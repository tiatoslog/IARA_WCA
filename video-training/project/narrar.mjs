/**
 * narrar.mjs — sintetiza a narração com a voz canônica da IARA.
 *
 * `pt-BR-FranciscaNeural` não é escolha desta produção: é a identidade da IARA,
 * declarada em `servidor/nucleo/Voz.ts` como inegociável. Reusar em vez de
 * escolher outra voz é o que faz o treinamento soar como a mesma pessoa que
 * atende no produto.
 *
 * HONESTIDADE: o provedor neural envia o TEXTO ao serviço da Microsoft — o
 * mesmo que o Edge faz com uma voz "Natural". Por isso nenhuma narração deste
 * roteiro contém nome de pessoa, telefone, e-mail ou número de documento real.
 *
 *   node project/narrar.mjs
 *
 * Idempotente: só sintetiza o que falta ou o que mudou (hash do texto).
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOZ = process.env.IARA_VOZ_EDGE?.trim() || 'pt-BR-FranciscaNeural';
const SAIDA = new URL('../assets/audio/', import.meta.url);
const INDICE = new URL('../assets/audio/indice.json', import.meta.url);

/* Prosódia: -4% de velocidade sobre o padrão. A voz neural padrão soa
 * levemente apressada para conteúdo instrucional — quem está aprendendo
 * precisa de tempo para olhar a tela e ouvir ao mesmo tempo. Abaixo de -8%
 * começa a soar arrastado, que lê como condescendência. */
const TAXA = process.env.IARA_VOZ_TAXA?.trim() || '-4%';
const TOM = '+0Hz';

mkdirSync(SAIDA, { recursive: true });

const falas = JSON.parse(readFileSync(new URL('../assets/audio/falas.json', import.meta.url), 'utf8'));
const indice = existsSync(INDICE) ? JSON.parse(readFileSync(INDICE, 'utf8')) : {};

/** Uma conexão por fala. Reusar o socket entre `setMetadata` dá corrida no
 *  msedge-tts; o custo de reabrir é irrelevante para 40 falas. */
async function sintetizar(texto) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = await tts.toStream(texto, { rate: TAXA, pitch: TOM });
  const partes = [];
  for await (const c of audioStream) partes.push(c);
  return Buffer.concat(partes);
}

let novos = 0;
let reusados = 0;

for (const { id, texto } of falas) {
  if (!texto?.trim()) continue;
  const hash = createHash('sha256').update(`${VOZ}|${TAXA}|${texto}`).digest('hex').slice(0, 16);
  const arquivo = new URL(`${id}.mp3`, SAIDA);

  if (indice[id] === hash && existsSync(arquivo)) {
    reusados += 1;
    continue;
  }

  let bytes;
  for (let tentativa = 1; tentativa <= 3; tentativa += 1) {
    try {
      bytes = await sintetizar(texto);
      break;
    } catch (erro) {
      if (tentativa === 3) throw new Error(`${id}: ${erro.message}`);
      await new Promise((r) => setTimeout(r, 900 * tentativa));
    }
  }

  writeFileSync(arquivo, bytes);
  indice[id] = hash;
  novos += 1;
  process.stdout.write(`${id} ${String(bytes.length).padStart(7)} bytes\n`);
}

writeFileSync(INDICE, JSON.stringify(indice, null, 2));
console.log(`\nvoz: ${VOZ} (${TAXA})  |  sintetizadas: ${novos}  |  reusadas: ${reusados}`);
