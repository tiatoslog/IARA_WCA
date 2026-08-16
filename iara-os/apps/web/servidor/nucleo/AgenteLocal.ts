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
import { enviarWhatsapp as enviarWhatsappGraph } from './ClienteWhatsapp';
import { repositoriosDisponiveis, resolverRepositorio } from './RepositoriosAutorizados';
import {
  caminhoDoTranscript,
  julgarSessao,
  type VereditoSessao,
} from './SessoesAgenteCodigo';

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
 * O mesmo lugar, dito dentro de uma frase.
 *
 * Existe porque o rótulo sozinho não tem preposição, e "na Documentos" é um
 * tropeço que a voz denuncia na hora — no texto quase passa, falado não passa.
 * Duas entradas do mesmo fato só se justificam quando servem a duas gramáticas,
 * e é o caso: o rótulo nomeia o lugar, isto o situa.
 */
export const NO_LOCAL: Record<LocalAutorizado, string> = {
  area_de_trabalho: 'na Área de Trabalho',
  documentos: 'em Documentos',
  downloads: 'em Downloads',
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
/**
 * Nomes de DISPOSITIVO do Windows. Reservados em qualquer diretório, com ou sem
 * extensão, em qualquer caixa.
 *
 * Passavam pela regra acima — são só letras e dígitos — e o `mkdir` falhava com
 * `EINVAL`, que subia até a rede de segurança do `ExecutorDesktop` e virava
 * "falhou por um erro interno". A recusa existe para dizer ao operador o que
 * fazer a seguir; devolver erro interno para um nome previsivelmente impossível
 * é a recusa falhando no único trabalho que ela tem.
 */
const RESERVADOS_WINDOWS =
  /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(\.|$)/i;

export function validarNomePasta(nome: string): string | null {
  const limpo = nome.trim();
  if (limpo.length === 0 || limpo.length > 60) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(limpo)) return null;
  if (limpo.includes('..') || /[. ]$/.test(limpo)) return null;
  if (RESERVADOS_WINDOWS.test(limpo)) return null;
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
  /**
   * Aplicativo da Store (UWP). Não é curiosidade de plataforma: ele fica
   * SUSPENSO fora de foco e não atende o pedido educado de fechamento, então
   * `fechar_aplicativo` vai falhar por um motivo que não é "trabalho não salvo".
   * Declarado aqui para que a resposta ao operador diga o que é verdade em vez
   * de escolher a explicação mais simpática. Ver o retorno de `fecharAplicativo`.
   */
  moderno?: boolean;
  /**
   * Este app aceita um endereço para abrir direto nele — hoje só os
   * navegadores. Bloco de Notas, Calculadora e Explorador não têm o que fazer
   * com uma URL, e oferecer o campo para eles seria uma promessa vazia.
   */
  aceitaUrl?: boolean;
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
  calculadora: { rotulo: 'Calculadora', comando: 'calc.exe', argumentos: [], processo: 'CalculatorApp.exe', fechavel: true, moderno: true },
  paint: { rotulo: 'Paint', comando: 'mspaint.exe', argumentos: [], processo: 'mspaint.exe', fechavel: true },
  explorador: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  explorer: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  arquivos: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [], processo: 'explorer.exe', fechavel: false },
  // Navegadores instalam fora do PATH; `start` resolve pelo registro do app.
  chrome: { rotulo: 'Google Chrome', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'chrome'], processo: 'chrome.exe', fechavel: true, aceitaUrl: true },
  edge: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'], processo: 'msedge.exe', fechavel: true, aceitaUrl: true },
  navegador: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'], processo: 'msedge.exe', fechavel: true, aceitaUrl: true },
};

/**
 * O site é o único parâmetro deste catálogo que o operador escolhe livremente
 * e que vira `argv` de um navegador de verdade — por isso a validação mora
 * aqui, ao lado do `spawn`, e não só no esquema genérico da habilidade.
 *
 * `http(s)://` obrigatório fecha a porta mais perigosa sozinho: `javascript:`,
 * `data:`, `file:` e os esquemas internos do navegador (`chrome://`,
 * `edge://`) nunca passam no prefixo. Proibir espaço e aspas fecha a segunda:
 * sem eles, uma URL não vira um SEGUNDO argumento nem consegue carregar uma
 * flag do navegador por engano (`--headless`, por exemplo) — e como
 * `argumentos` é sempre um array passado a `spawn` sem `shell: true`, não há
 * injeção de shell (`;`, `&&`, `|`) para se preocupar aqui, só injeção de
 * flag, e é essa que a ausência de espaço fecha.
 */
