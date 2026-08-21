/**
 * COMPREENSÃO SEMÂNTICA — o significado vira estrutura ANTES de escolher rota.
 *
 * ===========================================================================
 * O DEFEITO ESTRUTURAL QUE ESTA CAMADA EXISTE PARA FECHAR
 * ===========================================================================
 *
 * Até 21/08/2026 o sistema decidia rota misturando quatro coisas que não são a
 * mesma coisa:
 *
 *     objeto mencionado   ×   operação desejada
 *     forma sintática     ×   intenção comunicativa
 *
 * O arnês de invariância (`npm run invariancia`) mediu o preço da mistura:
 *
 *     « lista os arquivos da área de trabalho »  → objetivo `arquivos_criar`
 *     « quais arquivos estão nos documentos? »   → objetivo `cargas`
 *
 * Na primeira, o SUBSTANTIVO ("arquivo") decidiu sozinho e o VERBO ("lista")
 * foi jogado fora — literalmente, por projeto: o índice da
 * `DescobertaCapacidades` declara-se "de SUBSTANTIVOS de domínio" e o
 * `radical` descarta flexão verbal. Só que é no verbo que mora a diferença
 * entre ler e escrever no disco do operador.
 *
 * Esta camada não substitui a descoberta. Ela dá ao sistema as dimensões que
 * faltavam para INTERPRETAR o que ela encontra.
 *
 * ===========================================================================
 * POR QUE ISTO NÃO É "MAIS 145 REGEXES"
 * ===========================================================================
 *
 * A pergunta que separa esta camada do anti-padrão é uma só, e ela é
 * verificável — `testes/compreensao/aberto-fechado.test.ts` a faz rodar:
 *
 *     habilidade nova, ou formulação nova, obriga a editar este arquivo?
 *
 * Para o anti-padrão, sim: cada frase que a IARA não entendeu vira uma
 * alternativa a mais numa alternação. Aqui, não:
 *
 *   · a OPERAÇÃO de uma habilidade sai do `id` dela — `listar_arquivos` é
 *     leitura, `criar_arquivo` é criação — porque o CLAUDE.md deste repositório
 *     obriga todo id a ser `verbo_objeto` em português. Habilidade nova nasce
 *     classificada sem que ninguém escreva uma linha aqui;
 *   · o OBJETO sai do índice do catálogo (`tokensDeDominio`), que já nascia dos
 *     manifestos;
 *   · o PERÍODO sai de `interpretarPeriodo`, que já existia;
 *   · o ATO sai de traços GRAMATICAIS — interrogação, imperativo, negação,
 *     anáfora, particípio — que valem para qualquer frase do português,
 *     inclusive de habilidades que ainda não nasceram.
 *
 * O QUE SOBRA ESCRITO À MÃO, declarado sem eufemismo: o léxico verbal
 * (`LEXICO_VERBAL`). Ele mapeia radical de verbo → operação, e é a única parte
 * deste arquivo que um humano mantém. Ele cresce com o PORTUGUÊS, não com o
 * catálogo nem com o número de jeitos de pedir a mesma coisa — que é
 * exatamente a fronteira entre um léxico e a doença que este projeto persegue.
 * Sem embedding, alguma tabela de verbos é inevitável; o que se pode exigir
 * dela é que seja fechada, pequena e ortogonal ao produto. Esta é.
 *
 * ===========================================================================
 * O QUE ESTA CAMADA NÃO PODE FAZER
 * ===========================================================================
 *
 * Ela INTERPRETA. Não chama ferramenta, não executa habilidade, não escreve
 * arquivo, não agenda, não envia mensagem, não toca memória operacional, não
 * liga nem desliga nada. O módulo é PURO: sem I/O, sem relógio próprio (o
 * `agora` entra por parâmetro), sem rede. A frase que ele produz é sempre da
 * forma "acho que o operador quis dizer X" — autorização e execução seguem nas
 * camadas que já as tinham, intocadas.
 *
 * Isso não é só disciplina de projeto: é o que impede que uma interpretação
 * errada vire efeito. `testes/compreensao/interpretar-nao-executa.test.ts`
 * verifica a fronteira por grafo de importação, do mesmo jeito que
 * `fronteira-efeitos.test.ts` confina `execFile` ao `AgenteLocal`.
 *
 * ===========================================================================
 * A INCERTEZA SOBREVIVE
 * ===========================================================================
 *
 * `hipoteses` carrega mais de uma leitura quando mais de uma se sustenta, com
 * escore e evidência cada. Um sistema que responde "não sei entre A e B" numa
 * frase de fato ambígua vale mais que um que escolhe A errado — e a única forma
 * de ele poder dizer isso é a estrutura não ter jogado B fora antes.
 */

import { normalizar, corrigirTypos, ehInterrogativa } from '../texto';
import { interpretarPeriodo } from './PeriodoOperacional';
import type { Candidato, DescobertaCapacidades } from './DescobertaCapacidades';
import type { ManifestoHabilidade } from './Habilidade';
import type {
  ConceitoRecuperado,
  IndiceConceitual,
  OrigemDoConceito,
} from './IndiceConceitual';

// ---------------------------------------------------------------------------
// 1. O vocabulário do contrato
// ---------------------------------------------------------------------------

/**
 * O QUE A FRASE FAZ, socialmente — não o que ela pede.
 *
 * Separado de `operacao` de propósito, e o par « lista os arquivos » /
 * « quais arquivos existem? » mostra por quê: o ATO difere (uma manda, a outra
 * pergunta) e a OPERAÇÃO é a mesma (leitura). Um sistema que só tivesse uma das
 * duas dimensões teria de escolher entre tratá-las como iguais — perdendo a
 * diferença entre pedir e perguntar — ou como diferentes, perdendo que as duas
 * querem a mesma resposta.
 */
export type AtoComunicativo =
  | 'informar'
  | 'perguntar'
  | 'solicitar_acao'
  | 'cancelar'
  | 'confirmar'
  | 'negar'
  | 'corrigir'
  | 'continuar'
  | 'recapitular'
  | 'conversar'
  | 'ambigua';

/**
 * O QUE SE QUER FEITO com o objeto. Sai do verbo da frase, e do `id` da
 * habilidade — os dois pelo mesmo classificador, que é o que permite compará-los.
 */
export type Operacao =
  | 'leitura'
  | 'contagem'
  | 'analise'
  | 'criacao'
  | 'alteracao'
  | 'remocao'
  | 'envio'
  | 'execucao';

/** Para o que a resposta serve. Composto de `ato` + `operacao`, nunca digitado. */
export type Proposito = 'obter_informacao' | 'produzir_efeito' | 'revogar_efeito' | 'manter_conversa';

/**
 * O referente existe, foi mencionado, e NÃO dá para saber qual é sem o turno
 * anterior — « e aquele segundo? », « faz a mesma coisa pro outro ».
 *
 * Sentinela explícita em vez de `null` porque as duas situações são diferentes e
 * confundi-las é como se inventa contexto: `null` = a frase não fala de
 * referente nenhum; `desconhecido` = a frase DEPENDE de um e ele não está aqui.
 * Quem for resolver depois (contexto, memória, histórico) precisa saber que há
 * o que resolver.
 */
export const REFERENTE_DESCONHECIDO = 'desconhecido';

/**
 * O REFERENTE, COM AS DUAS METADES — o que foi dito e o que foi entendido.
 *
 * Até 21/08/2026 isto era uma string, e o arnês mediu o preço: « quantas
 * coletas essa semana? » e « quantas cargas essa semana? » saíam com referentes
 * DIFERENTES ("coleta" e "carga") sendo a mesma pergunta. Normalizar jogando
 * fora o literal seria trocar um defeito por outro — a auditoria precisa poder
 * ver o que o operador escreveu, e a decisão precisa do conceito.
 *
 * `alias_semantico` é o sinal de que houve tradução, e existe para que uma
 * revisão consiga achar rapidamente todas as vezes em que o sistema entendeu
 * uma palavra como outra.
 */
export interface Referente {
  /** O que o operador escreveu: `coletas`, `livre`, `caixa`. */
  readonly literal: string | null;
  /** O conceito canônico: `carga`, `disponibilidade`, `email`. */
  readonly conceito: string | null;
  readonly origem: OrigemDoConceito | 'anafora' | 'nenhum';
  readonly score: number;
  /** `true` quando literal e conceito diferem — houve normalização. */
  readonly alias_semantico: boolean;
  /** A frase DEPENDE de um antecedente que não está nela. */
  readonly pendente: boolean;
}

const SEM_REFERENTE: Referente = {
  literal: null,
  conceito: null,
  origem: 'nenhum',
  score: 0,
  alias_semantico: false,
  pendente: false,
};

export interface EvidenciaSemantica {
  /** `verbo`, `interrogacao`, `substantivo`, `periodo`, `anafora`, `catalogo`… */
  readonly fonte: string;
  /** O trecho da frase que produziu o sinal. */
  readonly trecho: string;
  /** O que ele determinou. */
  readonly conclusao: string;
}

export interface HipoteseSemantica {
  /** `id` de habilidade do catálogo. */
  readonly objetivo: string;
  readonly score: number;
  readonly evidencias: readonly string[];
  /** A operação que ESTA habilidade faz, lida do `id`. */
  readonly operacao: Operacao | null;
  /** `true` quando a operação da habilidade casa com a operação da frase. */
  readonly compativel: boolean;
}

