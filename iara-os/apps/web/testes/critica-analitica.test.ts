/**
 * A CAMADA DE CRÍTICA — cobertura, contestação, suficiência.
 *
 * CONJUNTO DE DESENVOLVIMENTO. Estes casos foram escritos junto com a
 * implementação e por isso NÃO PODEM aprová-la sozinhos — quem define o
 * comportamento não é testemunha isenta dele. A aprovação depende do holdout
 * (`testes/holdout/`), escrito contra a especificação e nunca contra o código.
 *
 * O que estes testes protegem é a diferença entre duas frases que saem da mesma
 * expressão: "nenhuma carga atrasou" e "não consegui apurar atraso nenhum". A
 * primeira é uma afirmação sobre o mundo; a segunda é ausência de dado. Um
 * sistema que não distingue as duas erra com segurança, que é o jeito caro de
 * errar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMIAR_COBERTURA,
  classificarCobertura,
  deCoberturaDeJoin,
  frasearCobertura,
  medirCobertura,
  mesmoRecorte,
  saoComparaveis,
  sustentaAfirmacaoPopulacional,
  zeroEhAusencia,
} from '../servidor/nucleo/kernel/Cobertura';
import {
  CONVENCOES_DE_CRITICA,
  alcanca,
  criticar,
  menorDegrau,
  ordenarRessalvas,
  type TipoDeConclusao,
} from '../servidor/nucleo/kernel/MotorCritica';
import {
  LIMIAR_CONFIANCA,
  avaliarConfianca,
  decidirSuficiencia,
  explicarConfianca,
} from '../servidor/nucleo/kernel/Suficiencia';
import type { Evidencia } from '../servidor/nucleo/kernel/Investigacao';

const AGORA = '2026-08-19T18:00:00.000Z';
const RECENTE = '2026-08-19T17:30:00.000Z';
const ONTEM = '2026-08-18T10:00:00.000Z';
const MES_PASSADO = '2026-07-10T10:00:00.000Z';

/** Fábrica de evidência: só o que o caso precisa dizer aparece no caso. */
function ev(p: Partial<Evidencia> & { metrica: string }): Evidencia {
  return {
    fonte: 'planilha_luft',
    valor: 10,
    unidade: '',
    procedencia: 'fato',
    relevancia: 'direta',
    instante: RECENTE,
    ...p,
  };
}

const criticarCom = (evidencias: readonly Evidencia[], tipo: TipoDeConclusao = 'populacional') =>
  criticar({ evidencias, tipo_pretendido: tipo, agora: AGORA });

// ===========================================================================
// A. Cobertura — a aritmética do denominador
// ===========================================================================

test('A1. cobertura calcula o derivado e não aceita percentual de fora', () => {
  const c = medirCobertura({ elegiveis: 200, consideradas: 150, motivo_ausencia: 'sem preço' });
  assert.equal(c.ausentes, 50);
  assert.equal(c.percentual, 75);
  assert.equal(classificarCobertura(c), 'parcial');
});

test('A2. 0 de 0 é null, nunca 0% — a lição de MargemOperacional', () => {
  const c = medirCobertura({ elegiveis: 0, consideradas: 0 });
  assert.equal(c.percentual, null);
  assert.equal(classificarCobertura(c), 'vazia');
  assert.equal(sustentaAfirmacaoPopulacional(c), false);
});

test('A3. considerar mais que o elegível fica no teto em vez de estourar', () => {
  const c = medirCobertura({ elegiveis: 3, consideradas: 999 });
  assert.equal(c.consideradas, 3);
  assert.equal(c.ausentes, 0);
  assert.equal(c.percentual, 100);
});

