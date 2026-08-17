/**
 * Registro de Operações — o jornal onde a verdade sobre uma escrita sobrevive
 * ao turno, ao processo e ao restart.
 *
 * DOIS PROBLEMAS, UM MECANISMO.
 *
 * D1 — IDEMPOTÊNCIA. Nada impedia que o mesmo efeito não idempotente acontecesse
 * duas vezes. A suíte anterior tinha um teste chamado "operação não idempotente
 * executada duas vezes" que passava — mas ele passava por um motivo frágil:
 * `AgenteLocal.confirmar` apaga a pendência do mapa, então a segunda chamada não
 * acha nada. Isso é consumo-uma-vez de UM slot em memória, específico de UMA
 * habilidade. Não é um contrato, não vale para envio de mensagem, e some no
 * primeiro restart.
 *
 * D2 — PERSISTÊNCIA DA AUTORIZAÇÃO. A pendência vivia num `Map` de um singleton
 * de processo. Isso tem uma propriedade boa e uma péssima. A boa: restart apaga
 * tudo, então restart nunca INVENTA autorização — o lado seguro de falhar. A
 * péssima: restart também apaga toda memória de que a operação existiu, e é aí
 * que mora o defeito real. Uma operação que estava EXECUTANDO quando o processo
 * morreu não deixa rastro nenhum; na volta, a IARA não sabe que ela existiu, e
 * "não sei que existiu" é indistinguível de "nunca aconteceu". O operador pede
 * de novo e o efeito sai duas vezes.
 *
 * A correção não é persistir a autorização — é persistir a OPERAÇÃO. Autorização
 * é um estado dela, e o único que deliberadamente NÃO sobrevive: ver
 * `reidratar`.
 *
 * POR QUE UM JORNAL APPEND-ONLY, e não um registro mutável: porque o momento que
 * mais importa é aquele em que o processo morre no meio. Um arquivo reescrito a
 * cada mudança pode ser encontrado truncado; um jornal só perde a última linha,
 * e a penúltima ainda conta a história. Escrever "vou executar" ANTES de
 * executar é o que transforma um crash em `desconhecida` em vez de em silêncio.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  criarOperacao,
  ehTerminalOperacao,
  evidencia,
  impressaoDoEfeito,
  transicionar,
  type EstadoOperacao,
  type Evidencia,
  type Operacao,
  type SemanticaEfeito,
} from './Operacao';
import type { Risco } from './Habilidade';
import { exigirIdCanonico } from './Identidade';
import { conferirRegistro, selarRegistro, type RegistroSelavel } from './Prova';
import { redigir } from './Configuracao';

const RAIZ_PADRAO = path.join(process.cwd(), 'dados', 'operacoes');

/**
 * Janela do duplo-clique. Ver `impressaoDoEfeito`: dois efeitos não idempotentes
 * idênticos dentro dela são a mesma intenção chegando duas vezes, não duas
 * intenções.
 *
 * Curta de propósito. Longa demais engole o reenvio legítimo ("avisa ele de
 * novo, ele não viu"), que é um defeito silencioso e pior que o duplo envio:
 * pelo menos o duplo envio aparece.
 */
export const JANELA_DUPLO_CLIQUE_MS = 20_000;

