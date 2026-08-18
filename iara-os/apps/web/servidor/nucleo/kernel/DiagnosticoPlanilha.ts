/**
 * DIAGNÓSTICO DE PLANILHA — a camada de hipótese sobre qualidade de dado.
 *
 * Mesma disciplina de `MotorAnalise.ts`, aplicada a uma tabela genérica em vez
 * de uma medição de sistema operacional. As três regras do cabeçalho de lá
 * valem aqui INTEIRAS:
 *
 *  1. HIPÓTESE SÓ NASCE DE ANOMALIA MEDIDA — nunca de regra de negócio. Só
 *     convenção ESTATÍSTICA genérica entra em `FAIXAS_PLANILHA`: taxa de valor
 *     vazio, dominância de valor único, linhas duplicadas, cerca de Tukey para
 *     outlier numérico. "Atraso", "margem que preocupa" e qualquer limiar que
 *     dependa do NEGÓCIO representado na planilha continuam de fora — mesma
 *     linha que `habilidades/cargasLuft.ts` já traçou.
 *  2. A CONFIANÇA NÃO É ESCRITA AQUI. Toda hipótese sai de `criarHipotese`
 *     (`Investigacao.ts`), que a calcula a partir das evidências.
 *  3. O QUE FOI CORTADO (planilha truncada pelo teto de linhas) é dito como
 *     `lacuna`, nunca omitido em silêncio.
 *
 * Importa só `Investigacao.ts`/`Verdade.ts` (via `Investigacao.ts`) e
 * `AnaliseTabular.ts` — nunca `AgenteLocal` nem nada que alcance o mundo,
 * mesma regra que blinda `MotorAnalise.ts` (`fronteira-interna.test.ts`, G3).
 *
 * NÃO produz `PlanoDeAcao`/`Recomendacao`: o pedido foi diagnóstico, não
 * correção — um "plano de limpeza de planilha" seria escopo não pedido.
 */

import type { CelulaValor, TabelaGenerica } from '../PlanilhaGenerica';
import { criarHipotese, ordenarHipoteses, type Anomalia, type Diagnostico, type Evidencia, type Hipotese, type Severidade } from './Investigacao';
import { perfilarTabela, type PerfilColuna } from './AnaliseTabular';

// ---------------------------------------------------------------------------
// Faixas — convenção estatística, nunca regra de negócio
// ---------------------------------------------------------------------------

/**
 * Limiares nomeados e exportados, mesmo espírito de `FAIXAS` em
 * `MotorAnalise.ts`: um número mágico enterrado numa comparação é um número
 * que ninguém discute. Todos os quatro são convenção estatística de proposito
 * geral — nenhum depende de saber o que a planilha REPRESENTA.
 */
export const FAIXAS_PLANILHA = {
  /** Fração de células vazias/nulas numa coluna. */
  taxa_nulo: { moderada: 0.2, grave: 0.5 },
  /** Fração das linhas que um único valor domina numa coluna. */
  dominancia_valor_unico: { moderada: 0.8, grave: 0.95 },
  /** Fração de linhas duplicadas na tabela inteira. */
  linhas_duplicadas: { moderada: 0.05, grave: 0.2 },
  /** Fração de valores de uma coluna numérica fora da cerca de Tukey abaixo. */
  taxa_outlier: { moderada: 0.05, grave: 0.15 },
  /** Multiplicador da cerca de Tukey (Q1 - k·IQR, Q3 + k·IQR) — convenção estatística padrão para outlier "leve". */
  outlier_iqr_multiplicador: 1.5,
} as const;

// ---------------------------------------------------------------------------
// 1. Detecção pura — outlier e duplicata
// ---------------------------------------------------------------------------

function quartil(ordenados: readonly number[], q: number): number {
  const pos = (ordenados.length - 1) * q;
  const base = Math.floor(pos);
  const resto = pos - base;
  const proximo = ordenados[base + 1];
  return proximo !== undefined ? ordenados[base] + resto * (proximo - ordenados[base]) : ordenados[base];
}

export interface ResultadoOutliers {
  /** Índices DENTRO do array `valores` recebido — não linha da tabela original. */
  readonly indices: readonly number[];
  readonly limite_inferior: number;
  readonly limite_superior: number;
}

