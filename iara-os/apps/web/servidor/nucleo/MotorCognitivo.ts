/**
 * O MotorCognitivo. Um por operador conectado.
 *
 * Fluxo de baixa latência (o mesmo princípio da Siri, com transparência
 * espacial que ela não tem):
 *
 *   mensagem -> cancela ciclo autônomo -> roteador local (µs)
 *      |-> ação nativa       : acende o TERMINAL, responde em <300ms
 *      |-> RAG histórico     : acende a ESTANTE, responde em ~50ms
 *      |-> recusa por sigilo : não acende nada, recusa e encerra
 *      +-> Claude na nuvem   : acende o RACK ANTES da chamada, streama
 *
 * O evento visual sai para o React *antes* do trabalho começar. É isso que
 * elimina a sensação de travamento.
 */

import { randomUUID } from 'node:crypto';
import type { CapacidadeAtiva, DestinoCognitivo, EstagioCognitivo } from '../../lib/estado';
import type { PacoteServidor } from '../../lib/protocolo';
import { outrosOperadores } from '../../lib/operadores';
import { EstadoAtomico } from './EstadoAtomico';
import { RoteadorIntencoes } from './RoteadorIntencoes';
import { OrquestradorAcoes } from './OrquestradorAcoes';
import { RagHistorico } from './RagHistorico';
import { TeoriaDaMente } from './TeoriaDaMente';
import { MemoriaOperacional } from './MemoriaOperacional';
import { ClienteClaude, NuvemIndisponivel } from './ClienteClaude';

/** Pacote sem carimbo — a sessão aplica `seq` e `instante`. */
export type PacoteBruto =
  PacoteServidor extends infer T ? (T extends PacoteServidor ? Omit<T, 'seq' | 'instante'> : never) : never;

export type Emissor = (pacote: PacoteBruto) => void;

export interface DependenciasMotor {
  estado: EstadoAtomico;
  memoria: MemoriaOperacional;
  rag: RagHistorico;
  claude: ClienteClaude;
  emitir: Emissor;
}

export class MotorCognitivo {
  private readonly roteador: RoteadorIntencoes;
  private readonly acoes = new OrquestradorAcoes();
  private readonly mente = new TeoriaDaMente();
  private emAndamento: AbortController | null = null;

  constructor(
    private readonly idUsuario: string,
    private readonly dep: DependenciasMotor,
  ) {
    // O roteador precisa saber quem são os OUTROS para reconhecer sondagem.
    this.roteador = new RoteadorIntencoes(outrosOperadores(idUsuario));
  }

  /**
   * Cancelamento preemptivo não-bloqueante. Aborta o turno anterior no
   * milissegundo em que o novo chega. Não existe trava global segurada durante
   * a chamada de rede — por isso o cancelamento é instantâneo.
   */
  cancelar(motivo = 'preempção'): void {
    if (!this.emAndamento) return;
    this.emAndamento.abort(new Error(motivo));
    this.emAndamento = null;
    this.log('traco', `Turno anterior cancelado (${motivo}).`);
  }