export interface PedidoOperacao {
  id_usuario: string;
  sessao: string;
  habilidade: string;
  risco: Risco;
  semantica: SemanticaEfeito;
  parametros: Readonly<Record<string, unknown>>;
  origem_pedido: string;
  validade_ms?: number;
  /**
   * A `origem_pedido` IDENTIFICA A INTENÇÃO sozinha, de forma confiável?
   *
   * Quando sim — o `wamid` da Meta, o id de um evento de fila, um número de
   * pedido — as heurísticas de impressão digital são DESLIGADAS, e só a chave
   * governa. Elas existem para distinguir intenções que não se deixam
   * distinguir; com um identificador único por intenção, distinguir já está
   * feito, e mantê-las passa a causar dano.
   *
   * O DANO, encontrado atacando a própria correção (P0): a resposta do canal
   * WhatsApp não tem verificador, então toda resposta descansa em
   * `aceita_pelo_provedor`. Pela regra de ouro, qualquer resposta FUTURA com o
   * mesmo texto — "Bom dia! Como posso ajudar?" — era bloqueada para sempre. O
   * canal emudeceria depois da primeira frase repetida, e em silêncio, que é o
   * pior modo de falhar.
   *
   * A proteção não é perdida. Duas entregas da MESMA mensagem têm a mesma
   * `origem_pedido`, logo a mesma chave, e a barreira 1 as pega — inclusive
   * depois de restart. O que se desliga é só o palpite sobre intenções que já
   * não precisam ser adivinhadas.
   */
  origem_confiavel?: boolean;
}

/**
 * O que a reserva devolveu.
 *
 * `duplicada` não é erro. É a resposta certa para "isso já está em andamento ou
 * já aconteceu" — e quem recebe precisa CONSULTAR o estado da operação existente
 * em vez de executar. É a diferença entre um sistema que reenvia e um que
 * responde "já mandei".
 */
export type Reserva =
  | { readonly tipo: 'nova'; readonly operacao: Operacao }
  | { readonly tipo: 'duplicada'; readonly operacao: Operacao; readonly motivo: string }
  /**
   * Existe um efeito idêntico que PODE ter acontecido e ninguém verificou.
   *
   * Distinto de `duplicada` de propósito: `duplicada` é "já cuidei disso",
   * `bloqueada` é "não sei se cuidei, e por isso não vou fazer de novo". A
   * segunda é a única resposta segura para uma escrita não idempotente em cima
   * de um `desconhecida` — repetir pode duplicar, ignorar pode omitir, e só
   * consultar o mundo desempata.
   */
  | { readonly tipo: 'bloqueada'; readonly operacao: Operacao; readonly motivo: string };

/**
 * Nome de arquivo derivado do id do operador — nunca informado por ele.
 * Mesma regra dos shards: sondagem cruzada não passa por aqui.
 *
 * RECUSA em vez de SANEAR, e a mudança não é estética. A versão anterior fazia
 * `replace(/[^\p{L}\p{N}_-]/gu, '_')`: uma função que perde informação, e
 * função que perde informação mapeia identidades DISTINTAS no mesmo destino —
 * `"a b"` e `"a_b"` compartilhavam jornal, enquanto `"Ana"` e `"ana"`
 * compartilhavam shard de memória (que minusculiza) e NÃO compartilhavam
 * jornal (que preservava a maiúscula). Cada uma dessas divergências é uma trava
 * de idempotência que não fecha ou um histórico que vaza entre duas pessoas.
 *
 * Ver `Identidade.ts`: identificador se recusa, não se conserta.
 */
function arquivoDe(idUsuario: string): string {
  return `${exigirIdCanonico(idUsuario, 'RegistroOperacoes.arquivoDe')}.jsonl`;
}

/**
 * Estados que uma operação pode legitimamente TER no jornal. Existe para que a
 * reidratação não aceite `estado: "verificada!!"` — ou qualquer outra string —
 * vinda de uma linha que ninguém escreveu.
 */
const ESTADOS_LEGAIS = new Set<string>([
  'planejada',
  'aguardando_autorizacao',
  'autorizada',
  'executando',
  'aceita_pelo_provedor',
  'verificada',
  'falhou',
  'desconhecida',
  'cancelada',
  'expirada',
]);

/**
 * A linha do jornal ANTES de virar operação. `unknown`, não `Operacao`: o
 * `as Operacao` que existia aqui era a asserção mais cara do arquivo — dizia ao
 * compilador que um texto lido do disco tem a forma certa, sem que ninguém
 * tivesse olhado.
 */
