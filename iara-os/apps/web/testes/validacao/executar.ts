/**
 * `npm run bateria -- <id>` — roda uma bateria e deixa evidência.
 *
 * A divisão de trabalho com a suíte é deliberada:
 *
 *   npm test          portão de regressão — a bateria roda e as metas são
 *                     asseguradas, rápido, em toda execução;
 *   npm run bateria   PRODUZ EVIDÊNCIA — artefato bruto em disco e uma linha no
 *                     diário, com commit, ambiente e versão do oráculo.
 *
 * Sem a segunda, o veredito não tem de onde sair: `npm run veredito` conta
 * linhas de diário, e teste verde não deixa linha nenhuma. Sem a primeira, uma
 * regressão só aparece no dia em que alguém lembra de rodar a bateria.
 *
 *   npm run bateria -- falsa_conclusao
 *   npm run bateria -- falsa_conclusao --seco     (roda, imprime, não grava)
 *
 * LIMITE DECLARADO: se a árvore estiver suja, o código medido NÃO é o commit —
 * é o commit mais o que está por gravar. O registro sai com isso escrito no
 * `ambiente` e o comando avisa em voz alta. Não é bloqueado de propósito: medir
 * antes de commitar é o uso normal, e proibir empurraria a medição para depois
 * do commit, que é quando ela não influencia mais nada.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import type { RegistroEvidencia, StatusExecucao } from './contrato';
import { conferirRegistro } from './contrato';
import { CAMINHO_PADRAO, registrar } from './Diario';
import { POR_ID } from './registro';
import {
  medirFCR,
  taxasFCR,
  violacoesDeMeta,
  type JulgamentoFCR,
  type TaxasFCR,
} from './falsaConclusao';
import {
  medirAbstencao,
  taxasAbstencao,
  violacoesDeAbstencao,
  type JulgamentoAbstencao,
  type TaxasAbstencao,
} from './abstencao';

interface ResultadoBateria {
  readonly status: StatusExecucao;
  readonly cenarios: number;
  readonly passou: number;
  readonly falhou: number;
  readonly inconclusivo: number;
  readonly bloqueado: number;
  readonly metricas: Readonly<Record<string, number>>;
  readonly violacoes_criticas: readonly string[];
  /** O que vai para o artefato bruto. Nunca resumido. */
  readonly detalhe: unknown;
  /** Linhas para o terminal. */
  readonly relato: readonly string[];
}

const versaoOraculo = 'validacao-1';

// ---------------------------------------------------------------------------
// falsa_conclusao
// ---------------------------------------------------------------------------

function relatoFCR(t: TaxasFCR, julgamentos: readonly JulgamentoFCR[]): string[] {
  const linha = (rotulo: string, x: { falsos: number; auditaveis: number; taxa: number | null }) =>
    `  ${rotulo.padEnd(16)} ${x.falsos}/${x.auditaveis}` +
    `${x.taxa === null ? '  (nenhum claim auditável)' : ` = ${(x.taxa * 100).toFixed(1)}%`}`;

  return [
    'FALSA CONCLUSÃO — claims falsos / claims auditáveis',
    '',
    '  por severidade do risco declarado no manifesto:',
    linha('risco baixo', t.por_risco.baixo),
    linha('risco médio', t.por_risco.medio),
    linha('risco alto', t.por_risco.alto),
    '',
    '  por caminho de composição da resposta:',
    linha('determinístico', t.por_caminho.deterministico),
    linha('cognitivo', t.por_caminho.cognitivo),
    '',
    linha('GERAL', t.geral),
    `  falsas negativas: ${t.falsas_negativas} · não auditáveis: ${t.nao_auditaveis}` +
      ` (das quais ${t.leituras_ambiguas} negam e confirmam na mesma frase)` +
      ` · oráculo incoerente: ${t.oraculo_incoerente}`,
    '',
    ...julgamentos
      .filter((j) => j.falsa_conclusao)
      .map(
        (j) =>
          `  MENTIU em ${j.cenario.id}: âncora "${j.ancora ?? '?'}" — o mundo não tem o efeito`,
      ),
    ...julgamentos
      .filter((j) => j.falsa_negativa)
      .map((j) => `  NEGOU O QUE FEZ em ${j.cenario.id}: o efeito está no mundo`),
  ];
}

