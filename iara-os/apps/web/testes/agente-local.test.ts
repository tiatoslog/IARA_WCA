/**
 * Testes do Agente Local — as fronteiras de segurança são o que se testa.
 *
 * O executor é injetado como stub: "confirmar desligamento" precisa ser
 * testável sem desligar a máquina de quem roda `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AgenteLocal,
  resolverAplicativo,
  resolverRaiz,
  validarNomePasta,
} from '../servidor/nucleo/AgenteLocal';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import {
  extrairAcaoEnergia,
  extrairLocalAutorizado,
  extrairNomePasta,
} from '../servidor/nucleo/kernel/Planejador';

/**
 * A conversa em que o pedido de energia nasce. Uma pendência é amarrada ao par
 * (operador, sessão): "confirmo" digitado em outro diálogo não a libera — ver
 * o caso "confirmação vinda de outra conversa" mais abaixo.
 */
const SESSAO = 's-agente-local';

// ---------------------------------------------------------------------------
// Fronteiras
// ---------------------------------------------------------------------------

test('nome de pasta: aceita nomes honestos, barra travessia e lixo', () => {
  assert.equal(validarNomePasta('Contratos'), 'Contratos');
  assert.equal(validarNomePasta('Relatórios 2026'), 'Relatórios 2026');
  assert.equal(validarNomePasta('..'), null);
  assert.equal(validarNomePasta('../segredos'), null);
  assert.equal(validarNomePasta('a/b'), null);
  assert.equal(validarNomePasta('con.'), null); // NTFS engole ponto final
  assert.equal(validarNomePasta('x'.repeat(61)), null);
  assert.equal(validarNomePasta('  '), null);
});

test('allowlist de aplicativos: reconhece autorizado, recusa o resto', () => {
  assert.equal(resolverAplicativo('abra o bloco de notas')?.comando, 'notepad.exe');
  assert.equal(resolverAplicativo('abre a calculadora aí')?.comando, 'calc.exe');
  assert.equal(resolverAplicativo('abra o chrome')?.rotulo, 'Google Chrome');
  assert.equal(resolverAplicativo('abra o regedit'), null);
  assert.equal(resolverAplicativo('rode o powershell'), null);
});

test('raiz autorizada resolve para caminho real da máquina', () => {
  const raiz = resolverRaiz('area_de_trabalho');
  assert.ok(raiz, 'esperava encontrar a Área de Trabalho');
});

// ---------------------------------------------------------------------------
// Energia — R2 com confirmação
// ---------------------------------------------------------------------------

test('energia nunca executa sem confirmação; confirmo executa; segunda vez não', () => {
  const executados: string[][] = [];
  const agente = new AgenteLocal((cmd, args) => executados.push([cmd, ...args]));

  const pedido = agente.pedirEnergia('daiane', 'desligar', SESSAO);
  assert.match(pedido, /confirmo/);
  assert.equal(executados.length, 0, 'pedir energia não pode executar nada');
  assert.ok(agente.temPendencia('daiane', SESSAO));

  const confirmacao = agente.confirmar('daiane', SESSAO);
  assert.match(confirmacao, /20 segundos/);
  assert.equal(executados.length, 1);
  assert.equal(executados[0][0], 'shutdown.exe');
  assert.equal(executados[0][1], '/s');

  // Pendência consumida: confirmar de novo não desliga de novo.
  const denovo = agente.confirmar('daiane', SESSAO);
  assert.match(denovo, /Não há nenhuma ação/);
  assert.equal(executados.length, 1);
});

test('confirmação de um operador não libera pendência de outro', () => {
  const executados: string[][] = [];
  const agente = new AgenteLocal((cmd, args) => executados.push([cmd, ...args]));
  agente.pedirEnergia('daiane', 'reiniciar', SESSAO);

  const alheia = agente.confirmar('operador-2', SESSAO);
  assert.match(alheia, /Não há nenhuma ação/);
  assert.equal(executados.length, 0);
  assert.ok(agente.temPendencia('daiane', SESSAO), 'a pendência da dona continua viva');
});

test('cancelar descarta a pendência e envia abort de shutdown', () => {
  const executados: string[][] = [];
  const agente = new AgenteLocal((cmd, args) => executados.push([cmd, ...args]));
  agente.pedirEnergia('daiane', 'desligar', SESSAO);

  const r = agente.cancelar('daiane', SESSAO);
  assert.match(r, /Cancelado/);
  assert.ok(!agente.temPendencia('daiane', SESSAO));
  assert.deepEqual(executados, [['shutdown.exe', '/a']]);
});

// ---------------------------------------------------------------------------
// Extração de parâmetros do pedido
// ---------------------------------------------------------------------------

test('extração do nome preserva acentos e ignora o local', () => {
  assert.equal(
    extrairNomePasta('crie uma pasta chamada Contratos na minha área de trabalho'),
    'Contratos',
  );
  assert.equal(extrairNomePasta('cria uma pasta Relatórios Aéreos em documentos'), 'Relatórios Aéreos');
  assert.equal(extrairNomePasta('crie uma pasta'), 'Nova pasta');
});

test('extração de local e ação de energia', () => {
  assert.equal(extrairLocalAutorizado('pasta X em documentos'), 'documentos');
  assert.equal(extrairLocalAutorizado('pasta X nos downloads'), 'downloads');
  assert.equal(extrairLocalAutorizado('pasta X na área de trabalho'), 'area_de_trabalho');
  assert.equal(extrairAcaoEnergia('reinicie o computador'), 'reiniciar');
  assert.equal(extrairAcaoEnergia('desligue meu pc'), 'desligar');
  assert.equal(extrairAcaoEnergia('suspenda a máquina'), 'suspender');
});

// ---------------------------------------------------------------------------
// Percepção — os comandos viram âncoras acionáveis
// ---------------------------------------------------------------------------

test('comandos do agente local são reconhecidos como âncoras acionáveis', () => {
  const p = new MotorPercepcao();
  assert.ok(p.perceber('crie uma pasta chamada Contratos na área de trabalho').ancoras.includes('pasta'));
  assert.ok(p.perceber('abra o bloco de notas').ancoras.includes('abrir_app'));
  assert.ok(p.perceber('desligue o computador').ancoras.includes('energia'));
  assert.ok(p.perceber('confirmo').ancoras.includes('confirmacao'));
  assert.ok(p.perceber('cancela').ancoras.includes('confirmacao'));
});
