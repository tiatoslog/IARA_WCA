/**
 * SUFICIÊNCIA — dá para concluir, dá para concluir com ressalva, ou é hora de
 * dizer "não sei"?
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: a IARA sabe que não sabe? "Não há
 * evidência suficiente para concluir" é uma CAPACIDADE, e a mais difícil de
 * provar que existe — porque o modo de falhar é silencioso e simpático: o
 * sistema responde alguma coisa, a frase soa razoável, e ninguém descobre que
 * ela não tinha lastro até a decisão dar errado.
 *
 * POR QUE A CONFIANÇA NÃO PODE SER A DO MODELO. Um número que a LLM escreve
 * ("confiança: alta") é gerado pelo mesmo processo que gerou a conclusão, com o
 * mesmo viés, e sobe junto com a fluência do texto em vez de com a qualidade da
 * evidência. Aqui ela é CALCULADA a partir de seis fatores observáveis, e a
 * função devolve os fatores junto — a IARA consegue responder "por que média?"
 * apontando qual fator puxou para baixo. Mesma disciplina de `criarHipotese` em
 * `Investigacao.ts`, que já calcula confiança em vez de aceitá-la.
 *
 * A REGRA DURA, e ela é mais estreita do que este comentário dizia até
 * 19/08/2026: **impeditiva com `teto: 'nenhum'` não é compensável.** Nenhuma
 * soma de fatores bons transforma "duas fontes discordam" ou "não entrou
 * registro nenhum" em conclusão — essas travam a confiança em `baixa` e o turno
 * termina em abstenção.
 *
 * Impeditiva que só LIMITA O DEGRAU é outra coisa. `causa_sem_lastro` nega a
 * frase causal e deixa a comparação de pé; tratá-la como trava fazia toda
 * pergunta começada por "por que" nascer com confiança `baixa`, inclusive com
 * pontuação 1,000 e três fontes independentes. Uma confiança constante para uma
 * classe inteira de perguntas não mede nada — a auditoria independente mediu
 * exatamente isso, e o cabeçalho antigo descrevia um comportamento que o código
 * deixou de ter.
 *
 * O modo de falhar que a regra continua barrando é o de sempre: num escore
 * único, o defeito grave vira uma parcela pequena de uma média boa.
 *
 * Puro: sem relógio, sem rede, sem domínio.
 */

import type { Confianca, Evidencia } from './Investigacao';
import {
  DERIVADAS,
  ordenarRessalvas,
  type DegrauSustentado,
  type Ressalva,
  type TipoDeConclusao,
} from './MotorCritica';
import { classificarCobertura } from './Cobertura';
import type { Procedencia } from './Verdade';

// ---------------------------------------------------------------------------
// 1. Os fatores da confiança
// ---------------------------------------------------------------------------

export interface FatorDeConfianca {
  /** `procedencia`, `cobertura`, `consistencia`, `recencia`, `independencia`, `volume`. */
  readonly nome: string;
  /** 0 a 1. */
  readonly nota: number;
  readonly peso: number;
  /** Uma linha explicando a nota. É isto que a IARA repete quando perguntam. */
  readonly porque: string;
}

export interface Confiabilidade {
  readonly confianca: Confianca;
  /** Média ponderada dos fatores, 0 a 1. */
  readonly pontuacao: number;
  readonly fatores: readonly FatorDeConfianca[];
  /** Houve ressalva impeditiva? Se sim, a pontuação não manda. */
  readonly travada: boolean;
}

/**
 * Pesos declarados. `cobertura` e `procedencia` pesam o dobro de `recencia` e
 * `independencia` porque respondem perguntas diferentes: os dois primeiros
 * dizem se o número É o número; os outros dois, o quanto ele pode ter mudado ou
 * ter vindo de um lugar só. Um número errado com três fontes frescas continua
 * errado.
 */
export const PESOS_DE_CONFIANCA = {
  procedencia: 3,
  cobertura: 3,
  consistencia: 2,
  recencia: 1,
  independencia: 1,
  volume: 1,
} as const;

export const LIMIAR_CONFIANCA = { alta: 0.75, media: 0.5 } as const;

