/**
 * QUAL DOS TRÊS PROGRAMAS ESTE PROCESSO É?
 *
 * Um binário só é instalador, supervisor e runtime. Errar o papel não produz um
 * erro — produz um comportamento plausível e errado: um `npm run braco` que
 * registra tarefa agendada e copia o `node.exe` do sistema para dentro de
 * `%LOCALAPPDATA%\IARA\braco`, ou um duplo clique que roda o braço de dentro de
 * Downloads e some no próximo reboot (que foi o defeito real, até 21/08/2026).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { papelDoProcesso } from '../servidor/braco/papel';

test('BP-01. duplo clique no executável baixado: INSTALAR', () => {
  assert.equal(papelDoProcesso({ argumentos: [], empacotado: true }), 'instalar');
});

test('BP-02. `npm run braco` nunca instala nada', () => {
  /**
   * O caso que precisa ser impossível. Sob `tsx`, `process.execPath` é o
   * `node.exe` de quem está desenvolvendo — instalar dali copiaria o Node do
   * sistema para a pasta da IARA e agendaria o Windows para iniciá-lo no logon.
   * Um estrago silencioso na máquina errada.
   */
  assert.equal(papelDoProcesso({ argumentos: [], empacotado: false }), 'runtime');
});

test('BP-03. a tarefa agendada chama `--supervisor`', () => {
  assert.equal(papelDoProcesso({ argumentos: ['--supervisor'], empacotado: true }), 'supervisor');
});

test('BP-04. o supervisor sobe o runtime com `--runtime`', () => {
  assert.equal(papelDoProcesso({ argumentos: ['--runtime'], empacotado: true }), 'runtime');
});

test('BP-05. o argumento explícito vale mesmo sem empacotar', () => {
  /**
   * É o que permite exercitar supervisor e runtime num terminal de
   * desenvolvimento sem empacotar primeiro. Sem isto, a única forma de rodar o
   * supervisor seria gerar um `.exe` — e o que não é fácil de rodar não é
   * exercitado.
   */
  assert.equal(papelDoProcesso({ argumentos: ['--supervisor'], empacotado: false }), 'supervisor');
  assert.equal(papelDoProcesso({ argumentos: ['--runtime'], empacotado: false }), 'runtime');
});

test('BP-06. argumento desconhecido não muda o papel', () => {
  /**
   * `--verbose`, `--debug`, o que o Windows resolver anexar. Nada disso pode
   * fazer um instalador virar runtime por engano.
   */
  assert.equal(papelDoProcesso({ argumentos: ['--verbose'], empacotado: true }), 'instalar');
  assert.equal(papelDoProcesso({ argumentos: ['--x', '--runtime'], empacotado: true }), 'runtime');
});
