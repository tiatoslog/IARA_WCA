/**
 * O ORÇAMENTO DO TURNO — a trava que faltava ao lado das que já existem.
 *
 * O porteiro pergunta "quem autorizou?". O sandbox pergunta "este papel pode?".
 * A autonomia pergunta "este nível alcança?". Nenhuma das três pergunta
 * **quanto**. Um turno sem teto é um turno que pode custar qualquer coisa, e
 * quem paga é a operadora.
 *
 * O QUE EXISTIA E NÃO ERA ORÇAMENTO:
 *
 *   custo_estimado: 'zero' | 'tokens'      ← rótulo de duas palavras
 *   MAX_PASSOS = 6                          ← forma do plano, não custo do passo
 *
 * Um passo pode virar uma chamada de modelo, que vira quatro tentativas de
 * provedor, cada uma com prompt de 4 mil tokens. `MAX_PASSOS` não vê nada disso.
 *
 * DECREMENTADO POR EXECUÇÃO REAL, nunca por previsão. O planejador dizer que vai
 * usar três ferramentas não gasta nada; a terceira ferramenta rodando gasta o
 * terceiro passo. Previsão é do planejador, e o planejador é justamente quem
 * pode estar errado.
 *
 * ESTOURO BLOQUEIA A AÇÃO SEGUINTE — não apenas registra. Registrar sem bloquear
 * é ter o número do prejuízo depois de pagá-lo.
 *
 * O QUE ESTE MÓDULO NÃO CONSEGUE FAZER, e está declarado porque a alternativa
 * seria uma falsa sensação de teto:
 *
 *  · TOKEN E TEMPO NÃO SE PREEMPTAM. Ninguém sabe quantos tokens uma chamada vai
 *    custar antes de fazê-la, e a chamada em voo não é cortada por este módulo (o
 *    `AbortController` do turno é quem faz isso). O teto de token pergunta "já
 *    gastei demais para começar a PRÓXIMA?". É teto de acumulado, e o pior caso
 *    real é um estouro do tamanho de uma chamada.
 *  · CUSTO EM DINHEIRO passou a ser contado em 19/08/2026, e a ressalva que
 *    estava aqui continua valendo por baixo: preço não se inventa. As camadas
 *    gratuitas têm zero declarado porque isso é fato da instalação; a paga só
 *    tem custo quando alguém declara o preço no ambiente, e sem declaração o
 *    turno registra `null` — que NÃO é zero. Ver `PrecoDoRaciocinio.ts`.
 *    O teto de dinheiro nasce sem valor pelo mesmo motivo: um limite cuja
 *    unidade ninguém declarou bloquearia turno por um número que ninguém
 *    escolheu.
 *  · PARALELISMO não tem teto porque não há paralelismo: o Kernel serializa
 *    turnos e passos. No dia em que houver, o teto entra aqui.
 */

import { lerConfig } from './Configuracao';

export type RecursoOrcado =
  /**
   * UMA VOLTA DO LAÇO — decidir, executar, observar.
   *
   * Não é o mesmo recurso que `chamada_modelo`, e confundir os dois foi o que
   * segurou o laço até 19/08/2026. Uma volta gasta UMA chamada de modelo para
   * decidir, mas o turno gasta outras que não são volta nenhuma: a síntese
   * final e a escalada por verificação. Um teto só para as duas coisas obriga a
   * escolher entre "o laço pensa pouco" e "a síntese fica sem orçamento".
   *
   * `voltas: 1` reproduz exatamente o pipeline anterior ao laço — uma decisão,
   * uma execução, uma resposta. É a saída de emergência sem código morto: não
   * existe caminho desligado, existe teto de um.
   */
  | 'volta'
  /** Uma habilidade EXECUTADA. É a chamada de ferramenta do contrato. */
  | 'passo'
  /** Uma ida ao provedor pedida pelo Kernel (planejar, sintetizar). */
  | 'chamada_modelo'
  /**
   * Cada ELO tentado dentro de uma chamada: a retentativa e o fallback da
   * cadeia. Sem este, o teto de chamada mediria 1 onde o custo foi 4.
   */
  | 'tentativa_provedor'
  /** Passo cuja semântica declarada altera o mundo. Teto separado de `passo`. */
  | 'efeito_externo'
  /** Soma de tokens de entrada e saída. Contado DEPOIS, gate na próxima. */
  | 'tokens'
  /**
   * DINHEIRO, em micro-centavos. Não é o mesmo recurso que `tokens`, e a
   * diferença é o preço: três chamadas de tokens iguais custam zero na camada
   * gratuita e custam de verdade na paga. Um teto de tokens não vê isso.
   *
   * REGISTRADO DEPOIS, como `tokens`: ninguém sabe o custo antes de pagar. O
   * teto atua na chamada seguinte.
   */
  | 'custo'
  /** Tempo de parede do turno. Global: estourado, bloqueia todo o resto. */
  | 'tempo';

