/**
 * O ORÁCULO INDEPENDENTE DA PLANILHA — a segunda opinião sobre o número.
 *
 * POR QUE ELE NÃO IMPORTA UMA LINHA DE `ClientePlanilhaOcis`. Se o auditor
 * usasse o mesmo código que produz a resposta, um defeito NELE ficaria invisível
 * para os dois lados — as duas pontas errando juntas, que foi exatamente como o
 * relógio das 18:29 passou por um verificador que usava `toLocaleString` para
 * conferir `toLocaleString`.
 *
 * Então aqui tudo é próprio: o token é pedido de novo ao Azure, o arquivo é
 * baixado por conta própria, a planilha é aberta com o parser cru, e a
 * identidade do motorista é reimplementada A PARTIR DA REGRA ESCRITA — não a
 * partir da função. A duplicação é o instrumento, não um descuido.
 *
 * O QUE ELE COMPARTILHA, e está declarado porque compartilhar em silêncio seria
 * o defeito: o MAPA DE COLUNAS (OCI=4, MOTORISTA=10, primeira linha de dado=5) e
 * o MAPA DE IDENTIDADE DECLARADA. Os dois são fatos sobre a planilha, medidos
 * por gente contra o arquivo real; reimplementá-los "às cegas" não produziria
 * independência, produziria um segundo palpite. O oráculo confere a CONTA, não
 * o layout do arquivo.
 *
 * Uso — as credenciais vêm do ambiente, nunca de argumento:
 *   node --env-file=.env.local testes/gate/oraculo-planilha.mjs
 *
 * Escreve o veredito em JSON no stdout. Nada de segredo sai daqui.
 */

import XLSX from 'xlsx';

const ABA = '2026';
const PRIMEIRA_LINHA_DE_DADO = 5;
const COL_OCI = 4;
const COL_MOTORISTA = 10;

/**
 * As mesmas quatro identidades confirmadas pela operadora. Copiadas de
 * propósito: o oráculo não pode IMPORTAR o mapa, senão herdaria um erro de
 * digitação junto; e não pode ignorá-lo, senão mediria outra coisa.
 */
const IDENTIDADE_DECLARADA = {
  'CLAUDINEI DE SOUZA': 'CLAUDINEI',
  'LOURENCO SAMPAIO': 'LOURENCO',
  'JAIRO GMK': 'JAIRO',
  'CLEITON LAUDIR': 'CLEITON',
};

/** A regra, reescrita a partir do texto: fora parênteses, fora o que vem após " - ". */
function identidade(bruto) {
  const semAcento = bruto.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const semParenteses = semAcento.replace(/\([^)]*\)/g, ' ');
  const semVeiculo = semParenteses.split(/\s+-\s+/)[0];
  const limpo = semVeiculo.replace(/\s+/g, ' ').trim();
  return IDENTIDADE_DECLARADA[limpo] ?? limpo;
}

async function token() {
  const tenant = process.env.MS_GRAPH_TENANT_ID?.trim();
  const id = process.env.MS_GRAPH_CLIENT_ID?.trim();
  const segredo = process.env.MS_GRAPH_CLIENT_SECRET?.trim();
  if (!tenant || !id || !segredo) throw new Error('faltam credenciais de app da Graph no ambiente');

  const r = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: segredo,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!r.ok) throw new Error(`Azure recusou o token: HTTP ${r.status}`);
  const corpo = await r.json();
  if (!corpo.access_token) throw new Error('Azure devolveu resposta sem access_token');
  return corpo.access_token;
}

function shareId(url) {
  const b64 = Buffer.from(url, 'utf8').toString('base64');
  return 'u!' + b64.replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}

async function baixar(t) {
  const url = process.env.MS_GRAPH_OCI_URL?.trim();
  if (!url) throw new Error('falta MS_GRAPH_OCI_URL no ambiente');
  const r = await fetch(
    `https://graph.microsoft.com/v1.0/shares/${shareId(url)}/driveItem/content`,
    { headers: { authorization: `Bearer ${t}` }, signal: AbortSignal.timeout(120000) },
  );
  if (!r.ok) throw new Error(`Graph recusou o download: HTTP ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const main = async () => {
  const bytes = await baixar(await token());
  const pasta = XLSX.read(bytes, { type: 'buffer' });
  const abas = pasta.SheetNames;
  const folha = pasta.Sheets[ABA];
  if (!folha) throw new Error(`o arquivo não tem a aba "${ABA}" (tem: ${abas.join(', ')})`);

  const todas = XLSX.utils.sheet_to_json(folha, { header: 1, raw: true, defval: '' });
  const linhas = todas
    .slice(PRIMEIRA_LINHA_DE_DADO - 1)
    .filter((l) => String(l[COL_OCI] ?? '').trim() !== '');

  const brutos = linhas.map((l) => String(l[COL_MOTORISTA] ?? '').trim());
  const vazios = brutos.filter((m) => m === '').length;
  const preenchidos = brutos.filter((m) => m !== '');

  /* Três contagens, e a diferença entre elas é a história inteira do incidente. */
  const grafiasDistintas = new Set(preenchidos.map((m) => m.toUpperCase())).size;
  const pessoasDistintas = new Set(preenchidos.map(identidade)).size;
  const gruposComVazio = pessoasDistintas + (vazios > 0 ? 1 : 0);

  console.log(
    JSON.stringify(
      {
        oraculo: 'planilha-luft-independente',
        aba: ABA,
        abas_no_arquivo: abas,
        linhas_com_oci: linhas.length,
        ocis_distintas: new Set(linhas.map((l) => String(l[COL_OCI]).trim().toUpperCase())).size,
        motorista: {
          /* O número CERTO para "quantos motoristas temos?". */
          pessoas_distintas: pessoasDistintas,
          /* Se a IARA responder isto, ela contou grafia e não pessoa. */
          grafias_distintas: grafiasDistintas,
          /* Se a IARA responder isto, ela contou GRUPO e ausência virou pessoa. */
          grupos_com_ausencia: gruposComVazio,
          cargas_sem_motorista: vazios,
        },
      },
      null,
      2,
    ),
  );
};

main().catch((e) => {
  console.log(JSON.stringify({ oraculo: 'planilha-luft-independente', erro: String(e.message ?? e) }));
  process.exit(1);
});
