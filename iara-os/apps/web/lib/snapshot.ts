/**
 * SnapshotCognitivo — o ÚNICO objeto que atravessa a fronteira do kernel.
 *
 * Nenhum módulo interno é exposto. Nem `EstadoAtomico`, nem `MemoriaTrabalho`,
 * nem o barramento, nem referência a coisa nenhuma. O que sai daqui é dado
 * puro, imutável e serializável.
 *
 * O snapshot é deliberadamente AGNÓSTICO DE RENDERIZADOR. Os mesmos campos
 * alimentam o escritório em pixel art de hoje e um avatar fotorrealista
 * amanhã: `visemas` viram boca, `olhar` vira direção da cabeça, `capacidades`
 * viram halo na sala ou luz no ambiente 3D. O kernel não sabe qual dos dois
 * está do outro lado, e não deve saber.
 */

import type {
  CapacidadeAtiva,
  EstagioCognitivo,
  LeituraOperador,
  MapaLuzes,
  MetricasVitais,
  OrigemRaciocinio,
  PerfilOperador,
} from './estado';

// ---------------------------------------------------------------------------
// Espaço cognitivo
// ---------------------------------------------------------------------------

/**
 * Cognitive Workspace: quanto de cada faculdade está em uso AGORA (0..1).
 *
 * Substitui a `capacidade` única. Um turno real acende mais de uma coisa ao
 * mesmo tempo — buscar no histórico usa conhecimento E memória — e um campo
 * só obrigava a mentir escolhendo uma.
 */
export type EspacoCognitivo = Record<CapacidadeAtiva, number>;

export const ESPACO_VAZIO: EspacoCognitivo = {
  automacao: 0,
  conhecimento: 0,
  raciocinio: 0,
  percepcao: 0,
  memoria: 0,
};

// ---------------------------------------------------------------------------
// Plano projetado
// ---------------------------------------------------------------------------

export interface PassoProjetado {
  readonly indice: number;
  readonly descricao: string;
  readonly estado: 'pendente' | 'executando' | 'concluido' | 'falhou';
}

export interface PlanoProjetado {
  readonly objetivo: string;
  readonly origem: 'deterministico' | 'emergente';
  readonly passos: readonly PassoProjetado[];
  readonly passo_atual: number;
}

// ---------------------------------------------------------------------------
// Expressão — para a camada de apresentação, qualquer que seja
// ---------------------------------------------------------------------------

/**
 * Visema corrente. Derivado do texto que está sendo falado, não de áudio:
 * enquanto não houver síntese de voz, é uma aproximação honesta que já move
 * a boca em sincronia com o streaming.
 */
export interface Visema {
  readonly id: string;
  readonly peso: number;
}

export interface Expressao {
  /** Para onde a IARA olha. -1..1 em cada eixo, 0 = para o operador. */
  readonly olhar: { readonly x: number; readonly y: number };
  /** Inclinação da cabeça, em graus. Pequena por decisão de direção de arte. */
  readonly cabeca: { readonly inclinacao: number; readonly giro: number };
  readonly visemas: readonly Visema[];
  /** Estado emocional projetado — consequência do estado interno, não enfeite. */
  readonly emocao: 'neutra' | 'atenta' | 'concentrada' | 'solicita' | 'preocupada';
  /** 0..1. Modula amplitude de qualquer animação reativa. */
  readonly intensidade: number;
}

export const EXPRESSAO_NEUTRA: Expressao = {
  olhar: { x: 0, y: 0 },
  cabeca: { inclinacao: 0, giro: 0 },
  visemas: [],
  emocao: 'neutra',
  intensidade: 0.2,
};

// ---------------------------------------------------------------------------
// Cadeia cognitiva — o último turno, elo a elo
// ---------------------------------------------------------------------------

/**
 * INTENÇÃO → CAPACIDADE → PLANO → EXECUÇÃO → VERIFICAÇÃO → RESPOSTA, projetada
 * dos eventos que o barramento JÁ publica (FASE A, 14/08/2026). Nenhum campo
 * aqui nasce de cálculo da UI: cada elo é a cópia direta de um evento do
 * turno — `PERCEPCAO_CONCLUIDA`, `DECISAO_TOMADA`, `PLANO_CRIADO`,
 * `PASSO_CONCLUIDO`, `HABILIDADE_VERIFICADA`, `TAREFA_CONCLUIDA`. Elo ausente
 * é elo que o turno não teve (turno de conversa não tem plano), nunca elo
 * inventado.
 */
