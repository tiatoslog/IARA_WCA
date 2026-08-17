/**
 * ROTEAMENTO como portão de regressão — e a caracterização que faltava.
 *
 * A pergunta da Fase 12 é "o roteador melhora qualidade, custo ou latência, ou só
 * parece mais esperto?". Medido em 17/08/2026: `CadeiaDeRaciocinio` é FAILOVER com
 * saúde, não roteador. Três tarefas de tamanhos muito diferentes ("oi", "resuma em
 * uma palavra", análise de doze meses com projeção) caíram no MESMO elo.
 *
 * Isso não é defeito e este arquivo não reprova por isso: é lacuna declarada. O que
 * ele trava é o que a cadeia PROMETE — atravessar elo quebrado, não insistir em
 * quem acabou de falhar, e não variar de escolha sem motivo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirRoteamento, violacoesDeRoteamento, type JulgamentoRoteamento } from './validacao/roteamento';

let julgamentos: readonly JulgamentoRoteamento[];
const achar = (id: string) => julgamentos.find((j) => j.id === id)!;

test('0. as quatro medições rodaram', async () => {
  julgamentos = await medirRoteamento();
  assert.equal(julgamentos.length, 4);
});

test('1. INVARIANTE: elo quebrado não derruba o turno', () => {
  const f = achar('failover-atravessa-o-elo-quebrado');
  assert.equal(f.aprovado, true, f.medido);
  /* A prova de que o failover foi EXERCITADO, e não que o primeiro elo funcionou:
     dois elos tentados na mesma chamada. */
  assert.match(f.medido, /→/);
});

test('2. INVARIANTE: quem falhou por cota não é o primeiro tentado', () => {
  /**
   * É a regressão de um defeito real de 17/08: a cadeia tentava o provedor sem
   * crédito PRIMEIRO em todo turno — três chamadas desperdiçadas para fazer uma. O
   * campo `observacoes` existia e ninguém no caminho de execução o lia.
   */
  const c = achar('carencia-desce-quem-falhou');
  assert.equal(c.aprovado, true, c.medido);
  assert.ok(!c.medido.includes('[caro-e-bom'), `a cadeia voltou a insistir: ${c.medido}`);
});

test('3. INVARIANTE: sem falha, a escolha não varia entre chamadas', () => {
  /* Escolha que varia sem motivo faz o operador ver qualidade oscilando sem
     explicação, e faz custo variar sem ninguém saber por quê. */
  assert.equal(achar('ordem-estavel-sem-falha').aprovado, true);
});

test('4. CARACTERIZAÇÃO: não há roteamento por tarefa nem por custo', () => {
  const c = achar('nao-roteia-por-tarefa-nem-custo');
  assert.equal(c.caracterizacao, true);
  /* Caracterização NÃO reprova — mas tem de continuar sendo medida. Se um dia o
     roteamento por custo entrar, este caso é o que mostra o antes e o depois. */
  assert.match(c.medido, /elo\(s\) distinto\(s\) para 3 tarefas/);
  assert.deepEqual(violacoesDeRoteamento(julgamentos), []);
});

test('5. a bateria SABE acusar — e caracterização nunca vira violação', () => {
  const comFalha = julgamentos.map((j) =>
    j.id === 'failover-atravessa-o-elo-quebrado' ? { ...j, aprovado: false } : j,
  );
  assert.equal(violacoesDeRoteamento(comFalha).length, 1);

  const caracterizacaoFalsa = julgamentos.map((j) =>
    j.caracterizacao ? { ...j, aprovado: false } : j,
  );
  assert.deepEqual(
    violacoesDeRoteamento(caracterizacaoFalsa),
    [],
    'caracterização reprovada não pode virar violação — senão a lacuna declarada bloquearia o veredito',
  );
});
