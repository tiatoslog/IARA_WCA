/**
 * Treinamento — o vocabulário do APRENDIZADO, ao lado do de `procedimento.ts`.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO está em
 * `docs/prd/instrutor-operacional-adaptativo.md`: **estado do procedimento não
 * é estado do aprendizado.** Uma pessoa pode concluir uma etapa sem ter
 * aprendido, entender uma etapa sem executá-la, e executar corretamente com
 * ajuda sem conseguir repetir sozinha. Colapsar as duas dimensões numa só
 * produziria o erro mais caro que um sistema de treinamento pode cometer:
 * declarar apta quem só foi conduzida.
 *
 * NADA AQUI TEM I/O, RELÓGIO OU ESTADO. É vocabulário e função pura, pela mesma
 * razão de `Verdade.ts` — quem decide como ensinar, quem persiste o progresso e
 * quem redige a resposta precisam falar a mesma língua sem depender uns dos
 * outros para isso.
 *
 * O QUE ESTE ARQUIVO NUNCA VAI TER: uma escala de confiança. `ResultadoDeResposta`
 * classifica uma RESPOSTA DE EXERCÍCIO, com procedência `inferencia`, e não
 * entra em `Verdade.ts` nem desempata afirmação nenhuma. Uma segunda escala ao
 * lado da existente é a doença que o `CLAUDE.md` registra ter custado caro duas
 * vezes.
 */

import { citar, type Etapa, type Posicao, type Procedimento, type SlideDoPop } from './procedimento';

// ---------------------------------------------------------------------------
// Estado pedagógico — cinco, não sete
// ---------------------------------------------------------------------------

/**
 * ONDE A PESSOA ESTÁ EM RELAÇÃO A SABER FAZER — não em relação a ter feito.
 *
 * CINCO ESTADOS, e a poda é deliberada. `com_duvida` e `corrigindo` foram
 * recusados porque nenhum dos dois tem saída própria: depois de responder uma
 * dúvida a IARA volta exatamente para o estado em que estava, e corrigir é o
 * que acontece DENTRO de `aprendendo`. Um estado que nada distingue do vizinho
 * é complexidade ornamental — é a mesma poda que deixou `EstadoDaExecucao` com
 * três valores em vez dos dez de um diagrama bonito.
 *
 * Dúvida e erro não somem: viram EVENTO (`DificuldadeRegistrada`), que é o que
 * eles são. Um evento tem instante e parada; um estado teria de ter saída.
 */
export type EstadoPedagogico =
  /** Nunca foi ensinada nem executou. O padrão de quem chega. */
  | 'descobrindo'
  /** Está sendo conduzida com instrução completa. */
  | 'aprendendo'
  /** Pediu para tentar sozinha. A IARA pergunta antes de responder. */
  | 'praticando'
  /** Está respondendo exercício. A IARA não entrega a resposta. */
  | 'avaliando'
  /**
   * Passou por uma avaliação sem resposta incorreta, NESTA revisão do POP.
   *
   * Amarrado ao `hash_origem` no progresso: POP revisado derruba o domínio,
   * porque o que a pessoa demonstrou saber era outro documento.
   */
  | 'dominado';

/** O que faz o estado pedagógico mudar. Enumerado, nunca inferido de texto. */
export type EventoPedagogico =
  | 'ensinou'
  | 'pediu_pratica'
  | 'pediu_avaliacao'
  | 'errou'
  | 'concluiu_avaliacao'
  | 'desistiu_da_pratica';

/**
 * A tabela de transição, escrita por extenso.
 *
 * Explícita em vez de `switch` aninhado porque é ela que o teste lê: um oráculo
 * escrito à mão contra uma tabela é prova; um oráculo escrito à mão contra um
 * `switch` copiado do próprio código é a implementação conferindo a si mesma.
 *
 * Transição ausente = o estado não muda. É o caso comum: responder uma dúvida
 * durante `aprendendo` mantém `aprendendo`.
 */