test('A4. só cobertura completa sustenta afirmação sobre a população', () => {
  const completa = medirCobertura({ elegiveis: 40, consideradas: 40 });
  const quase = medirCobertura({ elegiveis: 40, consideradas: 39 });
  assert.equal(sustentaAfirmacaoPopulacional(completa), true);
  /* 97,5% é `alta` e ainda assim NÃO sustenta: "os motoristas da semana" com um
     motorista de fora é uma frase falsa, e a ressalva custa uma linha. */
  assert.equal(classificarCobertura(quase), 'alta');
  assert.equal(sustentaAfirmacaoPopulacional(quase), false);
});

test('A5. ausência não é zero', () => {
  const vazia = medirCobertura({ elegiveis: 12, consideradas: 0 });
  assert.equal(zeroEhAusencia(0, vazia), true);
  const cheia = medirCobertura({ elegiveis: 12, consideradas: 12 });
  /* Zero apurado sobre 12 registros lidos É zero — e precisa continuar sendo,
     ou a trava viraria uma recusa de responder "não houve atraso". */
  assert.equal(zeroEhAusencia(0, cheia), false);
});

test('A6. comparável exige mesmas dimensões de recorte E mesma classe', () => {
  const a = medirCobertura({ elegiveis: 100, consideradas: 100, recorte: [{ dimensao: 'ano', valor: '2026' }] });
  const b = medirCobertura({ elegiveis: 100, consideradas: 88, recorte: [{ dimensao: 'ano', valor: '2024' }] });
  const c = medirCobertura({ elegiveis: 100, consideradas: 100, recorte: [{ dimensao: 'ano', valor: '2025' }] });
  const d = medirCobertura({ elegiveis: 50, consideradas: 50, recorte: [{ dimensao: 'mes', valor: '08' }] });
  assert.equal(saoComparaveis(a, c), true);
  assert.equal(saoComparaveis(a, b), false, '100% contra 88% é denominador móvel');
  assert.equal(saoComparaveis(a, d), false, 'ano contra mês não compara');
});

test('A7. o recorte é conjunto, não lista ordenada', () => {
  const x = [{ dimensao: 'ano', valor: '2026' }, { dimensao: 'uf', valor: 'SP' }];
  const y = [{ dimensao: 'uf', valor: 'SP' }, { dimensao: 'ano', valor: '2026' }];
  assert.equal(mesmoRecorte(x, y), true);
  assert.equal(mesmoRecorte(x, [{ dimensao: 'ano', valor: '2025' }, { dimensao: 'uf', valor: 'SP' }]), false);
});

test('A8. cobertura completa não vira ruído na resposta', () => {
  assert.equal(frasearCobertura(medirCobertura({ elegiveis: 9, consideradas: 9 })), '');
  const parcial = frasearCobertura(medirCobertura({ elegiveis: 10, consideradas: 7, motivo_ausencia: 'sem preço' }));
  assert.match(parcial, /7 de 10/);
  assert.match(parcial, /sem preço/);
  assert.match(frasearCobertura(medirCobertura({ elegiveis: 0, consideradas: 0 })), /não é um resultado zero/i);
});

test('A9. o adaptador do join da margem traduz sem que o kernel conheça carga', () => {
  const c = deCoberturaDeJoin(
    { cargas: 4064, com_preco: 3579, sem_preco: 400, sem_valor: 60, ambiguas: 25 },
    [{ dimensao: 'ano', valor: '2024' }],
  );
  assert.equal(c.elegiveis, 4064);
  assert.equal(c.consideradas, 3579);
  assert.ok((c.percentual ?? 0) > 88 && (c.percentual ?? 0) < 88.1, 'a cobertura medida de 2024');
  assert.match(c.motivo_ausencia, /sem preço de trecho/);
  assert.match(c.motivo_ausencia, /ambíguo/);
});

test('A10. os limiares são convenção declarada, não número solto', () => {
  assert.equal(LIMIAR_COBERTURA.completa, 100);
  assert.equal(LIMIAR_COBERTURA.alta, 95);
  assert.equal(LIMIAR_COBERTURA.parcial, 70);
});

// ===========================================================================
// B. Motor de crítica — as dez contestações
// ===========================================================================

