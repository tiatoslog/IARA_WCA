/**
 * O PREÇO DO RACIOCÍNIO — e o que ele se recusa a inventar.
 *
 * O sistema contava tokens desde sempre e nunca soube dizer quanto um turno
 * custou. A tentação, ao acrescentar "roteamento consciente de custo", é fixar
 * uma tabela de preços no código. Seria a mesma doença do
 * `llama-3.3-70b-versatile`: um fato do mundo congelado, que envelhece sem
 * avisar e ninguém percebe até alguém medir.
 *
 * O caso que dá nome ao arquivo é o P4: preço desconhecido NUNCA é zero.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  custoDaChamada,
  emCentavos,
  precoDoProvedor,
  MICRO_CENTAVOS_POR_CENTAVO,
} from '../servidor/nucleo/PrecoDoRaciocinio';
import { OrcamentoDoTurno, TETOS_PADRAO } from '../servidor/nucleo/kernel/OrcamentoDoTurno';

const SEM_AMBIENTE = {} as NodeJS.ProcessEnv;

test('P1. camada gratuita custa zero, e o zero é declarado com fonte', () => {
  /* Zero aqui é fato da instalação — níveis sem cartão, foi por isso que
     entraram —, não suposição sobre o mercado. */
  for (const apelido of ['groq', 'gemini', 'openrouter', 'ollama']) {
    const p = precoDoProvedor(apelido, SEM_AMBIENTE);
    assert.ok(p, `${apelido} sem preço`);
    assert.equal(p.entrada_centavos_por_milhao, 0);
    assert.ok(p.fonte.length > 0, 'zero sem fonte é zero inventado');
  }
});

test('P2. a paga não tem preço até alguém declarar', () => {
  assert.equal(precoDoProvedor('anthropic', SEM_AMBIENTE), null);
});

test('P3. o ambiente vence o mapa — contrato próprio, sem deploy', () => {
  const amb = {
    IARA_PRECO_GROQ_ENTRADA: '50',
    IARA_PRECO_GROQ_SAIDA: '200',
  } as unknown as NodeJS.ProcessEnv;
  const p = precoDoProvedor('groq', amb);
  assert.equal(p?.entrada_centavos_por_milhao, 50);
  assert.match(p?.fonte ?? '', /ambiente/);
});

test('P4. preço desconhecido devolve null — e null NUNCA é zero', () => {
  /**
   * O erro que este teste impede: tratar desconhecido como grátis faria o teto
   * de dinheiro aprovar exatamente o turno mais caro da casa, porque o provedor
   * caro é justamente o que não tem preço declarado por padrão.
   */
  assert.equal(custoDaChamada('anthropic', 1_000_000, 1_000_000, SEM_AMBIENTE), null);
  assert.notEqual(custoDaChamada('anthropic', 1_000_000, 1_000_000, SEM_AMBIENTE), 0);
});

test('P5. a conta é inteira: tokens × centavos-por-milhão vira micro-centavos', () => {
  /* Sem divisão e sem ponto flutuante acumulando erro ao longo de um dia. */
  const amb = {
    IARA_PRECO_X_ENTRADA: '300',
    IARA_PRECO_X_SAIDA: '1500',
  } as unknown as NodeJS.ProcessEnv;
  const custo = custoDaChamada('x', 1_000_000, 1_000_000, amb);
  assert.equal(custo, 300 * 1_000_000 + 1_500 * 1_000_000);
  assert.equal(Number.isInteger(custo), true);
  /* 1.800 centavos = 18 unidades da moeda, para um milhão de cada. */
  assert.equal(emCentavos(custo ?? 0), '1800.0000');
});

test('P6. token negativo ou absurdo não vira crédito', () => {
  const amb = {
    IARA_PRECO_X_ENTRADA: '100',
    IARA_PRECO_X_SAIDA: '100',
  } as unknown as NodeJS.ProcessEnv;
  assert.equal(custoDaChamada('x', -5_000, Number.NaN, amb), 0);
});

