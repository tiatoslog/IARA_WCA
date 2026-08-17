/**
 * Cliente Google Calendar — leitura de eventos, criação de evento e a troca
 * de JWT por access token (conta de serviço).
 *
 * Testes contra o CONTRATO HTTP do Google (documentação pública), com
 * `fetch` simulado — não contra um projeto real. Mesma disciplina de
 * `testes/graph.test.ts`: se o contrato real divergir do que está testado
 * aqui, é aqui que quebra primeiro quando alguém configurar a credencial de
 * verdade.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';

import {
  googleCalendarDisponivel,
  obterTokenGoogleCalendario,
  limparCacheTokenGoogleCalendario,
  listarEventosCalendario,
} from '../servidor/nucleo/ClienteGoogleCalendario';
import { criarEventoCalendario } from '../servidor/nucleo/ClienteGoogleCalendarioEscrita';

const VARS = ['GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID'] as const;

/** Uma chave RSA de verdade, gerada uma vez — `createSign` recusa string aleatória. */
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const CHAVE_TESTE = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function comCredenciais(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    process.env.GOOGLE_CALENDAR_CLIENT_EMAIL = 'iara-teste@projeto-teste.iam.gserviceaccount.com';
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = CHAVE_TESTE;
    process.env.GOOGLE_CALENDAR_ID = 'operadora@gmail.com';
    limparCacheTokenGoogleCalendario();
    try {
      await fn();
    } finally {
      limparCacheTokenGoogleCalendario();
      for (const v of VARS) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

function decodificarJwt(jwt: string): { header: Record<string, unknown>; payload: Record<string, unknown> } {
  const [h, p] = jwt.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString('utf8')),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')),
  };
}

test('sem credenciais, googleCalendarDisponivel() é falso', () => {
  const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
  try {
    assert.equal(googleCalendarDisponivel(), false);
  } finally {
    for (const v of VARS) {
      if (antes[v] !== undefined) process.env[v] = antes[v];
    }
  }
});

test('sem credenciais, listarEventosCalendario recusa sem bater na rede', async () => {
  const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
  for (const v of VARS) delete process.env[v];
  const fetchOriginal = globalThis.fetch;
  let bateuNaRede = false;
  globalThis.fetch = (async () => {
    bateuNaRede = true;
    throw new Error('não devia ter consultado nada');
  }) as typeof fetch;
  try {
    const r = await listarEventosCalendario(7);
    assert.equal(r.ok, false);
    assert.match(r.texto, /GOOGLE_CALENDAR/);
    assert.equal(bateuNaRede, false);
  } finally {
    globalThis.fetch = fetchOriginal;
    for (const v of VARS) {
      if (antes[v] !== undefined) process.env[v] = antes[v];
    }
  }
});

