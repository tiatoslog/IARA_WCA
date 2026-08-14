/**
 * A FRONTEIRA ENTRE O AMBIENTE E O SISTEMA.
 *
 * Nasceu de um incidente concreto, e o incidente vale mais que qualquer
 * explicação abstrata do que este módulo faz:
 *
 *   Alguém colou DUAS linhas de configuração no campo de valor de UMA variável
 *   no painel do host. `ANTHROPIC_API_KEY` passou a valer, literalmente:
 *
 *       sk-ant-…AA\nCRON_SECRET=…
 *
 *   O SDK da Anthropic põe esse valor no cabeçalho `x-api-key`. `Headers.append`
 *   recusa qualquer valor com CR ou LF — e a exceção subiu com a chave INTEIRA
 *   dentro da mensagem, atravessou o kernel e foi falada para a operadora no
 *   celular dela. Um erro de configuração virou divulgação de credencial.
 *
 * Três defeitos, e nenhum deles é o `Headers.append`:
 *
 *  1. `process.env.X?.trim()` era toda a validação que existia no repositório —
 *     em sessenta e poucos lugares. `.trim()` remove as pontas; a contaminação
 *     estava no MEIO. O código parecia validado e não era.
 *
 *  2. "A nuvem está disponível?" era respondido por `Boolean(chave?.trim())` —
 *     que testa PRESENÇA, não VALIDADE. O sistema se declarava saudável, dizia
 *     à operadora que o raciocínio profundo estava ligado, e só descobria a
 *     verdade uma requisição por vez, para sempre.
 *
 *  3. A mensagem da exceção ia crua para a fala da IARA. Ver `redigir`.
 *
 * A regra que este módulo impõe, e que é a única capaz de matar a CLASSE:
 *
 *     UMA VARIÁVEL DE AMBIENTE CARREGA EXATAMENTE UMA CONFIGURAÇÃO.
 *
 * Contaminação é DETECTADA e RECUSADA, nunca limpa. Limpar transformaria uma
 * configuração errada numa configuração aparentemente certa — que é como o
 * mesmo incidente volta em silêncio daqui a três meses.
 *
 * NORMALIZAR NÃO É SANITIZAR, e a distinção é a única concessão aqui: espaço
 * em branco NAS PONTAS é artefato de colagem de um valor só, e é removido. Um
 * caractere de controle NO INTERIOR, depois disso, não tem explicação inocente:
 * significa que duas coisas viraram uma. Esse é recusado.
 */

// ---------------------------------------------------------------------------
// 1. O registro — o que o sistema sabe que existe
// ---------------------------------------------------------------------------

/**
 * A natureza decide o rigor. Não é decoração: `segredo_cabecalho` é a única
 * que exige latin-1, porque é a única cujo valor vira byte de cabeçalho HTTP e
 * portanto a única que o `Headers` do runtime pode recusar.
 */
export type NaturezaConfig =
  | 'segredo_cabecalho'
  | 'segredo'
  | 'url'
  | 'texto'
  | 'numero'
  | 'lista'
  | 'sinalizador';

export interface DefinicaoConfig {
  readonly natureza: NaturezaConfig;
  /** Prefixo exigido quando o formato é público e estável. */
  readonly prefixo?: string;
  /** Piso de comprimento. Só onde ele significa alguma coisa. */
  readonly minimo?: number;
  /** Uma linha, para a mensagem de recusa. Nunca contém valor. */
  readonly papel: string;
}

/**
 * TUDO que o motor lê do ambiente. Uma variável fora desta lista não é
 * proibida — `inspecionar` a trata como `texto` —, mas fica fora da redação
 * automática, e é por isso que todo segredo PRECISA estar aqui.
 */
