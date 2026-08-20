/**
 * O ORÁCULO DA COMPARAÇÃO ENTRE ANOS — os números esperados, escritos do zero.
 *
 * Não importa `ComparacaoDePeriodos`, `ClientePlanilhaOcis` nem a habilidade.
 * Baixa o arquivo, lê as três abas, conta, soma e decompõe por conta própria, a
 * partir da REGRA escrita — e refaz até a aritmética da variação percentual.
 *
 * Se este arquivo chamasse `comparar()` para conferir `comparar()`, não seria
 * segunda opinião: seria a mesma opinião dita duas vezes. Foi assim que o
 * relógio das 18:29 passou por uma auditoria inteira.
 *
 *   node --env-file=.env.local testes/gate/oraculo-comparacao-anos.mjs
 */

import XLSX from 'xlsx';

const T = { origem: 2, destino: 3, mot: 4, log: 5, ida: 7 };
const C = { oci: 4, origem: 5, destino: 7, motorista: 10, dataColeta: 11 };
/* A coluna do valor MUDA de aba: 23 em 2026, 24 em 2025 e 2024. Reescrito aqui
   de propósito — se a implementação errar o mapa, o oráculo não erra junto. */
const VALOR_POR_ANO = { '2026': 23, '2025': 24, '2024': 24 };
const PRIMEIRA_LINHA_DE_DADO = 5;
const ANOS = ['2026', '2025', '2024'];

const norma = (v) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();

const chave = (o, d) => `${norma(o)} > ${norma(d)}`;

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

/* A conta da variação, reescrita. Base zero devolve null — nunca Infinity. */
const variacao = (a, b) => (a === 0 ? null : ((b - a) / a) * 100);

const main = async () => {
  const t = await token();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(process.env.MS_GRAPH_OCI_URL.trim())}/driveItem/content`,
    { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(180000) },
  );
  if (!r.ok) throw new Error(`Graph recusou: HTTP ${r.status}`);
  const pasta = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });

  // --- tabelário, para a margem --------------------------------------------
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

  // --- as três abas ---------------------------------------------------------
  const porAno = {};
  for (const ano of ANOS) {
    const colValor = VALOR_POR_ANO[ano];
    porAno[ano] = XLSX.utils
      .sheet_to_json(pasta.Sheets[ano], { header: 1, raw: true, defval: '' })
      .slice(PRIMEIRA_LINHA_DE_DADO - 1)
      .filter((l) => String(l[C.oci] ?? '').trim() !== '')
      .map((l) => ({
        oci: String(l[C.oci] ?? '').trim().toUpperCase(),
        origem: String(l[C.origem] ?? ''),
        destino: String(l[C.destino] ?? ''),
        motorista: String(l[C.motorista] ?? '').trim(),
        valor: typeof l[colValor] === 'number' ? l[colValor] : null,
      }));
  }

  const cargasUnicas = (lista) => new Set(lista.map((c) => c.oci)).size;
  const faturamento = (lista) => lista.reduce((s, c) => s + (c.valor ?? 0), 0);
  const motoristas = (lista) =>
    new Set(lista.map((c) => (c.motorista ? identidade(c.motorista) : null)).filter(Boolean)).size;

  function margemPct(lista) {
    let receita = 0;
    let custo = 0;
    let cobertas = 0;
    for (const c of lista) {
      const k = chave(c.origem, c.destino);
      if (ambiguas.has(k)) continue;
      const p = preco.get(k);
      if (!p || c.valor === null) continue;
      cobertas += 1;
      receita += c.valor;
      custo += p.mot;
    }
    return {
      pct: receita > 0 ? ((receita - custo) / receita) * 100 : null,
      resultado: receita - custo,
      cobertura_pct: lista.length ? (cobertas / lista.length) * 100 : null,
    };
  }

  // --- decomposição por central, de 2025 para 2026 --------------------------
  const contarPor = (lista, pegar) => {
    const m = new Map();
    for (const c of lista) {
      const v = pegar(c);
      if (!v) continue;
      m.set(v, (m.get(v) ?? 0) + 1);
    }
    return m;
  };
  const a25 = contarPor(porAno['2025'], (c) => norma(c.destino));
  const a26 = contarPor(porAno['2026'], (c) => norma(c.destino));
  const somaA = [...a25.values()].reduce((s, v) => s + v, 0);
  const somaB = [...a26.values()].reduce((s, v) => s + v, 0);
  const deltaTotal = somaB - somaA;
  const grupos = [...new Set([...a25.keys(), ...a26.keys()])]
    .map((k) => {
      const x = a25.get(k) ?? 0;
      const y = a26.get(k) ?? 0;
      return {
        central: k,
        anterior: x,
        atual: y,
        delta: y - x,
        contribuicao_pct: deltaTotal === 0 ? null : ((y - x) / deltaTotal) * 100,
      };
    })
    .sort((p, q) => Math.abs(q.delta) - Math.abs(p.delta));

  const direcao = Math.sign(deltaTotal);
  const oposta = direcao !== 0 && grupos.some((g) => g.delta !== 0 && Math.sign(g.delta) !== direcao);

  const m25 = margemPct(porAno['2025']);
  const m26 = margemPct(porAno['2026']);

  console.log(
    JSON.stringify(
      {
        ORACULO: 'comparacao-entre-anos-independente',
        por_ano: Object.fromEntries(
          ANOS.map((a) => [
            a,
            {
              linhas: porAno[a].length,
              cargas_unicas: cargasUnicas(porAno[a]),
              faturamento: faturamento(porAno[a]),
              motoristas_distintos: motoristas(porAno[a]),
              margem_pct: margemPct(porAno[a]).pct?.toFixed(2) ?? null,
            },
          ]),
        ),
        '2025_para_2026': {
          cargas: {
            anterior: cargasUnicas(porAno['2025']),
            atual: cargasUnicas(porAno['2026']),
            delta: cargasUnicas(porAno['2026']) - cargasUnicas(porAno['2025']),
            variacao_pct: variacao(cargasUnicas(porAno['2025']), cargasUnicas(porAno['2026']))?.toFixed(1),
          },
          faturamento: {
            anterior: faturamento(porAno['2025']).toFixed(2),
            atual: faturamento(porAno['2026']).toFixed(2),
            variacao_pct: variacao(faturamento(porAno['2025']), faturamento(porAno['2026']))?.toFixed(1),
          },
          margem: {
            pct_anterior: m25.pct?.toFixed(2),
            pct_atual: m26.pct?.toFixed(2),
            delta_pp: (m26.pct - m25.pct).toFixed(2),
            variacao_relativa_pct: variacao(m25.pct, m26.pct)?.toFixed(1),
            cobertura_anterior_pct: m25.cobertura_pct?.toFixed(1),
            cobertura_atual_pct: m26.cobertura_pct?.toFixed(1),
          },
          por_central: {
            delta_total: deltaTotal,
            tem_direcao_oposta: oposta,
            so_no_anterior: [...a25.keys()].filter((k) => !a26.has(k)),
            so_no_atual: [...a26.keys()].filter((k) => !a25.has(k)),
            top6: grupos.slice(0, 6).map((g) => ({
              ...g,
              contribuicao_pct: g.contribuicao_pct?.toFixed(1),
            })),
          },
        },
      },
      null,
      2,
    ),
  );
};

main().catch((e) => {
  console.error('ORACULO FALHOU:', e.message);
  process.exit(1);
});
