/**
 * ORÁCULO DE PROCESSO — pergunta ao SISTEMA OPERACIONAL quem está rodando.
 *
 * "Abri o Bloco de Notas" é a alegação mais fácil de fazer e a mais cara de
 * verificar por dentro: `spawn` que retorna sem erro só prova que o Windows
 * aceitou o pedido, não que uma janela existe. `AgenteLocal.abrirAplicativo` já
 * faz essa distinção com honestidade rara — mas quem confere é o mesmo processo
 * que pediu. Aqui a pergunta vai para o `tasklist`, que não conhece a IARA.
 *
 * SOBRE `execFile` E A FRONTEIRA DE EFEITOS: `testes/fronteira-efeitos.test.ts`
 * confina `execFile`/`spawn` ao `AgenteLocal`, e essa regra vale para
 * `servidor/` — que é o que ela varre. Um oráculo de campanha PRECISA falar com
 * o sistema operacional; é literalmente a razão de ele existir. Ele mora em
 * `testes/`, fora do alcance da regra, e não é importado por nada de `servidor/`
 * — o que `testes/campanha-fronteira.test.ts` confere para que essa separação
 * não dependa de boa vontade.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Mundo } from '../contrato';

const executar = promisify(execFile);
const NOME = 'processo';

/** Teto curto: um `tasklist` que demora mais que isto é a máquina em apuros. */
const PRAZO_MS = 15_000;

/**
 * O executável está rodando AGORA?
 *
 * Sem `/FI` de filtro por nome de propósito: o filtro do `tasklist` devolve
 * código de saída 0 e a frase "Nenhuma tarefa..." (localizada!) quando não
 * encontra nada, e casar essa frase significaria depender do idioma do Windows
 * da máquina. Listar tudo em CSV e procurar o nome é mais bruto e não mente em
 * português.
 */
export async function processoAtivo(executavel: string): Promise<Mundo> {
  if (process.platform !== 'win32') {
    return {
      existe: null,
      evidencia: `oráculo de processo só sabe olhar Windows; aqui é ${process.platform}`,
      oraculo: NOME,
    };
  }
  const alvo = executavel.toLowerCase();
  try {
    const { stdout } = await executar('tasklist', ['/FO', 'CSV', '/NH'], {
      timeout: PRAZO_MS,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
    });
    /**
     * O nome vem no PRIMEIRO campo, entre aspas. Procurar a substring no texto
     * inteiro casaria o nome do executável aparecendo dentro do título de outra
     * janela ou num caminho de linha de comando — falso positivo do oráculo, que
     * é o pior defeito que um oráculo pode ter.
     */
    const linhas = stdout.split('\n');
    const achou = linhas.some((l) => {
      const m = /^"([^"]+)"/.exec(l.trim());
      return m ? m[1].toLowerCase() === alvo : false;
    });
    return achou
      ? { existe: true, evidencia: `${executavel} presente na tabela de processos`, oraculo: NOME }
      : {
          existe: false,
          evidencia: `${executavel} ausente entre ${linhas.length} processos listados`,
          oraculo: NOME,
        };
  } catch (erro) {
    /**
     * `tasklist` indisponível, negado por política ou estourando o prazo é a
     * campanha cega — nunca "o programa não abriu". Ver a regra de ouro em
     * `OraculoDisco`.
     */
    return {
      existe: null,
      evidencia: `não consegui consultar a tabela de processos: ${(erro as Error).message.slice(0, 120)}`,
      oraculo: NOME,
    };
  }
}

/**
 * A porta TCP está escutando?
 *
 * Serve para provar que o motor da campanha subiu de verdade e, na fase de
 * recuperação, que ele MORREU de verdade — "matei o processo" é uma alegação
 * como qualquer outra e merece o mesmo ceticismo.
 */
export async function portaEscutando(porta: number): Promise<Mundo> {
  const { createConnection } = await import('node:net');
  return new Promise<Mundo>((resolver) => {
    const socket = createConnection({ host: '127.0.0.1', port: porta });
    const encerrar = (m: Mundo) => {
      socket.removeAllListeners();
      socket.destroy();
      resolver(m);
    };
    socket.setTimeout(3000);
    socket.on('connect', () =>
      encerrar({ existe: true, evidencia: `porta ${porta} aceitou conexão`, oraculo: NOME }),
    );
    socket.on('timeout', () =>
      encerrar({
        existe: null,
        evidencia: `porta ${porta} não respondeu em 3 s — nem aceite nem recusa`,
        oraculo: NOME,
      }),
    );
    socket.on('error', (e: NodeJS.ErrnoException) =>
      encerrar(
        e.code === 'ECONNREFUSED'
          ? { existe: false, evidencia: `porta ${porta} recusou conexão`, oraculo: NOME }
          : {
              existe: null,
              evidencia: `porta ${porta} devolveu ${e.code ?? e.message}`,
              oraculo: NOME,
            },
      ),
    );
  });
}
