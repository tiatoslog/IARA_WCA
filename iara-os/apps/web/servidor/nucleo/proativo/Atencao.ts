/**
 * ATENÇÃO — o que a IARA aprendeu sobre o que ESTE operador quer saber.
 *
 * ---------------------------------------------------------------------------
 * MEMÓRIA, NÃO PROCEDIMENTO
 * ---------------------------------------------------------------------------
 *
 * A distinção é rígida e vale a pena escrevê-la, porque confundi-la é como um
 * sistema desses acumula lixo:
 *
 *   MEMÓRIA    "esta pessoa se interessa por avisos sobre uso de memória."
 *   HABILIDADE "como medir o uso de memória de uma máquina."
 *
 * Este arquivo guarda só a primeira. Ele não sabe medir nada, não sabe falar com
 * ninguém e não conhece o catálogo. Uma observação sobre interesse nunca vira
 * procedimento, e um procedimento nunca vira preferência.
 *
 * ---------------------------------------------------------------------------
 * O PESO É DERIVADO DE EVIDÊNCIA, NUNCA DIGITADO
 * ---------------------------------------------------------------------------
 *
 * Não existe aqui — e não pode existir — um lugar onde alguém escreva
 * `peso: 0.9`. É a mesma regra que o `CLAUDE.md` já impõe a `Investigacao`: *"a
 * confiança de uma hipótese é calculada, não existe lugar onde alguém digite
 * `confianca: 'alta'`"*. Uma segunda escala arbitrária ao lado de uma escala
 * calculada é a doença que esta casa já pagou caro duas vezes.
 *
 * O peso sai de contagens do que de fato aconteceu:
 *
 *     peso = (positivos + α) / (positivos + negativos + 2α)
 *
 * com `α = 2`. A suavização (Laplace) resolve o problema que quebra qualquer
 * contador ingênuo: **sem ela, o primeiro alerta ignorado zeraria o assunto para
 * sempre**, e o primeiro engajamento o cravaria em 1. Com ela, ausência de
 * evidência devolve exatamente 0,5 — nem interesse, nem desinteresse — e são
 * precisos vários sinais na mesma direção para o peso sair do meio. Aprender
 * devagar é requisito, não defeito: uma preferência que vira do avesso a cada
 * turno não é preferência.
 *
 * ---------------------------------------------------------------------------
 * OS PESOS DA EVIDÊNCIA, E POR QUE ELES SÃO DIFERENTES
 * ---------------------------------------------------------------------------
 *
 * `agiu` vale o dobro de `engajou` porque agir é a evidência mais forte que
 * existe de que o aviso serviu: a pessoa não só leu, ela fez algo por causa dele.
 *
 * `rejeitou` vale o triplo de `ignorou` porque são coisas diferentes de verdade.
 * Ignorar é ambíguo — a pessoa pode estar ocupada, pode não ter visto, pode ter
 * lido e concordado sem responder. Rejeitar é inequívoco: ela leu, entendeu e
 * disse que não quer. Tratar as duas com o mesmo peso faz a IARA precisar de dez
 * silêncios para aprender o que uma frase já disse.
 */

/** Quantos sinais equivalentes uma opinião sem evidência vale. Ver o cabeçalho. */
const ALFA = 2;

const PESO_AGIU = 2;
const PESO_REJEITOU = 3;

/**
 * O silêncio depois de uma rejeição explícita.
 *
 * Dois dias, e não "para sempre". A rejeição é sobre o AVISO DE HOJE, não sobre
 * o assunto pelo resto da vida — a pessoa que disse "não precisa me avisar de
 * memória agora" pode querer saber na semana que vem, quando a máquina estiver
 * pior. Silêncio permanente por uma frase é o comportamento que obriga alguém a
 * caçar uma tela de configuração para desfazer um clique.
 */
export const SILENCIO_POR_REJEICAO_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * A partir daqui a pessoa já disse não vezes o bastante para a insistência
 * virar desrespeito. Um mês.
 */
