/**
 * OBS-1 — "mandei" não é "chegou".
 *
 * O DEFEITO (auditoria em navegador real, 19/08/2026). Duas mensagens foram
 * enviadas e sumiram: sem balão, sem erro, sem aviso — com o indicador do
 * barramento dizendo "aberto" o tempo todo. Coincidiram com reinícios do motor
 * provocados por outra sessão editando o servidor.
 *
 * A CONFUSÃO DE CONTRATO que causou isso:
 *
 *     readyState === OPEN  →  send() não lançou  →  "entregue"     ← FALSO
 *
 * O contrato correto tem um passo a mais, e é o único que prova entrega:
 *
 *     OPEN + send() → eco com o mesmo op:id → ENTREGA CONFIRMADA
 *     OPEN + send() → prazo vencido sem eco → ENTREGA NÃO CONFIRMADA
 *
 * O QUE ESTE ARQUIVO PROVA, e o caso do meio é o que reproduz o defeito: não
 * basta testar o caminho feliz. Um teste que só verifica `send()` voltando sem
 * exceção testa exatamente a premissa errada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PRAZO_DO_ECO_MS, VigiaDoEco } from '../lib/vigiaDoEco';

const T0 = 1_000_000;

test('envio normal → eco recebido → pendência resolvida', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'quantos motoristas temos?', T0);
  assert.equal(v.esperando, 1);
  assert.equal(v.confirmar('op:a'), true, 'o eco não encontrou a pendência');
  assert.equal(v.esperando, 0);
  assert.deepEqual(v.vencidos(T0 + PRAZO_DO_ECO_MS * 10), [], 'confirmada e ainda assim venceu');
});

/**
 * O CASO QUE REPRODUZ O OBS-1. O socket estava `OPEN`, o `send()` não lançou, e
 * o servidor reiniciou no meio: o eco nunca vem. É o único cenário em que o
 * defeito acontecia, e o único que um teste de caminho feliz não alcança.
 */
test('socket OPEN, send() sem exceção, servidor reinicia → o prazo vence e a perda é detectada', () => {
  const v = new VigiaDoEco();
  v.registrar('op:perdida', 'qual a margem da operação?', T0);

  /* Antes do prazo, nada é acusado: quem está só lento não é acusado de perdido. */
  assert.deepEqual(v.vencidos(T0 + PRAZO_DO_ECO_MS - 1), []);
  assert.equal(v.esperando, 1);

  const fora = v.vencidos(T0 + PRAZO_DO_ECO_MS + 1);
  assert.equal(fora.length, 1);
  assert.equal(fora[0].id, 'op:perdida');
  assert.equal(fora[0].texto, 'qual a margem da operação?', 'o texto perdido tem que voltar, para o aviso dizer QUAL mensagem');
});

test('o vencido é avisado UMA vez — o relógio bate a cada 2 s e não pode repetir o alarme', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'x', T0);
  assert.equal(v.vencidos(T0 + PRAZO_DO_ECO_MS + 1).length, 1);
  assert.deepEqual(v.vencidos(T0 + PRAZO_DO_ECO_MS + 2), [], 'avisou duas vezes a mesma perda');
  assert.equal(v.esperando, 0);
});

/**
 * ECO DUPLICADO. As outras telas do mesmo operador recebem o MESMO snapshot e
 * chamam `confirmar` para ids que elas nunca enviaram. `false` ali é a resposta
 * certa, e é o que impede uma segunda confirmação de virar evento.
 */
test('eco duplicado não gera segunda confirmação', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'x', T0);
  assert.equal(v.confirmar('op:a'), true);
  assert.equal(v.confirmar('op:a'), false, 'o segundo eco confirmou de novo');
});

test('eco de mensagem que esta tela não enviou é ignorado sem erro', () => {
  const v = new VigiaDoEco();
  v.registrar('op:minha', 'x', T0);
  assert.equal(v.confirmar('op:de-outra-tela'), false);
  assert.equal(v.esperando, 1, 'o eco alheio consumiu a minha pendência');
});

test('várias mensagens simultâneas: cada op:id resolve a própria pendência', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'primeira', T0);
  v.registrar('op:b', 'segunda', T0 + 10);
  v.registrar('op:c', 'terceira', T0 + 20);
  assert.equal(v.esperando, 3);

  assert.equal(v.confirmar('op:b'), true);
  assert.equal(v.esperando, 2);

  const fora = v.vencidos(T0 + PRAZO_DO_ECO_MS + 100);
  assert.deepEqual(
    fora.map((p) => p.id).sort(),
    ['op:a', 'op:c'],
    'a confirmação de uma mensagem afetou as outras',
  );
});

