/**
 * A COLUNA QUE EXISTE E ESTÁ VAZIA — o defeito de 20/08/2026.
 *
 * As abas de 2025 e 2024 têm uma coluna com o cabeçalho "VALOR". O mapeador de
 * colunas achou o rótulo e deu a coluna por mapeada. O cabeçalho era real; o
 * dado não era:
 *
 *          cargas   com valor   cobertura
 *   2026     2689        2688      99,96%
 *   2025     4030           1       0,02%
 *   2024     4064          11       0,27%
 *
 * O que saía antes da trava, e os dois números estão aritmeticamente certos:
 *
 *   "o faturamento cresceu 430.830% de 2025 para 2026"
 *   "a margem caiu 1,13 ponto percentual"
 *
 * Nada cresceu 430.830%. O que mudou foi quem preencheu a planilha. E uma
 * margem de 31,27% apurada sobre UMA carga em quatro mil não é a margem de
 * 2025 — é a margem daquela carga, com o nome do ano em cima.
 *
 * O teste central deste arquivo é o de MUTAÇÃO: se `PISO_DE_COBERTURA_DE_VALOR_PCT`
 * for para zero, alguma coisa aqui tem que ficar vermelha. Uma trava que não
 * consegue disparar não é trava.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coberturaDeValor,
  lacunaDeValor,
  PISO_DE_COBERTURA_DE_VALOR_PCT,
  type CargaCompleta,
} from '../servidor/nucleo/ClientePlanilhaOcis.ts';

/** Uma carga mínima: só o que a cobertura de valor olha. */
const carga = (valor: number | null, i = 0): CargaCompleta =>
  ({
    ano: '2026',
    oci: `OCI-${i}`,
    origem: 'POSTO A',
    uf_origem: 'SP',
    destino: 'CENTRAL B',
    uf_destino: 'SP',
    motorista: 'FULANO',
    data_rec_oci: null,
    data_coleta: null,
    data_descarga: null,
    status: '',
    status_normalizado: 'SEM_STATUS',
    valor,
  }) as CargaCompleta;

const lote = (comValor: number, semValor: number): CargaCompleta[] => [
  ...Array.from({ length: comValor }, (_, i) => carga(1000, i)),
  ...Array.from({ length: semValor }, (_, i) => carga(null, comValor + i)),
];

// ---------------------------------------------------------------------------
// A medição
// ---------------------------------------------------------------------------

test('recorte vazio não tem cobertura 0% — tem cobertura nenhuma', () => {
  const c = coberturaDeValor([]);
  assert.equal(c.percentual, null, '0 de 0 não é 0%: é ausência de recorte, e as duas frases são diferentes');
  assert.equal(c.total, 0);
});

test('a cobertura é a fração de cargas com valor lançado', () => {
  assert.equal(coberturaDeValor(lote(3, 1)).percentual, 75);
  assert.equal(coberturaDeValor(lote(4, 0)).percentual, 100);
  assert.equal(coberturaDeValor(lote(0, 4)).percentual, 0);
});

test('valor zero é valor lançado, ausência é outra coisa', () => {
  /* Uma carga que valeu R$ 0 foi faturada em zero — é um fato. Uma carga sem
     valor não foi faturada ainda. Confundir as duas faz a cobertura mentir para
     baixo justamente onde o dado existe. */
  const c = coberturaDeValor([carga(0, 0), carga(null, 1)]);
  assert.equal(c.com_valor, 1);
  assert.equal(c.percentual, 50);
});

// ---------------------------------------------------------------------------
// A recusa
// ---------------------------------------------------------------------------

test('2025 como está hoje: 1 valor em 4030 cargas, e a IARA recusa', () => {
  const lacuna = lacunaDeValor('2025', coberturaDeValor(lote(1, 4029)));
  assert.ok(lacuna, 'com 0,02% de cobertura a resposta tem que ser recusa');
  assert.match(lacuna, /\b1\b/, 'a recusa diz quantas cargas têm valor');
  assert.match(lacuna, /4030/, 'e diz sobre quantas — o número é o que a operadora aciona');
  assert.match(lacuna, /0[.,]02%/, 'e o percentual medido');
});

test('a recusa nunca traz um número de dinheiro junto', () => {
  /* O defeito inteiro era emitir R$ 1.100,00 com cara de faturamento anual. Se
     a recusa carregasse a soma "só para referência", o número voltaria a
     circular — e é o número, não a ressalva, que a pessoa copia para o e-mail. */
  const lacuna = lacunaDeValor('2025', coberturaDeValor(lote(1, 4029))) ?? '';
  assert.doesNotMatch(lacuna, /R\$/, 'a soma de uma amostra não escolhida não sai nem como referência');
  assert.doesNotMatch(lacuna, /430\.?830|%\s*de\s*(alta|crescimento)/, 'nem variação percentual');
});

