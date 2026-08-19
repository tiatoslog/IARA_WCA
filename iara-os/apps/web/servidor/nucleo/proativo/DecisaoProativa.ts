/**
 * A DECISÃO — o que fazer com uma ocorrência já pontuada.
 *
 * ---------------------------------------------------------------------------
 * A DISTINÇÃO QUE GOVERNA O ARQUIVO, E QUE NÃO É NEGOCIÁVEL
 * ---------------------------------------------------------------------------
 *
 *   **Proatividade responde "devo trazer isto à pessoa?".**
 *   **Ela NUNCA responde "posso executar isto?".**
 *
 * `agir` existe no vocabulário — é o degrau que a especificação pede e o nome
 * certo para o dia em que rotinas autorizadas existirem — e `decidir` **nunca o
 * devolve**. Não é omissão: é a trava. Há teste varrendo o espaço de entradas,
 * inclusive as hostis e inclusive com autonomia no topo, provando que nenhuma
 * combinação produz `agir`.
 *
 * A razão é a mesma que fez `Autonomia.ts` existir: subir um teto não pode
 * conceder nada. Uma camada que percebe o mundo sozinha e que pudesse concluir
 * "então execute" seria um caminho de autorização que não passa pelo
 * `PorteiroAutorizacao`, pelo esquema, pelo jornal nem pelo verificador — os
 * quatro portões que este kernel inteiro existe para manter no caminho. No dia
 * em que uma rotina autorizada existir, ela entra pelo portal, com plano
 * determinístico e autorização do operador, exatamente como qualquer outra
 * escrita. Não por aqui.
 *
 * ---------------------------------------------------------------------------
 * A ORDEM DAS REGRAS É A POLÍTICA
 * ---------------------------------------------------------------------------
 *
 * As três primeiras são PORTÕES — respondem antes de a pontuação importar:
 * autonomia, silêncio pedido pela pessoa, e ruído abaixo do piso. Só depois
 * delas a pontuação escolhe a forma da fala. Inverter a ordem faria um evento
 * grave falar por cima de um "não me avise disso" — que é a maneira mais rápida
 * de perder a confiança de quem usa.
 */

import type { Confianca } from '../kernel/Investigacao';
import { podeSem, type NivelAutonomia } from '../kernel/Autonomia';
import type { Atencao } from './Atencao';
import { silenciado } from './Atencao';
import type { MotivoRelevancia, Relevancia } from './Relevancia';
import type { Ocorrencia } from './Ocorrencia';
import type { MotivoSupressao } from './Interrupcao';

/**
 * Os oito degraus. Do mais contido ao mais invasivo — a ordem do array é a
 * ordem do impacto sobre a atenção de quem recebe.
 */
export const ACOES = [
  /** Não interessa a esta pessoa. Nem guardado é. */
  'ignorar',
  /** Guardado no livro; nada é dito. Vira histórico e insumo de aprendizado. */
  'guardar',
  /** Merece uma segunda leitura antes de valer uma frase. */
  'acompanhar',
  /** Junta-se ao resumo; sai quando alguém perguntar ou no próximo momento bom. */
  'resumir',
  /** Existe uma oportunidade. A IARA oferece; quem decide é a pessoa. */
  'sugerir',
  /** Falta um dado para afirmar. A IARA pergunta em vez de chutar. */
  'perguntar',
  /** A pessoa precisa saber agora. */
  'alertar',
  /** NUNCA devolvido por `decidir`. Ver o cabeçalho. */
  'agir',
] as const;

export type AcaoProativa = (typeof ACOES)[number];

/** As ações que produzem uma frase não pedida. As outras são silenciosas. */
export const ACOES_QUE_FALAM: readonly AcaoProativa[] = ['sugerir', 'perguntar', 'alertar'];