test('B0. sem evidência nenhuma o degrau é `nenhum` — a abstenção', () => {
  const r = criticarCom([]);
  assert.equal(r.degrau, 'nenhum');
  assert.equal(r.rebaixou, true);
});

test('B1. zero sobre conjunto vazio é impeditivo e derruba tudo', () => {
  const r = criticarCom([
    ev({ metrica: 'cargas_atrasadas', valor: 0, cobertura: medirCobertura({ elegiveis: 30, consideradas: 0 }) }),
  ]);
  const achada = r.ressalvas.find((x) => x.codigo === 'ausencia_como_zero');
  assert.ok(achada, 'R1 tem de disparar');
  assert.equal(achada?.gravidade, 'impeditiva');
  assert.equal(r.degrau, 'nenhum');
});

test('B2. cobertura parcial rebaixa para descritiva — não cala a resposta', () => {
  const r = criticarCom([
    ev({ metrica: 'margem', valor: 18, cobertura: medirCobertura({ elegiveis: 100, consideradas: 71 }) }),
  ]);
  assert.ok(r.ressalvas.some((x) => x.codigo === 'cobertura_parcial'));
  assert.equal(r.degrau, 'descritiva', 'o número continua válido sobre o subconjunto');
  assert.equal(alcanca(r.degrau, 'populacional'), false);
  assert.equal(alcanca(r.degrau, 'descritiva'), true);
});

test('B3. silêncio sobre cobertura não é garantia de cobertura', () => {
  const r = criticarCom([ev({ metrica: 'total_cargas', valor: 2688 })]);
  assert.ok(r.ressalvas.some((x) => x.codigo === 'cobertura_nao_declarada'));
  assert.equal(r.degrau, 'descritiva');
});

test('B4. duas fontes discordando é impeditivo', () => {
  const r = criticarCom([
    ev({ metrica: 'motoristas', valor: 73, fonte: 'planilha_luft' }),
    ev({ metrica: 'motoristas', valor: 75, fonte: 'memoria_do_turno' }),
  ]);
  const briga = r.ressalvas.find((x) => x.codigo === 'contradicao_entre_fontes');
  assert.ok(briga, 'o incidente dos 75/73 tem de virar contestação');
  assert.equal(r.degrau, 'nenhum');
});

test('B4b. a MESMA fonte lida duas vezes é série temporal, não contradição', () => {
  const r = criticarCom([
    ev({ metrica: 'cargas', valor: 40, fonte: 'planilha_luft', instante: ONTEM }),
    ev({ metrica: 'cargas', valor: 52, fonte: 'planilha_luft', instante: RECENTE }),
  ]);
  assert.equal(
    r.ressalvas.some((x) => x.codigo === 'contradicao_entre_fontes'),
    false,
    'senão toda evolução no tempo viraria briga de fontes',
  );
});

test('B5. dado velho entra com ressalva; dado obsoleto rebaixa', () => {
  const velho = criticarCom([ev({ metrica: 'frota', valor: 12, instante: ONTEM })]);
  const r1 = velho.ressalvas.find((x) => x.codigo === 'dado_envelhecido');
  assert.ok(r1);
  assert.equal(r1?.gravidade, 'leve');

  const obsoleto = criticarCom([ev({ metrica: 'frota', valor: 12, instante: MES_PASSADO })]);
  const r2 = obsoleto.ressalvas.find((x) => x.codigo === 'dado_envelhecido');
  assert.equal(r2?.gravidade, 'seria');
  assert.equal(obsoleto.degrau, 'descritiva');
});

test('B6. fonte única só é ressalva quando a conclusão passa de populacional', () => {
  const evs = [
    ev({ metrica: 'a', cobertura: medirCobertura({ elegiveis: 20, consideradas: 20 }) }),
    ev({ metrica: 'b', cobertura: medirCobertura({ elegiveis: 20, consideradas: 20 }) }),
  ];
  assert.equal(criticarCom(evs, 'populacional').ressalvas.some((x) => x.codigo === 'fonte_unica'), false);
  assert.equal(criticarCom(evs, 'comparativa').ressalvas.some((x) => x.codigo === 'fonte_unica'), true);
});

