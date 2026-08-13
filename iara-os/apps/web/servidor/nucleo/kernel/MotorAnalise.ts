/**
 * MOTOR DE ANÁLISE — onde medição vira diagnóstico, e só ali.
 *
 * O laço que este arquivo implementa é o do §3 da especificação de evolução:
 *
 *   medição → evidências → anomalias → hipóteses → planos → recomendação
 *
 * TRÊS REGRAS GOVERNAM CADA LINHA, e todas as três são o mesmo compromisso do
 * resto do kernel dito em outro domínio:
 *
 *  1. HIPÓTESE SÓ NASCE DE ANOMALIA. Nenhuma explicação é levantada a partir de
 *     uma leitura dentro da faixa. É o que impede a IARA de fazer o que um
 *     humano cansado faz: escolher um culpado e depois procurar o número que o
 *     acusa.
 *
 *  2. A CONFIANÇA NÃO É ESCRITA AQUI. Toda hipótese sai de `criarHipotese`, que
 *     a calcula a partir das evidências. Não existe neste arquivo um lugar onde
 *     alguém digite `confianca: 'alta'`.
 *
 *  3. O QUE NÃO FOI MEDIDO É DITO. Uma sonda que falhou vira `lacuna`, viaja até
 *     o relatório e sai na frase final. Um diagnóstico silencioso sobre a
 *     própria cobertura ensina o operador a confiar em cobertura que não existe.
 *
 * O QUE ELE NÃO FAZ: não mede (é `SondasDesempenho`), não executa (é o catálogo
 * de habilidades), não autoriza (é `PorteiroAutorizacao`) e não decide sozinho
 * agir. Ele produz uma PROPOSTA — e a invariante deste kernel é que a camada que
 * raciocina nunca autoriza.
 */

import type { Medicao, ProcessoMedido } from '../SondasDesempenho';
import { TETO_TENTATIVAS } from './PlanosPropostos';
import {
  anomaliaDominante,
  criarHipotese,
  ehConclusivo,
  ehExecutavelAgora,
  enunciarHipotese,
  ordenarHipoteses,
  recomendar,
  avaliarResultado,
  VERBO_DO_VEREDITO,
  type Anomalia,
  type Diagnostico,
  type Evidencia,
  type Hipotese,
  type PlanoDeAcao,
  type Recomendacao,
  type ResultadoEsperado,
  type Severidade,
  type Veredito,
} from './Investigacao';

// ---------------------------------------------------------------------------
// Faixas — a política de "o que é normal"
// ---------------------------------------------------------------------------

/**
 * Os limiares, num lugar só e exportados.
 *
 * Exportados porque um número mágico enterrado numa comparação é um número que
 * ninguém discute: quando a IARA disser "seu computador está com a memória
 * alta", a pergunta razoável é "alta a partir de quanto?", e a resposta precisa
 * ser um valor que alguém escolheu e que o teste consegue exercer nos dois lados.
 *
 * As faixas são deliberadamente frouxas. Um computador de trabalho passa boa
 * parte do dia com 70% de memória em uso e ninguém chama isso de problema;
 * alarmar ali gasta a atenção do operador, e atenção gasta não volta quando o
 * alarme importa.
 */
export const FAIXAS = {
  cpu: { moderada: 70, grave: 90 },
  memoria: { moderada: 82, grave: 92 },
  /** Disco é ao contrário: o número PEQUENO é o ruim. */
  disco_livre: { moderada: 15, grave: 5 },
  /** Um processo abaixo disto não explica sozinho uma máquina saturada. */
  processo_cpu: 20,
  /** Em MB. Abaixo disto, culpar um processo pela pressão de memória é esticar. */
  processo_memoria: 2048,
  /** Horas ligado a partir das quais reiniciar é uma sugestão razoável. */
  ligado_ha: 24 * 7,
} as const;

const AGORA_CONTEXTUAL = 'contextual' as const;
const AGORA_DIRETA = 'direta' as const;

// ---------------------------------------------------------------------------
// 1. Medição → evidências
// ---------------------------------------------------------------------------

/**
 * Toda medição vira evidência, inclusive a que está normal.
 *
 * A tentação é só registrar o que está fora — e ela custa caro em dois momentos:
 * quando o operador pergunta "e a memória, como está?" (a resposta precisa
 * existir) e quando uma leitura NORMAL é justamente o que enfraquece uma
 * hipótese. Evidência que sustenta e evidência que refuta saem da mesma coleta.
 *
 * `procedencia: 'fato'` para tudo aqui: são leituras de `node:os`, de `statfs` e
 * de uma sonda do sistema operacional — a base determinística da casa, no mesmo
 * sentido em que o relógio do servidor é. Nada nesta função é dedução.
 */
