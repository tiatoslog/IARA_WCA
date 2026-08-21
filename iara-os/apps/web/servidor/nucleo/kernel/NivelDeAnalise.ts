/**
 * NÍVEL DE ANÁLISE — quanto esta pergunta exige antes de a resposta valer.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: "quantas cargas hoje?" e "devo trocar a
 * transportadora da rota Campinas?" não podem custar a mesma coisa nem exigir a
 * mesma evidência. A primeira é uma leitura; a segunda é uma decisão com
 * dinheiro em cima. Sem uma escolha explícita de profundidade, o sistema faz
 * uma das duas coisas erradas: investiga tudo (caro, lento e irritante) ou
 * responde tudo raso (barato e perigoso).
 *
 * O QUE IMPEDE ISTO DE SER UMA TAXONOMIA. Um nível que só mudasse o TAMANHO da
 * resposta seria decoração — e é assim que "análise profunda" costuma ser
 * implementada: o mesmo raciocínio, com mais parágrafos. Aqui cada nível
 * declara três coisas que MUDAM o comportamento do kernel:
 *
 *   1. `tipo_pretendido` — o degrau que a resposta quer alcançar. Entra direto
 *      em `MotorCritica.criticar` e decide quais contestações rodam.
 *   2. `evidencias_minimas` — abaixo disso a resposta não é conclusão, é
 *      palpite, e a suficiência rebaixa.
 *   3. `exige_recomendacao` — se a resposta deve terminar em ação. Recomendar
 *      sobre evidência que não sustenta é o modo mais caro de errar, porque
 *      alguém executa.
 *
 * POR QUE REGEX E NÃO LLM. Mesma razão de `Percepcao` e de `ContratoFactual`:
 * quem escolhe o caminho não pode ser estocástico, ou duas paráfrases da mesma
 * pergunta caem em ramos diferentes do pipeline — foi exatamente esse o defeito
 * dos 75/75/timeout/53. Um classificador de nível por LLM reintroduziria a
 * variância no lugar onde ela custa mais.
 *
 * ⚠️ ERRAR PARA BAIXO AQUI **CUSTA UMA PROTEÇÃO** — e a versão anterior deste
 * comentário afirmava o contrário.
 *
 * O texto antigo dizia que "`MotorCritica` roda de todo jeito e o degrau é o
 * piso, não o teto", concluindo que errar o nível custaria só uma resposta
 * menos ambiciosa. É **falso**, e a auditoria independente provou com uma
 * paráfrase: `r9CausaSemLastro` começa com `if (tipo !== 'causal') return []`.
 * Quando o nível não reconhece a pergunta como causal, a contestação de causa
 * NÃO RODA. Medido:
 *
 *     "por que a margem caiu?"  → estrategica → degrau comparativa, rodapé com
 *                                  a ressalva de causa
 *     "pq a margem caiu?"       → consulta    → degrau POPULACIONAL, veredicto
 *                                  CONCLUIR, confiança ALTA, rodapé VAZIO
 *
 * Ou seja: este arquivo é uma trava, não um palpite, e um falso negativo aqui é
 * um buraco de verdade. O que resta de rede quando ele erra: o degrau máximo
 * cai para `populacional`, e `instrucaoDoDegrau` proíbe explicitamente o
 * redator de afirmar causa nesse degrau. É mitigação, não equivalência.
 *
 * A consequência prática para quem mexer aqui: **caso novo de paráfrase entra
 * na bateria antes de entrar na regex**. `testes/nivel-de-analise.test.ts` §D
 * guarda o vocabulário coloquial que já custou caro.
 */

import type { TipoDeConclusao } from './MotorCritica';
import { normalizar } from '../texto';

/**
 * Os degraus, com o nome que a operação usa.
 *
 * `direta` e `consulta` existem separados de propósito: a primeira não toca
 * fonte nenhuma ("que horas são"), a segunda toca uma e valida ("quantas cargas
 * hoje"). Fundi-las faria toda pergunta de relógio arrastar o motor analítico.
 */