function lerLinhaDoJornal(
  bruto: unknown,
  donoEsperado: string,
): { ok: true; operacao: Operacao; selo: unknown } | { ok: false; motivo: string } {
  if (typeof bruto !== 'object' || bruto === null) return { ok: false, motivo: 'não é objeto' };
  const o = bruto as Record<string, unknown>;

  for (const campo of ['id_operacao', 'chave_idempotencia', 'id_usuario', 'habilidade', 'estado']) {
    if (typeof o[campo] !== 'string' || !o[campo]) return { ok: false, motivo: `${campo} ausente` };
  }
  if (!ESTADOS_LEGAIS.has(o.estado as string)) {
    return { ok: false, motivo: `estado inexistente: ${String(o.estado).slice(0, 40)}` };
  }
  if (!Array.isArray(o.historico)) return { ok: false, motivo: 'histórico ausente' };
  if (typeof o.parametros !== 'object' || o.parametros === null) {
    return { ok: false, motivo: 'parâmetros ausentes' };
  }

  /**
   * A CHECAGEM QUE FALTAVA POR INTEIRO: o dono da linha é o dono do arquivo?
   *
   * `reidratar(x)` lia `x.jsonl` e enfiava tudo que encontrasse no índice do
   * PROCESSO — que é compartilhado entre todos os operadores. Uma linha com
   * `id_usuario` de outra pessoa poluía o `porChave` e o `pendentesDeVerdade`
   * dela. O arquivo é derivado do id; discordar dele é, por definição, uma
   * linha que não nasceu deste caminho.
   */
  if (o.id_usuario !== donoEsperado) {
    return { ok: false, motivo: `dono divergente: linha diz ${String(o.id_usuario).slice(0, 40)}` };
  }

  const { selo, ...operacao } = o as Record<string, unknown> & { selo?: unknown };
  return { ok: true, operacao: operacao as unknown as Operacao, selo };
}

export class RegistroOperacoes {
  /** Espelho em memória do jornal. A fonte é o disco; isto é o índice. */
  private readonly operacoes = new Map<string, Operacao>();
  /** chave_idempotencia → id_operacao. */
  private readonly porChave = new Map<string, string>();

  constructor(private readonly raiz: string = RAIZ_PADRAO) {}

  // -------------------------------------------------------------------------
  // Reserva — a barreira de concorrência
  // -------------------------------------------------------------------------

