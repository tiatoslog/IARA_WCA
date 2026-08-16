/**
 * A PERGUNTA DO OPERADOR ATRAVESSA A FRONTEIRA — relatado em 16/08/2026:
 * "se eu mando uma mensagem pelo celular, ela não aparece no pc".
 *
 * A causa não era rede nem sessão. O snapshot projetava a fala da IARA para
 * todos os espelhos do operador, mas a frase DELE nunca saía do aparelho que a
 * digitou: `useIaraSocket.enviar` acrescentava a bolha na lista local e mandava
 * só o texto pelo socket. O computador recebia a resposta sem a pergunta — uma
 * IARA falando sozinha sobre um assunto que ninguém ali tinha levantado.
 *
 * Estes testes prendem as três propriedades que fazem a conversa ser a mesma
 * nos dois aparelhos:
 *
 *   1. a pergunta É projetada no snapshot, com identidade;
 *   2. a identidade vem do CLIENTE, para o aparelho de origem reconhecer a
 *      própria bolha em vez de duplicá-la — inclusive quando a mesma frase é
 *      mandada duas vezes seguidas;
 *   3. ela sobrevive ao fim do turno, para o espelho que conecta depois ver o
 *      par pergunta/resposta e não uma resposta órfã.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../servidor/nucleo/kernel/CompiladorSnapshot';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { lerPacoteCliente } from '../lib/protocolo';

function montar() {
  const barramento = new BarramentoEventos('s-espelho');
  const compilador = new CompiladorSnapshot(barramento, new MemoriaTrabalho());
  const estado = new EstadoAtomico();
  return { barramento, compilador, estado };
}

test('antes do primeiro turno não há pergunta — null, não bolha vazia', () => {
  const { compilador, estado } = montar();
  const s = compilador.compilar(estado.instantaneo(), 's-espelho', 0);
  assert.equal(s.pergunta, null);
});

test('a frase do operador é projetada no snapshot, com o id que o cliente deu', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();
  barramento.publicar({
    tipo: 'MENSAGEM_RECEBIDA',
    texto: 'abre o bloco de notas',
    id_mensagem: 'op:k3f9-a1b2c3',
  });

  const s = compilador.compilar(estado.instantaneo(), 's-espelho', 0);
  assert.equal(s.pergunta?.texto, 'abre o bloco de notas');
  assert.equal(s.pergunta?.id, 'op:k3f9-a1b2c3');
});

test('a pergunta sobrevive ao turno: quem conecta depois vê o par, não a resposta órfã', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();
  barramento.publicar({
    tipo: 'MENSAGEM_RECEBIDA',
    texto: 'que horas são?',
    id_mensagem: 'op:um',
  });
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'resp-1',
    texto: 'São 22h10.',
    rota: 'local',
    ms: 12,
  });

  const s = compilador.compilar(estado.instantaneo(), 's-espelho', 0);
  assert.equal(s.fala?.texto, 'São 22h10.');
  assert.equal(s.pergunta?.texto, 'que horas são?');
});

test('turno novo substitui a pergunta — nunca se veem duas perguntas ao mesmo tempo', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'primeira', id_mensagem: 'op:um' });
  barramento.novoTraco();
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'segunda', id_mensagem: 'op:dois' });

  const s = compilador.compilar(estado.instantaneo(), 's-espelho', 0);
  assert.equal(s.pergunta?.texto, 'segunda');
  assert.equal(s.pergunta?.id, 'op:dois');
});

/**
 * A MESMA FRASE DUAS VEZES é o caso que uma deduplicação por texto erraria — e
 * é exatamente o que a pessoa faz quando acha que a primeira não chegou. Os dois
 * turnos precisam ter identidades diferentes para virarem duas bolhas.
 */
test('duas mensagens idênticas seguidas têm ids diferentes', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'oi', id_mensagem: 'op:um' });
  const primeira = compilador.compilar(estado.instantaneo(), 's-espelho', 0);

  barramento.novoTraco();
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'oi', id_mensagem: 'op:dois' });
  const segunda = compilador.compilar(estado.instantaneo(), 's-espelho', 0);

  assert.equal(primeira.pergunta?.texto, segunda.pergunta?.texto);
  assert.notEqual(primeira.pergunta?.id, segunda.pergunta?.id);
});

// ---------------------------------------------------------------------------
// A fronteira: o id vem da rede, e o que vem da rede entra com forma declarada
// ---------------------------------------------------------------------------

test('o id do cliente é aceito quando tem forma inerte', () => {
  const p = lerPacoteCliente(JSON.stringify({ tipo: 'mensagem', texto: 'oi', id_local: 'k3f9-a1b2' }));
  assert.equal(p?.tipo, 'mensagem');
  assert.equal(p?.tipo === 'mensagem' ? p.id_local : null, 'k3f9-a1b2');
});

test('id malformado é DESCARTADO e a mensagem passa — a frase não se perde por causa do id', () => {
  for (const ruim of ['<script>', 'a'.repeat(65), 'com espaço', '', 'a/b']) {
    const p = lerPacoteCliente(JSON.stringify({ tipo: 'mensagem', texto: 'oi', id_local: ruim }));
    assert.equal(p?.tipo, 'mensagem', `pacote descartado por causa do id ${JSON.stringify(ruim)}`);
    assert.equal(
      p?.tipo === 'mensagem' ? p.id_local : 'ausente',
      undefined,
      `id inválido aceito: ${JSON.stringify(ruim)}`,
    );
  }
});

test('cliente antigo, sem id_local, continua funcionando', () => {
  const p = lerPacoteCliente(JSON.stringify({ tipo: 'mensagem', texto: 'oi' }));
  assert.equal(p?.tipo, 'mensagem');
  assert.equal(p?.tipo === 'mensagem' ? p.id_local : 'ausente', undefined);
});
