/**
 * Cliente Google Calendar — leitura de eventos e obtenção do token de acesso
 * (conta de serviço, sem usuário logado).
 *
 * MESMO CONTRATO de `ClienteGraph.ts`: lê o ambiente em função (nunca no topo
 * do módulo — `dotenv` carrega depois do `import`), e devolve
 * `{ ok: false, texto }` honesto em vez de lançar quando falta configuração
 * ou a chamada falha.
 *
 * AUTENTICAÇÃO — conta de serviço (Service Account), dois passos:
 *
 *   1. Monta um JWT auto-assinado (RS256) com a chave privada da conta de
 *      serviço — nenhuma senha, nenhum navegador, nenhum consentimento
 *      interativo: é a própria IARA se identificando, o mesmo papel do
 *      `client_credentials` da Microsoft Graph, só que no formato do Google
 *      (RFC 7523, "JWT Bearer Token").
 *   2. Troca esse JWT por um access token em `oauth2.googleapis.com/token`.
 *      O token dura ~1h; este módulo cacheia em MEMÓRIA e renova sozinho
 *      pouco antes de vencer — nunca em disco, mesma disciplina do
 *      `MS_GRAPH_TOKEN`.
 *
 * A conta de serviço só enxerga o calendário que foi COMPARTILHADO com ela —
 * o e-mail dela (termina em `.iam.gserviceaccount.com`) precisa ser
 * adicionado nas permissões do Google Calendar de quem vai usar a IARA. Sem
 * isso, a API responde 403 mesmo com token válido. Ver `.env.example`.
 */

import { createSign } from 'node:crypto';

const AUD_TOKEN = 'https://oauth2.googleapis.com/token';
const ESCOPO = 'https://www.googleapis.com/auth/calendar';
const BASE = 'https://www.googleapis.com/calendar/v3';
const TEMPO_LIMITE_MS = 10_000;
/** Renova esta margem antes do vencimento real — nunca deixa o token expirar em serviço. */
const MARGEM_RENOVACAO_S = 5 * 60;

interface CredenciaisGoogle {
  readonly email: string;
  readonly chave: string;
  readonly calendario: string;
}

/** Lê o ambiente em função, pelo mesmo motivo de `ClienteGraph.ts`. */
function credenciais(): CredenciaisGoogle | null {
  const email = process.env.GOOGLE_CALENDAR_CLIENT_EMAIL?.trim();
  const chaveBruta = process.env.GOOGLE_CALENDAR_PRIVATE_KEY?.trim();
  const calendario = process.env.GOOGLE_CALENDAR_ID?.trim();
  if (!email || !chaveBruta || !calendario) return null;
  // `.env` guarda a chave numa linha só, com `\n` escapado; a PEM real precisa
  // das quebras de linha de verdade para `createSign` aceitar a chave.
  const chave = chaveBruta.replace(/\\n/g, '\n');
  return { email, chave, calendario };
}

export function googleCalendarDisponivel(): boolean {
  return credenciais() !== null;
}

function base64url(entrada: Buffer | string): string {
  return Buffer.from(entrada).toString('base64url');
}

interface CacheToken {
  readonly valor: string;
  readonly expiraEm: number; // epoch ms
}

let cache: CacheToken | null = null;

