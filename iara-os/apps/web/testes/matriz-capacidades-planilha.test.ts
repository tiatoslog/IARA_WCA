/**
 * A MATRIZ DE CAPACIDADES, TRAVADA — o mapa não pode envelhecer em silêncio.
 *
 * `testes/planilha/matriz.ts` MEDE; este arquivo CONGELA o que foi medido. Sem
 * ele, o documento gerado vira retrato de um dia — alguém conserta uma lacuna,
 * ninguém regenera, e a matriz passa a mentir na direção otimista, que é a
 * pior.
 *
 * O teste falha nos DOIS sentidos, de propósito:
 *
 *   · uma capacidade que REGREDIU (estava correta, passou a errar) — o motivo
 *     óbvio de existir um teste;
 *   · uma capacidade que MELHOROU (era UNSUPPORTED, passou a responder) — e
 *     este é o ponto sutil: melhoria não anunciada deixa a matriz desatualizada,
 *     e a próxima decisão de prioridade sai de um mapa velho.
 *
 * Quando falhar por melhoria, o conserto é regenerar o documento:
 *   node --import tsx scripts/matriz-planilha.ts
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CASOS, rodarMatriz, type EstadoCapacidade } from './planilha/matriz';
import { CARGAS_2026, CARGAS_2026_COM_DUPLICATA, ESPERADO } from './planilha/oraculo';
import { agregarCargas } from '../servidor/nucleo/ClientePlanilhaOcis';

/**
 * O ESTADO DE CADA CAPACIDADE, medido em 18/08/2026. Escrito à mão a partir da
 * execução — não gerado do próprio código, senão o teste concordaria consigo
 * mesmo para sempre.
 */
const ESTADO_MEDIDO: Readonly<Record<string, EstadoCapacidade>> = {
  'COUNT-001': 'SUPPORTED_CORRECT',
  'COUNT-002': 'SUPPORTED_CORRECT',
  'COUNT-003': 'SUPPORTED_CORRECT',
  'COUNT-004': 'UNSUPPORTED',
  'COUNT-005': 'UNSUPPORTED',
  'COUNT-006': 'UNSUPPORTED',
  'SUM-001': 'SUPPORTED_CORRECT',
  'SUM-002': 'SUPPORTED_CORRECT',
  'AVG-001': 'SUPPORTED_PARTIAL',
  'MAX-001': 'UNSUPPORTED',
  'MIN-001': 'UNSUPPORTED',
  'GROUP-001': 'SUPPORTED_CORRECT',
  'GROUP-002': 'SUPPORTED_CORRECT',
  'GROUP-003': 'UNSUPPORTED',
  'GROUP-004': 'UNSUPPORTED',
  'DIST-001': 'WRONG_RESULT',
  'DIST-002': 'WRONG_RESULT',
  'DATE-001': 'SUPPORTED_CORRECT',
  'DATE-002': 'SUPPORTED_CORRECT',
  'DATE-003': 'UNSUPPORTED',
  'DATE-004': 'UNSUPPORTED',
  'DATE-005': 'UNSUPPORTED',
  'DATE-006': 'SUPPORTED_PARTIAL',
  'DATE-007': 'UNSUPPORTED',
  'CMP-001': 'UNSUPPORTED',
  'CMP-002': 'UNSUPPORTED',
  'PCT-001': 'SUPPORTED_PARTIAL',
  'QUAL-001': 'SUPPORTED_CORRECT',
  'QUAL-002': 'UNSUPPORTED',
  'QUAL-003': 'UNSUPPORTED',
};

test('a matriz cobre todos os casos declarados, sem sobra nem falta', () => {
  const idsCasos = CASOS.map((c) => c.id).sort();
  const idsMedidos = Object.keys(ESTADO_MEDIDO).sort();
  assert.deepEqual(
    idsCasos,
    idsMedidos,
    'caso novo sem estado registrado (ou o contrário) — regenere a matriz e atualize este mapa',
  );
});

