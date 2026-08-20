/**
 * O ORÁCULO DA MARGEM CONTRA A PLANILHA VIVA — os números esperados da auditoria.
 *
 * Não importa uma linha de `MargemOperacional` nem de `ClientePlanilhaOcis`.
 * Baixa o arquivo por conta própria, lê as abas por conta própria, monta o
 * cruzamento por conta própria e faz a conta a partir da REGRA escrita.
 *
 * É contra ESTE arquivo que a resposta da IARA na tela vai ser comparada. Um
 * verificador que chama a implementação para conferir a implementação não é
 * segunda opinião — é a mesma opinião dita duas vezes, e foi assim que o
 * relógio das 18:29 passou.
 *
 *   node --env-file=.env.local testes/gate/oraculo-margem-vivo.mjs
 */

import XLSX from 'xlsx';

const T = { origem: 2, destino: 3, mot: 4, log: 5, ida: 7 };
const C = { oci: 4, origem: 5, destino: 7, motorista: 10, dataColeta: 11 };
const VALOR_POR_ANO = { '2026': 23, '2025': 24, '2024': 24 };
const PRIMEIRA_LINHA_DE_DADO = 5;

const norma = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const chave = (o, d) => `${norma(o)} > ${norma(d)}`;

/** Serial do Excel -> "AAAA-MM-DD". Escrito aqui, não importado. */
const serialParaISO = (s) => new Date(Math.round((s - 25569) * 86400 * 1000)).toISOString().slice(0, 10);

/** A identidade do motorista, reescrita a partir da regra. */
const IDENTIDADE = {
  'CLAUDINEI DE SOUZA': 'CLAUDINEI',
  'LOURENCO SAMPAIO': 'LOURENCO',
  'JAIRO GMK': 'JAIRO',
  'CLEITON LAUDIR': 'CLEITON',
};
function identidade(bruto) {
  const limpo = norma(bruto).replace(/\([^)]*\)/g, ' ').split(/\s+-\s+/)[0].replace(/\s+/g, ' ').trim();
  return IDENTIDADE[limpo] ?? limpo;
}

