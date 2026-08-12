/**
 * Testes da trava de origem.
 *
 * Com o motor headless, a interface mora noutro domínio e "mesma origem" deixa
 * de existir: esta lista passa a ser a ÚNICA coisa entre a IARA e qualquer
 * página da internet. Navegador não aplica CORS a WebSocket — se a checagem
 * ceder aqui, ninguém a segura depois.
 *
 * Os casos negativos são o assunto. Que `https://iara.atoslog.com.br` case com
 * ele mesmo não prova nada; o que prova é o que NÃO casa.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { casaOrigem, origemNaLista, temCuringa } from '../lib/origens';

test('sem curinga, o casamento é literal — nunca por prefixo', () => {
  const padrao = 'https://iara.atoslog.com.br';

  assert.equal(casaOrigem('https://iara.atoslog.com.br', padrao), true);

  // O erro nº 1 deste deploy, e ele TEM que falhar: barra final e esquema
  // trocado são origens diferentes para o navegador, e precisam ser aqui também.
  assert.equal(casaOrigem('https://iara.atoslog.com.br/', padrao), false);
  assert.equal(casaOrigem('http://iara.atoslog.com.br', padrao), false);

  // Prefixo compartilhado: um domínio registrável por outra pessoa.
  assert.equal(casaOrigem('https://iara.atoslog.com.br.evil.com', padrao), false);
  assert.equal(casaOrigem('https://iara.atoslog.com', padrao), false);
});

test('curinga cobre UM rótulo de subdomínio, e só', () => {
  const padrao = 'https://*.vercel.app';

  assert.equal(casaOrigem('https://iara-preview.vercel.app', padrao), true);
  assert.equal(casaOrigem('https://abc123.vercel.app', padrao), true);

  // Sem rótulo nenhum no lugar do curinga: `+` exige ao menos um caractere.
  assert.equal(casaOrigem('https://.vercel.app', padrao), false);
  assert.equal(casaOrigem('https://vercel.app', padrao), false);

  // O curinga NÃO atravessa ponto. Se atravessasse, um subdomínio de segundo
  // nível na conta de outra pessoa entraria pela mesma porta.
  assert.equal(casaOrigem('https://a.b.vercel.app', padrao), false);
});

test('as duas âncoras da regex — os dois buracos que elas fecham', () => {
  const padrao = 'https://*.vercel.app';

  // Sem a âncora final: o domínio do atacante vem DEPOIS do sufixo autorizado.
  assert.equal(casaOrigem('https://x.vercel.app.evil.com', padrao), false);

  // Sem a âncora inicial: o fragmento carrega o sufixo esperado e o host real
  // é outro. (Origin nunca traz fragmento de verdade — a checagem não pode
  // depender disso para estar correta.)
  assert.equal(casaOrigem('https://evil.com/#.vercel.app', padrao), false);
  assert.equal(casaOrigem('https://evil.com/?x=https://a.vercel.app', padrao), false);

  // Credenciais no autoridade: `https://a.vercel.app@evil.com` é servido por
  // evil.com. O `@` não está na classe do curinga, então não passa.
  assert.equal(casaOrigem('https://a.vercel.app@evil.com', padrao), false);
});

test('metacaracteres no padrão são escapados, não interpretados', () => {
  // Um ponto literal não pode virar "qualquer caractere": se virasse,
  // `https://iaraXatoslog.com.br` casaria com o domínio de produção.
  assert.equal(casaOrigem('https://iaraXatoslog.com.br', 'https://iara.atoslog.com.br'), false);
});

test('lista vazia não autoriza ninguém', () => {
  assert.equal(origemNaLista('https://iara.atoslog.com.br', []), false);
});

test('origemNaLista aceita se QUALQUER padrão casar', () => {
  const lista = ['https://iara.atoslog.com.br', 'https://*.vercel.app'];
  assert.equal(origemNaLista('https://iara.atoslog.com.br', lista), true);
  assert.equal(origemNaLista('https://preview-7.vercel.app', lista), true);
  assert.equal(origemNaLista('https://evil.com', lista), false);
});

test('temCuringa enxerga o curinga em qualquer posição da lista', () => {
  assert.equal(temCuringa([]), false);
  assert.equal(temCuringa(['https://iara.atoslog.com.br']), false);
  assert.equal(temCuringa(['https://iara.atoslog.com.br', 'https://*.vercel.app']), true);
});
