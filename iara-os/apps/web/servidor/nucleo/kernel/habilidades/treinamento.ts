/**
 * `treinar_procedimento` — a instrutora, e não uma sexta habilidade de POP.
 *
 * UMA HABILIDADE, OITO MODOS. A alternativa — `ensinar_procedimento`,
 * `explicar_etapa`, `diagnosticar_erro`, `avaliar_aprendizado`… — colocaria a
 * decisão pedagógica no catálogo, isto é, na LLM que escolhe habilidade. Aí
 * "deu erro" viraria `avancar_procedimento` no dia em que a escolha errasse, e o
 * operador que relatou um problema ouviria *"ninguém me confirmou que ela foi
 * feita"*. O modo é resolvido por `IntencaoPedagogica`, determinístico, antes de
 * qualquer modelo opinar.
 *
 * O QUE ESTA HABILIDADE NÃO FAZ, e é o contrato inteiro da camada:
 *
 *   NÃO move o ponteiro          quem move é `avancar_procedimento`
 *   NÃO conclui etapa            quem conclui é o guardião
 *   NÃO fabrica evidência        evidência sai do enunciado, no guardião
 *   NÃO fabrica conferência      conferência sai da imagem, em `ConferenciaDeTela`
 *   NÃO reescreve POP            nenhum caminho de código escreve no corpus
 *
 * Ela LÊ tudo isso e escreve só em `ProgressoDeTreinamento`. A separação é
 * verificada em `testes/treinamento-fronteira.test.ts` — não por este
 * comentário, que é exatamente o tipo de coisa que sobrevive à regressão que
 * descreve.
 *
 * A AUTORIDADE CONTINUA SENDO O POP. Nenhum modo inventa passo, campo ou botão:
 * o que sai como instrução sai verbatim, por `redigirParada`, com `citar()` no
 * rodapé. Quando o documento não responde, a resposta é dizer isso e registrar a
 * lacuna — nunca completar com bom senso.
 */

import type { Habilidade } from '../Habilidade';
import { baseProcedimentos } from '../../BaseProcedimentos';
import { procedimentosEmCurso } from '../../ProcedimentosEmCurso';
import { progressosDeTreinamento } from '../../ProgressoDeTreinamento';
import { percepcaoDeTela } from '../../PercepcaoDeTela';
import type { EstadoVisual } from '../../../../lib/percepcao';
import {
  compararComOPercurso,
  type ComparacaoComOPercurso,
} from '../../../../lib/aderencia';
import { assinaturaDeLacuna, lacunasCapacidade } from '../LacunasCapacidade';
import { RESSALVA } from '../Verdade';
import { classificarPedagogica } from '../IntencaoPedagogica';
import { extrairCodigoPop } from '../IntencaoProcedimento';
import { redigirParada } from './procedimentos';
import { contar } from '../../texto';
import {
  RESSALVA_DA_EVIDENCIA,
  acharPosicao,
  citar,
  descreverParada,
  ilustrarParada,
  posicoes,
  type Posicao,
  type Procedimento,
  type TipoDeEvidencia,
} from '../../../../lib/procedimento';
import {
  AVISO_AVALIACAO,
  COMENTARIO_DO_VEREDITO,
  MODOS_PEDAGOGICOS,
  chaveDaParada,
  escolhaDoOperador,
  esgotouSocratico,
  letraDaAlternativa,
  montarPergunta,
  nivelDe,
  precisamReforco,
  veredito,
  type ModoPedagogico,
  type ProgressoDeTreinamento,
  type TipoDeDificuldade,
} from '../../../../lib/treinamento';

// ---------------------------------------------------------------------------
// Frases de contrato — constantes, nunca texto solto
// ---------------------------------------------------------------------------

/**
 * O QUE A IARA RESPONDE A "por que eu faço isso?" QUANDO O POP NÃO DIZ.
 *
 * Os 11 POPs de 18/08/2026 descrevem AÇÃO e não RAZÃO. Fabricar uma
 * justificativa plausível — "isso registra a saída da carga no sistema" — é a
 * falha mais convidativa desta camada inteira: soa útil, soa competente, e
 * ninguém que lê tem como saber que foi inventada. Dizer que o documento não
 * explica é a resposta honesta, e é também o que vira pauta de revisão.
 */
const MOTIVO_AUSENTE_NO_POP =
  'O POP orienta fazer essa ação, mas **não explica o motivo** — esse campo não existe ' +
  'no documento. Não vou inventar uma justificativa: registrei a pergunta para quem ' +
  'escreve o procedimento.';

/** Nada aqui autoriza pular. A sequência é do documento, não da conversa. */
const SOBRE_PULAR =
  'Não tenho como autorizar pular etapa: o POP não declara nenhuma parada como opcional, ' +
  'e eu não enxergo o GW para saber se a etapa seguinte funciona sem esta. Se na prática ' +
  'ela for dispensável, isso é mudança de procedimento e precisa de quem aprova o POP.';

/** A frase que separa o que o documento manda do que o operador relata. */
const SEPARACAO_DE_RELATO =
  'Duas coisas diferentes aqui, e eu não vou fundir as duas: **o que o POP determina** ' +
  '(abaixo, verbatim) e **o que você está relatando**. Eu não enxergo o GW, então não ' +
  'tenho como dizer qual dos dois descreve a tela agora.';

/** Divergência registrada — sem correção, sem alternativa inventada. */
const SOBRE_DIVERGENCIA =
  'Registrei sua observação como possível divergência, para revisão humana. Eu **não** ' +
  'corrijo POP e **não** vou te orientar por um caminho que o documento não traz — isso ' +
  'seria transformar uma conversa em procedimento oficial. Até alguém revisar, o que ' +
  'vale para operar continua sendo o que está escrito.';

/**
 * O QUE A IARA DIZ quando está acompanhando a tela — e o que ela NÃO diz.
 *
 * Ela para de pedir print, porque pedir print a quem já autorizou o
 * acompanhamento é ignorar o que a pessoa concedeu. E continua dizendo, na mesma
 * frase, que observar não é conferir: o que a percepção enxerga é que a tela
 * mudou, não que a etapa foi cumprida. Sem a segunda metade, a primeira vira
 * promessa de vigilância competente que o sistema não cumpre.
 */
