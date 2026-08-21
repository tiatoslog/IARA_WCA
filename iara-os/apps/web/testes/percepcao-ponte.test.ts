/**
 * Percepção pela PONTE DE VERDADE — WebSocket real, ponte real, motor real.
 *
 * POR QUE ESTE ARQUIVO EXISTE separado de `percepcao-p0.test.ts`. Aquele prova a
 * lógica com o mundo injetado: tela falsa, relógio falso, emissor falso. É o que
 * permite provar o laço em qualquer sistema operacional. O que ele NÃO prova é
 * que o evento atravessa — que `lerPacoteBraco` aceita, que a ponte publica, que
 * `PercepcaoDeTela` recebe e que o estado muda do outro lado.
 *
 * Aqui não há dublê de transporte: sobe um `WebSocketServer` de verdade, um
 * cliente `ws` de verdade se apresenta como braço, e o pacote vai por JSON no
 * socket. Se a validação da fronteira quebrar, este arquivo cai — e é o único
 * que cai por isso.
 *
 * ELE TAMBÉM MEDE O TRÁFEGO. O requisito §20 pede MB enviados; a resposta não
 * pode ser uma estimativa, e aqui ela é o `Buffer.byteLength` do que de fato foi
 * escrito no socket.
 */

import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';

import { ponteDispositivos } from '../servidor/barramento/PonteDispositivos';
import { ligarPercepcaoNaPonte, percepcaoDeTela } from '../servidor/nucleo/PercepcaoDeTela';
import type { EventoVisual } from '../lib/percepcao';

const OPERADOR = 'u-percepcao-ponte';
const SESSAO = 'sp-ponte-1';

let servidor: WebSocketServer;
let porta = 0;
let desligarPercepcao: (() => void) | null = null;

before(async () => {
  servidor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => servidor.on('listening', () => r()));
  porta = (servidor.address() as { port: number }).port;
  servidor.on('connection', (ws) => ponteDispositivos.conectar(ws));
  desligarPercepcao = ligarPercepcaoNaPonte(ponteDispositivos);
});

after(async () => {
  desligarPercepcao?.();
  percepcaoDeTela.limpar();
  ponteDispositivos.encerrar();
  await new Promise<void>((r) => servidor.close(() => r()));
});

beforeEach(() => percepcaoDeTela.limpar());

/** Um braço de verdade: socket real, pacotes reais, apresentação real. */
async function abrirBraco(): Promise<{
  ws: WebSocket;
  enviar(pacote: unknown): number;
  bytes: number;
  fechar(): Promise<void>;
} | null> {
  const ws = new WebSocket(`ws://127.0.0.1:${porta}`, { headers: { Origin: 'http://localhost' } });
  await new Promise<void>((r, j) => {
    ws.on('open', () => r());
    ws.on('error', j);
  });

  let bytes = 0;
  const enviar = (pacote: unknown): number => {
    const corpo = JSON.stringify(pacote);
    bytes += Buffer.byteLength(corpo, 'utf8');
    ws.send(corpo);
    return Buffer.byteLength(corpo, 'utf8');
  };

  const primeira = new Promise<Record<string, unknown>>((r) => {
    ws.once('message', (d) => r(JSON.parse(d.toString()) as Record<string, unknown>));
  });

  enviar({
    tipo: 'apresentacao',
    id_usuario: OPERADOR,
    nome: 'maquina-de-teste',
    plataforma: 'teste',
    versao: '1.3.0',
  });

  const resposta = await primeira;
  if (resposta.tipo !== 'bem_vindo') {
    /* Motor com autenticação ligada recusa braço sem token. É configuração do
       ambiente, não defeito do código — dizer isso é melhor que falhar acusando
       a percepção. */
    ws.close();
    return null;
  }

  return {
    ws,
    enviar,
    get bytes() {
      return bytes;
    },
    fechar: () =>
      new Promise<void>((r) => {
        ws.on('close', () => r());
        ws.close();
      }),
  };
}

function evento(over: Partial<EventoVisual> = {}): EventoVisual {
  return {
    tipo: 'mudanca_visual',
    sessao_percepcao: SESSAO,
    instante: new Date().toISOString(),
    janela: { processo: 'gw', assinatura: 'consulta de coleta', largura: 1382, altura: 744 },
    hash: 'a1b2c3d4e5f60718',
    distancia: 24,
    origem: 'hash_de_quadro',
    motivo: '',
    texto: '',
    ...over,
  };
}

/** Espera o estado aparecer. A ponte é assíncrona: `send` não é `recebido`. */
async function esperarEstado(previsao: (n: number) => boolean, prazoMs = 2_000) {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    const estado = percepcaoDeTela.ativaDe(OPERADOR);
    if (estado && previsao(estado.mudancas)) return estado;
    await new Promise((r) => setTimeout(r, 20));
  }
  return percepcaoDeTela.ativaDe(OPERADOR);
}

// ---------------------------------------------------------------------------

