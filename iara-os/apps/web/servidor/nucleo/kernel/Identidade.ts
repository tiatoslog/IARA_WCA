/**
 * IDENTIDADE — a forma canônica de um `id_usuario`, num lugar só.
 *
 * O DEFEITO que este arquivo fecha, encontrado na auditoria zero-trust:
 *
 *   existiam TRÊS canonicalizações diferentes do mesmo identificador, e nenhuma
 *   sabia da outra:
 *
 *     `Autenticacao.identidadeLocal`  minúsculas, tira tudo fora de [a-z0-9_-], 48
 *     `MemoriaOperacional.idSeguro`   minúsculas, tira tudo fora de [a-z0-9_-], 48
 *     `RegistroOperacoes.arquivoDe`   PRESERVA maiúsculas, troca por "_", 64
 *
 *   Todas as três SANEAVAM em vez de RECUSAR, e é aí que mora o problema:
 *   saneamento é uma função que perde informação, e função que perde informação
 *   MAPEIA IDENTIDADES DISTINTAS NO MESMO DESTINO. `"Ana"` e `"ana"` são um
 *   único shard de memória e dois jornais diferentes; `"a b"` e `"a_b"` são um
 *   único jornal e dois shards. Cada colisão dessas é vazamento entre
 *   locatários, e cada divergência é uma trava de idempotência que não fecha.
 *
 *   Hoje nada disso dispara: o Supabase emite uuid, que passa intacto pelas
 *   três. É exatamente o perfil de defeito que fica dormindo até o dia em que a
 *   identidade passa a vir de outro provedor — e-mail, objectId, login de
 *   domínio — e aí não há sintoma, só duas pessoas lendo o mesmo histórico.
 *
 * A REGRA, em uma frase: **identificador se RECUSA, não se conserta.**
 *
 * Um id que não está na forma canônica é um id que este sistema não sabe
 * atribuir a ninguém com segurança, e a resposta certa é parar. Consertá-lo
 * significa escolher, em silêncio, de quem é o dado — que é a decisão que
 * ninguém quer que um `replace()` tome.
 */

/** Falha de identidade é classe própria: nunca deve virar 500 genérico. */
export class IdentidadeInvalida extends Error {}

/**
 * A forma canônica. Deliberadamente estreita e deliberadamente SUFICIENTE para
 * tudo que o sistema emite hoje:
 *
 *  - uuid do Supabase   `3f1a...-...` — minúsculas, dígitos e hífen
 *  - id do roster       `daiane`, `operador-2`
 *  - modo local         já normalizado por `identidadeLocal`
 *
 * O que ela exclui é o que causa colisão: maiúsculas (que só existem para
 * virar minúsculas em algum lugar do caminho), ponto, barra, espaço e
 * acentuação.
 */
const CANONICO = /^[a-z0-9_-]{1,64}$/;

/**
 * O id já está na forma canônica?
 *
 * Existe separado de `exigirIdCanonico` porque quem escreve um adaptador novo
 * precisa poder PERGUNTAR antes de decidir o que fazer — e a alternativa
 * (chamar a versão que lança dentro de um try/catch para usar como predicado) é
 * como se ensina uma equipe a engolir exceção de segurança.
 */
export function ehIdCanonico(bruto: unknown): boolean {
  return typeof bruto === 'string' && CANONICO.test(bruto);
}

/**
 * Devolve o id, ou LANÇA. Nunca devolve uma versão consertada.
 *
 * `onde` entra na mensagem porque o mesmo erro pode nascer em quatro camadas, e
 * "id_usuario inválido" sem origem custa uma hora de bisect.
 */
export function exigirIdCanonico(bruto: unknown, onde: string): string {
  if (!ehIdCanonico(bruto)) {
    throw new IdentidadeInvalida(
      `${onde}: id_usuario fora da forma canônica ([a-z0-9_-], até 64). ` +
        'Identificador não é saneado neste sistema — quem o emitiu precisa emitir certo.',
    );
  }
  return bruto as string;
}

/**
 * Normaliza um id que vem de FORA e ainda não tem forma — só o modo local, só
 * na fronteira do socket.
 *
 * É a ÚNICA função deste arquivo que conserta, e ela é a exceção que confirma a
 * regra: em modo local o id é digitado pelo cliente, não existe autoridade
 * nenhuma por trás dele, e não há identidade a preservar. Todo o resto do
 * sistema recebe o resultado dela — já canônico — e daí em diante recusa.
 */
export function canonizarIdLocal(bruto: string, reserva = 'operador'): string {
  const limpo = bruto.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 64);
  return limpo || reserva;
}
