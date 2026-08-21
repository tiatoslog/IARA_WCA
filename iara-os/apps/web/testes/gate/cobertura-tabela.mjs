/**
 * A COBERTURA DO CRUZAMENTO CARGAS × TABELA — medida ANTES de escrever margem.
 *
 * A `TABELA` é o tabelário de preços por TRECHO: origem, destino, valor pago ao
 * motorista, valor cobrado do logístico, pedágio, km e as duas margens. A chave
 * dela é `origem → destino`, que é a MESMA chave da rota nas abas de carga.
 *
 * "SE FECHAR" É A PERGUNTA INTEIRA, e é por isso que este script existe antes do
 * código. O cruzamento anterior que tentei — cargas × cadastro de centrais do
 * Supabase — parecia igualmente óbvio e casava 2 de 12. Ter medido foi o que
 * impediu a IARA de listar centrais que a operação não usa.
 *
 * CLASSIFICAÇÃO DE CADA CHAVE, e nenhuma outra é permitida:
 *
 *   EXACT             a chave bate byte a byte
 *   NORMALIZED_EXACT  bate depois de trim, caixa, espaço duplo e acento
 *   AMBIGUOUS         a TABELA tem DUAS linhas com preços diferentes para a
 *                     mesma chave — não existe "a margem" desse trecho
 *   UNMATCHED         não bate
 *
 * NÃO EXISTE APROXIMAÇÃO AQUI. Nada de distância de edição, nada de prefixo:
 * "POSTO A" nunca vira "POSTO B" por parecer. Uma rota sem preço é uma rota sem
 * preço, e o que se faz com ela é declarar, não adivinhar.
 *
 *   node --env-file=.env.local testes/gate/cobertura-tabela.mjs
 */

import XLSX from 'xlsx';

const ABA_TABELA = 'TABELA';
const PRIMEIRA_LINHA_DE_DADO = 5;

/* Índices medidos por `mapear-abas.mjs` em 19/08/2026. */
const T = { origem: 2, destino: 3, mot: 4, log: 5, pedagioIdaVolta: 6, ida: 7, margemBruta: 8, margemPedagio: 9 };
const COL = {
  '2026': { origem: 5, destino: 7, valor: 23 },
  '2025': { origem: 5, destino: 7, valor: 24 },
  '2024': { origem: 5, destino: 7, valor: 24 },
};

/** Só diferenças de FORMATAÇÃO: espaço, caixa, acento. Nunca semântica. */
const normalizar = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const chave = (o, d) => `${o} > ${d}`;

async function token() {
  const t = process.env.MS_GRAPH_TENANT_ID?.trim();
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_GRAPH_CLIENT_ID.trim(),
      client_secret: process.env.MS_GRAPH_CLIENT_SECRET.trim(),
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`Azure recusou o token: HTTP ${r.status}`);
  return c.access_token;
}

const shareId = (url) =>
  'u!' + Buffer.from(url, 'utf8').toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');

