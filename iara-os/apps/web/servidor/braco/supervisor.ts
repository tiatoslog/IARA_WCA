/**
 * O SUPERVISOR — quem mantém o braço vivo, e quem sobrevive a ele.
 *
 * POR QUE ELE EXISTE, e a razão é de arquitetura e não de conforto: até
 * 21/08/2026 o próprio runtime tentava se atualizar. `religarComVersaoNova`
 * escrevia um `.bat` que copiava o executável novo POR CIMA do
 * `process.execPath` — o arquivo que o Windows tinha acabado de abrir — num
 * laço de até 30 tentativas esperando o lock soltar. Funciona quando funciona,
 * e a auditoria nomeou o problema com precisão:
 *
 *     "o processo responsável por atualizar o runtime NÃO deve depender do
 *      próprio runtime para substituir a si mesmo."
 *
 * Com o supervisor, a substituição deixa de ser acrobacia: são dois arquivos
 * diferentes no disco, e o Windows só tranca o que está em execução.
 *
 * ================= O QUE ELE FAZ, E O QUE ELE NÃO FAZ =================
 *
 * FAZ: inicia o runtime, observa, reinicia quando ele morre, escreve o estado
 * num arquivo que o diagnóstico lê.
 *
 * NÃO FAZ: conectar ao motor, executar ordem, conhecer a IARA. O supervisor não
 * tem WebSocket, não tem credencial e não sabe o que é uma habilidade. Ele
 * cuida de UM processo. Dar a ele qualquer competência de produto seria criar
 * um segundo lugar onde o braço existe.
 *
 * ================= O REINÍCIO TEM FREIO =================
 *
 * Um runtime que morre na subida — binário corrompido, versão incompatível,
 * porta ocupada — reiniciaria mil vezes por minuto e encheria o disco de log
 * enquanto esquenta o processador de quem está trabalhando. O freio é
 * progressivo e tem teto; e um runtime que VIVEU tempo suficiente zera a
 * contagem, porque uma queda depois de horas de pé não é o mesmo defeito que
 * uma queda no primeiro segundo.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { lerEstadoInstalado, pastaDeInstalacao } from './instalacao';

/** Espera antes de reerguer, por tentativa consecutiva. Ver o cabeçalho. */
const FREIO_MS = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000] as const;

/**
 * Viveu mais que isto? A queda não é de subida — zera o freio.
 *
 * Trinta segundos porque é mais que o suficiente para conectar, autenticar e
 * registrar: um processo que passou disso estava FUNCIONANDO, e punir a próxima
 * queda dele com um minuto de espera transformaria um soluço de rede em braço
 * ausente.
 */
const VIVEU_O_BASTANTE_MS = 30_000;

export interface EstadoDoSupervisor {
  readonly versao: string | null;
  /** O pid DESTE processo. É por ele que o instalador pergunta se já há
   *  supervisor de pé antes de subir um segundo. */
  readonly pid_supervisor: number;
  readonly runtime: 'iniciando' | 'vivo' | 'caiu' | 'sem_versao';
  readonly pid: number | null;
  readonly reinicios: number;
  readonly ultima_saida: string | null;
  readonly desde: string;
}

/**
 * O estado vai para DISCO, e não só para o log.
 *
 * É o que permite responder "por que o braço não está lá?" sem depender de o
 * processo estar vivo para perguntar — que é exatamente a situação em que a
 * pergunta é feita. O diagnóstico da IARA lê este arquivo.
 */
function escreverEstado(pasta: string, estado: EstadoDoSupervisor): void {
  try {
    mkdirSync(pasta, { recursive: true });
    writeFileSync(path.join(pasta, 'supervisor.json'), JSON.stringify(estado, null, 2), 'utf8');
  } catch {
    /* Não conseguir escrever o estado não pode derrubar o supervisor: o
       trabalho dele é manter o braço de pé, e isso continua possível. */
  }
}

export interface OpcoesDoSupervisor {
  readonly pasta?: string;
  /** Injetado no teste: sobe um processo de mentira em vez do runtime real. */
  readonly iniciar?: (executavel: string) => ChildProcess;
  /** Injetado no teste para não esperar de verdade. */
  readonly esperar?: (ms: number) => Promise<void>;
  /** Quantas vezes reerguer antes de devolver o controle. `Infinity` em produção. */
  readonly voltas?: number;
  readonly agora?: () => number;
}

