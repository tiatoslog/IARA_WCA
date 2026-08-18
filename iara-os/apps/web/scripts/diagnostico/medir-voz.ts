/**
 * Cronômetro do caminho de voz. `npm run medir:voz`
 *
 * POR QUE ISTO EXISTE: até 12/08/2026 ninguém sabia onde os ~7 s entre enviar a
 * mensagem e ouvir a IARA eram gastos — e sem saber, toda correção seria chute
 * (baixar um timeout, aumentar um buffer). Este script mede o trecho que o
 * servidor controla: quanto custa transformar texto em áudio.
 *
 * O que ele NÃO mede: o tempo do kernel (aparece como `latência` no HUD de cada
 * turno) e o tempo de rede até o navegador (localhost, desprezível). Somando os
 * três se fecha T0..T5.
 *
 * A pergunta que ele responde: vale a pena segmentar a síntese? Se sintetizar
 * uma sentença custa quase o mesmo que sintetizar cinco, segmentar não paga o
 * preço em complexidade — o custo é de conexão, não de comprimento.
 */

import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const VOZ = (process.env.IARA_VOZ_EDGE ?? '').trim() || 'pt-BR-FranciscaNeural';

const AMOSTRAS: ReadonlyArray<readonly [string, string]> = [
  ['1 sentença', 'Provavelmente não chove hoje em Cuiabá: 12% de probabilidade.'],
  [
    '3 sentenças',
    'Provavelmente não chove hoje em Cuiabá: 12% de probabilidade, 0 mm previstos, ' +
      'céu limpo, entre 21 °C e 33 °C. É previsão de modelo numérico, não medição. ' +
      'Se quiser a medição do instante, eu leio a estação agora.',
  ],
  [
    '6 sentenças',
    'Verifiquei os registros de infraestrutura: 8 centrais ativas em toda a operação, ' +
      'somando 214 veículos vinculados. Uma está fora de operação. ' +
      'O histórico mostra que esse mesmo erro apareceu em março. ' +
      'A resolução adotada na época foi reiniciar o pool de conexões. ' +
      'Posso abrir o procedimento interno, se ajudar. ' +
      'Me diga se quer que eu execute alguma coisa.',
  ],
];

async function sintetizar(texto: string): Promise<{ ms: number; msPrimeiroByte: number; bytes: number }> {
  const t0 = Date.now();
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOZ, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const { audioStream } = tts.toStream(texto);

  let msPrimeiroByte = -1;
  const bytes = await new Promise<Buffer>((ok, falhar) => {
    const pedacos: Buffer[] = [];
    const limite = setTimeout(() => falhar(new Error('excedeu 20 s')), 20_000);
    audioStream.on('data', (c: Buffer) => {
      if (msPrimeiroByte < 0) msPrimeiroByte = Date.now() - t0;
      pedacos.push(c);
    });
    audioStream.on('end', () => {
      clearTimeout(limite);
      ok(Buffer.concat(pedacos));
    });
    audioStream.on('error', (e: Error) => {
      clearTimeout(limite);
      falhar(e);
    });
  });
  tts.close();
  return { ms: Date.now() - t0, msPrimeiroByte, bytes: bytes.length };
}

console.log(`voz: ${VOZ}\n`);
console.log('amostra        completo  1º byte    bytes');
console.log('------------------------------------------');
for (const [nome, texto] of AMOSTRAS) {
  try {
    const r = await sintetizar(texto);
    console.log(
      `${nome.padEnd(14)} ${String(r.ms).padStart(6)}ms ${String(r.msPrimeiroByte).padStart(7)}ms ` +
        `${String(r.bytes).padStart(8)}`,
    );
  } catch (e) {
    console.log(`${nome.padEnd(14)} FALHOU: ${(e as Error).message}`);
  }
}
