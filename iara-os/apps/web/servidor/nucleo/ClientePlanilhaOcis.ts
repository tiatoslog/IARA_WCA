/**
 * ClientePlanilhaOcis — leitura da planilha "VANIA - CONTROLE OCIS 2025 - 2"
 * (SharePoint, operação de carregamento LUFT). Uma linha da aba "2026" É uma
 * carga real: OCI, origem, destino, motorista, datas, valor.
 *
 * MESMO CONTRATO DE `ClienteGraph`: lê o ambiente em função, nunca lança,
 * devolve `{ ok: false, texto }` honesto. Usa o MESMO `MS_GRAPH_TOKEN` (e a
 * mesma renovação automática) — esta planilha é só mais uma coisa que a
 * Microsoft Graph sabe ler, não uma credencial nova.
 *
 * DADO DE CÉLULA É DADO, NUNCA COMANDO. Este módulo só produz valores
 * tipados (`Carga`) a partir de células — nunca concatena texto de célula em
 * algo que vira prompt, comando de sistema ou instrução. Se um dia uma
 * célula precisar alimentar uma chamada ao Claude (análise, não contagem), o
 * texto dela entra como DADO rotulado dentro do payload — nunca como
 * instrução —, a mesma disciplina que `RagHistorico` já aplica a log.
 *
 * ESTRUTURA DA ABA "2026" (mapeada e testada contra a planilha real em
 * 14/08/2026 — ver conversa da auditoria): cabeçalho na linha 1, dados reais
 * a partir da linha 5 até o fim do `usedRange` (o miolo entre o cabeçalho e
 * o fim costuma trazer linhas de fórmula quebrada, identificadas por OCI
 * vazio — `linhaReal` é o filtro). Índices de coluna (0 = A):
 *
 *   4  OCI            10 MOTORISTA
 *   5  ORIGEM         11 DATA COLETA (serial Excel — o campo desta consulta)
 *   6  UF origem      12 DATA DESCARGA
 *   7  DESTINO        21 status
 *   8  UF destino     23 VALOR (a coluna Q/16 tem fórmula quebrada; X é a válida)
 *   9  DATA REC. OCI
 *
 * "2026" é a aba VIVA. "2025"/"2024" são histórico — fora do escopo desta
 * primeira versão (ver conversa de 14/08/2026 sobre o Workbook Intelligence
 * Layer, fase 1).
 */

import XLSX from 'xlsx';
import { classificarExcecaoGraph, classificarStatusGraph } from './ClienteGraph';

/**
 * O COMPLEMENTO de cada frase de erro — o que se estava TENTANDO fazer.
 *
 * Ele só aparece na frase quando é honesto (recurso ausente, permissão negada,
 * serviço fora). Numa credencial expirada, `classificarStatusGraph` o descarta
 * de propósito: o token venceu independentemente do que se queria com ele, e
 * subordinar o fato à intenção de quem perguntou é o que produzia
 * "não consegui localizar a planilha" para um 401.
 */
const LOCALIZAR = 'localizar a planilha de cargas';
const LER_ABA = (aba: string): string => `ler a aba "${aba}" da planilha de cargas`;
const BAIXAR = 'baixar o arquivo da planilha de cargas';

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TEMPO_LIMITE_MS = 15_000;

/**
 * O TETO DA LEITURA EM MASSA — e por que não pode ser o mesmo dos metadados.
 *
 * O DEFEITO (produção, 18/08/2026): "quantas cargas estão cadastradas na
 * planilha?" respondeu *"a consulta excedeu o tempo limite e não retornou o
 * resultado"*. A mesma pergunta funcionara minutos antes — a diferença era o
 * cache de 5 min ter expirado, o que troca uma leitura de memória por uma ida
 * à rede.
 *
 * E as idas à rede daqui não são do mesmo tamanho. `driveItem` e `usedRange`
 * devolvem alguns bytes de metadado; `range(address=…)` traz ~2700 linhas × 29
 * colunas, e o caminho de `/content` baixa o ARQUIVO INTEIRO — 22 abas, três
 * anos de operação. Governar as quatro com um teto só significa dimensionar o
 * teto pela chamada leve e cortar a pesada no meio, que foi exatamente o que
 * aconteceu.
 *
 * Sessenta segundos porque a alternativa, para quem pergunta, é não ter
 * resposta: o cache expirado não vira número velho servido como novo (ver
 * `falhaNaLeitura` — essa política fica de pé), vira ausência. Esperar meio
 * minuto por um dado correto é pior que instantâneo e muito melhor que nada.
 */
const TEMPO_LIMITE_LEITURA_MS = 60_000;
const ABA_VIVA = '2026';
/** Linha 1 é cabeçalho; dado real começa na 5 (linhas 2-4 são sub-cabeçalho/resumo). */
const PRIMEIRA_LINHA_DE_DADO = 5;

/**
 * O ANO QUE ESTA LEITURA ALCANÇA — e ele precisa ser dito ao operador.
 *
 * O DEFEITO (18/08/2026). Perguntada quantas cargas existem, a IARA respondeu
 * "2681 cargas no total". São 2681 em 2026. A planilha tem 10.777: as abas
 * "2025" (4031) e "2024" (4065) estão no MESMO arquivo e não são lidas. A
 * procedência interna já carimbava `fonte: '2026'` — o sistema sabia o ano e
 * não contava a quem perguntou.
 *
 * É a classe de erro mais cara que existe aqui: a resposta certa para a
 * pergunta errada. "2681" está correto para 2026 e é falso como total, e o
 * operador não tem como perceber a diferença — ele perguntou "quantas cargas
 * temos" e recebeu um número redondo, com procedência, sem ressalva.
 *
 * Note que trocar de ano NÃO é ligar uma flag: a aba 2026 tem outro mapa de
 * colunas (VALOR na 17; nas antigas, na 25, com um bloco AGENDAMENTO no meio).
 * Ler as antigas com o mapa desta produziria lixo silencioso — que é pior que
 * a recusa. Enquanto esse mapa não existir, a resposta honesta é dizer o que se
 * alcança e o que não.
 */
export const ANO_VIVO = ABA_VIVA;

/**
 * O operador citou um ano que esta leitura não alcança? Devolve o ano citado.
 *
 * Lê a FRASE CRUA, e não o parâmetro `periodo`, porque o caso perigoso é
 * exatamente aquele em que a LLM larga o ano pelo caminho: "quantas cargas em
 * 2025?" vira uma chamada sem período, o universo inteiro de 2026 responde, e
 * o número sai rotulado como se fosse de 2025.
 */
export function anoForaDoAlcance(frase: string): string | null {
  /* Só anos plausíveis de operação. `\b` dos dois lados para não capturar o
     miolo de um número de OCI — "191597" não cita 2015. */
  const achados = frase.match(/\b(20[12]\d)\b/g);
  if (!achados) return null;
  /* O alcance passou a ser TRÊS abas em 19/08/2026. Antes era só o ano vivo, e
     a lista era um `!== ANO_VIVO` — o tipo de comparação que se torna mentira
     silenciosa no dia em que a leitura cresce. */
  const fora = achados.find((a) => !ANOS_LIDOS.includes(a as AnoLido));
  return fora ?? null;
}

/** O ano citado na frase, quando ele é um dos que a leitura alcança. */
export function anoCitado(frase: string): AnoLido | null {
  const achados = frase.match(/\b(20[12]\d)\b/g);
  if (!achados) return null;
  const dentro = achados.find((a) => ANOS_LIDOS.includes(a as AnoLido));
  return (dentro as AnoLido) ?? null;
}

// ---------------------------------------------------------------------------
// Retentativa — só para o que vale a pena repetir
// ---------------------------------------------------------------------------

/**
 * 429 (Graph pedindo pra esperar), 502/503/504 (backend fora do ar por um
 * instante — foi exatamente o que aconteceu em 14/08/2026: o serviço de
 * SESSÃO do Excel Online, não a Graph em si, devolveu
 * `FileOpenHostServiceUnavailable`). 401/403/404 são definitivos — insistir
 * não resolve, só atrasa a resposta que já sabemos que vai falhar.
 */
const HTTP_RETENTAVEL = new Set([429, 502, 503, 504]);
const RETENTATIVAS_MAX = 3;
const RETENTATIVA_BASE_MS = 400;

function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `fetch` com até `RETENTATIVAS_MAX` tentativas para erro transitório (HTTP
 * ou de rede/timeout). Devolve a `Response` da última tentativa (pode não
 * ser `.ok`) ou lança o erro de rede da última tentativa — quem chama
 * continua tratando os dois casos como já tratava, só que agora depois de
 * já ter insistido.
 */
