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

  constructor(private readonly socket: WebSocket) {}

  /**
   * Drenagem SOB DEMANDA, não por relógio. Um `setInterval` de 40 ms por tela
   * conectada acordava o event loop 25 vezes por segundo com a fila vazia —
   * multiplicado por espelho, era o maior custo fixo do servidor em ócio.
   * Agora o timer só existe quando há pacote esperando janela de aglutinação
   * (logs) ou backpressure segurando a fila.
   */
  private agendarDrenagem(): void {
    if (this.timer || this.fechada) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drenar();
      // Sobrou pacote (backpressure ou socket ainda abrindo)? Reagenda.
      if (this.fila.tamanho > 0) this.agendarDrenagem();
    }, JANELA_MS);
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
    this.agendarDrenagem();
  }

  emitirErro(texto: string): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({ tipo: 'erro', seq: this.seq, instante: Date.now(), texto });
    this.drenar();
  }

  private drenar(): void {
    if (this.fechada) return;
    // Socket ainda abrindo, ou backpressure real do SO: não empilha agora,
    // mas REAGENDA — sem o interval fixo de antes, ninguém mais tentaria.
    if (this.socket.readyState !== 1 || this.socket.bufferedAmount > 1_000_000) {
      if (this.fila.tamanho > 0) this.agendarDrenagem();
      return;
    }
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
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.fila.limpar();
  }

  /**
   * Fecha a sessão E derruba o transporte. É o que o takeover de reconexão
   * precisa: `fechar()` sozinho deixa o socket antigo vivo no SO, e o `close`
   * tardio dele (minutos depois, quando o TCP expira) executaria a desmontagem
   * em cima da sessão nova.
   */
  derrubar(codigo = 4000, motivo = 'substituida por conexao nova'): void {
    this.fechar();
    try {
      this.socket.close(codigo, motivo);
    } catch {
      /* transporte já encerrado */
    }
  }
}
