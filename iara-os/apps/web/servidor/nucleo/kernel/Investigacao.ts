/**
 * VOCABULÁRIO DE INVESTIGAÇÃO — o que separa "achar" de "apurar".
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: quando a IARA diz "o processo X está
 * deixando seu computador lento", quais partes dessa frase ela MEDIU, quais ela
 * DEDUZIU e qual ela está RECOMENDANDO? Sem três palavras diferentes para três
 * coisas diferentes, tudo vira "a IARA disse" — e "a IARA disse" já foi
 * diagnosticado neste kernel como indistinguível de "a IARA inventou".
 *
 * RELAÇÃO COM `Verdade.ts`, e por que este arquivo NÃO cria uma escala nova:
 *
 *   `Procedencia` já responde "de onde veio isto", com força ordenada e
 *   desempate. Uma segunda escala de confiança ao lado dela seria a doença que
 *   este kernel já teve duas vezes — a regra duplicada entre `Percepcao` e o
 *   antigo `RoteadorIntencoes`, e `Verdade.ts` com teste e sem chamador. Aqui a
 *   `Evidencia` CARREGA uma `Procedencia`, e a confiança de uma hipótese é
 *   DERIVADA das procedências que a sustentam. Não existe campo de confiança que
 *   alguém preencha na mão.
 *
 * A REGRA, em uma frase: **medição é fato, hipótese é hipótese, e a confiança
 * de uma hipótese é calculada, nunca afirmada.**
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: não mede nada, não decide nada, não fala com o
 * operador. É vocabulário e aritmética pura — pelo mesmo motivo que
 * `Verdade.ts` não tem dependência: quem coleta, quem analisa e quem responde
 * precisam falar a mesma língua sobre evidência sem depender uns dos outros.
 */

import type { Risco } from './Habilidade';
import { podeAfirmarSemRessalva, type Procedencia } from './Verdade';

// ---------------------------------------------------------------------------
// 1. Evidência — a unidade de coisa observada
// ---------------------------------------------------------------------------

/**
 * O quanto uma evidência fala sobre a pergunta que está em cima da mesa.
 *
 * Existe porque coletar é barato e concluir não é: uma investigação de lentidão
 * mede memória, disco, processos e tempo ligado, e nem tudo que ela mediu tem a
 * ver com o que ela concluiu. `contextual` é o que entra no relatório sem entrar
 * no raciocínio.
 */
export type Relevancia = 'direta' | 'contextual';

/**
 * Uma coisa observada, com a marca de quem a observou.
 *
 * `valor` é `number | string` de propósito: "CPU em 87%" e "o processo dominante
 * é chrome.exe" são as duas evidências, e forçar a segunda a virar número
 * produziria um código de processo que ninguém consegue ler no relatório.
 */
export interface Evidencia {
  /** Estável e legível: `cpu_total`, `memoria_uso`, `processo_dominante`. */
  readonly metrica: string;
  /** Quem produziu. Id de habilidade, `sonda_desempenho`, `jornal_operacoes`. */
  readonly fonte: string;
  readonly valor: number | string;
  /** `%`, `GB`, `s`, ou vazio quando o valor não tem unidade. */
  readonly unidade: string;
  readonly procedencia: Procedencia;
  readonly relevancia: Relevancia;
  /** ISO 8601. Métrica sem instante é métrica que envelhece sem avisar. */
  readonly instante: string;
}

/**
 * Uma evidência pode entrar num raciocínio sem ressalva?
 *
 * Delega a `Verdade.podeAfirmarSemRessalva` — não reimplementa. A regra de o que
 * vale como fato mora num lugar só.
 */
export function ehMedicao(e: Evidencia): boolean {
  return podeAfirmarSemRessalva(e.procedencia);
}

// ---------------------------------------------------------------------------
// 2. Anomalia — a evidência que está fora da faixa
// ---------------------------------------------------------------------------

export type Severidade = 'leve' | 'moderada' | 'grave';

/**
 * Uma medição fora do esperado. Note que ela NÃO é uma causa: um disco a 95%
 * é uma anomalia; dizer que ele é o motivo da lentidão é uma hipótese, e mora
 * na estrutura de baixo.
 */
