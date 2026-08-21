/**
 * COMPARAÇÃO ENTRE DOIS RECORTES — a conta, pura, e as três armadilhas dela.
 *
 * A operadora pediu isto em 19/08/2026, e nomeou as armadilhas junto: base
 * zero, ponto percentual contra por cento, e contribuição. As três estão aqui,
 * cada uma com o comentário do que aconteceria se fosse ignorada.
 *
 *   1. BASE ZERO. `((B − A) / A) × 100` com `A = 0` é divisão por zero. Um
 *      sistema que devolve `Infinity%`, `100%` ou `0%` nesse caso está
 *      inventando: não existe variação percentual contra nada. A resposta certa
 *      é `null` e a frase é "não havia base para comparar".
 *
 *   2. PONTO PERCENTUAL ≠ POR CENTO. Uma margem que sai de 30% para 33% subiu
 *      TRÊS PONTOS PERCENTUAIS, e subiu 10% em termos relativos. Dizer "+3%"
 *      ali é errado, e é o erro mais comum desta conta inteira — por isso a
 *      variação de uma métrica que JÁ É percentual tem tipo próprio e nome
 *      próprio, e nunca compartilha campo com a variação de um volume.
 *
 *   3. CONTRIBUIÇÃO PODE PASSAR DE 100%. Se a operação caiu 100 e uma central
 *      caiu 150 enquanto outra subiu 50, a primeira "explica" 150% da queda.
 *      Isso é verdade, não defeito — e cortar em 100% esconderia justamente a
 *      informação mais útil: que existe movimento em direções opostas. O que
 *      não se pode é apresentar isso sem dizer.
 *
 * MÓDULO PURO: recebe dois números (ou dois conjuntos já agregados) e devolve a
 * conta. Não sabe o que é carga, ano ou margem.
 */

/** Uma grandeza que se compara entre dois recortes. */
export interface Comparacao {
  readonly anterior: number;
  readonly atual: number;
  /** `atual − anterior`. Sempre existe. */
  readonly delta: number;
  /**
   * `((atual − anterior) / anterior) × 100`. `null` quando não havia base —
   * NUNCA `Infinity`, nunca zero. Ver a armadilha 1.
   */
  readonly variacao_pct: number | null;
  /** Por que a variação é `null`, para a frase poder dizer. */
  readonly sem_base: boolean;
}

export function comparar(anterior: number, atual: number): Comparacao {
  const delta = atual - anterior;
  const semBase = anterior === 0;
  return {
    anterior,
    atual,
    delta,
    variacao_pct: semBase ? null : (delta / anterior) * 100,
    sem_base: semBase,
  };
}

/**
 * A comparação de uma métrica que JÁ É PERCENTUAL — margem, taxa, proporção.
 *
 * Tipo separado de propósito. Se compartilhasse `Comparacao`, mais cedo ou mais
 * tarde alguém leria `variacao_pct` de uma margem e escreveria "+3%" onde são
 * três PONTOS. O nome do campo é a trava.
 */
export interface ComparacaoPercentual {
  readonly anterior_pct: number | null;
  readonly atual_pct: number | null;
  /** A diferença em PONTOS PERCENTUAIS. 30% → 33% dá 3, não 10. */
  readonly delta_pp: number | null;
  /** A variação RELATIVA. 30% → 33% dá 10. É outra pergunta. */
  readonly variacao_relativa_pct: number | null;
}

export function compararPercentual(
  anteriorPct: number | null,
  atualPct: number | null,
): ComparacaoPercentual {
  if (anteriorPct === null || atualPct === null) {
    return {
      anterior_pct: anteriorPct,
      atual_pct: atualPct,
      delta_pp: null,
      variacao_relativa_pct: null,
    };
  }
  return {
    anterior_pct: anteriorPct,
    atual_pct: atualPct,
    delta_pp: atualPct - anteriorPct,
    variacao_relativa_pct: anteriorPct === 0 ? null : ((atualPct - anteriorPct) / anteriorPct) * 100,
  };
}

export interface ContribuicaoDeGrupo {
  readonly chave: string;
  readonly anterior: number;
  readonly atual: number;
  readonly delta: number;
  /**
   * Que fatia do movimento TOTAL este grupo explica. `null` quando o total não
   * se moveu — dividir por zero aqui produziria o mesmo `Infinity` da armadilha
   * 1, com outra roupa.
   *
   * PODE PASSAR DE 100% e pode ser NEGATIVA: um grupo que subiu enquanto o
   * total caiu contribui negativamente para a queda. Ver a armadilha 3.
   */
  readonly contribuicao_pct: number | null;
}

