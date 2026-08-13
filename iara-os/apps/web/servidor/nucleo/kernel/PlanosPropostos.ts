/**
 * O QUE A IARA PROPÔS, e o que o operador autorizou disso.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE, e que a Fase 1 deixou em aberto: a IARA
 * terminava a investigação com "posso executar o plano A?" e não tinha onde
 * guardar a resposta. Um assistente que faz uma pergunta que não sabe receber
 * está encenando uma conversa.
 *
 * ELE TAMBÉM PAGA UM DÉBITO DECLARADO. Na Fase 1, o confronto do §14 comparava
 * a medição nova com a expectativa do plano RECOMENDADO — e o operador pode ter
 * seguido outro. Aqui a expectativa passa a vir do plano AUTORIZADO, quando há
 * um; a do recomendado vira só o palpite de fallback, para o caso de o operador
 * ter agido sem dizer qual plano seguiu.
 *
 * O QUE ELE NÃO É: um jornal. `RegistroOperacoes` continua sendo a trilha
 * persistida dos EFEITOS, com prova e nonce. Isto é memória de conversa — o que
 * está em cima da mesa agora — e é volátil de propósito, pelo mesmo motivo que
 * as pendências de energia do `AgenteLocal` são: uma proposta é sobre um estado
 * do mundo que já mudou quando o processo reinicia.
 *
 * O QUE ELE NÃO FAZ: autorizar. Ele REGISTRA que o operador autorizou. Quem
 * decide se um passo de risco alto pode rodar continua sendo o
 * `PorteiroAutorizacao`, no caminho do Kernel, e nada aqui o contorna — os
 * passos de um plano autorizado passam pelas mesmas portas de qualquer outro
 * plano determinístico.
 */

import type { Medicao } from '../SondasDesempenho';
import type { PlanoDeAcao, ResultadoEsperado } from './Investigacao';

/**
 * Quanto tempo uma proposta continua de pé.
 *
 * NÃO é generosidade nem impaciência: é o prazo de validade da MEDIÇÃO que a
 * sustenta. Autorizar às 15h um plano montado sobre os números das 11h faria a
 * IARA fechar o programa que era o maior consumidor quatro horas atrás e depois
 * comparar o resultado com um "antes" que não existe mais. Vencida a proposta, a
 * conduta certa é medir de novo — e é isso que ela diz.
 */
export const VALIDADE_MS = 20 * 60 * 1000;

/**
 * Quantos planos malsucedidos antes de a IARA parar de propor.
 *
 * O §15 pede autocorreção e proíbe laço infinito, e as duas coisas moram neste
 * número. Três tentativas medidas sem resolver não são má sorte: são sinal de
 * que a causa está fora do que estas sondas alcançam, e insistir com a quarta
 * alternativa é teatro de diligência.
 */
export const TETO_TENTATIVAS = 3;

export interface Proposta {
  readonly id_usuario: string;
  readonly sessao: string;
  readonly planos: readonly PlanoDeAcao[];
  /** Id do plano recomendado. `null` quando não havia anomalia a recomendar. */
  readonly recomendado: string | null;
  /** O estado do mundo sobre o qual estes planos foram montados. */
  readonly medicao: Medicao;
  readonly proposta_em: number;
  /** Id do plano que o operador autorizou. `null` enquanto ele não respondeu. */
  readonly autorizado: string | null;
  /**
   * Quantos planos já foram tentados e NÃO resolveram, nesta linha de
   * investigação. Sobrevive de uma proposta para a seguinte — senão cada nova
   * medição zeraria a conta e o teto nunca seria alcançado.
   */
  readonly tentativas_sem_sucesso: number;
}

export type MotivoIndisponivel = 'nenhuma' | 'vencida' | 'outra_conversa' | 'plano_desconhecido';

export class PlanosPropostos {
  private readonly porOperador = new Map<string, Proposta>();

  constructor(private readonly agora: () => number = () => Date.now()) {}

  /**
   * Registra o que a IARA acabou de propor, substituindo a proposta anterior.
   *
   * SUBSTITUIR É O CERTO: uma investigação nova mede o mundo de novo, e os planos
   * velhos falam de um estado que não vale mais. O que sobrevive à substituição é
   * só a contagem de tentativas — ela é sobre a linha de investigação, não sobre
   * uma medição.
   */
  propor(entrada: {
    id_usuario: string;
    sessao: string;
    planos: readonly PlanoDeAcao[];
    recomendado: string | null;
    medicao: Medicao;
    /** Somar 1 quando a proposta anterior foi tentada e não resolveu. */
    tentativa_falhou?: boolean;
  }): void {
    const anterior = this.porOperador.get(entrada.id_usuario);
    const acumuladas = anterior?.tentativas_sem_sucesso ?? 0;

    this.porOperador.set(entrada.id_usuario, {
      id_usuario: entrada.id_usuario,
      sessao: entrada.sessao,
      planos: entrada.planos,
      recomendado: entrada.recomendado,
      medicao: entrada.medicao,
      proposta_em: this.agora(),
      autorizado: null,
      tentativas_sem_sucesso: entrada.tentativa_falhou ? acumuladas + 1 : acumuladas,
    });
  }

