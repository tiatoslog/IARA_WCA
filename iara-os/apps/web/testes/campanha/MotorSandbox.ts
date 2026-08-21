/**
 * O MOTOR DA CAMPANHA — a IARA de verdade, num quarto fechado.
 *
 * Não é um mock, não é uma instância do Kernel montada em memória por dentro do
 * teste: é `servidor/principal.ts` num processo filho, falando o mesmo
 * WebSocket que o navegador fala. Essa escolha é o ponto inteiro da campanha —
 * um teste que instancia o Kernel diretamente prova que as peças funcionam, e a
 * pergunta aqui é outra: *o que chega ao operador é verdade?* Só a cadeia
 * completa responde isso.
 *
 * O quarto é fechado em quatro dimensões, e cada uma já foi um estrago real ou
 * evidente em algum sistema:
 *
 *  1. **Disco** — `USERPROFILE` aponta para um sandbox descartável, então
 *     "crie uma pasta na Área de Trabalho" cria numa Área de Trabalho de
 *     mentira. Ver `Sandbox.ts`.
 *  2. **Rede** — toda credencial de efeito externo (Graph, WhatsApp, Supabase,
 *     voz neural) entra VAZIA. A IARA não manda mensagem para ninguém às três
 *     da manhã porque a campanha pediu.
 *  3. **Porta** — exclusiva, nunca a 3000. Outras sessões usam a 3000.
 *  4. **Cérebro** — `IARA_PROVEDOR=ollama` força o modelo local: custo zero,
 *     nenhuma cota de terceiro, e o mesmo cérebro em toda rodada.
 *
 * O que NÃO é neutralizado, de propósito: `IARA_CHAVE_PROVA`. O selo do jornal
 * precisa estar ligado — conferir integridade com a integridade desligada seria
 * a própria campanha fazendo o que ela existe para pegar.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { conferirSandbox, criarSandbox, removerSandbox, type Sandbox } from './Sandbox';

/** A raiz do app — dois níveis acima de `testes/campanha/`. */
export const RAIZ_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Credenciais de EFEITO EXTERNO, zeradas no filho.
 *
 * String vazia, não `delete`: o `dotenv` de `principal.ts` só define o que
 * ainda não existe no ambiente, então uma chave PRESENTE E VAZIA é o único
 * jeito de impedir que o `.env.local` a reponha. Apagar a variável faria o
 * `.env.local` vencer — que é exatamente o contrário do pretendido.
 *
 * E `lerConfig` trata vazio como ausente, então a habilidade correspondente
 * fica indisponível e diz isso em voz alta, que é o comportamento honesto da
 * casa.
 */
const CREDENCIAIS_NEUTRALIZADAS = [
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  /* FALTAVA, e a falta era silenciosa: `OPENROUTER_API_KEY` entrou na cadeia de
     raciocínio em 18/08/2026 e ninguém a acrescentou aqui, então ela atravessava
     para todo filho de campanha. Não houve gasto — o filho é forçado a `ollama`,
     que nunca chega a consultar a cadeia — mas a lista É a fronteira, e uma
     fronteira que depende de outra trava para não vazar já vazou. */
  'OPENROUTER_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'CONVAI_API_KEY',
  'IARA_VOZ_NEURAL',
  'MS_GRAPH_TOKEN',
  'MS_GRAPH_CLIENT_ID',
  'MS_GRAPH_TENANT_ID',
  'MS_GRAPH_CLIENT_SECRET',
  'MS_GRAPH_CAIXA',
  'MS_GRAPH_OCI_URL',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_VERIFY_TOKEN',
  'CRON_SECRET',
  'IARA_TOKEN',
  'IARA_ADMINS',
] as const;

/**
 * A credencial de cada cérebro. Duplica de propósito o mapa de
 * `FabricaRaciocinio`: a campanha não importa nada de `servidor/` — é a mesma
 * regra que faz `OraculoJornal` reimplementar o HMAC. Um cérebro fora deste mapa
 * simplesmente não libera credencial nenhuma, e o motor dirá em voz alta que
 * está sem raciocínio.
 */
const CREDENCIAL_DO_CEREBRO: Readonly<Record<string, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  groq: 'GROQ_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  /* `ollama` não aparece: `OLLAMA_URL` nunca foi zerada — é local, sem cota e
     sem custo, e é o padrão da campanha. */
};