export const REGISTRO: Readonly<Record<string, DefinicaoConfig>> = {
  // — a nuvem que raciocina
  ANTHROPIC_API_KEY: {
    natureza: 'segredo_cabecalho',
    prefixo: 'sk-ant-',
    minimo: 40,
    papel: 'chave da camada de raciocínio profundo',
  },
  IARA_MODELO: { natureza: 'texto', papel: 'modelo da nuvem' },
  IARA_ESFORCO: { natureza: 'texto', papel: 'esforço de raciocínio' },

  // — o banco
  SUPABASE_URL: { natureza: 'url', papel: 'endereço do Supabase' },
  SUPABASE_SERVICE_ROLE_KEY: {
    natureza: 'segredo_cabecalho',
    minimo: 40,
    papel: 'chave service_role do Supabase',
  },
  NEXT_PUBLIC_SUPABASE_URL: { natureza: 'url', papel: 'endereço do Supabase no cliente' },
  NEXT_PUBLIC_SUPABASE_ANON_KEY: {
    natureza: 'segredo_cabecalho',
    minimo: 40,
    papel: 'chave anônima do Supabase',
  },

  // — a voz
  CONVAI_API_KEY: { natureza: 'segredo_cabecalho', papel: 'chave da voz neural' },
  CONVAI_VOZ: { natureza: 'texto', papel: 'voz escolhida' },
  CONVAI_ENCODING: { natureza: 'texto', papel: 'formato do áudio' },
  IARA_VOZ_EDGE: { natureza: 'texto', papel: 'voz do Edge TTS' },
  IARA_VOZ_NEURAL: { natureza: 'sinalizador', papel: 'liga a voz neural' },

  // — Microsoft Graph (e-mail e SharePoint)
  MS_GRAPH_TOKEN: {
    natureza: 'segredo_cabecalho',
    papel: 'access token da Microsoft Graph (caixa de entrada e busca no SharePoint)',
  },
  // As três a seguir são opcionais: só existem para a renovação AUTOMÁTICA do
  // MS_GRAPH_TOKEN (client credentials flow). Ver `ClienteGraph.ts`.
  MS_GRAPH_CLIENT_ID: {
    natureza: 'texto',
    papel: 'client ID do app no Azure AD (renovação automática do MS_GRAPH_TOKEN)',
  },
  MS_GRAPH_TENANT_ID: {
    natureza: 'texto',
    papel: 'tenant ID do Azure AD (renovação automática do MS_GRAPH_TOKEN)',
  },
  MS_GRAPH_CLIENT_SECRET: {
    natureza: 'segredo',
    papel: 'client secret do app no Azure AD (renovação automática do MS_GRAPH_TOKEN)',
  },
  // A Search API exige isto em token de aplicativo. Padrão 'BRA' (confirmado
  // contra o tenant da Atos Log); um tenant de outra geografia só precisa
  // declarar o valor que a própria Graph disser ser válido.
  MS_GRAPH_REGIAO: { natureza: 'texto', papel: 'região exigida pela Search API em token de aplicativo' },

  // — o canal WhatsApp
  WHATSAPP_TOKEN: { natureza: 'segredo_cabecalho', papel: 'token da Graph API' },
  WHATSAPP_PHONE_ID: { natureza: 'texto', papel: 'id do número' },
  WHATSAPP_APP_SECRET: { natureza: 'segredo', papel: 'segredo de assinatura do webhook' },
  WHATSAPP_VERIFY_TOKEN: { natureza: 'segredo', papel: 'token de verificação do webhook' },

  // — o jornal e as travas
  IARA_CHAVE_PROVA: { natureza: 'segredo', minimo: 32, papel: 'selo do jornal de operações' },
  CRON_SECRET: { natureza: 'segredo', papel: 'segredo das rotinas agendadas' },
  IARA_TOKEN: { natureza: 'segredo', papel: 'token de pareamento do braço' },
  IARA_CREDENCIAL_BRACO: { natureza: 'texto', papel: 'caminho da credencial do braço' },

  // — operação
  IARA_ORIGENS: { natureza: 'lista', papel: 'origens autorizadas no barramento' },
  IARA_PORTA: { natureza: 'numero', papel: 'porta local' },
  IARA_MODO: { natureza: 'texto', papel: 'unificado ou headless' },
  IARA_AMBIENTE: { natureza: 'texto', papel: 'produção ou homologação' },
  IARA_AUTONOMIA: { natureza: 'texto', papel: 'teto de autonomia' },
  IARA_ADMINS: { natureza: 'lista', papel: 'operadores administradores' },
  IARA_CIDADE: { natureza: 'texto', papel: 'cidade padrão' },
  IARA_LATITUDE: { natureza: 'texto', papel: 'latitude padrão' },
  IARA_LONGITUDE: { natureza: 'texto', papel: 'longitude padrão' },
  NEXT_PUBLIC_IARA_WS: { natureza: 'url', papel: 'endereço do barramento no cliente' },
  NEXT_PUBLIC_IARA_MOTOR: { natureza: 'url', papel: 'endereço do motor no cliente' },
};

/** Os nomes conhecidos, para detectar um deles embutido no valor de outro. */
const NOMES = Object.keys(REGISTRO);

const ehSegredo = (n: NaturezaConfig): boolean =>
  n === 'segredo' || n === 'segredo_cabecalho';

// ---------------------------------------------------------------------------
/**
 * O ambiente como ESTE módulo o enxerga: um mapa de texto, e nada mais.
 *
 * `NodeJS.ProcessEnv` exigiria `NODE_ENV` em todo chamador — inclusive num
 * teste que só quer provar uma variável isolada. Um validador de configuração
 * que obriga o teste a montar um ambiente inteiro é um validador que não vai
 * ser testado nos casos difíceis.
 */
export type Ambiente = Readonly<Record<string, string | undefined>>;

// 2. A inspeção
// ---------------------------------------------------------------------------

