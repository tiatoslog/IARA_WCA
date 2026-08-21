/**
 * DOIS BYTES QUE DECIDEM SE A OPERADORA CONSEGUE MATAR O BRAÇO.
 *
 * Em 21/08/2026 a tarefa agendada iniciava `supervisor.exe` e o Windows abria
 * uma janela de console preta na tela. Fechá-la mata o supervisor, o supervisor
 * leva o runtime junto, e o braço só volta no próximo logon. Um clique num "X"
 * derrubava a infraestrutura inteira.
 *
 * `windowsHide` não alcança essa rota — quem cria o processo é o Agendador, e
 * ele não aceita flag de janela. Esconder, minimizar ou mandar para trás seriam
 * apostas em ninguém clicar. O que resolve é o binário não PEDIR console:
 * `Subsystem` de `WINDOWS_CUI` (3) para `WINDOWS_GUI` (2), a mesma diferença
 * entre `python.exe` e `pythonw.exe`.
 *
 * ================= POR QUE ESTES TESTES SÃO PARANOICOS =================
 *
 * Escrever no lugar errado de um `.exe` de 82 MB não produz uma janela feia:
 * produz um binário que não carrega, e o sintoma é um braço que nunca mais
 * sobe. O caminho de recusa importa tanto quanto o de conversão, e por isso a
 * maior parte daqui exercita arquivos que NÃO devem ser tocados.
 */

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  deslocamentoDoSubsistema,
  subsistemaAtual,
  SUBSISTEMA_CONSOLE,
  SUBSISTEMA_JANELA,
  tornarSemConsole,
} from '../servidor/braco/pe';

/**
 * Um PE mínimo, montado à mão. Não é um executável que roda — é um arquivo com
 * os campos de cabeçalho que o patch precisa encontrar, e nada mais. Montar em
 * vez de embutir um `.exe` de verdade mantém o teste legível e deixa explícito
 * QUAL byte importa.
 */
function pe(opcoes: { magic?: number; subsistema?: number; inicioPe?: number } = {}): Buffer {
  const inicioPe = opcoes.inicioPe ?? 0x80;
  const b = Buffer.alloc(1024);
  b.writeUInt16LE(0x5a4d, 0); // 'MZ'
  b.writeUInt32LE(inicioPe, 0x3c); // e_lfanew
  b.writeUInt32LE(0x0000_4550, inicioPe); // 'PE\0\0'
  const optional = inicioPe + 4 + 20; // depois do COFF header
  b.writeUInt16LE(opcoes.magic ?? 0x20b, optional); // PE32+ por padrão
  b.writeUInt16LE(opcoes.subsistema ?? SUBSISTEMA_CONSOLE, optional + 68);
  return b;
}

const emDisco = (buf: Buffer): string => {
  const arquivo = path.join(mkdtempSync(path.join(tmpdir(), 'iara-pe-')), 'alvo.exe');
  writeFileSync(arquivo, buf);
  return arquivo;
};

// ===========================================================================
// 1. Onde fica o campo
// ===========================================================================

test('PE-01. o deslocamento é 68 em PE32 e em PE32+', () => {
  /**
   * Não é coincidência nem sorte: os dois formatos divergem só até `ImageBase`
   * — PE32+ o tem com 8 bytes e não tem `BaseOfData` — e voltam a coincidir em
   * `SectionAlignment`, no deslocamento 32. Daí em diante os campos são
   * idênticos. Este teste existe para que ninguém "corrija" isso para dois
   * deslocamentos diferentes achando que está sendo cuidadoso.
   */
  const a = deslocamentoDoSubsistema(pe({ magic: 0x10b }));
  const b = deslocamentoDoSubsistema(pe({ magic: 0x20b }));
  assert.equal(a, b);
  assert.equal(a, 0x80 + 4 + 20 + 68);
});

// ===========================================================================
// 2. A conversão
// ===========================================================================

test('PE-02. console vira GUI, e a leitura confirma', () => {
  const arquivo = emDisco(pe({ subsistema: SUBSISTEMA_CONSOLE }));
  assert.equal(subsistemaAtual(arquivo), SUBSISTEMA_CONSOLE);

  assert.equal(tornarSemConsole(arquivo), 'convertido');
  assert.equal(subsistemaAtual(arquivo), SUBSISTEMA_JANELA);
});

