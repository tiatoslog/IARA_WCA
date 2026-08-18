/**
 * `comparar_semanas_luft` e `relatorio_executivo_luft` — fase 3 do Workbook
 * Intelligence Layer. Mesmo desenho de teste de `planilha-ocis.test.ts`
 * (`fetch` simulado, mesmo contrato Graph), mas as datas da planilha
 * simulada são calculadas a partir de `interpretarPeriodo` chamado agora —
 * nunca uma data fixa —, porque `compararSemanasLuft`/`relatorioExecutivoLuft`
 * usam `new Date()` real (mesmo comportamento de `consultarCargasLuft`, que
 * já faz isso sem receber `agora` de fora). Fixar a data no teste e deixar o
 * código correr com a data real seria testar uma coisa e rodar outra.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compararSemanasLuft, relatorioExecutivoLuft } from '../servidor/nucleo/kernel/habilidades/cargasLuft';
import { interpretarPeriodo } from '../servidor/nucleo/kernel/PeriodoOperacional';
import { _esquecerLocalizacaoParaTeste, _esquecerCacheTodasParaTeste } from '../servidor/nucleo/ClientePlanilhaOcis';

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

/** Inverso de `serialParaISO` em ClientePlanilhaOcis.ts — "AAAA-MM-DD" -> serial Excel (UTC). */
function isoParaSerial(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000) + 25569;
}

function contexto(parametros: Record<string, unknown>) {
  return {
    parametros,
    enunciado: 'teste',
    id_usuario: 'op-teste',
    sessao: 'teste',
    sinal: new AbortController().signal,
  } as unknown as Parameters<typeof compararSemanasLuft.executar>[0];
}

test(
  'comparar_semanas_luft compara contagem e valor entre essa semana e a passada',
  comAmbiente(async () => {
    const atual = interpretarPeriodo('essa semana')!;
    const anterior = interpretarPeriodo('semana passada')!;

    const linha = (oci: number, dataColetaSerial: number, valor: number) => [
      0, 'rota', 0, 'nota', oci, 'ORIGEM', 'SP', 'DESTINO', 'MG', 46240, 'FULANO',
      dataColetaSerial, 46248, '', '', '', '#REF!', '', '', '', '', 'FINALIZADA', '', valor,
    ];

    const linhas = [
      linha(300001, isoParaSerial(atual.inicio), 1000), // semana atual: 2 cargas, 3000
      linha(300002, isoParaSerial(atual.inicio), 2000),
      linha(300003, isoParaSerial(anterior.inicio), 500), // semana anterior: 1 carga, 500
    ];

    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ address: "'2026'!A1:X8", rowCount: 8, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ values: linhas }), { status: 200 });
      }
      throw new Error(`URL inesperada no teste: ${u}`);
    }) as typeof fetch;

    try {
      const r = await compararSemanasLuft.executar(contexto({}));
      assert.equal(r.resolveu, true, r.texto);
      assert.match(r.texto, /2 cargas/, `esperava 2 cargas na semana atual: "${r.texto}"`);
      assert.match(r.texto, /1 carga\b/, `esperava 1 carga na semana anterior: "${r.texto}"`);
      assert.match(r.texto, /\+500\.0%/, `esperava +500% de variação (3000 vs 500): "${r.texto}"`);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'comparar_semanas_luft recusa período não reconhecido sem bater na rede',
  comAmbiente(async () => {
    const fetchOriginal = globalThis.fetch;
    let bateu = false;
    globalThis.fetch = (async () => {
      bateu = true;
      throw new Error('não devia');
    }) as typeof fetch;
    try {
      const r = await compararSemanasLuft.executar(contexto({ periodo_atual: 'trocentos anos atrás' }));
      assert.equal(r.resolveu, false);
      assert.equal(bateu, false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'relatorio_executivo_luft consolida total cadastrado, período, top motoristas e status',
  comAmbiente(async () => {
    const periodo = interpretarPeriodo('essa semana')!;
    const dentro = isoParaSerial(periodo.inicio);

    const linha = (oci: number, motorista: string, dataColetaSerial: number | string, status: string, valor: number) => [
      0, 'rota', 0, 'nota', oci, 'ORIGEM', 'SP', 'DESTINO', 'MG', 46240, motorista,
      dataColetaSerial, 46248, '', '', '', '#REF!', '', '', '', '', status, '', valor,
    ];

    const linhas = [
      linha(400001, 'CICLANO', dentro, 'FINALIZADA', 1000),
      linha(400002, 'CICLANO', dentro, 'FINALIZADA', 1000),
      linha(400003, 'BELTRANO', dentro, 'PAGO', 500),
      linha(400004, 'FULANO', '', 'PAGO', 700), // cadastrada, sem coleta — conta no total, não no período
    ];

    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      const u = String(url);
      if (u.includes('/shares/')) {
        return new Response(JSON.stringify({ id: 'ITEM', parentReference: { driveId: 'DRIVE' } }), { status: 200 });
      }
      if (u.includes('/usedRange')) {
        return new Response(JSON.stringify({ address: "'2026'!A1:X8", rowCount: 8, columnCount: 24 }), { status: 200 });
      }
      if (u.includes('/range(')) {
        return new Response(JSON.stringify({ values: linhas }), { status: 200 });
      }
      throw new Error(`URL inesperada no teste: ${u}`);
    }) as typeof fetch;

    try {
      const r = await relatorioExecutivoLuft.executar(contexto({}));
      assert.equal(r.resolveu, true, r.texto);
      assert.match(r.texto, /Total cadastrado.*: 4 cargas/, `esperava 4 no total: "${r.texto}"`);
      assert.match(r.texto, /No período: 3 cargas/, `esperava 3 no período: "${r.texto}"`);
      assert.match(r.texto, /1\. CICLANO — 2 cargas/, `esperava CICLANO no topo: "${r.texto}"`);
      assert.match(r.texto, /FINALIZADO — 2/, `esperava status normalizado agregado: "${r.texto}"`);
      assert.match(r.texto, /PAGO — 1/, `esperava PAGO só com a carga do período: "${r.texto}"`);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);