export interface ProblemaConfig {
  readonly variavel: string;
  /**
   * A explicação. INVARIANTE DESTE MÓDULO: nunca contém o valor, nem pedaço
   * dele. Quem lê um problema de configuração está quase sempre olhando um log
   * — e um log é o lugar onde um segredo fica guardado mais tempo que em
   * qualquer outro.
   */
  readonly motivo: string;
  readonly gravidade: 'contaminada' | 'malformada';
}

/**
 * Espaço nas pontas some; o resto é analisado como veio. Ver o cabeçalho.
 *
 * `\ufeff` entra junto porque BOM não é `\s`: um `.env` salvo como UTF-8 com
 * assinatura põe um caractere invisível na frente do PRIMEIRO valor do arquivo,
 * e sem isto a primeira variável de todo `.env` do Windows seria recusada.
 */
const normalizar = (bruto: string): string => bruto.replace(/^[\s\ufeff]+|[\s\ufeff]+$/g, '');

/**
 * O coração. Devolve `null` quando o valor é aceitável, ou o problema.
 *
 * A ordem das checagens importa: contaminação vem antes de formato, porque um
 * valor com duas configurações dentro pode até ter o prefixo certo — foi
 * exatamente o caso do incidente, onde a chave começava com `sk-ant-` e mesmo
 * assim estava irremediavelmente errada.
 */
export function inspecionar(variavel: string, bruto: string | undefined): ProblemaConfig | null {
  if (bruto === undefined) return null; // ausência é assunto de quem consome
  const valor = normalizar(bruto);
  if (valor === '') return null; // vazio é ausente, e cada consumidor decide

  const def = REGISTRO[variavel];
  const natureza = def?.natureza ?? 'texto';

  // (a) CONTAMINAÇÃO Nº 1 — caractere de controle no interior.
  const controle = /[\u0000-\u001f\u007f]/.exec(valor);
  if (controle) {
    const cod = controle[0].charCodeAt(0).toString(16).padStart(2, '0');
    return {
      variavel,
      gravidade: 'contaminada',
      motivo:
        `contém o caractere de controle 0x${cod} na posição ${controle.index} de ${valor.length}. ` +
        'Depois de remover o espaço das pontas, um caractere de controle no meio do valor ' +
        'significa que mais de uma configuração foi colada neste campo.',
    };
  }

  // (b) CONTAMINAÇÃO Nº 2 — o nome de OUTRA variável conhecida, com `=`.
  // Esta é a assinatura exata do incidente e não tem falso positivo plausível:
  // nenhum valor legítimo carrega `OUTRA_COISA=` dentro de si.
  for (const outro of NOMES) {
    if (outro === variavel) continue;
    if (valor.includes(`${outro}=`)) {
      return {
        variavel,
        gravidade: 'contaminada',
        motivo:
          `carrega a atribuição de ${outro} dentro do próprio valor. ` +
          'Uma variável de ambiente representa exatamente uma configuração; ' +
          `separe ${variavel} e ${outro} em duas variáveis.`,
      };
    }
  }

  // (c) CONTAMINAÇÃO Nº 3 — atribuição desconhecida dentro de um segredo.
  // Restrita a segredos de propósito: uma lista de URLs pode legitimamente
  // trazer um `?X=`, e um segredo nunca traz.
  if (ehSegredo(natureza)) {
    const atribuicao = /(^|[\s;,])([A-Z][A-Z0-9_]{3,})=/.exec(valor);
    if (atribuicao) {
      return {
        variavel,
        gravidade: 'contaminada',
        motivo:
          `carrega a atribuição de ${atribuicao[2]} dentro do próprio valor. ` +
          'Um segredo é um valor opaco, nunca um bloco de configuração.',
      };
    }
  }

  // (d) O QUE O `Headers` RECUSA. Só para quem vira cabeçalho: o construtor de
  // Headers do runtime rejeita qualquer byte fora de latin-1, e o erro que ele
  // produz é o que trouxe este módulo à existência.
  if (natureza === 'segredo_cabecalho') {
    for (let i = 0; i < valor.length; i++) {
      if (valor.charCodeAt(i) > 0xff) {
        return {
          variavel,
          gravidade: 'contaminada',
          motivo:
            `tem um caractere fora de latin-1 na posição ${i}. Este valor vira cabeçalho ` +
            'HTTP, e o runtime recusa a requisição inteira antes de ela sair.',
        };
      }
    }
  }

  // (e) FORMATO. Daqui para baixo o valor é ÍNTEGRO — só pode estar errado.
  if (def?.prefixo && !valor.startsWith(def.prefixo)) {
    return {
      variavel,
      gravidade: 'malformada',
      motivo: `não começa com "${def.prefixo}" — provavelmente é outra credencial neste campo.`,
    };
  }
  if (def?.minimo !== undefined && valor.length < def.minimo) {
    return {
      variavel,
      gravidade: 'malformada',
      motivo: `tem ${valor.length} caracteres; o mínimo é ${def.minimo}.`,
    };
  }
  if (natureza === 'numero' && !/^\d+$/.test(valor)) {
    return { variavel, gravidade: 'malformada', motivo: 'deveria ser um número inteiro.' };
  }
  if (natureza === 'url' && !/^https?:\/\/|^wss?:\/\//.test(valor)) {
    return { variavel, gravidade: 'malformada', motivo: 'deveria ser uma URL com esquema.' };
  }

  return null;
}

