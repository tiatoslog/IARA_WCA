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

import {
  buscarEmails,
  buscarSharepoint,
  graphDisponivel,
  iniciarRenovacaoAutomaticaGraph,
  pararRenovacaoAutomaticaGraph,
  renovarTokenGraph,
} from '../servidor/nucleo/ClienteGraph';

const VARS_CREDENCIAL = ['MS_GRAPH_TOKEN', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_SECRET'] as const;

/** Salva e restaura as quatro variáveis do Graph, como `comToken` faz para uma só. */
function comCredenciaisApp(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS_CREDENCIAL.map((v) => [v, process.env[v]]));
    process.env.MS_GRAPH_CLIENT_ID = 'client-de-teste';
    process.env.MS_GRAPH_TENANT_ID = 'tenant-de-teste';
    process.env.MS_GRAPH_CLIENT_SECRET = 'segredo-de-teste';
    delete process.env.MS_GRAPH_TOKEN;
    try {
      await fn();
    } finally {
      pararRenovacaoAutomaticaGraph();
      for (const v of VARS_CREDENCIAL) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

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
  'buscarSharepoint manda "region" no corpo — a Search API recusa token de aplicativo sem isso',
  comToken(async () => {
    const fetchOriginal = globalThis.fetch;
    let corpo: { requests?: Array<{ region?: string }> } = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ value: [{ hitsContainers: [{ hits: [] }] }] }), { status: 200 });
    }) as typeof fetch;
    try {
      await buscarSharepoint('teste');
      assert.equal(corpo.requests?.[0]?.region, 'BRA', 'sem region, a Graph real devolve 400 em token de aplicativo');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'buscarSharepoint respeita MS_GRAPH_REGIAO quando declarada',
  comToken(async () => {
    const antes = process.env.MS_GRAPH_REGIAO;
    process.env.MS_GRAPH_REGIAO = 'EUR';
    const fetchOriginal = globalThis.fetch;
    let corpo: { requests?: Array<{ region?: string }> } = {};
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      corpo = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({ value: [{ hitsContainers: [{ hits: [] }] }] }), { status: 200 });
    }) as typeof fetch;
    try {
      await buscarSharepoint('teste');
      assert.equal(corpo.requests?.[0]?.region, 'EUR');
    } finally {
      globalThis.fetch = fetchOriginal;
      if (antes === undefined) delete process.env.MS_GRAPH_REGIAO;
      else process.env.MS_GRAPH_REGIAO = antes;
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

// --- renovação automática -------------------------------------------------

test('renovarTokenGraph sem credencial de app não bate na rede', async () => {
  const antes = { ...Object.fromEntries(VARS_CREDENCIAL.map((v) => [v, process.env[v]])) };
  for (const v of VARS_CREDENCIAL) delete process.env[v];
  const fetchOriginal = globalThis.fetch;
  let bateuNaRede = false;
  globalThis.fetch = (async () => {
    bateuNaRede = true;
    throw new Error('não devia ter consultado nada');
  }) as typeof fetch;
  try {
    const r = await renovarTokenGraph();
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.motivo, /MS_GRAPH_CLIENT_ID/);
    assert.equal(bateuNaRede, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const v of VARS_CREDENCIAL) {
      if (antes[v] === undefined) delete process.env[v];
      else process.env[v] = antes[v];
    }
  }
});

test(
  'renovarTokenGraph troca credenciais por token e grava em MS_GRAPH_TOKEN',
  comCredenciaisApp(async () => {
    const fetchOriginal = globalThis.fetch;
    let urlChamada = '';
    let corpoEnviado = '';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urlChamada = String(url);
      corpoEnviado = String(init?.body ?? '');
      return new Response(JSON.stringify({ access_token: 'token-novo', expires_in: 3600, token_type: 'Bearer' }), {
        status: 200,
      });
    }) as typeof fetch;
    try {
      const r = await renovarTokenGraph();
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.expiraEmS, 3600);
      assert.equal(process.env.MS_GRAPH_TOKEN, 'token-novo');
      assert.match(urlChamada, /login\.microsoftonline\.com\/tenant-de-teste\/oauth2\/v2\.0\/token/);
      assert.match(corpoEnviado, /grant_type=client_credentials/);
      assert.match(corpoEnviado, /client_secret=segredo-de-teste/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'renovarTokenGraph com credencial inválida não apaga o token anterior',
  comCredenciaisApp(async () => {
    process.env.MS_GRAPH_TOKEN = 'token-antigo-ainda-valido';
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: 'invalid_client', error_description: 'AADSTS7000215: segredo inválido' }), {
        status: 401,
      })) as typeof fetch;
    try {
      const r = await renovarTokenGraph();
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.motivo, /invalid_client/);
      // o token antigo continua de pé — falha de renovação não apaga o que ainda funciona
      assert.equal(process.env.MS_GRAPH_TOKEN, 'token-antigo-ainda-valido');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test('iniciarRenovacaoAutomaticaGraph sem credencial de app não agenda nada e não bate na rede', async () => {
  const antes = Object.fromEntries(VARS_CREDENCIAL.map((v) => [v, process.env[v]]));
  for (const v of VARS_CREDENCIAL) delete process.env[v];
  process.env.MS_GRAPH_TOKEN = 'token-colado-a-mao';
  const fetchOriginal = globalThis.fetch;
  let bateuNaRede = false;
  globalThis.fetch = (async () => {
    bateuNaRede = true;
    throw new Error('não devia ter consultado nada');
  }) as typeof fetch;
  try {
    const status = iniciarRenovacaoAutomaticaGraph();
    assert.match(status, /manual/);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(bateuNaRede, false);
  } finally {
    pararRenovacaoAutomaticaGraph();
    globalThis.fetch = fetchOriginal;
    for (const v of VARS_CREDENCIAL) {
      if (antes[v] === undefined) delete process.env[v];
      else process.env[v] = antes[v];
    }
  }
});

test(
  'iniciarRenovacaoAutomaticaGraph com credencial de app renova sozinho ao subir',
  comCredenciaisApp(async () => {
    const fetchOriginal = globalThis.fetch;
    let chamadas = 0;
    globalThis.fetch = (async () => {
      chamadas += 1;
      return new Response(JSON.stringify({ access_token: `token-${chamadas}`, expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    try {
      const status = iniciarRenovacaoAutomaticaGraph();
      assert.match(status, /automático/);
      // a troca roda em background (void agendar()); dá um tick pra ela terminar
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));
      assert.equal(process.env.MS_GRAPH_TOKEN, 'token-1');
      assert.equal(chamadas, 1);
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
