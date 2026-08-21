/**
 * Conferência de tela — "estou aqui" medido contra o POP em curso.
 *
 * O QUE ESTE MÓDULO É: a costura entre duas coisas que já existiam e não se
 * conheciam — a análise visual de um screenshot anexado (`AnaliseVisual.ts`) e a
 * posição do operador dentro de um procedimento (`ProcedimentosEmCurso.ts`).
 * Sem ele, a IARA olhava a imagem sem saber que a pessoa estava na etapa 3, e
 * sabia da etapa 3 sem olhar a imagem.
 *
 * A REGRA QUE ELE EXISTE PARA MANTER DE PÉ, e que não é negociável:
 *
 *   **A visão diz ONDE a pessoa está. O POP diz O QUE fazer.**
 *
 * A leitura da tela é `procedencia: 'inferencia'` — dedução, não observação
 * verificada — e sai sempre com a ressalva correspondente. A orientação é
 * `documento`, sai VERBATIM do slide, com citação de fonte, e é montada por
 * `redigirParada`, a MESMA função que a habilidade usa. Se um dia as duas
 * discordarem, quem manda é o documento: a leitura nunca reescreve o passo,
 * nunca o completa e nunca o antecipa.
 *
 * E MAIS IMPORTANTE: **conferir não move ninguém.** A única escrita deste
 * módulo é `registrarConferencia`, que anota a LEITURA ao lado da parada — nunca
 * a parada. Uma tela que "parece a etapa 4" não é a pessoa dizendo que fez a
 * etapa 3; quem avança é `avancar_procedimento`, pela porta de sempre, com o
 * operador falando. Deixar a visão mover a posição seria a LLM escrevendo estado
 * por um caminho que nenhuma trava vigia, que é exatamente o que o `CLAUDE.md`
 * proíbe.
 *
 * O QUE A CONFERÊNCIA GUARDADA MUDA, então, se ela não avança nada: ela muda o
 * que o guardião SABE quando o operador pedir para avançar. `na_etapa` faz o
 * print virar evidência `anexada`; `outra_tela` faz o guardião RECUSAR o avanço,
 * porque existe uma evidência apontando contra; `indefinido` não sustenta nada e
 * o avanço volta a depender do que a pessoa disser. Antes disto (19/08/2026) o
 * tipo `anexada` existia declarado em `lib/procedimento.ts` e nenhum caminho de
 * código chegava nele.
 */

import { baseProcedimentos } from './BaseProcedimentos';
import { procedimentosEmCurso, type ModoDoProcedimento } from './ProcedimentosEmCurso';
import { redigirParada } from './kernel/habilidades/procedimentos';
import { RESSALVA } from './kernel/Verdade';

import {
  acharPosicao,
  descreverParada,
  ilustrarParada,
  type ParadaEsperada,
  type SituacaoNaParada,
  type Posicao,
  type Procedimento,
} from '../../lib/procedimento';
import type { Ilustracao } from '../../lib/snapshot';

/**
 * Em que pé está o operador quando ele anexa um screenshot.
 *
 * `revisado` é um estado próprio, e não um `sem_procedimento` disfarçado: o POP
 * mudou depois que a pessoa começou, e a etapa 4 da versão nova pode ser outra
 * coisa. Conferir a tela contra uma parada que talvez não exista mais é a
 * mentira fácil que `avancar_procedimento` já recusa a cometer — e recusar aqui
 * pelo mesmo motivo é o que impede as duas portas de discordarem.
 */
export type SituacaoDoOperador =
  | { readonly tipo: 'sem_procedimento' }
  | { readonly tipo: 'revisado'; readonly codigo: string }
  | {
      readonly tipo: 'parada';
      readonly procedimento: Procedimento;
      readonly posicao: Posicao;
      readonly modo: ModoDoProcedimento;
      readonly parada: ParadaEsperada;
    };

/**
 * Lê a posição do operador e resolve contra o corpus vigente. SÓ LÊ.
 *
 * Não encerra o acompanhamento quando o POP foi revisado, e a omissão é
 * deliberada: anexar um print é uma pergunta, e uma pergunta não pode ter como
 * efeito colateral apagar onde alguém estava. Quem encerra é
 * `avancar_procedimento`, que é o caminho em que a pessoa está de fato
 * seguindo em frente.
 */
export async function situacaoDoOperador(idUsuario: string): Promise<SituacaoDoOperador> {
  const emCurso = await procedimentosEmCurso.emCurso(idUsuario);
  if (!emCurso) return { tipo: 'sem_procedimento' };

  const procedimento = baseProcedimentos.porCodigo(emCurso.codigo);
  if (!procedimento) return { tipo: 'sem_procedimento' };

  if (procedimento.hash_origem !== emCurso.hash_origem) {
    return { tipo: 'revisado', codigo: procedimento.codigo };
  }

  const posicao = acharPosicao(procedimento, emCurso.etapa, emCurso.slide);
  if (!posicao) return { tipo: 'revisado', codigo: procedimento.codigo };

  return {
    tipo: 'parada',
    procedimento,
    posicao,
    modo: emCurso.modo,
    parada: descreverParada(procedimento, posicao),
  };
}

/** O que a IARA leu na tela do operador — o pedaço `inferencia` da resposta. */
export interface LeituraDaTela {
  readonly texto: string;
  readonly situacao: SituacaoNaParada | null;
}

