/**
 * BENCHMARK ANALÍTICO — falhas POR CATEGORIA, nunca uma nota agregada.
 *
 * `npm run benchmark-analitico`
 *
 * POR QUE NÃO UMA NOTA SÓ. Uma média esconde exatamente o que importa: 12 de 13
 * casos verdes com o único vermelho sendo "ausência convertida em zero" é um
 * sistema que erra caro, e sai como 92%. O relatório aqui é uma matriz — se uma
 * célula inteira falha, ela aparece como célula, não diluída.
 *
 * O QUE ESTE ARQUIVO NÃO É: não é o portão. O portão é
 * `analitico-holdout.test.ts`, que roda no `npm test` e reprova o commit. Este
 * aqui é o instrumento de LEITURA — ele mostra onde a matriz tem buraco, e por
 * isso imprime também as células que NENHUM caso cobre. Buraco de cobertura
 * declarado é informação; buraco não declarado é a impressão de ter olhado tudo.
 */

import { montarDossie } from '../../servidor/nucleo/kernel/DossieAnalitico';
import { AGORA, CENARIOS, type CenarioAnalitico } from './cenarios';

const ORDEM = ['nenhum', 'descritiva', 'populacional', 'comparativa', 'causal'] as const;
const altura = (d: string): number => ORDEM.indexOf(d as (typeof ORDEM)[number]);
const FORCA = { baixa: 1, media: 2, alta: 3 } as const;

interface Resultado {
  readonly cenario: CenarioAnalitico;
  readonly passou: boolean;
  readonly quebras: readonly string[];
  readonly degrau: string;
  readonly veredicto: string;
  readonly confianca: string;
  readonly ms: number;
}

function avaliar(c: CenarioAnalitico): Resultado {
  const t0 = process.hrtime.bigint();
  const d = montarDossie({
    analise_id: `bench-${c.id}`,
    pergunta: c.pergunta,
    evidencias: c.evidencias,
    ferramentas: c.ferramentas,
    agora: AGORA,
  });
  const ms = Number(process.hrtime.bigint() - t0) / 1_000_000;

  const codigos = d.ressalvas.map((x) => x.codigo);
  const quebras: string[] = [];

  if (c.esperado.veredicto && d.suficiencia.veredicto !== c.esperado.veredicto) {
    quebras.push(`veredicto ${d.suficiencia.veredicto} ≠ ${c.esperado.veredicto}`);
  }
  if (c.esperado.degrau_maximo && altura(d.degrau) > altura(c.esperado.degrau_maximo)) {
    quebras.push(`degrau ${d.degrau} acima de ${c.esperado.degrau_maximo}`);
  }
  for (const r of c.esperado.ressalvas_exigidas ?? []) {
    if (!codigos.includes(r)) quebras.push(`faltou ${r}`);
  }
  for (const r of c.esperado.ressalvas_proibidas ?? []) {
    if (codigos.includes(r)) quebras.push(`indevida ${r}`);
  }
  if (
    c.esperado.confianca_maxima &&
    FORCA[d.suficiencia.confiabilidade.confianca] > FORCA[c.esperado.confianca_maxima]
  ) {
    quebras.push(
      `confiança ${d.suficiencia.confiabilidade.confianca} acima de ${c.esperado.confianca_maxima}`,
    );
  }
  if (c.esperado.exige_o_que_falta && d.suficiencia.o_que_falta.length === 0) {
    quebras.push('não disse o que falta');
  }

  return {
    cenario: c,
    passou: quebras.length === 0,
    quebras,
    degrau: d.degrau,
    veredicto: d.suficiencia.veredicto,
    confianca: d.suficiencia.confiabilidade.confianca,
    ms,
  };
}

function porCategoria(rs: readonly Resultado[], chave: keyof CenarioAnalitico): void {
  const grupos = new Map<string, { total: number; falhas: number; ids: string[] }>();
  for (const r of rs) {
    const k = String(r.cenario[chave]);
    const g = grupos.get(k) ?? { total: 0, falhas: 0, ids: [] };
    g.total += 1;
    if (!r.passou) {
      g.falhas += 1;
      g.ids.push(r.cenario.id);
    }
    grupos.set(k, g);
  }
  console.log(`\n  por ${String(chave).toUpperCase()}`);
  for (const [k, g] of [...grupos.entries()].sort()) {
    const marca = g.falhas === 0 ? 'ok  ' : 'FALHA';
    const detalhe = g.falhas > 0 ? `  ← ${g.ids.join(', ')}` : '';
    console.log(
      `    ${marca} ${k.padEnd(20)} ${g.total - g.falhas}/${g.total}${detalhe}`,
    );
  }
}

