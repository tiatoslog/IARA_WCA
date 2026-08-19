/**
 * PROATIVIDADE — SETE DIAS VIRTUAIS, DUAS PESSOAS.
 *
 * As baterias de unidade provam regras isoladas. Esta prova a única coisa que
 * regras isoladas não conseguem provar: **que o comportamento ao longo do tempo
 * converge para menos barulho e mais utilidade**, e que converge de forma
 * DIFERENTE para pessoas diferentes.
 *
 * O critério de reprovação mais importante está em `LD-002`:
 *
 *     se os dois operadores receberem o mesmo conjunto de alertas, a
 *     implementação falhou — é personalização de fachada.
 *
 * NADA AQUI É ALEATÓRIO. O roteiro é fixo, o relógio é injetado e as reações são
 * escritas à mão. Um simulador com `Math.random` produziria uma bateria que
 * passa numa execução e falha na outra — e uma bateria intermitente é ruído que
 * alguém desliga na segunda semana, não evidência.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { LivroDeOcorrencias, atencaoDe } from '../servidor/nucleo/proativo/LivroDeOcorrencias';
import { MotorProativo, type FalaProativa } from '../servidor/nucleo/proativo/MotorProativo';
import {
  REJEICOES_PARA_SILENCIO_LONGO,
  SILENCIO_POR_REJEICAO_MS,
  pesoDe,
  silenciado,
} from '../servidor/nucleo/proativo/Atencao';
import { TETO_DIARIO } from '../servidor/nucleo/proativo/Interrupcao';
import { PREFERENCIAS_PADRAO, type PreferenciasOperador } from '../lib/perfil';

const RAIZES: string[] = [];
function raizNova(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'iara-proativo-7d-'));
  RAIZES.push(dir);
  return dir;
}
process.on('exit', () => {
  for (const dir of RAIZES) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* pasta temporária */
    }
  }
});

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;
const INICIO = new Date('2026-08-10T00:00:00.000Z').getTime();

// ---------------------------------------------------------------------------
// Os dois perfis
// ---------------------------------------------------------------------------

/**
 * ANA — cuida da infraestrutura. Declarou isso na ficha, e ao longo da semana
 * ela AGE sobre os avisos de máquina. É a pessoa para quem estes alertas
 * existem.
 */
const ANA: PreferenciasOperador = {
  ...PREFERENCIAS_PADRAO,
  como_chamar: 'Ana',
  funcao: 'Analista de infraestrutura',
  observacoes: 'acompanho memoria, disco e desempenho das maquinas da operacao',
};

/**
 * BIA — cuida do faturamento. Os mesmos avisos chegam a ela, e ela diz que não
 * quer. O sistema tem de aprender isso e ficar quieto — sem que ninguém mexa em
 * configuração nenhuma.
 */
const BIA: PreferenciasOperador = {
  ...PREFERENCIAS_PADRAO,
  como_chamar: 'Bia',
  funcao: 'Assistente de faturamento',
  observacoes: 'cuido de notas fiscais, cobranca e fechamento do mes',
};

interface Simulacao {
  readonly id: string;
  readonly motor: MotorProativo;
  readonly livro: LivroDeOcorrencias;
  readonly falas: FalaProativa[];
  /** Falas por dia virtual, para o teto diário poder ser conferido dia a dia. */
  readonly falasPorDia: number[];
  relogio: number;
  hora: number;
}

function simulacao(id: string, preferencias: PreferenciasOperador): Simulacao {
  const livro = new LivroDeOcorrencias(raizNova());
  const falas: FalaProativa[] = [];
  const estado = {
    id,
    livro,
    falas,
    falasPorDia: new Array<number>(7).fill(0),
    relogio: INICIO,
    hora: 9,
  } as Simulacao;

  (estado as { motor: MotorProativo }).motor = new MotorProativo({
    idUsuario: id,
    livro,
    falar: (f) => {
      falas.push(f);
      const dia = Math.floor((estado.relogio - INICIO) / DIA_MS);
      if (dia >= 0 && dia < 7) estado.falasPorDia[dia] += 1;
    },
    preferencias: async () => preferencias,
    nivel: () => 'sugestao',
    agora: () => estado.relogio,
    hora: () => estado.hora,
  });

  return estado;
}

