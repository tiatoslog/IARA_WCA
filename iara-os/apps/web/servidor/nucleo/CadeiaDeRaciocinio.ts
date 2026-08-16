/**
 * A CADEIA — vários cérebros, uma porta, e a IARA nunca mais muda por cota.
 *
 * O INCIDENTE QUE A ORIGINOU (15/08/2026): a conta da Anthropic zerou. A chave
 * continuava no ambiente, então a `FabricaRaciocinio` escolheu o `ClienteClaude`
 * na subida — e ele falhava em TODO turno. A operadora leu "não consegui
 * concluir; tente de novo" em cada pedido e concluiu, com razão, que a IARA
 * inteira estava quebrada. O `auto` de então protegia contra chave AUSENTE;
 * não contra chave que para de funcionar depois. É a diferença entre escolher
 * na subida e ter para onde ir em runtime.
 *
 * A REGRA QUE GOVERNA A TROCA, e ela é curta: troca-se quando o provedor não
 * conseguiu COMEÇAR — cota, chave, limite de taxa, serviço fora. Nunca depois
 * que um pedaço de texto já chegou ao operador: repetir com outro cérebro
 * duplicaria a fala no meio da frase. É a mesma regra do corte de retentativa
 * do `ClienteClaude` e do `ClienteOllama`, pela mesma razão.
 *
 * O QUE A CADEIA NÃO FAZ: mascarar. Se todos falharem, o erro do último sobe
 * inteiro — a mensagem honesta continua sendo a última palavra, e é ela que o
 * `mensagemHumanaDeFalha` traduz para a operadora.
 */

import {
  ProvedorIndisponivel,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from './ProvedorRaciocinio';

/**
 * O erro merece outro cérebro?
 *
 * Sim para o que é do PROVEDOR (cota, crédito, chave, limite de taxa, serviço
 * indisponível). Não para o que é do OPERADOR (ele cancelou) — trocar aí
 * gastaria a cota do próximo para produzir uma resposta que ninguém pediu.
 */
export function mereceOutroProvedor(erro: unknown, sinal?: AbortSignal): boolean {
  if (sinal?.aborted) return false;
  if (erro instanceof Error && erro.name === 'AbortError') return false;

  if (erro instanceof ProvedorIndisponivel) return true;

  const texto = erro instanceof Error ? erro.message : String(erro);
  return (
    /credit balance|quota|insufficient|billing|payment/i.test(texto) ||
    /rate.?limit|429|too many requests/i.test(texto) ||
    /401|403|invalid.?api.?key|unauthorized|permission/i.test(texto) ||
    /5\d{2}|overloaded|unavailable|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(texto)
  );
}

export class CadeiaDeRaciocinio implements ProvedorRaciocinio {
  /** O elo que respondeu por último — é o que a telemetria e o snapshot mostram. */
  private atual: ProvedorRaciocinio;

  constructor(private readonly elos: ProvedorRaciocinio[]) {
    if (elos.length === 0) throw new Error('cadeia de raciocínio vazia');
    this.atual = elos[0];
  }

  /** A origem e o modelo são os do elo que está respondendo AGORA — a tela não
   *  pode dizer "nuvem" enquanto quem responde é o Ollama da sala. */
  get origem(): 'nuvem' | 'local' {
    return this.atual.origem;
  }

  get modelo(): string {
    return this.atual.modelo;
  }

  /** Disponível se ALGUM elo está. Exigir todos desligaria a rota de raciocínio
   *  por causa de um provedor secundário sem chave. */
  get disponivel(): boolean {
    return this.elos.some((e) => e.disponivel);
  }

  /** Sonda os que sabem se sondar; basta um responder. */
  async sondar(): Promise<boolean> {
    let algum = false;
    for (const elo of this.elos) {
      if (!elo.sondar) {
        if (elo.disponivel) algum = true;
        continue;
      }
      if (await elo.sondar()) algum = true;
    }
    return algum;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    const candidatos = this.elos.filter((e) => e.disponivel);
    const fila = candidatos.length > 0 ? candidatos : this.elos;
    let ultimoErro: unknown = new ProvedorIndisponivel('nenhum provedor de raciocínio disponível');

    for (const elo of fila) {
      /**
       * A porta de saída da troca: o instante em que o primeiro pedaço chega
       * ao operador. Daí em diante o turno é daquele elo, dê no que der.
       */
      let comecouAFalar = false;

      try {
        this.atual = elo;
        return await elo.raciocinar({
          ...pedido,
          aoReceberTexto: (pedaco) => {
            comecouAFalar = true;
            pedido.aoReceberTexto(pedaco);
          },
        });
      } catch (erro) {
        ultimoErro = erro;
        if (comecouAFalar) throw erro;
        if (!mereceOutroProvedor(erro, pedido.sinal)) throw erro;
        /* Segue para o próximo elo. O motivo deste não se perde: se todos
           falharem, o último sobe — e os anteriores já foram vistos por quem
           acompanha o console técnico. */
      }
    }

    throw ultimoErro;
  }
}
