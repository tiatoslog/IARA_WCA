/**
 * FASE 1 — Domínio do IARA OS.
 *
 * Contrato único entre o motor cognitivo (servidor/) e a camada de projeção
 * (components/). Tudo aqui é imutável do ponto de vista do React: o servidor
 * é dono do estado, o cliente só desenha snapshots.
 *
 * Regra inegociável de direção de arte: todo campo abaixo nasce de um fato
 * observado no loop do agente. Nenhum campo existe para "dar vida" à tela —
 * animação ambiente é responsabilidade do CSS, não do estado.
 */

import type { PreferenciasOperador } from './perfil';

export type { PreferenciasOperador };

// ---------------------------------------------------------------------------
// Estágios e capacidades
// ---------------------------------------------------------------------------

/** Em que ponto do ciclo cognitivo a IARA está agora. */
export type EstagioCognitivo =
  | 'ocioso' // sala respirando, ninguém pediu nada
  | 'escutando' // mensagem chegou, roteador triando
  | 'executando' // ação local determinística rodando
  | 'consultando' // busca no RAG / banco vetorial local
  | 'pensando' // Claude na nuvem, raciocínio profundo
  | 'falando'; // streaming de resposta em andamento

/** Qual faculdade da IARA está acesa. Acende o objeto correspondente na sala. */
export type CapacidadeAtiva =
  | 'automacao' // terminal
  | 'conhecimento' // estante / arquivo
  | 'raciocinio' // rack do servidor
  | 'percepcao' // janela (clima, mundo externo)
  | 'memoria'; // gaveteiro

/** Para onde o roteador semântico mandou a mensagem. */
export type DestinoCognitivo =
  | 'sistema_local'
  | 'rag_historico'
  | 'claude_nuvem'
  | 'recusa_sigilo';

// ---------------------------------------------------------------------------
// Métricas vitais (o "corpo" da IARA)
// ---------------------------------------------------------------------------

/**
 * Floats 0..1. Só o `EstadoAtomico` no servidor pode alterar estes valores,
 * e sempre sob trava. A LLM nunca escreve aqui — ela emite intenções que o
 * motor valida antes de aplicar.
 */
export interface MetricasVitais {
  /** Cai a cada raciocínio caro; regenera no ócio. */
  energia_cognitiva: number;
  /** Cai com rajada de mensagens e caixa alta; regenera com pausas. */
  paciencia_operacional: number;
  /** Sobe com interações concluídas sem atrito. Por operador. */
  afinidade: number;
  /** Quanto do orçamento de contexto/token foi gasto na sessão. */
  carga_contextual: number;
}

/** Matriz OCEAN — parametriza a persona, não o humor. Constante em runtime. */
export interface MatrizOcean {
  abertura: number;
  conscienciosidade: number;
  extroversao: number;
  amabilidade: number;
  neuroticismo: number;
}

// ---------------------------------------------------------------------------
// Teoria da Mente
// ---------------------------------------------------------------------------

/** Leitura do estado do operador humano, derivada de sinais observáveis. */
export type EstadoOperador =
  | 'neutro'
  | 'focado'
  | 'produtivo'
  | 'estressado'
  | 'frustrado';

export interface LeituraOperador {
  estado: EstadoOperador;
  /** 0..1 — o quanto o motor confia nessa classificação. */
  confianca: number;
  /** Sinais que produziram a leitura. Vai para o console técnico, não para a UI. */
  sinais: string[];
}

// ---------------------------------------------------------------------------
// Operador e shards de memória
// ---------------------------------------------------------------------------

export interface PerfilOperador {
  id_usuario: string;
  nome: string;
  /** ISO. Convertido para absoluto na escrita, nunca relativo. */
  visto_em: string;
  /**
   * A ficha que o operador escreveu sobre si — ver `lib/perfil.ts`.
   *
   * Viaja no snapshot porque o formulário precisa hidratar com o que já está
   * gravado, e o snapshot já é o caminho de tudo que o servidor conta à tela.
   * Um segundo canal só para isto tornaria "só existe o snapshot" ficção.
   *
   * Opcional no tipo por causa de shard antigo e servidor antigo: quem lê
   * resolve com `PREFERENCIAS_PADRAO`, que é justamente "nada declarado".
   */
  preferencias?: PreferenciasOperador;
}

/**
 * Uma entrada da memória operacional. Vive SEMPRE dentro do shard privado de
 * um `id_usuario` — nunca no escopo global.
 */
