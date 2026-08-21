/**
 * Guardião do procedimento — as decisões que NÃO podem depender da LLM.
 *
 * É o `POPGuardian` da auditoria de 19/08/2026, com nome em português pelo
 * invariante de nomenclatura do repositório. O que ele responde:
 *
 *   podeIniciar        este documento sustenta uma condução?
 *   podeAvancar        esta execução pode sair desta parada?
 *   classificarEvidencia   o que sustenta "eu fiz"?
 *
 * PURO E DETERMINÍSTICO. Sem I/O, sem estado, sem relógio próprio — o instante
 * entra por parâmetro. É o que permite testá-lo contra um oráculo escrito à mão
 * em vez de contra a própria implementação.
 *
 * ONDE ESTAS REGRAS MORAVAM ANTES: espalhadas dentro de `avancar_procedimento`,
 * misturadas com a redação da resposta. Duas consequências, e a segunda é a que
 * dói: não dava para testá-las sem montar meia habilidade, e a próxima regra
 * seria escrita no terceiro lugar por quem não visse as duas primeiras.
 *
 * O QUE ELE NÃO FAZ: mover estado. Ele responde; quem grava é
 * `ProcedimentosEmCurso`. Um guardião que também executa é um guardião que se
 * autoriza.
 */

import {
  acharPosicao,
  podeGuiar,
  posicoes,
  type ConferenciaDaParada,
  type Desvio,
  type EstadoDaExecucao,
  type Procedimento,
  type TipoDeEvidencia,
} from '../../../lib/procedimento';
import { normalizar } from '../texto';

/** A posição salva, no mínimo que o guardião precisa saber. */
export interface PosicaoEmCurso {
  readonly codigo: string;
  readonly etapa: number;
  readonly slide: number;
  readonly hash_origem: string;
}

export interface VereditoDoGuardiao {
  readonly permitido: boolean;
  /** Frase para o operador. Vazia quando permitido e nada precisa ser dito. */
  readonly motivo: string;
  /** Em que estado a execução fica DEPOIS desta decisão. */
  readonly estado: EstadoDaExecucao;
  readonly desvio: Desvio | null;
}

/**
 * Frases com que uma pessoa declara ter feito uma etapa.
 *
 * Enumeradas, não inferidas: a diferença entre "o operador confirmou" e "a LLM
 * achou que confirmou" é exatamente o que esta camada existe para preservar.
 *
 * `proximo`/`avanca` contam como declaração, e é uma decisão de projeto: pedir
 * para seguir É afirmar que terminou. Exigir a palavra "fiz" produziria um
 * sistema que responde "não entendi" a quem já disse o que queria — e a pessoa
 * digitaria "fiz" na segunda tentativa, sem que nada tivesse sido verificado a
 * mais. Rigor que só cria uma volta a mais não é rigor.
 */
const DECLARA_CONCLUSAO =
  /\b(fiz|feito|fez|pronto|prontinho|ok|okay|consegui|terminei|termin[ao]u|conclui|concluido|realizado|deu certo|funcionou|proximo|proxima|avanca|avancar|segue|seguinte|continua|continuar)\b/;

/**
 * O que sustenta "esta etapa foi feita".
 *
 * A FONTE É O `enunciado` — o texto original do operador —, nunca um parâmetro
 * que a camada de raciocínio preencheu. Se a evidência viesse de campo que a
 * LLM escreve, a LLM poderia declarar concluído um passo que ninguém tocou:
 * adversarial nº 29 da auditoria.
 */
export function classificarEvidencia(
  enunciado: string,
  opcoes: {
    /**
     * A conferência de tela desta MESMA parada, quando existe. Já validada por
     * `conferenciaVale` — este módulo é puro e não sabe qual é a parada atual.
     */
    conferencia?: ConferenciaDaParada | null;
    dadoInformado?: string;
  } = {},
): TipoDeEvidencia {
  /**
   * PRINT SÓ CONTA DEPOIS DE CONFERIDO, e essa é a correção de 20/08/2026.
   *
   * A versão anterior devolvia `anexada` para qualquer `temAnexo: true` — um
   * arquivo chegou, logo a etapa está sustentada. Duas coisas erradas ali: a
   * opção nunca era passada por ninguém (o caminho ficou declarado e morto
   * durante um dia), e se fosse, uma imagem que a IARA não conseguiu ler
   * valeria tanto quanto uma que ela leu e confirmou.
   *
   * `indefinido` NÃO vira `anexada` de propósito: "não consegui ler sua tela"
   * não sustenta nada, e o avanço cai de volta no que a PESSOA disse. É a mesma
   * regra de `interpretar` em `AnaliseVisual.ts`, do outro lado da fronteira —
   * não ter lido nunca vira confirmação.
   */
  if (opcoes.conferencia?.situacao === 'na_etapa') return 'anexada';
  const t = normalizar(enunciado ?? '');
  if (opcoes.dadoInformado && opcoes.dadoInformado.trim().length > 0) return 'informada';
  if (DECLARA_CONCLUSAO.test(t)) return 'declarada';
  return 'nenhuma';
}

function desvio(tipo: Desvio['tipo'], detalhe: string, instante: string): Desvio {
  return { tipo, detalhe, instante };
}

/** Este documento sustenta uma condução etapa a etapa? */
export function podeIniciar(
  p: Procedimento,
  instante = new Date().toISOString(),
): VereditoDoGuardiao {
  if (!podeGuiar(p)) {
    return {
      permitido: false,
      motivo: `o documento ${p.codigo} não sustenta uma condução (${p.qualidade})`,
      estado: 'bloqueada',
      desvio: desvio('documento_contraditorio', `${p.codigo} rev=${p.revisao}`, instante),
    };
  }
  if (posicoes(p).length === 0) {
    return {
      permitido: false,
      motivo: `o documento ${p.codigo} não tem nenhuma etapa legível`,
      estado: 'bloqueada',
      desvio: desvio('posicao_perdida', `${p.codigo} sem posições`, instante),
    };
  }
  return { permitido: true, motivo: '', estado: 'aguardando_evidencia', desvio: null };
}

