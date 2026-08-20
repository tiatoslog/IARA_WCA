/**
 * A GUARDA DO LAÇO.
 *
 * O que esta bateria precisa provar, e é o inverso do que uma bateria de guarda
 * normalmente prova: que ela DISPARA. Um detector que nunca dispara passa em
 * todo teste de "não atrapalhou" e não protege de nada — é o falso verde por
 * construção que já custou caro aqui (`iara-duble-nao-pode-ser-o-porteiro`).
 *
 * Por isso a ordem das seções: primeiro os três detectores disparando, depois a
 * prova de que a canonicalização não deixa a assinatura escapar, e só no fim o
 * caso honesto — a retentativa legítima que a guarda NÃO pode matar, porque
 * matá-la mataria o motivo de existir o laço.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GuardaDeLaco,
  LIMIARES_PADRAO,
  VOLTAS_PADRAO,
  assinaturaDaChamada,
  type ChamadaObservada,
} from '../servidor/nucleo/kernel/GuardaDeLaco';

const leitura = (parametros: Record<string, unknown> = {}): ChamadaObservada => ({
  habilidade: 'consultar_cargas_luft',
  parametros,
  idempotencia: 'leitura',
});

const escrita = (parametros: Record<string, unknown> = {}): ChamadaObservada => ({
  habilidade: 'criar_pasta',
  parametros,
  idempotencia: 'escrita_idempotente',
});

// ===========================================================================
// 1. FALHA IDÊNTICA — o parâmetro errado repetido
// ===========================================================================

test('falha idêntica: a segunda tentativa igual já é barrada', () => {
  /**
   * Um degrau só, e não avisa-depois-barra: recusa de esquema, negativa do
   * porteiro e teto de autonomia são determinísticos. Deixar passar a segunda
   * chamada byte a byte idêntica seria pagar de novo pela mesma resposta — foi
   * o que fez dois passos barrados virarem oito execuções em 19/08/2026.
   */
  const g = new GuardaDeLaco();
  const c = leitura({ agrupar_por: 'inexistente' });

  assert.equal(g.antesDaChamada(c).acao, 'permitir', 'a primeira tentativa é livre');
  g.depoisDaChamada(c, { falhou: true });

  const segunda = g.antesDaChamada(c);
  assert.equal(segunda.acao, 'barrar', 'a segunda idêntica não roda');
  assert.equal(segunda.codigo, 'falha_identica');
  assert.match(segunda.motivo, /não a repita sem MUDAR/i, 'a recusa diz o que fazer em vez');
});

test('barrar é falar: o veredicto carrega motivo legível pelo modelo', () => {
  const g = new GuardaDeLaco();
  const c = leitura({ agrupar_por: 'inexistente' });
  g.antesDaChamada(c);
  g.depoisDaChamada(c, { falhou: true });
  const v = g.antesDaChamada(c);
  assert.equal(v.acao, 'barrar');
  assert.ok(v.motivo.length > 40, 'motivo vazio faria o modelo repetir achando que nunca rodou');
  assert.ok(v.motivo.includes('consultar_cargas_luft'), 'o motivo nomeia a habilidade');
});

test('mudar o parâmetro reabre a tentativa — a correção é o motivo do laço', () => {
  const g = new GuardaDeLaco();
  const errado = leitura({ agrupar_por: 'inexistente' });
  g.antesDaChamada(errado);
  g.depoisDaChamada(errado, { falhou: true });
  assert.equal(g.antesDaChamada(errado).acao, 'barrar');

  const certo = leitura({ agrupar_por: 'motorista' });
  const v = g.antesDaChamada(certo);
  assert.notEqual(v.acao, 'barrar', 'corrigir o parâmetro NÃO pode ser barrado');
});

// ===========================================================================
// 2. HABILIDADE FALHANDO — chute com parâmetro novo a cada volta
// ===========================================================================

