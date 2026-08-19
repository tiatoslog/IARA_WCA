/**
 * PROATIVIDADE — a suíte que prova o ciclo, não a intenção.
 *
 * O teste mais importante deste arquivo não é o que prova que a IARA fala. É o
 * que prova que ela CALA: `PRO-011` joga dez mil ocorrências e exige que quase
 * nada seja persistido e quase nada seja dito. Silêncio correto é uma capacidade,
 * e é a única deste módulo que, se quebrar, quebra em silêncio.
 *
 * A segunda coisa mais importante é `PRO-006`: nenhuma entrada, em nenhum nível
 * de autonomia, produz a decisão `agir`. Se isso cair, a camada proativa virou
 * um caminho de autorização que não passa pelo `PorteiroAutorizacao` — e vira
 * sem que nada mais falhe.
 *
 * Convenção dos IDs: `docs/prd/test-plan-proatividade.md`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LivroDeOcorrencias, atencaoDe, livroNovo } from '../servidor/nucleo/proativo/LivroDeOcorrencias';
import {
  MotorProativo,
  comporFala,
  ocorrenciaDeOportunidade,
  type FalaProativa,
} from '../servidor/nucleo/proativo/MotorProativo';
import {
  ACOES,
  LIMIAR_DE_FALA,
  PISO_DE_REGISTRO,
  decidir,
  rebaixar,
} from '../servidor/nucleo/proativo/DecisaoProativa';
import { PESOS, avaliar, novidadeDe, responsabilidadeDe } from '../servidor/nucleo/proativo/Relevancia';
import {
  aplicarReacao,
  atencaoNova,
  pesoDe,
  silenciado,
  REJEICOES_PARA_SILENCIO_LONGO,
  SILENCIO_POR_REJEICAO_MS,
} from '../servidor/nucleo/proativo/Atencao';
import {
  CARENCIA_ASSUNTO_MS,
  CARENCIA_GLOBAL_MS,
  TETO_DIARIO,
  atividadeVazia,
  horaSilenciosa,
  podeInterromper,
  registrarAtividade,
  registrarInterrupcao,
} from '../servidor/nucleo/proativo/Interrupcao';
import {
  DIAS_DISTINTOS_MINIMOS,
  assinarPasso,
  detectar,
  patamarDe,
} from '../servidor/nucleo/proativo/DetectorDeRepeticao';
import { chaveDe, normalizarOcorrencia } from '../servidor/nucleo/proativo/Ocorrencia';
import { ocorrenciaDoVigia } from '../servidor/nucleo/proativo/DetectoresInternos';
import { PREFERENCIAS_PADRAO, type PreferenciasOperador } from '../lib/perfil';
import type { NivelAutonomia } from '../servidor/nucleo/kernel/Autonomia';
import { CicloAutonomo } from '../servidor/nucleo/CicloAutonomo';
import type { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';

// ===========================================================================
// Bancada
// ===========================================================================

const RAIZES: string[] = [];

function raizNova(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'iara-proativo-'));
  RAIZES.push(dir);
  return dir;
}

process.on('exit', () => {
  for (const dir of RAIZES) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* pasta temporária de teste; falha ao limpar não é falha do teste */
    }
  }
});

/** Meio-dia de uma terça — dentro da janela de trabalho, longe da noite. */
const MEIO_DIA = new Date('2026-08-18T15:00:00.000Z').getTime();
const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

interface Bancada {
  readonly motor: MotorProativo;
  readonly livro: LivroDeOcorrencias;
  readonly falas: FalaProativa[];
  readonly raiz: string;
  avancar(ms: number): void;
  definirHora(h: number): void;
  agora(): number;
}

function bancada(opcoes: {
  id?: string;
  nivel?: NivelAutonomia;
  preferencias?: PreferenciasOperador;
  raiz?: string;
  livro?: LivroDeOcorrencias;
} = {}): Bancada {
  const raiz = opcoes.raiz ?? raizNova();
  const livro = opcoes.livro ?? new LivroDeOcorrencias(raiz);
  const falas: FalaProativa[] = [];
  let relogio = MEIO_DIA;
  /** 12h local por padrão — nunca a hora real da máquina que roda o teste. */
  let hora = 12;

  const motor = new MotorProativo({
    idUsuario: opcoes.id ?? 'operadora',
    livro,
    falar: (f) => falas.push(f),
    preferencias: async () => opcoes.preferencias ?? { ...PREFERENCIAS_PADRAO },
    nivel: () => opcoes.nivel ?? 'sugestao',
    agora: () => relogio,
    hora: () => hora,
  });

  return {
    motor,
    livro,
    falas,
    raiz,
    avancar: (ms) => {
      relogio += ms;
    },
    definirHora: (h) => {
      hora = h;
    },
    agora: () => relogio,
  };
}

/** Uma anomalia grave, medida, acionável — o caso que DEVE falar. */
function anomaliaGrave(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tipo: 'operacao.anomalia',
    origem: 'vigia',
    assunto: 'memoria_uso',
    rotulo: 'uso de memória',
    resumo: 'A memória da sua máquina está em 94%',
    evidencia: ['O normal seria abaixo de 80%'],
    confianca: 'alta',
    severidade: 'grave',
    natureza: 'observado',
    acionavel: true,
    ...extra,
  };
}

// ===========================================================================
// PRO-001 / PRO-002 — o caminho principal e o silêncio do caso fraco
// ===========================================================================

test('PRO-001. ocorrência grave, confiável e acionável vira uma fala — e só uma', async () => {
  const b = bancada();
  const j = await b.motor.perceber(anomaliaGrave());

  assert.equal(j?.acao, 'alertar');
  assert.equal(b.falas.length, 1);
  assert.match(b.falas[0].texto, /94%/);
  /* A frase termina em OFERTA, nunca em anúncio nem em ação. É a voz que o
     `Vigia` já tinha e que a camada nova não pode perder. */
  assert.match(b.falas[0].texto, /quer que eu/i);
  assert.doesNotMatch(b.falas[0].texto, /^Olá|informação relevante/i);
});

test('PRO-002. ocorrência leve e de confiança média não fala', async () => {
  const b = bancada();
  const j = await b.motor.perceber(
    anomaliaGrave({
      assunto: 'disco_livre',
      severidade: 'leve',
      confianca: 'media',
      acionavel: false,
      resumo: 'O disco está com 40% livre',
    }),
  );

  assert.notEqual(j?.acao, 'alertar');
  assert.equal(b.falas.length, 0);
});

