/**
 * Registro de habilidades.
 *
 * Este arquivo é a ÚNICA coisa que muda ao adicionar uma capacidade nova.
 * Nem o Kernel, nem a Função Executiva, nem o Planejador, nem a projeção.
 *
 * O procedimento inteiro:
 *   1. criar o arquivo da habilidade exportando um `Habilidade`
 *   2. importar aqui e somar à lista
 *
 * Se algum dia adicionar capacidade exigir tocar em outro arquivo do kernel,
 * a arquitetura regrediu.
 */

import type { Habilidade } from '../Habilidade';
import { HABILIDADES_OPERACIONAIS, prepararOperacionais } from './operacionais';
import { HABILIDADES_DADOS } from './dados';
import { HABILIDADES_INTEGRACAO } from './integracoes';
import { HABILIDADES_CALENDARIO } from './calendario';
import { HABILIDADES_AGENTE_LOCAL } from './agenteLocal';
import { HABILIDADES_AGENTE_CODIGO } from './agenteCodigo';
import { HABILIDADES_AGENDA } from './agenda';
import { HABILIDADES_DIAGNOSTICO } from './diagnostico';
import { HABILIDADES_INVESTIGACAO } from './investigacao';
import { HABILIDADES_AUDITORIA } from './auditoria';
import { HABILIDADES_PLANILHA_OCIS } from './cargasLuft';
import { HABILIDADES_PLANILHA_GENERICA } from './planilhaGenerica';

export const CATALOGO: readonly Habilidade[] = [
  ...HABILIDADES_OPERACIONAIS,
  ...HABILIDADES_DADOS,
  ...HABILIDADES_INTEGRACAO,
  ...HABILIDADES_CALENDARIO,
  ...HABILIDADES_AGENTE_LOCAL,
  ...HABILIDADES_AGENTE_CODIGO,
  ...HABILIDADES_AGENDA,
  ...HABILIDADES_DIAGNOSTICO,
  ...HABILIDADES_INVESTIGACAO,
  ...HABILIDADES_AUDITORIA,
  ...HABILIDADES_PLANILHA_OCIS,
  ...HABILIDADES_PLANILHA_GENERICA,
];

export { prepararOperacionais };
