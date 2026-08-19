/**
 * REL-0005 — "e amanhã?" tem que herdar a pergunta, não recomeçar do zero.
 *
 * O DEFEITO, medido na auditoria em navegador de 19/08/2026:
 *
 *   operadora:  quantas cargas hoje?
 *   IARA:       hoje (19/08): 15 cargas.
 *   operadora:  e amanhã?
 *   IARA:       "Não tenho o total de cargas para amanhã ainda. Posso consultar
 *                a base e trazer o número de cargas previstas para 20/08/2026.
 *                Você autoriza?"
 *
 * Duas coisas erradas numa frase só. Ela não consultou o que sabe consultar, e
 * inventou um portão de autorização que não existe — a habilidade é leitura,
 * risco baixo, custo zero. E o segundo turno é exatamente onde a operadora
 * disse que toda sessão desanda.
 *
 * A CAUSA não era o modelo: "e amanhã?" não tem substantivo da operação nem
 * verbo de contagem, então o contrato devolvia `fora` e a frase caía no
 * raciocínio livre. A análise estava certa — a frase, SOZINHA, não quer dizer
 * nada.
 *
 * A CORREÇÃO É SUBSTITUIÇÃO DE SLOT. Uma elipse não é pergunta nova: é a MESMA
 * pergunta com um campo trocado. Reinterpretar do zero seria pedir à LLM que
 * adivinhasse operação, métrica e política de nulo outra vez — e é assim que
 * período e entidade se perdem entre turnos.
 *
 * ESTE ARQUIVO PROVA AS DUAS METADES: o que a elipse herda, e o que ela NÃO
 * pode herdar. A segunda é a que impede a correção de virar um buraco por onde
 * entra capacidade que a pergunta inteira não tem.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assinaturaDoContrato,
  ehElipseFactual,
  herdarContrato,
  interpretarContratoFactual,
  type ContratoFactual,
} from '../servidor/nucleo/kernel/ContratoFactual';
import { ContratoAnterior, VALIDADE_MS } from '../servidor/nucleo/kernel/ContratoAnterior';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';

const percepcao = new MotorPercepcao();
const planejador = new Planejador();
const CTX = { id_usuario: 'u-elipse', sessao: 's-elipse' };

/** O contrato de uma frase que forma contrato sozinha. Falha alto se não formar. */
function contratoDe(frase: string): ContratoFactual {
  const l = interpretarContratoFactual(frase);
  if (l.tipo !== 'contrato') throw new Error(`"${frase}" não formou contrato`);
  return l.contrato;
}

// ---------------------------------------------------------------------------
// 1. O que é elipse, e o que não é
// ---------------------------------------------------------------------------

test('as continuações que a operadora escreve são reconhecidas como elipse', () => {
  for (const f of [
    'e amanhã?',
    'e ontem?',
    'e hoje?',
    'e semana passada?',
    'e na semana passada?',
    'e essa semana?',
    'e em 2025?',
    'e por motorista?',
    'e por central?',
    'e por posto?',
  ]) {
    assert.ok(ehElipseFactual(f), `"${f}" não foi reconhecida como continuação`);
  }
});

/**
 * A METADE QUE PROTEGE. Sem estas recusas, qualquer frase começada por "e"
 * viraria consulta à planilha — inclusive as que não têm nada a ver com ela.
 */
test('frase que só COMEÇA com "e" não é elipse factual', () => {
  for (const f of [
    'e aí?',
    'e agora, o que eu faço?',
    'e o relatório que pedi ontem, saiu?',
    'entao me diga uma curiosidade',
    'essa semana está corrida',
    'e você, tudo bem?',
    'preciso que você me explique tudo sobre a operação e sobre a semana passada também, com calma',
  ]) {
    assert.ok(!ehElipseFactual(f), `"${f}" foi tratada como continuação factual`);
  }
});

test('pergunta completa não precisa de elipse — ela forma contrato sozinha', () => {
  const l = interpretarContratoFactual('quantas cargas amanhã?');
  assert.equal(l.tipo, 'contrato');
});

