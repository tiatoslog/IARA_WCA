/**
 * A TRAVA DE AUTORIDADE LÊ O CATÁLOGO, NÃO UMA LISTA DE SEIS PALAVRAS.
 *
 * O DEFEITO (auditoria arquitetural de 21/08/2026). A trava que impede um
 * número sem procedência de chegar à tela vivia como uma alternação escrita à
 * mão dentro de `Kernel.ts`:
 *
 *   /\b(quantos?|quantas?|…)\b[^?]{0,40}\b(motoristas?|cargas?|rotas?|
 *     destinos?|origens?|clientes?)\b/i
 *
 * O cabeçalho dela afirmava, em maiúsculas: *"A REGRA É GERAL, e é o que a
 * impede de virar `if pergunta.includes('motoristas')`"*. Medida contra doze
 * perguntas de cardinalidade legítimas da operação, ela armava em DUAS. As
 * outras dez — « quantas coletas tivemos esse mês? », « quantas OCIs foram
 * abertas? », « quantos lembretes eu tenho? » — podiam receber um número
 * inventado pela LLM, sem execução nenhuma, digitado ao vivo na tela.
 *
 * A CORREÇÃO SEPARA AS DUAS METADES. A FORMA da pergunta (`quantos`, `total
 * de`) continua sendo sintaxe e mora no Kernel. O SUBSTANTIVO passa a ser dado
 * DECLARADO, no campo `entidades` do manifesto, e a trava lê a união — ver
 * `GerenciadorHabilidades.entidadesOperacionais`. Habilidade nova que conte
 * alguma coisa nasce coberta sem que ninguém edite regex em outro arquivo.
 *
 * POR QUE NÃO `pareceOperacional`. Foi a primeira hipótese e ela está errada,
 * medida antes de ser escrita: o índice de assunto da `DescobertaCapacidades`
 * responde "esta frase parece falar do que eu faço?", que é largo demais para
 * esta decisão. Ele arma em « quantos dias tem fevereiro? » e « quantos anos
 * você tem? ». E armar a trava ali não é um alarme extra — o oráculo devolve
 * `invalido`, `decidirEscalada` devolve `degradar`, e a resposta CERTA é
 * DESCARTADA e trocada por uma hedge. Falso positivo aqui custa a resposta
 * correta, e por isso a régua tem de ser estreita e declarada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { normalizar } from '../servidor/nucleo/texto';

/** A união, montada aqui do mesmo jeito que `entidadesOperacionais` monta. */
const ENTIDADES = [...new Set(CATALOGO.flatMap((h) => h.manifesto.entidades ?? []))];

/** O reconhecedor do Kernel, reconstruído a partir do catálogo. */
const RECONHECEDOR =
  ENTIDADES.length === 0 ? /(?!)/ : new RegExp(`\\b(${ENTIDADES.map((n) => `${n}e?s?`).join('|')})\\b`);
const FORMA = /\b(quantos?|quantas?|n[úu]mero de|total de|quantidade de)\b/i;

const arma = (f: string) => FORMA.test(f) && RECONHECEDOR.test(normalizar(f));

/**
 * As doze perguntas da medição. Duas armavam antes; as que o catálogo hoje sabe
 * contar têm de armar agora.
 */
const OPERACIONAIS = [
  'quantos motoristas temos?',
  'quantas cargas em agosto?',
  'quantas coletas tivemos esse mês?',
  'quantas OCIs foram abertas?',
  'quantos lembretes eu tenho?',
  'qual o total de cargas?',
  'número de rotas diferentes?',
  'quantidade de clientes atendidos?',
];

for (const f of OPERACIONAIS) {
  test(`trava arma em pergunta operacional: « ${f} »`, () => {
    assert.equal(arma(f), true, 'número sem procedência passaria ao vivo para a tela');
  });
}

/**
 * O LADO QUE PROTEGE A RESPOSTA CERTA. Conhecimento de mundo não é operação, e
 * armar a trava aqui faria a IARA descartar "fevereiro tem 28 dias" como
 * afirmação sem lastro. É o motivo pelo qual `entidades` é estreito.
 */
const CONHECIMENTO_DE_MUNDO = [
  'quantos dias tem fevereiro?',
  'quantas letras tem a palavra casa?',
  'quantos anos você tem?',
  'quantos estados tem o Brasil?',
  'bom dia, tudo bem?',
  'me conta uma piada',
];

for (const f of CONHECIMENTO_DE_MUNDO) {
  test(`trava NÃO arma fora da operação: « ${f} »`, () => {
    assert.equal(arma(f), false, 'a trava descartaria uma resposta correta');
  });
}

test('o campo entidades existe, é declarado e não virou lista de tudo', () => {
  assert.ok(ENTIDADES.length >= 6, `só ${ENTIDADES.length} entidade(s) declarada(s)`);
  /**
   * MUTAÇÃO INVERSA sobre a régua: se alguém declarar "dia", "ano" ou "vez"
   * como entidade da operação, os testes de conhecimento de mundo acima passam
   * a reprovar — mas o erro fica mais fácil de ler aqui, com o nome do
   * substantivo na mensagem, do que como um caso solto lá em cima.
   */
  const PROIBIDOS = ['dia', 'ano', 'mes', 'hora', 'letra', 'vez', 'coisa', 'item'];
  const invasores = ENTIDADES.filter((e) => PROIBIDOS.includes(e));
  assert.deepEqual(invasores, [], 'substantivo de tempo ou genérico não é entidade da operação');
});

test('entidades são singular, minúsculas e sem acento', () => {
  /**
   * O RECONHECEDOR PLURALIZA (`e?s?`) e casa sobre texto NORMALIZADO. Uma
   * entidade declarada com acento ou no plural nunca casaria nada, e o modo de
   * falhar é o pior possível: a trava simplesmente não arma, em silêncio, para
   * aquela habilidade.
   */
  const malformadas = ENTIDADES.filter((e) => e !== normalizar(e) || e.endsWith('s'));
  assert.deepEqual(malformadas, [], 'entidade fora da forma canônica não arma a trava');
});

test('toda entidade declarada é de fato alcançável pelo reconhecedor', () => {
  const mudas = ENTIDADES.filter((e) => !RECONHECEDOR.test(normalizar(`quantos ${e}s temos?`)));
  assert.deepEqual(mudas, [], 'entidade declarada que o reconhecedor não enxerga no plural');
});
