/**
 * AS SUGESTÕES DA SALA VAZIA — personalizadas por quem pergunta.
 *
 * A regra veio da operadora (15/08/2026): os atalhos de "a sala está aberta"
 * são as perguntas que ELA mais faz, não uma lista fixa igual para todo mundo.
 * Quem pergunta do tempo todo dia vê o tempo; quem nunca perguntou não vê.
 *
 * A contagem é local e pura: quem guarda (localStorage, por `id_usuario`) e
 * quando registra são decisões da tela — aqui mora só a aritmética, testável
 * em Node. Uma pergunta só vira atalho depois de REPETIR (2+ vezes): uma
 * pergunta feita uma única vez não é "frequente", é histórico.
 */

export interface PerguntaContada {
  /** A grafia mais recente com que a pergunta foi feita — é o que o botão mostra. */
  texto: string;
  vezes: number;
  /** Epoch ms da última vez — desempata entre iguais e poda as antigas. */
  ultima_em: number;
}

/** Quantas perguntas distintas vale a pena lembrar por pessoa. */
const MAX_HISTORICO = 200;

/** Um botão não é lugar para um parágrafo. Perguntas maiores continuam
 *  contadas, mas nunca viram atalho. */
const MAX_TEXTO_ATALHO = 120;

/** Quantas vezes no mínimo para virar atalho. */
const MINIMO_PARA_ATALHO = 2;

/**
 * "Vai chover hoje?", "vai chover hoje" e "VAI  CHOVER HOJE??" são a mesma
 * pergunta. Caixa, espaço repetido e pontuação final não diferenciam intenção
 * — e cada variação contada à parte faria a frequência real nunca aparecer.
 */
export function chaveDePergunta(texto: string): string {
  return texto
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[?!.\s]+$/g, '')
    .trim();
}

/** Registra uma pergunta feita agora. Puro: devolve a lista nova. */
export function registrarPergunta(
  historico: readonly PerguntaContada[],
  texto: string,
  agora: number,
): PerguntaContada[] {
  const limpo = texto.replace(/\s+/g, ' ').trim();
  const chave = chaveDePergunta(limpo);
  if (!chave) return [...historico];

  const semEla = historico.filter((p) => chaveDePergunta(p.texto) !== chave);
  const existente = historico.find((p) => chaveDePergunta(p.texto) === chave);
  const nova: PerguntaContada = {
    // A grafia mais recente vence: é a forma que a pessoa usa hoje.
    texto: limpo,
    vezes: (existente?.vezes ?? 0) + 1,
    ultima_em: agora,
  };

  return [nova, ...semEla]
    .sort((a, b) => b.ultima_em - a.ultima_em)
    .slice(0, MAX_HISTORICO);
}

/**
 * Os atalhos da sala vazia: as mais frequentes primeiro (desempate pela mais
 * recente), completadas com as sugestões padrão até `max` — sem repetir uma
 * padrão que já entrou como frequente.
 */
export function sugerir(
  historico: readonly PerguntaContada[],
  padrao: readonly string[],
  max = 3,
): string[] {
  const frequentes = historico
    .filter((p) => p.vezes >= MINIMO_PARA_ATALHO && p.texto.length <= MAX_TEXTO_ATALHO)
    .sort((a, b) => b.vezes - a.vezes || b.ultima_em - a.ultima_em)
    .slice(0, max)
    .map((p) => p.texto);

  const chaves = new Set(frequentes.map(chaveDePergunta));
  const resultado = [...frequentes];
  for (const s of padrao) {
    if (resultado.length >= max) break;
    if (chaves.has(chaveDePergunta(s))) continue;
    resultado.push(s);
    chaves.add(chaveDePergunta(s));
  }
  return resultado;
}

/** Leitura defensiva do que estava guardado — localStorage é entrada externa. */
export function lerHistorico(bruto: string | null): PerguntaContada[] {
  if (!bruto) return [];
  try {
    const dado: unknown = JSON.parse(bruto);
    if (!Array.isArray(dado)) return [];
    return dado
      .filter(
        (p): p is PerguntaContada =>
          typeof p === 'object' &&
          p !== null &&
          typeof (p as PerguntaContada).texto === 'string' &&
          typeof (p as PerguntaContada).vezes === 'number' &&
          typeof (p as PerguntaContada).ultima_em === 'number',
      )
      .slice(0, MAX_HISTORICO);
  } catch {
    return [];
  }
}