async function fetchComRetentativa(url: string, opts: RequestInit): Promise<Response> {
  for (let tentativa = 1; tentativa <= RETENTATIVAS_MAX; tentativa++) {
    try {
      const resposta = await fetch(url, opts);
      if (resposta.ok || !HTTP_RETENTAVEL.has(resposta.status) || tentativa === RETENTATIVAS_MAX) {
        return resposta;
      }
    } catch (erro) {
      if (tentativa === RETENTATIVAS_MAX) throw erro;
    }
    await esperar(RETENTATIVA_BASE_MS * 2 ** (tentativa - 1));
  }
  // Inalcançável: o laço sempre devolve ou lança na última iteração.
  throw new Error('fetchComRetentativa: estado inalcançável');
}

function token(): string {
  return (process.env.MS_GRAPH_TOKEN ?? '').trim();
}

function urlPlanilha(): string {
  return (process.env.MS_GRAPH_OCI_URL ?? '').trim();
}

export function planilhaOcisDisponivel(): boolean {
  return token().length > 0 && urlPlanilha().length > 0;
}

/** Codifica uma URL de compartilhamento no `shareId` que a Graph aceita em `/shares/{id}`. */
function paraShareId(url: string): string {
  const b64 = Buffer.from(url, 'utf8').toString('base64');
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

interface LocalizacaoItem {
  readonly driveId: string;
  readonly itemId: string;
}

/**
 * Resolvido uma vez por processo e reaproveitado — a URL de compartilhamento
 * não muda a cada chamada, e resolver de novo a cada consulta só custaria
 * uma requisição extra sem ganhar nada. Só fica em memória: falha na
 * resolução não é gravada, então a próxima chamada tenta de novo (a mesma
 * disciplina de `ClienteGraph`: nunca fingir sucesso).
 */
let localizacaoCache: LocalizacaoItem | null = null;

/** Só para teste: sem isto, o cache de um caso vaza pro próximo dentro do mesmo processo. */
export function _esquecerLocalizacaoParaTeste(): void {
  localizacaoCache = null;
}

async function resolverItem(t: string): Promise<{ ok: true; loc: LocalizacaoItem } | { ok: false; motivo: string }> {
  if (localizacaoCache) return { ok: true, loc: localizacaoCache };

  const shareId = paraShareId(urlPlanilha());
  try {
    const resposta = await fetchComRetentativa(
      `${GRAPH}/shares/${shareId}/driveItem?$select=id,parentReference`,
      { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) },
    );
    if (!resposta.ok) {
      /**
       * A CATEGORIA DO ERRO SOBREVIVE. A versão anterior devolvia
       * `Graph recusou localizar a planilha (HTTP 401): {"error":{...}}` — o
       * JSON cru na bolha de chat, e um token expirado descrito como problema
       * de localizar arquivo. Quem lê "não localizei" vai procurar a planilha
       * no SharePoint; o arquivo está lá, o que venceu foi a credencial.
       */
      return { ok: false, motivo: classificarStatusGraph(resposta.status, LOCALIZAR).frase };
    }
    const dados = (await resposta.json()) as { id?: string; parentReference?: { driveId?: string } };
    if (!dados.id || !dados.parentReference?.driveId) {
      return { ok: false, motivo: 'A Graph respondeu sem o id da planilha — resposta inesperada, não é falta de acesso.' };
    }
    localizacaoCache = { driveId: dados.parentReference.driveId, itemId: dados.id };
    return { ok: true, loc: localizacaoCache };
  } catch (erro) {
    return { ok: false, motivo: classificarExcecaoGraph(erro, LOCALIZAR).frase };
  }
}

async function lerRange(
  t: string,
  loc: LocalizacaoItem,
  aba: string,
  endereco: string,
): Promise<{ ok: true; valores: unknown[][] } | { ok: false; motivo: string }> {
  const caminho =
    `${GRAPH}/drives/${loc.driveId}/items/${loc.itemId}/workbook/worksheets('${encodeURIComponent(aba)}')` +
    `/range(address='${endereco}')?$select=values`;
  try {
    /* Leitura em massa: ~2700 linhas × 29 colunas. Teto próprio — ver
       `TEMPO_LIMITE_LEITURA_MS`. */
    const resposta = await fetchComRetentativa(caminho, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_LEITURA_MS),
    });
    if (!resposta.ok) {
      return { ok: false, motivo: classificarStatusGraph(resposta.status, LER_ABA(aba)).frase };
    }
    const dados = (await resposta.json()) as { values?: unknown[][] };
    return { ok: true, valores: dados.values ?? [] };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
  }
}

/**
 * FALLBACK — baixa o `.xlsx` bruto e lê localmente. Existe porque o erro que
 * derrubou a leitura em 14/08/2026 não veio da Graph: veio do serviço de
 * SESSÃO do Excel Online (`FileOpenHostServiceUnavailable`), que a API de
 * range acima depende e este caminho não. `/content` é download de arquivo
 * comum — mesma confiabilidade de baixar qualquer arquivo do SharePoint.
 *
 * Só entra em jogo depois que `buscarLinhasReais` já tentou a API (com
 * retentativa) e falhou de verdade — nunca é o caminho padrão, por custar
 * mais banda (o arquivo inteiro, ~2 MB, em vez de um range seletivo).
 */
async function baixarEParsearArquivo(
  t: string,
  loc: LocalizacaoItem,
  aba: AnoLido = ABA_VIVA,
): Promise<{ ok: true; linhas: unknown[][] } | { ok: false; motivo: string }> {
  try {
    const resposta = await fetchComRetentativa(
      `${GRAPH}/drives/${loc.driveId}/items/${loc.itemId}/content`,
      /* Baixa o ARQUIVO INTEIRO — 22 abas, três anos. É a chamada mais pesada
         do módulo; teto próprio, ver `TEMPO_LIMITE_LEITURA_MS`. */
      { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_LEITURA_MS) },
    );
    if (!resposta.ok) {
      return { ok: false, motivo: classificarStatusGraph(resposta.status, BAIXAR).frase };
    }
    const buffer = Buffer.from(await resposta.arrayBuffer());
    const pasta = XLSX.read(buffer, { type: 'buffer' });
    const folha = pasta.Sheets[aba];
    if (!folha) return { ok: false, motivo: `o arquivo baixado não tem a aba "${aba}"` };

    // `raw: true` mantém data como serial numérico (igual a Graph) em vez de
    // converter para `Date` — as duas fontes precisam produzir o MESMO
    // formato pra `paraCarga`/`paraCargaCompleta` funcionarem sem saber qual
    // caminho as trouxe.
    const todasAsLinhas = XLSX.utils.sheet_to_json<unknown[]>(folha, { header: 1, raw: true, defval: '' });
    const linhas = todasAsLinhas.slice(PRIMEIRA_LINHA_DE_DADO - 1);
    return { ok: true, linhas };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
  }
}

const letraColuna = (n: number): string => String.fromCharCode(65 + n);

/** De onde as linhas vieram — auditável em `fonte.via`, sem aparecer na resposta ao operador. */
export type ViaLeitura = 'api' | 'download';

/**
 * O par usedRange → range(A{PRIMEIRA_LINHA_DE_DADO}:...) que tanto
 * `cargasNoPeriodo` quanto `todasAsCargas` precisam. Extraído para não haver
 * dois lugares reimplementando a mesma leitura de forma sutilmente diferente.
 */
async function buscarLinhasReaisViaApi(
  t: string,
  loc: LocalizacaoItem,
  aba: AnoLido = ABA_VIVA,
): Promise<{ ok: true; linhas: unknown[][] } | { ok: false; motivo: string }> {
  const enc = encodeURIComponent(aba);
  const dimensoes = await fetchComRetentativa(
    `${GRAPH}/drives/${loc.driveId}/items/${loc.itemId}/workbook/worksheets('${enc}')` +
      `/usedRange?$select=address,rowCount,columnCount`,
    { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) },
  ).catch((erro: Error) => erro);
  if (dimensoes instanceof Error) {
    return { ok: false, motivo: `Não consegui ler o tamanho da aba "${aba}": ${dimensoes.message}` };
  }
  if (!dimensoes.ok) {
    const corpo = await dimensoes.text().catch(() => '');
    return { ok: false, motivo: `Graph recusou o tamanho da aba "${aba}" (HTTP ${dimensoes.status}): ${corpo.slice(0, 200)}` };
  }
  const { rowCount, columnCount } = (await dimensoes.json()) as { rowCount: number; columnCount: number };
  if (rowCount < PRIMEIRA_LINHA_DE_DADO) return { ok: true, linhas: [] };

  const endereco = `A${PRIMEIRA_LINHA_DE_DADO}:${letraColuna(columnCount - 1)}${rowCount}`;
  const dados = await lerRange(t, loc, aba, endereco);
  if (!dados.ok) return { ok: false, motivo: dados.motivo };

  return { ok: true, linhas: dados.valores.filter(linhaReal) };
}

/**
 * A leitura de verdade: API primeiro (com retentativa já embutida em cada
 * chamada). SÓ se ela falhar de ponta a ponta é que cai pro download bruto —
 * automático, sem o operador perceber qual caminho respondeu. Se os DOIS
 * falharem, o motivo reportado é o da API (é o caminho padrão, e é o que
 * quem for investigar precisa ver primeiro); o motivo do download fica só
 * no log técnico, para não empilhar dois parágrafos de erro na resposta.
 */