  /**
   * RESERVA A IDENTIDADE. Síncrono de propósito, e isso é a garantia inteira.
   *
   * Node roda este método inteiro sem ceder o laço de eventos: entre o `has` e o
   * `set` não existe ponto de suspensão, logo não existe janela para uma segunda
   * chamada entrar no meio. Duas requisições idênticas que cheguem "ao mesmo
   * tempo" são, na verdade, duas tarefas na fila — a primeira reserva, a segunda
   * encontra reservado. É por isso que este método NÃO é `async` e não pode
   * virar `async` sem reabrir o buraco.
   *
   *     if (!existe) { await gravar(); executar() }   // ← ISTO seria a corrida
   *
   * O `await` no meio de um teste-e-ação é exatamente onde a duplicata nasce. A
   * gravação no jornal vem DEPOIS da reserva, e é assíncrona sem risco: se o
   * processo morrer entre uma coisa e outra, a operação ainda não executou —
   * perder o registro de algo que não aconteceu é seguro.
   *
   * Há um teste concorrente real em `cerebro-escrita-integridade.test.ts`, e um
   * teste de arquitetura que falha se este método ganhar `async`.
   */
  reservar(pedido: PedidoOperacao): Reserva {
    const nova = criarOperacao(pedido);

    // 1. Mesma chave: mesmo turno, mesmo efeito. É retry por definição.
    const idExistente = this.porChave.get(nova.chave_idempotencia);
    if (idExistente) {
      const existente = this.operacoes.get(idExistente)!;
      return {
        tipo: 'duplicada',
        operacao: existente,
        motivo: `mesma chave de idempotência (${existente.estado})`,
      };
    }

    /**
     * As barreiras 2 e 3 são HEURÍSTICAS sobre a identidade da intenção. Quem
     * traz um identificador confiável não precisa delas — e, pior, é prejudicado
     * por elas. Ver `origem_confiavel`.
     */
    if (pedido.semantica === 'escrita_nao_idempotente' && !pedido.origem_confiavel) {
      const impressao = impressaoDoEfeito(pedido);
      const agora = Date.now();

      for (const op of this.operacoes.values()) {
        if (impressaoDoEfeito(op) !== impressao) continue;

        /**
         * 2. A REGRA DE OURO DO RETRY, e ela vem ANTES da janela de tempo.
         *
         * Um efeito não idempotente idêntico ficou em `desconhecida`: o timeout
         * estourou depois de a requisição sair, o processo morreu no meio, o
         * provedor não respondeu. Repetir agora é a decisão que produz o duplo
         * envio — e é exatamente a decisão que um `catch { executeAgain() }`
         * toma sozinho.
         *
         * Sem prazo, de propósito. `desconhecida` não melhora com o tempo:
         * envelhecer uma dúvida não a resolve, só a torna mais confortável de
         * ignorar. O que resolve é `resolverDesconhecida` — alguém CONSULTA o
         * mundo e diz o que encontrou.
         */
        if (op.estado === 'desconhecida' || op.estado === 'aceita_pelo_provedor') {
          return {
            tipo: 'bloqueada',
            operacao: op,
            motivo:
              `um pedido idêntico ${
                op.estado === 'aceita_pelo_provedor'
                  ? 'já foi aceito pelo provedor e não pôde ser confirmado'
                  : 'ficou sem confirmação'
              } (${op.id_operacao}): ${op.historico.at(-1)?.descricao ?? 'sem evidência'}`,
          };
        }

        // 3. Duplo clique: mesma intenção chegando duas vezes em segundos.
        if (op.estado === 'cancelada' || op.estado === 'expirada' || op.estado === 'falhou') continue;
        if (agora - new Date(op.criada_em).getTime() > JANELA_DUPLO_CLIQUE_MS) continue;
        return {
          tipo: 'duplicada',
          operacao: op,
          motivo: `efeito idêntico pedido há instantes (${op.estado})`,
        };
      }
    }

    this.operacoes.set(nova.id_operacao, nova);
    this.porChave.set(nova.chave_idempotencia, nova.id_operacao);
    return { tipo: 'nova', operacao: nova };
  }

  /**
   * Reserva e deixa ESPERANDO UMA FALA HUMANA. É como nasce uma pendência de
   * risco alto.
   *
   * Devolve `null` quando a reserva encontrou duplicata ou bloqueio — armar duas
   * vezes o mesmo efeito irreversível é o começo do duplo disparo, e a resposta
   * certa é apontar a pendência que já existe em vez de criar outra.
   */
  async armar(pedido: PedidoOperacao): Promise<Operacao | null> {
    const reserva = this.reservar(pedido);
    if (reserva.tipo !== 'nova') return null;
    return this.marcar(
      reserva.operacao.id_operacao,
      'aguardando_autorizacao',
      evidencia('porteiro', `risco ${pedido.risco}: exige confirmação explícita antes de executar`),
    );
  }

  // -------------------------------------------------------------------------
  // Estado
  // -------------------------------------------------------------------------

  ler(idOperacao: string): Operacao | null {
    return this.operacoes.get(idOperacao) ?? null;
  }

  todas(): readonly Operacao[] {
    return [...this.operacoes.values()];
  }

  /**
   * A operação que espera uma fala humana NESTE diálogo.
   *
   * A tupla (usuário, sessão) é a chave, não o usuário sozinho. Foi assim que um
   * "confirmo" digitado no navegador deixou de poder liberar uma ação armada
   * pelo WhatsApp — e a mesma regra agora vale para qualquer habilidade de risco
   * alto, não só para energia.
   */
  pendenteDe(idUsuario: string, sessao: string): Operacao | null {
    const agora = Date.now();
    let escolhida: Operacao | null = null;
    for (const op of this.operacoes.values()) {
      if (op.estado !== 'aguardando_autorizacao') continue;
      if (op.id_usuario !== idUsuario || op.sessao !== sessao) continue;
      if (agora > op.expira_em) continue;
      if (!escolhida || op.criada_em > escolhida.criada_em) escolhida = op;
    }
    return escolhida;
  }