async function token() {
  const r = await fetch(
    `https://login.microsoftonline.com/${process.env.MS_GRAPH_TENANT_ID.trim()}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MS_GRAPH_CLIENT_ID.trim(),
        client_secret: process.env.MS_GRAPH_CLIENT_SECRET.trim(),
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
      signal: AbortSignal.timeout(30000),
    },
  );
  const c = await r.json();
  if (!c.access_token) throw new Error(`Azure recusou: HTTP ${r.status}`);
  return c.access_token;
}

const shareId = (u) =>
  'u!' + Buffer.from(u, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

const brl = (n) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const main = async () => {
  const t = await token();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(process.env.MS_GRAPH_OCI_URL.trim())}/driveItem/content`,
    { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(180000) },
  );
  if (!r.ok) throw new Error(`Graph recusou: HTTP ${r.status}`);
  const pasta = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });

  // --- tabelário -----------------------------------------------------------
  const preco = new Map();
  const ambiguas = new Set();
  for (const l of XLSX.utils.sheet_to_json(pasta.Sheets.TABELA, { header: 1, raw: true, defval: '' }).slice(1)) {
    if (!norma(l[T.origem]) || !norma(l[T.destino])) continue;
    const k = chave(l[T.origem], l[T.destino]);
    const p = { mot: Number(l[T.mot]) || 0, log: Number(l[T.log]) || 0, ida: Number(l[T.ida]) || 0 };
    const antigo = preco.get(k);
    if (!antigo) preco.set(k, p);
    else if (antigo.mot !== p.mot || antigo.log !== p.log) ambiguas.add(k);
  }

  // --- cargas do ano vivo --------------------------------------------------
  const ano = '2026';
  const colValor = VALOR_POR_ANO[ano];
  const cargas = XLSX.utils
    .sheet_to_json(pasta.Sheets[ano], { header: 1, raw: true, defval: '' })
    .slice(PRIMEIRA_LINHA_DE_DADO - 1)
    .filter((l) => String(l[C.oci] ?? '').trim() !== '')
    .map((l) => ({
      origem: String(l[C.origem] ?? ''),
      destino: String(l[C.destino] ?? ''),
      motorista: String(l[C.motorista] ?? '').trim(),
      data: typeof l[C.dataColeta] === 'number' ? serialParaISO(l[C.dataColeta]) : null,
      valor: typeof l[colValor] === 'number' ? l[colValor] : null,
    }));

  /** A conta, escrita do zero. */
  function margem(lista) {
    let receita = 0;
    let custo = 0;
    let pedagio = 0;
    let comPreco = 0;
    let semPreco = 0;
    let semValor = 0;
    let amb = 0;
    for (const c of lista) {
      const k = chave(c.origem, c.destino);
      if (ambiguas.has(k)) { amb += 1; continue; }
      const p = preco.get(k);
      if (!p) { semPreco += 1; continue; }
      if (c.valor === null) { semValor += 1; continue; }
      comPreco += 1;
      receita += c.valor;
      custo += p.mot;
      pedagio += p.ida;
    }
    const bruto = receita - custo;
    return {
      cargas: lista.length,
      com_preco: comPreco,
      sem_preco: semPreco,
      sem_valor: semValor,
      ambiguas: amb,
      cobertura_pct: lista.length ? (comPreco / lista.length) * 100 : null,
      receita,
      custo,
      pedagio,
      resultado_bruto: bruto,
      resultado_com_pedagio: bruto - pedagio,
      pct_bruto: receita > 0 ? (bruto / receita) * 100 : null,
      pct_com_pedagio: receita > 0 ? ((bruto - pedagio) / receita) * 100 : null,
    };
  }

  function porDimensao(lista, pegar) {
    const g = new Map();
    for (const c of lista) {
      const v = pegar(c);
      if (!v) continue;
      (g.get(v) ?? g.set(v, []).get(v)).push(c);
    }
    return [...g.entries()]
      .map(([k, v]) => ({ chave: k, ...margem(v) }))
      .sort((a, b) => b.resultado_bruto - a.resultado_bruto);
  }

  const geral = margem(cargas);
  const porCentral = porDimensao(cargas, (c) => norma(c.destino));
  const porPosto = porDimensao(cargas, (c) => norma(c.origem));
  const porMotorista = porDimensao(cargas, (c) => (c.motorista ? identidade(c.motorista) : null));

  /** A média SIMPLES das margens das rotas — a outra conta, para contraste. */
  const porRota = porDimensao(cargas, (c) => chave(c.origem, c.destino));
  const pcts = porRota.map((x) => x.pct_bruto).filter((p) => p !== null);
  const mediaDasRotas = pcts.length ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null;

  console.log(
    JSON.stringify(
      {
        ORACULO: 'margem-viva-independente',
        ano,
        geral: {
          ...geral,
          receita_brl: brl(geral.receita),
          resultado_bruto_brl: brl(geral.resultado_bruto),
          resultado_com_pedagio_brl: brl(geral.resultado_com_pedagio),
          pct_bruto_1casa: geral.pct_bruto?.toFixed(1),
          pct_com_pedagio_1casa: geral.pct_com_pedagio?.toFixed(1),
          cobertura_pct_2casas: geral.cobertura_pct?.toFixed(2),
        },
        margem_media_das_rotas_1casa: mediaDasRotas?.toFixed(1),
        top5_central: porCentral.slice(0, 5).map((x) => ({
          central: x.chave,
          resultado: brl(x.resultado_bruto),
          pct: x.pct_bruto?.toFixed(1),
          cargas: x.com_preco,
        })),
        top5_posto: porPosto.slice(0, 5).map((x) => ({
          posto: x.chave,
          resultado: brl(x.resultado_bruto),
          pct: x.pct_bruto?.toFixed(1),
          cargas: x.com_preco,
        })),
        top3_motorista: porMotorista.slice(0, 3).map((x) => ({
          motorista: x.chave,
          resultado: brl(x.resultado_bruto),
          pct: x.pct_bruto?.toFixed(1),
          cargas: x.com_preco,
        })),
        /* A central de MAIOR PERCENTUAL, que é outra pergunta. */
        maior_percentual_central: [...porCentral]
          .filter((x) => x.pct_bruto !== null && x.com_preco >= 5)
          .sort((a, b) => b.pct_bruto - a.pct_bruto)
          .slice(0, 3)
          .map((x) => ({ central: x.chave, pct: x.pct_bruto.toFixed(1), cargas: x.com_preco })),
      },
      null,
      1,
    ),
  );
};

main().catch((e) => {
  console.error('FALHOU:', e.message ?? e);
  process.exit(1);
});
