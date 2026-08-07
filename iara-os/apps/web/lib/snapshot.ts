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

  /** `null` quando a IARA não está falando nem acabou de falar. */
  readonly fala: FalaProjetada | null;
}
