/**
 * MARGEM OPERACIONAL — a conta, pura, sobre carga já lida e tabelário já lido.
 *
 * O QUE A OPERAÇÃO TEM, medido em 19/08/2026 antes de escrever uma linha daqui:
 * a aba `TABELA` é um tabelário de preços por TRECHO, com 117 linhas, chave
 * `origem → destino` — a MESMA chave da rota nas abas de carga.
 *
 *   trechos únicos          117
 *   chaves ambíguas           0
 *   margem bruta confere    117 / 117
 *   margem com pedágio      117 / 117   (usa o pedágio de IDA, nunca ida+volta)
 *
 *   cobertura por CARGA     2026: 100%   2025: 94,4%   2024: 88,1%
 *   cobertura por ROTA      2026: 100%   2025: 82,3%   2024: 71,1%
 *
 * As duas coberturas divergem de propósito e a diferença é informação: em 2024,
 * 71% das rotas cobrem 88% das cargas, porque o que ficou de fora é rota de
 * pouco volume. Reportar só a primeira faria a análise parecer pior do que é;
 * reportar só a segunda esconderia que 39 rotas não têm preço.
 *
 * E A RECEITA JÁ ESTAVA NA CARGA: o campo `valor` de cada carga é IDÊNTICO ao
 * `VALOR LOGISTICO` do trecho em 2687 de 2687 cargas com valor (soma R$
 * 4.738.185 dos dois lados). Então receita vem da CARGA — que é o que foi de
 * fato faturado — e o custo vem da TABELA. Se um dia alguém editar o valor de
 * uma carga, a margem daquela carga muda, como deve.
 *
 * NADA AQUI FAZ I/O. Recebe cargas e tabelário, devolve conta. É o que permite
 * o oráculo independente comparar sem subir rede.
 */

import type { CargaCompleta, PrecoDoTrecho, TabelaDeTrechos } from './ClientePlanilhaOcis';
import { chaveDoTrecho, valorDaDimensao, type DimensaoContavel } from './ClientePlanilhaOcis';

/**
 * COMO A CARGA ENCONTROU (OU NÃO) O PREÇO DELA.
 *
 * `AMBIGUOUS` não é um detalhe teórico: se a TABELA tivesse duas linhas com
 * preços diferentes para o mesmo trecho, não existiria "a margem" daquele
 * trecho, e escolher uma delas seria inventar. Hoje são zero — e é justamente
 * por ser zero que o estado precisa existir, para o dia em que deixar de ser.
 */
export type ClasseDeMatch = 'EXACT' | 'AMBIGUOUS' | 'UNMATCHED' | 'SEM_VALOR';

export interface CoberturaDoJoin {
  readonly cargas: number;
  readonly com_preco: number;
  readonly sem_preco: number;
  readonly ambiguas: number;
  /** Carga com trecho na tabela mas sem valor faturado — não entra na conta. */
  readonly sem_valor: number;
  /** `null` quando não há carga nenhuma: 0/0 não é 0%. */
  readonly percentual: number | null;
  /** As rotas sem preço, da que mais pesa para a que menos. */
  readonly rotas_sem_preco: readonly { readonly rota: string; readonly cargas: number }[];
}

export interface Margem {
  readonly receita: number;
  readonly custo: number;
  readonly pedagio: number;
  readonly resultado_bruto: number;
  readonly resultado_com_pedagio: number;
  /**
   * A MARGEM AGREGADA — e ela NÃO é a média das margens das rotas.
   *
   * `(Σreceita − Σcusto) / Σreceita` pondera cada carga pelo que ela fatura.
   * `média(margem_da_rota)` trata uma rota de 1 carga igual a uma de 437, e as
   * duas respondem perguntas diferentes: "quanto sobra do que entrou" contra
   * "como é a margem típica de uma rota". As duas existem aqui, com nomes
   * diferentes, porque confundi-las é o erro clássico deste cálculo.
   */
  readonly percentual_bruto: number | null;
  readonly percentual_com_pedagio: number | null;
  readonly cobertura: CoberturaDoJoin;
}

/** O preço de uma carga, ou por que ela não tem. */
export function precoDaCarga(
  c: CargaCompleta,
  tabela: TabelaDeTrechos,
): { readonly classe: ClasseDeMatch; readonly preco: PrecoDoTrecho | null; readonly rota: string } {
  const rota = chaveDoTrecho(c.origem, c.destino);
  if (tabela.ambiguas.has(rota)) return { classe: 'AMBIGUOUS', preco: null, rota };
  const preco = tabela.preco.get(rota);
  if (!preco) return { classe: 'UNMATCHED', preco: null, rota };
  if (c.valor === null) return { classe: 'SEM_VALOR', preco, rota };
  return { classe: 'EXACT', preco, rota };
}

const percentual = (resultado: number, receita: number): number | null =>
  receita > 0 ? (resultado / receita) * 100 : null;