export interface ContratoSemantico {
  /**
   * O QUE O OPERADOR ESCREVEU, intacto. A normalizacao nao pode apaga-lo: a
   * auditoria precisa poder ver a frase real, e a decisao precisa da corrigida.
   */
  readonly texto_original: string;
  /**
   * A frase depois da correcao de digitacao contra o vocabulario do catalogo —
   * ver . Igual ao original quando
   * nao havia o que corrigir, que e o caso comum.
   */
  readonly texto_normalizado: string;
  readonly ato: AtoComunicativo;
  /**
   * O QUE O OPERADOR QUER — em vocabulário de SIGNIFICADO, não de catálogo.
   *
   *     « estou livre amanhã? »  →  consultar_disponibilidade
   *
   * SEPARADO DE `objetivo` DE PROPÓSITO, e a distinção não é acadêmica. Até
   * 21/08/2026 o contrato tinha só `objetivo`, que era o `id` de uma habilidade
   * — ou seja, uma DECISÃO OPERACIONAL vestida de compreensão. O efeito era que
   * a métrica "a IARA entendeu?" descia toda vez que o catálogo não tinha a
   * ferramenta, misturando duas falhas que se consertam em lugares diferentes:
   *
   *     entendi errado          →  conserta na camada de compreensão
   *     não tenho a capacidade  →  conserta no catálogo
   *
   * Composto, nunca digitado: `<verbo da operação>_<conceito ou objeto>`. É por
   * isso que ele existe mesmo quando o catálogo não tem nada a oferecer — a
   * IARA pode entender perfeitamente um pedido que ela não sabe atender, e
   * dizer isso é melhor que fingir que não entendeu.
   */
  readonly objetivoSemantico: string | null;
  /**
   * A HABILIDADE mais provável, ou `null` quando nenhuma se sustenta.
   *
   * É a resposta operacional — "quem executa isto?" — e vem DEPOIS do
   * significado. Uma frase pode ter `objetivoSemantico` e não ter `objetivo`:
   * significa que a IARA entendeu e não tem ferramenta, que é uma lacuna de
   * capacidade e não de compreensão.
   */
  readonly objetivo: string | null;
  readonly operacao: Operacao | null;
  /** O substantivo de domínio de que a frase trata. */
  readonly objeto: string | null;
  /** `AAAA-MM-DD..AAAA-MM-DD`, ou `null` quando a frase não nomeia tempo. */
  readonly periodo: string | null;
  readonly proposito: Proposito | null;
  readonly referente: Referente;
  /**
   * Os conceitos que a frase invocou — ver `IndiceConceitual`.
   *
   * Eles RECUPERAM candidatos e não autorizam nada: a admissão exige, além do
   * conceito, compatibilidade de operação. « Estou livre amanhã? » recupera
   * `disponibilidade`, que alcança tanto ler a agenda quanto criar evento nela,
   * e é a operação que decide qual das duas sobrevive.
   */
  readonly conceitos: readonly ConceitoRecuperado[];
  /** Modificadores de agregação e comparação: `maximo`, `distinto`, `total`. */
  readonly atributos: readonly string[];
  /** O que restringe o universo da resposta: período, local, qualificador. */
  readonly restricoes: readonly string[];
  /** Todas as leituras que se sustentam, em ordem. Nunca só a vencedora. */
  readonly hipoteses: readonly HipoteseSemantica[];
  readonly evidencias: readonly EvidenciaSemantica[];
  /** Distância relativa entre a 1ª e a 2ª hipótese. Perto de 0 = disputa. */
  readonly margem: number;
}

// ---------------------------------------------------------------------------
// 2. O léxico verbal — a única parte mantida à mão
// ---------------------------------------------------------------------------

/**
 * RADICAL DE VERBO → OPERAÇÃO.
 *
 * A tabela é fechada e ortogonal ao produto: ela não conhece carga, lembrete
 * nem central, e nunca precisa conhecer. Habilidade nova não a toca; frase nova
 * não a toca. Só um verbo do português que ainda não esteja aqui a toca — e
 * esse é o critério que a mantém sendo um léxico em vez de uma lista de frases.
 *
 * ORDEM IMPORTA: o casamento é por radical mais longo primeiro, para `encerr`
 * não ser comido por `enc` e `contrat` não ser comido por `cont`.
 */
const LEXICO_VERBAL: ReadonlyArray<readonly [Operacao, readonly string[]]> = [
  /**
   * `ver` e `vej` entraram em 21/08/2026 por medição, não por revisão de
   * dicionário: `operacaoDaHabilidade('ver_agenda_calendario')` devolvia `null`,
   * e a trava de compatibilidade RECUSAVA a habilidade certa — a única leitura
   * de agenda do catálogo — porque não conseguia ler a operação dela. Uma trava
   * que não sabe classificar barra o inocente.
   *
   * `descrev` e `relat` pela mesma razão: `descrever_planilha` e
   * `relatorio_executivo_luft` são leituras e não eram legíveis como tal.
   */
  ['leitura', ['listar', 'list', 'mostr', 'exib', 'consult', 'verific', 'confer', 'checar', 'olh', 'le', 'ler', 'lei', 'ver', 'vej', 'descrev', 'relat', 'busc', 'procur', 'acompanh', 'saber', 'sab', 'ter', 'tenh', 'tem', 'hav']],
  ['contagem', ['cont', 'som', 'totaliz', 'quantific']],
  ['analise', ['analis', 'investig', 'diagnostic', 'audit', 'compar', 'avali', 'entend', 'explic', 'declar']],
  ['criacao', ['cri', 'ger', 'faz', 'fiz', 'mont', 'agend', 'marc', 'salv', 'lembr', 'anot', 'registr', 'abr']],
  ['alteracao', ['renome', 'mov', 'lev', 'copi', 'atualiz', 'alter', 'troc', 'edit', 'ajust', 'corrig']],
  ['remocao', ['cancel', 'remov', 'apag', 'exclu', 'delet', 'encerr', 'fech', 'par', 'desfaz', 'esquec', 'desconsider']],
  ['envio', ['envi', 'mand', 'avis', 'encaminh', 'repass', 'comunic', 'respond']],
  /**
   * `recus`, `resolv`, `assum` e `declar` entraram por medição: o teste de
   * contrato do catálogo (`conceitos.test.ts`) mostrou que `recusar_por_sigilo`,
   * `resolver_confirmacao`, `assumir_plano` e `declarar_lacuna_de_dado` não
   * tinham operação legível — e habilidade que a trava não classifica é
   * habilidade que a trava recusa.
   */
  /**
   * `rod` SAIU em 21/08/2026, e a remoção é uma decisão de DOMÍNIO.
   *
   * Ele entrou pensando em "roda o script". Numa transportadora, "rodar" quer
   * dizer DIRIGIR — e « qual motorista mais rodou? » saía com `operacao:
   * execucao` e ia parar em `pesquisar_web`, uma pergunta sobre a operação
   * respondida pela internet.
   *
   * Nenhuma habilidade do catálogo se chama `rodar_*`, então o custo é nulo; o
   * ganho é uma pergunta central da operação parar de ser roteada para fora de
   * casa. A régua: o léxico não pode reivindicar um verbo cujo sentido dominante
   * NESTE domínio é outro.
   */
  ['execucao', ['execut', 'acion', 'captur', 'extra', 'tir', 'desli', 'reinici', 'suspend', 'instal', 'pesquis', 'recus', 'resolv', 'assum']],
];

/**
 * TERMINAÇÕES VERBAIS DO PORTUGUÊS. Fechada e mecânica: é o que transforma
 * ~70 radicais escritos à mão em milhares de formas reconhecidas, sem que
 * ninguém precise escrever "lista", "listar", "liste", "listando" um por um.
 *
 * O particípio (`ado`, `ido` e flexões) está aqui e é tratado à parte em
 * `verboDaFrase` — ver a regra da voz passiva.
 */
const TERMINACOES = [
  '', 'a', 'e', 'o', 'i', 'r', 'ar', 'er', 'ir', 'am', 'em', 'ou', 'ei', 'eu', 'iu',
  'as', 'es', 'os', 'amos', 'emos', 'imos', 'ava', 'avam', 'ia', 'iam',
  'ando', 'endo', 'indo', 'asse', 'esse', 'isse', 'aria', 'eria', 'iria',
  'ue', 'ues', 'uem', 'ado', 'ido', 'ada', 'ida', 'ados', 'idos', 'adas', 'idas',
];

const PARTICIPIOS = new Set(['ado', 'ido', 'ada', 'ida', 'ados', 'idos', 'adas', 'idas']);

/** Radicais ordenados do mais longo para o mais curto — ver `LEXICO_VERBAL`. */
const RADICAIS: ReadonlyArray<readonly [string, Operacao]> = LEXICO_VERBAL.flatMap(
  ([op, radicais]) => radicais.map((r) => [r, op] as const),
).sort((a, b) => b[0].length - a[0].length);

interface VerboReconhecido {
  readonly forma: string;
  readonly operacao: Operacao;
  readonly participio: boolean;
  readonly posicao: number;
}

function classificarForma(forma: string): { operacao: Operacao; participio: boolean } | null {
  for (const [radical, operacao] of RADICAIS) {
    if (!forma.startsWith(radical)) continue;
    const cauda = forma.slice(radical.length);
    if (!TERMINACOES.includes(cauda)) continue;
    return { operacao, participio: PARTICIPIOS.has(cauda) };
  }
  return null;
}