const FORCA_PROCEDENCIA: Record<Procedencia, number> = {
  fato_verificado: 1,
  fato: 0.9,
  resultado_ferramenta: 0.7,
  documento: 0.6,
  memoria: 0.45,
  inferencia: 0.3,
  hipotese: 0.15,
  desconhecido: 0,
};

const NOTA_COBERTURA = {
  completa: 1,
  alta: 0.85,
  parcial: 0.55,
  insuficiente: 0.25,
  vazia: 0,
} as const;

const media = (ns: readonly number[]): number =>
  ns.length === 0 ? 0 : ns.reduce((a, b) => a + b, 0) / ns.length;

/**
 * A confiança, calculada.
 *
 * `agora` é injetado — este módulo não lê relógio, pela mesma razão de
 * `MotorCritica`: um cálculo que depende do relógio do processo não é
 * reproduzível num teste, e confiança que muda entre execuções não é confiança.
 */
export function avaliarConfianca(entrada: {
  readonly evidencias: readonly Evidencia[];
  readonly ressalvas: readonly Ressalva[];
  readonly agora: string;
  /**
   * Quantas divergências `R4` engoliu por assumir recortes diferentes.
   *
   * Opcional para não quebrar chamador antigo, mas o Kernel sempre passa: uma
   * suposição que o motor fez SOBRE O DADO limita o quanto ele pode se dizer
   * seguro. Ver `ResultadoDaCritica.divergencias_silenciadas`.
   */
  readonly divergencias_silenciadas?: number;
}): Confiabilidade {
  const diretas = entrada.evidencias.filter((e) => e.relevancia === 'direta');

  /**
   * TRAVAR É PARA A IMPEDITIVA QUE DERRUBA A EVIDÊNCIA, NÃO PARA A QUE SÓ
   * LIMITA O DEGRAU — a correção do falso positivo achado na auditoria
   * independente.
   *
   * `causa_sem_lastro` é impeditiva e tem `teto: 'comparativa'`: ela nega a
   * frase causal e deixa a comparação de pé. Tratá-la como trava fazia TODA
   * pergunta começada por "por que" nascer com confiança `baixa` — medido com
   * três fontes independentes, cobertura 100% e `fato_verificado`: pontuação
   * 1,000 e confiança `baixa`, as duas gravadas lado a lado na linha de
   * auditoria. Uma confiança constante para uma classe inteira de perguntas não
   * mede nada, e ensina o operador a ignorar o campo.
   *
   * O discriminador é `teto === 'nenhum'`: aí a evidência não sustenta
   * afirmação nenhuma (contradição, conjunto vazio, número não finito), e aí
   * sim nenhum outro fator compensa.
   */
  const travada = entrada.ressalvas.some(
    (r) => r.gravidade === 'impeditiva' && r.teto === 'nenhum',
  );

  /**
   * NADA FOI MEDIDO — piso independente da pontuação.
   *
   * Quando toda evidência direta é derivada (dedução, hipótese, desconhecido), a
   * média ponderada ainda pode chegar a `media` porque consistência, recência e
   * volume "vão bem" — eles vão bem sobre nada. Um raciocínio inteiro construído
   * sem uma medição sequer é `baixa` por definição, não por aritmética.
   */
  const semMedicao =
    diretas.length > 0 && diretas.every((e) => DERIVADAS.includes(e.procedencia));

  /**
   * SÓ LEMBRANÇA, NENHUMA LEITURA NOVA — o teto que faltava.
   *
   * `memoria` não é derivada (alguém observou aquilo um dia), então não entra em
   * `DERIVADAS` e não vira `baixa`. Mas três lembranças COM cobertura declarada
   * — o que um shard que gravou "300 de 300 cargas" carrega — somavam 0,850 e
   * saíam como `alta`. A terceira passada da auditoria mostrou que o cenário
   * H19 passava pelo caminho errado: sem cobertura, a pontuação já caía sozinha,
   * e o defeito que o cenário NOMEAVA continuava aberto. Holdout que nomeia um
   * defeito e não o reproduz é pior que holdout nenhum, porque fecha o item.
   *
   * `documento` entra junto pela mesma razão: verdadeiro na data em que foi
   * escrito não é o mesmo que verdadeiro agora.
   */
  const soLembranca =
    diretas.length > 0 &&
    diretas.every(
      (e) => FORCA_PROCEDENCIA[e.procedencia] <= FORCA_PROCEDENCIA.memoria,
    );

  /**
   * ENGOLI UMA DIVERGÊNCIA — não posso dizer "alta".
   *
   * Ver `ResultadoDaCritica.divergencias_silenciadas`. Este teto é o que impede
   * o desfecho medido na terceira auditoria: 73 contra 95 motoristas saindo com
   * confiança `alta` e rodapé VAZIO só porque a frase tinha "devo" dentro. Com o
   * teto, a linha de confiança volta ao rodapé e o operador vê que houve
   * suposição.
   */
  const engoliuDivergencia = (entrada.divergencias_silenciadas ?? 0) > 0;

  const notaProcedencia = media(diretas.map((e) => FORCA_PROCEDENCIA[e.procedencia]));

  /**
   * COBERTURA NÃO DECLARADA VALE 0,5, NÃO 1. É a mesma decisão de `R3` no motor
   * de crítica, e pelo mesmo motivo: silêncio não é garantia. Quem não disse
   * sobre quanto mediu fica no meio da escala, não no topo dela.
   */
  const notaCobertura = media(
    diretas.map((e) => (e.cobertura ? NOTA_COBERTURA[classificarCobertura(e.cobertura)] : 0.5)),
  );

  const houveContradicao = entrada.ressalvas.some((r) => r.codigo === 'contradicao_entre_fontes');
  const notaConsistencia = houveContradicao ? 0 : 1;

  const velho = entrada.ressalvas.find((r) => r.codigo === 'dado_envelhecido');
  const notaRecencia = velho ? (velho.gravidade === 'seria' ? 0.3 : 0.7) : 1;

  const fontes = new Set(diretas.map((e) => e.fonte)).size;
  const notaIndependencia = fontes >= 3 ? 1 : fontes === 2 ? 0.8 : 0.4;

  const volumes = diretas
    .map((e) => e.cobertura?.consideradas)
    .filter((n): n is number => typeof n === 'number');
  const notaVolume =
    volumes.length === 0 ? 0.5 : Math.min(1, media(volumes) / 20);

  const fatores: FatorDeConfianca[] = [
    {
      nome: 'procedencia',
      nota: notaProcedencia,
      peso: PESOS_DE_CONFIANCA.procedencia,
      porque:
        diretas.length === 0
          ? 'nenhuma evidência direta'
          : `${diretas.length} evidência(s) direta(s), a mais fraca é ${
              diretas.reduce((a, b) =>
                FORCA_PROCEDENCIA[a.procedencia] <= FORCA_PROCEDENCIA[b.procedencia] ? a : b,
              ).procedencia
            }`,
    },
    {
      nome: 'cobertura',
      nota: notaCobertura,
      peso: PESOS_DE_CONFIANCA.cobertura,
      porque: diretas.some((e) => e.cobertura)
        ? `menor cobertura declarada: ${Math.min(
            ...diretas.filter((e) => e.cobertura).map((e) => e.cobertura?.percentual ?? 0),
          ).toFixed(1)}%`
        : 'nenhuma evidência declarou cobertura',
    },
    {
      nome: 'consistencia',
      nota: notaConsistencia,
      peso: PESOS_DE_CONFIANCA.consistencia,
      porque: houveContradicao ? 'há fontes discordando' : 'nenhuma contradição entre fontes',
    },
    {
      nome: 'recencia',
      nota: notaRecencia,
      peso: PESOS_DE_CONFIANCA.recencia,
      porque: velho ? velho.texto : 'dado dentro da janela de frescor',
    },
    {
      nome: 'independencia',
      nota: notaIndependencia,
      peso: PESOS_DE_CONFIANCA.independencia,
      porque: `${fontes} fonte(s) distinta(s)`,
    },
    {
      nome: 'volume',
      nota: notaVolume,
      peso: PESOS_DE_CONFIANCA.volume,
      porque:
        volumes.length === 0
          ? 'nenhum tamanho de conjunto declarado'
          : `média de ${Math.round(media(volumes))} registro(s) por métrica`,
    },
  ];

  const somaPesos = fatores.reduce((s, f) => s + f.peso, 0);
  const pontuacao = fatores.reduce((s, f) => s + f.nota * f.peso, 0) / somaPesos;

  /**
   * O TETO DA RESSALVA SÉRIA — achado pelo holdout, não pelo desenho.
   *
   * H02 (margem de 2024 sobre 88% das cargas) e H08 (contagem de "agora" com um
   * mês de idade) saíam com confiança ALTA. A média ponderada estava certa
   * aritmeticamente e errada como resposta: cinco fatores quase perfeitos
   * diluíam o único que importava naquele turno. É o modo clássico de uma
   * avaliação ponderada falhar — o defeito grave vira uma parcela pequena de
   * uma média boa.
   *
   * A regra é a mesma família de `travada`, um degrau mais fraca: `impeditiva`
   * prende em `baixa`, `seria` prende em `media`. Nenhuma das duas é
   * compensável, porque "12% das cargas não têm preço" não fica menos verdade
   * porque as outras cinco dimensões estão boas.
   *
   * `leve` continua sem teto de propósito: se toda ressalva puxasse a confiança
   * para baixo, `alta` nunca apareceria, e uma escala cujo topo é inalcançável
   * não informa nada.
   */
  const grave = entrada.ressalvas.some((r) => r.gravidade === 'seria');

  const porPontuacao: Confianca =
    pontuacao >= LIMIAR_CONFIANCA.alta
      ? 'alta'
      : pontuacao >= LIMIAR_CONFIANCA.media
        ? 'media'
        : 'baixa';

  const tetoMedia = grave || soLembranca || engoliuDivergencia;
  const confianca: Confianca =
    travada || semMedicao
      ? 'baixa'
      : tetoMedia && porPontuacao === 'alta'
        ? 'media'
        : porPontuacao;

  return { confianca, pontuacao, fatores, travada };
}

