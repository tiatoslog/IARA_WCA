/**
 * INTERRUPÇÃO — quando NÃO falar, mesmo tendo o que dizer.
 *
 * Esta é a metade que protege, e ela é separada da decisão de propósito. A
 * `DecisaoProativa` responde *"isto merece ser levado à pessoa?"*; esta responde
 * *"agora?"*. Juntar as duas produz o defeito clássico do alarme: um evento
 * legítimo é rebaixado para `ignorar` porque chegou às 3h da manhã, e ninguém
 * nunca fica sabendo que ele existiu.
 *
 * Aqui nada é descartado. Uma interrupção barrada vira RESUMO — o fato continua
 * no livro, com o motivo da supressão registrado, e sai no próximo momento
 * apropriado. É a diferença entre "não te acordei" e "não te contei".
 *
 * ---------------------------------------------------------------------------
 * AS QUATRO BARREIRAS, EM ORDEM, E O MODO DE FALHA DE CADA UMA
 * ---------------------------------------------------------------------------
 *
 * 1. HORA. Fora da janela em que a pessoa trabalha, só passa o que é grave E de
 *    confiança alta. O modo de falha sem isto é acordar alguém com uma suspeita.
 *
 * 2. CARÊNCIA POR ASSUNTO. Um mesmo assunto não volta antes do prazo. Sem isto,
 *    uma métrica que oscila em volta do limiar produz um aviso por leitura — e
 *    um alerta ignorado é pior que nenhum, porque dá a impressão de cobertura.
 *    É a mesma trava que o `Vigia` já tinha; aqui ela ganha persistência e passa
 *    a valer para todos os detectores, não só para ele.
 *
 * 3. CARÊNCIA GLOBAL. Duas interrupções em sequência, sobre assuntos diferentes,
 *    ainda são duas interrupções. Sem isto, cinco detectores independentes,
 *    todos bem comportados, somam um comportamento mal comportado.
 *
 * 4. TETO DIÁRIO. O último recurso. Se em um dia a IARA já falou seis vezes sem
 *    ser chamada, ou o dia está muito ruim ou a política está errada — e nas
 *    duas leituras a resposta certa é parar de falar e juntar o resto num
 *    resumo.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A JANELA DE SILÊNCIO É OBSERVADA, E NÃO CONFIGURADA
 * ---------------------------------------------------------------------------
 *
 * A ficha do operador (`lib/perfil.ts`) não tem campo de horário, e inventar um
 * exigiria tela, saneador e migração — três superfícies para uma informação que
 * a IARA já tem em mãos: **quando esta pessoa de fato fala com ela**. O
 * histograma de atividade por hora é evidência direta, custa um contador por
 * mensagem, e é personalizado desde o primeiro dia sem ninguém preencher nada.
 *
 * O padrão noturno (22h–6h) existe porque o histograma começa vazio, e um
 * histograma vazio não pode significar "silencie tudo" — isso calaria a IARA
 * exatamente no período em que ela ainda não conhece ninguém. Ele vale sempre;
 * o histograma só ACRESCENTA horas de silêncio, nunca remove as noturnas.
 */

import type { Confianca, Severidade } from '../kernel/Investigacao';

/** Uma casa por hora do dia local. Índice = hora. */
export type AtividadePorHora = readonly number[];

export const HORAS = 24;

/** Histograma zerado. Toda leitura de livro antigo cai aqui. */
export function atividadeVazia(): number[] {
  return new Array<number>(HORAS).fill(0);
}

/**
 * A janela noturna que vale mesmo sem nenhuma evidência. Fim exclusivo: 22, 23,
 * 0, 1, 2, 3, 4, 5 são silêncio; 6 já não é.
 */
export const NOITE_INICIO = 22;
export const NOITE_FIM = 6;

/**
 * Quantas mensagens o histograma precisa ter antes de poder calar uma hora por
 * conta própria.
 *
 * Baixo demais e a IARA silencia a manhã de terça porque a pessoa só usou o
 * sistema à tarde na segunda. Este número é o que separa "aprendi a rotina dela"
 * de "vi um dia e generalizei".
 */
export const AMOSTRAS_PARA_CONFIAR = 40;

/** Meia hora — o mesmo prazo que o `Vigia` já usava, agora por operador. */
export const CARENCIA_ASSUNTO_MS = 30 * 60 * 1000;

/** Dez minutos entre duas falas não pedidas, sejam do assunto que forem. */
export const CARENCIA_GLOBAL_MS = 10 * 60 * 1000;

export const TETO_DIARIO = 6;
const DIA_MS = 24 * 60 * 60 * 1000;

export type MotivoSupressao =
  | 'fora_de_hora'
  | 'carencia_do_assunto'
  | 'interrupcao_recente'
  | 'teto_diario';

