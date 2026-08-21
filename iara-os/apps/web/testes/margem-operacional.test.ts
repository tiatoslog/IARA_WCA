/**
 * MARGEM OPERACIONAL — a única métrica que cruza duas fontes, e por isso a que
 * mais precisa de portão.
 *
 * A MEDIÇÃO QUE AUTORIZOU ESCREVER ISTO (19/08/2026,
 * `testes/gate/cobertura-tabela.mjs`, contra a planilha real):
 *
 *   TABELA         117 linhas, 117 trechos únicos, 0 chaves ambíguas
 *   margem bruta   confere em 117/117
 *   margem c/ ped. confere em 117/117, sempre com o pedágio de IDA
 *                  (0/117 conferem com ida+volta)
 *
 *   cobertura por CARGA   2026: 100%    2025: 94,44%   2024: 88,07%
 *   cobertura por ROTA    2026: 100%    2025: 82,30%   2024: 71,11%
 *   NORMALIZED_EXACT      0 nos três anos — todo match é byte a byte
 *
 * As duas coberturas divergirem NÃO é defeito: em 2024, 71% das rotas cobrem 88%
 * das cargas porque o que ficou de fora é rota de pouco volume. É por isso que a
 * resposta carrega a cobertura POR CARGA — é ela que diz quanto do que se
 * faturou entrou na conta.
 *
 * O QUE ESTE ARQUIVO GUARDA:
 *
 *   · a conta contra um oráculo escrito à parte (`oraculoMargem.ts`);
 *   · a diferença entre margem AGREGADA e média das margens das rotas — as duas
 *     são verdadeiras e respondem perguntas diferentes;
 *   · o que acontece com rota sem preço, trecho ambíguo e carga sem valor;
 *   · as relações metamórficas da margem.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calcularMargem,
  margemMediaDasRotas,
  margemPorDimensao,
  precoDaCarga,
} from '../servidor/nucleo/MargemOperacional';
import { chaveDoTrecho, type CargaCompleta } from '../servidor/nucleo/ClientePlanilhaOcis';
import { chaveOraculo, margemEsperada, TABELA_COM_AMBIGUA, TABELA_TESTE } from './planilha/oraculoMargem';

/** Uma carga sintética. `valor` é a RECEITA — o que foi faturado. */
function carga(oci: string, origem: string, destino: string, valor: number | null, motorista = 'LINO'): CargaCompleta {
  return {
    ano: '2026',
    oci,
    origem,
    uf_origem: origem,
    destino,
    uf_destino: destino,
    motorista,
    data_rec_oci: '2026-01-01',
    data_coleta: '2026-01-05',
    data_descarga: '2026-01-06',
    status: 'FINALIZADO',
    status_normalizado: 'FINALIZADO',
    valor,
  };
}

/* SP→MT: 1000 receita, 600 custo, 50 pedágio. SP→GO: 2000/1400/100. */
const BASE: readonly CargaCompleta[] = [
  carga('A1', 'SP', 'MT', 1000),
  carga('A2', 'SP', 'MT', 1000),
  carga('A3', 'SP', 'GO', 2000),
];

// ---------------------------------------------------------------------------
// 1. A chave do cruzamento
// ---------------------------------------------------------------------------

test('a chave normaliza só formatação — nunca aproxima nomes diferentes', () => {
  assert.equal(chaveDoTrecho('  são  paulo ', 'Mato Grosso'), 'SAO PAULO > MATO GROSSO');
  /* E o portão que impede fuzzy matching de entrar por descuido. */
  assert.notEqual(chaveDoTrecho('POSTO A', 'X'), chaveDoTrecho('POSTO B', 'X'));
  assert.notEqual(chaveDoTrecho('TRES PONTAS', 'X'), chaveDoTrecho('TRES PONTAS DO SUL', 'X'));
});

test('a chave da produção e a do oráculo concordam', () => {
  for (const [o, d] of [
    ['SP', 'MT'],
    ['São Paulo', 'Goiás'],
    ['  BOA  ESPERANCA ', 'sorriso'],
  ] as const) {
    assert.equal(chaveDoTrecho(o, d), chaveOraculo(o, d));
  }
});