export interface Anomalia {
  readonly evidencia: Evidencia;
  /** Escrito para humano ler: "abaixo de 75%". Vai direto para o relatório. */
  readonly faixa_normal: string;
  readonly severidade: Severidade;
  /** Uma linha: o que está fora e o quanto. */
  readonly descricao: string;
}

const PESO_SEVERIDADE: Record<Severidade, number> = { leve: 1, moderada: 2, grave: 3 };

// ---------------------------------------------------------------------------
// 3. Hipótese — a explicação candidata
// ---------------------------------------------------------------------------

export type Confianca = 'alta' | 'media' | 'baixa';

const FORCA_CONFIANCA: Record<Confianca, number> = { alta: 3, media: 2, baixa: 1 };

export interface Hipotese {
  /** A frase, sempre em modo de suposição. Ver `enunciarHipotese`. */
  readonly enunciado: string;
  readonly sustentada_por: readonly Evidencia[];
  /**
   * O que PESA CONTRA — e o campo existe porque a alternativa é uma IARA que só
   * junta o que confirma. Uma hipótese com sustentação e refutação simultâneas
   * cai para `baixa`, que é o comportamento correto: duas medições discordando
   * é motivo para investigar mais, não para escolher a que agrada.
   */
  readonly enfraquecida_por: readonly Evidencia[];
  /** CALCULADA por `criarHipotese`. Não existe construtor que aceite este valor. */
  readonly confianca: Confianca;
}

/**
 * A confiança de uma hipótese, derivada — nunca declarada.
 *
 * A regra, e o motivo de cada parte:
 *
 *  - Sem nenhuma medição real sustentando, é `baixa`. Uma hipótese apoiada só em
 *    inferência é palpite com vocabulário técnico.
 *  - `alta` exige DUAS medições independentes (fontes ou métricas distintas).
 *    Uma medição só é um ponto; dois pontos que apontam para a mesma explicação
 *    são o mínimo para a IARA dizer "tenho alta confiança" sem esticar a frase.
 *  - Cada evidência contrária REBAIXA UM NÍVEL, e duas ou mais vão direto para
 *    `baixa`. Contradição não se resolve por contagem do lado que ganha; ela se
 *    resolve investigando — e uma hipótese que ainda se diz confiante enquanto
 *    carrega medição contra é precisamente a forma de errar com segurança.
 *
 * Deliberadamente conservadora. O custo de subestimar a própria confiança é o
 * operador conferir uma coisa que estava certa; o de superestimar é ele agir
 * sobre um diagnóstico errado.
 */
export function criarHipotese(entrada: {
  enunciado: string;
  sustentada_por: readonly Evidencia[];
  enfraquecida_por?: readonly Evidencia[];
}): Hipotese {
  const contra = entrada.enfraquecida_por ?? [];
  const medicoes = entrada.sustentada_por.filter(ehMedicao);
  const metricasDistintas = new Set(medicoes.map((e) => `${e.fonte}:${e.metrica}`)).size;

  let confianca: Confianca;
  if (medicoes.length === 0) confianca = 'baixa';
  else if (metricasDistintas >= 2) confianca = 'alta';
  else confianca = 'media';

  if (contra.length >= 2) confianca = 'baixa';
  else if (contra.length === 1) confianca = confianca === 'alta' ? 'media' : 'baixa';

  return {
    enunciado: entrada.enunciado,
    sustentada_por: entrada.sustentada_por,
    enfraquecida_por: contra,
    confianca,
  };
}

/**
 * O verbo com que cada nível de confiança pode ser dito ao operador.
 *
 * Mesma função de `VERBO_DO_ESTADO` em `Verdade.ts`, e pelo mesmo motivo: a
 * frase que a IARA fala não pode depender de quem escreveu o trecho de resposta.
 * "Tenho alta confiança" e "é uma possibilidade" descrevem estados diferentes do
 * mundo, e trocar um pelo outro é mentir sobre o que se sabe.
 */
