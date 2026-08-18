/**
 * QUAIS CÉREBROS A IARA TEM, DE VERDADE — provedor por provedor.
 *
 * O INCIDENTE (16/08/2026). Com a cota da Anthropic esgotada, a operadora
 * perguntou pelo celular: "mas você tem outras api do gemini e do grok". A IARA
 * repetiu, palavra por palavra, a mesma frase sobre o crédito da Anthropic.
 *
 * A leitura fácil era "a cadeia de fallback não funciona". Não era isso: a
 * `CadeiaDeRaciocinio` existe, troca de elo por cota, e quando TODOS falham
 * sobe o erro do ÚLTIMO. Receber a mensagem da Anthropic como palavra final
 * prova que a Anthropic era o único elo daquele motor — as chaves de Groq e
 * Gemini não estavam no ambiente da nuvem, embora estivessem na máquina de
 * desenvolvimento.
 *
 * O DEFEITO REAL, então, não era o roteamento. Era a IARA não ter como saber —
 * nem contar a ninguém — quantos cérebros ela de fato possuía. `estadoRaciocinio`
 * devolvia o PRIMEIRO provedor e parava; o `/saude` imprimia "chave da nuvem
 * válida" e ficava por isso mesmo. Um motor com quatro provedores e um motor com
 * um só produziam exatamente a mesma linha de diagnóstico. Ninguém tinha como
 * descobrir a diferença sem abrir o painel de variáveis do host.
 *
 * AS DUAS FONTES, e a razão de o painel dizer sempre QUAL delas falou:
 *
 *   SONDA — uma chamada barata que lista modelos. Responde conectividade, chave
 *   e modelo. NÃO responde cota: a conta zerada continua listando modelos, porque
 *   listar não gasta crédito. Prometer saldo a partir daqui seria inventar.
 *
 *   USO REAL — o que a `CadeiaDeRaciocinio` observou ao tentar raciocinar. É a
 *   única coisa que enxerga cota, e enxerga porque pagou para ver.
 *
 * Um provedor com chave válida e cota esgotada aparece como `quota_esgotada`
 * porque o uso real disse isso, não porque alguma sonda adivinhou. Um provedor
 * configurado que ninguém tentou aparece como `nao_sondado` — que é precisamente
 * o que se sabe dele.
 */

import {
  MODELO_NUVEM_PADRAO,
  configUtilizavel,
  lerConfig,
  redigir,
  type Ambiente,
} from './kernel/Configuracao';
import { GEMINI, GROQ, type PerfilProvedorAberto } from './ClienteCompativelOpenAI';
import { MOTIVO_DA_CLASSE, type FalhaObservada } from './CadeiaDeRaciocinio';

/**
 * Prazo curto, e os quatro provedores sondados em paralelo: a habilidade de
 * diagnóstico tem teto de 8 s, e ela ainda precisa ler dispositivos, catálogo e
 * jornal. Painel lento é painel que ninguém abre.
 */
const PRAZO_SONDA_MS = 3000;

/**
 * Toda linha que sai daqui passa por `redigir`, e não é excesso de zelo: a
 * mensagem de erro de um cliente HTTP inclui a URL da requisição mais vezes do
 * que se imagina, e há provedor que aceita chave em query string. O detalhe
 * deste painel vai para a tela do operador e para o log.
 */
const umaLinha = (bruto: string): string => redigir(bruto).replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * O estado de UM cérebro.
 *
 * `nao_sondado` é o estado mais importante da lista, pela mesma razão que
 * `desconhecido` é o mais importante em `Verdade.ts`: ele cobre "está
 * configurado e eu ainda não confirmei nada". Sem ele, configuração vira
 * disponibilidade por omissão — que é exatamente a mentira que este arquivo
 * existe para impedir.
 */
export type EstadoProvedor =
  | 'nao_configurado'
  | 'nao_sondado'
  | 'disponivel'
  | 'autenticacao_invalida'
  | 'quota_esgotada'
  | 'rate_limit'
  | 'servico_fora';