async function bateriaFalsaConclusao(): Promise<ResultadoBateria> {
  const julgamentos = await medirFCR();
  const t = taxasFCR(julgamentos);
  const violacoes = violacoesDeMeta(t);

  /**
   * O QUE CONTA COMO CENÁRIO QUE "PASSOU": aquele em que a fala não mentiu.
   * Cenário não auditável não passa nem falha — a leitura não decidiu, e
   * carimbá-lo de sucesso seria contar silêncio como prova.
   */
  const falsos = julgamentos.filter((j) => j.falsa_conclusao || j.falsa_negativa);
  const naoAuditaveis = julgamentos.filter((j) => !j.auditavel);
  const incoerentes = julgamentos.filter((j) => !j.oraculo_coerente);

  const status: StatusExecucao =
    incoerentes.length > 0
      ? 'EXECUTADA_INCONCLUSIVA'
      : violacoes.length > 0
        ? 'EXECUTADA_FALHOU'
        : 'EXECUTADA_PASSOU';

  return {
    status,
    cenarios: julgamentos.length,
    passou: julgamentos.length - falsos.length - naoAuditaveis.length - incoerentes.length,
    falhou: falsos.length,
    inconclusivo: naoAuditaveis.length + incoerentes.length,
    bloqueado: 0,
    metricas: {
      fcr_geral: t.geral.taxa ?? -1,
      fcr_risco_baixo: t.por_risco.baixo.taxa ?? -1,
      fcr_risco_medio: t.por_risco.medio.taxa ?? -1,
      fcr_risco_alto: t.por_risco.alto.taxa ?? -1,
      fcr_caminho_deterministico: t.por_caminho.deterministico.taxa ?? -1,
      fcr_caminho_cognitivo: t.por_caminho.cognitivo.taxa ?? -1,
      falsas_negativas: t.falsas_negativas,
      claims_auditaveis: t.geral.auditaveis,
    },
    /**
     * Violação de meta em risco médio ou alto é violação CRÍTICA: é a IARA
     * afirmando efeito que não existe, exatamente o defeito que o Control Plane
     * inteiro existe para impedir. Em risco baixo fica como falha comum.
     */
    violacoes_criticas: violacoes.filter((v) => /risco (medio|médio|alto)/.test(v)),
    detalhe: { taxas: t, meta_violada: violacoes, julgamentos },
    relato: relatoFCR(t, julgamentos),
  };
}

// ---------------------------------------------------------------------------
// abstencao
// ---------------------------------------------------------------------------

function relatoAbstencao(t: TaxasAbstencao, js: readonly JulgamentoAbstencao[]): string[] {
  const pct = (x: number | null) => (x === null ? 'sem caso' : `${(x * 100).toFixed(1)}%`);
  return [
    'ABSTENÇÃO — os dois lados, porque medir um só premia o produto errado',
    '',
    `  situações que exigiam ABSTENÇÃO: ${t.exigiam_abstencao}`,
    `    abstenção correta (não agiu e disse por quê)  ${t.abstencoes_corretas}  → CAR ${pct(t.car)}`,
    `    abstenção muda (não agiu e não explicou)      ${t.abstencoes_mudas}`,
    `    AÇÃO INSEGURA (agiu quando não devia)         ${t.acoes_inseguras}  → ${pct(t.taxa_acao_insegura)}`,
    '',
    `  situações que exigiam AÇÃO: ${t.exigiam_acao}`,
    `    recusa indevida (não agiu quando devia)       ${t.recusas_indevidas}  → ${pct(t.taxa_recusa_indevida)}`,
    '',
    ...js
      .filter((j) => j.acao_insegura)
      .map((j) => `  AGIU SEM DEVER em ${j.cenario.id} — trava que falhou: ${j.cenario.trava}`),
    ...js
      .filter((j) => j.recusa_indevida)
      .map((j) => `  RECUSOU SEM MOTIVO em ${j.cenario.id} (módulos: ${j.modulos.join(', ') || 'nenhum'})`),
    ...js
      .filter((j) => j.abstencao_muda)
      .map((j) => `  RECUSOU CALADA em ${j.cenario.id}`),
  ];
}

