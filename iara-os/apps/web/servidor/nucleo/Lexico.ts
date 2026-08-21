/**
 * Léxico — similaridade por trigramas de caractere com cosseno.
 *
 * POR QUE ISTO EXISTE COMO MÓDULO. As mesmas trinta linhas estavam copiadas em
 * dois lugares: `RagHistorico.ts` (incidentes) e `habilidades/dados.ts` (memória
 * corporativa). Duas cópias ainda se corrigem à mão; a terceira — o RAG de
 * procedimentos — era o ponto em que "corrigir o cosseno" viraria três edições
 * que alguém faria em duas.
 *
 * É a mesma razão que criou o `texto.ts`, e a extração é irmã dela: função de
 * string não pertence ao módulo que a usa primeiro.
 *
 * HONESTO SOBRE O QUE É: busca LEXICAL, não semântica. Nenhum embedding, nenhum
 * modelo baixado, nenhuma chamada paga — determinístico e offline. Para corpus
 * de vocabulário próprio da casa ("baixa de CT-e" aqui não significa o que
 * significa fora) isso acerta mais que embedding genérico, e é a diferença entre
 * uma resposta reproduzível e uma que muda quando o fornecedor troca de modelo.
 *
 * O QUE ESTE MÓDULO NÃO CARREGA, e é deliberado: o LIMIAR. Ele fica em cada
 * consumidor porque é propriedade do CORPUS, não da técnica — `0.3` no
 * `RagHistorico` é valor MEDIDO (era `0.08`, e com ele "como faço lasanha de
 * berinjela" casava com erro de logística), `0.06` na memória corporativa é de
 * outro corpus e de outra medição. Um limiar único aqui em cima seria a média de
 * duas calibrações que nunca foram feitas juntas — número com cara de constante
 * e sem medição por trás, que é como uma escala de confiança nasce errada.
 */

import { normalizar } from './texto';

/**
 * Perfil de trigramas do texto, já normalizado (sem acento, sem caixa, espaço
 * colapsado).
 *
 * O espaço nas pontas é intencional: sem ele, a primeira e a última palavra
 * perdem os trigramas de borda, e casamento de palavra curta ("cte", "oci")
 * fica bem pior justamente onde o vocabulário da casa mora.
 */
export function trigramas(texto: string): Map<string, number> {
  const base = ` ${normalizar(texto)} `;
  const mapa = new Map<string, number>();
  for (let i = 0; i + 3 <= base.length; i += 1) {
    const g = base.slice(i, i + 3);
    mapa.set(g, (mapa.get(g) ?? 0) + 1);
  }
  return mapa;
}

/**
 * Cosseno entre dois perfis. `0` quando qualquer um deles é vazio — nunca
 * `NaN`, que é o que a divisão por zero produziria e o que faria uma
 * comparação de similaridade passar despercebida por todo `>` e `<` do
 * caminho.
 */
export function cosseno(a: Map<string, number>, b: Map<string, number>): number {
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (const peso of a.values()) normaA += peso * peso;
  for (const [g, peso] of b) {
    normaB += peso * peso;
    const outro = a.get(g);
    if (outro) produto += outro * peso;
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}
