/**
 * QUANTO CUSTA PENSAR — e por que este arquivo não traz uma tabela de preços.
 *
 * O sistema contava tokens desde sempre e nunca soube dizer quanto um turno
 * custou. "Roteamento consciente de custo" sem essa conta seria só o que já
 * existe: a camada binária `padrao`/`premium`, decidida à mão.
 *
 * PREÇO NÃO SE INVENTA, E NEM SE COPIA DA PÁGINA DO FORNECEDOR. O número que
 * vale é o da CONTA de quem roda — muda por plano, por contrato, por região, e
 * envelhece sem avisar. Uma tabela fixada aqui seria a mesma doença do
 * `llama-3.3-70b-versatile`: um fato do mundo congelado em código.
 *
 * Então:
 *
 *   · as camadas GRATUITAS têm preço zero declarado, porque isso é fato da
 *     instalação — são níveis sem cartão, e foi por isso que entraram (15/08);
 *   · a paga tem preço LIDO DO AMBIENTE, e sem declaração o custo do turno sai
 *     `null`;
 *   · `null` NUNCA é tratado como zero. Um provedor de preço desconhecido
 *     parecendo grátis é exatamente o erro que faria o teto de custo aprovar o
 *     turno mais caro da casa.
 *
 * A UNIDADE É MICRO-CENTAVO, e é aritmética inteira de propósito. Preço vem por
 * MILHÃO de tokens; guardá-lo em centavos-por-milhão faz o custo de uma chamada
 * ser `tokens × centavos_por_milhao` — que já está em micro-centavos, sem
 * divisão e sem ponto flutuante acumulando erro ao longo de um dia de turnos.
 */

import { lerConfig } from './kernel/Configuracao';

/** 1 centavo = 1.000.000 micro-centavos. */
export const MICRO_CENTAVOS_POR_CENTAVO = 1_000_000;

export interface PrecoDoModelo {
  /** Centavos por milhão de tokens de ENTRADA. */
  readonly entrada_centavos_por_milhao: number;
  /** Centavos por milhão de tokens de SAÍDA. */
  readonly saida_centavos_por_milhao: number;
  /** De onde veio este número — para ninguém ter de adivinhar depois. */
  readonly fonte: string;
}

/**
 * As camadas gratuitas. Zero aqui é FATO DA INSTALAÇÃO, não suposição: Groq,
 * Gemini e OpenRouter entraram nesta base justamente por terem nível gratuito
 * sem cartão (15/08/2026), e o Ollama roda na máquina.
 *
 * Se alguma delas passar a cobrar, o conserto é declarar o preço no ambiente —
 * a variável vence este mapa.
 */
const GRATUITOS: Readonly<Record<string, PrecoDoModelo>> = {
  groq: { entrada_centavos_por_milhao: 0, saida_centavos_por_milhao: 0, fonte: 'camada gratuita sem cartão' },
  gemini: { entrada_centavos_por_milhao: 0, saida_centavos_por_milhao: 0, fonte: 'camada gratuita sem cartão' },
  openrouter: { entrada_centavos_por_milhao: 0, saida_centavos_por_milhao: 0, fonte: 'modelo `:free`' },
  ollama: { entrada_centavos_por_milhao: 0, saida_centavos_por_milhao: 0, fonte: 'inferência local' },
};

const numero = (variavel: string, ambiente: NodeJS.ProcessEnv): number | null => {
  const bruto = lerConfig(variavel, ambiente);
  if (bruto === null) return null;
  const n = Number(bruto);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/**
 * O preço deste cérebro, ou `null` quando ninguém declarou.
 *
 * O AMBIENTE VENCE O MAPA, sempre: quem tem contrato próprio declara o dele, e
 * quem descobrir que a camada "gratuita" passou a cobrar conserta sem deploy.
 */
export function precoDoProvedor(
  apelido: string,
  ambiente: NodeJS.ProcessEnv = process.env,
): PrecoDoModelo | null {
  /**
   * APELIDO AUSENTE É PREÇO DESCONHECIDO, não exceção.
   *
   * `apelido` é obrigatório no contrato do provedor e há implementação que não o
   * define — dublê de teste, sobretudo. A primeira versão fazia
   * `apelido.toUpperCase()` direto e derrubou oito cenários da escalada de uma
   * vez. É a TERCEIRA vez nesta base que uma peça nova assume campo obrigatório
   * que nem todo chamador preenche: já aconteceu com `AbortSignal.any` no
   * abandono por demora e com o estimador de tokens. `PedidoRaciocinio` e
   * `ProvedorRaciocinio` declaram obrigatório o que na prática é opcional, e
   * toda peça nova tropeça até isso ser resolvido no contrato.
   */
  if (typeof apelido !== 'string' || apelido.trim().length === 0) return null;
  const sufixo = apelido.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const entrada = numero(`IARA_PRECO_${sufixo}_ENTRADA`, ambiente);
  const saida = numero(`IARA_PRECO_${sufixo}_SAIDA`, ambiente);
  if (entrada !== null && saida !== null) {
    return {
      entrada_centavos_por_milhao: entrada,
      saida_centavos_por_milhao: saida,
      fonte: `ambiente (IARA_PRECO_${sufixo}_*)`,
    };
  }
  return GRATUITOS[apelido.toLowerCase()] ?? null;
}

/**
 * O custo de UMA chamada, em micro-centavos. `null` quando o preço é
 * desconhecido — e quem chama precisa tratar `null` como *não sei*, nunca como
 * zero.
 */
export function custoDaChamada(
  apelido: string,
  tokensEntrada: number,
  tokensSaida: number,
  ambiente: NodeJS.ProcessEnv = process.env,
): number | null {
  const preco = precoDoProvedor(apelido, ambiente);
  if (!preco) return null;
  const seguro = (n: number): number => (Number.isFinite(n) && n > 0 ? Math.round(n) : 0);
  return (
    seguro(tokensEntrada) * preco.entrada_centavos_por_milhao +
    seguro(tokensSaida) * preco.saida_centavos_por_milhao
  );
}

/** Para o relatório e o jornal. Micro-centavos são ilegíveis para gente. */
export function emCentavos(microCentavos: number): string {
  return (microCentavos / MICRO_CENTAVOS_POR_CENTAVO).toFixed(4);
}
