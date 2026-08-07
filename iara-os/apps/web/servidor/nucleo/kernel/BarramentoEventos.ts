/**
 * Barramento de eventos do kernel. Um por sessão.
 *
 * Escolhas deliberadas:
 *
 * - **Em processo e síncrono na entrega.** Não é Kafka nem Redis. Para 5
 *   operadores isso seria complexidade sem retorno. A interface é a mesma que
 *   um barramento distribuído teria (`publicar` / `assinar`), então trocar a
 *   implementação depois é adaptador, não reescrita.
 *
 * - **Um barramento POR SESSÃO.** Não existe barramento global. Evento de um
 *   operador não tem como vazar para outro porque não há caminho físico — a
 *   mesma lógica dos shards de memória, aplicada ao fluxo de eventos.
 *
 * - **Assinante que lança não derruba o publicador.** Um ouvinte quebrado vira
 *   log; o turno continua. O contrário faria um bug de UI matar o raciocínio.
 */

import { randomUUID } from 'node:crypto';
import type { EventoBase, EventoDe, EventoKernel, TipoEvento } from './Evento';

type Ouvinte<T extends TipoEvento> = (evento: EventoDe<T>) => void;
type OuvinteGeral = (evento: EventoKernel) => void;

/** O que o publicador informa; o barramento carimba o resto. */
export type EventoSemCarimbo = EventoKernel extends infer T
  ? T extends EventoKernel
    ? Omit<T, keyof EventoBase>
    : never
  : never;

export class BarramentoEventos {
  /**
   * Guardados na forma larga (`EventoKernel`). O estreitamento acontece na
   * assinatura pública: dentro do Map, um `Ouvinte<'FALHA'>` e um
   * `Ouvinte<'PLANO_CRIADO'>` não têm tipo comum, e forçar um só quebra a
   * variância. O despacho por `tipo` garante que cada ouvinte só recebe o
   * evento que assinou.
   */
  private readonly ouvintes = new Map<TipoEvento, Set<OuvinteGeral>>();
  private readonly gerais = new Set<OuvinteGeral>();
  /** Histórico curto do turno atual. Auditoria, não memória. */
  private readonly trilha: EventoKernel[] = [];
  private traco = randomUUID();

  constructor(private readonly sessao: string) {}

  /** Abre um novo traço. Um traço = um turno = uma unidade de auditoria. */
  novoTraco(): string {
    this.traco = randomUUID();
    this.trilha.length = 0;
    return this.traco;
  }

  get tracoAtual(): string {
    return this.traco;
  }

  publicar(bruto: EventoSemCarimbo): EventoKernel {
    const evento = {
      ...bruto,
      id: randomUUID(),
      instante: Date.now(),
      traco: this.traco,
      sessao: this.sessao,
    } as EventoKernel;

    this.trilha.push(evento);
    if (this.trilha.length > 200) this.trilha.shift();

    for (const ouvinte of this.gerais) this.entregar(() => ouvinte(evento));
    const alvo = this.ouvintes.get(evento.tipo);
    if (alvo) {
      for (const ouvinte of alvo) this.entregar(() => ouvinte(evento));
    }
    return evento;
  }

  private entregar(chamada: () => void): void {
    try {
      chamada();
    } catch (erro) {
      // Nunca propaga: assinante quebrado não pode derrubar quem publicou.
      console.warn(`[kernel] ouvinte falhou: ${(erro as Error).message}`);
    }
  }

  assinar<T extends TipoEvento>(tipo: T, ouvinte: Ouvinte<T>): () => void {
    let conjunto = this.ouvintes.get(tipo);
    if (!conjunto) {
      conjunto = new Set();
      this.ouvintes.set(tipo, conjunto);
    }
    // Seguro: só chega aqui evento cujo `tipo` bate com a chave do Map.
    const largo = ouvinte as unknown as OuvinteGeral;
    conjunto.add(largo);
    return () => conjunto.delete(largo);
  }

  assinarTudo(ouvinte: OuvinteGeral): () => void {
    this.gerais.add(ouvinte);
    return () => this.gerais.delete(ouvinte);
  }

  /** Cópia da trilha do traço corrente. Para auditoria e depuração. */
  trilhaAtual(): readonly EventoKernel[] {
    return [...this.trilha];
  }

  limpar(): void {
    this.ouvintes.clear();
    this.gerais.clear();
    this.trilha.length = 0;
  }
}