export type Nivel =
  | 'direta'
  | 'consulta'
  | 'operacional'
  | 'gerencial'
  | 'multidimensional'
  | 'estrategica'
  | 'executiva';

export interface ExigenciasDoNivel {
  readonly nivel: Nivel;
  /** O degrau que a resposta pretende. Entra em `MotorCritica`. */
  readonly tipo_pretendido: TipoDeConclusao;
  /** Abaixo disto a suficiência rebaixa: conclusão precisa de lastro. */
  readonly evidencias_minimas: number;
  /** A resposta deve terminar em ação proposta? */
  readonly exige_recomendacao: boolean;
  /** Escrito para o dossiê e para a auditoria. */
  readonly porque: string;
}

/**
 * A TABELA É A POLÍTICA. Está aqui inteira, num lugar só, para caber numa
 * revisão — a alternativa seria a mesma decisão espalhada por `if`s no kernel,
 * que foi como o roteamento duplicado entre `Percepcao` e o antigo
 * `RoteadorIntencoes` nasceu.
 *
 * `evidencias_minimas` cresce mais devagar que o nível de propósito: exigir
 * dez evidências para uma pergunta estratégica garantiria abstenção em toda
 * pergunta estratégica, que é recusa disfarçada de rigor.
 */
export const EXIGENCIAS: Readonly<Record<Nivel, ExigenciasDoNivel>> = {
  direta: {
    nivel: 'direta',
    tipo_pretendido: 'descritiva',
    evidencias_minimas: 0,
    exige_recomendacao: false,
    porque: 'pergunta factual de resposta única — não há o que analisar',
  },
  consulta: {
    nivel: 'consulta',
    tipo_pretendido: 'populacional',
    evidencias_minimas: 1,
    exige_recomendacao: false,
    porque: 'consulta a uma fonte: o número precisa dizer sobre quanto foi apurado',
  },
  operacional: {
    nivel: 'operacional',
    tipo_pretendido: 'populacional',
    evidencias_minimas: 2,
    exige_recomendacao: true,
    porque: 'situação e desvio do dia a dia: exige o número e o que fugiu dele',
  },
  gerencial: {
    nivel: 'gerencial',
    tipo_pretendido: 'comparativa',
    evidencias_minimas: 2,
    exige_recomendacao: true,
    porque: 'prioridade e recurso: exige comparação entre alternativas',
  },
  multidimensional: {
    nivel: 'multidimensional',
    tipo_pretendido: 'comparativa',
    evidencias_minimas: 3,
    exige_recomendacao: true,
    porque: 'cruza mais de uma dimensão: exige evidência de cada uma',
  },
  estrategica: {
    nivel: 'estrategica',
    tipo_pretendido: 'causal',
    evidencias_minimas: 3,
    exige_recomendacao: true,
    porque: 'horizonte e alternativa: pretende explicar, e explicar exige lastro causal',
  },
  executiva: {
    nivel: 'executiva',
    tipo_pretendido: 'causal',
    evidencias_minimas: 3,
    exige_recomendacao: true,
    porque: 'decisão com valor em risco: pretende explicar e recomendar',
  },
};

// ---------------------------------------------------------------------------
// Detectores — mesma disciplina de âncora que `Percepcao.ts`
// ---------------------------------------------------------------------------

/**
 * O VERBO PRESO AO COMPLEMENTO, sempre.
 *
 * `Percepcao.ts` pagou caro duas vezes por padrão genérico solto: `frota` sozinha
 * capturava "estratégia de redução de custo para a frota", e `lento` sozinho
 * capturava "o cliente está lento para pagar". A lição vale inteira aqui, e o
 * custo de ignorá-la seria pior: uma âncora errada em `Percepcao` manda para a
 * receita errada; um nível errado aqui muda o que a IARA se permite AFIRMAR.
 */
/**
 * O complemento causal EXPLÍCITO — "motivo de", "causa de", "o que explica".
 * Estes não têm segunda leitura: quem os escreve está pedindo explicação.
 */
