/**
 * O BRAÇO PRECISA SE INSTALAR — e a prova de que ele não se instalava estava
 * na pasta de Downloads da operadora, em 21/08/2026:
 *
 *     iara-braco.exe       15/08 20:15
 *     iara-braco (1).exe   15/08 21:48
 *     iara-braco (2).exe   15/08 22:10
 *     iara-braco (3).exe   20/08 13:34
 *     iara-braco (4).exe   21/08 08:58
 *
 * Cinco cópias do mesmo programa. É a assinatura forense de um produto que a
 * pessoa precisa BAIXAR DE NOVO toda vez que quer usar — porque o executável
 * nunca saía de Downloads, não havia etapa de instalação, e nada no Windows o
 * iniciava depois do reboot.
 *
 * A varredura confirmou, nas quatro camadas: nem `HKCU\...\Run`, nem
 * `HKLM\...\Run`, nem pasta Inicializar, nem serviço, nem tarefa agendada. E o
 * repositório inteiro não tinha uma linha de `schtasks`, `New-Service` ou
 * equivalente. O autostart não quebrou: **ele nunca existiu**.
 *
 * ================= O QUE ESTE MÓDULO DECIDE =================
 *
 * Ele é a parte PURA da instalação: dado onde o executável está rodando, o que
 * precisa acontecer? Separado dos efeitos (copiar, registrar tarefa) para poder
 * ser interrogado sem tocar no disco de ninguém — inclusive nos casos que
 * importam e são difíceis de montar: rodar já instalado, rodar de outra pasta,
 * rodar uma versão mais nova por cima de uma antiga.
 *
 * IDEMPOTÊNCIA É O REQUISITO CENTRAL. A operadora vai abrir o `.exe` de novo —
 * por hábito, por dúvida, porque clicou sem querer. A segunda execução tem de
 * REPARAR, nunca criar `braco (1)`, `braco (2)`. O defeito que este módulo
 * existe para não repetir é justamente uma pasta numerada.
 */

import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { subsistemaAtual } from '../servidor/braco/pe';

import {
  aplicarInstalacao,
  comandoDaTarefa,
  planoDeInstalacao,
  xmlDaTarefa,
  type PlanoDeInstalacao,
} from '../servidor/braco/instalacao';

const PASTA = 'C:\\Users\\daiane\\AppData\\Local\\IARA\\braco';
const emCasa = (...p: string[]): string => path.win32.join(PASTA, ...p);

const plano = (opcoes: {
  executavel: string;
  versao?: string;
  instalada?: string | null;
}): PlanoDeInstalacao =>
  planoDeInstalacao({
    executavel: opcoes.executavel,
    pasta: PASTA,
    versao: opcoes.versao ?? '1.3.0',
    versaoInstalada: opcoes.instalada ?? null,
    separador: path.win32,
  });

// ===========================================================================
// 1. De onde ele está rodando decide tudo
// ===========================================================================

test('BI-01. rodando de Downloads: INSTALAR', () => {
  const p = plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco (4).exe' });
  assert.equal(p.acao, 'instalar');
  assert.equal(p.destino_runtime, emCasa('versoes', '1.3.0', 'iara-braco.exe'));
  assert.equal(p.destino_supervisor, emCasa('supervisor.exe'));
  assert.equal(p.registrar_tarefa, true);
});

test('BI-02. rodando de DENTRO da instalação: não reinstala', () => {
  /**
   * É o caso do dia a dia — a tarefa agendada inicia o supervisor, que inicia o
   * runtime, e os dois estão dentro da pasta. Reinstalar aqui seria copiar um
   * arquivo sobre ele mesmo a cada logon.
   */
  const p = plano({
    executavel: emCasa('versoes', '1.3.0', 'iara-braco.exe'),
    instalada: '1.3.0',
  });
  assert.equal(p.acao, 'ja_instalado');
  assert.equal(p.registrar_tarefa, false);
});

test('BI-03. o supervisor rodando de dentro também não reinstala', () => {
  const p = plano({ executavel: emCasa('supervisor.exe'), instalada: '1.3.0' });
  assert.equal(p.acao, 'ja_instalado');
});