export type VeredictoInterrupcao =
  | { readonly permitido: true }
  | { readonly permitido: false; readonly motivo: MotivoSupressao };

const PERMITIDO: VeredictoInterrupcao = { permitido: true };

/**
 * Esta hora é de silêncio para esta pessoa?
 *
 * `hora` é a hora LOCAL do relógio do motor. É uma aproximação declarada: a IARA
 * roda num processo só, e o operador remoto num fuso diferente teria a janela do
 * servidor, não a dele. Enquanto todos os operadores estão na mesma operação —
 * que é o caso — a aproximação é exata; no dia em que não for, o conserto é um
 * campo de fuso na ficha, não uma reescrita desta função.
 */
export function horaSilenciosa(
  hora: number,
  atividade: AtividadePorHora = atividadeVazia(),
): boolean {
  if (hora >= NOITE_INICIO || hora < NOITE_FIM) return true;

  const total = atividade.reduce((s, n) => s + n, 0);
  if (total < AMOSTRAS_PARA_CONFIAR) return false;

  /* Zero mensagens NESTA hora, com histórico suficiente para a ausência
     significar alguma coisa: a pessoa não está aqui a esta hora. */
  return (atividade[hora] ?? 0) === 0;
}

export interface EstadoInterrupcao {
  /** Instantes das últimas falas não pedidas. Só as do último dia importam. */
  readonly interrupcoes: readonly number[];
  /** assunto → instante da última fala sobre ele. */
  readonly carencia: Readonly<Record<string, number>>;
  readonly atividade: AtividadePorHora;
}

export function podeInterromper(entrada: {
  readonly assunto: string;
  readonly severidade: Severidade;
  readonly confianca: Confianca;
  readonly agora: number;
  readonly estado: EstadoInterrupcao;
  /** Injetável para o teste poder pôr 3h da manhã sem esperar até lá. */
  readonly hora?: number;
}): VeredictoInterrupcao {
  const { assunto, severidade, confianca, agora, estado } = entrada;
  const hora = entrada.hora ?? new Date(agora).getHours();

  /**
   * A EMERGÊNCIA FURA A NOITE — e só ela.
   *
   * `grave` E `alta` juntas, nunca uma só. Uma suspeita grave (confiança baixa)
   * às 3h é exatamente o alarme falso que faz alguém desligar o sistema; um fato
   * leve de confiança alta às 3h não vale o sono de ninguém. A conjunção é o
   * ponto: para acordar alguém é preciso ter certeza E que importe.
   */
  const emergencia = severidade === 'grave' && confianca === 'alta';

  if (!emergencia && horaSilenciosa(hora, estado.atividade)) {
    return { permitido: false, motivo: 'fora_de_hora' };
  }

  const ultimaDoAssunto = estado.carencia[assunto];
  if (ultimaDoAssunto !== undefined && agora - ultimaDoAssunto < CARENCIA_ASSUNTO_MS) {
    return { permitido: false, motivo: 'carencia_do_assunto' };
  }

  const recentes = estado.interrupcoes.filter((t) => agora - t < DIA_MS);

  const ultima = recentes.length > 0 ? Math.max(...recentes) : null;
  if (ultima !== null && agora - ultima < CARENCIA_GLOBAL_MS) {
    /**
     * A EMERGÊNCIA NÃO FURA ESTA. É deliberado e vale explicar: a carência
     * global existe justamente para o caso em que tudo está pegando fogo e cinco
     * detectores graves disparam ao mesmo tempo. Se a emergência furasse aqui,
     * a barreira desapareceria exatamente no momento para o qual foi feita —
     * cinco alertas graves em dois segundos são um alerta e quatro ruídos.
     */
    return { permitido: false, motivo: 'interrupcao_recente' };
  }

  if (recentes.length >= TETO_DIARIO) {
    return { permitido: false, motivo: 'teto_diario' };
  }

  return PERMITIDO;
}

/** Registra que a interrupção aconteceu. Puro: devolve o estado novo. */
export function registrarInterrupcao(
  estado: EstadoInterrupcao,
  assunto: string,
  agora: number,
): EstadoInterrupcao {
  const recentes = estado.interrupcoes.filter((t) => agora - t < DIA_MS);
  return {
    interrupcoes: [...recentes, agora],
    carencia: { ...estado.carencia, [assunto]: agora },
    atividade: estado.atividade,
  };
}

/** Uma mensagem do operador, contada na hora em que chegou. */
export function registrarAtividade(atividade: AtividadePorHora, hora: number): number[] {
  const nova = [...atividade];
  while (nova.length < HORAS) nova.push(0);
  nova[hora] = (nova[hora] ?? 0) + 1;
  return nova.slice(0, HORAS);
}