export function evidenciasDe(m: Medicao): Evidencia[] {
  const base = { fonte: 'sonda_desempenho', procedencia: 'fato' as const, instante: m.instante };
  const evidencias: Evidencia[] = [
    { ...base, metrica: 'cpu_total', valor: m.cpu_pct, unidade: '%', relevancia: AGORA_DIRETA },
    { ...base, metrica: 'memoria_uso', valor: m.memoria_pct, unidade: '%', relevancia: AGORA_DIRETA },
    {
      ...base,
      metrica: 'ligado_ha',
      valor: m.ligado_ha_h,
      unidade: 'h',
      relevancia: AGORA_CONTEXTUAL,
    },
  ];

  if (m.disco_livre_pct !== null) {
    evidencias.push({
      ...base,
      metrica: 'disco_livre',
      valor: m.disco_livre_pct,
      unidade: '%',
      relevancia: AGORA_DIRETA,
    });
  }

  const cpu = maiorPorCpu(m);
  if (cpu) {
    evidencias.push({
      ...base,
      metrica: 'processo_cpu',
      valor: `${cpu.nome} (pid ${cpu.pid}) em ${cpu.cpu_pct}% da CPU`,
      unidade: '',
      relevancia: AGORA_DIRETA,
    });
  }

  const memoria = maiorPorMemoria(m);
  if (memoria) {
    evidencias.push({
      ...base,
      metrica: 'processo_memoria',
      valor: `${memoria.nome} (pid ${memoria.pid}) com ${gb(memoria.memoria_mb)} GB`,
      unidade: '',
      relevancia: AGORA_DIRETA,
    });
  }

  return evidencias;
}

function maiorPorCpu(m: Medicao): ProcessoMedido | null {
  if (!m.processos || m.processos.length === 0) return null;
  return [...m.processos].sort((a, b) => b.cpu_pct - a.cpu_pct)[0];
}

function maiorPorMemoria(m: Medicao): ProcessoMedido | null {
  if (!m.processos || m.processos.length === 0) return null;
  return [...m.processos].sort((a, b) => b.memoria_mb - a.memoria_mb)[0];
}

function gb(mb: number): number {
  return Math.round((mb / 1024) * 10) / 10;
}

const achar = (evidencias: readonly Evidencia[], metrica: string): Evidencia | undefined =>
  evidencias.find((e) => e.metrica === metrica);

// ---------------------------------------------------------------------------
// 2. Evidências → anomalias
// ---------------------------------------------------------------------------

function severidadeAcima(valor: number, faixa: { moderada: number; grave: number }): Severidade | null {
  if (valor >= faixa.grave) return 'grave';
  if (valor >= faixa.moderada) return 'moderada';
  return null;
}

function severidadeAbaixo(valor: number, faixa: { moderada: number; grave: number }): Severidade | null {
  if (valor <= faixa.grave) return 'grave';
  if (valor <= faixa.moderada) return 'moderada';
  return null;
}

export function anomaliasDe(evidencias: readonly Evidencia[]): Anomalia[] {
  const anomalias: Anomalia[] = [];

  const cpu = achar(evidencias, 'cpu_total');
  if (cpu && typeof cpu.valor === 'number') {
    const s = severidadeAcima(cpu.valor, FAIXAS.cpu);
    if (s) {
      anomalias.push({
        evidencia: cpu,
        faixa_normal: `abaixo de ${FAIXAS.cpu.moderada}%`,
        severidade: s,
        descricao: `processador em ${cpu.valor}%`,
      });
    }
  }

  const memoria = achar(evidencias, 'memoria_uso');
  if (memoria && typeof memoria.valor === 'number') {
    const s = severidadeAcima(memoria.valor, FAIXAS.memoria);
    if (s) {
      anomalias.push({
        evidencia: memoria,
        faixa_normal: `abaixo de ${FAIXAS.memoria.moderada}%`,
        severidade: s,
        descricao: `memória em ${memoria.valor}%`,
      });
    }
  }

  const disco = achar(evidencias, 'disco_livre');
  if (disco && typeof disco.valor === 'number') {
    const s = severidadeAbaixo(disco.valor, FAIXAS.disco_livre);
    if (s) {
      anomalias.push({
        evidencia: disco,
        faixa_normal: `acima de ${FAIXAS.disco_livre.moderada}% livres`,
        severidade: s,
        descricao: `apenas ${disco.valor}% livres no disco do sistema`,
      });
    }
  }

  return anomalias;
}

// ---------------------------------------------------------------------------
// 3. Anomalias → hipóteses
// ---------------------------------------------------------------------------

