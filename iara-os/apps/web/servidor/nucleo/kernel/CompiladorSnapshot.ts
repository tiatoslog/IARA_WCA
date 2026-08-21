/**
 * Compilador de Snapshot.
 *
 * Assina o barramento, acumula o que os eventos dizem e compila o
 * `SnapshotCognitivo`. É o único lugar do kernel autorizado a produzir o
 * objeto que sai para o mundo — e ele não tem referência a socket, a React,
 * nem a renderizador nenhum.
 *
 * A regra de direção de arte continua valendo aqui, agora como código: uma
 * capacidade só acende porque um evento disse que ela está em uso. Não existe
 * caminho neste arquivo que acenda algo "para dar vida".
 */

import type { BarramentoEventos } from './BarramentoEventos';
import type { EventoKernel } from './Evento';
import type { MemoriaTrabalho } from './MemoriaTrabalho';
import {
  ESPACO_VAZIO,
  EXPRESSAO_NEUTRA,
  TELEMETRIA_ZERO,
  type CadeiaCognitiva,
  type EspacoCognitivo,
  type Expressao,
  type FalaProjetada,
  type PerguntaProjetada,
  type PassoCadeia,
  type PlanoProjetado,
  type SnapshotCognitivo,
  type TelemetriaSnapshot,
  type VerificacaoCadeia,
} from '../../../lib/snapshot';
import {
  LUZES_APAGADAS,
  OBJETO_DA_CAPACIDADE,
  limitar,
  type CapacidadeAtiva,
  type EstadoEscritorio,
  type MapaLuzes,
} from '../../../lib/estado';

/** Quanto uma capacidade decai por compilação quando nada a reforça. */
const DECAIMENTO = 0.12;

/**
 * Tetos da cadeia projetada. O snapshot viaja aglutinado pelo barramento a
 * cada atualização; uma cadeia sem teto crescria com o plano mais longo e
 * seria retransmitida inteira a cada trecho de fala.
 */
const MAX_ELOS_EXECUCAO = 12;
const MAX_LINHA_CADEIA = 200;

const umaLinha = (texto: string): string => {
  // Uma linha DE VERDADE: quebra vira espaço antes do teto de comprimento —
  // um `resumo` multilinha viajaria com `\n` para dentro de um elo da cadeia.
  const plano = texto.replace(/\s+/g, ' ').trim();
  return plano.length > MAX_LINHA_CADEIA ? `${plano.slice(0, MAX_LINHA_CADEIA - 1)}…` : plano;
};

export class CompiladorSnapshot {
  private capacidades: EspacoCognitivo = { ...ESPACO_VAZIO };
  private telemetria: TelemetriaSnapshot = { ...TELEMETRIA_ZERO };
  private passosConcluidos = new Set<number>();
  private passoCorrente = -1;
  private falhou = new Set<number>();
  private textoEmCurso = '';
  private fala: FalaProjetada | null = null;
  /**
   * A pergunta do turno corrente. Sobrevive ao fim do turno de propósito: um
   * espelho que conecta DEPOIS da resposta precisa ver o par pergunta/resposta,
   * não uma resposta órfã. Zerada só quando o turno seguinte a substitui.
   */
  private pergunta: PerguntaProjetada | null = null;
  /**
   * Quem espera a vez. Vive fora do ciclo do turno de propósito: a fila
   * atravessa turnos — é justamente o pedido que NÃO é o turno corrente.
   */
  private fila: PerguntaProjetada[] = [];
  /**
   * A cadeia cognitiva do turno — FASE A (14/08/2026). Acumulada dos MESMOS
   * eventos que o resto deste arquivo já absorvia; nenhum evento novo, nenhuma
   * pergunta ao kernel. Zerada quando `MENSAGEM_RECEBIDA` abre o turno
   * seguinte — a cadeia mostrada é sempre a do turno corrente ou do último
   * concluído, nunca uma mistura dos dois.
   */
  private cadeia: {
    intencao: CadeiaCognitiva['intencao'];
    decisao: CadeiaCognitiva['decisao'];
    plano: CadeiaCognitiva['plano'];
    execucao: PassoCadeia[];
    verificacao: VerificacaoCadeia[];
    resposta: CadeiaCognitiva['resposta'];
  } | null = null;
  private desassinar: () => void;

