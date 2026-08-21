/**
 * HISTORICAL_WRONG_NUMERIC_ASSERTION — o histórico não manda no número.
 *
 * O INCIDENTE (produção, 19/08/2026). Perguntada "quantos motoristas temos?", a
 * IARA respondeu:
 *
 *   "75 motoristas diferentes, contando o grupo 'sem motorista' — **mesma
 *    contagem que te dei agora há pouco**."
 *
 * São 73. Ela não somou listagem truncada (esse foi o defeito da véspera, já
 * fechado) e não chamou ferramenta nenhuma: **repetiu a própria resposta errada
 * do histórico**. O "já respondi isso" funcionou como credencial, e o erro
 * passou a se auto-confirmar — cada repetição o deixa mais parecido com fato.
 *
 * A REGRA, e ela é geral por construção. O oráculo não sabe o que é motorista,
 * não sabe o que é carga e não sabe que a resposta é 73. Ele responde a uma
 * pergunta mais simples e mais forte:
 *
 *   esta fala afirma um número que só poderia vir de execução — e nenhuma
 *   execução aconteceu neste turno?
 *
 * É o que impede a correção de virar `if pergunta.includes("motoristas")`. A
 * mesma trava vale para faturamento, cargas e o que for declarado depois.
 *
 * A HIERARQUIA DE AUTORIDADE que isto materializa:
 *
 *   execução no turno > fonte sem execução > memória conversacional >
 *   resposta anterior da IARA > inferência da LLM
 *
 * Memória continua resolvendo CONTEXTO e referência ("e em 2026?"). Nunca VALOR.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { conferirExecucaoNoTurno } from '../lib/verificacao/oraculos';
import { VerificadorDeterministico, RAIZ_DO_APP } from '../servidor/nucleo/kernel/VerificacaoRuntime';

const verificador = new VerificadorDeterministico({
  raiz: RAIZ_DO_APP,
  /* Fonte LIGADA de propósito: o defeito deste arquivo não é "a base está
     fora" — aquele já tem oráculo. É "a base está lá e ninguém a consultou". */
  fontesAusentes: () => [],
});

const PERGUNTA = 'quantos motoristas temos?';

// ---------------------------------------------------------------------------
// O oráculo, isolado
// ---------------------------------------------------------------------------

test('afirmar número sem executar nada é inválido', () => {
  const r = conferirExecucaoNoTurno('Temos 75 motoristas diferentes.', [], 'a operação');
  assert.equal(r.status, 'invalido');
  assert.match(r.motivo ?? '', /sem executar nada/);
  assert.equal(r.escalavel, true, 'a fonte está ligada — a segunda tentativa tem o que fazer');
});

test('com operação executada, a autoridade existe e este oráculo se cala', () => {
  const r = conferirExecucaoNoTurno(
    'Temos 73 motoristas diferentes.',
    ['consultar_estatisticas_cargas_luft'],
    'a operação',
  );
  assert.equal(r.status, 'inconclusivo', 'conferir o VALOR é trabalho de outro oráculo');
});

test('sem número afirmado não há o que contestar', () => {
  const r = conferirExecucaoNoTurno('Não consegui consultar a planilha agora.', [], 'a operação');
  assert.equal(r.status, 'inconclusivo');
});

/**
 * NÃO SABER NÃO É ACUSAR. `undefined` significa que quem chamou não informou as
 * operações — e um oráculo cego não contesta ninguém. É a mesma regra do
 * `Mundo.existe: null` da campanha: não conseguir olhar é diferente de olhar e
 * discordar.
 */
test('sem informação sobre o turno, o oráculo se cala', () => {
  const r = conferirExecucaoNoTurno('Temos 75 motoristas.', undefined, 'a operação');
  assert.equal(r.status, 'inconclusivo');
});

// ---------------------------------------------------------------------------
// O verificador de runtime — o caminho que a produção percorre
// ---------------------------------------------------------------------------