test('habilidade falhando com parâmetros diferentes: avisa na 3ª, encerra na 4ª', () => {
  const g = new GuardaDeLaco();
  const tentativas = [{ a: 1 }, { a: 2 }, { a: 3 }].map((p) => leitura(p));

  assert.equal(g.antesDaChamada(tentativas[0]).acao, 'permitir');
  g.depoisDaChamada(tentativas[0], { falhou: true });

  assert.equal(g.antesDaChamada(tentativas[1]).acao, 'permitir', 'a 2ª ainda é esforço honesto');
  g.depoisDaChamada(tentativas[1], { falhou: true });

  const terceira = g.antesDaChamada(tentativas[2]);
  assert.equal(terceira.acao, 'avisar');
  assert.equal(terceira.codigo, 'habilidade_falhando');
  g.depoisDaChamada(tentativas[2], { falhou: true });

  const quarta = g.antesDaChamada(leitura({ a: 4 }));
  assert.equal(quarta.acao, 'encerrar', 'a 4ª tentativa cega encerra o laço');
  assert.equal(quarta.codigo, 'habilidade_falhando');
});

test('falha de uma habilidade não contamina outra', () => {
  const g = new GuardaDeLaco();
  for (const p of [{ a: 1 }, { a: 2 }, { a: 3 }]) {
    const c = leitura(p);
    g.antesDaChamada(c);
    g.depoisDaChamada(c, { falhou: true });
  }
  const outra = g.antesDaChamada(escrita({ nome: 'Alfa' }));
  assert.equal(outra.acao, 'permitir', 'a contagem é por habilidade, não global');
});

// ===========================================================================
// 3. JÁ EXECUTADO — repetir no MESMO turno o que já deu certo
// ===========================================================================

test('leitura idêntica bem-sucedida é barrada na segunda vez do mesmo turno', () => {
  /**
   * A primeira versão avisava na 2ª e só barrava na 3ª, com o argumento de que
   * a fonte pode ter mudado. O argumento é bom e o escopo estava errado: ele
   * vale ENTRE turnos, e entre turnos a guarda já nasce zerada. Dentro de um
   * turno de segundos, a observação anterior está na mesma janela de contexto.
   * Medido no cross-talk entre espelhos: cada habilidade rodava duas vezes.
   */
  const g = new GuardaDeLaco();
  const c = leitura({ ano: 2026 });

  assert.equal(g.antesDaChamada(c).acao, 'permitir');
  g.depoisDaChamada(c, { falhou: false });

  const segunda = g.antesDaChamada(c);
  assert.equal(segunda.acao, 'barrar');
  assert.equal(segunda.codigo, 'ja_executado');
});

test('parâmetro diferente na mesma leitura continua permitido', () => {
  const g = new GuardaDeLaco();
  const a = leitura({ ano: 2026 });
  g.antesDaChamada(a);
  g.depoisDaChamada(a, { falhou: false });
  assert.equal(
    g.antesDaChamada(leitura({ ano: 2025 })).acao,
    'permitir',
    'outro ano é outra pergunta',
  );
});

test('escrita idêntica bem-sucedida também é barrada', () => {
  const g = new GuardaDeLaco();
  const c = escrita({ nome: 'Alfa' });
  g.antesDaChamada(c);
  g.depoisDaChamada(c, { falhou: false });
  const v = g.antesDaChamada(c);
  assert.equal(v.acao, 'barrar');
  assert.equal(v.codigo, 'ja_executado');
});

// ===========================================================================
// 4. ASSINATURA — o modo de falha silencioso desta classe inteira
// ===========================================================================

test('ordem das chaves não muda a assinatura, em qualquer profundidade', () => {
  const a = assinaturaDaChamada('x', { b: 2, a: 1, n: { y: 2, x: 1 } });
  const b = assinaturaDaChamada('x', { a: 1, n: { x: 1, y: 2 }, b: 2 });
  assert.equal(a, b, 'sem canonicalização recursiva o detector nunca casaria');
});

test('a assinatura não devolve o parâmetro', () => {
  const s = assinaturaDaChamada('consultar_memoria_corporativa', { termo: 'salário do João' });
  assert.ok(!s.includes('João'), 'a guarda não guarda conteúdo — mesma regra do RAG');
  assert.ok(!s.includes('salário'));
});

test('habilidades diferentes com os mesmos parâmetros têm assinaturas diferentes', () => {
  assert.notEqual(assinaturaDaChamada('a', { x: 1 }), assinaturaDaChamada('b', { x: 1 }));
});

// ===========================================================================
// 5. VOLTAS — o teto do laço
// ===========================================================================

