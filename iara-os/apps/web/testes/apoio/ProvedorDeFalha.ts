/**
 * PROVEDOR DE FALHA CONTROLADA — só para teste, e a garantia é arquitetural.
 *
 * POR QUE ELE NÃO PODE SER ALCANÇADO EM PRODUÇÃO: ele mora em `testes/`, e
 * `FabricaRaciocinio` não o conhece. Não há valor de `IARA_PROVEDOR` que o
 * selecione, não há chave de ambiente que o ligue, não há registro onde ele
 * apareça. A única forma de instanciá-lo é um teste importá-lo e injetá-lo no
 * Kernel — o que exige escrever código, não configurar.
 *
 * Escolher isto em vez de um provedor "de teste" dentro de `FabricaRaciocinio`
 * foi deliberado: bastaria alguém copiar um `.env` com `IARA_PROVEDOR=teste`
 * para a IARA passar a responder mentira controlada em produção. Uma trava que
 * depende de ninguém digitar a palavra errada não é trava.
 *
 * O QUE ELE FALSIFICA, e nada além disso: o texto que o modelo devolve. A
 * cadeia é real, a retenção é real, o verificador é real, o orçamento é real, a
 * decisão de escalar é real, a segunda chamada é real. Se o mecanismo passar
 * aqui, o que ficou por provar é só a alcançabilidade em produção — que é outro
 * problema, medido à parte.
 */

import type {
  PedidoRaciocinio,
  ProvedorRaciocinio,
  RespostaRaciocinio,
} from '../../servidor/nucleo/ProvedorRaciocinio';

export interface Chamada {
  readonly instante: number;
  readonly mensagem: string;
}

export interface RoteiroDoProvedor {
  readonly apelido: string;
  readonly camada?: 'padrao' | 'premium';
  /**
   * O texto devolvido. Função para o roteiro poder variar por chamada — é assim
   * que FI-004 faz o premium errar depois de o barato ter errado.
   */
  readonly texto: (chamada: number) => string;
  /**
   * Em quantos pedaços o texto sai. `1` devolve tudo de uma vez; maior que 1
   * exercita o caminho de streaming, que é onde a exposição prematura moraria.
   */
  readonly pedacos?: number;
  /** Milissegundos entre pedaços — para o caso "stream lento" da Regra 15. */
  readonly atrasoPorPedacoMs?: number;
  /** Lança em vez de responder. Prova que falha de provedor não vira valor. */
  readonly explode?: boolean;
  /** Interrompe o stream no meio, sem concluir. */
  readonly interromperApos?: number;
}

export class ProvedorDeFalha implements ProvedorRaciocinio {
  readonly origem = 'nuvem' as const;
  readonly disponivel = true;
  readonly modelo: string;
  readonly apelido: string;
  readonly camada: 'padrao' | 'premium';
  /** Toda chamada recebida, com carimbo — a prova de ORDEM da Regra 14. */
  readonly chamadas: Chamada[] = [];

  constructor(private readonly roteiro: RoteiroDoProvedor) {
    this.apelido = roteiro.apelido;
    this.camada = roteiro.camada ?? 'padrao';
    this.modelo = `falso-${roteiro.apelido}`;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    const n = this.chamadas.length + 1;
    this.chamadas.push({ instante: Date.now(), mensagem: pedido.mensagem });

    if (this.roteiro.explode) throw new Error(`${this.apelido} fora do ar`);

    const texto = this.roteiro.texto(n);
    const quantos = Math.max(1, this.roteiro.pedacos ?? 1);
    const tamanho = Math.ceil(texto.length / quantos);

    let enviado = '';
    for (let i = 0; i < quantos; i += 1) {
      if (pedido.sinal?.aborted) {
        const e = new Error('abortado');
        e.name = 'AbortError';
        throw e;
      }
      if (this.roteiro.interromperApos !== undefined && i >= this.roteiro.interromperApos) {
        throw new Error('stream interrompido no meio');
      }
      const pedaco = texto.slice(i * tamanho, (i + 1) * tamanho);
      if (pedaco.length === 0) break;
      enviado += pedaco;
      pedido.aoReceberTexto(pedaco);
      if (this.roteiro.atrasoPorPedacoMs) {
        await new Promise((r) => setTimeout(r, this.roteiro.atrasoPorPedacoMs));
      }
    }
    return { texto: enviado, tokens_entrada: 10, tokens_saida: 10, cache_lido: 0, recusado: false };
  }
}
