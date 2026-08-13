/**
 * PAPEL EFETIVO de uma sessão — a peça que faltava para o RBAC existir.
 *
 * O DEFEITO, encontrado na auditoria zero-trust:
 *
 *   `Seguranca.ts` definia três papéis (`operador`, `administrador`,
 *   `somente_leitura`), com uma matriz de permissões por papel, um sandbox que
 *   a impõe e testes que a exercitam. E o Kernel fazia
 *   `this.papel = dep.papel ?? 'operador'` — enquanto `Porta.ts` e
 *   `PortaWhatsapp.ts`, os DOIS únicos lugares que constroem um Kernel de
 *   produção, nunca passavam o campo.
 *
 *   Resultado: todo mundo era `operador`, sempre. `administrador` e
 *   `somente_leitura` eram inalcançáveis em runtime — existiam só nos testes.
 *   A ausência de `externo` no papel `operador` estava carimbada em código,
 *   mas a possibilidade de CONCEDER `externo` a alguém não existia; e a
 *   possibilidade de REBAIXAR alguém a leitura também não. Um controle de
 *   acesso que só sabe emitir um único valor não é controle de acesso, é uma
 *   constante com nome de política.
 *
 * A FONTE, e por que é o ambiente:
 *
 *   A alternativa natural seria uma coluna no Supabase. Ela é melhor, e é para
 *   onde isto deve ir — mas exigiria migração de schema, uma tela de
 *   administração e um caminho de escrita novo, e cada uma dessas coisas é uma
 *   superfície a mais. O ambiente já é a fronteira de confiança do processo:
 *   quem edita `IARA_ADMINS` no host é quem já podia trocar o binário. Começar
 *   aqui torna os três papéis alcançáveis HOJE, com uma linha de configuração,
 *   e o dia da migração troca só esta função.
 *
 * O PADRÃO NÃO MUDA: quem não está em lista nenhuma continua `operador`,
 * exatamente como antes. Esta camada só torna possível o que já estava escrito.
 */

import type { Papel } from './Seguranca';

function lista(nome: string): readonly string[] {
  return (process.env[nome] ?? '')
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * O papel desta identidade.
 *
 * ORDEM DELIBERADA: a restrição vence a concessão. Um id que aparece nas duas
 * listas é uma configuração contraditória, e a leitura segura de uma
 * contradição é sempre a mais restritiva — do contrário, acrescentar alguém a
 * `IARA_SOMENTE_LEITURA` para contê-lo não teria efeito nenhum se ele já
 * estivesse em `IARA_ADMINS`, que é exatamente o momento em que a restrição
 * mais importa.
 *
 * Casa por `id_usuario` E por e-mail: o id do Supabase é um uuid que ninguém
 * consegue digitar de cabeça, e uma lista de acesso que exige colar uuid é uma
 * lista que fica desatualizada.
 */
export function papelDe(identidade: { id_usuario: string; email?: string }): Papel {
  const chaves = [identidade.id_usuario, identidade.email ?? '']
    .filter(Boolean)
    .map((x) => x.toLowerCase());

  const casa = (nome: string) => lista(nome).some((v) => chaves.includes(v));

  if (casa('IARA_SOMENTE_LEITURA')) return 'somente_leitura';
  if (casa('IARA_ADMINS')) return 'administrador';
  return 'operador';
}