test('PE-03. IDEMPOTENTE: a segunda passagem não escreve nada', () => {
  /**
   * A instalação chama isto a cada reparo, e a operadora repara por hábito. Um
   * patch que só funcionasse uma vez seria um conserto que quebra na segunda
   * tentativa — a classe de defeito que a instalação inteira existe para não
   * repetir.
   */
  const arquivo = emDisco(pe({ subsistema: SUBSISTEMA_CONSOLE }));
  tornarSemConsole(arquivo);
  const marca = statSync(arquivo).mtimeMs;
  const antes = readFileSync(arquivo);

  assert.equal(tornarSemConsole(arquivo), 'ja_sem_console');
  assert.equal(statSync(arquivo).mtimeMs, marca, 'reescreveu um arquivo que já estava certo');
  assert.deepEqual(readFileSync(arquivo), antes);
});

test('PE-04. só o campo do subsistema muda — mais nada', () => {
  /**
   * O invariante que protege o binário. Um `.exe` de 82 MB corrompido não
   * produz uma janela feia: produz um braço que não sobe, e o diagnóstico
   * disso é caro.
   */
  const original = pe({ subsistema: SUBSISTEMA_CONSOLE });
  const arquivo = emDisco(original);
  tornarSemConsole(arquivo);

  const depois = readFileSync(arquivo);
  const onde = deslocamentoDoSubsistema(original)!;
  const diferentes: number[] = [];
  for (let i = 0; i < original.length; i += 1) {
    if (original[i] !== depois[i]) diferentes.push(i);
  }
  assert.deepEqual(diferentes, [onde], `bytes alterados fora do campo: ${diferentes}`);
});

// ===========================================================================
// 3. A recusa — a metade que protege o executável
// ===========================================================================

test('PE-05. arquivo que não é PE: recusa sem escrever', () => {
  const arquivo = emDisco(Buffer.from('isto aqui é um texto qualquer, não um executável'));
  const antes = readFileSync(arquivo);
  assert.equal(tornarSemConsole(arquivo), 'formato_desconhecido');
  assert.deepEqual(readFileSync(arquivo), antes);
});

test('PE-06. tem MZ mas não tem assinatura PE: recusa', () => {
  const b = pe();
  b.writeUInt32LE(0xdead_beef, 0x80); // estraga o 'PE\0\0'
  const arquivo = emDisco(b);
  assert.equal(tornarSemConsole(arquivo), 'formato_desconhecido');
});

test('PE-07. Optional Header com magic desconhecido: recusa', () => {
  /* Nem PE32 nem PE32+. Escrever no deslocamento 68 seria adivinhar sobre um
     arquivo que não é o que eu penso que é. */
  const arquivo = emDisco(pe({ magic: 0x0107 }));
  assert.equal(tornarSemConsole(arquivo), 'formato_desconhecido');
});

test('PE-08. subsistema exótico (nativo, EFI) NÃO é convertido', () => {
  /**
   * `1` é `NATIVE` — driver. Converter às cegas qualquer coisa que não seja GUI
   * seria tratar "não é console" como "deve virar GUI", e as duas afirmações
   * não são a mesma.
   */
  const arquivo = emDisco(pe({ subsistema: 1 }));
  assert.equal(tornarSemConsole(arquivo), 'formato_desconhecido');
  assert.equal(subsistemaAtual(arquivo), 1, 'o campo foi tocado');
});

test('PE-09. e_lfanew apontando para fora do arquivo: recusa', () => {
  const b = pe();
  b.writeUInt32LE(0xffff_0000, 0x3c);
  const arquivo = emDisco(b);
  assert.equal(tornarSemConsole(arquivo), 'formato_desconhecido');
});

test('PE-10. arquivo ausente: `sem_acesso`, nunca exceção', () => {
  /**
   * A instalação chama isto e NÃO pode ser derrubada por ele. Um braço com
   * janela preta é um incômodo; um computador sem braço é o problema que este
   * trabalho inteiro existe para acabar.
   */
  assert.equal(tornarSemConsole(path.join(tmpdir(), 'nao-existe-mesmo-12345.exe')), 'sem_acesso');
  assert.equal(subsistemaAtual(path.join(tmpdir(), 'nao-existe-mesmo-12345.exe')), null);
});