/**
 * A parte que é raciocínio de verdade, e é aqui que o §4 se paga.
 *
 * Cada ramo escolhe o enunciado E o conjunto de evidências, e nada mais: a
 * confiança sai de `criarHipotese`. É por isso que "o processo X está deixando a
 * máquina lenta" e "a memória está alta e nenhum processo isolado responde por
 * ela" não podem sair com a mesma segurança mesmo tendo sido escritas na mesma
 * função — a segunda carrega uma evidência CONTRA, e a estrutura rebaixa
 * sozinha.
 */
export function hipotesesDe(
  m: Medicao,
  evidencias: readonly Evidencia[],
  anomalias: readonly Anomalia[],
): Hipotese[] {
  const hipoteses: Hipotese[] = [];
  const temCpu = anomalias.some((a) => a.evidencia.metrica === 'cpu_total');
  const temMemoria = anomalias.some((a) => a.evidencia.metrica === 'memoria_uso');
  const temDisco = anomalias.some((a) => a.evidencia.metrica === 'disco_livre');

  const evCpu = achar(evidencias, 'cpu_total');
  const evMemoria = achar(evidencias, 'memoria_uso');
  const evDisco = achar(evidencias, 'disco_livre');
  const evProcCpu = achar(evidencias, 'processo_cpu');
  const evProcMem = achar(evidencias, 'processo_memoria');

  // --- processador --------------------------------------------------------
  if (temCpu && evCpu) {
    const dominante = maiorPorCpu(m);
    if (dominante && evProcCpu && dominante.cpu_pct >= FAIXAS.processo_cpu) {
      hipoteses.push(
        criarHipotese({
          enunciado: `o processo ${dominante.nome} está contribuindo para a lentidão — ele sozinho responde por ${dominante.cpu_pct}% do processador`,
          sustentada_por: [evCpu, evProcCpu],
        }),
      );
    } else if (evProcCpu) {
      /**
       * Máquina saturada SEM dono. É um resultado, não uma falha da análise: a
       * carga está espalhada, e é isso que precisa ser dito — em vez de eleger o
       * maior da lista e acusá-lo de 9% de CPU.
       */
      hipoteses.push(
        criarHipotese({
          enunciado: `o processador está saturado por vários processos ao mesmo tempo — o maior deles não passa de ${dominante?.cpu_pct ?? 0}%, então não há um culpado único`,
          sustentada_por: [evCpu, evProcCpu],
        }),
      );
    } else {
      /**
       * CPU alta e sem sonda de processos. Uma medição só, e nenhuma forma de
       * apontar quem — `media`, e a lacuna já está declarada na medição.
       */
      hipoteses.push(
        criarHipotese({
          enunciado: 'o processador está sob carga alta, mas não consegui ver quais processos a produzem',
          sustentada_por: [evCpu],
        }),
      );
    }
  }

  // --- memória ------------------------------------------------------------
  if (temMemoria && evMemoria) {
    const dominante = maiorPorMemoria(m);
    if (dominante && evProcMem && dominante.memoria_mb >= FAIXAS.processo_memoria) {
      hipoteses.push(
        criarHipotese({
          enunciado: `o processo ${dominante.nome} está pressionando a memória — ele segura ${gb(dominante.memoria_mb)} GB`,
          sustentada_por: [evMemoria, evProcMem],
        }),
      );
    } else if (evProcMem) {
      /**
       * O CASO QUE JUSTIFICA O CAMPO `enfraquecida_por` EXISTIR.
       *
       * Memória alta e nenhum processo grande é comum, e é o momento em que um
       * diagnóstico automático mente com mais facilidade: ele elege o maior da
       * lista — 400 MB — e o culpa por 93% de uso. A medição do processo é
       * evidência CONTRA a explicação "algum programa está comendo a memória", e
       * carregá-la como contra é o que rebaixa a hipótese sozinha.
       */
      hipoteses.push(
        criarHipotese({
          enunciado:
            'a memória está alta e nenhum processo isolado responde por ela — o consumo pode estar espalhado ou em cache do sistema',
          sustentada_por: [evMemoria],
          enfraquecida_por: [evProcMem],
        }),
      );
    } else {
      hipoteses.push(
        criarHipotese({
          enunciado: 'a memória está alta, mas não consegui ver quais processos a ocupam',
          sustentada_por: [evMemoria],
        }),
      );
    }
  }

  // --- disco --------------------------------------------------------------
  if (temDisco && evDisco) {
    hipoteses.push(
      criarHipotese({
        enunciado:
          'o disco do sistema está quase cheio, e disco cheio deixa o Windows lento porque o arquivo de paginação não tem para onde crescer',
        sustentada_por: [evDisco],
      }),
    );
  }

  return ordenarHipoteses(hipoteses);
}

