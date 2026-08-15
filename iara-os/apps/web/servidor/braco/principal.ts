/**
 * O BRAÇO — o processo que roda no computador do operador e tem as mãos.
 *
 * É o outro lado da `PonteDispositivos`. Ele não pensa: não interpreta frase,
 * não escolhe ação, não conversa com LLM nenhuma. Recebe uma ordem de um
 * catálogo fechado, executa pelo `ExecutorDesktop` — o MESMO que o motor usa
 * quando as mãos são dele — e conta o que aconteceu.
 *
 * QUEM CONECTA EM QUEM. Este processo liga para o motor, nunca o contrário, e
 * é a decisão que torna a coisa toda viável: o computador do operador está
 * atrás de NAT e de um IP que muda, e não tem endereço estável para receber
 * chamada. Também não abre porta nenhuma nesta máquina — para efeito de rede,
 * o braço é um cliente, como uma aba de navegador.
 *
 * COMO RODAR. No computador da operadora: abrir o programa. Só isso.
 *
 * Na primeira vez ele não tem identidade nenhuma, e é ELE quem resolve isso:
 * pede um código de pareamento ao motor, mostra na tela, e fica esperando
 * alguém aprovar de uma tela já logada (aba Dispositivos). Ninguém digita senha
 * nesta máquina — ver `braco/pareamento.ts` para o porquê.
 *
 * No loop de desenvolvimento, sem login e sem pareamento:
 *
 *   IARA_MOTOR_WS=ws://localhost:3000/dispositivo IARA_ID_USUARIO=daiane npm run braco
 *
 * `IARA_MOTOR_WS` é o que separa os dois mundos: quem o declara está apontando
 * o braço para um motor à mão e sabe o que está fazendo, então o pareamento sai
 * do caminho. Sem ele, a falta de credencial é tratada como o que é numa máquina
 * de operadora — a primeira execução.
 *
 * A IDENTIDADE tem quatro fontes, nesta ordem: `IARA_TOKEN` (colado à mão, que é
 * como isto nasceu e continua servindo para depurar), o token de dispositivo
 * gravado pelo pareamento, a sessão renovável do Supabase (o caminho legado do
 * `braco:entrar`) e, por último, nada — o que só funciona com o motor em modo
 * local, onde não há Supabase para verificar coisa alguma.
 *
 * O destino final deste processo é ser hospedado pelo shell Tauri
 * (`apps/desktop`), que hoje só desenha janela. Enquanto isso ele é um processo
 * Node à parte — e, empacotado por `npm run empacotar:braco`, um executável
 * único que não exige Node instalado na máquina de ninguém.
 */

