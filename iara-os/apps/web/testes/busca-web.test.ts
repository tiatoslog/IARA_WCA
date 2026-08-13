/**
 * BUSCA WEB — a regressão do parser que devolvia vazio em silêncio.
 *
 * O defeito não foi encontrado lendo código nem rodando a suíte: foi preciso
 * executar a habilidade contra o DuckDuckGo de verdade e reparar que a resposta
 * "não achei nada utilizável sobre isso na web" saía para uma consulta que o
 * buscador respondia com dez resultados.
 *
 * CAUSA: o padrão exigia `class="result__body"` com a aspa colada no nome, e o
 * HTML servido traz `class="links_main links_deep result__body"`.
 *
 * Estes testes não tocam a rede — de propósito. O que estava quebrado era a
 * leitura do HTML, e um teste de rede seria lento, intermitente e mudo no dia em
 * que o DuckDuckGo estivesse fora. O HTML abaixo é a forma REAL observada em
 * 13/08/2026, reduzida ao que importa.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { extrairResultados } from '../servidor/nucleo/BuscaWeb';

/** A forma que o DuckDuckGo serve hoje: a classe vem por último, acompanhada. */
const HTML_REAL = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexemplo.br">Cancelamento extempor&#x27;aneo de CT-e</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=x">O emitente deve transmitir o pedido em at&amp;eacute; 7 dias.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=y">Portal do CT-e</a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=y">Manual do contribuinte, vers&amp;atilde;o 3.00.</a>
  </div>
</div>
<div id="rodape"></div>
`;

test('P1. o bloco é reconhecido quando a classe vem acompanhada de outras', () => {
  const achados = extrairResultados(HTML_REAL, 3);

  assert.equal(achados.length, 2, 'o parser voltou a devolver zero resultado');
  assert.match(achados[0].titulo, /Cancelamento/);
  assert.match(achados[0].resumo, /7 dias/);
  assert.match(achados[1].titulo, /Portal do CT-e/);
});

test('P1b. a forma antiga, com a classe sozinha, continua sendo lida', () => {
  /**
   * A correção casa por TOKEN. Se alguém a trocar por um padrão que exige a
   * companhia de outras classes, terá consertado o caso de hoje e quebrado o de
   * ontem — que é o mesmo erro na direção oposta.
   */
  const antigo = `
    <div class="result__body">
      <h2><a class="result__a" href="#">Título antigo</a></h2>
      <a class="result__snippet" href="#">Resumo antigo</a>
    </div>`;

  const achados = extrairResultados(antigo, 3);
  assert.equal(achados.length, 1);
  assert.equal(achados[0].titulo, 'Título antigo');
  assert.equal(achados[0].resumo, 'Resumo antigo');
});

test('P1c. resultado sem resumo NÃO rouba o resumo do vizinho', () => {
  /**
   * A razão de a extração ser por bloco. Em duas listas paralelas, o resultado
   * sem snippet desloca todos os pares seguintes — e o título A sai com o
   * resumo do B, que é a forma mais convincente de mentir sobre uma fonte.
   */
  const misto = `
    <div class="links_main result__body">
      <h2><a class="result__a" href="#">Sem resumo</a></h2>
    </div>
    <div class="links_main result__body">
      <h2><a class="result__a" href="#">Com resumo</a></h2>
      <a class="result__snippet" href="#">Este resumo é do segundo</a>
    </div>`;

  const achados = extrairResultados(misto, 3);
  assert.equal(achados.length, 2);
  assert.equal(achados[0].titulo, 'Sem resumo');
  assert.equal(achados[0].resumo, '', 'o primeiro resultado herdou o resumo do segundo');
  assert.equal(achados[1].resumo, 'Este resumo é do segundo');
});

test('P1d. o limite é respeitado e HTML sem resultado devolve lista vazia', () => {
  assert.equal(extrairResultados(HTML_REAL, 1).length, 1);
  assert.deepEqual(extrairResultados('<html><body>nada aqui</body></html>', 3), []);
});