test('W1. o evento visual atravessa o WebSocket e vira EstadoVisual', async (t) => {
  const braco = await abrirBraco();
  if (!braco) {
    t.skip('o motor exigiu token: autenticação ligada neste ambiente');
    return;
  }
  try {
    braco.enviar({
      tipo: 'percepcao',
      evento: evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, janela: null, motivo: 'aceite no console' }),
    });
    braco.enviar({ tipo: 'percepcao', evento: evento() });

    const estado = await esperarEstado((n) => n >= 1);
    assert.ok(estado, 'nada chegou ao motor');
    assert.equal(estado!.id_usuario, OPERADOR);
    assert.equal(estado!.sessao_percepcao, SESSAO);
    assert.equal(estado!.estado, 'ativa');
    assert.equal(estado!.mudancas, 1);
    assert.equal(estado!.hash, 'a1b2c3d4e5f60718');
    assert.equal(estado!.janela?.processo, 'gw');
  } finally {
    await braco.fechar();
  }
});

test('W2. suspensão e retomada atravessam e mudam o estado', async (t) => {
  const braco = await abrirBraco();
  if (!braco) {
    t.skip('autenticação ligada neste ambiente');
    return;
  }
  try {
    braco.enviar({
      tipo: 'percepcao',
      evento: evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, janela: null, motivo: 'aceite' }),
    });
    braco.enviar({
      tipo: 'percepcao',
      evento: evento({
        tipo: 'percepcao_suspensa',
        hash: null,
        distancia: null,
        janela: null,
        motivo: 'janela fora do escopo autorizado (whatsapp)',
      }),
    });

    const limite = Date.now() + 2_000;
    let estado = percepcaoDeTela.ativaDe(OPERADOR);
    while (Date.now() < limite && estado?.estado !== 'suspensa') {
      await new Promise((r) => setTimeout(r, 20));
      estado = percepcaoDeTela.ativaDe(OPERADOR);
    }
    assert.equal(estado?.estado, 'suspensa', 'a suspensão não chegou');
    assert.notEqual(estado?.estado, 'encerrada', 'suspensa virou encerrada');
    assert.match(estado!.motivo, /fora do escopo/);
  } finally {
    await braco.fechar();
  }
});

test('W3. QUADRO NO PACOTE não atravessa — nem chega ao estado', async (t) => {
  const braco = await abrirBraco();
  if (!braco) {
    t.skip('autenticação ligada neste ambiente');
    return;
  }
  try {
    braco.enviar({
      tipo: 'percepcao',
      evento: evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, janela: null, motivo: 'aceite' }),
    });
    await esperarEstado(() => true, 500);

    /* Um braço adulterado tentando subir a tela. O pacote é recusado inteiro na
       fronteira; nada é aplicado, nada é registrado, e o estado não anda. */
    const antes = percepcaoDeTela.ativaDe(OPERADOR)?.mudancas ?? 0;
    for (const contrabando of [
      { ...evento(), png: 'iVBORw0KGgoAAAANSUhEUg==' },
      { ...evento(), cinza: new Array(1024).fill(128) },
      { ...evento(), screenshot: 'data:image/png;base64,AAA' },
    ]) {
      braco.enviar({ tipo: 'percepcao', evento: contrabando });
    }
    await new Promise((r) => setTimeout(r, 300));

    assert.equal(
      percepcaoDeTela.ativaDe(OPERADOR)?.mudancas ?? 0,
      antes,
      'um pacote com imagem foi aplicado ao estado',
    );
  } finally {
    await braco.fechar();
  }
});

test('W4. o tráfego de um evento é da ordem de centenas de bytes', async (t) => {
  const braco = await abrirBraco();
  if (!braco) {
    t.skip('autenticação ligada neste ambiente');
    return;
  }
  try {
    const bytes = braco.enviar({ tipo: 'percepcao', evento: evento() });
    /* A conta que justifica a arquitetura: um PNG de tela cheia passa de 1 MB.
       Se este número um dia passar de 2 KB, alguém acrescentou conteúdo ao
       evento — e o teste é onde isso aparece antes de virar conta de rede. */
    assert.ok(bytes < 2_048, `evento com ${bytes} bytes: grande demais para ser só metadado`);
    assert.ok(bytes > 100, 'evento suspeito de estar vazio');
    console.log(`[medição] tráfego de um evento visual: ${bytes} bytes`);
  } finally {
    await braco.fechar();
  }
});

test('W5. o evento de um operador não vira estado de outro', async (t) => {
  const braco = await abrirBraco();
  if (!braco) {
    t.skip('autenticação ligada neste ambiente');
    return;
  }
  try {
    braco.enviar({
      tipo: 'percepcao',
      evento: evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, janela: null, motivo: 'aceite' }),
    });
    await esperarEstado(() => true, 500);
    assert.equal(percepcaoDeTela.de('outro-operador').length, 0);
    assert.equal(percepcaoDeTela.de(OPERADOR).length, 1);
  } finally {
    await braco.fechar();
  }
});
