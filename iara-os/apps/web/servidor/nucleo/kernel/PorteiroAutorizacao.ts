/**
 * Porteiro de autorização — a camada que faltava entre DECIDIR e EXECUTAR.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE, e que nenhuma outra respondia:
 *
 *   quem autorizou este passo?
 *
 * O sistema já sabia responder "quem PODE" (`Seguranca.ts`, por papel) e "quanta
 * prova o risco exige" (`PoliticaRisco.ts`). Faltava cruzar as duas coisas com
 * a ORIGEM do passo — e é aí que morava o defeito.
 *
 * O DEFEITO, reproduzido na auditoria de 11/08/2026:
 *
 *   A `PoliticaRisco` existia, tinha testes e dizia `confirmacaoPrevia: true`
 *   para risco alto. Nenhuma linha de produção a consultava. O Kernel executava
 *   qualquer passo que passasse pela permissão de papel, e o papel `operador`
 *   concede `escrita`. Como o catálogo oferecido à LLM incluía `acionar_energia`
 *   e `resolver_confirmacao` (as duas de risco alto, as duas de custo zero), um
 *   plano de dois passos emitido pela camada de raciocínio —
 *
 *     [acionar_energia{desligar}, resolver_confirmacao{confirmo}]
 *
 *   — armava a pendência e a confirmava no mesmo turno. `shutdown.exe /s /t 20`
 *   disparava sem o operador ter digitado "confirmo" uma única vez. A garantia
 *   escrita em `AgenteLocal.ts` ("só a palavra 'confirmo' do MESMO operador
 *   libera") era falsa: a pendência estava amarrada ao `id_usuario`, não a uma
 *   fala humana.
 *
 * A REGRA, em uma frase: **a LLM nunca é fonte de autorização.**
 *
 * Um passo de risco alto só executa quando nasce de um plano DETERMINÍSTICO —
 * isto é, de uma receita disparada por uma âncora encontrada no texto que o
 * operador escreveu. Plano emergente (decomposto pela LLM) pode ler, pode
 * consultar, pode alterar coisa reversível; não pode acionar o que é
 * irreversível ou alcança terceiro.
 *
 * Isto é deliberadamente GENÉRICO. Não menciona energia, não menciona WhatsApp,
 * não menciona habilidade nenhuma: lê o `risco` declarado no manifesto. Uma
 * habilidade nova de risco alto nasce protegida sem que ninguém se lembre de
 * protegê-la — que é a única forma de proteção que sobrevive ao tempo.
 */

import type { Risco } from './Habilidade';
import { PoliticaRisco } from './PoliticaRisco';

/** De onde veio o passo que está pedindo para executar. */
export type OrigemPasso =
  /** Receita disparada por âncora no texto do próprio operador. */
  | 'deterministico'
  /** Decomposição emitida pela camada de raciocínio. Não é fonte de autoridade. */
  | 'emergente';

export interface PedidoAutorizacao {
  readonly habilidade: string;
  readonly risco: Risco;
  readonly origem: OrigemPasso;
}

export interface Veredito {
  readonly permitido: boolean;
  /**
   * Uma linha, escrita para chegar ao operador. Vazio quando permitido.
   *
   * Nunca "não autorizado" seco: o operador precisa saber o que fazer a
   * seguir, senão a recusa vira um beco.
   */
  readonly motivo: string;
}

const PERMITIDO: Veredito = { permitido: true, motivo: '' };

export class PorteiroAutorizacao {
  constructor(private readonly politica = new PoliticaRisco()) {}

  /**
   * Este passo pode executar?
   *
   * A ordem do teste é a política: só o risco que exige confirmação prévia é
   * examinado quanto à origem. Risco baixo e médio seguem como sempre — pedir
   * autorização para consultar o clima ou criar uma pasta transformaria o
   * assistente em burocracia, e é por isso que a `PoliticaRisco` distingue os
   * três níveis em vez de tratar tudo como perigoso.
   */
  avaliar(pedido: PedidoAutorizacao): Veredito {
    const exigencia = this.politica.exigenciaDe(pedido.risco);
    if (!exigencia.confirmacaoPrevia) return PERMITIDO;

    if (pedido.origem === 'deterministico') return PERMITIDO;

    return {
      permitido: false,
      motivo:
        `"${pedido.habilidade}" é uma ação de risco alto e este passo foi proposto pela ` +
        'camada de raciocínio, não por você. Não executo ação irreversível por conta própria — ' +
        'peça diretamente e eu confirmo com você antes.',
    };
  }

  /**
   * O catálogo que pode ser oferecido à LLM para planejar.
   *
   * Segunda barreira, independente da primeira. O `avaliar` já recusaria o
   * passo; não mostrar a habilidade evita que a LLM monte um plano inteiro em
   * volta de algo que vai ser barrado — plano barrado no meio custa tokens,
   * mostra passos ao operador e termina em frustração.
   *
   * As duas barreiras existem de propósito: a de cima é política, a de baixo é
   * ergonomia. Remover a de baixo degrada a experiência; remover a de cima
   * reabre o buraco.
   */
  planejavel(risco: Risco): boolean {
    return !this.politica.exigenciaDe(risco).confirmacaoPrevia;
  }
}