/**
 * OS CÉREBROS PEDIDOS, normalizados — aceita `'groq'` e `'groq,gemini'`.
 *
 * A LISTA EXISTE POR UMA MEDIÇÃO, 18/08/2026. O boot de conversa subiu com
 * `--cerebro groq` e todo turno cognitivo morreu em ~130 ms; o texto cru era
 * `429 ... tokens per minute (TPM): Limit 8000, Used 7066, Requested 6448`. Um
 * turno da rota cognitiva pede ~6,4k tokens, então o segundo turno do mesmo
 * minuto estoura o teto gratuito da Groq — sempre.
 *
 * O ponto não é o 429: `CadeiaDeRaciocinio` classifica `rate_limit` como motivo
 * de TROCA, e em produção o próximo elo assumiria. O ponto é que ESTE HARNESS
 * não conseguia enxergar isso: liberando a credencial de um cérebro só, a cadeia
 * nasce com um elo, e "o provedor estourou a cota" fica INDISTINGUÍVEL de "a
 * cadeia não faz failover". São o mesmo relatório e defeitos opostos.
 *
 * Medir failover exige mais de um elo vivo. Daí a lista.
 */
function cerebrosPedidos(cerebro: string | undefined): readonly string[] {
  if (!cerebro) return [];
  return cerebro
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter((c) => c.length > 0);
}

/**
 * FONTES DE LEITURA que uma corrida pode pedir de volta, por apelido.
 *
 * Existe para a prova de produção da cardinalidade: "quantos motoristas temos?"
 * só tem resposta se a planilha da LUFT estiver alcançável, e no sandbox ela
 * está zerada por padrão — que continua sendo o certo para as campanhas
 * noturnas.
 *
 * SÓ LEITURA. `MS_GRAPH_CAIXA` (enviar e-mail) fica de fora de propósito: a
 * exceção é para conseguir CONFERIR um número, não para a IARA alcançar
 * terceiros durante um teste. WhatsApp e Supabase seguem zerados.
 *
 * O VALOR DO SEGREDO NÃO PASSA POR AQUI — o mesmo mecanismo do `cerebro`: a
 * variável apenas deixa de ser sobrescrita por string vazia, e o `dotenv` do
 * filho a repõe do `.env.local`. Nada é lido, copiado ou repassado.
 */
const FONTES_LIBERAVEIS: Readonly<Record<string, readonly string[]>> = {
  graph: ['MS_GRAPH_TOKEN', 'MS_GRAPH_CLIENT_ID', 'MS_GRAPH_TENANT_ID', 'MS_GRAPH_CLIENT_SECRET', 'MS_GRAPH_OCI_URL'],
};

/** As zeradas desta corrida: todas, menos as dos cérebros e fontes pedidos. */
function credenciaisZeradas(
  cerebro: string | undefined,
  fontes: readonly string[] = [],
): readonly string[] {
  const liberadas = new Set(
    cerebrosPedidos(cerebro)
      .map((c) => CREDENCIAL_DO_CEREBRO[c])
      .filter((v): v is string => Boolean(v)),
  );
  for (const apelido of fontes) {
    for (const v of FONTES_LIBERAVEIS[apelido.trim().toLowerCase()] ?? []) liberadas.add(v);
  }
  return CREDENCIAIS_NEUTRALIZADAS.filter((n) => !liberadas.has(n));
}

/**
 * O QUE VAI PARA `IARA_PROVEDOR`.
 *
 * Um cérebro pedido → força aquele, sem cadeia: quem declarou um sabe o que
 * quer medir. Mais de um → `auto`, porque é `auto` que faz a `FabricaRaciocinio`
 * montar a CADEIA na ordem dela. Declarar `'groq,gemini'` em `IARA_PROVEDOR`
 * cairia no ramo "valor fora da lista" da fábrica, que também vira `auto` — mas
 * por acidente, e um acerto por acidente é o que este arquivo inteiro combate.
 */
function seletorDeProvedor(cerebro: string | undefined): Record<string, string> {
  const pedidos = cerebrosPedidos(cerebro);
  if (pedidos.length === 0) return {};
  return { IARA_PROVEDOR: pedidos.length === 1 ? pedidos[0] : 'auto' };
}

