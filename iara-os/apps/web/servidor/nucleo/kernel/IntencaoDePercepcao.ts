/**
 * O operador está falando da OBSERVAÇÃO DA TELA — determinístico e puro.
 *
 * Terceiro irmão de `IntencaoProcedimento` e `IntencaoPedagogica`, e o eixo dele
 * é outro de novo: aqueles perguntam *o que responder*; este pergunta *ligar,
 * desligar ou informar a câmera*.
 *
 * POR QUE ISTO NÃO PODE DEPENDER DA LLM, e aqui a razão é mais grave que nas
 * outras duas: o que está em jogo é começar a observar a tela de uma pessoa. Um
 * modelo que interpretasse "para de olhar isso aqui" como pedido de observação
 * ligaria a captura contra a vontade de quem falou. A porta é regex, o
 * vocabulário é enumerado, e o padrão é NÃO FAZER NADA.
 *
 * A ORDEM É ENCERRAR ANTES DE TUDO. "Para de acompanhar minha tela" contém
 * "acompanhar minha tela"; se `PEDE_OBSERVACAO` viesse primeiro, o pedido de
 * parar ligaria a observação. É a precedência mais importante do arquivo.
 */

import { normalizar } from '../texto';

/**
 * "Para de observar" — o KILL SWITCH em linguagem natural.
 *
 * Deliberadamente largo: parar é sempre a ação segura, e errar para o lado de
 * parar custa ao operador uma frase a mais. Errar para o outro lado custa a
 * observação continuar depois de alguém ter pedido para parar.
 */
export const PEDE_PARAR =
  /\b(par[ae]r?\s+de\s+(?:observar|olhar|ver|acompanhar|me\s+acompanhar)|para\s+de\s+ver|pode\s+parar\s+de\s+(?:observar|olhar|ver|acompanhar)|encerr\w+\s+a?\s*(?:observacao|percepcao)|desliga\s+a?\s*(?:observacao|percepcao|camera)|nao\s+(?:olha|observa|acompanha)\s+mais|sai\s+da\s+minha\s+tela|para\s+de\s+me\s+observar)\b/;

/**
 * "Pode observar" — a AUTORIZAÇÃO, com o programa quando ele vier junto.
 *
 * Exige um verbo de observação de propósito: um "sim" solto NÃO liga captura de
 * tela. Consentimento para observar alguém não pode ser dado por monossílabo —
 * a IARA pede a frase inteira, e a frase inteira é o registro.
 */
export const AUTORIZA_OBSERVACAO =
  /\b(pode\s+(?:observar|acompanhar|olhar|ver)|autorizo\s+(?:a\s+)?(?:observacao|percepcao|voce)|estou\s+autorizando|liberado\s+para\s+(?:observar|acompanhar)|pode\s+ligar\s+a?\s*(?:percepcao|observacao))\b/;

/**
 * "Me acompanha fazendo" — o PEDIDO.
 *
 * Exige menção à TELA ou um "acompanhar" qualificado por execução. Sem isso,
 * roubaria `me acompanha no agendamento de coleta`, que é pedido de
 * procedimento e já tem dono (`PEDE_ENSINO`, em `IntencaoPedagogica`).
 */
export const PEDE_OBSERVACAO =
  /\b((?:me\s+)?acompanh\w+\s+(?:fazendo|enquanto|comigo\s+na\s+tela)|fica\s+(?:vendo|olhando)\s+(?:a\s+)?minha\s+tela|(?:olha|ve|observa|acompanha)\s+(?:a\s+)?minha\s+tela|(?:ve|olha|observa)\s+o\s+que\s+(?:eu\s+)?(?:faco|estou\s+fazendo)|assiste\s+minha\s+tela|liga\s+a?\s*(?:percepcao|observacao)|quero\s+que\s+voce\s+(?:veja|observe|acompanhe)\s+minha\s+tela)\b/;

/**
 * "Você está vendo minha tela?" — pergunta sobre o ESTADO, não pedido de ação.
 *
 * Existe separada porque a resposta é informação, e ela é o que permite ao
 * operador auditar a própria situação a qualquer momento: quem pergunta se está
 * sendo observado tem direito a uma resposta que não muda nada.
 */
export const PERGUNTA_SE_OBSERVA =
  /\b((?:voce\s+)?(?:esta|ta)\s+(?:vendo|olhando|observando|acompanhando)\s+(?:a\s+)?minha\s+tela|voce\s+(?:me\s+)?(?:esta|ta)\s+observando|a\s+(?:percepcao|observacao)\s+(?:esta|ta)\s+(?:ativa|ligada)|voce\s+consegue\s+ver\s+minha\s+tela)\b/;

export type AcaoDePercepcao = 'solicitar' | 'autorizar' | 'encerrar' | 'situacao';

/**
 * A ação, ou `null` quando a frase não fala de observação nenhuma.
 *
 * `null` é o caso comum e o padrão certo: a esmagadora maioria das frases não
 * tem nada a ver com câmera, e um classificador que sempre devolve alguma coisa
 * é um classificador que liga captura por engano.
 */
export function classificarPercepcao(bruto: string): AcaoDePercepcao | null {
  const t = normalizar(bruto ?? '');
  if (PEDE_PARAR.test(t)) return 'encerrar';
  if (PERGUNTA_SE_OBSERVA.test(t)) return 'situacao';
  if (AUTORIZA_OBSERVACAO.test(t)) return 'autorizar';
  if (PEDE_OBSERVACAO.test(t)) return 'solicitar';
  return null;
}

/**
 * O nome do programa citado na frase: `pode observar o chrome` → `chrome`.
 *
 * `null` quando a frase não nomeia nenhum, e quem chama TEM de tratar isso — a
 * autorização sem escopo é recusada. Este é o ponto em que seria fácil e errado
 * inventar um padrão ("deve ser o GW"): observar o programa errado é observar
 * uma janela que ninguém autorizou.
 *
 * As palavras de ligação ficam de fora por lista, não por heurística: `a`, `o`,
 * `minha` e companhia apareceriam como "nome do programa" e virariam escopo.
 */
const LIGACOES = new Set([
  'a',
  'o',
  'as',
  'os',
  'meu',
  'minha',
  'esse',
  'essa',
  'este',
  'esta',
  'tela',
  'janela',
  'programa',
  'sistema',
  'aqui',
  'agora',
  'sim',
]);

export function extrairAplicativo(bruto: string): string | null {
  const t = normalizar(bruto ?? '');
  const m = /\b(?:observar|acompanhar|olhar|ver|assistir)\s+((?:\w+\s+){0,2}?)([a-z][a-z0-9._-]{1,30})\b/.exec(t);
  if (!m) return null;
  const candidato = m[2];
  if (LIGACOES.has(candidato)) return null;
  /**
   * Um número não é nome de programa. O piso de tamanho é DUAS letras, e o
   * primeiro valor escrito aqui foi três — o que recusava `gw`, o nome do
   * próprio sistema que esta capacidade existe para observar.
   *
   * O teste de segurança pegou isso antes de qualquer pessoa: "pode observar o
   * gw" abria pedido e não abria sessão, em silêncio. Quem filtra palavra de
   * ligação é a lista `LIGACOES`, que é explícita; tamanho é um proxy ruim para
   * ela, e um proxy ruim ajustado no olho recusa justamente o caso principal.
   */
  if (/^\d/.test(candidato) || candidato.length < 2) return null;
  return candidato;
}
