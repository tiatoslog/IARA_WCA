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
import type { SessaoOperador } from './SessaoOperador';

const JANELA_MS = 50;

export class PonteProjecao {
  private pendente: NodeJS.Timeout | null = null;
  private readonly desassinar: () => void;

  constructor(
    private readonly barramento: BarramentoEventos,
    private readonly compilador: CompiladorSnapshot,
    private readonly estado: EstadoAtomico,
    private readonly sessao: SessaoOperador,
  ) {
    this.desassinar = barramento.assinarTudo((e) => this.aoEvento(e));
  }

  encerrar(): void {
    this.desassinar();
    if (this.pendente) clearTimeout(this.pendente);
    this.pendente = null;
  }

  /** Snapshot imediato — usado na conexão e na reconexão. */
  hidratar(): void {
    this.emitir();
  }

  private aoEvento(e: EventoKernel): void {
    const log = this.traduzir(e);
    if (log) this.sessao.emitirLog(log.nivel, log.texto);

    // Fala não espera a janela.
    if (e.tipo === 'RESPOSTA_TRECHO' || e.tipo === 'TAREFA_CONCLUIDA') {
      this.emitir();
      return;
    }
    this.agendar();
  }

  private agendar(): void {
    if (this.pendente) return;
    this.pendente = setTimeout(() => {
      this.pendente = null;
      this.emitir();
    }, JANELA_MS);
    this.pendente.unref?.();
  }

  private emitir(): void {
    const base = this.estado.instantaneo();
    const snapshot = this.compilador.compilar(
      base,
      base.operador?.id_usuario ?? 'anonimo',
      this.sessao.descartados,
    );
    this.sessao.emitirSnapshot(snapshot);
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
      case 'HABILIDADE_CONCLUIDA':
        return {
          nivel: e.ok ? 'traco' : 'alerta',
          texto: `Habilidade "${e.habilidade}" ${e.ok ? 'ok' : 'sem resolver'} em ${e.ms}ms — ${e.detalhe}`,
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