export const VERBO_DA_CONFIANCA: Record<Confianca, string> = {
  alta: 'tenho alta confiança de que',
  media: 'minha leitura é que',
  baixa: 'é uma possibilidade, mas preciso investigar mais para afirmar que',
};

/**
 * O enunciado de uma hipótese, escrito como hipótese.
 *
 * Existe como função, e não como convenção de quem escreve a string, porque a
 * regra do §4 — não afirmar causalidade sem evidência — morre no dia em que uma
 * hipótese chega ao operador com verbo de fato. Aqui a marca é estrutural.
 */
export function enunciarHipotese(h: Hipotese): string {
  return `${VERBO_DA_CONFIANCA[h.confianca]} ${h.enunciado}`;
}

// ---------------------------------------------------------------------------
// 4. Diagnóstico — o que a investigação apurou
// ---------------------------------------------------------------------------

export interface Diagnostico {
  /** A pergunta investigada, nas palavras do domínio. */
  readonly problema: string;
  /** TUDO que foi medido, inclusive o que não sustentou hipótese nenhuma. */
  readonly evidencias: readonly Evidencia[];
  readonly anomalias: readonly Anomalia[];
  /** Da mais confiável para a menos. Ver `ordenarHipoteses`. */
  readonly hipoteses: readonly Hipotese[];
  /**
   * O QUE NÃO FOI POSSÍVEL MEDIR, e é o campo mais importante da estrutura.
   *
   * Um diagnóstico que omite o que não conseguiu olhar não é um diagnóstico
   * incompleto — é um diagnóstico enganoso, porque quem lê assume cobertura
   * total. "Não consegui ler o espaço em disco" muda o que o operador faz com o
   * resto da página.
   */
  readonly lacunas: readonly string[];
}

/**
 * Mais confiante primeiro; empate desfeito por quantidade de medições.
 *
 * Ordenar por confiança é o que permite a resposta dizer "minha hipótese
 * PRINCIPAL" sem que alguém escolha a dedo qual delas ganha o adjetivo.
 */
export function ordenarHipoteses(hipoteses: readonly Hipotese[]): Hipotese[] {
  return [...hipoteses].sort((a, b) => {
    const f = FORCA_CONFIANCA[b.confianca] - FORCA_CONFIANCA[a.confianca];
    if (f !== 0) return f;
    return b.sustentada_por.filter(ehMedicao).length - a.sustentada_por.filter(ehMedicao).length;
  });
}

/**
 * Há uma explicação de pé, ou a investigação só encontrou ruído?
 *
 * NÃO basta existir hipótese: uma lista de três palpites de confiança baixa é
 * uma investigação que não concluiu, e apresentá-la como conclusão é o que faz
 * um diagnóstico automático perder a credibilidade na primeira vez que erra.
 */
export function ehConclusivo(d: Diagnostico): boolean {
  return d.hipoteses.some((h) => h.confianca === 'alta' || h.confianca === 'media');
}

/** A anomalia que mais pesa. `null` quando a investigação não achou nada fora. */
export function anomaliaDominante(d: Diagnostico): Anomalia | null {
  if (d.anomalias.length === 0) return null;
  return [...d.anomalias].sort(
    (a, b) => PESO_SEVERIDADE[b.severidade] - PESO_SEVERIDADE[a.severidade],
  )[0];
}

// ---------------------------------------------------------------------------
// 5. Plano de ação — o que fazer com o que se apurou
// ---------------------------------------------------------------------------

export type Esforco = 'baixo' | 'medio' | 'alto';
export type Beneficio = 'baixo' | 'medio' | 'alto';

/**
 * O que deve ser VERDADE depois da ação, escrito de forma conferível.
 *
 * É o coração do §14, e a razão de ele ser uma estrutura e não uma frase: uma
 * expectativa em prosa ("o computador deve melhorar") não pode ser comparada com
 * uma medição. Esta pode — e é por isso que `avaliarResultado` consegue devolver
 * `acao_ineficaz` em vez de a IARA declarar sucesso porque o comando não deu
 * erro.
 */
