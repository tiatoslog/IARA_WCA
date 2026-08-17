/**
 * CONSISTÊNCIA SOB QUEDA como portão de regressão.
 *
 * O crash é real: processo filho que chama `process.exit(1)` no meio da operação,
 * sem `finally`, sem flush, sem despedida. Depois, um processo NOVO lê o disco —
 * que é o que acontece quando o serviço sobe de volta.
 *
 * Medido em 17/08/2026:
 *
 *     morreu ANTES do efeito     → jornal "desconhecida" · mundo sem efeito · na fila
 *     morreu DEPOIS do efeito    → jornal "desconhecida" · mundo COM efeito · na fila
 *     morreu depois de verificar → jornal "verificada"   · mundo COM efeito · fora da fila
 *
 * A RESPOSTA À PERGUNTA DA BATERIA é o que os dois primeiros têm em comum: o jornal
 * **não distingue** efeito aplicado de efeito não aplicado — e está certo em não
 * fingir que distingue, porque não tem como saber. Quem distingue é o verificador
 * olhando o mundo depois, e o que torna isso possível é a operação continuar em
 * `pendentesDeVerdade`. Sem a fila, as únicas saídas seriam retentar às cegas
 * (duplicando mensagem já enviada) ou abandonar trabalho que só faltava confirmar.
 *
 * E o produto se mostrou mais honesto que a expectativa: eu esperava `executando`,
 * o estado gravado antes do executor. A reidratação devolve `desconhecida`, porque
 * um processo que morreu não está executando nada — manter `executando` seria o
 * jornal afirmando atividade de um processo que não existe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirQueda, violacoesDeQueda, type JulgamentoQueda } from './validacao/queda';

let julgamentos: readonly JulgamentoQueda[];
const achar = (m: string) => julgamentos.find((j) => j.momento === m)!;

test('0. os três crashes rodaram em processo filho de verdade', async () => {
  julgamentos = await medirQueda();
  assert.equal(julgamentos.length, 3);

  /* Sem esta conferência, um filho que nem subisse (erro de caminho, tsx ausente)
     devolveria jornal vazio nos três casos — e "nada foi reidratado" poderia ser
     lido como "o sistema não gravou nada", que é conclusão sobre o produto tirada
     de um defeito do harness. */
  for (const j of julgamentos) {
    assert.notEqual(j.estado_lido, null, `${j.momento}: nada reidratado — ${j.detalhe}`);
  }
});

test('1. INVARIANTE: morrer no meio nunca vira confirmação', () => {
  /* O desfecho perigoso: jornal declarando efeito confirmado sem verificador ter
     olhado o mundo. É por essa porta que a duplicata entra na retentativa. */
  for (const m of ['antes_do_efeito', 'depois_do_efeito']) {
    const j = achar(m);
    assert.notEqual(j.estado_lido, 'verificada', `${m} voltou como verificada`);
    assert.notEqual(j.estado_lido, 'aceita_pelo_provedor');
  }
});

test('2. INVARIANTE: o estado lido é "desconhecida" — não "executando"', () => {
  /* Processo morto não está executando. Se algum dia a reidratação voltar a
     devolver `executando`, alguém vai ler "está em andamento, espere". */
  assert.equal(achar('antes_do_efeito').estado_lido, 'desconhecida');
  assert.equal(achar('depois_do_efeito').estado_lido, 'desconhecida');
});

test('3. INVARIANTE: o desconhecido entra na FILA de verdade', () => {
  /**
   * É a asserção que sustenta a resposta da bateria. O jornal não distingue os dois
   * crashes — e não precisa —, desde que os dois fiquem na fila de quem vai olhar o
   * mundo. Sem a fila, o desconhecimento morre no disco e o operador nunca descobre
   * se a mensagem foi enviada.
   */
  assert.equal(achar('antes_do_efeito').pendente_de_verdade, true);
  assert.equal(achar('depois_do_efeito').pendente_de_verdade, true);
});

test('4. CONTROLE: ciclo completo sai da fila e o mundo confirma', () => {
  const ok = achar('depois_de_verificar');
  assert.equal(ok.estado_lido, 'verificada');
  assert.equal(ok.efeito_no_mundo, true);
  assert.equal(ok.pendente_de_verdade, false);
  assert.deepEqual(violacoesDeQueda(julgamentos), []);
});

test('5. a bateria SABE acusar os três desfechos ruins', () => {
  const semJornal = violacoesDeQueda([{ ...achar('antes_do_efeito'), estado_lido: null }]);
  assert.match(semJornal[0], /não sobreviveu à queda/);

  const confirmouSozinho = violacoesDeQueda([
    { ...achar('depois_do_efeito'), estado_lido: 'verificada', honesto: false },
  ]);
  assert.ok(confirmouSozinho.some((v) => /confirmação por otimismo/.test(v)));

  const foraDaFila = violacoesDeQueda([
    { ...achar('depois_do_efeito'), pendente_de_verdade: false },
  ]);
  assert.ok(foraDaFila.some((v) => /ninguém vai conferir/.test(v)));
});
