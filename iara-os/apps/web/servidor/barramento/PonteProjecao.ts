/**
 * Ponte entre o barramento do kernel e a sessão do operador.
 *
 * É o ÚNICO ponto do sistema onde algo interno vira algo externo. Ela assina
 * o barramento, pede o snapshot compilado e entrega à sessão. Nenhum outro
 * módulo tem acesso ao socket.
 *
 * Duas responsabilidades que precisam morar juntas:
 *
 *  - **Aglutinação temporal.** Um turno publica dezenas de eventos em poucos
 *    milissegundos. Se cada um virasse um snapshot, o React re-renderizaria
 *    dezenas de vezes por turno. A ponte junta a rajada numa janela e emite
 *    uma vez — exceto a fala, que sai na hora, porque latência percebida é o
 *    produto.
 *
 *  - **Tradução de evento em log técnico.** O console mostra o raciocínio do
 *    kernel; a sala mostra o efeito. Nunca o contrário.
 */

import type { BarramentoEventos } from '../nucleo/kernel/BarramentoEventos';
import type { CompiladorSnapshot } from '../nucleo/kernel/CompiladorSnapshot';
import type { EstadoAtomico } from '../nucleo/EstadoAtomico';
import type { EventoKernel } from '../nucleo/kernel/Evento';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import { aquecerVoz, caminhoDaVoz, sintetizar, vozDisponivel } from '../nucleo/Voz';
import type { SessaoOperador } from './SessaoOperador';

const JANELA_MS = 50;

export class PonteProjecao {
  private pendente: NodeJS.Timeout | null = null;
  private encerrada = false;
  private readonly desassinar: () => void;
  /**
   * Assinatura estrutural do último snapshot emitido. Snapshot idêntico não é
   * reemitido: sem isto, o "respirar" do ciclo autônomo (15 s) e qualquer
   * evento que não mudou nada visível faziam TODAS as telas re-renderizar a
   * aplicação inteira em idle — `seq` e `instante` são novos a cada emissão,
   * então a comparação precisa ignorá-los.
   */
  private ultimaAssinatura = '';
  /**
   * Falas cuja síntese está EM VOO agora. É o que `voz_prevista` publica.
   *
   * Antes `voz_prevista` era `vozDisponivel()` — uma leitura de CONFIGURAÇÃO,
   * não um fato sobre esta fala. Ela dizia "o servidor tem voz ligada", e o
   * cliente lia como "o áudio desta resposta vem aí". Quando a síntese falhava,
   * o servidor sabia disso e não contava a ninguém: o cliente esperava um timer
   * cego de 6 s antes de deixar o navegador falar. Era esse timer, somado ao
   * kernel, que produzia os ~7 s até a IARA abrir a boca.
   *
   * Agora o conjunto esvazia quando a síntese termina — de qualquer jeito. Se
   * deu certo, `voz` carrega o áudio; se falhou, `voz_prevista` cai para falso
   * no mesmo instante e o navegador assume sem esperar nada.
   */
  private readonly vozEmVoo = new Set<string>();

  constructor(
    private readonly barramento: BarramentoEventos,
    private readonly compilador: CompiladorSnapshot,
    private readonly estado: EstadoAtomico,
    /**
     * Referência VIVA ao conjunto de espelhos do residente: telas entram e
     * saem sem a ponte precisar saber. Cada sessão carimba o próprio `seq`.
     */
    private readonly sessoes: ReadonlySet<SessaoOperador>,
  ) {
    this.desassinar = barramento.assinarTudo((e) => this.aoEvento(e));
  }

  encerrar(): void {
    this.encerrada = true;
    this.desassinar();
    if (this.pendente) clearTimeout(this.pendente);
    this.pendente = null;
    this.vozEmVoo.clear();
  }

  /** Snapshot imediato — usado na conexão e na reconexão. */
  hidratar(): void {
    // Hidratação nunca é deduplicada: a tela que acabou de (re)conectar zerou
    // a guarda de sequência e precisa do estado consolidado, igual ou não.
    this.emitir(true);
  }