export const REJEICOES_PARA_SILENCIO_LONGO = 3;
export const SILENCIO_LONGO_MS = 30 * 24 * 60 * 60 * 1000;

export interface Atencao {
  readonly assunto: string;
  /** Quantas vezes a IARA levou este assunto à pessoa. O denominador honesto. */
  readonly propostas: number;
  /** Ela respondeu, perguntou mais, continuou o assunto. */
  readonly engajou: number;
  /** Ela FEZ algo logo depois. A evidência mais forte de utilidade. */
  readonly agiu: number;
  /** A janela de reação venceu sem sinal nenhum. */
  readonly ignorou: number;
  /** Ela disse, com todas as letras, que não quer isto. */
  readonly rejeitou: number;
  /** Enquanto este instante não passar, o assunto não interrompe. */
  readonly silenciado_ate: number | null;
  readonly atualizado_em: number;
}

export type Reacao = 'proposta' | 'engajou' | 'agiu' | 'ignorou' | 'rejeitou';

export function atencaoNova(assunto: string, agora: number): Atencao {
  return {
    assunto,
    propostas: 0,
    engajou: 0,
    agiu: 0,
    ignorou: 0,
    rejeitou: 0,
    silenciado_ate: null,
    atualizado_em: agora,
  };
}

/**
 * O interesse desta pessoa por este assunto, em [0,1]. Ver o cabeçalho para a
 * fórmula e para por que ela é suavizada.
 */
export function pesoDe(a: Atencao): number {
  const positivos = a.engajou + PESO_AGIU * a.agiu;
  const negativos = a.ignorou + PESO_REJEITOU * a.rejeitou;
  return (positivos + ALFA) / (positivos + negativos + 2 * ALFA);
}

/** O assunto está de castigo agora? */
export function silenciado(a: Atencao, agora: number): boolean {
  return a.silenciado_ate !== null && a.silenciado_ate > agora;
}

/**
 * Aplica uma reação observada. Puro: devolve a atenção nova.
 *
 * DUAS DECISÕES QUE PARECEM DETALHE E NÃO SÃO:
 *
 * 1. `agiu` LEVANTA O SILÊNCIO, mas não apaga a contagem de rejeições.
 *    É o caso da "preferência contraditória": a pessoa disse que não queria e,
 *    duas semanas depois, agiu por causa de um aviso do mesmo assunto. A
 *    evidência mais recente e mais forte manda — seria absurdo continuar calado
 *    sobre algo que ela acabou de usar. Mas apagar o histórico de rejeição faria
 *    a IARA esquecer que já foi inconveniente ali, e voltar a insistir com a
 *    mesma intensidade de antes. O histórico fica; o castigo sai.
 *
 * 2. `ignorou` NÃO gera silêncio, em nenhuma quantidade.
 *    Só derruba o peso. Silêncio é uma decisão sobre o que a pessoa DISSE, e ela
 *    não disse nada. Um assunto que só acumula silêncios acaba com peso baixo o
 *    bastante para não passar do limiar de fala — que é o mesmo efeito, obtido
 *    pela porta certa, e reversível no dia em que ela se interessar.
 */
export function aplicarReacao(a: Atencao, reacao: Reacao, agora: number): Atencao {
  const base = { ...a, atualizado_em: agora };

  switch (reacao) {
    case 'proposta':
      return { ...base, propostas: a.propostas + 1 };

    case 'engajou':
      return { ...base, engajou: a.engajou + 1 };

    case 'agiu':
      return { ...base, agiu: a.agiu + 1, silenciado_ate: null };

    case 'ignorou':
      return { ...base, ignorou: a.ignorou + 1 };

    case 'rejeitou': {
      const rejeitou = a.rejeitou + 1;
      const castigo =
        rejeitou >= REJEICOES_PARA_SILENCIO_LONGO ? SILENCIO_LONGO_MS : SILENCIO_POR_REJEICAO_MS;
      return { ...base, rejeitou, silenciado_ate: agora + castigo };
    }
  }
}
