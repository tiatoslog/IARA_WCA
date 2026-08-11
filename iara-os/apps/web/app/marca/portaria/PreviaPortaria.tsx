'use client';

import { Portaria } from '../../../components/Portaria';

/**
 * A casca cliente da prévia.
 *
 * Existe porque `aoEntrar` é uma FUNÇÃO, e função não atravessa a fronteira de
 * um componente de servidor para um de cliente. A página continua sendo de
 * servidor — é ela que precisa decidir o `notFound()` em produção — e a função
 * nasce deste lado, onde ela pode existir.
 */
export function PreviaPortaria() {
  return <Portaria aoEntrar={() => undefined} />;
}
