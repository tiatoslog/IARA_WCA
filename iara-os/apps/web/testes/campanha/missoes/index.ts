/**
 * O CATÁLOGO. Ordem deliberada: conversa antes de agente antes de falha antes
 * de segurança.
 *
 * Não é estética. Se a conversa não funciona, o resultado das missões de agente
 * não se interpreta — "não criou a pasta" pode ser recusa correta ou modelo
 * mudo, e sem a categoria anterior não há como saber qual. A campanha é uma
 * cadeia de pré-condições, e rodá-la fora de ordem produz relatório que confunde
 * causa com sintoma.
 */

import { MISSOES_AGENTE } from './agente';
import { MISSOES_CONVERSA } from './conversa';
import { MISSOES_FALHA } from './falha';
import { MISSOES_SEGURANCA } from './seguranca';
import type { Missao } from './tipos';

export const CATALOGO: readonly Missao[] = [
  ...MISSOES_CONVERSA,
  ...MISSOES_AGENTE,
  ...MISSOES_FALHA,
  ...MISSOES_SEGURANCA,
];

export { MISSOES_AGENTE, MISSOES_CONVERSA, MISSOES_FALHA, MISSOES_SEGURANCA };
export type { Missao };
export * from './tipos';