import { WebSocket } from 'ws';
import { config as carregarEnv } from 'dotenv';
import { createInterface } from 'node:readline';
import { hostname, platform, release, tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import QRCode from 'qrcode';
import {
  lerPacoteMotor,
  type OrdemExecucao,
  type PacoteBraco,
  type RelatoExecucao,
} from '../../lib/execucao';
import { executarOrdem } from '../nucleo/ExecutorDesktop';
import {
  caminhoCredencial,
  lerCredencial,
  renovarAcesso,
  salvarCredencial,
  SessaoExpirada,
  wsDoMotor,
} from './credencial';
import {
  aguardarAprovacao,
  linkDoConvite,
  linkDoPareamento,
  PareamentoRecusado,
  pedirCodigo,
} from './pareamento';

carregarEnv({ path: '.env.local' });
carregarEnv();

const VERSAO = '1.1.0';

/**
 * O ENDEREÇO DA IARA, assado no executável em tempo de empacotamento.
 *
 * `scripts/empacotar-braco.ts` substitui este identificador pelo domínio da
 * instalação. É o que faz a diferença entre "abra o programa" e "abra o programa
 * e digite o endereço do servidor" — e a segunda frase é exatamente a barreira
 * que este trabalho inteiro existe para derrubar.
 *
 * `typeof` e não leitura direta: rodando por `npm run braco` a substituição não
 * aconteceu, o identificador não existe, e ler um identificador inexistente é
 * `ReferenceError`. `typeof` sobre um nome não declarado é legal em JavaScript —
 * é a única forma de o mesmo código servir aos dois modos.
 */
declare const __IARA_MOTOR__: string;
const MOTOR_EMBUTIDO = typeof __IARA_MOTOR__ === 'string' ? __IARA_MOTOR__ : '';

const ID_USUARIO = process.env.IARA_ID_USUARIO ?? 'daiane';
const NOME = process.env.IARA_NOME_DISPOSITIVO ?? hostname();

/**
 * Para onde ligar. O ambiente ganha da credencial porque o ambiente é o que
 * alguém acabou de digitar — e quem digita está depurando.
 */
function destino(): string {
  if (process.env.IARA_MOTOR_WS) return process.env.IARA_MOTOR_WS;
  /* A credencial vem ANTES do endereço assado: um executável entregue com um
     domínio e depois pareado contra outro (migração de host, homologação) deve
     falar com aquele em que ele de fato tem identidade. */
  const declarado = lerCredencial()?.motor || process.env.IARA_MOTOR?.trim() || MOTOR_EMBUTIDO;
  if (declarado) {
    try {
      return wsDoMotor(declarado);
    } catch {
      /* endereço gravado inválido: cai no padrão de desenvolvimento e o
         `close` seguinte explica */
    }
  }
  return 'ws://localhost:3000/dispositivo';
}

/**
 * O token desta conexão, resolvido A CADA tentativa — nunca uma vez na subida.
 *
 * O access token do Supabase vive cerca de uma hora, e um braço bom fica
 * ligado o dia inteiro. Resolver no topo do módulo faria a primeira queda de
 * rede depois do almoço reconectar com um token morto e o motor recusar para
 * sempre, com a mensagem certa ("sessão inválida") e a causa errada.
 *
 * O token de PAREAMENTO não tem esse problema — ele não expira —, e mesmo assim
 * é lido aqui a cada tentativa, e não guardado numa variável. A razão é a
 * revogação: a operadora aperta "desconectar" no celular, o motor derruba o
 * socket, e o braço tenta de novo. Relendo o arquivo, ele apresenta a mesma
 * credencial e ouve a recusa — que é a verdade. Guardado em memória, o
 * comportamento seria idêntico; o que a releitura garante é o caso oposto, o de
 * uma credencial NOVA gravada por um pareamento refeito com o processo vivo.
 *
 * `undefined` não é falha: em modo local o motor não verifica token nenhum.
 */
async function tokenDaVez(): Promise<string | undefined> {
  const colado = process.env.IARA_TOKEN;
  if (colado) return colado;

  const guardada = lerCredencial();
  if (!guardada) return undefined;
  if (guardada.token_dispositivo) return guardada.token_dispositivo;
  return renovarAcesso(guardada);
}

// ---------------------------------------------------------------------------
// A PRIMEIRA EXECUÇÃO
// ---------------------------------------------------------------------------

/** Onde a IARA mora, em HTTP. `null` quando nem o ambiente, nem a credencial,
 *  nem o empacotamento souberam dizer. */
function motorHttp(): string | null {
  return process.env.IARA_MOTOR?.trim() || lerCredencial()?.motor || MOTOR_EMBUTIDO || null;
}

function perguntar(rotulo: string): Promise<string> {
  const leitor = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolver) =>
    leitor.question(rotulo, (r) => {
      leitor.close();
      resolver(r.trim());
    }),
  );
}

/**
 * Abre um caminho OU URL no aplicativo padrão do sistema — hoje, o convite de
 * pareamento no navegador (e o PNG do QR continua sendo o reforço impresso).
 * Best-effort e silencioso de propósito: num servidor sem GUI o operador ainda
 * tem o ASCII no terminal, o código e o caminho do PNG.
 */
function abrirNoSistema(caminho: string): void {
  try {
    const p = platform();
    const [comando, args] =
      p === 'win32'
        ? ['cmd.exe', ['/c', 'start', '""', caminho]]
        : p === 'darwin'
          ? ['open', [caminho]]
          : ['xdg-open', [caminho]];
    const processo = spawn(comando, args, { detached: true, stdio: 'ignore', windowsHide: false });
    processo.unref();
    processo.on('error', () => {
      /* Sem visualizador associado ou comando ausente — o caminho impresso
         antes desta chamada continua sendo o reforço. */
    });
  } catch {
    /* Mesma postura: reforço, nunca via principal. */
  }
}

/**
 * O PAREAMENTO, na tela de quem instalou.
 *
 * Escrito com espaço em volta e o código em linha própria de propósito: esta é
 * a única coisa que a operadora precisa ler no programa inteiro, e ela vai lê-la
 * de relance, com o celular na outra mão.
 */