/**
 * A REGRA DA VOZ PASSIVA, e ela é a diferença entre uma pergunta e um efeito.
 *
 *     « esse arquivo foi criado quando? »
 *
 * tem "criado" — radical de criação — e NÃO pede criação nenhuma: pergunta
 * sobre um estado. Tratar o particípio como operação pedida é o mesmo defeito
 * que fazia « esse lembrete das 11h foi criado quando? » compilar para
 * `agendar_lembrete` e enfiar um item na agenda de quem só perguntou.
 *
 * A regra é gramatical, não lexical: particípio precedido de auxiliar (`foi`,
 * `está`, `era`, `fica`) descreve estado; particípio numa interrogativa também.
 * Nos dois casos ele fica registrado como evidência e NÃO define a operação.
 */
const AUXILIAR_PASSIVO = /\b(foi|fora|for|sao|eram|era|esta|estao|estava|estavam|fica|ficou|sera|serao|ser)\s*$/;

/**
 * DETERMINANTES — artigo, possessivo, demonstrativo e as contrações deles.
 *
 * Classe fechada do português, e o que ela resolve é uma ambiguidade real:
 * « agenda » é ao mesmo tempo o imperativo de *agendar* e o substantivo. O
 * léxico verbal reconhece a forma e não sabe qual das duas é.
 *
 *     « agenda uma consulta sexta »     → verbo    (abre a oração)
 *     « como está minha agenda amanhã? » → substantivo (vem depois de possessivo)
 *
 * Sem esta regra, a segunda saía com `operacao: criacao` — uma PERGUNTA sobre a
 * agenda classificada como pedido para escrever nela, que é a classe de defeito
 * mais cara deste pipeline. A régua é gramatical e vale para qualquer palavra
 * que um dia seja verbo e substantivo ao mesmo tempo, não só para "agenda".
 */
const DETERMINANTES = new Set([
  'o', 'a', 'os', 'as', 'um', 'uma', 'uns', 'umas',
  'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas',
  'este', 'esta', 'esse', 'essa', 'aquele', 'aquela', 'nosso', 'nossa',
  'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'ao', 'aos', 'pelo', 'pela',
]);

/**
 * PREPOSIÇÕES E CONJUNÇÕES — classe fechada que NUNCA é verbo.
 *
 * O DEFEITO MEDIDO (Arnês C): « qual a previsão PARA hoje? » saía com
 * `operacao: remocao`. O radical `par` do verbo *parar* casa com a preposição
 * *para*, e uma consulta de clima passava a ser lida como pedido de parada.
 *
 * A ambiguidade é real em português — « para o computador » é uma ordem — e a
 * escolha aqui é declarada: a preposição é ordens de grandeza mais frequente, e
 * o dano de ler consulta como remoção é muito pior que o de perder uma ordem
 * de parada, que continua alcançável por `pare` e `parar`.
 */
const PREPOSICOES = new Set([
  'para', 'por', 'com', 'sem', 'sobre', 'entre', 'ate', 'desde', 'apos', 'contra',
  'durante', 'perante', 'conforme', 'segundo', 'mediante', 'que', 'como', 'quando',
]);

/**
 * NEGAÇÃO PRÓXIMA — « não me deixe esquecer » não é um pedido de esquecer.
 *
 * O DEFEITO MEDIDO: a frase saía com `operacao: remocao` por causa de
 * "esquecer", e ela pede exatamente o CONTRÁRIO — criar um lembrete. Um verbo
 * sob negação não diz o que se quer; diz o que NÃO se quer, e disso não se
 * deduz a operação pedida.
 *
 * É a mesma família da regra do particípio: traço gramatical que DESQUALIFICA o
 * verbo como fonte da operação, em vez de inverter o significado dele — inverter
 * seria adivinhar.
 */
const NEGACAO_PROXIMA = /\b(nao|nunca|jamais|nem)\b/;

function verbosDaFrase(t: string, interrogativa: boolean): readonly VerboReconhecido[] {
  /**
   * A LEITURA É ORAÇÃO A ORAÇÃO, e a pontuação marca as fronteiras.
   *
   * Existe por causa do veto de negação: o alcance de um "não" termina onde a
   * oração termina. As palavras seguem numa lista única — as posições precisam
   * ser comparáveis com as do resto da frase — e `inicios` guarda onde cada
   * oração começa.
   */
  const palavras: string[] = [];
  const inicios = new Set<number>();
  for (const oracao of t.split(/[,;.!?]+/)) {
    inicios.add(palavras.length);
    for (const p of oracao.split(/[^a-z0-9]+/).filter(Boolean)) palavras.push(p);
  }

  const achados: VerboReconhecido[] = [];
  for (let i = 0; i < palavras.length; i += 1) {
    const c = classificarForma(palavras[i]);
    if (!c) continue;
    // Preposição não é verbo, por mais que o radical case. Ver `PREPOSICOES`.
    if (PREPOSICOES.has(palavras[i])) continue;
    // Precedido de determinante é substantivo, não verbo. Ver `DETERMINANTES`.
    if (i > 0 && DETERMINANTES.has(palavras[i - 1])) continue;
    /**
     * Sob negação DA MESMA ORAÇÃO, o verbo não é fonte da operação.
     *
     * O alcance para trás para na fronteira de oração — ver `inicios`. Sem
     * isso, « não, cancela isso » perdia o verbo: o "não" ali é MARCADOR DE
     * DISCURSO e não nega nada, ao contrário de « não me deixe esquecer ». As
     * duas frases têm as mesmas palavras na mesma ordem, e o que as separa é a
     * vírgula.
     */
    let inicioDaOracao = i;
    while (inicioDaOracao > 0 && !inicios.has(inicioDaOracao)) inicioDaOracao -= 1;
    const anteriores = palavras.slice(Math.max(inicioDaOracao, i - 3), i).join(' ');
    if (NEGACAO_PROXIMA.test(anteriores)) continue;
    const antes = palavras.slice(Math.max(0, i - 2), i).join(' ');
    const passivo = c.participio && (interrogativa || AUXILIAR_PASSIVO.test(`${antes} `.trim()));
    achados.push({
      forma: palavras[i],
      operacao: c.operacao,
      participio: c.participio || passivo,
      posicao: i,
    });
  }
  return achados;
}

/**
 * A OPERAÇÃO DA HABILIDADE SAI DO `id` DELA.
 *
 * O CLAUDE.md deste repositório obriga: *"Verbo + objeto, em português:
 * `consultar_clima`, `buscar_historico`"*. Isso é um invariante declarado do
 * projeto, verificado por `testes/habilidades.test.ts` — e é o que faz esta
 * função ser aberto/fechada de verdade. Habilidade nova nasce classificada.
 *
 * `null` para o punhado de ids que não começam por verbo (`informacoes_sistema`):
 * a ausência é declarada, e uma habilidade sem operação legível simplesmente não
 * ganha nem perde pontos na compatibilidade — nunca é penalizada por um palpite.
 */
export function operacaoDaHabilidade(id: string): Operacao | null {
  return classificarForma(id.split('_')[0])?.operacao ?? null;
}

/**
 * A OPERAÇÃO DE UMA HABILIDADE — declarada primeiro, inferida depois.
 *
 * O DEFEITO (Arnês C): `informacoes_sistema` começa por substantivo, a
 * inferência devolvia `null`, e a trava de compatibilidade RECUSAVA a
 * habilidade por não conseguir classificá-la. Uma trava que não sabe
 * classificar barra o inocente.
 *
 * A INFERÊNCIA CONTINUA, e continua sendo útil: 45 das 47 habilidades têm `id`
 * honesto e não precisam declarar nada. Mas ela é o PADRÃO, não a verdade — no
 * dia em que o nome e o comportamento divergirem, quem manda é a declaração.
 * Mesma disciplina de `risco`, `idempotencia` e `conceitos`.
 */
export function operacaoDoManifesto(m: ManifestoHabilidade): Operacao | null {
  return (m.operacao_semantica as Operacao | undefined) ?? operacaoDaHabilidade(m.id);
}

/** O objeto do `id`: `listar_arquivos` → `arquivos`. Vazio quando não há. */
function objetoDaHabilidade(id: string): string {
  return id.split('_').slice(1).join(' ');
}

// ---------------------------------------------------------------------------
// 3. Traços gramaticais — valem para qualquer frase, não para uma lista delas
// ---------------------------------------------------------------------------