async function buscarLinhasReais(
  t: string,
  loc: LocalizacaoItem,
  aba: AnoLido = ABA_VIVA,
): Promise<{ ok: true; linhas: unknown[][]; via: ViaLeitura } | { ok: false; motivo: string }> {
  const viaApi = await buscarLinhasReaisViaApi(t, loc, aba);
  if (viaApi.ok) return { ok: true, linhas: viaApi.linhas, via: 'api' };

  const viaDownload = await baixarEParsearArquivo(t, loc, aba);
  if (viaDownload.ok) {
    const linhas = viaDownload.linhas.filter(linhaReal);
    console.warn(
      `[iara] planilha LUFT: API falhou (${viaApi.motivo}) — respondeu via download bruto do arquivo, sem interrupção para o operador.`,
    );
    return { ok: true, linhas, via: 'download' };
  }

  return { ok: false, motivo: viaApi.motivo };
}

/** Serial de data do Excel (dias desde 1899-12-30) -> "AAAA-MM-DD". O valor é um dia civil puro, sem fuso envolvido. */
function serialParaISO(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

export interface Carga {
  readonly oci: string;
  readonly origem: string;
  readonly uf_origem: string;
  readonly destino: string;
  readonly uf_destino: string;
  readonly motorista: string;
  readonly data_coleta: string; // AAAA-MM-DD
  readonly status: string;
  readonly valor: number | null;
}

/** Uma linha é dado real quando tem número de OCI. As linhas de fórmula quebrada no fim do range não têm. */
function linhaReal(linha: readonly unknown[]): boolean {
  const oci = linha[4];
  return oci !== '' && oci !== undefined && oci !== null;
}

function paraCarga(linha: readonly unknown[]): Carga | null {
  const dataColetaSerial = linha[11];
  if (typeof dataColetaSerial !== 'number') return null; // sem data de coleta marcada
  const valorBruto = linha[23];
  return {
    oci: String(linha[4]),
    origem: String(linha[5] ?? ''),
    uf_origem: String(linha[6] ?? ''),
    destino: String(linha[7] ?? ''),
    uf_destino: String(linha[8] ?? ''),
    motorista: String(linha[10] ?? ''),
    data_coleta: serialParaISO(dataColetaSerial),
    status: String(linha[21] ?? ''),
    valor: typeof valorBruto === 'number' ? valorBruto : null,
  };
}

/**
 * Cargas cuja DATA COLETA cai em `[inicioISO, fimISO]` (inclusive, "AAAA-MM-DD").
 * Um único dia é `inicioISO === fimISO`.
 */
export async function cargasNoPeriodo(
  inicioISO: string,
  fimISO: string,
): Promise<{ ok: boolean; texto: string; cargas: Carga[] }> {
  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — planilha de cargas desligada.', cargas: [] };
  if (!urlPlanilha()) {
    return { ok: false, texto: 'MS_GRAPH_OCI_URL não configurado — não sei qual planilha ler.', cargas: [] };
  }

  const loc = await resolverItem(t);
  /* O motivo JÁ é uma frase completa e com o sujeito certo — prefixar aqui com
     "não consegui localizar a planilha" era o que transformava um token expirado
     em problema de arquivo sumido. Ver `classificarStatusGraph`. */
  if (!loc.ok) return { ok: false, texto: loc.motivo, cargas: [] };

  const resultado = await buscarLinhasReais(t, loc.loc);
  if (!resultado.ok) return { ok: false, texto: resultado.motivo, cargas: [] };

  const cargas = resultado.linhas
    .map(paraCarga)
    .filter((c): c is Carga => c !== null)
    .filter((c) => c.data_coleta >= inicioISO && c.data_coleta <= fimISO)
    .sort((a, b) => a.data_coleta.localeCompare(b.data_coleta));

  if (cargas.length === 0) {
    return { ok: true, texto: 'Nenhuma carga com coleta marcada nesse período.', cargas: [] };
  }

  const LIMITE_LISTA = 25;
  const linhas = cargas
    .slice(0, LIMITE_LISTA)
    .map(
      (c) =>
        `• OCI ${c.oci} — ${c.origem}/${c.uf_origem} → ${c.destino}/${c.uf_destino}` +
        `${c.motorista ? `, ${c.motorista}` : ''}${c.status ? ` (${c.status})` : ''}`,
    );
  const resto = cargas.length > LIMITE_LISTA ? `\n… e mais ${cargas.length - LIMITE_LISTA}.` : '';

  return {
    ok: true,
    texto: `${cargas.length} carga${cargas.length === 1 ? '' : 's'}:\n${linhas.join('\n')}${resto}`,
    cargas,
  };
}

// ---------------------------------------------------------------------------
// Todas as cargas cadastradas — fase 2 do Workbook Intelligence Layer
// ---------------------------------------------------------------------------

/**
 * Diferente de `Carga`: aqui `data_coleta` (e as outras datas) podem ser
 * `null`. "Cadastrada" e "coletada" são estados DIFERENTES — uma OCI pode
 * estar cadastrada sem coleta marcada ainda, e uma pergunta como "quantas
 * cargas existem cadastradas" precisa dessas linhas também, não só das que
 * `cargasNoPeriodo` enxerga.
 */
/**
 * O status BRUTO tem pelo menos três grafias para "finalizado"
 * (`FINALIZADO`, `finalizado`, `FINALIZADA`) e pelo menos um código sem
 * significado conhecido (`"7"`, achado em auditoria contra o tenant real em
 * 14/08/2026). `DESCONHECIDO` é o valor para QUALQUER coisa não mapeada
 * explicitamente — nunca um palpite. Ver `normalizarStatus`.
 */
export type StatusNormalizado = 'FINALIZADO' | 'PAGO' | 'SEM_STATUS' | 'DESCONHECIDO';

/** Só grafias CONFIRMADAS contra o dado real. Um código novo entra como DESCONHECIDO até alguém provar o que significa. */
const MAPA_STATUS: Readonly<Record<string, StatusNormalizado>> = {
  FINALIZADO: 'FINALIZADO',
  FINALIZADA: 'FINALIZADO',
  PAGO: 'PAGO',
};

/**
 * `bruto` nunca é descartado — quem quiser o texto original da célula
 * continua tendo `CargaCompleta.status`. Isto só decide em qual BALDE a
 * linha cai para fins de contagem/agrupamento, sem apagar a evidência.
 */
export function normalizarStatus(bruto: string): StatusNormalizado {
  const limpo = bruto.trim();
  if (!limpo) return 'SEM_STATUS';
  return MAPA_STATUS[limpo.toUpperCase()] ?? 'DESCONHECIDO';
}

export interface CargaCompleta {
  /**
   * De qual ABA esta carga veio. Existe desde 19/08/2026, quando a leitura
   * deixou de ser só de 2026.
   *
   * NÃO é derivável da data de coleta: uma OCI recebida em dezembro e coletada
   * em janeiro mora na aba do ano em que foi cadastrada. A aba é o fato; a data
   * é outro campo. Confundir os dois faria a contagem por ano discordar da
   * planilha que a operadora abre na tela — e a planilha vence sempre.
   */
  readonly ano: AnoLido;
  readonly oci: string;
  readonly origem: string;
  readonly uf_origem: string;
  readonly destino: string;
  readonly uf_destino: string;
  readonly motorista: string;
  readonly data_rec_oci: string | null;
  readonly data_coleta: string | null;
  readonly data_descarga: string | null;
  /** O texto exatamente como está na célula. Nunca reescrito. */
  readonly status: string;
  /** `status` classificado em `StatusNormalizado`. Ver `normalizarStatus`. */
  readonly status_normalizado: StatusNormalizado;
  readonly valor: number | null;
}

function serialOuNulo(v: unknown): string | null {
  return typeof v === 'number' ? serialParaISO(v) : null;
}

/**
 * ONDE CADA ANO GUARDA O QUE MUDA DE LUGAR — medido no arquivo real em
 * 19/08/2026 por `testes/gate/mapear-abas.mjs`.
 *
 * O COMENTÁRIO QUE BLOQUEOU ISSO POR TRÊS MESES dizia que as abas antigas têm
 * "outro desenho de colunas", e a frase virou o motivo de a IARA recusar
 * qualquer pergunta sobre 2025. Medido, o desenho é quase o MESMO: OCI (4),
 * ORIGEM (5), UF (6), DESTINO (7), UF (8), DATA REC. OCI (9), MOTORISTA (10),
 * DATA COLETA (11) e DATA DESCARGA (12) estão nos mesmos índices nas três abas.
 *
 * Diverge só o que está DEPOIS do bloco AGENDAMENTO, que existe em 2025/2024
 * (colunas 13–20: POSTOS, CENTRAL, TAC) e não existe em 2026:
 *
 *              2026      2025 / 2024
 *   VALOR      23 (X)    24 (Y)
 *   status     21 (V)    não existe — ali fica DATA ENV. OCI
 *
 * `status: null` NÃO é "status vazio": é a coluna não existir. Uma carga de
 * 2024 não tem status desconhecido, ela tem status inexistente — e chamar as
 * duas coisas de `SEM_STATUS` faria a IARA responder "2500 cargas sem status
 * preenchido" para um ano em que ninguém deixou de preencher nada.
 */
export const ANOS_LIDOS = ['2026', '2025', '2024'] as const;
export type AnoLido = (typeof ANOS_LIDOS)[number];

interface MapaDaAba {
  /**
   * O ÍNDICE DA COLUNA "VALOR" — que EXISTE nas três abas e só tem dado em uma.
   *
   * Em 2025 e 2024 o cabeçalho está lá, na coluna 24, e a coluna está vazia (1
   * de 4.030 e 11 de 4.064, medido em 20/08/2026). Manter o índice mapeado é
   * correto: a coluna é aquela mesmo, e no dia em que a operadora preencher, a
   * leitura já funciona. Quem decide se dá para responder é `lacunaDeValor`,
   * que mede o preenchimento REAL do recorte em vez de confiar no cabeçalho.
   */
  readonly valor: number;
  /** `null` quando a aba não tem a coluna. Ver o comentário acima. */
  readonly status: number | null;
}

const MAPA_DA_ABA: Readonly<Record<AnoLido, MapaDaAba>> = {
  '2026': { valor: 23, status: 21 },
  '2025': { valor: 24, status: null },
  '2024': { valor: 24, status: null },
};

function paraCargaCompleta(linha: readonly unknown[], ano: AnoLido = ABA_VIVA): CargaCompleta {
  const mapa = MAPA_DA_ABA[ano];
  const valorBruto = linha[mapa.valor];
  const statusBruto = mapa.status === null ? '' : String(linha[mapa.status] ?? '').trim();
  return {
    ano,
    oci: String(linha[4]),
    origem: String(linha[5] ?? ''),
    uf_origem: String(linha[6] ?? ''),
    destino: String(linha[7] ?? ''),
    uf_destino: String(linha[8] ?? ''),
    motorista: String(linha[10] ?? '').trim(),
    data_rec_oci: serialOuNulo(linha[9]),
    data_coleta: serialOuNulo(linha[11]),
    data_descarga: serialOuNulo(linha[12]),
    status: statusBruto,
    status_normalizado: normalizarStatus(statusBruto),
    valor: typeof valorBruto === 'number' ? valorBruto : null,
  };
}

/** 5 minutos: a planilha não muda a cada segundo, e cada renovação custa uma leitura de ~2600 linhas. */
const CACHE_TODAS_TTL_MS = 5 * 60 * 1000;
let cacheTodas: { cargas: readonly CargaCompleta[]; buscadoEm: number; via: ViaLeitura } | null = null;

/** Só para teste: mesma razão de `_esquecerLocalizacaoParaTeste`. */
export function _esquecerCacheTodasParaTeste(): void {
  cacheTodas = null;
}

/**
 * Só para teste: envelhece o cache além do TTL SEM apagá-lo — é o único jeito
 * de testar "falha com cache velho disponível" sem esperar 5 minutos de
 * verdade. `_esquecerCacheTodasParaTeste` apaga; esta função só faz o tempo
 * passar.
 */
export function _expirarCacheTodasParaTeste(): void {
  if (cacheTodas) cacheTodas = { ...cacheTodas, buscadoEm: Date.now() - CACHE_TODAS_TTL_MS - 1000 };
}

/**
 * De onde veio o dado devolvido — para quem consome nunca confundir "fresco"
 * com "velho". `null` só quando não há cargas nenhuma pra reportar (falha
 * sem cache anterior disponível).
 */
export interface FonteDados {
  readonly cache: boolean;
  readonly buscado_em: string; // ISO
  readonly idade_s: number;
  /** Qual caminho de leitura respondeu — a API (padrão) ou o download bruto (fallback automático). */
  readonly via: ViaLeitura;
}

function fonteDe(buscadoEmMs: number, deCache: boolean, via: ViaLeitura): FonteDados {
  return {
    cache: deCache,
    buscado_em: new Date(buscadoEmMs).toISOString(),
    idade_s: Math.max(0, Math.round((Date.now() - buscadoEmMs) / 1000)),
    via,
  };
}

function formatarIdade(segundos: number): string {
  if (segundos < 60) return `${segundos}s`;
  const min = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return resto > 0 ? `${min}min ${resto}s` : `${min}min`;
}

type ResultadoTodasAsCargas = {
  ok: boolean;
  texto: string;
  cargas: readonly CargaCompleta[];
  fonte: FonteDados | null;
};

/**
 * Falha na leitura NUNCA serve o cache velho DISFARÇADO de dado atual — mas
 * também não é obrigada a jogar fora a única informação que tem. Se existe
 * cache anterior, a mensagem DIZ que não conseguiu atualizar e diz a idade
 * do último dado válido; `cargas` continua vazio e `ok` continua `false`,
 * porque quem pergunta "quantas cargas temos" quer um número CONFIÁVEL
 * AGORA, não um número velho sem aviso.
 */
function falhaNaLeitura(motivoBase: string): ResultadoTodasAsCargas {
  if (!cacheTodas) return { ok: false, texto: motivoBase, cargas: [], fonte: null };
  const idadeS = Math.round((Date.now() - cacheTodas.buscadoEm) / 1000);
  return {
    ok: false,
    texto: `${motivoBase} O último dado válido disponível é de ${formatarIdade(idadeS)} atrás — não uso um número velho como se fosse atual.`,
    cargas: [],
    fonte: fonteDe(cacheTodas.buscadoEm, true, cacheTodas.via),
  };
}

/**
 * TODAS as cargas cadastradas na aba "2026" — cadastradas, não só coletadas.
 * Cacheado 5 min em memória do processo: as habilidades de estatística
 * (contagem, ranking, soma) tendem a ser pedidas em sequência numa mesma
 * conversa, e reler ~2600 linhas a cada pergunta seria custo sem ganho.
 *
 * Falha NUNCA usa o cache velho para fingir sucesso — ver `falhaNaLeitura`.
 */
export async function todasAsCargas(): Promise<ResultadoTodasAsCargas> {
  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — planilha de cargas desligada.', cargas: [], fonte: null };
  if (!urlPlanilha()) {
    return { ok: false, texto: 'MS_GRAPH_OCI_URL não configurado — não sei qual planilha ler.', cargas: [], fonte: null };
  }

  if (cacheTodas && Date.now() - cacheTodas.buscadoEm < CACHE_TODAS_TTL_MS) {
    return {
      ok: true,
      texto: `${cacheTodas.cargas.length} cargas cadastradas.`,
      cargas: cacheTodas.cargas,
      fonte: fonteDe(cacheTodas.buscadoEm, true, cacheTodas.via),
    };
  }

  const loc = await resolverItem(t);
  if (!loc.ok) return falhaNaLeitura(loc.motivo);

  const resultado = await buscarLinhasReais(t, loc.loc);
  if (!resultado.ok) return falhaNaLeitura(`${resultado.motivo}.`);

  const cargas = resultado.linhas.map((l) => paraCargaCompleta(l));
  const buscadoEm = Date.now();
  cacheTodas = { cargas, buscadoEm, via: resultado.via };
  return { ok: true, texto: `${cargas.length} cargas cadastradas.`, cargas, fonte: fonteDe(buscadoEm, false, resultado.via) };
}

/**
 * AS ABAS ANTIGAS — 2025 e 2024, que existem no mesmo arquivo.
 *
 * O QUE BLOQUEAVA ISSO POR TRÊS MESES era um comentário afirmando que as abas
 * antigas têm "outro desenho de colunas (VALOR na 17; nas antigas, na 25)".
 * Medido em 19/08/2026 por `testes/gate/mapear-abas.mjs`, o desenho é quase o
 * MESMO: OCI, origem, destino, motorista e as três datas estão nos mesmos
 * índices nos três anos. Diverge só o que vem depois do bloco AGENDAMENTO —
 * VALOR (23 contra 24) e status (existe em 2026, não existe nas antigas). E
 * nenhum dos números do comentário existia na planilha.
 *
 * O bloqueio era muito maior que o obstáculo: ler as antigas custa um mapa de
 * duas linhas por ano, que é o que `MAPA_DA_ABA` guarda.
 *
 * CACHE POR ANO, e não um só: 2026 muda o dia inteiro e as antigas não mudam
 * mais. Um cache compartilhado obrigaria a reler três abas para atualizar uma.
 */
const cachePorAno = new Map<AnoLido, { cargas: readonly CargaCompleta[]; buscadoEm: number; via: ViaLeitura }>();

export function _esquecerCachePorAnoParaTeste(): void {
  cachePorAno.clear();
}

/**
 * As cargas de UM ano. Para o ano vivo delega a `todasAsCargas`, que já tem o
 * cache quente que o resto do sistema usa — dois caminhos para a mesma aba
 * dariam dois números para a mesma pergunta conforme quem perguntou primeiro.
 */
export async function cargasDoAno(ano: AnoLido): Promise<ResultadoTodasAsCargas> {
  if (ano === ABA_VIVA) return todasAsCargas();

  const t = token();
  if (!t) return { ok: false, texto: 'MS_GRAPH_TOKEN não configurado — planilha de cargas desligada.', cargas: [], fonte: null };
  if (!urlPlanilha()) {
    return { ok: false, texto: 'MS_GRAPH_OCI_URL não configurado — não sei qual planilha ler.', cargas: [], fonte: null };
  }

  const emCache = cachePorAno.get(ano);
  /* Ano fechado não muda: uma hora de cache, contra os 5 min do ano vivo. */
  if (emCache && Date.now() - emCache.buscadoEm < 60 * 60 * 1000) {
    return {
      ok: true,
      texto: `${emCache.cargas.length} cargas em ${ano}.`,
      cargas: emCache.cargas,
      fonte: fonteDe(emCache.buscadoEm, true, emCache.via),
    };
  }

  const loc = await resolverItem(t);
  if (!loc.ok) return { ok: false, texto: loc.motivo, cargas: [], fonte: null };

  const resultado = await buscarLinhasReais(t, loc.loc, ano);
  if (!resultado.ok) return { ok: false, texto: `${resultado.motivo}.`, cargas: [], fonte: null };

  const cargas = resultado.linhas.map((l) => paraCargaCompleta(l, ano));
  const buscadoEm = Date.now();
  cachePorAno.set(ano, { cargas, buscadoEm, via: resultado.via });
  return {
    ok: true,
    texto: `${cargas.length} cargas em ${ano}.`,
    cargas,
    fonte: fonteDe(buscadoEm, false, resultado.via),
  };
}

// ---------------------------------------------------------------------------
// O TABELÁRIO DE TRECHOS — a aba "TABELA", que é de onde vem o custo
// ---------------------------------------------------------------------------

/**
 * O preço de um trecho. É o que a `TABELA` guarda por `origem → destino`.
 *
 * `valor_logistico` é o preço de tabela e `valor_motorista` é o que se paga a
 * quem dirige — a diferença entre os dois é a margem. Medido em 19/08/2026: o
 * `valor` de cada carga é IDÊNTICO ao `valor_logistico` do trecho em 2687 de
 * 2687 cargas com valor. Mesmo assim a receita é lida da CARGA e não daqui: é o
 * que foi de fato faturado, e no dia em que alguém editar uma carga a margem
 * daquela carga tem de mudar.
 *
 * As duas margens DECLARADAS vêm junto de propósito. Elas são o oráculo interno
 * do tabelário: se a conta feita a partir das colunas divergir do que a planilha
 * já traz pronto, quem está errado é o código — e `margem-operacional.test.ts`
 * cobra isso.
 */
export interface PrecoDoTrecho {
  readonly origem: string;
  readonly destino: string;
  readonly valor_motorista: number;
  readonly valor_logistico: number;
  /** O que a coluna "MARGEM COM PEDAGIO" usa. Medido: IDA, nunca ida+volta. */
  readonly pedagio_ida: number;
  readonly pedagio_ida_volta: number;
  readonly margem_bruta_declarada: number;
  readonly margem_com_pedagio_declarada: number;
}

export interface TabelaDeTrechos {
  readonly preco: ReadonlyMap<string, PrecoDoTrecho>;
  /**
   * Trechos com DUAS linhas de preços diferentes. Hoje são zero — e é por isso
   * que o conjunto precisa existir: para o dia em que deixarem de ser. Escolher
   * uma das duas seria inventar a margem daquele trecho.
   */
  readonly ambiguas: ReadonlySet<string>;
}

/**
 * A CHAVE DO CRUZAMENTO. Só formatação é normalizada — trim, caixa, espaço
 * duplo, acento. Nada de distância de edição, nada de prefixo: "POSTO A" nunca
 * vira "POSTO B" por parecer.
 *
 * Medido em 19/08/2026: com esta chave, 100% das rotas de 2026 casam de forma
 * EXATA (`NORMALIZED_EXACT` = 0 nos três anos). A normalização não foi nem
 * necessária — ela fica como rede de proteção contra um espaço a mais digitado
 * amanhã, não como ponte sobre nomes diferentes.
 */
export function chaveDoTrecho(origem: string, destino: string): string {
  const n = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  return `${n(origem)} > ${n(destino)}`;
}

const ABA_TABELA = 'TABELA';
/** Índices medidos por `testes/gate/mapear-abas.mjs` em 19/08/2026. */
const COL_TABELA = {
  origem: 2,
  destino: 3,
  mot: 4,
  log: 5,
  pedagioIdaVolta: 6,
  ida: 7,
  margemBruta: 8,
  margemPedagio: 9,
} as const;

function paraTabela(linhas: readonly unknown[][]): TabelaDeTrechos {
  const preco = new Map<string, PrecoDoTrecho>();
  const ambiguas = new Set<string>();
  const num = (v: unknown) => (typeof v === 'number' ? v : 0);

  for (const l of linhas) {
    const origem = String(l[COL_TABELA.origem] ?? '').trim();
    const destino = String(l[COL_TABELA.destino] ?? '').trim();
    if (!origem || !destino) continue;
    const k = chaveDoTrecho(origem, destino);
    const p: PrecoDoTrecho = {
      origem,
      destino,
      valor_motorista: num(l[COL_TABELA.mot]),
      valor_logistico: num(l[COL_TABELA.log]),
      pedagio_ida: num(l[COL_TABELA.ida]),
      pedagio_ida_volta: num(l[COL_TABELA.pedagioIdaVolta]),
      margem_bruta_declarada: num(l[COL_TABELA.margemBruta]),
      margem_com_pedagio_declarada: num(l[COL_TABELA.margemPedagio]),
    };
    const antigo = preco.get(k);
    if (!antigo) {
      preco.set(k, p);
    } else if (antigo.valor_motorista !== p.valor_motorista || antigo.valor_logistico !== p.valor_logistico) {
      ambiguas.add(k);
    }
  }
  return { preco, ambiguas };
}

/**
 * Trinta minutos, e não cinco como o das cargas: preço de trecho muda por
 * negociação, não por operação do dia. A coluna "ALTERAÇÃO LOG" da própria
 * planilha mostra datas de meses atrás.
 */
const CACHE_TABELA_TTL_MS = 30 * 60 * 1000;
let cacheTabela: { tabela: TabelaDeTrechos; buscadoEm: number } | null = null;

export function _esquecerCacheTabelaParaTeste(): void {
  cacheTabela = null;
}

export interface ResultadoTabela {
  readonly ok: boolean;
  readonly texto: string;
  readonly tabela: TabelaDeTrechos;
}

const TABELA_VAZIA: TabelaDeTrechos = { preco: new Map(), ambiguas: new Set() };

/**
 * Lê a aba `TABELA`. São 117 linhas — ordens de grandeza menor que a aba de
 * cargas, então vai direto pelo `range` da API sem o caminho de download.
 */
export async function tabelaDeTrechos(): Promise<ResultadoTabela> {
  const t = token();
  if (!t || !urlPlanilha()) {
    return { ok: false, texto: 'planilha de cargas desligada — sem tabelário de trechos.', tabela: TABELA_VAZIA };
  }
  if (cacheTabela && Date.now() - cacheTabela.buscadoEm < CACHE_TABELA_TTL_MS) {
    return { ok: true, texto: `${cacheTabela.tabela.preco.size} trechos com preço.`, tabela: cacheTabela.tabela };
  }

  const loc = await resolverItem(t);
  if (!loc.ok) return { ok: false, texto: loc.motivo, tabela: TABELA_VAZIA };

  /* A aba tem 117 linhas de dado e 18 colunas; A1:R400 cobre com folga o
     crescimento de anos sem virar leitura pesada. */
  const dados = await lerRange(t, loc.loc, ABA_TABELA, 'A2:R400');
  if (!dados.ok) return { ok: false, texto: dados.motivo, tabela: TABELA_VAZIA };

  const tabela = paraTabela(dados.valores);
  if (tabela.preco.size === 0) {
    return { ok: false, texto: `a aba "${ABA_TABELA}" veio sem nenhum trecho legível.`, tabela: TABELA_VAZIA };
  }
  cacheTabela = { tabela, buscadoEm: Date.now() };
  return { ok: true, texto: `${tabela.preco.size} trechos com preço.`, tabela };
}

// ---------------------------------------------------------------------------
// Agregação — a parte "cálculo" do Analytics Engine, pura e sem I/O
// ---------------------------------------------------------------------------

export type AgruparPor = 'motorista' | 'rota' | 'origem' | 'destino' | 'status' | 'status_normalizado' | 'nenhum';

export interface GrupoAgregado {
  readonly chave: string;
  readonly contagem: number;
  readonly valor_total: number;
  /**
   * Quantas cargas do grupo TÊM valor. Existe para a média poder estar certa.
   *
   * `valor_total / contagem` trata a carga sem valor como uma carga de zero
   * reais e puxa o ticket médio para baixo. Com este campo, a média é sobre o
   * que existe — e quem responde pode dizer quantas ficaram de fora, em vez de
   * escondê-las no divisor.
   */
  readonly com_valor: number;
}

// ---------------------------------------------------------------------------
// A semântica de COUNT — três operações que não são a mesma
// ---------------------------------------------------------------------------

/**
 * AUSÊNCIA, E SÓ AUSÊNCIA — nada de sentinela por heurística.
 *
 * MEDIDO NA FONTE REAL (18/08/2026, aba 2026, 2681 linhas): a única forma de
 * ausência de motorista é a célula vazia — 129 casos. Não existe "N/A", não
 * existe "-", não existe "SEM MOTORISTA". Ensinar o sistema a tratar esses
 * textos como ausência seria inventar uma regra que a fonte não pede, e o preço
 * seria transformar um nome legítimo em vazio no dia em que alguém se chamar
 * assim. Se a fonte mudar, a medição volta e a regra muda com evidência.
 */
export function dimensaoAusente(v: string | null | undefined): boolean {
  return v === null || v === undefined || v.trim() === '';
}

/**
 * A MESMA PESSOA EM VEÍCULOS DIFERENTES — a identidade do motorista.
 *
 * O DEFEITO (operadora, 19/08/2026): *"não analiso que em 2026 tivemos 76
 * motoristas diferentes; LINO está numa linha e LINEALDO em outra, são a mesma
 * pessoa"*. Ela estava certa, e a causa medida na aba 2026 é estrutural: a
 * coluna MOTORISTA carrega **nome + veículo + tag de pedágio**.
 *
 *   CARLOS ANEVTON                            24 cargas
 *   CARLOS ANEVTON - GRO4761                   1
 *   CARLOS ANEVTON - GRO4761 (SEM PARAR)       4
 *   CARLOS ANEVTON - QHI4C04 ( CONECT CAR )    1
 *   CARLOS ANEVTON - QHI4C04 (CONECTCAR)      14
 *
 * Uma pessoa, cinco linhas de contagem. O mesmo vale para `MOLINA - IMN7071`,
 * `LUCAS - PYN` (39 cargas!), `SERGIO - SEM PARAR` (27), `WILIS - SEM PARAR`.
 *
 * DUAS NATUREZAS, DOIS TRATAMENTOS — e a distinção é o que impede esta função
 * de virar o defeito que ela conserta:
 *
 *  1. ESTRUTURAL. O que vem depois de " - " e o que está entre parênteses é
 *     anotação de veículo, não nome. Removê-lo é ler o formato, não adivinhar
 *     semelhança.
 *
 *  2. DECLARADO. `CLAUDINEI DE SOUZA`, `LOURENCO SAMPAIO`, `JAIRO GMK` e
 *     `CLEITON LAUDIR` não têm marca estrutural nenhuma — só quem conhece a
 *     operação sabe que são as mesmas pessoas de `CLAUDINEI`, `LOURENCO`,
 *     `JAIRO` e `CLEITON`. Ficam num mapa escrito à mão, confirmado pela
 *     operadora.
 *
 * POR QUE NÃO SEMELHANÇA. `LUIZ ANTONIO` (5 cargas) e `LUIZ PAULO` (88) têm o
 * mesmo primeiro nome e são pessoas DIFERENTES. Qualquer regra por prefixo ou
 * distância de edição as fundiria — e sumir com uma pessoa real é pior que
 * contá-la duas vezes. Nome novo que apareça sem marca estrutural continua
 * sendo pessoa nova até alguém declarar o contrário.
 */
const IDENTIDADE_DECLARADA: Readonly<Record<string, string>> = {
  'CLAUDINEI DE SOUZA': 'CLAUDINEI',
  'LOURENCO SAMPAIO': 'LOURENCO',
  'JAIRO GMK': 'JAIRO',
  'CLEITON LAUDIR': 'CLEITON',
};

export function identidadeDeMotorista(bruto: string): string {
  const semAcento = bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase();
  /* Parênteses primeiro: "(SEM PARAR)", "( CONECT CAR )", "(CONECTCAR)". */
  const semParenteses = semAcento.replace(/\([^)]*\)/g, ' ');
  /* Depois o que vem após " - ": placa, prefixo de placa ou nome de tag. O
     espaço em volta do hífen é o que separa anotação de nome composto — um
     "JEAN-PAULO" não tem espaços e sobrevive inteiro. */
  const semVeiculo = semParenteses.split(/\s+-\s+/)[0];
  const limpo = semVeiculo.replace(/\s+/g, ' ').trim();
  return IDENTIDADE_DECLARADA[limpo] ?? limpo;
}