test(
  'sem credenciais, criarEventoCalendario recusa sem bater na rede',
  async () => {
    const antes = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    for (const v of VARS) delete process.env[v];
    const fetchOriginal = globalThis.fetch;
    let bateuNaRede = false;
    globalThis.fetch = (async () => {
      bateuNaRede = true;
      throw new Error('não devia ter consultado nada');
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario('Reunião', '2026-08-18T14:00:00-03:00', '2026-08-18T15:00:00-03:00', '');
      assert.equal(r.ok, false);
      assert.match(r.texto, /GOOGLE_CALENDAR/);
      assert.equal(bateuNaRede, false);
    } finally {
      globalThis.fetch = fetchOriginal;
      for (const v of VARS) {
        if (antes[v] !== undefined) process.env[v] = antes[v];
      }
    }
  },
);

test(
  'obterTokenGoogleCalendario monta um JWT com iss/scope/aud corretos e troca por access token',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    let urlChamada = '';
    let corpoEnviado = '';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      urlChamada = String(url);
      corpoEnviado = String(init?.body ?? '');
      return new Response(JSON.stringify({ access_token: 'token-novo', expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await obterTokenGoogleCalendario();
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.token, 'token-novo');
      assert.equal(urlChamada, 'https://oauth2.googleapis.com/token');
      assert.match(corpoEnviado, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);

      const params = new URLSearchParams(corpoEnviado);
      const jwt = params.get('assertion')!;
      assert.equal(jwt.split('.').length, 3, 'JWT precisa ter três partes');
      const { header, payload } = decodificarJwt(jwt);
      assert.equal(header.alg, 'RS256');
      assert.equal(payload.iss, 'iara-teste@projeto-teste.iam.gserviceaccount.com');
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/calendar');
      assert.equal(payload.aud, 'https://oauth2.googleapis.com/token');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'obterTokenGoogleCalendario cacheia — segunda chamada não bate na rede de novo',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    let chamadas = 0;
    globalThis.fetch = (async () => {
      chamadas += 1;
      return new Response(JSON.stringify({ access_token: 'token-cache', expires_in: 3600 }), { status: 200 });
    }) as typeof fetch;
    try {
      const r1 = await obterTokenGoogleCalendario();
      const r2 = await obterTokenGoogleCalendario();
      assert.equal(r1.ok, true);
      assert.equal(r2.ok, true);
      if (r1.ok && r2.ok) assert.equal(r1.token, r2.token);
      assert.equal(chamadas, 1, 'a segunda chamada deveria usar o cache');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'obterTokenGoogleCalendario com chave privada inválida não bate na rede',
  comCredenciais(async () => {
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = 'isto-nao-e-uma-chave-pem';
    const fetchOriginal = globalThis.fetch;
    let bateuNaRede = false;
    globalThis.fetch = (async () => {
      bateuNaRede = true;
      throw new Error('não devia ter consultado nada');
    }) as typeof fetch;
    try {
      const r = await obterTokenGoogleCalendario();
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.motivo, /chave privada inválida/);
      assert.equal(bateuNaRede, false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'listarEventosCalendario lista eventos reais, formata em horário local',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    let urlEventos = '';
    let chamadas = 0;
    globalThis.fetch = (async (url: string) => {
      chamadas += 1;
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'token-de-teste', expires_in: 3600 }), { status: 200 });
      }
      urlEventos = String(url);
      return new Response(
        JSON.stringify({
          items: [
            {
              summary: 'Reunião com o financeiro',
              start: { dateTime: '2026-08-18T14:00:00-03:00' },
              end: { dateTime: '2026-08-18T15:00:00-03:00' },
              location: 'Sala 2',
            },
          ],
        }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const r = await listarEventosCalendario(7);
      assert.equal(r.ok, true);
      assert.match(r.texto, /Reunião com o financeiro/);
      assert.match(r.texto, /Sala 2/);
      assert.ok(urlEventos.includes('/calendars/operadora%40gmail.com/events'), `URL errada: ${urlEventos}`);
      assert.ok(urlEventos.includes('singleEvents=true'));
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'listarEventosCalendario sem eventos diz isso, não inventa compromisso',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await listarEventosCalendario(7);
      assert.equal(r.ok, true);
      assert.match(r.texto, /[Ss]em compromissos/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'listarEventosCalendario traduz 403 em falta de permissão, não em "não encontrei"',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 });
    }) as typeof fetch;
    try {
      const r = await listarEventosCalendario(7);
      assert.equal(r.ok, false);
      assert.match(r.texto, /permiss/i);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'listarEventosCalendario traduz 401 em credencial expirada',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 401 });
    }) as typeof fetch;
    try {
      const r = await listarEventosCalendario(7);
      assert.equal(r.ok, false);
      assert.match(r.texto, /expirou|inválida/i);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'listarEventosCalendario não inventa compromisso quando a rede falha',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      throw new Error('ECONNRESET');
    }) as typeof fetch;
    try {
      const r = await listarEventosCalendario(7);
      assert.equal(r.ok, false);
      assert.match(r.texto, /ECONNRESET/);
      assert.doesNotMatch(r.texto, /Reunião/i);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'criarEventoCalendario cria de verdade — corpo sem attendees, com fuso explícito',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    let corpo: Record<string, unknown> = {};
    let metodo = '';
    let urlChamada = '';
    globalThis.fetch = (async (url: string, init?: RequestInit) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      urlChamada = String(url);
      metodo = init?.method ?? '';
      corpo = JSON.parse(String(init?.body ?? '{}'));
      return new Response(
        JSON.stringify({ id: 'evt123', htmlLink: 'https://calendar.google.com/evt123' }),
        { status: 200 },
      );
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario(
        'Reunião com o financeiro',
        '2026-08-18T14:00:00-03:00',
        '2026-08-18T15:00:00-03:00',
        'Sala 2',
      );
      assert.equal(r.ok, true);
      assert.match(r.texto, /Reunião com o financeiro/);
      assert.match(r.texto, /evt123|calendar\.google\.com/);
      assert.equal(metodo, 'POST');
      assert.ok(urlChamada.includes('/calendars/operadora%40gmail.com/events'));
      assert.equal(corpo.summary, 'Reunião com o financeiro');
      assert.deepEqual(corpo.start, { dateTime: '2026-08-18T14:00:00-03:00', timeZone: 'America/Sao_Paulo' });
      assert.equal(corpo.location, 'Sala 2');
      assert.equal('attendees' in corpo, false, 'v1 não deveria convidar ninguém');
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'criarEventoCalendario traduz 403 em falta de permissão de escrita',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), { status: 403 });
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario('Reunião', '2026-08-18T14:00:00-03:00', '2026-08-18T15:00:00-03:00', '');
      assert.equal(r.ok, false);
      assert.match(r.texto, /permiss/i);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'criarEventoCalendario sem id na resposta não afirma ter criado',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario('Reunião', '2026-08-18T14:00:00-03:00', '2026-08-18T15:00:00-03:00', '');
      assert.equal(r.ok, false);
      assert.match(r.texto, /inventar/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'criarEventoCalendario não inventa sucesso quando a rede falha',
  comCredenciais(async () => {
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
      }
      throw new Error('ETIMEDOUT');
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario('Reunião', '2026-08-18T14:00:00-03:00', '2026-08-18T15:00:00-03:00', '');
      assert.equal(r.ok, false);
      assert.match(r.texto, /ETIMEDOUT/);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

test(
  'sem GOOGLE_CALENDAR_ID, criarEventoCalendario recusa antes de autenticar',
  comCredenciais(async () => {
    delete process.env.GOOGLE_CALENDAR_ID;
    const fetchOriginal = globalThis.fetch;
    let bateuNaRede = false;
    globalThis.fetch = (async () => {
      bateuNaRede = true;
      throw new Error('não devia ter consultado nada');
    }) as typeof fetch;
    try {
      const r = await criarEventoCalendario('Reunião', '2026-08-18T14:00:00-03:00', '2026-08-18T15:00:00-03:00', '');
      assert.equal(r.ok, false);
      assert.match(r.texto, /GOOGLE_CALENDAR_ID/);
      assert.equal(bateuNaRede, false);
    } finally {
      globalThis.fetch = fetchOriginal;
    }
  }),
);