export interface PassoCadeia {
  readonly indice: number;
  /** `raciocinio` quando o passo foi da LLM, senão o id da habilidade. */
  readonly habilidade: string;
  readonly descricao: string;
  /** Uma linha do que aconteceu — o `resumo` de `PASSO_CONCLUIDO`. */
  readonly resumo: string;
  readonly ms: number;
}

export interface VerificacaoCadeia {
  readonly habilidade: string;
  readonly confirmado: boolean;
  readonly evidencia: string;
}

export interface CadeiaCognitiva {
  /** O que a percepção entendeu: tipo da entrada, objetivo provável, confiança. */
  readonly intencao: {
    readonly tipo: string;
    readonly objetivo: string;
    readonly confianca: number;
  } | null;
  /** A decisão executiva — a porta de capacidade: qual rota e por quê. */
  readonly decisao: {
    readonly rota: string;
    readonly justificativa: string;
    readonly custo: 'zero' | 'tokens';
  } | null;
  readonly plano: {
    readonly objetivo: string;
    readonly origem: 'deterministico' | 'emergente';
    readonly total_passos: number;
  } | null;
  readonly execucao: readonly PassoCadeia[];
  readonly verificacao: readonly VerificacaoCadeia[];
  /** Preenchido quando `TAREFA_CONCLUIDA` fecha o turno. */
  readonly resposta: { readonly rota: string; readonly latencia_ms: number } | null;
}

// ---------------------------------------------------------------------------
// Telemetria
// ---------------------------------------------------------------------------

export interface TelemetriaSnapshot {
  readonly rota: string | null;
  readonly custo: 'zero' | 'tokens' | null;
  readonly latencia_ms: number | null;
  readonly tokens_entrada: number;
  readonly tokens_saida: number;
  readonly cache_lido: number;
  readonly eventos_no_traco: number;
  readonly descartados: number;
}

export const TELEMETRIA_ZERO: TelemetriaSnapshot = {
  rota: null,
  custo: null,
  latencia_ms: null,
  tokens_entrada: 0,
  tokens_saida: 0,
  cache_lido: 0,
  eventos_no_traco: 0,
  descartados: 0,
};

// ---------------------------------------------------------------------------
// O contrato
// ---------------------------------------------------------------------------

/**
 * A fala corrente. Vive DENTRO do snapshot de propósito: um canal separado de
 * streaming seria um segundo caminho falando com a tela, e aí o contrato
 * "só existe o snapshot" vira ficção. O texto vai acumulado a cada emissão —
 * o cliente substitui, nunca concatena, e por isso pacote perdido não
 * corrompe a resposta.
 */
export interface FalaProjetada {
  readonly id: string;
  readonly texto: string;
  readonly concluida: boolean;
  /**
   * O ID DA PERGUNTA QUE ESTA FALA RESPONDE — o mesmo `op:` de
   * `PerguntaProjetada.id`.
   *
   * Existe porque uma sessão tem UM kernel e até quatro telas, e o snapshot vai
   * para todas. Sem este campo, cada espelho encostava a fala corrente no fim da
   * própria lista, e a tela que tinha perdido a corrida exibia a confirmação do
   * pedido alheio como se fosse a resposta do seu (CC-01, 16/08/2026 — ver
   * `docs/prd/test-plan-cross-talk-espelhos.md`).
   *
   * `null` quando a fala não responde a ninguém: recado espontâneo, insight
   * noturno, aviso do ciclo autônomo. Ausente em servidor antigo — o cliente
   * degrada para o comportamento de antes, que é acrescentar no fim.
   */
  readonly responde_a?: string | null;
  readonly destino: string | null;
  readonly latencia_ms: number | null;
  readonly cache_lido: number;
  /**
   * Caminho do áudio desta fala, servido pelo próprio processo, ou `null`
   * enquanto não houver voz.
   *
   * É um CAMINHO, não os bytes: enfiar áudio dentro do snapshot inflaria cada
   * pacote do barramento em centenas de kilobytes, e o snapshot é aglutinado —
   * seria o mesmo áudio retransmitido a cada atualização de estado.
   *
   * Só aparece depois que a síntese termina, então chega um instante após o
   * texto. É o comportamento honesto: o texto existe antes da voz existir.
   */
  readonly voz: string | null;

  /**
   * `true` quando o servidor VAI produzir áudio para esta fala (Convai
   * configurada). É o que permite ao cliente esperar o áudio de qualidade em
   * vez de disparar a síntese local — sem isto, as duas vozes saem uma em
   * cima da outra, porque o áudio chega sempre um instante depois do texto.
   */
  readonly voz_prevista?: boolean;
}