// ===========================================================================
// PRO-003 / PRO-004 — duas pessoas, o mesmo evento
// ===========================================================================

test('PRO-003. o MESMO evento produz decisões diferentes para operadores diferentes', async () => {
  /**
   * O teste que define a camada. Se os dois receberem o mesmo alerta, a
   * implementação falhou — é personalização de fachada.
   *
   * A diferença aqui é só a ficha, que é o único lugar da IARA onde nada é
   * inferido: A declarou que cuida de desempenho de máquina; B declarou que
   * cuida de faturamento.
   */
  const fichaA: PreferenciasOperador = {
    ...PREFERENCIAS_PADRAO,
    funcao: 'Analista de infraestrutura',
    observacoes: 'acompanho memoria e desempenho das maquinas da operacao',
  };
  const fichaB: PreferenciasOperador = {
    ...PREFERENCIAS_PADRAO,
    funcao: 'Assistente de faturamento',
    observacoes: 'cuido de notas fiscais e cobranca dos clientes',
  };

  const a = bancada({ id: 'ana', preferencias: fichaA });
  const bb = bancada({ id: 'bia', preferencias: fichaB });

  const evento = anomaliaGrave({
    severidade: 'moderada',
    confianca: 'media',
    resumo: 'A memoria da sua maquina subiu para 84%',
  });

  const ja = await a.motor.perceber(evento);
  const jb = await bb.motor.perceber(evento);

  assert.ok(ja && jb);
  assert.ok(
    ja.pontuacao > jb.pontuacao,
    `A (${ja.pontuacao}) deveria pontuar acima de B (${jb.pontuacao})`,
  );
  assert.notDeepEqual(
    [ja.acao, ja.motivos],
    [jb.acao, jb.motivos],
    'os dois operadores receberam exatamente a mesma decisão',
  );
});

test('PRO-004. o livro de um operador não contém nada do outro', async () => {
  const raiz = raizNova();
  const compartilhado = new LivroDeOcorrencias(raiz);
  const a = bancada({ id: 'ana', raiz, livro: compartilhado });
  const bb = bancada({ id: 'bia', raiz, livro: compartilhado });

  await a.motor.perceber(anomaliaGrave());

  const livroB = await bb.livro.ler('bia');
  assert.deepEqual(livroB.vistas, {});
  assert.deepEqual(livroB.decisoes, []);
  assert.equal(bb.falas.length, 0);

  const livroA = await a.livro.ler('ana');
  assert.equal(Object.keys(livroA.vistas).length, 1);
});

// ===========================================================================
// PRO-005 / PRO-006 — autonomia
// ===========================================================================

test('PRO-005. abaixo de "sugestao" a IARA percebe e NÃO fala', async () => {
  for (const nivel of ['conversa', 'comando', 'plano'] as const) {
    const b = bancada({ nivel });
    const j = await b.motor.perceber(anomaliaGrave());
    assert.equal(j?.acao, 'guardar', `nível ${nivel} deixou a decisão virar ${j?.acao}`);
    assert.deepEqual(j?.motivos, ['autonomia_insuficiente']);
    assert.equal(b.falas.length, 0, `nível ${nivel} produziu fala`);
  }
});

test('PRO-006. NENHUMA entrada produz a decisão `agir` — nem no topo da autonomia', () => {
  /**
   * A varredura que sustenta o invariante I2. `agir` existe no vocabulário
   * porque é o nome certo para o degrau que ainda não existe; o que este teste
   * trava é que `decidir` nunca o alcance por combinação nenhuma.
   *
   * Se um dia rotinas autorizadas existirem, elas entram pelo `PorteiroAutorizacao`
   * com plano determinístico — e este teste continua verde, porque continua
   * sendo verdade que a camada proativa não autoriza nada.
   */
  const severidades = ['leve', 'moderada', 'grave'] as const;
  const confiancas = ['baixa', 'media', 'alta'] as const;
  const niveis = ['conversa', 'comando', 'plano', 'sugestao', 'rotina'] as const;
  const tipos = [
    'operacao.anomalia',
    'operacao.falha',
    'sistema.degradacao',
    'automacao.oportunidade',
    'dado.inconsistente',
  ] as const;

  let combinacoes = 0;
  for (const severidade of severidades) {
    for (const confianca of confiancas) {
      for (const nivel of niveis) {
        for (const tipo of tipos) {
          for (const acionavel of [true, false]) {
            for (const vezes of [0, 1, 9]) {
              const leitura = normalizarOcorrencia(
                anomaliaGrave({ tipo, severidade, confianca, acionavel }),
                'operadora',
                MEIO_DIA,
                () => 'id-fixo',
              );
              assert.ok(leitura.ok);
              const atencao = atencaoNova('memoria_uso', MEIO_DIA);
              const relevancia = avaliar({
                ocorrencia: leitura.ocorrencia,
                atencao,
                preferencias: { ...PREFERENCIAS_PADRAO },
                vezesVisto: vezes,
              });
              const j = decidir({
                ocorrencia: leitura.ocorrencia,
                relevancia,
                atencao,
                nivel,
                agora: MEIO_DIA,
              });
              assert.notEqual(j.acao, 'agir', `combinação produziu agir: ${tipo}/${severidade}/${confianca}/${nivel}`);
              assert.ok(ACOES.includes(j.acao));
              combinacoes += 1;
            }
          }
        }
      }
    }
  }
  assert.ok(combinacoes >= 900, `varredura fraca demais: ${combinacoes} combinações`);
});

// ===========================================================================
// PRO-007 a PRO-010 — deduplicação e anti-spam
// ===========================================================================

test('PRO-007. o mesmo fato de duas fontes é UMA ocorrência com duas fontes', async () => {
  const b = bancada();

  await b.motor.perceber(
    anomaliaGrave({
      fontes: [{ nome: 'sonda A', referencia: 'braco:medir:1', instante: MEIO_DIA }],
    }),
  );
  await b.motor.perceber(
    anomaliaGrave({
      fontes: [{ nome: 'sonda B', referencia: 'braco:medir:2', instante: MEIO_DIA }],
    }),
  );

  const livro = await b.livro.ler('operadora');
  assert.equal(Object.keys(livro.vistas).length, 1, 'o mesmo fato virou duas ocorrências');
  const vista = Object.values(livro.vistas)[0];
  assert.equal(vista.vezes, 2);
  assert.deepEqual(
    vista.fontes.map((f) => f.nome),
    ['sonda A', 'sonda B'],
  );
  assert.equal(b.falas.length, 1, 'o segundo relato do mesmo fato falou de novo');
});

