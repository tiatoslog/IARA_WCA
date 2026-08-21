/**
 * COBERTURA — sobre QUANTO do universo aquele número foi calculado.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: quando a IARA diz "a margem foi 18%",
 * 18% de quê? De tudo? Do que tinha preço? Do que tinha preço E valor lançado?
 * Sem uma resposta tipada, as três frases saem idênticas — e levam a decisões
 * diferentes.
 *
 * POR QUE ELE EXISTE, SE `CoberturaDoJoin` JÁ EXISTE. `MargemOperacional.ts`
 * acertou a disciplina primeiro: `percentual: number | null`, porque 0/0 não é
 * 0%. Mas aquele tipo conhece carga, preço e rota — ele é a cobertura DAQUELE
 * cruzamento. O kernel não pode importar o vocabulário de um domínio para
 * decidir se uma conclusão é sustentável; precisaria de um tipo por domínio, e
 * a regra de "isto é amostra parcial" viraria uma cópia por habilidade. Aqui
 * mora a FORMA genérica; `deCoberturaDeJoin` traduz o caso da margem para ela
 * sem tocar em uma linha daquele arquivo — que é puro e comparável por oráculo,
 * e não deve mudar por causa disto.
 *
 * A REGRA, em uma frase: **ausência não é zero, e amostra não é população.**
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: não mede, não busca, não fala com o operador, não
 * conhece habilidade nem kernel. Aritmética e vocabulário puros, como
 * `Verdade.ts` e `Investigacao.ts` — pelo mesmo motivo: quem calcula, quem
 * contesta e quem redige precisam falar a mesma língua sobre "sobre quanto"
 * sem depender uns dos outros.
 */

// ---------------------------------------------------------------------------
// 1. Recorte — o filtro que produziu o subconjunto
// ---------------------------------------------------------------------------

/**
 * Uma dimensão pela qual o universo foi filtrado antes da conta.
 *
 * Existe separado da cobertura porque responde outra pergunta. Cobertura diz
 * "quantos dos elegíveis entraram"; recorte diz "quem era elegível". Um número
 * com 100% de cobertura sobre o recorte errado continua sendo o número errado,
 * e é o recorte que permite a `MotorCritica` notar que duas metades de uma
 * comparação não são comparáveis.
 */
export interface Recorte {
  /** `periodo`, `ano`, `motorista`, `status`. Estável e legível. */
  readonly dimensao: string;
  /** Como foi recortado: `2026-08-13..2026-08-19`, `CAMPINAS`. */
  readonly valor: string;
}

/** Duas listas de recorte descrevem o mesmo subconjunto? */
export function mesmoRecorte(a: readonly Recorte[], b: readonly Recorte[]): boolean {
  if (a.length !== b.length) return false;
  const chave = (r: Recorte): string => `${r.dimensao}=${r.valor}`;
  const ordenar = (lista: readonly Recorte[]): string[] => lista.map(chave).sort();
  const ea = ordenar(a);
  const eb = ordenar(b);
  return ea.every((x, i) => x === eb[i]);
}

// ---------------------------------------------------------------------------
// 2. Cobertura — a fração do recorte que entrou na conta
// ---------------------------------------------------------------------------

export interface Cobertura {
  /**
   * Quantos registros a fonte tem no total, ignorando o recorte. `null` quando
   * a habilidade não sabe — e `null` é resposta legítima, não falha: uma
   * consulta paginada honestamente não conhece o universo.
   */
  readonly universo: number | null;
  /** Quantos bateram o recorte. É o denominador de `percentual`. */
  readonly elegiveis: number;
  /** Quantos tinham o campo necessário e de fato entraram na conta. */
  readonly consideradas: number;
  /** `elegiveis - consideradas`. O que a conta NÃO viu. */
  readonly ausentes: number;
  /**
   * `consideradas / elegiveis * 100`, ou `null` quando não há elegível.
   *
   * `null` e não `0`, pela mesma razão de `MargemOperacional.percentual`: zero
   * por cento afirma que nada entrou de um conjunto que existia; sem elegível
   * não existe conjunto, e as duas coisas levam a decisões opostas.
   */
  readonly percentual: number | null;
  /** Por que os ausentes ficaram de fora. Vai inteiro para o operador. */
  readonly motivo_ausencia: string;
  readonly recorte: readonly Recorte[];
}

