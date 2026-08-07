/**
 * PROJECTION ENGINE — contrato de presença.
 *
 * O Kernel é a IARA. Tudo que desenha é periférico descartável: pixel art hoje,
 * cabeça fotorrealista amanhã, VisionOS depois. Este arquivo é a única fronteira
 * entre os dois lados, e ele tem uma regra:
 *
 *   A projeção DERIVA parâmetros de apresentação a partir de fatos recebidos.
 *   A projeção NUNCA inventa um fato.
 *
 * A diferença é fina e decide tudo. "A energia caiu para 0.4" é fato, e só o
 * `EstadoAtomico` no servidor pode produzi-lo. "Com energia 0.4 a pálpebra fecha
 * 12% a mais" é apresentação, e é trabalho daqui. Se um parâmetro abaixo não
 * conseguir apontar para o campo de `EstadoEscritorio` que o originou, ele não
 * deveria existir.
 *
 * Consequência prática: não há `Math.random()` neste arquivo, nem em nenhum
 * driver de projeção. Idle falso, piscada em loop e sorriso aleatório são
 * exatamente o que a matéria proíbe — o rosto passaria a afirmar coisas que o
 * sistema não sabe.
 */

import type {
  CapacidadeAtiva,
  EstadoEscritorio,
  EstagioCognitivo,
  EstadoOperador,
} from './estado';
import { trilhaDeVisemas, type Visema } from './visemas';

// ---------------------------------------------------------------------------
// Parâmetros de presença
// ---------------------------------------------------------------------------

/**
 * O que o rosto expressa. Cada valor é consequência de um estado do sistema,
 * nunca de humor decorativo — ver `emocaoDe`.
 */
export type Emocao =
  | 'neutra' // ócio, nada pendente
  | 'atenta' // mensagem chegou, triando
  | 'concentrada' // raciocínio ou consulta cara em andamento
  | 'cordial' // respondendo
  | 'contida' // sem nuvem, ou energia no fim: ela sabe que está limitada
  | 'preocupada'; // leitura do operador acusa atrito

/**
 * Direção do olhar em coordenadas normalizadas de cabeça.
 * x: -1 esquerda / +1 direita. y: -1 baixo / +1 cima.
 * `foco` é quanto ela encara a câmera — 1 = direto no operador.
 */
export interface Olhar {
  x: number;
  y: number;
  foco: number;
}

/** Pose da cabeça em unidades normalizadas. `aceno` é um pulso, não um ciclo. */
export interface Cabeca {
  giro: number;
  inclinacao: number;
  /** Sobe para 1 quando um turno de fala começa e decai. Reconhecimento. */
  aceno: number;
}

/** Números que a interface tem direito de mostrar. Todos medidos, nenhum estimado. */
export interface Telemetria {
  conectado: boolean;
  latencia_ms: number | null;
  tokens_entrada: number | null;
  tokens_saida: number | null;
  cache_lido: number | null;
}

/**
 * O estado de fala já preparado para o loop de animação.
 *
 * `trilha` e `revelados` são o que permite a boca articular sem que o React
 * re-renderize: o `useFrame` amostra isso a 60 Hz por conta própria.
 */
export interface FalaProjetada {
  ativa: boolean;
  id: string | null;
  trilha: Visema[];
  /** Caracteres que o servidor entregou de fato. */
  revelados: number;
  /** `performance.now()` do primeiro delta desta fala. */
  iniciada_em: number | null;
}

/**
 * O pacote que um driver de projeção recebe. Um driver não conhece
 * `EstadoEscritorio`, não conhece WebSocket, não conhece Supabase e não conhece
 * Claude. Ele conhece isto, e só isto.
 */
export interface SnapshotCognitivo {
  seq: number;
  instante: number;

  estagio: EstagioCognitivo;
  capacidade: CapacidadeAtiva | null;
  /** Leitura do humano do outro lado. Muda como a IARA se apresenta, não o que ela faz. */
  estado_operador: EstadoOperador;

  energia: number;
  paciencia: number;
  afinidade: number;
  carga_contextual: number;

  emocao: Emocao;
  olhar: Olhar;
  cabeca: Cabeca;
  fala: FalaProjetada;
  telemetria: Telemetria;

  /**
   * Intensidade 0..1 por faculdade. Envelope de apresentação de um fato
   * booleano (`capacidade` está ativa agora), não uma medição nova.
   */
  capacidades: Record<CapacidadeAtiva, number>;

  nuvem_indisponivel: boolean;
}

/** Rótulos de tela. Vivem aqui para nenhum componente inventar tradução. */
export const ROTULO_CAPACIDADE: Record<CapacidadeAtiva, string> = {
  raciocinio: 'Raciocínio',
  conhecimento: 'Conhecimento',
  memoria: 'Memória',
  automacao: 'Automação',
  percepcao: 'Percepção',
};

export const ROTULO_ESTAGIO: Record<EstagioCognitivo, string> = {
  ocioso: 'em repouso',
  escutando: 'escutando',
  executando: 'executando',
  consultando: 'consultando memória',
  pensando: 'raciocinando',
  falando: 'respondendo',
};

// ---------------------------------------------------------------------------
// Derivação — cada função aponta para o fato que a origina
// ---------------------------------------------------------------------------

/**
 * Emoção por precedência, do mais grave para o mais trivial. A ordem importa:
 * limitação do sistema vence leitura do operador, que vence o estágio. Uma IARA
 * que parece cordial enquanto está sem nuvem estaria mentindo sobre si mesma.
 */