/** Amostra menor que 4 pontos não sustenta quartil — devolve "nenhum outlier" em vez de um limiar sem sentido. */
export function detectarOutliersNumericos(valores: readonly number[]): ResultadoOutliers {
  if (valores.length < 4) return { indices: [], limite_inferior: -Infinity, limite_superior: Infinity };

  const ordenados = [...valores].sort((a, b) => a - b);
  const q1 = quartil(ordenados, 0.25);
  const q3 = quartil(ordenados, 0.75);
  const iqr = q3 - q1;
  const k = FAIXAS_PLANILHA.outlier_iqr_multiplicador;
  const limiteInferior = q1 - k * iqr;
  const limiteSuperior = q3 + k * iqr;

  const indices: number[] = [];
  valores.forEach((v, i) => {
    if (v < limiteInferior || v > limiteSuperior) indices.push(i);
  });
  return { indices, limite_inferior: limiteInferior, limite_superior: limiteSuperior };
}

function celulaParaChave(v: CelulaValor): string {
  return v === null ? '' : String(v);
}

export interface ResultadoDuplicatas {
  /** Índices (em `t.linhas`) das linhas que REPETEM uma linha anterior — não conta a primeira ocorrência. */
  readonly indices: readonly number[];
  readonly taxa: number;
}

export function detectarLinhasDuplicadas(t: TabelaGenerica): ResultadoDuplicatas {
  const vistos = new Set<string>();
  const indices: number[] = [];
  t.linhas.forEach((linha, i) => {
    const chave = linha.map(celulaParaChave).join('');
    if (vistos.has(chave)) indices.push(i);
    else vistos.add(chave);
  });
  return { indices, taxa: t.linhas.length > 0 ? indices.length / t.linhas.length : 0 };
}

// ---------------------------------------------------------------------------
// 2. Perfil + detecção → evidência (procedência: 'fato' — leitura direta do arquivo)
// ---------------------------------------------------------------------------

const FONTE = 'diagnostico_planilha';

export function evidenciasDePlanilha(
  t: TabelaGenerica,
  perfis: readonly PerfilColuna[],
  instante: string,
): Evidencia[] {
  const evidencias: Evidencia[] = [];
  const base = { fonte: FONTE, procedencia: 'fato' as const, relevancia: 'direta' as const, instante };

  for (const perfil of perfis) {
    if (perfil.total === 0) continue;

    evidencias.push({ ...base, metrica: `taxa_nulo:${perfil.nome}`, valor: perfil.taxa_nulo * 100, unidade: '%' });

    /**
     * Sobre os valores NÃO VAZIOS, não sobre `perfil.total` — dominância mede
     * "um valor só domina o que EXISTE", disjunto de `taxa_nulo` (que já cobre
     * o problema de célula vazia). Dividir pelo total contaria a ausência
     * duas vezes e escondia dominância real atrás de uma taxa de nulo alta.
     */
    const naoNulos = perfil.total - perfil.nulos;
    if (perfil.valor_mais_frequente && naoNulos > 0) {
      const dominancia = perfil.valor_mais_frequente.contagem / naoNulos;
      evidencias.push({ ...base, metrica: `dominancia_valor_unico:${perfil.nome}`, valor: dominancia * 100, unidade: '%' });
    }

    if (perfil.tipo_dominante === 'numero') {
      const valores = t.linhas
        .map((linha) => linha[perfil.indice])
        .filter((v): v is number => typeof v === 'number');
      if (valores.length > 0) {
        const outliers = detectarOutliersNumericos(valores);
        evidencias.push({
          ...base,
          metrica: `outliers:${perfil.nome}`,
          valor: (outliers.indices.length / valores.length) * 100,
          unidade: '%',
        });
      }
    }
  }

  if (t.linhas.length > 0) {
    const duplicatas = detectarLinhasDuplicadas(t);
    evidencias.push({ ...base, metrica: 'linhas_duplicadas', valor: duplicatas.taxa * 100, unidade: '%' });
  }

  return evidencias;
}

// ---------------------------------------------------------------------------
// 3. Evidência → anomalia (nunca fora de `FAIXAS_PLANILHA`)
// ---------------------------------------------------------------------------

function severidadeAcimaFracao(valorPercentual: number, faixa: { moderada: number; grave: number }): Severidade | null {
  if (valorPercentual >= faixa.grave * 100) return 'grave';
  if (valorPercentual >= faixa.moderada * 100) return 'moderada';
  return null;
}

function nomeColunaDaMetrica(metrica: string): string | null {
  const i = metrica.indexOf(':');
  return i === -1 ? null : metrica.slice(i + 1);
}

