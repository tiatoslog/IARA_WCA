/**
 * O que é uma MISSÃO.
 *
 * Uma missão não é um teste com assert: é um roteiro de conversa mais um lugar
 * para olhar depois. A separação é o desenho inteiro — quem escreve a missão
 * declara *o que pedir* e *onde a consequência apareceria*, e nunca declara
 * *o que a IARA deve responder*.
 *
 * A razão é dura: um teste que fixa a frase esperada de um modelo de linguagem
 * mede o modelo, não o sistema. Ele fica vermelho quando a IARA melhora o
 * português e verde quando ela mente com as palavras certas. A campanha inverte
 * isso — a frase é lida com tolerância (ver `LeitorDeFala`), e o que é medido
 * com rigor é o MUNDO, que não tem sinônimo.
 */

import type { Categoria, Expectativa, Incidente, Mundo } from '../contrato';
import type { ClienteBarramento, Turno } from '../ClienteBarramento';
import type { MotorVivo } from '../MotorSandbox';

export interface ContextoMissao {
  readonly motor: MotorVivo;
  readonly cliente: ClienteBarramento;
  readonly id_usuario: string;
  /** Sufixo único da rodada — evita que a missão de hoje veja a pasta de ontem. */
  readonly marca: string;
}

export interface Missao {
  readonly id: string;
  readonly categoria: Categoria;
  readonly titulo: string;
  readonly expectativa: Expectativa;
  /**
   * Teto por turno. Padrão no corredor; declarado aqui quando a missão SABE que
   * a resposta é rápida ou que não vai vir resposta nenhuma.
   *
   * ACEITA UMA LISTA — um prazo por turno, na ordem das falas — e a razão veio de
   * uma medição. FA-07 manda duas frases de naturezas opostas: a primeira só com
   * espaços (o silêncio É a resposta certa, e esperar o teto inteiro por ele é
   * desperdiçar 10 minutos), a segunda uma pergunta de verdade (que precisa do
   * modelo, e o modelo local custa ~263 s por chamada nesta máquina). Com um
   * número só, os dois turnos herdavam 8 s e a missão voltava
   * `ESTADO_DESCONHECIDO` para SEMPRE — arrastando a campanha inteira para
   * inconclusiva por defeito do harness, não do produto.
   *
   * Lista mais curta que a lista de falas: os turnos restantes usam o padrão do
   * corredor. É o caso comum — "só o primeiro turno é atípico".
   */
  readonly prazo_ms?: number | readonly number[];
  /**
   * O silêncio é o comportamento CERTO desta missão?
   *
   * Existe por causa de um caso real: mensagem só com espaços é descartada por
   * `lerPacoteCliente` antes de chegar ao motor — o servidor não responde
   * porque não recebeu nada, e está certo. Sem este campo, o auditor de
   * silêncio registraria como defeito justamente a validação funcionando.
   */
  readonly tolera_silencio?: boolean;
  /**
   * Esta missão existe para SONDAR uma capacidade que talvez não exista.
   *
   * Muda duas coisas no corredor: a recusa é colhida como lacuna mesmo numa
   * missão `sem_efeito` (onde normalmente seria descartada — ver `Lacunas.ts`),
   * e a ausência de efeito no mundo é o resultado esperado, não um defeito.
   *
   * O que continua sendo defeito aqui é a IARA responder QUALQUER COISA que
   * afirme, sugira ou descreva um efeito que não houve. Não saber fazer é
   * legítimo; improvisar em cima de não saber, não.
   */
  readonly sonda_capacidade?: boolean;
  /**
   * As frases enviadas, na ordem. A ÚLTIMA é a que produz a fala julgada — as
   * anteriores são contexto (é assim que uma missão de memória constrói 20
   * turnos antes da pergunta que importa).
   */
  falas(ctx: ContextoMissao): readonly string[];
  /** Roda antes das falas: planta o arquivo com a injeção, cria o conflito. */
  preparar?(ctx: ContextoMissao): Promise<void>;
  /**
   * Onde olhar no mundo depois do último turno. É a única fonte de verdade
   * sobre o efeito — e ela nunca pergunta nada ao motor.
   */
  observar(ctx: ContextoMissao): Promise<Mundo>;
  /**
   * Conferências que não cabem no eixo fala×mundo e viram incidente próprio:
   * vazamento de segredo no texto, latência absurda, o jornal registrando risco
   * alto sem autorização. Roda sempre, mesmo quando o desfecho é bom — um
   * `VERIFICADO` que vazou uma chave continua sendo um incidente crítico.
   */
  auditar?(ctx: ContextoMissao, turnos: readonly Turno[]): Incidente[];
}

export function missao(m: Missao): Missao {
  return m;
}

export type { Categoria, Expectativa, Incidente, Mundo };

/**
 * O PRAZO DO TURNO `i`, e ela existe separada do corredor por um motivo prático:
 * `executar.ts` roda a campanha inteira ao ser importado (`process.exitCode = await
 * principal()`), então importá-lo de um teste subiria um motor e conversaria com a
 * IARA. A regra que precisa de teste mora aqui, onde importar não faz nada.
 *
 * A regra: lista mais curta que as falas → os turnos restantes usam o padrão. É o
 * caso comum ("só o primeiro turno é atípico") e é exatamente onde um off-by-one
 * devolveria silenciosamente o prazo errado para o turno que mais precisa dele.
 */
export function prazoDoTurno(
  prazo: number | readonly number[] | undefined,
  indice: number,
  padrao: number,
): number {
  if (prazo === undefined) return padrao;
  if (typeof prazo === 'number') return prazo;
  return prazo[indice] ?? padrao;
}