const dormir = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

/**
 * O laço. Devolve o estado final — em produção nunca devolve, porque `voltas` é
 * infinito; no teste devolve depois de N reinícios.
 */
export async function supervisionar(opcoes: OpcoesDoSupervisor = {}): Promise<EstadoDoSupervisor> {
  const pasta = opcoes.pasta ?? pastaDeInstalacao();
  const esperar = opcoes.esperar ?? dormir;
  const agora = opcoes.agora ?? Date.now;
  const teto = opcoes.voltas ?? Number.POSITIVE_INFINITY;

  let reinicios = 0;
  let consecutivas = 0;
  let ultima_saida: string | null = null;

  for (let volta = 0; volta < teto; volta += 1) {
    const instalado = lerEstadoInstalado(pasta);
    if (!instalado) {
      const estado: EstadoDoSupervisor = {
        versao: null,
        runtime: 'sem_versao',
        pid_supervisor: process.pid,
        pid: null,
        reinicios,
        ultima_saida: 'atual.json ausente — a instalação não terminou',
        desde: new Date(agora()).toISOString(),
      };
      escreverEstado(pasta, estado);
      return estado;
    }

    const executavel = path.join(pasta, 'versoes', instalado.versao, 'iara-braco.exe');
    const nasceu = agora();

    escreverEstado(pasta, {
      versao: instalado.versao,
      runtime: 'iniciando',
      pid_supervisor: process.pid,
      pid: null,
      reinicios,
      ultima_saida,
      desde: new Date(nasceu).toISOString(),
    });

    const filho = (opcoes.iniciar ?? padraoIniciar)(executavel);

    escreverEstado(pasta, {
      versao: instalado.versao,
      runtime: 'vivo',
      pid_supervisor: process.pid,
      pid: filho.pid ?? null,
      reinicios,
      ultima_saida,
      desde: new Date(nasceu).toISOString(),
    });

    const saida = await new Promise<string>((resolver) => {
      filho.once('exit', (codigo, sinal) =>
        resolver(sinal ? `sinal ${sinal}` : `código ${codigo ?? '?'}`),
      );
      filho.once('error', (e: Error) => resolver(`não subiu: ${e.message}`));
    });

    ultima_saida = saida;
    reinicios += 1;
    const viveu = agora() - nasceu;

    /**
     * Viveu o bastante? Então a queda não é de subida, e o freio recomeça.
     *
     * A ORDEM importa e já me custou dois testes vermelhos: zerar, USAR o
     * índice, e só então incrementar. Incrementar antes de usar pula o primeiro
     * degrau — a primeira queda esperaria 2 s, e o degrau de 1 s (o caso comum,
     * um tropeço isolado) nunca seria alcançado por queda nenhuma.
     */
    if (viveu >= VIVEU_O_BASTANTE_MS) consecutivas = 0;

    escreverEstado(pasta, {
      versao: instalado.versao,
      runtime: 'caiu',
      pid_supervisor: process.pid,
      pid: null,
      reinicios,
      ultima_saida: `${saida} depois de ${Math.round(viveu / 1000)}s`,
      desde: new Date(agora()).toISOString(),
    });

    const espera = FREIO_MS[Math.min(consecutivas, FREIO_MS.length - 1)];
    consecutivas += 1;
    console.log(
      `[supervisor] runtime ${instalado.versao} saiu (${saida}) depois de ${Math.round(viveu / 1000)}s; ` +
        `reerguendo em ${espera / 1000}s`,
    );
    await esperar(espera);
  }

  return {
    versao: lerEstadoInstalado(pasta)?.versao ?? null,
    runtime: 'caiu',
    pid_supervisor: process.pid,
    pid: null,
    reinicios,
    ultima_saida,
    desde: new Date(agora()).toISOString(),
  };
}

/**
 * `detached: false` e `stdio: 'inherit'` de propósito: o runtime é FILHO, e
 * matar o supervisor tem de levar o runtime junto. Um runtime órfão continuaria
 * conectado à IARA sem ninguém para reerguê-lo — e a máquina apareceria
 * saudável com um supervisor morto.
 */
function padraoIniciar(executavel: string): ChildProcess {
  return spawn(executavel, ['--runtime'], {
    stdio: 'inherit',
    windowsHide: true,
    detached: false,
  });
}