function frasePercepcao(visual: EstadoVisual): string {
  return (
    `👁️ Estou acompanhando **${visual.processos.join(', ')}** na sua tela` +
    (visual.estado === 'suspensa'
      ? ' — agora mesmo pausada, porque a janela em foco não é a autorizada.'
      : '.') +
    ' Vejo quando a tela muda; **não vejo que você cumpriu a etapa** — isso continua ' +
    'sendo você quem me diz. Para eu parar, diga "para de observar".'
  );
}

/**
 * O QUE A LEITURA DA TELA ACRESCENTA — uma frase por leitura, e só quando ela
 * diz alguma coisa.
 *
 * `indefinida` produz SILÊNCIO, e isso é regra de produto, não economia de
 * texto: percepção não significa comentar cada tela. Uma IARA que diz "não
 * consegui identificar sua tela" a cada resposta é uma IARA que o operador
 * desliga.
 *
 * NENHUM DOS RAMOS AVANÇA NADA. `resultado_observado` é o mais tentador — a tela
 * já é a da próxima parada — e é justamente onde a frase precisa dizer, com
 * todas as letras, que ver não é concluir.
 */
function fraseDoPercurso(ctx: ContextoDeTreinamento): string {
  const p = ctx.percurso;
  if (!p) return '';

  const ressalva = `_${RESSALVA.inferencia} — é leitura de tela, e leitura de tela erra._`;

  if (p.leitura === 'na_etapa') {
    return (
      `\n\n🟢 Pelo que leio na sua tela, você está **na tela desta etapa** ` +
      `(${p.atual.vistos.length} de ${p.atual.esperados.length} termos do POP aparecem aí).\n${ressalva}`
    );
  }

  if (p.leitura === 'resultado_observado') {
    return (
      `\n\n🔵 A tela que estou lendo se parece com a **próxima parada** do procedimento, ` +
      'não com esta. Isso sugere que a ação desta etapa surtiu efeito — e **não conclui a ' +
      'etapa**: eu vejo uma tela, não vejo você fazendo o que o POP manda. Se você terminou, ' +
      'me diga e eu avanço.\n' +
      ressalva
    );
  }

  if (p.leitura === 'fora_do_percurso') {
    return (
      '\n\n🟡 A tela que estou lendo **não corresponde** nem a esta parada nem à próxima. ' +
      'Não vou supor o que aconteceu — pode ser outra tela do sistema, pode ser que eu tenha ' +
      'lido mal. Se você saiu do procedimento, me diga; se não saiu, ignore este aviso.\n' +
      ressalva
    );
  }

  /* `indefinida`: silêncio. */
  return '';
}

/** Retomar não é avançar, e a frase precisa dizer isso. */
const RETOMAR_NAO_AVANCA =
  '_Retomar não avança nada: você continua exatamente na parada em que parou._';

// ---------------------------------------------------------------------------
// Contexto — o que a habilidade lê antes de decidir qualquer coisa
// ---------------------------------------------------------------------------

interface ContextoDeTreinamento {
  readonly procedimento: Procedimento;
  readonly posicao: Posicao;
  readonly alvo: { codigo: string; hash_origem: string; revisao: string };
  readonly progresso: ProgressoDeTreinamento | null;
  readonly modoOperacional: 'guiar' | 'treinar';
  readonly evidencia: TipoDeEvidencia;
  /**
   * O QUE A PERCEPÇÃO ESTÁ VENDO, quando há sessão ativa. `null` quando a IARA
   * não está acompanhando a tela — que é o caso normal.
   *
   * SÓ LEITURA, e nada aqui muda por causa dele: o que a percepção altera é o
   * que a IARA DIZ, nunca o que ela faz com o procedimento. Uma tela observada
   * não avança etapa, não vira evidência e não vira conferência — a instrutora
   * ganha o que falar, não uma autorização nova.
   */
  readonly visual: EstadoVisual | null;
  /**
   * O TEXTO OBSERVADO comparado com a `ParadaEsperada` — o que fecha o contexto.
   *
   * `null` quando não há percepção ativa ou quando ela ainda não leu texto
   * nenhum. NUNCA vira evidência nem conferência: é leitura, e leitura muda o
   * que a IARA diz. Ver `lib/aderencia.ts`.
   */
  readonly percurso: ComparacaoComOPercurso | null;
}

/**
 * Lê ponteiro, corpus e progresso. SÓ LÊ.
 *
 * `null` cobre três casos que a resposta precisa distinguir e que este tipo
 * deliberadamente NÃO colapsa — quem chama pergunta de novo ao ponteiro para
 * saber qual foi. Devolver um objeto "vazio" faria "não comecei" e "o POP mudou"
 * saírem com a mesma frase.
 */
async function contextoDe(idUsuario: string): Promise<ContextoDeTreinamento | null> {
  const emCurso = await procedimentosEmCurso.emCurso(idUsuario);
  if (!emCurso) return null;

  const procedimento = baseProcedimentos.porCodigo(emCurso.codigo);
  if (!procedimento) return null;
  if (procedimento.hash_origem !== emCurso.hash_origem) return null;

  const posicao = acharPosicao(procedimento, emCurso.etapa, emCurso.slide);
  if (!posicao) return null;

  const alvo = {
    codigo: procedimento.codigo,
    hash_origem: procedimento.hash_origem,
    revisao: procedimento.revisao,
  };

  const visual = percepcaoDeTela.ativaDe(idUsuario);

  /**
   * A COMPARAÇÃO ACONTECE AQUI, no motor, e não no Braço — porque é aqui que se
   * sabe qual é a parada. O Braço manda texto mascarado; quem tem o POP é o
   * motor. É a mesma divisão que faz a percepção não conhecer procedimento.
   *
   * `todas[posicao.indice]` é a PRÓXIMA parada (o índice é 1-based), e `null` na
   * última — ali não há para onde progredir, e só existe estar na etapa ou ter
   * saído dela.
   */
  const todas = posicoes(procedimento);
  const proxima = todas[posicao.indice] ?? null;
  const percurso =
    visual && visual.texto
      ? compararComOPercurso(
          descreverParada(procedimento, posicao),
          proxima ? descreverParada(procedimento, proxima) : null,
          visual.texto,
        )
      : null;

  return {
    procedimento,
    posicao,
    alvo,
    progresso: await progressosDeTreinamento.ler(idUsuario, alvo.codigo, alvo.hash_origem),
    modoOperacional: emCurso.modo,
    evidencia: emCurso.evidencia,
    visual,
    percurso,
  };
}

