/**
 * Sessão de um operador no barramento.
 *
 * Só três responsabilidades, todas de transporte — nenhuma cognitiva:
 *
 *  1. CARIMBO: aplica `seq` monotônico e `instante` em todo pacote.
 *  2. FILA: entrega via ring buffer com descarte semântico, para que rede ruim
 *     não vire vazamento de memória nem enxurrada retroativa.
 *  3. BACKPRESSURE: respeita o buffer do socket do sistema operacional.
 *
 * Ela não sabe o que é percepção, plano ou habilidade. Recebe snapshot pronto
 * da `PonteProjecao` e transmite.
 */

import type { WebSocket } from 'ws';
import type { NivelLog, PacoteServidor } from '../../lib/protocolo';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import { FilaTelemetria } from './FilaTelemetria';

const JANELA_MS = 40;

export class SessaoOperador {
  private readonly fila = new FilaTelemetria();
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private fechada = false;

  constructor(private readonly socket: WebSocket) {
    this.timer = setInterval(() => this.drenar(), JANELA_MS);
    this.timer.unref?.();
  }

  emitirSnapshot(snapshot: SnapshotCognitivo): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({
      tipo: 'snapshot',
      seq: this.seq,
      instante: Date.now(),
      // O `seq` do envelope manda: é o que o cliente usa como guarda de ordem.
      snapshot: { ...snapshot, seq: this.seq },
    });
    this.drenar();
  }

  emitirLog(nivel: NivelLog, texto: string): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({ tipo: 'log', seq: this.seq, instante: Date.now(), nivel, texto });
  }

  emitirErro(texto: string): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({ tipo: 'erro', seq: this.seq, instante: Date.now(), texto });
    this.drenar();
  }

  private drenar(): void {
    if (this.fechada || this.socket.readyState !== 1) return;
    // Backpressure real do socket: se o buffer do SO está cheio, não empilha
    // mais nada nele — deixa a fila absorver e descartar o que for velho.
    if (this.socket.bufferedAmount > 1_000_000) return;
    for (const pacote of this.fila.drenar()) this.enviar(pacote);
  }

  private enviar(pacote: PacoteServidor): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(JSON.stringify(pacote));
  }

  get descartados(): number {
    return this.fila.totalDescartado;
  }

  fechar(): void {
    this.fechada = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.fila.limpar();
  }
}