// ---------------------------------------------------------------------------
// 2. A conta, contra o oráculo independente
// ---------------------------------------------------------------------------

test('margem agregada bate com o oráculo escrito à parte', () => {
  const m = calcularMargem(BASE, TABELA_TESTE);
  const e = margemEsperada(BASE, TABELA_TESTE);

  assert.equal(m.receita, e.receita);
  assert.equal(m.custo, e.custo);
  assert.equal(m.pedagio, e.pedagio);
  assert.equal(m.resultado_bruto, e.resultado_bruto);
  assert.equal(m.resultado_com_pedagio, e.resultado_com_pedagio);
  assert.equal(m.percentual_bruto, e.percentual_bruto);
  assert.equal(m.percentual_com_pedagio, e.percentual_com_pedagio);
});

test('e os números são os da aritmética, conferidos à mão', () => {
  const m = calcularMargem(BASE, TABELA_TESTE);
  /* receita 1000+1000+2000 = 4000; custo 600+600+1400 = 2600; pedágio 50+50+100 = 200 */
  assert.equal(m.receita, 4000);
  assert.equal(m.custo, 2600);
  assert.equal(m.pedagio, 200);
  assert.equal(m.resultado_bruto, 1400);
  assert.equal(m.resultado_com_pedagio, 1200);
  assert.equal(m.percentual_bruto, 35);
  assert.equal(m.percentual_com_pedagio, 30);
});

/**
 * O PEDÁGIO É O DE IDA. Medido em 117 de 117 trechos da planilha real: nenhum
 * confere com ida+volta. Se alguém trocar por `pedagio_ida_volta`, este teste é
 * o que avisa — e o número dobraria em silêncio, tirando margem que existe.
 */
test('a margem com pedágio usa o pedágio de IDA, nunca ida e volta', () => {
  const m = calcularMargem([carga('A1', 'SP', 'MT', 1000)], TABELA_TESTE);
  assert.equal(m.pedagio, 50, 'usou ida e volta (100) no lugar da ida (50)');
  assert.equal(m.percentual_com_pedagio, 35, '(1000-600-50)/1000 = 35%');
});

// ---------------------------------------------------------------------------
// 3. Agregada NÃO é a média das rotas
// ---------------------------------------------------------------------------

/**
 * O ERRO CLÁSSICO DESTE CÁLCULO, travado por teste.
 *
 * SP→MT tem 40% de margem e duas cargas; SP→GO tem 30% e uma. A média simples
 * das rotas dá 35%. A agregada dá 1400/4000 = 35% também — coincidência do
 * fixture, então o teste usa números que SEPARAM as duas.
 */
test('margem agregada e média das rotas são contas diferentes, e a IARA sabe as duas', () => {
  /* Uma rota rica e minúscula, uma rota magra e enorme. */
  const cargas = [
    carga('R1', 'MG', 'MT', 1000), // 30% de margem, 1 carga
    ...Array.from({ length: 9 }, (_, i) => carga(`R${i + 2}`, 'SP', 'GO', 2000)), // 30%…
  ];
  const agregada = calcularMargem(cargas, TABELA_TESTE).percentual_bruto;
  const media = margemMediaDasRotas(cargas, TABELA_TESTE);
  assert.ok(agregada !== null && media !== null);
  /* MG→MT: (1000-700)/1000 = 30%. SP→GO: (2000-1400)/2000 = 30%. Iguais aqui,
     então o que este teste guarda é a EXISTÊNCIA das duas contas e o fato de
     nenhuma delas ser calculada a partir da outra. */
  assert.equal(Math.round(agregada), 30);
  assert.equal(Math.round(media!), 30);

  /* Agora com margens diferentes, o número tem de divergir. */
  const desiguais = [
    carga('D1', 'SP', 'MT', 1000), // 40%, 1 carga
    ...Array.from({ length: 19 }, (_, i) => carga(`D${i + 2}`, 'SP', 'GO', 2000)), // 30%, 19 cargas
  ];
  const ag = calcularMargem(desiguais, TABELA_TESTE).percentual_bruto!;
  const md = margemMediaDasRotas(desiguais, TABELA_TESTE)!;
  assert.equal(Math.round(md), 35, 'média simples das duas rotas: (40+30)/2');
  assert.ok(
    Math.abs(ag - 35) > 1,
    `a agregada (${ag.toFixed(1)}%) colapsou na média simples — o volume parou de pesar`,
  );
  assert.ok(ag < md, 'a rota grande é a de margem menor, então a agregada tem de ficar abaixo da média');
});

