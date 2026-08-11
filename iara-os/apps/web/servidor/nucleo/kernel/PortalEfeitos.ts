/**
 * Portal de Efeitos — a ÚNICA fronteira por onde a IARA alcança o mundo.
 *
 * O DEFEITO QUE ESTE ARQUIVO ELIMINA, e ele não é sobre WhatsApp:
 *
 *   `PortaWhatsapp.atender()` chamava `WhatsApp.responder()`, que fazia POST ao
 *   Graph da Meta. Uma mensagem saía para uma pessoa sem operação, sem
 *   identidade, sem idempotência, sem verificador e sem uma linha de jornal.
 *   Corrigir isso no WhatsApp teria consertado UM caso e deixado a classe
 *   inteira aberta: a próxima integração — e-mail, Graph, um webhook — nasceria
 *   com a mesma porta dos fundos, porque nada na arquitetura a impedia.
 *
 * A correção é estrutural. Existe UM objeto que sabe executar efeito, e ele é
 * este. Quem quiser alcançar o mundo passa por aqui ou não passa.
 *
 * O QUE ESTE PORTAL NÃO FAZ, e é tão importante quanto o que faz:
 *
 *   ELE NÃO DECIDE SE UMA AÇÃO É PERMITIDA.
 *
 * A decisão de autorizar pertence a quem lê a intenção — `PoliticaRisco`,
 * `PorteiroAutorizacao`, a fala do operador. O portal recebe uma autorização já
 * tomada, sob a forma de uma FONTE DE EVIDÊNCIA, e garante que a operação
 * aconteça sob o contrato certo. Misturar as duas responsabilidades faria do
 * portal um segundo lugar onde política mora — e política em dois lugares é
 * política em nenhum.
 *
 * A SEQUÊNCIA, e ela é a mesma para habilidade local e para provedor externo:
 *
 *   reservar identidade  (deduplicação e concorrência, síncrono)
 *        ↓
 *   autorizar            (fonte tipada; risco alto exige `operador`)
 *        ↓
 *   JORNAL: executando   (no disco ANTES do efeito)
 *        ↓
 *   executar             (habilidade ou integração)
 *        ↓
 *   JORNAL: resultado    (aceite do provedor NÃO é entrega)
 *        ↓
 *   verificar            (confere o MUNDO)
 *        ↓
 *   estado verdadeiro
 */

import type { BarramentoEventos } from './BarramentoEventos';
import type { Risco, Verificacao } from './Habilidade';
import { HabilidadeExpirou } from './Habilidade';
import {
  evidencia,
  podeExecutar,
  type EstadoOperacao,
  type FonteEvidencia,
  type Operacao,
  type SemanticaEfeito,
} from './Operacao';
import type { RegistroOperacoes } from './RegistroOperacoes';

// ---------------------------------------------------------------------------
// 1. O contrato de uma integração
// ---------------------------------------------------------------------------

/**
 * O que o provedor respondeu. NUNCA um booleano solto.
 *
 * `aceito: true` quer dizer "o provedor recebeu e enfileirou", e é tudo que um
 * `200 OK` prova. Não quer dizer entregue, não quer dizer lido, não quer dizer
 * aplicado. A `referencia` é o identificador que o provedor atribuiu — é ela que
 * permite, mais tarde, PERGUNTAR se aconteceu.
 */
export interface RespostaProvedor {
  readonly aceito: boolean;
  /** Id atribuído pelo provedor (`wamid`, id de mensagem, etc.). */
  readonly referencia?: string;
  /** Uma linha para o jornal. Nunca payload cru, nunca credencial. */
  readonly detalhe: string;
}

export interface PedidoIntegracao {
  readonly id_usuario: string;
  readonly sessao: string;
  readonly parametros: Readonly<Record<string, unknown>>;
  /**
   * A chave de idempotência da operação, para PROPAGAR ao provedor quando ele
   * souber recebê-la. Ver `RELATORIO`: propagar é o que transforma "no máximo
   * uma vez local" em "efetivamente uma vez" — e só o provedor pode conceder
   * isso. Quem não aceita a chave, ignora este campo, e a garantia declarada
   * continua sendo a local.
   */
  readonly chave_idempotencia: string;
  readonly sinal: AbortSignal;
}

/**
 * UM ADAPTADOR. Ela executa o contrato que recebeu e devolve evidência.
 *
 * Repare no que a interface NÃO permite dizer: não há como uma integração
 * devolver "autorizado", "confirmado" ou "verificado". `executar` devolve o que
 * o PROVEDOR respondeu; `verificar` devolve o que o MUNDO mostrou. O veredito é
 * do portal, e o portal o deriva dos dois — nunca da opinião do adaptador.
 */
