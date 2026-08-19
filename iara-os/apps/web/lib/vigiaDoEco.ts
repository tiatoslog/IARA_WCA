/**
 * O VIGIA DO ECO — "mandei" não é "chegou".
 *
 * O DEFEITO (auditoria em navegador real, 19/08/2026, OBS-1). Duas mensagens
 * foram enviadas e sumiram: sem balão, sem erro, sem aviso — e o indicador do
 * barramento dizia "aberto" o tempo todo. Coincidiram com reinícios do motor.
 *
 * A CAUSA, e ela é uma confusão de contrato que parece um detalhe:
 *
 *     readyState === OPEN
 *            ↓
 *     send() não lançou exceção
 *            ↓
 *     "entregue ao socket local"   ≠   "entregue ao servidor"
 *
 * A trava que já existia — recusar o envio com o socket fechado — está certa e
 * continua de pé. Ela cobre o caso em que o cliente SABE que está desconectado.
 * Não cobre o caso em que o servidor morre no meio: o socket segue `OPEN` do
 * lado de cá por algum tempo, o `send()` local tem sucesso, e o quadro morre no
 * caminho. O navegador só descobre no `onclose`, que pode demorar — e a
 * mensagem já sumiu.
 *
 * A PROVA DE ENTREGA JÁ EXISTIA e ninguém a estava usando: o servidor devolve
 * toda pergunta em `snapshot.pergunta` com o mesmo `op:<id_local>` que o
 * cliente gerou. Esse eco servia para a bolha não duplicar entre telas. O que
 * faltava era vigiar a AUSÊNCIA dele — é a ausência que prova a perda.
 *
 *     OPEN + send() → eco com o mesmo op:id → ENTREGA CONFIRMADA
 *     OPEN + send() → prazo vencido sem eco → ENTREGA NÃO CONFIRMADA
 *
 * NÃO REENVIA SOZINHO, e a recusa é deliberada. Uma mensagem sem eco pode ter
 * chegado — o que se perdeu talvez tenha sido o eco, não o pedido. Reenviar
 * executaria o turno duas vezes, e este repositório inteiro é construído contra
 * duplicação de efeito (ver `execucao_id`). É a mesma disciplina do `Vigia`:
 * detectar não é executar. A tela avisa; quem manda de novo é a pessoa.
 *
 * MÓDULO PURO, sem relógio próprio: o instante entra por parâmetro. É o que
 * permite testar prazo vencido sem esperar doze segundos, e é a mesma disciplina
 * de `PeriodoOperacional` e `ContratoFactual`.
 */

/**
 * Quanto tempo esperar o eco antes de dizer que não chegou.
 *
 * Doze segundos, e o número é sobre o servidor e não sobre paciência: o eco é o
 * PRIMEIRO pacote do turno — vem antes de qualquer raciocínio e de qualquer
 * ferramenta, então leva milissegundos quando o caminho está de pé. Doze
 * segundos cobrem com folga uma reconexão inteira (o backoff do socket vai a 1,
 * 2, 4 e 8 s) sem acusar quem só está lento.
 */
export const PRAZO_DO_ECO_MS = 12_000;

export interface EnvioPendente {
  readonly id: string;
  readonly texto: string;
  readonly em: number;
}

export class VigiaDoEco {
  private readonly pendentes = new Map<string, EnvioPendente>();

  constructor(private readonly prazoMs: number = PRAZO_DO_ECO_MS) {}

  /**
   * Uma mensagem saiu pelo socket. `id` é o `op:<id_local>` — o mesmo que vai
   * voltar no eco.
   *
   * Reenvio do MESMO id reinicia o prazo em vez de criar uma segunda pendência:
   * é uma mensagem só, e duas pendências fariam dois avisos para uma perda.
   */
  registrar(id: string, texto: string, agora: number): void {
    this.pendentes.set(id, { id, texto, em: agora });
  }

  /**
   * O eco chegou. Devolve `true` se havia pendência — e `false` no eco
   * DUPLICADO ou no eco de outra tela.
   *
   * O booleano importa: sem ele, quem chama não teria como distinguir "confirmei
   * agora" de "isto já estava confirmado", e o segundo eco de um mesmo turno
   * viraria uma segunda confirmação. As outras telas do mesmo operador recebem
   * o mesmo snapshot e chamam isto para ids que elas nunca enviaram — ali
   * `false` é a resposta certa, não um erro.
   */
  confirmar(id: string): boolean {
    return this.pendentes.delete(id);
  }

  /**
   * Quem passou do prazo. REMOVE ao devolver: um envio vencido é avisado uma
   * vez, não a cada tique do relógio.
   */
  vencidos(agora: number): readonly EnvioPendente[] {
    const fora: EnvioPendente[] = [];
    for (const p of this.pendentes.values()) {
      if (agora - p.em > this.prazoMs) fora.push(p);
    }
    for (const p of fora) this.pendentes.delete(p.id);
    return fora;
  }

  /** Quantos envios ainda esperam eco. Leitura, para teste e diagnóstico. */
  get esperando(): number {
    return this.pendentes.size;
  }

  /** O socket caiu e vai reconectar: nada muda. Ver o comentário do arquivo —
   *  a pendência sobrevive à reconexão de propósito, porque a mensagem pode ter
   *  chegado antes da queda e o eco vir depois de reconectar. */
  esquecerTudo(): void {
    this.pendentes.clear();
  }
}
