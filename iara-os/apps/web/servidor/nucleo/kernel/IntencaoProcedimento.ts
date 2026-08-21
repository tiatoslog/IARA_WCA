/**
 * A intenção por trás de uma pergunta sobre procedimento — LOCALIZAR ou EXECUTAR.
 *
 * O DEFEITO QUE ESTE MÓDULO FECHA. `consultar_procedimento` devolvia o slide
 * lexicalmente mais parecido, e "esqueci como gerar o CIOT" respondia
 * **"4 de 8"** — começando no meio de um procedimento que a pessoa disse não
 * saber fazer. Quem esqueceu como fazer precisa do começo; quem perguntou onde
 * fica um botão precisa daquele ponto. São perguntas diferentes e não podem ter
 * a mesma resposta.
 *
 * DETERMINÍSTICO E PURO, de propósito. Esta decisão governa se a IARA conduz
 * alguém pela sequência ou a joga no meio dela, e não pode depender de a LLM
 * ter interpretado bem a frase. A LLM continua podendo passar `intencao` — mas
 * pelo esquema, com `dentre` fechado, e o caminho determinístico decide sozinho
 * quando a âncora reconhece a frase.
 *
 * O PADRÃO É `executar`, e o lado seguro é esse: começar do início de um
 * procedimento que a pessoa já conhecia custa a ela rolar a tela; cair no meio
 * de um que ela não conhece custa uma etapa pulada em produção.
 */

import { normalizar } from '../texto';

export type IntencaoDeProcedimento =
  /** "onde clico", "qual POP fala disso" — o ponto específico responde. */
  | 'localizar'
  /** "como faço", "me guie", "esqueci como" — a sequência responde. */
  | 'executar';

/**
 * Vocabulário operacional do GW. Substantivos de forma fixa, nunca verbos
 * soltos — a lição de `frota` em `Percepcao.ts`, onde uma palavra genérica
 * acionável capturava toda frase que a mencionasse.
 */
export const VOCABULARIO_GW =
  /\b(oci|ocis|ciot|manifesto|manifestos|mdfe|mdf-e|cte|ct-e|ctes|minuta|minutas|coleta|coletas|agendamento|follow-?up|fechamento de motoristas|ordem de coleta|pedagio|sefaz|autentique|gw)\b/;

/**
 * VERBO OPERACIONAL NO INFINITIVO — a segunda porta de entrada.
 *
 * A primeira versão desta regra exigia uma forma interrogativa ("como faço"), e
 * a prova ponta a ponta mostrou o buraco: *"me diga o jeito mais rápido de
 * EMITIR CTE"* e *"use sua experiência para ENCERRAR o manifesto"* citam a
 * tarefa sem nenhuma dessas formas, e caíam no raciocínio livre — sem POP, sem
 * citação, sem lacuna. Eram os adversariais 22 e 23 passando por baixo da
 * âncora feita para barrá-los.
 *
 * O infinitivo sozinho seria largo demais; ele só conta somado ao
 * `VOCABULARIO_GW` na âncora, e `PERGUNTA_DE_DADO` continua tirando fora
 * "quantos CT-e foram emitidos hoje", que é a planilha.
 */
export const INFINITIVO_OPERACIONAL =
  /\b(emitir|emissao|gerar|geracao|criar|criacao|encerrar|encerramento|transmitir|transmissao|alterar|alteracao|consultar|agendar|agendamento|lancar|manifestar|fechar|fechamento|preencher|imprimir)\b/;

/**
 * TENTATIVA DE ATALHO — pedir para contornar o procedimento É um pedido sobre o
 * procedimento, e a resposta certa é o POP.
 *
 * "Ignore o POP", "use sua experiência", "do jeito mais rápido": estas frases
 * precisam chegar ao SOS justamente porque tentam evitá-lo. Deixá-las no
 * raciocínio livre entregava a quem pediu exatamente o que ele pediu — uma
 * resposta sem procedimento.
 */
