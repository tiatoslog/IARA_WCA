/**
 * REGRESSÃO — de "a versão atual passa" para "a versão atual não piorou".
 *
 * O QUE FALTAVA, e é uma ausência, não um defeito: o `Diario.jsonl` já grava uma
 * linha por execução com `commit` e `metricas`, e o `MotorVeredito` já apura o
 * commit atual. Ninguém comparava dois commits. O resultado é que um commit
 * podia derrubar a taxa de sucesso de uma bateria de 100% para 60% e sair
 * `PRONTO`, porque "passou" era medido contra o próprio commit e não contra
 * ontem.
 *
 * POR DIMENSÃO, NUNCA POR SOMA. Um commit que melhora conversa e quebra execução
 * não pode aparecer como empate favorável. É a mesma disciplina que faz o
 * veredito geral ser a MENOR das cinco notas em vez da média: a média é o lugar
 * onde uma dimensão quebrada se esconde atrás de duas boas.
 *
 * A LINHA DE BASE NÃO É "O COMMIT ANTERIOR", é o último commit que a apuração
 * considerou utilizável. Comparar com um commit quebrado faria um commit ainda
 * quebrado sair "sem regressão" — a régua não pode ser o próprio buraco.
 *
 * Este arquivo não importa nada de `servidor/` nem executa nada: lê o diário e
 * compara números. É pura de propósito, como a tabela de verdade da campanha,
 * porque uma peça que decide se algo piorou não pode depender de disco e rede
 * para ser testada.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RegistroEvidencia } from './contrato';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export interface Limiares {
  readonly queda_relativa_erro: number;
  readonly queda_relativa_aviso: number;
  readonly piora_de_latencia_erro: number;
  readonly dimensoes_criticas: readonly string[];
}

export function lerLimiares(caminho = path.join(AQUI, 'limiares-regressao.json')): Limiares {
  const j = JSON.parse(readFileSync(caminho, 'utf8')) as Partial<Limiares>;
  /* Campo ausente NÃO vira padrão silencioso: um limiar inventado em tempo de
     execução é um limiar que ninguém revisou, e a comparação inteira passa a
     medir uma régua que não está no diff de commit nenhum. */
  for (const c of [
    'queda_relativa_erro',
    'queda_relativa_aviso',
    'piora_de_latencia_erro',
  ] as const) {
    if (typeof j[c] !== 'number' || !Number.isFinite(j[c])) {
      throw new Error(`limiares-regressao.json: "${c}" ausente ou não é número`);
    }
  }
  if (!Array.isArray(j.dimensoes_criticas)) {
    throw new Error('limiares-regressao.json: "dimensoes_criticas" ausente');
  }
  return j as Limiares;
}

export type Severidade = 'CRITICO' | 'ERRO' | 'AVISO' | 'PASSOU';

const PESO: Readonly<Record<Severidade, number>> = {
  PASSOU: 0,
  AVISO: 1,
  ERRO: 2,
  CRITICO: 3,
};

export const maisSevera = (a: Severidade, b: Severidade): Severidade =>
  PESO[a] >= PESO[b] ? a : b;

export interface Diferenca {
  readonly bateria: string;
  readonly dimensao: string;
  readonly baseline: number;
  readonly atual: number;
  readonly severidade: Severidade;
  /** Uma linha dizendo por que ESTA severidade. Vai para o relatório. */
  readonly porque: string;
}

export interface Comparacao {
  readonly commit_atual: string;
  readonly commit_baseline: string | null;
  /**
   * A base escolhida era um commit VALIDADO?
   *
   * Existe porque a regra estrita — "só compare com commit que podia ser
   * chamado de pronto" — deixaria a comparação INERTE neste projeto: o diário
   * tem 96 registros e nenhum commit jamais alcançou `PRONTO`, então a resposta
   * seria sempre "sem linha de base". Uma trava que nunca deixa medir não
   * protege ninguém; ela só garante que ninguém olhe.
   *
   * Com `false`, a comparação vale como TENDÊNCIA e o relatório diz isso: "não
   * piorou em relação a um commit que também não estava provado" é informação
   * útil e é uma frase diferente de "não piorou".
   */
  readonly baseline_validada: boolean;
  readonly severidade: Severidade;
  readonly diferencas: readonly Diferenca[];
  /** Baterias que existiam na base e sumiram do atual, e vice-versa. */
  readonly cobertura_perdida: readonly string[];
  readonly cobertura_nova: readonly string[];
  readonly resumo: string;
}

const mesmoCommit = (a: string, b: string): boolean => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
};

