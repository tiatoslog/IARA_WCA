/**
 * Cliente Google Calendar — criação de evento real. ÚNICO propósito deste
 * módulo: o POST que cria algo fora do processo.
 *
 * Separado de `ClienteGoogleCalendario.ts` (leitura) pela mesma razão que
 * separa `ClienteWhatsapp.ts` do resto do sistema: uma leitura repetida não
 * machuca ninguém; um evento criado duas vezes, sim. A fronteira entre
 * `LEITURA_EXTERNA` e `EFEITO_EXTERNO` (ver `Fronteira.ts`) precisa de um
 * módulo por categoria para o teste de grafo poder provar a diferença — um
 * arquivo só, com as duas funções, tornaria as duas categorias indistintas.
 *
 * ESTE MÓDULO NUNCA DECIDE SE CRIA. Quem decide é `AgenteLocal`, e só depois
 * que o MESMO operador que pediu confirma dentro de 60s — ver
 * `AgenteLocal.pedirCriarEventoCalendario`/`confirmarCriarEventoCalendario`.
 * Mesmo desenho R2 de `ClienteWhatsapp.ts`.
 *
 * v1 NUNCA adiciona convidados (`attendees`). Decisão deliberada: o evento
 * só aparece no calendário que a IARA já tem permissão de escrever — nunca
 * alcança uma pessoa nova além de quem já é dono do calendário. Convidar
 * terceiros é escopo futuro, com revisão de risco própria (deixaria de ser
 * só "um evento no MEU calendário" e passaria a "um convite que ALGUÉM
 * recebe").
 */

import { obterTokenGoogleCalendario } from './ClienteGoogleCalendario';

const BASE = 'https://www.googleapis.com/calendar/v3';
const TEMPO_LIMITE_MS = 10_000;

function calendario(): string {
  return (process.env.GOOGLE_CALENDAR_ID ?? '').trim();
}

interface RespostaEvento {
  id?: string;
  htmlLink?: string;
  error?: { code?: number; message?: string };
}

/**
 * Cria o evento. `inicioIso`/`fimIso` já vêm RESOLVIDOS (produzidos por
 * `interpretarQuando`, nunca por texto livre da LLM) — este módulo só monta
 * o corpo HTTP e interpreta a resposta.
 */
export async function criarEventoCalendario(
  assunto: string,
  inicioIso: string,
  fimIso: string,
  local: string,
): Promise<{ ok: boolean; texto: string }> {
  const cal = calendario();
  if (!cal) {
    return { ok: false, texto: 'GOOGLE_CALENDAR_ID não configurado — não sei em qual calendário criar.' };
  }

  const t = await obterTokenGoogleCalendario();
  if (!t.ok) return { ok: false, texto: `Não consegui autenticar no Google Calendar (${t.motivo}).` };

  const corpo: Record<string, unknown> = {
    summary: assunto,
    start: { dateTime: inicioIso, timeZone: 'America/Sao_Paulo' },
    end: { dateTime: fimIso, timeZone: 'America/Sao_Paulo' },
  };
  if (local.trim()) corpo.location = local.trim();

  try {
    const resposta = await fetch(`${BASE}/calendars/${encodeURIComponent(cal)}/events`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const dados = (await resposta.json().catch(() => ({}))) as RespostaEvento;

    if (!resposta.ok) {
      if (resposta.status === 401) return { ok: false, texto: 'Credencial do Google Calendar expirou ou é inválida.' };
      if (resposta.status === 403) {
        return {
          ok: false,
          texto:
            'Sem permissão para criar evento neste calendário — a conta de serviço precisa de acesso ' +
            '"Fazer alterações nos eventos" (não só leitura).',
        };
      }
      const detalhe = dados.error?.message;
      return { ok: false, texto: `Google Calendar recusou o evento (HTTP ${resposta.status}${detalhe ? `: ${detalhe}` : ''}).` };
    }

    if (!dados.id) {
      return {
        ok: false,
        texto: 'O Google respondeu OK mas sem confirmar o evento criado — prefiro dizer isso a inventar que criei.',
      };
    }
    return { ok: true, texto: `Evento criado: "${assunto}"${dados.htmlLink ? ` — ${dados.htmlLink}` : ''}.` };
  } catch (erro) {
    return {
      ok: false,
      texto: `Não consegui falar com o Google Calendar (${(erro as Error).message}). Prefiro dizer isso a inventar que criei.`,
    };
  }
}
