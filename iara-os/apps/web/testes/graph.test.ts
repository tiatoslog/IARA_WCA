/**
 * Cliente Microsoft Graph — e-mail e busca no SharePoint.
 *
 * Testes contra o CONTRATO HTTP da Graph (documentação pública), com `fetch`
 * simulado — não contra um tenant real. Ninguém neste ambiente tem
 * `MS_GRAPH_TOKEN` configurado; é a mesma lacuna nomeada no comentário de
 * `integracoes.ts` e no `.env.example`. Se o contrato real divergir do que
 * está testado aqui, é aqui que quebra primeiro — quando alguém configurar a
 * credencial de verdade.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { buscarEmails, buscarSharepoint, graphDisponivel } from '../servidor/nucleo/ClienteGraph';

function comToken(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = process.env.MS_GRAPH_TOKEN;
    process.env.MS_GRAPH_TOKEN = 'token-de-teste';
    try {
      await fn();
    } finally {
      if (antes === undefined) delete process.env.MS_GRAPH_TOKEN;
      else process.env.MS_GRAPH_TOKEN = antes;
    }
  };
}

test('sem MS_GRAPH_TOKEN, graphDisponivel() é falso', () => {
  const antes = process.env.MS_GRAPH_TOKEN;
  delete process.env.MS_GRAPH_TOKEN;
  try {
    assert.equal(graphDisponivel(), false);
  } finally {
    if (antes !== undefined) process.env.MS_GRAPH_TOKEN = antes;
  }
});

test('sem token, buscarEmails recusa sem bater na rede', async () => {
  const antes = process.env.MS_GRAPH_TOKEN;
  delete process.env.MS_GRAPH_TOKEN;
  const fetchOriginal = globalThis.fetch;
  let bateuNaRede = false;
  globalThis.fetch = (async () => {
    bateuNaRede = true;
    throw new Error('não devia ter consultado nada');
  }) as typeof fetch;
  try {
    const r = await buscarEmails('', 10);
    assert.equal(r.ok, false);
    assert.match(r.texto, /MS_GRAPH_TOKEN/);
    assert.equal(bateuNaRede, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes !== undefined) process.env.MS_GRAPH_TOKEN = antes;
  }
});

test(
  'buscarEmails lista mensagens recentes, mais nova primeiro, sem vazar corpo inteiro',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    let urlChamada = '';
    let cabecalhos: Record<string, string> = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urlChamada = String(url);
      cabecalhos = (init?.headers as Record<string, string>) ?? {};
      return new Response(
        JSON.stringify({
          value: [
            {
              subject: 'Fatura em atraso',
              from: { emailAddress: { name: 'Financeiro', address: 'financeiro@atoslog.com.br' } },
              receivedDateTime: '2026-08-14T10:00:00Z',
              bodyPreview: 'Segue anexa a fatura referente ao mês de julho, vencimento em '.repeat(5),
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const r = await buscarEmails('', 5);
      assert.equal(r.ok, true);
      assert.match(r.texto, /Fatura em atraso/);
      assert.match(r.texto, /Financeiro/);
      assert.ok(urlChamada.includes('/me/messages'), `URL errada: ${urlChamada}`);
      assert.ok(urlChamada.includes('orderby'), 'sem filtro, precisa ordenar por data');
      assert.equal(cabecalhos.Authorization, 'Bearer token-de-teste');
      // A prévia é cortada — nunca o corpo inteiro do e-mail no prompt.
      assert.ok(!r.texto.includes('vencimento em '.repeat(5)), 'vazou o corpo inteiro, não só a prévia');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarEmails com filtro usa $search e o cabeçalho ConsistencyLevel',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    let urlChamada = '';
    let cabecalhos: Record<string, string> = {};
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urlChamada = String(url);
      cabecalhos = (init?.headers as Record<string, string>) ?? {};
      return new Response(JSON.stringify({ value: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await buscarEmails('contrato', 10);
      assert.equal(r.ok, true);
      assert.match(r.texto, /contrato/);
      assert.ok(decodeURIComponent(urlChamada).includes('contrato'), `busca não chegou na URL: ${urlChamada}`);
      assert.equal(cabecalhos.ConsistencyLevel, 'eventual');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarEmails traduz 401 em "token expirado", não em jargão HTTP',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { message: 'InvalidAuthenticationToken' } }), {
        status: 401,
      })) as typeof fetch;
    try {
      const r = await buscarEmails('', 10);
      assert.equal(r.ok, false);
      assert.match(r.texto, /expirou|inválido/i);
      assert.match(r.texto, /MS_GRAPH_TOKEN/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarEmails não inventa e-mail quando a rede falha',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    try {
      const r = await buscarEmails('', 10);
      assert.equal(r.ok, false);
      assert.match(r.texto, /ECONNRESET/);
      assert.doesNotMatch(r.texto, /Fatura|assunto/i);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarSharepoint devolve nome e link do documento, resumo sem HTML',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    let metodo = '';
    let corpo: unknown = null;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      metodo = init?.method ?? 'GET';
      corpo = init?.body ? JSON.parse(String(init.body)) : null;
      return new Response(
        JSON.stringify({
          value: [
            {
              hitsContainers: [
                {
                  hits: [
                    {
                      resource: { name: 'Contrato_2026.docx', webUrl: 'https://contoso.sharepoint.com/x' },
                      summary: '<c0>Contrato</c0> de prestação de serviço',
                    },
                  ],
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const r = await buscarSharepoint('contrato 2026');
      assert.equal(r.ok, true);
      assert.match(r.texto, /Contrato_2026\.docx/);
      assert.match(r.texto, /https:\/\/contoso\.sharepoint\.com\/x/);
      assert.doesNotMatch(r.texto, /<c0>/, 'HTML de destaque vazou pro texto');
      assert.equal(metodo, 'POST');
      assert.equal((corpo as { requests: Array<{ query: { queryString: string } }> }).requests[0].query.queryString, 'contrato 2026');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarSharepoint sem resultado diz isso, não inventa documento',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ value: [{ hitsContainers: [{ hits: [] }] }] }), { status: 200 })) as typeof fetch;
    try {
      const r = await buscarSharepoint('coisa-que-nao-existe');
      assert.equal(r.ok, true);
      assert.match(r.texto, /[Nn]enhum documento/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarSharepoint sem termo de busca recusa antes de bater na rede',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    let bateuNaRede = false;
    globalThis.fetch = (async () => {
      bateuNaRede = true;
      throw new Error('não devia ter consultado nada');
    }) as typeof fetch;
    try {
      const r = await buscarSharepoint('   ');
      assert.equal(r.ok, false);
      assert.equal(bateuNaRede, false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);
