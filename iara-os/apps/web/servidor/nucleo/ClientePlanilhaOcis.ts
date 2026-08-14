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

const GRAPH = 'https://graph.microsoft.com/v1.0';
const TEMPO_LIMITE_MS = 15_000;
const ABA_VIVA = '2026';
/** Linha 1 é cabeçalho; dado real começa na 5 (linhas 2-4 são sub-cabeçalho/resumo). */
const PRIMEIRA_LINHA_DE_DADO = 5;

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
    const resposta = await fetch(
      `${GRAPH}/shares/${shareId}/driveItem?$select=id,parentReference`,
      { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) },
    );
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      return { ok: false, motivo: `Graph recusou localizar a planilha (HTTP ${resposta.status}): ${corpo.slice(0, 200)}` };
    }
    const dados = (await resposta.json()) as { id?: string; parentReference?: { driveId?: string } };
    if (!dados.id || !dados.parentReference?.driveId) {
      return { ok: false, motivo: 'a Graph respondeu sem id/driveId da planilha' };
    }
    localizacaoCache = { driveId: dados.parentReference.driveId, itemId: dados.id };
    return { ok: true, loc: localizacaoCache };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
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
    const resposta = await fetch(caminho, {
      headers: { Authorization: `Bearer ${t}` },
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });
    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      return { ok: false, motivo: `Graph recusou ler a aba "${aba}" (HTTP ${resposta.status}): ${corpo.slice(0, 200)}` };
    }
    const dados = (await resposta.json()) as { values?: unknown[][] };
    return { ok: true, valores: dados.values ?? [] };
  } catch (erro) {
    return { ok: false, motivo: (erro as Error).message };
  }
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

const letraColuna = (n: number): string => String.fromCharCode(65 + n);

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
  if (!loc.ok) return { ok: false, texto: `Não consegui localizar a planilha: ${loc.motivo}`, cargas: [] };

  const enc = encodeURIComponent(ABA_VIVA);
  const dimensoes = await fetch(
    `${GRAPH}/drives/${loc.loc.driveId}/items/${loc.loc.itemId}/workbook/worksheets('${enc}')` +
      `/usedRange?$select=address,rowCount,columnCount`,
    { headers: { Authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(TEMPO_LIMITE_MS) },
  ).catch((erro: Error) => erro);
  if (dimensoes instanceof Error) {
    return { ok: false, texto: `Não consegui ler o tamanho da aba "${ABA_VIVA}": ${dimensoes.message}`, cargas: [] };
  }
  if (!dimensoes.ok) {
    const corpo = await dimensoes.text().catch(() => '');
    return { ok: false, texto: `Graph recusou o tamanho da aba "${ABA_VIVA}" (HTTP ${dimensoes.status}): ${corpo.slice(0, 200)}`, cargas: [] };
  }
  const { rowCount, columnCount } = (await dimensoes.json()) as { rowCount: number; columnCount: number };
  if (rowCount < PRIMEIRA_LINHA_DE_DADO) {
    return { ok: true, texto: 'A aba de cargas está vazia.', cargas: [] };
  }

  const endereco = `A${PRIMEIRA_LINHA_DE_DADO}:${letraColuna(columnCount - 1)}${rowCount}`;
  const dados = await lerRange(t, loc.loc, ABA_VIVA, endereco);
  if (!dados.ok) return { ok: false, texto: dados.motivo, cargas: [] };

  const cargas = dados.valores
    .filter(linhaReal)
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