test('B7. hipótese entrando como medida é ressalva séria', () => {
  const r = criticarCom([
    ev({ metrica: 'causa_provavel', procedencia: 'hipotese', cobertura: medirCobertura({ elegiveis: 9, consideradas: 9 }) }),
  ]);
  const achada = r.ressalvas.find((x) => x.codigo === 'procedencia_fraca');
  assert.equal(achada?.gravidade, 'seria');
  assert.equal(r.degrau, 'descritiva');
});

test('B8. denominador móvel derruba a comparação para populacional', () => {
  const r = criticarCom(
    [
      ev({ metrica: 'margem', valor: 18, cobertura: medirCobertura({ elegiveis: 100, consideradas: 100, recorte: [{ dimensao: 'ano', valor: '2026' }] }) }),
      ev({ metrica: 'margem', valor: 15, cobertura: medirCobertura({ elegiveis: 100, consideradas: 88, recorte: [{ dimensao: 'ano', valor: '2024' }] }) }),
    ],
    'comparativa',
  );
  assert.ok(r.ressalvas.some((x) => x.codigo === 'denominador_movel'));
  assert.equal(alcanca(r.degrau, 'comparativa'), false);
});

test('B9. causa sem experimento cai para comparativa e diz o que confirmaria', () => {
  const r = criticarCom(
    [ev({ metrica: 'pedagio', valor: 900, cobertura: medirCobertura({ elegiveis: 50, consideradas: 50 }) })],
    'causal',
  );
  const achada = r.ressalvas.find((x) => x.codigo === 'causa_sem_lastro');
  assert.ok(achada, 'nenhum arranjo de dado observado prova causa');
  assert.equal(r.degrau, 'comparativa');
  assert.match(achada!.texto, /andaram juntas/);
});

test('B9b. intervenção verificada é a exceção real, não decorativa', () => {
  const r = criticarCom(
    [
      ev({ metrica: 'intervencao:pedagio_removido', procedencia: 'fato_verificado', cobertura: medirCobertura({ elegiveis: 50, consideradas: 50 }) }),
      ev({ metrica: 'margem', valor: 21, cobertura: medirCobertura({ elegiveis: 50, consideradas: 50 }) }),
    ],
    'causal',
  );
  assert.equal(r.ressalvas.some((x) => x.codigo === 'causa_sem_lastro'), false);
});

test('B10. grupo pequeno demais não sustenta ranking nem tendência', () => {
  const r = criticarCom([
    ev({ metrica: 'top_motorista', cobertura: medirCobertura({ elegiveis: 3, consideradas: 3 }) }),
  ]);
  const achada = r.ressalvas.find((x) => x.codigo === 'amostra_pequena');
  assert.equal(achada?.gravidade, 'seria');
  assert.ok(CONVENCOES_DE_CRITICA.amostra_minima > 3);
  /* Descritiva é o degrau em que ainda dá para relatar o grupo pequeno. */
  assert.equal(criticarCom([ev({ metrica: 't', cobertura: medirCobertura({ elegiveis: 3, consideradas: 3 }) })], 'descritiva')
    .ressalvas.some((x) => x.codigo === 'amostra_pequena'), false);
});

