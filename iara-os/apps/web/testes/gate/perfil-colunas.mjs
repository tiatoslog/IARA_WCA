/**
 * PERFIL NUMÉRICO DE CADA COLUNA, por aba — para decidir a coluna do valor com
 * evidência em vez de palpite.
 *
 * Para cada coluna: quantas linhas têm número, a soma, a mediana e o cabeçalho.
 * A coluna do valor de uma carga tem preenchimento alto e mediana na casa dos
 * milhares. Uma coluna com 2 números e soma 1.100 não é o valor de 4.022 cargas.
 *
 *   node --env-file=.env.local testes/gate/perfil-colunas.mjs
 */

import XLSX from 'xlsx';

const PRIMEIRA_LINHA_DE_DADO = 5;
const COL_OCI = 4;
const ANOS = ['2026', '2025', '2024'];

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

const mediana = (v) => {
  if (!v.length) return null;
  const o = [...v].sort((a, b) => a - b);
  return o[Math.floor(o.length / 2)];
};

const main = async () => {
  const t = await token();
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(process.env.MS_GRAPH_OCI_URL.trim())}/driveItem/content`,
    { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(180000) },
  );
  const pasta = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });

  for (const ano of ANOS) {
    const todas = XLSX.utils.sheet_to_json(pasta.Sheets[ano], { header: 1, raw: true, defval: '' });
    /* O cabeçalho pode estar em qualquer uma das 4 primeiras linhas; junto todas. */
    const cabecalho = (c) =>
      todas
        .slice(0, PRIMEIRA_LINHA_DE_DADO - 1)
        .map((l) => String(l[c] ?? '').trim())
        .filter(Boolean)
        .join(' | ');

    const dados = todas
      .slice(PRIMEIRA_LINHA_DE_DADO - 1)
      .filter((l) => String(l[COL_OCI] ?? '').trim() !== '');

    const largura = Math.max(...todas.map((l) => l.length));
    const perfil = [];
    for (let c = 0; c < largura; c += 1) {
      const nums = dados.map((l) => l[c]).filter((v) => typeof v === 'number' && Number.isFinite(v));
      if (nums.length === 0) continue;
      perfil.push({
        col: c,
        cabecalho: cabecalho(c).slice(0, 40),
        com_numero: nums.length,
        preench_pct: ((nums.length / dados.length) * 100).toFixed(0),
        soma: Math.round(nums.reduce((s, v) => s + v, 0)),
        mediana: mediana(nums),
      });
    }
    /* Só o que parece dinheiro: preenchimento >= 50% e mediana >= 100. */
    const candidatas = perfil.filter((p) => Number(p.preench_pct) >= 50 && (p.mediana ?? 0) >= 100);
    console.log(`\n=== ${ano} — ${dados.length} linhas de dado ===`);
    console.log('candidatas a valor (preench >= 50%, mediana >= 100):');
    for (const p of candidatas) {
      console.log(
        `  col ${String(p.col).padStart(2)}  ${p.preench_pct.padStart(3)}%  soma=${String(p.soma).padStart(10)}  med=${String(p.mediana).padStart(8)}  ${p.cabecalho}`,
      );
    }
    console.log('  (todas as colunas numéricas, resumo)');
    console.log(
      '  ' + perfil.map((p) => `${p.col}:${p.preench_pct}%/${p.mediana}`).join(' '),
    );
  }
};

main().catch((e) => {
  console.error('FALHOU:', e.message);
  process.exit(1);
});