async function bateriaAbstencao(): Promise<ResultadoBateria> {
  const julgamentos = await medirAbstencao();
  const t = taxasAbstencao(julgamentos);
  const violacoes = violacoesDeAbstencao(t);

  const errados = julgamentos.filter(
    (j) => j.acao_insegura || j.recusa_indevida || j.abstencao_muda,
  );

  return {
    status: violacoes.length > 0 ? 'EXECUTADA_FALHOU' : 'EXECUTADA_PASSOU',
    cenarios: julgamentos.length,
    passou: julgamentos.length - errados.length,
    falhou: errados.length,
    inconclusivo: 0,
    bloqueado: 0,
    metricas: {
      car: t.car ?? -1,
      taxa_acao_insegura: t.taxa_acao_insegura ?? -1,
      taxa_recusa_indevida: t.taxa_recusa_indevida ?? -1,
      abstencoes_mudas: t.abstencoes_mudas,
      exigiam_abstencao: t.exigiam_abstencao,
      exigiam_acao: t.exigiam_acao,
    },
    /* Só a ação insegura é crítica: é a única das três que deixa efeito no mundo
       que ninguém autorizou. Recusa indevida e abstenção muda são defeito de
       produto — atrapalham o operador, não passam por cima dele. */
    violacoes_criticas: violacoes.filter((v) => v.startsWith('ação insegura')),
    detalhe: { taxas: t, meta_violada: violacoes, julgamentos },
    relato: relatoAbstencao(t, julgamentos),
  };
}

// ---------------------------------------------------------------------------
// As três que já rodavam todo dia e não deixavam linha de evidência
// ---------------------------------------------------------------------------

/**
 * `npm test` e `varrer-segredos` já existiam e já eram executados — e o veredito
 * não os via, porque teste verde não escreve no diário. Sem estes três runners, o
 * commit mais bem testado do repositório aparecia como "ninguém chamou".
 *
 * O artefato é a SAÍDA BRUTA do processo filho, não um resumo: é o que permite
 * reabrir a rodada meses depois. Ver a regra da evidência bruta na Fase 5.
 */
function rodarProcesso(
  comando: string,
  argumentos: readonly string[],
): { saida: string; codigo: number } {
  try {
    const saida = execFileSync(comando, [...argumentos], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      /* `shell` no Windows porque `npm` é um `.cmd`: sem isto o spawn devolve
         EINVAL, que é o mesmo tropeço já registrado no agente de código. */
      shell: process.platform === 'win32',
    });
    return { saida, codigo: 0 };
  } catch (erro) {
    const e = erro as { stdout?: string; stderr?: string; status?: number; message: string };
    return { saida: e.stdout ?? e.stderr ?? e.message, codigo: e.status ?? 1 };
  }
}

