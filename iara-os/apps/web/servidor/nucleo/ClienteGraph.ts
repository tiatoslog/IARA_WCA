/**
 * Cliente Microsoft Graph — caixa de entrada, busca no SharePoint, e a
 * renovação do próprio token.
 *
 * MESMO CONTRATO DE `ClienteSupabase`/`OrquestradorAcoes`: lê o ambiente em
 * função (nunca no topo do módulo — `dotenv` carrega depois do `import`), e
 * devolve `{ ok: false, texto }` honesto em vez de lançar quando falta
 * configuração ou a chamada falha. Quem chama nunca recebe exceção por
 * "esqueci o token".
 *
 * `MS_GRAPH_TOKEN` é um access token da Graph API — validade típica ~1h. Duas
 * formas de mantê-lo válido, e as duas convivem:
 *
 *   1. Manual: alguém cola um token já emitido em `MS_GRAPH_TOKEN` e renova à
 *      mão quando expirar. Comportamento original, ainda suportado — é o que
 *      sobra quando não há credencial de app configurada.
 *   2. Automática: com `MS_GRAPH_CLIENT_ID` + `MS_GRAPH_TENANT_ID` +
 *      `MS_GRAPH_CLIENT_SECRET` (client credentials flow do Azure AD),
 *      `iniciarRenovacaoAutomaticaGraph` troca as credenciais por um token
 *      novo na subida e reagenda a próxima troca minutos antes do vencimento.
 *      Sempre GRAVANDO em `process.env.MS_GRAPH_TOKEN`, nunca em disco —
 *      `token()` lê o ambiente a cada chamada, então a requisição seguinte já
 *      usa o token novo, sem restart do processo.
 *
 * Falha na renovação NUNCA apaga o token anterior nem derruba o processo: o
 * token velho segue servindo até expirar de verdade, a tentativa seguinte
 * roda em 5 min, e o log diz a verdade. Fingir que renovou seria pior que não
 * renovar.
 *
 * O texto que chega ao operador é sempre REDIGIDO por este módulo — nunca o
 * JSON cru da Graph. Mesma disciplina do `RagHistorico`: resumo, não despejo.
 */

import { FUSO_OPERACAO } from './kernel/Quando';

const BASE = 'https://graph.microsoft.com/v1.0';
const TEMPO_LIMITE_MS = 10_000;

function token(): string {
  return (process.env.MS_GRAPH_TOKEN ?? '').trim();
}

export function graphDisponivel(): boolean {
  return token().length > 0;
}

// ---------------------------------------------------------------------------
// Renovação automática (client credentials flow)
// ---------------------------------------------------------------------------

const URL_TOKEN_AZURE = (tenantId: string) =>
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

/** Renova esta margem antes do vencimento real — nunca deixa o token expirar em serviço. */
const MARGEM_RENOVACAO_S = 5 * 60;
/** Piso do intervalo entre renovações. Um `expires_in` absurdamente curto não vira loop apertado. */
const RENOVACAO_MINIMA_S = 60;
/** Falhou? Tenta de novo bem antes de o token atual expirar (~1h de folga típica). */
const RETENTATIVA_APOS_FALHA_MS = 5 * 60 * 1000;

let cronometroRenovacao: ReturnType<typeof setTimeout> | null = null;

interface CredenciaisAppGraph {
  readonly tenantId: string;
  readonly clientId: string;
  readonly clientSecret: string;
}

/** Lê o ambiente em função, pelo mesmo motivo de `token()`. */
function credenciaisApp(): CredenciaisAppGraph | null {
  const tenantId = process.env.MS_GRAPH_TENANT_ID?.trim();
  const clientId = process.env.MS_GRAPH_CLIENT_ID?.trim();
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenantId || !clientId || !clientSecret) return null;
  return { tenantId, clientId, clientSecret };
}