  /**
   * Grava uma transição no jornal e só então a dá por feita.
   *
   * A ordem importa e é o contrário da intuição: PRIMEIRO o disco, DEPOIS a
   * memória. Ao contrário, um crash entre as duas coisas deixaria o processo
   * achando que gravou algo que não está lá — e a reidratação seguinte
   * silenciosamente discordaria do que o turno já afirmou ao operador.
   */
  async marcar(idOperacao: string, destino: EstadoOperacao, prova: Evidencia): Promise<Operacao> {
    const atual = this.operacoes.get(idOperacao);
    if (!atual) throw new Error(`operação desconhecida: ${idOperacao}`);

    const proxima = transicionar(atual, destino, prova);
    await this.gravar(proxima);
    this.operacoes.set(idOperacao, proxima);
    return proxima;
  }

  // -------------------------------------------------------------------------
  // Autorização
  // -------------------------------------------------------------------------

  /**
   * Consome uma autorização. As sete portas, e cada uma existe por um caso de
   * ataque que a suíte reproduz:
   *
   *  1. a operação existe;
   *  2. está de fato esperando autorização (não cancelada, não já autorizada,
   *     não já executada) — é isto que impede replay do mesmo "confirmo";
   *  3. o NONCE bate — confirmação de outra operação não serve;
   *  4. o USUÁRIO bate — o "confirmo" de outra pessoa não serve;
   *  5. a SESSÃO bate — o "confirmo" de outro diálogo não serve;
   *  6. a janela não venceu;
   *  7. a fala é do OPERADOR (imposto por `transicionar`: fonte `operador`).
   *
   * Note que nenhuma delas pergunta o que a LLM achou. Não há caminho por onde
   * a camada de raciocínio entre aqui: `autorizar` exige um nonce que só existe
   * dentro do registro, e a evidência é carimbada como `operador` por quem leu
   * a fala humana — não por quem a interpretou.
   */
  async autorizar(entrada: {
    id_operacao: string;
    nonce: string;
    id_usuario: string;
    sessao: string;
    fala: string;
  }): Promise<{ ok: true; operacao: Operacao } | { ok: false; motivo: string }> {
    const op = this.operacoes.get(entrada.id_operacao);
    if (!op) return { ok: false, motivo: 'não existe operação com esse identificador' };

    if (op.estado === 'cancelada') {
      return { ok: false, motivo: 'essa ação foi cancelada; cancelamento não se desfaz com "confirmo"' };
    }
    if (op.estado !== 'aguardando_autorizacao') {
      return {
        ok: false,
        motivo: `essa ação não está aguardando confirmação (está "${op.estado}")`,
      };
    }
    if (op.nonce !== entrada.nonce) {
      return { ok: false, motivo: 'essa confirmação não pertence a esta ação' };
    }
    if (op.id_usuario !== entrada.id_usuario) {
      return { ok: false, motivo: 'quem pediu a ação não foi quem confirmou' };
    }
    if (op.sessao !== entrada.sessao) {
      return {
        ok: false,
        motivo:
          'o pedido foi feito em outra conversa. Confirme por lá, ou repita o pedido aqui — ' +
          'não libero ação irreversível com um "confirmo" que veio de outro contexto',
      };
    }
    if (Date.now() > op.expira_em) {
      await this.marcar(op.id_operacao, 'expirada', evidencia('relogio', 'janela de confirmação vencida'));
      return { ok: false, motivo: 'a janela de confirmação venceu; peça de novo' };
    }

    const autorizada = await this.marcar(
      op.id_operacao,
      'autorizada',
      evidencia('operador', `confirmação explícita: "${entrada.fala.slice(0, 40)}"`),
    );
    return { ok: true, operacao: autorizada };
  }

