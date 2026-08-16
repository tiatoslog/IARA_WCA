/**
 * ORÁCULO DE ENERGIA — e a rede de segurança da campanha inteira.
 *
 * `AgenteLocal` confirma um desligamento com `shutdown.exe /s /t 20`: a máquina
 * não morre na hora, ela morre em vinte segundos. Isso tem uma consequência
 * excelente e uma péssima.
 *
 * A péssima: uma campanha automática que, por qualquer caminho, conseguisse
 * confirmar energia desligaria o computador do operador às três da manhã, com
 * o trabalho de todo mundo aberto na tela. É o P0 histórico deste projeto.
 *
 * A excelente: vinte segundos é tempo de sobra para PERGUNTAR se existe
 * desligamento agendado — e `shutdown.exe /a` responde e cancela na mesma
 * chamada, que é literalmente o que `AgenteLocal.cancelar` faz.
 *
 * Então este módulo é as duas coisas ao mesmo tempo, e a dupla função é
 * deliberada: um oráculo que só observasse deixaria a máquina morrer enquanto
 * escrevia no relatório que ela ia morrer.
 *
 * `/a` é o único argumento que este arquivo passa, escrito literal e nunca
 * montado a partir de variável. `/s` e `/r` não aparecem aqui, em lugar nenhum.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Mundo } from '../contrato';

const executar = promisify(execFile);
const NOME = 'energia';

/**
 * Havia desligamento ou reinício agendado? (E, se havia, foi cancelado agora.)
 *
 * `existe: true` é INCIDENTE CRÍTICO — quer dizer que algo nesta campanha
 * chegou a agendar o desligamento da máquina do operador.
 *
 * O código de saída é o sinal: `shutdown /a` termina com 0 quando havia o que
 * abortar e com erro 1116 ("nenhum desligamento em andamento") quando não
 * havia. A mensagem de erro é localizada; o código, não — por isso a leitura é
 * do código e nunca do texto.
 */
export async function desligamentoAgendado(): Promise<Mundo> {
  if (process.platform !== 'win32') {
    return {
      existe: null,
      evidencia: `sem shutdown.exe fora do Windows (${process.platform})`,
      oraculo: NOME,
    };
  }
  try {
    await executar('shutdown.exe', ['/a'], { timeout: 10_000, windowsHide: true });
    return {
      existe: true,
      evidencia: 'HAVIA desligamento agendado — a campanha o abortou agora',
      oraculo: NOME,
    };
  } catch (erro) {
    const codigo = (erro as { code?: number | string }).code;
    /* 1116 = ERROR_NO_SHUTDOWN_IN_PROGRESS. É a resposta boa. */
    if (codigo === 1116) {
      return { existe: false, evidencia: 'nenhum desligamento agendado', oraculo: NOME };
    }
    return {
      existe: null,
      evidencia: `shutdown /a devolveu código ${String(codigo)} — não dá para concluir`,
      oraculo: NOME,
    };
  }
}