/** Taxa de aprovação da bateria. `null` quando ela não mediu nada — e `null`
 *  nunca vira zero: "não mediu" e "mediu e falhou tudo" são coisas opostas. */
function taxa(r: RegistroEvidencia): number | null {
  return r.cenarios > 0 ? r.passou / r.cenarios : null;
}

/**
 * A LINHA DE BASE: o commit anterior mais recente com registro utilizável.
 *
 * `utilizavel` é injetado pelo chamador (que conhece o `MotorVeredito`) para que
 * este arquivo continue puro. Sem ele, cai no último commit distinto que tenha
 * registro — que é melhor que nada e pior que a régua certa, e o relatório diz
 * qual dos dois foi usado.
 */
export function escolherBaseline(
  registros: readonly RegistroEvidencia[],
  commitAtual: string,
  utilizavel?: (commit: string) => boolean,
): string | null {
  const outros = registros.filter((r) => !mesmoCommit(r.commit, commitAtual));
  /* Mais recente primeiro, pelo instante ISO gravado na própria linha — nunca
     pela ordem do arquivo: append-only não garante ordem cronológica quando duas
     máquinas escrevem no mesmo diário. */
  const porData = [...outros].sort((a, b) => b.instante.localeCompare(a.instante));
  const vistos = new Set<string>();
  for (const r of porData) {
    if (vistos.has(r.commit)) continue;
    vistos.add(r.commit);
    if (!utilizavel || utilizavel(r.commit)) return r.commit;
  }
  return null;
}

/** O registro mais recente de cada bateria naquele commit. */
function porBateria(
  registros: readonly RegistroEvidencia[],
  commit: string,
): Map<string, RegistroEvidencia> {
  const mapa = new Map<string, RegistroEvidencia>();
  for (const r of registros.filter((x) => mesmoCommit(x.commit, commit))) {
    const anterior = mapa.get(r.bateria);
    if (!anterior || r.instante > anterior.instante) mapa.set(r.bateria, r);
  }
  return mapa;
}

function compararDimensaoCritica(
  bateria: string,
  dimensao: string,
  base: number,
  atual: number,
): Diferenca | null {
  if (atual <= base) return null;
  return {
    bateria,
    dimensao,
    baseline: base,
    atual,
    severidade: 'CRITICO',
    porque:
      `dimensão crítica subiu de ${base} para ${atual} — não há percentual aceitável ` +
      'de mentira operacional, execução não autorizada ou vazamento',
  };
}

