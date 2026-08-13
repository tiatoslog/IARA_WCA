/**
 * O ENQUADRAMENTO DA GEMA — a conta que decide se ela aparece.
 *
 * Em 13/08/2026 a presença passou a recolher para um círculo de 56px no
 * celular, e dentro dele não aparecia gema nenhuma. A causa não era WebGL nem
 * Canvas: era aritmética. A pedra ocupa `1/(distância × tan(abertura/2))` da
 * altura do palco, e em 18,5 isso dá 0,25 — um quarto de 56px são 14px de cromo
 * escuro sobre fundo escuro. Ela estava sendo desenhada o tempo todo, do
 * tamanho de um caractere.
 *
 * O palco é WebGL e não abre num teste de Node; a fórmula é pura. Ela mora
 * fora do componente exatamente para que este arquivo exista.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ABERTURA,
  DISTANCIA_CAMERA,
  DISTANCIA_ICONE,
  distanciaDoEnquadramento,
  fracaoDaAltura,
} from '../components/projecao/enquadramento';

test('a fórmula reproduz o enquadramento documentado do palco', () => {
  /**
   * O número 0,25 está escrito no comentário do palco desde o desvio das fitas.
   * Se alguém mexer na distância ou na abertura sem reler aquele texto, é aqui
   * que a divergência aparece — o comentário deixa de mentir sozinho.
   */
  const fracao = fracaoDaAltura(DISTANCIA_CAMERA);
  assert.ok(
    Math.abs(fracao - 0.25) < 0.01,
    `no palco a pedra deve ocupar ~1/4 da altura; deu ${fracao.toFixed(3)}`,
  );
});

test('no ícone a gema é grande o bastante para ser vista, e não encosta na borda', () => {
  const fracao = fracaoDaAltura(DISTANCIA_ICONE);

  assert.ok(
    fracao > 0.6,
    `abaixo de 0,6 a gema volta a ser um ponto no círculo de 56px; deu ${fracao.toFixed(3)}`,
  );
  assert.ok(
    fracao < 0.95,
    `encostando na borda ela vira mancha em vez de joia; deu ${fracao.toFixed(3)}`,
  );

  // O defeito exato que isto conserta, em pixels: 56px de círculo.
  const pixels = 56 * fracao;
  assert.ok(pixels > 34, `${pixels.toFixed(0)}px de gema ainda é pequeno demais para ler como objeto`);
});

test('o enquadramento vem do TAMANHO do palco, nunca da intenção do React', () => {
  // O ícone do celular.
  assert.equal(distanciaDoEnquadramento(56, 56), DISTANCIA_ICONE);

  /**
   * O DEFEITO QUE QUASE SAIU DAQUI. A primeira versão recebia `recolhida` por
   * propriedade — e no computador esse estado nasce `true`, porque quem decide
   * se ele vale é a consulta de mídia do CSS. A câmera de ícone teria ido para
   * um palco de 900px. Este caso é a prova de que a medida manda.
   */
  assert.equal(
    distanciaDoEnquadramento(884, 800),
    DISTANCIA_CAMERA,
    'palco de computador nunca pode receber o enquadramento de ícone',
  );

  // Palco de celular aberto (58dvh num aparelho estreito): ainda é palco.
  assert.equal(distanciaDoEnquadramento(375, 471), DISTANCIA_CAMERA);
});

test('tamanho zero — o instante antes do primeiro ResizeObserver — não vira ícone', () => {
  /**
   * Errar para o palco grande custa um quadro invisível; errar para o ícone
   * daria um salto de câmera na abertura da página, que é o tipo de defeito
   * que ninguém consegue reproduzir depois.
   */
  assert.equal(distanciaDoEnquadramento(0, 0), DISTANCIA_CAMERA);
  assert.equal(distanciaDoEnquadramento(0, 800), DISTANCIA_CAMERA);
});

test('a lente não muda: reenquadrar é mexer na distância', () => {
  /**
   * A regra está escrita em dois comentários e agora tem prova. Se alguém
   * "consertar" um enquadramento abrindo a lente, a assinatura de grande
   * angular volta — a esfera cresce nas bordas do quadro — e é exatamente o
   * que a referência da marca não tem.
   */
  assert.equal(ABERTURA, 24, 'a abertura é a lente; trocá-la troca o caráter da imagem');
});