interface RespostaTokenAzure {
  access_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

/**
 * Troca `client_id` + `client_secret` por um access token novo e grava em
 * `process.env.MS_GRAPH_TOKEN`. Exportada separada de
 * `iniciarRenovacaoAutomaticaGraph` para poder ser testada e chamada uma vez
 * sem esperar o relógio.
 */
export async function renovarTokenGraph(): Promise<
  { ok: true; expiraEmS: number } | { ok: false; motivo: string }
> {
  const c = credenciaisApp();
  if (!c) return { ok: false, motivo: 'MS_GRAPH_CLIENT_ID/MS_GRAPH_TENANT_ID/MS_GRAPH_CLIENT_SECRET ausentes' };

  try {
    const resposta = await fetch(URL_TOKEN_AZURE(c.tenantId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: c.clientId,
        client_secret: c.clientSecret,
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    const corpo = (await resposta.json().catch(() => ({}))) as RespostaTokenAzure;
    if (!resposta.ok || !corpo.access_token) {
      const detalhe = corpo.error
        ? `${corpo.error}: ${(corpo.error_description ?? '').split(/\r?\n/)[0]}`
        : `HTTP ${resposta.status}`;
      return { ok: false, motivo: detalhe };
    }
    process.env.MS_GRAPH_TOKEN = corpo.access_token;
    return { ok: true, expiraEmS: corpo.expires_in ?? 3600 };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
  }
}

/**
 * Liga o relógio de renovação, SE houver credencial de app configurada. Sem
 * `MS_GRAPH_CLIENT_ID/TENANT_ID/SECRET`, o comportamento é o de sempre:
 * `MS_GRAPH_TOKEN`, se presente, é usado até expirar e ninguém o renova
 * sozinho. Devolve uma frase para o log de subida — nunca um valor.
 *
 * Idempotente: uma segunda chamada para o cronômetro anterior antes de
 * agendar de novo, então religar não duplica o laço.
 */
/**
 * COMO esta instalação se autentica na Graph, em uma frase.
 *
 * Extraída de dentro de `iniciarRenovacaoAutomaticaGraph` porque o 401 precisa
 * dela: "a credencial expirou" tem consertos OPOSTOS nos dois modos. No
 * automático é um problema de verdade (as credenciais de app pararam de
 * funcionar); no manual é o comportamento esperado de um token de ~1h que
 * ninguém renovou, e o conserto é configurar `MS_GRAPH_CLIENT_ID`,
 * `MS_GRAPH_TENANT_ID` e `MS_GRAPH_CLIENT_SECRET` no host. Uma mensagem de erro
 * que não distingue os dois manda a pessoa colar outro token que também vai
 * vencer em uma hora.
 */
export function modoDeAutenticacaoGraph(): string {
  if (!credenciaisApp()) {
    return process.env.MS_GRAPH_TOKEN?.trim()
      ? 'MS_GRAPH_TOKEN manual (sem credencial de app — renove à mão quando expirar, ou configure ' +
          'MS_GRAPH_CLIENT_ID, MS_GRAPH_TENANT_ID e MS_GRAPH_CLIENT_SECRET para renovar sozinho)'
      : 'desligado (sem MS_GRAPH_TOKEN nem credencial de app)';
  }
  return 'automático (client credentials — renova sozinho minutos antes de cada expiração)';
}

export function iniciarRenovacaoAutomaticaGraph(): string {
  pararRenovacaoAutomaticaGraph();

  if (!credenciaisApp()) return modoDeAutenticacaoGraph();

  const agendar = async (): Promise<void> => {
    const r = await renovarTokenGraph();
    if (r.ok) {
      const proximaEmS = Math.max(RENOVACAO_MINIMA_S, r.expiraEmS - MARGEM_RENOVACAO_S);
      console.log(
        `[iara] MS_GRAPH_TOKEN renovado automaticamente — próxima renovação em ${Math.round(proximaEmS / 60)} min`,
      );
      cronometroRenovacao = setTimeout(() => void agendar(), proximaEmS * 1000);
    } else {
      console.warn(
        `[iara] renovação automática do MS_GRAPH_TOKEN falhou (${r.motivo}) — tentando de novo em 5 min; ` +
          'o token atual (se houver) continua valendo até expirar de verdade.',
      );
      cronometroRenovacao = setTimeout(() => void agendar(), RETENTATIVA_APOS_FALHA_MS);
    }
    cronometroRenovacao?.unref();
  };

  void agendar();
  return modoDeAutenticacaoGraph();
}

/** Desliga o relógio, se estiver ligado. Chamado no encerramento do processo e entre testes. */
export function pararRenovacaoAutomaticaGraph(): void {
  if (cronometroRenovacao) {
    clearTimeout(cronometroRenovacao);
    cronometroRenovacao = null;
  }
}

// ---------------------------------------------------------------------------
// Classificação de falha — a categoria do erro sobrevive à tradução
// ---------------------------------------------------------------------------

/**
 * POR QUE O GRAPH RECUSOU. Uma escala só, e ela mora aqui porque este é o
 * módulo que conhece a semântica da Graph — a mesma razão de
 * `classificarFalhaProvedor` morar na cadeia de raciocínio.
 *
 * O DEFEITO QUE ISTO FECHA (16/08/2026). A operadora pediu a planilha e leu:
 *
 *   "Não consegui localizar a planilha: Graph recusou localizar a planilha
 *    (HTTP 401): {"error":{"code":"InvalidAuthenticationToken","message":
 *    "Lifetime validation failed, the token is expired." ...
 *
 * Duas coisas erradas numa frase só. A primeira é a CATEGORIA: um token
 * expirado virou "não localizei o arquivo". São problemas diferentes, com
 * consertos diferentes e donos diferentes — quem lê "não localizei" vai
 * procurar a planilha no SharePoint, mexer em permissão de pasta, perguntar
 * para a equipe se alguém moveu o arquivo. O arquivo está lá; o que venceu foi
 * a credencial.
 *
 * A segunda é o JSON CRU indo para a bolha de chat, contra o que o cabeçalho
 * deste arquivo promete em voz alta: "o texto que chega ao operador é sempre
 * REDIGIDO por este módulo — nunca o JSON cru da Graph". A promessa era
 * verdadeira aqui e falsa no `ClientePlanilhaOcis`, que montava a própria
 * mensagem sem passar por aqui. Contrato que vale num módulo e não vale no
 * vizinho não é contrato.
 */
export type ClasseFalhaGraph =
  /** A credencial venceu ou é inválida. Ninguém procura arquivo por causa disto. */
  | 'credencial'
  /** A credencial é válida e não alcança este recurso. */
  | 'permissao'
  /** A Graph respondeu, e o recurso não existe (ou não é visível a esta conta). */
  | 'nao_encontrado'
  /** A Graph respondeu com erro dela. Não é nosso, e tentar de novo pode servir. */
  | 'servico'
  /** Não houve resposta: rede, DNS, tempo esgotado. */
  | 'rede';

export interface FalhaGraph {
  readonly classe: ClasseFalhaGraph;
  /** Uma linha, em português, já sem corpo de JSON. */
  readonly frase: string;
}

/**
 * A frase que descreve a falha, com o SUJEITO certo.
 *
 * `oQueSeQueria` é o complemento honesto e só é usado onde ele é verdadeiro —
 * em `nao_encontrado`. Nas outras classes ele não aparece, porque dizer "não
 * consegui ler a planilha" quando a credencial venceu é subordinar o fato à
 * intenção de quem perguntou.
 */
export function classificarStatusGraph(status: number, oQueSeQueria: string): FalhaGraph {
  if (status === 401) {
    return {
      classe: 'credencial',
      frase:
        'A credencial do Microsoft 365 expirou (HTTP 401) — não é a planilha, é o acesso. ' +
        `Como esta instalação se autentica: ${modoDeAutenticacaoGraph()}.`,
    };
  }
  if (status === 403) {
    return {
      classe: 'permissao',
      frase:
        `A credencial do Microsoft 365 é válida mas não tem permissão para ${oQueSeQueria} ` +
        '(HTTP 403) — falta escopo no app registrado no Azure.',
    };
  }
  if (status === 404) {
    return { classe: 'nao_encontrado', frase: `Não localizei ${oQueSeQueria} (HTTP 404).` };
  }
  if (status === 429) {
    return {
      classe: 'servico',
      frase: 'O Microsoft 365 pediu para eu ir mais devagar (HTTP 429). Tente daqui a pouco.',
    };
  }
  return {
    classe: 'servico',
    frase: `O Microsoft 365 respondeu com erro (HTTP ${status}) ao ${oQueSeQueria}.`,
  };
}

/** Falha sem resposta HTTP: nunca é "não localizei" — não houve conversa. */
export function classificarExcecaoGraph(erro: unknown, oQueSeQueria: string): FalhaGraph {
  const bruto = erro instanceof Error ? erro.message : String(erro);
  const tempoEsgotado = /timeout|abort|ETIMEDOUT/i.test(bruto);
  return {
    classe: 'rede',
    frase: tempoEsgotado
      ? `O Microsoft 365 não respondeu a tempo ao ${oQueSeQueria}.`
      : `Não consegui falar com o Microsoft 365 para ${oQueSeQueria}: ${umaLinhaGraph(bruto)}.`,
  };
}

/** Sem corpo de resposta, sem quebra de linha, com teto. */
function umaLinhaGraph(bruto: string): string {
  return bruto.replace(/\s+/g, ' ').trim().slice(0, 120);
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
  /* `timeZone` explícito, pela mesma razão do relógio (18/08/2026): sem ele
     vale o fuso do sistema — UTC no Railway —, e um e-mail recebido às 15:00
     aparecia carimbado como 18:00. Errado de um jeito que ninguém confere. */
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO_OPERACAO,
  });
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

  /**
   * `/me` SÓ EXISTE NO FLUXO DELEGADO — e o token deste sistema é de
   * APLICATIVO (client credentials, ver cabeçalho). Achado em teste E2E real
   * (14/08/2026): "Leia meus emails" chegava até aqui e a Graph respondia
   * HTTP 400 "/me request is only valid with delegated authentication flow",
   * sempre. Com `MS_GRAPH_CAIXA` (o e-mail da caixa a ler), a rota vira
   * `/users/{caixa}` — a forma que o fluxo de aplicativo aceita. Sem a
   * variável, mantém `/me`: um token delegado colado à mão continua
   * funcionando como antes.
   */
  const caixa = process.env.MS_GRAPH_CAIXA?.trim();
  const raizCaixa = caixa ? `${BASE}/users/${encodeURIComponent(caixa)}` : `${BASE}/me`;

  try {
    const resposta = await fetch(`${raizCaixa}/messages?${params.toString()}`, {
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
 *
 * Com token de APLICATIVO (client credentials — o único modo que este
 * processo usa), a Search API exige o campo `region`: sem ele, HTTP 400
 * "Region is required when request with application permission." Não existe
 * essa exigência em token delegado, e é por isso que passou despercebido até
 * ser testado contra um tenant real. `BRA` foi confirmado por tentativa
 * direta contra a Graph — a própria API devolve "Only valid regions are
 * BRA" quando o valor está errado, então um tenant diferente aparece no log
 * em vez de falhar em silêncio.
 */
export async function buscarSharepoint(consulta: string): Promise<{ ok: boolean; texto: string }> {
  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — busca no SharePoint desligada.' };
  if (!consulta.trim()) return { ok: false, texto: 'Preciso de um termo para buscar.' };

  const regiao = process.env.MS_GRAPH_REGIAO?.trim() || 'BRA';

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
            region: regiao,
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