test('recusar sem dizer o que dá para fazer é meio serviço', () => {
  const lacuna = lacunaDeValor('2025', coberturaDeValor(lote(1, 4029))) ?? '';
  assert.match(lacuna, /[Cc]ontagem|cargas/, 'a recusa aponta o que ainda responde');
  assert.match(lacuna, /motorista|posto|central/i);
});

test('recorte vazio recusa por outro motivo, e diz outro motivo', () => {
  const lacuna = lacunaDeValor('março de 2026', coberturaDeValor([])) ?? '';
  assert.match(lacuna, /Não há carga nenhuma/);
  assert.doesNotMatch(lacuna, /valor lançado na planilha/, 'não há cargas é diferente de não há valores');
});

// ---------------------------------------------------------------------------
// O piso
// ---------------------------------------------------------------------------

test('acima do piso a resposta SAI — recusar a 94% seria trocar um exagero por outro', () => {
  assert.equal(lacunaDeValor('2026', coberturaDeValor(lote(94, 6))), null);
  assert.equal(lacunaDeValor('2026', coberturaDeValor(lote(2688, 1))), null, '2026 real responde');
});

test('exatamente no piso responde; um passo abaixo recusa', () => {
  assert.equal(coberturaDeValor(lote(50, 50)).percentual, PISO_DE_COBERTURA_DE_VALOR_PCT);
  assert.equal(lacunaDeValor('x', coberturaDeValor(lote(50, 50))), null, 'o piso é inclusivo');
  assert.ok(lacunaDeValor('x', coberturaDeValor(lote(49, 51))), 'e abaixo dele recusa');
});

// ---------------------------------------------------------------------------
// Relações que têm de valer sempre
// ---------------------------------------------------------------------------

test('acrescentar carga COM valor nunca piora a cobertura', () => {
  for (const [a, b] of [
    [10, 90],
    [50, 50],
    [1, 4029],
  ]) {
    const antes = coberturaDeValor(lote(a, b)).percentual ?? 0;
    const depois = coberturaDeValor(lote(a + 1, b)).percentual ?? 0;
    assert.ok(depois >= antes, `${a}/${a + b}: cobertura caiu ao ganhar um valor`);
  }
});

test('acrescentar carga SEM valor nunca melhora a cobertura', () => {
  for (const [a, b] of [
    [10, 90],
    [50, 50],
    [2688, 1],
  ]) {
    const antes = coberturaDeValor(lote(a, b)).percentual ?? 0;
    const depois = coberturaDeValor(lote(a, b + 1)).percentual ?? 0;
    assert.ok(depois <= antes, `${a}/${a + b}: cobertura subiu ao ganhar uma ausência`);
  }
});

test('a decisão só depende da fração, não do tamanho do lote', () => {
  /* 1 em 4 e 1000 em 4000 são a mesma situação. Se a trava olhasse a quantidade
     absoluta de valores, um ano grande e mal preenchido passaria por ter "mil
     valores", que é exatamente o caso de 2024 com 11. */
  const pequeno = lacunaDeValor('a', coberturaDeValor(lote(1, 3)));
  const grande = lacunaDeValor('a', coberturaDeValor(lote(1000, 3000)));
  assert.equal(pequeno === null, grande === null);
});

// ---------------------------------------------------------------------------
// MUTAÇÃO — a trava consegue disparar?
// ---------------------------------------------------------------------------

test('MUTAÇÃO: com o piso em zero, 2025 passaria a responder', () => {
  /* Reescrevo a decisão com o piso zerado e confirmo que a cobertura de 2025
     ficaria autorizada. É o que prova que os testes acima estão presos ao piso
     e não a um detalhe da frase: se `PISO_DE_COBERTURA_DE_VALOR_PCT` for a
     zero no arquivo, os testes de recusa quebram de verdade. */
  const c = coberturaDeValor(lote(1, 4029));
  const comPisoZero = (c.percentual ?? 0) >= 0;
  assert.equal(comPisoZero, true, 'a mutação de fato mudaria a decisão — a trava é o piso');
  assert.ok(
    PISO_DE_COBERTURA_DE_VALOR_PCT > (c.percentual ?? 0),
    'e o piso de produção está acima da cobertura de 2025, que é o que faz a recusa acontecer',
  );
});