/**
 * Limiares de classificação. Declarados e exportados — mesma disciplina de
 * `FAIXAS` em `MotorAnalise.ts` e `DOMINANCIA_TIPO` em `AnaliseTabular.ts`:
 * convenção com nome, nunca número solto no meio de um `if`.
 *
 * 95 e 70 não são arbitrários: são os degraus onde a cobertura medida da
 * operação real cai (2026: 100%, 2025: 94,4%, 2024: 88,1% por carga). O ano
 * corrente fica em `completa`, os anteriores em `parcial` — e é exatamente
 * essa a diferença que a resposta precisa carregar.
 */
export const LIMIAR_COBERTURA = {
  completa: 100,
  alta: 95,
  parcial: 70,
} as const;

export type ClasseCobertura = 'completa' | 'alta' | 'parcial' | 'insuficiente' | 'vazia';

/**
 * Constrói a cobertura, calculando o que é derivado.
 *
 * `ausentes` e `percentual` NÃO são parâmetros — são consequência, e aceitar os
 * dois de fora abriria a porta para uma habilidade declarar 100% de cobertura
 * sobre 3 de 200 registros. Mesma disciplina de `criarHipotese`, que calcula a
 * confiança em vez de aceitá-la.
 */
export function medirCobertura(entrada: {
  readonly universo?: number | null;
  readonly elegiveis: number;
  readonly consideradas: number;
  readonly motivo_ausencia?: string;
  readonly recorte?: readonly Recorte[];
}): Cobertura {
  const elegiveis = Math.max(0, Math.trunc(entrada.elegiveis));
  /* Considerar mais do que era elegível é erro de quem chamou, não estado do
     mundo. Ceifar em silêncio esconderia o defeito; estourar derrubaria um
     turno por uma conta de relatório. Fica no teto e a crítica vê `ausentes: 0`
     num conjunto que deveria ter ausência — o sintoma aparece, nada quebra. */
  const consideradas = Math.min(elegiveis, Math.max(0, Math.trunc(entrada.consideradas)));
  const ausentes = elegiveis - consideradas;
  return {
    universo: entrada.universo ?? null,
    elegiveis,
    consideradas,
    ausentes,
    percentual: elegiveis > 0 ? (consideradas / elegiveis) * 100 : null,
    motivo_ausencia: entrada.motivo_ausencia ?? '',
    recorte: entrada.recorte ?? [],
  };
}

export function classificarCobertura(c: Cobertura): ClasseCobertura {
  if (c.percentual === null) return 'vazia';
  if (c.percentual >= LIMIAR_COBERTURA.completa) return 'completa';
  if (c.percentual >= LIMIAR_COBERTURA.alta) return 'alta';
  if (c.percentual >= LIMIAR_COBERTURA.parcial) return 'parcial';
  return 'insuficiente';
}

/**
 * O NÚCLEO DESTE ARQUIVO: um valor 0 sobre cobertura vazia NÃO é zero.
 *
 * "Nenhuma carga atrasada essa semana" e "não consegui apurar atraso nenhum"
 * saem da mesma expressão `atrasadas.length === 0`, e só a primeira é uma
 * afirmação sobre o mundo. Esta função é o que permite a `MotorCritica` separar
 * as duas sem conhecer carga nem atraso.
 */
export function zeroEhAusencia(valor: number | string, c: Cobertura): boolean {
  return valor === 0 && c.consideradas === 0;
}

/**
 * Este número pode ser apresentado como afirmação sobre a POPULAÇÃO do recorte?
 *
 * Só quando nada ficou de fora. `alta` não basta de propósito: 95% de cobertura
 * ainda deixa 1 em 20 fora, e "os motoristas da semana" com um motorista fora é
 * uma frase falsa — a ressalva custa uma linha, o erro custa a decisão.
 */
export function sustentaAfirmacaoPopulacional(c: Cobertura): boolean {
  return classificarCobertura(c) === 'completa';
}

/**
 * Duas coberturas são comparáveis entre si?
 *
 * O denominador móvel é o erro clássico da comparação entre períodos: 2024 tem
 * 88% de cobertura e 2026 tem 100%, então "a margem subiu 3 pontos" mistura
 * variação real com variação de quanto se enxerga. Recorte de dimensões
 * diferentes também não compara — semana contra mês não é queda, é escala.
 */