const TRANSICOES: Partial<Record<EstadoPedagogico, Partial<Record<EventoPedagogico, EstadoPedagogico>>>> = {
  descobrindo: {
    ensinou: 'aprendendo',
    pediu_pratica: 'praticando',
    pediu_avaliacao: 'avaliando',
  },
  aprendendo: {
    pediu_pratica: 'praticando',
    pediu_avaliacao: 'avaliando',
  },
  praticando: {
    /* ERRAR NA PRÁTICA VOLTA PARA `aprendendo`, e é o comportamento adaptativo
       inteiro numa linha: quem demonstrou que não sabe precisa ser ensinado, não
       interrogado mais uma vez. É o teto do socrático dito como transição. */
    errou: 'aprendendo',
    desistiu_da_pratica: 'aprendendo',
    pediu_avaliacao: 'avaliando',
    ensinou: 'aprendendo',
  },
  avaliando: {
    concluiu_avaliacao: 'dominado',
    /* Errar na avaliação NÃO derruba para `descobrindo`: a pessoa continua
       sabendo o que sabia. Volta a aprender a parada que falhou. */
    errou: 'aprendendo',
    pediu_pratica: 'praticando',
  },
  dominado: {
    pediu_avaliacao: 'avaliando',
    pediu_pratica: 'praticando',
    errou: 'aprendendo',
  },
};

export function transicionar(estado: EstadoPedagogico, evento: EventoPedagogico): EstadoPedagogico {
  return TRANSICOES[estado]?.[evento] ?? estado;
}

// ---------------------------------------------------------------------------
// Modo pedagógico — como a IARA conversa neste momento
// ---------------------------------------------------------------------------

/**
 * O MODO NÃO MUDA DE ONDE VEM A INFORMAÇÃO. Ele muda a forma.
 *
 * O POP continua sendo a autoridade em todos os oito. `pratica` e `avaliacao`
 * não sabem nada que `ensino` não saiba — o que muda é que elas seguram a
 * resposta e perguntam primeiro.
 */
export type ModoPedagogico =
  /** Quer informação, não quer ser conduzida. */
  | 'consulta'
  /** Quer aprender do zero. */
  | 'ensino'
  /** Está executando agora e reportando. */
  | 'execucao'
  /** Parou para perguntar — dentro ou fora do procedimento. */
  | 'duvida'
  /** Relatou um problema: erro, botão que não aparece, tela diferente. */
  | 'diagnostico'
  /** Quer tentar sozinha. */
  | 'pratica'
  /** Quer ser testada. */
  | 'avaliacao'
  /** Quer continuar de onde parou. */
  | 'retomada';

export const MODOS_PEDAGOGICOS: readonly ModoPedagogico[] = [
  'consulta',
  'ensino',
  'execucao',
  'duvida',
  'diagnostico',
  'pratica',
  'avaliacao',
  'retomada',
];

/**
 * A PROFUNDIDADE DA EXPLICAÇÃO — derivada, nunca um campo sobre a pessoa.
 *
 * Nível é ESTADO PEDAGÓGICO de alguém numa parada, não atributo permanente de
 * um ser humano. Gravar "fulano é iniciante" produziria um sistema que trata
 * pior justamente quem já aprendeu, e que nunca desmente a si mesmo.
 */
export type NivelDeExplicacao = 'iniciante' | 'intermediario' | 'avancado';

// ---------------------------------------------------------------------------
// Dificuldade — o que travou, classificado pelo que dá para saber
// ---------------------------------------------------------------------------

/**
 * O TIPO DE DIFICULDADE, limitado ao que este sistema TEM COMO DISTINGUIR.
 *
 * `erro_de_procedimento` e `erro_de_contexto` foram recusados de propósito: a
 * IARA não instrumenta o GW, e nenhuma evidência que ela possui separa "a
 * pessoa executou o passo errado" de "o sistema respondeu diferente". **Uma
 * categoria que o sistema nunca tem como preencher honestamente é uma categoria
 * que vai ser preenchida por chute** — é a mesma razão pela qual
 * `SituacaoNaParada` tem `indefinido` em vez de fingir certeza.
 *
 * O que sobrou é o que a FRASE do operador sustenta, e nada além disso.
 */
export type TipoDeDificuldade =
  /** "onde clico", "não acho o campo" — sabe o que fazer, não sabe onde. */
  | 'duvida_de_localizacao'
  /** "o que é MDF-e", "por que eu faço isso" — não é sobre a tela. */
  | 'duvida_conceitual'
  /** "deu erro", "apareceu uma mensagem" — o sistema respondeu algo. */
  | 'erro_de_sistema'
  /**
   * "não aparece esse botão".
   *
   * Separado de `erro_de_sistema` porque a resposta certa é outra: aqui existe
   * uma AFIRMAÇÃO DO POP (o elemento existe) contra uma OBSERVAÇÃO do operador
   * (não está lá), e a IARA não pode resolver o conflito — só nomeá-lo.
   */
  | 'elemento_nao_encontrado'
  /** "acho que fiz", "não sei se fiz certo" — a própria pessoa não afirma. */
  | 'evidencia_insuficiente'
  /** "o POP está errado", "meu colega manda fazer diferente". */
  | 'possivel_divergencia_do_pop'
  /** A pergunta é legítima e o documento não a responde. */
  | 'fora_do_pop';