export async function baixarPasta() {
  const t = await token();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(process.env.MS_GRAPH_OCI_URL.trim())}/driveItem/content`,
    { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(180000) },
  );
  if (!r.ok) throw new Error(`Graph recusou o download: HTTP ${r.status}`);
  return XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });
}

const main = async () => {
  const pasta = await baixarPasta();

  // -------------------------------------------------------------------------
  // O tabelário
  // -------------------------------------------------------------------------
  const linhasT = XLSX.utils
    .sheet_to_json(pasta.Sheets[ABA_TABELA], { header: 1, raw: true, defval: '' })
    .slice(1)
    .filter((l) => normalizar(l[T.origem]) !== '' && normalizar(l[T.destino]) !== '');

  const preco = new Map();
  const ambiguas = new Map();
  const cruas = new Set();
  for (const l of linhasT) {
    cruas.add(chave(String(l[T.origem]).trim(), String(l[T.destino]).trim()));
    const k = chave(normalizar(l[T.origem]), normalizar(l[T.destino]));
    const p = {
      mot: Number(l[T.mot]) || 0,
      log: Number(l[T.log]) || 0,
      idaVolta: Number(l[T.pedagioIdaVolta]) || 0,
      ida: Number(l[T.ida]) || 0,
      margemBrutaDeclarada: Number(l[T.margemBruta]) || 0,
      margemPedagioDeclarada: Number(l[T.margemPedagio]) || 0,
    };
    const antigo = preco.get(k);
    if (antigo) {
      if (antigo.mot !== p.mot || antigo.log !== p.log) ambiguas.set(k, [antigo, p]);
    } else {
      preco.set(k, p);
    }
  }

  // -------------------------------------------------------------------------
  // As duas fórmulas, conferidas linha a linha
  // -------------------------------------------------------------------------
  const conferencia = { bruta_ok: 0, bruta_erro: 0, pedagio_ida_ok: 0, pedagio_idavolta_ok: 0, pedagio_erro: 0 };
  const divergentes = [];
  for (const [k, p] of preco) {
    if (p.log <= 0) continue;
    const bruta = (p.log - p.mot) / p.log;
    if (Math.abs(bruta - p.margemBrutaDeclarada) < 0.0005) conferencia.bruta_ok += 1;
    else {
      conferencia.bruta_erro += 1;
      if (divergentes.length < 5)
        divergentes.push({ trecho: k, declarada: p.margemBrutaDeclarada, calculada: Number(bruta.toFixed(5)) });
    }

    /* Qual pedágio a coluna "MARGEM COM PEDAGIO" usa: a ida, ou ida e volta? */
    const comIda = (p.log - p.mot - p.ida) / p.log;
    const comIdaVolta = (p.log - p.mot - p.idaVolta) / p.log;
    if (Math.abs(comIda - p.margemPedagioDeclarada) < 0.0005) conferencia.pedagio_ida_ok += 1;
    else if (Math.abs(comIdaVolta - p.margemPedagioDeclarada) < 0.0005) conferencia.pedagio_idavolta_ok += 1;
    else conferencia.pedagio_erro += 1;
  }

  // -------------------------------------------------------------------------
  // A cobertura, por ano
  // -------------------------------------------------------------------------
  const relatorio = {};
  for (const [ano, c] of Object.entries(COL)) {
    const folha = pasta.Sheets[ano];
    if (!folha) continue;
    const linhas = XLSX.utils
      .sheet_to_json(folha, { header: 1, raw: true, defval: '' })
      .slice(PRIMEIRA_LINHA_DE_DADO - 1)
      .filter((l) => String(l[4] ?? '').trim() !== '');

    const porRota = new Map();
    for (const l of linhas) {
      const o = normalizar(l[c.origem]);
      const d = normalizar(l[c.destino]);
      if (!o || !d) continue;
      const k = chave(o, d);
      const at = porRota.get(k) ?? { cargas: 0, exata: chave(String(l[c.origem]).trim(), String(l[c.destino]).trim()) };
      at.cargas += 1;
      porRota.set(k, at);
    }

    let exact = 0;
    let normalizado = 0;
    let ambiguo = 0;
    let semMatch = 0;
    let cargasCobertas = 0;
    let cargasAmbiguas = 0;
    let cargasSemMatch = 0;
    const descobertas = [];
    for (const [k, v] of porRota) {
      if (ambiguas.has(k)) {
        ambiguo += 1;
        cargasAmbiguas += v.cargas;
      } else if (preco.has(k)) {
        if (cruas.has(v.exata)) exact += 1;
        else normalizado += 1;
        cargasCobertas += v.cargas;
      } else {
        semMatch += 1;
        cargasSemMatch += v.cargas;
        descobertas.push({ rota: k, cargas: v.cargas });
      }
    }
    const totalCargas = [...porRota.values()].reduce((s, v) => s + v.cargas, 0);
    const pct = (a, b) => (b === 0 ? null : Number(((a / b) * 100).toFixed(2)));

    relatorio[ano] = {
      rotas: { total: porRota.size, EXACT: exact, NORMALIZED_EXACT: normalizado, AMBIGUOUS: ambiguo, UNMATCHED: semMatch },
      cobertura_por_rota_pct: pct(exact + normalizado, porRota.size),
      cargas: { total: totalCargas, com_match: cargasCobertas, ambiguas: cargasAmbiguas, sem_match: cargasSemMatch },
      cobertura_por_carga_pct: pct(cargasCobertas, totalCargas),
      maiores_rotas_sem_match: descobertas
        .sort((a, b) => b.cargas - a.cargas)
        .slice(0, 15)
        .map((x) => ({ ...x, pct_do_total: pct(x.cargas, totalCargas) })),
    };
  }

  console.log(
    JSON.stringify(
      {
        tabela: { linhas: linhasT.length, trechos_unicos: preco.size, chaves_ambiguas: ambiguas.size },
        formulas: conferencia,
        formula_divergente_exemplos: divergentes,
        cobertura: relatorio,
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