// ===========================================================================
// 2. Idempotência — a segunda execução REPARA
// ===========================================================================

test('BI-04. baixou de novo a MESMA versão: repara, e nunca cria pasta numerada', () => {
  /**
   * O comportamento que a pasta de Downloads da operadora provou existir: ela
   * baixa de novo. A segunda execução tem de consertar o que estiver faltando
   * (tarefa apagada, supervisor corrompido) e seguir — nunca duplicar.
   */
  const p = plano({
    executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco (5).exe',
    versao: '1.3.0',
    instalada: '1.3.0',
  });
  assert.equal(p.acao, 'reparar');
  assert.equal(p.registrar_tarefa, true, 'reparar reinstala a tarefa: ela pode ter sido apagada');
  /* O destino é o MESMO caminho de sempre. Um `(1)` aqui seria o defeito. */
  assert.equal(p.destino_runtime, emCasa('versoes', '1.3.0', 'iara-braco.exe'));
  assert.ok(!/\(\d+\)/.test(p.destino_runtime), 'caminho numerado');
  assert.ok(!/\(\d+\)/.test(p.destino_supervisor), 'caminho numerado');
});

test('BI-05. baixou uma versão MAIS NOVA por cima: instala ao lado, sem apagar a antiga', () => {
  /**
   * A versão anterior fica no disco de propósito — é o que torna o rollback
   * possível sem baixar nada. Ver `atual.json` e a fase de rollback.
   */
  const p = plano({
    executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe',
    versao: '1.4.0',
    instalada: '1.3.0',
  });
  assert.equal(p.acao, 'atualizar');
  assert.equal(p.destino_runtime, emCasa('versoes', '1.4.0', 'iara-braco.exe'));
  assert.equal(p.versao_anterior, '1.3.0');
});

test('BI-06. baixou uma versão MAIS VELHA: recusa o downgrade', () => {
  /**
   * Abrir um `iara-braco (1).exe` esquecido em Downloads não pode rebaixar uma
   * instalação boa. É a mesma regra que o updater vai precisar ter contra
   * downgrade forçado por quem controla a rede.
   */
  const p = plano({
    executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco (1).exe',
    versao: '1.2.0',
    instalada: '1.3.0',
  });
  assert.equal(p.acao, 'recusar_downgrade');
  assert.equal(p.registrar_tarefa, false);
});

// ===========================================================================
// 3. O que o plano promete sobre o Windows
// ===========================================================================

test('BI-07. a tarefa chama o SUPERVISOR, nunca o runtime', () => {
  /**
   * A correção que a auditoria pediu explicitamente: o supervisor sobrevive ao
   * próprio runtime. Apontar a tarefa para o `iara-braco.exe` faria o
   * atualizador precisar substituir o executável que o Windows acabou de
   * iniciar — o antipadrão que `religarComVersaoNova` implementava com um
   * `.bat` de retry.
   */
  const p = plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe' });
  assert.equal(p.alvo_da_tarefa, emCasa('supervisor.exe'));
  assert.notEqual(p.alvo_da_tarefa, p.destino_runtime);
});

test('BI-08. o nome da tarefa é estável — reinstalar não cria uma segunda', () => {
  const a = plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe' });
  const b = plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco (9).exe', instalada: '1.3.0' });
  assert.equal(a.nome_da_tarefa, b.nome_da_tarefa);
  assert.match(a.nome_da_tarefa, /IARA/i);
});

test('BI-09. a identidade NÃO mora na pasta de instalação', () => {
  /**
   * `braco.json` fica em `%APPDATA%\iara\` e continua lá. Se a identidade
   * morasse dentro de `%LOCALAPPDATA%\IARA\braco`, uma reinstalação que
   * limpasse a pasta apagaria a credencial — e a máquina apareceria para a IARA
   * como um computador NOVO a cada reparo, que é exatamente o que a Fase 6 da
   * auditoria proíbe.
   */
  const p = plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe' });
  assert.ok(
    !p.destino_runtime.includes('braco.json') && !p.apaga.some((x) => x.includes('braco.json')),
    'a instalação toca no arquivo de identidade',
  );
});