export interface OpcoesMotor {
  readonly porta: number;
  readonly rotulo: string;
  /** Sobrescritas pontuais — uma missão que precise de admin, por exemplo. */
  readonly ambiente?: Readonly<Record<string, string>>;
  /**
   * O CÉREBRO PEDIDO — e a única exceção à neutralização de credenciais.
   *
   * Sem ele, o filho roda `ollama` local com todas as chaves de raciocínio
   * zeradas: a campanha não gasta cota nem dinheiro, que é o padrão e continua
   * sendo. Com ele, DUAS coisas mudam juntas, e só juntas é que a medição existe:
   *
   *   1. `IARA_PROVEDOR` passa a valer o provedor pedido;
   *   2. a credencial DESSE provedor — só dela — sai da lista de zeradas.
   *
   * Fazer (1) sem (2) foi o defeito de 18/08/2026: a campanha CO subiu com
   * `--cerebro groq`, o seletor mudou, a chave continuou vazia, o provedor
   * nasceu indisponível e a IARA recusou honestamente durante doze segundos. O
   * relatório teria chamado aquilo de "resultado da Groq".
   *
   * O VALOR DO SEGREDO NÃO PASSA POR AQUI. A credencial não é lida, copiada nem
   * repassada: ela apenas deixa de ser sobrescrita por string vazia, e o
   * `dotenv` de `principal.ts` a repõe do `.env.local` dentro do filho — que é
   * exatamente o mecanismo que o comentário de `CREDENCIAIS_NEUTRALIZADAS`
   * descreve, usado no sentido contrário.
   *
   * ISTO GASTA COTA REAL, e dinheiro real quando o pedido é `anthropic`. É por
   * isso que a porta é uma opção explícita por corrida e não um padrão.
   *
   * ACEITA LISTA SEPARADA POR VÍRGULA — `'groq,gemini,openrouter'`. Um nome
   * força aquele provedor; vários montam a CADEIA, que é a única forma de medir
   * failover. Ver `cerebrosPedidos` para o incidente que originou a lista.
   */
  readonly cerebro?: string;
  /** Teto para a subida. Ollama frio já levou 20 s para o primeiro turno. */
  readonly prazo_subida_ms?: number;
  /**
   * Fontes de LEITURA devolvidas a este filho, por apelido (`graph`). Padrão é
   * nenhuma — o sandbox segue cego para o mundo, que é o que permite a campanha
   * rodar de madrugada. Ver `FONTES_LIBERAVEIS`.
   */
  readonly liberar?: readonly string[];
}

export interface MotorVivo {
  readonly porta: number;
  readonly url_ws: string;
  readonly sandbox: Sandbox;
  /** Onde o jornal `.jsonl` cai. É `cwd/dados/operacoes`, por `RegistroOperacoes`. */
  readonly raiz_operacoes: string;
  readonly pid: number;
  /** Tudo que o motor escreveu em stdout/stderr, para o dossiê. */
  readonly saida: readonly string[];
  /** Morreu sozinho? Guarda o código, que é o que separa crash de encerramento. */
  readonly desfecho: () => { vivo: boolean; codigo: number | null; sinal: string | null };
  /** Mata SEM cerimônia — é o que a missão de recuperação precisa. */
  matar(sinal?: NodeJS.Signals): void;
  encerrar(): Promise<void>;
}

/**
 * TODO motor vivo desta rodada, para a rede de segurança abaixo.
 *
 * A rede existe por causa de um estrago medido em 16/08/2026: matar o `npm run
 * campanha` deixou o motor filho VIVO na porta 3071. Ele continuou com o ciclo
 * autônomo ligado, chamando o provedor local a cada tique — e como aquele
 * processo tinha subido antes de o modelo ser fixado, ele mantinha o `llama3.1`
 * de 6 GB residente. A máquina foi a 98% de memória, o Ollama passou a despejar
 * e recarregar modelo entre chamadas (86 s, 126 s, 132 s medidos), e TODA
 * medição das horas seguintes ficou contaminada por um processo que ninguém
 * sabia que existia.
 *
 * No Windows, filho não morre com o pai. Quem sobe processo aqui é responsável
 * por derrubá-lo — inclusive quando o corredor morre de morte violenta.
 */