/**
 * A margem de um conjunto de cargas.
 *
 * RECEITA ZERO devolve `null`, nunca zero e nunca infinito. Zero por cento
 * afirmaria que não sobrou nada; a verdade é que não há denominador, e as duas
 * coisas levam a decisões opostas.
 */
export function calcularMargem(
  cargas: readonly CargaCompleta[],
  tabela: TabelaDeTrechos,
): Margem {
  let receita = 0;
  let custo = 0;
  let pedagio = 0;
  let comPreco = 0;
  let semPreco = 0;
  let ambiguas = 0;
  let semValor = 0;
  const rotasSemPreco = new Map<string, number>();

  for (const c of cargas) {
    const p = precoDaCarga(c, tabela);
    if (p.classe === 'AMBIGUOUS') {
      ambiguas += 1;
      continue;
    }
    if (p.classe === 'UNMATCHED') {
      semPreco += 1;
      rotasSemPreco.set(p.rota, (rotasSemPreco.get(p.rota) ?? 0) + 1);
      continue;
    }
    if (p.classe === 'SEM_VALOR') {
      semValor += 1;
      continue;
    }
    comPreco += 1;
    receita += c.valor ?? 0;
    custo += p.preco!.valor_motorista;
    pedagio += p.preco!.pedagio_ida;
  }

  const resultadoBruto = receita - custo;
  const resultadoComPedagio = resultadoBruto - pedagio;

  return {
    receita,
    custo,
    pedagio,
    resultado_bruto: resultadoBruto,
    resultado_com_pedagio: resultadoComPedagio,
    percentual_bruto: percentual(resultadoBruto, receita),
    percentual_com_pedagio: percentual(resultadoComPedagio, receita),
    cobertura: {
      cargas: cargas.length,
      com_preco: comPreco,
      sem_preco: semPreco,
      ambiguas,
      sem_valor: semValor,
      percentual: cargas.length > 0 ? (comPreco / cargas.length) * 100 : null,
      rotas_sem_preco: [...rotasSemPreco.entries()]
        .map(([rota, n]) => ({ rota, cargas: n }))
        .sort((a, b) => b.cargas - a.cargas),
    },
  };
}

export interface MargemDeGrupo {
  readonly chave: string;
  readonly margem: Margem;
}

/**
 * A margem de cada valor de uma dimensão — por posto, por central, por rota, por
 * motorista. Reaproveita `valorDaDimensao`, que é quem já decide o que é
 * ausência em cada dimensão; um segundo critério aqui divergiria do primeiro.
 *
 * Ordenado pelo RESULTADO ABSOLUTO, não pelo percentual — e a escolha é
 * substantiva. Uma central com 40% de margem sobre R$ 10 mil rende menos que uma
 * com 25% sobre R$ 800 mil, e quem pergunta "qual central gera mais margem"
 * quer a segunda. Quem quiser a de maior PERCENTUAL reordena; quem responde tem
 * de saber que são duas perguntas.
 */
export function margemPorDimensao(
  cargas: readonly CargaCompleta[],
  tabela: TabelaDeTrechos,
  dimensao: DimensaoContavel,
): readonly MargemDeGrupo[] {
  const grupos = new Map<string, CargaCompleta[]>();
  for (const c of cargas) {
    const v = valorDaDimensao(c, dimensao);
    if (v === null) continue; /* ausência não é entidade — a mesma regra de sempre */
    const lista = grupos.get(v);
    if (lista) lista.push(c);
    else grupos.set(v, [c]);
  }
  return [...grupos.entries()]
    .map(([chave, lista]) => ({ chave, margem: calcularMargem(lista, tabela) }))
    .sort((a, b) => b.margem.resultado_bruto - a.margem.resultado_bruto);
}

/**
 * A MÉDIA SIMPLES DAS MARGENS DAS ROTAS — a outra pergunta, com o outro nome.
 *
 * Existe para poder ser CONTRASTADA com `calcularMargem(...).percentual_bruto`,
 * nunca para substituí-la. "Nossa margem é 32%" (agregada) e "a rota típica tem
 * 28%" (média simples) são as duas verdadeiras e falam de coisas diferentes; o
 * dia em que alguém unificar as duas, esta função e o teste que a acompanha vão
 * dizer por que não dá.
 *
 * `null` quando nenhuma rota tem margem calculável.
 */
export function margemMediaDasRotas(
  cargas: readonly CargaCompleta[],
  tabela: TabelaDeTrechos,
): number | null {
  const porRota = margemPorDimensao(cargas, tabela, 'rota');
  const percentuais = porRota
    .map((g) => g.margem.percentual_bruto)
    .filter((p): p is number => p !== null);
  if (percentuais.length === 0) return null;
  return percentuais.reduce((s, p) => s + p, 0) / percentuais.length;
}
