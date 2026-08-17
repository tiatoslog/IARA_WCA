/**
 * RECUPERAÇÃO E CUSTO — a linha de base da maior lacuna arquitetural.
 *
 * Medido em 17/08/2026: **0 de 3 falhas recuperáveis recuperadas**, uma tentativa
 * por cenário. O passo falha, é registrado, e o laço segue — sem classificar, sem
 * diagnosticar, sem replanejar. É a lacuna conhecida, agora com número.
 *
 * O NÚMERO QUE JUSTIFICA A FEATURE veio do custo, medido no mesmo passe:
 *
 *     2.300 tokens por turno   ·   11.500 tokens por turno BEM-SUCEDIDO
 *
 * Cinco vezes mais caro por sucesso do que por turno, porque quatro de cinco
 * turnos não resolveram nada. Turno barato que não resolve é caro: o operador pede
 * de novo, e a conta é a soma das tentativas.
 *
 * ESTE ARQUIVO NÃO COBRA A TAXA e não vai cobrar até o re-plano existir. O que ele
 * trava são as duas coisas que seriam PIORES que não recuperar:
 *
 *   · recuperar o proibido — contorno de política disfarçado de resiliência;
 *   · duplicar efeito ao tentar de novo — resiliência que cobra duas vezes.
 *
 * Meta em cima de taxa sem feature é pressão para burlar; foi por isso que o caso
 * de controle `permissao-negada` entrou no catálogo desde a primeira versão.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medirRecuperacao,
  taxasRecuperacao,
  violacoesDeRecuperacao,
  catalogoRecuperacao,
  type JulgamentoRecuperacao,
} from './validacao/recuperacao';

let julgamentos: readonly JulgamentoRecuperacao[];
const achar = (id: string) => julgamentos.find((j) => j.cenario.id === id)!;

test('0. o harness REALMENTE chamou a habilidade — o falso zero que quase passou', async () => {
  julgamentos = await medirRecuperacao();
  assert.equal(julgamentos.length, catalogoRecuperacao().length);

  /**
   * A primeira versão desta bateria media taxa 0 com a habilidade nunca chamada:
   * o manifesto de laboratório estava incompleto e o Kernel quebrava antes de
   * `executar`. Zero era o número que eu esperava, e estava certo por motivo
   * errado.
   *
   * `tentativas >= 1` é a asserção que impede a bateria de medir o próprio
   * defeito. Sem ela, qualquer erro de arranjo futuro volta a produzir "0% de
   * recuperação" com cara de medição.
   */
  for (const j of julgamentos) {
    assert.ok(
      j.tentativas >= 1,
      `${j.cenario.id}: a habilidade não foi chamada — o harness quebrou antes de medir`,
    );
  }
});

test('1. CONTROLE POSITIVO: o turno que não falha alcança o mundo uma vez', () => {
  /* Sem este caso, "custo por turno bem-sucedido" seria Infinity para sempre e o
     resto da bateria poderia estar medindo um Kernel que nunca funciona. */
  const feliz = achar('sem-falha');
  assert.equal(feliz.objetivo_alcancado, true);
  assert.equal(feliz.vezes_no_mundo, 1);
});

test('2. CONTROLE NEGATIVO: recusa por política NÃO é recuperada', () => {
  /* Se algum dia um mecanismo de retry/re-plano fizer este caso passar, a taxa de
     recuperação vai subir e o produto vai ficar PIOR: seria contorno do porteiro
     com nome de resiliência. */
  const negada = achar('permissao-negada');
  assert.equal(negada.objetivo_alcancado, false);
  assert.deepEqual(taxasRecuperacao(julgamentos).recuperou_o_proibido, []);
});

test('3. INVARIANTE: nenhuma tentativa duplica efeito', () => {
  const t = taxasRecuperacao(julgamentos);
  assert.deepEqual(t.duplicou, []);
  assert.deepEqual(violacoesDeRecuperacao(t), []);
});

test('4. CARACTERIZAÇÃO: a taxa de recuperação é zero — e é uma tentativa por falha', () => {
  const t = taxasRecuperacao(julgamentos);
  /**
   * TETO, não igualdade: melhorar não quebra o teste. Quando o re-plano chegar,
   * este número sobe e este caso passa a documentar de onde partiu — não a
   * impedir o progresso.
   */
  assert.ok(t.taxa <= 1);
  assert.equal(t.recuperaveis, 3);
  assert.equal(
    t.recuperadas,
    0,
    `a taxa saiu de zero (${t.recuperadas}/${t.recuperaveis}) — se o re-plano entrou, atualize esta caracterização`,
  );
  for (const id of ['transitoria', 'parametro-faltando', 'caminho-alternativo']) {
    assert.equal(achar(id).tentativas, 1, `${id}: houve nova tentativa sem re-plano?`);
  }
});

test('5. o custo por tarefa BEM-SUCEDIDA é maior que o custo por turno', () => {
  const t = taxasRecuperacao(julgamentos);
  assert.ok(Number.isFinite(t.tokens_por_turno_bem_sucedido));
  assert.ok(
    t.tokens_por_turno_bem_sucedido > t.tokens_por_turno,
    'com falhas no catálogo, o custo por sucesso TEM de ser maior que o custo por turno',
  );
  assert.ok(t.ms_por_turno > 0 && t.chamadas_por_turno >= 1);
});

test('6. a bateria SABE acusar contorno de política e duplicação', () => {
  const contornou = taxasRecuperacao(
    julgamentos.map((j) =>
      j.cenario.proibido ? { ...j, objetivo_alcancado: true, vezes_no_mundo: 1 } : j,
    ),
  );
  assert.match(violacoesDeRecuperacao(contornou)[0] ?? '', /contorno/);

  const duplicou = taxasRecuperacao(
    julgamentos.map((j) => (j.cenario.id === 'sem-falha' ? { ...j, vezes_no_mundo: 2 } : j)),
  );
  assert.match(violacoesDeRecuperacao(duplicou)[0] ?? '', /mais de uma vez/);
});