// ---------------------------------------------------------------------------
// 4. Diagnóstico
// ---------------------------------------------------------------------------

export const PROBLEMA_LENTIDAO = 'lentidão relatada no computador do operador';

export function diagnosticarLentidao(m: Medicao): Diagnostico {
  const evidencias = evidenciasDe(m);
  const anomalias = anomaliasDe(evidencias);
  return {
    problema: PROBLEMA_LENTIDAO,
    evidencias,
    anomalias,
    hipoteses: hipotesesDe(m, evidencias, anomalias),
    lacunas: m.lacunas,
  };
}

// ---------------------------------------------------------------------------
// 5. Planos (§8 e §9)
// ---------------------------------------------------------------------------

const ESPERADO_CPU: ResultadoEsperado = {
  metrica: 'cpu_total',
  comparador: '<',
  valor: FAIXAS.cpu.moderada,
  unidade: '%',
};

const ESPERADO_MEMORIA: ResultadoEsperado = {
  metrica: 'memoria_uso',
  comparador: '<',
  valor: FAIXAS.memoria.moderada,
  unidade: '%',
};

/**
 * As alternativas para o que foi apurado — sempre mais de uma quando há mais de
 * uma, e sempre incluindo a de não fazer nada.
 *
 * "NÃO FAZER NADA AGORA" É UM PLANO, e omiti-lo é a forma mais silenciosa de
 * empurrar o operador para a ação: uma tela com dois botões de agir e nenhum de
 * esperar não está oferecendo escolha. Ele entra com benefício baixo e risco
 * zero, e perde na pontuação sempre que houver algo real a fazer — que é
 * exatamente o comportamento desejado.
 */
/**
 * "A IARA sabe encerrar este programa?" — recebida, não alcançada.
 *
 * A resposta mora na allowlist do `AgenteLocal`, e este módulo NÃO a importa: um
 * `import` daqui até lá seria uma aresta nova para um módulo de EFEITO EXTERNO, e
 * `fronteira-interna.test.ts` (`G3`) derruba a suíte por isso — com razão. Quem
 * pode alcançar o agente é o catálogo, e é o catálogo que passa a função.
 *
 * O PADRÃO É RECUSAR. Sem resolvedor injetado, a análise nunca afirma que
 * consegue fechar coisa nenhuma, e todo plano vira instrução ao operador. É o
 * lado seguro de degradar: prometer uma ação que não se consegue executar é
 * pior que pedir ajuda.
 */
export type PodeFechar = (imagem: string) => { rotulo: string } | null;

const NUNCA_FECHA: PodeFechar = () => null;