test('o teto de voltas encerra, e encerra dizendo o que ficou de fora', () => {
  const g = new GuardaDeLaco();
  for (let i = 0; i < VOLTAS_PADRAO; i++) {
    assert.equal(g.abrirVolta().acao, 'permitir', `volta ${i + 1} deveria abrir`);
  }
  assert.equal(g.voltasGastas, VOLTAS_PADRAO);

  const alem = g.abrirVolta();
  assert.equal(alem.acao, 'encerrar');
  assert.equal(alem.codigo, 'voltas_esgotadas');
  assert.match(alem.motivo, /ficou sem resposta/i, 'o teto não pode encerrar em silêncio');
});

test('o teto de voltas é menor ou igual ao teto de passos do orçamento de hoje + folga', () => {
  /* Invariante, não retrato: o laço não pode nascer podendo gastar mais que o
     pipeline que ele substitui, mais a folga de UMA correção por passo. */
  assert.ok(VOLTAS_PADRAO <= 12, `teto de voltas alto demais: ${VOLTAS_PADRAO}`);
  assert.ok(VOLTAS_PADRAO >= 3, 'abaixo de 3 voltas não há espaço para observar e corrigir');
});

// ===========================================================================
// 6. TURNO NOVO NASCE LIMPO
// ===========================================================================

test('reiniciarTurno zera contagem e voltas', () => {
  const g = new GuardaDeLaco();
  const c = leitura({ a: 1 });
  for (let i = 0; i < 2; i++) {
    g.abrirVolta();
    g.antesDaChamada(c);
    g.depoisDaChamada(c, { falhou: true });
  }
  assert.equal(g.antesDaChamada(c).acao, 'barrar');

  g.reiniciarTurno();
  assert.equal(g.voltasGastas, 0);
  assert.equal(
    g.antesDaChamada(c).acao,
    'permitir',
    'o segundo pedido do operador não pode nascer com o histórico de falhas do primeiro',
  );
});

// ===========================================================================
// 7. OS LIMIARES SÃO COERENTES ENTRE SI
// ===========================================================================

test('todo limiar de aviso vem antes do limiar que interrompe', () => {
  const l = LIMIARES_PADRAO;
  assert.ok(l.habilidade_falhando_avisa < l.habilidade_falhando_encerra);
});

test('todo limiar cabe dentro do teto de voltas — limiar acima do teto é código morto', () => {
  const l = LIMIARES_PADRAO;
  for (const [nome, valor] of Object.entries(l)) {
    if (nome === 'voltas') continue;
    assert.ok(
      (valor as number) <= l.voltas,
      `limiar "${nome}" (${valor}) nunca dispararia sob teto de ${l.voltas} voltas`,
    );
  }
});

// ===========================================================================
// 8. ADVERSARIAL — a guarda não pode ser a peça que derruba o turno
// ===========================================================================

test('8.1 parâmetro circular não estoura a pilha', () => {
  /**
   * Regressão do defeito achado na varredura adversarial de 19/08/2026:
   * `canonicalizar` recursava sem detecção de ciclo e `{self: circular}`
   * derrubava o turno DENTRO da guarda. Uma guarda que lança é estritamente
   * pior que guarda nenhuma — troca um laço caro por um turno morto.
   */
  const circular: Record<string, unknown> = { a: 1 };
  circular.self = circular;
  const s = assinaturaDaChamada('h', circular);
  assert.match(s, /^h:/);

  const g = new GuardaDeLaco();
  assert.equal(g.antesDaChamada({ habilidade: 'h', parametros: circular }).acao, 'permitir');
  g.depoisDaChamada({ habilidade: 'h', parametros: circular }, { falhou: true });
  assert.doesNotThrow(() => g.antesDaChamada({ habilidade: 'h', parametros: circular }));
});

test('8.2 ciclo é estável: o mesmo objeto circular dá a mesma assinatura', () => {
  const a: Record<string, unknown> = { x: 1 };
  a.self = a;
  const b: Record<string, unknown> = { x: 1 };
  b.self = b;
  assert.equal(
    assinaturaDaChamada('h', a),
    assinaturaDaChamada('h', b),
    'se o ciclo virasse valor único, o detector nunca casaria nesses casos',
  );
});