export interface Integracao {
  /** `whatsapp.responder`, `graph.enviar_email`. Verbo + destino. */
  readonly id: string;
  readonly nome: string;
  readonly risco: Risco;
  readonly semantica: SemanticaEfeito;
  readonly timeout_ms: number;
  /** Falta credencial? Devolve o motivo. `null` = pronta. */
  indisponivelPorque?(): string | null;
  executar(pedido: PedidoIntegracao): Promise<RespostaProvedor>;
  /**
   * Confere o MUNDO. A ausência é significativa e honesta: quer dizer que o
   * provedor não oferece meio de conferir, e a operação descansa em
   * `aceita_pelo_provedor` — nunca em `verificada`.
   */
  verificar?(resposta: RespostaProvedor, pedido: PedidoIntegracao): Promise<Verificacao>;
}

// ---------------------------------------------------------------------------
// 2. O que o portal devolve
// ---------------------------------------------------------------------------

export type ResultadoPortal =
  | {
      readonly tipo: 'executada';
      readonly operacao: Operacao;
      readonly resposta: RespostaProvedor;
      readonly verificacao: Verificacao | null;
    }
  /** Não executou, e o motivo importa: duplicata, bloqueio, recusa, ausência. */
  | { readonly tipo: 'recusada'; readonly motivo: string; readonly operacao: Operacao | null };

export class EfeitoRecusado extends Error {}

// ---------------------------------------------------------------------------

export class PortalEfeitos {
  private readonly integracoes = new Map<string, Integracao>();

  constructor(
    private readonly registro: RegistroOperacoes,
    private readonly barramento?: BarramentoEventos,
  ) {}

  registrar(integracao: Integracao): void {
    if (this.integracoes.has(integracao.id)) {
      throw new Error(`integração duplicada: ${integracao.id}`);
    }
    this.integracoes.set(integracao.id, integracao);
  }

  registrarTodas(lista: readonly Integracao[]): void {
    for (const i of lista) this.registrar(i);
  }

  tem(id: string): boolean {
    return this.integracoes.has(id);
  }

  catalogo(): readonly string[] {
    return [...this.integracoes.keys()];
  }

  // -------------------------------------------------------------------------
  // ABRIR — identidade, deduplicação, autorização, jornal. Antes do efeito.
  // -------------------------------------------------------------------------

  /**
   * Dá identidade a uma escrita e a deixa pronta para executar.
   *
   * Usado pelos DOIS caminhos — o passo de plano do Kernel e a integração
   * externa — porque a pergunta "posso deixar isto acontecer, e sob que
   * identidade?" é a mesma nos dois. Era estar escrita só dentro do laço de
   * passos do Kernel que permitia ao canal WhatsApp não fazê-la.
   *
   * `null` em `operacao` significa LEITURA: sem efeito para duplicar, sem
   * identidade persistida. É a única saída sem jornal, e é deliberada.
   */
  async abrir(pedido: {
    id_usuario: string;
    sessao: string;
    acao: string;
    risco: Risco;
    semantica: SemanticaEfeito;
    parametros: Readonly<Record<string, unknown>>;
    origem_pedido: string;
    /**
     * QUEM autorizou — já decidido por quem tinha competência para decidir. O
     * portal não escolhe este valor; ele o aplica, e `transicionar` recusa
     * `porteiro` para risco alto.
     */
    fonte_autorizacao: Extract<FonteEvidencia, 'operador' | 'porteiro'>;
    motivo_autorizacao: string;
    /** A `origem_pedido` identifica a intenção sozinha? Ver `PedidoOperacao`. */
    origem_confiavel?: boolean;
  }): Promise<
    { ok: true; operacao: Operacao | null } | { ok: false; estado: EstadoOperacao; motivo: string }
  > {
    if (pedido.semantica === 'leitura') return { ok: true, operacao: null };

    if (!podeExecutar(pedido.semantica)) {
      return {
        ok: false,
        estado: 'falhou',
        motivo:
          `"${pedido.acao}" não declara o que acontece se for executada duas vezes ` +
          '(efeito_desconhecido). Não executo o que ninguém soube classificar.',
      };
    }

    const reserva = this.registro.reservar({
      id_usuario: pedido.id_usuario,
      sessao: pedido.sessao,
      habilidade: pedido.acao,
      risco: pedido.risco,
      semantica: pedido.semantica,
      parametros: pedido.parametros,
      origem_pedido: pedido.origem_pedido,
      origem_confiavel: pedido.origem_confiavel,
    });

    if (reserva.tipo === 'bloqueada') {
      return {
        ok: false,
        estado: 'desconhecida',
        motivo:
          `não repeti "${pedido.acao}" porque ${reserva.motivo}. ` +
          'Confira se já aconteceu antes de pedir de novo — repetir isto duplicaria o efeito.',
      };
    }
    if (reserva.tipo === 'duplicada') {
      return {
        ok: false,
        estado: reserva.operacao.estado,
        motivo: `não repeti "${pedido.acao}": ${reserva.motivo}`,
      };
    }

    const op = reserva.operacao;
    try {
      const autorizada = await this.registro.marcar(
        op.id_operacao,
        'autorizada',
        evidencia(pedido.fonte_autorizacao, pedido.motivo_autorizacao),
      );
      const executando = await this.registro.marcar(
        autorizada.id_operacao,
        'executando',
        evidencia('executor', 'jornal gravado antes de o efeito acontecer'),
      );
      return { ok: true, operacao: executando };
    } catch (erro) {
      await this.registro
        .marcar(op.id_operacao, 'falhou', evidencia('porteiro', (erro as Error).message))
        .catch(() => null);
      return { ok: false, estado: 'falhou', motivo: (erro as Error).message };
    }
  }