export type MotivoDecisao =
  | MotivoRelevancia
  | 'autonomia_insuficiente'
  | 'assunto_silenciado'
  | 'abaixo_do_piso'
  | 'abaixo_do_limiar_de_fala'
  | 'oportunidade'
  /** Falou por causa de QUEM recebe, não da gravidade. Ver `LIMIAR_DE_ALERTA`. */
  | 'relevancia_individual'
  | MotivoSupressao;

/**
 * A JUSTIFICATIVA ESTRUTURADA — o que responde "por que você me chamou?".
 *
 * Estruturada, e não uma frase: uma frase não pode ser contada, agrupada nem
 * comparada entre mil decisões. A interface (ou a fala) transforma isto em
 * português; a auditoria lê os campos.
 */
export interface Justificativa {
  readonly gatilho: Ocorrencia['tipo'];
  readonly assunto: string;
  readonly acao: AcaoProativa;
  readonly motivos: readonly MotivoDecisao[];
  /** Os fatos, como vieram da ocorrência. Nunca interpretação. */
  readonly evidencia: readonly string[];
  readonly confianca: Confianca;
  readonly pontuacao: number;
  readonly natureza: Ocorrencia['natureza'];
  /** Preenchido quando a política de interrupção rebaixou a ação. */
  readonly suprimida_por: MotivoSupressao | null;
}

/**
 * Abaixo disto a ocorrência não vale nem o espaço em disco.
 *
 * É o número que torna possível a IARA ver dez mil eventos e guardar dezenas.
 * Sem um piso, "guardar tudo, decidir depois" transforma o livro de cada
 * operador num log de aplicação — caro de ler, caro de podar, e inútil, porque
 * ninguém vai procurar ali.
 *
 * ---------------------------------------------------------------------------
 * O DEFEITO QUE ESTE NÚMERO JÁ TEVE, e a lição que ele deixou
 * ---------------------------------------------------------------------------
 *
 * O primeiro valor foi 0,30, escolhido "por parecer baixo". Ele era mais baixo
 * que o MÍNIMO ATINGÍVEL pela fórmula de `Relevancia`: o evento mais
 * desinteressante possível — severidade leve, confiança baixa, não acionável,
 * operador sem histórico e sem ficha — pontua ≈0,394, porque os sinais neutros
 * (`interesse` e `responsabilidade` valem 0,5 quando não há evidência) já somam
 * 0,20 sozinhos. Consequência: o ramo `ignorar` era **inalcançável**, e a
 * bateria de silêncio mediu 500 ocorrências guardadas e 87 segundos de disco
 * onde deveria haver dezenas e nada.
 *
 * A lição não é sobre este número: é que **um limiar só significa alguma coisa
 * em relação à faixa que a fórmula de fato produz.** A faixa útil aqui é
 * [≈0,31, 1,0], não [0, 1]. Quem mexer nos `PESOS` de `Relevancia` tem de
 * recalcular estes dois valores — há teste medindo os dois lados.
 */
export const PISO_DE_REGISTRO = 0.42;

/**
 * A partir daqui vale abrir a boca — se a política de interrupção deixar.
 *
 * Calibrado contra três pontos de referência reais, e não por gosto:
 *
 *   ≈0,39  evento trivial (leve, baixa, não acionável)          → ignorar
 *   ≈0,55  evento mediano (moderada, média, não acionável)      → guardar
 *   ≈0,80  anomalia grave, medida e acionável                   → falar
 *
 * O padrão de uma ocorrência sobre a qual nada se sabe é SILÊNCIO. Falar exige
 * algo que a levante acima da mediana — gravidade, interesse comprovado, ou a
 * pessoa ter declarado que aquilo é trabalho dela.
 */
export const LIMIAR_DE_FALA = 0.6;