export function planosParaLentidao(
  m: Medicao,
  d: Diagnostico,
  podeFechar: PodeFechar = NUNCA_FECHA,
): PlanoDeAcao[] {
  const planos: PlanoDeAcao[] = [];
  const proximo = () => String.fromCharCode(65 + planos.length); // A, B, C...

  const temCpu = d.anomalias.some((a) => a.evidencia.metrica === 'cpu_total');
  const temMemoria = d.anomalias.some((a) => a.evidencia.metrica === 'memoria_uso');
  const temDisco = d.anomalias.some((a) => a.evidencia.metrica === 'disco_livre');

  /**
   * O processo que vale a pena encerrar: o maior de CPU quando a CPU é o
   * problema, o maior de memória quando é a memória. Quando os dois estão fora,
   * a CPU manda — ela é a que o operador SENTE como travamento imediato.
   */
  const alvo = temCpu
    ? maiorPorCpu(m)
    : temMemoria
      ? maiorPorMemoria(m)
      : null;
  const relevante = alvo
    ? temCpu
      ? alvo.cpu_pct >= FAIXAS.processo_cpu
      : alvo.memoria_mb >= FAIXAS.processo_memoria
    : false;

  if (alvo && relevante) {
    const fechavel = podeFechar(alvo.nome);
    const esperado = temCpu ? ESPERADO_CPU : ESPERADO_MEMORIA;

    if (fechavel) {
      const id = proximo();
      planos.push({
        id,
        rotulo: `encerrar o ${fechavel.rotulo}`,
        objetivo: `Devolver ${temCpu ? 'processador' : 'memória'} encerrando o maior consumidor`,
        passos: [
          {
            ordem: 1,
            descricao: `Fechar o ${fechavel.rotulo}`,
            habilidade: 'fechar_aplicativo',
            parametros: { aplicativo: fechavel.rotulo },
            reversivel: true,
            quando: 'agora',
          },
          {
            /**
             * O ÚNICO passo de medição que roda no mesmo turno, e pode: fechar
             * um aplicativo tem efeito imediato e observável. O de reiniciar não
             * pode, e o de instrução ao operador também não — ver `quando`.
             */
            ordem: 2,
            descricao: 'Medir de novo e comparar com o estado de agora',
            habilidade: 'investigar_lentidao',
            parametros: {},
            reversivel: true,
            quando: 'agora',
          },
        ],
        risco: 'medio',
        esforco: 'baixo',
        beneficio: 'alto',
        resultado_esperado: esperado,
        rollback: `abrir o ${fechavel.rotulo} de novo — nada do que estava salvo se perde`,
      });
    } else {
      /**
       * O ramo HONESTO, e o que mais importa deste arquivo inteiro.
       *
       * `fechar_aplicativo` só alcança a allowlist do `AgenteLocal`. Quando o
       * maior consumidor está fora dela, a IARA NÃO tem como agir — e o certo é
       * dizer isso e transformar o passo em instrução, não inventar um plano que
       * vai falhar na execução. Um plano que a IARA não consegue executar,
       * oferecido como se conseguisse, é a mentira operacional deste kernel
       * vestida de proatividade.
       */
      const id = proximo();
      planos.push({
        id,
        rotulo: `você encerra o ${alvo.nome}, eu meço de novo`,
        objetivo: `Devolver ${temCpu ? 'processador' : 'memória'} encerrando o maior consumidor`,
        passos: [
          {
            ordem: 1,
            descricao: `Você fecha o ${alvo.nome} (pid ${alvo.pid}) — não tenho autorização para encerrar esse programa`,
            habilidade: null,
            parametros: {},
            reversivel: true,
            quando: 'quando_o_operador_voltar',
          },
          {
            ordem: 2,
            descricao: 'Eu meço de novo e comparo com o estado de agora',
            habilidade: 'investigar_lentidao',
            parametros: {},
            reversivel: true,
            quando: 'quando_o_operador_voltar',
          },
        ],
        risco: 'baixo',
        esforco: 'baixo',
        beneficio: 'alto',
        resultado_esperado: esperado,
        rollback: `abrir o ${alvo.nome} de novo`,
      });
    }
  }

  if (temDisco) {
    const id = proximo();
    planos.push({
      id,
      rotulo: 'liberar espaço em disco',
      objetivo: 'Devolver folga ao disco do sistema',
      passos: [
        {
          ordem: 1,
          descricao:
            'Você roda a Limpeza de Disco do Windows ou esvazia a Lixeira — ainda não tenho ferramenta para localizar e apagar arquivos por conta própria',
          habilidade: null,
          parametros: {},
          reversivel: false,
          quando: 'quando_o_operador_voltar',
        },
        {
          ordem: 2,
          descricao: 'Eu meço de novo e comparo',
          habilidade: 'investigar_lentidao',
          parametros: {},
          reversivel: true,
          quando: 'quando_o_operador_voltar',
        },
      ],
      risco: 'baixo',
      esforco: 'medio',
      beneficio: temDisco && !temCpu && !temMemoria ? 'alto' : 'medio',
      resultado_esperado: {
        metrica: 'disco_livre',
        comparador: '>',
        valor: FAIXAS.disco_livre.moderada,
        unidade: '%',
      },
      rollback: null,
    });
  }

  /**
   * Reiniciar só entra quando há razão MEDIDA para propô-lo: memória alta ou
   * muito tempo ligado. Oferecer "já tentou reiniciar?" para toda queixa é o
   * conselho que fez o suporte técnico virar piada — e aqui seria pior, porque
   * viria de quem acabou de medir a máquina e portanto sabe mais do que isso.
   */
  if (temMemoria || m.ligado_ha_h >= FAIXAS.ligado_ha) {
    const id = proximo();
    planos.push({
      id,
      rotulo: 'reiniciar o computador',
      objetivo: 'Devolver memória presa e zerar o estado acumulado do sistema',
      passos: [
        {
          ordem: 1,
          descricao: 'Reiniciar o computador (peço sua confirmação explícita antes)',
          habilidade: 'acionar_energia',
          parametros: { acao: 'reiniciar' },
          reversivel: false,
          quando: 'agora',
        },
        {
          /**
           * `quando_o_operador_voltar`, e é o caso que deu origem ao campo:
           * medir logo depois de PEDIR o reinício mediria a máquina que ainda
           * não reiniciou, e produziria um "não resolveu" sobre uma ação que
           * nem começou.
           */
          ordem: 2,
          descricao: 'Medir de novo depois que você voltar',
          habilidade: 'investigar_lentidao',
          parametros: {},
          reversivel: true,
          quando: 'quando_o_operador_voltar',
        },
      ],
      risco: 'alto',
      esforco: 'medio',
      beneficio: 'alto',
      resultado_esperado: ESPERADO_MEMORIA,
      rollback: null,
    });
  }

  const id = proximo();
  planos.push({
    id,
    rotulo: 'não fazer nada agora e observar',
    objetivo: 'Guardar esta medição como referência e comparar quando você pedir de novo',
    passos: [
      {
        ordem: 1,
        descricao: 'Eu guardo os números de agora',
        habilidade: null,
        parametros: {},
        reversivel: true,
        quando: 'quando_o_operador_voltar',
      },
      {
        ordem: 2,
        descricao: 'Quando você disser "meça de novo", eu comparo e digo o que mudou',
        habilidade: 'investigar_lentidao',
        parametros: {},
        reversivel: true,
        quando: 'quando_o_operador_voltar',
      },
    ],
    risco: 'baixo',
    esforco: 'baixo',
    beneficio: 'baixo',
    resultado_esperado: null,
    rollback: null,
  });

  return planos;
}

