/**
 * Cliente Microsoft Graph — caixa de entrada e busca no SharePoint.
 *
 * MESMO CONTRATO DE `ClienteSupabase`/`OrquestradorAcoes`: lê o ambiente em
 * função (nunca no topo do módulo — `dotenv` carrega depois do `import`), e
 * devolve `{ ok: false, texto }` honesto em vez de lançar quando falta
 * configuração ou a chamada falha. Quem chama nunca recebe exceção por
 * "esqueci o token".
 *
 * TOKEN, NÃO CREDENCIAL DE APP. `MS_GRAPH_TOKEN` é um access token da Graph
 * API já obtido — o mesmo desenho de `CONVAI_API_KEY`: a IARA não faz o
 * fluxo OAuth (client credentials ou device code) sozinha. Quem operar isto
 * precisa renovar o token periodicamente (a validade típica é ~1h); não há
 * refresh automático aqui, e fingir que há seria pior que não ter.
 *
 * O texto que chega ao operador é sempre REDIGIDO por este módulo — nunca o
 * JSON cru da Graph. Mesma disciplina do `RagHistorico`: resumo, não despejo.
 */

const BASE = 'https://graph.microsoft.com/v1.0';
const TEMPO_LIMITE_MS = 10_000;

function token(): string {
  return (process.env.MS_GRAPH_TOKEN ?? '').trim();
}

export function graphDisponivel(): boolean {
  return token().length > 0;
}

interface RespostaGraphErro {
  error?: { code?: string; message?: string };
}

/**
 * Traduz o erro HTTP mais comum da Graph para algo que o operador entende.
 * `401` quase sempre é token expirado — a distinção importa porque "renove o
 * token" é uma ação concreta, e "deu erro" não é.
 */
async function mensagemDeErro(resposta: Response): Promise<string> {
  let corpo: RespostaGraphErro | null = null;
  try {
    corpo = (await resposta.json()) as RespostaGraphErro;
  } catch {
    /* corpo não veio em JSON — segue só com o status */
  }
  const detalhe = corpo?.error?.message;
  if (resposta.status === 401) {
    return 'MS_GRAPH_TOKEN expirou ou é inválido. Access token da Graph API precisa ser renovado.';
  }
  if (resposta.status === 403) {
    return 'MS_GRAPH_TOKEN não tem permissão para isto (escopo insuficiente no app registrado).';
  }
  return `Microsoft Graph respondeu HTTP ${resposta.status}${detalhe ? `: ${detalhe}` : ''}.`;
}

interface MensagemGraph {
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
}

function remetente(m: MensagemGraph): string {
  const e = m.from?.emailAddress;
  if (!e) return 'remetente desconhecido';
  return e.name ? `${e.name} <${e.address ?? ''}>`.trim() : (e.address ?? 'remetente desconhecido');
}

function dataCurta(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Lê e-mails recentes da caixa do operador. `filtro` casa contra assunto,
 * corpo e remetente (`$search` da Graph, que exige o cabeçalho
 * `ConsistencyLevel: eventual` — sem ele a API recusa a combinação). Sem
 * filtro, lista os mais recentes por data de recebimento.
 */
export async function buscarEmails(
  filtro: string,
  limite: number,
): Promise<{ ok: boolean; texto: string }> {
  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — caixa de entrada desligada.' };

  const params = new URLSearchParams({
    '$top': String(Math.min(Math.max(limite, 1), 25)),
    '$select': 'subject,from,receivedDateTime,bodyPreview',
  });
  const cabecalhos: Record<string, string> = { Authorization: `Bearer ${t}` };
  if (filtro.trim()) {
    // `$search` é aspas-obrigatórias e não convive com `$orderby`.
    params.set('$search', `"${filtro.trim().replace(/"/g, "'")}"`);
    cabecalhos.ConsistencyLevel = 'eventual';
  } else {
    params.set('$orderby', 'receivedDateTime desc');
  }

  try {
    const resposta = await fetch(`${BASE}/me/messages?${params.toString()}`, {
      headers: cabecalhos,
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) return { ok: false, texto: await mensagemDeErro(resposta) };

    const dados = (await resposta.json()) as { value?: MensagemGraph[] };
    const mensagens = dados.value ?? [];
    if (mensagens.length === 0) {
      return {
        ok: true,
        texto: filtro.trim()
          ? `Nenhum e-mail encontrado para "${filtro.trim()}".`
          : 'Caixa de entrada sem mensagens recentes.',
      };
    }

    const linhas = mensagens.map((m) => {
      const assunto = m.subject?.trim() || '(sem assunto)';
      const previa = (m.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 140);
      return `• ${assunto} — ${remetente(m)}, ${dataCurta(m.receivedDateTime)}${previa ? `\n  "${previa}${previa.length === 140 ? '…' : ''}"` : ''}`;
    });
    return { ok: true, texto: linhas.join('\n') };
  } catch (erro) {
    return {
      ok: false,
      texto: `Não consegui falar com a Microsoft Graph (${(erro as Error).message}). Prefiro dizer isso a inventar e-mail.`,
    };
  }
}

interface ResultadoBuscaGraph {
  hitsContainers?: Array<{
    hits?: Array<{
      resource?: { name?: string; webUrl?: string };
      summary?: string;
    }>;
  }>;
}

/**
 * Busca documentos no SharePoint/OneDrive corporativo pela Search API da
 * Graph (`/search/query`) — não a API de sites, de propósito: ela cobre
 * tudo que o operador tem acesso sem exigir saber em qual site o documento
 * está, que é exatamente a pergunta que "busque um documento" não responde.
 */
export async function buscarSharepoint(consulta: string): Promise<{ ok: boolean; texto: string }> {
  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — busca no SharePoint desligada.' };
  if (!consulta.trim()) return { ok: false, texto: 'Preciso de um termo para buscar.' };

  try {
    const resposta = await fetch(`${BASE}/search/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            entityTypes: ['driveItem'],
            query: { queryString: consulta.trim() },
            from: 0,
            size: 5,
          },
        ],
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) return { ok: false, texto: await mensagemDeErro(resposta) };

    const dados = (await resposta.json()) as { value?: ResultadoBuscaGraph[] };
    const hits = dados.value?.[0]?.hitsContainers?.[0]?.hits ?? [];
    if (hits.length === 0) {
      return { ok: true, texto: `Nenhum documento encontrado para "${consulta.trim()}".` };
    }

    const linhas = hits.map((h) => {
      const nome = h.resource?.name ?? '(sem nome)';
      const link = h.resource?.webUrl ?? '';
      const resumo = (h.summary ?? '').replace(/<[^>]+>/g, '').trim();
      return `• ${nome}${link ? ` — ${link}` : ''}${resumo ? `\n  ${resumo}` : ''}`;
    });
    return { ok: true, texto: linhas.join('\n') };
  } catch (erro) {
    return {
      ok: false,
      texto: `Não consegui falar com a Microsoft Graph (${(erro as Error).message}). Prefiro dizer isso a inventar documento.`,
    };
  }
}