/** Move o relógio virtual para o dia/hora pedidos. */
function irPara(s: Simulacao, dia: number, hora: number): void {
  s.relogio = INICIO + dia * DIA_MS + hora * HORA_MS;
  s.hora = hora;
}

// ---------------------------------------------------------------------------
// O roteiro dos sete dias
// ---------------------------------------------------------------------------

type Evento = { hora: number; carga: Record<string, unknown> };

function anomalia(
  assunto: string,
  resumo: string,
  severidade: 'leve' | 'moderada' | 'grave',
  confianca: 'baixa' | 'media' | 'alta',
): Record<string, unknown> {
  return {
    tipo: 'operacao.anomalia',
    origem: 'vigia',
    assunto,
    rotulo: assunto.replace(/_/g, ' '),
    resumo,
    evidencia: ['medido pelo braço na máquina do operador'],
    confianca,
    severidade,
    natureza: 'observado',
    acionavel: true,
  };
}

function ruido(i: number): Record<string, unknown> {
  return {
    tipo: 'sistema.degradacao',
    origem: 'kernel',
    assunto: `ruido_${i}`,
    rotulo: 'ruído',
    resumo: `Variação irrelevante número ${i}`,
    evidencia: [`amostra ${i}`],
    confianca: 'baixa',
    severidade: 'leve',
    natureza: 'observado',
    acionavel: false,
  };
}

/**
 * O DIA TÍPICO. Um alerta grave que merece ser dito, um moderado que não, uma
 * falha, e trinta ruídos — que é aproximadamente a proporção real de qualquer
 * operação: quase tudo é ruído.
 */
function diaDe(dia: number): Evento[] {
  const eventos: Evento[] = [
    /* 1. A EMERGÊNCIA. Grave e medida: fala para qualquer perfil. */
    {
      hora: 9,
      carga: anomalia('memoria_uso', `Memória da máquina em ${88 + dia}%`, 'grave', 'alta'),
    },
    /**
     * 2. O EVENTO QUE SEPARA OS DOIS PERFIS. Gravidade média, confiança alta,
     * e um assunto que a ficha da Ana declara e a da Bia não. Para Ana ele
     * cruza `LIMIAR_DE_ALERTA` pela responsabilidade declarada; para Bia, o
     * MESMO evento para em resumo.
     */
    {
      hora: 11,
      carga: anomalia(
        'desempenho_maquina',
        `O desempenho da máquina caiu ${10 + dia}% desde ontem`,
        'moderada',
        'alta',
      ),
    },
    /* 3. Ruído estrutural: acontece todo dia e não é para ninguém. */
    {
      hora: 14,
      carga: {
        tipo: 'operacao.falha',
        origem: 'kernel',
        assunto: 'coleta_planilha',
        rotulo: 'coleta da planilha',
        resumo: `A leitura da planilha falhou ${dia + 2} vezes hoje`,
        evidencia: [`${dia + 2} falhas desde as 8h`],
        confianca: 'media',
        severidade: 'moderada',
        natureza: 'observado',
        acionavel: true,
      },
    },
    /**
     * 4. A SUSPEITA DA MADRUGADA. Grave, mas de confiança baixa — o que a
     * torna uma pergunta, nunca uma afirmação. Às 2h ela tem de ser REPRESADA,
     * não descartada: só grave + alta acorda alguém.
     */
    {
      hora: 2,
      carga: {
        ...anomalia('rede_latencia', `A latência de rede pode ter subido para ${100 + dia} ms`, 'grave', 'baixa'),
        natureza: 'inferido',
      },
    },
  ];

  for (let i = 0; i < 30; i += 1) {
    eventos.push({ hora: 10 + (i % 8), carga: ruido(dia * 100 + i) });
  }
  return eventos;
}