/**
 * A PERGUNTA CORRENTE DO OPERADOR — o outro lado de `FalaProjetada`.
 *
 * Ela existe por causa de um defeito relatado em 16/08/2026: uma mensagem
 * mandada do celular não aparecia no computador. A causa não estava na rede.
 * O snapshot projetava a fala da IARA para todos os espelhos, mas a frase do
 * OPERADOR nunca saía do aparelho que a digitou — `useIaraSocket.enviar`
 * acrescentava a bolha na lista local e mandava só o texto pelo socket.
 *
 * O resultado era uma tela que via a resposta sem a pergunta: no computador a
 * IARA respondia sozinha, sobre um assunto que ninguém ali tinha levantado. Pior
 * que feio — enganoso, porque um espelho que perde metade do diálogo mostra um
 * diálogo que não aconteceu.
 *
 * Vive DENTRO do snapshot pela mesma razão que `fala`: um segundo canal para a
 * tela transformaria "só existe o snapshot" em ficção. É a pergunta corrente, não
 * o histórico — quem quiser transcrição passada lê a `MemoriaOperacional`, que é
 * onde ela mora e é durável.
 */
export interface PerguntaProjetada {
  /**
   * Ecoa o `id_local` que o cliente mandou, prefixado por `op:`. É o que permite
   * ao aparelho que digitou reconhecer a PRÓPRIA bolha em vez de duplicá-la, sem
   * comparar texto — comparação de texto erraria em duas mensagens iguais
   * seguidas, que é exatamente o caso de quem reenvia por achar que não chegou.
   */
  readonly id: string;
  readonly texto: string;
}

export interface SnapshotCognitivo {
  readonly sessao: string;
  readonly seq: number;
  readonly instante: number;
  /** Traço do turno corrente. Amarra o snapshot à trilha de auditoria. */
  readonly traco: string;

  readonly operador: PerfilOperador | null;
  readonly estagio: EstagioCognitivo;
  readonly objetivo: string | null;
  readonly plano: PlanoProjetado | null;

  readonly capacidades: EspacoCognitivo;
  readonly metricas: MetricasVitais;
  readonly leitura: LeituraOperador;
  readonly expressao: Expressao;
  readonly telemetria: TelemetriaSnapshot;

  /** Projeção espacial derivada de `capacidades`. A sala em pixel art usa isto. */
  readonly luzes: MapaLuzes;
  readonly nuvem_indisponivel: boolean;
  readonly origem_raciocinio: OrigemRaciocinio;

  /** `null` quando a IARA não está falando nem acabou de falar. */
  readonly fala: FalaProjetada | null;

  /**
   * A última frase do operador nesta sessão, para os espelhos que não a
   * digitaram. `null` antes do primeiro turno — e ausente em servidor antigo,
   * onde o cliente simplesmente continua mostrando só a própria bolha local.
   */
  readonly pergunta?: PerguntaProjetada | null;

  /**
   * OS PEDIDOS QUE ESPERAM A VEZ, em ordem de chegada.
   *
   * Uma sessão tem um kernel e até quatro telas, e desde a serialização de
   * turnos (CC-01, 16/08/2026) o pedido de uma tela pode ficar esperando o da
   * outra. Sem este campo, a pessoa via a própria bolha, via a IARA
   * trabalhando, e não tinha como saber se o trabalho em curso era o pedido
   * dela ou o da outra tela — e "parar" virava uma ação oferecida sem dizer se
   * ainda valia.
   *
   * Cada espelho encontra a SI MESMO comparando estes ids com os `op:` das
   * bolhas que ele criou. É o mesmo truque de `PerguntaProjetada.id`, e pela
   * mesma razão: o snapshot é um só para todas as telas, então quem se
   * identifica é quem lê.
   *
   * Vazio quando ninguém espera. Ausente em servidor antigo — o cliente
   * degrada para não mostrar nada, que é o comportamento de antes.
   */
  readonly fila?: readonly PerguntaProjetada[];

  /**
   * A cadeia cognitiva do turno corrente (ou do último concluído). `null`
   * antes do primeiro turno da sessão — o painel mostra "nenhum turno ainda"
   * em vez de uma cadeia vazia com cara de turno que não aconteceu.
   */
  readonly cadeia: CadeiaCognitiva | null;

  /**
   * `true` na ÚNICA tela eleita para reproduzir voz. A sessão aceita até
   * quatro espelhos do mesmo operador (app + abas), e sem eleição cada um
   * reproduz o próprio áudio — a IARA sai repetida e embolada. O servidor
   * elege o espelho mais antigo; quando ele fecha, o próximo herda a voz.
   * Ausente (servidor antigo) vale `true`: tela única fala normalmente.
   */
  readonly voz_lider?: boolean;
}