const CAUSAL_EXPLICITO = new RegExp(
  [
    /* "motivo/causa/razão DE alguma coisa" — o complemento inclui as formas
       contraídas, que é como as pessoas escrevem. `causa\s+d[eoa]` não casava
       "causa DISSO", e "qual a causa disso?" caía em `direta`.

       `explicação` FICOU DE FORA desta alternação: "a explicação pro cliente ta
       pronta?" é pergunta de status sobre um documento, e casava `pr?[ao]`.
       Ela só conta na forma interrogativa, logo abaixo. */
    String.raw`\b(motivo|causa|raz[ãa]o)\s+(d[eoa]\b|d(isso|aquilo|essa|esse|aquela|aquele)\b|pr?[ao]\b)`,
    /* "qual o motivo", "qual a explicação" — `onde está` saiu: "onde está a
       explicação do relatório" pergunta LOCALIZAÇÃO, não causa. */
    String.raw`\b(qual|cad[êe])\s+(o\s+|a\s+)?(motivo|causa|raz[ãa]o|explica[çc][ãa]o)\b`,
    /* Verbos que só existem para pedir causa. `houve|aconteceu|deu` NÃO entram
       aqui — ver `CAUSAL_DE_ESTADO`. */
    String.raw`\bo\s+que\s+(causou|explica|levou|provocou)\b`,
    /* "explica a queda" — verbo de explicação preso a um substantivo de
       variação. Solto, `explic\w+` capturaria "me explica como usar isso". */
    String.raw`\bexplic\w+\s+(a\s+|o\s+|essa\s+|esse\s+)?(queda|alta|aumento|redu[çc][ãa]o|diferen[çc]a|varia[çc][ãa]o|piora|melhora)\b`,
  ].join('|'),
);

/**
 * "O QUE HOUVE COM X" — causal ou pergunta de estado, dependendo do X.
 *
 * "O que houve com a margem?" pede explicação. "O que houve com a impressora?"
 * pede status. A construção é a mesma e o objeto decide — foi por ignorar isso
 * que a segunda passada da auditoria achou sete falsos positivos novos, todos
 * nascendo `estrategica / causal / evidencias_minimas: 3`: excel, impressora,
 * envio, e-mail.
 *
 * A regra que separa não mora na regex, mora em `escolherNivel`: esta forma só
 * conta como causal quando a frase encosta numa DIMENSÃO DE NEGÓCIO. É a mesma
 * disciplina de prender o verbo ao complemento, aplicada a um complemento que é
 * grande demais para caber numa alternação.
 */
const CAUSAL_DE_ESTADO = /\bo\s+que\s+(houve|aconteceu|deu\s+errado)\b/;

/**
 * "PORQUE" SOZINHO NÃO É PERGUNTA — o falso positivo que a bateria pegou.
 *
 * "te mandei o arquivo porque achei importante" é relato, e capturá-lo fazia a
 * frase nascer com `tipo_pretendido: 'causal'`, `evidencias_minimas: 3` e a
 * ressalva de `causa_sem_lastro` garantida. Uma conversa vira análise
 * estratégica reprovada.
 *
 * Em português a distinção formal existe — "por que" pergunta, "porque"
 * responde —, mas ninguém escreve assim no dia a dia, e um seletor que dependa
 * da ortografia certa erra justamente com quem digita rápido. A âncora aqui é
 * o ATO DE FALA: ou a frase é interrogativa, ou ela pede explicação com um
 * verbo. É a mesma disciplina de prender o verbo ao complemento.
 */
/**
 * `pq` E `porq` ENTRAM AQUI — a operadora escreve rápido e sem acento.
 *
 * Medido pela auditoria independente: `por que a margem caiu?` virava
 * `estrategica` com a ressalva de causa, e `pq a margem caiu?` — a MESMA
 * pergunta — virava `consulta`, degrau `populacional`, veredicto `concluir`,
 * confiança `alta`, rodapé VAZIO. Uma grafia desligava a proteção inteira,
 * porque `r9CausaSemLastro` começa com `if (tipo !== 'causal') return []`.
 */