export interface TetosDoTurno {
  /** Quantas vezes o modelo pode decidir dentro de um turno. Ver `RecursoOrcado`. */
  readonly voltas: number;
  readonly passos: number;
  readonly chamadas_modelo: number;
  readonly tentativas_provedor: number;
  readonly efeitos_externos: number;
  readonly tokens: number;
  readonly tempo_ms: number;
  /**
   * TETO DE DINHEIRO POR TURNO, em micro-centavos.
   *
   * O PADRÃO É "SEM TETO", e é a única escolha honesta hoje: um limite de
   * dinheiro cuja unidade ninguém declarou bloquearia turno com base num número
   * que ninguém escolheu. O custo passa a ser SEMPRE medido e registrado; quem
   * conhece a própria conta declara o teto em `IARA_ORCAMENTO_CUSTO_CENTAVOS`.
   *
   * `Number.MAX_SAFE_INTEGER` e não `Infinity`: o orçamento compara e soma
   * inteiros, e um `Infinity` no meio da aritmética viraria `NaN` na primeira
   * subtração.
   */
  readonly custo_micro_centavos: number;
}

/**
 * Padrões que NÃO mudam o comportamento de um turno honesto desta máquina, e
 * cortam o turno patológico.
 *
 * `tempo_ms` é 15 min porque o provedor local desta máquina leva ~263 s por
 * chamada (medido, ver `testes/campanha/LEIA-ME.md`): duas chamadas já passam de
 * 9 minutos. Um teto de 60 s pareceria rigoroso e transformaria a operação
 * normal em recusa — que é o modo mais rápido de alguém desligar o orçamento.
 */
export const TETOS_PADRAO: TetosDoTurno = {
  /**
   * OITO VOLTAS, e o número vem de `GuardaDeLaco.VOLTAS_PADRAO` — que é quem
   * argumenta por ele. Repetido aqui como literal, e não importado, porque o
   * orçamento não pode depender da guarda: são duas travas independentes sobre
   * o mesmo laço, e uma importando a outra as tornaria uma só. Há teste
   * travando a igualdade.
   */
  voltas: 8,
  /**
   * DOZE PASSOS, dobro do que era. O laço executa habilidade em VÁRIAS voltas;
   * o teto antigo de 6 era o total de um plano único e, sob laço, seria gasto
   * pela primeira decomposição — as voltas seguintes decidiriam sem poder agir.
   * Dois passos por volta em seis voltas efetivas é o que este número compra.
   */
  passos: 12,
  /**
   * DOZE CHAMADAS: até oito decisões do laço, mais a síntese, mais a escalada
   * por verificação, mais folga para a retomada de pendência. O teto anterior
   * era 3 — dimensionado para um pipeline de duas chamadas, e cabia exato. Sob
   * laço ele morreria na volta 3 de todo pedido de dois saltos, e o operador
   * receberia "orçamento estourado" onde antes recebia resposta: regressão, não
   * evolução.
   *
   * O que torna isto pagável é o catálogo ter saído de `mensagem` para o
   * prefixo cacheado (medido: 7.448 → 101 tokens de escrita por decisão).
   * Sem aquela mudança, subir este número multiplicaria a conta por quatro.
   */
  chamadas_modelo: 12,
  /** Duas tentativas de rede por chamada de modelo. */
  tentativas_provedor: 24,
  efeitos_externos: 4,
  tokens: 120_000,
  tempo_ms: 900_000,
  custo_micro_centavos: Number.MAX_SAFE_INTEGER,
};

export type VeredictoOrcamento =
  | { readonly permitido: true }
  | {
      readonly permitido: false;
      readonly recurso: RecursoOrcado;
      readonly teto: number;
      readonly gasto: number;
      /** Uma frase para o operador. Nunca "erro interno". */
      readonly motivo: string;
    };

const ROTULO: Readonly<Record<RecursoOrcado, string>> = {
  volta: 'voltas do laço',
  passo: 'passos executados',
  custo: 'custo',
  chamada_modelo: 'chamadas ao modelo',
  tentativa_provedor: 'tentativas de provedor',
  efeito_externo: 'efeitos no mundo',
  tokens: 'tokens',
  tempo: 'tempo',
};