async function parearEsteComputador(): Promise<boolean> {
  let motor = motorHttp();
  if (!motor) {
    /**
     * Só acontece num executável empacotado sem endereço assado — que é um
     * defeito de empacotamento, não de uso. Perguntar é melhor que travar: a
     * pessoa tem o endereço na barra do navegador, na aba que ela acabou de
     * usar para baixar este programa.
     */
    motor = await perguntar('  Endereço da IARA (ex.: https://iara.suaempresa.com): ');
    if (!motor) return false;
  }

  console.log(`\n  Conectando este computador à IARA em ${motor}…\n`);

  let pedido;
  try {
    pedido = await pedirCodigo(motor, {
      nome: NOME,
      plataforma: `${platform()} ${release()}`,
      versao: VERSAO,
    });
  } catch (erro) {
    const motivo = erro instanceof PareamentoRecusado ? erro.message : (erro as Error).message;
    console.error(`\n  Não consegui pedir o código de conexão: ${motivo}\n`);
    return false;
  }

  /**
   * O QR É ATALHO, O CÓDIGO É A SEGURANÇA. Quem aprova precisa estar numa
   * sessão já logada — o QR só poupa digitar 8 caracteres, abrindo a aba
   * Dispositivos com o código pronto. Ele não pode ser gerado se `motor` não
   * for uma URL http(s) de verdade (motor local sem endereço, por exemplo) —
   * nesse caso a operadora ainda tem o código para digitar à mão.
   */
  try {
    const linkPareamento = linkDoPareamento(motor, pedido.codigo);

    /**
     * O QR AGORA MORA NA INTERFACE DA IARA, não no terminal (15/08/2026, a
     * pedido da operadora). O braço abre o navegador em `/?convite=<código>` e
     * a própria página monta o popover com o QR — nítido, com a estética do
     * aplicativo, em qualquer fonte de console. A história desta decisão vem
     * em camadas: o ASCII dependia do codepage do console (auditoria de
     * 14/08), o PNG avulso abria num visualizador que não parecia o produto
     * (rodada 2 do mesmo dia); a página é a primeira via que é sempre nítida E
     * sempre parece a IARA.
     *
     * `spawn` já é permitido neste arquivo (`fronteira-efeitos.test.ts`, A4);
     * abrir o navegador no ENDEREÇO DO PRÓPRIO MOTOR é o mesmo nível de
     * confiança de abrir a imagem que acabamos de gerar.
     */
    abrirNoSistema(linkDoConvite(motor, pedido.codigo));
    console.log('  O navegador vai abrir com o QR na tela da IARA.');
    console.log('  Aponte a câmera do celular para ele — ou, se a janela não abrir,');
    console.log('  use o desenho abaixo ou digite o código na aba Dispositivos:\n');

    const qr = await QRCode.toString(linkPareamento, { type: 'terminal', small: true });
    console.log(qr);

    /**
     * O PNG continua existindo como reforço IMPRESSO (não abre mais sozinho:
     * navegador e visualizador de imagem abrindo juntos é duas janelas para o
     * mesmo fato). Ele cobre o caso do terminal sem UTF-8 E sem navegador.
     */
    try {
      const caminhoQr = path.join(
        tmpdir(),
        `iara-pareamento-${pedido.codigo.replace(/-/g, '')}.png`,
      );
      await QRCode.toFile(caminhoQr, linkPareamento, { width: 512, margin: 2 });
      console.log(`  (Se nada disso aparecer legível, o QR também está em ${caminhoQr})\n`);
    } catch {
      /* PNG é reforço do reforço — falha ao gravar não pode derrubar nada. */
    }
  } catch {
    /* Endereço não vira QR válido (ex.: motor sem esquema http/https) — o
       código continua funcionando sozinho, então isto nunca é fatal. */
  }

  console.log('  ┌────────────────────────────────────────────────┐');
  console.log('  │  Abra a IARA no celular, vá em Dispositivos e   │');
  console.log('  │  digite este código:                           │');
  console.log('  │                                                │');
  console.log(`  │              ${pedido.codigo.padEnd(34)}│`);
  console.log('  └────────────────────────────────────────────────┘');
  console.log('\n  Esperando a autorização… (o código vale por 5 minutos)\n');

  const credencial = await aguardarAprovacao(motor, pedido);
  if (!credencial) {
    console.log('  O código expirou sem ser autorizado. Feche e abra o programa para tentar de novo.\n');
    return false;
  }

  salvarCredencial({
    motor,
    token_dispositivo: credencial.token_dispositivo,
    email: credencial.email,
    atualizado_em: new Date().toISOString(),
  });

  console.log(`  Pronto. Este computador agora atende a IARA${credencial.email ? ` de ${credencial.email}` : ''}.`);
  console.log(`  Credencial guardada em ${caminhoCredencial()}`);
  console.log('  Pode deixar esta janela aberta e minimizada.\n');
  return true;
}