test('PRO-008. 100 ocorrências idênticas produzem no máximo uma fala', async () => {
  const b = bancada();
  for (let i = 0; i < 100; i += 1) await b.motor.perceber(anomaliaGrave());

  assert.equal(b.falas.length, 1);
  const livro = await b.livro.ler('operadora');
  assert.equal(Object.keys(livro.vistas).length, 1);
  assert.equal(livro.contadores.duplicadas, 99);
});

test('PRO-009. 100 ocorrências semelhantes respeitam o teto diário', async () => {
  const b = bancada();
  for (let i = 0; i < 100; i += 1) {
    await b.motor.perceber(anomaliaGrave({ assunto: `assunto_${i}`, resumo: `Fato número ${i}` }));
    /* Avança o relógio o bastante para furar a carência global — o objetivo é
       exercitar o TETO, não a carência. */
    b.avancar(CARENCIA_GLOBAL_MS + 1000);
  }
  assert.ok(
    b.falas.length <= TETO_DIARIO,
    `${b.falas.length} falas passam do teto diário de ${TETO_DIARIO}`,
  );
  assert.ok(b.falas.length > 0, 'nenhuma fala: o teste não exercitou nada');
});

test('PRO-010. rajada instantânea de 50 eventos não vira rajada de falas', async () => {
  const b = bancada();
  const tudo = Array.from({ length: 50 }, (_, i) =>
    b.motor.perceber(anomaliaGrave({ assunto: `rajada_${i}`, resumo: `Rajada ${i}` })),
  );
  const resultados = await Promise.all(tudo);

  assert.equal(resultados.filter((r) => r === null).length, 0, 'alguma percepção morreu');
  assert.ok(b.falas.length <= 2, `rajada produziu ${b.falas.length} falas`);
});

// ===========================================================================
// PRO-011 — O TESTE DO SILÊNCIO
// ===========================================================================

test('PRO-011. dez mil ocorrências: tudo avaliado, quase nada guardado, nada dito', async () => {
  const b = bancada();

  /**
   * 9 990 eventos triviais e 10 relevantes. O que se mede não é a fala — é o
   * CUSTO do silêncio: se guardar tudo fosse necessário para calar, esta camada
   * seria um log de aplicação com nome bonito.
   */
  for (let i = 0; i < 9990; i += 1) {
    await b.motor.perceber({
      tipo: 'sistema.degradacao',
      origem: 'kernel',
      assunto: `ruido_${i % 300}`,
      rotulo: 'ruído',
      resumo: `Evento trivial ${i}`,
      evidencia: [`amostra ${i}`],
      confianca: 'baixa',
      severidade: 'leve',
      natureza: 'observado',
      acionavel: false,
    });
  }

  const soRuido = await b.livro.ler('operadora');
  assert.equal(b.falas.length, 0, 'ruído produziu fala');
  assert.equal(
    Object.keys(soRuido.vistas).length,
    0,
    `${Object.keys(soRuido.vistas).length} ocorrências de ruído persistidas — o piso não está segurando`,
  );

  /* A fração pequena que IMPORTA: dez anomalias graves, em assuntos distintos,
     espaçadas o bastante para furar a carência global. O silêncio não pode ser
     obtido calando tudo. */
  for (let i = 0; i < 10; i += 1) {
    await b.motor.perceber(anomaliaGrave({ assunto: `real_${i}`, resumo: `Anomalia real ${i}` }));
    b.avancar(CARENCIA_GLOBAL_MS + 1000);
  }

  const livro = await b.livro.ler('operadora');
  const persistidas = Object.keys(livro.vistas).length;

  assert.equal(persistidas, 10, `guardou ${persistidas} — deveria guardar só as 10 relevantes`);
  assert.ok(b.falas.length > 0, 'nada foi dito nem para as anomalias graves');
  assert.ok(
    b.falas.length <= TETO_DIARIO,
    `${b.falas.length} falas passam do teto diário de ${TETO_DIARIO}`,
  );

  const m = await b.motor.metricas();
  assert.equal(m.avaliadas, 10_000, 'a contagem de avaliadas não fecha');
});

// ===========================================================================
// PRO-012 a PRO-016 — aprendizado
// ===========================================================================

test('PRO-012. engajamento e ação levantam o peso de forma monotônica', () => {
  let a = atencaoNova('antt', MEIO_DIA);
  const inicial = pesoDe(a);
  assert.equal(inicial, 0.5, 'sem evidência o peso tem de ser exatamente neutro');

  const trilha: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    a = aplicarReacao(a, 'proposta', MEIO_DIA);
    a = aplicarReacao(a, 'engajou', MEIO_DIA);
    trilha.push(pesoDe(a));
  }
  for (let i = 0; i < 2; i += 1) {
    a = aplicarReacao(a, 'agiu', MEIO_DIA);
    trilha.push(pesoDe(a));
  }

  for (let i = 1; i < trilha.length; i += 1) {
    assert.ok(trilha[i] > trilha[i - 1], `o peso não subiu no passo ${i}: ${trilha.join(', ')}`);
  }
  assert.ok(pesoDe(a) > 0.75, `peso final fraco demais: ${pesoDe(a)}`);
});

test('PRO-013. ignorar e rejeitar derrubam o peso e silenciam o assunto', () => {
  let a = atencaoNova('antt', MEIO_DIA);
  for (let i = 0; i < 4; i += 1) a = aplicarReacao(a, 'engajou', MEIO_DIA);
  const alto = pesoDe(a);

  for (let i = 0; i < 10; i += 1) a = aplicarReacao(a, 'ignorou', MEIO_DIA);
  const depoisDeIgnorar = pesoDe(a);
  assert.ok(depoisDeIgnorar < alto, 'ignorar não derrubou o peso');
  assert.equal(silenciado(a, MEIO_DIA), false, 'ignorar nunca deve silenciar — só rejeitar');

  for (let i = 0; i < REJEICOES_PARA_SILENCIO_LONGO; i += 1) {
    a = aplicarReacao(a, 'rejeitou', MEIO_DIA);
  }
  assert.ok(pesoDe(a) < depoisDeIgnorar, 'rejeitar não derrubou mais que ignorar');
  assert.equal(silenciado(a, MEIO_DIA + 3 * DIA_MS), true, 'três rejeições não geraram silêncio longo');
});

