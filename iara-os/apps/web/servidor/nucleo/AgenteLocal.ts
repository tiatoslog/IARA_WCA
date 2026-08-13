/**
 * Agente Local — as mãos da IARA no computador onde o motor roda.
 *
 * FRONTEIRAS, ANTES DE QUALQUER COISA:
 *
 *  1. RAÍZES AUTORIZADAS. Escrita de pasta só dentro de Área de Trabalho,
 *     Documentos e Downloads do usuário do processo. Não existe parâmetro de
 *     caminho livre — o operador escolhe um LOCAL nomeado, nunca um path.
 *  2. ALLOWLIST DE APLICATIVOS. Abrir aplicativo é escolher de um mapa
 *     fechado, revisado em commit. Não existe "execute este comando".
 *  3. ENERGIA É R2. Desligar/reiniciar/suspender NUNCA executa direto: vira
 *     pendência de 60 segundos que só a palavra "confirmo" do MESMO operador,
 *     NA MESMA CONVERSA, libera — e para a ação que foi de fato anunciada, não
 *     para o que estiver no slot. Cancelar sempre funciona, inclusive depois do
 *     agendamento (shutdown do Windows com atraso + /a) e inclusive de outra
 *     conversa: desistir nunca exige a prova que agir exige.
 *  4. A CAPTURA DE TELA NUNCA É LIDA. O arquivo nasce no disco do operador e o
 *     processo devolve caminho e tamanho — nunca bytes de imagem. É a mesma
 *     regra do RAG, que injeta assinatura e não log bruto: o que não entra no
 *     resultado não tem como vazar para o prompt no passo seguinte.
 *  5. AUDITORIA. Toda ação — executada, recusada ou pendente — vira uma linha
 *     JSON no canal `agente_local`, sem copiar conteúdo de conversa.
 *
 * A LLM não chega aqui: quem chama são habilidades do catálogo, com esquema
 * validado, e os parâmetros dela são rótulos de listas fechadas. É a mesma
 * regra do resto do sistema — a IA propõe, o determinístico executa.
 */

import { mkdir, readdir } from 'node:fs/promises';
import { existsSync, statSync, statfs } from 'node:fs';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { cpus, freemem, homedir, hostname, networkInterfaces, totalmem, uptime } from 'node:os';
import path from 'node:path';
import type { CodigoErro, ProvaExecucao } from '../../lib/execucao';
import {
  JANELA_PROCESSOS_MS,
  SCRIPT_PROCESSOS,
  interpretarProcessos,
  medirCpu,
  montarMedicao,
  type Disco,
  type ProcessoMedido,
} from './SondasDesempenho';

/**
 * O que uma ação das mãos devolve.
 *
 * ANTES era `string`, e a diferença não é de forma — é de honestidade. Uma
 * frase carrega o RELATO do executor; ela não carrega o que foi APURADO depois.
 * Com só a frase atravessando a fronteira, a quinta porta (`Habilidade.
 * verificar`) tinha que reconferir o mundo a partir do processo do motor — o
 * que funcionava enquanto o motor E as mãos eram a mesma máquina, e passou a
 * conferir o disco errado no dia em que deixaram de ser.
 *
 * Agora a prova nasce onde o efeito nasce, e viaja junto.
 */
export interface RelatoAcao {
  readonly ok: boolean;
  readonly texto: string;
  readonly prova: ProvaExecucao;
  readonly codigo_erro: CodigoErro | null;
  /**
   * A OBSERVAÇÃO em estrutura, para as ações que medem em vez de agir. Ver o
   * campo homônimo em `RelatoExecucao`: quem consome trata a ausência como
   * lacuna, nunca como zero.
   */
  readonly dados?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Raízes autorizadas
// ---------------------------------------------------------------------------

export type LocalAutorizado = 'area_de_trabalho' | 'documentos' | 'downloads';

export const ROTULO_DO_LOCAL: Record<LocalAutorizado, string> = {
  area_de_trabalho: 'Área de Trabalho',
  documentos: 'Documentos',
  downloads: 'Downloads',
};

/**
 * Resolve o local nomeado para um caminho REAL desta máquina. Windows com
 * OneDrive move Desktop/Documentos para dentro do OneDrive (com nome
 * localizado) — por isso é uma lista de candidatos, não um caminho fixo.
 */
export function resolverRaiz(local: LocalAutorizado): string | null {
  const casa = homedir();
  const candidatos: Record<LocalAutorizado, string[]> = {
    area_de_trabalho: [
      path.join(casa, 'OneDrive', 'Área de Trabalho'),
      path.join(casa, 'OneDrive', 'Desktop'),
      path.join(casa, 'Desktop'),
    ],
    documentos: [
      path.join(casa, 'OneDrive', 'Documentos'),
      path.join(casa, 'OneDrive', 'Documents'),
      path.join(casa, 'Documents'),
    ],
    downloads: [path.join(casa, 'Downloads')],
  };
  return candidatos[local].find((c) => existsSync(c)) ?? null;
}

/**
 * Nome de pasta seguro: letras (com acento), números, espaço e -_.
 * Sem barra, sem `..`, sem terminar em ponto/espaço (o NTFS engole e o
 * caminho passa a mentir). O nome NUNCA é interpretado como caminho.
 */
export function validarNomePasta(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo.length === 0 || limpo.length > 60) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(limpo)) return null;
  if (limpo.includes('..') || /[. ]$/.test(limpo)) return null;
  return limpo;
}

// ---------------------------------------------------------------------------
// Aplicativos autorizados
// ---------------------------------------------------------------------------

interface AplicativoAutorizado {
  rotulo: string;
  comando: string;
  argumentos: string[];
  /**
   * O NOME DE IMAGEM que prova que o aplicativo subiu.
   *
   * Sem este campo, `abrir_aplicativo` não tinha como se verificar e declarava
   * `sem_meio_de_verificar` — uma limitação honesta, e evitável. O comando
   * lançado nem sempre é o processo que fica: `calc.exe` é um trampolim que
   * morre depois de acordar o `CalculatorApp.exe`, e `cmd /c start chrome` sai
   * assim que o Windows resolve o registro. Verificar o que foi LANÇADO
   * confirmaria o trampolim; o que interessa é o que FICOU.
   */
  processo: string;
  /**
   * Fechar é uma ação separada, e nem todo aplicativo desta lista aceita ser
   * fechado pela IARA. O Explorador de Arquivos é o shell do Windows: derrubá-lo
   * apaga a barra de tarefas e a área de trabalho de quem estiver na frente.
   */
  fechavel: boolean;
}

/**
 * O mapa É a permissão. Adicionar aplicativo = adicionar linha aqui, em
 * commit revisado. As chaves são o que o reconhecedor procura na frase.
 */
const APLICATIVOS: Record<string, AplicativoAutorizado> = {
  'bloco de notas': { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [], processo: 'notepad.exe', fechavel: true },
  notepad: { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [], processo: 'notepad.exe', fechavel: true },
  /**
   * A Calculadora do Windows 10/11 é um app da Store: `calc.exe` é um lançador
   * que termina em seguida, e quem permanece é `CalculatorApp.exe`. Conferir
   * `calc.exe` daria sempre "não apareceu" numa calculadora que está na tela.
   */
  calculadora: { rotulo: 'Calculadora', comando: 'calc.exe', argumentos: [], processo: 'CalculatorApp.exe', fechavel: true },
  paint: { rotulo: 'Paint', comando: 'mspaint.exe', argumentos: [], processo: 'mspaint.exe', fechavel: true },
  explorador: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  explorer: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  arquivos: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  // Navegadores instalam fora do PATH; `start` resolve pelo registro do app.
  chrome: { rotulo: 'Google Chrome', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'chrome'], processo: 'chrome.exe', fechavel: true },
  edge: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'], processo: 'msedge.exe', fechavel: true },
  navegador: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'], processo: 'msedge.exe', fechavel: true },
};

