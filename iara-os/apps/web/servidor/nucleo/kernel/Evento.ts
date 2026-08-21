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
import type { Ilustracao } from '../../../lib/snapshot';

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
  | 'FILA_ATUALIZADA'
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
  /**
   * `id_mensagem` identifica a FRASE DO OPERADOR, do mesmo jeito que os eventos
   * de resposta identificam a frase da IARA. É o que o compilador projeta em
   * `SnapshotCognitivo.pergunta` para os espelhos que não digitaram nada.
   */
  | (EventoBase & {
      tipo: 'MENSAGEM_RECEBIDA';
      texto: string;
      id_mensagem: string;
      /** Screenshot anexado a esta pergunta, se houver — ver `lib/protocolo.ts`. */
      anexo?: { url: string; largura: number; altura: number };
    })
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
  /**
   * `responde_a` — a QUAL pergunta esta fala responde.
   *
   * Nasceu do CC-01 (16/08/2026): um kernel por operador, várias telas, e uma
   * fala que saía para a sessão inteira sem dizer de quem era a pergunta. A
   * tela que perdeu a corrida colava a confirmação alheia embaixo do próprio
   * balão e apresentava aquilo como a resposta do que ELA tinha pedido.
   *
   * É o `id_mensagem` do `MENSAGEM_RECEBIDA` que abriu o turno — o mesmo `op:`
   * que a projeção usa para a tela reconhecer a própria bolha. `null` quando a
   * fala não responde a pergunta nenhuma (recado que a IARA dá por conta
   * própria); nunca o id de uma pergunta que a sessão não viu.
   */
  | (EventoBase & {
      tipo: 'RESPOSTA_TRECHO';
      id_mensagem: string;
      texto: string;
      responde_a: string | null;
      /**
       * ISTO NÃO É RESPOSTA — é recado de andamento ("ainda estou nisto").
       *
       * O campo existe por um defeito criado pelo próprio conserto do prazo de
       * fala, em 18/08/2026. O aviso era publicado como trecho comum, e o
       * `CompiladorSnapshot` promove toda fala parcial pendente a `concluida`
       * quando o turno é cancelado ou falha — regra certa para resposta parcial
       * de verdade (apagar o que já foi dito faria o texto sumir da tela), e
       * errada para um recado de espera. Medido: o turno 5 morreu, o turno 6
       * chegou, e "Ainda estou nisto: 2 segundos até agora." virou a RESPOSTA
       * do turno 5.
       *
       * Trocar silêncio por nota de status apresentada como resposta não é
       * conserto — é a mentira operacional pequena que esta base inteira existe
       * para não cometer.
       */
      provisoria?: boolean;
    })
  | (EventoBase & {
      tipo: 'TAREFA_CONCLUIDA';
      id_mensagem: string;
      texto: string;
      rota: string;
      ms: number;
      responde_a: string | null;
      /**
       * Onde a IARA aponta, quando esta resposta veio de `analisarImagem`.
       * `null` = sabe que não sabe (nenhum elemento identificado); ausente =
       * turno sem imagem envolvida. Ver `lib/snapshot.ts#FalaProjetada.marcacao`.
       */
      marcacao?: { alvo_x: number; alvo_y: number; elemento: string } | null;
      /**
       * As telas do documento que esta resposta mostra — hoje, as capturas do
       * POP em curso. Ausente no turno que não ilustra nada, que é a regra.
       * Ver `lib/snapshot.ts#Ilustracao`.
       */
      ilustracao?: Ilustracao | null;
    })
  | (EventoBase & { tipo: 'TAREFA_CANCELADA'; motivo: string })
  /**
   * QUEM ESTÁ ESPERANDO A VEZ — a fila inteira, sempre que ela muda.
   *
   * O evento carrega o estado COMPLETO, não o delta, pela mesma razão que o
   * snapshot carrega: quem chega no meio precisa da verdade de agora, e um
   * delta perdido deixaria a tela mostrando uma fila que não existe mais.
   *
   * Nasceu da lacuna que a auditoria de 16/08 deixou explícita: com a
   * serialização de turnos, o pedido de uma tela pode ESPERAR — e não havia no
   * contrato nada que dissesse isso. A pessoa via a própria bolha, a IARA
   * trabalhando, e não tinha como saber se o que estava sendo feito era o
   * pedido dela ou o da outra tela. Sem isso, "desistir antes da vez" é uma
   * ação que a interface oferece sem dizer se ainda vale.
   */
  | (EventoBase & {
      tipo: 'FILA_ATUALIZADA';
      pedidos: readonly { readonly id_mensagem: string; readonly texto: string }[];
    })
  | (EventoBase & { tipo: 'FALHA'; modulo: string; mensagem: string });

/** Extrai o payload de um tipo específico — usado pelos assinantes tipados. */
export type EventoDe<T extends TipoEvento> = Extract<EventoKernel, { tipo: T }>;
