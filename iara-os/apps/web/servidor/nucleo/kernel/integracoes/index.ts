/**
 * O catálogo de INTEGRAÇÕES — tudo que alcança um provedor externo.
 *
 * Uma integração é diferente de uma habilidade, e a distinção não é burocrática:
 *
 *   HABILIDADE  é uma capacidade que o operador pode PEDIR. Entra no catálogo
 *               oferecido ao planejamento, tem esquema de parâmetros, aparece no
 *               manifesto da interface.
 *   INTEGRAÇÃO  é um canal de EFEITO. Ninguém a "pede"; ela é usada por quem já
 *               tem uma operação autorizada nas mãos — inclusive por partes do
 *               sistema que não passam pelo laço de passos do Kernel, como o
 *               canal de resposta do WhatsApp.
 *
 * Foi exatamente essa segunda categoria que não existia, e por isso o canal
 * WhatsApp não tinha para onde ir a não ser chamar `fetch` direto.
 *
 * REGRA PARA QUEM ACRESCENTAR A PRÓXIMA (Graph, e-mail, ERP, webhook):
 * o adaptador vai neste diretório, é registrado aqui, e o cliente HTTP dele só
 * pode ser importado pelo próprio adaptador. `fronteira-efeitos.test.ts` falha
 * se alguém importar um cliente de provedor de qualquer outro lugar — inclusive
 * um arquivo novo que ainda não existe.
 */

import type { Integracao } from '../PortalEfeitos';
import { integracaoWhatsapp } from './whatsapp';

export { ID_WHATSAPP_RESPONDER } from './whatsapp';

export const INTEGRACOES: readonly Integracao[] = [integracaoWhatsapp];