export interface DificuldadeRegistrada {
  readonly tipo: TipoDeDificuldade;
  /** `"etapa/slide"`, ou `null` quando não havia procedimento em curso. */
  readonly parada: string | null;
  /**
   * A frase, JÁ REDUZIDA A ASSINATURA pelo chamador.
   *
   * Nunca o texto cru: este arquivo vai para disco e é relido por quem revisa
   * POP. `assinaturaDeLacuna` já faz essa redução para a fila de lacunas, e o
   * progresso usa a mesma — duas formas de guardar a mesma frase seria duas
   * políticas de privacidade discordando no mesmo repositório.
   */
  readonly assinatura: string;
  readonly instante: string;
}

// ---------------------------------------------------------------------------
// Avaliação — exercício, e nunca habilitação
// ---------------------------------------------------------------------------

/**
 * O VEREDITO DE UM EXERCÍCIO. Pedagógico, procedência `inferencia`.
 *
 * `nao_coberta` é o valor que mais importa, e ele cobre o caso em que a resposta
 * do operador não corresponde a nada que o POP diga. Colapsá-lo em `incorreta`
 * afirmaria que existe uma resposta certa que a pessoa errou — quando o que
 * houve foi a IARA não ter como julgar.
 */
export type ResultadoDeResposta = 'correta' | 'parcial' | 'incorreta' | 'nao_coberta';

/**
 * A FRASE OBRIGATÓRIA de toda avaliação.
 *
 * Constante e não texto solto porque ela é contrato, não redação: acertar um
 * exercício é evidência pedagógica, e habilitação operacional é decisão de
 * gente. Sem esta separação, "você respondeu corretamente" vira, na cabeça de
 * quem lê, "estou liberada para operar".
 */
export const AVISO_AVALIACAO =
  'Isto é exercício, não habilitação: acertar aqui não autoriza ninguém a operar sozinho — ' +
  'quem decide isso é a supervisão.';

/**
 * Uma questão de múltipla escolha construída DO PRÓPRIO POP.
 *
 * MÚLTIPLA ESCOLHA, e não pergunta aberta corrigida por similaridade, por uma
 * razão de método: corrigir texto livre exigiria um limiar, e limiar sem
 * medição é "número com cara de constante e sem medição por trás" — o defeito
 * que este repositório já nomeou duas vezes. Aqui o acerto é EXATO: a
 * alternativa certa é um trecho verbatim de uma parada real, e as erradas são
 * trechos verbatim de OUTRAS paradas do mesmo POP. Nenhuma alternativa é
 * escrita pela IARA, então nenhuma pode estar inventada.
 */
export interface PerguntaDeAvaliacao {
  readonly tipo: 'proxima_acao' | 'etapa_da_acao';
  readonly enunciado: string;
  /** Trechos verbatim. A ordem é a que o operador vê: a) b) c). */
  readonly alternativas: readonly string[];
  readonly correta: number;
  /**
   * A parada de cada alternativa, `"etapa/slide"`, na mesma ordem.
   *
   * É o que permite distinguir `parcial` de `incorreta`: escolher outra tela da
   * MESMA etapa é errar de mira; escolher outra etapa é errar de assunto.
   */
  readonly paradas: readonly string[];
  /** A parada sobre a qual se pergunta. */
  readonly parada: string;
  /** `citar()` — a mesma proveniência de qualquer orientação. */
  readonly fonte: string;
}

export interface AvaliacaoRegistrada {
  readonly parada: string;
  readonly resultado: ResultadoDeResposta;
  readonly instante: string;
}

// ---------------------------------------------------------------------------
// Progresso — a memória do treinamento
// ---------------------------------------------------------------------------

/**
 * O QUE A IARA SABE SOBRE O APRENDIZADO DESTA PESSOA NESTE POP.
 *
 * NÃO GUARDA POSIÇÃO. `etapa`, `slide`, `evidencia` e `conferencia` são do
 * `ProcedimentosEmCurso` e continuam sendo só de lá: uma segunda cópia é como
 * dois espelhos passam a discordar sobre em que etapa alguém está — o defeito
 * que aquele arquivo já documenta ter evitado ao recusar cache em memória.
 *
 * CHAVEADO POR `hash_origem`. Progresso de uma revisão anterior não é
 * equivalente ao da vigente: a pessoa demonstrou saber outro documento. A
 * retomada DIZ isso em vez de continuar contando.
 */
