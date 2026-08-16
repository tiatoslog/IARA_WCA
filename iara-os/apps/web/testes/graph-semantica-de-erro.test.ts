/**
 * ERRO DE CREDENCIAL NÃO É ARQUIVO SUMIDO.
 *
 * O QUE A OPERADORA LEU EM 16/08/2026, ao pedir a planilha de cargas:
 *
 *   "Não consegui localizar a planilha: Graph recusou localizar a planilha
 *    (HTTP 401): {"error":{"code":"InvalidAuthenticationToken","message":
 *    "Lifetime validation failed, the token is expired." ...
 *
 * Duas coisas erradas na mesma frase.
 *
 * A CATEGORIA. Um token expirado foi apresentado como problema de localizar
 * arquivo. São defeitos diferentes, com consertos diferentes e donos
 * diferentes: quem lê "não localizei" vai procurar a planilha no SharePoint,
 * conferir permissão de pasta, perguntar se alguém moveu o arquivo. O arquivo
 * está lá. O que venceu foi a credencial — e ninguém teria descoberto isso pela
 * frase, só pelo JSON colado no fim dela.
 *
 * O JSON CRU. O cabeçalho do `ClienteGraph` promete, em voz alta, que "o texto
 * que chega ao operador é sempre REDIGIDO por este módulo — nunca o JSON cru da
 * Graph". A promessa era verdadeira lá e falsa no `ClientePlanilhaOcis`, que
 * montava a própria mensagem sem passar por ele. Contrato que vale num módulo e
 * não no vizinho não é contrato: é comentário.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classificarExcecaoGraph,
  classificarStatusGraph,
  modoDeAutenticacaoGraph,
} from '../servidor/nucleo/ClienteGraph';

const QUE_SE_QUERIA = 'localizar a planilha de cargas';

/** Reposição do ambiente entre casos — `modoDeAutenticacaoGraph` lê `process.env`. */
async function comAmbiente(vars: Record<string, string | undefined>, corpo: () => void): Promise<void> {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    corpo();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// A categoria sobrevive
// ---------------------------------------------------------------------------

test('401 é credencial — e a frase NÃO diz que não localizou a planilha', () => {
  const f = classificarStatusGraph(401, QUE_SE_QUERIA);
  assert.equal(f.classe, 'credencial');
  assert.match(f.frase, /credencial do Microsoft 365 expirou/i);
  assert.ok(
    !/não localizei|não consegui localizar/i.test(f.frase),
    'a frase de credencial voltou a falar em localizar arquivo',
  );
});

test('403 é permissão, e diz que falta escopo — não que o arquivo sumiu', () => {
  const f = classificarStatusGraph(403, QUE_SE_QUERIA);
  assert.equal(f.classe, 'permissao');
  assert.match(f.frase, /permissão/i);
  assert.match(f.frase, /escopo/i);
  assert.ok(!/não localizei/i.test(f.frase));
});

/** O ÚNICO status em que "não localizei" é verdade. */
test('404 é o único caso em que a IARA diz que não localizou', () => {
  const f = classificarStatusGraph(404, QUE_SE_QUERIA);
  assert.equal(f.classe, 'nao_encontrado');
  assert.match(f.frase, /Não localizei/i);
  assert.match(f.frase, new RegExp(QUE_SE_QUERIA));
});

test('429 e 5xx são serviço — nem credencial, nem arquivo', () => {
  const limite = classificarStatusGraph(429, QUE_SE_QUERIA);
  assert.equal(limite.classe, 'servico');
  assert.match(limite.frase, /devagar|429/i);

  const fora = classificarStatusGraph(503, QUE_SE_QUERIA);
  assert.equal(fora.classe, 'servico');
  assert.match(fora.frase, /503/);
  for (const f of [limite, fora]) {
    assert.ok(!/não localizei/i.test(f.frase), 'erro de serviço virou arquivo sumido');
  }
});

test('sem resposta HTTP a classe é rede — não houve conversa para o arquivo faltar', () => {
  const tempo = classificarExcecaoGraph(new Error('The operation was aborted due to timeout'), QUE_SE_QUERIA);
  assert.equal(tempo.classe, 'rede');
  assert.match(tempo.frase, /não respondeu a tempo/i);

  const caiu = classificarExcecaoGraph(new Error('fetch failed ECONNREFUSED'), QUE_SE_QUERIA);
  assert.equal(caiu.classe, 'rede');
  assert.ok(!/não localizei/i.test(caiu.frase));
});

// ---------------------------------------------------------------------------
// Nada de JSON cru
// ---------------------------------------------------------------------------

test('o corpo de erro da Graph nunca vaza para a frase do operador', () => {
  const corpoReal =
    '{"error":{"code":"InvalidAuthenticationToken","message":"Lifetime validation failed, ' +
    'the token is expired.","innerError":{"date":"2026-08-16T01:12:22","request-id":"f2d5a2a2"}}}';
  const f = classificarStatusGraph(401, QUE_SE_QUERIA);
  assert.ok(!f.frase.includes('{'), 'JSON cru na frase do operador');
  assert.ok(!f.frase.includes(corpoReal));
  assert.ok(!/request-id/i.test(f.frase));
});

test('exceção comprida é cortada e vira uma linha só', () => {
  const f = classificarExcecaoGraph(new Error('x\n'.repeat(500)), QUE_SE_QUERIA);
  assert.ok(f.frase.length < 260, `frase longa demais: ${f.frase.length}`);
  assert.ok(!f.frase.includes('\n'), 'quebra de linha na bolha de chat');
});

// ---------------------------------------------------------------------------
// O 401 diz COMO consertar, e o conserto depende do modo
// ---------------------------------------------------------------------------

/**
 * "A credencial expirou" tem consertos OPOSTOS nos dois modos. No manual é o
 * comportamento esperado de um token de ~1h que ninguém renovou, e o conserto é
 * configurar a credencial de app. Uma mensagem que não distingue os dois manda a
 * pessoa colar outro token que também vai vencer em uma hora — que foi
 * exatamente o ciclo observado.
 */
test('no modo manual, o 401 aponta as variáveis que ligam a renovação automática', async () => {
  await comAmbiente(
    {
      MS_GRAPH_TOKEN: 'token-colado-a-mao',
      MS_GRAPH_CLIENT_ID: undefined,
      MS_GRAPH_TENANT_ID: undefined,
      MS_GRAPH_CLIENT_SECRET: undefined,
    },
    () => {
      const f = classificarStatusGraph(401, QUE_SE_QUERIA);
      assert.match(f.frase, /MS_GRAPH_CLIENT_ID/);
      assert.match(f.frase, /MS_GRAPH_TENANT_ID/);
      assert.match(f.frase, /MS_GRAPH_CLIENT_SECRET/);
    },
  );
});

test('sem token nenhum, o modo é declarado como desligado — não como expirado', async () => {
  await comAmbiente(
    {
      MS_GRAPH_TOKEN: undefined,
      MS_GRAPH_CLIENT_ID: undefined,
      MS_GRAPH_TENANT_ID: undefined,
      MS_GRAPH_CLIENT_SECRET: undefined,
    },
    () => {
      assert.match(modoDeAutenticacaoGraph(), /desligado/i);
    },
  );
});
