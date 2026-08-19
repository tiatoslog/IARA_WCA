/**
 * A ESCALADA — e a primeira coisa a dizer é o que ela NÃO é.
 *
 *   retentativa   mesmo nível, falha transitória, o resultado não chegou a
 *                 existir. Já mora na `CadeiaDeRaciocinio`: 429, 503, elo que
 *                 não começou a falar no prazo.
 *
 *   escalada      o resultado EXISTE, um verificador independente o contesta,
 *                 e vale gastar orçamento com um cérebro de maior capacidade
 *                 para produzir outro.
 *
 * São eventos diferentes e a confusão entre eles é como um sistema aprende a
 * queimar cota repetindo a mesma chamada. Aqui só se trata do segundo.
 *
 * UMA ESCALADA POR TURNO, nunca por provedor. O teto por provedor pareceria
 * mais generoso e tornaria a convergência indemonstrável: com quatro elos, uma
 * verificação teimosa produziria quatro chamadas premium e nenhuma prova de que
 * o laço termina. Com um teto por turno, a máquina abaixo tem no máximo dois
 * caminhos até um estado final, e isso cabe em teste.
 *
 * O ORÇAMENTO É O DONO DO LAÇO. Esta peça não decide sozinha: ela pergunta.
 * Quando o orçamento nega, o desfecho é degradação honesta — nunca uma terceira
 * chamada, nunca silêncio.
 *
 * Função pura de propósito, como a tabela de verdade da campanha: uma peça que
 * decide se o sistema gasta dinheiro não pode depender de relógio, disco ou rede
 * para ser testada.
 */

import type { ResultadoVerificacao } from '../../../lib/verificacao/contrato';

export type AcaoDaEscalada =
  /** O valor bate, ou não havia o que conferir. Entrega. */
  | { readonly acao: 'entregar'; readonly porque: string }
  /** Gasta orçamento e chama o pool premium. Exatamente uma vez por turno. */
  | { readonly acao: 'escalar'; readonly porque: string }
  /**
   * Não dá para escalar e o valor está contestado: o operador recebe a
   * limitação em voz alta. Nunca a resposta contestada em silêncio.
   */
  | { readonly acao: 'degradar'; readonly porque: string };

export interface SituacaoDaEscalada {
  readonly resultado: ResultadoVerificacao;
  /** Este turno já escalou? Uma vez por TURNO, não por provedor. */
  readonly ja_escalou: boolean;
  /** O orçamento do turno tem chamada e tentativa sobrando? */
  readonly orcamento_permite: boolean;
  /** Existe pool premium declarado e fora de carência? */
  readonly premium_saudavel: boolean;
}

/**
 * A TRANSIÇÃO. A ordem das perguntas importa, como na tabela da campanha: o que
 * impede a escalada é conferido ANTES do que a autoriza, para que nenhum caminho
 * chegue a `escalar` sem ter passado por todos os freios.
 */
export function decidirEscalada(s: SituacaoDaEscalada): AcaoDaEscalada {
  if (s.resultado.status === 'valido') {
    return { acao: 'entregar', porque: `valor confere (${s.resultado.evidencia.fonte})` };
  }
  if (s.resultado.status === 'inconclusivo') {
    /**
     * INCONCLUSIVO ENTREGA, e é a decisão que mantém o mecanismo utilizável.
     *
     * A imensa maioria dos turnos cai aqui: a IARA responde muita coisa que
     * nenhuma fonte determinística alcança. Escalar em "não sei conferir" faria
     * toda conversa custar dois modelos, e degradar faria a IARA se desculpar
     * por responder bem. Não saber conferir não é motivo para desconfiar.
     */
    return { acao: 'entregar', porque: `sem oráculo para esta resposta: ${s.resultado.motivo}` };
  }

  /* Daqui para baixo o valor está CONTESTADO por evidência determinística. */
  if (!s.resultado.escalavel) {
    return {
      acao: 'degradar',
      porque: `${s.resultado.motivo} — e outro modelo não consertaria isto`,
    };
  }
  if (s.ja_escalou) {
    /* O terceiro estado do diagrama, e o que prova que o laço termina: a
       resposta premium também foi contestada, e não existe terceira chamada. */
    return {
      acao: 'degradar',
      porque: `${s.resultado.motivo} — o turno já havia escalado uma vez`,
    };
  }
  if (!s.orcamento_permite) {
    return { acao: 'degradar', porque: `${s.resultado.motivo} — sem orçamento para escalar` };
  }
  if (!s.premium_saudavel) {
    return {
      acao: 'degradar',
      porque: `${s.resultado.motivo} — não há pool premium saudável para onde escalar`,
    };
  }
  return { acao: 'escalar', porque: s.resultado.motivo };
}

/**
 * A frase que o operador lê quando a escalada não salvou o turno.
 *
 * Ela DIZ O QUE FOI CONTESTADO em vez de pedir desculpa genérica: "não consegui
 * confirmar" sem dizer o quê manda a pessoa adivinhar se pode usar o número. E
 * ela nunca repete o valor contestado como se fosse resposta — foi por isso que
 * a verificação existiu.
 */
export function textoDegradado(resultado: ResultadoVerificacao): string {
  if (resultado.status !== 'invalido') {
    return 'Não consegui confirmar esta resposta com uma fonte independente, então não vou afirmá-la.';
  }
  const { esperado, fonte } = resultado.evidencia;
  return (
    'Não vou te dar esse número: conferi contra a fonte e não bateu. ' +
    `A fonte (${fonte}) diz "${esperado}". ` +
    'Prefiro te dizer que não confirmei a te entregar um valor que você usaria para decidir.'
  );
}