export interface ResultadoEsperado {
  /** A MESMA chave de `Evidencia.metrica`. É o que amarra expectativa a medição. */
  readonly metrica: string;
  readonly comparador: '<' | '<=' | '>' | '>=';
  readonly valor: number;
  readonly unidade: string;
}

/**
 * QUANDO este passo pode rodar — e o campo existe por causa de um erro concreto
 * que ele impede.
 *
 * Um plano tem passos que a IARA executa agora e passos que dependem do mundo
 * andar primeiro. "Reiniciar o computador" e "medir de novo" estão no mesmo
 * plano, e medir logo depois de PEDIR o reinício mediria a máquina que ainda não
 * reiniciou — produzindo um "não resolveu" sobre uma ação que nem começou. O
 * mesmo vale para o plano em que quem age é o operador.
 *
 * Sem esta marca, a única alternativa seria o executor adivinhar pela id da
 * habilidade quais passos são seguros rodar em sequência — uma regra implícita
 * que quebra em silêncio no dia em que um plano novo aparecer.
 */
export type QuandoOPasso =
  /** A IARA roda neste turno, em sequência. */
  | 'agora'
  /** Depende do operador (ou de um reinício) acontecer antes. Não roda agora. */
  | 'quando_o_operador_voltar';

export interface PassoDeAcao {
  readonly ordem: number;
  readonly descricao: string;
  /** Id no catálogo, ou `null` quando o passo é apuração e não efeito. */
  readonly habilidade: string | null;
  readonly parametros: Readonly<Record<string, unknown>>;
  readonly quando: QuandoOPasso;
  /**
   * Desfaz? Alimenta a comparação entre alternativas e a redação do plano.
   * `false` não impede nada — quem impede é `PoliticaRisco`. Aqui o campo serve
   * para o operador saber no que está se metendo ANTES de autorizar.
   */
  readonly reversivel: boolean;
}

/**
 * Uma alternativa completa: o que fazer, o que se espera, o que custa e como
 * voltar atrás.
 *
 * Note que o plano NÃO carrega autorização nenhuma. Ele é uma PROPOSTA — a
 * invariante deste kernel é que a camada que raciocina nunca autoriza, e um
 * plano que chegasse pronto com carimbo de "pode executar" seria exatamente a
 * porta que `PorteiroAutorizacao` existe para fechar.
 */
export interface PlanoDeAcao {
  /** Estável dentro de uma investigação: `A`, `B`, `C`. É como o operador chama. */
  readonly id: string;
  readonly rotulo: string;
  readonly objetivo: string;
  readonly passos: readonly PassoDeAcao[];
  /** O maior risco entre os passos. Ver `riscoDoPlano`. */
  readonly risco: Risco;
  readonly esforco: Esforco;
  readonly beneficio: Beneficio;
  readonly resultado_esperado: ResultadoEsperado | null;
  /** Como desfazer, em uma frase. `null` quando não há o que desfazer. */
  readonly rollback: string | null;
}

/**
 * Os passos que a IARA de fato roda ao autorizar este plano.
 *
 * A REGRA DE PARADA É O PRIMEIRO PASSO QUE NÃO É `agora`, e não um filtro.
 * Filtrar deixaria passar um passo `agora` que vem DEPOIS de um que espera o
 * operador — e rodá-lo fora de ordem é executar o fim do plano antes do meio.
 * Um plano é uma sequência, não um conjunto.
 */
export function passosExecutaveis(p: PlanoDeAcao): readonly PassoDeAcao[] {
  const emOrdem = [...p.passos].sort((a, b) => a.ordem - b.ordem);
  const corte = emOrdem.findIndex((s) => s.quando !== 'agora');
  const ateOCorte = corte === -1 ? emOrdem : emOrdem.slice(0, corte);
  return ateOCorte.filter((s) => s.habilidade !== null);
}

/** Este plano produz algum efeito agora, ou é só instrução ao operador? */
export function ehExecutavelAgora(p: PlanoDeAcao): boolean {
  return passosExecutaveis(p).length > 0;
}

const PESO_RISCO: Record<Risco, number> = { baixo: 1, medio: 2, alto: 3 };
const PESO_ESFORCO: Record<Esforco, number> = { baixo: 1, medio: 2, alto: 3 };
const PESO_BENEFICIO: Record<Beneficio, number> = { baixo: 1, medio: 2, alto: 3 };