  private aoEvento(e: EventoKernel): void {
    /**
     * A conexão de voz abre AQUI, no começo do turno — não quando o texto fica
     * pronto.
     *
     * `DECISAO_TOMADA` é o primeiro instante em que se sabe que vai haver
     * resposta, e faltam ainda os segundos de geração. O aperto de mão com o
     * serviço de síntese (~1 s) cabe inteiro nessa janela, e deixa de somar ao
     * silêncio que o operador escuta depois de a frase aparecer na tela.
     *
     * Não é picotar a fala: o áudio continua sendo sintetizado uma vez, sobre o
     * texto final, com uma prosódia só. O que mudou foi QUANDO o socket abre.
     */
    if (e.tipo === 'DECISAO_TOMADA') aquecerVoz();

    const log = this.traduzir(e);
    if (log) for (const sessao of this.sessoes) sessao.emitirLog(log.nivel, log.texto);

    // Fala não espera a janela.
    if (e.tipo === 'RESPOSTA_TRECHO' || e.tipo === 'TAREFA_CONCLUIDA') {
      /**
       * A síntese é MARCADA antes de o snapshot sair, e não depois.
       *
       * A ordem é o ponto: `emitir()` publica `voz_prevista`, então marcar
       * depois faria o primeiro snapshot com `concluida: true` — justamente o
       * que o cliente usa para decidir se espera o áudio — sair dizendo que
       * não vem voz nenhuma. O navegador falaria por cima do áudio que chegava
       * meio segundo depois.
       */
      if (e.tipo === 'TAREFA_CONCLUIDA') {
        const vocalizavel = vozDisponivel() && e.texto.trim().length > 0;
        if (vocalizavel) this.vozEmVoo.add(e.id_mensagem);
        this.emitir();
        // A voz é sintetizada sobre o texto FINAL, uma vez por turno.
        // Sintetizar trecho a trecho picotaria a fala em pedaços com prosódia
        // própria — e, medido em 12/08, cada pedaço pagaria um handshake novo
        // de ~1 s: a fala começaria mais TARDE. Ver `scripts/medir-voz.ts`.
        if (vocalizavel) this.vocalizar(e.id_mensagem, e.texto);
        return;
      }
      this.emitir();
      return;
    }
    this.agendar();
  }

  /**
   * Dispara a síntese e reemite quando o resultado é conhecido — CERTO OU
   * ERRADO.
   *
   * Deliberadamente fora do caminho de resposta: o texto já chegou na tela e o
   * operador já pode ler. Se a síntese demorar ou falhar, o turno inteiro
   * continua válido — só sai mudo, e o navegador assume a voz.
   *
   * O `finally` é o que conserta a latência: a falha é publicada com a mesma
   * pressa que o sucesso. Um `if (ok)` aqui deixaria o cliente esperando um
   * áudio que nunca vem, que é exatamente o defeito que o timer de 6 s tentava
   * remendar do outro lado da fronteira.
   */
  private vocalizar(idMensagem: string, texto: string): void {
    void sintetizar(idMensagem, texto)
      .catch(() => false)
      .then(() => {
        this.vozEmVoo.delete(idMensagem);
        // `encerrar()` pode ter rodado enquanto a rede respondia.
        if (!this.encerrada) this.emitir();
      });
  }

  private agendar(): void {
    if (this.pendente) return;
    this.pendente = setTimeout(() => {
      this.pendente = null;
      this.emitir();
    }, JANELA_MS);
    this.pendente.unref?.();
  }

  private emitir(forcar = false): void {
    const base = this.estado.instantaneo();
    // Descartes somados: a telemetria é do operador, não de uma tela.
    let descartados = 0;
    for (const sessao of this.sessoes) descartados += sessao.descartados;
    const snapshot = this.compilador.compilar(
      base,
      base.operador?.id_usuario ?? 'anonimo',
      descartados,
    );
    const pronto = this.comVoz(snapshot);

    // `seq` e `instante` mudam a cada compilação mesmo com estado idêntico —
    // zerados na assinatura para a comparação enxergar só o que é visível.
    const assinatura = JSON.stringify({ ...pronto, seq: 0, instante: 0 });
    if (!forcar && assinatura === this.ultimaAssinatura) return;
    this.ultimaAssinatura = assinatura;
    /**
     * Eleição de líder de voz: só UMA tela reproduz áudio, a mais antiga.
     * `Set` preserva ordem de inserção, então o primeiro da iteração é o
     * espelho mais velho. Quando ele fecha, a próxima emissão promove o
     * seguinte — sem isso, app + abas espelhando o mesmo operador falam
     * todos ao mesmo tempo e a IARA sai repetida e embolada.
     */
    let lider = true;
    for (const sessao of this.sessoes) {
      sessao.emitirSnapshot({ ...pronto, voz_lider: lider });
      lider = false;
    }
  }

