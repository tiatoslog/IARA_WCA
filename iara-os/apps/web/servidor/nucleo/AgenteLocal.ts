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

import { mkdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';

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
}

/**
 * O mapa É a permissão. Adicionar aplicativo = adicionar linha aqui, em
 * commit revisado. As chaves são o que o reconhecedor procura na frase.
 */
const APLICATIVOS: Record<string, AplicativoAutorizado> = {
  'bloco de notas': { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [] },
  notepad: { rotulo: 'Bloco de Notas', comando: 'notepad.exe', argumentos: [] },
  calculadora: { rotulo: 'Calculadora', comando: 'calc.exe', argumentos: [] },
  paint: { rotulo: 'Paint', comando: 'mspaint.exe', argumentos: [] },
  explorador: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  explorer: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  arquivos: { rotulo: 'Explorador de Arquivos', comando: 'explorer.exe', argumentos: [] },
  // Navegadores instalam fora do PATH; `start` resolve pelo registro do app.
  chrome: { rotulo: 'Google Chrome', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'chrome'] },
  edge: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'] },
  navegador: { rotulo: 'Microsoft Edge', comando: 'cmd.exe', argumentos: ['/c', 'start', '', 'msedge'] },
};

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

const executorReal: Executor = (comando, argumentos) => {
  const filho = spawn(comando, argumentos, { detached: true, stdio: 'ignore' });
  filho.unref();
};

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

  abrirAplicativo(idUsuario: string, pedido: string): string {
    const app = resolverAplicativo(pedido);
    if (!app) {
      this.auditar(idUsuario, 'abrir_aplicativo', false, pedido.slice(0, 60));
      return `Esse aplicativo não está na minha lista autorizada. Hoje eu abro: ${aplicativosDisponiveis()}.`;
    }
    this.executor(app.comando, app.argumentos);
    this.auditar(idUsuario, 'abrir_aplicativo', true, app.rotulo);
    return `${app.rotulo} aberto.`;
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
