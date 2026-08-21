/**
 * ADERÊNCIA — o texto observado na tela contra a `ParadaEsperada` do POP.
 *
 * É a peça que faltava para a percepção deixar de dizer só "mudou" e passar a
 * dizer "mudou PARA a tela desta etapa" — ou "para uma que não é nenhuma das
 * duas". As duas metades já existiam e nunca tinham se encostado:
 * `descreverParada` produz o que se ESPERA ver, e o OCR produz o que se VÊ.
 *
 * A REGRA QUE ESTE ARQUIVO NÃO PODE QUEBRAR, e ela é a mais fácil de quebrar
 * sem perceber: **aderência não é conferência.** `ConferenciaDaParada` é o que
 * o guardião aceita como evidência `anexada` para autorizar um avanço, e ela
 * nasce de um print que a PESSOA anexou. O que sai daqui nasce de uma leitura
 * automática, contínua, que ninguém pediu quadro a quadro — e transformá-la em
 * evidência daria à observação o poder de andar com o procedimento sozinha.
 *
 * Então este módulo produz uma LEITURA, que muda o que a IARA DIZ, e nada mais.
 * `testes/percepcao-aderencia.test.ts` prova que nenhum caminho de código monta
 * uma `ConferenciaDaParada` a partir daqui.
 *
 * PURO E SEM I/O. Mora em `lib/` porque junta dois contratos de `lib/` —
 * `ParadaEsperada` (procedimento) e o texto mascarado (percepção) — e não
 * conhece nem o motor nem o Braço.
 */

import type { ParadaEsperada, SituacaoNaParada } from './procedimento';

/**
 * Palavras que não distinguem tela nenhuma.
 *
 * Lista curta e explícita, não uma heurística de frequência: um corpus de 11
 * documentos é pequeno demais para tirar stopwords dele, e uma lista tirada de
 * frequência acabaria removendo justamente o vocabulário da casa — "coleta",
 * "manifesto", "OCI" aparecem em quase todo slide E são o que identifica a tela.
 */
const LIGACOES = new Set([
  'para',
  'pela',
  'pelo',
  'com',
  'sem',
  'que',
  'uma',
  'uns',
  'umas',
  'dos',
  'das',
  'nos',
  'nas',
  'aos',
  'como',
  'onde',
  'quando',
  'depois',
  'antes',
  'entao',
  'apos',
  'este',
  'esta',
  'esse',
  'essa',
  'isso',
  'aqui',
  'deve',
  'devera',
  'sera',
  'apenas',
  'tambem',
  'mesmo',
  'todos',
  'todas',
  'cada',
  'seja',
  'sendo',
  'pode',
  'poder',
  'fazer',
  'feito',
  'clicar',
  'clique',
  'selecionar',
  'selecione',
  'preencher',
  'preencha',
  'informar',
  'informe',
]);

/**
 * O piso de tamanho de um termo. Quatro letras.
 *
 * Abaixo disso as palavras do português são quase todas ligação, e as siglas
 * curtas do domínio (`OCI`, `CTE`, `MDF`) entram por outro caminho: elas vêm das
 * MARCAS do POP, que não passam por este filtro.
 */
const MIN_TERMO = 4;