/** Quantificador interrogativo: a pergunta pede um NÚMERO. */
const QUANTIFICADOR = /\b(quantos?|quantas?|numero de|quantidade de|total de)\b/;
/** Interrogativo que pede enumeração ou identificação — logo, leitura. */
const INTERROGATIVO_DE_LEITURA = /\b(quais|qual|o que|onde|quem|quando|como esta|como estao)\b/;
/** Marca de referência a algo dito antes, sem nomear. */
const ANAFORA = /\b(esse|essa|esses|essas|este|esta|aquele|aquela|aqueles|aquelas|isso|isto|aquilo|o mesmo|a mesma|o outro|a outra|dele|dela|segundo|primeiro)\b/;
/** Frase que só existe para desfazer o que veio antes. Ver `Ambiguidade.ts`. */
const REVOGACAO = /\b(na verdade nao|deixa pra la|deixa quieto|esquece|cancela|cancelar|melhor nao|nao precisa mais|desconsidera|para com isso)\b/;
const CONFIRMACAO = /^(sim|confirmo|confirma|confirmado|isso|isso mesmo|pode|pode sim|autorizo|ok|beleza|exato|certo)\b/;
const NEGACAO_PURA = /^(nao|nao precisa|melhor nao|negativo|nem|de jeito nenhum)\b\s*$/;
const CORRECAO = /\b(na verdade|quis dizer|era pra ser|me enganei|corrigindo|nao e isso)\b/;
/** Elipse: a frase continua a anterior em vez de começar uma nova. */
const CONTINUACAO = /^(e|ja|entao|mas|tambem|agora)\b\s+/;
const SAUDACAO = /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|tudo bem|obrigad|valeu|ate mais|ate logo)\b/;
/** A frase fala DA IARA ou DO OPERADOR, não de um objeto da operação. */
const SOBRE_OS_INTERLOCUTORES = /\b(voce|tu|contigo|com voce|comigo|a gente|nos dois)\b/;
/** Marcadores de que o assunto é o próprio diálogo — base de `recapitular`. */
const SOBRE_O_DIALOGO = /\b(marquei com voce|combinamos|combinei|te pedi|voce disse|falamos|conversamos|voce me disse|a gente combinou)\b/;

/**
 * CLASSE GRAMATICAL FECHADA — pronomes, demonstrativos, ordinais, indefinidos.
 *
 * Estas palavras estão no índice do catálogo (aparecem nos manifestos e nos
 * exemplos) e NUNCA são o objeto de que a frase trata. Sem esta exclusão,
 * « como você está? » produzia `objeto: "voce"`, e um objeto qualquer bastava
 * para o ato virar `perguntar` em vez de `conversar` — que é exatamente o caso
 * que `testes/decisao.test.ts:287` já reprovava numa tentativa anterior.
 *
 * Como o léxico verbal, esta lista é FECHADA e ortogonal ao produto: o
 * português não ganha pronome novo, e habilidade nova não a toca.
 */
const GRAMATICAIS_DECLARADAS = [
  'voce', 'voces', 'tudo', 'nada', 'algo', 'alguem', 'ninguem', 'isso', 'isto', 'aquilo',
  'esse', 'essa', 'esses', 'essas', 'este', 'esta', 'estes', 'estas',
  'aquele', 'aquela', 'aqueles', 'aquelas', 'mesmo', 'mesma', 'mesmos', 'mesmas',
  'outro', 'outra', 'outros', 'outras', 'primeiro', 'primeira', 'segundo', 'segunda',
  'terceiro', 'ultimo', 'ultima', 'qual', 'quais', 'quem', 'onde', 'quando', 'quanto',
  'quanta', 'quantos', 'quantas', 'algum', 'alguma', 'alguns', 'algumas', 'nenhum',
  'nenhuma', 'meu', 'minha', 'meus', 'minhas', 'seu', 'sua', 'seus', 'suas', 'dele', 'dela',
  /**
   * PRÓ-FORMAS GENÉRICAS. « faz a mesma COISA pro outro » não é sobre coisas —
   * "coisa" ocupa o lugar do objeto sem nomeá-lo, igual a "isso". Sem esta
   * entrada, o referente da frase virava `coisa` e a camada afirmava saber
   * sobre o que era a frase, que é o oposto do que ela sabe.
   */
  'coisa', 'coisas', 'jeito', 'negocio', 'troco', 'lance',
];

/**
 * O ÍNDICE ENTREGA O TOKEN JÁ RADICALIZADO, e a lista acima está em português
 * inteiro. Sem esta expansão, « quais arquivos existem? » produzia
 * `objeto: "quai"` — o radical de "quais", que não casa com nenhuma entrada — e
 * o pronome interrogativo virava o assunto da frase.
 *
 * A regra replicada é a mesma de `radical` na `DescobertaCapacidades`: plural
 * simples acima de quatro letras. Duas cópias de uma regra divergem, e esta
 * está aqui declarada como cópia justamente para o dia em que divergir.
 */
const PALAVRAS_GRAMATICAIS = new Set(
  GRAMATICAIS_DECLARADAS.flatMap((p) =>
    p.length > 4 && p.endsWith('s') ? [p, p.slice(0, -1)] : [p],
  ),
);

/** Agregação e comparação. Fechado e linguístico — não conhece domínio. */
const ATRIBUTOS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b(mais|maior|maiores|top|melhor|campeao)\b/, 'maximo'],
  [/\b(menos|menor|menores|pior)\b/, 'minimo'],
  [/\b(distintos?|distintas?|diferentes?|unicos?|unicas?)\b/, 'distinto'],
  [/\b(total|totais|somando|no total)\b/, 'total'],
  [/\b(medi[ao]|media|em media)\b/, 'media'],
  [/\bpor\s+[a-z]{3,}\b/, 'agrupado'],
  [/\b(cada|todos|todas)\b/, 'exaustivo'],
];

// ---------------------------------------------------------------------------
// 4. A interpretação
// ---------------------------------------------------------------------------

export interface EntradaDeCompreensao {
  readonly bruto: string;
  /** O índice do catálogo. Fonte do objeto e das hipóteses. */
  readonly descoberta: DescobertaCapacidades;
  /**
   * OS MANIFESTOS do catálogo — não os ids.
   *
   * Passou a ser o manifesto inteiro em 21/08/2026 porque a operação de uma
   * habilidade deixou de ser inferida do `id` e passou a poder ser DECLARADA
   * (`operacao_semantica`). Um id não carrega o que a habilidade faz; o
   * manifesto sim.
   */
  readonly habilidades: readonly ManifestoHabilidade[];
  /** Injetado, nunca lido do relógio — o módulo é puro e testável 100×. */
  readonly agora: Date;
  /**
   * O índice de conceitos do catálogo — ver `IndiceConceitual`. OPCIONAL: sem
   * ele a camada funciona exatamente como antes desta fase, o que mantém os
   * testes das etapas anteriores medindo o que mediam.
   */
  readonly conceitual?: IndiceConceitual;
  /**
   * Conceitos que um recuperador EXTERNO propôs — a porta do embedding.
   *
   * Chegam prontos, de fora, porque o núcleo desta camada é síncrono e puro:
   * fazer a interpretação inteira depender de uma chamada de rede trocaria a
   * variância que estas fases mataram por outra. Quem tiver um recuperador roda
   * `RecuperadorDeConceitos.recuperar()` antes e injeta o resultado aqui.
   *
   * ELES NÃO GANHAM PODER NENHUM POR ESTAREM AQUI. Passam pela mesma trava de
   * compatibilidade de operação que os declarados — ver `admitirPorConceito`.
   */
  readonly conceitosRecuperados?: readonly {
    readonly conceito: string;
    readonly literal: string;
    readonly score: number;
  }[];
}

/** Habilidade cuja operação bate com a da frase vale mais; a que não bate, menos. */
const BONUS_OPERACAO = 1.6;
const PENALIDADE_OPERACAO = 0.35;
/** Habilidade cujo `id` nomeia o objeto da frase vale mais. */
const BONUS_OBJETO = 1.5;
/**
 * Peso de uma hipótese admitida por ESTRUTURA em vez de por léxico — ver
 * `admitirPorEstrutura`. Fica abaixo de uma coincidência lexical forte de
 * propósito: evidência estrutural é boa, mas duas palavras raras do manifesto
 * continuam sendo evidência melhor.
 */
const BASE_ESTRUTURAL = 1.4;
/**
 * Peso de uma hipotese admitida por CONCEITO recuperado. Fica acima da
 * estrutural porque o conceito e declarado pela habilidade — ela afirmou
 * atender aquilo — e abaixo de uma coincidencia lexical forte.
 */
const BASE_CONCEITUAL = 2.2;
/**
 * A habilidade DECLAROU atender o conceito da frase. Ver .
 */
const BONUS_CONCEITO_DECLARADO = 2;
/** Hipótese que não cita o objeto da frase — casou com a forma, não com o assunto. */
const PENALIDADE_OBJETO_AUSENTE = 0.15;

/**
 * LER, CONTAR e ANALISAR não mudam nada — e essa é a fronteira que importa.
 *
 * A compatibilidade entre a operação da frase e a da habilidade não pode ser
 * igualdade estrita: « quantas cargas essa semana? » pede `contagem`, e a
 * habilidade que responde é `consultar_cargas_luft`, que o `id` classifica como
 * `leitura`. Exigir igualdade penalizaria toda pergunta de cardinalidade da
 * operação contra a habilidade que existe para respondê-la.
 *
 * O que NÃO se afrouxa é a travessia leitura↔escrita: `criacao`, `alteracao`,
 * `remocao`, `envio` e `execucao` só casam consigo mesmas. É essa metade que
 * impede « lista os arquivos » de alcançar `criar_arquivo`, e ela é a razão de
 * toda esta camada existir.
 */
const FAMILIA_LEITURA = new Set<Operacao>(['leitura', 'contagem', 'analise']);

function operacoesCompativeis(daFrase: Operacao, daHabilidade: Operacao): boolean {
  if (daFrase === daHabilidade) return true;
  return FAMILIA_LEITURA.has(daFrase) && FAMILIA_LEITURA.has(daHabilidade);
}