/**
 * POR QUE esta confiança. A frase que a IARA usa quando perguntam.
 *
 * Nomeia o fator que MAIS puxou para baixo, não todos: uma explicação que lista
 * seis fatores é uma explicação que ninguém lê. O fator dominante é o que a
 * pessoa precisa saber para decidir se busca mais dado ou age com o que tem.
 */
export function explicarConfianca(c: Confiabilidade): string {
  if (c.travada) {
    return 'Confiança baixa, e não é questão de grau: há uma objeção que nenhum outro fator compensa.';
  }
  /**
   * O FATOR DOMINANTE É O DE MAIOR PERDA, não o de menor contribuição.
   *
   * A primeira versão comparava `nota × peso` e o próprio teste a derrubou:
   * `independencia` tem peso 1, então mesmo com nota 0,4 ela produz 0,4 —
   * menos que `cobertura` com nota 0,55 e peso 3 (1,65). O critério elegia
   * sempre o fator mais leve da lista, e a explicação apontava para o lado
   * errado justamente quando a cobertura era o problema.
   *
   * `(1 − nota) × peso` mede quanto daquele fator FICOU NA MESA. É a conta que
   * corresponde à pergunta que a pessoa faz — "o que eu conserto primeiro?".
   */
  const pior = c.fatores.reduce((a, b) =>
    (1 - a.nota) * a.peso >= (1 - b.nota) * b.peso ? a : b,
  );
  const rotulo = { alta: 'alta', media: 'média', baixa: 'baixa' }[c.confianca];
  return `Confiança ${rotulo} (${(c.pontuacao * 100).toFixed(0)}/100). O que mais pesou contra: ${pior.nome} — ${pior.porque}.`;
}