  /**
   * Fecha a operação com o que se APUROU.
   *
   * Traduz o vocabulário de evidência para o ciclo de vida persistido, e a
   * tradução é o ponto: `verificada` só sai daqui carregando prova de fonte
   * `verificador`. Qualquer outra fonte faz `transicionar` lançar.
   */
  async fechar(
    operacao: Operacao | null,
    destino: EstadoOperacao,
    fonte: FonteEvidencia,
    descricao: string,
  ): Promise<void> {
    if (!operacao) return;
    await this.registro
      .marcar(operacao.id_operacao, destino, evidencia(fonte, descricao))
      /**
       * Falha ao FECHAR não derruba o turno — o efeito já aconteceu e o operador
       * precisa da resposta. A operação fica em `executando`, e a reidratação a
       * converte em `desconhecida`: exatamente o tratamento de um crash, que é
       * exatamente o que isto é.
       */
      .catch((erro) => {
        this.barramento?.publicar({
          tipo: 'FALHA',
          modulo: 'portal_efeitos',
          mensagem: `não consegui fechar ${operacao.id_operacao}: ${(erro as Error).message}`,
        });
      });
  }

  // -------------------------------------------------------------------------
  // EXECUTAR — a sequência inteira, para efeito de PROVEDOR EXTERNO
  // -------------------------------------------------------------------------

