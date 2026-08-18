/**
 * DiagnosticoPlanilha — a camada de hipótese. O coração do teste é provar que
 * `criarHipotese` (importado de `Investigacao.ts`, nunca reimplementado) é
 * quem decide a confiança, e que nenhuma anomalia nasce fora de
 * `FAIXAS_PLANILHA` — nunca um limiar mágico solto no meio do código.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FAIXAS_PLANILHA,
  anomaliasDePlanilha,
  detectarLinhasDuplicadas,
  detectarOutliersNumericos,
  diagnosticarPlanilha,
  evidenciasDePlanilha,
  hipotesesDePlanilha,
} from '../servidor/nucleo/kernel/DiagnosticoPlanilha';
import { perfilarTabela } from '../servidor/nucleo/kernel/AnaliseTabular';
import type { Evidencia } from '../servidor/nucleo/kernel/Investigacao';
import type { CelulaValor, TabelaGenerica } from '../servidor/nucleo/PlanilhaGenerica';

function tabela(cabecalho: readonly string[], linhas: readonly (readonly CelulaValor[])[], truncada = false, totalLinhasReal?: number): TabelaGenerica {
  return {
    arquivo: 'teste.xlsx',
    aba: 'Dados',
    abas_disponiveis: ['Dados'],
    cabecalho,
    linhas,
    total_linhas: totalLinhasReal ?? linhas.length,
    truncada,
  };
}

const INSTANTE = '2026-08-18T12:00:00.000Z';

// ---------------------------------------------------------------------------
// detectarOutliersNumericos
// ---------------------------------------------------------------------------

test('detectarOutliersNumericos: amostra homogênea não acusa nada', () => {
  const r = detectarOutliersNumericos([10, 11, 12, 11, 10, 12, 11]);
  assert.deepEqual(r.indices, []);
});

test('detectarOutliersNumericos: valor extremo é flagrado pela cerca de Tukey', () => {
  const valores = [10, 11, 12, 13, 11, 10, 12, 13, 11, 1000];
  const r = detectarOutliersNumericos(valores);
  assert.deepEqual(r.indices, [9]);
});

test('detectarOutliersNumericos: amostra menor que 4 pontos não sustenta quartil — devolve nada', () => {
  const r = detectarOutliersNumericos([1, 2, 1000]);
  assert.deepEqual(r.indices, []);
});

// ---------------------------------------------------------------------------
// detectarLinhasDuplicadas
// ---------------------------------------------------------------------------

test('detectarLinhasDuplicadas: só conta REPETIÇÕES, não a primeira ocorrência', () => {
  const t = tabela(['a', 'b'], [
    [1, 'x'],
    [2, 'y'],
    [1, 'x'],
    [3, 'z'],
    [1, 'x'],
  ]);
  const r = detectarLinhasDuplicadas(t);
  assert.deepEqual(r.indices, [2, 4]);
  assert.equal(r.taxa, 0.4);
});

test('detectarLinhasDuplicadas: tabela sem repetição tem taxa zero', () => {
  const t = tabela(['a'], [[1], [2], [3]]);
  assert.equal(detectarLinhasDuplicadas(t).taxa, 0);
});

// ---------------------------------------------------------------------------
// evidenciasDePlanilha
// ---------------------------------------------------------------------------

test('evidenciasDePlanilha: toda evidência sai com procedência "fato"', () => {
  const t = tabela(['Nome'], [['A'], ['B'], [null]]);
  const evidencias = evidenciasDePlanilha(t, perfilarTabela(t), INSTANTE);
  assert.ok(evidencias.length > 0);
  assert.ok(evidencias.every((e) => e.procedencia === 'fato'));
});

// ---------------------------------------------------------------------------
// anomaliasDePlanilha — nunca fora de FAIXAS_PLANILHA
// ---------------------------------------------------------------------------

function evidencia(parcial: Partial<Evidencia> & Pick<Evidencia, 'metrica' | 'valor'>): Evidencia {
  return { fonte: 'diagnostico_planilha', procedencia: 'fato', relevancia: 'direta', instante: INSTANTE, unidade: '%', ...parcial };
}

test('anomaliasDePlanilha: taxa de nulo abaixo do limiar moderado não vira anomalia', () => {
  const anomalias = anomaliasDePlanilha([evidencia({ metrica: 'taxa_nulo:Col', valor: FAIXAS_PLANILHA.taxa_nulo.moderada * 100 - 1 })]);
  assert.deepEqual(anomalias, []);
});

test('anomaliasDePlanilha: taxa de nulo no limiar grave vira anomalia grave', () => {
  const [a] = anomaliasDePlanilha([evidencia({ metrica: 'taxa_nulo:Col', valor: FAIXAS_PLANILHA.taxa_nulo.grave * 100 })]);
  assert.equal(a.severidade, 'grave');
});

test('anomaliasDePlanilha: métrica desconhecida NUNCA vira anomalia, por maior que seja o valor', () => {
  const anomalias = anomaliasDePlanilha([evidencia({ metrica: 'algo_que_nao_existe:Col', valor: 999 })]);
  assert.deepEqual(anomalias, []);
});

test('anomaliasDePlanilha: toda anomalia produzida mapeia para uma faixa nomeada de FAIXAS_PLANILHA', () => {
  const evidencias: Evidencia[] = [
    evidencia({ metrica: 'taxa_nulo:A', valor: 60 }),
    evidencia({ metrica: 'dominancia_valor_unico:B', valor: 99 }),
    evidencia({ metrica: 'outliers:C', valor: 20 }),
    evidencia({ metrica: 'linhas_duplicadas', valor: 30 }),
  ];
  const anomalias = anomaliasDePlanilha(evidencias);
  assert.equal(anomalias.length, 4);
  const prefixosConhecidos = ['taxa_nulo:', 'dominancia_valor_unico:', 'outliers:', 'linhas_duplicadas'];
  for (const a of anomalias) {
    assert.ok(prefixosConhecidos.some((p) => a.evidencia.metrica === p || a.evidencia.metrica.startsWith(p)));
  }
});

// ---------------------------------------------------------------------------
// hipotesesDePlanilha — confiança CALCULADA por criarHipotese, nunca escrita
// ---------------------------------------------------------------------------

test('hipotesesDePlanilha: UMA métrica anômala na coluna produz confiança "media"', () => {
  const anomalias = anomaliasDePlanilha([evidencia({ metrica: 'dominancia_valor_unico:Status', valor: 90 })]);
  const [h] = hipotesesDePlanilha(anomalias);
  assert.equal(h.confianca, 'media');
});

test('hipotesesDePlanilha: DUAS métricas distintas anômalas na MESMA coluna produzem confiança "alta"', () => {
  const anomalias = anomaliasDePlanilha([
    evidencia({ metrica: 'taxa_nulo:Status', valor: 30 }),
    evidencia({ metrica: 'dominancia_valor_unico:Status', valor: 99 }),
  ]);
  const [h] = hipotesesDePlanilha(anomalias);
  assert.equal(h.confianca, 'alta');
  assert.equal(h.sustentada_por.length, 2);
});

test('hipotesesDePlanilha: linhas_duplicadas gera hipótese própria, separada das colunas', () => {
  const anomalias = anomaliasDePlanilha([evidencia({ metrica: 'linhas_duplicadas', valor: 30 })]);
  const hipoteses = hipotesesDePlanilha(anomalias);
  assert.equal(hipoteses.length, 1);
  assert.match(hipoteses[0].enunciado, /duplicadas/);
});

test('hipotesesDePlanilha: sem anomalia, sem hipótese', () => {
  assert.deepEqual(hipotesesDePlanilha([]), []);
});

// ---------------------------------------------------------------------------
// diagnosticarPlanilha — o laço inteiro
// ---------------------------------------------------------------------------

test('diagnosticarPlanilha: planilha limpa não produz anomalia nem hipótese', () => {
  const t = tabela(['Nome', 'Valor'], [
    ['A', 10],
    ['B', 11],
    ['C', 12],
    ['D', 13],
  ]);
  const d = diagnosticarPlanilha(t, INSTANTE);
  assert.deepEqual(d.anomalias, []);
  assert.deepEqual(d.hipoteses, []);
});

test('diagnosticarPlanilha: coluna com nulo alto E dominância alta gera hipótese de confiança alta', () => {
  const linhas: CelulaValor[][] = [
    ...Array.from({ length: 3 }, () => ['']),
    ...Array.from({ length: 7 }, () => ['X']),
  ];
  const t = tabela(['Status'], linhas);
  const d = diagnosticarPlanilha(t, INSTANTE);
  assert.ok(d.hipoteses.some((h) => h.confianca === 'alta'));
});

test('diagnosticarPlanilha: truncada vira lacuna, nunca some em silêncio', () => {
  const t = tabela(['id'], [[1], [2]], true, 100_000);
  const d = diagnosticarPlanilha(t, INSTANTE);
  assert.equal(d.lacunas.length, 1);
  assert.match(d.lacunas[0], /100000|100.000/);
});

test('diagnosticarPlanilha: não truncada não gera lacuna nenhuma', () => {
  const t = tabela(['id'], [[1], [2]]);
  const d = diagnosticarPlanilha(t, INSTANTE);
  assert.deepEqual(d.lacunas, []);
});