// ---------------------------------------------------------------------------
// 2. O veredicto
// ---------------------------------------------------------------------------

export type VeredictoAnalitico = 'concluir' | 'concluir_com_ressalva' | 'abster';

export interface Suficiencia {
  readonly veredicto: VeredictoAnalitico;
  readonly degrau: DegrauSustentado;
  readonly confiabilidade: Confiabilidade;
  /**
   * O TEXTO DETERMINÍSTICO da abstenção ou da ressalva. Preenchido sempre que o
   * veredicto não é `concluir` — e é este texto que vai ao operador quando o
   * veredicto é `abster`, sem passar pela LLM.
   */
  readonly texto: string;
  /** O que destravaria isto. Vazio quando não há abstenção. */
  readonly o_que_falta: readonly string[];
}

/**
 * O QUE FALTA, por código de ressalva — e é isto que separa "não sei" de "não
 * sei e não sei o que fazer a respeito".
 *
 * A missão pede duas frases diferentes: "não há evidência suficiente" e
 * "preciso consultar X antes de recomendar". A segunda só existe se o sistema
 * souber nomear o X, e o X é consequência do código da ressalva — não de uma
 * frase que a LLM invente.
 */
const O_QUE_DESTRAVA: Record<string, string> = {
  ausencia_como_zero:
    'confirmar se realmente não houve registro no período ou se a fonte não foi lida inteira',
  contradicao_entre_fontes: 'resolver qual das fontes está certa antes de eu dar um número',
  procedencia_fraca: 'apurar o dado numa fonte, em vez de deduzir',
  cobertura_parcial: 'completar o que ficou de fora do recorte',
  cobertura_nao_declarada: 'saber sobre quantos registros o número foi calculado',
  denominador_movel: 'igualar o recorte dos dois lados da comparação',
  causa_sem_lastro: 'mexer na variável suspeita e medir o efeito, mantendo o resto igual',
  amostra_pequena: 'juntar mais registros no grupo',
  dado_envelhecido: 'reler a fonte',
  fonte_unica: 'conferir em uma segunda fonte',
};

