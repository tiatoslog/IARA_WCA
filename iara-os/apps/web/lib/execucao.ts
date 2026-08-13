/**
 * O CONTRATO DE EXECUÇÃO REMOTA — a única coisa que atravessa a ponte entre o
 * motor e as mãos.
 *
 * POR QUE ISTO EXISTE. Até aqui, o `AgenteLocal` era chamado dentro do próprio
 * processo do motor, e a arquitetura assumia — sem nunca dizer — que "a máquina
 * do operador" e "a máquina onde o motor roda" eram a mesma coisa. Enquanto o
 * motor subia no computador de cada pessoa isso era verdade. Desde que o motor
 * mudou para a nuvem (ver `apps/desktop/src-tauri/src/main.rs`, que já anunciava
 * esta fase), deixou de ser: um pedido vindo do celular chegava ao contêiner
 * Linux e tentava abrir o Bloco de Notas LÁ.
 *
 * A ponte não é "mais uma camada". Ela é o reconhecimento de um fato que já era
 * verdade e estava calado: entre a intenção e o efeito existe uma REDE, e rede
 * falha de maneiras que chamada de função não tem como falhar — o outro lado
 * pode não estar lá, pode receber e morrer, pode executar e não conseguir
 * contar. Cada um desses casos tem um nome nesta lista de estados, e nenhum
 * deles é `sucesso`.
 *
 * INVARIANTE CENTRAL: `sucesso` NUNCA é inferido do envio. Ele só existe quando
 * o lado que tem as mãos devolveu prova. É a mesma regra que o resto do sistema
 * já aplica à quinta porta (`Habilidade.verificar`), estendida à distância.
 *
 * Este arquivo mora em `lib/` porque é contrato compartilhado: o motor, o braço
 * e a projeção leem a mesma definição. Nenhum dos três importa código do outro.
 */

// ---------------------------------------------------------------------------
// O que pode ser pedido a um par de mãos
// ---------------------------------------------------------------------------

/**
 * O catálogo FECHADO de ações que atravessam a ponte.
 *
 * Não existe `executar_comando`, e a ausência é a decisão mais importante deste
 * arquivo. Um campo de comando livre transformaria a ponte em shell remoto, e
 * a allowlist do `AgenteLocal` — que é revisada em commit — viraria decoração.
 * A LLM emite uma destas etiquetas ou não emite nada.
 */
export type AcaoDesktop =
  | 'abrir_aplicativo'
  | 'fechar_aplicativo'
  | 'criar_pasta'
  | 'listar_arquivos'
  | 'capturar_tela'
  | 'informacoes_sistema';

export const ACOES_DESKTOP: readonly AcaoDesktop[] = [
  'abrir_aplicativo',
  'fechar_aplicativo',
  'criar_pasta',
  'listar_arquivos',
  'capturar_tela',
  'informacoes_sistema',
];

