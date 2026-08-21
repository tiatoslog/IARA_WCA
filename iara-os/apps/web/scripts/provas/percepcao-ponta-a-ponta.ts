/**
 * PROVA PONTA A PONTA da percepção — pelo caminho de PRODUTO.
 *
 *     npx tsx scripts/provas/percepcao-ponta-a-ponta.ts
 *
 * A DIFERENÇA PARA A VERSÃO ANTERIOR, e ela é o ponto desta fase: aquela prova
 * mandava `percepcao_iniciar` no socket com a mão. Provava o transporte e não
 * provava o produto — um script escrevendo pacote não é a IARA decidindo.
 *
 * Aqui entram FRASES. Cada uma passa por `MotorPercepcao` → `Planejador` →
 * habilidade, exatamente como passaria vinda do WhatsApp ou do navegador:
 *
 *   "me acompanha fazendo esse procedimento"  → observar_tela(solicitar)
 *   "pode observar o notepad"                 → observar_tela(autorizar) → Braço
 *   ...o operador digita, a tela muda, os eventos chegam...
 *   "para de observar"                        → observar_tela(encerrar) → Braço para
 *
 * O Braço é o PROCESSO REAL (`servidor/braco/principal.ts`), a captura é a tela
 * de verdade, e o Bloco de Notas faz o papel do GW.
 *
 * ESCREVE SÓ EM TEMPORÁRIO — a rigor nem isso: o Bloco de Notas é fechado sem
 * salvar, e provar que nenhuma imagem foi gravada é metade do objetivo.
 *
 * SÓ RODA EM WINDOWS COM TELA. Noutro lugar diz por que não rodou.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';

import { ponteDispositivos } from '../../servidor/barramento/PonteDispositivos';
import { ligarPercepcaoNaPonte, percepcaoDeTela } from '../../servidor/nucleo/PercepcaoDeTela';
import { percepcaoIndisponivelPorque } from '../../servidor/braco/CapturaDeQuadro';
import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { observarTela } from '../../servidor/nucleo/kernel/habilidades/percepcao';
import { treinarProcedimento } from '../../servidor/nucleo/kernel/habilidades/treinamento';
import { procedimentosEmCurso } from '../../servidor/nucleo/ProcedimentosEmCurso';
import { baseProcedimentos } from '../../servidor/nucleo/BaseProcedimentos';
import { podeGuiar, posicoes } from '../../lib/procedimento';
import type { ContextoHabilidade } from '../../servidor/nucleo/kernel/Habilidade';
import type { EventoVisual } from '../../lib/percepcao';

const OPERADOR = 'prova-percepcao';
const PASTA_CAPTURAS = path.join(os.homedir(), 'Documents', 'Capturas IARA');

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function contarCapturas(): number {
  return existsSync(PASTA_CAPTURAS) ? readdirSync(PASTA_CAPTURAS).length : 0;
}

/** Roda um PowerShell curto e devolve a saída. Só para orquestrar a prova. */
function ps(comando: string): Promise<string> {
  return new Promise((resolver) => {
    const filho = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', comando],
      { windowsHide: true },
    );
    let saida = '';
    filho.stdout.on('data', (d: Buffer) => (saida += d.toString()));
    filho.on('exit', () => resolver(saida.trim()));
  });
}

/**
 * O TURNO DA IARA, reduzido ao que esta prova precisa: frase → plano → resposta.
 *
 * Não usa o Kernel inteiro de propósito — ele traria orçamento, provedores de
 * raciocínio e persistência, nenhum dos quais está sendo provado aqui. O que
 * importa é que a decisão de ligar a observação venha da FRASE, pelo caminho
 * determinístico, e não de uma chamada escrita à mão.
 */
