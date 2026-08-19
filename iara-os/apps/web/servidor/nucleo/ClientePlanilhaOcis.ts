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
  const fora = achados.find((a) => a !== ANO_VIVO);
  return fora ?? null;
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
    const folha = pasta.Sheets[ABA_VIVA];
    if (!folha) return { ok: false, motivo: `o arquivo baixado não tem a aba "${ABA_VIVA}"` };

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
): Promise<{ ok: true; linhas: unknown[][] } | { ok: false; motivo: string }> {
  const enc = encodeURIComponent(ABA_VIVA);
  const dimensoes = await fetchComRetentativa(
    `${GRAPH}/drives/${loc.driveId}/items/${loc.itemId}/workbook/worksheets('${enc}')` +
      `/usedRange?$select=address,rowCount,columnCount`,
    { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) },
  ).catch((erro: Error) => erro);
  if (dimensoes instanceof Error) {
    return { ok: false, motivo: `Não consegui ler o tamanho da aba "${ABA_VIVA}": ${dimensoes.message}` };
  }
  if (!dimensoes.ok) {
    const corpo = await dimensoes.text().catch(() => '');
    return { ok: false, motivo: `Graph recusou o tamanho da aba "${ABA_VIVA}" (HTTP ${dimensoes.status}): ${corpo.slice(0, 200)}` };
  }
  const { rowCount, columnCount } = (await dimensoes.json()) as { rowCount: number; columnCount: number };
  if (rowCount < PRIMEIRA_LINHA_DE_DADO) return { ok: true, linhas: [] };

  const endereco = `A${PRIMEIRA_LINHA_DE_DADO}:${letraColuna(columnCount - 1)}${rowCount}`;
  const dados = await lerRange(t, loc, ABA_VIVA, endereco);
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
): Promise<{ ok: true; linhas: unknown[][]; via: ViaLeitura } | { ok: false; motivo: string }> {
  const viaApi = await buscarLinhasReaisViaApi(t, loc);
  if (viaApi.ok) return { ok: true, linhas: viaApi.linhas, via: 'api' };

  const viaDownload = await baixarEParsearArquivo(t, loc);
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

function paraCargaCompleta(linha: readonly unknown[]): CargaCompleta {
  const valorBruto = linha[23];
  const statusBruto = String(linha[21] ?? '').trim();
  return {
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

  const cargas = resultado.linhas.map(paraCargaCompleta);
  const buscadoEm = Date.now();
  cacheTodas = { cargas, buscadoEm, via: resultado.via };
  return { ok: true, texto: `${cargas.length} cargas cadastradas.`, cargas, fonte: fonteDe(buscadoEm, false, resultado.via) };
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

export function contarDistintos(
  cargas: readonly CargaCompleta[],
  dimensao: 'motorista' | 'origem' | 'destino' | 'uf_origem' | 'uf_destino' | 'status',
): ContagemDistinta {
  const vistos = new Set<string>();
  let ausentes = 0;
  for (const c of cargas) {
    const v = c[dimensao];
    if (dimensaoAusente(v)) ausentes += 1;
    else vistos.add(v.trim().toUpperCase());
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
      return c.motorista || '(sem motorista)';
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