export function ehAcaoDesktop(v: unknown): v is AcaoDesktop {
  return typeof v === 'string' && (ACOES_DESKTOP as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * A vida de uma execução, do pedido ao desfecho.
 *
 * Os estados intermediários não são enfeite de log: cada um responde a uma
 * pergunta diferente quando algo dá errado. `enviada_ao_dispositivo` sem
 * `recebida_pelo_dispositivo` é rede; `recebida_pelo_dispositivo` sem
 * `executando` é o braço travado; `executando` sem desfecho é a ação em si.
 * Sem essa granularidade, "não funcionou" é indistinguível de "não funcionou",
 * e é assim que se perde uma tarde procurando no lugar errado.
 */
export type EstadoExecucao =
  /** O motor recebeu o pedido e ele ainda não foi olhado. */
  | 'recebida'
  /** Conferindo ação, parâmetros e permissão — antes de qualquer envio. */
  | 'validando'
  /** Válida, esperando vez (há outra execução do mesmo operador em curso). */
  | 'enfileirada'
  /** Escrita no socket do dispositivo. NÃO significa que ele leu. */
  | 'enviada_ao_dispositivo'
  /** O braço confirmou que a ordem chegou. Ainda não começou. */
  | 'recebida_pelo_dispositivo'
  /** O braço começou. A partir daqui, repetir o pedido pode duplicar efeito. */
  | 'executando'
  /** Terminou E há prova. O único estado que autoriza a IARA a dizer "pronto". */
  | 'sucesso'
  /** Terminou e não deu certo. `codigo_erro` diz por quê. */
  | 'falhou'
  /** O prazo venceu sem desfecho. O efeito pode ter acontecido — ver abaixo. */
  | 'expirou'
  /** Alguém desistiu antes de o efeito começar. */
  | 'cancelada'
  /** Não havia mãos: nenhum braço conectado para este operador. */
  | 'dispositivo_ausente'
  /** Chegou de novo o que já foi executado. O relato devolvido é o do original. */
  | 'duplicada';

export const ESTADOS_TERMINAIS: readonly EstadoExecucao[] = [
  'sucesso',
  'falhou',
  'expirou',
  'cancelada',
  'dispositivo_ausente',
  'duplicada',
];

export function ehTerminal(e: EstadoExecucao): boolean {
  return ESTADOS_TERMINAIS.includes(e);
}

/**
 * `expirou` é o estado mais honesto e o mais desconfortável da lista.
 *
 * Ele NÃO quer dizer "não aconteceu". Quer dizer "não sei". O braço pode ter
 * aberto o Chrome e perdido a conexão antes de contar. Por isso a frase que a
 * IARA diz para `expirou` nunca é "não consegui" — é "não recebi confirmação",
 * que é a diferença entre relatar um fato e relatar a própria ignorância.
 */
export const ESTADOS_INCERTOS: readonly EstadoExecucao[] = ['expirou'];

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/**
 * O vocabulário fechado de falhas. Fechado porque a resposta ao operador é
 * escolhida a partir dele: um código novo sem frase correspondente produziria
 * ou silêncio, ou o texto técnico cru na cara de quem não pediu isso.
 */
export type CodigoErro =
  | 'DESKTOP_OFFLINE'
  | 'APP_NAO_ENCONTRADO'
  | 'ARQUIVO_NAO_ENCONTRADO'
  | 'PERMISSAO_NEGADA'
  | 'PARAMETRO_INVALIDO'
  | 'FERRAMENTA_INDISPONIVEL'
  | 'EXPIROU'
  | 'ERRO_DE_REDE'
  | 'FALHA_NA_EXECUCAO';

/**
 * Vale a pena tentar de novo?
 *
 * Só o que é transitório. `APP_NAO_ENCONTRADO` não fica menos ausente na
 * segunda tentativa, e repetir um pedido que falhou por permissão é como o
 * sistema aprende a ignorar a própria política.
 *
 * `EXPIROU` fica de FORA de propósito, e é a decisão mais delicada aqui: a ação
 * pode ter acontecido do outro lado. Repetir automaticamente uma execução de
 * desfecho desconhecido é exatamente como se abre o Chrome duas vezes — ou pior,
 * como se envia a mesma mensagem duas vezes. Quem decide repetir é o operador,
 * com a informação na frente.
 */
export const RETENTAVEL: Record<CodigoErro, boolean> = {
  DESKTOP_OFFLINE: true,
  ERRO_DE_REDE: true,
  APP_NAO_ENCONTRADO: false,
  ARQUIVO_NAO_ENCONTRADO: false,
  PERMISSAO_NEGADA: false,
  PARAMETRO_INVALIDO: false,
  FERRAMENTA_INDISPONIVEL: false,
  EXPIROU: false,
  FALHA_NA_EXECUCAO: false,
};

// ---------------------------------------------------------------------------
// Prova
// ---------------------------------------------------------------------------

/**
 * O que o lado das mãos APUROU depois de agir — conferindo o mundo, não o
 * próprio relato.
 *
 * Mesma forma de `Habilidade.Verificacao`, e é intencional: a prova nasce no
 * dispositivo e é entregue à quinta porta sem tradução. Traduzir seria a
 * oportunidade de perder a ressalva no caminho.
 *
 * `confirmado: false` não é sinônimo de falha. `motivo` separa "conferi e não
 * está lá" de "não tenho como conferir" — e a IARA fala diferente nos dois
 * casos, porque são coisas diferentes.
 */
export interface ProvaExecucao {
  readonly confirmado: boolean;
  readonly evidencia: string;
  readonly motivo?: 'nao_encontrado' | 'divergente' | 'sem_meio_de_verificar';
}

// ---------------------------------------------------------------------------
// Ordem e relato
// ---------------------------------------------------------------------------

export interface OrdemExecucao {
  /** Ver `novaExecucaoId`. Acompanha o pedido do começo ao fim da cadeia. */
  readonly execucao_id: string;
  readonly acao: AcaoDesktop;
  readonly parametros: Record<string, unknown>;
  readonly id_usuario: string;
  /** O diálogo de origem. O braço o devolve; nada dele é interpretado lá. */
  readonly sessao: string;
  /** Teto de vida desta ordem, contado do envio. */
  readonly prazo_ms: number;
  readonly emitida_em: number;
}

export interface RelatoExecucao {
  readonly execucao_id: string;
  readonly estado: EstadoExecucao;
  /** O que a IARA tem para dizer ao operador. Nunca stack trace. */
  readonly texto: string;
  readonly prova: ProvaExecucao;
  readonly codigo_erro: CodigoErro | null;
  readonly duracao_ms: number;
  /** Qual dispositivo executou. `null` quando ninguém executou. */
  readonly dispositivo: string | null;
  /** Onde a ação de fato correu. `nenhum` quando ela não chegou a correr. */
  readonly onde: 'motor' | 'dispositivo' | 'nenhum';
}

export interface DescricaoDispositivo {
  readonly id_dispositivo: string;
  readonly nome: string;
  readonly plataforma: string;
  readonly versao: string;
  readonly conectado_em: number;
  readonly visto_em: number;
}

// ---------------------------------------------------------------------------
// Identidade da execução
// ---------------------------------------------------------------------------

let contador = 0;

/**
 * `IARA-20260813-000123`.
 *
 * Data local no nome porque quem lê um log procura por dia; contador do
 * processo porque dentro de um dia o que se quer é ordem. Não é chave global —
 * dois motores geram a mesma sequência —, e não precisa ser: a identidade
 * global de um EFEITO é do jornal (`RegistroOperacoes`), que já resolve isso
 * com impressão digital e nonce. Este id é de TRANSPORTE: ele existe para
 * responder "onde esta execução parou", e essa pergunta é sempre feita dentro
 * de um processo.
 */
export function novaExecucaoId(agora = new Date()): string {
  const d = (n: number) => String(n).padStart(2, '0');
  const dia = `${agora.getFullYear()}${d(agora.getMonth() + 1)}${d(agora.getDate())}`;
  contador = (contador + 1) % 1_000_000;
  return `IARA-${dia}-${String(contador).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Pacotes da ponte
// ---------------------------------------------------------------------------

/** Braço → motor. */
export type PacoteBraco =
  | {
      tipo: 'apresentacao';
      id_usuario: string;
      token?: string;
      nome: string;
      plataforma: string;
      versao: string;
    }
  | { tipo: 'recebida'; execucao_id: string }
  | { tipo: 'executando'; execucao_id: string }
  | { tipo: 'concluida'; relato: RelatoExecucao };

/** Motor → braço. */
export type PacoteMotor =
  | { tipo: 'bem_vindo'; id_dispositivo: string }
  | { tipo: 'recusado'; motivo: string }
  | { tipo: 'executar'; ordem: OrdemExecucao };

const objeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const texto = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Validação estrutural na fronteira, nos DOIS sentidos.
 *
 * O braço valida o que vem do motor pela mesma razão que o motor valida o que
 * vem do braço: nenhum dos dois pode assumir que o outro é a versão que ele
 * espera. Um braço antigo conversando com um motor novo é o caso normal de um
 * produto instalado em máquina de gente, não a exceção.
 */
export function lerPacoteBraco(bruto: string): PacoteBraco | null {
  let v: unknown;
  try {
    v = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!objeto(v)) return null;

  switch (v.tipo) {
    case 'apresentacao':
      if (!texto(v.id_usuario, 120) || !texto(v.nome, 120)) return null;
      if (!texto(v.plataforma, 60) || !texto(v.versao, 60)) return null;
      if (v.token !== undefined && typeof v.token !== 'string') return null;
      return {
        tipo: 'apresentacao',
        id_usuario: v.id_usuario,
        nome: v.nome,
        plataforma: v.plataforma,
        versao: v.versao,
        ...(typeof v.token === 'string' ? { token: v.token } : {}),
      };
    case 'recebida':
    case 'executando':
      return texto(v.execucao_id, 80) ? { tipo: v.tipo, execucao_id: v.execucao_id } : null;
    case 'concluida': {
      const r = v.relato;
      if (!objeto(r) || !texto(r.execucao_id, 80) || typeof r.texto !== 'string') return null;
      if (typeof r.estado !== 'string') return null;
      if (!objeto(r.prova) || typeof r.prova.confirmado !== 'boolean') return null;
      return { tipo: 'concluida', relato: r as unknown as RelatoExecucao };
    }
    default:
      return null;
  }
}

export function lerPacoteMotor(bruto: string): PacoteMotor | null {
  let v: unknown;
  try {
    v = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!objeto(v)) return null;

  switch (v.tipo) {
    case 'bem_vindo':
      return texto(v.id_dispositivo, 80) ? { tipo: 'bem_vindo', id_dispositivo: v.id_dispositivo } : null;
    case 'recusado':
      return typeof v.motivo === 'string' ? { tipo: 'recusado', motivo: v.motivo } : null;
    case 'executar': {
      const o = v.ordem;
      if (!objeto(o) || !texto(o.execucao_id, 80) || !ehAcaoDesktop(o.acao)) return null;
      if (!objeto(o.parametros)) return null;
      if (!texto(o.id_usuario, 120) || !texto(o.sessao, 200)) return null;
      if (typeof o.prazo_ms !== 'number' || !Number.isFinite(o.prazo_ms)) return null;
      return {
        tipo: 'executar',
        ordem: {
          execucao_id: o.execucao_id,
          acao: o.acao,
          parametros: o.parametros,
          id_usuario: o.id_usuario,
          sessao: o.sessao,
          prazo_ms: o.prazo_ms,
          emitida_em: typeof o.emitida_em === 'number' ? o.emitida_em : Date.now(),
        },
      };
    }
    default:
      return null;
  }
}
