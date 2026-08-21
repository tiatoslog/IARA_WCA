/**
 * O MAPA DAS ABAS — medição, não suposição.
 *
 * `ClientePlanilhaOcis` afirma, desde 14/08/2026, que as abas 2025 e 2024 têm
 * "outro desenho de colunas (VALOR na 25; nesta, na 23)". Essa frase virou o
 * motivo de a IARA recusar qualquer pergunta sobre 2025 — e ninguém a conferiu
 * desde então.
 *
 * Antes de escrever um segundo mapa, este script IMPRIME os cabeçalhos reais de
 * cada aba de ano e de TABELA. Um mapa escrito a partir de um comentário de três
 * meses atrás é exatamente o tipo de coisa que devolve número errado com
 * procedência.
 *
 *   node --env-file=.env.local testes/gate/mapear-abas.mjs
 */

import XLSX from 'xlsx';

const ABAS = ['2026', '2025', '2024', 'TABELA'];
/** Onde o cabeçalho mora na aba viva. As outras podem discordar — é o que se mede. */
const LINHAS_DE_TOPO = 6;

async function token() {
  const t = process.env.MS_GRAPH_TENANT_ID?.trim();
  const id = process.env.MS_GRAPH_CLIENT_ID?.trim();
  const seg = process.env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!t || !id || !seg) throw new Error('faltam credenciais de app da Graph');
  const r = await fetch(`https://login.microsoftonline.com/${t}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: seg,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const c = await r.json();
  if (!c.access_token) throw new Error(`Azure recusou: HTTP ${r.status}`);
  return c.access_token;
}

function shareId(url) {
  const b64 = Buffer.from(url, 'utf8').toString('base64');
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

const rotuloColuna = (i) => {
  let s = '';
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

const main = async () => {
  const url = process.env.MS_GRAPH_OCI_URL?.trim();
  if (!url) throw new Error('falta MS_GRAPH_OCI_URL');
  const t = await token();
  const r = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId(url)}/driveItem/content`, {
    headers: { authorization: `Bearer ${t}` },
    signal: AbortSignal.timeout(180000),
  });
  if (!r.ok) throw new Error(`Graph recusou o download: HTTP ${r.status}`);
  const pasta = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' });

  for (const aba of ABAS) {
    const folha = pasta.Sheets[aba];
    console.log(`\n${'='.repeat(70)}\nABA "${aba}"`);
    if (!folha) {
      console.log('  NÃO EXISTE neste arquivo');
      continue;
    }
    const linhas = XLSX.utils.sheet_to_json(folha, { header: 1, raw: true, defval: '' });
    console.log(`  linhas totais: ${linhas.length}`);

    /* As primeiras linhas, coluna a coluna, para achar ONDE está o cabeçalho. */
    for (let i = 0; i < Math.min(LINHAS_DE_TOPO, linhas.length); i += 1) {
      const preenchidas = linhas[i]
        .map((v, j) => [j, String(v ?? '').trim()])
        .filter(([, v]) => v !== '')
        .map(([j, v]) => `${j}:${rotuloColuna(j)}=${v.slice(0, 22)}`);
      if (preenchidas.length > 0) console.log(`  L${i + 1}  ${preenchidas.join(' | ')}`);
    }
  }
};

main().catch((e) => {
  console.error('FALHOU:', e.message ?? e);
  process.exit(1);
});