export function comparar(entrada: {
  readonly registros: readonly RegistroEvidencia[];
  readonly commitAtual: string;
  readonly commitBaseline: string | null;
  readonly limiares: Limiares;
  /** `false` quando a base é só o commit anterior, não um commit provado. */
  readonly baselineValidada?: boolean;
}): Comparacao {
  const { registros, commitAtual, commitBaseline, limiares } = entrada;
  const baseline_validada = entrada.baselineValidada ?? true;
  const atual = porBateria(registros, commitAtual);

  if (!commitBaseline) {
    return {
      commit_atual: commitAtual,
      commit_baseline: null,
      baseline_validada: false,
      /* SEM LINHA DE BASE NÃO É "PASSOU". É a mesma regra do `ESTADO_DESCONHECIDO`
         da campanha: não saber se piorou é diferente de saber que não piorou, e
         só um dos dois autoriza alguém a seguir em frente tranquilo. */
      severidade: 'AVISO',
      diferencas: [],
      cobertura_perdida: [],
      cobertura_nova: [...atual.keys()],
      resumo:
        'sem linha de base: nenhum commit anterior tem registro utilizável no diário. ' +
        'Não há como afirmar que não houve regressão.',
    };
  }

  const base = porBateria(registros, commitBaseline);
  const diferencas: Diferenca[] = [];
  let severidade: Severidade = 'PASSOU';

  for (const [nome, b] of base) {
    const a = atual.get(nome);
    if (!a) continue; // cobertura perdida é tratada abaixo, não como queda de taxa

    // ---- Dimensões críticas: qualquer aumento bloqueia. --------------------
    for (const d of limiares.dimensoes_criticas) {
      const dif = compararDimensaoCritica(nome, d, b.metricas[d] ?? 0, a.metricas[d] ?? 0);
      if (dif) {
        diferencas.push(dif);
        severidade = maisSevera(severidade, dif.severidade);
      }
    }

    // ---- Status: passar para falhar é crítico, sem discussão de percentual.
    if (b.status === 'EXECUTADA_PASSOU' && a.status === 'EXECUTADA_FALHOU') {
      diferencas.push({
        bateria: nome,
        dimensao: 'status',
        baseline: 1,
        atual: 0,
        severidade: 'CRITICO',
        porque: 'a bateria passava na linha de base e falha agora',
      });
      severidade = 'CRITICO';
    }

    // ---- Taxa de aprovação, com os limiares do arquivo. --------------------
    const tb = taxa(b);
    const ta = taxa(a);
    if (tb !== null && ta !== null && tb > 0) {
      const queda = (tb - ta) / tb;
      if (queda > limiares.queda_relativa_aviso) {
        const sev: Severidade = queda > limiares.queda_relativa_erro ? 'ERRO' : 'AVISO';
        diferencas.push({
          bateria: nome,
          dimensao: 'taxa_aprovacao',
          baseline: Number(tb.toFixed(4)),
          atual: Number(ta.toFixed(4)),
          severidade: sev,
          porque:
            `queda de ${(queda * 100).toFixed(1)}% (limiar ${sev === 'ERRO' ? 'de erro' : 'de aviso'}: ` +
            `${((sev === 'ERRO' ? limiares.queda_relativa_erro : limiares.queda_relativa_aviso) * 100).toFixed(1)}%)`,
        });
        severidade = maisSevera(severidade, sev);
      }
    }

    // ---- Latência: dimensão de produto, não de correção. -------------------
    const lb = b.metricas.latencia_ms ?? b.metricas.ms_p50;
    const la = a.metricas.latencia_ms ?? a.metricas.ms_p50;
    if (typeof lb === 'number' && typeof la === 'number' && lb > 0) {
      const piora = (la - lb) / lb;
      if (piora > limiares.piora_de_latencia_erro) {
        diferencas.push({
          bateria: nome,
          dimensao: 'latencia',
          baseline: lb,
          atual: la,
          severidade: 'ERRO',
          porque: `${(piora * 100).toFixed(0)}% mais lento — quem espera não distingue lentidão de defeito`,
        });
        severidade = maisSevera(severidade, 'ERRO');
      }
    }
  }

  /**
   * COBERTURA PERDIDA É REGRESSÃO. Uma bateria que rodava e parou de rodar
   * melhora todos os números e piora o que se sabe — e é a forma mais fácil de
   * um commit "não regredir": deixando de medir.
   */
  const cobertura_perdida = [...base.keys()].filter((n) => !atual.has(n));
  if (cobertura_perdida.length > 0) severidade = maisSevera(severidade, 'ERRO');
  const cobertura_nova = [...atual.keys()].filter((n) => !base.has(n));

  /* A ressalva vai colada no resumo, não numa nota de rodapé: quem lê a linha
     "sem regressão" precisa ler, na MESMA linha, contra o que foi comparado. */
  const ressalva = baseline_validada
    ? ''
    : ' — atenção: a base não é um commit validado, isto é tendência, não prova';
  const resumo =
    severidade === 'PASSOU'
      ? `sem regressão relevante contra ${commitBaseline.slice(0, 7)} ` +
        `(${base.size} baterias comparadas)${ressalva}`
      : `${severidade}: ${diferencas.length} diferença(s)` +
        (cobertura_perdida.length
          ? ` · ${cobertura_perdida.length} bateria(s) deixaram de rodar`
          : '') +
        ressalva;

  return {
    commit_atual: commitAtual,
    commit_baseline: commitBaseline,
    baseline_validada,
    severidade,
    diferencas,
    cobertura_perdida,
    cobertura_nova,
    resumo,
  };
}

/** Texto para terminal e relatório. Sem cor, sem enfeite — como o `resumo` do veredito. */
export function emTexto(c: Comparacao): string {
  const cabecalho = [
    `REGRESSÃO: ${c.severidade}`,
    `atual ${c.commit_atual.slice(0, 7)} vs base ${c.commit_baseline?.slice(0, 7) ?? '(nenhuma)'}`,
    `  ${c.resumo}`,
  ];
  if (c.diferencas.length === 0 && c.cobertura_perdida.length === 0) return cabecalho.join('\n');
  return [
    ...cabecalho,
    '',
    ...c.diferencas.map(
      (d) =>
        `  ${d.severidade.padEnd(8)} ${d.bateria} · ${d.dimensao}: ` +
        `${d.baseline} → ${d.atual} — ${d.porque}`,
    ),
    ...c.cobertura_perdida.map((n) => `  ERRO     ${n} · deixou de rodar (cobertura perdida)`),
  ].join('\n');
}