/**
 * Esta execução pode sair desta parada?
 *
 * A ORDEM DAS RECUSAS É DELIBERADA, da mais grave para a menos. Versão
 * divergente vem antes de tudo: continuar sobre um documento que mudou é o
 * defeito que não quebra nada e produz um número bonito ("etapa 4 de 8") sobre
 * outra coisa.
 */
export function podeAvancar(entrada: {
  procedimento: Procedimento;
  emCurso: PosicaoEmCurso;
  evidencia: TipoDeEvidencia;
  /** A conferência de tela desta parada, quando há. Já validada pelo chamador. */
  conferencia?: ConferenciaDaParada | null;
  instante?: string;
}): VereditoDoGuardiao {
  const { procedimento: p, emCurso, evidencia, conferencia } = entrada;
  const instante = entrada.instante ?? new Date().toISOString();

  if (p.hash_origem !== emCurso.hash_origem) {
    return {
      permitido: false,
      motivo: `o ${p.codigo} foi revisado depois que esta execução começou`,
      estado: 'bloqueada',
      desvio: desvio(
        'versao_divergente',
        `em_curso=${emCurso.hash_origem} vigente=${p.hash_origem}`,
        instante,
      ),
    };
  }

  if (!podeGuiar(p)) {
    return {
      permitido: false,
      motivo: `o ${p.codigo} deixou de sustentar uma condução (${p.qualidade})`,
      estado: 'bloqueada',
      desvio: desvio('documento_contraditorio', `${p.codigo} rev=${p.revisao}`, instante),
    };
  }

  if (!acharPosicao(p, emCurso.etapa, emCurso.slide)) {
    return {
      permitido: false,
      motivo: 'a etapa em que você estava não existe mais neste procedimento',
      estado: 'bloqueada',
      desvio: desvio(
        'posicao_perdida',
        `${p.codigo} etapa=${emCurso.etapa} slide=${emCurso.slide}`,
        instante,
      ),
    };
  }

  /**
   * SEM EVIDÊNCIA NENHUMA, NÃO ANDA — e este é o ponto do guardião inteiro.
   *
   * O caso real que isto barra não é o operador distraído: é a CAMADA DE
   * RACIOCÍNIO chamando `avancar_procedimento` por conta própria, sem que
   * ninguém tenha dito nada. Sem esta porta, a LLM podia percorrer um
   * procedimento inteiro sozinha e a IARA registraria oito etapas concluídas
   * que nenhuma pessoa executou (adversariais 27 e 28).
   *
   * A execução NÃO é bloqueada: continua `aguardando_evidencia`, na mesma
   * parada. Bloquear exigiria alguém destravar; aqui basta o operador dizer.
   */
  if (evidencia === 'nenhuma') {
    return {
      permitido: false,
      /* Primeira pessoa como o resto das frases do guardião: desde que a
         habilidade passou a usar `motivo` em vez de texto próprio, isto é o que
         o operador lê literalmente, e não uma anotação de auditoria. */
      motivo: 'ninguém me confirmou que ela foi feita',
      estado: 'aguardando_evidencia',
      desvio: desvio('sem_evidencia', `${p.codigo} etapa=${emCurso.etapa}`, instante),
    };
  }

  /**
   * A EVIDÊNCIA APONTA CONTRA — e vem DEPOIS de `sem_evidencia` de propósito.
   *
   * A ordem importa porque as duas recusas dizem coisas diferentes ao operador.
   * Sem evidência nenhuma, a IARA não sabe de nada e pede confirmação. Aqui ela
   * SABE algo: o print que a pessoa mandou mostra outra tela. Recusar sem
   * distinguir os dois casos devolveria "me confirme que fez" a quem acabou de
   * mandar uma imagem — e a pessoa repetiria "fiz", agora sem que nada tivesse
   * sido conferido a mais, o que é como uma trava vira teatro.
   *
   * NÃO BLOQUEIA. Estar noutra tela na hora do print não desfaz o procedimento
   * — pode ser a janela errada em primeiro plano. Fica `aguardando_evidencia`,
   * na mesma parada, e o operador resolve com uma frase ou com outro print.
   */
  if (conferencia?.situacao === 'outra_tela') {
    return {
      permitido: false,
      motivo:
        'a captura que você mandou mostra outra tela — não a desta etapa. ' +
        'Se você fez a etapa em outro lugar, me diga; se ainda não fez, ela continua aqui',
      estado: 'aguardando_evidencia',
      desvio: desvio(
        'evidencia_contraditoria',
        `${p.codigo} etapa=${emCurso.etapa} slide=${emCurso.slide} anexo=${conferencia.anexo}`,
        instante,
      ),
    };
  }

  return { permitido: true, motivo: '', estado: 'aguardando_evidencia', desvio: null };
}

/**
 * A execução chegou ao fim?
 *
 * Separado de `podeAvancar` porque concluir é uma afirmação mais forte que
 * avançar: diz que o procedimento inteiro foi cumprido, e é o que a auditoria
 * vai reler depois.
 */
export function ehUltimaParada(p: Procedimento, emCurso: PosicaoEmCurso): boolean {
  const atual = acharPosicao(p, emCurso.etapa, emCurso.slide);
  return atual !== null && atual.indice === atual.total;
}
