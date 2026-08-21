/** Sonda: confirma que a voz neural responde e mede o tamanho do áudio. Só escreve em preview/. */
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { writeFileSync } from 'node:fs';
const tts = new MsEdgeTTS();
await tts.setMetadata('pt-BR-FranciscaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = await tts.toStream('Bem-vindo ao treinamento de agendamento de coleta.');
const partes = [];
for await (const c of audioStream) partes.push(c);
const b = Buffer.concat(partes);
writeFileSync('preview/sonda-voz.mp3', b);
console.log('BYTES:', b.length);
