/**
 * PEDIDO QUE NÃO SUSTENTA AÇÃO — as duas metades do achado da campanha de 18/08/2026.
 *
 * CO-03: "Cria uma pasta na área de trabalho" (sem nome) criava `Nova pasta` no
 * disco. CO-05: "Cria uma pasta chamada X… na verdade não, deixa pra lá" criava X.
 * Os dois desfechos foram `FALSO_NEGATIVO` — efeito PROIBIDO no mundo — e os dois
 * vinham do caminho DETERMINÍSTICO, não da LLM.
 *
 * A correção mora no detector de ambiguidade porque ele roda ANTES da receita
 * determinística (`FuncaoExecutiva`, passo 2 contra passo 3): o que ele acha vira
 * `rota: esclarecer` com pergunta, e nenhum passo é planejado. Nada de porta nova.
 *
 * METADE DESTE ARQUIVO EXISTE PARA A REGRA NÃO DISPARAR. O defeito simétrico —
 * parar de atender pedido legítimo — custa mais caro que o original: o operador
 * repete a frase, ela pergunta de novo, e ninguém entende o que está acontecendo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DetectorAmbiguidade,
  CONTEXTO_VAZIO,
  perguntaDe,
} from '../servidor/nucleo/kernel/Ambiguidade';
import { extrairNomePasta } from '../servidor/nucleo/kernel/Planejador';

const detector = new DetectorAmbiguidade();
const tipos = (frase: string) =>
  detector.detectar(frase, CONTEXTO_VAZIO).map((a) => a.tipo);

test('1. criar pasta SEM NOME vira pergunta, não vira pasta', () => {
  assert.deepEqual(tipos('Cria uma pasta na área de trabalho'), ['objeto_sem_nome']);
  assert.deepEqual(tipos('cria uma pasta pra mim'), ['objeto_sem_nome']);
  assert.deepEqual(tipos('crie uma pasta'), ['objeto_sem_nome']);

  /* A ausência vem da MESMA função que o planejador usa. Uma segunda regra de
     extração aqui produziria dois entendimentos do mesmo pedido. */
  assert.equal(extrairNomePasta('Cria uma pasta na área de trabalho'), null);

  const pergunta = perguntaDe(
    detector.detectar('Cria uma pasta na área de trabalho', CONTEXTO_VAZIO)[0],
  );
  assert.match(pergunta, /nome/i);
  assert.match(pergunta, /inventar/i, 'a pergunta diz POR QUE ela não seguiu sozinha');
});

test('2. pedido com nome NÃO é tocado — o defeito simétrico', () => {
  const legitimas = [
    'crie uma pasta chamada Contratos na minha área de trabalho',
    'cria uma pasta Relatórios Aéreos em documentos',
    'cria uma pasta RH em documentos',
    'crie uma pasta de contratos aereos na area de trabalho por favor',
    'crie uma pasta chamada Um Relatório',
  ];
  for (const frase of legitimas) {
    assert.deepEqual(tipos(frase), [], frase);
    assert.notEqual(extrairNomePasta(frase), null, frase);
  }
});

test('2b. LIMITE DECLARADO: o diminutivo não é nomeável, e isso é anterior a esta regra', () => {
  /**
   * "cria ai uma pastinha chamada Teste 123" — a frase de CO-04 — não produz nome:
   * `extrairNomePasta` procura `pasta` com fronteira de palavra, e "pastinha" não
   * casa. Medido, não suposto, e NÃO é regressão desta mudança: o mesmo valia antes.
   *
   * Também não vira pergunta, porque a mesma fronteira impede a regra nova de
   * disparar. Hoje isso é inofensivo — a percepção não reconhece âncora nenhuma
   * nessa frase e o turno vai para o caminho cognitivo, sem receita determinística.
   * Fica escrito aqui para o dia em que alguém ensinar o diminutivo à âncora: nesse
   * dia, esta linha vira vermelha e lembra que a regra do nome precisa acompanhar.
   */
  const diminutivo = 'cria ai uma pastinha chamada Teste 123 na area d trabalho vlw';
  assert.equal(extrairNomePasta(diminutivo), null);
  assert.deepEqual(tipos(diminutivo), []);
});

test('3. ordem revogada na mesma mensagem não vira efeito', () => {
  assert.deepEqual(
    tipos('Cria uma pasta chamada Revogada 42 na área de trabalho. Na verdade não, deixa pra lá, esquece.'),
    ['ordem_revogada'],
  );
  assert.deepEqual(tipos('manda o relatório pro João, cancela'), ['ordem_revogada']);
  assert.deepEqual(tipos('abre o Bloco de Notas, melhor não'), ['ordem_revogada']);

  /* A revogação vence a falta de nome: perguntar "que nome dar" de um pedido que a
     pessoa cancelou é não ter lido a mensagem até o fim. */
  assert.deepEqual(tipos('cria uma pasta, deixa pra lá'), ['ordem_revogada']);

  const pergunta = perguntaDe(
    detector.detectar('cria a pasta X. esquece.', CONTEXTO_VAZIO)[0],
  );
  assert.match(pergunta, /não fiz nada/i);
});

test('4. revogação ANTES do pedido é pedido legítimo — a posição é o critério', () => {
  /* "esquece o que eu disse ontem, cria a pasta Alfa" pede de verdade. Ler a
     revogação sem olhar a posição faria a IARA recusar trabalho legítimo. */
  assert.deepEqual(
    tipos('esquece o que eu disse ontem, cria a pasta Alfa na área de trabalho'),
    [],
  );
});

test('5. "não" sozinho NÃO é revogação — correção de alvo continua sendo pedido', () => {
  /* É por isso que a lista de marcadores é curta e explícita: `não` sozinho
     aparece em correção ("cria a pasta X, não a Y") e em negação de qualquer
     coisa. Só entram frases que existem para desfazer o que veio antes. */
  assert.deepEqual(tipos('cria a pasta Alfa, não a Beta'), []);

  /**
   * LIMITE DECLARADO, e ele é anterior a esta mudança: "cria a pasta Alfa, não a
   * Beta" produz o NOME "Alfa, não a Beta" — a cauda inteira entra. Feio, e fora do
   * alcance desta correção; o que importa aqui é que a frase continua sendo tratada
   * como pedido, e não como revogação.
   */
  assert.equal(extrairNomePasta('cria a pasta Alfa, não a Beta'), 'Alfa, não a Beta');

  /* "que não está lá" cai na regra ANTIGA de referência sem antecedente — nada a
     ver com revogação, e já era assim. Registrado para ninguém ler o disparo como
     efeito da regra nova. */
  assert.deepEqual(tipos('cria a pasta Alfa que não está lá'), ['referencia_sem_antecedente']);
});

test('6. conversa e outras famílias seguem intocadas', () => {
  assert.deepEqual(tipos('bom dia, tudo bem?'), []);
  assert.deepEqual(tipos('que horas são?'), []);
});
