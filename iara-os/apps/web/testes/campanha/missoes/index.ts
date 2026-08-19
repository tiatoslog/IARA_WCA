/**
 * O CATÁLOGO, e a ordem é a decisão mais importante deste arquivo.
 *
 * A campanha tem orçamento de tempo (ver `executar.ts`): quando ele acaba, ela
 * para de começar missões novas. **Logo a ordem do catálogo é a ordem de
 * prioridade**, e o que estiver no fim é o que não roda numa noite ruim.
 *
 * A primeira versão era conversa → agente → falha → segurança, com o argumento
 * de que conversa é pré-condição para interpretar o resto. O argumento era bom e
 * a ordem, perigosa: numa máquina lenta o orçamento estoura exatamente na
 * SEGURANÇA, e uma campanha que corta a categoria onde mora o risco entrega um
 * relatório tranquilizador sobre a parte que ninguém teme.
 *
 * A ordem de agora:
 *
 *  1. **agente** — rápido (rota determinística, dezenas de milissegundos) e
 *     prova que a cadeia inteira funciona. Cumpre o papel de pré-condição por
 *     um custo desprezível, que era o que a ordem anterior queria.
 *  2. **segurança** — onde o risco mora. Roda com o orçamento cheio.
 *  3. **falha** — importante, e cara: quase toda cai na rota cognitiva.
 *  4. **conversa** — a mais cara de todas (CO-08 sozinha são oito turnos) e a de
 *     menor severidade quando falha.
 */

import { MISSOES_AGENTE } from './agente';
import { MISSOES_CONVERSA } from './conversa';
import { MISSOES_FALHA } from './falha';
import { MISSOES_LACUNA } from './lacunas';
import { MISSOES_SEGURANCA } from './seguranca';
import { MISSOES_VALOR } from './valor';
import type { Missao } from './tipos';

export const CATALOGO: readonly Missao[] = [
  /* VALOR VEM PRIMEIRO, e pela mesma lógica que pôs `agente` na frente antes:
     são as missões mais baratas do catálogo (uma fala, quase todas em rota
     determinística) e medem a família de defeito mais silenciosa — a resposta
     plausível e falsa. Numa noite ruim, é a última coisa que se pode perder. */
  ...MISSOES_VALOR,
  ...MISSOES_AGENTE,
  ...MISSOES_SEGURANCA,
  ...MISSOES_FALHA,
  /* Lacunas antes de conversa: são mais baratas (uma fala cada) e alimentam a
     fila de evolução, que é o que o operador lê primeiro de manhã. */
  ...MISSOES_LACUNA,
  ...MISSOES_CONVERSA,
];

export {
  MISSOES_AGENTE,
  MISSOES_CONVERSA,
  MISSOES_FALHA,
  MISSOES_LACUNA,
  MISSOES_SEGURANCA,
  MISSOES_VALOR,
};
export type { Missao };
export * from './tipos';
