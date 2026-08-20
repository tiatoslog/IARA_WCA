/**
 * COMPARAÇÃO ENTRE RECORTES — e as três armadilhas que a operadora nomeou junto
 * com o pedido (19/08/2026).
 *
 *   1. BASE ZERO. `((B − A) / A) × 100` com `A = 0` é divisão por zero. Um
 *      sistema que devolve `Infinity%`, `100%` ou `0%` ali está inventando.
 *   2. PONTO PERCENTUAL ≠ POR CENTO. Margem de 30% para 33% subiu TRÊS PONTOS,
 *      e subiu 10% em termos relativos. "+3%" ali é errado.
 *   3. CONTRIBUIÇÃO PODE PASSAR DE 100%. Se o total caiu 100, uma central caiu
 *      150 e outra subiu 50, a primeira explica 150% da queda. É verdade, não
 *      defeito — e cortar em 100% esconderia o movimento em direções opostas.
 *
 * A comparação só existe porque as abas de 2025 e 2024 passaram a ser lidas no
 * mesmo dia. Antes disto, "compare 2025 com 2026" não era capacidade faltando:
 * era fonte que não existia.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  comparar,
  compararPercentual,
  decompor,
  dizerVariacao,
  dizerVariacaoPercentual,
} from '../servidor/nucleo/ComparacaoDePeriodos';

// ---------------------------------------------------------------------------
// 1. A conta básica
// ---------------------------------------------------------------------------

test('subida e queda com base — delta e percentual', () => {
  const sobe = comparar(100, 120);
  assert.equal(sobe.delta, 20);
  assert.equal(sobe.variacao_pct, 20);
  assert.equal(sobe.sem_base, false);

  const cai = comparar(4030, 2689);
  assert.equal(cai.delta, -1341);
  assert.ok(Math.abs(cai.variacao_pct! - -33.27) < 0.01, `deu ${cai.variacao_pct}`);
});

test('sem movimento é "não mudou", e não 0% escondido', () => {
  const c = comparar(500, 500);
  assert.equal(c.delta, 0);
  assert.equal(c.variacao_pct, 0);
  assert.equal(dizerVariacao(c), 'não mudou');
});

// ---------------------------------------------------------------------------
// 2. ARMADILHA 1 — base zero
// ---------------------------------------------------------------------------

/**
 * O caso é real na operação: uma central que não existia em 2024 e passou a
 * receber em 2025 tem base zero. `Infinity%` não é resposta, e "100%" é pior —
 * parece um número apurado.
 */
test('base zero devolve null, nunca infinito e nunca zero', () => {
  const c = comparar(0, 340);
  assert.equal(c.delta, 340);
  assert.equal(c.variacao_pct, null, 'inventou percentual sobre base zero');
  assert.equal(c.sem_base, true);
  assert.ok(Number.isFinite(c.delta));
});

test('e a frase diz o fato em vez de um percentual inventado', () => {
  const frase = dizerVariacao(comparar(0, 340));
  assert.match(frase, /saiu de zero para 340/);
  assert.match(frase, /não havia base/);
  assert.ok(!/Infinity|∞|NaN/.test(frase), `a frase vazou um não-número: "${frase}"`);
  assert.ok(!/\d+%/.test(frase), `a frase inventou um percentual: "${frase}"`);
});

test('zero para zero não é variação nenhuma', () => {
  const c = comparar(0, 0);
  assert.equal(c.delta, 0);
  assert.equal(dizerVariacao(c), 'não mudou');
});

// ---------------------------------------------------------------------------
// 3. ARMADILHA 2 — ponto percentual não é por cento
// ---------------------------------------------------------------------------

test('margem de 30% para 33% sobe 3 PONTOS e 10% em termos relativos', () => {
  const c = compararPercentual(30, 33);
  assert.equal(c.delta_pp, 3, 'a diferença em pontos percentuais está errada');
  assert.equal(c.variacao_relativa_pct, 10, 'a variação relativa está errada');
});

/**
 * O PORTÃO QUE IMPEDE O ERRO DE VIRAR FRASE. Uma resposta que diga "+3%" para
 * uma margem que subiu 3 pontos está errada, e é o erro mais comum desta conta.
 */
