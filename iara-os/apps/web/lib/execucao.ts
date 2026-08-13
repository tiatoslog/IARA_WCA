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
  | 'informacoes_sistema'
  /**
   * Separada de `informacoes_sistema`, e a separação é de contrato, não de
   * conveniência: aquela responde "como está o computador" com uma leitura
   * instantânea de `node:os`; esta AMOSTRA a máquina ao longo de uma janela
   * (CPU e processos são taxas, não valores) e custa segundos por isso. Fundir
   * as duas faria toda pergunta sobre memória pagar a sonda de processos.
   */
  | 'medir_desempenho';

export const ACOES_DESKTOP: readonly AcaoDesktop[] = [
  'abrir_aplicativo',
  'fechar_aplicativo',
  'criar_pasta',
  'listar_arquivos',
  'capturar_tela',
  'informacoes_sistema',
  'medir_desempenho',
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

/**
 * O vocabulário FECHADO de estados, para a fronteira poder recusar o que não
 * existe. `ehTerminal` responde outra pergunta — "acabou?" — e usá-lo como
 * validador deixava passar `enfileirada` tanto quanto `sucesso!!`.
 */
export const ESTADOS_CONHECIDOS: readonly string[] = [
  'recebida',
  'validando',
  'enfileirada',
  'enviada_ao_dispositivo',
  'recebida_pelo_dispositivo',
  'executando',
  'sucesso',
  'falhou',
  'expirou',
  'cancelada',
  'dispositivo_ausente',
  'duplicada',
];

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
export const CODIGOS_ERRO: readonly CodigoErro[] = [
  'DESKTOP_OFFLINE',
  'APP_NAO_ENCONTRADO',
  'ARQUIVO_NAO_ENCONTRADO',
  'PERMISSAO_NEGADA',
  'PARAMETRO_INVALIDO',
  'FERRAMENTA_INDISPONIVEL',
  'EXPIROU',
  'ERRO_DE_REDE',
  'FALHA_NA_EXECUCAO',
];

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
  /**
   * O que a execução MEDIU, em estrutura — para quando o motor precisa raciocinar
   * sobre o resultado e não apenas repeti-lo ao operador.
   *
   * OPCIONAL, e a opcionalidade é o desenho. Um braço de versão anterior não
   * conhece este campo e continua respondendo só `texto`; quem depende dos dados
   * precisa tratar a ausência como LACUNA declarada, nunca como zero. É a mesma
   * regra de `null` em `SondasDesempenho`, atravessando a rede.
   *
   * NÃO é um canal de propósito geral para payload cru. Quem o preenche declara
   * o formato do lado do motor e o valida na chegada — o braço é outro processo,
   * possivelmente de outra versão, e nada que vem dele entra tipado por confiança.
   */
  readonly dados?: Readonly<Record<string, unknown>>;
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
 * A MARCA DESTE PROCESSO, e ela existe por causa de um defeito real.
 *
 * A primeira versão deste id era `IARA-<dia>-<contador>` e vinha acompanhada de
 * um comentário confiante: "não é chave global — dois motores geram a mesma
 * sequência —, e não precisa ser". Precisava.
 *
 * O QUE ACONTECEU, na primeira bateria de testes com braço real: o motor
 * reiniciou (recarga do `tsx watch`), o contador voltou para 1, e o braço — que
 * guarda os relatos por cinco minutos para poder responder a uma reentrega sem
 * executar duas vezes — encontrou `IARA-20260813-000002` no próprio cache. Só
 * que o `000002` DELE era um "abra o bloco de notas" de minutos antes, e a
 * ordem nova era "quanto de memória está sendo usada". Ele reenviou o relato
 * antigo. A IARA respondeu, com todas as letras, "Pronto. Abri o Bloco de Notas
 * no computador." para uma pergunta sobre memória — nada foi executado, e o
 * relato de sucesso era de outra ação.
 *
 * É a falha mais grave possível neste sistema, e ela não veio de um efeito
 * errado: veio de uma IDENTIDADE que se repetia. A proteção contra duplicidade,
 * construída para impedir mentira, passou a produzi-la.
 *
 * A marca é gerada uma vez por processo. Dois motores, ou o mesmo motor depois
 * de reiniciar, nunca mais compartilham prefixo — e um cache do outro lado da
 * rede não tem como confundir execuções de vidas diferentes.
 */
const MARCA_DO_PROCESSO = Math.floor(Math.random() * 0xffff)
  .toString(16)
  .padStart(4, '0');

/**
 * `IARA-20260813-a3f9-000123`.
 *
 * Data local porque quem lê um log procura por dia; marca do processo porque a
 * unicidade precisa sobreviver a um restart; contador porque dentro de um
 * processo o que se quer é ordem.
 *
 * Continua sendo um id de TRANSPORTE — ele responde "onde esta execução parou".
 * A identidade global de um EFEITO é do jornal (`RegistroOperacoes`), que a
 * resolve com impressão digital e nonce, e essa divisão não mudou.
 */
export function novaExecucaoId(agora = new Date()): string {
  const d = (n: number) => String(n).padStart(2, '0');
  const dia = `${agora.getFullYear()}${d(agora.getMonth() + 1)}${d(agora.getDate())}`;
  contador = (contador + 1) % 1_000_000;
  return `IARA-${dia}-${MARCA_DO_PROCESSO}-${String(contador).padStart(6, '0')}`;
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
 * Teto do texto que o braço devolve.
 *
 * NÃO é higiene de log: `RelatoExecucao.texto` sobe para a resposta do operador
 * e, por contrato, é insumo do próximo passo — ou seja, pode acabar no prompt.
 * Sem teto, um braço comprometido (ou apenas de uma versão com defeito) entrega
 * megabytes que atravessam o motor inteiro, engordam o snapshot e são cobrados
 * em tokens. `lerPacoteCliente` sempre limitou o que vem do navegador em 8000
 * caracteres; esta fronteira estava sem o equivalente, e ela é a que executa
 * coisas.
 */
const MAX_TEXTO_RELATO = 8_000;
const MAX_EVIDENCIA = 2_000;

const MOTIVOS_PROVA: readonly string[] = ['nao_encontrado', 'divergente', 'sem_meio_de_verificar'];
const ONDES: readonly string[] = ['motor', 'dispositivo', 'nenhum'];

/**
 * O relato do braço, campo a campo — nunca `as RelatoExecucao` sobre o que veio
 * do socket.
 *
 * A versão anterior conferia quatro campos (`execucao_id`, `texto`,
 * `estado` como string qualquer, `prova.confirmado`) e repassava o OBJETO
 * INTEIRO com uma asserção de tipo. Tudo o mais — `estado` fora do vocabulário,
 * `evidencia` que não é texto, `codigo_erro` inventado, `onde` arbitrário,
 * `texto` de qualquer tamanho — entrava tipado por confiança num processo que
 * mora no computador de outra pessoa e pode ser de outra versão.
 *
 * Devolve `null` para qualquer desvio: um relato que não se deixa ler é um
 * relato que não aconteceu, e o prazo do Braço já sabe tratar silêncio.
 */
function lerRelato(bruto: unknown): RelatoExecucao | null {
  if (!objeto(bruto)) return null;
  if (!texto(bruto.execucao_id, 80)) return null;
  if (typeof bruto.texto !== 'string' || bruto.texto.length > MAX_TEXTO_RELATO) return null;
  if (typeof bruto.estado !== 'string' || !ESTADOS_CONHECIDOS.includes(bruto.estado)) return null;

  const p = bruto.prova;
  if (!objeto(p) || typeof p.confirmado !== 'boolean') return null;
  if (typeof p.evidencia !== 'string' || p.evidencia.length > MAX_EVIDENCIA) return null;
  if (p.motivo !== undefined && !MOTIVOS_PROVA.includes(p.motivo as string)) return null;

  if (bruto.codigo_erro !== null && bruto.codigo_erro !== undefined) {
    if (typeof bruto.codigo_erro !== 'string') return null;
    if (!(CODIGOS_ERRO as readonly string[]).includes(bruto.codigo_erro)) return null;
  }
  if (bruto.dispositivo !== null && bruto.dispositivo !== undefined && !texto(bruto.dispositivo, 80)) {
    return null;
  }
  if (bruto.onde !== undefined && !ONDES.includes(bruto.onde as string)) return null;
  if (bruto.dados !== undefined && !objeto(bruto.dados)) return null;

  return {
    execucao_id: bruto.execucao_id,
    estado: bruto.estado as EstadoExecucao,
    texto: bruto.texto,
    prova: {
      confirmado: p.confirmado,
      evidencia: p.evidencia,
      ...(p.motivo !== undefined ? { motivo: p.motivo as ProvaExecucao['motivo'] } : {}),
    },
    codigo_erro: (bruto.codigo_erro as CodigoErro | null) ?? null,
    duracao_ms:
      typeof bruto.duracao_ms === 'number' && Number.isFinite(bruto.duracao_ms) ? bruto.duracao_ms : 0,
    dispositivo: (bruto.dispositivo as string | null) ?? null,
    onde: (bruto.onde as RelatoExecucao['onde']) ?? 'dispositivo',
    ...(bruto.dados ? { dados: bruto.dados as Readonly<Record<string, unknown>> } : {}),
  };
}

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
      const relato = lerRelato(v.relato);
      return relato ? { tipo: 'concluida', relato } : null;
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