  async processar(mensagem: string): Promise<void> {
    this.cancelar('nova mensagem do operador');
    const controle = new AbortController();
    this.emAndamento = controle;
    const inicio = Date.now();

    try {
      // 1. Teoria da Mente antes de qualquer coisa — decide o tom do turno.
      const temporal = this.mente.registrarChegada();
      const leitura = this.mente.analisar(mensagem, temporal);
      await this.dep.estado.definirLeitura(leitura);
      this.log(
        'info',
        `Operador lido como "${leitura.estado}" (${(leitura.confianca * 100).toFixed(0)}%): ${leitura.sinais.join('; ') || 'sem sinais fortes'}`,
      );
      this.pulso();

      await this.dep.memoria.registrar(this.idUsuario, 'operador', mensagem);

      // 2. Triagem determinística.
      const intencao = this.roteador.rotear(mensagem);
      this.log('info', `Rota: ${intencao.destino} — ${intencao.justificativa}`);

      if (controle.signal.aborted) return;

      switch (intencao.destino) {
        case 'recusa_sigilo':
          await this.responderDireto(
            'Os registros individuais pertencem exclusivamente a cada operador — inclusive os seus, que ninguém mais acessa. Não tenho como comentar o conteúdo de outra pessoa. Se precisar de algo consolidado da operação, posso levantar sem expor ninguém.',
            'recusa_sigilo',
            inicio,
          );
          return;

        case 'sistema_local':
          await this.rodarAcaoLocal(intencao.modulo!, intencao.parametros, controle, inicio);
          return;

        case 'rag_historico':
          await this.rodarRag(mensagem, controle, inicio);
          return;

        default:
          await this.rodarNuvem(mensagem, leitura, controle, inicio);
          return;
      }
    } catch (erro) {
      if (controle.signal.aborted) return;
      this.dep.emitir({ tipo: 'erro', texto: (erro as Error).message });
      this.log('alerta', `Falha no turno: ${(erro as Error).message}`);
      await this.transicionar('ocioso', null, 'turno encerrado com falha');
    } finally {
      if (this.emAndamento === controle) this.emAndamento = null;
    }
  }

  // -------------------------------------------------------------------------

  private async rodarAcaoLocal(
    modulo: string,
    parametros: Record<string, unknown>,
    controle: AbortController,
    inicio: number,
  ): Promise<void> {
    // Acende o objeto ANTES de executar — honestidade visual.
    const capacidadePrevia: CapacidadeAtiva =
      modulo === 'clima' ? 'percepcao' : modulo === 'busca_web' ? 'conhecimento' : 'automacao';
    await this.transicionar('executando', capacidadePrevia, `ação nativa: ${modulo}`);

    const resultado = await this.acoes.executar(modulo, parametros);
    if (controle.signal.aborted) return;

    this.log('traco', `Ação "${modulo}" concluída em ${resultado.latencia_ms}ms, custo zero de tokens.`);
    await this.responderDireto(resultado.texto, 'sistema_local', inicio);
  }

  private async rodarRag(
    mensagem: string,
    controle: AbortController,
    inicio: number,
  ): Promise<void> {
    await this.transicionar('consultando', 'conhecimento', 'busca no índice histórico local');
    const achados = await this.dep.rag.consultar(mensagem);
    if (controle.signal.aborted) return;

    this.log(
      'traco',
      `RAG schema-only: ${achados.length} assinatura(s), nenhum log bruto carregado. ` +
        `Similaridade máxima ${achados[0] ? achados[0].similaridade.toFixed(2) : '0.00'}.`,
    );
    await this.responderDireto(this.dep.rag.formatar(achados), 'rag_historico', inicio);
  }