/**
 * CONTAR GRUPOS NÃO É CONTAR ENTIDADES — o defeito DIST-002.
 *
 * `agregarCargas(cargas, 'motorista')` devolve um grupo por motorista MAIS um
 * grupo "(sem motorista)", porque uma listagem precisa mostrar as cargas órfãs
 * — some-las seria pior. Mas quem pergunta "quantos motoristas temos?" não está
 * perguntando quantos grupos existem: ausência não é uma pessoa.
 *
 * Medido na planilha real: 73 motoristas e 74 grupos, porque 130 cargas estão
 * sem motorista. A resposta 74 é plausível o bastante para ninguém conferir —
 * e esse é exatamente o perfil de erro mais caro desta auditoria.
 *
 * NÃO é `grupos.length - 1`. Aquilo seria um atalho que quebra quando não há
 * ausência nenhuma (74 vira 72) e que não sabe dizer QUANTAS ficaram de fora.
 * Aqui a distinção é feita na origem, sobre o dado.
 */
export interface ContagemDistinta {
  /** Entidades distintas de verdade. Ausência nunca entra. */
  readonly distintos: number;
  /** Quantas cargas não têm a dimensão preenchida — declarado, nunca escondido. */
  readonly ausentes: number;
}

/**
 * GRAFIAS QUE PODEM SER A MESMA PESSOA — e a IARA ACUSA, nunca funde.
 *
 * A REGRA (operadora, 19/08/2026): ela precisa identificar esses casos sozinha,
 * inclusive os que aparecerem depois — o mapa escrito à mão envelhece.
 *
 * DUAS METADES, E A SEGUNDA É A QUE PROTEGE. O que tem marca ESTRUTURAL (sufixo
 * depois de " - ", parênteses) já é unido por `identidadeDeMotorista`, sozinho,
 * para qualquer nome futuro. O que NÃO tem marca — `CLAUDINEI` contra
 * `CLAUDINEI DE SOUZA` — não pode ser decidido por código: vira SUSPEITA, a
 * operadora confirma, e a confirmação entra no mapa declarado. O mapa passa a
 * crescer por confirmação, nunca por palpite.
 *
 * A ARMADILHA, e ela é absoluta: `LUIZ ANTONIO` (5 cargas) e `LUIZ PAULO` (88)
 * têm o mesmo primeiro nome e são pessoas DIFERENTES. Sumir com uma pessoa real
 * é pior que contá-la duas vezes. Por isso o critério é PREFIXO DE PALAVRAS
 * INTEIRAS — "CLAUDINEI" é o começo completo de "CLAUDINEI DE SOUZA", enquanto
 * nem "LUIZ ANTONIO" nem "LUIZ PAULO" é começo do outro. Compartilhar o primeiro
 * nome não basta, e é justamente essa a diferença entre as duas famílias.
 *
 * É a mesma disciplina de `Detectar não é executar` que já governa o `Vigia`.
 */