/** "Voltando ao treinamento, estávamos na parada 4 de 8." */
function voltarAoTreinamento(ctx: ContextoDeTreinamento): string {
  return (
    `\n\n---\n\n**Voltando ao procedimento:** você está na parada ` +
    `${ctx.posicao.indice} de ${ctx.posicao.total} do ${ctx.procedimento.codigo} ` +
    `(${ctx.posicao.etapa.titulo}). ${RETOMAR_NAO_AVANCA}`
  );
}

/** Proveniência numa linha, no mesmo formato das habilidades de procedimento. */
function proveniencia(ctx: ContextoDeTreinamento | null, extra: string): string {
  if (!ctx) return `sem_procedimento_em_curso ${extra}`;
  return (
    `pop=${ctx.procedimento.codigo} etapa=${ctx.posicao.etapa.numero} ` +
    `slide=${ctx.posicao.slide.indice} pos=${ctx.posicao.indice}/${ctx.posicao.total} ` +
    `rev=${ctx.procedimento.revisao} pedagogico=${ctx.progresso?.estado ?? 'sem_progresso'} ${extra}`
  );
}

/** Registra a dificuldade no progresso. Best-effort: nunca derruba a resposta. */
async function anotar(
  idUsuario: string,
  ctx: ContextoDeTreinamento,
  tipo: TipoDeDificuldade,
  frase: string,
): Promise<void> {
  try {
    await progressosDeTreinamento.registrarDificuldade(idUsuario, ctx.alvo, {
      tipo,
      parada: chaveDaParada(ctx.posicao.etapa.numero, ctx.posicao.slide.indice),
      assinatura: assinaturaDeLacuna(frase),
    });
  } catch (erro) {
    console.warn(`[iara] dificuldade não registrada — ${(erro as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// A habilidade
// ---------------------------------------------------------------------------

export const treinarProcedimento: Habilidade = {
  manifesto: {
    id: 'treinar_procedimento',
    nome: 'Instrutora do procedimento (SOS)',
    descricao:
      'Ensina, explica, tira dúvida, diagnostica problema relatado, conduz prática, avalia o ' +
      'aprendizado e retoma um treinamento interrompido — sempre sobre os POPs oficiais do GW. ' +
      'Use quando o operador está APRENDENDO ou TRAVADO: "me ensina", "não entendi", "por que ' +
      'faço isso", "deu erro", "não aparece o botão", "me testa", "quero praticar", "continua de ' +
      'onde paramos", "o POP está errado". Para avançar a etapa use avancar_procedimento; para ' +
      'consultar o passo a passo use consultar_procedimento.',
    exemplos: [
      'Nunca fiz isso, me ensina',
      'Não entendi por que preciso fazer essa etapa',
      'Deu erro aqui',
      'Não aparece esse botão na minha tela',
      'Me testa para ver se eu aprendi',
      'Continua meu treinamento de onde paramos',
      'Esse POP está errado, meu colega faz diferente',
    ],
    capacidades: [
      'treinamento operacional adaptativo',
      'diagnóstico de dificuldade em procedimento',
      'avaliação de aprendizagem sobre POP',
      'retomada de treinamento interrompido',
    ],
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: ['memoria'],
    timeout_ms: 6000,
    custo: 'zero',
    risco: 'baixo',
    /**
     * `escrita_idempotente`, e a escolha merece explicação: esta habilidade
     * escreve — no progresso pedagógico. Mas rodá-la duas vezes com o mesmo
     * enunciado deixa o mesmo estado final (as listas de paradas são conjuntos,
     * o contador socrático é por parada). O que NÃO é idempotente — mover a
     * etapa — não mora aqui.
     */
    idempotencia: 'escrita_idempotente',
    esquema: {
      /**
       * `modo` é `dentre` fechado porque o conjunto é do código, não do corpus
       * — o oposto de `codigo` em `consultar_procedimento`. E é OPCIONAL: quando
       * não vem, `classificarPedagogica` decide sobre o enunciado cru, que é o
       * caminho que não depende de a LLM ter interpretado bem a frase.
       */
      modo: { tipo: 'texto', dentre: [...MODOS_PEDAGOGICOS] },
      codigo: { tipo: 'texto' },
      /** A resposta do operador a uma pergunta de prática ou de avaliação. */
      resposta: { tipo: 'texto' },
    },
  },

  async executar(ctx) {
    const leitura = classificarPedagogica(ctx.enunciado);
    const modo = (ctx.parametros.modo ? String(ctx.parametros.modo) : leitura.modo) as ModoPedagogico;
    const resposta = ctx.parametros.resposta ? String(ctx.parametros.resposta) : '';

    const contexto = await contextoDe(ctx.id_usuario);

    if (modo === 'retomada') return retomar(ctx.id_usuario, contexto);
    if (!contexto) return semProcedimento(ctx.id_usuario, ctx.enunciado, modo);

    switch (modo) {
      case 'diagnostico':
        return diagnosticar(ctx.id_usuario, contexto, leitura.dificuldade, ctx.enunciado);
      case 'avaliacao':
        return avaliar(ctx.id_usuario, contexto, resposta || ctx.enunciado);
      case 'pratica':
        return praticar(ctx.id_usuario, contexto, resposta);
      case 'ensino':
        return ensinar(ctx.id_usuario, contexto);
      case 'duvida':
        return responderDuvida(ctx.id_usuario, contexto, leitura.dificuldade, ctx.enunciado);
      case 'execucao':
        return sobreExecucao(ctx.id_usuario, contexto, leitura.dificuldade, ctx.enunciado);
      default:
        return ensinar(ctx.id_usuario, contexto);
    }
  },

  /**
   * O QUE ESTE VERIFICADOR CONFIRMA — e o que ele nunca vai confirmar.
   *
   * Confirma o efeito DESTA habilidade: o progresso pedagógico gravado em disco.
   * NÃO confirma que alguém aprendeu, e a evidência devolvida diz isso: aprender
   * não é observável por este sistema, e um verificador que dissesse "aprendeu"
   * seria a mesma mentira que dizer "a etapa foi feita no GW".
   */
  async verificar(resultado, ctx) {
    if (!resultado.resolveu) {
      return {
        confirmado: false,
        evidencia: 'a habilidade não resolveu; nada foi registrado',
        motivo: 'nao_encontrado',
      };
    }
    const emCurso = await procedimentosEmCurso.emCurso(ctx.id_usuario);
    if (!emCurso) {
      return {
        confirmado: true,
        evidencia:
          'resposta pedagógica sem procedimento em curso; nenhuma posição foi criada ou movida',
      };
    }
    const progresso = await progressosDeTreinamento.ler(
      ctx.id_usuario,
      emCurso.codigo,
      emCurso.hash_origem,
    );
    return {
      confirmado: true,
      evidencia:
        `progresso pedagógico: ${progresso?.estado ?? 'sem registro'} em ${emCurso.codigo}; ` +
        `posição inalterada em ${emCurso.etapa}/${emCurso.slide} — ` +
        'aprendizado não é verificável por este sistema',
    };
  },
};

// ---------------------------------------------------------------------------
// Modos
// ---------------------------------------------------------------------------

/**
 * RETOMADA — o único modo que responde sem procedimento em curso.
 *
 * Ele existe justamente para o caso em que não há: alguém volta no dia seguinte
 * e pergunta onde parou. Responder "você não tem procedimento em curso" e calar
 * sobre o progresso registrado seria esconder o que a IARA sabe.
 */
async function retomar(idUsuario: string, ctx: ContextoDeTreinamento | null) {
  const historico = await progressosDeTreinamento.todos(idUsuario);

  if (!ctx) {
    const emCurso = await procedimentosEmCurso.emCurso(idUsuario);
    if (emCurso) {
      /* O PONTEIRO EXISTE E O CONTEXTO NÃO: o POP foi revisado, saiu da base ou
         a etapa sumiu. É o caso que `contextoDe` colapsa em `null` e que aqui
         precisa ser dito por extenso — continuar contando "etapa 4 de 8" sobre
         um documento que mudou é a mentira mais fácil de cometer neste
         subsistema, porque nada quebra. */
      return {
        texto:
          `Você tinha o ${emCurso.codigo} em curso, na etapa ${emCurso.etapa}. ` +
          'Só que o documento mudou desde então (ou a etapa deixou de existir nele), ' +
          'e eu **não** vou tratar seu progresso anterior como equivalente: o que você ' +
          'treinou era outra versão. Me peça para recomeçar e eu conduzo pela vigente.',
        detalhe: `retomada bloqueada: ${emCurso.codigo} hash em curso divergente ou posição perdida`,
        resolveu: true,
      };
    }
    if (historico.length === 0) {
      return {
        texto:
          'Não tenho treinamento seu registrado — nem procedimento em curso. ' +
          'Me diga o que você precisa aprender que eu começo do início.',
        detalhe: 'sem procedimento em curso e sem progresso registrado',
        resolveu: true,
      };
    }
    const ultimo = historico[0];
    return {
      texto:
        `Você não tem procedimento em curso agora. O último treinamento registrado foi o ` +
        `**${ultimo.codigo}** (${ultimo.revisao}), estado **${ultimo.estado}**, ` +
        `atualizado em ${ultimo.atualizado_em.slice(0, 10)}.` +
        (ultimo.dificuldades.length > 0
          ? `\n\nÚltima dificuldade registrada: _${ultimo.dificuldades.at(-1)!.assinatura}_ ` +
            `(${ultimo.dificuldades.at(-1)!.tipo.replace(/_/g, ' ')}).`
          : '') +
        '\n\nQuer que eu recomece a condução desse procedimento?',
      detalhe: `retomada sem ponteiro; progresso=${ultimo.codigo} estado=${ultimo.estado}`,
      resolveu: true,
    };
  }

  const p = ctx.progresso;
  const reforco = precisamReforco(p);
  const outras = await progressosDeTreinamento.deOutrasRevisoes(
    idUsuario,
    ctx.alvo.codigo,
    ctx.alvo.hash_origem,
  );

  const linhas: string[] = [];
  linhas.push(
    `Você estava no **${ctx.procedimento.codigo}** (${ctx.procedimento.revisao}), ` +
      `parada ${ctx.posicao.indice} de ${ctx.posicao.total} — ${ctx.posicao.etapa.titulo}.`,
  );
  linhas.push(
    `Estado operacional: a etapa anterior ficou sustentada por evidência ` +
      `**${ctx.evidencia}** (${RESSALVA_DA_EVIDENCIA[ctx.evidencia]}).`,
  );
  linhas.push(
    `Estado do seu aprendizado: **${p?.estado ?? 'ainda não registrei nada'}**` +
      (p ? ` — ${p.paradas_ensinadas.length} parada(s) já explicada(s).` : '.'),
  );

  if (p && p.dificuldades.length > 0) {
    const d = p.dificuldades.at(-1)!;
    linhas.push(
      `Última dificuldade registrada: _${d.assinatura}_ (${d.tipo.replace(/_/g, ' ')}` +
        `${d.parada ? `, parada ${d.parada}` : ''}).`,
    );
  }
  if (reforco.length > 0) {
    linhas.push(
      `Paradas que pedem reforço: ${reforco.join(', ')} — ` +
        'você travou nelas mais de uma vez.',
    );
  }
  if (outras.length > 0) {
    linhas.push(
      `⚠️ Você também tem progresso registrado em ${contar(outras.length, 'outra revisão', 'outras revisões')} ` +
        `deste POP (${outras.map((o) => o.revisao).join(', ')}). Não considero equivalente: ` +
        'o que você treinou era outro documento.',
    );
  }

  linhas.push('');
  linhas.push(RETOMAR_NAO_AVANCA);
  linhas.push('');
  linhas.push('---');
  linhas.push('');
  linhas.push(redigirParada(ctx.procedimento, ctx.posicao, 'treinar', nivelDaParada(ctx)));

  return {
    texto: linhas.join('\n'),
    detalhe: proveniencia(ctx, `modo=retomada reforco=${reforco.length} outras_revisoes=${outras.length}`),
    ilustracao: ilustrarParada(ctx.procedimento, ctx.posicao),
    resolveu: true,
  };
}

function nivelDaParada(ctx: ContextoDeTreinamento) {
  return nivelDe(ctx.progresso, chaveDaParada(ctx.posicao.etapa.numero, ctx.posicao.slide.indice));
}

/**
 * Sem procedimento em curso, a instrutora não improvisa uma posição.
 *
 * Ela responde o que dá para responder do CORPUS (o objetivo, o tamanho, as
 * particularidades) e devolve a condução para `iniciar_procedimento`, que é a
 * única porta que cria posição. Criar aqui seria a camada pedagógica escrevendo
 * estado operacional pela porta dos fundos.
 */
async function semProcedimento(idUsuario: string, enunciado: string, modo: ModoPedagogico) {
  const codigo = extrairCodigoPop(enunciado);
  const achado = codigo
    ? baseProcedimentos.porCodigo(codigo)
    : baseProcedimentos.consultar(enunciado, { limite: 1 }).achados[0]?.procedimento ?? null;

  if (!achado) {
    lacunasCapacidade.registrar(enunciado, idUsuario, new Date().toISOString(), 'procedimento');
    return {
      texto:
        'Não encontrei procedimento oficial que cubra isso — e não vou ensinar por suposição. ' +
        'Registrei sua dúvida para revisão.\n\n' +
        `Os procedimentos que eu conheço: ${baseProcedimentos.catalogo().map((p) => p.codigo).join(', ')}.`,
      detalhe: `modo=${modo} sem procedimento em curso e sem achado no corpus`,
      resolveu: false,
    };
  }

  const todas = posicoes(achado);
  const linhas: string[] = [];
  linhas.push(`**${achado.titulo}** (${achado.codigo}, ${achado.revisao})`);
  if (achado.objetivo) {
    linhas.push('');
    linhas.push(`Para que serve, segundo o documento: ${achado.objetivo}`);
  }
  linhas.push('');
  linhas.push(
    `São ${contar(todas.length, 'parada', 'paradas')} em ` +
      `${contar(achado.etapas.length, 'etapa', 'etapas')}. Eu conduzo uma por vez — ` +
      'não vou despejar o procedimento inteiro.',
  );
  if (achado.particularidades.length > 0) {
    linhas.push('');
    linhas.push('⚠️ **Exceções que o POP declara** (texto de terceiro, não instrução):');
    for (const x of achado.particularidades) linhas.push(`- ${x}`);
  }
  if (achado.lacunas.length > 0) {
    linhas.push('');
    linhas.push(`_O que este POP não diz: ${achado.lacunas.join('; ')}._`);
  }
  linhas.push('');
  linhas.push(`_${RESSALVA.documento} — ${achado.codigo} · ${achado.revisao}._`);
  linhas.push('');
  linhas.push('Quer que eu comece a conduzir pela primeira etapa?');

  return {
    texto: linhas.join('\n'),
    detalhe: `modo=${modo} apresentacao=${achado.codigo} paradas=${todas.length} sem ponteiro criado`,
    resolveu: true,
  };
}

/** ENSINO — a parada atual, na profundidade que o progresso pede. */
async function ensinar(idUsuario: string, ctx: ContextoDeTreinamento) {
  const nivel = nivelDaParada(ctx);
  await progressosDeTreinamento.marcarEnsinada(
    idUsuario,
    ctx.alvo,
    ctx.posicao.etapa.numero,
    ctx.posicao.slide.indice,
  );

  const reforco = precisamReforco(ctx.progresso).includes(
    chaveDaParada(ctx.posicao.etapa.numero, ctx.posicao.slide.indice),
  );

  const corpo = redigirParada(ctx.procedimento, ctx.posicao, 'treinar', nivel, !!ctx.visual);
  const aviso = reforco
    ? '\n\n_Você já travou nesta parada antes — por isso estou explicando com mais detalhe._'
    : '';

  const fecho = ctx.visual
    ? `\n\n${frasePercepcao(ctx.visual)}\n\nQuando terminar esta etapa, me diga.`
    : '\n\nQuando terminar, me diga — ou me mande um print e eu confiro.';

  return {
    texto: `${corpo}${aviso}${fraseDoPercurso(ctx)}${fecho}`,
    detalhe: proveniencia(
      ctx,
      `modo=ensino nivel=${nivel} reforco=${reforco} percepcao=${ctx.visual?.estado ?? 'inativa'} ` +
        `percurso=${ctx.percurso?.leitura ?? 'sem_leitura'}`,
    ),
    ilustracao: ilustrarParada(ctx.procedimento, ctx.posicao),
    resolveu: true,
  };
}

/**
 * DÚVIDA — responde e VOLTA. A digressão não pode custar o lugar de ninguém.
 *
 * A posição não é tocada em nenhum ramo: uma pergunta não move procedimento.
 * O que a resposta acrescenta é a frase de retorno, que é o requisito inteiro
 * de "não perder o contexto do treinamento".
 */
async function responderDuvida(
  idUsuario: string,
  ctx: ContextoDeTreinamento,
  dificuldade: TipoDeDificuldade | null,
  enunciado: string,
) {
  const linhas: string[] = [];
  const t = enunciado.toLowerCase();

  if (/\bpul\w+|\bobrigat|\bprecisa mesmo\b/.test(t)) {
    linhas.push(SOBRE_PULAR);
    linhas.push('');
    linhas.push(
      `Faltam ${contar(ctx.posicao.total - ctx.posicao.indice + 1, 'parada', 'paradas')} ` +
        'a partir de onde você está.',
    );
    await anotar(idUsuario, ctx, 'duvida_conceitual', enunciado);
  } else if (dificuldade === 'duvida_de_localizacao') {
    const marcas = ctx.posicao.slide.passos.map((q) => q.rotulo);
    linhas.push(
      marcas.length > 0
        ? `Nesta parada o POP marca ${contar(marcas.length, 'ponto', 'pontos')}: ` +
          `${marcas.join(', ')}. A imagem ao lado mostra onde cada um fica na tela.`
        : 'Esta parada não tem ponto marcado no POP — o documento não diz onde clicar aqui, ' +
          'e eu não vou apontar um lugar por dedução.',
    );
    if (ctx.posicao.slide.capturas.length === 0) {
      linhas.push('');
      linhas.push('_Esta etapa não tem captura de tela no POP._');
    }
    await anotar(idUsuario, ctx, 'duvida_de_localizacao', enunciado);
  } else if (/\bpor\s*que\b|\bmotivo\b|\bpra que serve\b|\bpara que serve\b/.test(t)) {
    /* O QUE O DOCUMENTO DIZ vem antes do que ele não diz: a etapa TEM título e o
       procedimento TEM objetivo, e os dois são conteúdo real do POP. Só depois
       de esgotar o que existe é que a ausência é declarada. */
    if (ctx.procedimento.objetivo) {
      linhas.push(`O procedimento inteiro serve para: ${ctx.procedimento.objetivo}`);
    }
    linhas.push(`Esta etapa é a "${ctx.posicao.etapa.titulo}".`);
    linhas.push('');
    linhas.push(MOTIVO_AUSENTE_NO_POP);
    lacunasCapacidade.registrar(enunciado, idUsuario, new Date().toISOString(), 'procedimento');
    await anotar(idUsuario, ctx, 'duvida_conceitual', enunciado);
  } else {
    /* Dúvida conceitual genérica: procura NO CORPUS, e o que não estiver lá é
       declarado ausente. Responder de conhecimento geral sobre transporte é a
       falha nº 1 do documento normativo — quem lê não tem como saber que a IARA
       chutou. */
    const r = baseProcedimentos.consultar(enunciado, { limite: 1 });
    const achado = r.achados[0];
    if (achado) {
      linhas.push('O que a documentação oficial diz sobre isso (texto de terceiro, verbatim):');
      linhas.push('');
      linhas.push(achado.slide.texto || achado.etapa.titulo);
      linhas.push('');
      linhas.push(
        `_${RESSALVA.documento} — ${citar(achado.procedimento, achado.etapa, achado.slide)}._`,
      );
    } else {
      linhas.push(
        'Isso não está coberto pelos POPs que eu tenho. Não vou responder de conhecimento ' +
          'geral: aqui uma resposta plausível e errada faz alguém agir errado no GW. ' +
          'Registrei a pergunta para revisão.',
      );
      lacunasCapacidade.registrar(enunciado, idUsuario, new Date().toISOString(), 'procedimento');
      await anotar(idUsuario, ctx, 'fora_do_pop', enunciado);
    }
  }

  return {
    texto: `${linhas.join('\n')}${voltarAoTreinamento(ctx)}`,
    detalhe: proveniencia(ctx, `modo=duvida dificuldade=${dificuldade ?? 'nenhuma'} posicao_intacta=sim`),
    ilustracao: ilustrarParada(ctx.procedimento, ctx.posicao),
    resolveu: true,
  };
}

/**
 * DIAGNÓSTICO — nomear a natureza da dificuldade, nunca resolvê-la por dedução.
 *
 * Nenhum ramo aqui afirma o que aconteceu no GW. O mais longe que a IARA vai é
 * separar as duas afirmações e dizer qual delas ela não tem como conferir — que
 * é, literalmente, tudo o que ela sabe.
 */
async function diagnosticar(
  idUsuario: string,
  ctx: ContextoDeTreinamento,
  dificuldade: TipoDeDificuldade | null,
  enunciado: string,
) {
  const tipo: TipoDeDificuldade = dificuldade ?? 'erro_de_sistema';
  await anotar(idUsuario, ctx, tipo, enunciado);

  const linhas: string[] = [];

  if (tipo === 'possivel_divergencia_do_pop') {
    lacunasCapacidade.registrar(enunciado, idUsuario, new Date().toISOString(), 'divergencia');
    linhas.push(SEPARACAO_DE_RELATO);
    linhas.push('');
    linhas.push(SOBRE_DIVERGENCIA);
  } else if (tipo === 'elemento_nao_encontrado') {
    const marcas = ctx.posicao.slide.passos.map((q) => q.rotulo);
    linhas.push(SEPARACAO_DE_RELATO);
    linhas.push('');
    linhas.push(
      marcas.length > 0
        ? `O POP marca aqui: ${marcas.join(', ')}. Você está dizendo que isso não aparece na sua tela.`
        : 'O POP não marca nenhum ponto nesta parada, então não tenho nem o que comparar com o ' +
          'que você não está vendo.',
    );
    linhas.push('');
    linhas.push(
      'O que eu **não** sei dizer: se é outra tela, outro perfil de acesso, outra versão do GW ' +
        'ou o documento defasado. Não vou escolher uma dessas por você. ' +
        'Me mande um print desta tela — aí eu digo se ela bate com a parada, que é a única ' +
        'coisa que eu consigo conferir.',
    );
  } else if (tipo === 'evidencia_insuficiente') {
    linhas.push(
      'Não vou avançar com isso: o que você mandou não sustenta que a etapa foi feita, e eu ' +
        'não completo evidência por conta própria.',
    );
    linhas.push('');
    linhas.push(
      'Duas saídas: me diga com todas as letras que concluiu, ou me mande um print legível ' +
        'desta tela.',
    );
  } else {
    linhas.push(SEPARACAO_DE_RELATO);
    linhas.push('');
    /**
     * A MENSAGEM OBSERVADA entra AQUI, e é o primeiro lugar em que a percepção
     * muda uma resposta de verdade: em vez de pedir à pessoa que transcreva o
     * erro, a IARA cita o que leu na tela.
     *
     * COM A PROCEDÊNCIA COLADA. O texto veio de OCR — `inferencia`, no
     * vocabulário de `Verdade.ts` —, e OCR erra: ele já leu "ABC1D23" como
     * "ABCID23" nesta máquina. Citar sem a ressalva transformaria uma leitura
     * provável em fato, que é a única coisa que esta camada não pode fazer.
     */
    const observadas = ctx.visual?.mensagens ?? [];
    if (observadas.length > 0) {
      linhas.push('Na sua tela eu li isto:');
      for (const m of observadas) linhas.push(`> ${m}`);
      linhas.push('');
      linhas.push(`_${RESSALVA.inferencia} — é leitura de tela, e leitura de tela erra letra._`);
      linhas.push('');
      linhas.push(
        'Se for isso mesmo, eu procuro orientação para essa mensagem na documentação oficial. ' +
          'Se eu li errado, me corrija.',
      );
    } else {
      linhas.push(
        'Para eu registrar direito: qual foi a **mensagem exata** que apareceu, e em que ponto ' +
          'da tela? Eu não enxergo o GW — sem o texto do erro, qualquer causa que eu apontasse ' +
          'seria chute.',
      );
    }
    if (ctx.procedimento.particularidades.length > 0) {
      linhas.push('');
      linhas.push('O POP declara estas exceções — vale conferir se alguma se aplica:');
      for (const x of ctx.procedimento.particularidades) linhas.push(`- ${x}`);
    }
  }

  const doPercurso = fraseDoPercurso(ctx);
  if (doPercurso) linhas.push(doPercurso.trim());

  linhas.push('');
  linhas.push('---');
  linhas.push('');
  linhas.push('O que o procedimento manda nesta parada, sem alteração:');
  linhas.push('');
  linhas.push(redigirParada(ctx.procedimento, ctx.posicao, ctx.modoOperacional, 'iniciante'));
  linhas.push('');
  linhas.push(RETOMAR_NAO_AVANCA);

  return {
    texto: linhas.join('\n'),
    detalhe: proveniencia(
      ctx,
      `modo=diagnostico dificuldade=${tipo} avanco=nao posicao_intacta=sim ` +
        `percepcao=${ctx.visual?.estado ?? 'inativa'} mensagens=${ctx.visual?.mensagens.length ?? 0} ` +
        `percurso=${ctx.percurso?.leitura ?? 'sem_leitura'}`,
    ),
    ilustracao: ilustrarParada(ctx.procedimento, ctx.posicao),
    resolveu: true,
  };
}

/**
 * PRÁTICA — perguntar antes de responder, com teto.
 *
 * `esgotouSocratico` é o que impede o interrogatório: depois de duas perguntas
 * sem a pessoa chegar lá, a IARA ensina. Quem não sabe continuar não sabendo por
 * mais uma rodada não aprendeu nada — só aprendeu que pedir ajuda custa caro.
 */
async function praticar(idUsuario: string, ctx: ContextoDeTreinamento, resposta: string) {
  const parada = chaveDaParada(ctx.posicao.etapa.numero, ctx.posicao.slide.indice);

  if (resposta.trim()) {
    /* A pessoa respondeu. A IARA REVELA e deixa a comparação com ela — não
       pontua: pontuar texto livre exigiria um limiar sem medição, e um limiar
       chutado aqui reprovaria gente por sinônimo. Quem pontua é a avaliação, com
       alternativas verbatim e acerto exato. */
    await progressosDeTreinamento.marcarPraticada(
      idUsuario,
      ctx.alvo,
      ctx.posicao.etapa.numero,
      ctx.posicao.slide.indice,
    );
    return {
      texto:
        'Vamos comparar com o documento. É isto que o POP manda nesta parada:\n\n' +
        `${redigirParada(ctx.procedimento, ctx.posicao, 'treinar', 'intermediario')}\n\n` +
        '_Eu não pontuei sua resposta: comparar texto livre com o procedimento seria eu ' +
        'adivinhando o que você quis dizer. Se quiser nota, me peça para te testar._',
      detalhe: proveniencia(ctx, 'modo=pratica revelou=sim pontuou=nao'),
      ilustracao: ilustrarParada(ctx.procedimento, ctx.posicao),
      resolveu: true,
    };
  }

  if (esgotouSocratico(ctx.progresso, parada)) {
    await progressosDeTreinamento.aplicarEvento(idUsuario, ctx.alvo, 'desistiu_da_pratica');
    const ensinado = await ensinar(idUsuario, ctx);
    return {
      ...ensinado,
      texto:
        'Já perguntei duas vezes sobre esta parada e não vou insistir — ' +
        `quem não sabe não aprende sendo perguntado de novo.\n\n${ensinado.texto}`,
      detalhe: proveniencia(ctx, 'modo=pratica socratico=esgotado ensinou=sim'),
    };
  }

  await progressosDeTreinamento.aplicarEvento(idUsuario, ctx.alvo, 'pediu_pratica');
  await progressosDeTreinamento.contarSocratica(
    idUsuario,
    ctx.alvo,
    ctx.posicao.etapa.numero,
    ctx.posicao.slide.indice,
  );

  const marcas = ctx.posicao.slide.passos.length;
  return {
    texto:
      `Combinado — nesta você tenta primeiro. Estamos na parada ${ctx.posicao.indice} de ` +
      `${ctx.posicao.total} do ${ctx.procedimento.codigo}, etapa "${ctx.posicao.etapa.titulo}".\n\n` +
      (marcas > 0
        ? `O POP marca ${contar(marcas, 'ponto', 'pontos')} nesta tela. Sem eu mostrar: ` +
          'qual seria sua **primeira** ação aqui, e onde você procuraria?'
        : 'Sem eu mostrar: o que você faria nesta etapa, e o que esperaria ver depois?') +
      '\n\n_Se preferir que eu já mostre, é só dizer. Eu pergunto no máximo duas vezes por parada._',
    detalhe: proveniencia(ctx, 'modo=pratica pergunta=socratica revelou=nao'),
    resolveu: true,
  };
}

/**
 * AVALIAÇÃO — exercício de múltipla escolha construído do próprio POP.
 *
 * Duas entradas no mesmo modo: sem questão pendente, monta uma; com questão
 * pendente e resposta, corrige. Separá-las em duas habilidades faria a correção
 * depender de a LLM escolher a habilidade certa no turno seguinte — e uma
 * correção que não acontece deixa a questão pendente para sempre.
 */
async function avaliar(idUsuario: string, ctx: ContextoDeTreinamento, resposta: string) {
  const pendente = ctx.progresso?.pergunta_pendente ?? null;

  if (pendente) {
    const escolha = escolhaDoOperador(pendente, resposta);
    const r = veredito(pendente, escolha);

    if (r === 'nao_coberta') {
      /* NÃO REGISTRA. "Não li sua resposta" não é "você errou", e gravar como
         erro contaminaria o progresso com falhas que ninguém cometeu — o mesmo
         princípio de `SituacaoNaParada.indefinido`. A questão continua pendente. */
      return {
        texto:
          `${COMENTARIO_DO_VEREDITO.nao_coberta}\n\n${redigirQuestao(pendente)}`,
        detalhe: proveniencia(ctx, 'modo=avaliacao veredito=nao_coberta registrado=nao'),
        resolveu: true,
      };
    }

    await progressosDeTreinamento.registrarAvaliacao(idUsuario, ctx.alvo, {
      parada: pendente.parada,
      resultado: r,
    });
    if (r === 'correta') {
      await progressosDeTreinamento.aplicarEvento(idUsuario, ctx.alvo, 'concluiu_avaliacao');
    }

    const linhas: string[] = [];
    linhas.push(COMENTARIO_DO_VEREDITO[r]);
    linhas.push('');
    linhas.push(
      `A alternativa correta era **${letraDaAlternativa(pendente.correta)})** — ` +
        `parada ${pendente.paradas[pendente.correta]} do procedimento.`,
    );
    if (r !== 'correta') {
      linhas.push('');
      linhas.push('Vamos rever a parada em que você está antes de seguir:');
      linhas.push('');
      linhas.push(redigirParada(ctx.procedimento, ctx.posicao, 'treinar', 'iniciante'));
    }
    linhas.push('');
    linhas.push(`_${pendente.fonte}_`);
    linhas.push('');
    linhas.push(`⚠️ ${AVISO_AVALIACAO}`);

    return {
      texto: linhas.join('\n'),
      detalhe: proveniencia(ctx, `modo=avaliacao veredito=${r} escolha=${escolha} habilitou=nao`),
      resolveu: true,
    };
  }

  const todas = posicoes(ctx.procedimento);
  const pergunta = montarPergunta(
    ctx.procedimento,
    todas,
    ctx.posicao,
    (ctx.progresso?.avaliacoes.length ?? 0) + ctx.posicao.indice,
  );

  if (!pergunta) {
    return {
      texto:
        `Não consigo montar um exercício honesto sobre o ${ctx.procedimento.codigo} nesta parada: ` +
        'as alternativas de uma questão saem verbatim de outras paradas deste mesmo POP, e aqui ' +
        'não há paradas distintas o bastante. Inventar alternativas seria eu escrevendo ' +
        'procedimento — que é a única coisa que eu não faço.',
      detalhe: proveniencia(ctx, 'modo=avaliacao questao=impossivel'),
      resolveu: false,
    };
  }

  await progressosDeTreinamento.aplicarEvento(idUsuario, ctx.alvo, 'pediu_avaliacao');
  await progressosDeTreinamento.guardarPergunta(idUsuario, ctx.alvo, pergunta);

  return {
    texto: `${redigirQuestao(pergunta)}\n\n⚠️ ${AVISO_AVALIACAO}`,
    detalhe: proveniencia(ctx, `modo=avaliacao questao=${pergunta.tipo} alternativas=${pergunta.alternativas.length}`),
    resolveu: true,
  };
}

/** A questão, na forma que o operador lê. Alternativas verbatim, com letra. */
function redigirQuestao(pergunta: { enunciado: string; alternativas: readonly string[] }): string {
  const linhas = [pergunta.enunciado, ''];
  pergunta.alternativas.forEach((alt, i) => {
    linhas.push(`**${letraDaAlternativa(i)})** ${alt}`);
  });
  linhas.push('');
  linhas.push('_Responda com a letra. As alternativas são trechos verbatim do próprio POP._');
  return linhas.join('\n');
}

/**
 * EXECUÇÃO — a pessoa tentou reportar e não afirmou nada.
 *
 * Este modo só é alcançado com hesitação ("acho que fiz"). O avanço de verdade
 * é de `avancar_procedimento`; aqui a IARA registra a dificuldade e diz o que
 * falta, sem repetir "ninguém me confirmou" para quem já explicou que está em
 * dúvida sobre a própria execução.
 */
async function sobreExecucao(
  idUsuario: string,
  ctx: ContextoDeTreinamento,
  dificuldade: TipoDeDificuldade | null,
  enunciado: string,
) {
  if (dificuldade === 'evidencia_insuficiente') {
    return diagnosticar(idUsuario, ctx, 'evidencia_insuficiente', enunciado);
  }
  return ensinar(idUsuario, ctx);
}

export const HABILIDADES_TREINAMENTO: readonly Habilidade[] = [treinarProcedimento];