function normalizar(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Os termos que identificam esta parada.
 *
 * Vêm de três lugares, e a ordem de importância é a inversa da ordem de
 * tamanho: as MARCAS (os rótulos das setas do POP) são o sinal mais forte
 * porque são o que o autor do procedimento escolheu apontar; o título da etapa
 * vem depois; o texto do slide é o mais ruidoso.
 *
 * As marcas entram SEM o filtro de tamanho: `OCI` tem três letras e é
 * exatamente o tipo de termo que identifica uma tela.
 */
export function termosDaParada(parada: ParadaEsperada): readonly string[] {
  const termos = new Set<string>();

  for (const marca of parada.marcas) {
    for (const t of normalizar(marca).split(/[^a-z0-9]+/)) {
      /* Rótulo que é só número (`1`, `2`, `3`) não identifica tela nenhuma — é a
         ordem do passo, não o conteúdo dele. */
      if (t.length >= 2 && !/^\d+$/.test(t)) termos.add(t);
    }
  }

  for (const fonte of [parada.etapa, parada.titulo, parada.instrucao]) {
    for (const t of normalizar(fonte).split(/[^a-z0-9]+/)) {
      if (t.length >= MIN_TERMO && !LIGACOES.has(t) && !/^\d+$/.test(t)) termos.add(t);
    }
  }

  return [...termos];
}

export interface Aderencia {
  /** Os termos que a parada esperava ver. */
  readonly esperados: readonly string[];
  /** Os que de fato apareceram no texto observado. */
  readonly vistos: readonly string[];
  /**
   * `vistos / esperados`, de 0 a 1.
   *
   * É uma MEDIDA, não uma confiança — a distinção é a mesma que separa a
   * distância de Hamming de um `certeza: 0.94`. Ninguém a digita, ela é contável
   * olhando as duas listas, e ela não desempata afirmação nenhuma: quem responde
   * "quão sustentada é esta frase?" continua sendo `Verdade.ts`, e a resposta
   * para tudo que sai daqui é `inferencia`.
   */
  readonly proporcao: number;
}

export function aderenciaAParada(parada: ParadaEsperada, textoObservado: string): Aderencia {
  const esperados = termosDaParada(parada);
  const observado = normalizar(textoObservado);
  const vistos = esperados.filter((t) => observado.includes(t));
  return {
    esperados,
    vistos,
    proporcao: esperados.length === 0 ? 0 : vistos.length / esperados.length,
  };
}

/**
 * PROPORÇÃO MÍNIMA PARA RECONHECER UMA PARADA.
 *
 * MEDIDO por `scripts/diagnostico/calibrar-aderencia.ts` sobre os 9 POPs
 * conduzíveis (62 paradas com termos), com a tela simulada a partir do texto do
 * POP: 60% das palavras sobrevivem e entra cromo de janela como ruído.
 *
 *   SINAL   (a própria parada)      p05=0,20  p50=0,57  p95=0,73  média 0,54
 *   VIZINHA (a parada seguinte)     p05=0,00  p50=0,17  p95=0,53  média 0,19
 *   ALHEIA  (parada de outro POP)   p05=0,00  p50=0,04  p95=0,20  média 0,06
 *
 * As caudas SE TOCAM em 0,20 — não existe limiar que separe as distribuições
 * inteiras, e escolher pelo "onde não há sobreposição" teria sido escolher um
 * número que não existe. A varredura resolveu por custo de erro:
 *
 *   limiar  na_etapa  desvio falso  tela alheia reconhecida
 *    0,15      92%         0%              11%
 *    0,20      90%         3%              10%
 *    0,25      87%         6%               3%   <-- o joelho
 *    0,30      84%        10%               3%
 *    0,40      81%        13%               2%
 *    0,50      66%        27%               0%
 *
 * `0,25` é onde o reconhecimento falso de uma tela de OUTRO procedimento cai de
 * 10% para 3%. Acima disso paga-se falso desvio sem comprar nada: 0,30 e 0,34
 * têm o mesmo 3% de tela alheia e quase o dobro de "essa não é a sua tela" dito
 * a quem estava na tela certa.
 *
 * OS DOIS ERROS NÃO CUSTAM IGUAL, e é isso que a escolha reflete. Dizer "essa
 * tela não é a desta etapa" a quem está na tela certa ensina o operador a
 * ignorar a IARA. Deixar de reconhecer custa uma frase a menos.
 *
 * O QUE ESTA MEDIÇÃO NÃO É: uma medição contra o GW. O texto do POP é proxy da
 * tela — e proxy otimista, porque foi escrito olhando para ela. Numa tela real a
 * proporção tende a cair. É por isso que a leitura errada custa uma frase e
 * nunca um avanço.
 */
export const PROPORCAO_MINIMA = 0.25;

/**
 * QUANTO A MELHOR PRECISA GANHAR DA SEGUNDA para a escolha valer.
 *
 * Sem esta margem, duas paradas quase empatadas fariam a IARA afirmar uma delas
 * por diferença de um termo — e paradas vizinhas do mesmo POP se parecem muito.
 * Empate vira `indefinida`, que é a resposta honesta.
 */
export const MARGEM_MINIMA = 0.1;

/**
 * O QUE A IARA CONCLUI da comparação. Quatro valores, e nenhum deles é
 * "etapa concluída".
 *
 * `resultado_observado` é o que mais precisa da distinção: a tela agora se
 * parece com a PRÓXIMA parada. Isso é forte — sugere que a ação anterior surtiu
 * efeito — e continua não sendo prova de que a pessoa fez o que o POP mandava.
 * Ela pode ter chegado ali por outro caminho, ou a tela pode ter sido aberta por
 * um colega. Quem conclui etapa é o operador, pelo guardião.
 */
export type LeituraDoPercurso =
  /** A tela observada bate com a parada em que a pessoa está. */
  | 'na_etapa'
  /** A tela observada bate com a PRÓXIMA parada. NÃO é etapa concluída. */
  | 'resultado_observado'
  /** Não bate com nenhuma das duas. É o DESVIO — sem causa atribuída. */
  | 'fora_do_percurso'
  /** Não deu para decidir: texto curto, empate, ou nada reconhecido. */
  | 'indefinida';

export interface ComparacaoComOPercurso {
  readonly leitura: LeituraDoPercurso;
  readonly atual: Aderencia;
  readonly proxima: Aderencia | null;
  /**
   * A tradução para o vocabulário que o resto do SOS já fala.
   *
   * REUSA `SituacaoNaParada` em vez de inventar um enum paralelo — é a mesma
   * pergunta ("onde a pessoa está em relação à parada?") respondida por outro
   * instrumento. O que NÃO acontece é este valor virar `ConferenciaDaParada`:
   * aquela estrutura carrega o anexo que a pessoa mandou, e aqui não houve
   * pessoa nenhuma anexando coisa alguma.
   */
  readonly situacao: SituacaoNaParada;
}

/**
 * Compara o texto observado com a parada atual E com a próxima.
 *
 * DUAS COMPARAÇÕES E NÃO UMA, e é isso que separa desvio de progresso. Com uma
 * só, "a tela não é a da etapa 3" cobre tanto a pessoa que avançou para a 4
 * quanto a que abriu o e-mail — e essas duas situações pedem respostas opostas.
 *
 * `proxima` é `null` na última parada, e aí só existe `na_etapa` ou desvio: não
 * há próxima tela para a qual progredir.
 */
export function compararComOPercurso(
  atual: ParadaEsperada,
  proxima: ParadaEsperada | null,
  textoObservado: string,
  /**
   * Os limiares, injetáveis SÓ para a calibração poder varrê-los.
   *
   * Sem isto, o script de calibração teria de reimplementar a decisão para testar
   * outro valor — e duas cópias da mesma decisão divergem no dia em que uma
   * recebe a correção. O padrão é a constante medida; ninguém em produção passa
   * este parâmetro.
   */
  limiares: { proporcaoMinima?: number; margemMinima?: number } = {},
): ComparacaoComOPercurso {
  const proporcaoMinima = limiares.proporcaoMinima ?? PROPORCAO_MINIMA;
  const margemMinima = limiares.margemMinima ?? MARGEM_MINIMA;
  const aAtual = aderenciaAParada(atual, textoObservado);
  const aProxima = proxima ? aderenciaAParada(proxima, textoObservado) : null;

  const indefinida: ComparacaoComOPercurso = {
    leitura: 'indefinida',
    atual: aAtual,
    proxima: aProxima,
    situacao: 'indefinido',
  };

  /* TEXTO CURTO NÃO DECIDE NADA. Uma janela minimizada, uma tela de carregamento
     ou um OCR que falhou produzem duas ou três palavras — e afirmar desvio a
     partir disso é afirmar sobre o que não se leu. */
  if (textoObservado.trim().length < 20) return indefinida;
  if (aAtual.esperados.length === 0) return indefinida;

  const melhorAtual = aAtual.proporcao;
  const melhorProxima = aProxima?.proporcao ?? 0;

  if (melhorAtual < proporcaoMinima && melhorProxima < proporcaoMinima) {
    return { leitura: 'fora_do_percurso', atual: aAtual, proxima: aProxima, situacao: 'outra_tela' };
  }

  if (Math.abs(melhorAtual - melhorProxima) < margemMinima) {
    /* EMPATE. Paradas vizinhas do mesmo POP descrevem telas parecidas; escolher
       a maior por um termo de diferença seria produzir uma afirmação precisa
       sobre uma medição que não distingue. */
    return indefinida;
  }

  return melhorAtual > melhorProxima
    ? { leitura: 'na_etapa', atual: aAtual, proxima: aProxima, situacao: 'na_etapa' }
    : {
        leitura: 'resultado_observado',
        atual: aAtual,
        proxima: aProxima,
        /**
         * `outra_tela`, e não `na_etapa`.
         *
         * A pessoa está numa tela que NÃO é a da parada atual — e é a tradução
         * honesta para o vocabulário do SOS. Que essa outra tela seja a próxima
         * do procedimento é informação a mais, e ela vive em `leitura`, não
         * aqui. Traduzir progresso como `na_etapa` faria a situação dizer que a
         * pessoa está onde ela não está.
         */
        situacao: 'outra_tela',
      };
}