export interface SuspeitaDeIdentidade {
  /** A grafia mais curta — a candidata a nome canônico. */
  readonly provavel: string;
  /** As grafias mais longas que começam por ela. */
  readonly variantes: readonly string[];
  /** Quantas cargas estão em jogo, somando todas as grafias. */
  readonly cargas: number;
}

export function suspeitasDeIdentidade(
  cargas: readonly CargaCompleta[],
): readonly SuspeitaDeIdentidade[] {
  const porIdentidade = new Map<string, number>();
  for (const c of cargas) {
    if (dimensaoAusente(c.motorista)) continue;
    const id = identidadeDeMotorista(c.motorista);
    porIdentidade.set(id, (porIdentidade.get(id) ?? 0) + 1);
  }

  const nomes = [...porIdentidade.keys()].sort((a, b) => a.length - b.length);
  const jaAgrupado = new Set<string>();
  const achados: SuspeitaDeIdentidade[] = [];

  for (const curto of nomes) {
    if (jaAgrupado.has(curto)) continue;
    const palavras = curto.split(' ');
    const variantes = nomes.filter((outro) => {
      if (outro === curto || jaAgrupado.has(outro)) return false;
      const dele = outro.split(' ');
      if (dele.length <= palavras.length) return false;
      /* Prefixo de PALAVRAS INTEIRAS: "CLAUDINEI" começa "CLAUDINEI DE SOUZA",
         mas "LUIZ ANTONIO" não começa "LUIZ PAULO". */
      return palavras.every((p, i) => dele[i] === p);
    });
    if (variantes.length === 0) continue;

    jaAgrupado.add(curto);
    for (const v of variantes) jaAgrupado.add(v);
    achados.push({
      provavel: curto,
      variantes,
      cargas: [curto, ...variantes].reduce((s, n) => s + (porIdentidade.get(n) ?? 0), 0),
    });
  }

  /* Maior impacto primeiro: a suspeita que move mais cargas é a que a operadora
     deve olhar antes. */
  return achados.sort((a, b) => b.cargas - a.cargas);
}

