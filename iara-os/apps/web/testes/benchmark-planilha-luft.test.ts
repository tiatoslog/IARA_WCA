/**
 * IARA WORKBOOK BENCHMARK — planilha da operação LUFT, primeira fatia.
 *
 * Diferente de `testes/planilha-ocis.test.ts` (contrato HTTP, dado sintético),
 * este arquivo roda contra um FIXTURE CONGELADO de linhas REAIS, capturadas da
 * planilha em 14/08/2026 (`testes/fixtures/planilha-luft-agosto-2026.json`,
 * A5:X2650 da aba "2026", filtrado a 01–20/08/2026 + uma amostra sem coleta).
 *
 * Cada caso seguiu o formato de QA que a Vania e o time propuseram (ver
 * conversa de 14/08/2026, "IARA Workbook Benchmark"):
 *
 *   intent, source, field, filter, expected_result
 *
 * O EXPECTED_RESULT de cada QA-00N abaixo foi conferido DUAS VEZES contra
 * fontes independentes antes de virar teste:
 *
 *   1. contra a linha EXECUTADAS da aba AGENDA (13, 16, 15, 16 para
 *      seg–qui da semana de 10–14/08, e 10, 14, 21, 17, 10 para a semana
 *      de 03–07/08);
 *   2. contra a chamada real de `cargasNoPeriodo` no processo de verdade
 *      (ver a mesma conversa) — não só contra este fixture.
 *
 * Regra do benchmark: se uma alteração no motor de contagem fizer QA-003
 * passar de 15 para 14, o teste FALHA. Ele não existe para provar que o
 * código roda — existe para travar o NÚMERO.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { cargasNoPeriodo, _esquecerLocalizacaoParaTeste } from '../servidor/nucleo/ClientePlanilhaOcis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE: { linhas: unknown[][] } = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'planilha-luft-agosto-2026.json'), 'utf8'),
);

const VARS = ['MS_GRAPH_TOKEN', 'MS_GRAPH_OCI_URL'] as const;

function comFixture(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    process.env.MS_GRAPH_TOKEN = 'token-de-teste';
    process.env.MS_GRAPH_OCI_URL = 'https://contoso.sharepoint.com/:x:/r/sites/x/planilha.xlsx';
    _esquecerLocalizacaoParaTeste();
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ rowCount: FIXTURE.linhas.length + 4, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ values: FIXTURE.linhas }), { status: 200 });
      }
      throw new Error(`URL inesperada: ${u}`);
    }) as typeof fetch;
    try {
      await fn();
    } finally {
      globalThis.fetch = fetchOriginal;
      _esquecerLocalizacaoParaTeste();
      for (const v of VARS) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

/**
 * QA-001..005 — intent: COUNT, source: 2026, field: DATA COLETA,
 * filter: dia único. Semana de 10–14/08/2026.
 */
const QA_SEMANA_10_A_14 = [
  ['QA-001', '2026-08-10', 13],
  ['QA-002', '2026-08-11', 16],
  ['QA-003', '2026-08-12', 15],
  ['QA-004', '2026-08-13', 16],
  ['QA-005', '2026-08-14', 6],
] as const;

for (const [id, data, esperado] of QA_SEMANA_10_A_14) {
  test(
    `${id} — COUNT(DATA COLETA = ${data}) = ${esperado}`,
    comFixture(async () => {
      const r = await cargasNoPeriodo(data, data);
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, esperado, `${id}: esperado ${esperado}, veio ${r.cargas.length}`);
    }),
  );
}

/**
 * QA-006..010 — a semana ANTERIOR (03–07/08/2026), capturada no mesmo
 * fixture. Confere que o benchmark não está calibrado para uma semana só.
 */
const QA_SEMANA_03_A_07 = [
  ['QA-006', '2026-08-03', 10],
  ['QA-007', '2026-08-04', 14],
  ['QA-008', '2026-08-05', 21],
  ['QA-009', '2026-08-06', 17],
  ['QA-010', '2026-08-07', 10],
] as const;

for (const [id, data, esperado] of QA_SEMANA_03_A_07) {
  test(
    `${id} — COUNT(DATA COLETA = ${data}) = ${esperado}`,
    comFixture(async () => {
      const r = await cargasNoPeriodo(data, data);
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, esperado, `${id}: esperado ${esperado}, veio ${r.cargas.length}`);
    }),
  );
}

/**
 * QA-011 — intent: COUNT, source: 2026, field: DATA COLETA,
 * filter: intervalo (semana inteira). RECONCILIATION: precisa bater com a
 * SOMA de QA-001..005 — é a mesma checagem que a AGENDA faz na linha TOTAL.
 */
test(
  'QA-011 — COUNT(DATA COLETA entre 2026-08-10 e 2026-08-14) = 66, e bate com a soma de QA-001..005',
  comFixture(async () => {
    const r = await cargasNoPeriodo('2026-08-10', '2026-08-14');
    assert.equal(r.ok, true);
    const somaIndividual = QA_SEMANA_10_A_14.reduce((soma, [, , n]) => soma + n, 0);
    assert.equal(somaIndividual, 66); // trava a premissa do teste em si
    assert.equal(r.cargas.length, 66, `QA-011: esperado 66, veio ${r.cargas.length}`);
  }),
);

/**
 * QA-012 — DATA QUALITY: linhas sem DATA COLETA preenchida não entram em
 * NENHUM período — nunca aparecem como "coletadas" num dia que não coletaram.
 */
test(
  'QA-012 — cargas sem DATA COLETA não aparecem em nenhuma contagem por dia',
  comFixture(async () => {
    const semColeta = FIXTURE.linhas.filter((l) => typeof l[11] !== 'number');
    assert.ok(semColeta.length > 0, 'o fixture precisa ter ao menos uma linha sem data de coleta para este teste valer algo');

    // Um intervalo generoso, cobrindo toda a faixa capturada no fixture.
    const r = await cargasNoPeriodo('2026-01-01', '2026-12-31');
    const ocisSemColeta = new Set(semColeta.map((l) => String(l[4])));
    const apareceu = r.cargas.some((c) => ocisSemColeta.has(c.oci));
    assert.equal(apareceu, false, 'uma OCI sem DATA COLETA apareceu numa contagem — o filtro vazou');
  }),
);
