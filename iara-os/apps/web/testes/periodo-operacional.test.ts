/**
 * PeriodoOperacional — tradução de frase para intervalo de dias. Mesmo
 * espírito dos testes de `Quando.ts`: `agora` fixo, para o teste não
 * depender de quando ele roda.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretarPeriodo } from '../servidor/nucleo/kernel/PeriodoOperacional';

// Sexta-feira, 14/08/2026 — a mesma data usada na auditoria da planilha.
const SEXTA = new Date(2026, 7, 14, 10, 0, 0);

test('"hoje" devolve o próprio dia', () => {
  const p = interpretarPeriodo('quantas cargas hoje?', SEXTA);
  assert.ok(p);
  assert.equal(p!.inicio, '2026-08-14');
  assert.equal(p!.fim, '2026-08-14');
  assert.match(p!.rotulo, /hoje/);
});

test('"amanhã" avança um dia', () => {
  const p = interpretarPeriodo('e amanhã, quantas?', SEXTA);
  assert.equal(p!.inicio, '2026-08-15');
  assert.equal(p!.fim, '2026-08-15');
});

test('"depois de amanhã" avança dois dias', () => {
  const p = interpretarPeriodo('depois de amanhã', SEXTA);
  assert.equal(p!.inicio, '2026-08-16');
  assert.equal(p!.fim, '2026-08-16');
});

test('"ontem" recua um dia', () => {
  const p = interpretarPeriodo('ontem', SEXTA);
  assert.equal(p!.inicio, '2026-08-13');
  assert.equal(p!.fim, '2026-08-13');
});

test('"essa semana" é segunda a sexta da semana corrente', () => {
  const p = interpretarPeriodo('essa semana', SEXTA);
  assert.equal(p!.inicio, '2026-08-10'); // segunda
  assert.equal(p!.fim, '2026-08-14'); // sexta (hoje)
});

test('"essa semana" pedido num sábado ainda resolve a semana que passou', () => {
  const sabado = new Date(2026, 7, 15, 10, 0, 0); // sábado 15/08
  const p = interpretarPeriodo('essa semana', sabado);
  assert.equal(p!.inicio, '2026-08-10');
  assert.equal(p!.fim, '2026-08-14');
});

test('"semana que vem" é a próxima segunda a sexta', () => {
  const p = interpretarPeriodo('semana que vem', SEXTA);
  assert.equal(p!.inicio, '2026-08-17');
  assert.equal(p!.fim, '2026-08-21');
});

test('data explícita "17/08" assume o ano corrente', () => {
  const p = interpretarPeriodo('cargas do dia 17/08', SEXTA);
  assert.equal(p!.inicio, '2026-08-17');
  assert.equal(p!.fim, '2026-08-17');
});

test('data explícita com ano', () => {
  const p = interpretarPeriodo('01/09/2026', SEXTA);
  assert.equal(p!.inicio, '2026-09-01');
});

test('data inválida (32/13) devolve null, nunca um palpite', () => {
  assert.equal(interpretarPeriodo('32/13', SEXTA), null);
});

test('frase sem nenhum período reconhecível devolve null', () => {
  assert.equal(interpretarPeriodo('me conta uma piada', SEXTA), null);
  assert.equal(interpretarPeriodo('', SEXTA), null);
});

test('rótulo sempre repete o que foi entendido, para ser corrigível', () => {
  const p = interpretarPeriodo('essa semana', SEXTA);
  assert.match(p!.rotulo, /10\/08 a 14\/08/);
});
