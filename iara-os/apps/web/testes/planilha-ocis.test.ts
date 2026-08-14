/**
 * ClientePlanilhaOcis — leitura da planilha da operação LUFT.
 *
 * Testes contra o CONTRATO HTTP da Graph (`fetch` simulado), mesmo desenho de
 * `testes/graph.test.ts`. As três respostas em sequência que um `cargasNoPeriodo`
 * bem-sucedido precisa: `/shares/.../driveItem`, `.../usedRange`, `.../range(...)`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cargasNoPeriodo,
  planilhaOcisDisponivel,
  _esquecerLocalizacaoParaTeste,
} from '../servidor/nucleo/ClientePlanilhaOcis';

const VARS = ['MS_GRAPH_TOKEN', 'MS_GRAPH_OCI_URL'] as const;

function comAmbiente(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    process.env.MS_GRAPH_TOKEN = 'token-de-teste';
    process.env.MS_GRAPH_OCI_URL = 'https://contoso.sharepoint.com/:x:/r/sites/x/planilha.xlsx';
    _esquecerLocalizacaoParaTeste();
    try {
      await fn();
    } finally {
      _esquecerLocalizacaoParaTeste();
      for (const v of VARS) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

/** Cabeçalho (linhas 1-4) mais duas linhas reais e uma linha "lixo" de fórmula quebrada. */
function linhasSimuladas(): unknown[][] {
  const linha = (oci: number, dataColetaSerial: number | string, valor: number) =>
    [0, 'rota', 0, 'nota', oci, 'ORIGEM', 'SP', 'DESTINO', 'MG', 46240, 'FULANO', dataColetaSerial, 46248, '', '', '', '#REF!', '', '', '', '', 'FINALIZADA', '', valor];
  return [
    linha(100001, 46248, 1500), // 2026-08-14
    linha(100002, 46249, 2000), // 2026-08-15
    linha(100003, '', 1800), // sem data de coleta — não deve aparecer em nenhum período
    [0, '-', '#N/D', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '#N/D'], // linha lixo, OCI vazio
  ];
}

function mockFetch(chamadas: { shares: number }): typeof fetch {
  return (async (url: string) => {
    const u = String(url);
    if (u.includes('/shares/')) {
      chamadas.shares++;
      return new Response(
        JSON.stringify({ id: 'ITEM123', parentReference: { driveId: 'DRIVE456' } }),
        { status: 200 },
      );
    }
    if (u.includes('/usedRange')) {
      return new Response(JSON.stringify({ address: "'2026'!A1:X8", rowCount: 8, columnCount: 24 }), { status: 200 });
    }
    if (u.includes('/range(')) {
      return new Response(JSON.stringify({ values: linhasSimuladas() }), { status: 200 });
    }
    throw new Error(`URL inesperada no teste: ${u}`);
  }) as typeof fetch;
}

test('planilhaOcisDisponivel() é falso sem MS_GRAPH_TOKEN ou sem MS_GRAPH_OCI_URL', () => {
  const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  try {
    delete process.env.MS_GRAPH_TOKEN;
    process.env.MS_GRAPH_OCI_URL = 'https://x/y.xlsx';
    assert.equal(planilhaOcisDisponivel(), false);

    process.env.MS_GRAPH_TOKEN = 'algo';
    delete process.env.MS_GRAPH_OCI_URL;
    assert.equal(planilhaOcisDisponivel(), false);
  } finally {
    for (const v of VARS) {
      if (antes[v] === undefined) delete process.env[v];
      else process.env[v] = antes[v];
    }
  }
});

test('sem MS_GRAPH_TOKEN, cargasNoPeriodo recusa sem bater na rede', async () => {
  const antes = process.env.MS_GRAPH_TOKEN;
  delete process.env.MS_GRAPH_TOKEN;
  process.env.MS_GRAPH_OCI_URL = 'https://x/y.xlsx';
  const fetchOriginal = globalThis.fetch;
  let bateu = false;
  globalThis.fetch = (async () => {
    bateu = true;
    throw new Error('não devia');
  }) as typeof fetch;
  try {
    const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
    assert.equal(r.ok, false);
    assert.match(r.texto, /MS_GRAPH_TOKEN/);
    assert.equal(bateu, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes !== undefined) process.env.MS_GRAPH_TOKEN = antes;
  }
});

test('sem MS_GRAPH_OCI_URL, cargasNoPeriodo recusa sem bater na rede', async () => {
  const antes = process.env.MS_GRAPH_OCI_URL;
  process.env.MS_GRAPH_TOKEN = 'algo';
  delete process.env.MS_GRAPH_OCI_URL;
  const fetchOriginal = globalThis.fetch;
  let bateu = false;
  globalThis.fetch = (async () => {
    bateu = true;
    throw new Error('não devia');
  }) as typeof fetch;
  try {
    const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
    assert.equal(r.ok, false);
    assert.match(r.texto, /MS_GRAPH_OCI_URL/);
    assert.equal(bateu, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes === undefined) delete process.env.MS_GRAPH_OCI_URL;
    else process.env.MS_GRAPH_OCI_URL = antes;
  }
});

test(
  'um único dia devolve só as cargas daquele dia, ignorando a linha sem data e a linha lixo',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    const chamadas = { shares: 0 };
    globalThis.fetch = mockFetch(chamadas);
    try {
      const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, 1);
      assert.equal(r.cargas[0].oci, '100001');
      assert.equal(r.cargas[0].data_coleta, '2026-08-14');
      // coluna X (valor real), não a Q quebrada com #REF!
      assert.equal(r.cargas[0].valor, 1500);
      assert.match(r.texto, /100001/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'um intervalo de dois dias devolve as duas cargas, ordenadas por data',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = mockFetch({ shares: 0 });
    try {
      const r = await cargasNoPeriodo('2026-08-14', '2026-08-15');
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, 2);
      assert.deepEqual(r.cargas.map((c) => c.oci), ['100001', '100002']);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'dia sem nenhuma carga devolve ok com lista vazia, não erro',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = mockFetch({ shares: 0 });
    try {
      const r = await cargasNoPeriodo('2026-01-01', '2026-01-01');
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, 0);
      assert.match(r.texto, /[Nn]enhuma carga/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'a localização do arquivo é resolvida uma vez só e reaproveitada entre chamadas',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    const chamadas = { shares: 0 };
    globalThis.fetch = mockFetch(chamadas);
    try {
      await cargasNoPeriodo('2026-08-14', '2026-08-14');
      await cargasNoPeriodo('2026-08-15', '2026-08-15');
      assert.equal(chamadas.shares, 1, '/shares/ deveria ter sido chamado só na primeira vez');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'falha ao resolver a localização (link inválido/expirado) devolve erro honesto, sem lançar',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/shares/')) {
        return new Response(JSON.stringify({ error: { message: 'itemNotFound' } }), { status: 404 });
      }
      throw new Error('não devia ter ido além de /shares/');
    }) as typeof fetch;
    try {
      const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
      assert.equal(r.ok, false);
      assert.match(r.texto, /404|localizar/i);
      assert.equal(r.cargas.length, 0);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);