export function compreender(entrada: EntradaDeCompreensao): ContratoSemantico {
  const { bruto, descoberta, agora, habilidades } = entrada;
  const operacaoPorId = new Map(habilidades.map((m) => [m.id, operacaoDoManifesto(m)] as const));
  const evidencias: EvidenciaSemantica[] = [];
  const anota = (fonte: string, trecho: string, conclusao: string) =>
    evidencias.push({ fonte, trecho, conclusao });

  /**
   * `corrigirTypos` roda AQUI e não dentro da descoberta de propósito: ele
   * corrige o texto usado para RECONHECER, e o texto usado para EXTRAIR o que o
   * operador escreveu continua sendo `bruto`. Ver o cabeçalho da função.
   */
  const t = corrigirTypos(normalizar(bruto));
  const interrogativa = ehInterrogativa(bruto);

  // --- Traços -------------------------------------------------------------
  const verbos = verbosDaFrase(t, interrogativa);
  const acionaveis = verbos.filter((v) => !v.participio);
  /**
   * O OBJETO É O SUBSTANTIVO QUE O VERBO REGE — posição, não raridade.
   *
   * A primeira versão escolhia o token mais ESPECÍFICO do índice, e errava por
   * um motivo instrutivo: em « lista os arquivos da área de trabalho », "area"
   * é mais rara no catálogo que "arquivo", então o objeto virava a LOCALIZAÇÃO
   * e o objeto de verdade caía para restrição. Raridade mede quanto um token
   * discrimina habilidades; ela não sabe nada sobre quem é objeto de quem.
   *
   * Em português o objeto direto vem depois do verbo. A regra é essa, com o
   * primeiro substantivo da frase como recurso quando não há verbo — « esse
   * arquivo foi criado quando? » não tem verbo acionável e ainda assim é sobre
   * arquivo. O que sobra vira `restricoes`, que é o que "da área de trabalho"
   * de fato é.
   */
  /**
   * MARCADOR DE AGREGAÇÃO NÃO É OBJETO — são papéis diferentes na mesma frase.
   *
   * « qual o TOTAL de cargas dessa semana? » produzia `objeto: "total"`, porque
   * "total" está nos manifestos e vem antes de "cargas". Mas "total" já é lido
   * como ATRIBUTO logo abaixo: é o modificador da contagem, não a coisa
   * contada. Deixá-lo concorrer a objeto é a mistura de dimensões que esta
   * camada veio desfazer, reaparecendo dentro dela.
   */
  const deAtributo = new Set(
    ATRIBUTOS.flatMap(([re]) => (t.match(re) ?? []).flatMap((m) => m.split(/\s+/))),
  );

  /**
   * VERBO E SUBSTANTIVO SÃO DECIDIDOS UMA VEZ SÓ.
   *
   * A primeira versão perguntava duas coisas diferentes em dois lugares:
   * `verbosDaFrase` decidia por POSIÇÃO (é verbo se não vem depois de
   * determinante), e este filtro decidia por FORMA (é verbo se o léxico
   * reconhece a flexão). Em « como está minha agenda amanhã? » as duas
   * discordavam: a primeira dizia "agenda é substantivo aqui", a segunda a
   * excluía dos substantivos assim mesmo — e a frase ficava sem objeto nenhum.
   *
   * Duas regras para a mesma pergunta divergem sempre; a única correção estável
   * é haver uma. Quem é verbo já foi decidido acima, com a posição na mão.
   */
  const posicoesDeVerbo = new Set(verbos.map((v) => v.posicao));
  const substantivos = descoberta
    .tokensDeDominio(bruto)
    .filter(
      (x) =>
        !posicoesDeVerbo.has(x.posicao) &&
        !PALAVRAS_GRAMATICAIS.has(x.token) &&
        !deAtributo.has(x.token),
    );
  const depoisDoVerbo =
    acionaveis.length > 0 ? substantivos.filter((x) => x.posicao > acionaveis[0].posicao) : [];
  const regido = depoisDoVerbo[0] ?? substantivos[0] ?? null;
  const objeto = regido?.token ?? null;

  const p = interpretarPeriodo(bruto, agora);
  const periodo = p ? `${p.inicio}..${p.fim}` : null;
  if (p) anota('periodo', p.rotulo, `janela ${periodo}`);
  if (regido) anota('substantivo', regido.token, `objeto regido pelo verbo (em ${regido.habilidades} habilidade[s])`);

  // --- Operação -----------------------------------------------------------
  let operacao: Operacao | null = null;
  if (acionaveis.length > 0) {
    /** O verbo mais à esquerda manda: é o núcleo do pedido em português. */
    const nucleo = acionaveis[0];
    operacao = nucleo.operacao;
    anota('verbo', nucleo.forma, `operação ${operacao}`);
  }
  for (const v of verbos) {
    if (v.participio) anota('participio', v.forma, 'estado descrito, não operação pedida');
  }
  if (QUANTIFICADOR.test(t)) {
    /**
     * O quantificador VENCE o verbo: « quantas cargas foram coletadas? » tem
     * "coletadas" (particípio, já descartado) e pede uma CONTAGEM, que nenhum
     * verbo da frase carrega. É a pergunta que define a operação, não o resto.
     */
    operacao = 'contagem';
    anota('interrogacao', t.match(QUANTIFICADOR)![0], 'operação contagem');
  } else if (operacao === null && interrogativa && INTERROGATIVO_DE_LEITURA.test(t)) {
    operacao = 'leitura';
    anota('interrogacao', t.match(INTERROGATIVO_DE_LEITURA)![0], 'operação leitura');
  }

  // --- Conceitos ----------------------------------------------------------
  /**
   * A RECUPERAÇÃO ACONTECE AQUI E NÃO DECIDE NADA AQUI.
   *
   * Os conceitos declarados no catálogo e os que um recuperador externo tenha
   * proposto entram na MESMA lista, distinguidos por `origem`. O que eles fazem
   * é dizer de que a frase fala; quem pode ser chamado por causa disso é
   * decidido depois, com a operação na mão.
   */
  /**
   * O ÍNDICE CONCEITUAL LÊ O MESMO TEXTO QUE A DESCOBERTA — e não lia.
   *
   * Defeito medido pelo Arnês C: « vai chove hoje » era normalizada para « vai
   * chover hoje » pela descoberta, e o índice conceitual recebia o texto BRUTO.
   * O conceito `clima` existia, estava declarado, e não era recuperado porque
   * os dois componentes liam strings diferentes da mesma frase.
   *
   * É a mesma classe de defeito que já apareceu duas vezes nesta camada: duas
   * peças perguntando a mesma coisa sobre entradas diferentes divergem sempre.
   */
  const paraConceito = descoberta.normalizarConsulta(bruto);
  const declarados = entrada.conceitual?.recuperar(paraConceito) ?? [];
  const conceitos = entrada.conceitual
    ? entrada.conceitual.mesclar(declarados, entrada.conceitosRecuperados ?? [])
    : declarados;
  for (const c of conceitos) {
    anota('conceito', c.literal, `conceito ${c.conceito} (${c.origem}, ${c.score.toFixed(2)})`);
  }

  // --- Ato comunicativo ---------------------------------------------------
  const ato = decidirAto({ t, bruto, interrogativa, operacao, objeto, periodo, acionaveis, conceitos, anota });

  /**
   * PERGUNTA PEDE LEITURA — e este passo vem DEPOIS do ato de propósito.
   *
   * « Estou livre amanhã? » não tem verbo acionável, não tem quantificador e
   * não abre com interrogativo de enumeração; a operação saía `null`, e sem
   * operação a trava estrutural não tem o que comparar — `disponibilidade`
   * alcançaria tanto ler a agenda quanto CRIAR evento nela, e a frase de quem
   * só perguntou poderia virar um compromisso.
   *
   * A ORDEM É O QUE TORNA ISTO SEGURO. Se a operação fosse preenchida antes de
   * `decidirAto`, toda interrogativa passaria a ter conteúdo e « como você
   * está? » deixaria de ser conversa — o caso que `decisao.test.ts:287` reprova.
   * O ato é decidido só com sinais explícitos; a leitura é derivada dele.
   */
  if (operacao === null && (ato === 'perguntar' || ato === 'recapitular')) {
    operacao = 'leitura';
    anota('ato', ato, 'pergunta sem verbo de ação pede leitura');
  }

  // --- Referente ----------------------------------------------------------
  /**
   * O REFERENTE TEM DUAS METADES: o que foi escrito e o que foi entendido.
   *
   * O conceito que o índice recuperou para a palavra do objeto normaliza
   * « coletas » e « cargas » no mesmo referente `carga`, sem apagar qual das
   * duas o operador digitou. Sem conceito, literal e conceito coincidem — e
   * `alias_semantico` fica falso, que é a leitura correta.
   *
   * NÃO INVENTAR CONTEXTO: anáfora sem objeto nomeado fica `pendente`, que é
   * diferente de ausente e diferente de um palpite.
   */
  const anafora = t.match(ANAFORA);
  const doObjeto = objeto ? conceitos.find((c) => c.literal === objeto) : undefined;
  let referente: Referente = SEM_REFERENTE;

  if (objeto) {
    const conceito = doObjeto?.conceito ?? objeto;
    referente = {
      literal: objeto,
      conceito,
      origem: doObjeto?.origem ?? 'literal',
      score: doObjeto?.score ?? 1,
      alias_semantico: conceito !== objeto,
      pendente: false,
    };
    if (referente.alias_semantico) {
      anota('normalizacao', objeto, `referente normalizado para ${conceito}`);
    }
  } else if (conceitos.length > 0) {
    /**
     * O CONCEITO É O REFERENTE QUANDO NÃO HÁ OBJETO LÉXICO.
     *
     * « amanhã estou ocupado? » e « me mostra as vistorias » invocam um conceito
     * declarado e não têm substantivo no índice de assunto — "ocupado" e
     * "vistoria" não aparecem em descrição nenhuma. O referente ficava vazio, e
     * a frase saía dizendo que não era sobre nada, tendo acabado de recuperar
     * exatamente sobre o que era.
     *
     * Recuperar um conceito É saber o assunto. Deixar o referente vazio aqui
     * seria descartar a única informação que a frase deu.
     */
    const c = conceitos[0];
    referente = {
      literal: c.literal,
      conceito: c.conceito,
      origem: c.origem,
      score: c.score,
      alias_semantico: c.literal !== c.conceito,
      pendente: false,
    };
    anota('conceito', c.literal, `referente pelo conceito ${c.conceito}`);
  } else if (anafora) {
    referente = {
      ...SEM_REFERENTE,
      conceito: REFERENTE_DESCONHECIDO,
      origem: 'anafora',
      pendente: true,
    };
    anota('anafora', anafora[0], 'referente depende do turno anterior');
  }

  /**
   * ATO DE FECHAMENTO SEM OBJETO TEM REFERENTE PENDENTE — cancela-se ALGUMA
   * COISA.
   *
   * Achado pelo arnês, que mediu a ambiguidade de « cancela » caindo de
   * preservada para escondida quando esta camada entrou: o re-ranqueamento dava
   * `remocao` a `cancelar_lembrete` e abria margem sobre `resolver_confirmacao`,
   * e a frase passava a ter um vencedor. Só que « cancela » sozinho pode ser
   * cancelar lembrete, abortar pendência de confirmação ou desfazer plano — o
   * ato está claro e o ALVO não.
   *
   * A camada ficou mais confiante sem ficar mais informada, que é a forma de
   * regressão mais perigosa que ela pode ter. A régua é geral: revogar,
   * confirmar e negar são atos sobre algo dito antes; sem objeto na frase, esse
   * algo não está aqui.
   */
  const ATOS_DE_FECHAMENTO = ['cancelar', 'confirmar', 'negar'];
  if (objeto === null && ATOS_DE_FECHAMENTO.includes(ato)) {
    referente = { ...SEM_REFERENTE, conceito: REFERENTE_DESCONHECIDO, origem: 'anafora', pendente: true };
    anota('ato', ato, 'fechamento sem objeto — o alvo veio de um turno anterior');
  }

  // --- Hipóteses ----------------------------------------------------------
  const candidatos = descoberta.descobrirCandidatos(bruto);
  const operacaoDe = (id: string): Operacao | null =>
    operacaoPorId.get(id) ?? operacaoDaHabilidade(id);
  const hipoteses = ranquear(candidatos, operacao, objeto, habilidades, operacaoDe, conceitos, anota);

  /**
   * REFERENTE DESCONHECIDO NÃO PRODUZ OBJETIVO — e as hipóteses ficam de pé.
   *
   * « e aquele segundo? » alcançava `informacoes_sistema` por empate de ruído.
   * A frase não diz sobre o que é: ela DEPENDE de um turno que não está aqui.
   * Nomear um vencedor nesse estado é inventar contexto — o defeito que o §7 da
   * ordem proíbe em uma linha ("não transforme ausência de contexto em
   * certeza").
   *
   * As hipóteses continuam na lista de propósito: quem tiver o histórico —
   * memória, contexto, ou o próprio operador — resolve o referente e escolhe
   * entre elas. O que esta camada recusa é escolher no lugar de quem sabe.
   */
  /**
   * ELIPSE NÃO DECIDE SOZINHA — nem quando tem objeto.
   *
   * Achado pelo arnês na Fase 3, e é a segunda vez que o mesmo padrão aparece:
   * « e por central? » tinha margem 0,00 e passou a 0,50 quando `central` virou
   * conceito declarado. A habilidade que declarou o conceito ganhou peso, abriu
   * vantagem, e a frase passou a ter um vencedor — sendo que ela continua sem
   * dizer agrupar O QUÊ por central.
   *
   * `ato === 'continuar'` é justamente o reconhecimento de que a frase REFINA
   * uma anterior. Ter objeto próprio não a torna autossuficiente: o objeto é o
   * refinamento, não o pedido. A camada ficar mais confiante porque o catálogo
   * ficou mais rico é a forma de regressão que este arnês existe para pegar.
   */
  const semAncora = (referente.pendente && objeto === null) || ato === 'continuar';
  if (semAncora) anota('referente', REFERENTE_DESCONHECIDO, 'sem âncora própria → objetivo não declarado');
  const objetivo = semAncora ? null : (hipoteses[0]?.objetivo ?? null);
  /**
   * SEM ÂNCORA PRÓPRIA, A MARGEM É ZERO — e isso não é um detalhe de cálculo.
   *
   * Margem mede SEPARAÇÃO POR EVIDÊNCIA entre a primeira e a segunda hipótese.
   * Quando a frase não tem âncora própria, a separação que o ranqueamento
   * produziu não é evidência sobre esta frase: é o peso do catálogo falando
   * sozinho. Deixá-la alta faria a camada anunciar certeza que ela não tem, que
   * é exatamente o que o arnês pegou em « cancela ».
   */
  const margem = semAncora
    ? 0
    : hipoteses.length === 0
      ? 0
      : hipoteses.length === 1 || hipoteses[0].score <= 0
        ? 1
        : (hipoteses[0].score - hipoteses[1].score) / hipoteses[0].score;

  // --- Atributos e restrições --------------------------------------------
  const atributos = ATRIBUTOS.filter(([re]) => re.test(t)).map(([, nome]) => nome);
  const restricoes: string[] = [];
  if (p) restricoes.push(`periodo:${periodo}`);
  for (const s of substantivos) if (s.token !== objeto) restricoes.push(`qualificador:${s.token}`);

  return {
    texto_original: bruto,
    texto_normalizado: descoberta.normalizarConsulta(bruto),
    ato,
    objetivoSemantico: comporObjetivoSemantico(operacao, referente, objeto),
    objetivo,
    operacao,
    objeto,
    periodo,
    proposito: propositoDe(ato, operacao),
    referente,
    conceitos,
    atributos: [...new Set(atributos)],
    restricoes,
    hipoteses,
    evidencias,
    margem,
  };
}