export interface ProgressoDeTreinamento {
  readonly id_usuario: string;
  readonly codigo: string;
  readonly hash_origem: string;
  /** Como estava escrito no POP quando o progresso começou. Nunca normalizado. */
  readonly revisao: string;
  readonly estado: EstadoPedagogico;
  readonly iniciado_em: string;
  readonly atualizado_em: string;

  /** `"etapa/slide"` das paradas já explicadas com instrução completa. */
  readonly paradas_ensinadas: readonly string[];
  /** Paradas em que a pessoa respondeu por conta própria antes da instrução. */
  readonly paradas_praticadas: readonly string[];
  readonly dificuldades: readonly DificuldadeRegistrada[];
  readonly avaliacoes: readonly AvaliacaoRegistrada[];
  /** Termos já explicados, para não reexplicar o mesmo a cada turno. */
  readonly conceitos_explicados: readonly string[];
  /** A questão aguardando resposta, ou `null`. Sobrevive entre turnos. */
  readonly pergunta_pendente: PerguntaDeAvaliacao | null;
  /** Quantas perguntas socráticas já foram feitas SEM ensinar, nesta parada. */
  readonly socraticas_na_parada: number;
  /** A parada a que `socraticas_na_parada` se refere. Muda de parada, zera. */
  readonly parada_socratica: string | null;
}

/** A chave de uma parada. Uma função, para os dois lados escreverem igual. */
export function chaveDaParada(etapa: number, slide: number): string {
  return `${etapa}/${slide}`;
}

/**
 * TETO DO SOCRÁTICO — duas perguntas, e depois ensina.
 *
 * Sem teto, "qual campo você procuraria primeiro?" vira interrogatório: a
 * pessoa que não sabe continua não sabendo, e cada rodada a ensina que pedir
 * ajuda custa caro. Dois é pequeno de propósito — quem sabe responde na
 * primeira, e quem não sabe já demonstrou na segunda.
 */
export const MAX_SOCRATICAS = 2;

/**
 * Quantas dificuldades na MESMA parada bastam para tratá-la como difícil.
 *
 * Duas, e não três como a fila de lacunas: lá o custo de errar é olhar uma
 * pauta a mais; aqui é explicar demais para quem já entendeu. Dois é o menor
 * número que ainda distingue tropeço de padrão.
 */
export const DIFICULDADES_PARA_REFORCO = 2;

export function progressoInicial(
  entrada: { id_usuario: string; codigo: string; hash_origem: string; revisao: string },
  instante: string,
): ProgressoDeTreinamento {
  return {
    ...entrada,
    estado: 'descobrindo',
    iniciado_em: instante,
    atualizado_em: instante,
    paradas_ensinadas: [],
    paradas_praticadas: [],
    dificuldades: [],
    avaliacoes: [],
    conceitos_explicados: [],
    pergunta_pendente: null,
    socraticas_na_parada: 0,
    parada_socratica: null,
  };
}

/**
 * O NÍVEL DE EXPLICAÇÃO DESTA PARADA PARA ESTA PESSOA — derivado, sempre.
 *
 * A ordem das perguntas é a que importa: dificuldade REPETIDA vence tudo. Quem
 * travou duas vezes na mesma tela não vira intermediário por já ter passado por
 * ela — foi justamente por ter passado que sabemos que precisa de mais.
 */
export function nivelDe(progresso: ProgressoDeTreinamento | null, parada: string): NivelDeExplicacao {
  if (!progresso) return 'iniciante';

  const tropecos = progresso.dificuldades.filter((d) => d.parada === parada).length;
  if (tropecos >= DIFICULDADES_PARA_REFORCO) return 'iniciante';

  const errou = progresso.avaliacoes.some(
    (a) => a.parada === parada && (a.resultado === 'incorreta' || a.resultado === 'parcial'),
  );
  if (errou) return 'iniciante';

  if (progresso.estado === 'dominado') return 'avancado';
  if (progresso.paradas_praticadas.includes(parada)) return 'avancado';
  if (progresso.paradas_ensinadas.includes(parada)) return 'intermediario';
  return 'iniciante';
}