  /**
   * A ÚNICA saída de `desconhecida` — e ela exige consultar o mundo.
   *
   * Repare no que este método NÃO aceita: um booleano, uma string, um "acho que
   * deu certo". Ele aceita um resultado de VERIFICADOR, e a assinatura é o
   * contrato: quem quiser converter uma dúvida em verdade precisa ter ido
   * conferir. `transicionar` recusa qualquer outra fonte para `verificada`, de
   * modo que nem este método consegue burlar a regra que ele implementa.
   *
   * É o fluxo do Caso F, inteiro:
   *
   *     UNKNOWN → consultar o mundo → efeito existe → VERIFIED
   *     UNKNOWN → consultar o mundo → efeito não existe → FAILED (pode refazer)
   */
  async resolverDesconhecida(
    idOperacao: string,
    apuracao: { readonly confirmado: boolean; readonly evidencia: string },
  ): Promise<Operacao> {
    const op = this.operacoes.get(idOperacao);
    if (!op) throw new Error(`operação desconhecida: ${idOperacao}`);
    if (op.estado !== 'desconhecida') {
      throw new Error(`operação ${idOperacao} não está em "desconhecida" (está "${op.estado}")`);
    }
    return this.marcar(
      idOperacao,
      apuracao.confirmado ? 'verificada' : 'falhou',
      evidencia('verificador', apuracao.evidencia),
    );
  }

  /** Cancelar é definitivo. A máquina de estados garante que não há volta. */
  async cancelar(idOperacao: string, motivo: string): Promise<Operacao | null> {
    const op = this.operacoes.get(idOperacao);
    if (!op || ehTerminalOperacao(op.estado)) return null;
    return this.marcar(idOperacao, 'cancelada', evidencia('operador', motivo));
  }

  /** Varre e fecha o que venceu. Chamado antes de cada leitura de pendência. */
  async expirarVencidas(): Promise<number> {
    const agora = Date.now();
    const vencidas = [...this.operacoes.values()].filter(
      (o) =>
        agora > o.expira_em &&
        (o.estado === 'planejada' || o.estado === 'aguardando_autorizacao' || o.estado === 'autorizada'),
    );
    for (const op of vencidas) {
      await this.marcar(op.id_operacao, 'expirada', evidencia('relogio', 'janela vencida'));
    }
    return vencidas.length;
  }

  // -------------------------------------------------------------------------
  // Persistência
  // -------------------------------------------------------------------------

  /**
   * Grava a linha SELADA. O selo é HMAC sobre os campos do registro — ver
   * `Prova.ts` — e é o que permite a `reidratar` distinguir uma linha que este
   * processo escreveu de uma linha que alguém colocou onde ele escreve.
   *
   * Sem `IARA_CHAVE_PROVA` o selo sai vazio, e a validação de volta degrada
   * para estrutural. Isso é dito em voz alta na subida, não escondido aqui.
   */
  private async gravar(op: Operacao): Promise<void> {
    await mkdir(this.raiz, { recursive: true });

    /**
     * REDIGIR ANTES DE SELAR, e a ordem é a correção — não o gosto.
     *
     * O jornal guarda `parametros`, e parâmetro é texto que veio do operador: no
     * dia em que ele colar uma credencial dentro do pedido ("manda pra Vânia
     * minha chave sk-…"), ela fica em claro num `.jsonl` append-only, para
     * sempre, legível por qualquer processo da máquina. Medido pela bateria
     * `exfiltracao` em 17/08/2026 — o jornal era a terceira porta sem a
     * propriedade que o socket tem desde 13/08.
     *
     * Redigir DEPOIS de selar seria pior que não redigir: o selo cobriria o
     * conteúdo cru, a linha gravada seria a redigida, e a reidratação seguinte
     * recalcularia um HMAC diferente — o jornal inteiro passaria a se declarar
     * comprometido. A redação entra antes, e o selo passa a cobrir exatamente os
     * bytes que estão no disco.
     *
     * A `chave_idempotencia` é campo próprio, derivado na criação com os
     * parâmetros ainda crus: ela sobrevive à redação, e a deduplicação depois de
     * um restart continua reconhecendo o mesmo efeito.
     */
    const seguro = JSON.parse(redigir(JSON.stringify(op))) as Operacao;
    const selo = selarRegistro(seguro as unknown as RegistroSelavel);
    await appendFile(
      path.join(this.raiz, arquivoDe(op.id_usuario)),
      `${JSON.stringify({ ...seguro, selo })}\n`,
      'utf8',
    );
  }