const CAUSAL_INTERROGATIVO = /\b(por\s?que|porqu[êe]|pq|porq)\b/;
const PEDE_EXPLICACAO =
  /\b(explic\w+|entender|compreender|saber|sabe\s+me\s+dizer|me\s+diz\w*|me\s+diga|diga|dizer|justific\w+)\b/;

/**
 * `caiu`/`subiu` NUNCA sozinhos — "o sistema caiu" é incidente, não comparação.
 *
 * E `de` NUNCA solto, que foi o segundo falso positivo da bateria: "o sistema
 * caiu DE NOVO" casava `caiu\s+de` e virava pergunta comparativa. O complemento
 * tem de ser uma MEDIDA (`caiu 3 pontos`, `caiu de 20% para 15%`) ou uma
 * REFERÊNCIA TEMPORAL (`caiu no mês`, `caiu desde`) — que são as duas formas em
 * que esses verbos de fato comparam.
 */
const COMPARATIVO =
  /* `ao?` e não `a`: o `\b` no fim da alternação não casa DENTRO de "ao" — a
     posição entre `a` e `o` não é fronteira de palavra. "em relação AO ano
     passado" (a forma que as pessoas escrevem) não era reconhecida; "em relação
     A 2024" era. Achado pela bateria C3. */
  /\b(compar\w+|versus|vs\.?|em\s+rela[çc][ãa]o\s+ao?|contra\s+(o\s+)?(m[êe]s|ano|semana|per[íi]odo)|melhor\s+que|pior\s+que|diferen[çc]a\s+entre)\b|\b(caiu|subiu|aumentou|diminuiu|cresceu|piorou|melhorou)\s+((de\s+|em\s+|para\s+)?\d|desde\b|contra\b|no\s+(m[êe]s|ano|trimestre|semestre)\b|na\s+semana\b)/;

const POPULACIONAL = /\b(quant[oa]s?|total\s+de|todos?\s+os|todas?\s+as|m[ée]dia\s+d[eoa]|percentual|propor[çc][ãa]o)\b/;

/** Pede DECISÃO — e é isto que separa relatório de recomendação. */
const DECISORIO =
  /\b(devo|devemos|deveria|vale\s+a\s+pena|recomend\w+|o\s+que\s+(eu\s+)?fa[çc]o|qual\s+(a\s+)?melhor|decid\w+|priori[zs]\w+|escolh\w+\s+entre)\b/;

/** Enquadramento executivo declarado pelo operador. */
const EXECUTIVO = /\b(diretoria|conselho|executiv\w+|ceo|s[óo]cios?|board|acionist\w+)\b/;

/** Dimensões que, cruzadas, tornam a pergunta multidimensional. */
const DIMENSOES: readonly { readonly nome: string; readonly re: RegExp }[] = [
  { nome: 'financeiro', re: /\b(margem|receita|faturamento|custo|lucro|pre[çc]o|pedagio|ped[áa]gio)\b/ },
  { nome: 'operacional', re: /\b(carga|cargas|rota|rotas|entrega|coleta|frota|ve[íi]culo)\b/ },
  { nome: 'pessoas', re: /\b(motorista|motoristas|equipe|time|funcion[áa]rio)\b/ },
  { nome: 'tempo', re: /\b(prazo|atraso|atrasad\w+|sla|pontualidade|lead\s?time)\b/ },
  { nome: 'cliente', re: /\b(cliente|clientes|reclama\w+|nps)\b/ },
  { nome: 'qualidade', re: /\b(avaria|avarias|sinistro|ocorr[êe]ncia|defeito|retrabalho)\b/ },
];

/* `normalizar` da casa (`servidor/nucleo/texto.ts`) — a MESMA que `Percepcao` e
   `ContratoFactual` usam. Uma segunda normalização aqui produziria o clássico
   deste kernel: duas regras que concordam hoje e divergem no dia em que uma
   delas ganhar um caso novo. */


