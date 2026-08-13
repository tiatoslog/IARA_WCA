/**
 * Normalização de texto. Utilitário puro, sem opinião sobre intenção.
 *
 * Morava dentro do `RoteadorIntencoes`, e quatro módulos que nada têm a ver com
 * roteamento importavam de lá (`RagHistorico`, `TeoriaDaMente`, `Percepcao`,
 * `dados`). Importar de um módulo de decisão o que é só uma função de string
 * cria dependência falsa — e foi parte do que manteve viva uma camada de
 * roteamento que já não decidia nada.
 */

/**
 * Remove acento, uniformiza caixa e colapsa espaço.
 *
 * SEM isto, `/ja aconteceu/` nunca casa com "já aconteceu" — o bug silencioso
 * mais comum em reconhecedor PT-BR.
 *
 * A faixa de marcas combinantes vai na forma ESCAPADA, não literal: a forma
 * literal depende de a codificação do arquivo sobreviver a todo editor que um
 * dia tocar nele.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Concord\u00e2ncia de n\u00famero. Existe para matar o `(s)`.
 *
 * `"3 central(is) ativa(s)"` e `"2 lembrete(s)"` s\u00e3o a voz de formul\u00e1rio de
 * reparti\u00e7\u00e3o, e apareciam na resposta mais frequente da opera\u00e7\u00e3o \u2014 quantas
 * centrais temos. Nenhuma pessoa escreve assim para outra; escreve-se assim
 * quando n\u00e3o se sabe o n\u00famero na hora de redigir. Aqui se sabe: o n\u00famero est\u00e1
 * no argumento.
 *
 * O plural \u00e9 EXPL\u00cdCITO, e \u00e9 a \u00fanica decis\u00e3o de projeto que este utilit\u00e1rio
 * toma. Derivar plural de portugu\u00eas por regra (`+s`, `-l` \u2192 `-is`, `-\u00e3o` \u2192
 * `-\u00f5es`) acerta a maioria e erra em sil\u00eancio o resto, e um utilit\u00e1rio de
 * reda\u00e7\u00e3o que erra em sil\u00eancio produz exatamente o constrangimento que ele
 * veio evitar. Duas strings custam nada e nunca erram.
 */
export function concordar(quantidade: number, singular: string, plural: string): string {
  return Math.abs(quantidade) === 1 ? singular : plural;
}

/** O mesmo, j\u00e1 com o n\u00famero na frente: `contar(3, 'central', 'centrais')`. */
export function contar(quantidade: number, singular: string, plural: string): string {
  return `${quantidade} ${concordar(quantidade, singular, plural)}`;
}