test('P7. o teto de dinheiro nasce SEM valor, de propósito', () => {
  /**
   * Um limite cuja unidade ninguém declarou bloquearia turno por um número que
   * ninguém escolheu. O custo é sempre medido; o teto é opt-in.
   */
  assert.equal(TETOS_PADRAO.custo_micro_centavos, Number.MAX_SAFE_INTEGER);
  const o = new OrcamentoDoTurno();
  o.registrar('custo', 5_000 * MICRO_CENTAVOS_POR_CENTAVO);
  assert.equal(o.consumir('chamada_modelo').permitido, true, 'bloqueou sem teto declarado');
});

test('P8. com teto declarado, o custo bloqueia a chamada seguinte', () => {
  /* Mesma mecânica de `tokens`: ninguém sabe o custo antes de pagar, então o
     teto atua na próxima. */
  const orcamento = new OrcamentoDoTurno({
    ...TETOS_PADRAO,
    custo_micro_centavos: 10 * MICRO_CENTAVOS_POR_CENTAVO,
  });
  assert.equal(orcamento.consumir('chamada_modelo').permitido, true);
  orcamento.registrar('custo', 11 * MICRO_CENTAVOS_POR_CENTAVO);
  const v = orcamento.consumir('chamada_modelo');
  assert.equal(v.permitido, false);
  assert.equal(v.permitido === false && v.recurso, 'custo');
});

test('P9. custo e tokens são recursos DIFERENTES', () => {
  /**
   * Três chamadas de tokens iguais custam zero na camada gratuita e custam de
   * verdade na paga. Um teto de tokens não vê isso — é por isso que dinheiro é
   * dimensão própria e não um apelido para token.
   */
  const gratis = custoDaChamada('groq', 500_000, 500_000, SEM_AMBIENTE);
  const pago = custoDaChamada(
    'x',
    500_000,
    500_000,
    { IARA_PRECO_X_ENTRADA: '300', IARA_PRECO_X_SAIDA: '1500' } as unknown as NodeJS.ProcessEnv,
  );
  assert.equal(gratis, 0);
  assert.ok((pago ?? 0) > 0);
});

test('P10. o teto de TOKENS também passou a ser conferido', async () => {
  /**
   * ACHADO DE 19/08/2026, e ele já estava lá antes deste arquivo existir:
   * `registrar('tokens')` acumulava e `consumir('tokens')` não existia em lugar
   * nenhum do servidor. O teto de 120.000 era um número que nada lia — uma
   * proteção que se documentava como proteção e não era.
   *
   * Custo e tokens entram pela mesma porta e agora são conferidos pela mesma
   * regra: global, como o tempo.
   */
  const orcamento = new OrcamentoDoTurno({ ...TETOS_PADRAO, tokens: 100 });
  assert.equal(orcamento.consumir('chamada_modelo').permitido, true);
  orcamento.registrar('tokens', 150);
  const v = orcamento.consumir('chamada_modelo');
  assert.equal(v.permitido, false);
  assert.equal(v.permitido === false && v.recurso, 'tokens');
});

test('P11. apelido ausente é preço DESCONHECIDO, nunca exceção', () => {
  /**
   * `apelido` é obrigatório no contrato e há implementação que não o define. A
   * primeira versão fazia `apelido.toUpperCase()` direto e derrubou oito
   * cenários da escalada de uma vez.
   *
   * É a TERCEIRA vez nesta base: já aconteceu com `AbortSignal.any` no abandono
   * por demora e com o estimador de tokens. O padrão é o mesmo — contrato que
   * declara obrigatório o que na prática é opcional.
   */
  assert.equal(precoDoProvedor(undefined as never, SEM_AMBIENTE), null);
  assert.equal(precoDoProvedor('', SEM_AMBIENTE), null);
  assert.equal(custoDaChamada(undefined as never, 100, 100, SEM_AMBIENTE), null);
});
