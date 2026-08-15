/**
 * SUGESTÕES PERSONALIZADAS — a aritmética dos atalhos da sala vazia.
 *
 * O que não pode acontecer: uma pergunta feita UMA vez virar atalho (isso é
 * histórico, não frequência); variações de caixa/pontuação contarem separado
 * (a frequência real nunca apareceria); e o localStorage corrompido derrubar
 * a tela (é entrada externa).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  chaveDePergunta,
  lerHistorico,
  registrarPergunta,
  sugerir,
  type PerguntaContada,
} from '../lib/sugestoes';

const PADRAO = ['Vai chover hoje?', 'Quantas centrais ativas temos em MT?', 'Crie uma pasta'];

test('variações de caixa, espaço e pontuação final são a MESMA pergunta', () => {
  const chaves = new Set(
    ['Vai chover hoje?', 'vai chover hoje', 'VAI  CHOVER HOJE??', ' vai chover hoje? '].map(
      chaveDePergunta,
    ),
  );
  assert.equal(chaves.size, 1);
});

test('uma pergunta feita uma vez NÃO vira atalho; duas vezes vira', () => {
  let h: PerguntaContada[] = [];
  h = registrarPergunta(h, 'Como está o pátio?', 1000);
  assert.deepEqual(sugerir(h, PADRAO), PADRAO);

  h = registrarPergunta(h, 'como está o pátio', 2000);
  const s = sugerir(h, PADRAO);
  assert.equal(s[0], 'como está o pátio'); // grafia mais recente vence
  assert.equal(s.length, 3);
  // As padrão completam as vagas restantes, sem repetir.
  assert.deepEqual(s.slice(1), PADRAO.slice(0, 2));
});

test('as mais frequentes vêm primeiro, no máximo 3, sem duplicar as padrão', () => {
  let h: PerguntaContada[] = [];
  for (let i = 0; i < 5; i += 1) h = registrarPergunta(h, 'Vai chover hoje?', i);
  for (let i = 0; i < 3; i += 1) h = registrarPergunta(h, 'Cadê o caminhão 12?', 100 + i);
  for (let i = 0; i < 2; i += 1) h = registrarPergunta(h, 'Abra a planilha da Vania', 200 + i);
  h = registrarPergunta(h, 'pergunta avulsa', 999);

  const s = sugerir(h, PADRAO);
  assert.deepEqual(s, ['Vai chover hoje?', 'Cadê o caminhão 12?', 'Abra a planilha da Vania']);
});

test('pergunta-parágrafo continua contada mas nunca vira atalho', () => {
  let h: PerguntaContada[] = [];
  const longa = 'x'.repeat(200);
  h = registrarPergunta(h, longa, 1);
  h = registrarPergunta(h, longa, 2);
  assert.deepEqual(sugerir(h, PADRAO), PADRAO);
});

test('histórico é podado e o mais recente sobrevive', () => {
  let h: PerguntaContada[] = [];
  for (let i = 0; i < 250; i += 1) h = registrarPergunta(h, `pergunta ${i}`, i);
  assert.ok(h.length <= 200);
  assert.equal(h[0].texto, 'pergunta 249');
});

test('lerHistorico aguenta lixo: null, JSON inválido, formatos errados', () => {
  assert.deepEqual(lerHistorico(null), []);
  assert.deepEqual(lerHistorico('não é json'), []);
  assert.deepEqual(lerHistorico('{"a":1}'), []);
  assert.deepEqual(lerHistorico('[{"texto":1,"vezes":"x"}]'), []);
  const ok = lerHistorico('[{"texto":"oi","vezes":2,"ultima_em":5}]');
  assert.equal(ok.length, 1);
  assert.equal(ok[0].texto, 'oi');
});