interface RespostaTokenGoogle {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Monta o JWT auto-assinado e troca por access token, com cache em memória.
 * Exportada (não interna) para `ClienteGoogleCalendarioEscrita.ts` reusar a
 * MESMA autenticação — duas contas de serviço para o mesmo calendário seria
 * duas fontes de verdade sobre a mesma credencial.
 */
export async function obterTokenGoogleCalendario(): Promise<
  { ok: true; token: string } | { ok: false; motivo: string }
> {
  const c = credenciais();
  if (!c) {
    return { ok: false, motivo: 'GOOGLE_CALENDAR_CLIENT_EMAIL/PRIVATE_KEY/ID ausentes' };
  }

  if (cache && cache.expiraEm > Date.now() + MARGEM_RENOVACAO_S * 1000) {
    return { ok: true, token: cache.valor };
  }

  const agora = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(
    JSON.stringify({
      iss: c.email,
      scope: ESCOPO,
      aud: AUD_TOKEN,
      iat: agora,
      exp: agora + 3600,
    }),
  );
  const semAssinatura = `${header}.${claims}`;

  let assinatura: string;
  try {
    const assinador = createSign('RSA-SHA256');
    assinador.update(semAssinatura);
    assinatura = base64url(assinador.sign(c.chave));
  } catch (erro) {
    return { ok: false, motivo: `chave privada inválida: ${(erro as Error).message}` };
  }

  const jwt = `${semAssinatura}.${assinatura}`;

  try {
    const resposta = await fetch(AUD_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as RespostaTokenGoogle;
    if (!resposta.ok || !corpo.access_token) {
      const detalhe = corpo.error
        ? `${corpo.error}: ${(corpo.error_description ?? '').split(/\r?\n/)[0]}`
        : `HTTP ${resposta.status}`;
      return { ok: false, motivo: detalhe };
    }
    cache = { valor: corpo.access_token, expiraEm: Date.now() + (corpo.expires_in ?? 3600) * 1000 };
    return { ok: true, token: corpo.access_token };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
  }
}

/** Só para teste: descarta o cache entre casos, para cada um poder simular a troca. */
export function limparCacheTokenGoogleCalendario(): void {
  cache = null;
}

interface RespostaErroGoogle {
  error?: { code?: number; message?: string; status?: string };
}

/** `401` é credencial; `403` é permissão — a distinção importa porque os
 *  consertos são de pessoas diferentes (renovar chave vs. compartilhar agenda). */
async function mensagemDeErro(resposta: Response): Promise<string> {
  let corpo: RespostaErroGoogle | null = null;
  try {
    corpo = (await resposta.json()) as RespostaErroGoogle;
  } catch {
    /* corpo não veio em JSON — segue só com o status */
  }
  const detalhe = corpo?.error?.message;
  if (resposta.status === 401) {
    return 'Credencial do Google Calendar expirou ou é inválida.';
  }
  if (resposta.status === 403) {
    return (
      'Credencial do Google Calendar válida, mas sem permissão neste calendário — ' +
      'a conta de serviço precisa estar compartilhada nele (ver .env.example).'
    );
  }
  return `Google Calendar respondeu HTTP ${resposta.status}${detalhe ? `: ${detalhe}` : ''}.`;
}

interface EventoGoogle {
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  location?: string;
}

function dataHoraCurta(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Sao_Paulo',
  });
}

/**
 * Lista os próximos eventos do calendário real, em horário local
 * (`America/Sao_Paulo` — mesma disciplina de `porExtenso` em `Quando.ts`:
 * `toLocaleString` com fuso explícito, nunca `toISOString` cru).
 */
export async function listarEventosCalendario(
  diasAFrente: number,
): Promise<{ ok: boolean; texto: string }> {
  const c = credenciais();
  if (!c) {
    return {
      ok: false,
      texto: 'GOOGLE_CALENDAR_CLIENT_EMAIL/PRIVATE_KEY/ID não configurados — calendário desligado.',
    };
  }

  const t = await obterTokenGoogleCalendario();
  if (!t.ok) return { ok: false, texto: `Não consegui autenticar no Google Calendar (${t.motivo}).` };

  const agora = new Date();
  const fim = new Date(agora.getTime() + Math.min(Math.max(diasAFrente, 1), 30) * 86_400_000);
  const params = new URLSearchParams({
    timeMin: agora.toISOString(),
    timeMax: fim.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '25',
  });

  try {
    const resposta = await fetch(
      `${BASE}/calendars/${encodeURIComponent(c.calendario)}/events?${params.toString()}`,
      {
        headers: { Authorization: `Bearer ${t.token}` },
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      },
    );
    if (!resposta.ok) return { ok: false, texto: await mensagemDeErro(resposta) };

    const dados = (await resposta.json()) as { items?: EventoGoogle[] };
    const eventos = dados.items ?? [];
    if (eventos.length === 0) {
      return { ok: true, texto: 'Sem compromissos nesse período.' };
    }

    const linhas = eventos.map((e) => {
      const assunto = e.summary?.trim() || '(sem título)';
      const diaInteiro = !e.start?.dateTime && !!e.start?.date;
      const quando = diaInteiro ? 'dia inteiro' : dataHoraCurta(e.start?.dateTime);
      const local = e.location?.trim();
      return `• ${assunto} — ${quando}${local ? ` (${local})` : ''}`;
    });
    return { ok: true, texto: linhas.join('\n') };
  } catch (erro) {
    return {
      ok: false,
      texto: `Não consegui falar com o Google Calendar (${(erro as Error).message}). Prefiro dizer isso a inventar compromisso.`,
    };
  }
}
