/**
 * O ORÇAMENTO DE CONTEXTO — quanto do passado cabe no pedido.
 *
 * O histórico sempre foi limitado por CONTAGEM: vinte registros para a síntese,
 * seis para o antecedente. Contagem não é tamanho. Vinte mensagens de cinquenta
 * caracteres não são nada; vinte de quatro mil são ~20 mil tokens — mais que a
 * janela inteira da camada gratuita da Groq (8.000, medido em 18/08/2026).
 *
 * Basta um operador colar um trecho de planilha para TODO turno seguinte daquela
 * conversa nascer grande demais, e nada no sistema notava: o pedido ia inteiro,
 * o provedor recusava por tamanho, e a cadeia caía para o elo seguinte sem
 * ninguém entender por quê.
 *
 * O QUE SE CORTA É O MAIS ANTIGO, e a razão é a mesma de toda janela deslizante:
 * a última troca é a que o operador tem na cabeça. Cortar o meio produziria uma
 * conversa que salta, e cortar o fim responderia à pergunta anterior.
 *
 * O CORTE É DITO, nunca silencioso. Uma IARA que esquece parte da conversa sem
 * avisar é uma IARA que às vezes muda de assunto sozinha — e no dia em que o
 * corte apagar o que importava, ninguém terá como saber que foi ele. Quem chama
 * recebe a contagem do que ficou de fora e a leva para o jornal.
 *
 * Função pura: recebe o histórico e o teto, devolve a decisão. Nada de disco,
 * nada de relógio — a peça que decide o que a IARA lembra não pode depender de
 * ambiente para ser testada.
 */

import type { RegistroMemoria } from '../../../lib/estado';
import { lerConfig } from './Configuracao';

/**
 * DOIS MIL TOKENS PARA O PASSADO, e o número saiu de aritmética sobre medição,
 * não de gosto.
 *
 * O pedido de resposta já custa ~4.000 tokens estimados sem histórico nenhum
 * (persona, camada global, catálogo). A janela gratuita mais apertada que se
 * mediu é a da Groq: 8.000 por minuto. Sobram ~4.000 para tudo o mais, e metade
 * disso para o histórico deixa folga para a mensagem do turno e para a resposta
 * — que também conta contra o mesmo teto por minuto.
 *
 * Um teto maior tornaria a Groq inalcançável em qualquer conversa com três
 * trocas; um bem menor jogaria fora contexto que cabia. Quem tiver só provedor
 * de janela grande aumenta em `IARA_ORCAMENTO_CONTEXTO_TOKENS` e paga em tokens
 * o que ganha em memória.
 */
export const TETO_CONTEXTO_PADRAO_TOKENS = 2_000;

export function tetoDeContexto(ambiente: NodeJS.ProcessEnv = process.env): number {
  const bruto = lerConfig('IARA_ORCAMENTO_CONTEXTO_TOKENS', ambiente);
  if (bruto === null) return TETO_CONTEXTO_PADRAO_TOKENS;
  const n = Number(bruto);
  /* Zero ou negativo desligaria a memória inteira em silêncio, e "a IARA não
     lembra de nada" é indistinguível de "a IARA está com defeito". */
  return Number.isInteger(n) && n > 0 ? n : TETO_CONTEXTO_PADRAO_TOKENS;
}

export interface HistoricoAparado {
  readonly mantidos: RegistroMemoria[];
  /** Quantos registros ficaram de fora. Vai para o jornal, nunca para o silêncio. */
  readonly descartados: number;
  /** Tokens estimados do que ficou. Para a telemetria e para o teste. */
  readonly tokens: number;
}

/** Mesma régua do estimador da cadeia: quatro caracteres por token, errando
 *  para baixo de propósito. Ver `estimarTokensDoPedido`. */
const tokensDe = (texto: unknown): number =>
  typeof texto === 'string' ? Math.ceil(texto.length / 4) : 0;

/**
 * Mantém o fim do histórico que couber no teto.
 *
 * UM REGISTRO SOZINHO MAIOR QUE O TETO ainda entra, e essa exceção é
 * deliberada: é quase sempre a última fala do operador — o próprio pedido que
 * ele acabou de colar. Descartá-lo por tamanho faria a IARA responder à
 * conversa sem responder à pergunta, que é pior que estourar a janela e cair
 * para o elo seguinte.
 */
export function apararHistorico(
  historico: readonly RegistroMemoria[],
  teto: number,
): HistoricoAparado {
  if (!Array.isArray(historico) || historico.length === 0) {
    return { mantidos: [], descartados: 0, tokens: 0 };
  }

  const mantidos: RegistroMemoria[] = [];
  let soma = 0;
  for (let i = historico.length - 1; i >= 0; i -= 1) {
    const r = historico[i];
    const custo = tokensDe(r?.texto);
    /* O primeiro (mais recente) entra sempre — ver o comentário acima. */
    if (mantidos.length > 0 && soma + custo > teto) break;
    mantidos.unshift(r);
    soma += custo;
  }
  return { mantidos, descartados: historico.length - mantidos.length, tokens: soma };
}
