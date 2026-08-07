/**
 * Teoria da Mente computacional.
 *
 * Classifica o operador a partir de sinais observáveis — não de adivinhação.
 * Cada classificação carrega os sinais que a produziram, e eles vão para o
 * console técnico. Se a IARA "acha" algo, dá para auditar por quê.
 *
 * O efeito prático: quando o operador está frustrado ou estressado, a persona
 * recebe injeção de controle que silencia a ironia e a prolixidade do mordomo.
 */

import { OCEAN_IARA, type LeituraOperador, type MatrizOcean } from '../../lib/estado';
import { normalizar } from './RoteadorIntencoes';

const CRISE =
  /\b(urgente|urgencia|parou|caiu|travou|nao funciona|nao esta funcionando|prejuizo|perdendo|critico|emergencia|socorro|pane|fora do ar)\b/;
const ATRITO = /\b(de novo|denovo|outra vez|sempre|nunca funciona|ja falei|absurdo|ridiculo|pelo amor)\b/;
const FLUXO = /\b(ok|beleza|entendi|perfeito|fechou|isso mesmo|obrigad)\b/;

export interface SinalTemporal {
  /** Intervalo em ms desde a mensagem anterior do mesmo operador. */
  delta_ms: number;
  /** Quantas mensagens nos últimos 60s. */
  rajada: number;
}

export class TeoriaDaMente {
  private ultimoInstante = 0;
  private janela: number[] = [];

  registrarChegada(agora = Date.now()): SinalTemporal {
    const delta = this.ultimoInstante === 0 ? Number.POSITIVE_INFINITY : agora - this.ultimoInstante;
    this.ultimoInstante = agora;
    this.janela = this.janela.filter((t) => agora - t < 60_000);
    this.janela.push(agora);
    return { delta_ms: delta, rajada: this.janela.length };
  }

  analisar(mensagem: string, temporal: SinalTemporal): LeituraOperador {
    const t = normalizar(mensagem);
    const sinais: string[] = [];
    let tensao = 0;
    let fluxo = 0;

    if (CRISE.test(t)) {
      tensao += 2;
      sinais.push('léxico de crise');
    }
    if (ATRITO.test(t)) {
      tensao += 2;
      sinais.push('marcador de recorrência/atrito');
    }

    // Caixa alta: só conta em mensagens com corpo, senão "OK" vira estresse.
    const letras = mensagem.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letras.length >= 12) {
      const maiusculas = (mensagem.match(/[A-ZÀ-Þ]/g) ?? []).length;
      if (maiusculas / letras.length > 0.6) {
        tensao += 2;
        sinais.push('caixa alta sustentada');
      }
    }

    const pontuacao = (mensagem.match(/[!?]/g) ?? []).length;
    if (pontuacao >= 3) {
      tensao += 1;
      sinais.push(`pontuação excessiva (${pontuacao})`);
    }

    if (temporal.rajada >= 4) {
      tensao += 1;
      sinais.push(`rajada de ${temporal.rajada} mensagens em 60s`);
    }
    if (temporal.delta_ms < 2500 && Number.isFinite(temporal.delta_ms)) {
      tensao += 1;
      sinais.push('intervalo curto entre envios');
    }

    if (FLUXO.test(t)) {
      fluxo += 1;
      sinais.push('marcador de concordância');
    }
    if (Number.isFinite(temporal.delta_ms) && temporal.delta_ms > 30_000 && mensagem.length > 80) {
      fluxo += 1;
      sinais.push('mensagem elaborada após pausa');
    }

    if (tensao >= 4) {
      return { estado: 'frustrado', confianca: Math.min(1, tensao / 6), sinais };
    }
    if (tensao >= 2) {
      return { estado: 'estressado', confianca: Math.min(1, tensao / 5), sinais };
    }
    if (fluxo >= 2) {
      return { estado: 'produtivo', confianca: 0.6, sinais };
    }
    if (mensagem.length > 140) {
      sinais.push('mensagem longa e estruturada');
      return { estado: 'focado', confianca: 0.5, sinais };
    }
    return { estado: 'neutro', confianca: 0.3, sinais };
  }

  /**
   * Override de persona. Devolve o bloco que é ANEXADO ao prompt de sistema —
   * o prompt base nunca é reescrito, para não invalidar o cache de prefixo.
   */
  static overrideDePersona(leitura: LeituraOperador, ocean: MatrizOcean = OCEAN_IARA): string {
    switch (leitura.estado) {
      case 'frustrado':
        return (
          'ESTADO DO OPERADOR: frustrado. Responda em no máximo três frases. ' +
          'Sem ironia, sem preâmbulo, sem pedido de desculpas prolongado. ' +
          'Primeira frase = a resposta ou o próximo passo concreto.'
        );
      case 'estressado':
        return (
          'ESTADO DO OPERADOR: sob pressão. Seja direto e calmo. Corte cortesia ' +
          'ornamental. Entregue o essencial primeiro e ofereça detalhe só se pedirem.'
        );
      case 'focado':
        return 'ESTADO DO OPERADOR: focado. Acompanhe o raciocínio dele sem redirecionar o assunto.';
      case 'produtivo':
        return `ESTADO DO OPERADOR: produtivo. Mantenha o ritmo; extroversão calibrada em ${ocean.extroversao}.`;
      default:
        return '';
    }
  }
}
