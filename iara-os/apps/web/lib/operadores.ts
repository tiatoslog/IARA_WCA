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
  /**
   * Número no formato internacional, só dígitos: 55 + DDD + número.
   * Ex.: 5565999998888. Ausente = essa pessoa não fala com a IARA pelo
   * WhatsApp.
   *
   * ESTA LISTA É A TRAVA DO CANAL. Número que não está aqui não abre sessão,
   * e não existe cadastro automático em lugar nenhum do código: quem entra no
   * escritório é decidido aqui, não por quem manda mensagem.
   */
  telefone?: string;
}

export const OPERADORES: Operador[] = [
  { id: 'daiane', nome: 'Daiane' },
  { id: 'operador-2', nome: 'Operador 2' },
  { id: 'operador-3', nome: 'Operador 3' },
  { id: 'operador-4', nome: 'Operador 4' },
  { id: 'operador-5', nome: 'Operador 5' },
];

/**
 * Nomes de todo mundo, menos quem está falando agora.
 *
 * O `nomeAtual` não é conveniência — é a correção de um defeito que só aparece
 * com autenticação LIGADA. Com Supabase, `id_usuario` é um uuid, e uuid nunca
 * casa com `'daiane'` ou `'operador-2'`: o filtro por id não excluía ninguém, e
 * o próprio nome do operador entrava na lista de "outros". A consequência é o
 * `PortaoSigilo` tratando uma pergunta da pessoa sobre o registro DELA MESMA
 * como sondagem entre shards, e recusando com uma frase sobre privacidade de
 * terceiro — a pior recusa possível, porque parece uma acusação.
 *
 * Comparar por nome normalizado resolve o caso real (o roster e o provedor de
 * identidade se referem à mesma pessoa por nome) sem fingir que o roster é a
 * fonte de identidade — ela é o token, e continua sendo.
 */
export function outrosOperadores(idAtual: string, nomeAtual = ''): string[] {
  const alvo = chaveNome(nomeAtual);
  return OPERADORES.filter((o) => o.id !== idAtual && (!alvo || chaveNome(o.nome) !== alvo)).map(
    (o) => o.nome,
  );
}

/** Nome comparável: sem acento, sem caixa, sem espaço sobrando. */
function chaveNome(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Resolve um número de telefone para o operador cadastrado.
 *
 * Compara só dígitos e tolera a ausência do nono dígito em números móveis
 * antigos — o WhatsApp entrega ora com, ora sem, dependendo de quando o
 * contato foi salvo, e uma comparação literal falharia de forma intermitente.
 */
export function operadorPorTelefone(telefone: string): Operador | null {
  const alvo = chaveTelefone(telefone);
  if (!alvo) return null;

  for (const o of OPERADORES) {
    if (!o.telefone) continue;
    if (chaveTelefone(o.telefone) === alvo) return o;
  }
  return null;
}

/**
 * Chave canônica de comparação: DDD + os 8 últimos dígitos.
 *
 * Descartar o nono dígito é o que faz `5565999998888` e `556599998888`
 * casarem — o WhatsApp entrega ora com, ora sem, dependendo de quando o
 * contato foi salvo, e comparação literal falharia de forma intermitente.
 *
 * O DDD é extraído DEPOIS de tirar o código do país, nunca por posição a
 * partir do fim: um número com nono dígito e outro sem têm comprimentos
 * diferentes, e contar do fim pega dígitos errados. Foi assim que a primeira
 * versão deixou passar número de outro DDD com final igual.
 */
function chaveTelefone(bruto: string): string | null {
  let d = bruto.replace(/\D/g, '');
  // Código do país só sai quando sobra número nacional plausível: DDD 55
  // (Santa Maria/RS) existe, e `55999998888` sem país não pode virar `999998888`.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10) return null;
  return d.slice(0, 2) + d.slice(-8);
}
