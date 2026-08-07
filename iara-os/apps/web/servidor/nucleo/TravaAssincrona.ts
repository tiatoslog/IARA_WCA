/**
 * Trava assíncrona (equivalente ao asyncio.Lock).
 *
 * Node é single-threaded, mas NÃO é atômico entre `await`s: qualquer
 * `ler -> await -> escrever` é uma condição de corrida real. É essa janela
 * que a trava fecha.
 *
 * Anti-deadlock: `executar` sempre libera no `finally`, inclusive quando o
 * corpo lança ou é cancelado.
 */
export class TravaAssincrona {
  private fila: Array<() => void> = [];
  private ocupada = false;

  async executar<T>(corpo: () => T | Promise<T>): Promise<T> {
    await this.adquirir();
    try {
      return await corpo();
    } finally {
      this.liberar();
    }
  }

  private adquirir(): Promise<void> {
    if (!this.ocupada) {
      this.ocupada = true;
      return Promise.resolve();
    }
    return new Promise<void>((resolver) => this.fila.push(resolver));
  }

  private liberar(): void {
    const proximo = this.fila.shift();
    if (proximo) {
      proximo();
      return;
    }
    this.ocupada = false;
  }
}
