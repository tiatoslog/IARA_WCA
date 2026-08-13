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
 * COMO RODAR. No computador da operadora, uma vez:
 *
 *   npm run braco:entrar     (login; guarda a sessão fora do repositório)
 *   npm run braco            (fica rodando)
 *
 * No loop de desenvolvimento, sem login nenhum:
 *
 *   IARA_MOTOR_WS=ws://localhost:3000/dispositivo IARA_ID_USUARIO=daiane npm run braco
 *
 * A IDENTIDADE tem três fontes, nesta ordem: `IARA_TOKEN` (colado à mão, que é
 * como isto nasceu e continua servindo para depurar), a sessão renovável em
 * disco (`credencial.ts`) e, por último, nada — o que só funciona com o motor
 * em modo local, onde não há Supabase para verificar coisa alguma.
 *
 * O destino final deste processo é ser hospedado pelo shell Tauri
 * (`apps/desktop`), que hoje só desenha janela — é exatamente a "Fase 3"
 * anunciada no cabeçalho do `main.rs`. Enquanto isso ele é um processo Node à
 * parte, que é o que permite provar a cadeia inteira hoje em vez de depois do
 * instalador.
 */

import { WebSocket } from 'ws';
import { config as carregarEnv } from 'dotenv';
import { hostname, platform, release } from 'node:os';
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
  SessaoExpirada,
  wsDoMotor,
} from './credencial';

carregarEnv({ path: '.env.local' });
carregarEnv();

const VERSAO = '1.0.0';

const ID_USUARIO = process.env.IARA_ID_USUARIO ?? 'daiane';
const NOME = process.env.IARA_NOME_DISPOSITIVO ?? hostname();

/**
 * Para onde ligar. O ambiente ganha da credencial porque o ambiente é o que
 * alguém acabou de digitar — e quem digita está depurando.
 */
function destino(): string {
  if (process.env.IARA_MOTOR_WS) return process.env.IARA_MOTOR_WS;
  const guardada = lerCredencial();
  if (guardada?.motor) {
    try {
      return wsDoMotor(guardada.motor);
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
 * `undefined` não é falha: em modo local o motor não verifica token nenhum.
 */
async function tokenDaVez(): Promise<string | undefined> {
  const colado = process.env.IARA_TOKEN;
  if (colado) return colado;

  const guardada = lerCredencial();
  if (!guardada) return undefined;
  return renovarAcesso(guardada);
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
        `        Rode  npm run braco:entrar  para entrar de novo ` +
        `(sessão em ${caminhoCredencial()}).`,
    );
    tentarDeNovo();
    return;
  }

  if (!token) {
    // Um aviso por tentativa, e não um erro: contra um motor local isto é o
    // funcionamento normal, e o motor é quem decide se aceita.
    console.warn(
      '[braço] sem sessão gravada e sem IARA_TOKEN — só o motor em modo local vai aceitar. ' +
        'Para conectar na IARA da nuvem: npm run braco:entrar',
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
void conectar();