export function validarUrlAbertura(url: string): string | null {
  const t = url.trim();
  if (!t) return 'endereço vazio';
  if (t.length > 2000) return 'endereço longo demais';
  if (/\s/.test(t)) return 'endereço não pode ter espaço';
  if (/['"]/.test(t)) return 'endereço não pode ter aspas';
  if (!/^https?:\/\//i.test(t)) return 'só endereço http:// ou https://';
  try {
    const analisado = new URL(t);
    if (analisado.protocol !== 'http:' && analisado.protocol !== 'https:') {
      return 'só endereço http:// ou https://';
    }
  } catch {
    return 'endereço malformado';
  }
  return null;
}

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
interface PendenciaEnergia {
  readonly tipo: 'energia';
  readonly id: string;
  readonly acao: AcaoEnergia;
  readonly sessao: string;
  readonly criada_em: number;
  readonly expira_em: number;
}

/**
 * A pendência de envio de WhatsApp — MESMO desenho da de energia, mesma
 * pergunta ("alguém fora da IARA percebe?") respondida "sim" pelas duas.
 * Vive no MESMO slot por operador (`pendencias`), nunca um Map à parte: dois
 * mapas para duas ações irreversíveis seria reabrir, por um caminho
 * diferente, exatamente o defeito que motivou `sessao` na pendência de
 * energia — duas fontes de verdade que um dia divergem sobre o que está
 * pendente. Com um slot só, a pergunta "o que este 'confirmo' libera?" tem
 * sempre uma resposta, nunca duas.
 */
interface PendenciaWhatsapp {
  readonly tipo: 'whatsapp';
  readonly id: string;
  readonly destinatario: string;
  readonly mensagem: string;
  readonly sessao: string;
  readonly criada_em: number;
  readonly expira_em: number;
}

type Pendencia = PendenciaEnergia | PendenciaWhatsapp;

/** Assinatura compatível com `child_process.spawn` — injetável nos testes
 *  para que "confirmar desligamento" seja testável sem desligar nada. */
export type Executor = (comando: string, argumentos: string[]) => void;

// ---------------------------------------------------------------------------
// Sessões de agente de código
// ---------------------------------------------------------------------------

/**
 * Quanto se espera por uma falha de PARTIDA antes de responder ao operador.
 *
 * Não é tempo de trabalho: é tempo de manifestação de erro. Medido com o
 * binário real (Claude Code 2.1.233) em 16/08/2026: o caso "não logado" sai em
 * ~300 ms. Doze segundos cobrem uma máquina fria com folga e ainda cabem no
 * teto da habilidade.
 *
 * `IARA_JANELA_AGENTE_MS` encurta a espera. Existe para a suíte: os casos de
 * "processo que não sai" pagariam doze segundos CADA, e uma suíte lenta é uma
 * suíte que alguém deixa de rodar. Não é para produção — lá o padrão é o certo.
 */
function janelaVeredito(): number {
  const declarado = Number(process.env.IARA_JANELA_AGENTE_MS);
  return Number.isFinite(declarado) && declarado > 0 ? declarado : 12_000;
}

/** Teto do registro de sessões. Sessão viva nunca é descartada. */
const MAX_SESSOES_AGENTE = 20;

/** O processo do agente, visto de fora. Estreito para poder ser dublê. */
export interface ProcessoAgente {
  readonly pid: number | null;
  matar(): void;
}

/**
 * Lança o agente e avisa quando ele sai. Injetável — é o que permite testar o
 * ciclo inteiro sem depender de um binário instalado na máquina de quem roda a
 * suíte.
 */
export type LancadorAgente = (
  argumentos: string[],
  diretorio: string,
  aoSair: (codigo: number | null, saida: string, erro: string) => void,
) => ProcessoAgente;

/**
 * O COMANDO nunca vem de parâmetro de habilidade — só do ambiente, e é a
 * diferença entre configuração e injeção. `shell: false` fecha o resto: a
 * instrução do operador viaja como UM argumento do array, e nem aspas nem `&&`
 * nem `|` a transformam em outra coisa.
 *
 * POR QUE `claude.exe` NO WINDOWS, E NÃO `claude.cmd`. Descoberto pelo E2E com
 * o binário real em 16/08/2026: `spawn('claude.cmd')` devolve **EINVAL**. Desde
 * a CVE-2024-27980 o Node recusa executar `.cmd`/`.bat` sem `shell: true` — e
 * `shell: true` aqui seria trocar um erro por uma vulnerabilidade, porque a
 * instrução do operador passaria a ser interpretada pelo `cmd.exe`.
 *
 * O atalho que o npm instala (`claude.cmd`) só chama
 * `node_modules/@anthropic-ai/claude-code/bin/claude.exe`. É esse executável
 * nativo que se lança: sem shell, sem interpretação, sem EINVAL.
 *
 * Ele NÃO está no PATH (só o atalho está), então quem usa esta capacidade no
 * Windows declara `IARA_COMANDO_AGENTE` com o caminho do `.exe`. Nada é
 * adivinhado — a mesma disciplina de `OLLAMA_URL` e de todo o resto: sem
 * declaração, a IARA falha dizendo exatamente o que falta.
 */
function comandoDoAgente(): string {
  const declarado = (process.env.IARA_COMANDO_AGENTE ?? '').trim();
  if (declarado) return declarado;
  return process.platform === 'win32' ? 'claude.exe' : 'claude';
}

const lancadorAgenteReal: LancadorAgente = (argumentos, diretorio, aoSair) => {
  const filho = spawn(comandoDoAgente(), argumentos, {
    cwd: diretorio,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    /* `shell: false` explícito: o padrão já é esse, e escrevê-lo impede que
       alguém o "conserte" para true no dia em que o PATH der trabalho. */
    shell: false,
  });

  let saida = '';
  let erro = '';
  filho.stdout?.on('data', (b: Buffer) => {
    saida += b.toString();
  });
  filho.stderr?.on('data', (b: Buffer) => {
    erro += b.toString();
  });
  /* ENOENT chega por evento, não por exceção — a mesma lição do `executorReal`.
     Sem este ouvinte, um `claude` ausente derruba o processo inteiro. */
  filho.on('error', (e: Error) => {
    erro += e.message;
    aoSair(-1, saida, erro);
  });
  filho.on('close', (codigo) => aoSair(codigo, saida, erro));

  return { pid: filho.pid ?? null, matar: () => filho.kill() };
};

/** Uma sessão viva no registro deste processo. */
interface SessaoAgenteViva {
  readonly id: string;
  readonly repositorio: string;
  readonly caminho: string;
  readonly idUsuario: string;
  readonly iniciada_em: number;
  saida: string;
  erro: string;
  codigoSaida: number | null;
  encerradaPorMim: boolean;
  processo: ProcessoAgente | null;
}

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
// Repositórios autorizados
// ---------------------------------------------------------------------------

/**
 * OS REPOSITÓRIOS QUE A IARA PODE TOCAR, por apelido.
 *
 * A allowlist é a trava inteira desta capacidade, e ela é uma lista de APELIDOS
 * — nunca de caminhos vindos da frase. É a mesma disciplina de
 * `ROTULO_DO_LOCAL`, e aqui ela importa mais: um `git pull` no diretório errado
 * não é uma pasta no lugar errado, é código-fonte de alguém sendo alterado.
 *
 * `IARA_REPOSITORIOS` declara os pares `apelido=caminho`, separados por
 * vírgula. Vazio (o padrão) significa que a capacidade não existe naquela
 * máquina — e é o padrão certo: um verbo que altera código nasce desligado e é
 * LIGADO de propósito, nunca o contrário.
 *
 * Decidido com a operadora em 13/08/2026: só o repositório do próprio produto,
 * e só puxar. Publicar continua sendo pessoa. Abrir esta lista depois é fácil;
 * fechá-la depois de um acidente é que não é.
 */
export function repositoriosAutorizados(): ReadonlyMap<string, string> {
  const mapa = new Map<string, string>();
  for (const par of (process.env.IARA_REPOSITORIOS ?? '').split(',')) {
    const corte = par.indexOf('=');
    if (corte <= 0) continue;
    const apelido = apelidoCanonico(par.slice(0, corte));
    const caminho = par.slice(corte + 1).trim();
    if (apelido && caminho) mapa.set(apelido, caminho);
  }
  return mapa;
}

/** Sem acento, sem caixa, sem espaço nas pontas: "IARA_WCA", "iara wca" e
 *  "Iara-WCA" nomeiam o mesmo repositório, porque quem fala não digita chave. */
function apelidoCanonico(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * O TERCEIRO executor, e o primeiro que precisa da SAÍDA do processo.
 *
 * Os outros dois bastavam para o que faziam: um solta o processo e esquece, o
 * outro devolve o código de saída. Nenhum serve aqui, porque a prova desta ação
 * é literalmente o texto que o `git` responde — o hash antes e depois, a lista
 * de arquivos sujos. Um código de saída zero não distingue "atualizei" de "já
 * estava atualizado", e essa é justamente a distinção que a resposta precisa
 * fazer para não mentir.
 *
 * Injetável pela mesma razão dos outros: provar o comportamento em árvore suja,
 * em conflito e em rede caída sem precisar de um repositório de verdade em cada
 * um desses estados.
 */
export type ExecutorGit = (
  argumentos: readonly string[],
  diretorio: string,
) => Promise<{ codigo: number; saida: string }>;

const executorGitReal: ExecutorGit = (argumentos, diretorio) =>
  new Promise((resolver) => {
    execFile(
      'git',
      [...argumentos],
      {
        cwd: diretorio,
        windowsHide: true,
        encoding: 'utf8',
        /**
         * Um `pull` atravessa a rede, e uma rede ruim é lenta antes de ser
         * quebrada. 60 s é folgado para um repositório do tamanho deste e curto
         * o bastante para o operador não achar que a IARA travou.
         */
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        /**
         * Sem prompt, nunca. `git` pedindo senha num processo sem terminal fica
         * pendurado até o timeout, e o operador vê "demorou" onde a verdade é
         * "faltou credencial". Com isto ele falha na hora, e a frase pode dizer
         * o que de fato aconteceu.
         */
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo' },
      },
      (erro, saida, erroPadrao) => {
        const texto = `${String(saida ?? '')}${String(erroPadrao ?? '')}`.trim();
        if (!erro) {
          resolver({ codigo: 0, saida: texto });
          return;
        }
        const codigo = typeof (erro as { code?: unknown }).code === 'number'
          ? (erro as { code: number }).code
          : -1;
        resolver({ codigo, saida: texto || erro.message });
      },
    );
  });

/**
 * O envio de UMA mensagem de WhatsApp — assinatura mínima, sem conhecer nada
 * de pendência ou confirmação. Quem decide QUANDO chamar é `AgenteLocal`; a
 * função em si só sabe falar com a Meta. Ver `ClienteWhatsapp.ts`.
 */
export type EnviadorWhatsapp = (
  destinatario: string,
  mensagem: string,
) => Promise<{ ok: boolean; texto: string }>;

const enviarWhatsappReal: EnviadorWhatsapp = (destinatario, mensagem) =>
  enviarWhatsappGraph(destinatario, mensagem);

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
    /**
     * O executor de git. Injetável porque os estados que INTERESSAM neste verbo
     * — árvore suja, branch divergente, rede caída — são exatamente os que dão
     * trabalho para montar de verdade, e são os únicos em que a recusa precisa
     * estar certa. Com um repositório real a suíte só provaria o caminho feliz.
     */
    private readonly executorGit: ExecutorGit = executorGitReal,
    /**
     * O envio de WhatsApp. Injetável pela mesma razão do executor de
     * energia: "confirmar envio" precisa ser testável sem mandar mensagem de
     * verdade para o número de teste de ninguém.
     */
    private readonly enviadorWhatsapp: EnviadorWhatsapp = enviarWhatsappReal,
    /**
     * O lançador do agente de código. Injetável pela razão mais forte da lista:
     * o binário `claude` pode não existir na máquina que roda a suíte, e o
     * ciclo inteiro — abrir, mandar, acompanhar, encerrar — precisa ser
     * provável mesmo assim. O caminho REAL é exercitado por um E2E à parte,
     * contra o binário de verdade.
     */
    private readonly lancadorAgente: LancadorAgente = lancadorAgenteReal,
  ) {}

  /** As sessões de agente de código deste processo, por id. */
  private readonly sessoesAgente = new Map<string, SessaoAgenteViva>();

  /**
   * Construção NOMEADA para teste.
   *
   * O construtor tem dez dependências posicionais, e um teste que escreve nove
   * `undefined` para alcançar a décima fica preso à ORDEM delas: basta alguém
   * inserir uma injeção no meio da lista para que o dublê passe a substituir a
   * dependência errada — em silêncio, com a suíte verde. O risco não é
   * hipotético: aconteceu enquanto este arquivo era escrito, com duas frentes
   * mexendo no mesmo construtor.
   */
  static paraTeste(opcoes: { lancadorAgente?: LancadorAgente }): AgenteLocal {
    const agente = new AgenteLocal();
    if (opcoes.lancadorAgente) {
      (agente as unknown as { lancadorAgente: LancadorAgente }).lancadorAgente = opcoes.lancadorAgente;
    }
    return agente;
  }

  private auditar(idUsuario: string, acao: string, permitido: boolean, detalhe: string): void {
    console.log(
      JSON.stringify({ canal: 'agente_local', usuario: idUsuario, acao, permitido, detalhe }),
    );
  }

  /** Um lugar só chama o git, para que nenhum caminho novo esqueça o `cwd`
   *  — rodar git no diretório errado é o modo de falhar deste verbo. */
  private git(argumentos: readonly string[], diretorio: string) {
    return this.executorGit(argumentos, diretorio);
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
      return `A pasta "${nome}" já existe ${NO_LOCAL[local]}. Não mexi em nada.`;
    }

    await mkdir(destino);
    this.auditar(idUsuario, 'criar_pasta', true, destino);
    /**
     * O CAMINHO SAIU DAQUI, e a razão é que este texto é FALADO.
     *
     * A frase antiga terminava em `: C:\Users\daian\Desktop\contratos aereos`, e
     * a voz neural leu isso como se fosse endereço ditado ao telefone — "cê,
     * dois pontos, barra invertida, usuários, barra invertida…". Na tela era
     * ruído; no ouvido era a IARA soando como uma máquina lendo um log, que é
     * exatamente a impressão que este produto existe para não dar.
     *
     * Nada se perde. O caminho absoluto continua indo para a auditoria (a linha
     * acima) e é ele que `provaDaPasta` confere no disco — a prova nunca dependeu
     * desta frase. O rótulo do local é o que a pessoa precisa para achar a pasta,
     * porque é assim que ela pensa no lugar: "área de trabalho", não "C:\Users".
     */
    return `Pronto, criei a pasta "${nome}" ${NO_LOCAL[local]}.`;
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
  async abrirAplicativo(idUsuario: string, pedido: string, url?: string): Promise<RelatoAcao> {
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
     * O SITE É OPCIONAL E VALIDADO ANTES DE TOCAR O `spawn`.
     *
     * Duas recusas diferentes moram aqui, e a distinção importa para a frase
     * que volta ao operador: "esse app não abre endereço" (pediu URL para o
     * Bloco de Notas) é sobre a ESCOLHA do aplicativo; "endereço inválido" é
     * sobre a URL em si. As duas são `PARAMETRO_INVALIDO` — nenhuma delas
     * chegou perto de lançar processo nenhum.
     */
    const urlLimpa = url?.trim() || null;
    if (urlLimpa) {
      if (!app.aceitaUrl) {
        this.auditar(idUsuario, 'abrir_aplicativo', false, `${app.rotulo}: nao aceita url`);
        return {
          ok: false,
          texto: `${app.rotulo} não abre endereço — só um navegador faz isso. Posso abrir ${app.rotulo} sem endereço, ou abrir o Chrome/Edge já no site.`,
          prova: {
            confirmado: false,
            evidencia: `"${app.rotulo}" não aceita parâmetro de URL; nada foi lançado`,
            motivo: 'nao_encontrado',
          },
          codigo_erro: 'PARAMETRO_INVALIDO',
        };
      }
      const motivoInvalido = validarUrlAbertura(urlLimpa);
      if (motivoInvalido) {
        this.auditar(idUsuario, 'abrir_aplicativo', false, `url invalida: ${motivoInvalido}`);
        return {
          ok: false,
          texto: `Esse endereço não passa na minha validação (${motivoInvalido}). Preciso de um link http:// ou https:// completo, sem espaço.`,
          prova: {
            confirmado: false,
            evidencia: `URL recusada: ${motivoInvalido}`,
            motivo: 'nao_encontrado',
          },
          codigo_erro: 'PARAMETRO_INVALIDO',
        };
      }
    }
    const argumentos = urlLimpa ? [...app.argumentos, urlLimpa] : app.argumentos;

    /**
     * A FOTO DE ANTES é o que dá sentido à foto de depois. "Chrome está
     * rodando" não prova nada quando o Chrome já estava rodando — é a diferença
     * entre os dois instantes que carrega informação, e sem o antes essa
     * verificação seria só uma forma mais cara de dizer "sim".
     */
    const antes = await this.sonda(app.processo);
    const lancamento = await this.lancador(app.comando, argumentos);

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
        texto:
          `Mandei ${artigoDe(app.rotulo)} ${app.rotulo} abrir${urlLimpa ? ` em ${urlLimpa}` : ''}. ` +
          'Não consigo conferir a tabela de processos desta máquina, então não tenho como te garantir que a janela apareceu.',
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
        texto: `Pronto. Abri ${artigoDe(app.rotulo)} ${app.rotulo} no computador${urlLimpa ? `, já em ${urlLimpa}` : ''}.`,
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
          `${artigoDe(app.rotulo)==="a"?"A":"O"} ${app.rotulo} já estava aberto no computador e eu mandei abrir de novo${urlLimpa ? ` em ${urlLimpa}` : ''}. ` +
          'Ele traz a janela existente para a frente em vez de criar um processo novo, ' +
          'então não tenho como te provar que uma janela nova apareceu' +
          (urlLimpa ? ' — mas o endereço deve ter aberto numa aba nova dela.' : '.'),
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

    /**
     * A FRASE DIZ O QUE FOI OBSERVADO, E SÓ.
     *
     * A versão anterior afirmava: "isso normalmente acontece quando há algo não
     * salvo e o programa está esperando uma resposta na tela". Medido em
     * 13/08/2026 com a Calculadora: `taskkill` sem `/F` devolve código 0 e a
     * mensagem "sinal de encerramento enviado", o processo continua na tabela, e
     * não havia nada não salvo em lugar nenhum — a Calculadora não tem o que
     * salvar. A causa afirmada era falsa, e falsa da pior maneira: plausível,
     * tranquilizadora e impossível de o operador conferir.
     *
     * Aplicativo da Store fica SUSPENSO quando não está em foco e não processa o
     * pedido educado de fechamento — nem o `taskkill` sem `/F`, nem o
     * `CloseMainWindow` (que devolve `true` e não fecha; também medido). Isso é
     * um fato sobre a CLASSE do aplicativo, declarado na allowlist, não uma
     * hipótese sobre o que a pessoa estava fazendo.
     *
     * A recusa de forçar continua igual, e continua certa. O que muda é a IARA
     * parar de inventar o porquê.
     */
    this.auditar(idUsuario, 'fechar_aplicativo', false, `${app.rotulo} resistiu`);
    return {
      ok: false,
      texto:
        `Pedi para ${artigoDe(app.rotulo)} ${app.rotulo} fechar e o processo continua na máquina. ` +
        (app.moderno
          ? `${artigoDe(app.rotulo) === 'a' ? 'Ela' : 'Ele'} é um aplicativo da Store, e esses ficam ` +
            'suspensos quando não estão em foco: ignoram o pedido educado de fechamento. ' +
            'Feche pela janela, ou me diga que eu abro para você fechar na tela.'
          : 'Não sei dizer o motivo daqui — pode ser trabalho não salvo esperando resposta na tela. ' +
            'Dê uma olhada na janela.') +
        ' Forçar eu não forço: se houvesse algo não salvo, você perderia.',
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
    /**
     * Pelo mesmo motivo de `criarPasta`: esta frase é FALADA, e um caminho
     * absoluto vira ditado de barras invertidas no ouvido de quem pediu. O nome
     * do arquivo e a pasta bastam para achar; o caminho inteiro continua na
     * auditoria e em `capturaRecenteDe`, que é quem o verificador consulta.
     */
    return (
      `Tela capturada em "${PASTA_CAPTURAS}", ${NO_LOCAL[local]}: ${path.basename(destino)} ` +
      `(${Math.max(1, Math.round(bytes / 1024))} KB). ` +
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

  /**
   * `git pull --ff-only` num repositório da allowlist.
   *
   * AS DUAS TRAVAS QUE O `git` SOZINHO NÃO DÁ, e por que cada uma existe:
   *
   *  1. ÁRVORE SUJA É RECUSA, NÃO MERGE. `git status --porcelain` roda antes, e
   *     qualquer coisa não commitada para a ação. É a única forma deste verbo
   *     destruir algo — puxar por cima de trabalho que ninguém salvou — e ela
   *     custa uma chamada para eliminar. A frase diz O QUE está sujo, porque
   *     "não deu" sem o motivo obriga a pessoa a ir olhar de qualquer jeito.
   *
   *  2. `--ff-only`. Sem merge, sem rebase. Ou o remoto avança em linha reta ou
   *     não avança. Um conflito resolvido por uma IA sem ninguém olhando é
   *     exatamente o que este projeto não faz — e a diferença entre um merge
   *     automático que deu certo e um que comeu código só aparece depois.
   *
   * A PROVA é o hash. `git rev-parse HEAD` antes e depois: se mudou, atualizou;
   * se não mudou e o `pull` passou, já estava em dia. As duas coisas são
   * verdadeiras e diferentes, e dizer "atualizei" no segundo caso seria a mesma
   * família de mentira operacional que o resto deste arquivo combate.
   *
   * O QUE ESTE MÉTODO NÃO FAZ: commit, push, checkout, merge, rebase, e
   * qualquer coisa com `--force`. Nenhuma delas é omissão de escopo — cada uma
   * altera história ou alcança gente de fora, e essas passam por decisão de
   * pessoa. Ver `LEITURA_DO_CLAUDE.md` na pasta de habilidades.
   */
  async atualizarRepositorio(idUsuario: string, apelidoPedido: string): Promise<RelatoAcao> {
    const autorizados = repositoriosAutorizados();
    const apelido = apelidoCanonico(apelidoPedido);
    const diretorio = autorizados.get(apelido);

    if (!diretorio) {
      const conhecidos = [...autorizados.keys()];
      this.auditar(idUsuario, 'atualizar_repositorio', false, `apelido "${apelido}" fora da lista`);
      return {
        ok: false,
        texto: conhecidos.length
          ? `Não tenho esse repositório na minha lista. Os que eu conheço são: ${conhecidos.join(', ')}.`
          : 'Não tenho nenhum repositório autorizado neste computador, então não posso atualizar nada. ' +
            'Quem instala declara isso em IARA_REPOSITORIOS.',
        prova: {
          confirmado: false,
          evidencia: `apelido "${apelido}" ausente da allowlist (${conhecidos.length} declarados)`,
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'ARQUIVO_NAO_ENCONTRADO',
      };
    }

    const sujo = await this.git(['status', '--porcelain'], diretorio);
    if (sujo.codigo !== 0) {
      this.auditar(idUsuario, 'atualizar_repositorio', false, `status falhou (${sujo.codigo})`);
      return {
        ok: false,
        texto:
          `Não consegui nem olhar o estado do repositório "${apelido}" — ` +
          'ou ele não está onde eu esperava, ou o git não respondeu. Não mexi em nada.',
        prova: {
          confirmado: false,
          evidencia: `git status saiu ${sujo.codigo}: ${sujo.saida.slice(0, 200)}`,
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'FALHA_NA_EXECUCAO',
      };
    }

    if (sujo.saida.length > 0) {
      const linhas = sujo.saida.split('\n').filter(Boolean);
      const amostra = linhas.slice(0, 5).map((l) => l.trim().replace(/^\S+\s+/, '')).join(', ');
      this.auditar(idUsuario, 'atualizar_repositorio', false, `árvore suja (${linhas.length})`);
      return {
        ok: false,
        /**
         * Recusa que ENSINA. A pessoa precisa saber o que está sujo para
         * decidir, e a decisão (salvar? descartar?) é dela — a IARA não escolhe
         * entre commitar e jogar fora o trabalho de alguém.
         */
        texto:
          `Não atualizei "${apelido}": tem ${linhas.length} ` +
          `${linhas.length === 1 ? 'arquivo alterado' : 'arquivos alterados'} que ninguém salvou ainda` +
          `${amostra ? ` (${amostra}${linhas.length > 5 ? '…' : ''})` : ''}. ` +
          'Puxar por cima disso pode comer esse trabalho. Salve ou descarte, e eu atualizo na hora.',
        prova: {
          confirmado: false,
          evidencia: `${linhas.length} arquivo(s) não commitados; pull recusado antes de tocar na árvore`,
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'PERMISSAO_NEGADA',
      };
    }

    const antes = await this.git(['rev-parse', 'HEAD'], diretorio);
    const puxada = await this.git(['pull', '--ff-only'], diretorio);
    const depois = await this.git(['rev-parse', 'HEAD'], diretorio);

    if (puxada.codigo !== 0) {
      this.auditar(idUsuario, 'atualizar_repositorio', false, `pull saiu ${puxada.codigo}`);
      /**
       * A causa mais comum de `--ff-only` falhar não é rede: é a branch local
       * ter commits que o remoto não tem. Dizer isso poupa a pessoa de abrir o
       * terminal para descobrir — e é um fato que a saída do git já contém.
       */
      const divergiu = /diverg|não é possível avançar|not possible to fast-forward|Not possible/i.test(
        puxada.saida,
      );
      return {
        ok: false,
        texto: divergiu
          ? `Não atualizei "${apelido}": a sua cópia tem commits que o servidor não tem, ` +
            'então não dá para avançar em linha reta. Isso precisa de alguém decidindo o que fazer — ' +
            'eu não resolvo conflito sozinha.'
          : `Não consegui atualizar "${apelido}". O git recusou e eu não mexi na árvore.`,
        prova: {
          confirmado: antes.saida === depois.saida,
          evidencia: `git pull --ff-only saiu ${puxada.codigo}: ${puxada.saida.slice(0, 200)}`,
          motivo: 'divergente',
        },
        codigo_erro: divergiu ? 'PERMISSAO_NEGADA' : 'ERRO_DE_REDE',
      };
    }

    const mudou = antes.saida !== depois.saida && depois.saida.length > 0;
    this.auditar(
      idUsuario,
      'atualizar_repositorio',
      true,
      `${apelido}: ${antes.saida.slice(0, 8)} → ${depois.saida.slice(0, 8)}`,
    );
    return {
      ok: true,
      /**
       * Duas frases diferentes para dois fatos diferentes. "Já estava
       * atualizado" não é uma versão modesta de "atualizei" — é outra coisa, e
       * o hash é quem sabe qual das duas aconteceu.
       */
      texto: mudou
        ? `Pronto, atualizei o "${apelido}" — ele estava para trás e agora está em dia com o servidor.`
        : `O "${apelido}" já estava atualizado. Não havia nada novo para puxar.`,
      prova: {
        confirmado: true,
        evidencia: mudou
          ? `HEAD ${antes.saida.slice(0, 8)} → ${depois.saida.slice(0, 8)}`
          : `HEAD inalterado em ${depois.saida.slice(0, 8)}; pull sem novidade`,
      },
      codigo_erro: null,
      dados: { repositorio: apelido, avancou: mudou },
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
  /** Rótulo de UMA LINHA para qualquer pendência — usado só para dizer "descartei o pedido anterior de X". */
  private rotuloPendencia(p: Pendencia): string {
    return p.tipo === 'energia' ? ROTULO_ENERGIA[p.acao] : `a mensagem de WhatsApp para ${p.destinatario}`;
  }

  private pendenciaAnteriorTrocada(idUsuario: string, rotuloNova: string): string {
    /**
     * Substituir uma pendência é FATO DITO, não sobrescrita muda.
     *
     * Sem esta frase, quem pediu "desligar" e depois "reiniciar" — ou pediu
     * "desligar" e depois "manda mensagem pro fulano" — fica com dois pedidos
     * na cabeça e um só no sistema, porque o slot é UM por operador (ver o
     * comentário de `PendenciaWhatsapp`). O "confirmo" seguinte resolve o que
     * o sistema guardou, não o que a pessoa lembra.
     */
    const anterior = this.pendencias.get(idUsuario);
    if (!anterior || Date.now() > anterior.expira_em) return '';
    const rotuloAnterior = this.rotuloPendencia(anterior);
    return rotuloAnterior === rotuloNova ? '' : `Descartei o pedido anterior de ${rotuloAnterior}. `;
  }

  pedirEnergia(idUsuario: string, acao: AcaoEnergia, sessao: string): string {
    const trocou = this.pendenciaAnteriorTrocada(idUsuario, ROTULO_ENERGIA[acao]);

    this.pendencias.set(idUsuario, {
      tipo: 'energia',
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

  /**
   * R2 aplicado a comunicação: NUNCA envia aqui — registra a pendência e
   * devolve o pedido de confirmação. Mesma trava dupla de `acionar_energia`
   * (interlock em memória + operação persistida no jornal, as duas amarradas
   * a operador+sessão); ver `ClienteWhatsapp.ts` para o porquê deste módulo
   * nunca chamar a Meta diretamente.
   */
  pedirWhatsapp(idUsuario: string, destinatario: string, mensagem: string, sessao: string): string {
    const rotuloNovo = `a mensagem de WhatsApp para ${destinatario}`;
    const trocou = this.pendenciaAnteriorTrocada(idUsuario, rotuloNovo);

    this.pendencias.set(idUsuario, {
      tipo: 'whatsapp',
      id: randomUUID(),
      destinatario,
      mensagem,
      sessao,
      criada_em: Date.now(),
      expira_em: Date.now() + VALIDADE_PENDENCIA_MS,
    });
    this.auditar(idUsuario, 'whatsapp_pendente', true, `para ${destinatario}, aguardando confirmação (${sessao})`);
    const previa = mensagem.length > 80 ? `${mensagem.slice(0, 80)}…` : mensagem;
    return (
      `${trocou}Confirma o envio para ${destinatario}: "${previa}"? Responda "confirmo" em até 1 minuto. ` +
      '"cancela" desiste. Mensagem entregue não se desfaz — por isso pergunto antes.'
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

    /**
     * GUARDA DE TIPO, DE PROPÓSITO REDUNDANTE COM `resolverConfirmacao`.
     *
     * Em uso normal, quem chama já conferiu `tipoPendencia` antes de decidir
     * entre este método e `confirmarComunicacao` — nunca deveria cair aqui
     * com uma pendência de WhatsApp. Mas "nunca deveria" é exatamente a frase
     * que o incidente de 11/08/2026 (`PorteiroAutorizacao.ts`) invalidou: uma
     * garantia que só existe no chamador, e não aqui, é uma garantia que um
     * chamador novo pode esquecer de honrar. Recusar SEM consumir a
     * pendência deixa quem realmente sabe tratá-la (`confirmarComunicacao`)
     * ainda com o que precisa.
     */
    if (pendencia.tipo !== 'energia') {
      this.auditar(idUsuario, 'energia:confirmar_chamado_para_whatsapp', false, sessao);
      return 'Isto não é uma pendência de energia — chamada errada, nada foi tocado.';
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

  /**
   * QUAL TIPO de pendência válida existe para este diálogo, sem consumir
   * nada. `resolverConfirmacao` chama isto ANTES de decidir entre `confirmar`
   * (energia, síncrono, dispara e não espera) e `confirmarComunicacao`
   * (assíncrono, espera a Meta responder) — as duas ações têm naturezas
   * diferentes demais para viver atrás da mesma assinatura de função.
   */
  tipoPendencia(idUsuario: string, sessao: string): Pendencia['tipo'] | null {
    return this.valida(idUsuario, sessao)?.tipo ?? null;
  }

  /**
   * A confirmação de WhatsApp — irmã assíncrona de `confirmar`.
   *
   * POR QUE NÃO É A MESMA FUNÇÃO: `confirmar` devolve `string` porque
   * "desligar" é fogo-e-esquece — `this.executor` solta o comando e a
   * verdade sobre o que aconteceu não é observável deste processo (por isso
   * o jornal marca `desconhecida`, nunca `sucesso`). Enviar mensagem é
   * diferente: a Meta responde SÍNCRONO, dentro desta mesma chamada, com
   * sucesso ou erro — fingir que não sei o resultado quando ele já chegou
   * seria pior que a "mentira operacional" que este arquivo inteiro existe
   * para impedir.
   *
   * `null` quando não há pendência de WhatsApp válida — quem chama decide o
   * que fazer (normalmente nem chega a chamar, porque já conferiu
   * `tipoPendencia` antes).
   */
  async confirmarComunicacao(
    idUsuario: string,
    sessao: string,
  ): Promise<{ texto: string; sucesso: boolean } | null> {
    const pendencia = this.valida(idUsuario, sessao);
    if (!pendencia || pendencia.tipo !== 'whatsapp') return null;

    this.pendencias.delete(idUsuario);

    const resultado = await this.enviadorWhatsapp(pendencia.destinatario, pendencia.mensagem);
    this.auditar(
      idUsuario,
      `whatsapp:${resultado.ok ? 'enviado' : 'falhou'}`,
      resultado.ok,
      `${pendencia.id}: ${resultado.texto}`,
    );
    return { texto: resultado.texto, sucesso: resultado.ok };
  }

  // -------------------------------------------------------------------------
  // Sessões de agente de código (Claude Code)
  // -------------------------------------------------------------------------

  /**
   * ABRE uma sessão e manda a primeira instrução.
   *
   * A IARA GERA o `--session-id` antes de lançar. Isso não é detalhe: significa
   * que a identidade da sessão é conhecida ANTES de o processo existir, então
   * qualquer relato que volte pode ser conferido contra ela. Extrair o id da
   * saída faria o contrário — acreditar no processo sobre quem ele é.
   *
   * NÃO espera o agente terminar. Uma auditoria de código leva minutos e a
   * habilidade tem teto de segundos; o que se espera é a JANELA DE VEREDITO
   * ANTECIPADO — tempo suficiente para uma falha de partida (binário ausente,
   * não logado, repositório recusado) aparecer. Passada a janela sem saída, o
   * estado honesto é `trabalhando`, nunca "pronto".
   */
  async abrirSessaoAgente(
    idUsuario: string,
    pedidoRepositorio: string,
    instrucao: string,
  ): Promise<RelatoAcao> {
    const repo = resolverRepositorio(pedidoRepositorio);
    if (!repo) {
      this.auditar(idUsuario, 'abrir_sessao_agente', false, `repo recusado: ${pedidoRepositorio.slice(0, 60)}`);
      return {
        ok: false,
        texto:
          `Não abro sessão em "${pedidoRepositorio.slice(0, 80)}": não é um repositório autorizado. ` +
          `Hoje eu conheço: ${repositoriosDisponiveis()}.`,
        prova: {
          confirmado: false,
          evidencia: 'fora da allowlist de repositórios; nenhum processo foi lançado',
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'PERMISSAO_NEGADA',
      };
    }

    const id = randomUUID();
    const sessao: SessaoAgenteViva = {
      id,
      repositorio: repo.apelido,
      caminho: repo.caminho,
      idUsuario,
      iniciada_em: Date.now(),
      saida: '',
      erro: '',
      codigoSaida: null,
      encerradaPorMim: false,
      processo: null,
    };
    this.sessoesAgente.set(id, sessao);
    this.podarSessoesAgente();

    const argumentos = [
      '-p',
      instrucao,
      '--session-id',
      id,
      '--output-format',
      'json',
      /* Modo de permissão CONSERVADOR e explícito. O agente delegado não herda
         autoridade nenhuma da IARA — ele é outro processo, com as próprias
         travas, e quem o lança não pode afrouxá-las por conveniência. */
      '--permission-mode',
      'acceptEdits',
    ];

    try {
      sessao.processo = this.lancadorAgente(argumentos, repo.caminho, (codigo, saida, erro) => {
        sessao.codigoSaida = codigo;
        sessao.saida += saida;
        sessao.erro += erro;
        sessao.processo = null;
      });
    } catch (erro) {
      sessao.codigoSaida = -1;
      sessao.erro = (erro as Error).message;
    }

    await this.esperarVereditoAntecipado(sessao);
    return this.relatarSessao(sessao, 'abrir_sessao_agente');
  }

  /**
   * MANDA outra instrução para uma sessão que já existe, com `--resume`.
   *
   * Recusa sessão de outro operador antes de qualquer coisa: o id é um UUID e
   * não se adivinha, mas "difícil de adivinhar" nunca foi controle de acesso.
   */
  async enviarParaSessaoAgente(
    idUsuario: string,
    idSessao: string,
    instrucao: string,
  ): Promise<RelatoAcao> {
    const sessao = this.sessaoAgenteDe(idUsuario, idSessao);
    if (!sessao) return this.sessaoAgenteDesconhecida(idUsuario, idSessao);

    if (sessao.processo) {
      return {
        ok: false,
        texto:
          `A sessão ${sessao.id} ainda está trabalhando no repositório ${sessao.repositorio}. ` +
          'Espere ela terminar, ou me peça para encerrar.',
        prova: {
          confirmado: false,
          evidencia: `processo ainda vivo (pid ${sessao.processo.pid ?? 'desconhecido'}); nada foi enviado`,
          motivo: 'sem_meio_de_verificar',
        },
        codigo_erro: null,
      };
    }

    sessao.saida = '';
    sessao.erro = '';
    sessao.codigoSaida = null;
    sessao.encerradaPorMim = false;

    const argumentos = [
      '-p',
      instrucao,
      '--resume',
      sessao.id,
      '--output-format',
      'json',
      '--permission-mode',
      'acceptEdits',
    ];

    try {
      sessao.processo = this.lancadorAgente(argumentos, sessao.caminho, (codigo, saida, erro) => {
        sessao.codigoSaida = codigo;
        sessao.saida += saida;
        sessao.erro += erro;
        sessao.processo = null;
      });
    } catch (erro) {
      sessao.codigoSaida = -1;
      sessao.erro = (erro as Error).message;
    }

    await this.esperarVereditoAntecipado(sessao);
    return this.relatarSessao(sessao, 'enviar_para_sessao_agente');
  }

  /** CONSULTA o estado — sem tocar em nada. É leitura, e a prova é o veredito. */
  consultarSessaoAgente(idUsuario: string, idSessao?: string): RelatoAcao {
    if (idSessao) {
      const sessao = this.sessaoAgenteDe(idUsuario, idSessao);
      if (!sessao) return this.sessaoAgenteDesconhecida(idUsuario, idSessao);
      return this.relatarSessao(sessao, 'consultar_sessao_agente');
    }

    const minhas = [...this.sessoesAgente.values()].filter((s) => s.idUsuario === idUsuario);
    if (minhas.length === 0) {
      return {
        ok: true,
        texto: 'Não abri nenhuma sessão de agente de código nesta conversa.',
        prova: { confirmado: true, evidencia: 'registro de sessões vazio para este operador' },
        codigo_erro: null,
      };
    }
    const linhas = minhas.map((s) => {
      const v = this.julgar(s);
      return `  ${s.id}  ${s.repositorio}  ${v.estado}`;
    });
    return {
      ok: true,
      texto: ['Sessões de agente de código:', ...linhas].join('\n'),
      prova: { confirmado: true, evidencia: `${minhas.length} sessão(ões) no registro deste processo` },
      codigo_erro: null,
    };
  }

  /**
   * ENCERRA. Matar o processo é um efeito, e o relato diz o que foi observado —
   * nunca "encerrei" por ter chamado `kill`.
   */
  encerrarSessaoAgente(idUsuario: string, idSessao: string): RelatoAcao {
    const sessao = this.sessaoAgenteDe(idUsuario, idSessao);
    if (!sessao) return this.sessaoAgenteDesconhecida(idUsuario, idSessao);

    if (!sessao.processo) {
      return {
        ok: true,
        texto: `A sessão ${sessao.id} já não estava rodando. Não mexi em nada.`,
        prova: { confirmado: true, evidencia: 'nenhum processo vivo para esta sessão antes do pedido' },
        codigo_erro: null,
      };
    }

    sessao.encerradaPorMim = true;
    sessao.processo.matar();
    this.auditar(idUsuario, 'encerrar_sessao_agente', true, sessao.id);
    return {
      ok: true,
      texto: `Mandei encerrar a sessão ${sessao.id} no repositório ${sessao.repositorio}.`,
      prova: {
        confirmado: false,
        evidencia: 'sinal de encerramento enviado ao processo; a saída dele ainda não foi observada',
        motivo: 'sem_meio_de_verificar',
      },
      codigo_erro: null,
    };
  }

  // --- apoio das sessões de agente ------------------------------------------

  private sessaoAgenteDe(idUsuario: string, idSessao: string): SessaoAgenteViva | null {
    const s = this.sessoesAgente.get((idSessao ?? '').trim());
    /* Dono errado responde igual a inexistente: confirmar a existência de uma
       sessão alheia já é vazamento. */
    return s && s.idUsuario === idUsuario ? s : null;
  }

  private sessaoAgenteDesconhecida(idUsuario: string, idSessao: string): RelatoAcao {
    this.auditar(idUsuario, 'sessao_agente', false, `desconhecida: ${String(idSessao).slice(0, 40)}`);
    return {
      ok: false,
      texto: 'Não encontro essa sessão de agente de código nesta conversa.',
      prova: {
        confirmado: false,
        evidencia: 'id não está no registro deste processo para este operador',
        motivo: 'nao_encontrado',
      },
      codigo_erro: 'PARAMETRO_INVALIDO',
    };
  }

  /**
   * A JANELA DE VEREDITO ANTECIPADO. Curta de propósito: ela não existe para
   * esperar o agente trabalhar, e sim para deixar uma falha de PARTIDA se
   * manifestar antes de a IARA abrir a boca. Medido com o binário real: o caso
   * "não logado" morre em ~300 ms.
   */
  private async esperarVereditoAntecipado(sessao: SessaoAgenteViva): Promise<void> {
    const limite = Date.now() + janelaVeredito();
    while (sessao.codigoSaida === null && Date.now() < limite) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  private julgar(sessao: SessaoAgenteViva): VereditoSessao {
    if (sessao.encerradaPorMim && sessao.codigoSaida !== null) {
      return {
        estado: 'desconhecida',
        evidencia: 'eu encerrei esta sessão; não dá para saber o que ela teria concluído',
        resultado: null,
      };
    }
    return julgarSessao({
      codigoSaida: sessao.codigoSaida,
      saidaBruta: sessao.saida,
      erroBruto: sessao.erro,
      idEsperado: sessao.id,
      transcriptExiste: existsSync(caminhoDoTranscript(homedir(), sessao.caminho, sessao.id)),
    });
  }

  /**
   * O RELATO. É aqui que o veredito vira frase, e a regra é a de `Verdade.ts`:
   * só `concluida` autoriza afirmar que o trabalho aconteceu.
   */
  private relatarSessao(sessao: SessaoAgenteViva, acao: string): RelatoAcao {
    const v = this.julgar(sessao);
    this.auditar(sessao.idUsuario, acao, v.estado !== 'falhou', `${sessao.id}: ${v.estado}`);

    if (v.estado === 'concluida') {
      return {
        ok: true,
        texto:
          `O Claude Code terminou no repositório ${sessao.repositorio}.\n\n${v.resultado}\n\n` +
          `Sessão ${sessao.id}.`,
        prova: { confirmado: true, evidencia: v.evidencia },
        codigo_erro: null,
      };
    }

    if (v.estado === 'trabalhando') {
      return {
        ok: true,
        texto:
          `A sessão ${sessao.id} está aberta e trabalhando no repositório ${sessao.repositorio}. ` +
          'Ainda não terminou — me pergunte de novo daqui a pouco e eu confiro.',
        prova: { confirmado: false, evidencia: v.evidencia, motivo: 'sem_meio_de_verificar' },
        codigo_erro: null,
      };
    }

    if (v.estado === 'falhou') {
      /**
       * A FALHA DE PARTIDA tem conserto e dono, e por isso ganha frase própria.
       * `ENOENT`/`EINVAL` não são "o agente falhou": são "o programa não foi
       * encontrado do jeito que dá para executá-lo nesta máquina" — e a pessoa
       * que lê precisa saber que o conserto é declarar `IARA_COMANDO_AGENTE`,
       * não tentar de novo. Ver `comandoDoAgente` para o porquê do `.exe`.
       */
      const naoLancou = /ENOENT|EINVAL|spawn/i.test(v.evidencia);
      return {
        ok: false,
        texto: naoLancou
          ? 'Não consegui iniciar o Claude Code neste computador: o programa não foi encontrado. ' +
            'Instale com `npm install -g @anthropic-ai/claude-code` e, no Windows, declare ' +
            '`IARA_COMANDO_AGENTE` com o caminho do `claude.exe` — o atalho `.cmd` não é executável direto.'
          : `Não consegui trabalhar no repositório ${sessao.repositorio}: ${v.resultado ?? 'o agente falhou ao iniciar'}.`,
        prova: { confirmado: false, evidencia: v.evidencia, motivo: 'divergente' },
        codigo_erro: 'FALHA_NA_EXECUCAO',
      };
    }

    return {
      ok: false,
      texto:
        `Mandei o pedido para o Claude Code no repositório ${sessao.repositorio} e não consigo provar o que aconteceu. ` +
        'Não vou dizer que deu certo sem ter como confirmar.',
      prova: { confirmado: false, evidencia: v.evidencia, motivo: 'sem_meio_de_verificar' },
      codigo_erro: null,
    };
  }

  /** Teto do registro. Sessão velha e já encerrada sai; viva nunca sai. */
  private podarSessoesAgente(): void {
    if (this.sessoesAgente.size <= MAX_SESSOES_AGENTE) return;
    for (const [id, s] of this.sessoesAgente) {
      if (this.sessoesAgente.size <= MAX_SESSOES_AGENTE) break;
      if (!s.processo) this.sessoesAgente.delete(id);
    }
  }
}

/** Instância única do processo — as pendências vivem nela. */
export const agenteLocal = new AgenteLocal();
