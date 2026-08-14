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

import {
  cargasNoPeriodo,
  todasAsCargas,
  agregarCargas,
  normalizarStatus,
  _esquecerLocalizacaoParaTeste,
  _esquecerCacheTodasParaTeste,
  _expirarCacheTodasParaTeste,
} from '../servidor/nucleo/ClientePlanilhaOcis';
import { interpretarPeriodo } from '../servidor/nucleo/kernel/PeriodoOperacional';
import { validar, ParametroInvalido } from '../servidor/nucleo/kernel/Habilidade';
import { consultarEstatisticasCargasLuft } from '../servidor/nucleo/kernel/habilidades/cargasLuft';

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
    _esquecerCacheTodasParaTeste();
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
      _esquecerCacheTodasParaTeste();
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

// -----------------------------------------------------------------------
// STAT-00N — estatísticas (fase 2), mesmo fixture congelado.
//
// IMPORTANTE: estes números são do FIXTURE (178 linhas fixas), não da
// planilha ao vivo. "Quantas cargas cadastradas EXISTEM HOJE na planilha
// real" muda toda vez que a Vania cadastra uma OCI nova — congelar ESSE
// número como expected_result permanente seria travar um valor que tem que
// mudar. O que trava aqui é a CONTA: dado um universo fixo e conhecido, o
// motor de agregação sempre chega no mesmo resultado. Cada número abaixo
// foi calculado por um script separado direto sobre o arquivo do fixture
// (não à mão), antes de virar assertion — ver a conversa de 14/08/2026.
// -----------------------------------------------------------------------

test(
  'STAT-001 — COUNT(*) sobre o universo todasAsCargas() do fixture = 178',
  comFixture(async () => {
    const r = await todasAsCargas();
    assert.equal(r.ok, true);
    assert.equal(r.cargas.length, 178);
  }),
);

test(
  'STAT-002 — SUM(valor) sobre o mesmo universo = R$ 316.172,00',
  comFixture(async () => {
    const r = await todasAsCargas();
    const total = r.cargas.reduce((s, c) => s + (c.valor ?? 0), 0);
    assert.ok(Math.abs(total - 316172) < 0.005, `esperado 316172.00, veio ${total.toFixed(2)}`);
  }),
);

test(
  'STAT-003 — COUNT(data_coleta IS NULL) = 5 (cadastrada ≠ coletada)',
  comFixture(async () => {
    const r = await todasAsCargas();
    const semColeta = r.cargas.filter((c) => c.data_coleta === null);
    assert.equal(semColeta.length, 5);
  }),
);

test(
  'STAT-004 — GROUP BY motorista, ORDER BY contagem DESC, LIMIT 1 = MOLINA (17)',
  comFixture(async () => {
    const r = await todasAsCargas();
    const grupos = [...agregarCargas(r.cargas, 'motorista')].sort((a, b) => b.contagem - a.contagem);
    assert.equal(grupos[0].chave, 'MOLINA');
    assert.equal(grupos[0].contagem, 17);
  }),
);

test(
  'STAT-005/006 — GROUP BY rota, ORDER BY valor_total DESC, LIMIT 1 = PONTES E LACERDA → MIRASSOL DOESTE (R$ 22.495,00)',
  comFixture(async () => {
    const r = await todasAsCargas();
    const grupos = [...agregarCargas(r.cargas, 'rota')].sort((a, b) => b.valor_total - a.valor_total);
    assert.equal(grupos[0].chave, 'PONTES E LACERDA → MIRASSOL DOESTE');
    assert.ok(Math.abs(grupos[0].valor_total - 22495) < 0.005);
  }),
);

// --- testes negativos ---------------------------------------------------

test('STAT-NEG-001 — data impossível (35/99) não vira consulta, interpretarPeriodo devolve null', () => {
  assert.equal(interpretarPeriodo('35/99/2026'), null);
  assert.equal(interpretarPeriodo('cargas do dia 35/99'), null);
});

test('STAT-NEG-002 — período vazio SEM ambiguidade: "" é "todas as cargas", não erro', () => {
  // Contrato explícito de PeriodoOperacional: string vazia não é "período inexistente
  // interpretado errado" — é ausência de filtro, e quem decide o que isso significa
  // é a habilidade (aqui: todas as cargas cadastradas), nunca um palpite de data.
  assert.equal(interpretarPeriodo(''), null);
});

test(
  'STAT-NEG-003 — fonte indisponível com cache expirado NUNCA finge que o número é atual',
  comFixture(async () => {
    const primeira = await todasAsCargas();
    assert.equal(primeira.ok, true);
    assert.equal(primeira.fonte?.cache, false);

    _expirarCacheTodasParaTeste();

    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/shares/')) {
        return new Response(JSON.stringify({ error: { message: 'serviceUnavailable' } }), { status: 503 });
      }
      throw new Error('não devia ter ido além de /shares/ nesta falha');
    }) as typeof fetch;

    const segunda = await todasAsCargas();
    assert.equal(segunda.ok, false, 'com a fonte fora do ar, NUNCA reporta sucesso usando o cache velho');
    assert.equal(segunda.cargas.length, 0, 'e não entrega os números antigos como se fossem a resposta');
    assert.match(segunda.texto, /último dado válido/i, 'a mensagem precisa avisar que o dado é velho, não calar sobre isso');
    assert.equal(segunda.fonte?.cache, true, 'mas a proveniência da falha aponta pro cache que existia');
  }),
);

test('STAT-NEG-004 — "agrupar_por" fora da lista aceita é recusado pelo próprio esquema, antes de executar', () => {
  assert.throws(
    () => validar(consultarEstatisticasCargasLuft.manifesto.esquema, { agrupar_por: 'coluna_que_nao_existe' }),
    ParametroInvalido,
  );
});

test('STAT-NEG-005 — status "7" nunca vira FINALIZADO por adivinhação', () => {
  assert.equal(normalizarStatus('7'), 'DESCONHECIDO');
  assert.notEqual(normalizarStatus('7'), 'FINALIZADO');
});

test('normalizarStatus colapsa as três grafias de "finalizado" achadas na auditoria, sem tocar o texto original', () => {
  assert.equal(normalizarStatus('FINALIZADO'), 'FINALIZADO');
  assert.equal(normalizarStatus('finalizado'), 'FINALIZADO');
  assert.equal(normalizarStatus('FINALIZADA'), 'FINALIZADO');
  assert.equal(normalizarStatus('PAGO'), 'PAGO');
  assert.equal(normalizarStatus(''), 'SEM_STATUS');
  assert.equal(normalizarStatus('   '), 'SEM_STATUS');
});
