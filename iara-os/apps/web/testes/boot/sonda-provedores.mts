/**
 * SONDA DE PROVEDOR EM RUNTIME — itens 13/14 da missão.
 *
 * Nada aqui acredita em configuração. Cada provedor é INSTANCIADO e CHAMADO de
 * verdade, e o desfecho é classificado nos degraus do item 14, porque "chave
 * presente" e "modelo gera texto válido" são afirmações diferentes e a primeira
 * já mentiu duas vezes nesta base (15/08 e 18/08).
 *
 * Não imprime segredo: só apelido, modelo, degrau, latência e a classe do erro.
 */
import { config as carregarEnv } from 'dotenv';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const RAIZ = process.argv[2];
carregarEnv({ path: path.join(RAIZ, '.env.local') });

const { criarProvedorRaciocinio, provedoresDeclarados } = await import(
  pathToFileURL(path.join(RAIZ, 'servidor/nucleo/FabricaRaciocinio.ts')).href
);

type Degrau =
  | 'NAO_DECLARADO'
  | 'DECLARADO'
  | 'INSTANCIADO'
  | 'RESPONDEU'
  | 'SAIDA_VALIDA'
  | 'FALHOU';

interface Linha {
  apelido: string;
  modelo: string;
  degrau: Degrau;
  ms: number;
  classe: string;
  amostra: string;
}

const PERGUNTA = 'Responda apenas com a palavra PRONTO, sem pontuação.';
const PRAZO_MS = 45_000;

/** Classifica o erro do provedor em vocabulário estável (item 15). */
function classificar(e: unknown): string {
  const m = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (/401|unauthor|invalid api key|invalid_api_key/.test(m)) return 'AUTH_FAILURE';
  if (/404|not.?found|does not exist|decommission/.test(m)) return 'MODEL_NOT_FOUND';
  if (/429|rate.?limit/.test(m)) return 'RATE_LIMIT';
  if (/quota|credit|billing|insufficient/.test(m)) return 'QUOTA';
  if (/abort|timeout|timed out|etimedout/.test(m)) return 'TIMEOUT';
  if (/econnrefused|enotfound|network|fetch failed|socket/.test(m)) return 'NETWORK_FAILURE';
  if (/400|invalid.?request|bad request/.test(m)) return 'INVALID_REQUEST';
  if (/5\d\d|unavailable|overloaded/.test(m)) return 'SERVICE_UNAVAILABLE';
  if (/indisponivel|indisponível/.test(m)) return 'PROVIDER_UNAVAILABLE';
  return `UNKNOWN_FAILURE: ${m.slice(0, 120)}`;
}

const declarados: string[] = provedoresDeclarados(process.env);
console.log(`declarados pela fábrica, em ordem: ${declarados.join(' -> ') || '(nenhum)'}`);

const CANDIDATOS = ['groq', 'gemini', 'openrouter', 'anthropic', 'ollama'];
const linhas: Linha[] = [];

for (const escolha of CANDIDATOS) {
  if (!declarados.includes(escolha)) {
    linhas.push({ apelido: escolha, modelo: '-', degrau: 'NAO_DECLARADO', ms: 0, classe: '-', amostra: '' });
    continue;
  }
  const t0 = Date.now();
  let provedor: any;
  try {
    provedor = criarProvedorRaciocinio({ ...process.env, IARA_PROVEDOR: escolha });
  } catch (e) {
    linhas.push({ apelido: escolha, modelo: '-', degrau: 'FALHOU', ms: Date.now() - t0, classe: classificar(e), amostra: '' });
    continue;
  }
  const base = { apelido: provedor.apelido, modelo: provedor.modelo };
  if (!provedor.disponivel) {
    linhas.push({ ...base, degrau: 'INSTANCIADO', ms: Date.now() - t0, classe: 'PROVIDER_UNAVAILABLE', amostra: '' });
    continue;
  }
  const ctrl = new AbortController();
  const relogio = setTimeout(() => ctrl.abort(), PRAZO_MS);
  try {
    const r = await provedor.raciocinar({
      mensagem: PERGUNTA,
      historico: [],
      overridePersona: 'Você responde em uma palavra.',
      camadaGlobal: '',
      sinal: ctrl.signal,
      aoReceberTexto: () => {},
    });
    const ms = Date.now() - t0;
    const texto = (r?.texto ?? '').trim();
    const valido = texto.length > 0 && texto.length < 200;
    linhas.push({
      ...base,
      degrau: valido ? 'SAIDA_VALIDA' : 'RESPONDEU',
      ms,
      classe: valido ? '-' : 'MALFORMED_RESPONSE',
      amostra: texto.replace(/\s+/g, ' ').slice(0, 60),
    });
  } catch (e) {
    linhas.push({ ...base, degrau: 'FALHOU', ms: Date.now() - t0, classe: classificar(e), amostra: '' });
  } finally {
    clearTimeout(relogio);
  }
}

console.log('');
console.log('| provedor | modelo | degrau | ms | classe | amostra |');
console.log('|---|---|---|---|---|---|');
for (const l of linhas) {
  console.log(`| ${l.apelido} | ${l.modelo} | ${l.degrau} | ${l.ms} | ${l.classe} | ${l.amostra} |`);
}
const vivos = linhas.filter((l) => l.degrau === 'SAIDA_VALIDA');
console.log('');
console.log(`PROVEDORES COM SAIDA VALIDA: ${vivos.length} (${vivos.map((v) => v.apelido).join(', ') || 'nenhum'})`);
