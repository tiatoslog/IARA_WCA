/**
 * O CONTRATO SEMÂNTICO — a pergunta factual vira estrutura ANTES de qualquer
 * modelo opinar.
 *
 * O INCIDENTE (produção, 19/08/2026). "Quantos motoristas temos?" devolveu, em
 * quatro execuções da MESMA pergunta sobre a MESMA base:
 *
 *   1. "75 motoristas diferentes, contando o grupo 'sem motorista'."
 *   2. "75 motoristas diferentes, contando o grupo 'sem motorista'."
 *   3. "Não executei isso. (…) passou de 15000ms."
 *   4. "todas as cargas de 2026: 53 motoristas diferentes — 131 cargas sem
 *       motorista preenchido, fora dessa conta."
 *
 * Cada um dos três defeitos por trás desses quatro turnos já foi consertado no
 * seu nível (o rodapé somado virou a métrica `distintos`; o teto de 15 s virou
 * 75 s; o número repetido do histórico virou a trava de autoridade). E mesmo
 * com os três fechados a VARIÂNCIA continuava possível, porque nenhum deles
 * tocava na causa comum.
 *
 * A CAUSA COMUM, medida neste repositório em 19/08/2026 e congelada em
 * `testes/contrato-factual.test.ts`: nenhuma pergunta de contagem sobre a
 * operação LUFT casava âncora nenhuma. Todas caíam em `plano_cognitivo` — quer
 * dizer, **a ferramenta e os parâmetros eram escolhidos por um modelo
 * estocástico a cada execução**. Duas paráfrases da mesma pergunta nem sequer
 * caíam no mesmo ramo do pipeline: "quantos motoristas temos?" ia para
 * `plano_cognitivo` (que lista o catálogo) e "me diga o número de motoristas"
 * ia para `raciocinio_direto` (que não lista).
 *
 * Com isso, `SAME_QUESTION_VARIANCE = 0` não era uma propriedade que o sistema
 * podia falhar em cumprir: era uma propriedade que ele não tinha como cumprir.
 * Oráculo e trava de fala PEGAM a resposta errada depois; nenhum dos dois faz o
 * CAMINHO ser o mesmo duas vezes.
 *
 * O QUE ESTE ARQUIVO FAZ. Para a família fechada de perguntas que o motor
 * determinístico já sabe responder, a interpretação é feita aqui, por código:
 *
 *     MODELO PROPÕE → SISTEMA EXECUTA → ORÁCULO VALIDA → MODELO EXPLICA
 *
 * vira, nesta família, algo ainda mais forte — o modelo não propõe. Ele só
 * explica o que o sistema já executou.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, e a recusa é o que o mantém honesto. Ele cobre um
 * conjunto ESTREITO e DECLARADO de perguntas. Tudo que estiver fora devolve
 * `fora` e o pipeline de hoje segue intacto. Um contrato que tentasse cobrir
 * "quantas cargas por mês" — agrupamento que o motor não tem — trocaria uma
 * resposta hesitante da LLM por um número errado com procedência, que é o pior
 * defeito desta auditoria inteira. Ver `EXCETO`.
 *
 * ESTE MÓDULO É PURO. Sem I/O, sem relógio, sem rede: a mesma frase produz o
 * mesmo contrato para sempre, e é isso que o torna testável 100 vezes seguidas.
 */

import { normalizar } from '../texto';
import type { AgruparPor } from '../ClientePlanilhaOcis';

/**
 * A operação relacional que responde a pergunta. Nome de SQL de propósito: é o
 * vocabulário em que a operadora e o auditor conferem a conta.
 */
export type OperacaoFactual = 'COUNT' | 'COUNT_DISTINCT' | 'SUM' | 'AVG' | 'GROUP_BY';

/** A métrica no vocabulário do catálogo — o que vai no parâmetro da habilidade. */
export type MetricaFactual = 'contagem' | 'distintos' | 'valor_total' | 'valor_medio';