// ---------------------------------------------------------------------------

interface TracosDoAto {
  readonly t: string;
  readonly bruto: string;
  readonly interrogativa: boolean;
  readonly operacao: Operacao | null;
  readonly objeto: string | null;
  readonly periodo: string | null;
  readonly acionaveis: readonly VerboReconhecido[];
  readonly conceitos: readonly ConceitoRecuperado[];
  readonly anota: (fonte: string, trecho: string, conclusao: string) => void;
}

/**
 * O ATO É COMPOSTO, NÃO CASADO.
 *
 * Cada ramo abaixo combina traços gramaticais; nenhum reconhece uma frase.
 * A ordem é a das evidências mais decisivas para as menos: revogar e confirmar
 * são atos de fechamento e não podem ser lidos como pedido novo, custe o que
 * custar — é o que impede « não, cancela isso » de virar uma ação.
 *
 * O CASO QUE GOVERNA O RAMO INTERROGATIVO, e que já foi implementado errado
 * antes neste repositório (`testes/decisao.test.ts:287`):
 *
 *     « Como você está? »       interrogativa, e é CONVERSA
 *     « Estou livre amanhã? »   interrogativa, e é CONSULTA
 *
 * A forma é a mesma nas duas. O que as separa não é sintaxe: é a primeira não
 * ter operação, nem objeto de domínio, nem período — e falar dos interlocutores.
 * "Sintaxe não é proxy de intenção" vira, aqui, uma conjunção verificável.
 */