export interface FichaProvedor {
  readonly apelido: string;
  /** A variável de ambiente que liga este provedor. É o que a pessoa vai procurar. */
  readonly variavel: string;
  /** Há configuração utilizável no ambiente? NÃO significa que funciona. */
  readonly configurado: boolean;
  readonly modelo: string | null;
  readonly estado: EstadoProvedor;
  /** Uma linha em português dizendo o que se sabe E de onde isso veio. */
  readonly detalhe: string;
}

// ---------------------------------------------------------------------------
// A sonda — barata, e explícita sobre o que não alcança
// ---------------------------------------------------------------------------

type VereditoSonda =
  | { tipo: 'ok'; modelo: string | null }
  | { tipo: 'autenticacao'; detalhe: string }
  | { tipo: 'rate_limit'; detalhe: string }
  | { tipo: 'servico_fora'; detalhe: string };

/**
 * Uma requisição GET que lista modelos. É o endpoint mais barato que ainda prova
 * as duas coisas que interessam: a rede alcança o provedor, e a chave é aceita.
 *
 * Nunca lança — devolve veredito. Um painel de diagnóstico que quebra por causa
 * do serviço que ele foi escrito para diagnosticar não serve para nada.
 */
async function sondarHttp(url: string, cabecalhos: Record<string, string>): Promise<VereditoSonda> {
  const relogio = AbortSignal.timeout(PRAZO_SONDA_MS);
  try {
    const resposta = await fetch(url, { headers: cabecalhos, signal: relogio });
    if (resposta.status === 401 || resposta.status === 403) {
      return { tipo: 'autenticacao', detalhe: `o provedor recusou a chave (HTTP ${resposta.status})` };
    }
    if (resposta.status === 429) {
      return { tipo: 'rate_limit', detalhe: 'o provedor respondeu 429 (limite de taxa)' };
    }
    if (!resposta.ok) {
      return { tipo: 'servico_fora', detalhe: `o provedor respondeu HTTP ${resposta.status}` };
    }
    return { tipo: 'ok', modelo: null };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    return {
      tipo: 'servico_fora',
      detalhe: relogio.aborted ? `não respondeu em ${PRAZO_SONDA_MS} ms` : umaLinha(motivo),
    };
  }
}

async function sondarAnthropic(chave: string): Promise<VereditoSonda> {
  return sondarHttp('https://api.anthropic.com/v1/models?limit=1', {
    'x-api-key': chave,
    'anthropic-version': '2023-06-01',
  });
}

async function sondarAberto(perfil: PerfilProvedorAberto, chave: string): Promise<VereditoSonda> {
  return sondarHttp(`${perfil.base.replace(/\/$/, '')}/models`, {
    Authorization: `Bearer ${chave}`,
  });
}

async function sondarOllama(url: string): Promise<VereditoSonda> {
  return sondarHttp(`${url.replace(/\/$/, '')}/api/tags`, {});
}

// ---------------------------------------------------------------------------
// A ficha de cada provedor
// ---------------------------------------------------------------------------

/**
 * O uso real MANDA sobre a sonda, e a ordem não é arbitrária.
 *
 * A sonda alcança conectividade e chave; o uso real alcança cota, que a sonda
 * não vê de jeito nenhum. Quando os dois falam, o que foi medido pagando é o que
 * vale — a mesma regra de precedência que `Verdade.maisForte` aplica entre
 * `fato_verificado` e `resultado_ferramenta`.
 */
interface Veredito {
  estado: EstadoProvedor;
  detalhe: string;
}

/**
 * O QUE O USO REAL DIZ, quando diz alguma coisa. `null` quando não há observação
 * aproveitável — e aí quem fala é a sonda, ou o silêncio honesto.
 *
 * Vale MESMO SEM SONDA, e este foi um defeito de verdade, pego pelo próprio
 * teste: a primeira versão só consultava o observado dentro do caminho sondado.
 * Com `sondar: false` — que é o modo do healthcheck do host — um provedor de cota
 * comprovadamente esgotada voltava como `nao_sondado`, ou seja, como candidato
 * utilizável. O painel barato ficava mais otimista que o caro, que é a direção
 * errada de todas.
 */
