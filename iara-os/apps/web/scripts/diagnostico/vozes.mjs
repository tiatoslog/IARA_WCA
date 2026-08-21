/**
 * Lista as vozes disponíveis na conta Convai.
 *
 * Existe porque `CONVAI_VOZ` não é um nome bonito escolhido a dedo: é o
 * `voice_value` exato do catálogo, e errar uma letra dá 4xx sem explicação.
 *
 *   npm run vozes
 *
 * A chave é lida de .env.local e nunca é impressa.
 */

import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: '.env.local' });
carregarEnv();

const CHAVE = (process.env.CONVAI_API_KEY ?? '').trim();

if (!CHAVE) {
  console.error('CONVAI_API_KEY ausente. Preencha em .env.local e rode de novo.');
  process.exit(1);
}

const resposta = await fetch('https://api.convai.com/tts/get_available_voices', {
  headers: { 'CONVAI-API-KEY': CHAVE },
});

if (!resposta.ok) {
  console.error(`Convai respondeu ${resposta.status} ${resposta.statusText}`);
  console.error(await resposta.text().catch(() => ''));
  process.exit(1);
}

const dados = await resposta.json();

// O formato do catálogo já mudou de versão para versão; em vez de assumir uma
// forma, procuramos o primeiro array de objetos e imprimimos o que houver.
const lista = Array.isArray(dados)
  ? dados
  : Object.values(dados).find((v) => Array.isArray(v) && typeof v[0] === 'object');

if (!lista) {
  console.log(JSON.stringify(dados, null, 2));
  process.exit(0);
}

const emPortugues = lista.filter((v) =>
  JSON.stringify(v).toLowerCase().includes('portug') ||
  JSON.stringify(v).toLowerCase().includes('pt-br'),
);

const mostrar = (titulo, itens) => {
  if (itens.length === 0) return;
  console.log(`\n=== ${titulo} (${itens.length}) ===`);
  for (const v of itens) {
    const valor = v.voice_value ?? v.voice_name ?? v.name ?? '?';
    const rotulo = v.voice_name ?? v.name ?? '';
    const extra = [v.gender, v.language, v.language_code].filter(Boolean).join(' · ');
    const tempoReal = JSON.stringify(v).toLowerCase().includes('realtime');
    console.log(
      `  ${String(valor).padEnd(34)} ${rotulo.padEnd(22)} ${extra}` +
        (tempoReal ? '   ⚠️ realtime — não serve para TTS' : ''),
    );
  }
};

mostrar('PORTUGUÊS', emPortugues);
mostrar('TODAS', lista);

console.log('\nCopie o valor da PRIMEIRA coluna para CONVAI_VOZ em .env.local.');