test('a frase da margem diz PONTOS PERCENTUAIS, e nunca "3%" sozinho', () => {
  const frase = dizerVariacaoPercentual(compararPercentual(30, 33));
  assert.match(frase, /3,0 pontos percentuais/, `deu "${frase}"`);
  assert.match(frase, /de 30,0% para 33,0%/, 'a frase precisa mostrar os dois lados');
  assert.match(frase, /10,0% em termos relativos/, 'a leitura relativa sumiu');
});

test('um único ponto percentual fica no singular', () => {
  assert.match(dizerVariacaoPercentual(compararPercentual(30, 31)), /1,0 ponto percentual\b/);
});

test('margem que não mudou não vira "0 pontos"', () => {
  assert.equal(dizerVariacaoPercentual(compararPercentual(30, 30)), 'ficou igual');
});

test('percentual ausente de um dos lados não vira zero', () => {
  const c = compararPercentual(null, 33);
  assert.equal(c.delta_pp, null, 'tratou ausência como zero — inventaria +33 pontos');
  assert.match(dizerVariacaoPercentual(c), /falta o percentual de um dos lados/);
});

test('margem partindo de zero por cento não gera variação relativa infinita', () => {
  const c = compararPercentual(0, 12);
  assert.equal(c.delta_pp, 12, 'os pontos percentuais existem mesmo com base zero');
  assert.equal(c.variacao_relativa_pct, null, 'a relativa dividiu por zero');
});

// ---------------------------------------------------------------------------
// 4. ARMADILHA 3 — decomposição e contribuição
// ---------------------------------------------------------------------------

const mapa = (o: Record<string, number>) => new Map(Object.entries(o));

test('a decomposição soma exatamente o movimento do total', () => {
  const d = decompor(mapa({ A: 100, B: 200, C: 50 }), mapa({ A: 120, B: 150, C: 50 }));
  assert.equal(d.total.anterior, 350);
  assert.equal(d.total.atual, 320);
  assert.equal(d.total.delta, -30);
  const soma = d.grupos.reduce((s, g) => s + g.delta, 0);
  assert.equal(soma, d.total.delta, 'a soma das partes não fecha com o todo');
});

test('a ordem é por MÓDULO do delta — quem mais mexeu o ponteiro vem primeiro', () => {
  const d = decompor(mapa({ A: 100, B: 200, C: 50 }), mapa({ A: 120, B: 150, C: 50 }));
  assert.equal(d.grupos[0].chave, 'B', 'a queda de 50 tinha de vir antes da subida de 20');
  assert.equal(d.grupos[1].chave, 'A');
});

/**
 * O CASO QUE A ARMADILHA 3 DESCREVE, com os números da operadora: total cai
 * 100, uma central cai 150, outra sobe 50. A primeira explica 150% da queda.
 */
test('contribuição passa de 100% quando há movimento em direções opostas — e isso é declarado', () => {
  const d = decompor(mapa({ X: 200, Y: 100 }), mapa({ X: 50, Y: 150 }));
  assert.equal(d.total.delta, -100);
  const x = d.grupos.find((g) => g.chave === 'X')!;
  const y = d.grupos.find((g) => g.chave === 'Y')!;
  assert.equal(x.delta, -150);
  assert.equal(x.contribuicao_pct, 150, 'cortou a contribuição em 100% e escondeu a compensação');
  assert.equal(y.contribuicao_pct, -50, 'quem subiu contra a maré tem contribuição negativa');
  assert.equal(d.tem_direcao_oposta, true, 'não acusou que há movimento em direções opostas');
});

test('sem direções opostas, ninguém é acusado de ter', () => {
  const d = decompor(mapa({ A: 100, B: 100 }), mapa({ A: 80, B: 90 }));
  assert.equal(d.tem_direcao_oposta, false);
});

test('total parado não produz contribuição — dividir por zero aqui é a armadilha 1 com outra roupa', () => {
  const d = decompor(mapa({ A: 100, B: 100 }), mapa({ A: 150, B: 50 }));
  assert.equal(d.total.delta, 0);
  for (const g of d.grupos) {
    assert.equal(g.contribuicao_pct, null, `${g.chave} recebeu contribuição sobre total parado`);
  }
});