// ---------------------------------------------------------------------------
// 6. A investigação inteira
// ---------------------------------------------------------------------------

export interface Investigacao {
  readonly diagnostico: Diagnostico;
  readonly medicao: Medicao;
  readonly planos: readonly PlanoDeAcao[];
  /** `null` quando não há anomalia — não há o que recomendar sobre nada. */
  readonly recomendacao: Recomendacao | null;
  /**
   * O confronto com a investigação ANTERIOR desta mesma máquina, quando existe.
   * É o §14 fechando o laço: o que se esperava contra o que se mediu.
   */
  readonly veredito: ConfrontoAnterior | null;
  /**
   * A IARA já tentou o bastante sem resolver, e para de propor.
   *
   * O §15 pede autocorreção E proíbe laço infinito, e este booleano é a segunda
   * metade. Três planos medidos sem sucesso não são má sorte: são sinal de que a
   * causa está fora do que estas sondas alcançam. Continuar oferecendo a próxima
   * alternativa seria teatro de diligência — e o operador merece ouvir que a
   * IARA chegou ao fim do que sabe medir.
   */
  readonly esgotado: boolean;
  /**
   * O que já se tentou para esta MESMA situação, em outras ocasiões (§26). Vazio
   * na primeira vez — que é o caso normal.
   *
   * Sai como `memoria` no vocabulário de `Verdade.ts`, e a redação o mantém
   * SEPARADO do que foi medido agora: que o plano A tenha resolvido em julho não
   * é evidência sobre a máquina de hoje.
   */
  readonly historico: string;
}

export interface ConfrontoAnterior {
  readonly veredito: Veredito;
  readonly metrica: string;
  readonly antes: number;
  readonly depois: number;
  readonly unidade: string;
  /** O que se esperava, em texto: "abaixo de 70%". */
  readonly esperado: string;
  /**
   * O plano que o operador AUTORIZOU antes desta medição, se autorizou. É o que
   * permite a resposta dizer "o plano A não resolveu" em vez do genérico "não
   * melhorou" — e é a diferença entre relatar um número e fechar um ciclo.
   */
  readonly plano_tentado: string | null;
  readonly rotulo_tentado: string | null;
}

/**
 * O estado da investigação ANTERIOR, para o confronto do §14.
 *
 * `esperado` vem do plano AUTORIZADO quando há um — ver `PlanosPropostos.
 * referencia`. Quando vem do recomendado, é palpite declarado: a IARA está
 * conferindo a expectativa do plano que ELA sugeriu, não necessariamente o que o
 * operador seguiu.
 */
export interface Anterior {
  readonly medicao: Medicao;
  readonly esperado: ResultadoEsperado | null;
  readonly plano_tentado?: string | null;
  readonly rotulo_tentado?: string | null;
  readonly tentativas_sem_sucesso?: number;
}

/**
 * Compara esta medição com a anterior, à luz do que o plano recomendado prometia.
 *
 * `null` quando não houve investigação anterior, quando o plano anterior não
 * declarou expectativa, ou quando a métrica esperada não pôde ser medida agora —
 * e essa última é a que não pode virar sucesso por omissão: `avaliarResultado`
 * devolve `nao_verificavel`, e o relatório diz isso com todas as letras.
 */