/**
 * "o Bloco de Notas", "a Calculadora".
 *
 * Detalhe pequeno e não decorativo: a primeira bateria real produziu "Pronto.
 * Abri o Calculadora no computador." A IARA fala português o tempo todo, e um
 * erro de concordância na frase que confirma uma AÇÃO é onde ele mais aparece —
 * é a frase que a pessoa lê com atenção, porque quer saber se deu certo.
 *
 * Derivado do rótulo em vez de declarado por entrada: o mapa tem três aliases
 * para o mesmo Explorador, e três campos `artigo` para concordar entre si é
 * exatamente o tipo de repetição que fica errada na quarta linha.
 */
export function artigoDe(rotulo: string): 'o' | 'a' {
  return /^(calculadora|área|agenda|planilha)/i.test(rotulo) ? 'a' : 'o';
}

export function resolverAplicativo(pedido: string): AplicativoAutorizado | null {
  const t = pedido
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  // Chaves mais longas primeiro: "bloco de notas" antes de "notas".
  const chaves = Object.keys(APLICATIVOS).sort((a, b) => b.length - a.length);
  for (const chave of chaves) {
    if (t.includes(chave)) return APLICATIVOS[chave];
  }
  return null;
}

/**
 * O caminho INVERSO de `resolverAplicativo`: dado um nome de imagem que a sonda
 * de desempenho observou rodando, este é um aplicativo que a IARA sabe fechar?
 *
 * Existe separado, e casando pelo campo `processo` em vez de por substring na
 * frase, porque as duas perguntas não são a mesma. `resolverAplicativo` procura
 * o que o operador ESCREVEU dentro de um vocabulário generoso — ali "abre os
 * arquivos" achar o Explorador é acerto. Aqui a entrada é um nome de processo
 * vindo do sistema operacional, e a mesma generosidade seria defeito: um
 * processo chamado `arquivos_backup` contém "arquivos" e viraria uma oferta de
 * derrubar o shell do Windows.
 *
 * Devolve `null` para processo desconhecido E para processo conhecido não
 * fechável — quem chama só precisa saber se pode OFERECER o fechamento, e as
 * duas respostas são "não pode".
 */
export function aplicativoFechavelDoProcesso(imagem: string): { rotulo: string } | null {
  const alvo = imagem
    .trim()
    .toLowerCase()
    .replace(/\.exe$/, '');
  if (!alvo) return null;
  for (const app of Object.values(APLICATIVOS)) {
    if (!app.fechavel) continue;
    if (app.processo.toLowerCase().replace(/\.exe$/, '') === alvo) return { rotulo: app.rotulo };
  }
  return null;
}

export function aplicativosDisponiveis(): string {
  const rotulos = [...new Set(Object.values(APLICATIVOS).map((a) => a.rotulo))];
  return rotulos.join(', ');
}

// ---------------------------------------------------------------------------
// Captura de tela
// ---------------------------------------------------------------------------

/**
 * Subpasta fixa dentro da raiz autorizada. O operador escolhe a RAIZ — Área de
 * Trabalho, Documentos ou Downloads —, nunca um caminho. A subpasta existe para
 * que a captura tenha um lugar previsível: quem quiser apagar tudo que a IARA
 * já capturou apaga um diretório, não caça arquivos soltos.
 */
export const PASTA_CAPTURAS = 'Capturas IARA';

/**
 * A captura depende da API gráfica do Windows E de haver uma sessão com tela.
 *
 * Isto NÃO vira `indisponivelPorque` na habilidade, e a escolha é deliberada:
 * uma receita determinística que aponta para habilidade opcional some do
 * planejador no ambiente errado, e o operador recebe silêncio. Aqui ele recebe
 * uma frase. O motor publicado no Railway roda em Linux e responde exatamente
 * isso quando alguém pede uma captura — que é a verdade, dita em voz alta.
 */
export function capturaIndisponivelPorque(): string | null {
  return process.platform === 'win32'
    ? null
    : `este motor está rodando em ${process.platform}, sem a API gráfica do Windows e sem tela para capturar`;
}

/** Nome com carimbo de tempo LOCAL: duas capturas nunca disputam o mesmo arquivo. */
export function nomeDaCaptura(agora = new Date()): string {
  const d = (n: number) => String(n).padStart(2, '0');
  return (
    `captura-${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}` +
    `-${d(agora.getHours())}${d(agora.getMinutes())}${d(agora.getSeconds())}.png`
  );
}

/**
 * O script que tira a foto. `VirtualScreen` e não `PrimaryScreen`: quem opera
 * com dois monitores tem metade do contexto no segundo, e capturar só o
 * primeiro produziria uma imagem que mente por omissão.
 *
 * O único valor interpolado é o destino, e ele nasce de `resolverRaiz` mais um
 * nome que este arquivo gera — nada do operador chega aqui. O escape de aspa
 * simples é cinto de segurança para o caso de o perfil do Windows ter uma.
 */