/**
 * Guarda a conferência para o turno seguinte — o único efeito deste módulo.
 *
 * E ele NÃO MOVE NINGUÉM: `registrarConferencia` grava a leitura ao lado da
 * parada e nada mais. Quem avança continua sendo `avancar_procedimento`, com o
 * operador falando, pelo guardião. O que muda é que, quando ele passar por lá,
 * vai existir uma evidência conferida em vez de só a palavra da pessoa.
 *
 * A gravação é BEST-EFFORT: falhar aqui não pode derrubar a resposta à imagem.
 * O custo declarado de perder uma é o avanço seguinte cair em `declarada` — o
 * comportamento de antes desta camada existir, que continua correto.
 */
export async function registrarConferencia(
  idUsuario: string,
  situacao: Extract<SituacaoDoOperador, { tipo: 'parada' }>,
  leitura: LeituraDaTela,
  anexo: string,
  agora: () => string = () => new Date().toISOString(),
): Promise<void> {
  if (!leitura.situacao) return;
  try {
    await procedimentosEmCurso.registrarConferencia(idUsuario, {
      situacao: leitura.situacao,
      codigo: situacao.procedimento.codigo,
      etapa: situacao.posicao.etapa.numero,
      slide: situacao.posicao.slide.indice,
      hash_origem: situacao.procedimento.hash_origem,
      anexo,
      instante: agora(),
    });
  } catch (erro) {
    console.warn(`[iara] conferência não foi guardada — ${(erro as Error).message}`);
  }
}

/**
 * A frase que traduz a situação, e o que ela NÃO promete.
 *
 * Nenhuma das três avança nada, e a de `outra_tela` diz isso com todas as
 * letras. Uma IARA que responde "você está na tela errada" e cala sobre o que
 * fez com a posição deixa a pessoa sem saber se perdeu o lugar.
 */
function frasePelaSituacao(situacao: SituacaoNaParada | null, posicao: Posicao): string {
  switch (situacao) {
    case 'na_etapa':
      return (
        `É a tela desta parada mesmo — você está na ${posicao.indice} de ${posicao.total}. ` +
        'Quando terminar, diga "próximo" e eu avanço com essa captura como evidência.'
      );
    case 'outra_tela':
      /* NÃO oferece mais "me diga próximo que eu avanço": com a conferência
         valendo no guardião, esse convite virava uma promessa que a porta
         seguinte recusa. Quem está noutra tela precisa dizer o que houve, não
         repetir o pedido. */
      return (
        `Essa não me parece a tela da parada ${posicao.indice} de ${posicao.total}. ` +
        'Não mexi na sua posição — e, enquanto essa for a captura mais recente, eu não avanço ' +
        'só porque você pedir: me diga o que aconteceu, ou me mande um print da tela desta etapa.'
      );
    case 'indefinido':
      return (
        `Não consigo afirmar se essa é a tela da parada ${posicao.indice} de ${posicao.total} — ` +
        'não é o mesmo que dizer que não é. Essa captura não vai sustentar um avanço; ' +
        'se você fez a etapa, me diga com todas as letras.'
      );
    default:
      return '';
  }
}

/**
 * A RESPOSTA COMPOSTA, na ordem em que a hierarquia da verdade manda.
 *
 * Primeiro o que eu VI, marcado como dedução. Depois o que o DOCUMENTO manda,
 * verbatim e com fonte. Nunca ao contrário, e nunca fundidos num parágrafo só:
 * um texto que mistura leitura e procedimento faz as duas coisas terem o mesmo
 * peso na cabeça de quem lê — e é o procedimento que responde por um clique
 * errado no GW.
 */
export function redigirConferencia(
  situacao: Extract<SituacaoDoOperador, { tipo: 'parada' }>,
  leitura: LeituraDaTela,
): string {
  const linhas: string[] = [];

  const lido = leitura.texto.trim();
  if (lido) {
    linhas.push(`Pelo que vejo na sua tela: ${lido}`);
    linhas.push(`_${RESSALVA.inferencia}._`);
  }

  const frase = frasePelaSituacao(leitura.situacao, situacao.posicao);
  if (frase) {
    linhas.push('');
    linhas.push(frase);
  }

  linhas.push('');
  linhas.push('---');
  linhas.push('');
  /* A MESMA função da habilidade, e não uma cópia adaptada: dois lugares
     redigindo a mesma parada é como a ressalva, a citação e as exceções do POP
     passam a sair diferentes conforme o caminho por onde a pessoa chegou. */
  linhas.push(redigirParada(situacao.procedimento, situacao.posicao, situacao.modo));

  /**
   * A ARMADILHA QUE ESTA LINHA FECHA: quem manda um print junto de "pronto, fiz"
   * vai supor que o print avançou a etapa. Ele não avança — a conferência é uma
   * leitura, e quem move a posição é `avancar_procedimento`, com o operador
   * dizendo. Sem esta frase, a pessoa segue operando achando que a IARA está uma
   * etapa à frente de onde realmente está.
   */
  linhas.push('');
  linhas.push('_Conferir não avança — a captura fica guardada para quando você disser "próximo"._');

  return linhas.join('\n');
}

/** A ilustração da parada em curso — a tela do POP, ao lado da tela real. */
export function ilustracaoDaSituacao(situacao: SituacaoDoOperador): Ilustracao | null {
  return situacao.tipo === 'parada'
    ? ilustrarParada(situacao.procedimento, situacao.posicao)
    : null;
}

/**
 * O aviso de POP revisado, para o turno de visão que não pôde ser situado.
 *
 * Sai junto da análise normal da imagem: a leitura da tela continua valendo — o
 * que não vale é dizer em que etapa a pessoa está.
 */
export function avisoDeRevisao(codigo: string): string {
  return (
    `\n\n_Aviso: o ${codigo} foi revisado depois que você começou, então não dá para dizer ` +
    'em que etapa você está. Me peça para recomeçar o procedimento e eu conduzo pela versão vigente._'
  );
}
