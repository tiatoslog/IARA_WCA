/**
 * Origem do raciocínio no estado e no snapshot.
 *
 * `nuvem_indisponivel` preservou a semântica original ("a nuvem Anthropic não
 * está utilizável") quando `origem_raciocinio` chegou — e os dois são gravados
 * SOB A MESMA TRAVA, porque uma janela entre eles faria a projeção afirmar
 * "sem nuvem" e "sem origem" ao mesmo tempo. Estes testes fixam a coerência.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../servidor/nucleo/kernel/CompiladorSnapshot';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { estadoInicial } from '../lib/estado';

test('UN-040. origem local: origem gravada E nuvem_indisponivel true, na mesma escrita', async () => {
  const estado = new EstadoAtomico();
  await estado.definirOrigemRaciocinio('local');
  const retrato = estado.instantaneo();
  assert.equal(retrato.origem_raciocinio, 'local');
  assert.equal(retrato.nuvem_indisponivel, true);
});

test('UN-041. origem nuvem: nuvem_indisponivel volta a false', async () => {
  const estado = new EstadoAtomico();
  await estado.definirOrigemRaciocinio('local');
  await estado.definirOrigemRaciocinio('nuvem');
  const retrato = estado.instantaneo();
  assert.equal(retrato.origem_raciocinio, 'nuvem');
  assert.equal(retrato.nuvem_indisponivel, false);
});

test('origem nenhuma: sem provedor, o aviso clássico continua verdadeiro', async () => {
  const estado = new EstadoAtomico();
  await estado.definirOrigemRaciocinio('nenhuma');
  const retrato = estado.instantaneo();
  assert.equal(retrato.origem_raciocinio, 'nenhuma');
  assert.equal(retrato.nuvem_indisponivel, true);
});

test('o estado inicial nasce com origem nenhuma — nunca anuncia provedor antes da sonda', () => {
  assert.equal(estadoInicial().origem_raciocinio, 'nenhuma');
});

test('UN-042. o snapshot compilado carrega a origem — a projeção enxerga o campo', async () => {
  const barramento = new BarramentoEventos('s-origem');
  const compilador = new CompiladorSnapshot(barramento, new MemoriaTrabalho());
  const estado = new EstadoAtomico();

  await estado.definirOrigemRaciocinio('local');
  const snapshot = compilador.compilar(estado.instantaneo(), 's-origem', 0);
  assert.equal(snapshot.origem_raciocinio, 'local');
  assert.equal(snapshot.nuvem_indisponivel, true);

  compilador.encerrar();
});