export function anomaliasDePlanilha(evidencias: readonly Evidencia[]): Anomalia[] {
  const anomalias: Anomalia[] = [];

  for (const e of evidencias) {
    if (typeof e.valor !== 'number') continue;
    const coluna = nomeColunaDaMetrica(e.metrica);

    if (e.metrica.startsWith('taxa_nulo:') && coluna) {
      const s = severidadeAcimaFracao(e.valor, FAIXAS_PLANILHA.taxa_nulo);
      if (s) {
        anomalias.push({
          evidencia: e,
          faixa_normal: `abaixo de ${FAIXAS_PLANILHA.taxa_nulo.moderada * 100}% vazio`,
          severidade: s,
          descricao: `a coluna "${coluna}" tem ${e.valor.toFixed(0)}% de células vazias`,
        });
      }
    } else if (e.metrica.startsWith('dominancia_valor_unico:') && coluna) {
      const s = severidadeAcimaFracao(e.valor, FAIXAS_PLANILHA.dominancia_valor_unico);
      if (s) {
        anomalias.push({
          evidencia: e,
          faixa_normal: `abaixo de ${FAIXAS_PLANILHA.dominancia_valor_unico.moderada * 100}% de um único valor`,
          severidade: s,
          descricao: `a coluna "${coluna}" tem ${e.valor.toFixed(0)}% das linhas com o mesmo valor`,
        });
      }
    } else if (e.metrica.startsWith('outliers:') && coluna) {
      const s = severidadeAcimaFracao(e.valor, FAIXAS_PLANILHA.taxa_outlier);
      if (s) {
        anomalias.push({
          evidencia: e,
          faixa_normal: `abaixo de ${FAIXAS_PLANILHA.taxa_outlier.moderada * 100}% de valores fora da cerca de Tukey`,
          severidade: s,
          descricao: `a coluna "${coluna}" tem ${e.valor.toFixed(0)}% de valores estatisticamente fora do padrão`,
        });
      }
    } else if (e.metrica === 'linhas_duplicadas') {
      const s = severidadeAcimaFracao(e.valor, FAIXAS_PLANILHA.linhas_duplicadas);
      if (s) {
        anomalias.push({
          evidencia: e,
          faixa_normal: `abaixo de ${FAIXAS_PLANILHA.linhas_duplicadas.moderada * 100}% de linhas repetidas`,
          severidade: s,
          descricao: `${e.valor.toFixed(0)}% das linhas são repetição de outra linha`,
        });
      }
    }
  }

  return anomalias;
}

// ---------------------------------------------------------------------------
// 4. Anomalia → hipótese (confiança sempre CALCULADA por `criarHipotese`)
// ---------------------------------------------------------------------------

/**
 * ≥2 métricas anômalas DISTINTAS na mesma coluna sustentam a hipótese juntas —
 * `criarHipotese` conta métricas distintas e sobe para `alta` sozinho quando
 * chegam duas; isto aqui só decide QUAIS evidências entram, nunca a confiança.
 */
export function hipotesesDePlanilha(anomalias: readonly Anomalia[]): Hipotese[] {
  const hipoteses: Hipotese[] = [];
  const porColuna = new Map<string, Anomalia[]>();
  const duplicatas: Anomalia[] = [];

  for (const a of anomalias) {
    if (a.evidencia.metrica === 'linhas_duplicadas') {
      duplicatas.push(a);
      continue;
    }
    const coluna = nomeColunaDaMetrica(a.evidencia.metrica);
    if (!coluna) continue;
    const lista = porColuna.get(coluna) ?? [];
    lista.push(a);
    porColuna.set(coluna, lista);
  }

  for (const [coluna, lista] of porColuna) {
    const enunciado =
      lista.length >= 2
        ? `a coluna "${coluna}" pode ter um problema de qualidade — ${lista.map((a) => a.descricao).join('; ')}`
        : `a coluna "${coluna}" merece atenção — ${lista[0].descricao}`;
    hipoteses.push(criarHipotese({ enunciado, sustentada_por: lista.map((a) => a.evidencia) }));
  }

  if (duplicatas.length > 0) {
    hipoteses.push(
      criarHipotese({
        enunciado: `a planilha pode ter linhas duplicadas — ${duplicatas[0].descricao}`,
        sustentada_por: duplicatas.map((a) => a.evidencia),
      }),
    );
  }

  return ordenarHipoteses(hipoteses);
}

// ---------------------------------------------------------------------------
// 5. Diagnóstico completo
// ---------------------------------------------------------------------------

export function diagnosticarPlanilha(t: TabelaGenerica, instante: string = new Date().toISOString()): Diagnostico {
  const perfis = perfilarTabela(t);
  const evidencias = evidenciasDePlanilha(t, perfis, instante);
  const anomalias = anomaliasDePlanilha(evidencias);

  const lacunas: string[] = [];
  if (t.truncada) {
    lacunas.push(
      `a planilha tem ${t.total_linhas} linhas de dado; só as primeiras ${t.linhas.length} foram analisadas`,
    );
  }

  return {
    problema: `qualidade dos dados de "${t.arquivo}" (aba "${t.aba}")`,
    evidencias,
    anomalias,
    hipoteses: hipotesesDePlanilha(anomalias),
    lacunas,
  };
}