/**
 * GRUPO QUE ENTRA E GRUPO QUE SAI. Uma central que existia num ano e sumiu no
 * outro tem delta igual ao volume inteiro dela; escondê-la faria a soma das
 * contribuições não fechar, e quem lê nunca saberia por quê.
 */
test('grupo que só existe num dos anos entra na conta e é declarado', () => {
  const d = decompor(mapa({ VELHA: 80, COMUM: 100 }), mapa({ COMUM: 100, NOVA: 60 }));
  assert.deepEqual(d.so_no_anterior, ['VELHA']);
  assert.deepEqual(d.so_no_atual, ['NOVA']);

  const velha = d.grupos.find((g) => g.chave === 'VELHA')!;
  assert.equal(velha.anterior, 80);
  assert.equal(velha.atual, 0, 'quem sumiu tem de aparecer com zero, não sumir da conta');
  assert.equal(velha.delta, -80);

  const soma = d.grupos.reduce((s, g) => s + g.delta, 0);
  assert.equal(soma, d.total.delta, 'a soma não fecha porque alguém foi escondido');
});

// ---------------------------------------------------------------------------
// 5. Relações metamórficas
// ---------------------------------------------------------------------------

test('MC1. comparar um recorte consigo mesmo dá zero em tudo', () => {
  const d = decompor(mapa({ A: 10, B: 20 }), mapa({ A: 10, B: 20 }));
  assert.equal(d.total.delta, 0);
  assert.equal(d.tem_direcao_oposta, false);
});

test('MC2. inverter os lados inverte o sinal do delta', () => {
  const ida = comparar(100, 130);
  const volta = comparar(130, 100);
  assert.equal(volta.delta, -ida.delta);
  /* Mas NÃO o percentual: +30% na ida e −23,1% na volta. A assimetria é da
     matemática, não um defeito — a base mudou. */
  assert.ok(Math.abs(volta.variacao_pct!) !== Math.abs(ida.variacao_pct!));
});

test('MC3. somar a mesma quantidade aos dois lados não muda o delta', () => {
  const a = comparar(100, 130);
  const b = comparar(600, 630);
  assert.equal(b.delta, a.delta);
  assert.ok(b.variacao_pct! < a.variacao_pct!, 'o percentual tem de encolher com base maior');
});

test('MC4. a decomposição é indiferente à ordem de inserção dos grupos', () => {
  const d1 = decompor(mapa({ A: 1, B: 2, C: 3 }), mapa({ C: 1, B: 2, A: 3 }));
  const d2 = decompor(mapa({ C: 3, B: 2, A: 1 }), mapa({ A: 3, B: 2, C: 1 }));
  assert.equal(d1.total.delta, d2.total.delta);
  assert.deepEqual(
    d1.grupos.map((g) => [g.chave, g.delta]).sort(),
    d2.grupos.map((g) => [g.chave, g.delta]).sort(),
  );
});

// ---------------------------------------------------------------------------
// 6. Nenhuma frase vaza não-número
// ---------------------------------------------------------------------------

test('nenhuma frase de variação contém Infinity, NaN ou undefined', () => {
  const casos: [number, number][] = [
    [0, 0],
    [0, 100],
    [100, 0],
    [100, 100],
    [1, 1_000_000],
    [1_000_000, 1],
  ];
  for (const [a, b] of casos) {
    const frase = dizerVariacao(comparar(a, b));
    assert.ok(
      !/Infinity|NaN|undefined|null|∞/.test(frase),
      `comparar(${a}, ${b}) produziu "${frase}"`,
    );
  }
});

test('nenhuma frase percentual vaza não-número', () => {
  const casos: [number | null, number | null][] = [
    [0, 0],
    [0, 15],
    [30, 0],
    [null, 30],
    [30, null],
    [null, null],
  ];
  for (const [a, b] of casos) {
    const frase = dizerVariacaoPercentual(compararPercentual(a, b));
    assert.ok(
      !/Infinity|NaN|undefined|∞/.test(frase),
      `compararPercentual(${a}, ${b}) produziu "${frase}"`,
    );
  }
});