/**
 * As dimensões que se pode CONTAR. É `AgruparPor` menos `nenhum` — porque
 * "quantos nenhum diferentes existem" não é uma pergunta — mais os campos de UF,
 * que agrupamento não oferece e contagem sim.
 */
export type DimensaoContavel =
  | Exclude<AgruparPor, 'nenhum'>
  | 'uf_origem'
  | 'uf_destino';

/**
 * O VALOR DE UMA DIMENSÃO PARA EFEITO DE CONTAGEM — `null` quando não há valor.
 *
 * O DEFEITO QUE ISTO FECHA (auditoria em navegador real, 19/08/2026). Perguntada
 * "quantas rotas diferentes temos?", a IARA respondeu, com procedência completa:
 *
 *   "todas as cargas de 2026: 0 rotas diferentes — 2687 cargas sem rota
 *    preenchido, fora dessa conta."
 *
 * São 4 no fixture e dezenas na planilha real. `rota` é dimensão DERIVADA
 * (`origem → destino`), não uma coluna: `c['rota']` é `undefined`, toda linha
 * caía em `dimensaoAusente` e o total ia para `ausentes`. Zero com fonte, ano e
 * contagem de ausência — a resposta mais confiável possível, e errada.
 *
 * A CAUSA NÃO ERA A ROTA. `contarDistintos` falava um vocabulário MAIS ESTREITO
 * que `AgruparPor`, e a habilidade unia os dois com
 * `agruparPor as Parameters<typeof contarDistintos>[1]`. O cast desligava
 * exatamente a checagem que teria acusado isso na compilação. Dois vocabulários
 * para a mesma ideia, ligados por um cast: é a mesma doença da regra duplicada
 * que este repositório já pagou duas vezes, na versão tipada.
 *
 * O SEGUNDO DEFEITO, achado junto e mais sutil: `status_normalizado` EXISTE em
 * `CargaCompleta`, então não explodia — devolvia 4 contando `SEM_STATUS` como se
 * fosse um status. Ausência virando entidade, que é literalmente o defeito
 * DIST-002 do incidente dos motoristas, vivo em outra dimensão porque a política
 * de nulo estava escrita para uma dimensão de cada vez.
 *
 * Agora existe UM lugar que decide o que é ausência, para toda dimensão. Ele é o
 * que `contarDistintos` usa, e é onde se lê a política inteira de uma vez.
 *
 * POR QUE `chaveDoGrupo` NÃO FOI UNIFICADO COM ISTO, e a diferença é
 * substantiva: listar e contar querem coisas opostas da ausência. Uma listagem
 * PRECISA mostrar `(sem motorista) — 131 cargas` e `SP → ?`, senão esconde carga
 * órfã de quem precisa resolvê-la. Uma contagem de entidades não pode incluir
 * nenhuma das duas. Unificar as funções faria uma das duas mentir.
 */