function doObservado(falha: FalhaObservada | undefined): Veredito | null {
  if (!falha || falha.classe === 'outra' || falha.classe === 'cancelado') return null;
  const mapa: Partial<Record<FalhaObservada['classe'], EstadoProvedor>> = {
    quota: 'quota_esgotada',
    autenticacao: 'autenticacao_invalida',
    rate_limit: 'rate_limit',
    servico_fora: 'servico_fora',
  };
  const estado = mapa[falha.classe];
  if (!estado) return null;
  return {
    estado,
    detalhe: `${MOTIVO_DA_CLASSE[falha.classe]} — observado em uso real às ${falha.instante.slice(11, 16)}`,
  };
}

function combinar(sonda: VereditoSonda, falha: FalhaObservada | undefined): Veredito {
  const observado = doObservado(falha);
  if (observado) return observado;

  if (sonda.tipo === 'ok') {
    return {
      estado: 'disponivel',
      /* A ressalva sobre a cota é permanente e não é excesso de zelo: é o que
         impede o painel verde de ser lido como "tem saldo". */
      detalhe: 'a sonda alcançou o provedor e a chave foi aceita (saldo não é sondável)',
    };
  }
  if (sonda.tipo === 'autenticacao') return { estado: 'autenticacao_invalida', detalhe: sonda.detalhe };
  if (sonda.tipo === 'rate_limit') return { estado: 'rate_limit', detalhe: sonda.detalhe };
  return { estado: 'servico_fora', detalhe: sonda.detalhe };
}

function naoConfigurado(apelido: string, variavel: string): FichaProvedor {
  return {
    apelido,
    variavel,
    configurado: false,
    modelo: null,
    estado: 'nao_configurado',
    detalhe: `${variavel} não está no ambiente deste motor`,
  };
}

/**
 * O retrato de TODOS os cérebros, em ordem de preferência da cadeia.
 *
 * `observado` vem da `CadeiaDeRaciocinio` viva quando existe uma. Sem ela (motor
 * com provedor único, teste), o painel mostra só o que a sonda alcança — e diz
 * isso, em vez de fingir que o silêncio é boa notícia.
 *
 * `sondar: false` devolve as fichas sem tocar a rede: é o que o healthcheck do
 * host usa, porque um `/saude` que faz quatro chamadas externas vira um deploy
 * marcado como doente na primeira lentidão de rede alheia.
 */
export async function fichasDeProvedores(opcoes: {
  ambiente?: Ambiente;
  observado?: ReadonlyMap<string, FalhaObservada>;
  sondar?: boolean;
} = {}): Promise<FichaProvedor[]> {
  const ambiente = opcoes.ambiente ?? process.env;
  const observado = opcoes.observado ?? new Map<string, FalhaObservada>();
  const comSonda = opcoes.sondar !== false;

  const tarefas: Array<Promise<FichaProvedor>> = [];

  // --- Anthropic ----------------------------------------------------------
  tarefas.push(
    (async (): Promise<FichaProvedor> => {
      if (!configUtilizavel('ANTHROPIC_API_KEY', ambiente)) {
        return naoConfigurado('anthropic', 'ANTHROPIC_API_KEY');
      }
      const modelo = lerConfig('IARA_MODELO', ambiente) ?? MODELO_NUVEM_PADRAO;
      const base = { apelido: 'anthropic', variavel: 'ANTHROPIC_API_KEY', configurado: true, modelo };
      const visto = doObservado(observado.get('anthropic'));
      if (visto) return { ...base, ...visto };
      if (!comSonda) {
        return { ...base, estado: 'nao_sondado', detalhe: 'chave presente; não sondada nesta consulta' };
      }
      const sonda = await sondarAnthropic(lerConfig('ANTHROPIC_API_KEY', ambiente) ?? '');
      return { ...base, ...combinar(sonda, observado.get('anthropic')) };
    })(),
  );

  // --- Groq e Gemini (compatíveis com OpenAI) -----------------------------
  for (const perfil of [GROQ, GEMINI]) {
    tarefas.push(
      (async (): Promise<FichaProvedor> => {
        if (!configUtilizavel(perfil.variavelChave, ambiente)) {
          return naoConfigurado(perfil.apelido, perfil.variavelChave);
        }
        const modelo = lerConfig(perfil.variavelModelo, ambiente) ?? perfil.modeloPadrao;
        const base = {
          apelido: perfil.apelido,
          variavel: perfil.variavelChave,
          configurado: true,
          modelo,
        };
        const visto = doObservado(observado.get(perfil.apelido));
        if (visto) return { ...base, ...visto };
        if (!comSonda) {
          return { ...base, estado: 'nao_sondado', detalhe: 'chave presente; não sondada nesta consulta' };
        }
        const sonda = await sondarAberto(perfil, lerConfig(perfil.variavelChave, ambiente) ?? '');
        return { ...base, ...combinar(sonda, observado.get(perfil.apelido)) };
      })(),
    );
  }

  // --- Ollama -------------------------------------------------------------
  tarefas.push(
    (async (): Promise<FichaProvedor> => {
      if (!configUtilizavel('OLLAMA_URL', ambiente)) {
        return naoConfigurado('ollama', 'OLLAMA_URL');
      }
      const url = lerConfig('OLLAMA_URL', ambiente) ?? 'http://127.0.0.1:11434';
      const base = {
        apelido: 'ollama',
        variavel: 'OLLAMA_URL',
        configurado: true,
        modelo: lerConfig('OLLAMA_MODELO', ambiente) ?? null,
      };
      const visto = doObservado(observado.get('ollama'));
      if (visto) return { ...base, ...visto };
      if (!comSonda) {
        return { ...base, estado: 'nao_sondado', detalhe: `declarado em ${url}; não sondado nesta consulta` };
      }
      const sonda = await sondarOllama(url);
      const combinado = combinar(sonda, observado.get('ollama'));
      return {
        ...base,
        ...combinado,
        detalhe:
          combinado.estado === 'disponivel'
            ? `respondendo em ${url}`
            : `${combinado.detalhe} (${url})`,
      };
    })(),
  );

  return Promise.all(tarefas);
}