/**
 * A recomendação entre alternativas — §10.
 *
 * A FÓRMULA É EXPLÍCITA DE PROPÓSITO: benefício menos risco menos metade do
 * esforço. Não porque esses pesos sejam a verdade sobre o mundo, mas porque uma
 * recomendação precisa poder ser EXPLICADA ("por que você escolheu o A?"), e uma
 * escolha feita por prosa da LLM não pode. Discordar da política é editar dois
 * números aqui; discordar de um julgamento em linguagem natural é impossível.
 *
 * Risco pesa igual a benefício e o esforço pesa metade: entre um plano que
 * entrega muito arriscando muito e um que entrega bem arriscando pouco, o
 * segundo ganha. É a mesma preferência que o resto do kernel já expressa ao
 * exigir confirmação para risco alto.
 */
export function pontuarPlano(p: PlanoDeAcao): number {
  return PESO_BENEFICIO[p.beneficio] - PESO_RISCO[p.risco] - PESO_ESFORCO[p.esforco] / 2;
}

export interface Recomendacao {
  readonly escolhido: PlanoDeAcao;
  readonly descartados: readonly PlanoDeAcao[];
  /** Por que este. Sai como está para o operador, e responde ao "por quê?". */
  readonly justificativa: string;
}

/**
 * Escolhe e EXPLICA. Lança com lista vazia — recomendar nada não é um resultado,
 * é um erro de quem chamou.
 *
 * `preferidoPorHistorico` é o DESEMPATE do §26, e é só isso: o rótulo de um
 * plano que já resolveu esta mesma situação antes. Ele só age entre planos
 * EMPATADOS na pontuação — nunca sobrepõe a fórmula. Ver o cabeçalho de
 * `MemoriaDeSolucoes` para a razão: uma recomendação que se explica por "foi
 * assim antes" é como um sistema aprende a repetir o próprio erro com confiança
 * crescente.
 */
export function recomendar(
  planos: readonly PlanoDeAcao[],
  preferidoPorHistorico?: string | null,
): Recomendacao {
  if (planos.length === 0) {
    throw new Error('recomendar: nenhuma alternativa para comparar');
  }
  const ordenados = [...planos].sort((a, b) => {
    const p = pontuarPlano(b) - pontuarPlano(a);
    if (p !== 0) return p;
    if (!preferidoPorHistorico) return 0;
    const ha = a.rotulo === preferidoPorHistorico ? 1 : 0;
    const hb = b.rotulo === preferidoPorHistorico ? 1 : 0;
    return hb - ha;
  });
  const escolhido = ordenados[0];
  const descartados = ordenados.slice(1);

  const melhorBeneficio = [...planos].sort(
    (a, b) => PESO_BENEFICIO[b.beneficio] - PESO_BENEFICIO[a.beneficio],
  )[0];

  /**
   * A justificativa muda de forma quando o escolhido NÃO é o de maior
   * benefício — e essa é a frase que dá valor à comparação. "Escolhi o A porque
   * entrega quase tanto quanto o B com risco menor" é uma recomendação; "escolhi
   * o A" é um sorteio narrado.
   */
  const porHistorico =
    preferidoPorHistorico && escolhido.rotulo === preferidoPorHistorico
      ? ' Ele também é o que já resolveu isto antes.'
      : '';

  const justificativa =
    (melhorBeneficio.id !== escolhido.id
      ? `Escolhi o plano ${escolhido.id} (${escolhido.rotulo}): o ${melhorBeneficio.id} entrega mais, ` +
        `mas com risco ${melhorBeneficio.risco} contra ${escolhido.risco}. ` +
        `Prefiro o que resolve com o menor risco de estragar outra coisa.`
      : `Escolhi o plano ${escolhido.id} (${escolhido.rotulo}): é o de maior benefício ` +
        `(${escolhido.beneficio}) e o risco é ${escolhido.risco}, esforço ${escolhido.esforco}.`) +
    porHistorico;

  return { escolhido, descartados, justificativa };
}

