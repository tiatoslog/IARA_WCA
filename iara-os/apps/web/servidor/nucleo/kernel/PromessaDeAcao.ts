/**
 * A FALA PROMETE UMA AÇÃO QUE NÃO VAI ACONTECER?
 *
 * Módulo irmão de `AfirmacaoDeFeito`, e a simetria é exata:
 *
 *   AfirmacaoDeFeito   "eu FIZ"        e nada aconteceu.
 *   PromessaDeAcao     "eu VOU fazer"  e nada mais vai acontecer.
 *
 * As duas são mentira operacional. A primeira o operador descobre indo olhar o
 * disco; a segunda ele nem descobre — fica esperando um número que nunca chega,
 * e só saberia mandando outra mensagem.
 *
 * O DEFEITO, MEDIDO NO NAVEGADOR EM 19/08/2026 com modelo real
 * (`test-evidence/AUTORIDADE-DE-DADOS/cognitiva-3` e `-4`), duas de duas
 * rodadas da rota cognitiva:
 *
 *     "Vou puxar o número atual na base. [Chamando consultar_infraestrutura]…"
 *     "…Vou consultar a base agora, direito. Consulta: `consultar_infraestrutura`
 *      com `uf = GERAL`"
 *
 * Numa delas a resposta ainda caiu no número velho do histórico — o incidente
 * que o laço inteiro existe para fechar. A causa é o laço ter terminado com o
 * modelo ainda na postura de quem pode agir: a última decisão dele foi tomada
 * com ferramentas na mesa, e a síntese herda esse hábito.
 *
 * A CORREÇÃO ANTERIOR FOI INSTRUÇÃO, e instrução não é trava — a mesma frase
 * que abre `AfirmacaoDeFeito`. Uma linha no bloco de sistema dizendo "não
 * anuncie consulta" funcionou nas duas rodadas seguintes, e "funcionou duas
 * vezes" é o que se diz de um dado, não de uma garantia. Este arquivo é a
 * garantia.
 *
 * ---------------------------------------------------------------------------
 * DUAS FAMÍLIAS, E A PRIMEIRA É QUE É DETERMINÍSTICA
 * ---------------------------------------------------------------------------
 *
 * 1. CHAMADA EM PROSA — o id de uma habilidade do catálogo aparecendo em
 *    posição de chamada. `consultar_infraestrutura` não é português: ninguém
 *    escreve isso por acaso numa resposta a operador. É o sinal mais forte que
 *    existe aqui, e não depende de interpretar linguagem natural — depende do
 *    catálogo, que o kernel conhece.
 *
 * 2. PROMESSA DE CONSULTA — "vou verificar", "confirmando na base agora". Esta
 *    é heurística sobre português e por isso é ESTREITA, com as mesmas
 *    prioridades de `AfirmacaoDeFeito`.
 *
 * ---------------------------------------------------------------------------
 * O QUE NÃO PODE SER BARRADO, e é metade do desenho
 * ---------------------------------------------------------------------------
 *
 * · PERGUNTAR AO OPERADOR é a resposta certa quando falta parâmetro. "Quer que
 *   eu consulte por UF?" contém "consulte" e é exatamente o que a IARA deve
 *   dizer — `Ambiguidade.ts` existe para produzir essa frase.
 * · RELATAR O QUE FALHOU também nomeia a habilidade: "não consegui rodar
 *   `consultar_infraestrutura`, a UF veio inválida" é honestidade, não promessa.
 * · CONDICIONAL não é promessa: "se você quiser, eu consulto no próximo turno"
 *   descreve uma possibilidade e não engana ninguém.
 *
 * Desarmar vem ANTES de acusar, oração por oração — a mesma ordem do módulo
 * irmão, e pela mesma razão: senão isto vira um localizador de palavra.
 *
 * ASSIMETRIA DE ERRO, e ela é DIFERENTE da do módulo irmão. Lá, bloquear uma
 * frase honesta custa a resposta inteira. Aqui o descarte cai para uma
 * composição do Kernel sobre `saidas` — os dados observados existem e chegam ao
 * operador de qualquer jeito; o que se perde é a redação. Por isso esta trava
 * pode ser um pouco mais firme que aquela sem o mesmo risco.
 */