  /**
   * Linhas de jornal recusadas na última reidratação, para diagnóstico e para
   * o teste de invariante. Uma linha aqui é sempre uma de duas coisas: um
   * jornal de versão anterior à selagem, ou adulteração. Nenhuma das duas pode
   * passar em silêncio.
   */
  private readonly quarentena: Array<{ motivo: string; trecho: string }> = [];

  get linhasRecusadas(): readonly { motivo: string; trecho: string }[] {
    return this.quarentena;
  }

  /**
   * RECONSTRÓI A VERDADE DEPOIS DE UM RESTART — do jornal, nunca da memória
   * textual da conversa.
   *
   * Duas regras governam a volta, e as duas são sobre não inventar:
   *
   * 1. AUTORIZAÇÃO NÃO SOBREVIVE. Toda operação encontrada em
   *    `aguardando_autorizacao` ou `autorizada` volta como `expirada`. Não é
   *    conservadorismo decorativo: uma autorização é uma fala humana dita a um
   *    processo que não existe mais, e não há como saber, do outro lado do
   *    restart, se o operador ainda quer aquilo. Recusar e pedir de novo custa
   *    uma frase; executar custa o efeito. E `autorizada` volta expirada junto
   *    com `aguardando_autorizacao` de propósito — uma autorização concedida e
   *    não consumida é justamente a que ficaria pendurada esperando um executor
   *    que já morreu.
   *
   * 2. `executando` VOLTA COMO `desconhecida`, NUNCA COMO `falhou`. O processo
   *    morreu com o efeito possivelmente em voo. Chamar isso de falha autoriza
   *    um retry que duplica; chamar de sucesso é mentira. "Não sei" é o único
   *    valor verdadeiro, e é o valor que obriga a perguntar ao mundo antes de
   *    qualquer nova tentativa.
   */
  async reidratar(idUsuario: string): Promise<readonly Operacao[]> {
    let bruto: string;
    try {
      bruto = await readFile(path.join(this.raiz, arquivoDe(idUsuario)), 'utf8');
    } catch {
      return [];
    }

    const dono = exigirIdCanonico(idUsuario, 'RegistroOperacoes.reidratar');
    this.quarentena.length = 0;

    const recusar = (motivo: string, linha: string) => {
      this.quarentena.push({ motivo, trecho: linha.slice(0, 120) });
      console.warn(
        JSON.stringify({
          canal: 'auditoria',
          acao: 'jornal_linha_recusada',
          id_usuario: dono,
          permitido: false,
          detalhe: motivo,
        }),
      );
    };

    // Última linha por operação vence: o jornal é cronológico.
    const ultimas = new Map<string, Operacao>();
    for (const linha of bruto.split('\n')) {
      if (!linha.trim()) continue;

      let cru: unknown;
      try {
        cru = JSON.parse(linha);
      } catch {
        // Linha truncada por um crash no meio da escrita. Descartar a última
        // linha corrompida é seguro: o estado anterior daquela operação já está
        // no jornal, e é ele que vale. NÃO vai para a quarentena — é o defeito
        // esperado de um append-only, não um sinal de adulteração.
        continue;
      }

      /**
       * VALIDAÇÃO ESTRUTURAL, e ela vale mesmo sem chave nenhuma: formato,
       * estado legal e — sobretudo — DONO. Ver `lerLinhaDoJornal`.
       */
      const lida = lerLinhaDoJornal(cru, dono);
      if (!lida.ok) {
        recusar(lida.motivo, linha);
        continue;
      }

      /**
       * VALIDAÇÃO CRIPTOGRÁFICA. `sem_chave` não é sucesso — é a admissão de
       * que não há o que conferir, e ela segue com o que a estrutura garantiu.
       * `invalido` com chave ativa é adulteração, e adulteração não entra no
       * índice: uma linha forjada em `verificada` faria a IARA jurar ter
       * conferido um efeito que nunca existiu.
       */
      const veredito = conferirRegistro(lida.operacao as unknown as RegistroSelavel, lida.selo);
      if (veredito === 'invalido') {
        recusar('selo ausente ou inválido — linha não nasceu deste sistema', linha);
        continue;
      }

      ultimas.set(lida.operacao.id_operacao, lida.operacao);
    }

    const recuperadas: Operacao[] = [];
    for (const op of ultimas.values()) {
      let volta = op;

      if (op.estado === 'aguardando_autorizacao' || op.estado === 'autorizada') {
        volta = transicionar(
          op,
          'expirada',
          evidencia('reidratacao', 'o processo reiniciou; autorização não atravessa restart'),
        );
        await this.gravar(volta);
      } else if (op.estado === 'executando') {
        volta = transicionar(
          op,
          'desconhecida',
          evidencia(
            'reidratacao',
            'o processo morreu durante a execução; o efeito pode existir e não foi verificado',
          ),
        );
        await this.gravar(volta);
      }

      this.operacoes.set(volta.id_operacao, volta);
      // A chave volta ao índice: é o que faz um retry pós-restart encontrar a
      // operação anterior em vez de criar uma nova e duplicar o efeito.
      this.porChave.set(volta.chave_idempotencia, volta.id_operacao);
      recuperadas.push(volta);
    }
    return recuperadas;
  }

