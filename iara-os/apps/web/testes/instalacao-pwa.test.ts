/**
 * Testes da classificação de instalação do PWA.
 *
 * O bug que este recurso existe para impedir: oferecer o gesto errado na
 * plataforma errada — um botão "Instalar" no iPhone (onde não existe evento
 * de instalação), a instrução do Safari no Chrome do iOS (que não instala),
 * ou reoferecer instalação dentro do app já instalado. A tabela de decisão é
 * pura (`lib/instalacaoPwa.ts`) exatamente para caber inteira aqui.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { classificarInstalacao } from '../lib/instalacaoPwa';

const UA_IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1';
const UA_IPAD_MODERNO =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const UA_CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36';
const UA_CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.64 Mobile Safari/537.36';

// UN-001 — instalada vence tudo: é a única resposta que nunca pode estar errada.
test('standalone é "instalada" em QUALQUER plataforma, mesmo com prompt capturado', () => {
  for (const ua of [UA_IPHONE_SAFARI, UA_IPHONE_CHROME, UA_CHROME_WINDOWS, UA_CHROME_ANDROID]) {
    assert.equal(
      classificarInstalacao({ ua, standalone: true, promptCapturado: true, toques: 5 }),
      'instalada',
    );
  }
});

// UN-002 — iPhone no Safari recebe a instrução do Compartilhar.
test('iPhone Safari → ios_safari (não existe botão de prompt no iOS)', () => {
  assert.equal(
    classificarInstalacao({
      ua: UA_IPHONE_SAFARI,
      standalone: false,
      promptCapturado: false,
      toques: 5,
    }),
    'ios_safari',
  );
});

// UN-003 — os navegadores de iOS que NÃO instalam mandam a pessoa ao Safari.
test('iPhone fora do Safari → ios_navegador', () => {
  for (const marca of ['CriOS/126.0', 'FxiOS/127.0', 'EdgiOS/126.0', 'OPiOS/4.0']) {
    const ua = UA_IPHONE_SAFARI.replace('Version/17.5', marca);
    assert.equal(
      classificarInstalacao({ ua, standalone: false, promptCapturado: false, toques: 5 }),
      'ios_navegador',
      `UA com ${marca} deveria mandar ao Safari`,
    );
  }
});

// UN-004 — o iPad moderno mente que é um Macintosh; os toques o denunciam.
test('iPad (UA de Macintosh + toques) → ios_safari; Mac de verdade → manual', () => {
  assert.equal(
    classificarInstalacao({
      ua: UA_IPAD_MODERNO,
      standalone: false,
      promptCapturado: false,
      toques: 5,
    }),
    'ios_safari',
  );
  // O mesmo UA sem toques é um Mac de verdade rodando Safari: caminho manual.
  assert.equal(
    classificarInstalacao({
      ua: UA_IPAD_MODERNO,
      standalone: false,
      promptCapturado: false,
      toques: 0,
    }),
    'manual',
  );
});

// UN-005 / UN-007 — o convite capturado vira botão, no desktop e no Android.
test('prompt capturado → pronta (Chrome no Windows e no Android)', () => {
  for (const ua of [UA_CHROME_WINDOWS, UA_CHROME_ANDROID]) {
    assert.equal(
      classificarInstalacao({ ua, standalone: false, promptCapturado: true, toques: 0 }),
      'pronta',
    );
  }
});

// UN-006 — sem convite não há botão: o caminho honesto é o menu do navegador.
test('desktop sem prompt → manual (nunca um botão morto)', () => {
  assert.equal(
    classificarInstalacao({
      ua: UA_CHROME_WINDOWS,
      standalone: false,
      promptCapturado: false,
      toques: 0,
    }),
    'manual',
  );
});

// O prompt capturado NUNCA muda a resposta no iOS: o evento não existe lá, e
// se algum navegador exótico o emitir, o caminho do iOS continua sendo o real.
test('iOS ignora prompt capturado', () => {
  assert.equal(
    classificarInstalacao({
      ua: UA_IPHONE_SAFARI,
      standalone: false,
      promptCapturado: true,
      toques: 5,
    }),
    'ios_safari',
  );
});