/**
 * Id de habilidade em POSIÇÃO DE CHAMADA.
 *
 * A menção nua não basta: `n8o consegui rodar consultar_x` é relato honesto. O
 * que acusa é a forma de invocação — parêntese de argumento, cerca de código,
 * colchete de ferramenta, ou um verbo de acionamento colado antes.
 */
function chamadaEmProsa(oracao: string, ids: readonly string[]): string | null {
  for (const id of ids) {
    if (!id || !oracao.includes(id)) continue;
    const escapado = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const formas: RegExp[] = [
      new RegExp(`${escapado}\\s*\\(`, 'i'),
      new RegExp(`[\`*_\\[]\\s*${escapado}`, 'i'),
      new RegExp(`\\b(chamando|executando|rodando|acionando|invocando)\\b[^.]{0,40}${escapado}`, 'i'),
      new RegExp(`${escapado}\\s+com\\s+\`?\\w+\\s*=`, 'i'),
    ];
    for (const re of formas) {
      const m = re.exec(oracao);
      if (m) return m[0].trim();
    }
  }
  return null;
}

/** Marcador de ferramenta, sem depender de conhecer o id. */
const MARCADOR_DE_CHAMADA: readonly RegExp[] = [
  /\[\s*(chamando|executando|rodando|tool|função|funcao)\b[^\]]*\]/i,
  /<\s*(tool_call|function_call|invoke)\b[^>]*>/i,
];

/**
 * Promessa de consulta ou verificação futura.
 *
 * Só o que promete ALCANÇAR ALGO neste turno. "Vou pensar" e "vou resumir" não
 * entram: descrevem o que a própria fala já está fazendo.
 */
const PROMESSAS: readonly RegExp[] = [
  /\b(vou|irei|v[ôo]u|vamos|deixa\s+eu|deixe-me|j[áa]\s+vou)\s+\w*\s*(consultar|verificar|checar|conferir|puxar|buscar|levantar|rodar|executar|confirmar|apurar|olhar|ver)\b/i,
  /\b(consultando|verificando|checando|conferindo|apurando|confirmando)\s+(agora|na\s+base|no\s+sistema|os?\s+dados|direito)\b/i,
  /\b(um\s+momento|s[óo]\s+um\s+instante|aguarde|j[áa]\s+te\s+(digo|trago|falo|respondo)|volto\s+j[áa])\b/i,
  /\bdeixa\s+comigo\b/i,
];

/**
 * O que desarma. Ordem de leitura: se qualquer um casar, a oração não é
 * promessa e nem chega a ser examinada.
 */
const DESARMES: readonly RegExp[] = [
  /\?\s*$/,
  /\b(quer\s+que|posso|deseja|prefere|se\s+voc[êe]|caso\s+queira|se\s+quiser|se\s+preferir)\b/i,
  /\bn[ãa]o\s+(vou|consigo|tenho\s+como|d[áa]\s+para|consegui|rodei|executei)\b/i,
  /\b(tentei|tentou|falh(ei|ou|aram)|recusou|inv[áa]lid[oa]|n[ãa]o\s+aceito)\b/i,
  /\bda\s+pr[óo]xima\s+vez\b/i,
  /\bno\s+pr[óo]ximo\s+turno\b/i,
  /\bme\s+(diga|informe|passe|mande)\b/i,
];

export interface LeituraDePromessa {
  readonly promete: boolean;
  /** O trecho que decidiu. Vai para o log e para o teste — nunca inventado. */
  readonly ancora: string | null;
  readonly especie: 'chamada_em_prosa' | 'promessa_futura' | null;
}

const NADA: LeituraDePromessa = { promete: false, ancora: null, especie: null };