test('8.3 BigInt e Symbol não lançam', () => {
  assert.doesNotThrow(() => assinaturaDaChamada('h', { n: 10n }));
  assert.doesNotThrow(() => assinaturaDaChamada('h', { s: Symbol('x') }));
});

test('8.4 aninhamento profundo não estoura e ainda distingue chamadas', () => {
  const fundo = (n: number): Record<string, unknown> => {
    let o: Record<string, unknown> = { fim: 1 };
    for (let i = 0; i < n; i += 1) o = { d: o };
    return o;
  };
  assert.doesNotThrow(() => assinaturaDaChamada('h', fundo(5_000)));
  assert.notEqual(
    assinaturaDaChamada('h', { a: 1 }),
    assinaturaDaChamada('h', { a: 2 }),
    'a poda de profundidade não pode achatar chamadas rasas diferentes',
  );
});

test('8.5 parâmetros vazios, nulos e ausentes não lançam', () => {
  assert.doesNotThrow(() => assinaturaDaChamada('h', {}));
  assert.doesNotThrow(() =>
    assinaturaDaChamada('h', undefined as unknown as Record<string, unknown>),
  );
  assert.doesNotThrow(() => assinaturaDaChamada('h', { v: null, u: undefined }));
});

// ===========================================================================
// 9. JÁ EXECUTADO — a lacuna entre os detectores de falha e o de leitura
// ===========================================================================

test('9.1 escrita idêntica bem-sucedida não roda duas vezes no mesmo turno', () => {
  /**
   * Regressão de 19/08/2026: os três detectores originais olhavam para FALHA e
   * para leitura sem progresso. Uma escrita que deu CERTO e era pedida de novo,
   * byte a byte igual, passava entre eles — e com um planejador que devolvia o
   * mesmo plano, cada habilidade executava duas vezes por turno, em silêncio.
   */
  const g = new GuardaDeLaco();
  const c = escrita({ nome: 'Alfa' });
  assert.equal(g.antesDaChamada(c).acao, 'permitir');
  g.depoisDaChamada(c, { falhou: false });

  const v = g.antesDaChamada(c);
  assert.equal(v.acao, 'barrar');
  assert.equal(v.codigo, 'ja_executado');
  assert.match(v.motivo, /já foi executada neste turno/i);
  assert.match(v.motivo, /use-o em vez de repetir/i, 'a recusa diz o que fazer em vez');
});

test('9.2 parâmetro diferente na mesma escrita continua permitido', () => {
  const g = new GuardaDeLaco();
  const alfa = escrita({ nome: 'Alfa' });
  g.antesDaChamada(alfa);
  g.depoisDaChamada(alfa, { falhou: false });
  assert.equal(
    g.antesDaChamada(escrita({ nome: 'Beta' })).acao,
    'permitir',
    'criar outra pasta é outra ação',
  );
});

test('9.3 fonte viva: a releitura é permitida no TURNO SEGUINTE, não no mesmo', () => {
  /**
   * Onde a exceção de fonte viva realmente mora. Clima e planilha atualizada
   * mudam entre turnos — e entre turnos a guarda nasce zerada. Dentro de um
   * turno de segundos, a leitura anterior está na mesma janela de contexto e
   * repeti-la é desperdício quase certo.
   */
  const g = new GuardaDeLaco();
  const c = leitura({ cidade: 'Valinhos' });

  g.antesDaChamada(c);
  g.depoisDaChamada(c, { falhou: false });
  assert.equal(g.antesDaChamada(c).acao, 'barrar', 'no MESMO turno, não relê');

  g.reiniciarTurno();
  assert.equal(
    g.antesDaChamada(c).acao,
    'permitir',
    'no turno seguinte o clima pode ter mudado — e a IARA precisa poder ver',
  );
});

test('9.4 turno novo pode executar de novo a mesma escrita', () => {
  const g = new GuardaDeLaco();
  const c = escrita({ nome: 'Alfa' });
  g.antesDaChamada(c);
  g.depoisDaChamada(c, { falhou: false });
  assert.equal(g.antesDaChamada(c).acao, 'barrar');

  g.reiniciarTurno();
  assert.equal(
    g.antesDaChamada(c).acao,
    'permitir',
    'o operador pode pedir a mesma coisa de novo amanhã — o teto é o TURNO',
  );
});