/**
 * Decide, e escreve a frase.
 *
 * A ABSTENÇÃO É ESCOPADA, não total. `abster` quer dizer "não afirmo ISTO", e
 * `degrau` diz o que ainda dá para afirmar. Uma IARA que se cala inteira porque
 * não pode provar causa é tão inútil quanto uma que afirma causa sem lastro — o
 * comportamento sênior é descer o degrau e dizer que desceu.
 */
export function decidirSuficiencia(entrada: {
  readonly tipo_pretendido: TipoDeConclusao;
  readonly degrau: DegrauSustentado;
  readonly ressalvas: readonly Ressalva[];
  readonly confiabilidade: Confiabilidade;
}): Suficiencia {
  const ordenadas = ordenarRessalvas(entrada.ressalvas);
  const impeditivas = ordenadas.filter((r) => r.gravidade === 'impeditiva');
  const serias = ordenadas.filter((r) => r.gravidade === 'seria');

  const oQueFalta = [...new Set([...impeditivas, ...serias].map((r) => O_QUE_DESTRAVA[r.codigo]))]
    .filter(Boolean);

  if (entrada.degrau === 'nenhum') {
    return {
      veredicto: 'abster',
      degrau: 'nenhum',
      confiabilidade: entrada.confiabilidade,
      texto:
        'Não tenho evidência suficiente para concluir isso, e prefiro dizer isso a te dar um número que ' +
        'não se sustenta.\n\n' +
        impeditivas.map((r) => `— ${r.texto}`).join('\n') +
        (oQueFalta.length > 0 ? `\n\nO que destravaria: ${oQueFalta.join('; ')}.` : ''),
      o_que_falta: oQueFalta,
    };
  }

  if (impeditivas.length > 0 || serias.length > 0) {
    return {
      veredicto: 'concluir_com_ressalva',
      degrau: entrada.degrau,
      confiabilidade: entrada.confiabilidade,
      texto: [...impeditivas, ...serias].map((r) => r.texto).join('\n'),
      o_que_falta: oQueFalta,
    };
  }

  const leves = ordenadas.filter((r) => r.gravidade === 'leve');
  return {
    veredicto: leves.length > 0 ? 'concluir_com_ressalva' : 'concluir',
    degrau: entrada.degrau,
    confiabilidade: entrada.confiabilidade,
    texto: leves.map((r) => r.texto).join('\n'),
    o_que_falta: [],
  };
}
