/**
 * A ficha do operador — o que a IARA sabe porque foi DITO a ela.
 *
 * Existe uma diferença de natureza entre este arquivo e a `TeoriaDaMente`, e
 * ela é o motivo de os dois não serem o mesmo módulo:
 *
 *   - `TeoriaDaMente` INFERE. Lê sinais observáveis do turno (caixa alta,
 *     rajada, léxico de crise) e produz uma leitura provisória, com confiança
 *     menor que 1 e com os sinais anexados para auditoria.
 *   - Este arquivo NÃO INFERE NADA. Todo campo aqui foi digitado pelo operador
 *     sobre si mesmo. Confiança é 1 por construção, e nada é derivado de outra
 *     coisa.
 *
 * O caso que criou este arquivo: a persona mandava tratar o operador por
 * "senhor"/"senhora", sem dizer de onde tirar qual. Não havendo fonte, o
 * modelo tirou do nome — e errou. Nome não carrega essa informação, em nenhum
 * idioma, e um sistema que a deduz vai errar com uma parcela dos usuários
 * sempre. A correção não é escolher um padrão melhor: é ter onde a pessoa
 * declarar, e não tratar enquanto ela não declarar.
 *
 * A ficha mora no shard privado do operador, como todo o resto que é dele.
 */

/**
 * Como a IARA se dirige a esta pessoa.
 *
 * `nome` é o padrão e o único valor que o sistema pode assumir sozinho: usa o
 * nome e mais nada. Os outros dois só existem porque foram escolhidos.
 */
export type TratamentoOperador = 'nome' | 'senhora' | 'senhor';

export const ROTULO_TRATAMENTO: Record<TratamentoOperador, string> = {
  nome: 'Só o nome',
  senhora: 'Senhora',
  senhor: 'Senhor',
};

export interface PreferenciasOperador {
  /**
   * O nome que a IARA usa em voz alta. Vazio = o nome da credencial.
   *
   * Separado do nome de login de propósito: "Daiane Cristina dos Santos" é
   * quem assina o contrato, "Daiane" é quem está na sala.
   */
  como_chamar: string;
  /** Forma de tratamento DECLARADA. Nunca inferida de nome, voz ou foto. */
  tratamento: TratamentoOperador;
  /** Cargo ou função. Contexto de trabalho — o que ela pode assumir que você sabe. */
  funcao: string;
  /** Instruções livres do operador sobre como quer ser atendido. */
  observacoes: string;
}

export const PREFERENCIAS_PADRAO: PreferenciasOperador = {
  como_chamar: '',
  tratamento: 'nome',
  funcao: '',
  observacoes: '',
};

const LIMITE_CURTO = 60;
const LIMITE_LONGO = 800;

/**
 * Saneador único, usado nos DOIS lados da fronteira: o parser do socket e o
 * formulário. Um fato, um lugar — se o limite de `observacoes` mudar, muda para
 * quem valida e para quem digita ao mesmo tempo, e o campo nunca aceita na tela
 * o que o servidor vai recusar calado.
 *
 * Aceita `unknown` porque do lado do socket é exatamente isso que chega.
 */
export function normalizarPreferencias(bruto: unknown): PreferenciasOperador {
  if (typeof bruto !== 'object' || bruto === null) return { ...PREFERENCIAS_PADRAO };
  const o = bruto as Record<string, unknown>;

  const texto = (v: unknown, limite: number): string =>
    typeof v === 'string' ? v.trim().slice(0, limite) : '';

  const tratamento = o.tratamento;
  return {
    como_chamar: texto(o.como_chamar, LIMITE_CURTO),
    tratamento:
      tratamento === 'senhora' || tratamento === 'senhor' || tratamento === 'nome'
        ? tratamento
        : 'nome',
    funcao: texto(o.funcao, LIMITE_CURTO),
    observacoes: texto(o.observacoes, LIMITE_LONGO),
  };
}

export const LIMITES_PREFERENCIAS = {
  curto: LIMITE_CURTO,
  longo: LIMITE_LONGO,
} as const;

/** Ficha em branco: nada foi declarado, então nada pode ser afirmado. */
export function fichaVazia(p: PreferenciasOperador): boolean {
  return (
    !p.como_chamar &&
    !p.funcao &&
    !p.observacoes &&
    p.tratamento === 'nome'
  );
}