function scriptDeCaptura(destino: string): string {
  const alvo = destino.replace(/'/g, "''");
  return [
    'Add-Type -AssemblyName System.Windows.Forms,System.Drawing;',
    '$a=[System.Windows.Forms.SystemInformation]::VirtualScreen;',
    '$m=New-Object System.Drawing.Bitmap($a.Width,$a.Height);',
    '$g=[System.Drawing.Graphics]::FromImage($m);',
    '$g.CopyFromScreen($a.Location,[System.Drawing.Point]::Empty,$a.Size);',
    `$m.Save('${alvo}',[System.Drawing.Imaging.ImageFormat]::Png);`,
    '$g.Dispose();$m.Dispose()',
  ].join('');
}

// ---------------------------------------------------------------------------
// Energia — pendência com confirmação explícita
// ---------------------------------------------------------------------------

export type AcaoEnergia = 'desligar' | 'reiniciar' | 'suspender';

const ROTULO_ENERGIA: Record<AcaoEnergia, string> = {
  desligar: 'desligar o computador',
  reiniciar: 'reiniciar o computador',
  suspender: 'suspender o computador',
};

/** Janela para o "confirmo" chegar. Curta de propósito: confirmação velha
 *  executando ação esquecida é exatamente o acidente que este fluxo evita. */
const VALIDADE_PENDENCIA_MS = 60_000;

/**
 * A pendência de energia, com IDENTIDADE — não só uma ação solta.
 *
 * O DEFEITO, reproduzido na auditoria de fechamento (11/08/2026): a pendência
 * era `{ acao, expira_em }` indexada só por `id_usuario`. Duas consequências,
 * as duas confirmadas com executor espião:
 *
 *  1. TROCA SILENCIOSA DE AÇÃO. `pedirEnergia(u,'desligar')` seguido de
 *     `pedirEnergia(u,'reiniciar')` sobrescrevia o slot sem dizer nada. O
 *     operador que leu "vou desligar" e digitou "confirmo" recebia um REBOOT.
 *  2. CONFIRMAÇÃO ATRAVESSANDO CANAL. O `agenteLocal` é singleton do processo e
 *     a chave era só o usuário: uma pendência armada pelo WhatsApp podia ser
 *     liberada por um "confirmo" digitado no navegador — duas conversas
 *     diferentes, uma autorização só.
 *
 * `sessao` amarra a confirmação ao MESMO diálogo em que o pedido foi feito
 * (`Porta.ts` usa o id do operador; `PortaWhatsapp.ts` usa `whatsapp:<id>`, e é
 * por isso que os espelhos do navegador continuam funcionando entre si).
 * `id` é o nonce que dá à pendência uma identidade própria, para que
 * "confirmo" nunca seja um cheque em branco sobre o slot atual.
 */
interface Pendencia {
  readonly id: string;
  readonly acao: AcaoEnergia;
  readonly sessao: string;
  readonly criada_em: number;
  readonly expira_em: number;
}

/** Assinatura compatível com `child_process.spawn` — injetável nos testes
 *  para que "confirmar desligamento" seja testável sem desligar nada. */
export type Executor = (comando: string, argumentos: string[]) => void;

/**
 * O OUVINTE DE `error` NÃO É ZELO — é o que separa uma recusa de uma queda.
 *
 * Um `ChildProcess` é um `EventEmitter`, e `EventEmitter` sem ouvinte de
 * `error` LANÇA quando o evento sai. `spawn` não lança na chamada: ele volta
 * normalmente e reporta o ENOENT de forma assíncrona, uma volta de laço depois.
 * Sem esta linha, portanto, pedir um executável ausente não devolvia erro —
 * derrubava o processo inteiro por exceção não capturada, levando junto a
 * sessão de todos os outros operadores.
 *
 * Reproduzido antes de corrigir: `spawn('programa-que-nao-existe.exe')` com a
 * forma anterior deste executor termina o processo com `uncaughtException:
 * spawn ... ENOENT`. Num motor Linux — que é onde ele roda hoje — TODO pedido
 * de energia ou de aplicativo caía nesse caminho.
 */
const executorReal: Executor = (comando, argumentos) => {
  const filho = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });
  filho.on('error', (erro: Error) => {
    console.log(
      JSON.stringify({ canal: 'agente_local', acao: 'lancamento_falhou', comando, detalhe: erro.message }),
    );
  });
  filho.unref();
};

/**
 * Lança um aplicativo e ESPERA para saber se ele subiu.
 *
 * O `Executor` acima solta o processo e não olha para trás; era ele que
 * sustentava a frase "Bloco de Notas aberto." — dita antes de existir qualquer
 * informação sobre o lançamento, e portanto dita com a mesma convicção quando
 * nada abria. É o falso positivo canônico, e a correção não é escrever a frase
 * com menos certeza: é ter a informação antes de escrever.
 *
 * Dois desfechos possíveis, e é por isso que a janela de graça existe:
 *
 *  - o processo TERMINA rápido. É o caso de `cmd /c start`, que apenas resolve o
 *    aplicativo no registro do Windows e sai. Aqui o código de saída é a
 *    resposta: zero significa que o Windows encontrou o alvo.
 *  - o processo CONTINUA vivo. É o caso de `notepad.exe`, que é o aplicativo em
 *    si. Esperar o fim seria esperar o operador fechar a janela.
 *
 * Sobreviver à janela de graça é evidência de lançamento, não de janela na tela
 * — essa parte quem responde é a sonda de processos.
 */
export type Lancador = (
  comando: string,
  argumentos: string[],
) => Promise<{ subiu: boolean; motivo: string }>;

const GRACA_LANCAMENTO_MS = 1500;

const lancadorReal: Lancador = (comando, argumentos) =>
  new Promise((resolver) => {
    let respondido = false;
    const responder = (r: { subiu: boolean; motivo: string }) => {
      if (respondido) return;
      respondido = true;
      clearTimeout(relogio);
      resolver(r);
    };

    let filho: ReturnType<typeof spawn>;
    try {
      filho = spawn(comando, argumentos, { detached: true, stdio: 'ignore', windowsHide: true });
    } catch (erro) {
      // `spawn` só lança de forma síncrona em erro de argumento, mas "só lança
      // em X" é uma afirmação sobre a versão do Node de hoje.
      resolver({ subiu: false, motivo: (erro as Error).message });
      return;
    }

    filho.on('error', (erro: Error) => responder({ subiu: false, motivo: erro.message }));
    filho.on('exit', (codigo) =>
      responder(
        codigo === 0
          ? { subiu: true, motivo: 'o lançador terminou sem erro' }
          : { subiu: false, motivo: `o lançador terminou com código ${codigo}` },
      ),
    );

    /**
     * O relógio NÃO leva `unref`, ao contrário do filho. É ele que segura o
     * laço de eventos vivo até a resposta existir — com os dois soltos, um
     * processo sem mais nada a fazer poderia terminar antes de saber o desfecho.
     */
    const relogio = setTimeout(
      () => responder({ subiu: true, motivo: 'continua em execução após a janela de graça' }),
      GRACA_LANCAMENTO_MS,
    );
    filho.unref();
  });

/**
 * Quem está rodando com este nome de imagem, agora.
 *
 * `null` significa NÃO SEI SONDAR — plataforma sem `tasklist`, ou a chamada
 * falhou. A distinção entre "sondei e não achei" (`[]`) e "não consigo sondar"
 * (`null`) é a mesma que separa `divergente` de `sem_meio_de_verificar` na
 * quinta porta, e fundir as duas faria a IARA declarar fracasso toda vez que
 * ela apenas não tivesse como olhar.
 */
export type SondaProcessos = (imagem: string) => Promise<number[] | null>;

const sondaReal: SondaProcessos = (imagem) =>
  new Promise((resolver) => {
    if (process.platform !== 'win32') {
      resolver(null);
      return;
    }
    execFile(
      'tasklist',
      ['/FI', `IMAGENAME eq ${imagem}`, '/NH', '/FO', 'CSV'],
      // `latin1` e não `utf8`: o `tasklist` responde na página de código do
      // console, e a mensagem de "nenhuma tarefa" sai acentuada em português.
      // Nada aqui depende dessa mensagem — mas decodificar errado produziria
      // ruído no log de auditoria.
      { windowsHide: true, encoding: 'latin1', timeout: 8000 },
      (erro, saida) => {
        if (erro) {
          resolver(null);
          return;
        }
        /**
         * A saída é lida como CSV, e não pela mensagem de texto, porque a
         * mensagem é TRADUZIDA: em português é "INFORMAÇÕES: nenhuma tarefa em
         * execução…", em inglês é outra coisa. Procurar por ela seria escrever
         * uma checagem que quebra na máquina de quem tem o Windows em outro
         * idioma — e quebra devolvendo "achei", que é o lado errado de falhar.
         * Linha CSV só existe quando há processo.
         */
        const pids: number[] = [];
        for (const linha of String(saida).split(/\r?\n/)) {
          const m = /^"([^"]+)","(\d+)"/.exec(linha.trim());
          if (m && m[1].toLowerCase() === imagem.toLowerCase()) pids.push(Number(m[2]));
        }
        resolver(pids);
      },
    );
  });

