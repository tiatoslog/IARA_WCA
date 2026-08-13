/**
 * FECHAR APLICATIVO — a resposta não pode inventar a causa da recusa.
 *
 * MEDIDO em 13/08/2026, com a Calculadora aberta de verdade:
 *
 *   taskkill /IM CalculatorApp.exe
 *   → "ÊXITO: sinal de encerramento enviado ao processo (PID 188440)", código 0
 *   → o processo continua na tabela dois segundos depois
 *   (Get-Process 188440).CloseMainWindow()
 *   → devolve True
 *   → o processo continua na tabela dois segundos depois
 *
 * E a IARA respondia: "isso normalmente acontece quando há algo não salvo e o
 * programa está esperando uma resposta na tela".
 *
 * A Calculadora não tem o que salvar. A causa afirmada era falsa — e falsa da
 * forma mais cara: plausível, tranquilizadora e impossível de conferir. Um
 * aplicativo da Store fica suspenso fora de foco e não atende pedido educado de
 * fechamento; isso é um fato da CLASSE dele, declarado na allowlist.
 *
 * A verificação já estava certa (`divergente`, processo ainda presente). O que
 * mentia era a prosa. Estes testes travam a prosa.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AgenteLocal } from '../servidor/nucleo/AgenteLocal';

/**
 * Um agente cujo `taskkill` "dá certo" e cuja sonda mostra o processo VIVO
 * depois — exatamente o que a máquina real faz com um app da Store.
 */
function agenteQueNaoConsegueFechar(): AgenteLocal {
  return new AgenteLocal(
    () => undefined,
    async () => 0, // taskkill devolve 0: "sinal enviado"
    async () => ({ subiu: false, motivo: 'dublê: não lança nada' }),
    async () => [4242], // ...e o processo continua lá, antes e depois
  );
}

test('F1. app da Store: a IARA nomeia a causa REAL e não fala em trabalho não salvo', async () => {
  const relato = await agenteQueNaoConsegueFechar().fecharAplicativo('daiane', 'calculadora');

  assert.equal(relato.ok, false, 'processo vivo depois do pedido não pode virar sucesso');
  assert.equal(relato.prova.confirmado, false);
  assert.equal(relato.prova.motivo, 'divergente');

  assert.match(relato.texto, /Store/i, 'não disse o que de fato explica a recusa');
  assert.match(relato.texto, /suspens/i);
  assert.doesNotMatch(
    relato.texto,
    /normalmente acontece quando há algo não salvo/i,
    'voltou a afirmar uma causa que não mediu',
  );
});

test('F2. app comum: sem medição da causa, a IARA diz que NÃO SABE', async () => {
  /**
   * O outro lado da mesma regra. Para o Bloco de Notas a hipótese do trabalho
   * não salvo é razoável — e continua sendo hipótese. A frase pode oferecê-la;
   * não pode afirmá-la como o que aconteceu.
   */
  const relato = await agenteQueNaoConsegueFechar().fecharAplicativo('daiane', 'bloco de notas');

  assert.equal(relato.ok, false);
  assert.match(relato.texto, /não sei dizer o motivo/i, 'afirmou uma causa em vez de declarar dúvida');
  assert.match(relato.texto, /pode ser/i, 'a hipótese precisa estar marcada como hipótese');
  assert.doesNotMatch(relato.texto, /Store/i, 'atribuiu à Store um programa que não é da Store');
});

test('F3. a recusa de FORÇAR continua de pé — nenhuma correção de prosa a afrouxa', async () => {
  /**
   * A tentação óbvia ao consertar isto seria mandar `/F` e acabar com o
   * problema. O `/F` mata o processo por cima do documento aberto de alguém —
   * é o que transformaria esta habilidade de risco médio em irreversível.
   */
  const comandos: string[][] = [];
  const agente = new AgenteLocal(
    () => undefined,
    async (cmd, args) => {
      comandos.push([cmd, ...args]);
      return 0;
    },
    async () => ({ subiu: false, motivo: 'dublê: não lança nada' }),
    async () => [4242],
  );

  await agente.fecharAplicativo('daiane', 'calculadora');

  assert.ok(comandos.length > 0, 'nenhum comando foi executado — o teste cegou');
  for (const c of comandos) {
    assert.ok(
      !c.some((p) => /^\/F$/i.test(p)),
      `a IARA passou a forçar o fechamento: ${c.join(' ')}`,
    );
  }
});

test('F4. o Explorador continua não fechável, e a razão continua dita', async () => {
  const relato = await agenteQueNaoConsegueFechar().fecharAplicativo('daiane', 'explorador');

  assert.equal(relato.ok, false);
  assert.equal(relato.codigo_erro, 'PERMISSAO_NEGADA');
  assert.match(relato.texto, /shell do Windows/i);
});
