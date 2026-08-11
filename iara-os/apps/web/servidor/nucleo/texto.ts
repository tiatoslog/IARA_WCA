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