export function confrontar(anterior: Anterior | null, agora: Medicao): ConfrontoAnterior | null {
  if (!anterior?.esperado) return null;
  const { esperado } = anterior;

  const ler = (m: Medicao): number | null => {
    switch (esperado.metrica) {
      case 'cpu_total':
        return m.cpu_pct;
      case 'memoria_uso':
        return m.memoria_pct;
      case 'disco_livre':
        return m.disco_livre_pct;
      default:
        return null;
    }
  };

  const antes = ler(anterior.medicao);
  const depois = ler(agora);
  if (antes === null) return null;

  return {
    veredito: avaliarResultado(esperado, depois, antes),
    metrica: esperado.metrica,
    antes,
    depois: depois ?? antes,
    unidade: esperado.unidade,
    esperado: `${esperado.comparador === '<' || esperado.comparador === '<=' ? 'abaixo de' : 'acima de'} ${esperado.valor}${esperado.unidade}`,
    plano_tentado: anterior.plano_tentado ?? null,
    rotulo_tentado: anterior.rotulo_tentado ?? null,
  };
}

/**
 * O que a memória de soluções tem a dizer sobre esta situação — injetado, não
 * alcançado, pela mesma razão de `PodeFechar`: o motor de análise é puro, e a
 * memória é estado do processo. Ausente, a investigação simplesmente não
 * consulta histórico, que é o que acontece na primeira vez.
 */
export interface Historico {
  /** O relato para a resposta, já formatado. Vazio quando não há o que contar. */
  readonly relato: string;
  /** O rótulo que desempata entre planos de mesma pontuação. */
  readonly preferido: string | null;
}

export function investigarLentidao(
  medicao: Medicao,
  anterior: Anterior | null = null,
  podeFechar?: PodeFechar,
  historico: Historico | null = null,
): Investigacao {
  const diagnostico = diagnosticarLentidao(medicao);
  const planos = planosParaLentidao(medicao, diagnostico, podeFechar);
  const esgotado = (anterior?.tentativas_sem_sucesso ?? 0) >= TETO_TENTATIVAS;

  /**
   * Sem anomalia não há recomendação — e a lista de planos, nesse caso, tem só
   * o de observar. Recomendar "observe" como se fosse uma escolha entre
   * alternativas daria à frase um peso que ela não tem.
   *
   * Esgotada a linha de investigação, também não há: insistir com a quarta
   * alternativa depois de três medidas sem sucesso é propor por hábito.
   */
  const recomendacao =
    diagnostico.anomalias.length > 0 && !esgotado
      ? recomendar(planos, historico?.preferido ?? null)
      : null;

  return {
    diagnostico,
    medicao,
    planos,
    recomendacao,
    veredito: confrontar(anterior, medicao),
    esgotado,
    historico: historico?.relato ?? '',
  };
}

// ---------------------------------------------------------------------------
// 7. Redação
// ---------------------------------------------------------------------------

const ROTULO_METRICA: Record<string, string> = {
  cpu_total: 'processador',
  memoria_uso: 'memória',
  disco_livre: 'espaço livre em disco',
  ligado_ha: 'ligado há',
  processo_cpu: 'maior consumidor de processador',
  processo_memoria: 'maior consumidor de memória',
};

/**
 * O relatório, em texto — função pura, mesmo desenho de `contextoDeConflitos`.
 *
 * A ORDEM DAS SEÇÕES É A ORDEM DO §17, e ela não é estética: fato antes de
 * hipótese, hipótese antes de recomendação, recomendação antes do pedido de
 * autorização. Quem lê precisa ter visto a evidência antes de ler a conclusão,
 * senão a conclusão vira a coisa que se lembra e a evidência vira decoração.
 *
 * A ÚLTIMA LINHA É SEMPRE UMA PERGUNTA quando há o que fazer. A IARA propõe e
 * para; ela não executa plano por ter achado bom.
 */