/**
 * A SONDA DETALHADA — quem consome o processador, agora.
 *
 * Mora aqui, e não em `SondasDesempenho.ts`, por causa da regra `A4` da
 * fronteira: `execFile` e `spawn` são confinados a este arquivo. A primeira
 * versão desta função vivia lá e derrubou a suíte — corretamente. Um segundo
 * lugar do sistema capaz de rodar um comando é uma segunda fronteira para
 * manter, e a auditoria que este arquivo carrega não a alcançaria.
 *
 * O script é constante e não interpola NADA vindo de fora. Ver `SCRIPT_PROCESSOS`.
 *
 * `null` = não sei sondar (outra plataforma, ou a chamada falhou). Mesma
 * distinção de `sondaReal`, e pelo mesmo motivo: "sondei e não achei" e "não
 * consigo olhar" pedem frases diferentes ao operador.
 */
const sondaDetalhadaReal: SondaDetalhada = () =>
  new Promise((resolver) => {
    if (process.platform !== 'win32') {
      resolver(null);
      return;
    }
    execFile(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', SCRIPT_PROCESSOS],
      {
        windowsHide: true,
        encoding: 'utf8',
        // Folga sobre a janela do script: ele dorme 1 s por construção, e o
        // interpretador leva o seu para subir numa máquina fria — que é
        // exatamente a máquina que se está investigando.
        timeout: JANELA_PROCESSOS_MS + 11_000,
        maxBuffer: 4 * 1024 * 1024,
      },
      (erro, saida) => {
        resolver(erro ? null : interpretarProcessos(String(saida), cpus().length));
      },
    );
  });

export type SondaDetalhada = () => Promise<readonly ProcessoMedido[] | null>;

/**
 * `fs.statfs` cobre Windows, Linux e macOS a partir do Node 18.15 — e quando não
 * cobrir, a chamada devolve erro e o campo vira `null`, que é o comportamento
 * pretendido. Nenhum `catch` esconde ausência de dado aqui: ela vira lacuna
 * declarada lá em cima.
 *
 * O volume é o do SISTEMA, não o do diretório do processo: é o disco cheio do
 * Windows que deixa a máquina lenta, não o disco de dados.
 */
export type SondaDisco = () => Promise<Disco | null>;

function raizDoSistema(): string {
  if (process.platform === 'win32') {
    return process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\';
  }
  return '/';
}

const sondaDiscoReal: SondaDisco = () =>
  new Promise((resolver) => {
    statfs(raizDoSistema(), (erro, s) => {
      if (erro || !s || !Number.isFinite(s.blocks) || s.blocks <= 0) {
        resolver(null);
        return;
      }
      /**
       * `bavail` (disponível sem privilégio), não `bfree`: em sistemas de
       * arquivos com reserva, `bfree` inclui blocos que ninguém consegue usar, e
       * relatar espaço que não dá para ocupar é o mesmo tipo de número enganoso
       * que este trabalho evita em toda parte.
       */
      const livre = Number(s.bavail) * Number(s.bsize);
      const total = Number(s.blocks) * Number(s.bsize);
      const arredondar = (n: number) => Math.round(n * 10) / 10;
      resolver({
        livre_pct: arredondar((livre / total) * 100),
        livre_gb: arredondar(livre / 1024 ** 3),
      });
    });
  });

/**
 * O SEGUNDO executor, e a razão de existirem dois.
 *
 * `Executor` solta o processo e não olha para trás — é o certo para abrir o
 * Bloco de Notas, e é justamente por isso que `abrir_aplicativo` declara
 * `sem_meio_de_verificar`. A captura de tela é o caso oposto: ela produz um
 * ARTEFATO, e prometer um arquivo sem esperar o processo que o escreve seria
 * relatar sucesso antes de o disco ter qualquer coisa. Quem espera pode provar.
 *
 * Devolve o código de saída (-1 se o processo nem chegou a subir), e é
 * injetável pelo mesmo motivo do outro: testar captura sem tirar foto de tela.
 */
export type ExecutorAguardado = (comando: string, argumentos: string[]) => Promise<number>;

const executorAguardadoReal: ExecutorAguardado = (comando, argumentos) =>
  new Promise((resolver) => {
    const filho = spawn(comando, argumentos, { stdio: 'ignore', windowsHide: true });
    filho.on('error', () => resolver(-1));
    filho.on('close', (codigo) => resolver(codigo ?? -1));
  });

// ---------------------------------------------------------------------------

export class AgenteLocal {
  /** Pendência R2 por operador — confirmação de A nunca libera ação de B. */
  private pendencias = new Map<string, Pendencia>();

  /**
   * Caminho da última captura BEM-SUCEDIDA de cada operador.
   *
   * Existe porque o verificador da habilidade não tem como recalcular o
   * destino: o nome carrega o segundo em que a foto foi tirada. Sem este mapa,
   * `verificar` só poderia reler o texto que `executar` devolveu — conferir o
   * relato contra o próprio relato, que é exatamente o que a quinta porta
   * existe para impedir. Aqui ele confere o DISCO, no caminho que o executor
   * registrou.
   */
  private capturas = new Map<string, string>();

  constructor(
    private readonly executor: Executor = executorReal,
    private readonly executorAguardado: ExecutorAguardado = executorAguardadoReal,
    /** Injetáveis pelo mesmo motivo dos outros dois: testar abertura de
     *  aplicativo sem abrir aplicativo, e testar a prova sem depender de qual
     *  máquina roda a suíte. */
    private readonly lancador: Lancador = lancadorReal,
    private readonly sonda: SondaProcessos = sondaReal,
    /**
     * As duas sondas de desempenho, injetáveis pela mesma razão das outras: um
     * teste precisa provar a análise de uma máquina saturada sem saturar a
     * máquina que roda a suíte, e provar o disco cheio sem encher o disco.
     */
    private readonly sondaDetalhada: SondaDetalhada = sondaDetalhadaReal,
    private readonly sondaDisco: SondaDisco = sondaDiscoReal,
  ) {}

  private auditar(idUsuario: string, acao: string, permitido: boolean, detalhe: string): void {
    console.log(
      JSON.stringify({ canal: 'agente_local', usuario: idUsuario, acao, permitido, detalhe }),
    );
  }

  async criarPasta(
    idUsuario: string,
    nomePedido: string,
    local: LocalAutorizado,
  ): Promise<string> {
    const nome = validarNomePasta(nomePedido);
    if (!nome) {
      this.auditar(idUsuario, 'criar_pasta', false, 'nome inválido');
      return (
        'Esse nome de pasta não passa na minha regra de segurança (só letras, números, espaço, hífen e sublinhado, até 60 caracteres). ' +
        'Me diga outro nome que eu crio na hora.'
      );
    }

    const raiz = resolverRaiz(local);
    if (!raiz) {
      this.auditar(idUsuario, 'criar_pasta', false, `raiz ${local} não encontrada`);
      return `Não encontrei a pasta ${ROTULO_DO_LOCAL[local]} neste computador.`;
    }

    const destino = path.join(raiz, nome);
    if (existsSync(destino)) {
      this.auditar(idUsuario, 'criar_pasta', true, 'já existia');
      return `A pasta "${nome}" já existe em ${ROTULO_DO_LOCAL[local]} (${destino}). Não mexi em nada.`;
    }

    await mkdir(destino);
    this.auditar(idUsuario, 'criar_pasta', true, destino);
    return `Pasta "${nome}" criada em ${ROTULO_DO_LOCAL[local]}: ${destino}`;
  }