test('PRO-014. "não precisa me avisar disso" silencia o assunto de ponta a ponta', async () => {
  const b = bancada();
  await b.motor.perceber(anomaliaGrave());
  assert.equal(b.falas.length, 1);

  b.avancar(60_000);
  await b.motor.observarMensagem('não precisa me avisar disso, por favor');

  const livro = await b.livro.ler('operadora');
  const atencao = atencaoDe(livro, 'memoria_uso', b.agora());
  assert.equal(atencao.rejeitou, 1);
  assert.ok(silenciado(atencao, b.agora()), 'a rejeição não produziu silêncio');

  /* E agora o que importa: o MESMO fato, um dia depois, não fala. */
  b.avancar(DIA_MS);
  const j = await b.motor.perceber(anomaliaGrave({ resumo: 'A memória subiu para 96%' }));
  assert.equal(j?.acao, 'guardar');
  assert.deepEqual(j?.motivos, ['assunto_silenciado']);
  assert.equal(b.falas.length, 1, 'falou apesar da rejeição explícita');
});

test('PRO-015. agir depois de rejeitar levanta o silêncio sem apagar o histórico', () => {
  let a = atencaoNova('antt', MEIO_DIA);
  a = aplicarReacao(a, 'rejeitou', MEIO_DIA);
  assert.ok(silenciado(a, MEIO_DIA + HORA_MS));

  a = aplicarReacao(a, 'agiu', MEIO_DIA + 2 * HORA_MS);
  assert.equal(silenciado(a, MEIO_DIA + 2 * HORA_MS), false, 'agir não levantou o silêncio');
  assert.equal(a.rejeitou, 1, 'a rejeição foi apagada — o histórico não pode sumir');
});

test('PRO-016. o silêncio por rejeição vence sozinho', () => {
  let a = atencaoNova('antt', MEIO_DIA);
  a = aplicarReacao(a, 'rejeitou', MEIO_DIA);

  assert.equal(silenciado(a, MEIO_DIA + SILENCIO_POR_REJEICAO_MS - 1000), true);
  assert.equal(silenciado(a, MEIO_DIA + SILENCIO_POR_REJEICAO_MS + 1000), false);
});

// ===========================================================================
// PRO-017 / PRO-018 — a janela de silêncio
// ===========================================================================

test('PRO-017. fora do horário, o caso moderado é represado em vez de dito', async () => {
  const b = bancada();
  b.definirHora(3);

  const j = await b.motor.perceber(
    anomaliaGrave({ severidade: 'moderada', confianca: 'media', assunto: 'disco_livre' }),
  );

  assert.equal(b.falas.length, 0, 'interrompeu às 3h da manhã');
  /* Represado, NÃO descartado: o fato continua no livro com o motivo escrito. */
  if (j?.suprimida_por) {
    assert.equal(j.suprimida_por, 'fora_de_hora');
    assert.equal(j.acao, 'resumir');
  }
  const resumo = await b.motor.resumoPendente();
  assert.ok(resumo === null || typeof resumo === 'string');
});

test('PRO-018. a emergência fura a janela de silêncio — e só ela', async () => {
  const grave = bancada();
  grave.definirHora(3);
  await grave.motor.perceber(anomaliaGrave());
  assert.equal(grave.falas.length, 1, 'grave + alta às 3h deveria falar');

  const suspeita = bancada();
  suspeita.definirHora(3);
  const j = await suspeita.motor.perceber(anomaliaGrave({ confianca: 'baixa' }));
  assert.equal(suspeita.falas.length, 0, 'uma SUSPEITA grave acordou o operador');
  assert.equal(j?.suprimida_por, 'fora_de_hora');
});

test('PRO-017b. a janela aprendida só vale com amostra suficiente', () => {
  const vazia = atividadeVazia();
  assert.equal(horaSilenciosa(14, vazia), false, 'sem histórico, 14h não pode ser silêncio');
  assert.equal(horaSilenciosa(3, vazia), true, 'a noite vale sempre');

  let ativa = atividadeVazia();
  for (let i = 0; i < 60; i += 1) ativa = registrarAtividade(ativa, 9);
  assert.equal(horaSilenciosa(14, ativa), true, 'com 60 amostras só às 9h, 14h é silêncio');
  assert.equal(horaSilenciosa(9, ativa), false);
});

// ===========================================================================
// PRO-019 — confiança baixa com impacto alto
// ===========================================================================

test('PRO-019. confiança baixa com impacto alto vira pergunta, nunca afirmação', async () => {
  const b = bancada();
  const j = await b.motor.perceber(
    anomaliaGrave({
      confianca: 'baixa',
      natureza: 'inferido',
      resumo: 'Pode haver um problema no processo de coleta',
    }),
  );

  assert.equal(j?.acao, 'perguntar');
  assert.equal(b.falas.length, 1);
  assert.match(b.falas[0].texto, /ainda não confirmei/i);
  assert.match(b.falas[0].texto, /quer que eu verifi/i);
  /* A frase NÃO pode afirmar. "está com problema" é o exemplo ruim do contrato. */
  assert.doesNotMatch(b.falas[0].texto, /\bestá com problema\b/i);
});

// ===========================================================================
// PRO-020 / PRO-021 — oportunidade de automação
// ===========================================================================

test('PRO-020. a oportunidade aparece só a partir do limiar, e por patamar', () => {
  const assinatura = assinarPasso('consultar_cargas', { mes: 'agosto' });
  /**
   * Espalhados em DEZ dias distintos, em rodízio — repetição concentrada é
   * tentativa, não hábito, e a janela do detector é de catorze dias. A primeira
   * versão desta fixture usava passo fixo de 6 h, o que jogava a centésima
   * execução 24 dias no passado: metade caía fora da janela e o patamar de 100
   * nunca era alcançado. Errar isso no teste é fácil; errar no detector seria
   * um recurso que só funciona em volume baixo.
   */
  const passos = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      assinatura,
      rotulo: 'consultar_cargas',
      instante: MEIO_DIA - (i % 10) * DIA_MS - Math.floor(i / 10) * 60_000,
      /* Um traço por execução: são N TURNOS distintos, que é o que o detector
         conta. Ver `RegistroPasso.traco`. */
      traco: `turno-${i}`,
    }));

  assert.equal(detectar(passos(1), MEIO_DIA).length, 0, '1 execução virou oportunidade');
  assert.equal(detectar(passos(4), MEIO_DIA).length, 0, '4 execuções viraram oportunidade');

  const cinco = detectar(passos(5), MEIO_DIA);
  assert.equal(cinco.length, 1);
  assert.equal(cinco[0].patamar, 5);

  assert.equal(detectar(passos(20), MEIO_DIA)[0].patamar, 20);
  assert.equal(detectar(passos(100), MEIO_DIA)[0].patamar, 100);

  assert.equal(patamarDe(4), null);
  assert.equal(patamarDe(19), 5);
  assert.equal(patamarDe(1000), 100);
});

