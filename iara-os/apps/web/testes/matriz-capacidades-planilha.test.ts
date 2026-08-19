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
import {
  CARGAS_2026,
  CARGAS_2026_COM_DUPLICATA,
  CARGAS_AUSENCIA,
  CARGAS_DUPLICADAS,
  CARGAS_MEDIA,
  ESPERADO,
} from './planilha/oraculo';
import {
  agregarCargas,
  contarCargas,
  contarDistintos,
  dimensaoAusente,
  valorMedio,
} from '../servidor/nucleo/ClientePlanilhaOcis';

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
  /* Ciclo A: a média passou a dividir pelo que TEM valor. */
  'AVG-001': 'SUPPORTED_CORRECT',
  'AVG-002': 'SUPPORTED_CORRECT',
  'MAX-001': 'UNSUPPORTED',
  'MIN-001': 'UNSUPPORTED',
  'GROUP-001': 'SUPPORTED_CORRECT',
  'GROUP-002': 'SUPPORTED_CORRECT',
  'GROUP-003': 'UNSUPPORTED',
  'GROUP-004': 'UNSUPPORTED',
  /* Ciclo A: os dois WRONG_RESULT da Fase 1, agora com semântica própria. */
  'DIST-001': 'SUPPORTED_CORRECT',
  'DIST-001b': 'SUPPORTED_CORRECT',
  'DIST-001c': 'SUPPORTED_CORRECT',
  'DIST-002': 'SUPPORTED_CORRECT',
  'DIST-002b': 'SUPPORTED_CORRECT',
  'DIST-002c': 'SUPPORTED_CORRECT',
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
  'QUAL-003': 'SUPPORTED_CORRECT',
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
 * DIST-001 FECHADO — contar cargas não é contar linhas.
 *
 * A identidade de uma carga é a OCI, PROVADA nos dados: 2681 OCIs distintas em
 * 2681 linhas na aba real. Não foi escolhida pelo nome do campo.
 *
 * O grupo continua contando linhas de propósito — uma listagem por motorista
 * mostra linhas. Quem responde "quantas cargas" é `contarCargas`, e a diferença
 * entre os dois números sai declarada em vez de sumir.
 */
test('DIST-001 · cargas únicas ≠ linhas, e a diferença é declarada', () => {
  const r = contarCargas(CARGAS_2026_COM_DUPLICATA);
  assert.equal(r.linhas, ESPERADO.linhas_2026_com_duplicata, 'treze linhas');
  assert.equal(r.unicas, ESPERADO.ocis_unicas_2026_com_duplicata, 'doze cargas');
  assert.equal(r.repetidas, 1, 'e uma repetição, dita e não escondida');

  /* O conjunto adversarial do enunciado: A, A, B, C, C. */
  const adv = contarCargas(CARGAS_DUPLICADAS);
  assert.equal(adv.linhas, ESPERADO.linhas_adversarial);
  assert.equal(adv.unicas, ESPERADO.cargas_unicas_adversarial, 'três cargas, não cinco');
  assert.equal(adv.repetidas, ESPERADO.linhas_repetidas_adversarial);
});

/**
 * DIST-002 FECHADO — contar grupos não é contar motoristas.
 *
 * Era VIVO: na planilha real são 73 motoristas e 74 grupos, porque 130 cargas
 * estão sem motorista e formam grupo próprio. "Quantos motoristas temos?"
 * responderia 74 — plausível o bastante para ninguém conferir.
 *
 * O conserto NÃO é `grupos.length - 1`. Aquilo quebraria quando não houvesse
 * ausência nenhuma, e não saberia dizer quantas cargas ficaram órfãs. A
 * distinção é feita sobre o dado, e a ausência sai declarada.
 */
test('DIST-002 · motoristas distintos ignoram a ausência, e a ausência é dita', () => {
  const r = contarDistintos(CARGAS_2026, 'motorista');
  assert.equal(r.distintos, ESPERADO.motoristas_distintos_2026, 'três motoristas de verdade');
  assert.equal(r.ausentes, ESPERADO.cargas_sem_motorista_2026, 'e uma carga órfã, declarada');

  /* O agrupamento CONTINUA mostrando o grupo do ausente — sumir com ele seria o
     defeito simétrico, e a listagem em produção depende disso. */
  const gs = agregarCargas(CARGAS_2026, 'motorista');
  assert.equal(gs.length, 4, 'a listagem segue com quatro grupos');
  assert.ok(gs.some((g) => /sem motorista/i.test(g.chave)));
});

/**
 * A DEFINIÇÃO DE AUSÊNCIA, TRAVADA CONTRA HEURÍSTICA.
 *
 * MEDIDO na fonte real (aba 2026, 2681 linhas): a única forma de ausência é a
 * célula vazia — 129 casos. Não há "N/A", não há "-", não há "SEM MOTORISTA".
 * Ensinar o sistema a tratar esses textos como ausência inventaria uma regra que
 * a fonte não pede, e o preço seria transformar um nome legítimo em vazio.
 *
 * Se a fonte passar a usar sentinela, a medição volta e a regra muda com
 * evidência — nunca por palpite.
 */
test('DIST-002c · só vazio é ausência; "N/A" e "-" são nomes', () => {
  const r = contarDistintos(CARGAS_AUSENCIA, 'motorista');
  assert.equal(r.distintos, ESPERADO.motoristas_distintos_ausencia, '"N/A", "-" e "LINO" são três');
  assert.equal(r.ausentes, ESPERADO.ausencias_no_conjunto_ausencia, 'vazio e espaços são as duas');

  assert.equal(dimensaoAusente(''), true);
  assert.equal(dimensaoAusente('   '), true);
  assert.equal(dimensaoAusente(null), true);
  assert.equal(dimensaoAusente('N/A'), false, '"N/A" é um nome até a fonte dizer o contrário');
  assert.equal(dimensaoAusente('-'), false);
});

/**
 * A MÉDIA DIVIDE PELO QUE EXISTE — a decisão documentada, com o caso do
 * enunciado: 100, 200 e ausente dão 150, nunca 100.
 */
test('AVG · o denominador é a quantidade de valores válidos', () => {
  const [g] = agregarCargas(CARGAS_MEDIA, 'nenhum');
  assert.equal(g.contagem, 3, 'três cargas');
  assert.equal(g.com_valor, 2, 'duas com valor');
  assert.equal(g.valor_total, 300);
  assert.equal(valorMedio(g), ESPERADO.media_sobre_valores_validos, '300/2 = 150');

  /* Sem nenhum valor: ausência, nunca zero. Zero afirmaria que não valem nada. */
  const [vazio] = agregarCargas(
    CARGAS_MEDIA.map((x) => ({ ...x, valor: null })),
    'nenhum',
  );
  assert.equal(valorMedio(vazio), null);
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