// ---------------------------------------------------------------------------
// 2. A herança troca UM slot e preserva o resto
// ---------------------------------------------------------------------------

test('"e amanhã?" troca só o período — o incidente REL-0005', () => {
  const antes = contratoDe('quantas cargas hoje?');
  const depois = herdarContrato('e amanhã?', antes);
  assert.ok(depois, 'a continuação não herdou nada');
  if (!depois) return;

  assert.equal(depois.operacao, antes.operacao, 'a operação mudou');
  assert.equal(depois.dimensao, antes.dimensao, 'a dimensão mudou');
  assert.equal(depois.metrica, antes.metrica, 'a métrica mudou');
  assert.equal(depois.politica_nulo, antes.politica_nulo, 'a política de nulo mudou');
  assert.equal(depois.fonte, antes.fonte, 'a fonte mudou');
  assert.equal(depois.periodo.expressao, 'amanha', 'o período não foi substituído');
});

test('"e por motorista?" troca só a dimensão, e preserva o período herdado', () => {
  const antes = contratoDe('quantas cargas essa semana?');
  const depois = herdarContrato('e por motorista?', antes);
  assert.ok(depois);
  if (!depois) return;
  assert.equal(depois.dimensao, 'motorista');
  assert.equal(depois.periodo.expressao, 'essa semana', 'o período se perdeu na troca de eixo');
});

test('"e por central?" usa o vocabulário da operação e cai em destino', () => {
  const antes = contratoDe('quantas cargas hoje?');
  const depois = herdarContrato('e por central?', antes);
  assert.ok(depois);
  if (!depois) return;
  assert.equal(depois.dimensao, 'destino');
  assert.equal(depois.entidade, 'central');
});

/**
 * O ANO É PERÍODO, e herdá-lo é o que faz "e em 2025?" chegar à porta que sabe
 * tratá-lo. Sem isto a frase volta ao raciocínio livre — e foi de lá que saiu
 * "preciso que você autorize a leitura desse arquivo", um portão inventado.
 */
test('"e em 2025?" herda como período, para a porta do ano decidir', () => {
  const antes = contratoDe('quantas cargas temos?');
  const depois = herdarContrato('e em 2025?', antes);
  assert.ok(depois);
  if (!depois) return;
  assert.equal(depois.periodo.tipo, 'explicito');
  assert.equal(depois.periodo.expressao, '2025');
});

test('elipse sem slot reconhecível não herda nada', () => {
  const antes = contratoDe('quantas cargas hoje?');
  assert.equal(herdarContrato('e daí?', antes), null);
});

/**
 * O QUE A ELIPSE NÃO PODE CRIAR. Filtro por entidade nomeada não existe no
 * motor, e `EXCETO` já recusa a forma completa ("quantas cargas do motorista
 * LINO?"). Herdar por elipse o que a pergunta inteira não alcança seria abrir
 * pela porta dos fundos uma capacidade que não existe.
 */
test('"e no posto Três Pontas?" não vira filtro por elipse', () => {
  const antes = contratoDe('quantas cargas hoje?');
  const depois = herdarContrato('e no posto tres pontas?', antes);
  if (depois) {
    assert.notEqual(
      assinaturaDoContrato(depois),
      assinaturaDoContrato(antes),
      'herdou sem trocar nada',
    );
    /* Se herdou, herdou como TROCA DE DIMENSÃO — nunca como filtro pelo nome. */
    assert.equal(depois.dimensao, 'origem');
    assert.ok(
      !JSON.stringify(depois.parametros).toLowerCase().includes('tres pontas'),
      'o nome da entidade virou filtro, e filtro não existe no motor',
    );
  }
});

// ---------------------------------------------------------------------------
// 3. A memória da conversa
// ---------------------------------------------------------------------------

test('a memória é por operador e por sessão — dois fios não se misturam', () => {
  const m = new ContratoAnterior();
  m.registrar('ana', 's1', contratoDe('quantas cargas hoje?'));
  assert.ok(m.ler('ana', 's1'));
  assert.equal(m.ler('ana', 's2'), null, 'vazou entre sessões da mesma pessoa');
  assert.equal(m.ler('bruno', 's1'), null, 'vazou entre operadores');
});

