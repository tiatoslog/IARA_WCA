/**
 * Protocolo do barramento WebSocket.
 *
 * Todo pacote servidor→cliente carrega `seq` monotônico. O cliente descarta
 * qualquer pacote com `seq` menor ou igual ao último aplicado — é o que impede
 * a enxurrada retroativa (backpressure wave) de bagunçar a UI na reconexão.
 */

import type {
  CapacidadeAtiva,
  DestinoCognitivo,
  EstadoEscritorio,
  EstagioCognitivo,
  LeituraOperador,
  MetricasVitais,
} from './estado';

export type NivelLog = 'traco' | 'info' | 'alerta';

/** Chave de aglutinação: pacotes com a mesma chave se sobrescrevem na fila. */
export type ChaveAglutinacao = string;

export type PacoteServidor =
  /** Estado consolidado. Enviado na conexão e em toda reconexão. */
  | { tipo: 'hidratacao'; seq: number; instante: number; estado: EstadoEscritorio }
  /** Marco de transição de estágio. Só marcos — micro-eventos não sobem. */
  | {
      tipo: 'transicao';
      seq: number;
      instante: number;
      estagio: EstagioCognitivo;
      capacidade: CapacidadeAtiva | null;
      motivo: string;
    }
  /** Pulso de métricas, com throttle. Descartável na reconexão. */
  | {
      tipo: 'pulso';
      seq: number;
      instante: number;
      metricas: MetricasVitais;
      leitura: LeituraOperador;
    }
  | { tipo: 'fala_inicio'; seq: number; instante: number; id_mensagem: string }
  | {
      tipo: 'fala_delta';
      seq: number;
      instante: number;
      id_mensagem: string;
      texto: string;
    }
  | {
      tipo: 'fala_fim';
      seq: number;
      instante: number;
      id_mensagem: string;
      texto: string;
      destino: DestinoCognitivo;
      latencia_ms: number;
      tokens_entrada: number;
      tokens_saida: number;
      cache_lido: number;
    }
  /** Log técnico. Vai para o console, nunca para a sala. */
  | { tipo: 'log'; seq: number; instante: number; nivel: NivelLog; texto: string }
  | { tipo: 'erro'; seq: number; instante: number; texto: string };

export type PacoteCliente =
  /**
   * `token` é o access token do Supabase. Quando a autenticação está ativa, é
   * ELE que define quem é o operador — `id_usuario` e `nome` viram decoração
   * de desenvolvimento e são ignorados pelo servidor.
   */
  | { tipo: 'ola'; id_usuario: string; nome: string; token?: string }
  | { tipo: 'mensagem'; texto: string }
  | { tipo: 'interromper' };

/**
 * Prioridade de descarte da fila de telemetria. Quanto menor, mais descartável.
 * `hidratacao`, `fala_*` e `transicao` nunca são descartados por pressão.
 */
export const PRIORIDADE: Record<PacoteServidor['tipo'], number> = {
  log: 0,
  pulso: 1,
  transicao: 3,
  fala_inicio: 3,
  fala_delta: 3,
  fala_fim: 3,
  erro: 3,
  hidratacao: 4,
};

/**
 * Pacotes com chave de aglutinação são substituídos, não empilhados: só o
 * estado mais recente sobrevive na fila.
 */
export function chaveDe(pacote: PacoteServidor): ChaveAglutinacao | null {
  switch (pacote.tipo) {
    case 'pulso':
      return 'pulso';
    case 'hidratacao':
      return 'hidratacao';
    default:
      return null;
  }
}

export function ehDescartavel(pacote: PacoteServidor): boolean {
  return PRIORIDADE[pacote.tipo] <= 1;
}

/** Parser defensivo: nada que venha do socket entra no motor sem validação. */
export function lerPacoteCliente(bruto: string): PacoteCliente | null {
  let dado: unknown;
  try {
    dado = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (typeof dado !== 'object' || dado === null) return null;
  const obj = dado as Record<string, unknown>;

  if (obj.tipo === 'ola') {
    const id = typeof obj.id_usuario === 'string' ? obj.id_usuario.trim() : '';
    const nome = typeof obj.nome === 'string' ? obj.nome.trim() : '';
    const token = typeof obj.token === 'string' ? obj.token.trim() : undefined;
    // Sem id E sem token não há como abrir sessão em modo nenhum.
    if (!id && !token) return null;
    return {
      tipo: 'ola',
      id_usuario: id.slice(0, 64),
      nome: (nome || id).slice(0, 64),
      token: token ? token.slice(0, 4096) : undefined,
    };
  }
  if (obj.tipo === 'mensagem') {
    const texto = typeof obj.texto === 'string' ? obj.texto : '';
    if (!texto.trim()) return null;
    return { tipo: 'mensagem', texto: texto.slice(0, 8000) };
  }
  if (obj.tipo === 'interromper') {
    return { tipo: 'interromper' };
  }
  return null;
}