// ---------------------------------------------------------------------------
// A campanha
// ---------------------------------------------------------------------------

/**
 * A REAÇÃO CHEGA CINCO MINUTOS DEPOIS DA FALA, e não no fim do dia.
 *
 * A primeira versão desta campanha entregava todas as reações às 19h. Nenhuma
 * era contada, todas as propostas venciam como `ignorou`, e o peso da Ana — que
 * engajava todo dia — CAÍA. Seis testes vermelhos por uma causa só, e a causa
 * era o simulador, não o motor: a janela de reação é de trinta minutos, porque
 * uma pessoa responde a um alerta em minutos, e atribuir a conversa da tarde à
 * proposta da manhã é como um sistema aprende a coisa errada.
 *
 * O simulador precisa ser realista no TEMPO, não só nos fatos. Um roteiro que
 * viola o modelo mede o modelo errado.
 */
async function correrSemana(s: Simulacao, reagir: (s: Simulacao, dia: number) => Promise<void>) {
  for (let dia = 0; dia < 7; dia += 1) {
    for (const evento of diaDe(dia)) {
      irPara(s, dia, evento.hora);
      const antes = s.falas.length;
      await s.motor.perceber(evento.carga);

      if (s.falas.length > antes) {
        /* Cinco minutos depois — dentro da janela, como uma pessoa real. */
        s.relogio += 5 * 60 * 1000;
        await reagir(s, dia);
      }
    }
    /* Fim do dia: o tique vence pendências e consolida contadores. */
    irPara(s, dia, 23);
    await s.motor.tique();
  }
}

test('LD-001. sete dias: o teto diário nunca é estourado, em nenhum dos dois perfis', async () => {
  const ana = simulacao('ana', ANA);
  const bia = simulacao('bia', BIA);

  await correrSemana(ana, async (s) => {
    /* Ana usa: responde e age sobre o que é da área dela. */
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });
  await correrSemana(bia, async (s, dia) => {
    /* Bia recusa: nos dois primeiros dias com todas as letras. */
    if (dia < 2) await s.motor.observarMensagem('não precisa me avisar disso');
  });

  for (const s of [ana, bia]) {
    s.falasPorDia.forEach((n, dia) => {
      assert.ok(
        n <= TETO_DIARIO,
        `${s.id} recebeu ${n} interrupções no dia ${dia} (teto ${TETO_DIARIO})`,
      );
    });
  }
});

test('LD-002. as duas pessoas NÃO recebem o mesmo conjunto de alertas', async () => {
  const ana = simulacao('ana', ANA);
  const bia = simulacao('bia', BIA);

  await correrSemana(ana, async (s) => {
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });
  await correrSemana(bia, async (s, dia) => {
    if (dia < 2) await s.motor.observarMensagem('não precisa me avisar disso');
  });

  assert.ok(ana.falas.length > 0, 'Ana não recebeu nada — a campanha não exercitou nada');
  assert.ok(
    bia.falas.length < ana.falas.length,
    `Bia (${bia.falas.length}) deveria receber menos que Ana (${ana.falas.length})`,
  );

  const assuntosAna = new Set(ana.falas.map((f) => f.assunto));
  const assuntosBia = new Set(bia.falas.map((f) => f.assunto));
  assert.notDeepEqual(
    [...assuntosAna].sort(),
    [...assuntosBia].sort(),
    'os dois perfis convergiram para o mesmo conjunto de assuntos',
  );
});

