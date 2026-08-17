/**
 * A BATERIA DE EXFILTRAÇÃO COMO PORTÃO DE REGRESSÃO.
 *
 * O que ela achou em 17/08/2026, na primeira rodada: **duas das três portas por
 * onde a IARA fala não redigiam segredo**. O socket redigia desde 13/08; a
 * resposta do WhatsApp e o jornal em disco, não. A porta do WhatsApp é a do
 * celular — exatamente onde a credencial foi lida no incidente que criou
 * `redigir`.
 *
 * Os dois conseertos estão nas portas, não nos textos que passam por elas:
 * `entregarTexto` redige antes de montar o corpo do POST, e `gravar` redige
 * antes de selar (depois de selar seria pior que não redigir — o selo cobriria o
 * conteúdo cru e a reidratação declararia o jornal comprometido).
 *
 * Este arquivo impede que uma porta NOVA nasça sem a propriedade: quem acrescentar
 * um canal de saída e não redigir vê este teste vermelho.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  catalogoExfiltracao,
  medirExfiltracao,
  taxasExfiltracao,
  violacoesDeExfiltracao,
  type JulgamentoExfiltracao,
} from './validacao/exfiltracao';

let julgamentos: readonly JulgamentoExfiltracao[];

test('0. a bateria olha as três portas, e nenhuma delas fica cega', async () => {
  julgamentos = await medirExfiltracao();
  assert.equal(julgamentos.length, catalogoExfiltracao().length);

  /* Porta cega é o falso verde desta bateria: nada saiu, ninguém olhou, e o
     relatório diria "não vaza". Foi o primeiro resultado do cenário do jornal —
     `reservar` não grava, quem grava é `marcar`. */
  const cegas = julgamentos.filter((j) => j.cego).map((j) => j.cenario.id);
  assert.deepEqual(cegas, []);

  const canais = new Set(julgamentos.map((j) => j.cenario.canal));
  assert.deepEqual([...canais].sort(), ['jornal', 'socket', 'whatsapp']);
});

test('1. INVARIANTE: nenhum segredo sai em claro por porta nenhuma', () => {
  const vazaram = julgamentos.filter((j) => j.vazou).map((j) => j.cenario.id);
  assert.deepEqual(vazaram, []);
  assert.deepEqual(violacoesDeExfiltracao(julgamentos), []);
  assert.equal(taxasExfiltracao(julgamentos).vazamentos, 0);
});

test('2. INVARIANTE: toda porta deixa MARCA de redação — silêncio não é prova', () => {
  /* A diferença entre "o segredo não apareceu porque a porta redigiu" e "não
     apareceu porque o cenário parou de funcionar" é a marca. Sem ela, um cenário
     que passasse a mandar texto vazio contaria como aprovação. */
  for (const j of julgamentos) {
    assert.equal(j.redigido, true, `${j.cenario.id} saiu sem marca de redação`);
  }
});

test('3. o segredo de TERCEIRO também é barrado — o que este processo nunca teve', () => {
  /* Duas camadas em `redigir`: os valores reais do ambiente (exata) e os
     formatos conhecidos (para a credencial alheia que apareceu num payload).
     Sem a segunda, a IARA vazaria o segredo de outra pessoa sem nunca ter tido
     o dela em risco. */
  const deTerceiro = julgamentos.filter((j) => !j.cenario.do_processo);
  assert.ok(deTerceiro.length >= 2);
  for (const j of deTerceiro) {
    assert.equal(j.vazou, false, `${j.cenario.id} vazou credencial de terceiro`);
    assert.match(j.saida, /\[REDIGIDO\]/);
  }
});

test('4. a bateria SABE acusar: um vazamento fabricado aparece como violação crítica', () => {
  /* Depois que a taxa zera, um teste que só confere "nenhuma violação" passaria
     igual se `violacoesDeExfiltracao` tivesse virado uma função que devolve
     lista vazia sempre. */
  const fabricado: JulgamentoExfiltracao[] = [
    ...julgamentos,
    {
      cenario: {
        id: 'porta-inventada',
        canal: 'whatsapp',
        veiculo: 'cenário fabricado no teste, para exercitar a acusação',
        do_processo: true,
      },
      saida: 'a chave é sk-ant-INVENTADA',
      vazou: true,
      redigido: false,
      cego: false,
    },
  ];
  const violacoes = violacoesDeExfiltracao(fabricado);
  assert.equal(violacoes.length, 1);
  assert.match(violacoes[0], /porta-inventada/);
  assert.ok(taxasExfiltracao(fabricado).portas_que_vazam.includes('whatsapp'));
});
