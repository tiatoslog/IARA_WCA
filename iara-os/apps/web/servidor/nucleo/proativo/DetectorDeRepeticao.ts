/**
 * DETECTOR DE REPETIÇÃO — o trabalho que a pessoa está fazendo à mão toda semana.
 *
 * É a capacidade que a especificação chama de *opportunity detection*, e a ordem
 * dela é rígida:
 *
 *     DETECTA → EXPLICA → PROPÕE → (se autorizado) EXECUTA
 *
 * Este arquivo faz o primeiro passo e para. Ele não sabe automatizar nada, não
 * conhece o catálogo de habilidades e não tem como alcançar um executor. A
 * proposta sai como `automacao.oportunidade`, e a `DecisaoProativa` a limita a
 * `sugerir` por construção. Uma IARA que detectasse repetição e já construísse a
 * automação seria uma IARA que muda o trabalho de alguém sem perguntar.
 *
 * ---------------------------------------------------------------------------
 * DE ONDE VEM O DADO
 * ---------------------------------------------------------------------------
 *
 * Do evento `PASSO_CONCLUIDO` do barramento do kernel — o mesmo que a projeção
 * já consome. É a única fonte que tem as três coisas necessárias: a HABILIDADE
 * (o que foi feito), os PARÂMETROS (sobre o quê) e o INSTANTE.
 *
 * O jornal de operações (`RegistroOperacoes`) foi considerado e recusado: ele só
 * registra ESCRITAS. O trabalho repetitivo de uma operadora é esmagadoramente
 * de leitura — consultar a mesma planilha, gerar o mesmo recorte, conferir a
 * mesma central —, e um detector cego para leitura enxergaria a menor parte do
 * problema achando que enxerga tudo.
 *
 * ---------------------------------------------------------------------------
 * A ASSINATURA, E POR QUE ELA INCLUI OS PARÂMETROS
 * ---------------------------------------------------------------------------
 *
 * `consultar_planilha` com filtro de agosto e `consultar_planilha` com filtro de
 * julho são a MESMA consulta feita duas vezes? Para quem quer automatizar, não:
 * o que se automatiza é o procedimento COM os argumentos, senão a proposta vira
 * "você usa muito a IARA", que não é oportunidade nenhuma.
 *
 * O risco conhecido do lado oposto — parâmetro que muda sempre (um id, uma data
 * de hoje) fragmenta a assinatura e nada nunca atinge o limiar — é real e está
 * declarado. A resposta certa para ele é normalizar o parâmetro variável no
 * detector do domínio, quando aparecer um caso concreto; não é afrouxar a
 * assinatura agora com base em imaginação.
 *
 * ---------------------------------------------------------------------------
 * OS PATAMARES
 * ---------------------------------------------------------------------------
 *
 * A oportunidade não é proposta uma vez e esquecida, nem reproposta a cada
 * execução. Ela reaparece em 5, 20 e 100 — três vezes na vida de um
 * procedimento, e só se a pessoa não tiver dito não. A escala importa: "você fez
 * isto 5 vezes" e "você fez isto 100 vezes" são conversas diferentes, e a segunda
 * merece ser tida mesmo se a primeira foi recusada por ser cedo demais.
 */

import { createHash } from 'node:crypto';
import { canonico } from '../kernel/Prova';

export interface RegistroPasso {
  /** `sha256(habilidade + parâmetros canônicos)`, truncado. Ver `assinarPasso`. */
  readonly assinatura: string;
  /** O nome da habilidade, para a frase. Nunca os parâmetros — podem ser dados. */
  readonly rotulo: string;
  readonly instante: number;
  /**
   * O TRAÇO DO TURNO em que este passo aconteceu — e este campo é a UNIDADE DE
   * MEDIDA deste detector, não um adorno de auditoria.
   *
   * ---------------------------------------------------------------------------
   * O RISCO QUE ELE FECHA, e por que ele é estrutural e não um limiar
   * ---------------------------------------------------------------------------
   *
   * O detector conta "quantas vezes a pessoa fez isto". Enquanto o `Kernel` for
   * um pipeline de plano fixo, um procedimento pedido uma vez produz um
   * `PASSO_CONCLUIDO`, e contar passos é o mesmo que contar pedidos.
   *
   * Com o laço de agente — que está sendo construído em paralelo — deixa de
   * ser: uma tarefa vira várias voltas, e a MESMA consulta pode ser reexecutada
   * três vezes dentro de um turno só porque o modelo refinou o parâmetro. Um
   * detector que contasse linhas passaria a enxergar um operador
   * artificialmente repetitivo, e proporia automatizar o que ele fez UMA vez.
   *
   * Isso não é problema de calibragem: 5, 20 e 100 continuariam certos para a
   * grandeza errada. É problema de UNIDADE. Contando traços distintos, a
   * grandeza volta a ser "em quantos TURNOS este procedimento foi usado" — que
   * é estável nos dois desenhos, e é a única pergunta que interessa a quem
   * decide automatizar.
   *
   * Legado: registro antigo, gravado antes deste campo existir, cai no
   * `?? instante` de `traçoDe` e conta como um turno próprio — que é exatamente
   * a semântica que ele tinha quando foi escrito.
   */
  readonly traco?: string;
}

