/**
 * A BATERIA DE RAG COMO PORTÃO DE REGRESSÃO.
 *
 * Achou três coisas em 17/08/2026, com corpus sintético de 62 linhas e gabarito
 * conhecido:
 *
 *  1. limiar `0.08` respondia "Sim, já passamos por isso" para *"como faço
 *     lasanha de berinjela"* — a distribuição medida separa acerto (0,436…0,964)
 *     de ruído (≤0,195) com um vão enorme, e o piso virou `0.30`;
 *  2. uma linha com 40 linhas de log na `assinatura` saía inteira para o
 *     operador e para o prompt: 43 linhas, 3.014 caracteres. O invariante "só
 *     assinatura de uma linha" era convenção de quem cadastra, não porta;
 *  3. texto hostil no campo `resolucao` chegava indistinguível da fala da IARA.
 *
 * Recall de PARÁFRASE não é meta e não pode virar meta aqui: busca lexical não
 * encontra "o banco não responde" a partir de "timeout ao conectar". O número é
 * medido e publicado para servir de linha de base no dia em que alguém propuser
 * embeddings — sem ele, a proposta seria decidida por gosto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medirRecall,
  medirContrato,
  taxasRag,
  violacoesDeRag,
  perguntasRag,
  corpusSintetico,
  type JulgamentoRag,
  type JulgamentoContrato,
} from './validacao/rag';

let recall: readonly JulgamentoRag[];
let contrato: readonly JulgamentoContrato[];

test('0. o corpus e o gabarito são grandes o bastante para o acerto não ser sorte', async () => {
  recall = await medirRecall();
  contrato = await medirContrato();

  assert.ok(corpusSintetico().length >= 60);
  assert.equal(recall.length, perguntasRag().length);
  /* Acerto por sorte com 62 linhas e limite 2 é ~3%. Sem esse piso, um corpus que
     encolhesse silenciosamente inflaria o recall sem ninguém notar. */
  assert.ok(perguntasRag().filter((p) => p.esperado !== null).length >= 12);
});

test('1. INVARIANTE: o índice lexical acerta 100% do que ele existe para achar', () => {
  const t = taxasRag(recall, contrato);
  assert.equal(t.por_familia.literal.acertos, t.por_familia.literal.total);
  assert.equal(t.por_familia.erro_de_digitacao.acertos, t.por_familia.erro_de_digitacao.total);
});

test('2. INVARIANTE: pergunta sem resposta na base não recebe achado', () => {
  /* O defeito que estava aqui: "como faço lasanha de berinjela" recebia duas
     assinaturas de erro de logística acima do limiar, com a frase "Sim, já
     passamos por isso" na frente. Afirmar familiaridade com o que nunca se viu é
     a mesma família da falsa conclusão — mentir sobre o próprio passado. */
  const ruidosas = recall.filter((j) => j.ruido).map((j) => j.pergunta.id);
  assert.deepEqual(ruidosas, []);

  for (const j of recall.filter((j) => j.pergunta.esperado === null)) {
    assert.match(j.texto_ao_operador, /Nada com assinatura equivalente/);
  }
});

test('3. INVARIANTE: o contrato de log bruto é porta, não convenção', () => {
  const violadas = contrato.filter((c) => c.violou).map((c) => c.id);
  assert.deepEqual(violadas, []);
  assert.deepEqual(violacoesDeRag(recall, contrato), []);
});

test('4. a paráfrase é MEDIDA, não cobrada — e o número fica registrado', () => {
  const t = taxasRag(recall, contrato);
  /* Piso baixo de propósito: o teste protege contra o dia em que a paráfrase cair
     para zero (índice quebrado), sem exigir semântica de quem se declara
     lexical. Em 17/08 o valor medido foi 4/6. */
  assert.ok(
    t.por_familia.parafrase.acertos >= 3,
    `paráfrase caiu para ${t.por_familia.parafrase.acertos}/${t.por_familia.parafrase.total} — o índice pode ter quebrado`,
  );
  assert.ok(t.mrr > 0.7, `MRR caiu para ${t.mrr.toFixed(3)}`);
});

test('5. a bateria SABE acusar: corpus com gabarito impossível reprova', () => {
  /* Sem este caso, `violacoesDeRag` poderia ter virado uma função que devolve
     lista vazia sempre e todos os testes acima continuariam verdes. */
  const inventado: JulgamentoRag[] = recall.map((j) =>
    j.pergunta.familia === 'literal' ? { ...j, acertou_em_1: false, acertou_em_2: false, posicao: null } : j,
  );
  const violacoes = violacoesDeRag(inventado, contrato);
  assert.ok(violacoes.some((v) => /recall de literal/.test(v)));
});