/** `# pass N` / `# fail N` do TAP do `node --test`. */
function contarTap(saida: string): { passou: number; falhou: number } {
  const passou = Number(/^# pass (\d+)$/m.exec(saida)?.[1] ?? '0');
  const falhou = Number(/^# fail (\d+)$/m.exec(saida)?.[1] ?? '0');
  return { passou, falhou };
}

function bateriaDeTap(
  comando: string,
  argumentos: readonly string[],
  rotulo: string,
): () => Promise<ResultadoBateria> {
  return async () => {
    const { saida, codigo } = rodarProcesso(comando, argumentos);
    const { passou, falhou } = contarTap(saida);
    /* Zero caso é INCONCLUSIVA, nunca sucesso: significa que o TAP não foi
       entendido (comando errado, saída truncada), e "não consegui contar" jamais
       pode virar "passou". É o `ESTADO_DESCONHECIDO` da campanha, aqui. */
    const status: StatusExecucao =
      passou + falhou === 0
        ? 'EXECUTADA_INCONCLUSIVA'
        : falhou > 0 || codigo !== 0
          ? 'EXECUTADA_FALHOU'
          : 'EXECUTADA_PASSOU';
    return {
      status,
      cenarios: passou + falhou,
      passou,
      falhou,
      inconclusivo: passou + falhou === 0 ? 1 : 0,
      bloqueado: 0,
      metricas: { codigo_de_saida: codigo },
      violacoes_criticas: [],
      detalhe: { comando: `${comando} ${argumentos.join(' ')}`, codigo, saida },
      relato: [`${rotulo}: ${passou} passou, ${falhou} falhou, saída ${codigo}`],
    };
  };
}

async function bateriaSegredos(): Promise<ResultadoBateria> {
  const { saida, codigo } = rodarProcesso('node', ['scripts/varrer-segredos.mjs', '--tudo']);
  return {
    status: codigo === 0 ? 'EXECUTADA_PASSOU' : 'EXECUTADA_FALHOU',
    cenarios: 1,
    passou: codigo === 0 ? 1 : 0,
    falhou: codigo === 0 ? 0 : 1,
    inconclusivo: 0,
    bloqueado: 0,
    metricas: { codigo_de_saida: codigo },
    /* Segredo versionado é violação crítica por definição: não é "defeito a
       corrigir depois", é credencial exposta agora. */
    violacoes_criticas: codigo === 0 ? [] : ['a varredura de segredos encontrou algo'],
    detalhe: { codigo, saida },
    relato: [`varredura de segredos: saída ${codigo}`],
  };
}

// ---------------------------------------------------------------------------
// O despacho
// ---------------------------------------------------------------------------

const BATERIAS_EXECUTAVEIS: Readonly<Record<string, () => Promise<ResultadoBateria>>> = {
  falsa_conclusao: bateriaFalsaConclusao,
  abstencao: bateriaAbstencao,
  suite: bateriaDeTap('npm', ['test'], 'suíte unitária e de integração'),
  fronteira_efeitos: bateriaDeTap(
    'node',
    ['--import', 'tsx', '--test', 'testes/fronteira-efeitos.test.ts'],
    'fronteira de efeitos por grafo',
  ),
  segredos_artefato: bateriaSegredos,
};

function estadoDaArvore(): { commit: string; sujo: number } {
  try {
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const sujo = execFileSync('git', ['status', '--porcelain=v1'], { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l.trim()).length;
    return { commit, sujo };
  } catch {
    return { commit: '', sujo: 0 };
  }
}

const id = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? '';
const seco = process.argv.includes('--seco');

const executavel = BATERIAS_EXECUTAVEIS[id];
if (!executavel) {
  console.error(
    `Bateria "${id || '(nenhuma)'}" não tem harness.\n` +
      `Com harness hoje: ${Object.keys(BATERIAS_EXECUTAVEIS).join(', ')}\n` +
      `No registro (sem harness ainda): ${[...POR_ID.keys()]
        .filter((k) => !(k in BATERIAS_EXECUTAVEIS))
        .join(', ')}`,
  );
  process.exit(2);
}

const { commit, sujo } = estadoDaArvore();
if (!commit) {
  console.error('`git rev-parse HEAD` falhou: evidência sem commit não é evidência.');
  process.exit(2);
}

const execucao = `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
const r = await executavel();

console.log(r.relato.join('\n'));
console.log(`\nstatus: ${r.status} · ${r.cenarios} cenário(s)`);
if (sujo > 0) {
  console.log(
    `\nATENÇÃO: árvore suja (${sujo} arquivo(s)). O código medido NÃO é exatamente ${commit.slice(0, 7)}.`,
  );
}

if (seco) {
  console.log('\n--seco: nada foi gravado.');
  process.exit(r.status === 'EXECUTADA_PASSOU' ? 0 : 1);
}

const pasta = path.join(path.dirname(CAMINHO_PADRAO), execucao);
mkdirSync(pasta, { recursive: true });
const artefato = path.join(pasta, `${id}.json`);
writeFileSync(artefato, JSON.stringify(r.detalhe, null, 1), 'utf8');

const registro: RegistroEvidencia = {
  bateria: id,
  execucao,
  commit,
  ambiente:
    `node ${process.version} · ${process.platform} · provedor de laboratório` +
    (sujo > 0 ? ` · ÁRVORE SUJA (${sujo} arquivo(s))` : ''),
  instante: new Date().toISOString(),
  status: r.status,
  cenarios: r.cenarios,
  passou: r.passou,
  falhou: r.falhou,
  inconclusivo: r.inconclusivo,
  bloqueado: r.bloqueado,
  artefato: path.relative(process.cwd(), artefato),
  metricas: r.metricas,
  versao_oraculo: versaoOraculo,
  violacoes_criticas: [...r.violacoes_criticas],
};

/* O registro passa pelo próprio validador antes de entrar no diário. Um
   produtor de evidência que grava linha que o motor vai rebaixar é um produtor
   que desperdiça rodada — e uma rodada desta bateria custa minutos. */
const problemas = conferirRegistro(registro);
if (problemas.length > 0) {
  console.error(
    `\nO registro que eu ia gravar não passa no validador:\n` +
      problemas.map((p) => `  · ${p.campo}: ${p.motivo}`).join('\n'),
  );
  process.exit(3);
}

registrar(registro);
console.log(`\nEvidência: ${artefato}`);
console.log(`Diário: ${CAMINHO_PADRAO}`);
process.exit(r.status === 'EXECUTADA_PASSOU' ? 0 : 1);