export function valorDaDimensao(c: CargaCompleta, dimensao: DimensaoContavel): string | null {
  switch (dimensao) {
    case 'motorista':
      /* Motorista tem IDENTIDADE, não só grafia: a mesma pessoa aparece com
         placa e tag coladas ao nome. Ver `identidadeDeMotorista`. */
      return dimensaoAusente(c.motorista) ? null : identidadeDeMotorista(c.motorista);
    case 'rota':
      /**
       * ROTA EXIGE AS DUAS PONTAS. Uma carga com destino em branco não define
       * uma rota parcial: define uma rota desconhecida. Contá-la como "SP → ?"
       * criaria uma entidade por origem órfã, e o número de rotas passaria a
       * crescer com o preenchimento incompleto da planilha — que é o oposto do
       * que quem pergunta quer saber.
       */
      return dimensaoAusente(c.origem) || dimensaoAusente(c.destino)
        ? null
        : `${c.origem.trim().toUpperCase()} → ${c.destino.trim().toUpperCase()}`;
    case 'status_normalizado':
      /* `SEM_STATUS` é o nome que o normalizador dá à célula vazia. Ele é
         ausência com outro rótulo, e ausência nunca é entidade. */
      return c.status_normalizado === 'SEM_STATUS' ? null : c.status_normalizado;
    default: {
      const v = c[dimensao];
      return dimensaoAusente(v) ? null : v.trim().toUpperCase();
    }
  }
}

/**
 * QUEM SUMIU — os valores que a operação conhece e que NÃO apareceram na janela.
 *
 * A PERGUNTA (operadora, 19/08/2026): *"quais centrais não tiveram cargas nos
 * últimos 30 dias?"*. Ela é de uma família diferente de tudo que existia aqui:
 * as outras contam o que ESTÁ nos dados; esta procura o que FALTA. Uma central
 * que parou de receber não aparece em nenhuma listagem — some, e sumir em
 * silêncio é exatamente o que a operadora precisa ver.
 *
 * O UNIVERSO É A PLANILHA, e a fronteira precisa ser dita em voz alta. `deTodo`
 * é o que a aba do ano conhece; `naJanela` é o recorte. A diferença são os que
 * pararam.
 *
 * O QUE ISTO NÃO ALCANÇA, medido em 19/08/2026 antes de escrever a função: a
 * tabela `centrais` do Supabase tem 12 centrais e a planilha tem 24 destinos —
 * e só DUAS aparecem nas duas (`RIO VERDE`, `SORRISO`). Os cadastros não se
 * falam. Cruzar as duas fontes produziria uma lista errada nas duas pontas:
 * nomearia central que a operação não usa e esconderia central que ela usa.
 *
 * Então esta função responde pela planilha e só por ela: "das centrais que
 * receberam carga em 2026, estas pararam". Uma central que NUNCA apareceu no ano
 * está fora do alcance, e quem responde tem de dizer isso.
 */
export interface SemMovimento {
  /** Os valores presentes no universo e ausentes na janela, em ordem de volume. */
  readonly parados: readonly { readonly chave: string; readonly cargas_no_universo: number }[];
  /** Quantos valores o universo conhece. O denominador da frase. */
  readonly conhecidos: number;
  /** Quantos apareceram na janela. */
  readonly ativos: number;
}

export function semMovimentoNaJanela(
  deTodo: readonly CargaCompleta[],
  naJanela: readonly CargaCompleta[],
  dimensao: DimensaoContavel,
): SemMovimento {
  const volume = new Map<string, number>();
  for (const c of deTodo) {
    const v = valorDaDimensao(c, dimensao);
    if (v !== null) volume.set(v, (volume.get(v) ?? 0) + 1);
  }
  const ativos = new Set<string>();
  for (const c of naJanela) {
    const v = valorDaDimensao(c, dimensao);
    if (v !== null) ativos.add(v);
  }
  const parados = [...volume.entries()]
    .filter(([chave]) => !ativos.has(chave))
    .map(([chave, cargas_no_universo]) => ({ chave, cargas_no_universo }))
    /* Maior volume primeiro: a que mais movimentava e parou é a que dói. */
    .sort((a, b) => b.cargas_no_universo - a.cargas_no_universo);
  return { parados, conhecidos: volume.size, ativos: ativos.size };
}

export function contarDistintos(
  cargas: readonly CargaCompleta[],
  dimensao: DimensaoContavel,
): ContagemDistinta {
  const vistos = new Set<string>();
  let ausentes = 0;
  for (const c of cargas) {
    const v = valorDaDimensao(c, dimensao);
    if (v === null) ausentes += 1;
    else vistos.add(v);
  }
  return { distintos: vistos.size, ausentes };
}

/**
 * QUANTAS CARGAS, E NÃO QUANTAS LINHAS — o defeito DIST-001.
 *
 * A identidade de uma carga é a OCI, e isso foi PROVADO nos dados, não
 * escolhido pelo nome: na aba 2026 há 2681 OCIs distintas em 2681 linhas com
 * OCI preenchida (as 24 linhas sem OCI já são descartadas antes, por
 * `linhaReal`). Hoje não há repetição — então isto é risco LATENTE, e o dia em
 * que alguém colar uma linha duas vezes a contagem sobe sem avisar ninguém.
 *
 * `repetidas` é a diferença, e sai declarada: uma planilha que ganha duplicata
 * precisa acusar, não corrigir em silêncio.
 */