async function turno(frase: string): Promise<string> {
  const percebida = new MotorPercepcao().perceber(frase);
  const plano = new Planejador().planejar(percebida, { id_usuario: OPERADOR, sessao: 'prova' });
  const passo = plano.passos[0];

  console.log(`\n[operador] ${frase}`);
  console.log(`[plano] origem=${plano.origem} habilidade=${passo.habilidade} ${JSON.stringify(passo.parametros)}`);

  if (passo.habilidade !== 'observar_tela') {
    console.log(`[prova] FALHA: a frase não chegou à habilidade de percepção`);
    return '';
  }

  const ctx = {
    sessao: 'prova',
    id_usuario: OPERADOR,
    parametros: passo.parametros,
    sinal: new AbortController().signal,
    enunciado: frase,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;

  const r = await observarTela.executar(ctx);
  console.log(`[iara] ${r.texto.split('\n')[0]}`);
  console.log(`[detalhe] ${r.detalhe}`);
  return r.detalhe;
}

async function principal(): Promise<void> {
  const indisponivel = percepcaoIndisponivelPorque();
  if (indisponivel) {
    console.log(`PROVA NÃO EXECUTADA: ${indisponivel}`);
    return;
  }

  const capturasAntes = contarCapturas();
  const inicio = Date.now();

  // --- a ponte de verdade ---------------------------------------------------
  const servidor = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => servidor.on('listening', () => r()));
  const porta = (servidor.address() as { port: number }).port;

  let conectou = false;
  const recebidos: EventoVisual[] = [];
  let bytesRecebidos = 0;

  servidor.on('connection', (ws: WebSocket) => {
    conectou = true;
    ws.on('message', (d: Buffer) => {
      const texto = d.toString();
      if (texto.includes('"percepcao"')) bytesRecebidos += Buffer.byteLength(texto, 'utf8');
    });
    ponteDispositivos.conectar(ws);
  });

  const desligar = ligarPercepcaoNaPonte(ponteDispositivos);
  percepcaoDeTela.aoEvento((_e, evento) => recebidos.push(evento));

  console.log(`[prova] ponte no ws://127.0.0.1:${porta}`);
  console.log(`[prova] braço: ${process.env.IARA_PROVA_BRACO_EXE ?? 'tsx (código-fonte)'}`);

  // --- o processo do Braço, de verdade -------------------------------------
  /**
   * O BRAÇO EMPACOTADO, quando `IARA_PROVA_BRACO_EXE` aponta para ele.
   *
   * "Funciona via tsx" não é prova de produção: o executável passa por esbuild e
   * pelo SEA do Node, e o helper de percepção entra ali como texto embutido, com
   * `-EncodedCommand`. Se alguma dessas passagens quebrar o script do PowerShell,
   * é AQUI que se descobre — não na máquina da operadora.
   */
  const exe = process.env.IARA_PROVA_BRACO_EXE;
  const braco: ChildProcess = spawn(
    exe ?? process.execPath,
    exe ? [] : ['--import', 'tsx', path.join(process.cwd(), 'servidor', 'braco', 'principal.ts')],
    {
      env: {
        ...process.env,
        IARA_MOTOR_WS: `ws://127.0.0.1:${porta}`,
        IARA_ID_USUARIO: OPERADOR,
        IARA_NOME_DISPOSITIVO: 'prova-percepcao',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );

  const logDoBraco: string[] = [];
  braco.stdout?.setEncoding('utf8');
  braco.stdout?.on('data', (d: string) => {
    for (const linha of d.split('\n').map((l) => l.trim()).filter(Boolean)) {
      logDoBraco.push(linha);
      console.log(`  [braço] ${linha}`);
    }
  });
  braco.stderr?.setEncoding('utf8');
  braco.stderr?.on('data', (d: string) => console.log(`  [braço:err] ${d.trim().slice(0, 160)}`));

  const prazo = Date.now() + 20_000;
  while (!conectou && Date.now() < prazo) await dormir(100);
  if (!conectou) {
    console.log('PROVA INTERROMPIDA: o Braço não conectou em 20 s');
    braco.kill();
    servidor.close();
    return;
  }
  console.log('[prova] braço conectado');
  await dormir(800);

  // --- o "GW" desta prova: o Bloco de Notas --------------------------------
  await ps('Start-Process notepad.exe; Start-Sleep -Milliseconds 1200');
  await ps(
    "$s = New-Object -ComObject WScript.Shell; " +
      "$p = Get-Process notepad | Select-Object -First 1; " +
      '[void]$s.AppActivate($p.Id); Start-Sleep -Milliseconds 600',
  );
  const foco = await ps(
    'Add-Type -Namespace P -Name N -MemberDefinition ' +
      "'[DllImport(\"user32.dll\")] public static extern System.IntPtr GetForegroundWindow();" +
      '[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint p);\'; ' +
      '$h = [P.N]::GetForegroundWindow(); $id = 0; [void][P.N]::GetWindowThreadProcessId($h, [ref]$id); ' +
      '(Get-Process -Id $id).ProcessName',
  );
  const alvo = foco.toLowerCase();
  console.log(`[prova] janela em foco: ${alvo}`);
  if (alvo !== 'notepad') {
    console.log('[prova] AVISO: o Windows não deixou o Bloco de Notas tomar o foco;');
    console.log(`[prova] a prova segue observando "${alvo}" — o mecanismo é o mesmo.`);
  }

  // --- O FLUXO DE PRODUTO, por frases --------------------------------------
  await turno('me acompanha fazendo esse procedimento');
  await dormir(300);
  await turno(`pode observar o ${alvo}`);
  await dormir(2_500);

  // --- a tela muda de verdade ----------------------------------------------
  if (alvo === 'notepad') {
    for (let i = 0; i < 5; i += 1) {
      await ps(
        "$s = New-Object -ComObject WScript.Shell; " +
          "$p = Get-Process notepad | Select-Object -First 1; [void]$s.AppActivate($p.Id); " +
          `$s.SendKeys('LINHA ${i} percepcao{ENTER}')`,
      );
      await dormir(2_200);
    }
  } else {
    console.log('[prova] aguardando a tela mudar sozinha por 12 s');
    await dormir(12_000);
  }

  // --- CONTEXTO E DESVIO: procedimento em curso × tela observada -----------
  /**
   * A tela desta prova é o Bloco de Notas (ou o terminal), e o procedimento é um
   * POP do GW. Ou seja: a tela observada NÃO é a da etapa — e é exatamente esse o
   * caso que a aderência existe para nomear sem inventar causa.
   *
   * O que se observa aqui é o `percurso=` na proveniência da instrutora, com
   * texto lido por OCR de verdade.
   */
  const pop = baseProcedimentos.catalogo().find(podeGuiar);
  if (pop) {
    const primeira = posicoes(pop)[0];
    await procedimentosEmCurso.iniciar({
      id_usuario: OPERADOR,
      codigo: pop.codigo,
      modo: 'treinar',
      etapa: primeira.etapa.numero,
      slide: primeira.slide.indice,
      hash_origem: pop.hash_origem,
    });
    console.log(`
[prova] procedimento ${pop.codigo} em curso, parada 1`);
    await dormir(6_000);

    const r = await treinarProcedimento.executar({
      sessao: 'prova',
      id_usuario: OPERADOR,
      parametros: { modo: 'ensino' },
      sinal: new AbortController().signal,
      enunciado: 'me ensina',
      registro: null,
      operacao: null,
    } as unknown as ContextoHabilidade);
    console.log(`[iara/treino] ${r.detalhe}`);
    const linha = r.texto
      .split('\n')
      .find((l) => /Pelo que leio|não corresponde|próxima parada/.test(l));
    console.log(`[iara/treino] ${linha ?? '(sem frase de percurso — leitura indefinida)'}`);
    await procedimentosEmCurso.encerrar(OPERADOR);
  }

  // --- sai do escopo e volta ------------------------------------------------
  console.log('\n[prova] tirando o foco do escopo autorizado');
  await ps('Start-Process calc.exe; Start-Sleep -Milliseconds 2500');
  await dormir(4_000);
  if (alvo === 'notepad') {
    await ps(
      "$s = New-Object -ComObject WScript.Shell; $p = Get-Process notepad | Select-Object -First 1; " +
        '[void]$s.AppActivate($p.Id); Start-Sleep -Milliseconds 800',
    );
    await dormir(4_000);
  }

  // --- o operador pergunta, e depois manda parar ---------------------------
  await turno('você está vendo minha tela?');
  await dormir(300);
  await turno('para de observar');
  await dormir(2_500);

  const antesDoSilencio = recebidos.length;
  await dormir(4_000);
  const depoisDoSilencio = recebidos.length - antesDoSilencio;

  // --- medição --------------------------------------------------------------
  const cpuDoBraco = await ps(
    `$p = Get-Process -Id ${braco.pid} -ErrorAction SilentlyContinue; ` +
      'if ($p) { "{0};{1}" -f [math]::Round($p.TotalProcessorTime.TotalMilliseconds,0), ' +
      '[math]::Round($p.WorkingSet64/1MB,1) } else { "-1;-1" }',
  );

  braco.kill();
  desligar();
  servidor.close();
  await ps('Get-Process notepad -ErrorAction SilentlyContinue | Stop-Process -Force');
  await ps(
    'Get-Process Calculator, CalculatorApp, calc -ErrorAction SilentlyContinue | Stop-Process -Force',
  );

  const duracao = (Date.now() - inicio) / 1000;
  const porTipo = new Map<string, number>();
  for (const e of recebidos) porTipo.set(e.tipo, (porTipo.get(e.tipo) ?? 0) + 1);
  const estadoFinal = percepcaoDeTela.de(OPERADOR)[0];

  console.log('');
  console.log('============ RESULTADO DA PROVA DE PRODUTO ============');
  console.log(`duração                       ${duracao.toFixed(1)} s`);
  console.log(`eventos recebidos no motor    ${recebidos.length}`);
  for (const [tipo, n] of porTipo) console.log(`  ${tipo.padEnd(22)} ${n}`);
  console.log(`bytes de percepção na rede    ${bytesRecebidos} B`);
  console.log(`eventos por minuto            ${((recebidos.length / duracao) * 60).toFixed(1)}`);
  console.log(`arquivos em Capturas IARA     antes=${capturasAntes} depois=${contarCapturas()}`);
  console.log(`braço: cpu_ms;memoria_MB      ${cpuDoBraco}`);
  console.log(`eventos APÓS "para de observar" ${depoisDoSilencio} (tem de ser 0)`);
  console.log(`indicador no Braço            ${logDoBraco.filter((l) => l.includes('PERCEPCAO')).length} linhas`);
  console.log(`pergunta ao Braço no console  ${logDoBraco.filter((l) => l.includes('Autoriza?')).length} (tem de ser 0)`);
  console.log(`estado final no motor         ${estadoFinal?.estado} mudancas=${estadoFinal?.mudancas}`);
  console.log('======================================================');
  process.exit(0);
}

void principal();