export interface LeituraDoNivel extends ExigenciasDoNivel {
  /** As dimensões de negócio que a frase encostou. Vai para o dossiê. */
  readonly dimensoes: readonly string[];
  /** Marcadores que dispararam. Torna a escolha auditável, não mágica. */
  readonly marcadores: readonly string[];
}

/**
 * Escolhe o nível.
 *
 * A ORDEM É A POLÍTICA e ela desce do mais exigente para o menos: uma pergunta
 * pode ser causal E comparativa E populacional ao mesmo tempo ("por que a
 * margem caiu contra o ano passado?"), e o que vale é o degrau mais alto que
 * ela pede. Testar do menor para o maior faria a primeira regra que casasse
 * vencer, e a mais barata casa quase sempre.
 */
export function escolherNivel(pergunta: string): LeituraDoNivel {
  const t = normalizar(pergunta);
  const marcadores: string[] = [];

  /* A interrogação é lida do texto NORMALIZADO — `normalizar` mexe em acento,
     caixa e espaço, e preserva a pontuação. */
  const interrogativa = t.includes('?');
  const comparativo = COMPARATIVO.test(t);
  const populacional = POPULACIONAL.test(t);
  const decisorio = DECISORIO.test(t);
  const executivo = EXECUTIVO.test(t);

  if (comparativo) marcadores.push('comparativo');
  if (populacional) marcadores.push('populacional');
  if (decisorio) marcadores.push('decisorio');
  if (executivo) marcadores.push('executivo');

  const dimensoes = DIMENSOES.filter((d) => d.re.test(t)).map((d) => d.nome);

  /**
   * O CAUSAL SÓ PODE SER DECIDIDO DEPOIS DAS DIMENSÕES.
   *
   * Duas das três formas dependem de a frase encostar num assunto de negócio:
   * "o que houve com X" e a abreviação `pq`/`porq` sem interrogação. As duas
   * são ambíguas sozinhas e inequívocas com o complemento — mesma lição de
   * `frota` e `lento` em `Percepcao.ts`, agora no eixo causal.
   */
  const temDimensao = dimensoes.length > 0;
  const causal =
    CAUSAL_EXPLICITO.test(t) ||
    (CAUSAL_DE_ESTADO.test(t) && temDimensao) ||
    (CAUSAL_INTERROGATIVO.test(t) &&
      (interrogativa || PEDE_EXPLICACAO.test(t) || temDimensao));

  if (causal) marcadores.unshift('causal');

  const base = ((): Nivel => {
    /* Executivo é ENQUADRAMENTO DECLARADO mais decisão. A palavra sozinha não
       basta: "manda isso pro pessoal da diretoria" é recado, não análise. */
    if (executivo && decisorio) return 'executiva';
    if (causal) return 'estrategica';
    if (dimensoes.length >= 3) return 'multidimensional';
    if (comparativo || decisorio) return 'gerencial';
    if (dimensoes.length >= 1 && populacional) return 'operacional';
    if (populacional || dimensoes.length >= 1) return 'consulta';
    return 'direta';
  })();

  const exigencias = EXIGENCIAS[base];

  /**
   * O DECISÓRIO SOBE UM DEGRAU, mas nunca cria uma exigência causal sozinho.
   *
   * "Devo priorizar a rota X?" pede recomendação e comparação — não pede que a
   * IARA explique a causa de nada. Promover para `estrategica` faria toda
   * pergunta de decisão nascer com `tipo_pretendido: 'causal'`, e `R9` a
   * rebaixaria em 100% dos casos: a ressalva de causa apareceria em perguntas
   * que nunca falaram de causa. Ressalva que sempre aparece deixa de ser lida.
   */
  const exigeRecomendacao = exigencias.exige_recomendacao || decisorio;

  return {
    ...exigencias,
    exige_recomendacao: exigeRecomendacao,
    dimensoes,
    marcadores,
  };
}
