/**
 * A MESMA PESSOA EM VEÍCULOS DIFERENTES.
 *
 * O DEFEITO (operadora, 19/08/2026): *"não analiso que em 2026 tivemos 76
 * motoristas diferentes; LINO está numa linha e LINEALDO em outra, são a mesma
 * pessoa"*. Ela estava certa, e a medição na aba real explicou por quê: a coluna
 * MOTORISTA carrega **nome + veículo + tag de pedágio**.
 *
 *   CARLOS ANEVTON                            24 cargas
 *   CARLOS ANEVTON - GRO4761                   1
 *   CARLOS ANEVTON - GRO4761 (SEM PARAR)       4
 *   CARLOS ANEVTON - QHI4C04 ( CONECT CAR )    1
 *   CARLOS ANEVTON - QHI4C04 (CONECTCAR)      14
 *
 * MEDIDO na aba 2026: **73 grafias distintas, 53 pessoas**. O erro não estava só
 * na contagem — o RANKING também mentia: `LUCAS` aparecia com 138 cargas porque
 * `LUCAS - PYN` (39) contava à parte, e ele era 6º quando é 4º com 177.
 *
 * O QUE ESTE ARQUIVO PROTEGE, e é a metade mais importante: `LUIZ ANTONIO` (5
 * cargas) e `LUIZ PAULO` (88) têm o mesmo primeiro nome e são pessoas
 * DIFERENTES. Nenhuma regra por prefixo ou semelhança pode fundi-las — sumir
 * com uma pessoa real é pior que contá-la duas vezes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { identidadeDeMotorista } from '../servidor/nucleo/ClientePlanilhaOcis';

/** As cinco grafias reais de uma pessoa só, copiadas da planilha. */
test('as cinco grafias de CARLOS ANEVTON viram uma pessoa', () => {
  const grafias = [
    'CARLOS ANEVTON',
    'CARLOS ANEVTON - GRO4761',
    'CARLOS ANEVTON - GRO4761 (SEM PARAR)',
    'CARLOS ANEVTON - QHI4C04 ( CONECT CAR )',
    'CARLOS ANEVTON - QHI4C04 (CONECTCAR)',
  ];
  const identidades = new Set(grafias.map(identidadeDeMotorista));
  assert.equal(identidades.size, 1, `viraram ${[...identidades].join(' | ')}`);
  assert.equal([...identidades][0], 'CARLOS ANEVTON');
});

test('placa, prefixo de placa e tag de pedágio saem do nome', () => {
  assert.equal(identidadeDeMotorista('MOLINA - IMN7071'), 'MOLINA');
  assert.equal(identidadeDeMotorista('LUCAS - PYN'), 'LUCAS');
  assert.equal(identidadeDeMotorista('SERGIO - SEM PARAR'), 'SERGIO');
  assert.equal(identidadeDeMotorista('WILIS - SEM PARAR'), 'WILIS');
  assert.equal(identidadeDeMotorista('LUAN - VELOE'), 'LUAN');
  assert.equal(identidadeDeMotorista('RAFAEL GABRIEL - BWO'), 'RAFAEL GABRIEL');
});

/** Sufixo que é nome de terceiro (agregado/proprietário) some pela mesma regra. */
test('o nome do agregado depois do hífen não cria motorista novo', () => {
  assert.equal(identidadeDeMotorista('CLEITON - LAUDIR'), 'CLEITON');
  assert.equal(identidadeDeMotorista('LUCIANO - DIMAS'), 'LUCIANO');
  assert.equal(identidadeDeMotorista('JOSE GERALDO - DELMIRO'), 'JOSE GERALDO');
});

/** Sem marca estrutural, só o mapa declarado une — confirmado pela operadora. */
test('as variações sem hífen vêm do mapa declarado, nunca de semelhança', () => {
  assert.equal(identidadeDeMotorista('CLAUDINEI DE SOUZA'), 'CLAUDINEI');
  assert.equal(identidadeDeMotorista('LOURENCO SAMPAIO'), 'LOURENCO');
  assert.equal(identidadeDeMotorista('JAIRO GMK'), 'JAIRO');
  assert.equal(identidadeDeMotorista('CLEITON LAUDIR'), 'CLEITON');
});

/**
 * O CASO QUE IMPEDE A REGRA DE VIRAR O DEFEITO QUE ELA CONSERTA.
 */
test('pessoas diferentes com o mesmo primeiro nome continuam diferentes', () => {
  assert.notEqual(identidadeDeMotorista('LUIZ ANTONIO'), identidadeDeMotorista('LUIZ PAULO'));
  assert.notEqual(identidadeDeMotorista('CARLOS ANEVTON'), identidadeDeMotorista('CARLOS LAUDIR'));
  assert.notEqual(identidadeDeMotorista('CARLOS HENRIQUE'), identidadeDeMotorista('CARLOS LAUDIR'));
  assert.notEqual(identidadeDeMotorista('JOSE DARI'), identidadeDeMotorista('JOSE GERALDO'));
});

/** Nome composto com hífen SEM espaços não é anotação de veículo. */
test('hífen sem espaços faz parte do nome', () => {
  assert.equal(identidadeDeMotorista('JEAN-PAULO'), 'JEAN-PAULO');
});

test('acento e espaço extra não criam pessoa nova', () => {
  assert.equal(identidadeDeMotorista('  lourenço  '), 'LOURENCO');
  assert.equal(identidadeDeMotorista('Sérgio - Sem Parar'), 'SERGIO');
});
