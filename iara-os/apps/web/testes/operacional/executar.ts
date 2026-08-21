/**
 * SCORECARD DA INTELIGÊNCIA OPERACIONAL — `npm run operacional`.
 *
 * ===========================================================================
 * TRÊS CAMADAS, TRÊS NÚMEROS
 * ===========================================================================
 *
 *   1. LINGUÍSTICA   o que a pessoa quis dizer?
 *   2. OPERACIONAL   dado o POP, a etapa e a evidência, o que é PERMITIDO?
 *   3. PEDAGÓGICA    a pessoa consegue executar o procedimento?
 *
 * Elas não se somam numa nota. Um sistema pode acertar 98% das intenções e ser
 * péssimo instrutor se omitir uma pré-condição crítica nos 2% restantes — e uma
 * média esconde exatamente isso.
 *
 * ===========================================================================
 * A MÉTRICA QUE NÃO ADMITE MEIO-TERMO
 * ===========================================================================
 *
 *     AVANÇO INDEVIDO = 0
 *
 * Uma etapa que anda sobre hesitação, negativa ou relato de resultado é o
 * defeito mais caro que uma instrutora operacional pode ter: o registro passa a
 * afirmar que alguém executou algo que ninguém executou. Qualquer número
 * diferente de zero aqui reprova a entrega inteira, por pior que estejam as
 * outras colunas.
 *
 * SEM REDE, SEM LLM. Tudo aqui é determinístico e roda offline: o que se mede é
 * a DECISÃO das travas, não a redação de uma resposta.
 */

import { classificarEvidencia } from '../../servidor/nucleo/kernel/GuardiaoDoProcedimento';
import { classificarIntencao } from '../../servidor/nucleo/kernel/IntencaoProcedimento';
import {
  DECLARACOES,
  EXIGEM_POP,
  FORA_DO_CORPUS,
  HESITACOES,
  INVERSOES,
  MATRIZ,
  NEGATIVAS,
  RESULTADOS,
  type CasoOperacional,
} from './intencoes';

const pct = (n: number, d: number): string => (d === 0 ? '  — ' : `${((100 * n) / d).toFixed(0)}%`);
const taxa = (n: number, d: number): string => `${n}/${d}`.padEnd(8) + pct(n, d).padStart(5);

interface Resultado {
  readonly nome: string;
  readonly ok: number;
  readonly total: number;
  readonly falhas: readonly string[];
}

/**
 * O portão de evidência. É o que decide se o procedimento anda — e por isso é a
 * única coluna com meta absoluta.
 */
function medirEvidencia(nome: string, casos: readonly CasoOperacional[]): Resultado {
  const falhas: string[] = [];
  let ok = 0;
  for (const c of casos) {
    const obtido = classificarEvidencia(c.frase);
    const acertou = (obtido === 'declarada') === (c.evidencia === 'declarada');
    if (acertou) ok += 1;
    else {
      falhas.push(
        `« ${c.frase} » esperado ${c.evidencia}, veio ${obtido}` +
          (c.porque ? `  (${c.porque})` : ''),
      );
    }
  }
  return { nome, ok, total: casos.length, falhas };
}

/**
 * AVANÇO INDEVIDO — quantas frases que NÃO declaram conclusão produziriam
 * avanço. Conta separado de propósito: é a métrica de meta zero.
 */
function medirAvancoIndevido(): Resultado {
  const naoDeclaram = [...HESITACOES, ...NEGATIVAS, ...RESULTADOS];
  const falhas = naoDeclaram
    .filter((c) => classificarEvidencia(c.frase) === 'declarada')
    .map((c) => `« ${c.frase} » (${c.intencao}) avançaria a etapa`);
  return {
    nome: 'avanço indevido',
    ok: naoDeclaram.length - falhas.length,
    total: naoDeclaram.length,
    falhas,
  };
}

/**
 * INVERSÃO E INJEÇÃO — o operador (ou um texto que ele colou) mandando a IARA
 * registrar o que não aconteceu. A regra do guardião não é negociável por quem
 * fala com ele.
 */
function medirInversao(): Resultado {
  const falhas = INVERSOES.filter((f) => classificarEvidencia(f) === 'declarada').map(
    (f) => `« ${f} » produziu evidência de conclusão`,
  );
  return {
    nome: 'inversão / injeção',
    ok: INVERSOES.length - falhas.length,
    total: INVERSOES.length,
    falhas,
  };
}

/**
 * O pedido chega ao POP? A âncora de procedimento é o que separa "responder de
 * cabeça sobre um ERP" de "consultar a documentação oficial da casa".
 */
function medirAlcanceDoPop(): Resultado {
  const falhas = EXIGEM_POP.filter((c) => classificarIntencao(c.frase) === null).map(
    (c) => `« ${c.frase} » (${c.intencao}) não alcançou o procedimento`,
  );
  return {
    nome: 'pedido alcança o POP',
    ok: EXIGEM_POP.length - falhas.length,
    total: EXIGEM_POP.length,
    falhas,
  };
}

function imprimir(r: Resultado, meta?: 'zero'): void {
  const marca = meta === 'zero' && r.falhas.length > 0 ? ' ⛔' : '';
  console.log(`  ${r.nome.padEnd(26)} ${taxa(r.ok, r.total)}${marca}`);
  for (const f of r.falhas) console.log(`      ${f}`);
}

function main(): void {
  console.log('\n═══ INTELIGÊNCIA OPERACIONAL DA IARA ═══');

  console.log('\n1. LINGUÍSTICA — a frase foi classificada corretamente?\n');
  const blocos = [
    medirEvidencia('declaração', DECLARACOES),
    medirEvidencia('hesitação', HESITACOES),
    medirEvidencia('negativa / erro', NEGATIVAS),
    medirEvidencia('relato de resultado', RESULTADOS),
  ];
  for (const b of blocos) imprimir(b);
  const totalOk = blocos.reduce((s, b) => s + b.ok, 0);
  const total = blocos.reduce((s, b) => s + b.total, 0);
  console.log(`  ${'TODAS'.padEnd(26)} ${taxa(totalOk, total)}`);

  console.log('\n2. OPERACIONAL — o que é permitido fazer com isso?\n');
  const avanco = medirAvancoIndevido();
  const inversao = medirInversao();
  const pop = medirAlcanceDoPop();
  imprimir(avanco, 'zero');
  imprimir(inversao, 'zero');
  imprimir(pop);

  console.log('\n3. LACUNAS DECLARADAS — o que este arnês NÃO mede\n');
  /**
   * Nenhuma destas é marcada verde por ausência de caso. A ordem de validação
   * é explícita: sem cobertura, LACUNA — nunca sucesso.
   */
  for (const l of [
    'alucinação contra os 11 POPs — exige o corpus indexado e roda em `npm run alucinacao`',
    'condução ponta a ponta com operador novo — exige sessão real, não roda aqui',
    'limiar de aderência contra telas reais do GW — proxy textual, ver relatório',
  ]) {
    console.log(`  LACUNA  ${l}`);
  }

  const reprovado = avanco.falhas.length > 0 || inversao.falhas.length > 0;
  console.log(
    `\nVEREDITO: ${reprovado ? '⛔ REPROVADO — avanço indevido ou inversão aceita' : 'sem avanço indevido e sem inversão aceita'}`,
  );
  console.log('');
  if (reprovado) process.exit(1);
}

main();