/**
 * AS CÉLULAS QUE NINGUÉM COBRE. Sem isto, um benchmark 100% verde sobre 3
 * domínios pareceria idêntico a um 100% verde sobre 11 — e a diferença é o
 * trabalho inteiro.
 */
function buracos(rs: readonly Resultado[]): void {
  const universo = {
    dominio: [
      'operacional', 'financeiro', 'dados', 'qualidade', 'processos', 'pessoas',
      'clientes', 'risco', 'gestao', 'estrategia', 'executivo',
    ],
    complexidade: ['simples', 'media', 'alta', 'multidimensional'],
    evidencia: ['completa', 'parcial', 'contraditoria', 'desatualizada', 'ausente'],
    raciocinio: [
      'comparacao', 'agregacao', 'tendencia', 'anomalia', 'concentracao', 'causalidade',
      'previsao', 'cenario', 'tradeoff', 'priorizacao', 'decisao',
    ],
    risco: ['baixo', 'medio', 'alto', 'critico'],
  } as const;

  console.log('\n  BURACOS DA MATRIZ — dimensões declaradas e não exercitadas');
  for (const [eixo, valores] of Object.entries(universo)) {
    const vistos = new Set(rs.map((r) => String(r.cenario[eixo as keyof CenarioAnalitico])));
    const faltando = valores.filter((v) => !vistos.has(v));
    console.log(
      `    ${eixo.padEnd(14)} ${vistos.size}/${valores.length} coberto` +
        (faltando.length > 0 ? `  — SEM CASO: ${faltando.join(', ')}` : ''),
    );
  }
}

const resultados = CENARIOS.map(avaliar);
const falhas = resultados.filter((r) => !r.passou);
const tempoTotal = resultados.reduce((s, r) => s + r.ms, 0);

console.log('='.repeat(78));
console.log('BENCHMARK ANALÍTICO — holdout');
console.log('='.repeat(78));

console.log('\n  CASO A CASO');
for (const r of resultados) {
  const marca = r.passou ? 'ok  ' : 'FALHA';
  console.log(
    `    ${marca} ${r.cenario.id}  ${r.veredicto.padEnd(22)} degrau=${r.degrau.padEnd(13)} ` +
      `confiança=${r.confianca.padEnd(6)} ${r.ms.toFixed(2)}ms`,
  );
  if (!r.passou) for (const q of r.quebras) console.log(`           └─ ${q}`);
}

for (const eixo of ['dominio', 'complexidade', 'evidencia', 'raciocinio', 'risco'] as const) {
  porCategoria(resultados, eixo);
}

buracos(resultados);

/**
 * LATÊNCIA E CUSTO — as duas últimas linhas do que a missão manda medir.
 *
 * O custo em tokens é ZERO por construção, e essa é a propriedade principal
 * desta camada: toda a crítica é aritmética local. Não é uma otimização — é o
 * que permite rodar 13 cenários em milissegundos e o que torna o resultado
 * reprodutível. Um crítico que chamasse modelo teria custo, latência de rede e
 * variância entre execuções.
 */
console.log('\n  LATÊNCIA E CUSTO');
console.log(`    total          ${tempoTotal.toFixed(2)}ms para ${resultados.length} cenários`);
console.log(`    pior caso      ${Math.max(...resultados.map((r) => r.ms)).toFixed(2)}ms`);
console.log('    tokens         0 — a camada não chama modelo em nenhum caminho');

console.log('\n' + '='.repeat(78));
console.log(
  falhas.length === 0
    ? `VEREDITO DO BENCHMARK: ${resultados.length}/${resultados.length} — nenhuma categoria vermelha`
    : `VEREDITO DO BENCHMARK: ${falhas.length} FALHA(S) — ${falhas.map((f) => f.cenario.id).join(', ')}`,
);
console.log('='.repeat(78));

process.exitCode = falhas.length === 0 ? 0 : 1;