export interface RegistroMemoria {
  id: string;
  id_usuario: string;
  instante: string;
  papel: 'operador' | 'iara';
  texto: string;
  destino?: DestinoCognitivo;
}

/** Consolidação noturna. Gravada no shard privado, lida no dia seguinte. */
export interface InsightRelacional {
  id: string;
  id_usuario: string;
  gerado_em: string;
  titulo: string;
  detalhe: string;
  /** Se true, a IARA abre o próximo turno com isso. */
  proativo: boolean;
}

// ---------------------------------------------------------------------------
// RAG de erros — Schema-Only
// ---------------------------------------------------------------------------

/**
 * O RAG NUNCA devolve o log bruto. Só a assinatura sintática e a resolução.
 * Isso é o que impede o contexto do Claude de ser inundado por lixo técnico.
 */
export interface AssinaturaErro {
  hash: string;
  /** Ex.: "ECONNRESET em pool de conexões do Postgres". Uma linha. */
  assinatura: string;
  sistema: string;
  primeira_ocorrencia: string;
  ultima_ocorrencia: string;
  ocorrencias: number;
  /** O que o time efetivamente fez. Uma ou duas frases. */
  resolucao: string;
}

// ---------------------------------------------------------------------------
// Objetos da sala
// ---------------------------------------------------------------------------

export type IdObjeto =
  | 'terminal'
  | 'estante'
  | 'rack'
  | 'janela'
  | 'gaveteiro'
  | 'cafeteira'
  | 'planta'
  | 'quadro_metas';

/** Intensidade luminosa por objeto: 0 = apagado, 1 = pulsando forte. */
export type MapaLuzes = Record<IdObjeto, number>;

export const LUZES_APAGADAS: MapaLuzes = {
  terminal: 0,
  estante: 0,
  rack: 0,
  janela: 0,
  gaveteiro: 0,
  cafeteira: 0,
  planta: 0,
  quadro_metas: 0,
};

/** Qual objeto acende para cada capacidade. Única fonte dessa relação. */
export const OBJETO_DA_CAPACIDADE: Record<CapacidadeAtiva, IdObjeto> = {
  automacao: 'terminal',
  conhecimento: 'estante',
  raciocinio: 'rack',
  percepcao: 'janela',
  memoria: 'gaveteiro',
};

// ---------------------------------------------------------------------------
// Snapshot consolidado
// ---------------------------------------------------------------------------

/**
 * O que o React recebe. Imutável, versionado por `seq`. Um pacote com `seq`
 * menor que o último aplicado é descartado — é assim que a reconexão não
 * teleporta o avatar.
 */
export interface EstadoEscritorio {
  seq: number;
  instante: number;
  operador: PerfilOperador | null;
  estagio: EstagioCognitivo;
  capacidade: CapacidadeAtiva | null;
  metricas: MetricasVitais;
  leitura: LeituraOperador;
  luzes: MapaLuzes;
  /** true quando a chave da Anthropic não está configurada. */
  nuvem_indisponivel: boolean;
}

export const METRICAS_INICIAIS: MetricasVitais = {
  energia_cognitiva: 1,
  paciencia_operacional: 1,
  afinidade: 0.5,
  carga_contextual: 0,
};

export const OCEAN_IARA: MatrizOcean = {
  // Curiosa, mas sem divagar.
  abertura: 0.72,
  // Rigor é a identidade: personalidade não afrouxa fato.
  conscienciosidade: 0.94,
  // Presente, nunca tagarela.
  extroversao: 0.38,
  // Alta, mas não complacente — amabilidade aqui é cuidado, não concordância.
  amabilidade: 0.81,
  // Estável sob pressão — é o ponto todo dela.
  neuroticismo: 0.16,
};

export const LEITURA_INICIAL: LeituraOperador = {
  estado: 'neutro',
  confianca: 0,
  sinais: [],
};

export function estadoInicial(): EstadoEscritorio {
  return {
    seq: 0,
    instante: Date.now(),
    operador: null,
    estagio: 'ocioso',
    capacidade: null,
    metricas: { ...METRICAS_INICIAIS },
    leitura: { ...LEITURA_INICIAL },
    luzes: { ...LUZES_APAGADAS },
    nuvem_indisponivel: false,
  };
}

/** Limita um número a 0..1 sem depender de Math.clamp (não existe em ES2022). */
export function limitar(valor: number): number {
  if (Number.isNaN(valor)) return 0;
  return valor < 0 ? 0 : valor > 1 ? 1 : valor;
}
