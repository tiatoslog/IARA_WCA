/**
 * A GRAFIA DO CÓDIGO DE PAREAMENTO — contrato compartilhado servidor↔cliente.
 *
 * Nasceu dentro de `servidor/nucleo/Pareamento.ts` e mudou para cá em
 * 15/08/2026, quando o convite de pareamento passou a ser desenhado pelo
 * CLIENTE (`ConvitePareamento`): a página precisa normalizar e formatar o
 * código da URL, e importar o kernel num bundle de navegador é exatamente a
 * fronteira que este projeto não cruza. A regra é a mesma do `SnapshotCognitivo`:
 * o que os dois lados precisam saber mora em `lib/`.
 *
 * Só a GRAFIA mora aqui. Sortear, aprovar, comparar em tempo constante —
 * tudo que carrega segredo ou decisão — continua no kernel.
 */

/**
 * Alfabeto sem `0/O`, `1/I/L` e `U`. Não é purismo: o código é lido na tela de
 * um computador e digitado no celular, às vezes ditado em voz alta. Um zero que
 * vira letra ó gasta a única coisa que o pareamento não tem de sobra — as
 * tentativas.
 */
export const ALFABETO_CODIGO = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TAMANHO_CODIGO = 8;

/**
 * `H7K29QP4` ← `h7k2-9qp4`, ` H7K2 9QP4 `. O que a pessoa digita nunca é
 * exatamente o que o sistema guardou, e normalizar aqui é o que evita o pior
 * atendimento possível: "o código está certo e não funciona".
 *
 * Só separadores e caixa são corrigidos. Caractere fora do alfabeto NÃO é
 * removido — e essa contenção é deliberada: descartá-lo encurtaria a string e
 * poderia transformar um código errado noutro código de comprimento válido.
 * Um `O` digitado no lugar de um `0` que o gerador nunca produz é um erro de
 * leitura, e o certo é dizer que não confere.
 */
export function normalizarCodigo(bruto: string): string {
  return bruto.toUpperCase().replace(/[\s\-_.]/g, '');
}

/** `H7K2-9QP4` — o hífen é só para a leitura; nada o guarda. */
export function formatarCodigo(codigo: string): string {
  return `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
}

/** Um código POSSÍVEL: tamanho certo, só caracteres que o sorteio produz. É o
 *  filtro da única entrada não confiável do convite — a URL. */
export function ehCodigoPossivel(codigo: string): boolean {
  if (codigo.length !== TAMANHO_CODIGO) return false;
  for (const c of codigo) if (!ALFABETO_CODIGO.includes(c)) return false;
  return true;
}