export interface ContagemDeCargas {
  readonly linhas: number;
  readonly unicas: number;
  readonly repetidas: number;
}

export function contarCargas(cargas: readonly CargaCompleta[]): ContagemDeCargas {
  const ocis = new Set<string>();
  let semOci = 0;
  for (const c of cargas) {
    if (dimensaoAusente(c.oci)) semOci += 1;
    else ocis.add(c.oci.trim().toUpperCase());
  }
  const linhas = cargas.length;
  const unicas = ocis.size + semOci; /* linha sem OCI não é duplicata de ninguém */
  return { linhas, unicas, repetidas: linhas - unicas };
}

/**
 * QUANTAS CARGAS DO RECORTE TÊM VALOR LANÇADO — a medição que precisa vir ANTES
 * de qualquer conta de dinheiro.
 *
 * MEDIDO NO ARQUIVO REAL EM 20/08/2026, e o resultado é a razão deste código
 * existir:
 *
 *          cargas   com valor   cobertura
 *   2026     2689        2688      99,96%
 *   2025     4030           1       0,02%
 *   2024     4064          11       0,27%
 *
 * A aba de 2025 TEM uma coluna com o cabeçalho "VALOR". Ela está vazia. O
 * mapeador de colunas achou o rótulo e deu a coluna por mapeada — o cabeçalho
 * era real, o dado não era. É a mesma família do falso verde por âncora de
 * texto: procurar o nome e concluir que a coisa existe.
 *
 * O que isso produzia, medido antes da correção:
 *
 *   "o faturamento cresceu 430.830% de 2025 para 2026"   (R$ 1.100 -> R$ 4,7 mi)
 *   "a margem caiu 1,13 ponto percentual"                (31,27% apurado sobre UMA carga)
 *
 * Os dois números são aritmeticamente corretos e operacionalmente falsos. Nada
 * cresceu 430.830%: o que mudou foi quem preencheu a planilha. E uma margem
 * apurada sobre uma carga em quatro mil não é a margem de 2025 — é a margem
 * daquela carga, com o nome do ano em cima.
 *
 * A MEDIÇÃO É FEITA AQUI, e não escrita como constante por ano. Se amanhã a
 * operadora lançar os valores de 2025, a IARA passa a responder sozinha. Uma
 * tabela fixa dizendo "2025 não tem valor" viraria mentira no dia do
 * preenchimento, e ninguém lembraria de ir mexer nela.
 */
/**
 * PERCENTUAL EM PORTUGUÊS — vírgula, não ponto.
 *
 * `toFixed` é uma função de máquina e devolve "30.1". Numa frase em português
 * isso é "30.1%", que ninguém escreve. O dinheiro já saía certo porque
 * `toLocaleString('pt-BR')` cuidava dele; o percentual passava direto porque
 * ninguém tinha escrito o formatador equivalente.
 *
 * É a mesma família de "82 origems" e "pontos percentualis": a frase montada
 * pela conveniência do código em vez da gramática de quem lê.
 */
export const formatarPorcento = (v: number, casas = 1): string =>
  `${v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export interface CoberturaDeValor {
  readonly total: number;
  readonly com_valor: number;
  /** `null` quando o recorte está vazio: 0 de 0 não é 0%, é ausência de recorte. */
  readonly percentual: number | null;
}

export function coberturaDeValor(cargas: readonly CargaCompleta[]): CoberturaDeValor {
  const comValor = cargas.reduce((s, c) => s + (c.valor === null ? 0 : 1), 0);
  return {
    total: cargas.length,
    com_valor: comValor,
    percentual: cargas.length === 0 ? null : (comValor / cargas.length) * 100,
  };
}

/**
 * O PISO ABAIXO DO QUAL UMA SOMA NÃO É UM TOTAL.
 *
 * Metade é a fronteira defensável: acima dela o número é um total com ressalva,
 * abaixo dela é a soma de uma amostra que ninguém escolheu, apresentada com
 * nome de total. Não existe percentual "certo" aqui — existe a obrigação de
 * haver UM, declarado, em vez de a conta sair sempre.
 *
 * Entre o piso e 100% a resposta SAI, com a cobertura junto. Recusar a 94% seria
 * trocar um exagero por outro.
 */
export const PISO_DE_COBERTURA_DE_VALOR_PCT = 50;

/**
 * A frase da recusa, ou `null` quando dá para responder.
 *
 * Ela diz o número medido em vez de "dados insuficientes": a operadora é quem
 * preenche essa planilha, e "1 de 4.030 cargas de 2025 tem valor lançado" é
 * acionável — ela sabe exatamente o que fazer com isso. "Não consigo calcular"
 * não é.
 */
export function lacunaDeValor(rotulo: string, c: CoberturaDeValor): string | null {
  if (c.percentual === null) return `Não há carga nenhuma em ${rotulo}, então não há valor a somar.`;
  if (c.percentual >= PISO_DE_COBERTURA_DE_VALOR_PCT) return null;
  return (
    `Não vou responder isso com os dados de ${rotulo}: só ${c.com_valor} ` +
    `de ${c.total} carga${c.total === 1 ? '' : 's'} ` +
    `(${formatarPorcento(Math.floor((c.percentual ?? 0) * 100) / 100, 2)}) tem valor lançado na planilha. ` +
    `A coluna VALOR existe nessa aba e está praticamente vazia, então qualquer soma, média ou margem ` +
    `que eu apresentasse seria de um punhado de cargas com o nome do período inteiro em cima. ` +
    `Contagem, motoristas, postos e centrais desse período eu respondo normalmente. ` +
    `O que falta é o dinheiro.`
  );
}

/**
 * A MÉDIA SOBRE O QUE EXISTE — a decisão, documentada.
 *
 * Três cargas valendo 100, 200 e ausente admitem duas médias: 300/2 = 150 ou
 * 300/3 = 100. A escolha aqui é **150**: o denominador é a quantidade de
 * valores VÁLIDOS.
 *
 * A razão é operacional, não estatística. "Qual o ticket médio?" pergunta
 * quanto vale uma carga típica; uma carga cujo valor ainda não foi lançado não
 * vale zero — ela ainda não tem valor. Contá-la no divisor mistura "vale pouco"
 * com "não sabemos", e a operadora não tem como distinguir as duas coisas
 * olhando o número.
 *
 * `null` quando não há nenhum valor válido: média de nada é ausência, nunca
 * zero. Zero seria uma afirmação — a de que as cargas não valem nada.
 */
export function valorMedio(g: GrupoAgregado): number | null {
  return g.com_valor > 0 ? g.valor_total / g.com_valor : null;
}

function chaveDoGrupo(c: CargaCompleta, agruparPor: AgruparPor): string {
  switch (agruparPor) {
    case 'motorista':
      /* Agrupa por PESSOA, não por grafia: sem isto o ranking mostrava
         `CARLOS ANEVTON` cinco vezes, uma por veículo, e a operadora somava na
         cabeça. Ver `identidadeDeMotorista`. */
      return c.motorista ? identidadeDeMotorista(c.motorista) : '(sem motorista)';
    case 'rota':
      return `${c.origem || '?'} → ${c.destino || '?'}`;
    case 'origem':
      return c.origem || '(sem origem)';
    case 'destino':
      return c.destino || '(sem destino)';
    case 'status':
      return c.status || '(sem status)';
    case 'status_normalizado':
      return c.status_normalizado;
    case 'nenhum':
      return 'total';
  }
}

/**
 * Agrupa e soma — a mesma conta que `SUM/COUNT ... GROUP BY` faria, em cima
 * de dado já tipado. Pura: não busca nada, não decide o que mostrar — quem
 * chama decide ordenar por `contagem` ou por `valor_total` e cortar o topo.
 */
export function agregarCargas(
  cargas: readonly CargaCompleta[],
  agruparPor: AgruparPor,
): readonly GrupoAgregado[] {
  const grupos = new Map<string, { contagem: number; valor_total: number; com_valor: number }>();
  for (const c of cargas) {
    const chave = chaveDoGrupo(c, agruparPor);
    const atual = grupos.get(chave) ?? { contagem: 0, valor_total: 0, com_valor: 0 };
    atual.contagem += 1;
    atual.valor_total += c.valor ?? 0;
    /* Contado à parte para a média poder dividir pelo que existe — ver
       `valorMedio`. A soma continua tratando ausente como zero, e ali está
       certo: somar o que não existe não muda o total. */
    if (c.valor !== null) atual.com_valor += 1;
    grupos.set(chave, atual);
  }
  return [...grupos.entries()].map(([chave, v]) => ({ chave, ...v }));
}