test('a pergunta anterior envelhece — meia hora depois, "e amanhã?" é outra pergunta', () => {
  const m = new ContratoAnterior();
  const t0 = 1_000_000;
  m.registrar('ana', 's1', contratoDe('quantas cargas hoje?'), t0);
  assert.ok(m.ler('ana', 's1', t0 + VALIDADE_MS - 1), 'esqueceu cedo demais');
  assert.equal(m.ler('ana', 's1', t0 + VALIDADE_MS + 1), null, 'lembrou tempo demais');
});

// ---------------------------------------------------------------------------
// 4. Ponta a ponta pelo pipeline de produção
// ---------------------------------------------------------------------------

test('o turno 1 registra e o turno 2 herda — plano determinístico nos dois', () => {
  const planejadorLocal = new Planejador();

  const p1 = percepcao.perceber('quantas cargas hoje?');
  assert.ok(p1.ancoras.includes('contrato_factual'));
  const plano1 = planejadorLocal.planejar(p1, CTX);
  assert.equal(plano1.origem, 'deterministico');
  assert.equal(plano1.passos[0].parametros.periodo, 'hoje');

  const p2 = percepcao.perceber('e amanhã?');
  assert.ok(p2.ancoras.includes('contrato_factual'), 'a elipse perdeu a âncora');
  const plano2 = planejadorLocal.planejar(p2, CTX);
  assert.equal(plano2.origem, 'deterministico', 'a continuação caiu no raciocínio livre');
  assert.equal(plano2.passos[0].habilidade, 'consultar_estatisticas_cargas_luft');
  assert.equal(plano2.passos[0].parametros.periodo, 'amanha');
  assert.equal(plano2.passos[0].parametros.metrica, 'contagem', 'a métrica se perdeu');
  assert.match(plano2.passos[0].descricao, /herdado/, 'o trace não declara que foi herança');
});

/**
 * ELIPSE SEM ANTECEDENTE É GENUINAMENTE AMBÍGUA. Adivinhar ali seria pior que
 * não responder: "e amanhã?" dito do nada pode ser sobre carga, sobre a agenda
 * ou sobre o tempo. Cai no raciocínio livre, que é onde a pergunta ambígua deve
 * cair.
 */
test('elipse sem pergunta anterior degrada para raciocínio, e não inventa contexto', () => {
  const planejadorLocal = new Planejador();
  const p = percepcao.perceber('e amanhã?');
  const plano = planejadorLocal.planejar(p, { id_usuario: 'ninguem', sessao: 'nova' });
  assert.equal(plano.origem, 'emergente');
  assert.equal(plano.passos[0].habilidade, 'raciocinio');
});

test('sem contexto de conversa, a elipse também não herda', () => {
  const planejadorLocal = new Planejador();
  const p = percepcao.perceber('e amanhã?');
  const plano = planejadorLocal.planejar(p, null);
  assert.equal(plano.origem, 'emergente');
});

/**
 * A CADEIA DE TRÊS TURNOS — o cenário que a operadora disse que nunca sobrevive.
 * Cada elipse herda do turno IMEDIATAMENTE anterior, inclusive de outra elipse.
 */
test('cadeia de continuações: cada uma herda da anterior, inclusive de outra elipse', () => {
  const planejadorLocal = new Planejador();
  const ctx = { id_usuario: 'u-cadeia', sessao: 's-cadeia' };

  planejadorLocal.planejar(percepcao.perceber('quantas cargas hoje?'), ctx);
  const t2 = planejadorLocal.planejar(percepcao.perceber('e amanhã?'), ctx);
  assert.equal(t2.passos[0].parametros.periodo, 'amanha');

  /* Agora troca o EIXO, mantendo o período que veio da elipse anterior. */
  const t3 = planejadorLocal.planejar(percepcao.perceber('e por central?'), ctx);
  assert.equal(t3.origem, 'deterministico');
  assert.equal(t3.passos[0].parametros.agrupar_por, 'destino');
  assert.equal(t3.passos[0].parametros.periodo, 'amanha', 'o período se perdeu no terceiro turno');
});
