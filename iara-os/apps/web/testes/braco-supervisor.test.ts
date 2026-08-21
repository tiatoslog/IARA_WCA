/**
 * O SUPERVISOR TEM DE SOBREVIVER AO RUNTIME — inclusive quando o runtime cai
 * de um jeito que ninguém previu.
 *
 * O que estes testes protegem é o motivo de o supervisor existir. Até
 * 21/08/2026 o braço se atualizava sozinho: escrevia um `.bat` que copiava o
 * executável novo por cima do `process.execPath` — o arquivo que o Windows
 * tinha acabado de abrir — tentando até 30 vezes até o lock soltar. Toda a
 * fragilidade daquele desenho vinha de UMA decisão: o processo que troca o
 * runtime era o próprio runtime.
 *
 * Aqui o runtime é um FILHO. Trocá-lo é copiar um arquivo que ninguém abriu.
 *
 * ================= POR QUE ESTES TESTES SÃO RÁPIDOS =================
 *
 * `esperar` e `agora` são injetados. Sem isso, exercitar o freio progressivo
 * levaria os 108 s que ele soma — e um teste que demora assim não roda, e um
 * teste que não roda não protege nada. O relógio é falso; o laço é o de verdade.
 */

import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import type { ChildProcess } from 'node:child_process';

import { supervisionar, type EstadoDoSupervisor } from '../servidor/braco/supervisor';

/** Uma pasta de instalação de mentira, com `atual.json` na versão pedida. */
function pastaComVersao(versao: string | null): string {
  const pasta = mkdtempSync(path.join(tmpdir(), 'iara-sup-'));
  if (versao !== null) {
    writeFileSync(
      path.join(pasta, 'atual.json'),
      JSON.stringify({ versao, versao_anterior: null, instalado_em: '2026-08-21T12:00:00.000Z' }),
      'utf8',
    );
  }
  return pasta;
}

/**
 * Um runtime de mentira: emite `exit` sozinho no próximo tique.
 *
 * Não é `spawn` de processo real de propósito. Subir 6 processos para exercitar
 * o freio traria o escalonador do Windows para dentro do teste, e o que está
 * sendo medido é a DECISÃO do supervisor, não a capacidade do SO de criar
 * processos.
 */
function runtimeQueMorre(codigo = 1): ChildProcess {
  const falso = new EventEmitter() as unknown as ChildProcess;
  (falso as { pid?: number }).pid = 4242;
  setImmediate(() => falso.emit('exit', codigo, null));
  return falso;
}

function runtimeQueNaoSobe(mensagem: string): ChildProcess {
  const falso = new EventEmitter() as unknown as ChildProcess;
  setImmediate(() => falso.emit('error', new Error(mensagem)));
  return falso;
}

/** Um relógio que a gente empurra à mão, para "viveu N ms" ser uma decisão do teste. */
function relogio(inicio = 1_000_000) {
  let t = inicio;
  return { agora: () => t, avancar: (ms: number) => (t += ms) };
}

function estadoEmDisco(pasta: string): EstadoDoSupervisor {
  return JSON.parse(readFileSync(path.join(pasta, 'supervisor.json'), 'utf8')) as EstadoDoSupervisor;
}

// ===========================================================================
// 1. Sem instalação completa ele PARA — e diz por quê
// ===========================================================================