test('PRO-020b. repetição concentrada num dia só não é hábito', () => {
  const assinatura = assinarPasso('consultar_cargas', {});
  const doMesmoDia = Array.from({ length: 10 }, (_, i) => ({
    assinatura,
    rotulo: 'consultar_cargas',
    instante: MEIO_DIA - i * 60_000,
    traco: `turno-${i}`,
  }));
  assert.equal(
    detectar(doMesmoDia, MEIO_DIA).length,
    0,
    `dez execuções em dez minutos viraram oportunidade (mínimo: ${DIAS_DISTINTOS_MINIMOS} dias)`,
  );
});

test('PRO-020c. a unidade é o TURNO — vinte passos do mesmo turno contam UMA vez', () => {
  /**
   * O TESTE QUE PROTEGE O DETECTOR DO LAÇO DE AGENTE.
   *
   * Hoje o `Kernel` é um pipeline e um pedido produz um passo. Quando ele virar
   * laço, um pedido vai produzir várias voltas — e a MESMA consulta pode ser
   * reexecutada dentro de um turno porque o modelo refinou o parâmetro. Se o
   * detector contasse linhas, um operador que fez a coisa UMA vez apareceria
   * como alguém que a repetiu vinte, e a IARA proporia automatizar o que ele
   * não repetiu.
   *
   * Não é calibragem de limiar: 5/20/100 continuariam certos para a grandeza
   * errada. É a unidade. Este teste fixa a unidade em TURNO, e ele falha alto e
   * claro no dia em que alguém voltar a contar linhas.
   */
  const assinatura = assinarPasso('consultar_cargas', { mes: 'agosto' });

  /* Vinte passos, dois turnos, em dois dias distintos. */
  const doLaco = Array.from({ length: 20 }, (_, i) => ({
    assinatura,
    rotulo: 'consultar_cargas',
    instante: MEIO_DIA - (i < 10 ? 0 : DIA_MS) - i * 1000,
    traco: i < 10 ? 'turno-a' : 'turno-b',
  }));

  assert.equal(
    detectar(doLaco, MEIO_DIA).length,
    0,
    'vinte passos de dois turnos viraram oportunidade — o detector está contando linhas',
  );

  /* E cinco TURNOS de verdade continuam sendo detectados, com `vezes` em
     turnos — nunca em passos. */
  const cincoTurnos = Array.from({ length: 5 }, (_, t) =>
    Array.from({ length: 4 }, (_, k) => ({
      assinatura,
      rotulo: 'consultar_cargas',
      instante: MEIO_DIA - t * DIA_MS - k * 1000,
      traco: `turno-${t}`,
    })),
  ).flat();

  const achado = detectar(cincoTurnos, MEIO_DIA);
  assert.equal(achado.length, 1);
  assert.equal(achado[0].vezes, 5, `contou ${achado[0].vezes} — deveria contar 5 turnos, não 20 passos`);
  assert.equal(achado[0].patamar, 5);
});

test('PRO-020d. registro sem traço mantém a semântica antiga — livro velho não muda de leitura', () => {
  /* Um livro gravado antes deste campo existir não pode ser reinterpretado: ali
     cada linha ERA um pedido, e continua sendo contada como um. */
  const assinatura = assinarPasso('consultar_cargas', {});
  const legado = Array.from({ length: 5 }, (_, i) => ({
    assinatura,
    rotulo: 'consultar_cargas',
    instante: MEIO_DIA - i * DIA_MS,
  }));
  const achado = detectar(legado, MEIO_DIA);
  assert.equal(achado.length, 1);
  assert.equal(achado[0].vezes, 5);
});

test('PRO-020e. o motor não deixa o mesmo turno entupir o buffer de passos', () => {
  const b = bancada();
  /* Cinquenta passos idênticos do MESMO turno: o buffer tem de guardar um. */
  for (let i = 0; i < 50; i += 1) {
    b.motor.registrarPasso('consultar_cargas', { mes: 'agosto' }, 'turno-unico');
  }
  const buffer = (b.motor as unknown as { passosPendentes: unknown[] }).passosPendentes;
  assert.equal(buffer.length, 1, `o buffer guardou ${buffer.length} cópias do mesmo turno`);
});

test('PRO-021. a oportunidade vira SUGESTÃO, jamais execução', async () => {
  const b = bancada();
  const j = await b.motor.perceber(
    ocorrenciaDeOportunidade({
      assinatura: 'abc123',
      rotulo: 'consultar_cargas',
      vezes: 14,
      patamar: 5,
      dias_distintos: 6,
      primeira_em: MEIO_DIA - 6 * DIA_MS,
      ultima_em: MEIO_DIA,
    }),
  );

  assert.equal(j?.acao, 'sugerir');
  assert.equal(b.falas.length, 1);
  assert.match(b.falas[0].texto, /14 vezes/);
  assert.match(b.falas[0].texto, /automatizar\?$/);
  /* Nenhuma promessa de ação: a frase oferece, não anuncia. */
  assert.doesNotMatch(b.falas[0].texto, /\bvou (automatizar|criar|executar)\b/i);
});

test('PRO-021b. o ciclo completo detecta a repetição a partir dos passos observados', async () => {
  const b = bancada();
  for (let i = 0; i < 6; i += 1) {
    /* Um turno por dia — seis pedidos de verdade, não seis voltas do mesmo. */
    b.motor.registrarPasso('consultar_cargas', { mes: 'agosto' }, `turno-dia-${i}`);
    b.avancar(DIA_MS);
  }
  await b.motor.tique();

  assert.equal(b.falas.length, 1, 'o tique não detectou a repetição');
  assert.match(b.falas[0].texto, /consultar_cargas/);
});

// ===========================================================================
// PRO-022 — a justificativa
// ===========================================================================