export function emocaoDe(estado: EstadoEscritorio): Emocao {
  if (estado.nuvem_indisponivel) return 'contida';
  if (estado.metricas.energia_cognitiva < 0.25) return 'contida';

  const { estado: humano, confianca } = estado.leitura;
  // Abaixo de 0.5 a classificação não é confiável o bastante para mudar o rosto.
  if (confianca >= 0.5 && (humano === 'frustrado' || humano === 'estressado')) {
    return 'preocupada';
  }

  switch (estado.estagio) {
    case 'escutando':
      return 'atenta';
    case 'pensando':
    case 'consultando':
    case 'executando':
      return 'concentrada';
    case 'falando':
      return 'cordial';
    case 'ocioso':
      return 'neutra';
  }
}

/**
 * Para onde ela olha.
 *
 * Desviar o olhar durante recuperação de memória não é maneirismo: é o sinal
 * que humanos leem como "ela foi buscar". Aqui o desvio está amarrado ao
 * estágio real, então ele aparece exatamente enquanto a busca acontece.
 */
export function olharDe(estagio: EstagioCognitivo): Olhar {
  switch (estagio) {
    case 'escutando':
      // Encara. É o único estágio em que ela não está fazendo mais nada.
      return { x: 0, y: 0, foco: 1 };
    case 'consultando':
      // Olho para cima e para o lado: recuperação.
      return { x: -0.45, y: 0.35, foco: 0.15 };
    case 'pensando':
      return { x: 0.28, y: 0.3, foco: 0.3 };
    case 'executando':
      // Para baixo: ela está operando alguma coisa, não conversando.
      return { x: 0.2, y: -0.4, foco: 0.2 };
    case 'falando':
      return { x: 0, y: 0.04, foco: 0.9 };
    case 'ocioso':
      return { x: 0, y: 0, foco: 0.65 };
  }
}

/** Pose da cabeça. A inclinação de escuta é o único gesto "social" permitido. */
export function cabecaDe(estagio: EstagioCognitivo, olhar: Olhar): Cabeca {
  return {
    // A cabeça acompanha o olhar em fração — olho lidera, cabeça segue.
    giro: olhar.x * 0.35,
    inclinacao: estagio === 'escutando' ? 0.18 : olhar.y * 0.2,
    aceno: 0,
  };
}

/**
 * Envelope das capacidades.
 *
 * O servidor manda uma capacidade ativa por vez. Cortar de 1 para 0 no instante
 * da troca produz pisca-pisca; por isso o valor anterior decai em vez de sumir.
 * O decaimento é apresentação — o fato ("estava ativa até agora") é verdadeiro
 * durante todo o rastro.
 */
export function capacidadesDe(
  ativa: CapacidadeAtiva | null,
  anterior: Record<CapacidadeAtiva, number>,
  decaimento = 0.86,
): Record<CapacidadeAtiva, number> {
  const proximo = {} as Record<CapacidadeAtiva, number>;
  for (const chave of Object.keys(ROTULO_CAPACIDADE) as CapacidadeAtiva[]) {
    proximo[chave] = chave === ativa ? 1 : Math.max(0, (anterior[chave] ?? 0) * decaimento);
  }
  return proximo;
}

export const CAPACIDADES_ZERADAS: Record<CapacidadeAtiva, number> = {
  raciocinio: 0,
  conhecimento: 0,
  memoria: 0,
  automacao: 0,
  percepcao: 0,
};

/** Entrada da derivação: o estado do escritório mais o que o socket sabe da fala. */
export interface ContextoProjecao {
  conectado: boolean;
  fala: {
    id: string;
    texto: string;
    concluida: boolean;
    iniciada_em: number;
    latencia_ms?: number;
    tokens_entrada?: number;
    tokens_saida?: number;
    cache_lido?: number;
  } | null;
  capacidades: Record<CapacidadeAtiva, number>;
}

/**
 * Fato -> apresentação. Pura: mesma entrada, mesma saída, sempre. É isso que
 * torna a presença da IARA reproduzível a partir de um traço gravado.
 */
export function derivarSnapshot(
  estado: EstadoEscritorio,
  contexto: ContextoProjecao,
): SnapshotCognitivo {
  const olhar = olharDe(estado.estagio);
  const fala = contexto.fala;

  return {
    seq: estado.seq,
    instante: estado.instante,

    estagio: estado.estagio,
    capacidade: estado.capacidade,
    estado_operador: estado.leitura.estado,

    energia: estado.metricas.energia_cognitiva,
    paciencia: estado.metricas.paciencia_operacional,
    afinidade: estado.metricas.afinidade,
    carga_contextual: estado.metricas.carga_contextual,

    emocao: emocaoDe(estado),
    olhar,
    cabeca: cabecaDe(estado.estagio, olhar),

    fala: {
      ativa: Boolean(fala && !fala.concluida),
      id: fala?.id ?? null,
      trilha: fala ? trilhaDeVisemas(fala.texto) : [],
      revelados: fala?.texto.length ?? 0,
      iniciada_em: fala?.iniciada_em ?? null,
    },

    telemetria: {
      conectado: contexto.conectado,
      latencia_ms: fala?.latencia_ms ?? null,
      tokens_entrada: fala?.tokens_entrada ?? null,
      tokens_saida: fala?.tokens_saida ?? null,
      cache_lido: fala?.cache_lido ?? null,
    },

    capacidades: contexto.capacidades,
    nuvem_indisponivel: estado.nuvem_indisponivel,
  };
}