// ===========================================================================
// 4. O XML da tarefa — cada linha aqui neutraliza um default que mata o braço
// ===========================================================================

const xml = (): string =>
  xmlDaTarefa(
    plano({ executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe' }),
    'COMPUTADOR\\daiane',
  );

test('BI-11. a tarefa não tem prazo de validade', () => {
  /**
   * O default do Agendador do Windows é `PT72H`: TRÊS DIAS, e ao fim deles ele
   * MATA a tarefa. Um supervisor que deve viver enquanto a máquina viver
   * morreria na quarta-feira de quem ligou o computador no domingo — sem erro,
   * sem log, sem nada que ligasse o sintoma à causa.
   */
  assert.match(xml(), /<ExecutionTimeLimit>PT0S<\/ExecutionTimeLimit>/);
});

test('BI-12. bateria não desliga a IARA', () => {
  /**
   * Os dois defaults são `true`. Num notebook isso significa "a IARA não tem
   * mãos fora da tomada" — e o sintoma seria o pior tipo de intermitente:
   * funciona na mesa, some na reunião.
   */
  assert.match(xml(), /<DisallowStartIfOnBatteries>false<\/DisallowStartIfOnBatteries>/);
  assert.match(xml(), /<StopIfGoingOnBatteries>false<\/StopIfGoingOnBatteries>/);
});

test('BI-13. a tarefa roda na sessão gráfica do operador', () => {
  /**
   * `InteractiveToken` é a linha que faz `capturar_tela` e `abrir_aplicativo`
   * existirem. Na sessão 0 — onde um serviço rodaria — a captura é preta e não
   * há área de trabalho para abrir nada. É a razão de este desenho ser tarefa
   * agendada e não serviço do Windows.
   */
  assert.match(xml(), /<LogonType>InteractiveToken<\/LogonType>/);
  assert.match(xml(), /<RunLevel>LeastPrivilege<\/RunLevel>/);
});

test('BI-14. o Windows é a rede de segurança do supervisor', () => {
  /* O supervisor reergue o runtime; quem reergue o supervisor é o Agendador. */
  assert.match(xml(), /<RestartOnFailure>/);
  assert.match(xml(), /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
});

test('BI-15. quem a tarefa inicia é o supervisor, com o papel declarado', () => {
  const x = xml();
  assert.match(x, /<Command>C:\\Users\\daiane\\AppData\\Local\\IARA\\braco\\supervisor\.exe<\/Command>/);
  assert.match(x, /<Arguments>--supervisor<\/Arguments>/);
  assert.doesNotMatch(x, /iara-braco\.exe/, 'a tarefa aponta para o runtime');
});

test('BI-15b. a tarefa declara o diretório de trabalho', () => {
  /**
   * Sem `<WorkingDirectory>` o Windows usa `%windir%\System32`. Nada no braço
   * depende de diretório relativo hoje — e é por isso que a linha é barata
   * agora: o primeiro caminho relativo escrito daqui a seis meses apontaria
   * para dentro de `System32`, onde a escrita é negada, com uma mensagem que
   * não fala de diretório de trabalho.
   */
  assert.match(
    xml(),
    /<WorkingDirectory>C:\\Users\\daiane\\AppData\\Local\\IARA\\braco<\/WorkingDirectory>/,
  );
});

test('BI-16. o comando usa /xml — o atalho /sc onlogon é recusado sem elevação', () => {
  /**
   * Medido no Windows real em 21/08/2026, rodando o `.exe` empacotado:
   * `/sc onlogon` responde "Acesso negado" com e sem `/ru`, com e sem `/rl`, na
   * raiz e em subpasta. O MESMO gatilho de logon declarado em XML é aceito.
   * Este teste existe para que ninguém "simplifique" de volta.
   */
  const cmd = comandoDaTarefa(plano({ executavel: 'C:\\x\\iara-braco.exe' }), 'C:\\tmp\\t.xml');
  assert.deepEqual([...cmd], ['/create', '/f', '/tn', 'IARA-Braco', '/xml', 'C:\\tmp\\t.xml']);
  assert.ok(!cmd.includes('onlogon'), 'voltou ao atalho que o Windows recusa sem admin');
});

test('BI-17. caminho com caractere de XML não quebra o documento', () => {
  /**
   * `C:\Users\Ana & João\…` é um nome de usuário perfeitamente possível, e um
   * `&` cru invalida o XML inteiro — a tarefa não seria criada e a mensagem
   * falaria de formato de arquivo, não do nome da pessoa.
   */
  const p = planoDeInstalacao({
    executavel: 'C:\\Downloads\\iara-braco.exe',
    pasta: 'C:\\Users\\Ana & João\\AppData\\Local\\IARA\\braco',
    versao: '1.3.0',
    versaoInstalada: null,
    separador: path.win32,
  });
  const x = xmlDaTarefa(p, 'COMPUTADOR\\Ana & João');
  assert.match(x, /Ana &amp; João/);
  assert.doesNotMatch(x, /Ana & João/, 'o `&` foi cru para dentro do XML');
});

// ===========================================================================
// 5. O reparo sobre uma instalação VIVA — o defeito que os testes puros não viam
// ===========================================================================

test('BI-19. reparar com o mesmo arquivo NÃO reescreve o executável', () => {
  /**
   * DEFEITO REAL, 21/08/2026, com os 17 testes acima verdes:
   *
   *     Error: EBUSY: resource busy or locked, copyfile
   *       'Downloads\iara-braco (5).exe' -> '…\versoes\1.3.0\iara-braco.exe'
   *
   * A operadora abriu o `.exe` uma segunda vez — hábito comprovado pelas cinco
   * cópias em Downloads —, o plano decidiu `reparar`, e o reparo tentou
   * sobrescrever o executável que estava RODANDO. O Windows tranca o que está em
   * execução, e ela viu um stack trace do Node numa janela preta.
   *
   * Os testes puros não podiam pegar: nenhum deles tinha uma instalação viva do
   * outro lado, e `planoDeInstalacao` estava certo — quem estava errado era o
   * EFEITO. Este teste mora no disco de propósito, e o que ele mede é a
   * ausência de escrita: se `aplicarInstalacao` reescrever um arquivo idêntico,
   * a data de modificação muda, e num Windows real o `EBUSY` volta.
   */
  const casa = mkdtempSync(join(tmpdir(), 'iara-inst-'));
  const baixado = join(casa, 'baixado.exe');
  writeFileSync(baixado, 'conteudo-do-binario-v1');

  const p = planoDeInstalacao({
    executavel: baixado,
    pasta: join(casa, 'instalado'),
    versao: '1.3.0',
    versaoInstalada: null,
  });

  aplicarInstalacao(p, baixado);
  const marca = statSync(p.destino_runtime).mtimeMs;
  const marcaSup = statSync(p.destino_supervisor).mtimeMs;

  /* A segunda execução, com o MESMO arquivo — o caso do duplo clique. */
  const reparo = planoDeInstalacao({
    executavel: baixado,
    pasta: join(casa, 'instalado'),
    versao: '1.3.0',
    versaoInstalada: '1.3.0',
  });
  assert.equal(reparo.acao, 'reparar');
  aplicarInstalacao(reparo, baixado);

  assert.equal(statSync(reparo.destino_runtime).mtimeMs, marca, 'reescreveu o runtime à toa');
  assert.equal(statSync(reparo.destino_supervisor).mtimeMs, marcaSup, 'reescreveu o supervisor à toa');
});

test('BI-19b. depois de tirar o console, o REPARO ainda não recopia', async () => {
  /**
   * A armadilha que eu quase criei ao consertar a janela preta.
   *
   * A instalação patcheia as cópias para o subsistema GUI (ver `pe.ts`), e o
   * arquivo baixado continua console. Com um hash ingênuo, origem e destino
   * passariam a diferir SEMPRE — e o reparo, que existe exatamente para não
   * recopiar, voltaria a copiar por cima de um executável em execução. `EBUSY`,
   * stack trace, e a operadora de volta ao ponto de partida de BI-19.
   *
   * Dois bytes de diferença conhecida e deliberada não são conteúdo diferente.
   */
  const casa = mkdtempSync(join(tmpdir(), 'iara-inst-'));
  const baixado = join(casa, 'baixado.exe');
  /* Um PE mínimo de verdade: o patch precisa achar o campo para exercer o caso. */
  const buf = Buffer.alloc(1024);
  buf.writeUInt16LE(0x5a4d, 0);
  buf.writeUInt32LE(0x80, 0x3c);
  buf.writeUInt32LE(0x0000_4550, 0x80);
  buf.writeUInt16LE(0x20b, 0x80 + 24);
  buf.writeUInt16LE(3, 0x80 + 24 + 68); // console
  writeFileSync(baixado, buf);

  const p = planoDeInstalacao({
    executavel: baixado,
    pasta: join(casa, 'instalado'),
    versao: '1.7.0',
    versaoInstalada: null,
  });

  aplicarInstalacao(p, baixado);
  assert.equal(subsistemaAtual(p.destino_supervisor), 2, 'o supervisor instalado continua com console');
  assert.equal(subsistemaAtual(p.destino_runtime), 2, 'o runtime instalado continua com console');
  assert.equal(subsistemaAtual(baixado), 3, 'o arquivo BAIXADO foi alterado — ele tem de continuar console');

  const marca = statSync(p.destino_supervisor).mtimeMs;
  const marcaR = statSync(p.destino_runtime).mtimeMs;

  aplicarInstalacao(
    { ...p, acao: 'reparar', versao_anterior: '1.7.0' },
    baixado,
  );

  assert.equal(statSync(p.destino_supervisor).mtimeMs, marca, 'recopiou o supervisor por causa do patch');
  assert.equal(statSync(p.destino_runtime).mtimeMs, marcaR, 'recopiou o runtime por causa do patch');
});

test('BI-20. conteúdo diferente com a mesma versão AINDA é copiado', () => {
  /**
   * A contraprova de BI-19. Pular a cópia por "mesma versão" seria trocar um
   * defeito por outro — um reparo que não repara. O que autoriza pular é os
   * BYTES serem iguais, nunca o número da versão.
   */
  const casa = mkdtempSync(join(tmpdir(), 'iara-inst-'));
  const baixado = join(casa, 'baixado.exe');
  writeFileSync(baixado, 'binario-v1');

  const p = planoDeInstalacao({
    executavel: baixado,
    pasta: join(casa, 'instalado'),
    versao: '1.3.0',
    versaoInstalada: null,
  });
  aplicarInstalacao(p, baixado);

  writeFileSync(baixado, 'binario-v1-corrigido');
  aplicarInstalacao({ ...p, acao: 'reparar' }, baixado);

  assert.equal(readFileSync(p.destino_runtime, 'utf8'), 'binario-v1-corrigido');
  assert.equal(readFileSync(p.destino_supervisor, 'utf8'), 'binario-v1-corrigido');
});

test('BI-21. instalar não toca no arquivo de identidade', () => {
  /**
   * A versão em disco de BI-09: `braco.json` mora em `%APPDATA%\iara\`, e uma
   * instalação inteira não pode fazer aparecer nada com esse nome na pasta de
   * instalação — o que faria a máquina virar um computador NOVO a cada reparo.
   */
  const casa = mkdtempSync(join(tmpdir(), 'iara-inst-'));
  const baixado = join(casa, 'baixado.exe');
  writeFileSync(baixado, 'binario');

  const p = planoDeInstalacao({
    executavel: baixado,
    pasta: join(casa, 'instalado'),
    versao: '1.3.0',
    versaoInstalada: null,
  });
  aplicarInstalacao(p, baixado);

  const tudo = readdirSync(p.pasta, { recursive: true }) as string[];
  assert.ok(!tudo.some((f) => String(f).includes('braco.json')), `identidade na instalação: ${tudo}`);
});

test('BI-22. instalar não apaga nada da versão em uso', () => {
  const p = plano({
    executavel: 'C:\\Users\\daiane\\Downloads\\iara-braco.exe',
    versao: '1.4.0',
    instalada: '1.3.0',
  });
  assert.ok(
    !p.apaga.some((x) => x.includes('1.3.0')),
    'a atualização apagaria a versão anterior, e some com o rollback',
  );
});