/**
 * Garante que existe COM O QUE se apresentar antes de a primeira conexão sair.
 *
 * Devolve sempre — inclusive quando o pareamento falhou. Falhar aqui não pode
 * impedir o laço de conexão de começar: contra um motor em modo local não há
 * pareamento nenhum a fazer, e recusar-se a conectar transformaria o loop de
 * desenvolvimento em algo que só funciona com banco configurado.
 */
async function garantirIdentidade(): Promise<void> {
  if (process.env.IARA_TOKEN) return;
  if (process.env.IARA_MOTOR_WS) return; // motor apontado à mão: quem digitou sabe
  if (lerCredencial()) return;
  await parearEsteComputador();
}

/**
 * Recuo exponencial com teto. Sem o teto, um motor fora do ar por uma noite
 * levaria o braço a tentar de novo daqui a horas — e a pessoa chega de manhã
 * com o computador "desconectado" sem motivo aparente. Com ele, o pior caso é
 * meio minuto de atraso depois que o motor volta.
 */
const RECUO_INICIAL_MS = 1_000;
const RECUO_MAXIMO_MS = 30_000;

let recuo = RECUO_INICIAL_MS;
let encerrando = false;
let socket: WebSocket | null = null;

/**
 * Execuções em curso NESTE braço.
 *
 * Existe para uma razão só, e ela é de idempotência: o motor pode reenviar uma
 * ordem quando acha que o socket caiu antes da entrega. Se a ordem de fato
 * chegou nas duas vezes, executar duas vezes abriria dois Blocos de Notas. O
 * `execucao_id` é o mesmo nas duas cópias — então a segunda encontra a primeira
 * aqui e se cala.
 */
const emCurso = new Map<string, Promise<RelatoExecucao>>();
/** Relatos já entregues, por um instante: cobre a reentrega que chega DEPOIS
 *  de a primeira ter terminado. */
const concluidas = new Map<string, { relato: RelatoExecucao; assinatura: string; em: number }>();

/**
 * O QUE ESTA ORDEM PEDE, em uma linha.
 *
 * Guardada junto do relato para que o cache só responda por uma ordem
 * IDÊNTICA. A raiz do defeito que motivou isto foi consertada do outro lado —
 * `execucao_id` agora carrega a marca do processo e não se repete entre vidas
 * do motor (ver `lib/execucao.ts`). Esta é a segunda tranca, e ela existe
 * porque a primeira depende de um contrato que este processo não controla: o
 * braço roda no computador de alguém e conversa com o motor que estiver lá,
 * inclusive uma versão mais velha. Uma cache que devolve o relato de OUTRA ação
 * é uma mentira com selo de sucesso, e vale ter duas defesas contra isso.
 */
function assinaturaDa(ordem: OrdemExecucao): string {
  /**
   * `\0` e JSON, não `=`/`&`/`|`: um valor de parâmetro pode conter os três, e
   * duas ordens diferentes com a mesma assinatura fariam esta cache — que
   * existe para impedir mentira — devolver o relato da ação errada. É o mesmo
   * conserto de `Braco.chaveDe`, e as duas travas precisam concordar sobre o
   * que é "a mesma ordem" para que a segunda ainda seja uma segunda tranca.
   */
  const parametros = JSON.stringify(
    Object.keys(ordem.parametros)
      .sort()
      .map((k) => [k, ordem.parametros[k]]),
  );
  return [ordem.acao, parametros].join('\0');
}