  constructor(
    private readonly barramento: BarramentoEventos,
    private readonly memoria: MemoriaTrabalho,
  ) {
    this.desassinar = barramento.assinarTudo((e) => this.absorver(e));
  }

  encerrar(): void {
    this.desassinar();
  }

  // -------------------------------------------------------------------------

  private absorver(e: EventoKernel): void {
    switch (e.tipo) {
      case 'MENSAGEM_RECEBIDA':
        this.pergunta = { id: e.id_mensagem, texto: e.texto, imagem: e.anexo ?? null };
        this.passosConcluidos.clear();
        this.falhou.clear();
        this.passoCorrente = -1;
        this.textoEmCurso = '';
        this.telemetria = { ...TELEMETRIA_ZERO };
        // Turno novo, cadeia nova: os elos nascem vazios e cada evento
        // preenche o seu. Nada do turno anterior sobrevive aqui.
        this.cadeia = {
          intencao: null,
          decisao: null,
          plano: null,
          execucao: [],
          verificacao: [],
          resposta: null,
        };
        break;

      case 'FILA_ATUALIZADA':
        /* Estado completo, não delta — o evento já vem assim. Copiar aqui
           mantém o compilador sem referência ao array do Kernel. */
        this.fila = e.pedidos.map((p) => ({ id: p.id_mensagem, texto: p.texto }));
        break;

      case 'PERCEPCAO_CONCLUIDA':
        // Perceber É usar percepção. O evento é o fato; a luz é a consequência.
        this.acender('percepcao', 0.55);
        if (this.cadeia) {
          this.cadeia.intencao = {
            tipo: e.percepcao.tipo,
            objetivo: umaLinha(e.percepcao.objetivo_provavel),
            confianca: e.percepcao.confianca,
          };
        }
        break;

      case 'DECISAO_TOMADA':
        this.telemetria = { ...this.telemetria, rota: e.rota, custo: e.custo_estimado };
        if (this.cadeia) {
          this.cadeia.decisao = {
            rota: e.rota,
            justificativa: umaLinha(e.justificativa),
            custo: e.custo_estimado,
          };
        }
        break;

      case 'PLANO_CRIADO':
        this.acender('raciocinio', e.plano.origem === 'emergente' ? 0.8 : 0.25);
        if (this.cadeia) {
          this.cadeia.plano = {
            objetivo: umaLinha(e.plano.objetivo),
            origem: e.plano.origem,
            total_passos: e.plano.passos.length,
          };
        }
        break;

      case 'PASSO_INICIADO':
        this.passoCorrente = e.passo.indice;
        break;

      case 'PASSO_CONCLUIDO':
        this.passosConcluidos.add(e.passo.indice);
        if (this.cadeia && this.cadeia.execucao.length < MAX_ELOS_EXECUCAO) {
          this.cadeia.execucao.push({
            indice: e.passo.indice,
            habilidade: e.passo.habilidade ?? 'raciocinio',
            descricao: umaLinha(e.passo.descricao),
            resumo: umaLinha(e.resumo),
            ms: e.ms,
          });
        }
        break;

      case 'HABILIDADE_VERIFICADA':
        if (this.cadeia && this.cadeia.verificacao.length < MAX_ELOS_EXECUCAO) {
          this.cadeia.verificacao.push({
            habilidade: e.habilidade,
            confirmado: e.confirmado,
            evidencia: umaLinha(e.evidencia),
          });
        }
        break;

      case 'HABILIDADE_INICIADA':
        this.acender(e.capacidade, 1);
        break;

      case 'HABILIDADE_CONCLUIDA':
        if (!e.ok && this.passoCorrente >= 0) this.falhou.add(this.passoCorrente);
        break;

      case 'RACIOCINIO_INICIADO':
        this.acender('raciocinio', 1);
        break;

      case 'RACIOCINIO_CONCLUIDO':
        this.telemetria = {
          ...this.telemetria,
          tokens_entrada: this.telemetria.tokens_entrada + e.tokens_entrada,
          tokens_saida: this.telemetria.tokens_saida + e.tokens_saida,
          cache_lido: this.telemetria.cache_lido + e.cache_lido,
        };
        break;

      case 'RESPOSTA_TRECHO':
        this.textoEmCurso = e.texto;
        this.fala = {
          id: e.id_mensagem,
          texto: e.texto,
          concluida: false,
          /* Copiado do evento, nunca lido de `this.pergunta`: o campo existe
             justamente porque "a pergunta corrente do compilador" e "a pergunta
             que este turno está respondendo" podem ser duas coisas diferentes
             quando duas telas falam. Ver o CC-01 em `Evento.ts`. */
          responde_a: e.responde_a,
          destino: this.telemetria.rota,
          latencia_ms: null,
          cache_lido: this.telemetria.cache_lido,
          // O compilador nunca preenche `voz`: áudio é do mundo HTTP, e quem
          // anexa é a `PonteProjecao`. Aqui é sempre null.
          voz: null,
          // Trecho parcial nunca carrega marcação: a análise visual desta
          // versão é uma chamada única, não incremental — a marcação só
          // existe quando a resposta está pronta, em TAREFA_CONCLUIDA.
          marcacao: null,
          // Mesma razão, outro motivo: a ilustração vem do passo que já
          // executou, e um trecho parcial é texto chegando antes disso.
          ilustracao: null,
        };
        break;

      case 'TAREFA_CONCLUIDA':
        this.telemetria = { ...this.telemetria, latencia_ms: e.ms };
        /**
         * A RESPOSTA FECHA A CADEIA UMA VEZ — achado da auditoria adversarial
         * de 14/08: lembrete vencido e aviso do vigia publicam
         * `TAREFA_CONCLUIDA` direto no barramento, SEM `MENSAGEM_RECEBIDA`
         * antes (ver `Porta.ts` — é deliberado, recado precisa virar fala). O
         * último-que-escreve sobrescrevia o elo de resposta de um turno já
         * concluído com `via sistema_local (0 ms)` — a cadeia mostrava a
         * pergunta de um turno com a resposta de recado nenhum. Primeiro-que-
         * fecha é o certo aqui: o turno do operador fecha a própria cadeia, e
         * recado autônomo que chegue depois não a toca. O resíduo declarado:
         * um recado que dispare NO MEIO de um turno em voo ocupa o elo por
         * alguns segundos, até o fechamento real do turno — raro, visível e
         * menos errado que o inverso.
         */
        if (this.cadeia && this.cadeia.resposta === null) {
          this.cadeia.resposta = { rota: e.rota, latencia_ms: e.ms };
        }
        this.textoEmCurso = '';
        this.fala = {
          id: e.id_mensagem,
          texto: e.texto,
          concluida: true,
          responde_a: e.responde_a,
          destino: e.rota,
          latencia_ms: e.ms,
          cache_lido: this.telemetria.cache_lido,
          voz: null,
          marcacao: e.marcacao ?? null,
          ilustracao: e.ilustracao ?? null,
        };
        break;

      case 'TAREFA_CANCELADA':
      case 'FALHA':
        this.textoEmCurso = '';
        // A fala parcial permanece: apagar o que já foi dito faria o texto
        // sumir da tela e o operador achar que a IARA nunca respondeu.
        if (this.fala && !this.fala.concluida) {
          this.fala = { ...this.fala, concluida: true };
        }
        break;
    }
  }

