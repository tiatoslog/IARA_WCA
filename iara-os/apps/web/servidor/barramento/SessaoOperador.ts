/**
 * Sessão de um operador no barramento.
 *
 * Responsável por três coisas que, se ficarem no motor, quebram o React:
 *
 *  1. CARIMBO: aplica `seq` monotônico e `instante` em todo pacote.
 *  2. THROTTLE: drena a fila em janelas fixas. Micro-eventos viram um lote;
 *     o React re-renderiza em cadência previsível em vez de a cada mutação.
 *  3. HIDRATAÇÃO: na (re)conexão, manda o estado consolidado e descarta a
 *     telemetria velha. É por isso que o avatar não se teletransporta.
 */

import type { WebSocket } from 'ws';
import type { EstadoAtomico } from '../nucleo/EstadoAtomico';
import type { PacoteBruto } from '../nucleo/MotorCognitivo';
import type { PacoteServidor } from '../../lib/protocolo';
import { FilaTelemetria } from './FilaTelemetria';

const JANELA_MS = 60;

export class SessaoOperador {
  private readonly fila = new FilaTelemetria();
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private fechada = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly estado: EstadoAtomico,
  ) {
    this.timer = setInterval(() => this.drenar(), JANELA_MS);
    this.timer.unref?.();
  }

  /** Ponto único de entrada de telemetria. O motor só conhece isto. */
  emitir = (bruto: PacoteBruto): void => {
    if (this.fechada) return;
    this.seq += 1;
    const pacote = { ...bruto, seq: this.seq, instante: Date.now() } as PacoteServidor;
    this.fila.enfileirar(pacote);

    // Fala não espera a janela: latência percebida é o produto.
    if (pacote.tipo === 'fala_delta' || pacote.tipo === 'fala_inicio') {
      this.drenar();
    }
  };

  /** Estado consolidado. Sempre o primeiro pacote de uma conexão. */
  hidratar(): void {
    this.fila.limpar();
    this.seq += 1;
    const pacote: PacoteServidor = {
      tipo: 'hidratacao',
      seq: this.seq,
      instante: Date.now(),
      estado: { ...this.estado.instantaneo(), seq: this.seq },
    };
    this.enviar(pacote);
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
