/**
 * Testes do Agente Local — as fronteiras de segurança são o que se testa.
 *
 * O executor é injetado como stub: "confirmar desligamento" precisa ser
 * testável sem desligar a máquina de quem roda `npm test`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  AgenteLocal,
  capturaIndisponivelPorque,
  resolverAplicativo,
  resolverRaiz,
  validarNomePasta,
} from '../servidor/nucleo/AgenteLocal';
import { capturarTela } from '../servidor/nucleo/kernel/habilidades/agenteLocal';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import {
  extrairAcaoEnergia,
  extrairLocalAutorizado,
  extrairLocalCaptura,
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
// Captura de tela
// ---------------------------------------------------------------------------

/**
 * O executor aguardado é injetado pela MESMA razão que o outro: rodar a suíte
 * não pode tirar foto da tela de quem está rodando.
 *
 * O que se testa aqui não é o PowerShell — é a única promessa que a habilidade
 * faz ao operador: que ela nunca diz "capturei" sem arquivo.
 */
test('captura só afirma sucesso com arquivo no disco', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('a captura é específica do Windows; aqui só a recusa é observável');
    return;
  }

  // Executor que "roda" com sucesso e não escreve nada — o caso exato em que um
  // agendador ingênuo relataria captura feita.
  const mentiroso = new AgenteLocal(
    () => undefined,
    async () => 0,
  );
  const texto = await mentiroso.capturarTela('daiane', 'downloads');
  assert.match(texto, /não consegui/i, 'código zero sem arquivo não pode virar sucesso');
  assert.equal(
    mentiroso.capturaRecenteDe('daiane'),
    null,
    'nada pode ser registrado quando nada foi escrito',
  );
});

test('captura registra o caminho quando o arquivo de fato nasce', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('a captura é específica do Windows');
    return;
  }

  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-captura-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));

  /**
   * O dublê escreve um PNG de mentira no destino que o agente escolheu — é o
   * papel do PowerShell, sem o PowerShell. O caminho sai do último argumento do
   * script, que é onde `$m.Save('...')` o coloca.
   */
  const honesto = new AgenteLocal(
    () => undefined,
    async (_cmd, args) => {
      const destino = args[args.length - 1].match(/\$m\.Save\('(.+?)'/)?.[1];
      if (destino) writeFileSync(destino, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      return 0;
    },
  );

  const texto = await honesto.capturarTela('daiane', 'downloads');
  const caminho = honesto.capturaRecenteDe('daiane');

  // Downloads pode não existir na máquina que roda a suíte; a recusa por raiz
  // ausente também é comportamento correto e não deve derrubar o teste.
  if (/Não encontrei a pasta/.test(texto)) {
    assert.equal(caminho, null);
    return;
  }

  assert.ok(caminho, 'captura bem-sucedida precisa registrar o caminho');
  assert.ok(existsSync(caminho), 'o caminho registrado tem que existir no disco');
  assert.match(caminho, /Capturas IARA/, 'a captura vive na subpasta fixa, nunca solta na raiz');
  assert.match(texto, /não abri a imagem/i, 'a resposta precisa declarar que não leu a imagem');
  rmSync(caminho, { force: true });
});

/**
 * O INVARIANTE QUE MAIS IMPORTA nesta habilidade, e o único que não é sobre
 * segurança de arquivo: o conteúdo da tela não pode existir em lugar nenhum do
 * fluxo cognitivo. `ResultadoHabilidade.texto` é declarado no contrato como
 * insumo do próximo passo — ou seja, pode chegar ao prompt.
 */
test('a captura devolve caminho e tamanho, jamais bytes de imagem', async () => {
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
  );
  const texto = await agente.capturarTela('daiane', 'documentos');
  assert.doesNotMatch(texto, /base64|data:image|iVBOR/i, 'imagem vazando na resposta');
  assert.ok(texto.length < 400, 'a resposta cresceu além de uma frase — algo entrou junto');
});

test('sem Windows, a captura recusa em voz alta em vez de sumir do catálogo', () => {
  const motivo = capturaIndisponivelPorque();
  if (process.platform === 'win32') {
    assert.equal(motivo, null);
  } else {
    assert.ok(motivo && motivo.length > 10, 'a recusa precisa explicar o porquê');
  }
  // A habilidade continua no catálogo em qualquer plataforma: receita
  // determinística não pode apontar para algo que some do planejador.
  assert.equal(capturarTela.indisponivelPorque, undefined);
});

test('print mencionado não é print pedido', () => {
  const p = new MotorPercepcao();
  assert.ok(p.perceber('tira um print da tela').ancoras.includes('captura'));
  assert.ok(p.perceber('captura a tela pra mim').ancoras.includes('captura'));
  assert.ok(p.perceber('faz um screenshot').ancoras.includes('captura'));

  // Menção, não pedido — a mesma família do bug de `frota` e de `tempo`.
  assert.ok(
    !p.perceber('manda o print que o cliente enviou no grupo').ancoras.includes('captura'),
    'falar de um print existente não pode capturar a tela',
  );
  assert.ok(
    !p.perceber('não tire print dessa tela').ancoras.includes('captura'),
    'proibir a ação não pode executá-la',
  );
});

test('a captura vai para Documentos por padrão, e obedece quando mandam', () => {
  assert.equal(extrairLocalCaptura('tira um print'), 'documentos');
  assert.equal(extrairLocalCaptura('tira um print e salva na área de trabalho'), 'area_de_trabalho');
  assert.equal(extrairLocalCaptura('captura a tela nos downloads'), 'downloads');
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