/**
 * ONDE A TRAVA MORA — e por que não em `reconhece`.
 *
 * A primeira versão desta correção reconhecia toda pergunta de "quantos X" no
 * verificador. O `E23` de `escalada-verificada.test.ts` reprovou, com razão:
 * `reconhece` arma a trava da fala e custa a digitação ao vivo do turno
 * INTEIRO, inclusive dos que funcionam — e a imensa maioria funciona. Punir o
 * caminho bom para pegar o ruim é caro demais.
 *
 * A trava foi para o Kernel, onde a conta é outra: ali o turno já executou (ou
 * não), e ela arma só quando nada alcançou o mundo. O turno legítimo não paga.
 */
test('o verificador NÃO arma a fala por cardinalidade — o E23 continua valendo', () => {
  assert.equal(
    verificador.reconhece('quantas cargas existem na base 2026?'),
    false,
    'com a fonte no ar, reter a fala puniria o caminho que funciona',
  );
  assert.equal(verificador.reconhece(PERGUNTA), false);
  assert.equal(verificador.reconhece('bom dia, tudo bem?'), false);
  /* O relógio segue reconhecido: a fonte dele é aritmética, não custa disco. */
  assert.equal(verificador.reconhece('que horas são?'), true);
});

/**
 * O CASO EXATO DE PRODUÇÃO, com a frase literal que a IARA disse.
 */
test('REGRESSÃO · a fala de 19/08 é contestada quando nada executou', () => {
  const r = verificador.verificar(
    '75 motoristas diferentes, contando o grupo "sem motorista" — mesma contagem que te dei agora há pouco.',
    { pergunta: PERGUNTA, inicio_ms: 0, fim_ms: 1000, operacoes_do_turno: [] },
  );
  assert.equal(r.status, 'invalido', 'a resposta que chegou à operadora tem de ser contestada');
  assert.equal(r.escalavel, true);
  assert.match(r.evidencia?.detalhe ?? '', /contexto.*não é fonte/i);
});

/**
 * O TESTE MAIS FORTE DO ARQUIVO: um número absurdo no histórico não vira
 * autoridade só por estar escrito.
 */
test('REGRESSÃO · nem um número absurdo repetido do histórico passa', () => {
  const r = verificador.verificar('Temos 999999 motoristas.', {
    pergunta: PERGUNTA,
    inicio_ms: 0,
    fim_ms: 1000,
    operacoes_do_turno: [],
  });
  assert.equal(r.status, 'invalido');
});

test('com execução no turno, a resposta atravessa', () => {
  const r = verificador.verificar('Temos 73 motoristas diferentes.', {
    pergunta: PERGUNTA,
    inicio_ms: 0,
    fim_ms: 1000,
    operacoes_do_turno: ['consultar_estatisticas_cargas_luft'],
  });
  assert.notEqual(r.status, 'invalido', 'executou: o número tem procedência');
});

/**
 * A REGRA É GERAL — não é sobre motorista. Se fosse um `if` por assunto, este
 * caso passaria despercebido.
 */
test('a mesma trava vale para faturamento e cargas, sem regra por assunto', () => {
  for (const pergunta of [
    'quantas cargas temos?',
    'qual o número de clientes?',
    'quantidade de rotas?',
  ]) {
    const r = verificador.verificar('São 4321.', {
      pergunta,
      inicio_ms: 0,
      fim_ms: 1000,
      operacoes_do_turno: [],
    });
    assert.equal(r.status, 'invalido', `"${pergunta}" deveria ser contestada`);
  }
});

/**
 * PASSO PLANEJADO NÃO É PASSO EXECUTADO. O Kernel só põe na lista o que
 * alcançou o mundo — contar intenção faria a trava aprovar exatamente o turno
 * que ela existe para pegar.
 */
test('a lista de operações é do que executou, não do que se pretendia', () => {
  /* Lista vazia é o que o Kernel entrega quando nenhum passo alcançou o mundo,
     inclusive quando havia plano. */
  const r = verificador.verificar('Temos 75 motoristas.', {
    pergunta: PERGUNTA,
    inicio_ms: 0,
    fim_ms: 1000,
    operacoes_do_turno: [],
  });
  assert.equal(r.status, 'invalido');
});