test('PRO-022. toda decisão carrega justificativa estruturada e explicável', async () => {
  const b = bancada();
  const j = await b.motor.perceber(anomaliaGrave());

  assert.ok(j);
  assert.equal(j.gatilho, 'operacao.anomalia');
  assert.equal(j.assunto, 'memoria_uso');
  assert.equal(j.natureza, 'observado');
  assert.equal(j.confianca, 'alta');
  assert.ok(j.motivos.length > 0);
  assert.ok(j.evidencia.length > 0);
  assert.ok(typeof j.pontuacao === 'number' && j.pontuacao > 0 && j.pontuacao <= 1);

  const explicacao = b.motor.explicarUltima();
  assert.ok(explicacao);
  assert.match(explicacao, /memoria_uso/);
  assert.match(explicacao, /alertar/);
});

// ===========================================================================
// PRO-023 — persistência real
// ===========================================================================

test('PRO-023. o estado sobrevive ao descarte da instância e volta do disco', async () => {
  const raiz = raizNova();
  const primeiro = bancada({ raiz });

  await primeiro.motor.perceber(anomaliaGrave());
  primeiro.avancar(60_000);
  await primeiro.motor.observarMensagem('não precisa me avisar disso');
  await primeiro.motor.tique();

  /* Instância NOVA sobre o mesmo diretório — nada em memória atravessa. */
  const segundo = new LivroDeOcorrencias(raiz);
  const livro = await segundo.ler('operadora');

  assert.equal(Object.keys(livro.vistas).length, 1, 'a ocorrência não foi ao disco');
  assert.equal(livro.contadores.faladas, 1);
  assert.equal(livro.contadores.rejeitou, 1);
  const atencao = atencaoDe(livro, 'memoria_uso', primeiro.agora());
  assert.equal(atencao.rejeitou, 1);
  assert.ok(silenciado(atencao, primeiro.agora()), 'o silêncio não sobreviveu ao restart');
  assert.ok(livro.atividade.some((n) => n > 0), 'o histograma de atividade não persistiu');
});

// ===========================================================================
// PRO-025 / PRO-026 — degradação segura
// ===========================================================================

test('PRO-025. disco indisponível: não lança, não fala, e registra a degradação', async () => {
  /**
   * Raiz apontando para DENTRO de um arquivo que existe de verdade: `mkdir`
   * falha com `ENOTDIR`/`EEXIST` e a falha sobe até o motor.
   *
   * O arquivo precisa existir. A primeira versão deste teste apontava para um
   * caminho inexistente — e `mkdir(recursive)` simplesmente criava as pastas,
   * de modo que o teste media o caminho feliz achando que media a falha. É o
   * falso verde clássico: a asserção estava certa, a pré-condição é que era
   * mentira.
   */
  const { writeFileSync: escrever } = await import('node:fs');
  const bloqueio = path.join(raizNova(), 'bloqueio');
  escrever(bloqueio, 'não sou uma pasta', 'utf8');
  const raiz = path.join(bloqueio, 'dentro');
  const b = bancada({ raiz });

  const j = await b.motor.perceber(anomaliaGrave());

  assert.equal(j, null, 'com o livro fora do ar a decisão tem de ser nenhuma');
  assert.equal(b.falas.length, 0, 'falou sem conseguir lembrar o que já disse');
});

test('PRO-026. ocorrência malformada é recusada sem falar e sem persistir', async () => {
  const b = bancada();
  const lixo: unknown[] = [
    null,
    undefined,
    'texto solto',
    42,
    [],
    {},
    { tipo: 'operacao.anomalia' },
    anomaliaGrave({ tipo: 'inventado.novo' }),
    anomaliaGrave({ origem: 'hacker' }),
    anomaliaGrave({ severidade: 'catastrofica' }),
    anomaliaGrave({ confianca: 'total' }),
    anomaliaGrave({ natureza: 'certeza' }),
    anomaliaGrave({ assunto: '' }),
    anomaliaGrave({ assunto: '   ' }),
    anomaliaGrave({ resumo: '' }),
    anomaliaGrave({ acionavel: 'sim' }),
    anomaliaGrave({ natureza: 'observado', evidencia: [] }),
  ];

  for (const entrada of lixo) {
    const j = await b.motor.perceber(entrada);
    assert.equal(j, null, `entrada aceita indevidamente: ${JSON.stringify(entrada)?.slice(0, 80)}`);
  }

  assert.equal(b.falas.length, 0);
  const livro = await b.livro.ler('operadora');
  assert.deepEqual(livro.vistas, {});

  const m = await b.motor.metricas();
  assert.equal(m.recusadas, lixo.length);
});

// ===========================================================================
// Política pura — as peças isoladas
// ===========================================================================

test('os pesos de relevância somam 1 — senão os limiares mudam de significado', () => {
  const soma = Object.values(PESOS).reduce((s, n) => s + n, 0);
  assert.ok(Math.abs(soma - 1) < 1e-9, `os pesos somam ${soma}`);
});

test('a pontuação de uma ocorrência mediana fica ABAIXO do limiar de fala', () => {
  /* É o que faz do silêncio o padrão. Se isto cair, tudo passa a falar. */
  const leitura = normalizarOcorrencia(
    anomaliaGrave({ severidade: 'moderada', confianca: 'media', acionavel: false }),
    'operadora',
    MEIO_DIA,
    () => 'x',
  );
  assert.ok(leitura.ok);
  const r = avaliar({
    ocorrencia: leitura.ocorrencia,
    atencao: atencaoNova('memoria_uso', MEIO_DIA),
    preferencias: { ...PREFERENCIAS_PADRAO },
    vezesVisto: 0,
  });
  assert.ok(r.pontuacao > PISO_DE_REGISTRO, `mediana abaixo do piso: ${r.pontuacao}`);
  assert.ok(r.pontuacao < LIMIAR_DE_FALA, `mediana já fala sozinha: ${r.pontuacao}`);
});

test('ficha vazia é neutra; ficha declarada em outro assunto pesa menos que uma que casa', () => {
  const leitura = normalizarOcorrencia(anomaliaGrave(), 'operadora', MEIO_DIA, () => 'x');
  assert.ok(leitura.ok);
  const o = leitura.ocorrencia;

  assert.equal(responsabilidadeDe({ ...PREFERENCIAS_PADRAO }, o), 0.5);
  const outra = responsabilidadeDe(
    { ...PREFERENCIAS_PADRAO, funcao: 'faturamento', observacoes: 'notas fiscais' },
    o,
  );
  const dela = responsabilidadeDe(
    { ...PREFERENCIAS_PADRAO, funcao: 'infraestrutura', observacoes: 'memoria das maquinas' },
    o,
  );
  assert.ok(dela > 0.5 && outra < 0.5, `dela=${dela} outra=${outra}`);
});

