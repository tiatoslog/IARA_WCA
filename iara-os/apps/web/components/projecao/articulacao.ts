'use client';

/**
 * A DECISÃO DE ARTICULAÇÃO — uma só, para as duas projeções.
 *
 * Existiam duas cópias desta lógica: uma no `ControladorFacial` (a boca do
 * avatar) e outra no `ControladorEntidade` (a energia das ondas da entidade).
 * As duas respondiam a mesma pergunta — "onde a fala está agora?" — e as duas
 * carregavam o MESMO defeito, porque o defeito foi copiado junto com a regra:
 *
 *     const fracaoDaVoz = voz?.progresso() ?? null;
 *     if (fracaoDaVoz === null && fala.concluida) → sem articulação
 *
 * `progresso()` devolve `null` durante TODA a síntese do navegador — ela não
 * tem linha do tempo para consultar. Então, no caminho sem áudio do servidor,
 * as duas projeções paravam de articular no instante em que o texto era
 * concluído e ficavam paradas enquanto a IARA falava a resposta inteira em voz
 * alta. A boca fechava no meio da frase; a entidade voltava à cor de repouso.
 *
 * Corrigir isso em dois arquivos deixaria duas cópias que podem divergir de
 * novo na próxima mudança. Um fato, um lugar: quem quiser saber onde a fala
 * está pergunta AQUI.
 *
 * O que este módulo NÃO faz: decidir como isso aparece. O avatar traduz o
 * visema em morph targets, a entidade traduz a abertura em energia de onda.
 * A tradução continua sendo de cada projeção — como sempre foi.
 */

import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import { visemaAgora, visemaNoProgresso, type Visema } from '../../lib/visemas';

/**
 * Onde a fala está agora, ou `null` quando não há fala acontecendo.
 *
 * A ordem das perguntas é o contrato:
 *
 *  1. Existe fala da IARA? Sem isso não há nada a articular — fala do operador
 *     não move o rosto dela.
 *  2. Ela ainda está acontecendo? Está, se ainda sai som (`audivel`) OU se o
 *     texto ainda está chegando (`!concluida`). Texto pronto e silêncio é o
 *     único caso em que o turno de fato acabou.
 *  3. Qual relógio manda? O do ÁUDIO quando existe — é o relógio verdadeiro,
 *     com as pausas e alongamentos que a locução realmente tem. A cadência de
 *     leitura é aproximação declarada, e só entra quando não há outro.
 *
 * A âncora da cadência de leitura é `audivelDesde()`, não a abertura do turno.
 * Ancorar na abertura fazia a articulação correr durante o tempo em que a IARA
 * ainda estava sintetizando, terminar antes de sair som, e deixar a fala
 * audível inteira sem movimento nenhum.
 */
export function visemaCorrente(
  trilha: Visema[],
  fala: Fala | null,
  voz: RelogioVoz | null,
  agora: number,
): Visema | null {
  if (!fala || fala.papel !== 'iara') return null;

  const audivel = voz?.audivel() ?? false;
  if (!audivel && fala.concluida) return null;

  const fracao = voz?.progresso() ?? null;
  if (fracao !== null) return visemaNoProgresso(trilha, fracao).visema;

  const desde = voz?.audivelDesde() ?? null;
  return visemaAgora(trilha, fala.texto.length, agora - (desde ?? fala.iniciada_em)).visema;
}
