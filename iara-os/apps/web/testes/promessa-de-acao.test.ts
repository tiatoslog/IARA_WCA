/**
 * A TRAVA CONTRA A PROMESSA VAZIA.
 *
 * Duas metades, e a segunda é a que decide se esta trava presta:
 *
 *  1. ela DISPARA contra as falas que a produção realmente produziu;
 *  2. ela NÃO dispara contra a fala honesta que se parece com aquelas.
 *
 * A metade 2 é a mais fácil de errar e a mais cara de descobrir: uma trava que
 * engole "quer que eu consulte por UF?" tira do ar exatamente a frase que
 * `Ambiguidade.ts` existe para produzir, e o operador nunca fica sabendo por
 * quê. Por isso as falas da seção 2 são reais, não inventadas para passar.
 *
 * As falas da seção 1 saíram de `test-evidence/AUTORIDADE-DE-DADOS/cognitiva-3`
 * e `-4`, medidas no navegador com modelo real em 19/08/2026.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lerPromessaDeAcao } from '../servidor/nucleo/kernel/PromessaDeAcao';

const IDS = ['consultar_infraestrutura', 'consultar_cargas_luft', 'criar_pasta', 'enviar_whatsapp'];

// ===========================================================================
// 1. DISPARA — as falas que a produção produziu
// ===========================================================================

test('1.1 fala medida: "[Chamando consultar_infraestrutura]"', () => {
  const r = lerPromessaDeAcao(
    'Vou puxar o número atual na base. [Chamando consultar_infraestrutura] ' +
      'Antes de te dar o número: aquele bloco não trazia nada útil.',
    IDS,
  );
  assert.equal(r.promete, true);
  assert.equal(r.especie, 'chamada_em_prosa');
  assert.match(String(r.ancora), /chamando/i);
});

test('1.2 fala medida: "Consulta: `consultar_infraestrutura` com `uf = GERAL`"', () => {
  const r = lerPromessaDeAcao(
    'Não vou tratar aquilo como se fosse a consulta em si. ' +
      'Vou consultar a base agora, direito. **Consulta:** `consultar_infraestrutura` com `uf = GERAL`',
    IDS,
  );
  assert.equal(r.promete, true);
  assert.equal(r.especie, 'chamada_em_prosa');
});

test('1.3 promessa sem nome de habilidade também é promessa', () => {
  const r = lerPromessaDeAcao('Vou verificar isso na base e já te digo o número.', IDS);
  assert.equal(r.promete, true);
  assert.equal(r.especie, 'promessa_futura');
  assert.match(String(r.ancora), /vou verificar/i);
});

test('1.4 gerúndio de espera: "Confirmando na base agora"', () => {
  assert.equal(lerPromessaDeAcao('Confirmando na base agora: preciso da UF.', IDS).promete, true);
});

test('1.5 "um momento" e "já te trago" prometem sem verbo de consulta', () => {
  assert.equal(lerPromessaDeAcao('Um momento, já te trago o número.', IDS).promete, true);
  assert.equal(lerPromessaDeAcao('Deixa comigo, volto já.', IDS).promete, true);
});

test('1.6 chamada com parênteses de argumento', () => {
  const r = lerPromessaDeAcao('Executo então consultar_cargas_luft(ano=2026) para você.', IDS);
  assert.equal(r.promete, true);
  assert.equal(r.especie, 'chamada_em_prosa');
});

test('1.7 marcador genérico, sem depender do catálogo', () => {
  assert.equal(lerPromessaDeAcao('<tool_call name="x">', []).promete, true);
  assert.equal(lerPromessaDeAcao('[executando a função de busca]', []).promete, true);
});

// ===========================================================================
// 2. NÃO DISPARA — a fala honesta que se parece com aquelas
// ===========================================================================

test('2.1 PERGUNTAR ao operador é a resposta certa, não uma promessa', () => {
  /* A frase que `Ambiguidade.ts` existe para produzir. Barrar isto seria tirar
     do ar o comportamento correto quando falta parâmetro. */
  assert.equal(lerPromessaDeAcao('Quer que eu consulte por UF?', IDS).promete, false);
  assert.equal(lerPromessaDeAcao('Posso verificar isso na base para você?', IDS).promete, false);
  assert.equal(
    lerPromessaDeAcao('Me diga a UF e eu consulto.', IDS).promete,
    false,
    'pedir o dado que falta não é prometer',
  );
});