const VIVOS = new Set<ChildProcess>();
let redeArmada = false;

function armarRedeDeSeguranca(): void {
  if (redeArmada) return;
  redeArmada = true;
  const derrubar = () => {
    for (const f of VIVOS) {
      try {
        f.kill('SIGKILL');
      } catch {
        /* já morreu */
      }
    }
    VIVOS.clear();
  };
  process.on('exit', derrubar);
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
    process.on(sinal, () => {
      derrubar();
      process.exit(130);
    });
  }
  /* Exceção não capturada também deixa órfão — e é o caso mais provável de
     todos, porque ninguém a prevê. */
  process.on('uncaughtException', (e) => {
    derrubar();
    console.error('[campanha] exceção não capturada:', e);
    process.exit(1);
  });
}

async function esperarSaude(porta: number, prazoMs: number): Promise<boolean> {
  const limite = Date.now() + prazoMs;
  while (Date.now() < limite) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/saude`, {
        signal: AbortSignal.timeout(2000),
      });
      if (r.ok || r.status === 503) return true;
    } catch {
      /* ainda não subiu */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * Derruba motores de campanha ESQUECIDOS nas portas indicadas.
 *
 * Complementa a rede de segurança acima e cobre o buraco que ela não cobre: um
 * `SIGKILL` no corredor (o teto de tempo do Agendador de Tarefas, por exemplo)
 * não executa nenhum tratador, e o motor da rodada anterior amanhece vivo
 * segurando o modelo na memória.
 *
 * DUAS TRAVAS, e as duas precisam casar antes de qualquer processo morrer:
 *
 *  1. a porta está no intervalo que a campanha usa — nunca a 3000, nunca a
 *     porta de quem estiver depurando;
 *  2. a linha de comando do processo é `servidor/principal.ts`.
 *
 * Sem a segunda, um serviço qualquer que tivesse pegado a porta seria morto por
 * uma suíte de teste. Devolve o que matou, para o relatório dizer.
 */
export async function limparMotoresEsquecidos(portas: readonly number[]): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const executar = promisify(execFile);
  const script = `
    $portas = @(${portas.join(',')})
    foreach ($p in $portas) {
      Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue | ForEach-Object {
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$($_.OwningProcess)" -ErrorAction SilentlyContinue
        if ($proc -and $proc.CommandLine -match 'servidor.principal\\.ts') {
          Write-Output "porta $p PID $($_.OwningProcess)"
          Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue
        }
      }
    }`;
  try {
    const { stdout } = await executar(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 30_000, windowsHide: true },
    );
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    /* Sem PowerShell, sem limpeza — e a subida vai recusar a porta ocupada,
       que é o comportamento seguro. Não é motivo para abortar a campanha. */
    return [];
  }
}

export async function subirMotor(opcoes: OpcoesMotor): Promise<MotorVivo> {
  const sandbox = criarSandbox(opcoes.rotulo);
  const faltando = conferirSandbox(sandbox);
  if (faltando.length) {
    removerSandbox(sandbox);
    throw new Error(`sandbox incompleto, o motor escreveria no disco real: ${faltando.join(', ')}`);
  }

  const ambiente: NodeJS.ProcessEnv = {
    ...process.env,
    USERPROFILE: sandbox.raiz,
    HOME: sandbox.raiz,
    IARA_MODO: 'headless',
    IARA_PORTA: String(opcoes.porta),
    PORT: String(opcoes.porta),
    /**
     * O motor TEM as mãos desta máquina, declarado em vez de herdado da
     * plataforma. É o que faz `criar_pasta` de fato escrever no disco — e,
     * portanto, o que permite ao oráculo desmentir a fala. Sem mãos, toda
     * missão de agente viraria uma recusa honesta e a campanha não mediria
     * nada.
     */
    IARA_MAOS_LOCAIS: '1',
    IARA_PROVEDOR: 'ollama',
    OLLAMA_URL: process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434',
    /**
     * O MODELO É FIXADO, e não é preferência estética — foi medido.
     *
     * `ClienteOllama` cai em `llama3.1` (8B, ~6,2 GB residentes) quando ninguém
     * declara. Numa máquina de 16 GB com o resto do ambiente de trabalho aberto,
     * esse modelo não cabe: o Windows o despeja entre uma requisição e outra e
     * o Ollama o recarrega do disco toda vez. Medido em 16/08/2026, três
     * chamadas seguidas de "diga apenas OK": 86 s, 126 s e 132 s — das quais
     * 99% era `load_duration`, e `/api/ps` voltava vazio logo depois.
     *
     * Uma campanha nesse regime não mede a IARA: mede a paginação do sistema
     * operacional, e cada turno vira silêncio por estouro de prazo. O 3B
     * (~2 GB) fica residente e devolve o turno em segundos.
     *
     * `OLLAMA_MODELO` do ambiente ainda vence, para quem tiver máquina que
     * comporte o modelo maior.
     */
    OLLAMA_MODELO: process.env.OLLAMA_MODELO ?? 'llama3.2:3b',
    IARA_ORIGENS: '',
    ...Object.fromEntries(credenciaisZeradas(opcoes.cerebro, opcoes.liberar).map((n) => [n, ''])),
    /* Depois das zeradas de propósito: pedir cérebro é justamente sobrepor o
       `IARA_PROVEDOR: 'ollama'` fixado acima. */
    ...seletorDeProvedor(opcoes.cerebro),
    ...(opcoes.ambiente ?? {}),
  };

  const saida: string[] = [];
  /**
   * `node --import tsx` e não `npx tsx`: o `npx` do Windows abre um `cmd.exe`
   * intermediário, e matar o filho passa a matar o `cmd` deixando o motor vivo
   * — o que arruinaria a missão de recuperação (que precisa provar que o
   * processo morreu) e deixaria porta ocupada para a rodada seguinte.
   */
  const filho: ChildProcess = spawn(
    process.execPath,
    ['--import', 'tsx', path.join('servidor', 'principal.ts'), '--dev'],
    { cwd: RAIZ_WEB, env: ambiente, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
  );

  armarRedeDeSeguranca();
  VIVOS.add(filho);

  let codigo: number | null = null;
  let sinal: string | null = null;
  let vivo = true;
  filho.on('exit', (c, s) => {
    vivo = false;
    codigo = c;
    sinal = s;
    VIVOS.delete(filho);
  });
  const anotar = (b: Buffer) => {
    for (const l of b.toString('utf8').split('\n')) if (l.trim()) saida.push(l.trimEnd());
    if (saida.length > 4000) saida.splice(0, saida.length - 4000);
  };
  filho.stdout?.on('data', anotar);
  filho.stderr?.on('data', anotar);

  const motor: MotorVivo = {
    porta: opcoes.porta,
    url_ws: `ws://127.0.0.1:${opcoes.porta}/barramento`,
    sandbox,
    raiz_operacoes: path.join(RAIZ_WEB, 'dados', 'operacoes'),
    pid: filho.pid ?? -1,
    saida,
    desfecho: () => ({ vivo, codigo, sinal }),
    matar(s: NodeJS.Signals = 'SIGKILL') {
      /**
       * No Windows não existe sinal de verdade: `kill` termina o processo, e
       * `SIGKILL` é o mais próximo de "arrancar da tomada" que a plataforma
       * oferece. É o que a missão de recuperação precisa — encerramento limpo
       * provaria a ordem de desligamento, não a resiliência.
       */
      if (vivo) filho.kill(s);
    },
    async encerrar() {
      if (!vivo) return;
      filho.kill('SIGTERM');
      const limite = Date.now() + 5000;
      while (vivo && Date.now() < limite) await new Promise((r) => setTimeout(r, 100));
      if (vivo) filho.kill('SIGKILL');
      /* Espera curta para o `exit` chegar antes de o sandbox sumir debaixo dele. */
      const limite2 = Date.now() + 3000;
      while (vivo && Date.now() < limite2) await new Promise((r) => setTimeout(r, 100));
      removerSandbox(sandbox);
    },
  };

  if (!(await esperarSaude(opcoes.porta, opcoes.prazo_subida_ms ?? 90_000))) {
    const ultimas = saida.slice(-25).join('\n');
    await motor.encerrar();
    throw new Error(
      `motor não respondeu /saude na porta ${opcoes.porta}. Últimas linhas:\n${ultimas}`,
    );
  }
  return motor;
}