/**
 * O CONTRATO. Tudo que a pergunta significa, sem uma palavra de texto livre.
 *
 * O ponto do formato é negativo, não positivo: com ele, NÃO existe lugar onde a
 * LLM esconda uma decisão semântica. Período, política de nulo, dimensão e
 * operação ou estão aqui, explícitos e conferíveis, ou não foram decididos.
 */
export interface ContratoFactual {
  readonly operacao: OperacaoFactual;
  /** O substantivo que a pergunta conta ou soma, no singular. */
  readonly entidade: string;
  /** A dimensão do GROUP BY / COUNT DISTINCT. `nenhum` = universo inteiro. */
  readonly dimensao: AgruparPor;
  readonly metrica: MetricaFactual;
  readonly distinto: boolean;
  /**
   * `implicito` = a frase não nomeou período, e a política é o universo lido
   * (a aba do ano vivo), DECLARADO na resposta pelo rótulo da habilidade.
   * `explicito` = a frase nomeou, e a expressão vai crua para quem sabe
   * interpretá-la. Nunca uma data já calculada: calcular aqui duplicaria
   * `interpretarPeriodo` e as duas cópias divergiriam.
   */
  readonly periodo: { readonly tipo: 'implicito' | 'explicito'; readonly expressao: string };
  /** Ausência nunca é entidade. Ver `dimensaoAusente`. */
  readonly politica_nulo: 'excluir';
  readonly fonte: 'cargas_luft';
  readonly habilidade: string;
  /** Já no formato que o esquema da habilidade valida. */
  readonly parametros: Readonly<Record<string, string>>;
}

/**
 * A leitura da frase. Três desfechos, e o do meio é o que a auditoria exige:
 * pergunta bem-formada sobre coluna que NÃO EXISTE tem que devolver ausência de
 * dado, nunca uma associação inventada.
 */
export type LeituraFactual =
  | { readonly tipo: 'contrato'; readonly contrato: ContratoFactual }
  | { readonly tipo: 'sem_dado'; readonly dimensao: LacunaDeColuna; readonly motivo: string }
  | { readonly tipo: 'fora' };

// ---------------------------------------------------------------------------
// Vocabulário — uma tabela, não regras espalhadas
// ---------------------------------------------------------------------------

/** Substantivos que nomeiam uma DIMENSÃO da carga: contá-los é COUNT DISTINCT. */
const DIMENSOES: ReadonlyArray<{ re: RegExp; dimensao: AgruparPor; entidade: string }> = [
  {
    re: /\b(motorista|motoristas|condutor|condutores)\b/,
    dimensao: 'motorista',
    entidade: 'motorista',
  },
  { re: /\b(rota|rotas)\b/, dimensao: 'rota', entidade: 'rota' },
  { re: /\b(origem|origens)\b/, dimensao: 'origem', entidade: 'origem' },
  { re: /\b(destino|destinos)\b/, dimensao: 'destino', entidade: 'destino' },
  { re: /\b(status|situacao|situacoes)\b/, dimensao: 'status_normalizado', entidade: 'status' },
];

/** O fato contável: a carga. */
const CARGA = /\b(carga|cargas|oci|ocis)\b/;

/**
 * DIMENSÕES QUE A FONTE NÃO TEM — a regra de "dado ausente" da auditoria.
 *
 * "Quantas cargas por cliente?" é uma pergunta perfeitamente formada sobre uma
 * coluna que não existe em `CargaCompleta`. Hoje ela chega à LLM, que tem duas
 * saídas: admitir a lacuna ou associar rota/destino a "cliente" e responder com
 * cara de certeza. A segunda é gratuita para ela e cara para a operação.
 *
 * Reconhecer aqui é o que torna a recusa determinística: mesma frase, mesma
 * recusa, sempre — e a lacuna vira uma linha de produto, não um silêncio.
 */
const SEM_COLUNA: ReadonlyArray<{ re: RegExp; nome: LacunaDeColuna }> = [
  { re: /\b(cliente|clientes|embarcador|embarcadores|tomador|tomadores)\b/, nome: 'cliente' },
  { re: /\b(veiculo|veiculos|placa|placas|caminhao|caminhoes)\b/, nome: 'veiculo' },
];