  /**
   * Anexa o caminho do áudio ao snapshot já compilado.
   *
   * Acontece AQUI, e não no `CompiladorSnapshot`, porque uma URL é um conceito
   * do mundo HTTP e o compilador não conhece esse mundo — ele produz estado
   * cognitivo puro. A ponte é a fronteira, então é dela o trabalho de traduzir
   * "existe áudio para esta fala" em "está em /voz/<hash>.mp3".
   */
  private comVoz(snapshot: SnapshotCognitivo): SnapshotCognitivo {
    if (!snapshot.fala) return snapshot;
    const voz = caminhoDaVoz(snapshot.fala.id);
    /**
     * `voz_prevista` avisa o cliente que o áudio DESTA fala está a caminho —
     * um fato sobre o turno, não uma leitura da configuração do servidor. É o
     * que impede a síntese do navegador de disparar no instante da conclusão e
     * o áudio do servidor chegar um segundo depois POR CIMA (as duas vozes
     * juntas eram a fala dobrada e embolada) SEM cobrar do cliente uma espera
     * cega quando o áudio não vem.
     */
    const prevista = this.vozEmVoo.has(snapshot.fala.id);
    if (voz === snapshot.fala.voz && prevista === (snapshot.fala.voz_prevista ?? false)) {
      return snapshot;
    }
    return { ...snapshot, fala: { ...snapshot.fala, voz, voz_prevista: prevista } };
  }

  /**
   * Evento → linha de console. Nem todo evento vira log: os que só existem
   * para mover o snapshot ficam calados, senão o console vira ruído e perde a
   * função de explicar a decisão.
   */
  private traduzir(e: EventoKernel): { nivel: 'traco' | 'info' | 'alerta'; texto: string } | null {
    switch (e.tipo) {
      case 'PERCEPCAO_CONCLUIDA': {
        const p = e.percepcao;
        return {
          nivel: 'traco',
          texto:
            `Percepção: ${p.tipo}/${p.urgencia} · objetivo provável "${p.objetivo_provavel}" · ` +
            `confiança ${p.confianca.toFixed(2)} · âncoras [${p.ancoras.join(', ') || '—'}] · ` +
            `operador ${p.leitura.estado}`,
        };
      }
      case 'DECISAO_TOMADA':
        return {
          nivel: 'info',
          texto: `Função executiva → ${e.rota} (${e.custo_estimado}). ${e.justificativa}`,
        };
      case 'PLANO_CRIADO':
        return {
          nivel: 'info',
          texto:
            `Plano ${e.plano.origem} "${e.plano.objetivo}" com ${e.plano.passos.length} passo(s): ` +
            e.plano.passos.map((p) => `${p.indice + 1}. ${p.descricao}`).join(' | '),
        };
      case 'PASSO_INICIADO':
        return {
          nivel: 'traco',
          texto: `Passo ${e.passo.indice + 1}/${e.total}: ${e.passo.descricao}`,
        };
      /**
       * O RESULTADO DO PASSO — e ele faltava aqui.
       *
       * O Kernel publicava `PASSO_CONCLUIDO` desde sempre; a tradução parava
       * em `PASSO_INICIADO`. O console mostrava "Passo 1/1: Ler a previsão do
       * modelo" e emudecia: o que a ferramenta DEVOLVEU nunca chegava ao
       * operador. Era o elo que faltava para diagnosticar uma resposta errada
       * — dava para ver que a IARA decidiu consultar o clima, e não dava para
       * ver o que o clima respondeu, então não havia como saber se o erro
       * nasceu na decisão, na ferramenta ou na redação.
       */
      case 'PASSO_CONCLUIDO':
        return {
          nivel: 'traco',
          texto: `Passo ${e.passo.indice + 1} concluído em ${e.ms}ms — ${e.resumo}`,
        };
      case 'HABILIDADE_CONCLUIDA':
        return {
          nivel: e.ok ? 'traco' : 'alerta',
          texto: `Habilidade "${e.habilidade}" ${e.ok ? 'ok' : 'sem resolver'} em ${e.ms}ms — ${e.detalhe}`,
        };
      /**
       * A APURAÇÃO, separada do relato do executor de propósito: um diz "eu
       * fiz", o outro diz "o mundo confirma". Confundir os dois é a mentira
       * operacional que `Verdade.ts` inteiro existe para impedir — e ela
       * também precisa ser VISÍVEL, não só respeitada internamente.
       */
      case 'HABILIDADE_VERIFICADA':
        return {
          nivel: e.confirmado ? 'traco' : 'alerta',
          texto:
            `Verificação de "${e.habilidade}": ` +
            `${e.confirmado ? 'o mundo confirma' : 'NÃO confirmado'} — ${e.evidencia}`,
        };
      case 'RACIOCINIO_INICIADO':
        return { nivel: 'info', texto: `Acionando ${e.modelo} na nuvem.` };
      case 'RACIOCINIO_CONCLUIDO':
        return {
          nivel: 'info',
          texto:
            `Raciocínio: ${e.tokens_entrada} tokens de entrada (${e.cache_lido} do cache), ` +
            `${e.tokens_saida} de saída, ${e.ms}ms.`,
        };
      case 'TAREFA_CANCELADA':
        return { nivel: 'traco', texto: `Turno cancelado (${e.motivo}).` };
      case 'FALHA':
        return { nivel: 'alerta', texto: `${e.modulo}: ${e.mensagem}` };
      default:
        return null;
    }
  }
}