// ---------------------------------------------------------------------------
// 4. O que não tem preço não ganha margem inventada
// ---------------------------------------------------------------------------

test('rota sem tabelário fica UNMATCHED e não entra na conta', () => {
  const semPreco = carga('X1', 'MG', 'GO', 5000); // MG→GO não está na TABELA_TESTE
  const p = precoDaCarga(semPreco, TABELA_TESTE);
  assert.equal(p.classe, 'UNMATCHED');
  assert.equal(p.preco, null);

  const m = calcularMargem([...BASE, semPreco], TABELA_TESTE);
  assert.equal(m.receita, 4000, 'a receita da carga sem preço entrou na conta');
  assert.equal(m.resultado_bruto, 1400, 'a margem mudou por causa de uma carga sem custo conhecido');
  assert.equal(m.cobertura.sem_preco, 1);
  assert.deepEqual(m.cobertura.rotas_sem_preco, [{ rota: 'MG > GO', cargas: 1 }]);
});

test('trecho com dois preços é AMBIGUOUS — e não se escolhe um deles', () => {
  const c = carga('X2', 'MG', 'GO', 5000);
  assert.equal(precoDaCarga(c, TABELA_COM_AMBIGUA).classe, 'AMBIGUOUS');
  const m = calcularMargem([...BASE, c], TABELA_COM_AMBIGUA);
  assert.equal(m.cobertura.ambiguas, 1);
  assert.equal(m.resultado_bruto, 1400, 'a carga ambígua entrou na conta com um dos dois preços');
});

test('carga sem valor lançado não vira receita zero', () => {
  const c = carga('X3', 'SP', 'MT', null);
  assert.equal(precoDaCarga(c, TABELA_TESTE).classe, 'SEM_VALOR');
  const m = calcularMargem([...BASE, c], TABELA_TESTE);
  assert.equal(m.cobertura.sem_valor, 1);
  assert.equal(m.receita, 4000, 'a carga sem valor mexeu na receita');
  assert.equal(m.custo, 2600, 'a carga sem valor trouxe custo sem trazer receita — isso deprime a margem');
});

test('sem receita nenhuma, o percentual é null e não zero', () => {
  const m = calcularMargem([carga('Z1', 'SP', 'MT', null)], TABELA_TESTE);
  assert.equal(m.percentual_bruto, null, 'zero por cento afirmaria que não sobrou nada');
  assert.equal(m.percentual_com_pedagio, null);
});

test('a cobertura é reportada em número, não em impressão', () => {
  const m = calcularMargem([...BASE, carga('X1', 'MG', 'GO', 5000)], TABELA_TESTE);
  assert.equal(m.cobertura.cargas, 4);
  assert.equal(m.cobertura.com_preco, 3);
  assert.equal(m.cobertura.percentual, 75);
});

// ---------------------------------------------------------------------------
// 5. Relações metamórficas
// ---------------------------------------------------------------------------

test('MM1. carga nova numa rota existente não muda a margem UNITÁRIA da rota', () => {
  const antes = margemPorDimensao(BASE, TABELA_TESTE, 'rota').find((g) => g.chave === 'SP → MT')!;
  const depois = margemPorDimensao([...BASE, carga('N1', 'SP', 'MT', 1000)], TABELA_TESTE, 'rota').find(
    (g) => g.chave === 'SP → MT',
  )!;
  assert.equal(depois.margem.percentual_bruto, antes.margem.percentual_bruto, 'o percentual da rota mudou');
  assert.equal(depois.margem.resultado_bruto, antes.margem.resultado_bruto + 400, 'o resultado não acompanhou o volume');
});

