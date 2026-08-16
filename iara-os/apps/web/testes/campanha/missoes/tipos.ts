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
   */
  readonly prazo_ms?: number;
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