/**
 * Varre o ambiente inteiro. É o que a subida chama.
 *
 * Varre o REGISTRO e não `process.env`: uma variável que o motor não lê não é
 * problema dele, e recusar subir por causa de uma variável de outro programa
 * na mesma máquina seria um modo novo de derrubar produção.
 */
export function conferirAmbiente(
  ambiente: Ambiente = process.env,
): ProblemaConfig[] {
  const problemas: ProblemaConfig[] = [];
  for (const nome of NOMES) {
    const p = inspecionar(nome, ambiente[nome]);
    if (p) problemas.push(p);
  }
  return problemas;
}

// ---------------------------------------------------------------------------
// 3. A leitura
// ---------------------------------------------------------------------------

export class ConfiguracaoInvalida extends Error {
  constructor(readonly problema: ProblemaConfig) {
    super(`${problema.variavel} ${problema.motivo}`);
    this.name = 'ConfiguracaoInvalida';
  }
}

/**
 * A ÚNICA porta de leitura para valor sensível.
 *
 * Devolve `null` quando ausente — que é um estado legítimo em toda parte deste
 * sistema: sem `ANTHROPIC_API_KEY` a IARA roda local e diz isso na interface.
 * LEVANTA quando presente e contaminado, porque aí não existe comportamento
 * degradado honesto: seguir seria escolher entre falhar a cada requisição ou
 * fingir que a credencial não foi configurada.
 */
export function lerConfig(
  variavel: string,
  ambiente: Ambiente = process.env,
): string | null {
  const bruto = ambiente[variavel];
  if (bruto === undefined) return null;
  const problema = inspecionar(variavel, bruto);
  if (problema) throw new ConfiguracaoInvalida(problema);
  const valor = normalizar(bruto);
  return valor === '' ? null : valor;
}

/**
 * "Está configurado E utilizável?" — a pergunta que `Boolean(env.X?.trim())`
 * fingia responder. Um valor contaminado responde `false` aqui, e é por isso
 * que este módulo existe: presença nunca mais volta a valer como validade.
 */
export function configUtilizavel(
  variavel: string,
  ambiente: Ambiente = process.env,
): boolean {
  try {
    return lerConfig(variavel, ambiente) !== null;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 4. A redação
// ---------------------------------------------------------------------------

/** `sk-ant-…`, JWT, `xox…`, `ghp_…`. Rede de segurança, não a defesa principal. */
const FORMATOS_DE_SEGREDO: ReadonlyArray<RegExp> = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[abprs]-[A-Za-z0-9-]{10,}/g,
];

/**
 * Tira segredo de texto que vai para OLHO HUMANO — fala da IARA, log, console
 * técnico, resposta de erro.
 *
 * Duas camadas, e a ordem importa. Primeiro os valores REAIS que este processo
 * carrega: é a única camada exata, e pega inclusive uma credencial de formato
 * que ninguém previu. Depois os formatos conhecidos, que pegam o segredo de
 * terceiro que apareceu num payload e que este processo nunca teve.
 *
 * Não substitui o `Configuracao` recusar subir. É a segunda porta: mesmo que
 * um valor sensível chegue a uma exceção por um caminho que ninguém mapeou,
 * ele não chega ao celular de ninguém.
 */
export function redigir(texto: string, ambiente: Ambiente = process.env): string {
  let saida = texto;

  for (const nome of NOMES) {
    if (!ehSegredo(REGISTRO[nome].natureza)) continue;
    const bruto = ambiente[nome];
    if (!bruto) continue;
    // O bruto E o normalizado: no caso contaminado os dois circulam, e é
    // justamente o caso contaminado que produz as exceções mais barulhentas.
    for (const forma of new Set([bruto, normalizar(bruto)])) {
      // Piso de 8: um segredo curto demais para ser único transformaria a
      // redação num localizador de substring aleatória no meio do texto.
      if (forma.length < 8) continue;
      saida = saida.split(forma).join(`[REDIGIDO:${nome}]`);
    }
  }

  for (const formato of FORMATOS_DE_SEGREDO) {
    saida = saida.replace(formato, '[REDIGIDO]');
  }

  return saida;
}