test('B11. o teto é o PIOR limite, nunca a média deles', () => {
  assert.equal(menorDegrau('causal', 'descritiva'), 'descritiva');
  assert.equal(menorDegrau('nenhum', 'causal'), 'nenhum');

  /**
   * ⚠️ ESTA EXPECTATIVA MUDOU EM 19/08/2026, e o motivo está registrado porque
   * mudar expectativa para o teste passar é o pecado que o orquestrador proíbe.
   *
   * A asserção original era `degrau === 'nenhum'` — teto global. A auditoria
   * independente mostrou o custo: `Ressalva.teto` vale para o TURNO, e o laço
   * agrega evidência de todas as voltas, então uma sub-consulta vazia
   * abstinha um turno em que a métrica principal estava 100% apurada. A margem
   * perfeita ia para o lixo.
   *
   * O que o caso protege continua idêntico — **a evidência boa não levanta o
   * teto** —, e a asserção ficou mais precisa em vez de mais frouxa: em vez de
   * "cai para o chão", agora é "cai para `descritiva` E a ausência aparece
   * nomeada". A conclusão causal continua barrada.
   */
  const misto = criticarCom(
    [
      ev({ metrica: 'x', valor: 0, cobertura: medirCobertura({ elegiveis: 5, consideradas: 0 }) }),
      ev({ metrica: 'y', cobertura: medirCobertura({ elegiveis: 100, consideradas: 100 }) }),
    ],
    'causal',
  );
  assert.equal(misto.degrau, 'descritiva', 'uma evidência boa não LEVANTA o teto');
  const ausencia = misto.ressalvas.find((x) => x.codigo === 'ausencia_como_zero');
  assert.ok(ausencia, 'a métrica vazia tem de aparecer nomeada');
  assert.deepEqual(ausencia?.metricas, ['x'], 'e só ela, não o turno inteiro');

  /* E quando NADA foi apurado, o chão continua sendo o chão. */
  const tudoVazio = criticarCom(
    [
      ev({ metrica: 'x', valor: 0, cobertura: medirCobertura({ elegiveis: 5, consideradas: 0 }) }),
      ev({ metrica: 'y', valor: 0, cobertura: medirCobertura({ elegiveis: 8, consideradas: 0 }) }),
    ],
    'causal',
  );
  assert.equal(tudoVazio.degrau, 'nenhum');
});

test('B12. ordenar coloca a impeditiva na frente', () => {
  const r = criticarCom([
    ev({ metrica: 'a', valor: 73, fonte: 'f1' }),
    ev({ metrica: 'a', valor: 75, fonte: 'f2', instante: MES_PASSADO }),
  ]);
  const ordenadas = ordenarRessalvas(r.ressalvas);
  assert.equal(ordenadas[0].gravidade, 'impeditiva');
});

// ===========================================================================
// C. Suficiência — confiança calculada e abstenção
// ===========================================================================

test('C1. evidência boa e completa dá confiança alta', () => {
  const evidencias = [
    ev({ metrica: 'cargas', valor: 2688, fonte: 'planilha_luft', procedencia: 'fato_verificado', cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688 }) }),
    ev({ metrica: 'receita', valor: 4738185, fonte: 'tabela_trechos', procedencia: 'fato', cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688 }) }),
    ev({ metrica: 'motoristas', valor: 73, fonte: 'cadastro', procedencia: 'fato', cobertura: medirCobertura({ elegiveis: 73, consideradas: 73 }) }),
  ];
  const { ressalvas } = criticarCom(evidencias);
  const c = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  assert.equal(c.confianca, 'alta');
  assert.ok(c.pontuacao >= LIMIAR_CONFIANCA.alta);
});

test('C2. contradição TRAVA a confiança em baixa — não é compensável', () => {
  const evidencias = [
    ev({ metrica: 'motoristas', valor: 73, fonte: 'planilha', procedencia: 'fato_verificado', cobertura: medirCobertura({ elegiveis: 900, consideradas: 900 }) }),
    ev({ metrica: 'motoristas', valor: 75, fonte: 'memoria', procedencia: 'fato_verificado', cobertura: medirCobertura({ elegiveis: 900, consideradas: 900 }) }),
  ];
  const { ressalvas } = criticarCom(evidencias);
  const c = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  assert.equal(c.travada, true);
  assert.equal(c.confianca, 'baixa', 'nenhuma soma de fatores bons compra uma contradição');
});