function decidirAto(x: TracosDoAto): AtoComunicativo {
  const { t, interrogativa, operacao, objeto, periodo, acionaveis, conceitos, anota } = x;

  if (SAUDACAO.test(t) && t.length < 40) {
    anota('social', t.slice(0, 20), 'ato conversar');
    return 'conversar';
  }
  if (REVOGACAO.test(t)) {
    anota('revogacao', t.match(REVOGACAO)![0], 'ato cancelar');
    return 'cancelar';
  }
  if (NEGACAO_PURA.test(t)) {
    anota('negacao', t, 'ato negar');
    return 'negar';
  }
  if (CONFIRMACAO.test(t) && !objeto) {
    anota('confirmacao', t.match(CONFIRMACAO)![0], 'ato confirmar');
    return 'confirmar';
  }
  if (CORRECAO.test(t)) {
    anota('correcao', t.match(CORRECAO)![0], 'ato corrigir');
    return 'corrigir';
  }
  if (SOBRE_O_DIALOGO.test(t)) {
    anota('dialogo', t.match(SOBRE_O_DIALOGO)![0], 'ato recapitular');
    return 'recapitular';
  }
  if (CONTINUACAO.test(t) && acionaveis.length === 0) {
    anota('elipse', t.split(/\s+/)[0], 'ato continuar — a frase refina a anterior');
    return 'continuar';
  }

  /**
   * PERGUNTA SEM PONTO DE INTERROGAÇÃO AINDA É PERGUNTA.
   *
   * O Arnês C mediu SEIS falhas com a mesma assinatura — `op=null`,
   * `ato=informar` — e todas eram consultas reais digitadas como a operadora
   * digita no celular:
   *
   *     « vai chove hoje »          « como ta o pc »
   *     « como ta o tempo ai hoje » « qnts cargas essa semana »
   *
   * Nenhuma tem "?" nem abertura interrogativa que `ehInterrogativa` reconheça,
   * e por isso caíam em `informar` — um ato que não deriva operação nenhuma e
   * termina em conversa. Seis casos, UMA causa.
   *
   * O SINAL QUE RESOLVE NÃO É SINTÁTICO, e é aí que esta camada tem vantagem:
   * a frase RECUPERA UM CONCEITO DECLARADO do catálogo e não pede ação nenhuma
   * (nenhum verbo acionável). Quem escreve sobre um assunto que a IARA declara
   * atender, sem mandar fazer nada, está perguntando. Conceito declarado é a
   * evidência de maior prioridade que existe aqui — muito acima de "tem alguma
   * palavra de domínio".
   *
   * O CUSTO, declarado: um desabafo com vocabulário de trabalho e conceito
   * declarado ("esse relatório de cargas me destruiu hoje") passa a pagar uma
   * chamada de planejamento. É o erro BARATO — volta com raciocínio puro e a
   * resposta certa, só mais lenta — e é a mesma régua que o cabeçalho da
   * `DescobertaCapacidades` já declara: o erro barato absorve o caro. A fila de
   * lacunas não é contaminada: `Kernel` tem o próprio guarda de FORMA DE PEDIDO
   * antes de registrar.
   */
  const consultaSemForma =
    !interrogativa && acionaveis.length === 0 && conceitos.length > 0;
  if (consultaSemForma) {
    anota('conceito', conceitos[0].conceito, 'assunto declarado sem pedido de ação → consulta');
  }

  if (interrogativa || consultaSemForma) {
    const temConteudo = operacao !== null || objeto !== null || periodo !== null;
    if (!temConteudo || (SOBRE_OS_INTERLOCUTORES.test(t) && !objeto && !periodo)) {
      anota('interrogacao', t, 'pergunta sem objeto, operação nem tempo → conversa');
      return 'conversar';
    }
    anota('interrogacao', t, 'ato perguntar');
    return 'perguntar';
  }

  /** Imperativo: verbo na abertura, sem interrogação. É a forma de mandar. */
  if (acionaveis.length > 0 && acionaveis[0].posicao <= 1) {
    anota('imperativo', acionaveis[0].forma, 'ato solicitar_acao');
    return 'solicitar_acao';
  }
  if (operacao !== null && objeto !== null) {
    anota('declarativa', `${operacao}+${objeto}`, 'ato solicitar_acao');
    return 'solicitar_acao';
  }
  if (objeto !== null || operacao !== null) return 'informar';

  /**
   * Nem forma, nem operação, nem objeto, nem tempo. A frase pode ser conversa
   * ou uma elipse cujo antecedente não está aqui — e afirmar qualquer uma das
   * duas seria inventar. `ambigua` é a resposta honesta.
   */
  if (ANAFORA.test(t)) {
    anota('anafora', t.match(ANAFORA)![0], 'sem antecedente e sem conteúdo próprio → ambígua');
    return 'ambigua';
  }
  return 'conversar';
}

/**
 * O VERBO CANÔNICO DE CADA OPERAÇÃO — o vocabulário em que o significado é
 * escrito.
 *
 * Uma tabela de OITO entradas, uma por operação, e ela não cresce com o
 * catálogo nem com a língua: é a nomenclatura do próprio `Operacao`. Serve para
 * `objetivoSemantico` ser legível por gente — `consultar_disponibilidade` diz
 * mais num relatório de auditoria do que `leitura+disponibilidade`.
 */
const VERBO_CANONICO: Record<Operacao, string> = {
  leitura: 'consultar',
  contagem: 'contar',
  analise: 'analisar',
  criacao: 'criar',
  alteracao: 'alterar',
  remocao: 'remover',
  envio: 'enviar',
  execucao: 'executar',
};

/**
 * O SIGNIFICADO, COMPOSTO — nunca uma tabela de frases.
 *
 * `leitura` + `disponibilidade` → `consultar_disponibilidade`.
 *
 * O CONCEITO VEM ANTES DO OBJETO LITERAL, de propósito: « estou livre amanhã? »
 * e « tenho horário amanhã? » têm objetos diferentes ("livre", "horario") e o
 * MESMO conceito normalizado. É o conceito que define o que a pessoa quis; o
 * literal serve à auditoria, não à identidade do objetivo.
 *
 * `null` quando falta operação ou assunto, e a ausência é honesta: sem verbo e
 * sem objeto não há o que a frase queira — há só forma.
 */
function comporObjetivoSemantico(
  operacao: Operacao | null,
  referente: Referente,
  objeto: string | null,
): string | null {
  if (operacao === null) return null;
  const assunto = referente.conceito ?? objeto;
  if (!assunto || assunto === REFERENTE_DESCONHECIDO) return null;
  return `${VERBO_CANONICO[operacao]}_${assunto}`;
}

function propositoDe(ato: AtoComunicativo, operacao: Operacao | null): Proposito | null {
  if (ato === 'cancelar' || ato === 'negar') return 'revogar_efeito';
  if (ato === 'conversar') return 'manter_conversa';
  if (ato === 'perguntar' || ato === 'recapitular') return 'obter_informacao';
  if (ato === 'solicitar_acao') {
    if (operacao === 'leitura' || operacao === 'contagem' || operacao === 'analise') {
      return 'obter_informacao';
    }
    return 'produzir_efeito';
  }
  return null;
}

/**
 * O RE-RANQUEAMENTO — onde a operação e o objeto passam a valer.
 *
 * A descoberta devolve candidatos ordenados por peso LEXICAL: quantos
 * substantivos da frase cada habilidade compartilha, e quão raros eles são.
 * É por isso que « lista os arquivos da área de trabalho » chegava em
 * `criar_arquivo`: as duas habilidades falam de arquivo, e o índice não tinha
 * como saber que uma cria e a outra lê.
 *
 * Aqui a frase e a habilidade são comparadas nas DUAS dimensões que a camada
 * semântica separou. O escore lexical não é descartado — é multiplicado, e
 * `compativel` fica registrado em cada hipótese para a decisão seguinte poder
 * ver por que a ordem é esta.
 *
 * NENHUMA HIPÓTESE É REMOVIDA. Habilidade incompatível é rebaixada, nunca
 * apagada: se a leitura da operação estiver errada, a hipótese certa continua
 * na lista para o contexto ou o operador a resgatarem.
 */