  /**
   * O caminho completo de uma integração. É o método que o canal WhatsApp passa
   * a usar no lugar do `fetch` direto.
   *
   * Toda a diferença entre isto e o que existia está em três linhas: a operação
   * existe antes da requisição, o resultado do provedor é registrado como ACEITE
   * (não como entrega), e a verificação — quando existe — é quem promove.
   */
  async executar(pedido: {
    integracao: string;
    id_usuario: string;
    sessao: string;
    parametros: Readonly<Record<string, unknown>>;
    origem_pedido: string;
    fonte_autorizacao: Extract<FonteEvidencia, 'operador' | 'porteiro'>;
    motivo_autorizacao: string;
    origem_confiavel?: boolean;
    sinal?: AbortSignal;
  }): Promise<ResultadoPortal> {
    const integracao = this.integracoes.get(pedido.integracao);
    if (!integracao) {
      return { tipo: 'recusada', motivo: `integração desconhecida: ${pedido.integracao}`, operacao: null };
    }

    const indisponivel = integracao.indisponivelPorque?.();
    if (indisponivel) {
      return {
        tipo: 'recusada',
        motivo: `${integracao.id} indisponível: ${indisponivel}`,
        operacao: null,
      };
    }

    const abertura = await this.abrir({
      id_usuario: pedido.id_usuario,
      sessao: pedido.sessao,
      acao: integracao.id,
      risco: integracao.risco,
      semantica: integracao.semantica,
      parametros: pedido.parametros,
      origem_pedido: pedido.origem_pedido,
      fonte_autorizacao: pedido.fonte_autorizacao,
      motivo_autorizacao: pedido.motivo_autorizacao,
      origem_confiavel: pedido.origem_confiavel,
    });

    if (!abertura.ok) {
      return { tipo: 'recusada', motivo: abertura.motivo, operacao: null };
    }
    // Integração nunca é leitura; `abrir` só devolve `null` para `leitura`.
    const operacao = abertura.operacao!;

    const contexto: PedidoIntegracao = {
      id_usuario: pedido.id_usuario,
      sessao: pedido.sessao,
      parametros: pedido.parametros,
      chave_idempotencia: operacao.chave_idempotencia,
      sinal: pedido.sinal ?? new AbortController().signal,
    };

    let resposta: RespostaProvedor;
    try {
      resposta = await comRelogio(
        integracao.executar(contexto),
        integracao.timeout_ms,
        integracao.id,
      );
    } catch (erro) {
      /**
       * O PROVEDOR PODE TER RECEBIDO. Timeout, socket cortado, processo do outro
       * lado que aplicou e não respondeu — em todos, a requisição pode ter
       * chegado. Chamar isso de falha autoriza um retry que duplica.
       *
       * A resposta honesta é `desconhecida`, e ela BLOQUEIA repetição de efeito
       * não idempotente até alguém consultar o mundo.
       */
      await this.fechar(
        operacao,
        'desconhecida',
        'executor',
        `${(erro as Error).message} — a requisição pode ter chegado ao provedor`,
      );
      return {
        tipo: 'recusada',
        motivo: `não consigo provar o que aconteceu: ${(erro as Error).message}`,
        operacao: this.registro.ler(operacao.id_operacao),
      };
    }

    if (!resposta.aceito) {
      // O provedor RECUSOU explicitamente. Isto é fato apurado, não dúvida.
      await this.fechar(operacao, 'falhou', 'provedor', resposta.detalhe);
      return {
        tipo: 'recusada',
        motivo: `o provedor recusou: ${resposta.detalhe}`,
        operacao: this.registro.ler(operacao.id_operacao),
      };
    }

    /**
     * ACEITE ≠ ENTREGA. Esta linha é o coração do arquivo.
     *
     * O provedor devolveu 200 e um identificador. Registra-se exatamente isso —
     * nem mais, nem menos — e a promoção a `verificada` fica para quem conferir
     * o mundo.
     */
    await this.fechar(
      operacao,
      'aceita_pelo_provedor',
      'provedor',
      resposta.referencia ? `${resposta.detalhe} (ref ${resposta.referencia})` : resposta.detalhe,
    );

    if (!integracao.verificar) {
      return {
        tipo: 'executada',
        operacao: this.registro.ler(operacao.id_operacao)!,
        resposta,
        verificacao: null,
      };
    }

    let verificacao: Verificacao;
    try {
      verificacao = await comRelogio(
        integracao.verificar(resposta, contexto),
        integracao.timeout_ms,
        `verificação de ${integracao.id}`,
      );
    } catch (erro) {
      verificacao = {
        confirmado: false,
        evidencia: `a verificação falhou: ${(erro as Error).message}`,
        motivo: 'sem_meio_de_verificar',
      };
    }

    if (verificacao.confirmado) {
      await this.fechar(operacao, 'verificada', 'verificador', verificacao.evidencia);
    } else if (verificacao.motivo === 'divergente') {
      // O provedor aceitou e o mundo desmente. Isto É falha.
      await this.fechar(operacao, 'falhou', 'verificador', verificacao.evidencia);
    }
    /**
     * `sem_meio_de_verificar` e `nao_encontrado` DESCANSAM em
     * `aceita_pelo_provedor`, sem transição.
     *
     * Rebaixar para `desconhecida` perderia informação: "o provedor aceitou e
     * não há como conferir" sabe estritamente mais que "não sei de nada". Os
     * dois estados bloqueiam repetição de efeito não idempotente do mesmo jeito
     * — ver `RegistroOperacoes.reservar` —, então a proteção é idêntica e a
     * honestidade é maior.
     */

    return {
      tipo: 'executada',
      operacao: this.registro.ler(operacao.id_operacao)!,
      resposta,
      verificacao,
    };
  }
}

/**
 * Relógio que não deixa promessa pendurada. Mesmo desenho do
 * `GerenciadorHabilidades`: uma trava não pode depender da boa vontade do código
 * que ela existe para conter, e respeitar `AbortSignal` é escolha de quem
 * escreve a integração.
 */
async function comRelogio<T>(promessa: Promise<T>, ms: number, quem: string): Promise<T> {
  let relogio: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        relogio = setTimeout(() => rejeitar(new HabilidadeExpirou(`${quem} passou de ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (relogio) clearTimeout(relogio);
  }
}