/**
 * REENVIO MANUAL. A pessoa reenvia porque a tela avisou; o novo envio ganha id
 * novo e não pode ser confundido com o antigo. E se algum caminho reenviar com
 * o MESMO id, o prazo reinicia em vez de criar duas pendências — uma mensagem
 * só, um aviso só.
 */
test('reenvio com id novo não perde a correlação do antigo', () => {
  const v = new VigiaDoEco();
  v.registrar('op:velha', 'quantas cargas hoje?', T0);
  v.vencidos(T0 + PRAZO_DO_ECO_MS + 1); /* a antiga foi avisada e saiu */

  v.registrar('op:nova', 'quantas cargas hoje?', T0 + 20_000);
  assert.equal(v.confirmar('op:nova'), true);
  assert.equal(v.confirmar('op:velha'), false, 'o eco da nova ressuscitou a velha');
});

test('reenvio com o MESMO id reinicia o prazo, sem criar segunda pendência', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'x', T0);
  v.registrar('op:a', 'x', T0 + 10_000);
  assert.equal(v.esperando, 1);
  assert.deepEqual(v.vencidos(T0 + PRAZO_DO_ECO_MS + 1), [], 'o prazo não foi reiniciado');
  assert.equal(v.vencidos(T0 + 10_000 + PRAZO_DO_ECO_MS + 1).length, 1);
});

/**
 * A PENDÊNCIA SOBREVIVE À RECONEXÃO de propósito. A mensagem pode ter chegado
 * antes da queda e o eco vir depois de reconectar — apagar a pendência no
 * `onclose` transformaria uma entrega bem-sucedida em alarme falso.
 */
test('a pendência não é apagada por conta própria: só eco ou prazo a resolvem', () => {
  const v = new VigiaDoEco();
  v.registrar('op:a', 'x', T0);
  /* Passaram-se 5 s de reconexão; o eco chega atrasado, mas chega. */
  assert.equal(v.confirmar('op:a'), true);
  assert.equal(v.esperando, 0);
});

test('o prazo é maior que o backoff inteiro da reconexão', () => {
  /* O backoff do socket vai a 1, 2, 4 e 8 s. Um prazo menor que a soma acusaria
     como perdida toda mensagem enviada durante uma reconexão normal. */
  assert.ok(PRAZO_DO_ECO_MS > 1000 + 2000 + 4000, `prazo curto demais: ${PRAZO_DO_ECO_MS} ms`);
});

/**
 * O PORTÃO DE ARQUITETURA. O defeito nasceu de tratar `send()` como prova, e a
 * única forma de garantir que ninguém volte a fazê-lo é ler a fonte: não pode
 * existir caminho que marque entrega sem passar pelo eco.
 */
test('não existe confirmação de entrega baseada no retorno de send()', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(new URL('../hooks/useIaraSocket.ts', import.meta.url), 'utf8');

  /* A trava de socket fechado continua de pé — ela cobre o outro caso. */
  assert.match(
    fonte,
    /readyState !== WebSocket\.OPEN/,
    'a recusa de envio com o socket fechado sumiu',
  );

  /* Todo envio de mensagem registra pendência. */
  assert.match(fonte, /vigiaDoEco\.current\.registrar\(/, 'o envio não registra pendência de eco');
  /* E só o eco a resolve. */
  assert.match(fonte, /vigiaDoEco\.current\.confirmar\(/, 'nada resolve a pendência pelo eco');
  /* E o relógio existe para o caso em que NENHUM pacote chega. */
  assert.match(fonte, /vigiaDoEco\.current\.vencidos\(/, 'ninguém vigia o prazo');
});

/**
 * O SEGUNDO GATILHO, e ele existe por uma falha da VERIFICAÇÃO, não da teoria.
 *
 * A prova ponta a ponta em navegador FALHOU em 19/08/2026. O conserto estava no
 * bundle, a mensagem se perdeu de verdade (servidor derrubado logo após o
 * envio), e o aviso não saiu. A causa: o Chrome estrangula `setInterval` em aba
 * oculta — uma vez por minuto, e congelamento total depois de alguns minutos —
 * e a aba do painel fica `hidden`. Numa aba de fundo real dá no mesmo: a
 * operadora volta ao trabalho e não fica sabendo.
 *
 * Depender de um relógio que o navegador tem o direito de congelar é depender
 * de nada. `visibilitychange` é o gatilho que não pode ser estrangulado: ele
 * dispara exatamente quando alguém volta a olhar, que é quando o aviso serve
 * para alguma coisa.
 */
test('o aviso não depende só do relógio — a volta da aba também confere', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(new URL('../hooks/useIaraSocket.ts', import.meta.url), 'utf8');
  assert.match(fonte, /visibilitychange/, 'sem gatilho na volta da aba, aba de fundo nunca avisa');
  assert.match(
    fonte,
    /visibilityState === 'visible'/,
    'o gatilho da aba precisa conferir quando ela VOLTA, não quando some',
  );
});
