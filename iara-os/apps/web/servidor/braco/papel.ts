/**
 * UM BINÁRIO, TRÊS PAPÉIS — e quem decide qual é este arquivo.
 *
 * `iara-braco.exe` é ao mesmo tempo o instalador que a operadora baixa, o
 * supervisor que a tarefa agendada inicia no logon, e o runtime que tem as mãos.
 * Três programas em um arquivo, com o papel escolhido por argumento.
 *
 * POR QUE NÃO TRÊS EXECUTÁVEIS. Seriam três artefatos para manter em
 * concordância, três downloads para versionar juntos, e três chances de a
 * pessoa abrir o errado. `empacotar-braco.ts` já tinha recusado essa divisão
 * uma vez, por esse motivo. Um binário, papel por argumento — e um só SHA256
 * para conferir na atualização.
 *
 * ================= A REGRA QUE PROTEGE O DESENVOLVIMENTO =================
 *
 * Rodando por `npm run braco` (tsx, não empacotado) o papel é SEMPRE runtime.
 * Nunca instalar, nunca agendar tarefa. Um `npm run braco` que registrasse
 * tarefa agendada e copiasse o `node.exe` do sistema para
 * `%LOCALAPPDATA%\IARA\braco` seria um desastre silencioso na máquina de quem
 * está desenvolvendo — e o `process.execPath` do tsx aponta exatamente para
 * esse `node.exe`, não para a IARA.
 */

export type PapelDoProcesso = 'runtime' | 'supervisor' | 'instalar';

export interface ContextoDoPapel {
  /** `process.argv.slice(2)`. */
  readonly argumentos: readonly string[];
  /** `sea.isSea()` — falso sob `tsx`. */
  readonly empacotado: boolean;
}

/**
 * O argumento explícito ganha de tudo, inclusive de não estar empacotado: é
 * assim que dá para exercitar o supervisor à mão num terminal de
 * desenvolvimento sem empacotar nada primeiro.
 */
export function papelDoProcesso(ctx: ContextoDoPapel): PapelDoProcesso {
  if (ctx.argumentos.includes('--supervisor')) return 'supervisor';
  if (ctx.argumentos.includes('--runtime')) return 'runtime';

  /* Sem argumento e sem empacotamento: alguém rodou `npm run braco`. */
  if (!ctx.empacotado) return 'runtime';

  /**
   * Sem argumento, empacotado: a operadora deu um duplo clique no arquivo. Este
   * é o caso que a pasta de Downloads dela provou ser o único que existe na
   * prática — e até 21/08/2026 ele fazia o braço rodar de dentro de Downloads,
   * sem instalar nada e sem sobreviver ao reboot.
   *
   * `instalar` cobre também o duplo clique no executável JÁ instalado: o plano
   * de instalação resolve isso como `ja_instalado`/`reparar`, que é a resposta
   * certa — conferir e consertar, nunca subir um segundo runtime ao lado do que
   * o supervisor já mantém de pé.
   */
  return 'instalar';
}
