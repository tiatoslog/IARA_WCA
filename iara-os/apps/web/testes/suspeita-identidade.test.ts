/**
 * O DETECTOR ACUSA, NUNCA FUNDE.
 *
 * A REGRA (operadora, 19/08/2026): a IARA precisa identificar sozinha as
 * grafias que são a mesma pessoa, inclusive as que aparecerem depois — o mapa
 * escrito à mão envelhece.
 *
 * DUAS METADES. O que tem marca ESTRUTURAL (sufixo depois de " - ",
 * parênteses) já é unido por `identidadeDeMotorista`, sozinho, para qualquer
 * nome futuro. O que NÃO tem marca vira SUSPEITA: a IARA pergunta, a operadora
 * confirma, e a confirmação entra no mapa declarado. O mapa cresce por
 * confirmação, nunca por palpite.
 *
 * O CASO QUE GOVERNA O ARQUIVO INTEIRO: `LUIZ ANTONIO` (5 cargas) e `LUIZ
 * PAULO` (88) têm o mesmo primeiro nome e são pessoas DIFERENTES. Sumir com uma
 * pessoa real é pior que contá-la duas vezes. Por isso o critério é prefixo de
 * PALAVRAS INTEIRAS, e não primeiro nome nem semelhança.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizarStatus,
  suspeitasDeIdentidade,
  type CargaCompleta,
} from '../servidor/nucleo/ClientePlanilhaOcis';

const carga = (oci: string, motorista: string): CargaCompleta => ({
  ano: '2026',
  oci,
  origem: 'SP',
  uf_origem: 'SP',
  destino: 'MT',
  uf_destino: 'MT',
  motorista,
  data_rec_oci: '2026-01-05',
  data_coleta: '2026-01-05',
  data_descarga: '2026-01-05',
  status: 'FINALIZADO',
  status_normalizado: normalizarStatus('FINALIZADO'),
  valor: 100,
});

const de = (nomes: readonly string[]): CargaCompleta[] =>
  nomes.map((n, i) => carga(`OCI-${i}`, n));

/**
 * O CASO FUTURO — a razão de o detector existir.
 *
 * Um sobrenome que aparece amanhã, em alguém que ninguém declarou. É o que o
 * mapa escrito à mão nunca vai cobrir sozinho, e é exatamente o que a operadora
 * pediu que a IARA passasse a enxergar.
 */
test('acusa a variação NOVA, sem marca estrutural e fora do mapa', () => {
  const s = suspeitasDeIdentidade(de(['MARCELO', 'MARCELO FERREIRA', 'MOLINA']));
  assert.equal(s.length, 1);
  assert.equal(s[0].provavel, 'MARCELO');
  assert.deepEqual(s[0].variantes, ['MARCELO FERREIRA']);
  assert.equal(s[0].cargas, 2);
});

/**
 * O CASO QUE IMPEDE O DETECTOR DE VIRAR O DEFEITO. Mesmo primeiro nome não é
 * suspeita: nenhum dos dois é o começo COMPLETO do outro.
 */
test('pessoas diferentes com o mesmo primeiro nome NÃO viram suspeita', () => {
  assert.deepEqual(suspeitasDeIdentidade(de(['LUIZ ANTONIO', 'LUIZ PAULO'])), []);
  assert.deepEqual(suspeitasDeIdentidade(de(['CARLOS ANEVTON', 'CARLOS LAUDIR'])), []);
  assert.deepEqual(suspeitasDeIdentidade(de(['JOSE DARI', 'JOSE GERALDO'])), []);
});

/** O que a regra estrutural já resolve não vira pergunta — seria ruído. */
test('variação com marca estrutural já foi unida e não é acusada', () => {
  const s = suspeitasDeIdentidade(
    de(['MOLINA', 'MOLINA - IMN7071', 'CARLOS ANEVTON', 'CARLOS ANEVTON - QHI4C04 (CONECTCAR)']),
  );
  assert.deepEqual(s, [], 'o sufixo de veículo some antes de a suspeita ser avaliada');
});

/** Já declarado no mapa também não vira pergunta: o caso está resolvido. */
test('o que já está no mapa declarado não é perguntado de novo', () => {
  assert.deepEqual(suspeitasDeIdentidade(de(['JAIRO', 'JAIRO GMK'])), []);
  assert.deepEqual(suspeitasDeIdentidade(de(['LOURENCO', 'LOURENCO SAMPAIO'])), []);
});

test('três grafias da mesma raiz saem num grupo só', () => {
  const s = suspeitasDeIdentidade(de(['ANA', 'ANA MARIA', 'ANA MARIA SILVA']));
  assert.equal(s.length, 1);
  assert.equal(s[0].provavel, 'ANA');
  assert.equal(s[0].variantes.length, 2);
  assert.equal(s[0].cargas, 3);
});

/** Ordenado por impacto: a suspeita que move mais cargas vem antes. */
test('a suspeita de maior impacto vem primeiro', () => {
  const cargas = [
    ...de(['PEDRO', 'PEDRO ALVES']),
    ...Array.from({ length: 20 }, (_, i) => carga(`X-${i}`, 'BRUNO')),
    ...Array.from({ length: 10 }, (_, i) => carga(`Y-${i}`, 'BRUNO COSTA')),
  ];
  const s = suspeitasDeIdentidade(cargas);
  assert.equal(s[0].provavel, 'BRUNO');
  assert.equal(s[0].cargas, 30);
  assert.equal(s[1].provavel, 'PEDRO');
});

test('sem suspeita nenhuma, devolve lista vazia — nada de pergunta inventada', () => {
  assert.deepEqual(suspeitasDeIdentidade(de(['LINO', 'LAUDIR', 'MOLINA'])), []);
  assert.deepEqual(suspeitasDeIdentidade([]), []);
});

test('carga sem motorista não entra na análise', () => {
  const s = suspeitasDeIdentidade(de(['', '   ', 'LINO']));
  assert.deepEqual(s, []);
});
