/**
 * O SUPERVISOR NÃO PODE TER JANELA — e a razão não é estética.
 *
 * O DEFEITO, observado em produção em 21/08/2026: a tarefa agendada iniciava
 * `supervisor.exe` e o Windows abria uma janela de console preta na tela da
 * operadora. Fechá-la mata o supervisor, o supervisor leva o runtime junto, e
 * o braço só volta no próximo logon. Um clique num "X" derruba a infraestrutura
 * inteira — e uma janela preta sem explicação convida exatamente esse clique.
 *
 * ================= POR QUE ESCONDER NÃO RESOLVE =================
 *
 * `windowsHide` do `spawn` funciona na rota do instalador e NÃO existe na rota
 * da tarefa agendada — lá quem cria o processo é o Agendador, e ele não aceita
 * flag de janela. Minimizar, mover para fora da tela ou mandar para trás são
 * todas a mesma aposta: a de que ninguém vai clicar. Isso não é arquitetura, é
 * torcida.
 *
 * A janela existe porque `supervisor.exe` é um binário do subsistema CONSOLE.
 * O Windows aloca um console para todo processo assim iniciado de forma
 * interativa. O caminho correto não é esconder a janela: é o processo NÃO
 * PEDIR console nenhum.
 *
 * ================= O QUE ESTE ARQUIVO FAZ =================
 *
 * Vira um bit do cabeçalho PE: `Subsystem` de `WINDOWS_CUI` (3) para
 * `WINDOWS_GUI` (2). É a mesma diferença entre `python.exe` e `pythonw.exe`,
 * entre `java.exe` e `javaw.exe` — dois programas idênticos, um dos quais o
 * Windows sabe que não deve enfeitar com um console.
 *
 * Dois bytes. Nenhuma linha de código do produto muda de comportamento: o
 * supervisor continua sendo o mesmo binário do runtime, com o papel decidido
 * por argumento. O que muda é o que o SO faz ao carregá-lo.
 *
 * ================= O QUE ISSO CUSTA, E COMO É PAGO =================
 *
 * Sem console, `process.stdout` não tem para onde escrever. Por isso a troca só
 * é segura DEPOIS de o supervisor registrar em arquivo — ver `registrar()` em
 * `supervisor.ts`. Trocar a ordem transformaria "a janela sumiu" em "a
 * observabilidade sumiu", que é trocar um defeito por outro pior, porque o
 * segundo não aparece na tela de ninguém.
 *
 * O CHECKSUM do PE fica inválido depois desta escrita, e isso é aceitável: o
 * Windows só valida checksum de driver e de alguns binários de sistema, nunca
 * de um `.exe` de usuário. Ele, aliás, JÁ estava inválido — o `postject` do
 * empacotamento SEA injeta o recurso sem recalcular.
 */

import { closeSync, openSync, readSync, writeSync } from 'node:fs';

/** Valores do campo `Subsystem` do Optional Header. */
export const SUBSISTEMA_CONSOLE = 3;
export const SUBSISTEMA_JANELA = 2;

export type ResultadoDoPatch =
  /** Era console e virou GUI. */
  | 'convertido'
  /** Já estava sem console — reinstalar não precisa fazer nada. */
  | 'ja_sem_console'
  /** Não é um PE que eu reconheça. Nada foi escrito. */
  | 'formato_desconhecido'
  /** Não consegui abrir ou escrever. Nada foi escrito. */
  | 'sem_acesso';

/**
 * Onde mora o campo `Subsystem`, dado o começo do arquivo.
 *
 * `null` quando o arquivo não é um PE reconhecível — e aí NADA é escrito. Um
 * patch às cegas num deslocamento fixo corromperia o executável em vez de
 * consertar a janela, e o sintoma seria um braço que não sobe mais.
 *
 * O deslocamento é 68 tanto em PE32 quanto em PE32+, e isso não é coincidência
 * nem sorte: os dois formatos divergem apenas até `ImageBase` (PE32+ o tem com
 * 8 bytes e não tem `BaseOfData`), e voltam a coincidir em `SectionAlignment`,
 * no deslocamento 32. Daí para a frente os campos são idênticos. A verificação
 * do `Magic` abaixo existe para garantir que estamos mesmo num dos dois.
 */
export function deslocamentoDoSubsistema(cabecalho: Buffer): number | null {
  /* 'MZ' — sem isto não é sequer um executável do DOS/Windows. */
  if (cabecalho.length < 0x40 || cabecalho.readUInt16LE(0) !== 0x5a4d) return null;

  const inicioPe = cabecalho.readUInt32LE(0x3c);
  if (inicioPe <= 0 || inicioPe + 0x18 + 0x46 > cabecalho.length) return null;

  /* 'PE\0\0' */
  if (cabecalho.readUInt32LE(inicioPe) !== 0x0000_4550) return null;

  /* COFF header tem 20 bytes; o Optional Header começa logo depois. */
  const optional = inicioPe + 4 + 20;
  const magic = cabecalho.readUInt16LE(optional);
  if (magic !== 0x10b && magic !== 0x20b) return null;

  return optional + 68;
}

/**
 * Tira o console do executável, no lugar.
 *
 * IDEMPOTENTE por construção: rodar de novo sobre um arquivo já convertido
 * devolve `ja_sem_console` e não escreve nada. A instalação chama isto a cada
 * reparo, e um patch que só funcionasse uma vez seria um reparo que quebra na
 * segunda tentativa — a classe de defeito que a instalação inteira existe para
 * não repetir.
 *
 * NUNCA LANÇA. Uma instalação que não conseguiu tirar o console continua
 * utilizável: o braço funciona, com uma janela preta a mais. Derrubar o
 * instalador por causa disso trocaria um incômodo por uma máquina sem braço.
 */
export function tornarSemConsole(caminho: string): ResultadoDoPatch {
  let fd: number | null = null;
  try {
    fd = openSync(caminho, 'r+');
    const cabecalho = Buffer.alloc(1024);
    const lidos = readSync(fd, cabecalho, 0, cabecalho.length, 0);
    const onde = deslocamentoDoSubsistema(cabecalho.subarray(0, lidos));
    if (onde === null) return 'formato_desconhecido';

    const atual = cabecalho.readUInt16LE(onde);
    if (atual === SUBSISTEMA_JANELA) return 'ja_sem_console';
    if (atual !== SUBSISTEMA_CONSOLE) {
      /* Nem console nem GUI: é um subsistema que eu não sei o que faz (nativo,
         EFI, POSIX). Mexer aqui seria adivinhar sobre um binário que não é o
         que eu penso que é. */
      return 'formato_desconhecido';
    }

    const novo = Buffer.alloc(2);
    novo.writeUInt16LE(SUBSISTEMA_JANELA, 0);
    writeSync(fd, novo, 0, 2, onde);
    return 'convertido';
  } catch {
    return 'sem_acesso';
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* fechar é melhor esforço */
      }
    }
  }
}

/** O que o arquivo declara AGORA. Serve à conferência e ao diagnóstico. */
export function subsistemaAtual(caminho: string): number | null {
  let fd: number | null = null;
  try {
    fd = openSync(caminho, 'r');
    const cabecalho = Buffer.alloc(1024);
    const lidos = readSync(fd, cabecalho, 0, cabecalho.length, 0);
    const onde = deslocamentoDoSubsistema(cabecalho.subarray(0, lidos));
    return onde === null ? null : cabecalho.readUInt16LE(onde);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* melhor esforço */
      }
    }
  }
}