test('SV-01. sem atual.json: não sobe nada e deixa o motivo em disco', async () => {
  /**
   * É o estado de uma instalação interrompida no meio (queda de energia, disco
   * cheio). Subir "alguma coisa" aqui seria adivinhar qual versão — e o
   * supervisor não adivinha. Ele para e escreve por quê, que é o que torna o
   * diagnóstico possível sem ninguém estar na frente da máquina.
   */
  const pasta = pastaComVersao(null);
  const iniciados: string[] = [];

  const fim = await supervisionar({
    pasta,
    iniciar: (exe) => {
      iniciados.push(exe);
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 5,
  });

  assert.equal(fim.runtime, 'sem_versao');
  assert.deepEqual(iniciados, [], 'subiu um executável sem saber qual versão é');
  assert.match(estadoEmDisco(pasta).ultima_saida ?? '', /atual\.json/);
});

// ===========================================================================
// 2. Quem ele sobe, e como
// ===========================================================================

test('SV-02. sobe o runtime da versão declarada em atual.json', async () => {
  const pasta = pastaComVersao('1.3.0');
  const iniciados: string[] = [];

  await supervisionar({
    pasta,
    iniciar: (exe) => {
      iniciados.push(exe);
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 1,
  });

  assert.equal(iniciados.length, 1);
  assert.equal(iniciados[0], path.join(pasta, 'versoes', '1.3.0', 'iara-braco.exe'));
});

test('SV-03. o supervisor NUNCA sobe a si mesmo', async () => {
  /**
   * O laço infinito mais fácil de escrever por engano neste arquivo: apontar
   * para `supervisor.exe` e criar uma árvore de supervisores supervisionando
   * supervisores. O caminho tem de conter a versão — o supervisor mora na raiz.
   */
  const pasta = pastaComVersao('1.3.0');
  const iniciados: string[] = [];

  await supervisionar({
    pasta,
    iniciar: (exe) => {
      iniciados.push(exe);
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 1,
  });

  assert.ok(!iniciados[0].endsWith('supervisor.exe'), 'o supervisor subiu a si mesmo');
  assert.ok(iniciados[0].includes(path.join('versoes', '1.3.0')));
});

// ===========================================================================
// 3. Ele reergue — e o freio tem forma
// ===========================================================================

test('SV-04. runtime que morre é reerguido', async () => {
  const pasta = pastaComVersao('1.3.0');
  let subidas = 0;

  const fim = await supervisionar({
    pasta,
    iniciar: () => {
      subidas += 1;
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 4,
  });

  assert.equal(subidas, 4);
  assert.equal(fim.reinicios, 4);
});

test('SV-05. quedas consecutivas na subida: o freio cresce e tem teto', async () => {
  /**
   * O caso real: binário corrompido ou versão incompatível. Sem freio isto é um
   * laço apertado que enche o disco de log e esquenta a máquina de quem está
   * trabalhando. O teto existe porque uma espera que cresce para sempre vira
   * "o braço nunca mais volta" depois de uma noite.
   */
  const pasta = pastaComVersao('1.3.0');
  const esperas: number[] = [];

  await supervisionar({
    pasta,
    iniciar: () => runtimeQueMorre(),
    esperar: async (ms) => {
      esperas.push(ms);
    },
    voltas: 8,
  });

  assert.deepEqual(esperas, [1_000, 2_000, 5_000, 10_000, 30_000, 60_000, 60_000, 60_000]);
});

test('SV-06. quem viveu o bastante zera o freio', async () => {
  /**
   * Um braço de pé há horas que cai por soluço de rede não é o mesmo defeito
   * que um binário que não sobe. Punir os dois igual faria o caso comum — e
   * recuperável — esperar um minuto por nada.
   */
  const pasta = pastaComVersao('1.3.0');
  const t = relogio();
  const esperas: number[] = [];
  let subidas = 0;

  await supervisionar({
    pasta,
    agora: t.agora,
    iniciar: () => {
      subidas += 1;
      /* A 3ª vida dura 5 minutos; as outras, um instante. */
      setImmediate(() => t.avancar(subidas === 3 ? 300_000 : 100));
      return runtimeQueMorre();
    },
    esperar: async (ms) => {
      esperas.push(ms);
    },
    voltas: 4,
  });

  /**
   * A 3ª espera é a que importa: depois de 5 minutos de pé, o freio volta ao
   * primeiro degrau em vez de continuar em 5 s. A 4ª sobe de novo porque aí sim
   * começou uma sequência nova de quedas rápidas.
   */
  assert.deepEqual(
    esperas,
    [1_000, 2_000, 1_000, 2_000],
    'a queda depois de 5 minutos de pé não zerou o freio',
  );
});

// ===========================================================================
// 4. Um `spawn` que falha é queda, não crash do supervisor
// ===========================================================================

test('SV-07. executável ausente derruba o runtime, não o supervisor', async () => {
  /**
   * `ENOENT` no `spawn` chega como evento `error`, não como `exit`. Tratar só
   * `exit` deixaria a promessa pendurada para sempre — o supervisor vivo,
   * parado, sem nunca reerguer nada. Fica de pé e sem braço: o pior desfecho,
   * porque não parece defeito de fora.
   */
  const pasta = pastaComVersao('1.3.0');
  let subidas = 0;

  const fim = await supervisionar({
    pasta,
    iniciar: () => {
      subidas += 1;
      return runtimeQueNaoSobe('spawn ENOENT');
    },
    esperar: async () => {},
    voltas: 3,
  });

  assert.equal(subidas, 3, 'o supervisor parou de tentar depois de um erro de spawn');
  assert.match(fim.ultima_saida ?? '', /ENOENT/);
});

// ===========================================================================
// 5. O estado em disco é o que o diagnóstico lê
// ===========================================================================

test('SV-08. supervisor.json acompanha o ciclo e guarda o pid', async () => {
  const pasta = pastaComVersao('1.3.0');

  await supervisionar({
    pasta,
    iniciar: () => runtimeQueMorre(3),
    esperar: async () => {},
    voltas: 2,
  });

  const estado = estadoEmDisco(pasta);
  assert.equal(estado.runtime, 'caiu');
  assert.equal(estado.versao, '1.3.0');
  assert.equal(estado.reinicios, 2);
  assert.match(estado.ultima_saida ?? '', /código 3/);
});

test('SV-09. o pid do runtime vivo aparece em disco', async () => {
  /**
   * É o que permite a alguém — ou à própria IARA — cruzar "o supervisor acha
   * que tem um runtime" com "o SO tem esse processo". Sem o pid, a única prova
   * de vida seria a palavra do supervisor sobre si mesmo.
   */
  const pasta = pastaComVersao('1.3.0');
  let visto: number | null = null;

  await supervisionar({
    pasta,
    iniciar: () => {
      /* Lê o disco DEPOIS de o supervisor ter anotado 'vivo'. */
      setImmediate(() => {
        visto = estadoEmDisco(pasta).pid;
      });
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 1,
  });

  assert.equal(visto, 4242);
});

// ===========================================================================
// 6. A base do auto-update: a versão é relida a cada volta
// ===========================================================================

test('SV-10. atual.json reescrito entre quedas: a volta seguinte sobe a versão NOVA', async () => {
  /**
   * É o mecanismo inteiro da atualização, e a razão de `lerEstadoInstalado`
   * estar DENTRO do laço em vez de antes dele. Trocar de versão passa a ser:
   * escrever a pasta nova, apontar `atual.json`, derrubar o runtime. Nenhum
   * `.bat` de retry, nenhum arquivo sobrescrito com lock — porque o supervisor
   * nunca abriu o arquivo que está sendo trocado.
   *
   * Ler a versão uma vez só, fora do laço, faria o supervisor reerguer a versão
   * velha para sempre, e a atualização "funcionaria" até o próximo reboot.
   */
  const pasta = pastaComVersao('1.3.0');
  const iniciados: string[] = [];

  await supervisionar({
    pasta,
    iniciar: (exe) => {
      iniciados.push(exe);
      if (iniciados.length === 1) {
        writeFileSync(
          path.join(pasta, 'atual.json'),
          JSON.stringify({ versao: '1.4.0', versao_anterior: '1.3.0', instalado_em: 'x' }),
          'utf8',
        );
      }
      return runtimeQueMorre();
    },
    esperar: async () => {},
    voltas: 2,
  });

  assert.ok(iniciados[0].includes('1.3.0'));
  assert.ok(iniciados[1].includes('1.4.0'), 'o supervisor reergueu a versão velha depois da troca');
});
