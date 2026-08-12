/**
 * Casamento de origem — a checagem que separa a IARA da internet.
 *
 * Vive aqui, e não dentro de `servidor/principal.ts`, por uma razão só: é
 * função pura de segurança, e função pura de segurança que não tem teste é
 * afirmação. `principal.ts` sobe um servidor ao ser importado, então nenhum
 * teste alcança o que está lá dentro. Isto alcança.
 *
 * Nada aqui importa nada nem toca no mundo — é comparação de string.
 */

function escaparRegex(texto: string): string {
  return texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compara uma origem com um padrão que pode conter `*` num rótulo de
 * subdomínio: `https://*.vercel.app`.
 *
 * As DUAS âncoras são o ponto inteiro da função:
 *
 *  · sem `^`, `https://evil.com/#.vercel.app` casa — o fragmento carrega o
 *    sufixo esperado e o resto da string é ignorado;
 *  · sem `$`, `https://x.vercel.app.evil.com` casa — o domínio do atacante
 *    vem DEPOIS do sufixo autorizado.
 *
 * E o curinga vira `[a-z0-9-]+`, nunca `.*`: um ponto dentro dele reabriria os
 * dois buracos por outro caminho, porque `*` passaria a atravessar separadores.
 * Um rótulo de DNS não contém ponto, barra nem arroba — a classe restrita é o
 * que faz `*` significar "um rótulo" em vez de "qualquer coisa".
 *
 * Sem `*` no padrão, é igualdade literal. Comparação de origem NUNCA é por
 * prefixo: `https://iara.com` e `https://iara.com.br` compartilham prefixo.
 */
export function casaOrigem(origem: string, padrao: string): boolean {
  if (!padrao.includes('*')) return origem === padrao;
  const re = new RegExp(`^${padrao.split('*').map(escaparRegex).join('[a-z0-9-]+')}$`);
  return re.test(origem);
}

/** Alguma entrada da lista casa? Lista vazia nunca autoriza ninguém. */
export function origemNaLista(origem: string, lista: readonly string[]): boolean {
  return lista.some((padrao) => casaOrigem(origem, padrao));
}

/**
 * Um curinga em produção não é "um pouco mais frouxo" — é a internet inteira.
 * Qualquer pessoa registra um subdomínio num host de deploy gratuito em
 * minutos, e a partir daí `https://*.vercel.app` autoriza a página dela.
 */
export function temCuringa(lista: readonly string[]): boolean {
  return lista.some((o) => o.includes('*'));
}