/**
 * NORMALIZAR ANTES DE DETECTAR — e isto é o que separa esta trava de mais um
 * punhado de regex frágil.
 *
 * O detector não pode depender da redação. Marcação de markdown, aspas
 * tipográficas, travessão unicode e caractere de largura zero são todos formas
 * de escrever a MESMA chamada, e cada uma delas seria um regex novo se a
 * normalização não existisse. Aqui o texto entra por um funil estreito e o
 * detector trabalha sobre uma forma só.
 *
 * O que NÃO se faz aqui é remover conteúdo: normalizar é achatar a forma, não
 * censurar. A âncora devolvida é um trecho do texto normalizado, e é isso que
 * vai para o log — nunca uma reconstrução.
 */
export function normalizarParaDeteccao(texto: string): string {
  return texto
    /* Largura zero e junções: o vetor mais barato de quebrar casamento. */
    .replace(/[\u200B-\u200D\uFEFF\u2060]/g, '')
    /* Travessões e aspas tipográficas viram ASCII. */
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    /* Ênfase de markdown some; crase e colchete FICAM, porque são justamente
       o sinal de "isto é código/ferramenta" que o detector usa. */
    .replace(/\*\*|__|~~/g, '')
    .replace(/\s+/g, ' ');
}

/** Mesmo cortador de orações do módulo irmão — ver o comentário de lá. */
function oracoes(texto: string): string[] {
  return texto
    .split(/[.!?;\n]|,\s*(?=mas|por[ée]m|contudo|todavia)|\s+(?:mas|por[ée]m|contudo|todavia)\s+/i)
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
}

const primeiroAchado = (oracao: string, res: readonly RegExp[]): string | null => {
  for (const re of res) {
    const m = re.exec(oracao);
    if (m) return m[0];
  }
  return null;
};

/**
 * @param texto  a fala que a síntese produziu
 * @param ids    ids das habilidades do catálogo desta subida. Vazio é legítimo:
 *               a família 1 simplesmente não tem o que casar, e a 2 continua
 *               valendo.
 */
export function lerPromessaDeAcao(
  texto: string,
  ids: readonly string[] = [],
): LeituraDePromessa {
  if (typeof texto !== 'string' || !texto.trim()) return NADA;

  /**
   * VARRE O TEXTO INTEIRO E FICA COM A EVIDÊNCIA MAIS FORTE — não com a
   * primeira encontrada.
   *
   * A primeira versão parava na primeira oração acusada, e as duas falas
   * medidas em produção caíam no caso ruim: "Vou puxar o número na base."
   * (promessa) vinha ANTES de "[Chamando consultar_infraestrutura]" (chamada
   * estruturada). O veredicto saía `promessa_futura` e o log registrava a
   * evidência fraca de um caso que tinha a forte.
   *
   * Chamada estruturada vence porque é a única que não depende de interpretar
   * português: ou o texto tem a forma de uma invocação de habilidade do
   * catálogo, ou não tem.
   */
  let promessaFraca: LeituraDePromessa | null = null;

  for (const oracao of oracoes(normalizarParaDeteccao(texto))) {
    /* Desarmar antes de acusar. Uma pergunta ao operador, um relato de falha ou
       uma condicional não são promessa — e examinar-lhes o conteúdo em busca de
       verbo seria transformar isto num localizador de palavra. */
    if (primeiroAchado(oracao, DESARMES)) continue;

    const marcador = primeiroAchado(oracao, MARCADOR_DE_CHAMADA);
    if (marcador) return { promete: true, ancora: marcador, especie: 'chamada_em_prosa' };

    const chamada = chamadaEmProsa(oracao, ids);
    if (chamada) return { promete: true, ancora: chamada, especie: 'chamada_em_prosa' };

    if (!promessaFraca) {
      const promessa = primeiroAchado(oracao, PROMESSAS);
      if (promessa) {
        promessaFraca = { promete: true, ancora: promessa, especie: 'promessa_futura' };
      }
    }
  }
  return promessaFraca ?? NADA;
}