  private acender(capacidade: CapacidadeAtiva, intensidade: number): void {
    this.capacidades = {
      ...this.capacidades,
      [capacidade]: Math.max(this.capacidades[capacidade], intensidade),
    };
  }

  /** Decai tudo que nenhum evento reforçou desde a última compilação. */
  private esfriar(): void {
    const proximo = { ...this.capacidades };
    for (const chave of Object.keys(proximo) as CapacidadeAtiva[]) {
      proximo[chave] = limitar(proximo[chave] - DECAIMENTO);
    }
    this.capacidades = proximo;
  }

  // -------------------------------------------------------------------------

  compilar(base: EstadoEscritorio, sessao: string, descartados: number): SnapshotCognitivo {
    const retrato = this.memoria.retrato;

    const plano: PlanoProjetado | null = retrato.plano
      ? {
          objetivo: retrato.plano.objetivo,
          origem: retrato.plano.origem,
          passo_atual: retrato.passo_atual,
          passos: retrato.plano.passos.map((p) => ({
            indice: p.indice,
            descricao: p.descricao,
            estado: this.falhou.has(p.indice)
              ? ('falhou' as const)
              : this.passosConcluidos.has(p.indice)
                ? ('concluido' as const)
                : p.indice === this.passoCorrente
                  ? ('executando' as const)
                  : ('pendente' as const),
          })),
        }
      : null;

    const snapshot: SnapshotCognitivo = {
      sessao,
      seq: base.seq,
      instante: Date.now(),
      traco: this.barramento.tracoAtual,
      operador: base.operador,
      estagio: base.estagio,
      objetivo: retrato.objetivo,
      plano,
      capacidades: { ...this.capacidades },
      metricas: base.metricas,
      leitura: base.leitura,
      expressao: this.expressar(base),
      telemetria: { ...this.telemetria, eventos_no_traco: this.barramento.trilhaAtual().length, descartados },
      luzes: this.projetarLuzes(base),
      nuvem_indisponivel: base.nuvem_indisponivel,
      origem_raciocinio: base.origem_raciocinio,
      fala: this.fala,
      pergunta: this.pergunta,
      fila: this.fila,
      // Cópia com arrays congelados por spread: o acumulador continua mutável
      // aqui dentro, mas o que sai pela fronteira é dado morto, como todo o
      // resto do snapshot.
      cadeia: this.cadeia
        ? {
            ...this.cadeia,
            execucao: [...this.cadeia.execucao],
            verificacao: [...this.cadeia.verificacao],
          }
        : null,
    };

    this.esfriar();
    return snapshot;
  }