function ranquear(
  candidatos: readonly Candidato[],
  operacao: Operacao | null,
  objeto: string | null,
  habilidades: readonly ManifestoHabilidade[],
  operacaoDe: (id: string) => Operacao | null,
  conceitos: readonly ConceitoRecuperado[],
  anota: (fonte: string, trecho: string, conclusao: string) => void,
): readonly HipoteseSemantica[] {
  const avaliar = (id: string, base: number, evidencias: readonly string[]): HipoteseSemantica => {
    const daHabilidade = operacaoDe(id);
    const compativel =
      operacao !== null && daHabilidade !== null && operacoesCompativeis(operacao, daHabilidade);

    let fator = 1;
    if (operacao !== null && daHabilidade !== null) {
      fator *= compativel ? BONUS_OPERACAO : PENALIDADE_OPERACAO;
    }
    if (objeto && objetoDaHabilidade(id).includes(objeto)) fator *= BONUS_OBJETO;

    /**
     * DECLARAÇÃO VENCE COINCIDÊNCIA.
     *
     * Duas medições da Fase 3 tinham a mesma causa e nenhuma delas era da
     * camada:
     *
     *   « como está minha agenda amanhã? » → `consultar_agenda`
     *   « tenho horário amanhã? »          → `listar_lembretes`
     *
     * `consultar_agenda` devolve DATA E HORA — o nome é enganoso e a palavra
     * "agenda" só existe no `id` dela. `listar_lembretes` ganhava de
     * `ver_agenda_calendario` por ruído léxico de "tenho". Nos dois casos, a
     * habilidade que perdeu tinha DECLARADO no manifesto que atende aquele
     * conceito, e a que ganhou não tinha declarado nada.
     *
     * Declarar `conceitos` é uma afirmação de quem escreveu a habilidade —
     * "isto é meu assunto". Um pedaço de `id` que por acaso contém a palavra é
     * coincidência. Tratar as duas como evidência do mesmo peso é o que fazia a
     * coincidência ganhar.
     *
     * É a mesma ordenação de qualidade de evidência que a `DescobertaCapacidades`
     * já usa entre exemplo e prosa: o que foi afirmado vale mais que o que foi
     * inferido do texto.
     */
    if (conceitos.some((c) => c.capacidades.includes(id))) fator *= BONUS_CONCEITO_DECLARADO;

    /**
     * HIPÓTESE SOBRE OUTRO OBJETO NÃO É HIPÓTESE SOBRE ESTA FRASE.
     *
     * « quais arquivos existem? » ia parar em
     * `consultar_estatisticas_cargas_luft`, com escore alto e esta evidência:
     *
     *     ["existem", "quai"]
     *
     * Nenhuma das duas é "arquivo". "quais" é pronome e "existem" é o verbo do
     * exemplo « Quantas rotas distintas existem? » — as duas entraram no índice
     * porque ele indexa o texto INTEIRO do manifesto, e nenhuma delas diz uma
     * palavra sobre o assunto da frase. A habilidade casou com a FORMA da
     * pergunta, não com o objeto dela: é a mistura que esta camada existe para
     * desfazer, aparecendo do lado do léxico.
     *
     * A régua é geral e não precisa saber classe de palavra: quando a frase tem
     * objeto, quem não o cita — nem na evidência, nem no próprio `id` — está
     * respondendo sobre outra coisa. Rebaixa, nunca remove: se a leitura do
     * objeto estiver errada, a hipótese continua ali para o contexto resgatar.
     *
     * A correção mora deste lado, e não na lista de funcionais da
     * `DescobertaCapacidades`, de propósito: mexer no índice mudaria a linha de
     * base que a Fase 2 mediu, e o antes/depois desta fase deixaria de comparar
     * a mesma coisa.
     */
    if (objeto && !evidencias.includes(objeto) && !objetoDaHabilidade(id).includes(objeto)) {
      fator *= PENALIDADE_OBJETO_AUSENTE;
    }

    return { objetivo: id, score: base * fator, evidencias, operacao: daHabilidade, compativel };
  };

  const hipoteses = candidatos.map((c) => avaliar(c.habilidade, c.score, c.evidencias));

  /**
   * ADMISSÃO POR ESTRUTURA — o segundo sinal que o léxico não tinha.
   *
   * A descoberta exige DUAS coincidências lexicais para admitir uma habilidade
   * (ou um token quase-exclusivo). « lista os arquivos » passava porque "lista"
   * também aparece no manifesto de `listar_arquivos`; « me mostra os arquivos »
   * e « olha os arquivos pra mim » não passavam — "arquivo" sozinho é comum
   * demais — e `listar_arquivos` nem chegava a ser candidata. Re-ranquear não
   * resolvia: só reordena o que já está na lista.
   *
   * O par (operação, objeto) É a segunda evidência, e ela é mais forte que a
   * co-ocorrência de dois substantivos quaisquer: « ler » + « arquivo » aponta
   * para `listar_arquivos` pelo mesmo motivo que o `id` se chama assim. Sai do
   * invariante de nomenclatura do CLAUDE.md, não de uma tabela.
   *
   * A trava: só admite dentro da compatibilidade de operação — o que impede
   * esta porta de virar um jeito de `criar_arquivo` entrar numa frase de
   * leitura pela porta dos fundos.
   */
  if (operacao !== null && objeto !== null) {
    const jaTem = new Set(hipoteses.map((h) => h.objetivo));
    for (const { id } of habilidades) {
      if (jaTem.has(id)) continue;
      const daHabilidade = operacaoDe(id);
      if (daHabilidade === null || !operacoesCompativeis(operacao, daHabilidade)) continue;
      if (!objetoDaHabilidade(id).includes(objeto)) continue;
      hipoteses.push(avaliar(id, BASE_ESTRUTURAL, [`estrutura:${operacao}+${objeto}`]));
      anota('estrutura', `${operacao}+${objeto}`, `hipótese ${id} admitida sem coincidência lexical`);
    }
  }

  /**
   * ADMISSÃO POR CONCEITO — e a trava que impede similaridade de virar
   * autorização.
   *
   * « Estou livre amanhã? » recupera o conceito `disponibilidade`, que DUAS
   * habilidades declaram atender: `ver_agenda_calendario` e
   * `criar_evento_calendario`. A similaridade entre a frase e as duas é
   * idêntica, e está correta — as duas são sobre agenda.
   *
   * O que separa uma da outra não é conceito nenhum: é `leitura` contra
   * `criacao`. Sem esta condição, perguntar se está livre poderia marcar um
   * compromisso — e nenhuma quantidade de escore semântico deveria ser capaz de
   * autorizar isso.
   *
   *     similaridade semântica × compatibilidade estrutural
   *
   * A CONJUNÇÃO É LITERAL AQUI: sem `operacao`, NADA é admitido por conceito.
   * Não é conservadorismo — é que sem operação a segunda metade da conjunção
   * não existe, e metade de uma trava não é trava.
   */
  if (operacao !== null) {
    const jaTem = new Set(hipoteses.map((h) => h.objetivo));
    for (const c of conceitos) {
      for (const id of c.capacidades) {
        if (jaTem.has(id)) continue;
        const daHabilidade = operacaoDe(id);
        if (daHabilidade === null || !operacoesCompativeis(operacao, daHabilidade)) {
          anota(
            'compatibilidade',
            `${c.conceito}→${id}`,
            `recuperada por conceito e RECUSADA: operação ${daHabilidade} ≠ ${operacao}`,
          );
          continue;
        }
        jaTem.add(id);
        hipoteses.push(
          avaliar(id, BASE_CONCEITUAL * c.score, [`conceito:${c.conceito}<-${c.literal}`]),
        );
        anota('conceito', c.literal, `hipótese ${id} admitida pelo conceito ${c.conceito}`);
      }
    }
  }

  const ordenadas = [...hipoteses].sort(
    (a, b) => b.score - a.score || a.objetivo.localeCompare(b.objetivo),
  );
  if (ordenadas.length > 0 && candidatos.length > 0 && ordenadas[0].objetivo !== candidatos[0].habilidade) {
    anota(
      'reranqueamento',
      `${candidatos[0].habilidade} → ${ordenadas[0].objetivo}`,
      operacao ? `operação ${operacao} da frase mudou a hipótese principal` : 'objeto mudou a hipótese principal',
    );
  }
  return ordenadas;
}

// ---------------------------------------------------------------------------
// 5. A costura para uma etapa cognitiva — e o que ela nunca poderá fazer
// ---------------------------------------------------------------------------

/**
 * O LUGAR ONDE UMA LLM PODERIA ENTRAR, e o contrato que a limita.
 *
 * A ordem de 21/08/2026 liberou uma etapa cognitiva de INTERPRETAÇÃO antes da
 * rota. A costura existe; o refinador concreto não, e a recusa é deliberada:
 * todo o resto desta camada é puro e roda sem chave de API, e o sistema tem o
 * invariante de funcionar completo em modo local. Um interpretador que
 * dependesse de rede faria a compreensão da IARA variar com a conectividade —
 * trocando a variância que esta fase veio matar por outra.
 *
 * AS DUAS TRAVAS, e elas são o motivo de o refinador ser um tipo e não uma
 * chamada solta:
 *
 *   · ele recebe e devolve `ContratoSemantico` — não recebe ferramenta, não
 *     recebe executor, não tem como alcançar o mundo nem com um plano válido;
 *   · `aplicarRefinamento` só deixa passar mudança que ESTREITA: preencher o
 *     que estava `null`, escolher entre hipóteses que já existiam, marcar
 *     `ambigua`. Inventar objetivo fora da lista, criar período do nada ou
 *     resolver um `desconhecido` sem evidência é recusado e o contrato
 *     determinístico fica de pé.
 *
 * É a mesma disciplina de `Autonomia.ts`: a camada de cima pode IMPEDIR, nunca
 * PERMITIR o que as travas de baixo não permitiriam.
 */
export interface RefinadorSemantico {
  refinar(contrato: ContratoSemantico, bruto: string): Promise<ContratoSemantico | null>;
}

export function aplicarRefinamento(
  base: ContratoSemantico,
  proposto: ContratoSemantico | null,
): { readonly contrato: ContratoSemantico; readonly recusas: readonly string[] } {
  if (!proposto) return { contrato: base, recusas: [] };
  const recusas: string[] = [];
  const idsConhecidos = new Set(base.hipoteses.map((h) => h.objetivo));

  /** Objetivo tem de sair das hipóteses que a descoberta já sustentava. */
  let objetivo = base.objetivo;
  if (proposto.objetivo !== base.objetivo) {
    if (proposto.objetivo !== null && !idsConhecidos.has(proposto.objetivo)) {
      recusas.push(`objetivo "${proposto.objetivo}" não está entre as hipóteses — descartado`);
    } else {
      objetivo = proposto.objetivo;
    }
  }

  /** Período é aritmética de calendário. Modelo não fabrica data. */
  const periodo = base.periodo;
  if (proposto.periodo !== base.periodo) {
    recusas.push('período só vem de `interpretarPeriodo` — proposta descartada');
  }

  /** Referente pendente só se resolve com contexto, que não passa por aqui. */
  let referente = base.referente;
  if (base.referente.pendente && !proposto.referente.pendente) {
    recusas.push('referente pendente não se resolve sem contexto — proposta descartada');
  } else if (proposto.referente.pendente && !base.referente.pendente) {
    // Estreitar é sempre permitido: reconhecer que falta antecedente é recuar.
    referente = { ...base.referente, pendente: true };
  }

  return {
    contrato: {
      ...base,
      objetivo,
      periodo,
      referente,
      ato: proposto.ato === 'ambigua' ? 'ambigua' : base.ato,
      evidencias: [
        ...base.evidencias,
        { fonte: 'refinador', trecho: bruto8(base), conclusao: `ato ${proposto.ato}` },
      ],
    },
    recusas,
  };
}

const bruto8 = (c: ContratoSemantico): string => c.objeto ?? c.ato;
