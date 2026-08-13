/**
 * O VIGIA — a IARA percebendo antes de ser perguntada (§12).
 *
 * A REGRA, e ela é a única coisa que separa isto de um alarme irritante:
 *
 *   **detectar não é executar.** O vigia FALA. Ele nunca age, nunca abre plano,
 *   nunca toca em habilidade de efeito. O que ele produz é uma frase e uma
 *   oferta — "detectei isto; quer que eu investigue?" — e a investigação, se
 *   vier, vem pelo caminho normal, pedida pelo operador.
 *
 * TRÊS TRAVAS, e cada uma existe por um modo de falhar diferente:
 *
 *  1. AUTONOMIA. Falar sem ser chamada exige o degrau `sugestao`. Abaixo dele o
 *     vigia mede e cala — ou nem mede. Ver `Autonomia.ts`: o nível é um teto.
 *
 *  2. BORDA, NÃO NÍVEL. Ele avisa quando a situação MUDA para anômala, não
 *     enquanto ela está anômala. Um alerta por tique sobre a mesma memória em
 *     88% é o comportamento que ensina o operador a ignorar alertas — e um
 *     alerta ignorado é pior que nenhum, porque dá a impressão de cobertura.
 *
 *  3. CARÊNCIA. Mesmo na borda, um mesmo assunto não volta antes do prazo. É o
 *     que protege da métrica que oscila em volta do limiar e produziria uma
 *     borda a cada leitura.
 *
 * O QUE ELE NÃO FAZ, e é deliberado: não mede sozinho. Ele recebe a medição de
 * quem tem permissão para colhê-la. O vigia é política — quando vale a pena
 * interromper alguém —, e política não abre PowerShell.
 */

import { nivelAtual, podeSem, type NivelAutonomia } from './Autonomia';
import { anomaliaDominante, diagnosticarLentidao } from './MotorAnalise';
import type { Medicao } from '../SondasDesempenho';
import type { Severidade } from './Investigacao';

/**
 * Quanto tempo um mesmo assunto fica em silêncio depois de avisado.
 *
 * Meia hora é longo para um alarme e curto para um dia de trabalho, e é
 * proposital: o vigia não é um monitor de datacenter. Ele é alguém na sala que
 * comenta uma vez que a máquina está pesada e não repete a cada dez minutos.
 */
export const CARENCIA_MS = 30 * 60 * 1000;

/**
 * Severidade a partir da qual vale interromper.
 *
 * `moderada` fica DE FORA de propósito. A faixa moderada é onde uma máquina de
 * trabalho passa boa parte do dia, e interromper ali gastaria a atenção do
 * operador exatamente como o alerta por nível gastaria — só que mais devagar. O
 * vigia fala quando a coisa é `grave`; o resto ele responde quando perguntado.
 */
export const SEVERIDADE_MINIMA: Severidade = 'grave';

const PESO: Record<Severidade, number> = { leve: 1, moderada: 2, grave: 3 };

export interface Aviso {
  /** O assunto, para a carência: `memoria_uso`, `disco_livre`. */
  readonly assunto: string;
  readonly severidade: Severidade;
  /** A frase, pronta para sair. Termina em oferta, nunca em ação. */
  readonly texto: string;
}

export class Vigia {
  /** Assunto → instante do último aviso. É o que implementa a carência. */
  private readonly avisadoEm = new Map<string, number>();
  /** O assunto anômalo da última leitura. É o que implementa a borda. */
  private ultimoAssunto: string | null = null;

  constructor(
    private readonly agora: () => number = () => Date.now(),
    private readonly nivel: () => NivelAutonomia = nivelAtual,
  ) {}

  /**
   * Vale interromper o operador com esta medição?
   *
   * `null` é a resposta esmagadoramente mais comum, e é o desenho: um vigia que
   * quase sempre cala é um vigia em quem se acredita quando ele fala.
   */
  avaliar(m: Medicao): Aviso | null {
    /**
     * A AUTONOMIA É CONFERIDA PRIMEIRO, antes até de diagnosticar. Não é
     * economia — é a ordem certa: abaixo de `sugestao` a IARA não tem o que
     * fazer com a conclusão, e produzir uma conclusão que não pode ser dita é
     * como se acumula a tentação de dizê-la mais tarde.
     */
    if (!podeSem(this.nivel(), 'falar_sem_ser_chamada')) {
      this.ultimoAssunto = null;
      return null;
    }

    const dominante = anomaliaDominante(diagnosticarLentidao(m));

    // Voltou ao normal: a borda é rearmada. É o que permite avisar de novo se a
    // situação piorar outra vez — sem isso, o primeiro aviso seria o único.
    if (!dominante || PESO[dominante.severidade] < PESO[SEVERIDADE_MINIMA]) {
      this.ultimoAssunto = null;
      return null;
    }

    const assunto = dominante.evidencia.metrica;

    // 2. BORDA: já estava neste mesmo estado na leitura passada, então não é
    //    notícia. Uma situação que persiste não vira aviso novo.
    if (this.ultimoAssunto === assunto) return null;
    this.ultimoAssunto = assunto;

    // 3. CARÊNCIA: mesmo sendo borda, este assunto foi falado há pouco.
    const ultimo = this.avisadoEm.get(assunto);
    if (ultimo !== undefined && this.agora() - ultimo < CARENCIA_MS) return null;
    this.avisadoEm.set(assunto, this.agora());

    return {
      assunto,
      severidade: dominante.severidade,
      /**
       * A FRASE TERMINA EM OFERTA. É a diferença entre um assistente e um
       * alarme: o vigia relata o que MEDIU (nunca uma causa — ele não
       * investigou) e devolve a decisão. Nenhum plano foi montado ainda.
       */
      texto:
        `Uma coisa que eu notei sem você perguntar: ${dominante.descricao}. ` +
        `O normal seria ${dominante.faixa_normal}. ` +
        `Não investiguei ainda nem mexi em nada — quer que eu descubra o motivo?`,
    };
  }

  /** Esquece borda e carência. Para o teste, e para quando a sessão troca. */
  reiniciar(): void {
    this.avisadoEm.clear();
    this.ultimoAssunto = null;
  }
}
