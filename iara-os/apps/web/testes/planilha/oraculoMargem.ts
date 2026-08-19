/**
 * O ORÁCULO DA MARGEM — segunda opinião que não importa a implementação.
 *
 * `MargemOperacional` faz a conta que a IARA responde. Este arquivo faz a MESMA
 * conta por escrito próprio, a partir da REGRA, e é contra ele que a
 * implementação é comparada.
 *
 * A duplicação é o instrumento. Um verificador que chama `calcularMargem` para
 * conferir `calcularMargem` não confere nada — é a mesma opinião dita duas
 * vezes, o defeito que deixou "18:29" passar por um verificador que usava
 * `toLocaleString` para checar `toLocaleString`.
 *
 * AS DUAS FÓRMULAS, CONFIRMADAS CONTRA A PLANILHA REAL em 19/08/2026 por
 * `testes/gate/cobertura-tabela.mjs`, em 117 de 117 trechos:
 *
 *   margem_bruta        = (VALOR LOGISTICO − VALOR MOT) / VALOR LOGISTICO
 *   margem_com_pedagio  = (VALOR LOGISTICO − VALOR MOT − PEDAGIO IDA) / VALOR LOGISTICO
 *
 * O pedágio é o de IDA, nunca ida+volta: das 117 linhas, 117 conferem com IDA e
 * ZERO conferem com ida+volta. Não é escolha de projeto — é leitura do dado.
 *
 * O QUE ELE COMPARTILHA, declarado: as fórmulas acima e a chave do cruzamento.
 * As duas são fatos sobre a planilha, medidos. O oráculo confere a CONTA, não a
 * descoberta da regra.
 */

import type { CargaCompleta, PrecoDoTrecho, TabelaDeTrechos } from '../../servidor/nucleo/ClientePlanilhaOcis';

/** A chave, reescrita a partir da regra: só formatação é normalizada. */
export function chaveOraculo(origem: string, destino: string): string {
  const n = (v: string) =>
    v
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
  return `${n(origem)} > ${n(destino)}`;
}

export interface MargemEsperada {
  readonly receita: number;
  readonly custo: number;
  readonly pedagio: number;
  readonly resultado_bruto: number;
  readonly resultado_com_pedagio: number;
  readonly percentual_bruto: number | null;
  readonly percentual_com_pedagio: number | null;
  readonly com_preco: number;
  readonly sem_preco: number;
  readonly ambiguas: number;
  readonly sem_valor: number;
}

/**
 * A conta, escrita do zero. Um laço só, sem função auxiliar compartilhada com a
 * produção — de propósito: o objetivo é que um erro lá não tenha como estar aqui.
 */
export function margemEsperada(
  cargas: readonly CargaCompleta[],
  tabela: TabelaDeTrechos,
): MargemEsperada {
  let receita = 0;
  let custo = 0;
  let pedagio = 0;
  let comPreco = 0;
  let semPreco = 0;
  let ambiguas = 0;
  let semValor = 0;

  for (const c of cargas) {
    const k = chaveOraculo(c.origem, c.destino);
    if (tabela.ambiguas.has(k)) {
      ambiguas += 1;
      continue;
    }
    const p: PrecoDoTrecho | undefined = tabela.preco.get(k);
    if (!p) {
      semPreco += 1;
      continue;
    }
    if (c.valor === null) {
      semValor += 1;
      continue;
    }
    comPreco += 1;
    receita += c.valor;
    custo += p.valor_motorista;
    pedagio += p.pedagio_ida;
  }

  const bruto = receita - custo;
  const comPedagio = bruto - pedagio;
  return {
    receita,
    custo,
    pedagio,
    resultado_bruto: bruto,
    resultado_com_pedagio: comPedagio,
    percentual_bruto: receita > 0 ? (bruto / receita) * 100 : null,
    percentual_com_pedagio: receita > 0 ? (comPedagio / receita) * 100 : null,
    com_preco: comPreco,
    sem_preco: semPreco,
    ambiguas,
    sem_valor: semValor,
  };
}

// ---------------------------------------------------------------------------
// O tabelário de teste — pequeno, escrito à mão, com os casos que importam
// ---------------------------------------------------------------------------

const trecho = (
  origem: string,
  destino: string,
  mot: number,
  log: number,
  ida: number,
): PrecoDoTrecho => ({
  origem,
  destino,
  valor_motorista: mot,
  valor_logistico: log,
  pedagio_ida: ida,
  pedagio_ida_volta: ida * 2,
  /* As margens declaradas, calculadas pela mesma regra medida na planilha. */
  margem_bruta_declarada: (log - mot) / log,
  margem_com_pedagio_declarada: (log - mot - ida) / log,
});

/**
 * Espelha a estrutura da planilha real: SP→MT e SP→GO têm preço, MG→MT tem
 * preço, e MG→GO fica de FORA de propósito — é a rota sem tabelário, que existe
 * na realidade (39 delas em 2024) e precisa existir aqui.
 */
export const TABELA_TESTE: TabelaDeTrechos = {
  preco: new Map<string, PrecoDoTrecho>([
    [chaveOraculo('SP', 'MT'), trecho('SP', 'MT', 600, 1000, 50)],
    [chaveOraculo('SP', 'GO'), trecho('SP', 'GO', 1400, 2000, 100)],
    [chaveOraculo('MG', 'MT'), trecho('MG', 'MT', 700, 1000, 0)],
  ]),
  ambiguas: new Set<string>(),
};

/** O mesmo tabelário, com MG→GO marcada como ambígua — dois preços na planilha. */
export const TABELA_COM_AMBIGUA: TabelaDeTrechos = {
  preco: TABELA_TESTE.preco,
  ambiguas: new Set<string>([chaveOraculo('MG', 'GO')]),
};