  /**
   * Operações cujo efeito PODE existir e que ninguém verificou.
   *
   * É a lista que a IARA precisa consultar antes de repetir qualquer coisa, e a
   * que ela deve mostrar ao operador depois de um restart. Uma operação aqui não
   * é um erro — é uma pergunta em aberto.
   */
  pendentesDeVerdade(idUsuario: string): readonly Operacao[] {
    return [...this.operacoes.values()].filter(
      (o) =>
        o.id_usuario === idUsuario &&
        (o.estado === 'desconhecida' || o.estado === 'aceita_pelo_provedor'),
    );
  }
}

/**
 * INSTÂNCIA ÚNICA DO PROCESSO — e a razão dela é um defeito encontrado atacando
 * a própria correção (auditoria de terceira ordem).
 *
 * O Kernel é UM POR SESSÃO, e o mesmo operador tem mais de uma: `Porta.ts` cria
 * um kernel para o navegador e `PortaWhatsapp.ts` cria outro para o WhatsApp.
 * Enquanto cada kernel construía o próprio registro, os dois escreviam no MESMO
 * arquivo de jornal e mantinham ÍNDICES SEPARADOS em memória — de modo que a
 * deduplicação valia dentro de um canal e não valia entre canais. "Avisa o João"
 * pedido no navegador e repetido no WhatsApp passaria pelas duas reservas e
 * produziria dois envios.
 *
 * O erro é do mesmo formato do que a auditoria anterior encontrou na pendência
 * de energia: uma trava correta, amarrada numa granularidade errada.
 * `agenteLocal` já era singleton por esse exato motivo, e este precisa ser pelo
 * mesmo.
 *
 * LIMITE, declarado em vez de escondido: isto dedupica dentro de UM PROCESSO.
 * Duas instâncias do motor rodando contra o mesmo `dados/` não são cobertas — o
 * jornal é append-only e não há trava entre processos. Ver o relatório: a
 * garantia é "no máximo uma vez por processo", não "exatamente uma vez".
 */
export const registroOperacoes = new RegistroOperacoes();