export class OrcamentoDoTurno {
  private readonly gastos: Record<RecursoOrcado, number> = {
    volta: 0,
    passo: 0,
    chamada_modelo: 0,
    tentativa_provedor: 0,
    efeito_externo: 0,
    tokens: 0,
    custo: 0,
    tempo: 0,
  };

  private readonly inicio: number;
  /** O primeiro recurso que estourou. O turno inteiro herda esse motivo. */
  private primeiroEstouro: VeredictoOrcamento | null = null;

  constructor(
    readonly tetos: TetosDoTurno = TETOS_PADRAO,
    private readonly agora: () => number = () => Date.now(),
  ) {
    this.inicio = agora();
  }

  private tetoDe(r: RecursoOrcado): number {
    switch (r) {
      case 'volta':
        return this.tetos.voltas;
      case 'passo':
        return this.tetos.passos;
      case 'chamada_modelo':
        return this.tetos.chamadas_modelo;
      case 'tentativa_provedor':
        return this.tetos.tentativas_provedor;
      case 'efeito_externo':
        return this.tetos.efeitos_externos;
      case 'tokens':
        return this.tetos.tokens;
      case 'custo':
        return this.tetos.custo_micro_centavos;
      case 'tempo':
        return this.tetos.tempo_ms;
    }
  }

  private recusa(r: RecursoOrcado, gasto: number): VeredictoOrcamento {
    const teto = this.tetoDe(r);
    const v = {
      permitido: false as const,
      recurso: r,
      teto,
      gasto,
      motivo:
        r === 'tempo'
          ? `este turno passou do tempo máximo (${Math.round(teto / 1000)}s) e eu parei aqui`
          : `este turno bateu o teto de ${ROTULO[r]} (${teto}) e eu parei aqui`,
    };
    this.primeiroEstouro ??= v;
    return v;
  }

  decorrido(): number {
    return this.agora() - this.inicio;
  }

  /**
   * A ÚNICA porta de gasto. Confere e só então debita — recurso recusado não
   * consome orçamento, senão a recusa iria empurrando o gasto para cima e a
   * mensagem para o operador mudaria de recurso a cada tentativa.
   *
   * O TEMPO É CONFERIDO EM TODA CHAMADA, seja qual for o recurso pedido: relógio
   * de parede é global, e um turno que já passou do tempo não pode continuar
   * "porque ainda tem passo sobrando".
   */
  consumir(recurso: RecursoOrcado, quantidade = 1): VeredictoOrcamento {
    return this.consumirVarios([{ recurso, quantidade }]);
  }

  /**
   * CABERIA? — a mesma conferência de `consumirVarios`, sem debitar.
   *
   * Existe para a ESCALADA POR VERIFICAÇÃO: a decisão de escalar precisa saber
   * se há orçamento ANTES de decidir, e `decidirEscalada` é função pura que
   * recebe a resposta pronta. Perguntar consumindo faria o simples ato de
   * avaliar a escalada gastar a chamada que talvez não fosse usada.
   *
   * NÃO SUBSTITUI `consumir`. Quem escala pergunta aqui e debita lá — e o débito
   * confere de novo, que é o que mantém esta função como consulta e não como
   * autorização.
   */
  podeGastar(
    pedidos: readonly { readonly recurso: RecursoOrcado; readonly quantidade?: number }[],
  ): boolean {
    if (this.decorrido() > this.tetos.tempo_ms) return false;
    return pedidos.every(
      (p) => this.gastos[p.recurso] + (p.quantidade ?? 1) <= this.tetoDe(p.recurso),
    );
  }

  /**
   * Vários recursos na mesma decisão, com TUDO OU NADA.
   *
   * Existe porque um passo de escrita gasta duas coisas (`passo` e
   * `efeito_externo`) e debitar a primeira antes de saber da segunda deixaria o
   * orçamento contando um passo que não aconteceu.
   */
  consumirVarios(
    pedidos: readonly { readonly recurso: RecursoOrcado; readonly quantidade?: number }[],
  ): VeredictoOrcamento {
    const decorrido = this.decorrido();
    if (decorrido > this.tetos.tempo_ms) return this.recusa('tempo', decorrido);

    /**
     * OS RECURSOS QUE SÓ SE REGISTRAM SÃO CONFERIDOS AQUI — e a falta disto era
     * um teto que não existia.
     *
     * `tokens` e `custo` não podem ser pedidos ANTES da chamada: ninguém sabe o
     * tamanho nem o preço até pagar. Por isso eles entram por `registrar`, e o
     * cabeçalho sempre disse que "o teto atua na chamada seguinte". Só que a
     * chamada seguinte pede `chamada_modelo`, e o laço abaixo confere apenas os
     * recursos PEDIDOS — então nada nunca olhava o acumulado. Auditoria de
     * 19/08/2026: `consumir('tokens')` não existe em lugar nenhum do servidor, e
     * o teto de 120.000 era um número que nada lia.
     *
     * São globais como o tempo, e pelo mesmo motivo: um turno que já gastou
     * demais não pode continuar "porque ainda tem passo sobrando".
     */
    for (const r of ['tokens', 'custo'] as const) {
      if (this.gastos[r] > this.tetoDe(r)) return this.recusa(r, this.gastos[r]);
    }

    for (const p of pedidos) {
      const q = p.quantidade ?? 1;
      if (this.gastos[p.recurso] + q > this.tetoDe(p.recurso)) {
        return this.recusa(p.recurso, this.gastos[p.recurso]);
      }
    }
    for (const p of pedidos) this.gastos[p.recurso] += p.quantidade ?? 1;
    return { permitido: true };
  }

