/**
 * Detecção do chamado "ei IARA" — a parte pura da vigília de voz.
 *
 * O resto do fluxo (reconhecedor, modos, relógios) vive no navegador e não é
 * testável aqui; a decisão "isto foi um chamado?" é, e é ela que define se a
 * IARA acorda sozinha no meio de uma conversa de escritório.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectarChamado } from '../hooks/useEscuta';

test('"ei IARA" simples acorda', () => {
  const d = detectarChamado('ei IARA');
  assert.equal(d.chamou, true);
  assert.equal(d.resto, '');
});

test('chamado com pedido na mesma frase devolve o pedido', () => {
  const d = detectarChamado('Ei Iara, que horas são?');
  assert.equal(d.chamou, true);
  assert.equal(d.resto, 'que horas são?');
});

test('variações de interjeição e grafia acordam', () => {
  for (const frase of ['hey iara', 'hei iara', 'oi iara', 'ô Iara', 'ei yara']) {
    assert.equal(detectarChamado(frase).chamou, true, `não acordou com: ${frase}`);
  }
});

test('o nome sozinho NÃO acorda — Iara é nome de gente', () => {
  assert.equal(detectarChamado('a Iara mandou o relatório').chamou, false);
  assert.equal(detectarChamado('iara').chamou, false);
});

test('chamado no meio de frase maior acorda e corta certo', () => {
  const d = detectarChamado('então tá bom ei iara abre o bloco de notas');
  assert.equal(d.chamou, true);
  assert.equal(d.resto, 'abre o bloco de notas');
});

test('conversa comum não acorda', () => {
  for (const frase of [
    'vou almoçar agora',
    'a diretoria aprovou o orçamento',
    'ei pessoal, reunião às três',
  ]) {
    assert.equal(detectarChamado(frase).chamou, false, `acordou à toa com: ${frase}`);
  }
});

test('acentos não atrapalham o corte do resto', () => {
  // O "ô" pré-composto tem 1 caractere; o índice do corte precisa continuar
  // valendo no texto original.
  const d = detectarChamado('ô iara crie a pasta Contratos');
  assert.equal(d.chamou, true);
  assert.equal(d.resto, 'crie a pasta Contratos');
});
