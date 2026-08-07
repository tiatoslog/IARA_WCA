/**
 * Roster do time. Fonte única — usado pela UI (seletor) e pelo roteador
 * (detecção de sondagem entre shards).
 *
 * O roteador precisa saber quem SÃO os outros para reconhecer uma pergunta
 * sobre eles. Sem isso, "o que o Operador 3 falou" passa batido e sobe para a
 * nuvem, onde a defesa vira só texto de prompt.
 */

export interface Operador {
  id: string;
  nome: string;
}

export const OPERADORES: Operador[] = [
  { id: 'daiane', nome: 'Daiane' },
  { id: 'operador-2', nome: 'Operador 2' },
  { id: 'operador-3', nome: 'Operador 3' },
  { id: 'operador-4', nome: 'Operador 4' },
  { id: 'operador-5', nome: 'Operador 5' },
];

/** Nomes de todo mundo, menos quem está falando agora. */
export function outrosOperadores(idAtual: string): string[] {
  return OPERADORES.filter((o) => o.id !== idAtual).map((o) => o.nome);
}