  /**
   * Contabilidade do que JÁ foi gasto e não podia ser pedido antes — token é o
   * caso. Não recusa nada: o efeito dela aparece na `consumir` seguinte.
   */
  registrar(recurso: RecursoOrcado, quantidade: number): void {
    this.gastos[recurso] += quantidade;
  }

  gasto(recurso: RecursoOrcado): number {
    return recurso === 'tempo' ? this.decorrido() : this.gastos[recurso];
  }

  /** O recurso que estourou primeiro, ou `null`. Para a fala e para o jornal. */
  get estouro(): VeredictoOrcamento | null {
    return this.primeiroEstouro;
  }

  /** Uma linha por recurso gasto. Vai para o jornal de auditoria. */
  resumo(): string {
    const partes: string[] = [];
    for (const r of Object.keys(this.gastos) as RecursoOrcado[]) {
      if (r === 'tempo' || this.gastos[r] === 0) continue;
      partes.push(`${ROTULO[r]} ${this.gastos[r]}/${this.tetoDe(r)}`);
    }
    partes.push(`tempo ${Math.round(this.decorrido())}ms/${this.tetos.tempo_ms}ms`);
    return partes.join(' · ');
  }
}

// ---------------------------------------------------------------------------
// A fronteira com o ambiente
// ---------------------------------------------------------------------------

import { MICRO_CENTAVOS_POR_CENTAVO } from '../PrecoDoRaciocinio';

const numero = (variavel: string, padrao: number): number => {
  /* `lerConfig` LEVANTA em valor contaminado, e é o comportamento certo: um teto
     de orçamento colado errado no painel do host não pode virar "sem teto" nem
     "teto zero" em silêncio. */
  const bruto = lerConfig(variavel);
  if (bruto === null) return padrao;
  const n = Number(bruto);
  /* `numero` no REGISTRO já barra não-inteiro. Zero é recusado aqui porque teto
     zero significa "nenhuma ação permitida", que ninguém configura de propósito
     e produziria uma IARA que recusa tudo sem explicar por quê. */
  return Number.isInteger(n) && n > 0 ? n : padrao;
};

export function tetosDoAmbiente(): TetosDoTurno {
  return {
    /* `IARA_ORCAMENTO_VOLTAS=1` devolve o comportamento de antes do laço. */
    voltas: numero('IARA_ORCAMENTO_VOLTAS', TETOS_PADRAO.voltas),
    passos: numero('IARA_ORCAMENTO_PASSOS', TETOS_PADRAO.passos),
    chamadas_modelo: numero('IARA_ORCAMENTO_CHAMADAS_MODELO', TETOS_PADRAO.chamadas_modelo),
    tentativas_provedor: numero(
      'IARA_ORCAMENTO_TENTATIVAS_PROVEDOR',
      TETOS_PADRAO.tentativas_provedor,
    ),
    efeitos_externos: numero('IARA_ORCAMENTO_EFEITOS', TETOS_PADRAO.efeitos_externos),
    tokens: numero('IARA_ORCAMENTO_TOKENS', TETOS_PADRAO.tokens),
    tempo_ms: numero('IARA_ORCAMENTO_TEMPO_MS', TETOS_PADRAO.tempo_ms),
    /* Declarado em CENTAVOS, guardado em micro-centavos: quem configura pensa
       em dinheiro, a aritmética interna pensa em inteiro. */
    custo_micro_centavos:
      numero('IARA_ORCAMENTO_CUSTO_CENTAVOS', 0) > 0
        ? numero('IARA_ORCAMENTO_CUSTO_CENTAVOS', 0) * MICRO_CENTAVOS_POR_CENTAVO
        : TETOS_PADRAO.custo_micro_centavos,
  };
}