export function redigirInvestigacao(inv: Investigacao): string {
  const { diagnostico: d, medicao: m } = inv;
  const linhas: string[] = [];

  if (inv.veredito) {
    const v = inv.veredito;
    const sinal = v.depois === v.antes ? 'continua em' : `foi de ${v.antes} para`;
    /**
     * QUEM foi tentado, quando se sabe. "O plano A não resolveu" fecha um ciclo;
     * "não melhorou" só relata um número. A diferença é o que transforma a
     * segunda medição em aprendizado em vez de repetição.
     */
    const oQue = v.plano_tentado
      ? `O plano ${v.plano_tentado} (${v.rotulo_tentado}) ${VERBO_DO_VEREDITO[v.veredito]}`
      : `Comparando com a última medição: ${VERBO_DO_VEREDITO[v.veredito]}`;
    linhas.push(
      `${oQue}. ${ROTULO_METRICA[v.metrica] ?? v.metrica} ${sinal} ${v.depois}${v.unidade} ` +
        `(eu esperava ${v.esperado}).`,
      '',
    );
  }

  linhas.push('O que eu MEDI agora:');
  for (const e of d.evidencias) {
    const rotulo = ROTULO_METRICA[e.metrica] ?? e.metrica;
    linhas.push(`  • ${rotulo}: ${e.valor}${e.unidade}`);
  }

  if (d.lacunas.length > 0) {
    linhas.push('', 'O que eu NÃO consegui medir:');
    for (const l of d.lacunas) linhas.push(`  • ${l}`);
  }

  if (d.anomalias.length === 0) {
    linhas.push(
      '',
      'Nenhuma das medições que eu sei fazer está fora da faixa normal. Isso não quer ' +
        'dizer que está tudo bem — quer dizer que a lentidão que você sente não aparece ' +
        'nos números que eu alcanço. Me diga o que está lento (abrir programa, navegar, ' +
        'salvar arquivo) que eu procuro em outro lugar.',
    );
    return linhas.join('\n');
  }

  linhas.push('', 'O que está FORA da faixa:');
  for (const a of d.anomalias) {
    linhas.push(`  • ${a.descricao} — o normal seria ${a.faixa_normal} (${a.severidade})`);
  }

  if (d.hipoteses.length > 0) {
    linhas.push('', 'O que eu ACHO que explica — e não é a mesma coisa que o de cima:');
    for (const h of d.hipoteses) {
      linhas.push(`  • ${enunciarHipotese(h)}.`);
    }
    if (!ehConclusivo(d)) {
      linhas.push(
        '  Nenhuma dessas hipóteses tem sustentação forte o bastante para eu tratar como causa.',
      );
    }
  }

  /**
   * O FIM DA LINHA (§15). Depois de `TETO_TENTATIVAS` planos medidos sem
   * sucesso, a IARA para de oferecer alternativas e devolve a palavra — dizendo
   * exatamente o que sabe e o que não alcança. É mais útil que a quarta
   * sugestão, e é a única saída honesta de um laço que não está convergindo.
   */
  if (inv.esgotado) {
    linhas.push(
      '',
      `Já tentamos ${TETO_TENTATIVAS} caminhos e o número não cedeu. Não vou ficar propondo ` +
        'alternativas: isso me diz que a causa está fora do que estas sondas alcançam — ' +
        'driver, disco com defeito, antivírus, ou algo que só aparece enquanto você usa. ' +
        'Me conte o que exatamente fica lento e em que momento, que eu procuro por outro lado.',
    );
    return linhas.join('\n');
  }

  /**
   * O HISTÓRICO ENTRA DEPOIS DAS HIPÓTESES E ANTES DOS PLANOS, e a posição é a
   * mesma disciplina do resto: ele não é medição (não pode ficar junto do que
   * foi medido agora) e não é conclusão (não pode virar hipótese). É contexto que
   * ajuda a escolher — e por isso fica encostado na lista de alternativas.
   */
  if (inv.historico) {
    linhas.push('', inv.historico);
  }

  if (inv.planos.length > 0) {
    linhas.push('', 'O que dá para fazer:');
    for (const p of inv.planos) {
      const desfaz = p.rollback ? `; para desfazer: ${p.rollback}` : '';
      linhas.push(
        `  ${p.id}) ${p.rotulo} — benefício ${p.beneficio}, risco ${p.risco}, esforço ${p.esforco}${desfaz}`,
      );
    }
  }

  if (inv.recomendacao) {
    const escolhido = inv.recomendacao.escolhido;
    linhas.push('', inv.recomendacao.justificativa);
    linhas.push(
      `Passos: ${escolhido.passos.map((s) => `${s.ordem}. ${s.descricao}`).join('  ')}`,
    );
    /**
     * A ÚLTIMA LINHA MUDA COM QUEM AGE, e precisa mudar: pedir autorização para
     * um plano que a IARA não executa é pedir permissão para não fazer nada. Um
     * plano de instrução termina devolvendo a vez ao operador; só o executável
     * termina em pergunta.
     */
    linhas.push(
      '',
      ehExecutavelAgora(escolhido)
        ? `Posso executar o plano ${escolhido.id}? Responda "executar o plano ${escolhido.id}" que eu faço e meço de novo.`
        : `Esse plano depende de você — eu não alcanço esse programa. Quando tiver feito, ` +
            `me diga "meça de novo" que eu comparo com os números de agora.`,
    );
  }

  // Uma máquina ligada há muito tempo é contexto, não causa — e sai como
  // contexto, no fim, sem virar hipótese. Ver o comentário de `planosParaLentidao`.
  if (m.ligado_ha_h >= FAIXAS.ligado_ha) {
    linhas.push(
      '',
      `Para contexto: este computador está ligado há ${Math.round(m.ligado_ha_h / 24)} dias sem reiniciar.`,
    );
  }

  return linhas.join('\n');
}

/** Reexportado para quem só quer a anomalia que mais pesa, sem importar dois módulos. */
export { anomaliaDominante };