export interface Decomposicao {
  readonly total: Comparacao;
  /** Do que mais explica o movimento para o que menos — por MÓDULO do delta. */
  readonly grupos: readonly ContribuicaoDeGrupo[];
  /** Existe grupo andando na direção oposta à do total? A frase precisa dizer. */
  readonly tem_direcao_oposta: boolean;
  /** Grupos que só existem num dos dois recortes. Entram, e são declarados. */
  readonly so_no_anterior: readonly string[];
  readonly so_no_atual: readonly string[];
}

/**
 * De onde veio a diferença — a decomposição que transforma "caiu 12%" em "estas
 * três centrais explicam 80% da queda".
 *
 * ENTRA E SAI GRUPO, e os dois casos são declarados. Uma central que existia em
 * 2025 e sumiu em 2026 tem delta igual ao seu volume inteiro; escondê-la faria
 * a soma das contribuições não fechar, e quem lê nunca saberia por quê.
 */
export function decompor(
  anterior: ReadonlyMap<string, number>,
  atual: ReadonlyMap<string, number>,
): Decomposicao {
  const chaves = new Set([...anterior.keys(), ...atual.keys()]);
  const somaA = [...anterior.values()].reduce((s, v) => s + v, 0);
  const somaB = [...atual.values()].reduce((s, v) => s + v, 0);
  const total = comparar(somaA, somaB);

  const grupos: ContribuicaoDeGrupo[] = [];
  for (const chave of chaves) {
    const a = anterior.get(chave) ?? 0;
    const b = atual.get(chave) ?? 0;
    const delta = b - a;
    grupos.push({
      chave,
      anterior: a,
      atual: b,
      delta,
      contribuicao_pct: total.delta === 0 ? null : (delta / total.delta) * 100,
    });
  }
  grupos.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));

  const direcaoDoTotal = Math.sign(total.delta);
  return {
    total,
    grupos,
    tem_direcao_oposta:
      direcaoDoTotal !== 0 && grupos.some((g) => g.delta !== 0 && Math.sign(g.delta) !== direcaoDoTotal),
    so_no_anterior: [...anterior.keys()].filter((k) => !atual.has(k)),
    so_no_atual: [...atual.keys()].filter((k) => !anterior.has(k)),
  };
}

// ---------------------------------------------------------------------------
// Como isso vira frase
// ---------------------------------------------------------------------------

const numero = (v: number, casas = 1): string =>
  v.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

/**
 * "subiu 12,3%" / "caiu 4,1%" / "não mudou" / "sem base de comparação".
 *
 * A frase NUNCA inventa percentual sem base. "Saiu de 0 para 340" é um fato
 * completo; "subiu ∞%" é ruído com cara de número.
 */
export function dizerVariacao(c: Comparacao): string {
  if (c.delta === 0) return 'não mudou';
  if (c.sem_base) {
    return `saiu de zero para ${numero(c.atual, 0)}, e não havia base para calcular variação percentual`;
  }
  const verbo = c.delta > 0 ? 'subiu' : 'caiu';
  return `${verbo} ${numero(Math.abs(c.variacao_pct ?? 0))}%`;
}

/**
 * A frase da métrica percentual, com as DUAS leituras — e o ponto percentual
 * vem primeiro porque é o que a pergunta "a margem melhorou?" quer saber.
 */
export function dizerVariacaoPercentual(c: ComparacaoPercentual): string {
  if (c.anterior_pct === null || c.atual_pct === null) {
    return 'não dá para comparar: falta o percentual de um dos lados';
  }
  if (c.delta_pp === 0) return 'ficou igual';
  const verbo = (c.delta_pp ?? 0) > 0 ? 'subiu' : 'caiu';
  /* As duas formas inteiras, e não um sufixo montado: "percentual" + "is" dava
     "percentualis". Plural de português não sai de concatenação. */
  const abs = Math.abs(c.delta_pp ?? 0);
  const unidade = abs === 1 ? 'ponto percentual' : 'pontos percentuais';
  const pp = `${verbo} ${numero(abs)} ${unidade}`;
  if (c.variacao_relativa_pct === null) return pp;
  return `${pp} (de ${numero(c.anterior_pct)}% para ${numero(c.atual_pct)}%, o que é ${numero(Math.abs(c.variacao_relativa_pct))}% em termos relativos)`;
}