test('LD-003. a rejeição repetida silencia — sem ninguém mexer em configuração', async () => {
  const bia = simulacao('bia', BIA);
  /* Bia recusa TODA vez. É o que uma pessoa faz com um aviso que não é dela. */
  await correrSemana(bia, async (s) => {
    await s.motor.observarMensagem('não precisa me avisar disso');
  });

  const livro = await bia.livro.ler('bia');
  const rejeitados = Object.values(livro.atencao).filter((a) => a.rejeitou > 0);
  assert.ok(rejeitados.length > 0, 'nenhuma rejeição foi registrada na semana');

  const silenciados = rejeitados.filter((a) => silenciado(a, bia.relogio));
  assert.ok(
    silenciados.length > 0,
    `${rejeitados.length} assuntos rejeitados e nenhum silenciado ao fim da semana`,
  );

  /**
   * A CONVERGÊNCIA, medida pelo que ela de fato produz.
   *
   * A primeira versão deste teste comparava "primeira metade da semana" com
   * "segunda metade" e falhava por um motivo que não era defeito: com um alerta
   * por dia e silêncio de dois dias, a série vira `1,0,0,1,0,0,1` — as duas
   * metades empatam. O número que importa não é a distribuição no gráfico; é
   * que a IARA nunca insiste mais de uma vez entre duas recusas, e que a
   * terceira recusa compra um mês de silêncio em vez de dois dias.
   */
  const totalBia = bia.falasPorDia.reduce((s, n) => s + n, 0);
  const totalRejeicoes = rejeitados.reduce((s, a) => s + a.rejeitou, 0);
  assert.ok(
    totalBia <= totalRejeicoes,
    `insistiu ${totalBia} vezes contra ${totalRejeicoes} recusas: ${bia.falasPorDia.join(', ')}`,
  );

  assert.ok(
    totalRejeicoes >= REJEICOES_PARA_SILENCIO_LONGO,
    `só ${totalRejeicoes} recusas na semana — o cenário não chegou ao silêncio longo`,
  );
  const castigo = (silenciados[0].silenciado_ate ?? 0) - bia.relogio;
  assert.ok(
    castigo > SILENCIO_POR_REJEICAO_MS * 2,
    `a terceira recusa não escalou o silêncio: faltam ${Math.round(castigo / DIA_MS)} dias`,
  );
});

test('LD-004. o interesse aprendido diverge entre os perfis de forma mensurável', async () => {
  const ana = simulacao('ana', ANA);
  const bia = simulacao('bia', BIA);

  await correrSemana(ana, async (s) => {
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });
  await correrSemana(bia, async (s, dia) => {
    if (dia < 3) await s.motor.observarMensagem('não precisa me avisar disso');
  });

  const livroAna = await ana.livro.ler('ana');
  const livroBia = await bia.livro.ler('bia');

  const pesoAna = pesoDe(atencaoDe(livroAna, 'memoria_uso', ana.relogio));
  const pesoBia = pesoDe(atencaoDe(livroBia, 'memoria_uso', bia.relogio));

  assert.ok(pesoAna > 0.5, `Ana engajou e o peso não subiu: ${pesoAna}`);
  assert.ok(pesoBia < 0.5, `Bia rejeitou e o peso não caiu: ${pesoBia}`);
  assert.ok(
    pesoAna - pesoBia > 0.25,
    `os pesos mal se separaram: Ana=${pesoAna} Bia=${pesoBia}`,
  );
});

test('LD-005. as métricas da semana são calculadas a partir de evidência', async () => {
  const ana = simulacao('ana', ANA);
  await correrSemana(ana, async (s) => {
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });

  const m = await ana.motor.metricas();

  /* Volume: sete dias de 34 eventos. */
  assert.equal(m.avaliadas, 7 * 34, `avaliadas=${m.avaliadas}`);
  assert.ok(m.faladas > 0 && m.faladas < m.avaliadas / 10, `faladas=${m.faladas}`);

  /* Ruído não é guardado: 210 dos 238 eventos são irrelevantes por construção. */
  assert.ok(m.persistidas < 100, `persistidas=${m.persistidas}`);

  /* As taxas fecham entre si — nenhuma métrica pode ser maior que 1. */
  for (const [nome, valor] of Object.entries(m)) {
    if (nome.startsWith('taxa_') || nome === 'utilidade') {
      assert.ok(valor >= 0 && valor <= 1, `${nome} fora de [0,1]: ${valor}`);
    }
  }

  assert.ok(
    m.utilidade + m.taxa_falso_positivo <= 1.0001,
    `utilidade (${m.utilidade}) + falso positivo (${m.taxa_falso_positivo}) passa de 1`,
  );
  assert.ok(m.engajou > 0, 'nenhum engajamento foi contado numa semana inteira de uso');
});