/**
 * As paradas que pedem reforço — calculadas, nunca guardadas.
 *
 * Guardar a lista seria manter um resumo ao lado dos fatos que o produzem, e é
 * assim que um resumo passa a discordar do histórico sem ninguém notar.
 */
export function precisamReforco(progresso: ProgressoDeTreinamento | null): readonly string[] {
  if (!progresso) return [];
  const conta = new Map<string, number>();
  for (const d of progresso.dificuldades) {
    if (d.parada) conta.set(d.parada, (conta.get(d.parada) ?? 0) + 1);
  }
  for (const a of progresso.avaliacoes) {
    if (a.resultado === 'incorreta' || a.resultado === 'parcial') {
      conta.set(a.parada, (conta.get(a.parada) ?? 0) + DIFICULDADES_PARA_REFORCO);
    }
  }
  return [...conta.entries()]
    .filter(([, n]) => n >= DIFICULDADES_PARA_REFORCO)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([parada]) => parada);
}

/** A IARA já pode parar de perguntar e ensinar de uma vez? */
export function esgotouSocratico(progresso: ProgressoDeTreinamento | null, parada: string): boolean {
  if (!progresso) return false;
  return progresso.parada_socratica === parada && progresso.socraticas_na_parada >= MAX_SOCRATICAS;
}

// ---------------------------------------------------------------------------
// Montagem de questões — tudo verbatim, nada escrito pela IARA
// ---------------------------------------------------------------------------

/** Teto de uma alternativa. Trecho verbatim cortado, nunca reescrito. */
const MAX_ALTERNATIVA = 140;

/**
 * O trecho de um slide que cabe numa alternativa.
 *
 * CORTA, não resume: resumir seria a IARA escrevendo a alternativa, e uma
 * alternativa escrita pela IARA é exatamente a que pode estar inventada. As
 * reticências ficam visíveis para quem lê saber que o texto continua.
 */
export function trechoDaParada(slide: SlideDoPop, etapa: Etapa): string {
  const bruto = (slide.texto || etapa.titulo).replace(/\s+/g, ' ').trim();
  if (bruto.length <= MAX_ALTERNATIVA) return bruto;
  return `${bruto.slice(0, MAX_ALTERNATIVA).trimEnd()}…`;
}

/**
 * Embaralhamento DETERMINÍSTICO a partir de uma semente.
 *
 * Determinístico porque a questão é persistida e relida noutro turno: um
 * `Math.random()` aqui faria a alternativa correta mudar de letra entre a
 * pergunta e a correção, e a pessoa seria reprovada por acertar.
 */
function embaralhar<T>(itens: readonly T[], semente: number): T[] {
  const saida = [...itens];
  let s = (semente % 2147483647) + 1;
  for (let i = saida.length - 1; i > 0; i -= 1) {
    s = (s * 16807) % 2147483647;
    const j = s % (i + 1);
    [saida[i], saida[j]] = [saida[j], saida[i]];
  }
  return saida;
}

/**
 * Monta uma questão sobre a próxima ação, a partir das paradas reais do POP.
 *
 * `null` quando o documento não sustenta uma questão — POP de uma parada só, ou
 * sem distratores suficientes. Devolver uma questão com duas alternativas
 * iguais seria produzir um exercício que não mede nada e ainda registra um
 * acerto.
 */
export function montarPergunta(
  p: Procedimento,
  todas: readonly Posicao[],
  atual: Posicao,
  semente: number,
): PerguntaDeAvaliacao | null {
  const proxima = todas[atual.indice];
  if (!proxima) return null;

  const certa = {
    texto: trechoDaParada(proxima.slide, proxima.etapa),
    parada: chaveDaParada(proxima.etapa.numero, proxima.slide.indice),
  };

  const distratores = todas
    .filter((x) => x.indice !== atual.indice && x.indice !== proxima.indice)
    .map((x) => ({
      texto: trechoDaParada(x.slide, x.etapa),
      parada: chaveDaParada(x.etapa.numero, x.slide.indice),
    }))
    /* Trecho idêntico ao da correta não pode virar distrator: a pessoa marcaria
       a resposta certa e seria contada como errada. Acontece de verdade — slides
       repetem texto curto dentro do mesmo POP. */
    .filter((x) => x.texto !== certa.texto);

  if (distratores.length < 2) return null;

  const escolhidos = embaralhar(distratores, semente).slice(0, 2);
  const alternativas = embaralhar([certa, ...escolhidos], semente + 7);

  return {
    tipo: 'proxima_acao',
    enunciado:
      `Você está na parada ${atual.indice} de ${atual.total} do ${p.codigo} ` +
      `(${atual.etapa.titulo}). Qual destas é a PRÓXIMA ação do procedimento?`,
    alternativas: alternativas.map((x) => x.texto),
    correta: alternativas.findIndex((x) => x.parada === certa.parada && x.texto === certa.texto),
    paradas: alternativas.map((x) => x.parada),
    parada: chaveDaParada(atual.etapa.numero, atual.slide.indice),
    fonte: citar(p, atual.etapa, atual.slide),
  };
}