  /**
   * Expressão derivada do estado, nunca escolhida à toa.
   *
   * Os visemas saem do texto em streaming: enquanto não há síntese de voz, é
   * aproximação — e é honesto dizer isso aqui em vez de fingir lipsync de
   * áudio que não existe. Quando a voz entrar, só esta função muda.
   */
  private expressar(base: EstadoEscritorio): Expressao {
    const emocao: Expressao['emocao'] =
      base.leitura.estado === 'frustrado' || base.leitura.estado === 'estressado'
        ? 'solicita'
        : base.estagio === 'pensando'
          ? 'concentrada'
          : base.estagio === 'escutando'
            ? 'atenta'
            : base.metricas.energia_cognitiva < 0.3
              ? 'preocupada'
              : 'neutra';

    const intensidade =
      base.estagio === 'ocioso' ? 0.2 : base.estagio === 'pensando' ? 0.9 : 0.6;

    return {
      ...EXPRESSAO_NEUTRA,
      emocao,
      intensidade,
      // Pensando, a IARA desvia o olhar; falando, volta ao operador.
      olhar: base.estagio === 'pensando' ? { x: -0.35, y: 0.2 } : { x: 0, y: 0 },
      cabeca: { inclinacao: base.estagio === 'escutando' ? 4 : 0, giro: 0 },
      visemas: this.visemasDe(this.textoEmCurso),
    };
  }

  /** Aproximação de boca a partir da última sílaba emitida. */
  private visemasDe(texto: string): Expressao['visemas'] {
    if (!texto) return [];
    const ultima = texto.trim().slice(-1).toLowerCase();
    const grupo =
      'aáà'.includes(ultima) ? 'AA'
      : 'eé'.includes(ultima) ? 'E'
      : 'ií'.includes(ultima) ? 'I'
      : 'oó'.includes(ultima) ? 'O'
      : 'uú'.includes(ultima) ? 'U'
      : 'mbp'.includes(ultima) ? 'PP'
      : 'fv'.includes(ultima) ? 'FF'
      : 'sz'.includes(ultima) ? 'SS'
      : null;
    return grupo ? [{ id: grupo, peso: 0.7 }] : [];
  }

  /**
   * Projeção espacial: capacidades viram luz na sala. Esta é a tradução do
   * espaço cognitivo para o ambiente — e o único lugar onde ela acontece.
   */
  private projetarLuzes(base: EstadoEscritorio): MapaLuzes {
    const luzes: MapaLuzes = { ...LUZES_APAGADAS };

    luzes.janela = 0.25;
    luzes.planta = 0.15 + base.metricas.paciencia_operacional * 0.2;
    luzes.rack = 0.12 + base.metricas.carga_contextual * 0.35;
    if (base.estagio === 'ocioso') luzes.quadro_metas = 0.2;

    for (const [capacidade, valor] of Object.entries(this.capacidades) as Array<
      [CapacidadeAtiva, number]
    >) {
      if (valor <= 0.03) continue;
      const objeto = OBJETO_DA_CAPACIDADE[capacidade];
      luzes[objeto] = Math.max(luzes[objeto], valor);
    }
    return luzes;
  }
}