/** O risco de um plano é o do passo mais arriscado. Nunca a média. */
export function riscoDoPlano(passos: readonly { risco: Risco }[]): Risco {
  return passos.reduce<Risco>(
    (pior, p) => (PESO_RISCO[p.risco] > PESO_RISCO[pior] ? p.risco : pior),
    'baixo',
  );
}

// ---------------------------------------------------------------------------
// 6. Veredito — a ação resolveu? (§14)
// ---------------------------------------------------------------------------

export type Veredito =
  /** A medição depois satisfaz o esperado. */
  | 'resolvido'
  /** Melhorou, mas não o bastante. Continua sendo um problema. */
  | 'parcial'
  /** A ação rodou e a métrica não se moveu na direção esperada. */
  | 'acao_ineficaz'
  /** Piorou depois da ação. É informação diferente de "não resolveu". */
  | 'regrediu'
  /** Não há como medir de novo. NÃO é sucesso e NÃO é fracasso. */
  | 'nao_verificavel';

/**
 * O que a resposta pode dizer para cada veredito. Mesma disciplina de `Verdade`.
 *
 * NENHUM DESTES VERBOS AFIRMA QUE A AÇÃO ACONTECEU, e a restrição custou uma
 * correção: `acao_ineficaz` dizia "a ação rodou e o número não mudou". Numa
 * prova contra a máquina real, um plano de INSTRUÇÃO — daqueles em que quem age
 * é o operador — recebeu essa frase sem que ninguém tivesse feito coisa alguma.
 * A IARA estava afirmando que uma ação rodou apoiada só no fato de ter sido
 * autorizada.
 *
 * A medição prova o NÚMERO, não a execução. Quem prova execução é o verificador
 * da habilidade (`Verdade.EstadoExecucao`), e ele não participa desta
 * comparação. Os verbos daqui falam só do que a medição sustenta.
 */
export const VERBO_DO_VEREDITO: Record<Veredito, string> = {
  resolvido: 'resolveu',
  parcial: 'melhorou, mas ainda não está dentro do que eu esperava',
  acao_ineficaz: 'não resolveu — o número não mudou como eu previa',
  regrediu: 'piorou desde a última medição',
  nao_verificavel: 'não consegui medir de novo para saber se resolveu',
};

function satisfaz(esperado: ResultadoEsperado, valor: number): boolean {
  switch (esperado.comparador) {
    case '<':
      return valor < esperado.valor;
    case '<=':
      return valor <= esperado.valor;
    case '>':
      return valor > esperado.valor;
    case '>=':
      return valor >= esperado.valor;
  }
}

/**
 * Compara o esperado com o medido DEPOIS — o §14 inteiro.
 *
 * `antes` é opcional e muda a resposta de forma importante: sem ele, não dá para
 * distinguir "não moveu" de "moveu na direção errada", e as duas pedem condutas
 * diferentes. Com ele, `parcial` deixa de ser um consolo e passa a ser uma
 * medida — melhorou, mas não chegou.
 *
 * `nao_verificavel` quando não há medição depois. É o mesmo desenho de
 * `sem_meio_de_verificar` na quinta porta: não conseguir olhar nunca vira
 * sucesso por omissão.
 */
export function avaliarResultado(
  esperado: ResultadoEsperado | null,
  depois: number | null,
  antes?: number | null,
): Veredito {
  if (!esperado || depois === null || depois === undefined) return 'nao_verificavel';
  if (satisfaz(esperado, depois)) return 'resolvido';
  if (antes === null || antes === undefined) return 'acao_ineficaz';

  /**
   * A direção desejada sai do comparador, não de uma suposição de que "menor é
   * melhor". Um plano que espera espaço livre ACIMA de 20% melhora subindo.
   */
  const querMenor = esperado.comparador === '<' || esperado.comparador === '<=';
  const melhorou = querMenor ? depois < antes : depois > antes;
  const piorou = querMenor ? depois > antes : depois < antes;

  if (melhorou) return 'parcial';
  if (piorou) return 'regrediu';
  return 'acao_ineficaz';
}