test('nenhuma capacidade mudou de estado sem a matriz ser regenerada', () => {
  const divergencias = rodarMatriz()
    .filter((r) => r.estado !== ESTADO_MEDIDO[r.id])
    .map((r) => `${r.id} (${r.pergunta}): medido ${ESTADO_MEDIDO[r.id]} → agora ${r.estado}`);

  assert.deepEqual(
    divergencias,
    [],
    'o mapa e o território divergiram. Se foi conserto, comemore e rode ' +
      '`node --import tsx scripts/matriz-planilha.ts` para regenerar o documento.',
  );
});

// ---------------------------------------------------------------------------
// Os dois defeitos que a matriz encontrou — vigiados por caso próprio
// ---------------------------------------------------------------------------

/**
 * LINHA REPETIDA VIRA CARGA A MAIS.
 *
 * Na planilha real de 18/08/2026 não há OCI repetida em 2681 linhas — medido,
 * não suposto. Então isto é risco LATENTE, e é assim que fica registrado: o dia
 * em que alguém colar uma linha duas vezes, a contagem sobe e nada avisa.
 */
test('DEFEITO · o motor conta linhas, não cargas únicas', () => {
  const comDup = agregarCargas(CARGAS_2026_COM_DUPLICATA, 'nenhum')[0].contagem;
  assert.equal(comDup, ESPERADO.linhas_2026_com_duplicata, 'o conjunto tem 13 linhas');

  const ocisUnicas = new Set(CARGAS_2026_COM_DUPLICATA.map((c) => c.oci)).size;
  assert.equal(ocisUnicas, ESPERADO.ocis_unicas_2026_com_duplicata, 'e 12 OCIs');

  assert.notEqual(
    comDup,
    ocisUnicas,
    'se passaram a bater, COUNT DISTINCT foi implementado — atualize a matriz',
  );
});

/**
 * O GRUPO DO MOTORISTA AUSENTE CONTA COMO MOTORISTA.
 *
 * Este é VIVO, não latente: na planilha real são 73 motoristas e 74 grupos,
 * porque 130 cargas estão sem motorista e formam um grupo próprio. "Quantos
 * motoristas temos?" responderia 74 — e 74 é plausível o bastante para ninguém
 * conferir.
 */
test('DEFEITO · contar grupos não é contar motoristas', () => {
  const gruposMotorista = agregarCargas(CARGAS_2026, 'motorista');
  const motoristasReais = new Set(
    CARGAS_2026.map((c) => c.motorista).filter((m) => m.trim() !== ''),
  ).size;

  assert.equal(motoristasReais, ESPERADO.motoristas_distintos_2026, 'são três motoristas de verdade');
  assert.equal(gruposMotorista.length, 4, 'e quatro grupos, porque o ausente forma o seu');
  assert.notEqual(
    gruposMotorista.length,
    motoristasReais,
    'se passaram a bater, o grupo do ausente saiu da contagem — atualize a matriz',
  );
});

/**
 * O ORÁCULO CONFERE CONSIGO MESMO. Se a soma dos grupos não fecha com o total,
 * o erro está no oráculo — e um oráculo errado contamina toda a matriz em
 * silêncio, que é o pior defeito possível num arquivo como este.
 */
test('o oráculo é internamente consistente', () => {
  const total = agregarCargas(CARGAS_2026, 'nenhum')[0].contagem;
  assert.equal(total, ESPERADO.linhas_2026);

  for (const dim of ['motorista', 'rota', 'origem', 'destino', 'status_normalizado'] as const) {
    const soma = agregarCargas(CARGAS_2026, dim).reduce((s, g) => s + g.contagem, 0);
    assert.equal(soma, total, `os grupos de ${dim} somam ${soma} e as cargas são ${total}`);
  }

  const somaStatus =
    ESPERADO.finalizado_2026 + ESPERADO.pago_2026 + ESPERADO.sem_status_2026 + ESPERADO.desconhecido_2026;
  assert.equal(somaStatus, ESPERADO.linhas_2026, 'as constantes de status não fecham com o total');
});
