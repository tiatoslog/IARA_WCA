/**
 * Onde cada operador está AGORA, segundo o aparelho dele.
 *
 * ESTE ARQUIVO É A DECISÃO DE PRIVACIDADE, escrita em código.
 *
 * A coordenada de uma pessoa é dado pessoal: se alguém abre a IARA de casa num
 * domingo, é a casa dela que chega aqui. A decisão tomada em 12/08/2026 foi
 * "usar e descartar", e ela precisa ser estrutural, não uma promessa no README.
 * Por isso este módulo:
 *
 *  · guarda em MEMÓRIA DO PROCESSO, num Map — reiniciou, esqueceu;
 *  · não importa `MemoriaOperacional`, não conhece Supabase, não escreve
 *    arquivo. Não há caminho daqui para persistência nenhuma, e é essa AUSÊNCIA
 *    que garante a decisão. Uma flag `naoPersistir = true` seria uma promessa;
 *    não ter a dependência é um fato;
 *  · expira sozinho. Localização velha é pior que nenhuma — responder o tempo
 *    de onde a pessoa estava ontem tem a forma de um acerto e é um erro.
 *
 * Se um dia alguém precisar de histórico de localização, o lugar não é aqui: é
 * um módulo novo, com aviso explícito aos funcionários e decisão registrada.
 */

/**
 * Quanto tempo uma coordenada vale.
 *
 * Oito horas cobre um expediente sem obrigar a pessoa a reautorizar a cada
 * conversa, e é curto o bastante para que uma viagem de fim de semana não
 * responda pela segunda-feira. O relógio é do RECEBIMENTO, não do aparelho:
 * quem manda o pacote não decide por quanto tempo ele vale.
 */
const VALIDADE_MS = 8 * 60 * 60 * 1000;

export interface LocalConhecido {
  readonly latitude: number;
  readonly longitude: number;
  readonly recebido_em: number;
}

const porOperador = new Map<string, LocalConhecido>();

/** Guarda a posição informada pelo aparelho do operador. */
export function registrarLocal(idUsuario: string, latitude: number, longitude: number): void {
  if (!idUsuario) return;
  porOperador.set(idUsuario, { latitude, longitude, recebido_em: Date.now() });
}

/**
 * A posição, se houver uma recente. Fora da validade, some — e some de
 * verdade: a entrada é removida, para o Map não crescer com gente que não
 * conversa há semanas.
 */
export function localDe(idUsuario: string): LocalConhecido | null {
  const achado = porOperador.get(idUsuario);
  if (!achado) return null;
  if (Date.now() - achado.recebido_em > VALIDADE_MS) {
    porOperador.delete(idUsuario);
    return null;
  }
  return achado;
}

/**
 * Esquece a posição. Chamado quando a última tela do operador fecha: sessão
 * encerrada não deveria deixar rastro de onde a pessoa estava.
 */
export function esquecerLocal(idUsuario: string): void {
  porOperador.delete(idUsuario);
}

/** Só para os testes: devolve o tamanho do Map sem expor o Map. */
export function quantosLocaisNaMemoria(): number {
  return porOperador.size;
}