  private async rodarNuvem(
    mensagem: string,
    leitura: Awaited<ReturnType<TeoriaDaMente['analisar']>>,
    controle: AbortController,
    inicio: number,
  ): Promise<void> {
    if (!this.dep.claude.disponivel) {
      await this.responderDireto(
        'Essa pergunta exige raciocínio aberto, e a camada de nuvem está desligada: falta a chave da Anthropic no ambiente. ' +
          'Prefiro dizer isso a improvisar. Enquanto isso, consigo responder clima, hora, infraestrutura e histórico de incidentes localmente.',
        'claude_nuvem',
        inicio,
      );
      return;
    }

    // Rack acende ANTES da chamada HTTP — o operador vê a carga subir no
    // instante em que ela começa, não quando termina.
    await this.transicionar('pensando', 'raciocinio', 'matriz de raciocínio acionada');

    const idMensagem = randomUUID();
    let abriu = false;

    const historico = await this.dep.memoria.historico(this.idUsuario, 20);
    const camadaGlobal = await this.dep.memoria.carregarGlobal();

    try {
      const resposta = await this.dep.claude.raciocinar({
        mensagem,
        historico: historico.slice(0, -1), // a mensagem atual já vai separada
        overridePersona: TeoriaDaMente.overrideDePersona(leitura),
        camadaGlobal,
        sinal: controle.signal,
        aoReceberTexto: (pedaco) => {
          if (controle.signal.aborted) return;
          if (!abriu) {
            abriu = true;
            this.dep.emitir({ tipo: 'fala_inicio', id_mensagem: idMensagem });
            void this.transicionar('falando', 'raciocinio', 'streaming de resposta');
          }
          this.dep.emitir({ tipo: 'fala_delta', id_mensagem: idMensagem, texto: pedaco });
        },
      });

      if (controle.signal.aborted) return;

      this.log(
        'info',
        `Claude: ${resposta.tokens_entrada} tokens de entrada (${resposta.cache_lido} lidos do cache), ` +
          `${resposta.tokens_saida} de saída.`,
      );
      if (resposta.cache_lido === 0 && resposta.tokens_entrada > 1000) {
        this.log('alerta', 'Cache de prefixo não foi lido neste turno — verificar invalidação.');
      }

      await this.dep.estado.aplicarIntencao({
        campo: 'energia_cognitiva',
        delta: -0.06,
        motivo: 'raciocínio profundo',
      });
      await this.dep.estado.aplicarIntencao({
        campo: 'carga_contextual',
        delta: Math.min(0.25, resposta.tokens_entrada / 40000),
        motivo: 'contexto acumulado',
      });

      await this.finalizarFala(idMensagem, resposta.texto, 'claude_nuvem', inicio, {
        entrada: resposta.tokens_entrada,
        saida: resposta.tokens_saida,
        cache: resposta.cache_lido,
      });
    } catch (erro) {
      if (controle.signal.aborted) return;
      if (erro instanceof NuvemIndisponivel) {
        await this.responderDireto(
          'A camada de raciocínio não está configurada neste ambiente.',
          'claude_nuvem',
          inicio,
        );
        return;
      }
      throw erro;
    }
  }

  // -------------------------------------------------------------------------

  /** Resposta que não veio por streaming: emite início, corpo e fim. */
  private async responderDireto(
    texto: string,
    destino: DestinoCognitivo,
    inicio: number,
  ): Promise<void> {
    const idMensagem = randomUUID();
    this.dep.emitir({ tipo: 'fala_inicio', id_mensagem: idMensagem });
    this.dep.emitir({ tipo: 'fala_delta', id_mensagem: idMensagem, texto });
    await this.finalizarFala(idMensagem, texto, destino, inicio, {
      entrada: 0,
      saida: 0,
      cache: 0,
    });
  }

  private async finalizarFala(
    idMensagem: string,
    texto: string,
    destino: DestinoCognitivo,
    inicio: number,
    tokens: { entrada: number; saida: number; cache: number },
  ): Promise<void> {
    this.dep.emitir({
      tipo: 'fala_fim',
      id_mensagem: idMensagem,
      texto,
      destino,
      latencia_ms: Date.now() - inicio,
      tokens_entrada: tokens.entrada,
      tokens_saida: tokens.saida,
      cache_lido: tokens.cache,
    });
    await this.dep.memoria.registrar(this.idUsuario, 'iara', texto, destino);
    await this.dep.estado.aplicarIntencao({ campo: 'afinidade', delta: 0.015 });
    await this.transicionar('ocioso', null, 'turno concluído');
    this.pulso();
  }

  async transicionar(
    estagio: EstagioCognitivo,
    capacidade: CapacidadeAtiva | null,
    motivo: string,
  ): Promise<void> {
    await this.dep.estado.transicionar(estagio, capacidade);
    this.dep.emitir({ tipo: 'transicao', estagio, capacidade, motivo });
  }

  pulso(): void {
    const s = this.dep.estado.instantaneo();
    this.dep.emitir({ tipo: 'pulso', metricas: s.metricas, leitura: s.leitura });
  }

  log(nivel: 'traco' | 'info' | 'alerta', texto: string): void {
    this.dep.emitir({ tipo: 'log', nivel, texto });
  }
}
