/**
 * Fila de telemetria limitada com descarte semântico por janela de tempo.
 *
 * Problema que ela resolve: se a rede do operador oscila, o socket para de
 * drenar. Sem limite, a fila cresce até derrubar o processo (OOM); e quando a
 * conexão volta, a enxurrada retroativa faz o avatar se teletransportar pela
 * sala tentando "alcançar" o tempo real.
 *
 * Regras:
 *  1. Teto rígido de `MAXIMO` pacotes.
 *  2. Pacotes com chave de aglutinação se SOBRESCREVEM (só o último importa).
 *  3. Sob pressão, descarta primeiro os descartáveis (log, pulso) — os mais
 *     antigos antes. Fala e transição nunca são descartados por pressão.
 *  4. Pacotes descartáveis expiram por idade: telemetria velha não é
 *     reenviada na reconexão, o estado consolidado é.
 */

import { chaveDe, ehDescartavel, type PacoteServidor } from '../../lib/protocolo';

const MAXIMO = 100;
const VALIDADE_MS = 4000;

export class FilaTelemetria {
  private itens: PacoteServidor[] = [];
  private descartados = 0;

  get tamanho(): number {
    return this.itens.length;
  }

  get totalDescartado(): number {
    return this.descartados;
  }

  enfileirar(pacote: PacoteServidor): void {
    const chave = chaveDe(pacote);
    if (chave) {
      const i = this.itens.findIndex((p) => chaveDe(p) === chave);
      if (i >= 0) {
        // Aglutinação: o estado mais recente substitui o anterior in-place,
        // preservando a posição na fila.
        this.itens[i] = pacote;
        return;
      }
    }

    this.itens.push(pacote);
    if (this.itens.length <= MAXIMO) return;

    // Pressão: sacrifica o descartável mais antigo. Se não houver nenhum,
    // sacrifica o mais antigo de todos — nunca deixa a fila crescer.
    const alvo = this.itens.findIndex(ehDescartavel);
    this.itens.splice(alvo >= 0 ? alvo : 0, 1);
    this.descartados += 1;
  }

  /**
   * Drena o que ainda é relevante. Telemetria vencida é jogada fora aqui —
   * é este passo que zera o efeito de teletransporte na reconexão.
   */
  drenar(agora = Date.now()): PacoteServidor[] {
    const saida: PacoteServidor[] = [];
    for (const pacote of this.itens) {
      if (ehDescartavel(pacote) && agora - pacote.instante > VALIDADE_MS) {
        this.descartados += 1;
        continue;
      }
      saida.push(pacote);
    }
    this.itens = [];
    return saida;
  }

  limpar(): void {
    this.itens = [];
  }
}
