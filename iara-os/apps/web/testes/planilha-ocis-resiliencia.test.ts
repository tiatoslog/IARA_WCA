/**
 * Resiliência da leitura da planilha LUFT — achado em 14/08/2026: o erro que
 * derrubou a leitura não veio da Graph, veio do serviço de SESSÃO do Excel
 * Online (`FileOpenHostServiceUnavailable`, HTTP 503). Duas defesas, nesta
 * ordem:
 *
 *   1. Retentativa com backoff para erro transitório (429/502/503/504 ou
 *      falha de rede) — a maioria dos blips se resolve sozinha na 2ª tentativa.
 *   2. Se mesmo assim a API falhar de ponta a ponta, cai automaticamente para
 *      baixar o `.xlsx` bruto e ler localmente — sem o operador perceber
 *      qual caminho respondeu.
 *
 * Estes testes usam um `.xlsx` DE VERDADE, construído em memória com a mesma
 * biblioteca (`xlsx`) que o código de produção usa pra ler — não um mock de
 * JSON fingindo ser bytes de arquivo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';

import { cargasNoPeriodo, todasAsCargas, _esquecerLocalizacaoParaTeste, _esquecerCacheTodasParaTeste } from '../servidor/nucleo/ClientePlanilhaOcis';

const VARS = ['MS_GRAPH_TOKEN', 'MS_GRAPH_OCI_URL'] as const;

function comAmbiente(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    process.env.MS_GRAPH_TOKEN = 'token-de-teste';
    process.env.MS_GRAPH_OCI_URL = 'https://contoso.sharepoint.com/:x:/r/sites/x/planilha.xlsx';
    _esquecerLocalizacaoParaTeste();
    _esquecerCacheTodasParaTeste();
    try {
      await fn();
    } finally {
      _esquecerLocalizacaoParaTeste();
      _esquecerCacheTodasParaTeste();
      for (const v of VARS) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

/** Cabeçalho (4 linhas) + 2 cargas reais, no mesmo layout de coluna de sempre. */
function linhasDeTeste(): unknown[][] {
  const linha = (oci: number, motorista: string, dataColetaSerial: number, valor: number) =>
    [0, 'rota', 0, 'nota', oci, 'ORIGEM', 'SP', 'DESTINO', 'MG', 46240, motorista, dataColetaSerial, 46248, '', '', '', '', '', '', '', '', 'FINALIZADO', '', valor];
  return [[], [], [], [], linha(300001, 'FALLBACK-JOAO', 46248, 1000), linha(300002, 'FALLBACK-MARIA', 46249, 2000)];
}

/** Um `.xlsx` real em memória, aba "2026" — a mesma lib que o código de produção usa pra ler. */
function construirXlsxDeTeste(): Buffer {
  const planilha = XLSX.utils.aoa_to_sheet(linhasDeTeste());
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, planilha, '2026');
  return XLSX.write(pasta, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

// --- retentativa ------------------------------------------------------------

test(
  'erro transitório (503) na primeira tentativa se resolve sozinho na segunda, sem cair pro fallback',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    let chamadasShares = 0;
    let chamadasContent = 0;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        chamadasShares++;
        if (chamadasShares === 1) {
          return new Response(JSON.stringify({ error: { message: 'serviceUnavailable' } }), { status: 503 });
        }
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ rowCount: 6, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ values: linhasDeTeste().slice(4) }), { status: 200 });
      }
      if (u.includes('/content')) {
        chamadasContent++;
        throw new Error('não devia ter caído pro download — a retentativa deveria ter bastado');
      }
      throw new Error(`URL inesperada: ${u}`);
    }) as typeof fetch;
    try {
      const r = await todasAsCargas();
      assert.equal(r.ok, true);
      assert.equal(chamadasShares, 2, 'a segunda tentativa deveria ter resolvido, sem precisar de uma terceira');
      assert.equal(chamadasContent, 0, 'não deveria ter tentado o fallback — a API respondeu na retentativa');
      assert.equal(r.fonte?.via, 'api');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'erro DEFINITIVO (404) não gera retentativa — falha na primeira tentativa mesmo',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    let chamadas = 0;
    globalThis.fetch = (async (url: string) => {
      if (String(url).includes('/shares/')) {
        chamadas++;
        return new Response(JSON.stringify({ error: { message: 'itemNotFound' } }), { status: 404 });
      }
      throw new Error('não devia ter ido além de /shares/');
    }) as typeof fetch;
    try {
      const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
      assert.equal(r.ok, false);
      assert.equal(chamadas, 1, '404 é definitivo — nenhuma retentativa deveria ter acontecido');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

// --- fallback automático para download bruto --------------------------------

test(
  'API falhando de ponta a ponta cai automaticamente para o download bruto, sem erro pro operador',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    const xlsxBuffer = construirXlsxDeTeste();
    let chamadasRange = 0;
    let chamadasContent = 0;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ rowCount: 6, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        chamadasRange++;
        // A API de range está fora do ar de verdade — sempre 503, mesmo depois da retentativa.
        return new Response(JSON.stringify({ error: { message: 'FileOpenHostServiceUnavailable' } }), { status: 503 });
      }
      if (u.includes('/content')) {
        chamadasContent++;
        return new Response(new Uint8Array(xlsxBuffer), { status: 200 });
      }
      throw new Error(`URL inesperada: ${u}`);
    }) as typeof fetch;
    try {
      const r = await todasAsCargas();
      assert.equal(r.ok, true, 'o operador continua recebendo resposta mesmo com a API de range fora do ar');
      assert.equal(r.cargas.length, 2);
      assert.equal(r.cargas.find((c) => c.oci === '300001')?.motorista, 'FALLBACK-JOAO');
      assert.equal(r.fonte?.via, 'download', 'a proveniência precisa registrar que veio do fallback');
      assert.ok(chamadasRange >= 1, 'a API precisa ter sido tentada antes do fallback, nunca pulada');
      assert.equal(chamadasContent, 1);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'cargasNoPeriodo também se beneficia do fallback — mesma função compartilhada',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    const xlsxBuffer = construirXlsxDeTeste();
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ rowCount: 6, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ error: {} }), { status: 503 });
      }
      if (u.includes('/content')) {
        return new Response(new Uint8Array(xlsxBuffer), { status: 200 });
      }
      throw new Error(`URL inesperada: ${u}`);
    }) as typeof fetch;
    try {
      const r = await cargasNoPeriodo('2026-08-14', '2026-08-14');
      assert.equal(r.ok, true);
      assert.equal(r.cargas.length, 1);
      assert.equal(r.cargas[0].oci, '300001');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'se a API E o download falharem, a falha é honesta — não inventa dado nenhum',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ rowCount: 6, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ error: {} }), { status: 503 });
      }
      if (u.includes('/content')) {
        return new Response(JSON.stringify({ error: { message: 'itemNotFound' } }), { status: 404 });
      }
      throw new Error(`URL inesperada: ${u}`);
    }) as typeof fetch;
    try {
      const r = await todasAsCargas();
      assert.equal(r.ok, false);
      assert.equal(r.cargas.length, 0);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);
