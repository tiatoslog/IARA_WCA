/**
 * Normalização de histórico — a função compartilhada pelos provedores.
 *
 * Movida de dentro do `ClienteClaude` para o contrato quando o Ollama chegou;
 * estes testes fixam os três casos que o comentário original documentava e que
 * antes só existiam como prosa: histórico órfão (começa em `iara`), papéis
 * repetidos, e a mensagem corrente já gravada no shard.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizarHistorico } from '../servidor/nucleo/ProvedorRaciocinio';
import type { RegistroMemoria } from '../lib/estado';

let sequencia = 0;
const registro = (papel: 'operador' | 'iara', texto: string): RegistroMemoria => ({
  id: `r-${(sequencia += 1)}`,
  id_usuario: 'op.teste',
  instante: new Date(0).toISOString(),
  papel,
  texto,
});

test('UN-001. histórico começando em `iara` tem o prefixo cortado até o primeiro operador', () => {
  const resultado = normalizarHistorico(
    [registro('iara', 'fala órfã'), registro('operador', 'pergunta'), registro('iara', 'resposta')],
    'pergunta nova',
  );
  assert.deepEqual(
    resultado.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
  assert.equal(resultado[0].content, 'pergunta');
  assert.ok(!resultado.some((m) => m.content.includes('fala órfã')));
});

test('UN-002. dois registros do mesmo papel são fundidos num bloco único', () => {
  const resultado = normalizarHistorico(
    [registro('operador', 'primeira'), registro('operador', 'segunda'), registro('iara', 'ok')],
    'pergunta nova',
  );
  assert.deepEqual(
    resultado.map((m) => m.role),
    ['user', 'assistant', 'user'],
  );
  assert.equal(resultado[0].content, 'primeira\n\nsegunda');
});

test('UN-003. mensagem corrente já gravada não duplica; texto diferente funde', () => {
  const jaGravada = normalizarHistorico(
    [registro('operador', 'pergunta nova')],
    'pergunta nova',
  );
  assert.equal(jaGravada.length, 1);
  assert.equal(jaGravada[0].content, 'pergunta nova');

  const diferente = normalizarHistorico(
    [registro('operador', 'contexto anterior')],
    'pergunta nova',
  );
  assert.equal(diferente.length, 1);
  assert.equal(diferente[0].content, 'contexto anterior\n\npergunta nova');
});

test('UN-004. histórico vazio vira só a mensagem corrente como user', () => {
  const resultado = normalizarHistorico([], 'pergunta solitária');
  assert.deepEqual(resultado, [{ role: 'user', content: 'pergunta solitária' }]);
});

test('a lista sempre termina em user — é o invariante que a API da nuvem exige', () => {
  const resultado = normalizarHistorico(
    [registro('operador', 'a'), registro('iara', 'b')],
    'c',
  );
  assert.equal(resultado[resultado.length - 1].role, 'user');
  assert.equal(resultado[resultado.length - 1].content, 'c');
});