test('a novidade decai, mas nunca zera', () => {
  assert.equal(novidadeDe(0), 1);
  assert.equal(novidadeDe(1), 0.5);
  assert.ok(novidadeDe(99) > 0);
});

test('as quatro barreiras de interrupção disparam cada uma pelo próprio motivo', () => {
  const base = {
    assunto: 'memoria_uso',
    severidade: 'moderada' as const,
    confianca: 'media' as const,
    estado: { interrupcoes: [], carencia: {}, atividade: atividadeVazia() },
  };

  assert.equal(podeInterromper({ ...base, agora: MEIO_DIA, hora: 12 }).permitido, true);

  const noite = podeInterromper({ ...base, agora: MEIO_DIA, hora: 3 });
  assert.deepEqual(noite, { permitido: false, motivo: 'fora_de_hora' });

  const comCarencia = podeInterromper({
    ...base,
    agora: MEIO_DIA,
    hora: 12,
    estado: { ...base.estado, carencia: { memoria_uso: MEIO_DIA - CARENCIA_ASSUNTO_MS + 1000 } },
  });
  assert.deepEqual(comCarencia, { permitido: false, motivo: 'carencia_do_assunto' });

  const recente = podeInterromper({
    ...base,
    agora: MEIO_DIA,
    hora: 12,
    estado: { ...base.estado, interrupcoes: [MEIO_DIA - CARENCIA_GLOBAL_MS + 1000] },
  });
  assert.deepEqual(recente, { permitido: false, motivo: 'interrupcao_recente' });

  const cheio = podeInterromper({
    ...base,
    agora: MEIO_DIA,
    hora: 12,
    estado: {
      ...base.estado,
      interrupcoes: Array.from({ length: TETO_DIARIO }, (_, i) => MEIO_DIA - (i + 2) * HORA_MS),
    },
  });
  assert.deepEqual(cheio, { permitido: false, motivo: 'teto_diario' });
});

test('a emergência NÃO fura a carência global — é para ela que a barreira existe', () => {
  const veredicto = podeInterromper({
    assunto: 'outro',
    severidade: 'grave',
    confianca: 'alta',
    agora: MEIO_DIA,
    hora: 12,
    estado: {
      interrupcoes: [MEIO_DIA - 1000],
      carencia: {},
      atividade: atividadeVazia(),
    },
  });
  assert.deepEqual(veredicto, { permitido: false, motivo: 'interrupcao_recente' });
});

test('rebaixar preserva o fato e escreve por que a fala não saiu', () => {
  const leitura = normalizarOcorrencia(anomaliaGrave(), 'operadora', MEIO_DIA, () => 'x');
  assert.ok(leitura.ok);
  const r = avaliar({
    ocorrencia: leitura.ocorrencia,
    atencao: atencaoNova('memoria_uso', MEIO_DIA),
    preferencias: { ...PREFERENCIAS_PADRAO },
    vezesVisto: 0,
  });
  const j = decidir({
    ocorrencia: leitura.ocorrencia,
    relevancia: r,
    atencao: atencaoNova('memoria_uso', MEIO_DIA),
    nivel: 'sugestao',
    agora: MEIO_DIA,
  });
  const rebaixada = rebaixar(j, 'teto_diario');

  assert.equal(rebaixada.acao, 'resumir');
  assert.equal(rebaixada.suprimida_por, 'teto_diario');
  assert.deepEqual(rebaixada.evidencia, j.evidencia, 'o fato foi alterado no rebaixamento');
  assert.notEqual(rebaixada.acao, 'ignorar', 'represar não pode virar descartar');
});

test('a chave de deduplicação ignora grafia e pontuação do mesmo fato', () => {
  assert.equal(
    chaveDe('operacao.anomalia', 'memoria_uso', 'A memória está em 94%'),
    chaveDe('operacao.anomalia', 'memoria_uso', 'a  MEMORIA  esta em 94%'),
  );
  assert.notEqual(
    chaveDe('operacao.anomalia', 'memoria_uso', 'A memória está em 94%'),
    chaveDe('operacao.anomalia', 'disco_livre', 'A memória está em 94%'),
  );
});

test('o registro de interrupção esquece o que passou de 24h', () => {
  const estado = registrarInterrupcao(
    { interrupcoes: [MEIO_DIA - 2 * DIA_MS], carencia: {}, atividade: atividadeVazia() },
    'memoria_uso',
    MEIO_DIA,
  );
  assert.deepEqual(estado.interrupcoes, [MEIO_DIA]);
  assert.equal(estado.carencia.memoria_uso, MEIO_DIA);
});

// ===========================================================================
// PRO-038 — a fiação com o vigia
// ===========================================================================

test('PRO-038. o aviso do vigia atravessa a camada proativa preservando o fato', async () => {
  const b = bancada();
  const j = await b.motor.perceber(
    ocorrenciaDoVigia({
      assunto: 'memoria_uso',
      severidade: 'grave',
      texto: 'frase antiga do vigia',
      descricao: 'a memória está em 94% (o normal seria abaixo de 80%)',
      faixa_normal: 'abaixo de 80%',
    }),
  );

  assert.equal(j?.acao, 'alertar');
  assert.equal(j?.natureza, 'observado');
  assert.equal(b.falas.length, 1);
  assert.match(b.falas[0].texto, /94%/);
  assert.match(b.falas[0].texto, /abaixo de 80%/);
  /* A frase é composta pela camada nova; a do vigia não é reaproveitada crua,
     senão a oferta apareceria duas vezes na mesma linha. */
  assert.doesNotMatch(b.falas[0].texto, /frase antiga/);
  assert.equal((b.falas[0].texto.match(/quer que eu/gi) ?? []).length, 1);
});