/**
 * As dimensões que a planilha NÃO tem, com o motivo escrito uma vez só.
 *
 * O motivo mora aqui, e não no plano, por uma razão de segurança e não de
 * organização: a habilidade que declara a lacuna recebe só o NOME da dimensão,
 * validado contra este enum. Se ela recebesse o texto, a LLM — que também
 * enxerga o catálogo — poderia chamá-la com um motivo inventado e a recusa
 * viraria mais um lugar por onde passa afirmação sem lastro.
 */
export const LACUNAS_DE_COLUNA = {
  cliente:
    'a planilha da operação LUFT não tem coluna de cliente. Ela tem OCI, origem, destino, motorista, status, datas e valor',
  veiculo:
    'a planilha não tem coluna de veículo. A placa aparece colada ao nome do motorista, e contar dali seria contar anotação como se fosse cadastro',
} as const;

export type LacunaDeColuna = keyof typeof LACUNAS_DE_COLUNA;

/** O enum que o esquema da habilidade de lacuna valida. Fonte única. */
export const DIMENSOES_SEM_COLUNA = Object.keys(LACUNAS_DE_COLUNA) as readonly LacunaDeColuna[];

/** Pede uma contagem. */
const VERBO_DE_CONTAGEM =
  /\b(quantos|quantas|quantidade de|numero de|total de|contagem de)\b/;

/** Pede a soma do valor. */
const VERBO_DE_SOMA =
  /\b(faturamento|faturado|faturamos|valor total|total faturado|soma dos valores|somatorio|receita total)\b/;

/** Pede a média do valor. */
const VERBO_DE_MEDIA = /\b(valor medio|ticket medio|media por carga|media das cargas)\b/;

/**
 * Pede um ranking — o topo de um GROUP BY.
 *
 * A FORMA SOZINHA NÃO BASTA, e a trava está em `ehRanking`: "qual a maior
 * rota?" tem a forma exata de um ranking e pergunta DISTÂNCIA, que a planilha
 * não tem. Um GROUP BY respondido ali devolveria a rota com mais cargas — outra
 * pergunta, bem formatada, com procedência. Só vira ranking quando a frase diz
 * por qual grandeza ordenar: cargas ou faturamento.
 */
const VERBO_DE_RANKING =
  /\b(qual|quais|quem)\b[^?]{0,40}\b(mais|maior|melhor|top|lidera|campeao)\b|\branking\b/;

/** "por motorista", "por rota" — o GROUP BY dito em português. */
const AGRUPADO_POR = /\b(?:por|para cada|agrupados? por|agrupadas? por|separados? por|separadas? por)\s+(?:cada\s+)?([a-z]+)\b/;

/**
 * PERÍODOS QUE `interpretarPeriodo` ENTENDE — e só eles.
 *
 * A lista é cópia do vocabulário de lá, e a duplicação é deliberada e travada
 * por teste (`contrato-factual.test.ts`, "o vocabulário de período não
 * diverge"). O contrato precisa SABER se a frase nomeou período antes de chamar
 * qualquer coisa; importar o interpretador aqui traria o relógio para dentro de
 * um módulo que é puro de propósito.
 */