function enviar(pacote: PacoteBraco): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  try {
    socket.send(JSON.stringify(pacote));
  } catch (erro) {
    console.warn(`[braço] não consegui responder ao motor: ${(erro as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// ATUALIZAÇÃO AUTOMÁTICA — Etapa 2 (14/08/2026)
//
// A regra que governa este bloco inteiro: NUNCA tocar no executável atual
// antes de o download inteiro ter chegado E o SHA256 ter batido. Uma falha
// em qualquer ponto anterior a isso deixa a versão instalada exatamente como
// estava — `atualizacao_falhou` é o único desfecho possível de um problema,
// nunca um executável pela metade.
// ---------------------------------------------------------------------------

/** Uma atualização de cada vez. Clique duplo na gaveta não pode disparar
 *  dois downloads pisando no mesmo arquivo temporário. */
let atualizando = false;

/**
 * Só o binário empacotado (Node SEA) pode ser substituído. Rodando por
 * `npx tsx` (desenvolvimento), `process.execPath` aponta para o `node.exe`
 * do sistema — tentar "atualizar" ali seria substituir o Node de quem está
 * codando, não o programa da IARA. `node:sea` é a forma oficial de saber a
 * diferença; a ausência do módulo (Node mais velho) é tratada como "não é
 * SEA", nunca como exceção que derruba o braço.
 */
async function rodandoComoExecutavelEmpacotado(): Promise<boolean> {
  try {
    // Import DINÂMICO, não estático: `node:sea` é recente, e um `import`
    // no topo do arquivo quebraria a subida inteira num Node sem o módulo.
    // Este arquivo é ESM (`"type": "module"`) — `require` não existe aqui
    // fora do bundle CJS que `empacotar-braco.ts` produz.
    const sea = (await import('node:sea')) as { isSea: () => boolean };
    return sea.isSea();
  } catch {
    return false;
  }
}

/** Percentual só sobe quando muda de verdade — não vale a pena mandar
 *  socket a cada byte quando o número exibido não mudaria. */
function percentualMudou(anterior: number, novo: number): boolean {
  return novo === 100 || novo - anterior >= 2;
}

async function atualizar(pedido: { url: string; sha256: string; versao: string }): Promise<void> {
  if (atualizando) {
    console.warn('[braço] pedido de atualização ignorado: já existe uma em andamento');
    return;
  }
  atualizando = true;

  const empacotado = await rodandoComoExecutavelEmpacotado();
  if (!empacotado) {
    atualizando = false;
    const motivo =
      'este processo está rodando em modo de desenvolvimento (tsx), não como o programa instalado — ' +
      'atualização automática só se aplica ao executável empacotado.';
    console.warn(`[braço] atualização recusada: ${motivo}`);
    enviar({ tipo: 'atualizacao_falhou', motivo });
    return;
  }

  const caminhoNovo = path.join(tmpdir(), 'iara-braco-novo.exe');
  const hash = createHash('sha256');
  let ultimoPercentualEnviado = -1;

  try {
    console.log(`[braço] baixando atualização (${pedido.versao}) de ${pedido.url}`);
    const resposta = await fetch(pedido.url);
    if (!resposta.ok || !resposta.body) {
      throw new Error(`servidor respondeu ${resposta.status}`);
    }
    const tamanhoTotal = Number(resposta.headers.get('content-length') ?? 0);

    let recebidos = 0;
    const destino = createWriteStream(caminhoNovo);
    try {
      // @ts-expect-error — `Response.body` (WHATWG ReadableStream) é
      // async-iterável em tempo de execução no Node 18+; o tipo do DOM lib
      // não declara isso, mas o comportamento é garantido pela runtime.
      for await (const pedaco of resposta.body) {
        const buf = Buffer.from(pedaco as Uint8Array);
        hash.update(buf);
        await new Promise<void>((resolve, reject) => {
          destino.write(buf, (erro) => (erro ? reject(erro) : resolve()));
        });
        recebidos += buf.length;
        if (tamanhoTotal > 0) {
          const percentual = Math.min(99, Math.floor((recebidos / tamanhoTotal) * 100));
          if (percentualMudou(ultimoPercentualEnviado, percentual)) {
            ultimoPercentualEnviado = percentual;
            enviar({ tipo: 'progresso_atualizacao', percentual });
          }
        }
      }
    } finally {
      await new Promise<void>((resolve) => destino.end(resolve));
    }

    const hashCalculado = hash.digest('hex');
    if (hashCalculado !== pedido.sha256) {
      unlinkSync(caminhoNovo);
      throw new Error(
        `verificação de integridade falhou (esperado ${pedido.sha256.slice(0, 12)}…, ` +
          `recebido ${hashCalculado.slice(0, 12)}…) — o download pode ter sido corrompido ou adulterado`,
      );
    }

    enviar({ tipo: 'progresso_atualizacao', percentual: 100 });
    console.log('[braço] download íntegro; preparando a troca do executável');
    religarComVersaoNova(caminhoNovo);
    /**
     * `return`, NÃO um `throw`. BUG REAL, achado testando de verdade
     * (14/08/2026): `religarComVersaoNova` só AGENDA a saída — o
     * `process.exit` dentro dela é adiado por `setTimeout`, então o código
     * daqui volta a rodar ANTES de o processo morrer. Um `throw` aqui caía
     * no `catch` abaixo, que apaga `caminhoNovo` por engano de "a
     * atualização falhou" — apagando o arquivo baixado bem na frente do
     * script de religamento, que corria atrás de um arquivo que acabara de
     * sumir. O sintoma era exatamente esse: `atualizacao_falhou` reportado
     * mesmo com o download e a validação tendo dado certo, e o executável
     * nunca era trocado. Ver `testes/pareamento.test.ts`, que não pega este
     * bug — só o E2E com o `.exe` de verdade pegou.
     */
    return;
  } catch (erro) {
    if (existsSync(caminhoNovo)) {
      try {
        unlinkSync(caminhoNovo);
      } catch {
        /* limpeza de melhor esforço — não é o motivo real da falha */
      }
    }
    const motivo = (erro as Error).message;
    console.error(`[braço] atualização falhou: ${motivo}`);
    enviar({ tipo: 'atualizacao_falhou', motivo });
    atualizando = false;
  }
}

/**
 * O RELIGAMENTO — a metade que precisa de um processo SEPARADO.
 *
 * O Windows não deixa um executável apagar ou sobrescrever a si mesmo
 * enquanto está rodando: o arquivo fica com lock enquanto o processo existe.
 * Por isso este script pequeno, escrito num arquivo à parte e lançado
 * DESTACADO — ele sobrevive ao `process.exit` de quem o criou, espera o
 * lock soltar (o `copy` falha e tenta de novo, em vez de um `sleep` fixo
 * que seria um chute sobre quanto tempo o SO leva para soltar o arquivo),
 * troca o executável, e só então reabre o programa.
 *
 * Não devolve nada em caso de sucesso — a última coisa que este processo
 * faz é `process.exit`. Só retorna (e o chamador trata como falha) quando
 * nem consegue ESCREVER o script.
 */
function religarComVersaoNova(caminhoNovo: string): void {
  const atual = process.execPath;
  const scriptPath = path.join(tmpdir(), `iara-braco-religar-${Date.now()}.bat`);
  /**
   * `copy /y` em loop, não `move`: `move` falha de vez quando o destino
   * ainda está com lock, e um `goto retry` depois disso repetiria sobre um
   * estado que já falhou de um jeito diferente. `copy` sobrescreve no
   * lugar, e falhar por lock é exatamente o caso que o loop existe para
   * absorver — até 30 tentativas (~15s) antes de desistir e avisar.
   */
  const script = [
    '@echo off',
    'setlocal',
    'set /a tentativas=0',
    ':tentar',
    'set /a tentativas+=1',
    'timeout /t 1 /nobreak >nul',
    `copy /y "${caminhoNovo}" "${atual}" >nul 2>&1`,
    'if not errorlevel 1 goto trocou',
    'if %tentativas% lss 30 goto tentar',
    // Desistiu: limpa os dois arquivos temporários (script E download) antes
    // de sair, em vez de deixar lixo — a versão instalada continua a antiga.
    `del "${caminhoNovo}" >nul 2>&1`,
    'del "%~f0" >nul 2>&1',
    'exit /b 1',
    ':trocou',
    `del "${caminhoNovo}" >nul 2>&1`,
    `start "" "${atual}"`,
    'del "%~f0" >nul 2>&1',
    '',
  ].join('\r\n');

  writeFileSync(scriptPath, script, 'utf8');

  const processo = spawn('cmd.exe', ['/c', scriptPath], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  processo.unref();

  console.log('[braço] religamento agendado; encerrando esta versão agora');
  socket?.close(1000, 'atualizando');
  encerrando = true;
  // Uma folga curta para o `spawn` acima terminar de registrar o processo
  // filho no SO antes deste morrer — sem ela, em máquinas lentas o filho
  // detached corre risco de não sobreviver ao pai em alguns ambientes.
  setTimeout(() => process.exit(0), 200);
}

async function atender(ordem: OrdemExecucao): Promise<void> {
  const assinatura = assinaturaDa(ordem);
  const guardado = concluidas.get(ordem.execucao_id);
  if (guardado) {
    if (guardado.assinatura === assinatura) {
      console.log(`[braço] ${ordem.execucao_id} já executada; reenviando o relato original`);
      enviar({ tipo: 'concluida', relato: guardado.relato });
      return;
    }
    /**
     * Mesmo id, ordem DIFERENTE. Isso não é reentrega — é colisão de
     * identidade, e responder com o relato guardado seria relatar o sucesso de
     * uma ação que ninguém pediu. Descarta o cache e executa o que chegou.
     */
    console.warn(
      `[braço] ${ordem.execucao_id} reaproveitado para outra ordem ` +
        `("${guardado.assinatura}" → "${assinatura}"); descartando o relato antigo e executando a nova`,
    );
    concluidas.delete(ordem.execucao_id);
  }
  const jaCorrendo = emCurso.get(ordem.execucao_id);
  if (jaCorrendo) {
    console.log(`[braço] ${ordem.execucao_id} já está em curso; ignorando a cópia`);
    return;
  }

  /**
   * Os dois avisos ANTES de executar, e nesta ordem. `recebida` é o que
   * distingue, do lado do motor, "a rede engoliu a ordem" de "o braço está
   * demorando" — sem ele, um timeout não tem como dizer qual dos dois foi.
   */
  enviar({ tipo: 'recebida', execucao_id: ordem.execucao_id });
  enviar({ tipo: 'executando', execucao_id: ordem.execucao_id });

  const trabalho = executarOrdem(ordem, 'dispositivo', NOME);
  emCurso.set(ordem.execucao_id, trabalho);

  const relato = await trabalho;
  emCurso.delete(ordem.execucao_id);

  const agora = Date.now();
  concluidas.set(ordem.execucao_id, { relato, assinatura, em: agora });
  for (const [k, v] of concluidas) if (agora - v.em > 5 * 60_000) concluidas.delete(k);

  console.log(
    `[braço] ${ordem.execucao_id} ${ordem.acao} → ${relato.estado} ` +
      `(${relato.duracao_ms} ms) — ${relato.prova.evidencia}`,
  );
  enviar({ tipo: 'concluida', relato });
}

/** Agenda a próxima tentativa e alarga o recuo. Um lugar só, para que nenhum
 *  caminho de falha esqueça de reagendar — ou reagende duas vezes. */
function tentarDeNovo(): void {
  if (encerrando) return;
  setTimeout(() => void conectar(), recuo);
  recuo = Math.min(recuo * 2, RECUO_MAXIMO_MS);
}

async function conectar(): Promise<void> {
  if (encerrando) return;

  const DESTINO = destino();

  let token: string | undefined;
  try {
    token = await tokenDaVez();
  } catch (erro) {
    /**
     * Sessão revogada é a única falha deste processo que a operadora RESOLVE, e
     * por isso é a única que ganha instrução em vez de código de erro. Continua
     * tentando — o refresh pode ter falhado por rede, e desistir de vez deixaria
     * o computador mudo até alguém reparar.
     */
    const motivo = erro instanceof SessaoExpirada ? erro.message : (erro as Error).message;
    console.error(
      `[braço] não consegui renovar a sessão deste computador: ${motivo}\n` +
        '        Apague o arquivo abaixo e abra o programa de novo para parear ' +
        `este computador outra vez\n        (${caminhoCredencial()}).`,
    );
    tentarDeNovo();
    return;
  }

  if (!token) {
    // Um aviso por tentativa, e não um erro: contra um motor local isto é o
    // funcionamento normal, e o motor é quem decide se aceita.
    console.warn(
      '[braço] sem credencial gravada e sem IARA_TOKEN — só o motor em modo local vai aceitar. ' +
        'Para conectar na IARA da nuvem, feche e abra o programa: ele pede um código de pareamento.',
    );
  }

  console.log(`[braço] conectando em ${DESTINO}…`);

  const ws = new WebSocket(DESTINO, {
    /**
     * A ORIGEM é obrigatória, e descobri-la custou tempo: `principal.ts` recusa
     * o upgrade quando não há cabeçalho `Origin`, exceto em desenvolvimento. Um
     * cliente Node não manda `Origin` sozinho — o navegador é que manda. Sem
     * esta linha o braço apanha um 403 mudo contra um motor de produção
     * configurado corretamente.
     */
    headers: { Origin: origemDe(DESTINO) },
  });
  socket = ws;

  ws.on('open', () => {
    console.log('[braço] conectado; apresentando este computador');
    enviar({
      tipo: 'apresentacao',
      id_usuario: ID_USUARIO,
      nome: NOME,
      plataforma: `${platform()} ${release()}`,
      versao: VERSAO,
      ...(token ? { token } : {}),
    });
  });

  ws.on('message', (dado) => {
    const pacote = lerPacoteMotor(dado.toString());
    if (!pacote) return;

    if (pacote.tipo === 'bem_vindo') {
      // O recuo só volta ao mínimo quando a conexão de fato SERVIU. Zerar no
      // `open` faria um motor que aceita e recusa em seguida virar laço apertado.
      recuo = RECUO_INICIAL_MS;
      console.log(`[braço] registrado no motor como ${pacote.id_dispositivo} (operador ${ID_USUARIO})`);
      return;
    }

    if (pacote.tipo === 'recusado') {
      console.error(`[braço] o motor recusou este computador: ${pacote.motivo}`);
      return;
    }

    if (pacote.tipo === 'atualizar') {
      void atualizar(pacote);
      return;
    }

    if (pacote.tipo === 'executar') {
      void atender(pacote.ordem).catch((erro: Error) => {
        /**
         * `atender` já captura o que o executor lança. Este `catch` cobre o que
         * sobrar — e ele não pode ficar calado: uma ordem que morre aqui sem
         * relato deixa o motor esperando até o prazo, e o operador recebe
         * "não sei" no lugar de "deu errado".
         */
        console.error(`[braço] falha ao atender ${pacote.ordem.execucao_id}: ${erro.message}`);
        enviar({
          tipo: 'concluida',
          relato: {
            execucao_id: pacote.ordem.execucao_id,
            estado: 'falhou',
            texto: 'O programa da IARA no seu computador falhou ao executar isso.',
            prova: { confirmado: false, evidencia: `exceção no braço: ${erro.message}`, motivo: 'divergente' },
            codigo_erro: 'FALHA_NA_EXECUCAO',
            duracao_ms: 0,
            dispositivo: NOME,
            onde: 'dispositivo',
          },
        });
      });
    }
  });

  ws.on('close', (codigo, motivo) => {
    socket = null;
    if (encerrando) return;
    const explicacao = motivo.toString() || 'sem motivo declarado';
    console.warn(`[braço] conexão fechada (${codigo}: ${explicacao}); tentando de novo em ${recuo} ms`);
    tentarDeNovo();
  });

  ws.on('error', (erro: Error) => {
    // O `close` vem logo atrás e é ele quem reagenda; aqui só se explica.
    console.warn(`[braço] erro de conexão: ${erro.message}`);
  });
}

/** `ws://host:porta/caminho` → `http://host:porta`. */
function origemDe(url: string): string {
  try {
    const u = new URL(url);
    const esquema = u.protocol === 'wss:' ? 'https:' : 'http:';
    return `${esquema}//${u.host}`;
  } catch {
    return 'http://localhost';
  }
}

const encerrar = () => {
  encerrando = true;
  console.log('\n[braço] encerrando…');
  socket?.close(1000, 'encerrando');
  setTimeout(() => process.exit(0), 300).unref();
};
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

console.log(`[braço] IARA — braço v${VERSAO} em ${NOME} (${platform()} ${release()})`);
/**
 * O pareamento acontece ANTES da primeira conexão, e não em paralelo com ela.
 *
 * Conectar primeiro produziria, na primeira execução de toda máquina nova, uma
 * recusa do motor no console — "este computador não está autorizado" — em cima
 * do código que a pessoa deveria estar lendo. Ela veria um erro e um código, e
 * não teria como saber que o erro era esperado.
 */
void garantirIdentidade().then(() => conectar());
