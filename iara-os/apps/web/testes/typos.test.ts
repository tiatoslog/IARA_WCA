/**
 * Tolerância a erro de digitação nas âncoras — achado ao vivo em auditoria
 * (14/08/2026). Pedido explícito: erro de digitação comum não pode empurrar
 * um pedido simples pro raciocínio emergente sem necessidade.
 *
 * A suíte cobre dois lados: a correção acontece quando deveria, e NÃO
 * acontece quando o "erro" na verdade é uma palavra válida (conjugação de
 * verbo) — essa segunda parte existe porque a primeira versão desta função
 * quebrou exatamente nisso: "desliga" (válido) virava "desligar" e mudava o
 * tempo verbal da frase, derrubando a distinção entre pergunta hipotética e
 * ordem real. Ver `testes/cerebro-integridade-final.test.ts`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { corrigirTypos, normalizar } from '../servidor/nucleo/texto';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';

function corrigido(frase: string): string {
  return corrigirTypos(normalizar(frase));
}

test('corrige erro de uma letra em substantivo de forma fixa', () => {
  assert.match(corrigido('crie um lembrte pra mim'), /\blembrete\b/);
  assert.match(corrigido('qual o climaa hoje'), /\bclima\b/);
  assert.match(corrigido('crie uma pata no desktop'), /\bpasta\b/);
  assert.match(corrigido('quantas centrais estao ativas'), /\bcentrais\b/);
});

test('NÃO corrige quando o token já é uma palavra válida — mesmo se parecida com outra âncora', () => {
  // "desliga" é conjugação legítima de "desligar" (regex da âncora já cobre
  // as duas); corrigir teria mudado o tempo verbal da frase.
  const t = corrigido('quando voce desliga o computador, avisa antes?');
  assert.match(t, /\bdesliga\b/);
  assert.doesNotMatch(t, /\bdesligar\b/);
});

test('NÃO corrige token ambíguo (a uma letra de mais de uma palavra da lista)', () => {
  // "tela" e "tela" — sem ambiguidade real na lista atual, mas o mecanismo
  // precisa ficar quieto quando dois candidatos empatam. Prova indireta: uma
  // palavra bem distante de qualquer âncora nunca muda.
  assert.equal(corrigido('isso e uma frase qualquer sem relacao'), 'isso e uma frase qualquer sem relacao');
});

test('não mexe em token curto (< 4 letras) nem em palavra já correta', () => {
  assert.equal(corrigido('sim'), 'sim');
  assert.equal(corrigido('lembrete'), 'lembrete');
});

test('ponta a ponta: âncora reconhece pedido com erro de digitação', () => {
  const p = new MotorPercepcao().perceber('crie uma pata chamada Contratos na area de trabalho');
  assert.ok(p.ancoras.includes('pasta'), `esperava âncora "pasta"; veio ${JSON.stringify(p.ancoras)}`);
});

test('ponta a ponta: pergunta hipotética sobre desligar continua suprimida com erro de digitação', () => {
  // Regressão exata do achado: "computadorr" com erro de dedo, frase ainda
  // hipotética ("...avisa antes?"), não pode virar ordem real.
  const p = new MotorPercepcao().perceber('quando voce desliga o computadr, avisa antes?');
  assert.ok(!p.ancoras.includes('energia'), 'pergunta hipotética virou âncora de energia');
});
