/**
 * Microfone aberto e mudo — a parte pura da detecção.
 *
 * O resto (AudioContext, fluxo do VAD, relógio de 4 Hz) vive no navegador e não
 * é testável aqui; a decisão "este dispositivo capta alguma coisa?" é, e é ela
 * que separa um alerta útil de um alerta que pisca em toda pausa da conversa.
 *
 * O QUE ESTES TESTES PROTEGEM, em uma frase: em 15/08/2026 a IARA passou dias
 * "sem ouvir" porque o Windows apontava o dispositivo de comunicação padrão para
 * uma webcam de celular desconectada. Aquilo abre fluxo válido, reporta 48 kHz e
 * uma faixa ativa, e entrega amostras nulas. Nada na tela dizia isso.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { PISO_DE_SINAL, ehSilencioDigital, picoDe } from '../hooks/useDeteccaoVocal';

/** `getByteTimeDomainData` centra o repouso em 128, não em 0. */
const REPOUSO = 128;

function janela(preencher: (i: number) => number, tamanho = 512): Uint8Array {
  const a = new Uint8Array(tamanho);
  for (let i = 0; i < tamanho; i += 1) a[i] = preencher(i);
  return a;
}

test('silêncio digital absoluto: pico zero', () => {
  assert.equal(picoDe(janela(() => REPOUSO)), 0);
});

test('o repouso é 128 e não 0 — ler errado daria meio volume para o silêncio', () => {
  // A armadilha que este teste tranca: uma janela de zeros NÃO é silêncio, é
  // o sinal encostado no fundo da escala.
  assert.equal(picoDe(janela(() => 0)), 1);
});

test('fala de verdade fica muito acima do piso', () => {
  const senoide = janela((i) => REPOUSO + Math.round(100 * Math.sin(i / 8)));
  assert.ok(picoDe(senoide) > 0.5, `esperava pico alto, veio ${picoDe(senoide)}`);
  assert.equal(ehSilencioDigital(picoDe(senoide)), false);
});

test('ruído de sala — pequeno, mas existe — NÃO é dispositivo mudo', () => {
  /**
   * O caso que decide a utilidade da faixa. Um microfone real numa sala quieta
   * entrega ruído térmico de poucas unidades acima do repouso. Se isto contasse
   * como "mudo", o alerta apareceria toda vez que a pessoa ficasse calada — e um
   * alerta que aparece sem motivo é um alerta que se aprende a ignorar.
   */
  const salaQuieta = janela((i) => REPOUSO + (i % 3) - 1); // ±1 de 128
  const pico = picoDe(salaQuieta);
  assert.ok(pico > PISO_DE_SINAL, `ruído de sala (${pico}) deveria passar do piso`);
  assert.equal(ehSilencioDigital(pico), false);
});

test('desvio de uma unidade ainda conta como sinal', () => {
  // 1/128 = 0,0078 — quatro vezes o piso. É a menor coisa que um conversor real
  // produz, e ela precisa passar.
  assert.equal(ehSilencioDigital(picoDe(janela(() => REPOUSO + 1))), false);
});

test('o piso é baixo o bastante para não engolir sinal real', () => {
  // Guarda contra alguém "calibrar" o piso para cima e transformar a detecção
  // num gerador de falso positivo silencioso.
  assert.ok(PISO_DE_SINAL < 1 / 128, `piso ${PISO_DE_SINAL} engoliria o menor sinal possível`);
});