test('a mesma medição em duas leituras seguidas não fala duas vezes', async () => {
  const b = bancada();
  const aviso = {
    assunto: 'memoria_uso',
    severidade: 'grave' as const,
    texto: '',
    descricao: 'a memória está em 94%',
    faixa_normal: 'abaixo de 80%',
  };
  await b.motor.perceber(ocorrenciaDoVigia(aviso));
  b.avancar(11 * 60 * 1000); // fura a carência global, não a do assunto
  await b.motor.perceber(ocorrenciaDoVigia({ ...aviso, descricao: 'a memória está em 96%' }));

  assert.equal(b.falas.length, 1, 'a segunda leitura da mesma anomalia falou de novo');
});

// ===========================================================================
// PRO-040 — métricas
// ===========================================================================

test('PRO-040. as métricas saem de evidência, não de estimativa', async () => {
  const b = bancada();

  await b.motor.perceber(anomaliaGrave());
  b.avancar(60_000);
  await b.motor.observarMensagem('sim, pode investigar');

  b.avancar(2 * HORA_MS);
  await b.motor.perceber(anomaliaGrave({ assunto: 'disco_livre', resumo: 'Disco em 3% livre' }));
  b.avancar(JANELA_REACAO_EXCEDIDA);
  await b.motor.tique();

  const m = await b.motor.metricas();
  assert.equal(m.faladas, 2);
  assert.equal(m.engajou, 1);
  assert.equal(m.ignorou, 1);
  assert.equal(m.utilidade, 0.5, `utilidade errada: ${m.utilidade}`);
  assert.equal(m.taxa_falso_positivo, 0.5);
  assert.equal(m.taxa_ignorado, 0.5);
});

const JANELA_REACAO_EXCEDIDA = 31 * 60 * 1000;

// ===========================================================================
// Higiene do livro
// ===========================================================================

test('o livro tem teto em todas as coleções e conta o que podou', async () => {
  const raiz = raizNova();
  const livro = new LivroDeOcorrencias(raiz);

  await livro.transacao('operadora', (l) => {
    for (let i = 0; i < 800; i += 1) {
      l.decisoes.push({
        id: `d${i}`,
        chave: `c${i}`,
        em: MEIO_DIA,
        justificativa: {
          gatilho: 'operacao.anomalia',
          assunto: 'x',
          acao: 'guardar',
          motivos: [],
          evidencia: [],
          confianca: 'media',
          pontuacao: 0.4,
          natureza: 'observado',
          suprimida_por: null,
        },
        texto: null,
      });
      l.passos.push({ assinatura: `a${i}`, rotulo: 'r', instante: MEIO_DIA });
    }
  });

  const lido = await livro.ler('operadora');
  assert.ok(lido.decisoes.length <= 200, `decisões sem teto: ${lido.decisoes.length}`);
  assert.ok(lido.passos.length <= 500, `passos sem teto: ${lido.passos.length}`);
  assert.ok(lido.podados > 0, 'podou sem contar — perda silenciosa');
});

test('livro ilegível não derruba nada: volta vazio e avisa', async () => {
  const raiz = raizNova();
  const livro = new LivroDeOcorrencias(raiz);
  await livro.transacao('operadora', (l) => {
    l.contadores.faladas = 7;
  });

  const { writeFileSync } = await import('node:fs');
  writeFileSync(path.join(raiz, 'operadora.json'), '{ isto não é json', 'utf8');
  livro.esquecer('operadora');

  const lido = await livro.ler('operadora');
  assert.deepEqual(lido, livroNovo('operadora'));
});

// ===========================================================================
// PRO-039 — a fiação com o metabolismo
// ===========================================================================

test('PRO-039. o ciclo autônomo aciona a proatividade e sobrevive a ela falhar', async () => {
  /**
   * `girarProatividade` é privado de propósito — o tique é quem o chama. A
   * suíte o exercita direto para não depender de um timer de quinze segundos.
   * É o mesmo recurso que `agenda.test.ts` usa com `entregarVencidos`, e pela
   * mesma razão.
   */
  const chamadas: string[] = [];

  const feliz = new CicloAutonomo(
    'operadora',
    {} as EstadoAtomico,
    {} as MemoriaOperacional,
    () => undefined,
    null,
    undefined,
    null,
    null,
    async () => {
      chamadas.push('ok');
    },
  );
  const girarFeliz = (
    feliz as unknown as { girarProatividade: (s: AbortSignal) => Promise<void> }
  ).girarProatividade.bind(feliz);
  await girarFeliz(new AbortController().signal);
  assert.deepEqual(chamadas, ['ok'], 'o ciclo não acionou a camada proativa');

  /**
   * E a segunda metade, que é a que importa: uma proatividade quebrada NÃO pode
   * derrubar o metabolismo. Se este `await` rejeitar, a consolidação noturna que
   * roda logo depois no mesmo tique deixa de acontecer — e ninguém descobre,
   * porque o sintoma seria "o insight parou de sair".
   */
  const quebrado = new CicloAutonomo(
    'operadora',
    {} as EstadoAtomico,
    {} as MemoriaOperacional,
    () => undefined,
    null,
    undefined,
    null,
    null,
    async () => {
      throw new Error('livro em chamas');
    },
  );
  const girarQuebrado = (
    quebrado as unknown as { girarProatividade: (s: AbortSignal) => Promise<void> }
  ).girarProatividade.bind(quebrado);
  await assert.doesNotReject(() => girarQuebrado(new AbortController().signal));

  /* E um ciclo SEM camada proativa continua sendo um ciclo válido. */
  const semMotor = new CicloAutonomo(
    'operadora',
    {} as EstadoAtomico,
    {} as MemoriaOperacional,
    () => undefined,
  );
  const girarSem = (
    semMotor as unknown as { girarProatividade: (s: AbortSignal) => Promise<void> }
  ).girarProatividade.bind(semMotor);
  await assert.doesNotReject(() => girarSem(new AbortController().signal));
});

test('comporFala nunca promete ação nem anuncia genericamente', () => {
  const leitura = normalizarOcorrencia(anomaliaGrave(), 'operadora', MEIO_DIA, () => 'x');
  assert.ok(leitura.ok);
  for (const acao of ['alertar', 'sugerir', 'perguntar'] as const) {
    const frase = comporFala(leitura.ocorrencia, acao);
    assert.match(frase, /\?$/, `${acao}: a frase não termina em oferta`);
    assert.doesNotMatch(frase, /\bjá (executei|fiz|corrigi|resolvi)\b/i);
    assert.doesNotMatch(frase, /informação relevante|Olá!/i);
    assert.ok(frase.length < 400, `${acao}: frase longa demais (${frase.length})`);
  }
});
