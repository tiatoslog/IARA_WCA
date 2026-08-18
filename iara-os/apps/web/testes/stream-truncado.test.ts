/**
 * A ÚLTIMA LINHA DO STREAM NÃO PODE SUMIR.
 *
 * O DEFEITO, medido em produção (18/08/2026). A operadora perguntou "o que você
 * consegue fazer por mim?" e recebeu:
 *
 *   "Bastante coisa, na prática. Consigo puxar dados da operação — cargas,
 *    faturamento, motoristas, cent"
 *
 * E parou ali. Para sempre: 38 s depois o texto era o mesmo. Sem erro de
 * console, sem falha registrada em `raciocinio_falhas`, sem nada no jornal — o
 * provedor tinha respondido com SUCESSO. A frase simplesmente foi cortada no
 * meio da palavra, e a IARA a apresentou como se estivesse inteira.
 *
 * A CAUSA. O laço de leitura acumula em `restante`, quebra por `\n` e devolve a
 * última parte ao buffer — porque ela pode estar cortada no meio de um pacote.
 * Correto. O que faltava era o fim:
 *
 *     if (done) break;      // ← sai do laço com `restante` cheio
 *
 * Se o servidor fecha a conexão sem `\n` depois do último `data:`, aquele último
 * pedaço de texto morre no buffer. Ninguém percebe, porque não é erro: é
 * ausência.
 *
 * POR QUE ISTO É PIOR QUE UM ERRO. Uma falha o operador vê e reporta. Uma frase
 * cortada no meio ele lê como resposta — e uma resposta pela metade sobre o que
 * a IARA "consegue fazer" é exatamente a que ele vai usar para decidir se
 * confia nela.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ClienteCompativelOpenAI, OPENROUTER } from '../servidor/nucleo/ClienteCompativelOpenAI';
import type { PedidoRaciocinio } from '../servidor/nucleo/ProvedorRaciocinio';

/** Chave de formato válido — `configUtilizavel` recusa lixo, e com razão. */
const CHAVE_FALSA = 'sk-or-v1-' + 'a'.repeat(48);

const delta = (texto: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: texto } }] })}`;

/** Um corpo SSE literal, byte a byte como o servidor o entregaria. */
function corpoSSE(bruto: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(bruto);
  return new ReadableStream({
    start(controlador) {
      /* Em pedaços pequenos, para exercitar a remontagem entre leituras — é
         assim que chega de verdade, e um corpo inteiro de uma vez esconderia
         justamente o caminho do buffer. */
      for (let i = 0; i < bytes.length; i += 7) {
        controlador.enqueue(bytes.slice(i, i + 7));
      }
      controlador.close();
    },
  });
}

function pedido(sobre: Partial<PedidoRaciocinio> = {}): PedidoRaciocinio {
  return {
    mensagem: 'o que você consegue fazer por mim?',
    historico: [],
    overridePersona: '',
    camadaGlobal: '',
    sinal: new AbortController().signal,
    aoReceberTexto: () => undefined,
    ...sobre,
  };
}

async function responderCom(bruto: string): Promise<{ texto: string; streamado: string }> {
  const chaveOriginal = process.env[OPENROUTER.variavelChave];
  const fetchOriginal = globalThis.fetch;
  process.env[OPENROUTER.variavelChave] = CHAVE_FALSA;
  globalThis.fetch = (async () =>
    new Response(corpoSSE(bruto), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })) as typeof globalThis.fetch;

  let streamado = '';
  try {
    const cliente = new ClienteCompativelOpenAI(OPENROUTER);
    const r = await cliente.raciocinar(pedido({ aoReceberTexto: (p) => (streamado += p) }));
    return { texto: r.texto, streamado };
  } finally {
    globalThis.fetch = fetchOriginal;
    if (chaveOriginal === undefined) delete process.env[OPENROUTER.variavelChave];
    else process.env[OPENROUTER.variavelChave] = chaveOriginal;
  }
}

/** O caso saudável, para o teste seguinte significar alguma coisa. */
test('stream bem-comportado chega inteiro', async () => {
  const { texto } = await responderCom(
    [delta('Consigo puxar dados da operação'), delta(' — cargas e centrais.'), 'data: [DONE]', ''].join(
      '\n',
    ),
  );
  assert.equal(texto, 'Consigo puxar dados da operação — cargas e centrais.');
});

/**
 * A REGRESSÃO. Servidor fecha sem `\n` depois do último `data:` — sem `[DONE]`,
 * que é como uma conexão interrompida ou um proxy impaciente encerram.
 */
test('a última linha sem quebra final não pode ser engolida', async () => {
  const { texto, streamado } = await responderCom(
    [delta('Consigo puxar dados da operação — cargas, faturamento, motoristas,'), delta(' centrais.')].join(
      '\n',
    ),
    // sem '\n' no fim, de propósito
  );

  assert.match(
    texto,
    /centrais\.$/,
    `a resposta terminou em "${texto.slice(-30)}" — o último pedaço morreu no buffer, ` +
      'que é exatamente o corte no meio da palavra que a operadora recebeu em produção.',
  );
  assert.equal(streamado, texto, 'o que foi streamado e o texto final têm que bater');
});

/**
 * O caractere multibyte partido entre duas leituras. `decode(v, {stream:true})`
 * segura o pedaço até completar; sem um `decode()` final, o último caractere
 * pendente some — e em português isso cai justamente nos acentos.
 */
test('acento partido entre dois pacotes sobrevive ao fim do stream', async () => {
  const { texto } = await responderCom(delta('operação'));
  assert.match(texto, /operação$/, `saiu "${texto}" — caractere multibyte perdido no fim do stream`);
});