/**
 * Minúsculas sem acento, para comparar a resposta com a alternativa.
 *
 * Cópia mínima e deliberada de `normalizar` (`servidor/nucleo/texto.ts`): `lib/`
 * é contrato compartilhado servidor↔cliente e não pode importar do servidor.
 * Cinco linhas duplicadas custam menos que a fronteira furada — e este arquivo
 * não colapsa espaço, porque o casamento por trecho depende do espaçamento
 * original do slide.
 */
function semAcento(bruto: string): string {
  return bruto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/** As letras que o operador pode digitar. Fecha em `alternativas.length`. */
const LETRAS = 'abcdefgh';

export function letraDaAlternativa(indice: number): string {
  return LETRAS[indice] ?? '?';
}

/**
 * Qual alternativa o operador escolheu. `null` quando não dá para saber.
 *
 * `null` é resposta legítima e NÃO é `incorreta`: "não consegui ler o que você
 * respondeu" e "você errou" são coisas diferentes, e registrar a primeira como
 * a segunda contaminaria o progresso com erros que ninguém cometeu.
 *
 * Duas formas de escolher, nesta ordem: a letra (`b`, `letra b`, `alternativa b`)
 * e o texto — quando a resposta contém, normalizada, um pedaço grande o
 * bastante de UMA alternativa só.
 */
export function escolhaDoOperador(pergunta: PerguntaDeAvaliacao, bruto: string): number | null {
  const t = semAcento(bruto);

  const letra = /(?:^|\b)(?:alternativa\s+|letra\s+|op[cç][aã]o\s+)?([a-h])(?:\)|\.|\s|$)/.exec(t);
  if (letra) {
    const indice = LETRAS.indexOf(letra[1]);
    if (indice >= 0 && indice < pergunta.alternativas.length) return indice;
  }

  /* Casamento por texto: exige um trecho longo, e exige ser de UMA alternativa
     só. Trecho curto casaria com várias — todas as paradas do mesmo POP falam do
     mesmo sistema, e "clicar em" aparece em quase todas. */
  const candidatos: number[] = [];
  pergunta.alternativas.forEach((alt, i) => {
    const a = semAcento(alt);
    const pedaco = a.slice(0, 40).trim();
    if (pedaco.length >= 12 && t.includes(pedaco)) candidatos.push(i);
  });
  return candidatos.length === 1 ? candidatos[0] : null;
}

/**
 * O veredito de uma escolha.
 *
 * `parcial` tem um significado preciso e computável: a pessoa marcou OUTRA TELA
 * DA MESMA ETAPA. Errar de mira dentro da etapa certa é diferente de responder
 * sobre outro assunto do procedimento, e a diferença muda o que se ensina em
 * seguida — daí ela existir em vez de tudo virar `incorreta`.
 */
export function veredito(pergunta: PerguntaDeAvaliacao, escolha: number | null): ResultadoDeResposta {
  if (escolha === null) return 'nao_coberta';
  if (escolha === pergunta.correta) return 'correta';
  const etapaCerta = pergunta.paradas[pergunta.correta]?.split('/')[0];
  const etapaMarcada = pergunta.paradas[escolha]?.split('/')[0];
  return etapaCerta && etapaCerta === etapaMarcada ? 'parcial' : 'incorreta';
}

/** Como a resposta comenta cada veredito. Constantes, não texto solto. */
export const COMENTARIO_DO_VEREDITO: Record<ResultadoDeResposta, string> = {
  correta: 'É essa mesma — bate com a próxima parada do procedimento.',
  parcial:
    'Você acertou a etapa e errou a tela: a alternativa que você marcou é outra parada da MESMA etapa.',
  incorreta: 'Essa alternativa é de outra etapa do procedimento.',
  nao_coberta:
    'Não consegui identificar qual alternativa você escolheu — e não vou registrar como erro algo ' +
    'que eu não li. Responda com a letra.',
};