test('2.2 RELATAR o que falhou nomeia a habilidade e é honestidade', () => {
  assert.equal(
    lerPromessaDeAcao(
      'Não consegui rodar consultar_infraestrutura: a UF veio inválida.',
      IDS,
    ).promete,
    false,
  );
  assert.equal(
    lerPromessaDeAcao('A chamada a `consultar_infraestrutura` falhou por parâmetro.', IDS).promete,
    false,
  );
});

test('2.3 CONDICIONAL não engana ninguém', () => {
  assert.equal(lerPromessaDeAcao('Se você quiser, eu consulto no próximo turno.', IDS).promete, false);
  assert.equal(lerPromessaDeAcao('Caso queira, verifico na base da próxima vez.', IDS).promete, false);
});

test('2.4 negativa explícita passa', () => {
  assert.equal(
    lerPromessaDeAcao('Não vou consultar agora — não tenho a UF que a base exige.', IDS).promete,
    false,
  );
  assert.equal(lerPromessaDeAcao('Não tenho como verificar isso neste turno.', IDS).promete, false);
});

test('2.5 a resposta APROVADA da bateria de navegador não pode ser barrada', () => {
  /* Texto real de `AUTORIDADE-DE-DADOS/cognitiva-6`, o run aprovado. Se esta
     trava o engolisse, ela teria trocado um defeito por outro. */
  const aprovada =
    'Agora dá 15 centrais ativas, com 255 veículos vinculados, e mais 2 fora de operação — ' +
    'não bate com o que te falei antes (13). Mas é bom pesar isso com cuidado: o resultado ' +
    'vem marcado como dataset semente de demonstração, não do banco real, que ainda não ' +
    'está conectado.';
  assert.equal(lerPromessaDeAcao(aprovada, IDS).promete, false);
});

test('2.6 a resposta determinística aprovada também passa', () => {
  const aprovada =
    '15 centrais ativas em toda a operação, somando 255 veículos vinculados. ' +
    '2 estão fora de operação. (Atenção: estes são dados de demonstração do dataset semente.)';
  assert.equal(lerPromessaDeAcao(aprovada, IDS).promete, false);
});

test('2.7 "vou resumir" e "vou explicar" descrevem a própria fala', () => {
  assert.equal(lerPromessaDeAcao('Vou resumir o que apurei em três pontos.', IDS).promete, false);
  assert.equal(lerPromessaDeAcao('Vou explicar por que os números divergem.', IDS).promete, false);
});

test('2.8 menção nua ao id, fora de posição de chamada, não acusa', () => {
  assert.equal(
    lerPromessaDeAcao('O dado veio de consultar_infraestrutura, com procedência de base.', IDS)
      .promete,
    false,
    'citar a origem do dado é procedência, não chamada',
  );
});

// ===========================================================================
// 3. BORDAS
// ===========================================================================

test('3.1 texto vazio, nulo e não-string não quebram', () => {
  assert.equal(lerPromessaDeAcao('', IDS).promete, false);
  assert.equal(lerPromessaDeAcao('   ', IDS).promete, false);
  assert.equal(lerPromessaDeAcao(undefined as unknown as string, IDS).promete, false);
});

test('3.2 catálogo vazio não desliga a família de promessa', () => {
  assert.equal(lerPromessaDeAcao('Vou consultar a base agora.', []).promete, true);
});

test('3.3 id com caractere de regex não explode', () => {
  assert.doesNotThrow(() => lerPromessaDeAcao('texto', ['a.b(c)*']));
});

test('3.4 a âncora é um trecho REAL do texto, nunca inventada', () => {
  const texto = 'Vou verificar na base agora.';
  const r = lerPromessaDeAcao(texto, IDS);
  assert.ok(r.ancora && texto.toLowerCase().includes(r.ancora.toLowerCase()));
});

test('3.5 uma oração honesta não desarma a promessa de outra', () => {
  /* O defeito espelhado que o cortador de orações existe para evitar: a
     negação da primeira não pode absolver a promessa da segunda. */
  const r = lerPromessaDeAcao(
    'Não consegui na primeira tentativa. Vou consultar a base agora.',
    IDS,
  );
  assert.equal(r.promete, true);
});
