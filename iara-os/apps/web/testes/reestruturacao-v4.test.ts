/**
 * Regressões da reestruturação V4 (performance + runtime).
 *
 * Cada teste aqui trava um bug encontrado na auditoria de 08/08/2026:
 *  1. Snapshot idêntico NÃO é reemitido (re-render da app inteira em ócio).
 *  2. Hidratação SEMPRE emite, mesmo idêntica (reconexão zerou a guarda).
 *  3. A sessão drena sob demanda — sem interval fixo acordando o event loop.
 *  4. A guarda de eco reconhece a voz da própria IARA voltando pelo microfone.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { PonteProjecao } from '../servidor/barramento/PonteProjecao';
import { SessaoOperador } from '../servidor/barramento/SessaoOperador';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../servidor/nucleo/kernel/CompiladorSnapshot';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { pareceEco } from '../hooks/useEscuta';
import { diagnosticoVoz, vozDisponivel } from '../servidor/nucleo/Voz';
import type { WebSocket } from 'ws';

/** Socket falso: grava o que seria enviado. */
function socketFalso() {
  const enviados: string[] = [];
  const socket = new EventEmitter() as unknown as WebSocket & { enviados: string[] };
  Object.assign(socket, {
    readyState: 1,
    bufferedAmount: 0,
    enviados,
    send: (dado: string) => enviados.push(dado),
    close: () => undefined,
  });
  return socket as WebSocket & { enviados: string[]; bufferedAmount: number };
}

function montarPonte() {
  const estado = new EstadoAtomico();
  const barramento = new BarramentoEventos('teste');
  const compilador = new CompiladorSnapshot(barramento, new MemoriaTrabalho());
  const socket = socketFalso();
  const sessao = new SessaoOperador(socket);
  const sessoes = new Set([sessao]);
  const ponte = new PonteProjecao(barramento, compilador, estado, sessoes);
  return { ponte, socket, sessao, barramento, compilador };
}

function snapshotsDe(socket: { enviados: string[] }) {
  return socket.enviados
    .map((s) => JSON.parse(s) as { tipo: string })
    .filter((p) => p.tipo === 'snapshot');
}

test('snapshot estruturalmente idêntico não é reemitido', async () => {
  const { ponte, socket, sessao, barramento } = montarPonte();
  ponte.hidratar();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(snapshotsDe(socket).length, 1, 'a hidratação inicial emite um snapshot');

  /**
   * Emissão NÃO forçada com estado idêntico: é o caminho do "respirar" do
   * ciclo autônomo (15 s) e de qualquer rajada que não mudou nada visível.
   * `seq`/`instante` seriam novos, o conteúdo não — a assinatura estrutural
   * precisa segurar o pacote. Era isto que re-renderizava a aplicação
   * inteira em ócio.
   */
  (ponte as unknown as { emitir(forcar?: boolean): void }).emitir();
  (ponte as unknown as { emitir(forcar?: boolean): void }).emitir();
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(
    snapshotsDe(socket).length,
    1,
    'estado idêntico compilado de novo não vira snapshot novo no fio',
  );

  /**
   * E quando o estado MUDA de verdade (evento no traço mexe na telemetria),
   * a emissão passa — dedup nunca pode virar censura de estado novo.
   */
  barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'mudança real' });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(
    snapshotsDe(socket).length,
    2,
    'estado diferente atravessa o dedup normalmente',
  );

  ponte.encerrar();
  sessao.fechar();
});

test('hidratação sempre emite, mesmo com estado idêntico (reconexão)', async () => {
  const { ponte, socket, sessao } = montarPonte();
  ponte.hidratar();
  ponte.hidratar(); // reconexão: a tela zerou a guarda de seq e precisa do estado
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(
    snapshotsDe(socket).length,
    2,
    'duas hidratações = duas emissões, idênticas ou não',
  );
  ponte.encerrar();
  sessao.fechar();
});

test('sessão drena log sob demanda, dentro da janela de aglutinação', async () => {
  const socket = socketFalso();
  const sessao = new SessaoOperador(socket);
  sessao.emitirLog('info', 'primeira linha');
  assert.equal(socket.enviados.length, 0, 'log espera a janela de aglutinação');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(socket.enviados.length, 1, 'a janela venceu e o log saiu sozinho');
  sessao.fechar();
});

test('sessão reagenda drenagem quando o socket está com backpressure', async () => {
  const socket = socketFalso();
  (socket as { bufferedAmount: number }).bufferedAmount = 2_000_000;
  const sessao = new SessaoOperador(socket);
  sessao.emitirLog('info', 'linha presa no backpressure');
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(socket.enviados.length, 0, 'nada sai enquanto o buffer do SO está cheio');
  (socket as { bufferedAmount: number }).bufferedAmount = 0;
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(socket.enviados.length, 1, 'o buffer esvaziou e a fila drenou');
  sessao.fechar();
});

test('provedor de voz: neural do Edge por padrão, Convai com chave, desligável', () => {
  const antes = {
    convaiChave: process.env.CONVAI_API_KEY,
    convaiVoz: process.env.CONVAI_VOZ,
    neural: process.env.IARA_VOZ_NEURAL,
  };
  try {
    delete process.env.CONVAI_API_KEY;
    delete process.env.CONVAI_VOZ;
    delete process.env.IARA_VOZ_NEURAL;
    assert.equal(vozDisponivel(), true, 'sem configuração nenhuma, o neural grátis assume');
    assert.match(diagnosticoVoz(), /neural do Edge/);

    process.env.IARA_VOZ_NEURAL = '0';
    assert.equal(vozDisponivel(), false, 'IARA_VOZ_NEURAL=0 desliga a voz do servidor');

    process.env.CONVAI_API_KEY = 'chave-teste';
    process.env.CONVAI_VOZ = 'voz-teste';
    assert.equal(vozDisponivel(), true);
    assert.match(diagnosticoVoz(), /Convai/, 'Convai configurada tem precedência');
  } finally {
    if (antes.convaiChave === undefined) delete process.env.CONVAI_API_KEY;
    else process.env.CONVAI_API_KEY = antes.convaiChave;
    if (antes.convaiVoz === undefined) delete process.env.CONVAI_VOZ;
    else process.env.CONVAI_VOZ = antes.convaiVoz;
    if (antes.neural === undefined) delete process.env.IARA_VOZ_NEURAL;
    else process.env.IARA_VOZ_NEURAL = antes.neural;
  }
});

test('guarda de eco: a fala da própria IARA não é interrupção nem pergunta', () => {
  const falaDaIara =
    'Encontrei três centrais ativas em Mato Grosso: Cuiabá, Rondonópolis e Sinop.';
  // Fragmentos que o reconhecedor devolveria ouvindo o alto-falante:
  assert.equal(pareceEco('três centrais ativas', falaDaIara), true);
  assert.equal(pareceEco('Cuiabá Rondonópolis e Sinop', falaDaIara), true);
  assert.equal(pareceEco('encontrei três centrais', falaDaIara), true);
  // Ruído curto nunca vale interrupção:
  assert.equal(pareceEco('ãã', falaDaIara), true);
  // Gente de verdade cortando a IARA passa:
  assert.equal(pareceEco('para, espera um pouco', falaDaIara), false);
  assert.equal(pareceEco('não era isso que eu pedi', falaDaIara), false);
  // Sem fala em curso, nada é eco:
  assert.equal(pareceEco('qualquer coisa', null), false);
});
