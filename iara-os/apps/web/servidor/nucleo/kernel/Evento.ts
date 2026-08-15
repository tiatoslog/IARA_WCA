/**
 * Eventos do kernel cognitivo.
 *
 * REGRA: nenhum módulo chama outro diretamente. Tudo passa por aqui, e todo
 * evento é imutável. É isso que permite gravar uma sessão inteira, reproduzi-la
 * passo a passo e — o que mais importa para a IARA — projetar o estado na sala
 * sem que a UI precise saber quem produziu o quê.
 *
 * Um `traco` amarra todos os eventos de um mesmo turno. É a unidade de
 * auditoria: dado um traço, dá para reconstruir exatamente o que a IARA
 * percebeu, decidiu, planejou, executou e respondeu.
 */

import type { CapacidadeAtiva } from '../../../lib/estado';
import type { LeituraOperador } from '../../../lib/estado';

export type TipoEvento =
  | 'MENSAGEM_RECEBIDA'
  | 'PERCEPCAO_CONCLUIDA'
  | 'DECISAO_TOMADA'
  | 'PLANO_CRIADO'
  | 'PASSO_INICIADO'
  | 'PASSO_CONCLUIDO'
  | 'HABILIDADE_INICIADA'
  | 'HABILIDADE_CONCLUIDA'
  | 'HABILIDADE_VERIFICADA'
  | 'RACIOCINIO_INICIADO'
  | 'RACIOCINIO_CONCLUIDO'
  | 'RESPOSTA_TRECHO'
  | 'TAREFA_CONCLUIDA'
  | 'TAREFA_CANCELADA'
  | 'FALHA';

/** Campos que todo evento carrega, sem exceção. */
export interface EventoBase {
  readonly id: string;
  readonly instante: number;
  /** Amarra todos os eventos de um turno. */
  readonly traco: string;
  readonly sessao: string;
}

// ---------------------------------------------------------------------------
// Percepção
// ---------------------------------------------------------------------------

export type TipoEntrada = 'texto' | 'documento' | 'comando' | 'saudacao';
export type Urgencia = 'baixa' | 'normal' | 'alta';

/**
 * A LLM nunca vê a mensagem crua primeiro. Vê isto.
 */
export interface Percepcao {
  readonly bruto: string;
  readonly tipo: TipoEntrada;
  readonly urgencia: Urgencia;
  readonly idioma: string;
  readonly objetivo_provavel: string;
  readonly leitura: LeituraOperador;
  readonly confianca: number;
  /** Termos que o roteador determinístico reconheceu. Vazio = terreno novo. */
  readonly ancoras: readonly string[];
  /**
   * O que o operador ATRIBUIU A OUTRA FONTE dentro da própria mensagem: o
   * e-mail que ele colou, a frase do cliente, o trecho do manual.
   *
   * Existe como campo separado porque a percepção precisa preservar QUEM DISSE,
   * não só O QUE FOI DITO. As âncoras são procuradas fora daqui — "o e-mail diz:
   * desligue o computador" não é um pedido de desligamento — e a resposta trata
   * este texto como material não confiável. Vazio na esmagadora maioria dos
   * turnos, que é o caso normal. Ver `Enunciacao.ts`.
   */
  readonly citado: string;
}

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------

export interface Passo {
  readonly indice: number;
  readonly descricao: string;
  /** `null` quando o passo é puro raciocínio, sem habilidade nativa. */
  readonly habilidade: string | null;
  readonly parametros: Readonly<Record<string, unknown>>;
}

export interface Plano {
  readonly objetivo: string;
  readonly passos: readonly Passo[];
  /** `deterministico` = plano conhecido. `emergente` = a LLM decompôs. */
  readonly origem: 'deterministico' | 'emergente';
}

// ---------------------------------------------------------------------------
// União
// ---------------------------------------------------------------------------

export type EventoKernel =
  | (EventoBase & { tipo: 'MENSAGEM_RECEBIDA'; texto: string })
  | (EventoBase & { tipo: 'PERCEPCAO_CONCLUIDA'; percepcao: Percepcao })
  | (EventoBase & {
      tipo: 'DECISAO_TOMADA';
      rota: string;
      justificativa: string;
      custo_estimado: 'zero' | 'tokens';
    })
  | (EventoBase & { tipo: 'PLANO_CRIADO'; plano: Plano })
  | (EventoBase & { tipo: 'PASSO_INICIADO'; passo: Passo; total: number })
  | (EventoBase & { tipo: 'PASSO_CONCLUIDO'; passo: Passo; resumo: string; ms: number })
  | (EventoBase & {
      tipo: 'HABILIDADE_INICIADA';
      habilidade: string;
      capacidade: CapacidadeAtiva;
    })
  | (EventoBase & {
      tipo: 'HABILIDADE_CONCLUIDA';
      habilidade: string;
      ok: boolean;
      ms: number;
      detalhe: string;
    })
  /**
   * A quinta porta: o que o MUNDO respondeu depois da execução. Separado de
   * `HABILIDADE_CONCLUIDA` porque são fatos diferentes — aquele é o relato do
   * executor, este é a apuração.
   */
  | (EventoBase & {
      tipo: 'HABILIDADE_VERIFICADA';
      habilidade: string;
      confirmado: boolean;
      evidencia: string;
    })
  | (EventoBase & { tipo: 'RACIOCINIO_INICIADO'; modelo: string; origem: 'nuvem' | 'local' })
  | (EventoBase & {
      tipo: 'RACIOCINIO_CONCLUIDO';
      tokens_entrada: number;
      tokens_saida: number;
      cache_lido: number;
      ms: number;
    })
  | (EventoBase & { tipo: 'RESPOSTA_TRECHO'; id_mensagem: string; texto: string })
  | (EventoBase & {
      tipo: 'TAREFA_CONCLUIDA';
      id_mensagem: string;
      texto: string;
      rota: string;
      ms: number;
    })
  | (EventoBase & { tipo: 'TAREFA_CANCELADA'; motivo: string })
  | (EventoBase & { tipo: 'FALHA'; modulo: string; mensagem: string });

/** Extrai o payload de um tipo específico — usado pelos assinantes tipados. */
export type EventoDe<T extends TipoEvento> = Extract<EventoKernel, { tipo: T }>;