test('MM2. carga nova numa rota de margem diferente MUDA a agregada', () => {
  const antes = calcularMargem(BASE, TABELA_TESTE).percentual_bruto!;
  const depois = calcularMargem([...BASE, carga('N2', 'MG', 'MT', 1000)], TABELA_TESTE).percentual_bruto!;
  assert.notEqual(depois, antes, 'a agregada ignorou uma carga de margem diferente');
});

test('MM3. carga em rota SEM tabelário não muda nenhum número da margem', () => {
  const antes = calcularMargem(BASE, TABELA_TESTE);
  const depois = calcularMargem([...BASE, carga('N3', 'MG', 'GO', 9999)], TABELA_TESTE);
  assert.equal(depois.receita, antes.receita);
  assert.equal(depois.resultado_bruto, antes.resultado_bruto);
  assert.equal(depois.percentual_bruto, antes.percentual_bruto);
  /* Mas a cobertura CAI, e é ela que conta a história. */
  assert.ok(depois.cobertura.percentual! < antes.cobertura.percentual!);
});

test('MM4. subir o custo do trecho derruba a margem, na medida exata', () => {
  const maisCaro = {
    preco: new Map(TABELA_TESTE.preco).set(chaveDoTrecho('SP', 'MT'), {
      ...TABELA_TESTE.preco.get(chaveDoTrecho('SP', 'MT'))!,
      valor_motorista: 700,
    }),
    ambiguas: TABELA_TESTE.ambiguas,
  };
  const antes = calcularMargem(BASE, TABELA_TESTE);
  const depois = calcularMargem(BASE, maisCaro);
  assert.equal(depois.custo, antes.custo + 200, 'duas cargas SP→MT, R$100 a mais de custo em cada');
  assert.equal(depois.resultado_bruto, antes.resultado_bruto - 200);
});

test('MM5. reordenar as cargas não muda nada', () => {
  const a = calcularMargem(BASE, TABELA_TESTE);
  const b = calcularMargem([...BASE].reverse(), TABELA_TESTE);
  assert.equal(b.resultado_bruto, a.resultado_bruto);
  assert.equal(b.percentual_bruto, a.percentual_bruto);
});

test('MM6. a soma dos resultados por dimensão fecha com o resultado total', () => {
  const total = calcularMargem(BASE, TABELA_TESTE).resultado_bruto;
  for (const dim of ['rota', 'origem', 'destino', 'motorista'] as const) {
    const soma = margemPorDimensao(BASE, TABELA_TESTE, dim).reduce((s, g) => s + g.margem.resultado_bruto, 0);
    assert.equal(soma, total, `a soma por ${dim} não fecha com o total`);
  }
});

// ---------------------------------------------------------------------------
// 6. Por dimensão
// ---------------------------------------------------------------------------

test('a ordem é por RESULTADO, não por percentual — volume pesa', () => {
  /* SP→GO tem 30% e fatura 2000; SP→MT tem 40% e fatura 2000 em duas cargas. */
  const g = margemPorDimensao(BASE, TABELA_TESTE, 'rota');
  assert.equal(g[0].chave, 'SP → MT', 'a rota de maior resultado não veio primeiro');
  assert.equal(g[0].margem.resultado_bruto, 800);
  assert.equal(g[1].margem.resultado_bruto, 600);
});

test('a margem por posto e por central usa o vocabulário da operação', () => {
  const porPosto = margemPorDimensao(BASE, TABELA_TESTE, 'origem');
  assert.deepEqual(porPosto.map((g) => g.chave), ['SP']);
  const porCentral = margemPorDimensao(BASE, TABELA_TESTE, 'destino');
  assert.deepEqual(new Set(porCentral.map((g) => g.chave)), new Set(['MT', 'GO']));
});

test('ausência de dimensão não vira grupo — a mesma regra de sempre', () => {
  const semMotorista = { ...carga('S1', 'SP', 'MT', 1000), motorista: '' };
  const g = margemPorDimensao([...BASE, semMotorista], TABELA_TESTE, 'motorista');
  assert.deepEqual(g.map((x) => x.chave), ['LINO'], 'a carga sem motorista virou um grupo');
});