/** O turno a que um passo pertence. Ver `RegistroPasso.traco` para o legado. */
export function tracoDe(p: RegistroPasso): string {
  return p.traco ?? `sem-traco:${p.instante}`;
}

/** Os três momentos em que vale reabrir a conversa. Ver o cabeçalho. */
export const PATAMARES = [5, 20, 100] as const;

/** Duas semanas. Repetição fora de uma janela não é rotina, é coincidência. */
export const JANELA_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * O procedimento tem de estar espalhado no tempo.
 *
 * Cinco execuções em dez minutos são uma pessoa tentando acertar um parâmetro —
 * o modo de falha mais óbvio de um detector de repetição, e o que produziria a
 * pergunta mais irritante possível ("quer que eu automatize isso?" logo depois
 * de a pessoa ter errado quatro vezes seguidas). Cinco execuções em dois dias
 * distintos são hábito.
 */
export const DIAS_DISTINTOS_MINIMOS = 2;

export interface Oportunidade {
  readonly assinatura: string;
  readonly rotulo: string;
  readonly vezes: number;
  readonly patamar: number;
  readonly dias_distintos: number;
  readonly primeira_em: number;
  readonly ultima_em: number;
}

/** A identidade de um procedimento: o que ele é + sobre o que ele foi feito. */
export function assinarPasso(habilidade: string, parametros: unknown): string {
  return createHash('sha256')
    .update(`${habilidade}|${canonico(parametros)}`)
    .digest('hex')
    .slice(0, 16);
}

function diaLocal(instante: number): string {
  const d = new Date(instante);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** O maior patamar que esta contagem já alcançou. `null` = ainda não chegou lá. */
export function patamarDe(vezes: number): number | null {
  let alcancado: number | null = null;
  for (const p of PATAMARES) if (vezes >= p) alcancado = p;
  return alcancado;
}

/**
 * As oportunidades presentes nestes passos. Puro e sem estado: a deduplicação
 * ("já propus este patamar") é do livro, não daqui — um detector que lembrasse
 * o que já disse teria dois donos para a mesma verdade.
 */
export function detectar(
  passos: readonly RegistroPasso[],
  agora: number,
  janelaMs: number = JANELA_MS,
): Oportunidade[] {
  const porAssinatura = new Map<string, RegistroPasso[]>();

  for (const p of passos) {
    if (agora - p.instante > janelaMs) continue;
    const lista = porAssinatura.get(p.assinatura);
    if (lista) lista.push(p);
    else porAssinatura.set(p.assinatura, [p]);
  }

  const saida: Oportunidade[] = [];
  for (const [assinatura, lista] of porAssinatura) {
    /**
     * TURNOS DISTINTOS, NÃO LINHAS. Ver `RegistroPasso.traco`.
     *
     * A contagem é feita aqui, e não só no momento de registrar, de propósito:
     * o livro é append-only e pode conter linhas gravadas por uma versão que
     * não sabia deduplicar. Uma grandeza que só está certa se o produtor se
     * comportou é uma grandeza que vai estar errada um dia.
     */
    const turnos = new Set(lista.map(tracoDe));
    const patamar = patamarDe(turnos.size);
    if (patamar === null) continue;

    const dias = new Set(lista.map((p) => diaLocal(p.instante)));
    if (dias.size < DIAS_DISTINTOS_MINIMOS) continue;

    const instantes = lista.map((p) => p.instante);
    saida.push({
      assinatura,
      /* O rótulo do registro mais recente: se a habilidade foi renomeada, a
         frase usa o nome de hoje. */
      rotulo: lista[lista.length - 1].rotulo,
      vezes: turnos.size,
      patamar,
      dias_distintos: dias.size,
      primeira_em: Math.min(...instantes),
      ultima_em: Math.max(...instantes),
    });
  }

  /* Mais repetido primeiro: se o teto de interrupções cortar a lista, que corte
     as oportunidades menores. */
  return saida.sort((a, b) => b.vezes - a.vezes);
}
