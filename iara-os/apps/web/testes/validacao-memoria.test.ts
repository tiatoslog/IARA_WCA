/**
 * A BATERIA DE MEMÓRIA COMO PORTÃO DE REGRESSÃO.
 *
 * A suíte já cobria a ESCRITA (as três travas de `sobTrava` nasceram de 39
 * escritas concorrentes perdidas). Isto cobre a LEITURA, que ninguém media: de
 * 100 fatos gravados, quantos voltam certos e quantos voltam errados.
 *
 * O que a bateria mudou no produto: `podados` e `ultima_poda` no shard. A poda
 * acima de 3× o limite é necessária e era invisível — cortava os mais antigos e
 * nada dizia que houve corte, então "descartado pela poda" e "nunca foi gravado"
 * ficavam indistinguíveis para quem investiga.
 *
 * E o que ela ensinou sobre si mesma: a primeira versão confundiu JANELA DE
 * LEITURA com PODA e quase acusou perda de dado que não existia. Os 60 fatos
 * "perdidos" estavam no disco inteiros; o que os escondia era o `limite` que o
 * próprio teste passou. As duas medições ficaram separadas por isso.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirMemoria, taxasMemoria, violacoesDeMemoria, type JulgamentoMemoria } from './validacao/memoria';

let julgamentos: readonly JulgamentoMemoria[];
const achar = (id: string) => julgamentos.find((j) => j.id === id)!;

test('0. a bateria mede as cinco dimensões da leitura', async () => {
  julgamentos = await medirMemoria();
  for (const id of [
    'recall-na-janela',
    'janela-de-leitura-nao-e-perda',
    'janela-pequena-esconde-antigo',
    'poda-registra-a-perda',
    'falsa-memoria',
    'ordem-cronologica',
    'obsolescencia-vence-a-nova',
    'isolamento-entre-operadores',
  ]) {
    assert.ok(achar(id), `medição ausente: ${id}`);
  }
});

test('1. INVARIANTE: recall de 100% na janela e ZERO falsa memória', () => {
  const t = taxasMemoria(julgamentos);
  assert.equal(t.recall_na_janela, 1);
  assert.equal(t.falsa_memoria, 0);
  assert.equal(achar('ordem-cronologica').aprovado, true);
});

test('2. INVARIANTE: janela pequena não é perda — pedir mais devolve mais', () => {
  /* A distinção que a primeira versão da bateria errou. Se este teste falhar, ou
     a janela virou perda real, ou alguém trocou o significado do `limite`. */
  assert.equal(achar('janela-de-leitura-nao-e-perda').aprovado, true);
  assert.equal(achar('janela-pequena-esconde-antigo').aprovado, true);
});

test('3. INVARIANTE: a poda permanente deixa número e data', () => {
  /* Perda com número é investigável; perda silenciosa é indistinguível de fato
     nunca gravado. Se alguém remover o contador, este teste é o que avisa. */
  const poda = achar('poda-registra-a-perda');
  assert.equal(poda.aprovado, true, poda.medido);
  assert.match(poda.medido, /[1-9]\d* descartado/);
});

test('4. INVARIANTE: fato corrigido — a versão nova vence', () => {
  /* 8h depois corrigido para 10h: vigente tem de ser 600 minutos. O contrário
     seria a IARA repetir com confiança a informação que o operador já corrigiu. */
  assert.equal(achar('obsolescencia-vence-a-nova').aprovado, true);
  assert.match(achar('obsolescencia-vence-a-nova').medido, /vigente 600 min/);
});

test('5. INVARIANTE: nada cruza entre operadores', () => {
  assert.equal(achar('isolamento-entre-operadores').aprovado, true);
  assert.deepEqual(violacoesDeMemoria(julgamentos), []);
});

test('6. a bateria SABE acusar: medição reprovada aparece como violação', () => {
  const fabricado = julgamentos.map((j) =>
    j.id === 'falsa-memoria' ? { ...j, aprovado: false, medido: '3: [inventado]' } : j,
  );
  const violacoes = violacoesDeMemoria(fabricado);
  assert.equal(violacoes.length, 1);
  assert.match(violacoes[0], /falsa-memoria/);
  assert.equal(taxasMemoria(fabricado).falsa_memoria, 1);
});