const EXPRESSAO_DE_PERIODO =
  /\b(depois de amanha|hoje|amanha|ontem|[dn]?essa semana|[dn]?esta semana|semana atual|semana que vem|proxima semana|semana seguinte|semana passada|semana anterior|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/;

/**
 * A CONTRAÇÃO COME A FRONTEIRA DE PALAVRA — `[dn]?` acima não é enfeite.
 *
 * "qual o valor total das cargas DESSA SEMANA?" devolveu o ano inteiro em
 * 19/08/2026, na auditoria em navegador. `\bessa semana\b` não casa "dessa": o
 * "essa" vem colado num "d" e a fronteira de palavra não existe ali. Sem
 * período reconhecido, o contrato marcava `implicito` — que significa universo
 * inteiro. O rótulo saiu honesto ("todas as cargas de 2026") e a pergunta era
 * outra.
 *
 * A mesma letra foi corrigida em `interpretarPeriodo`. As duas pontas TÊM de
 * mudar juntas, e o portão que cobra isso é o teste "o vocabulário de período do
 * contrato não diverge de interpretarPeriodo".
 */

/**
 * O QUE O CONTRATO SE RECUSA A LER — e por que a recusa é a metade que protege.
 *
 * Cada linha aqui é uma capacidade que o motor NÃO tem. Deixar o contrato
 * capturar a frase assim mesmo trocaria "a LLM hesita" por "o sistema responde
 * com procedência a pergunta errada" — e resposta errada com procedência é a
 * que ninguém confere. Os estados vêm medidos de
 * `testes/matriz-capacidades-planilha.test.ts`, não de suposição.
 */
const EXCETO: ReadonlyArray<{ re: RegExp; porque: string }> = [
  {
    /* MIN-001 / MAX-001: UNSUPPORTED. */
    re: /\b(maior valor|menor valor|valor maximo|valor minimo|mais car[ao]|mais barat[ao])\b/,
    porque: 'MIN/MAX ainda não existem no motor',
  },
  {
    /**
     * GROUP-003/004 e DATE-003..005: agrupamento temporal UNSUPPORTED.
     *
     * ACHADO NA PRÓPRIA VARREDURA (19/08/2026), e é o defeito que este arquivo
     * inteiro existe para não cometer: a primeira versão listava `por mes` e
     * deixava passar **"quantas cargas tivemos mês a mês?"**. O contrato se
     * declarava competente, devolvia o TOTAL do ano com procedência impecável,
     * e a pergunta era por uma série mensal. Resposta certa para a pergunta
     * errada — a mais cara de todas, porque ninguém confere número que veio
     * com fonte.
     *
     * Por isso a regra passou a ser escrita por FORMA e não por lista de
     * frases: `por/cada/todo` + unidade, e a reduplicação `mês a mês`. Listar
     * frases significa descobrir a próxima em produção.
     *
     * `essa semana` sobrevive de propósito: é PERÍODO, que o motor sabe
     * filtrar, e não agrupamento, que ele não sabe fazer.
     */
    re: /\b(?:por|a\s+cada|cada|todos?\s+os?|todo|toda)\s+(mes|meses|ano|anos|semestre|trimestre|dia|dias|semana|semanas)\b|\b(?:mes a mes|ano a ano|dia a dia|semana a semana)\b|\b(mensal|mensais|anual|anuais|diari[ao]s?|semanal|semanais|mensalmente|anualmente|diariamente|semanalmente)\b|\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\b/,
    porque: 'agrupamento e filtro por mês/ano ainda não existem no motor',
  },
  {
    /* PCT-001: SUPPORTED_PARTIAL — parcial não é determinístico o bastante. */
    re: /\b(percentual|porcentagem|proporcao|por cento)\b|%/,
    porque: 'percentual ainda é parcial no motor',
  },
  {
    /* CMP-001/002: tem habilidade própria (`comparar_semanas_luft`). */
    re: /\b(compar\w+|diferenca entre|em relacao a|versus|vs|crescemos|caimos|evolucao)\b/,
    porque: 'comparação tem habilidade própria e contrato próprio',
  },
  {
    /* Filtro por predicado: o motor agrega, não filtra. */
    re: /\b(acima de|abaixo de|maior que|menor que|com status|cujo|cuja|que estao|filtrad[oa]s?)\b/,
    porque: 'filtro por predicado ainda não existe no motor',
  },
  {
    /* "quantas cargas o LINO fez" — filtro por entidade nomeada. A pergunta é
       boa, a habilidade não tem o parâmetro, e adivinhar o nome é pior. */
    re: /\b(do|da) (motorista|rota|origem|destino) \w/,
    porque: 'filtro por entidade específica ainda não existe no motor',
  },
  {
    /* Pergunta SOBRE a capacidade, não pela contagem. */
    re: /\b(como voce|de onde voce|voce sabe|voce consegue|voce pode|explique|explica como)\b/,
    porque: 'a pergunta é sobre o método, não pelo número',
  },
];

// ---------------------------------------------------------------------------

const HABILIDADE = 'consultar_estatisticas_cargas_luft';

function periodoDaFrase(t: string): { tipo: 'implicito' | 'explicito'; expressao: string } {
  const m = t.match(EXPRESSAO_DE_PERIODO);
  return m ? { tipo: 'explicito' as const, expressao: m[0] } : { tipo: 'implicito' as const, expressao: '' };
}

function montar(
  operacao: OperacaoFactual,
  entidade: string,
  dimensao: AgruparPor,
  metrica: MetricaFactual,
  periodo: { tipo: 'implicito' | 'explicito'; expressao: string },
): ContratoFactual {
  return {
    operacao,
    entidade,
    dimensao,
    metrica,
    distinto: metrica === 'distintos',
    periodo,
    politica_nulo: 'excluir',
    fonte: 'cargas_luft',
    habilidade: HABILIDADE,
    parametros: {
      periodo: periodo.expressao,
      agrupar_por: dimensao,
      metrica,
    },
  };
}

/**
 * "por motorista" → `motorista`. `null` quando o "por" não nomeia dimensão
 * conhecida — "por favor" e "por enquanto" não agrupam nada.
 */
function agrupamentoExplicito(t: string): AgruparPor | null {
  const m = t.match(AGRUPADO_POR);
  if (!m) return null;
  const palavra = m[1];
  const achado = DIMENSOES.find((d) => d.re.test(palavra));
  return achado ? achado.dimensao : null;
}

/**
 * Ranking de verdade: a forma MAIS a grandeza pela qual ordenar. Ver
 * `VERBO_DE_RANKING`.
 */
function ehRanking(t: string): boolean {
  return VERBO_DE_RANKING.test(t) && (CARGA.test(t) || VERBO_DE_SOMA.test(t));
}

/**
 * A ÚNICA PORTA. Frase crua entra, contrato ou recusa sai — sempre o mesmo para
 * a mesma frase, porque não há relógio, rede nem aleatoriedade no caminho.
 *
 * A ORDEM DAS REGRAS É A POLÍTICA:
 *
 *   1. o que a fonte não tem  → `sem_dado` (nunca inventar associação)
 *   2. o que o motor não faz  → `fora`     (a LLM segue melhor que um número errado)
 *   3. soma e média de valor  → SUM / AVG
 *   4. ranking                → GROUP_BY
 *   5. "cargas por X"         → GROUP_BY
 *   6. contar uma dimensão    → COUNT_DISTINCT   ← a pergunta do incidente
 *   7. contar cargas          → COUNT
 *
 * O passo 6 vem DEPOIS de 4 e 5 de propósito. "Qual motorista fez mais cargas?"
 * cita `motorista` e casaria COUNT_DISTINCT; a intenção é ranking. Trocar a
 * ordem responderia "53" a quem perguntou um nome.
 */
export function interpretarContratoFactual(bruto: string): LeituraFactual {
  const t = normalizar(bruto);

  /**
   * Sem menção à operação, nada aqui se aplica: este contrato fala de UMA
   * fonte. A porta estreita é o que impede o módulo de sequestrar "quantos
   * e-mails não lidos" no dia em que alguém acrescentar um substantivo.
   *
   * `SEM_COLUNA` fica DE FORA desta porta, e a exclusão evitou uma regressão
   * real: "quantos veículos temos?" tem resposta certa em OUTRA fonte (a frota,
   * pela âncora `infraestrutura`). Se bastasse a palavra "veículo" para o
   * contrato se declarar competente, ele passaria a devolver "a planilha não
   * tem essa coluna" para uma pergunta que o sistema sabe responder — trocar
   * uma resposta certa por uma recusa educada é regressão, não rigor.
   *
   * Com esta porta, `sem_dado` só alcança quem já está falando da planilha:
   * "quantas CARGAS por cliente" recusa; "quantos clientes temos" segue o
   * caminho de sempre.
   */
  const falaDaOperacao = CARGA.test(t) || DIMENSOES.some((d) => d.re.test(t));
  if (!falaDaOperacao) return { tipo: 'fora' };

  const pedeConta =
    VERBO_DE_CONTAGEM.test(t) ||
    VERBO_DE_SOMA.test(t) ||
    VERBO_DE_MEDIA.test(t) ||
    ehRanking(t);
  if (!pedeConta) return { tipo: 'fora' };

  for (const c of SEM_COLUNA) {
    if (c.re.test(t)) return { tipo: 'sem_dado', dimensao: c.nome, motivo: LACUNAS_DE_COLUNA[c.nome] };
  }

  for (const x of EXCETO) {
    if (x.re.test(t)) return { tipo: 'fora' };
  }

  const periodo = periodoDaFrase(t);
  const dim = DIMENSOES.find((d) => d.re.test(t)) ?? null;
  const explicito = agrupamentoExplicito(t);

  // 3. Valor — soma e média. Sozinhas valem o universo; com "por X", agrupam.
  if (VERBO_DE_MEDIA.test(t)) {
    return {
      tipo: 'contrato',
      contrato: montar('AVG', 'valor', explicito ?? 'nenhum', 'valor_medio', periodo),
    };
  }
  if (VERBO_DE_SOMA.test(t)) {
    const alvo = explicito ?? (ehRanking(t) ? (dim?.dimensao ?? null) : null);
    return {
      tipo: 'contrato',
      contrato: alvo
        ? montar('GROUP_BY', 'valor', alvo, 'valor_total', periodo)
        : montar('SUM', 'valor', 'nenhum', 'valor_total', periodo),
    };
  }

  // 4. Ranking — "qual motorista fez mais cargas".
  if (ehRanking(t) && dim) {
    return {
      tipo: 'contrato',
      contrato: montar('GROUP_BY', dim.entidade, dim.dimensao, 'contagem', periodo),
    };
  }

  // 5. "quantas cargas por motorista" — GROUP BY dito com "por".
  if (explicito && CARGA.test(t)) {
    return { tipo: 'contrato', contrato: montar('GROUP_BY', 'carga', explicito, 'contagem', periodo) };
  }

  // 6. Contar uma DIMENSÃO é contar entidades distintas — a pergunta do incidente.
  if (VERBO_DE_CONTAGEM.test(t) && dim) {
    return {
      tipo: 'contrato',
      contrato: montar('COUNT_DISTINCT', dim.entidade, dim.dimensao, 'distintos', periodo),
    };
  }

  // 7. Contar cargas é contar o fato.
  if (VERBO_DE_CONTAGEM.test(t) && CARGA.test(t)) {
    return { tipo: 'contrato', contrato: montar('COUNT', 'carga', 'nenhum', 'contagem', periodo) };
  }

  return { tipo: 'fora' };
}

/**
 * A ASSINATURA DO CONTRATO — o que o portão de determinismo compara.
 *
 * Comparar o TEXTO da resposta não prova nada: a IARA reescreve a frase a cada
 * turno, duas frases diferentes podem carregar o mesmo fato, e o mesmo texto
 * pode sair de dois caminhos diferentes. O que precisa ser idêntico 100 vezes é
 * isto: operação, dimensão, métrica, período e política de nulo.
 */
export function assinaturaDoContrato(c: ContratoFactual): string {
  return [
    c.operacao,
    c.entidade,
    c.dimensao,
    c.metrica,
    `distinto=${c.distinto}`,
    `periodo=${c.periodo.tipo}:${c.periodo.expressao}`,
    `nulo=${c.politica_nulo}`,
    c.fonte,
    c.habilidade,
  ].join('|');
}

/**
 * O pré-filtro de âncora, para que `Percepcao` NÃO tenha uma segunda cópia da
 * regra — a doença que este repositório já pagou duas vezes (`Percepcao` ×
 * `RoteadorIntencoes`). Quem decide continua sendo `interpretarContratoFactual`.
 */
export function ehPerguntaDeContratoFactual(bruto: string): boolean {
  return interpretarContratoFactual(bruto).tipo !== 'fora';
}
