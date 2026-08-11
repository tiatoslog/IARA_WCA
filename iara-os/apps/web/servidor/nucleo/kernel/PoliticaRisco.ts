/**
 * Política de risco.
 *
 * A TESE DESTE ARQUIVO, em uma frase: **confiança e risco são eixos
 * independentes, e tratá-los como um só é o erro clássico de agente
 * autônomo.**
 *
 * "Desligue o computador" tem confiança 0,92 — a IARA entendeu perfeitamente.
 * Entender perfeitamente é justamente o que torna a ação perigosa: ela vai
 * mesmo desligar. Um sistema que usa confiança como autorização executa com
 * mais vontade quanto melhor entende, que é o oposto do comportamento
 * desejado.
 *
 * Então: confiança decide se a IARA sabe O QUE fazer. Risco decide QUANTA
 * PROVA ela precisa antes e depois de fazer.
 */

import type { Risco } from './Habilidade';

export interface ExigenciaDeRisco {
  /** Precisa de "confirmo" do operador ANTES de executar? */
  readonly confirmacaoPrevia: boolean;
  /** Precisa conferir o mundo DEPOIS de executar? */
  readonly verificacaoPosterior: boolean;
  /**
   * Pode declarar conclusão sem verificação confirmada? Só o risco baixo pode:
   * ali a resposta É o resultado, não há mundo separado para conferir.
   */
  readonly podeConcluirSemVerificar: boolean;
}

const EXIGENCIA: Record<Risco, ExigenciaDeRisco> = {
  /** Ler, consultar, organizar. A leitura é a própria prova. */
  baixo: {
    confirmacaoPrevia: false,
    verificacaoPosterior: false,
    podeConcluirSemVerificar: true,
  },
  /**
   * Altera a máquina ou os dados. Sem confirmação prévia — pedir "confirma?"
   * para criar uma pasta transforma assistente em burocracia. Mas verificação
   * obrigatória: criar a pasta errada se desfaz; dizer que criou sem ter
   * criado, não.
   */
  medio: {
    confirmacaoPrevia: false,
    verificacaoPosterior: true,
    podeConcluirSemVerificar: false,
  },
  /** Irreversível ou alcança terceiro. Prova nas duas pontas. */
  alto: {
    confirmacaoPrevia: true,
    verificacaoPosterior: true,
    podeConcluirSemVerificar: false,
  },
};

export class PoliticaRisco {
  exigenciaDe(risco: Risco): ExigenciaDeRisco {
    return EXIGENCIA[risco];
  }

  /**
   * A confiança da percepção é suficiente para ESTE risco?
   *
   * O piso sobe com o risco, e nunca chega a 1: exigir certeza absoluta
   * significa nunca agir. O que fecha a diferença em risco alto não é a
   * confiança — é a confirmação explícita do operador.
   */
  confiancaSuficiente(risco: Risco, confianca: number): boolean {
    const piso: Record<Risco, number> = { baixo: 0.5, medio: 0.85, alto: 0.9 };
    return confianca >= piso[risco];
  }

  /**
   * Risco de um plano é o do passo MAIS arriscado. Um plano que lê três coisas
   * e desliga a máquina é um plano de risco alto — a média diluiria justamente
   * o passo que importa.
   */
  riscoDoPlano(riscos: readonly Risco[]): Risco {
    if (riscos.includes('alto')) return 'alto';
    if (riscos.includes('medio')) return 'medio';
    return 'baixo';
  }
}