test('C3. a confiança se explica apontando o fator dominante', () => {
  const evidencias = [ev({ metrica: 'margem', valor: 18, cobertura: medirCobertura({ elegiveis: 100, consideradas: 40 }) })];
  const { ressalvas } = criticarCom(evidencias);
  const c = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  const frase = explicarConfianca(c);
  assert.match(frase, /cobertura/, 'o fator que puxou para baixo tem de aparecer');
  assert.match(frase, /\d+\/100/);
});

test('C4. degrau `nenhum` produz abstenção com o que destravaria', () => {
  const evidencias = [ev({ metrica: 'atrasos', valor: 0, cobertura: medirCobertura({ elegiveis: 40, consideradas: 0 }) })];
  const { ressalvas, degrau } = criticarCom(evidencias);
  const confiabilidade = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  const s = decidirSuficiencia({ tipo_pretendido: 'populacional', degrau, ressalvas, confiabilidade });
  assert.equal(s.veredicto, 'abster');
  assert.match(s.texto, /não tenho evidência suficiente/i);
  assert.ok(s.o_que_falta.length > 0, 'abster sem dizer o que falta é meia resposta');
  assert.match(s.texto, /O que destravaria/);
});

test('C5. ressalva leve ainda conclui — a crítica não é uma recusa disfarçada', () => {
  const evidencias = [
    ev({ metrica: 'cargas', valor: 40, fonte: 'a', cobertura: medirCobertura({ elegiveis: 40, consideradas: 40 }) }),
    ev({ metrica: 'valor', valor: 900, fonte: 'b', instante: ONTEM, cobertura: medirCobertura({ elegiveis: 40, consideradas: 40 }) }),
  ];
  const { ressalvas, degrau } = criticarCom(evidencias);
  const confiabilidade = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  const s = decidirSuficiencia({ tipo_pretendido: 'populacional', degrau, ressalvas, confiabilidade });
  assert.equal(s.veredicto, 'concluir_com_ressalva');
  assert.equal(s.degrau, 'populacional');
});

test('C6. tudo limpo conclui sem ressalva nenhuma', () => {
  const evidencias = [
    ev({ metrica: 'cargas', valor: 2688, fonte: 'a', procedencia: 'fato_verificado', cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688 }) }),
    ev({ metrica: 'receita', valor: 100, fonte: 'b', procedencia: 'fato', cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688 }) }),
  ];
  const { ressalvas, degrau } = criticarCom(evidencias);
  const confiabilidade = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  const s = decidirSuficiencia({ tipo_pretendido: 'populacional', degrau, ressalvas, confiabilidade });
  assert.deepEqual(ressalvas, [], 'nenhuma contestação deve sobrar num conjunto assim');
  assert.equal(s.veredicto, 'concluir');
  assert.equal(s.texto, '');
});

test('C7. a abstenção é ESCOPADA: causa negada, comparação preservada', () => {
  const evidencias = [
    ev({ metrica: 'pedagio', valor: 900, fonte: 'a', cobertura: medirCobertura({ elegiveis: 50, consideradas: 50, recorte: [{ dimensao: 'ano', valor: '2026' }] }) }),
    ev({ metrica: 'margem', valor: 12, fonte: 'b', cobertura: medirCobertura({ elegiveis: 50, consideradas: 50, recorte: [{ dimensao: 'ano', valor: '2026' }] }) }),
  ];
  const { ressalvas, degrau } = criticarCom(evidencias, 'causal');
  const confiabilidade = avaliarConfianca({ evidencias, ressalvas, agora: AGORA });
  const s = decidirSuficiencia({ tipo_pretendido: 'causal', degrau, ressalvas, confiabilidade });
  assert.notEqual(s.veredicto, 'abster', 'calar inteiro seria tão ruim quanto afirmar causa');
  assert.equal(s.degrau, 'comparativa');
  assert.ok(s.o_que_falta.some((x) => /mexer na variável/.test(x)));
});