test('LD-006. a IARA fica MAIS útil ao longo da semana para quem usa', async () => {
  const ana = simulacao('ana', ANA);
  await correrSemana(ana, async (s) => {
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });

  const m = await ana.motor.metricas();
  /**
   * A MÉTRICA PRINCIPAL: das vezes em que a IARA falou, quantas serviram.
   *
   * Não é "quantas notificações". Uma IARA que fala uma vez por semana e acerta
   * vale mais que uma que fala trinta e acerta cinco — e é isso que este número
   * mede.
   */
  assert.ok(
    m.utilidade >= 0.4,
    `utilidade de ${m.utilidade}: a IARA falou ${m.faladas} vezes e serviu ${m.engajou + m.agiu}`,
  );
});

test('LD-007. nada é dito de madrugada — o evento das 2h nunca vira interrupção', async () => {
  const ana = simulacao('ana', ANA);
  await correrSemana(ana, async (s) => {
    await s.motor.observarMensagem('sim, pode investigar a memória');
  });

  assert.equal(
    ana.falas.filter((f) => f.assunto === 'rede_latencia').length,
    0,
    'o evento moderado das 2h da manhã acordou a operadora',
  );

  /* Mas não foi DESCARTADO: represado, com o motivo escrito. É a diferença
     entre "não te acordei" e "não te contei". */
  const livro = await ana.livro.ler('ana');
  const represadas = livro.decisoes.filter((d) => d.justificativa.suprimida_por !== null);
  assert.ok(represadas.length > 0, 'nada foi represado — o fato das 2h sumiu');
});

test('LD-008. a semana inteira sobrevive a um restart no meio', async () => {
  const raiz = raizNova();
  const falas: FalaProativa[] = [];
  let relogio = INICIO;
  let hora = 9;

  const montar = () =>
    new MotorProativo({
      idUsuario: 'ana',
      /* Livro NOVO a cada montagem: nada de estado atravessa em memória. */
      livro: new LivroDeOcorrencias(raiz),
      falar: (f) => falas.push(f),
      preferencias: async () => ANA,
      nivel: () => 'sugestao',
      agora: () => relogio,
      hora: () => hora,
    });

  let motor = montar();
  for (let dia = 0; dia < 3; dia += 1) {
    for (const e of diaDe(dia)) {
      relogio = INICIO + dia * DIA_MS + e.hora * HORA_MS;
      hora = e.hora;
      await motor.perceber(e.carga);
    }
    relogio = INICIO + dia * DIA_MS + 19 * HORA_MS;
    hora = 19;
    await motor.observarMensagem('sim, pode investigar');
    await motor.tique();
  }

  const antes = await new LivroDeOcorrencias(raiz).ler('ana');
  const engajouAntes = antes.contadores.engajou;
  const pesoAntes = pesoDe(atencaoDe(antes, 'memoria_uso', relogio));

  /* RESTART: motor novo, livro novo, mesmo diretório. */
  motor = montar();

  const depois = await new LivroDeOcorrencias(raiz).ler('ana');
  assert.equal(depois.contadores.engajou, engajouAntes, 'o aprendizado não sobreviveu ao restart');
  assert.equal(pesoDe(atencaoDe(depois, 'memoria_uso', relogio)), pesoAntes);
  assert.ok(depois.atividade.some((n) => n > 0), 'a rotina observada não sobreviveu');

  /* E continua funcionando depois de voltar. */
  relogio = INICIO + 4 * DIA_MS + 9 * HORA_MS;
  hora = 9;
  const j = await motor.perceber(anomalia('memoria_uso', 'Memória em 97%', 'grave', 'alta'));
  assert.ok(j, 'o motor não voltou a funcionar depois do restart');
});