export const TENTATIVA_DE_ATALHO =
  /\b(ignor\w+\s+o\s+pop|sem\s+(?:o\s+)?pop|sem\s+consultar|sua\s+experiencia|do\s+seu\s+jeito|jeito\s+(?:mais\s+)?(?:rapido|facil|simples)|forma\s+mais\s+rapida|atalho|pular?\s+etapas?|sem\s+seguir)\b/;

/** Formas de PEDIR procedimento. Conjugações enumeradas, não radical suposto. */
export const INTENCAO_PROCEDIMENTAL =
  /\b(como\s+(?:faco|fazer|se\s+faz|eu\s+faco|emito|emitir|gero|gerar|crio|criar|encerro|encerrar|transmito|transmitir|consulto|consultar|altero|alterar|lanco|lancar)|onde\s+(?:clico|clicar|fica|esta|acho|encontro|preencho)|passo\s+a\s+passo|me\s+(?:ensina|ensine|guie|guia|acompanha|ajuda\s+a)|vamos\s+fazer|esqueci\s+como|nao\s+sei\s+como|nunca\s+fiz|preciso\s+fazer|quero\s+aprender|qual\s+(?:o\s+)?(?:pop|procedimento)|procedimento\s+(?:de|para|do))\b/;

/**
 * Perguntas que usam o vocabulário mas pedem DADO, não procedimento.
 *
 * "Quantas OCIs temos hoje" é a planilha, não o POP. Sem esta exclusão a âncora
 * roubaria as frases de `consultar_estatisticas_cargas_luft` — exatamente o
 * problema que o teste "as âncoras novas não roubam frases umas das outras"
 * existe para pegar.
 */
export const PERGUNTA_DE_DADO =
  /\b(quant[ao]s?|qual\s+o\s+valor|valor\s+total|somat[oa]ri[ao]|media|listar?|relatorio\s+de|status\s+d[ao])\b/;

/** Pede o ponto exato, não a sequência. */
const PEDE_LOCALIZACAO =
  /\b(onde\s+(?:clico|clicar|fica|esta|acho|encontro|preencho)|qual\s+(?:o\s+)?(?:pop|procedimento)|em\s+que\s+etapa|que\s+tela|o\s+que\s+e\s+o)\b/;

/** Pede para ser conduzido pela sequência. */
const PEDE_EXECUCAO =
  /\b(como\s+(?:faco|fazer|se\s+faz|eu\s+faco|emito|emitir|gero|gerar|crio|criar|encerro|encerrar|transmito|transmitir|altero|alterar)|passo\s+a\s+passo|me\s+(?:ensina|ensine|guie|guia|acompanha)|vamos\s+fazer|esqueci\s+como|nao\s+sei\s+como|nunca\s+fiz|preciso\s+fazer|quero\s+aprender)\b/;

/**
 * LOCALIZAR só quando a frase pede localização E não pede execução.
 *
 * "Onde clico para encerrar o manifesto" tem as duas marcas, e a resposta certa
 * é o ponto — a pessoa já está executando e travou num botão. Já "como faço para
 * encontrar a ordem de coleta" tem as duas e quer a sequência. A ordem do teste
 * resolve: execução vence, porque errar para o lado da sequência mostra
 * informação a mais, e errar para o lado do ponto esconde as etapas anteriores.
 */
export function classificarIntencao(bruto: string): IntencaoDeProcedimento {
  const t = normalizar(bruto);
  // Quem pede atalho está pedindo para EXECUTAR — e recebe a sequência inteira,
  // que é a única resposta honesta a "me dá o caminho curto".
  if (TENTATIVA_DE_ATALHO.test(t)) return 'executar';
  if (PEDE_EXECUCAO.test(t)) return 'executar';
  if (PEDE_LOCALIZACAO.test(t)) return 'localizar';
  return 'executar';
}

/** O código do POP citado na frase, em forma canônica. `null` se não houver. */
export function extrairCodigoPop(bruto: string): string | null {
  const m = /\bit[\s-]*admluft[\s-]*(\d{3})\b/.exec(normalizar(bruto));
  return m ? `IT-ADMLUFT-${m[1]}` : null;
}