// ---------------------------------------------------------------------------
// A leitura em uma linha
// ---------------------------------------------------------------------------

export const ROTULO_DO_ESTADO: Record<EstadoProvedor, string> = {
  nao_configurado: 'NÃO CONFIGURADO',
  nao_sondado: 'NÃO SONDADO',
  disponivel: 'DISPONÍVEL',
  autenticacao_invalida: 'CHAVE RECUSADA',
  quota_esgotada: 'COTA ESGOTADA',
  rate_limit: 'LIMITE DE TAXA',
  servico_fora: 'FORA DO AR',
};

/** Um provedor que pode ser tentado agora. `nao_sondado` conta: não confirmar
 *  não é o mesmo que estar quebrado, e a cadeia tentaria de qualquer forma. */
export function utilizavel(f: FichaProvedor): boolean {
  return f.estado === 'disponivel' || f.estado === 'nao_sondado';
}

/**
 * A frase que a IARA diz quando perguntam do que ela é capaz.
 *
 * Existe porque a resposta que a operadora recebeu era uma frase FIXA sobre a
 * Anthropic. Esta é montada do estado real e nomeia cada cérebro — inclusive
 * para dizer que não há nenhum, quando não há.
 */
export function resumirProvedores(fichas: readonly FichaProvedor[], emUso: string | null): string {
  const configuradas = fichas.filter((f) => f.configurado);
  if (configuradas.length === 0) {
    return (
      'Não tenho nenhum provedor de raciocínio configurado neste motor — ' +
      'nem ANTHROPIC_API_KEY, nem GROQ_API_KEY, nem GEMINI_API_KEY, nem OLLAMA_URL. ' +
      'Respondo só pelo caminho local: clima, hora, infraestrutura, histórico e busca.'
    );
  }

  const linhas = configuradas.map(
    (f) =>
      `${f.apelido}: ${ROTULO_DO_ESTADO[f.estado].toLowerCase()}` +
      (f.modelo ? ` (${f.modelo})` : '') +
      ` — ${f.detalhe}`,
  );

  const prontos = configuradas.filter(utilizavel);
  const fecho =
    prontos.length === 0
      ? 'Nenhum deles está utilizável agora, então não tenho raciocínio livre neste momento.'
      : emUso
        ? `Estou raciocinando com ${emUso}.`
        : `Posso usar ${prontos.map((f) => f.apelido).join(', ')}.`;

  return `${linhas.join('\n')}\n\n${fecho}`;
}