  /**
   * Abre um aplicativo da lista e PROVA o que conseguir provar.
   *
   * O defeito que este método tinha era de duas naturezas ao mesmo tempo, e as
   * duas nasciam da mesma linha (`this.executor(...)` seguida de um `return`):
   *
   *  1. FALSO POSITIVO. `${app.rotulo} aberto.` era escrito antes de existir
   *     qualquer informação sobre o lançamento — e portanto era escrito
   *     igualzinho quando nada abria. A IARA dizia "Bloco de Notas aberto." com
   *     a mesma convicção num Windows com o Bloco de Notas e num contêiner Linux
   *     onde `notepad.exe` não existe.
   *  2. QUEDA DO PROCESSO. O `spawn` de dentro do executor não tinha ouvinte de
   *     `error`, então o ENOENT assíncrono virava exceção não capturada e
   *     derrubava o motor inteiro. Ou seja: no ambiente em que o item 1 mentia,
   *     ele nem chegava a mentir — o servidor morria antes.
   *
   * Agora são três perguntas, feitas em ordem, e cada uma pode devolver "não":
   * o aplicativo está autorizado? o lançamento subiu? o processo apareceu?
   */
  async abrirAplicativo(idUsuario: string, pedido: string): Promise<RelatoAcao> {
    const app = resolverAplicativo(pedido);
    if (!app) {
      this.auditar(idUsuario, 'abrir_aplicativo', false, pedido.slice(0, 60));
      return {
        ok: false,
        texto: `Esse aplicativo não está na minha lista autorizada. Hoje eu abro: ${aplicativosDisponiveis()}.`,
        prova: {
          confirmado: false,
          evidencia: 'aplicativo fora da allowlist; nada foi lançado',
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'APP_NAO_ENCONTRADO',
      };
    }

    /**
     * A FOTO DE ANTES é o que dá sentido à foto de depois. "Chrome está
     * rodando" não prova nada quando o Chrome já estava rodando — é a diferença
     * entre os dois instantes que carrega informação, e sem o antes essa
     * verificação seria só uma forma mais cara de dizer "sim".
     */
    const antes = await this.sonda(app.processo);
    const lancamento = await this.lancador(app.comando, app.argumentos);

    if (!lancamento.subiu) {
      this.auditar(idUsuario, 'abrir_aplicativo', false, `${app.rotulo}: ${lancamento.motivo}`);
      return {
        ok: false,
        texto:
          `Não consegui abrir ${app.rotulo} neste computador. O Windows recusou o lançamento ` +
          `(${lancamento.motivo}) — normalmente isso quer dizer que o programa não está instalado aqui.`,
        prova: {
          confirmado: false,
          evidencia: `o lançamento de ${app.comando} falhou: ${lancamento.motivo}`,
          motivo: 'divergente',
        },
        codigo_erro: 'APP_NAO_ENCONTRADO',
      };
    }

    const depois = await this.esperarProcesso(app.processo, antes?.length ?? 0);

    // Sem sonda não há prova — e dizer isso é melhor que inventar uma.
    if (antes === null || depois === null) {
      this.auditar(idUsuario, 'abrir_aplicativo', true, `${app.rotulo} (sem sonda)`);
      return {
        ok: true,
        texto: `Mandei ${artigoDe(app.rotulo)} ${app.rotulo} abrir. Não consigo conferir a tabela de processos desta máquina, então não tenho como te garantir que a janela apareceu.`,
        prova: {
          confirmado: false,
          evidencia: 'lançamento aceito; a tabela de processos não é consultável nesta plataforma',
          motivo: 'sem_meio_de_verificar',
        },
        codigo_erro: null,
      };
    }

    if (depois.length > antes.length) {
      this.auditar(idUsuario, 'abrir_aplicativo', true, `${app.rotulo} pid=${depois.at(-1)}`);
      /**
       * A EVIDÊNCIA PRECISA DIZER OS DOIS NÚMEROS, e a primeira versão dizia
       * "ausente antes do pedido" neste ramo — o que é verdade quando `antes`
       * está vazio e MENTIRA quando não está. Pego na primeira bateria real:
       * abrir o Chrome com quinze processos dele já rodando produziu um novo
       * processo (prova legítima) acompanhado da frase "ausente antes do
       * pedido", que era falsa sobre o estado anterior da máquina.
       *
       * Uma prova que exagera o que apurou é uma prova estragada, mesmo quando
       * a conclusão está certa — porque a próxima pessoa a lê-la vai confiar na
       * frase, não refazer a medição.
       */
      const novos = depois.length - antes.length;
      return {
        ok: true,
        texto: `Pronto. Abri ${artigoDe(app.rotulo)} ${app.rotulo} no computador.`,
        prova: {
          confirmado: true,
          evidencia:
            antes.length === 0
              ? `${app.processo} presente na tabela de processos (PID ${depois.at(-1)}), ausente antes do pedido`
              : `${app.processo} passou de ${antes.length} para ${depois.length} processo(s) — ` +
                `${novos} novo(s) depois do pedido, último PID ${depois.at(-1)}`,
        },
        codigo_erro: null,
      };
    }

    if (antes.length > 0) {
      /**
       * O caso incômodo, e o que ele NÃO pode virar. O aplicativo já estava
       * aberto; o lançamento foi aceito; a contagem de processos não mudou.
       * Isso é normal — muitos programas trazem a janela existente para a
       * frente em vez de criar processo novo. Chamar de sucesso seria afirmar
       * uma janela que ninguém viu; chamar de falha seria negar um lançamento
       * que deu certo. O nome disto é `sem_meio_de_verificar`, e ele existe
       * exatamente para não ter que escolher entre duas mentiras.
       */
      this.auditar(idUsuario, 'abrir_aplicativo', true, `${app.rotulo} (já estava aberto)`);
      return {
        ok: true,
        texto:
          `${artigoDe(app.rotulo)==="a"?"A":"O"} ${app.rotulo} já estava aberto no computador e eu mandei abrir de novo. ` +
          'Ele traz a janela existente para a frente em vez de criar um processo novo, ' +
          'então não tenho como te provar que uma janela nova apareceu.',
        prova: {
          confirmado: false,
          evidencia: `${app.processo} já estava em execução antes do pedido (${antes.length} processo(s)); a contagem não mudou`,
          motivo: 'sem_meio_de_verificar',
        },
        codigo_erro: null,
      };
    }

    this.auditar(idUsuario, 'abrir_aplicativo', false, `${app.rotulo}: processo não apareceu`);
    return {
      ok: false,
      texto:
        `Pedi ao Windows para abrir ${app.rotulo} e o processo não apareceu. ` +
        'Na prática isso quer dizer que ele não está instalado neste computador — ou que a instalação está quebrada.',
      prova: {
        confirmado: false,
        evidencia: `${app.processo} ausente da tabela de processos depois do lançamento`,
        motivo: 'divergente',
      },
      codigo_erro: 'APP_NAO_ENCONTRADO',
    };
  }

  /**
   * Espera o processo aparecer, com teto.
   *
   * Sondar uma vez logo depois do `spawn` daria falso negativo em qualquer
   * aplicativo real: `CalculatorApp.exe` leva um par de segundos para acordar
   * numa máquina fria. O laço para no instante em que a contagem sobe — o caso
   * comum custa uma sondagem só.
   */
  private async esperarProcesso(imagem: string, referencia: number): Promise<number[] | null> {
    const TETO_MS = 6000;
    const RITMO_MS = 400;
    const limite = Date.now() + TETO_MS;
    let ultima = await this.sonda(imagem);
    while (ultima !== null && ultima.length <= referencia && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, RITMO_MS));
      ultima = await this.sonda(imagem);
    }
    return ultima;
  }

  /**
   * Fecha um aplicativo — SEM `/F`, e a ausência da flag é a decisão.
   *
   * `taskkill /F` mata o processo na hora e leva junto o que não foi salvo. Sem
   * ela, o Windows pede ao programa que feche, e um programa com trabalho
   * pendente RECUSA e abre a caixa "deseja salvar?". Isso não é uma falha desta
   * habilidade: é o comportamento certo, e o relato diz isso em vez de insistir.
   * Perder o documento de alguém para poder responder "fechei" seria o pior
   * negócio possível.
   */
  async fecharAplicativo(idUsuario: string, pedido: string): Promise<RelatoAcao> {
    const app = resolverAplicativo(pedido);
    if (!app) {
      this.auditar(idUsuario, 'fechar_aplicativo', false, pedido.slice(0, 60));
      return {
        ok: false,
        texto: `Esse aplicativo não está na minha lista autorizada. Hoje eu conheço: ${aplicativosDisponiveis()}.`,
        prova: { confirmado: false, evidencia: 'fora da allowlist; nada foi encerrado', motivo: 'nao_encontrado' },
        codigo_erro: 'APP_NAO_ENCONTRADO',
      };
    }

    if (!app.fechavel) {
      this.auditar(idUsuario, 'fechar_aplicativo', false, `${app.rotulo} não é fechável`);
      return {
        ok: false,
        texto:
          `Não fecho ${artigoDe(app.rotulo)} ${app.rotulo}: ele é o próprio shell do Windows. Derrubá-lo apaga a barra de tarefas ` +
          'e a área de trabalho de quem estiver na frente do computador.',
        prova: { confirmado: false, evidencia: 'aplicativo marcado como não fechável na allowlist', motivo: 'nao_encontrado' },
        codigo_erro: 'PERMISSAO_NEGADA',
      };
    }

    const antes = await this.sonda(app.processo);
    if (antes !== null && antes.length === 0) {
      this.auditar(idUsuario, 'fechar_aplicativo', true, `${app.rotulo} já estava fechado`);
      return {
        ok: true,
        texto: `${artigoDe(app.rotulo)==="a"?"A":"O"} ${app.rotulo} já não estava aberto. Não mexi em nada.`,
        prova: { confirmado: true, evidencia: `${app.processo} ausente da tabela de processos antes e depois` },
        codigo_erro: null,
      };
    }

    const codigo = await this.executorAguardado('taskkill.exe', ['/IM', app.processo]);
    const depois = await this.sonda(app.processo);

    if (depois === null) {
      this.auditar(idUsuario, 'fechar_aplicativo', true, `${app.rotulo} (sem sonda)`);
      return {
        ok: codigo === 0,
        texto: `Pedi para ${artigoDe(app.rotulo)} ${app.rotulo} fechar. Não consigo conferir a tabela de processos daqui.`,
        prova: { confirmado: false, evidencia: `taskkill saiu com código ${codigo}; sem sonda para conferir`, motivo: 'sem_meio_de_verificar' },
        codigo_erro: null,
      };
    }

    if (depois.length === 0) {
      this.auditar(idUsuario, 'fechar_aplicativo', true, app.rotulo);
      return {
        ok: true,
        texto: `Pronto. Fechei ${artigoDe(app.rotulo)} ${app.rotulo}.`,
        prova: { confirmado: true, evidencia: `${app.processo} sumiu da tabela de processos depois do pedido` },
        codigo_erro: null,
      };
    }

    this.auditar(idUsuario, 'fechar_aplicativo', false, `${app.rotulo} resistiu`);
    return {
      ok: false,
      texto:
        `Pedi para ${artigoDe(app.rotulo)} ${app.rotulo} fechar e continua aberto. Isso normalmente acontece quando há algo não salvo ` +
        'e o programa está esperando uma resposta na tela. Eu não forço o fechamento — você perderia o trabalho.',
      prova: {
        confirmado: false,
        evidencia: `${app.processo} ainda presente (${depois.length} processo(s)) depois do pedido de fechamento`,
        motivo: 'divergente',
      },
      codigo_erro: 'FALHA_NA_EXECUCAO',
    };
  }

  /**
   * Fotografa a tela e devolve ONDE ficou — nunca O QUE tem nela.
   *
   * O valor de retorno é uma frase com caminho e tamanho. Nenhum byte de
   * imagem sai deste método, e é o invariante que sustenta a habilidade
   * inteira: `ResultadoHabilidade.texto` é descrito no contrato como "insumo do
   * próximo passo", ou seja, ele PODE acabar no prompt. Uma captura de tela é a
   * coisa mais indiscriminada que este sistema consegue produzir — senha
   * visível, conversa de outra pessoa, tela de um terceiro sistema. Ela fica no
   * disco do operador, onde ele já estava.
   */
  async capturarTela(idUsuario: string, local: LocalAutorizado): Promise<string> {
    const indisponivel = capturaIndisponivelPorque();
    if (indisponivel) {
      this.auditar(idUsuario, 'capturar_tela', false, indisponivel);
      return `Não consigo capturar a tela: ${indisponivel}.`;
    }

    const raiz = resolverRaiz(local);
    if (!raiz) {
      this.auditar(idUsuario, 'capturar_tela', false, `raiz ${local} não encontrada`);
      return `Não encontrei a pasta ${ROTULO_DO_LOCAL[local]} neste computador.`;
    }

    /**
     * O caminho antigo sai do mapa ANTES da tentativa. Se a captura falhar,
     * `verificar` precisa encontrar ausência — e não a foto da vez passada,
     * que existe no disco e confirmaria uma captura que não aconteceu.
     */
    this.capturas.delete(idUsuario);

    const pasta = path.join(raiz, PASTA_CAPTURAS);
    await mkdir(pasta, { recursive: true });
    const destino = path.join(pasta, nomeDaCaptura());

    const codigo = await this.executorAguardado('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      scriptDeCaptura(destino),
    ]);

    /**
     * As DUAS condições, e nenhuma delas basta sozinha. Código zero com arquivo
     * ausente acontece quando a sessão do Windows não tem desktop interativo (o
     * PowerShell sai limpo e não desenha nada); arquivo presente com código
     * diferente de zero seria um PNG truncado. Exigir as duas é o que impede a
     * frase "capturei" de sair sem foto.
     */
    if (codigo !== 0 || !existsSync(destino)) {
      this.auditar(idUsuario, 'capturar_tela', false, `powershell saiu ${codigo}`);
      return (
        'Tentei capturar a tela e não consegui. Isso acontece quando o motor roda como serviço, ' +
        'sem uma sessão gráfica aberta — nesse caso não existe tela para fotografar.'
      );
    }

    const bytes = statSync(destino).size;
    this.capturas.set(idUsuario, destino);
    this.auditar(idUsuario, 'capturar_tela', true, `${destino} (${bytes} bytes)`);
    return (
      `Tela capturada: ${destino} (${Math.max(1, Math.round(bytes / 1024))} KB). ` +
      'O arquivo ficou no seu computador — eu não abri a imagem nem enviei para lugar nenhum.'
    );
  }

  /** Caminho da última captura confirmada deste operador. Usado pelo verificador. */
  capturaRecenteDe(idUsuario: string): string | null {
    return this.capturas.get(idUsuario) ?? null;
  }

  // -------------------------------------------------------------------------
  // Provas — conferem o mundo, e conferem ONDE o mundo está
  // -------------------------------------------------------------------------

  /**
   * As duas provas abaixo eram código da camada de habilidades, e mudaram de
   * casa por um motivo específico: elas conferem o DISCO, e o disco que
   * interessa é o da máquina que executou. Enquanto viviam na habilidade, elas
   * rodavam no processo do motor — o que era a mesma coisa até o motor sair do
   * computador do operador, e virou "conferir a pasta errada no servidor
   * errado" depois disso. Aqui elas viajam junto com as mãos.
   */
  provaDaPasta(nomePedido: string, local: LocalAutorizado): ProvaExecucao {
    const nome = validarNomePasta(nomePedido);
    if (!nome) {
      return {
        confirmado: false,
        evidencia: 'nome recusado pela regra de segurança; nada foi criado',
        motivo: 'nao_encontrado',
      };
    }
    const raiz = resolverRaiz(local);
    if (!raiz) {
      return {
        confirmado: false,
        evidencia: `raiz "${local}" não existe nesta máquina`,
        motivo: 'nao_encontrado',
      };
    }
    const destino = path.join(raiz, nome);
    return existsSync(destino)
      ? { confirmado: true, evidencia: `diretório existe em ${destino}` }
      : { confirmado: false, evidencia: `${destino} não existe depois da execução`, motivo: 'divergente' };
  }

  provaDaCaptura(idUsuario: string): ProvaExecucao {
    const caminho = this.capturas.get(idUsuario) ?? null;
    if (!caminho) {
      return {
        confirmado: false,
        evidencia: 'o executor não registrou nenhuma captura; nada foi salvo',
        motivo: 'nao_encontrado',
      };
    }
    if (!existsSync(caminho)) {
      return { confirmado: false, evidencia: `${caminho} não existe depois da execução`, motivo: 'divergente' };
    }
    const bytes = statSync(caminho).size;
    return bytes > 0
      ? { confirmado: true, evidencia: `arquivo existe em ${caminho} com ${bytes} bytes` }
      : { confirmado: false, evidencia: `${caminho} existe mas está vazio; não é uma imagem`, motivo: 'divergente' };
  }

  // -------------------------------------------------------------------------
  // Leituras — saem do processo e não mudam nada
  // -------------------------------------------------------------------------

  /**
   * Lista o que está numa raiz autorizada.
   *
   * Não aceita caminho, pela mesma regra de `criarPasta`: o operador escolhe um
   * LOCAL nomeado. Sem isso, "liste os arquivos de C:\Users\outra_pessoa" seria
   * uma frase que funciona — e a allowlist de raízes existe justamente para que
   * a resposta a essa frase não dependa de a LLM ter bom senso.
   *
   * O TETO de itens não é performance. Uma pasta de downloads com dois mil
   * arquivos viraria dois mil nomes dentro do texto que alimenta o próximo
   * passo do raciocínio — ou seja, dentro do prompt. Cortar e DIZER que cortou
   * é a diferença entre uma resposta parcial e uma resposta que mente por
   * omissão.
   */
  async listarArquivos(idUsuario: string, local: LocalAutorizado): Promise<RelatoAcao> {
    const TETO = 60;
    const raiz = resolverRaiz(local);
    if (!raiz) {
      this.auditar(idUsuario, 'listar_arquivos', false, `raiz ${local} não encontrada`);
      return {
        ok: false,
        texto: `Não encontrei a pasta ${ROTULO_DO_LOCAL[local]} neste computador.`,
        prova: { confirmado: false, evidencia: `raiz "${local}" ausente`, motivo: 'nao_encontrado' },
        codigo_erro: 'ARQUIVO_NAO_ENCONTRADO',
      };
    }

    let entradas;
    try {
      entradas = await readdir(raiz, { withFileTypes: true });
    } catch (erro) {
      this.auditar(idUsuario, 'listar_arquivos', false, (erro as Error).message);
      return {
        ok: false,
        texto: `Não consegui ler a pasta ${ROTULO_DO_LOCAL[local]}: ${(erro as Error).message}`,
        prova: { confirmado: false, evidencia: `readdir falhou em ${raiz}`, motivo: 'divergente' },
        codigo_erro: 'PERMISSAO_NEGADA',
      };
    }

    const pastas = entradas.filter((e) => e.isDirectory()).map((e) => e.name).sort();
    const arquivos = entradas.filter((e) => e.isFile()).map((e) => e.name).sort();
    const total = pastas.length + arquivos.length;

    if (total === 0) {
      this.auditar(idUsuario, 'listar_arquivos', true, `${raiz}: vazia`);
      return {
        ok: true,
        texto: `A ${ROTULO_DO_LOCAL[local]} está vazia.`,
        prova: { confirmado: true, evidencia: `${raiz} lida: 0 itens` },
        codigo_erro: null,
      };
    }

    const mostrar = [...pastas.map((n) => `${n}/`), ...arquivos].slice(0, TETO);
    const corte = total > TETO ? ` (mostrando ${TETO} de ${total})` : '';
    this.auditar(idUsuario, 'listar_arquivos', true, `${raiz}: ${total} itens`);
    return {
      ok: true,
      texto:
        `${ROTULO_DO_LOCAL[local]} — ${pastas.length} pasta(s) e ${arquivos.length} arquivo(s)${corte}:\n` +
        mostrar.map((n) => `• ${n}`).join('\n'),
      prova: { confirmado: true, evidencia: `${raiz} lida: ${total} itens no disco` },
      codigo_erro: null,
    };
  }

  /**
   * O estado da máquina, com números que o operador reconhece.
   *
   * Tudo daqui sai de `node:os`, que lê o kernel local — nenhuma chamada de
   * shell, nenhuma dependência de idioma do Windows, nenhum comando novo para
   * auditar. O disco fica de fora de propósito: ele exigiria `wmic` (removido
   * do Windows 11) ou PowerShell, e o custo de manter esse caminho vivo não se
   * paga contra o que ele acrescenta. Quando entrar, entra declarado.
   */
  /**
   * A medição amostrada — CPU, memória, disco e processos — desta máquina.
   *
   * Note o que ela NÃO faz: não compara com faixa nenhuma, não conclui e não
   * escreve relatório. O `texto` aqui é o mínimo para o caso em que alguém olhe
   * o relato cru no console; a resposta ao operador é composta pelo
   * `MotorAnalise`, do lado do motor, a partir de `dados`.
   *
   * A separação importa porque este código roda no BRAÇO, e o braço não sabe o
   * que a IARA está investigando. Ele mede; quem interpreta é quem perguntou.
   */
  async medirDesempenho(idUsuario: string): Promise<RelatoAcao> {
    /**
     * As três sondas em paralelo: são independentes, e a de processos custa um
     * segundo que não há por que somar ao meio segundo da de CPU.
     */
    const [cpu_pct, disco, processos] = await Promise.all([
      medirCpu(),
      this.sondaDisco().catch(() => null),
      this.sondaDetalhada().catch(() => null),
    ]);
    const m = montarMedicao({ cpu_pct, disco, processos });
    this.auditar(
      idUsuario,
      'medir_desempenho',
      true,
      `cpu ${m.cpu_pct}%, mem ${m.memoria_pct}%, ${m.processos?.length ?? 'sem'} processo(s)`,
    );
    return {
      ok: true,
      texto:
        `Medição: processador ${m.cpu_pct}%, memória ${m.memoria_pct}%, ` +
        `disco ${m.disco_livre_pct === null ? 'não medido' : `${m.disco_livre_pct}% livres`}.`,
      prova: {
        confirmado: true,
        evidencia:
          `amostrado em ${hostname()}: janela de CPU sobre ${m.nucleos} núcleos, ` +
          `${m.processos === null ? 'sonda de processos indisponível' : `${m.processos.length} processos lidos`}`,
      },
      codigo_erro: null,
      // O objeto inteiro atravessa: quem valida na chegada é `interpretarMedicao`.
      dados: m as unknown as Readonly<Record<string, unknown>>,
    };
  }

  async informacoesSistema(idUsuario: string): Promise<RelatoAcao> {
    const gb = (b: number) => (b / 1024 ** 3).toFixed(1);
    const total = totalmem();
    const livre = freemem();
    const usada = total - livre;
    const pct = Math.round((usada / total) * 100);
    const nucleos = cpus();
    const horas = Math.floor(uptime() / 3600);
    const minutos = Math.floor((uptime() % 3600) / 60);

    /**
     * Só interfaces com IPv4 externo. `internal` é a de loopback, que existe em
     * toda máquina e não diz nada sobre estar em rede — informá-la faria a
     * resposta "você está conectado" ser verdadeira até com o cabo na mão.
     */
    const redes = Object.entries(networkInterfaces())
      .flatMap(([nome, lista]) => (lista ?? []).map((e) => ({ nome, ...e })))
      .filter((e) => e.family === 'IPv4' && !e.internal);

    this.auditar(idUsuario, 'informacoes_sistema', true, `mem ${pct}%`);
    return {
      ok: true,
      texto: [
        `Computador: ${hostname()} (${process.platform}, ${nucleos.length} núcleos)`,
        `Processador: ${nucleos[0]?.model?.trim() ?? 'desconhecido'}`,
        `Memória: ${gb(usada)} GB em uso de ${gb(total)} GB (${pct}%), ${gb(livre)} GB livres`,
        `Ligado há: ${horas}h${String(minutos).padStart(2, '0')}`,
        redes.length > 0
          ? `Rede: ${redes.map((r) => `${r.nome} ${r.address}`).join(', ')}`
          : 'Rede: nenhuma interface externa ativa — este computador está sem rede local.',
      ].join('\n'),
      prova: {
        confirmado: true,
        evidencia: `lido de node:os na máquina ${hostname()}: ${nucleos.length} núcleos, ${pct}% de memória em uso`,
      },
      codigo_erro: null,
    };
  }

  /**
   * A pendência VÁLIDA para este diálogo, ou `null`.
   *
   * Um só lugar decide o que "válida" quer dizer — não expirada E do mesmo
   * `sessao`. Espalhar esse teste por `confirmar`, `cancelar` e `temPendencia`
   * é como as três respostas passam a divergir com o tempo.
   */
  private valida(idUsuario: string, sessao: string): Pendencia | null {
    const p = this.pendencias.get(idUsuario);
    if (!p) return null;
    if (Date.now() > p.expira_em) return null;
    if (p.sessao !== sessao) return null;
    return p;
  }

  /** R2: nunca executa — registra a pendência e devolve o pedido de confirmação. */
  pedirEnergia(idUsuario: string, acao: AcaoEnergia, sessao: string): string {
    /**
     * Substituir uma pendência é FATO DITO, não sobrescrita muda.
     *
     * Sem esta frase, quem pediu "desligar" e depois "reiniciar" fica com dois
     * pedidos na cabeça e um só no sistema — e o "confirmo" seguinte resolve o
     * que o sistema guardou, não o que a pessoa lembra.
     */
    const anterior = this.pendencias.get(idUsuario);
    const trocou =
      anterior && Date.now() <= anterior.expira_em && anterior.acao !== acao
        ? `Descartei o pedido anterior de ${ROTULO_ENERGIA[anterior.acao]}. `
        : '';

    this.pendencias.set(idUsuario, {
      id: randomUUID(),
      acao,
      sessao,
      criada_em: Date.now(),
      expira_em: Date.now() + VALIDADE_PENDENCIA_MS,
    });
    this.auditar(idUsuario, `energia_pendente:${acao}`, true, `aguardando confirmação (${sessao})`);
    return (
      `${trocou}Entendido: você quer ${ROTULO_ENERGIA[acao]}. Isso interrompe tudo que estiver aberto, ` +
      `então preciso da sua confirmação explícita. Responda "confirmo ${ROTULO_ENERGIA[acao].split(' ')[0]}" ` +
      `— ou só "confirmo" — em até 1 minuto. "cancela" desiste.`
    );
  }

  confirmar(idUsuario: string, sessao: string): string {
    const bruta = this.pendencias.get(idUsuario);
    const pendencia = this.valida(idUsuario, sessao);

    if (!pendencia) {
      /**
       * Pendência de OUTRO diálogo não é apagada aqui: ela não é deste
       * "confirmo", e destruí-la deixaria o operador sem a ação que ele de fato
       * pediu na outra tela. Só a expirada sai do mapa.
       */
      if (bruta && Date.now() > bruta.expira_em) this.pendencias.delete(idUsuario);
      if (bruta && bruta.sessao !== sessao && Date.now() <= bruta.expira_em) {
        this.auditar(idUsuario, 'energia:confirmacao_de_outra_sessao', false, sessao);
        return (
          'Existe um pedido seu aguardando confirmação, mas ele foi feito em outra conversa. ' +
          'Confirme por lá, ou repita o pedido aqui — não libero ação irreversível com um "confirmo" ' +
          'que veio de outro contexto.'
        );
      }
      return 'Não há nenhuma ação aguardando confirmação — ou ela expirou. Pode pedir de novo.';
    }

    this.pendencias.delete(idUsuario);

    if (pendencia.acao === 'suspender') {
      this.executor('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']);
      this.auditar(idUsuario, 'energia:suspender', true, `executado (${pendencia.id})`);
      return 'Suspendendo o computador agora. Até já.';
    }

    const flag = pendencia.acao === 'desligar' ? '/s' : '/r';
    // 20 segundos de atraso: janela real de arrependimento. "cancela" aborta.
    this.executor('shutdown.exe', [flag, '/t', '20', '/c', 'IARA: acao confirmada pelo operador.']);
    this.auditar(idUsuario, `energia:${pendencia.acao}`, true, `agendado em 20s (${pendencia.id})`);
    return (
      `Confirmado. Vou ${ROTULO_ENERGIA[pendencia.acao]} em 20 segundos. ` +
      'Se mudou de ideia, diga "cancela" que eu aborto.'
    );
  }

  cancelar(idUsuario: string, sessao: string): string {
    /**
     * Cancelar é ASSIMÉTRICO em relação a confirmar, e de propósito: desistir
     * nunca precisa da mesma prova que agir. Uma pendência de outra sessão é
     * apagada daqui sem cerimônia — o custo de cancelar demais é zero, o de
     * cancelar de menos é um desligamento que o operador tentou impedir.
     */
    const havia = this.pendencias.delete(idUsuario);
    this.executor('shutdown.exe', ['/a']);
    this.auditar(
      idUsuario,
      'energia:cancelar',
      true,
      `${havia ? 'pendência descartada' : 'abort enviado'} (${sessao})`,
    );
    return havia
      ? 'Cancelado. Nada será executado.'
      : 'Cancelado — se havia um desligamento agendado, acabei de abortar.';
  }

  /** Existe pendência válida PARA ESTE DIÁLOGO? (usado pelo fluxo de confirmação) */
  temPendencia(idUsuario: string, sessao: string): boolean {
    return this.valida(idUsuario, sessao) !== null;
  }
}

/** Instância única do processo — as pendências vivem nela. */
export const agenteLocal = new AgenteLocal();
