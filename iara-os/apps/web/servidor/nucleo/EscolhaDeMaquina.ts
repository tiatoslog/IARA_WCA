/**
 * EM QUAL COMPUTADOR A IARA TRABALHA AGORA — a escolha do operador.
 *
 * O DEFEITO QUE ESTE MÓDULO ELIMINA, medido em 20/08/2026 e nomeado pela
 * operadora antes de eu olhar o código:
 *
 *     "Consigo conectar o braço em vários computadores e escolher em qual eu
 *      quero trabalhar? Se não, é inútil."
 *
 * Não conseguia. `PonteDispositivos.destinoDe` devolvia `lista[lista.length-1]`
 * — o último que conectou —, e não existia alvo em lugar nenhum da cadeia: nem
 * na `OrdemExecucao`, nem no esquema das habilidades, nem na interface. Com duas
 * máquinas ligadas, a ordem ia para a última **sempre**; e se ela caísse, a ação
 * MIGRAVA em silêncio para a outra, com relato de sucesso. Uma ação física
 * acontecia num computador que ninguém escolheu.
 *
 * ================= POR QUE UM MÓDULO, E NÃO UM PARÂMETRO =================
 *
 * A escolha é do OPERADOR, não do pedido. Ela sobrevive entre turnos, entre
 * habilidades e entre conversas: quem escolheu "escritório" às 9h quer o
 * escritório às 9h05, sem repetir. Passá-la como argumento obrigaria os oito
 * chamadores de `braco.executar` a carregá-la, e o dia em que alguém
 * esquecesse um deles o pedido voltaria a cair no último conectado — em
 * silêncio, que é como este defeito nasceu.
 *
 * O `Braco` pergunta a este objeto; as habilidades não sabem que ele existe.
 *
 * ================= POR QUE EM MEMÓRIA =================
 *
 * A escolha é sobre AGORA — qual máquina está na frente da pessoa. Persistir no
 * banco faria a IARA acordar amanhã insistindo num computador que a operadora
 * deixou no escritório, e a correção seria ela ter de lembrar de desescolher.
 * O processo cai, a escolha some, e o comportamento volta ao padrão de quem tem
 * uma máquina só. Perder isto é barato; teimar nele não é.
 *
 * Puro: sem relógio, sem rede, sem disco.
 */

/** A escolha atual por operador. `null` = nunca escolheu, ou esqueceu. */
export class EscolhaDeMaquina {
  private readonly porOperador = new Map<string, { id: string; nome: string }>();

  /**
   * O operador declarou onde quer trabalhar.
   *
   * NÃO CONFERE se a máquina existe ou está ligada, e a omissão é deliberada:
   * quem sabe isso é a ponte, no instante da execução. Validar aqui criaria uma
   * segunda verdade sobre quem está conectado — e duas verdades sobre a mesma
   * coisa é como um sistema passa a discordar de si mesmo.
   */
  escolher(idUsuario: string, idDispositivo: string, nome?: string): void {
    this.porOperador.set(idUsuario, { id: idDispositivo, nome: nome?.trim() || idDispositivo });
  }

  escolhida(idUsuario: string): string | null {
    return this.porOperador.get(idUsuario)?.id ?? null;
  }

  /**
   * O NOME QUE ESTAVA NA TELA quando a pessoa escolheu — e é por isso que ele é
   * guardado aqui em vez de perguntado à ponte na hora.
   *
   * A recusa de "escolhida e offline" precisa NOMEAR a máquina, e a máquina
   * offline não está no inventário conectado: perguntar à ponte devolveria
   * nada justamente no caso em que a frase importa. Cai para o id quando
   * ninguém informou o nome, que é feio e verdadeiro.
   */
  nomeEscolhido(idUsuario: string): string | null {
    return this.porOperador.get(idUsuario)?.nome ?? null;
  }

  /** Volta ao padrão: o último que conectou atende. */
  esquecer(idUsuario: string): void {
    this.porOperador.delete(idUsuario);
  }

  /**
   * A máquina saiu do inventário do operador (foi desconectada ou revogada).
   *
   * Existe para que a escolha não fique apontando para um fantasma: uma escolha
   * órfã transformaria toda ação seguinte numa recusa que o operador não sabe
   * desfazer, porque a máquina nem aparece mais na lista para ele reescolher.
   */
  esquecerDispositivo(idUsuario: string, idDispositivo: string): void {
    if (this.porOperador.get(idUsuario)?.id === idDispositivo) this.porOperador.delete(idUsuario);
  }
}

/** A escolha DO PROCESSO — a mesma para o WebSocket, o canal e o kernel. */
export const escolhaDeMaquina = new EscolhaDeMaquina();