/**
 * A partir daqui a relevância PARA ESTA PESSOA basta para interromper, mesmo sem
 * gravidade máxima. Ver a regra de promoção em `decidir`.
 *
 * Pontos de referência medidos, com ficha declarada e assunto casando:
 *
 *   ≈0,65  moderada + média, assunto da pessoa            → resumir
 *   ≈0,73  moderada + alta,  assunto da pessoa            → alertar
 *   ≈0,65  moderada + alta,  assunto de OUTRA pessoa      → resumir
 *
 * A terceira linha é a que importa: é o MESMO evento da segunda, e ele para em
 * resumo porque não é assunto de quem recebeu.
 */
export const LIMIAR_DE_ALERTA = 0.7;

export function decidir(entrada: {
  readonly ocorrencia: Ocorrencia;
  readonly relevancia: Relevancia;
  readonly atencao: Atencao;
  readonly nivel: NivelAutonomia;
  readonly agora: number;
}): Justificativa {
  const { ocorrencia: o, relevancia, atencao, nivel, agora } = entrada;

  const base = {
    gatilho: o.tipo,
    assunto: o.assunto,
    evidencia: o.evidencia,
    confianca: o.confianca,
    pontuacao: relevancia.pontuacao,
    natureza: o.natureza,
    suprimida_por: null,
  } as const;

  /**
   * PORTÃO 1 — AUTONOMIA. Conferida antes de tudo, inclusive antes de olhar a
   * pontuação, pela mesma razão que o `Vigia` já a confere antes de
   * diagnosticar: abaixo de `sugestao` a IARA não tem o que fazer com a
   * conclusão, e produzir uma conclusão que não pode ser dita é como se acumula
   * a tentação de dizê-la mais tarde.
   *
   * `guardar`, e não `ignorar`: o fato continua sendo verdade e continua valendo
   * como histórico. O que o teto proíbe é FALAR, não PERCEBER.
   */
  if (!podeSem(nivel, 'falar_sem_ser_chamada')) {
    return { ...base, acao: 'guardar', motivos: ['autonomia_insuficiente'] };
  }

  /**
   * PORTÃO 2 — A PESSOA JÁ DISSE NÃO. Vem antes da pontuação de propósito: um
   * evento grave não desfaz um "não me avise disso". Se ela mudar de ideia, é
   * ela quem pergunta — e perguntar levanta o silêncio pelo caminho normal
   * (`aplicarReacao('agiu')`).
   */
  if (silenciado(atencao, agora)) {
    return { ...base, acao: 'guardar', motivos: ['assunto_silenciado'] };
  }

  /** PORTÃO 3 — RUÍDO. Nem guardado. Ver `PISO_DE_REGISTRO`. */
  if (relevancia.pontuacao < PISO_DE_REGISTRO) {
    return { ...base, acao: 'ignorar', motivos: ['abaixo_do_piso', ...relevancia.motivos] };
  }

  if (relevancia.pontuacao < LIMIAR_DE_FALA) {
    return {
      ...base,
      acao: 'guardar',
      motivos: ['abaixo_do_limiar_de_fala', ...relevancia.motivos],
    };
  }

  /**
   * CONFIANÇA BAIXA COM IMPACTO ALTO NÃO VIRA AFIRMAÇÃO.
   *
   * A regra da especificação, e ela é a mais importante deste bloco:
   *
   *     baixa confiança + alto impacto = PERGUNTAR / VERIFICAR
   *     baixa confiança + alto impacto ≠ ação autônoma
   *
   * A forma de `perguntar` é o que impede a IARA de dizer "seu processo está com
   * problema" quando o que ela tem é um indício. Ela relata o que mediu e devolve
   * a decisão — a mesma forma que o `Vigia` já usava na frase dele.
   */
  if (o.confianca === 'baixa' && o.severidade === 'grave') {
    return { ...base, acao: 'perguntar', motivos: ['confianca_baixa', ...relevancia.motivos] };
  }

  /**
   * OPORTUNIDADE É OFERTA, NUNCA EXECUÇÃO. `sugerir` é o teto desta família por
   * construção: primeiro detecta, depois explica, depois propõe — e executa
   * apenas se autorizado, por um turno que a pessoa inicia.
   */
  if (o.tipo === 'automacao.oportunidade') {
    return { ...base, acao: 'sugerir', motivos: ['oportunidade', ...relevancia.motivos] };
  }

  if (o.severidade === 'grave' && o.confianca === 'alta') {
    return { ...base, acao: 'alertar', motivos: relevancia.motivos };
  }

  /**
   * A RELEVÂNCIA PROMOVE — e sem esta regra a camada não faz o que promete.
   *
   * O DEFEITO, encontrado pela bateria de sete dias: a árvore acima fazia a
   * pontuação governar apenas SE valia falar, nunca COMO. O único caminho até
   * `alertar` era `grave` + `alta`, que são duas propriedades DO EVENTO — nada
   * da pessoa. Consequência medida: dois operadores com fichas opostas recebiam
   * exatamente o mesmo conjunto de alertas na semana inteira, e a pergunta que
   * define este módulo ("importa PARA ESTA PESSOA?") não mudava nada além de
   * uma linha guardada em disco.
   *
   * A promoção fecha o buraco: um fato de gravidade média, mas que esta pessoa
   * declarou ser trabalho dela e sobre o qual ela vem agindo, alcança o alerta —
   * enquanto o MESMO fato, para quem não tem nada a ver com aquilo, para em
   * `resumir`.
   *
   * `confianca !== 'baixa'` é a trava que impede a promoção de virar uma porta
   * lateral para a regra de cima: interesse do operador nunca converte uma
   * SUSPEITA em afirmação. Uma suspeita muito relevante continua sendo uma
   * pergunta — e o ramo de `perguntar`, que vem antes, já a pegou.
   *
   * O limiar é alto de propósito, e a distância para `LIMIAR_DE_FALA` é o
   * espaço em que mora a maior parte do trabalho desta camada: entre 0,60 e
   * 0,70 tudo vira resumo.
   */
  if (relevancia.pontuacao >= LIMIAR_DE_ALERTA && o.confianca !== 'baixa') {
    return { ...base, acao: 'alertar', motivos: ['relevancia_individual', ...relevancia.motivos] };
  }

  /**
   * FATO REPETIDO E RELEVANTE VIRA ACOMPANHAMENTO, NÃO ALERTA.
   *
   * É o caso da métrica que continua ruim: já foi dita, continua verdade, e
   * repetir não acrescenta informação. `acompanhar` guarda com marcação de que
   * merece uma segunda leitura — o que alimenta a correlação e, se piorar, uma
   * ocorrência nova de severidade maior nasce e passa pelo caminho normal.
   */
  if (relevancia.sinais.novidade < 0.5) {
    return { ...base, acao: 'acompanhar', motivos: ['fato_repetido', ...relevancia.motivos] };
  }

  return { ...base, acao: 'resumir', motivos: relevancia.motivos };
}

/**
 * O REBAIXAMENTO — o que a política de interrupção faz com uma decisão de falar.
 *
 * Separado de `decidir` porque são perguntas diferentes com donos diferentes, e
 * porque o rebaixamento precisa ficar VISÍVEL: `suprimida_por` guardado no
 * registro é o que permite, depois, medir quantas falas foram represadas e por
 * quê. Uma supressão que não deixa rastro é indistinguível de um evento que
 * nunca chegou — e distinguir as duas é metade do valor desta camada.
 *
 * Rebaixa sempre para `resumir`, nunca para `guardar` ou `ignorar`: o fato foi
 * julgado digno de fala, e a única coisa que mudou foi o momento.
 */
export function rebaixar(j: Justificativa, motivo: MotivoSupressao): Justificativa {
  return {
    ...j,
    acao: 'resumir',
    motivos: [...j.motivos, motivo],
    suprimida_por: motivo,
  };
}