  /** A proposta viva desta conversa, ou `null`. Não mexe em nada. */
  aberta(idUsuario: string, sessao: string): Proposta | null {
    const p = this.porOperador.get(idUsuario);
    if (!p) return null;
    if (this.agora() - p.proposta_em > VALIDADE_MS) return null;
    /**
     * MESMA CONVERSA, pela mesma razão da pendência de energia: uma proposta
     * feita noutro diálogo não pode ser autorizada por um "pode executar" solto
     * aqui. O operador é o mesmo; o contexto do que ele está respondendo, não.
     */
    if (p.sessao !== sessao) return null;
    return p;
  }

  /** A proposta, ou por que não há uma — para a IARA poder DIZER qual dos casos é. */
  porQueNaoHa(idUsuario: string, sessao: string): MotivoIndisponivel {
    const p = this.porOperador.get(idUsuario);
    if (!p) return 'nenhuma';
    if (this.agora() - p.proposta_em > VALIDADE_MS) return 'vencida';
    if (p.sessao !== sessao) return 'outra_conversa';
    return 'nenhuma';
  }

  /**
   * Qual plano o operador quis. Sem letra, o RECOMENDADO — que é o que a
   * pergunta "posso executar o plano A?" torna natural responder com um "pode".
   */
  escolher(idUsuario: string, sessao: string, letra?: string): PlanoDeAcao | null {
    const proposta = this.aberta(idUsuario, sessao);
    if (!proposta) return null;
    const alvo = (letra ?? proposta.recomendado ?? '').toUpperCase();
    if (!alvo) return null;
    return proposta.planos.find((p) => p.id.toUpperCase() === alvo) ?? null;
  }

  /**
   * Marca que o operador autorizou este plano. Devolve `false` quando não havia
   * proposta viva — e quem chamou precisa tratar isso dizendo a verdade, nunca
   * seguindo em frente.
   */
  autorizar(idUsuario: string, sessao: string, idPlano: string): boolean {
    const proposta = this.aberta(idUsuario, sessao);
    if (!proposta) return false;
    if (!proposta.planos.some((p) => p.id === idPlano)) return false;
    this.porOperador.set(idUsuario, { ...proposta, autorizado: idPlano });
    return true;
  }

  /** O plano autorizado desta proposta, se houver. */
  planoAutorizado(idUsuario: string): PlanoDeAcao | null {
    const p = this.porOperador.get(idUsuario);
    if (!p?.autorizado) return null;
    return p.planos.find((x) => x.id === p.autorizado) ?? null;
  }

  /**
   * A referência para o confronto do §14: contra o que a próxima medição será
   * comparada.
   *
   * A ORDEM DE PREFERÊNCIA É O DÉBITO PAGO. O plano AUTORIZADO manda: é o que o
   * operador de fato escolheu seguir. Só na ausência dele — operador que agiu
   * sem dizer qual plano seguiu — se usa a expectativa do recomendado, e aí é
   * declaradamente um palpite.
   *
   * Note que a proposta VENCIDA ainda serve de referência, e é de propósito:
   * comparar com uma medição velha é útil (`de 88% para 31%`) mesmo quando
   * autorizar um plano velho não seria seguro. São perguntas diferentes.
   */
  referencia(idUsuario: string): {
    medicao: Medicao;
    esperado: ResultadoEsperado | null;
    plano_tentado: string | null;
    rotulo_tentado: string | null;
    tentativas_sem_sucesso: number;
  } | null {
    const p = this.porOperador.get(idUsuario);
    if (!p) return null;

    const autorizado = p.autorizado ? p.planos.find((x) => x.id === p.autorizado) : undefined;
    const recomendado = p.recomendado ? p.planos.find((x) => x.id === p.recomendado) : undefined;
    const base = autorizado ?? recomendado;

    return {
      medicao: p.medicao,
      esperado: base?.resultado_esperado ?? null,
      plano_tentado: autorizado?.id ?? null,
      rotulo_tentado: autorizado?.rotulo ?? null,
      tentativas_sem_sucesso: p.tentativas_sem_sucesso,
    };
  }

  /** A IARA ainda pode propor, ou já tentou o bastante sem resolver? */
  esgotou(idUsuario: string): boolean {
    const p = this.porOperador.get(idUsuario);
    return (p?.tentativas_sem_sucesso ?? 0) >= TETO_TENTATIVAS;
  }

  /** Zera a linha de investigação. O problema mudou, ou foi resolvido. */
  esquecer(idUsuario: string): void {
    this.porOperador.delete(idUsuario);
  }
}

/**
 * A instância do processo. Singleton pela mesma razão de `agenteLocal` e
 * `registroOperacoes`: o `Planejador` precisa consultá-la ao montar o plano, e a
 * habilidade precisa escrevê-la ao investigar — e os dois vivem em pontas
 * opostas do kernel, sem um dono comum para injetar a dependência.
 */
export const planosPropostos = new PlanosPropostos();
