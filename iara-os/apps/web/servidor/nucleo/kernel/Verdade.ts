/**
 * Camada de verdade — de onde vem cada coisa que a IARA afirma.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: quando a IARA diz algo, o que sustenta
 * aquilo? Sem uma resposta explícita, tudo vira "a IARA disse", e "a IARA
 * disse" é indistinguível de "a IARA inventou".
 *
 * Nada aqui tem dependência. É vocabulário: tipos e duas funções puras. É de
 * propósito — quem decide, quem executa e quem responde precisam falar a mesma
 * língua sobre evidência, e nenhum deles pode depender dos outros para isso.
 */

// ---------------------------------------------------------------------------
// Procedência — a origem de uma afirmação
// ---------------------------------------------------------------------------

/**
 * Ordenados do mais forte ao mais fraco. A ordem não é decorativa:
 * `maisForte()` a usa para desempatar informação conflitante.
 */
export type Procedencia =
  /** Verificado contra o mundo DEPOIS de agir. A pasta existe no disco. */
  | 'fato_verificado'
  /** Base determinística da casa, documento lido, relógio do servidor. */
  | 'fato'
  /** O executor disse que deu certo. Ainda NÃO é verdade — só um relato. */
  | 'resultado_ferramenta'
  /** Documento interno: verdadeiro na data em que foi escrito. */
  | 'documento'
  /** Shard do operador. Foi verdade quando gravado; pode ter envelhecido. */
  | 'memoria'
  /** Conclusão derivada de outras informações. Não foi observada. */
  | 'inferencia'
  /** Possibilidade levantada. Não derivada, não observada. */
  | 'hipotese'
  /** Não há informação. É um valor legítimo, não uma falha. */
  | 'desconhecido';

const FORCA: Record<Procedencia, number> = {
  fato_verificado: 7,
  fato: 6,
  resultado_ferramenta: 5,
  documento: 4,
  memoria: 3,
  inferencia: 2,
  hipotese: 1,
  desconhecido: 0,
};

/**
 * Uma afirmação sustentada é a menor unidade de conhecimento que a IARA
 * manipula: o conteúdo mais a evidência que o sustenta.
 */
export interface Afirmacao {
  readonly conteudo: string;
  readonly procedencia: Procedencia;
  /** Quem produziu: id da habilidade, 'shard', 'camada_global', 'llm'. */
  readonly origem: string;
  /** ISO 8601. Quando isto passou a ser verdade. */
  readonly instante: string;
}

/**
 * Desempate entre afirmações conflitantes.
 *
 * Procedência vence primeiro; recência só desempata dentro da MESMA
 * procedência. Uma memória de hoje não derruba um fato verificado de ontem —
 * era exatamente esse o erro do "relatório às 16h" contra "às 17h": tratar as
 * duas como equivalentes e escolher pela ordem de leitura.
 */
export function maisForte(a: Afirmacao, b: Afirmacao): Afirmacao {
  const fa = FORCA[a.procedencia];
  const fb = FORCA[b.procedencia];
  if (fa !== fb) return fa > fb ? a : b;
  return a.instante >= b.instante ? a : b;
}

/** Sustenta uma afirmação ao operador sem ressalva? */
export function podeAfirmarSemRessalva(p: Procedencia): boolean {
  return p === 'fato_verificado' || p === 'fato';
}

/**
 * Como a resposta deve marcar a informação. Vazio para o que é fato: encher a
 * resposta de "verificado:" a cada frase é ruído, e ruído constante deixa de
 * ser lido — inclusive quando importa.
 */
export const RESSALVA: Record<Procedencia, string> = {
  fato_verificado: '',
  fato: '',
  resultado_ferramenta: 'segundo o executor, sem confirmação independente',
  documento: 'conforme o documento interno',
  memoria: 'pelo que ficou registrado antes',
  inferencia: 'é uma dedução minha, não um dado observado',
  hipotese: 'é hipótese',
  desconhecido: 'não tenho essa informação',
};

// ---------------------------------------------------------------------------
// Estado de execução — em que ponto uma ação está
// ---------------------------------------------------------------------------

/**
 * O ciclo de vida de uma ação.
 *
 * `desconhecido` é o estado mais importante da lista, e o mais fácil de
 * esquecer: cobre "mandei executar e não consigo provar o que aconteceu". Sem
 * ele, todo executor que devolve sem erro vira sucesso — que é a mentira
 * operacional que este trabalho existe para impedir.
 */
export type EstadoExecucao =
  | 'pendente'
  | 'planejando'
  | 'aguardando_confirmacao'
  | 'executando'
  | 'executado' // o executor retornou sem erro. NÃO é o mesmo que verificado.
  | 'falhou'
  | 'verificacao_pendente'
  | 'verificado' // o mundo confirmou. Só aqui se pode dizer "feito".
  | 'parcial'
  | 'cancelado'
  | 'desconhecido';

/** Estados em que é honesto dizer ao operador que a ação aconteceu. */
export function confirmaAcontecimento(e: EstadoExecucao): boolean {
  return e === 'verificado';
}

/** Estados terminais — o ciclo acabou, com ou sem sucesso. */
export function ehTerminal(e: EstadoExecucao): boolean {
  return (
    e === 'verificado' ||
    e === 'falhou' ||
    e === 'cancelado' ||
    e === 'parcial' ||
    e === 'desconhecido' ||
    e === 'executado'
  );
}

/**
 * O verbo que a resposta pode usar para cada estado.
 *
 * É aqui que "executei" deixa de ser sinônimo de "está feito". Um executor que
 * retornou sem erro mas não pôde ser verificado produz "solicitei a execução e
 * não consegui confirmar" — nunca "pronto".
 */
export const VERBO_DO_ESTADO: Record<EstadoExecucao, string> = {
  pendente: 'ainda não comecei',
  planejando: 'estou montando o plano',
  aguardando_confirmacao: 'preciso da sua confirmação antes de executar',
  executando: 'estou executando',
  executado: 'solicitei a execução, mas não consegui confirmar o resultado',
  falhou: 'não consegui executar',
  verificacao_pendente: 'executei e ainda estou conferindo',
  verificado: 'está feito e confirmado',
  parcial: 'executei em parte',
  cancelado: 'cancelei',
  desconhecido: 'não consigo provar o que aconteceu',
};