export function saoComparaveis(a: Cobertura, b: Cobertura): boolean {
  const dimensoes = (c: Cobertura): string => c.recorte.map((r) => r.dimensao).sort().join('|');
  /* O que precisa bater é a DIMENSÃO do recorte, nunca o valor dela: semana
     contra mês não compara; 2024 contra 2026 é exatamente o que se quer
     comparar. Valores diferentes na mesma dimensão são a comparação. */
  if (dimensoes(a) !== dimensoes(b)) return false;
  if (a.percentual === null || b.percentual === null) return false;
  /**
   * DISTÂNCIA, NÃO BALDE — a correção do P1 achado na auditoria independente.
   *
   * A primeira versão comparava a CLASSE (`ca === cb`), e o sinal saía
   * invertido nos números reais da operação:
   *
   *   2025 (94,4% `parcial`) × 2024 (88,1% `parcial`)  →  comparáveis  ← 6,3 pontos
   *   99,9% (`alta`)         × 100%  (`completa`)      →  NÃO          ← 0,1 ponto
   *
   * Um gap de 6 pontos passava e um de 0,1 reprovava, porque a fronteira de
   * balde caía no meio. Classe existe para RESUMIR a cobertura numa palavra na
   * resposta; não serve para decidir se dois números se comparam. A pergunta
   * certa é "o quanto eu enxergo de um lado difere do quanto eu enxergo do
   * outro", e isso é uma subtração.
   */
  return Math.abs(a.percentual - b.percentual) <= TOLERANCIA_COMPARACAO_PP;
}

/**
 * Quantos PONTOS PERCENTUAIS de diferença de cobertura ainda deixam dois
 * números comparáveis.
 *
 * 5 não é estatística: é a folga abaixo da qual a variação de cobertura não
 * explica sozinha uma diferença que valha decisão. Acima disso, parte do que
 * parece variação do mundo é variação de quanto o sistema enxerga — e a
 * resposta precisa dizer isso.
 */
export const TOLERANCIA_COMPARACAO_PP = 5;

/**
 * A cobertura dita em português, para entrar na resposta.
 *
 * Devolve vazio quando é `completa` — encher toda resposta de "sobre 100% dos
 * registros" é o ruído que `RESSALVA` em `Verdade.ts` já evita pelo mesmo
 * motivo: ressalva constante deixa de ser lida, inclusive quando importa.
 */
export function frasearCobertura(c: Cobertura): string {
  const classe = classificarCobertura(c);
  if (classe === 'completa') return '';
  if (classe === 'vazia') {
    return 'Não havia registro nenhum no recorte pedido — isto não é um resultado zero, é ausência de dado.';
  }
  const pct = (c.percentual ?? 0).toFixed(1);
  const motivo = c.motivo_ausencia ? ` (${c.motivo_ausencia})` : '';
  return (
    `Isto vale sobre ${c.consideradas} de ${c.elegiveis} registros — ${pct}% do recorte; ` +
    `${c.ausentes} ficaram de fora${motivo}.`
  );
}

/**
 * Adaptador para o cruzamento carga × tabelário.
 *
 * A forma do parâmetro é estrutural de propósito — este módulo não importa
 * `MargemOperacional`, que vive fora do kernel e conhece rede. Importar de lá
 * para cá violaria a fronteira que `fronteira-interna.test.ts` guarda; e o tipo
 * estrutural aceita `CoberturaDoJoin` sem que nenhum dos dois arquivos saiba do
 * outro.
 */
export function deCoberturaDeJoin(
  j: {
    readonly cargas: number;
    readonly com_preco: number;
    readonly sem_preco: number;
    readonly ambiguas: number;
    readonly sem_valor: number;
  },
  recorte: readonly Recorte[] = [],
): Cobertura {
  const motivos = [
    j.sem_preco > 0 ? `${j.sem_preco} sem preço de trecho` : '',
    j.sem_valor > 0 ? `${j.sem_valor} sem valor faturado` : '',
    j.ambiguas > 0 ? `${j.ambiguas} com trecho ambíguo na tabela` : '',
  ].filter(Boolean);
  return medirCobertura({
    universo: null,
    elegiveis: j.cargas,
    consideradas: j.com_preco,
    motivo_ausencia: motivos.join(', '),
    recorte,
  });
}
