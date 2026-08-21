/**
 * `observar_tela` — a porta de PRODUTO da percepção.
 *
 * O QUE ELA FECHA. Depois do P0 existia captura, detecção, transporte e estado —
 * e nenhum caminho pelo qual a IARA ligasse aquilo. Só um script de prova
 * ligava, e script não é produto. Esta habilidade é o que transforma
 * "a infraestrutura existe" em "a IARA consegue acompanhar o operador".
 *
 * QUATRO AÇÕES, uma habilidade. `solicitar` pede, `autorizar` liga, `encerrar`
 * é o kill switch e `situacao` responde "você está me observando agora?".
 * Separá-las em quatro habilidades colocaria a decisão no catálogo — isto é, na
 * LLM que escolhe — e a escolha errada aqui LIGA A CÂMERA de alguém.
 *
 * A DECISÃO É DETERMINÍSTICA. `classificarPercepcao` lê a frase crua; a receita
 * do planejador passa a ação já resolvida. A LLM pode preencher o parâmetro,
 * mas nunca é ela quem decide — é a mesma lei de `agendar_lembrete` e
 * `consultar_procedimento`, aplicada ao caso em que ela mais importa.
 *
 * O QUE ESTA HABILIDADE NÃO FAZ:
 *
 *   NÃO captura                 quem captura é o Braço, na máquina da pessoa
 *   NÃO lê tela sem autorização `autorizar` é a única porta que aciona o Braço
 *   NÃO avança procedimento     não conhece `ProcedimentosEmCurso`
 *   NÃO produz evidência        percepção não é conferência
 *   NÃO escolhe o programa      escopo vem do operador, nunca de suposição
 */

import type { Habilidade } from '../Habilidade';
import { percepcaoDeTela } from '../../PercepcaoDeTela';
import { procedimentosEmCurso } from '../../ProcedimentosEmCurso';
import { classificarPercepcao, extrairAplicativo } from '../IntencaoDePercepcao';
import { RESSALVA } from '../Verdade';
import { TETO_DA_SESSAO_MS, VALIDADE_DA_SOLICITACAO_MS } from '../../../../lib/percepcao';

const MINUTOS = (ms: number) => Math.round(ms / 60_000);

/**
 * O QUE A IARA PROMETE ao pedir. Constante porque é contrato, não redação: cada
 * frase aqui corresponde a uma trava que existe no código, e mudar o texto sem
 * mudar a trava seria a IARA prometendo o que não cumpre.
 */
const O_QUE_EU_FACO = [
  `Observo **só a janela do programa que você autorizar** — se você mudar para outro, eu paro sozinha.`,
  `**Não envio imagem da sua tela.** O que sai do seu computador é um resumo numérico do que mudou, com o nome do programa.`,
  `A sessão morre sozinha em ${MINUTOS(TETO_DA_SESSAO_MS)} minutos, mesmo que ninguém peça.`,
  `Você para quando quiser dizendo **"para de observar"**.`,
];

/** O que a percepção NUNCA vai fazer, dito antes de ela começar. */
const O_QUE_EU_NAO_FACO =
  'Observar não me autoriza a avançar etapa nenhuma: eu vejo que a tela mudou, ' +
  'não que você fez o que o procedimento manda. Quem confirma continua sendo você.';

export const observarTela: Habilidade = {
  manifesto: {
    id: 'observar_tela',
    nome: 'Acompanhar a tela do operador',
    descricao:
      'Pede, liga, informa e desliga o acompanhamento da tela do operador pelo programa da IARA ' +
      'instalado no computador dele. Use quando a pessoa pedir para ser acompanhada enquanto ' +
      'executa ("me acompanha fazendo", "fica vendo minha tela"), quando autorizar ' +
      '("pode observar o chrome"), quando mandar parar ("para de observar") ou quando perguntar ' +
      'se está sendo observada. NÃO captura nada por conta própria: sem autorização explícita do ' +
      'operador nada é observado.',
    exemplos: [
      'Me acompanha fazendo esse procedimento',
      'Fica vendo minha tela enquanto eu faço',
      'Pode observar o chrome',
      'Para de observar minha tela',
      'Você está vendo minha tela agora?',
    ],
    capacidades: [
      'acompanhar a tela do operador',
      'ligar e desligar a percepção de tela',
      'informar se a observação está ativa',
    ],
    dominio: 'automacao',
    capacidade: 'percepcao',
    permissoes: ['memoria'],
    timeout_ms: 5000,
    custo: 'zero',
    /**
     * `medio`, e a escolha merece a explicação. Não é `alto` porque nada aqui é
     * irreversível nem alcança terceiro — o pior caso é a IARA observar uma
     * janela por até meia hora e o operador mandar parar. Não é `baixo` porque
     * uma das quatro ações LIGA a observação da tela de uma pessoa, e tratar
     * isso como leitura seria classificar pela dificuldade técnica em vez de
     * pelo que acontece com quem está do outro lado.
     */
    risco: 'medio',
    idempotencia: 'escrita_idempotente',
    esquema: {
      acao: {
        tipo: 'texto',
        dentre: ['solicitar', 'autorizar', 'encerrar', 'situacao'],
        padrao: 'situacao',
      },
      /** O programa a observar. Sem ele, `autorizar` recusa em vez de supor. */
      aplicativo: { tipo: 'texto' },
    },
  },

  async executar(ctx) {
    /* A FRASE CRUA DECIDE, e o parâmetro é o plano B. Se a ação viesse só do
       campo que a camada de raciocínio preenche, um modelo confuso poderia
       transformar "para de olhar" em `solicitar`. */
    const daFrase = classificarPercepcao(ctx.enunciado);
    const acao = daFrase ?? (ctx.parametros.acao ? String(ctx.parametros.acao) : 'situacao');
    const aplicativo =
      extrairAplicativo(ctx.enunciado) ??
      (ctx.parametros.aplicativo ? String(ctx.parametros.aplicativo).toLowerCase() : null);

    if (acao === 'encerrar') return encerrar(ctx.id_usuario);
    if (acao === 'situacao') return situacao(ctx.id_usuario);
    if (acao === 'autorizar') return autorizar(ctx.id_usuario, aplicativo);
    return solicitar(ctx.id_usuario, aplicativo);
  },

  /**
   * O QUE ESTE VERIFICADOR CONFIRMA: o estado da sessão no registro do motor.
   *
   * NÃO confirma que a tela está sendo capturada — isso acontece na máquina da
   * pessoa, e a única prova disso é o Braço dizendo `sessao_iniciada`. Um
   * verificador que afirmasse captura a partir do envio cometeria exatamente o
   * erro que `enviada_ao_dispositivo` existe para não cometer.
   */
  async verificar(_resultado, ctx) {
    const viva = percepcaoDeTela.vivaDe(ctx.id_usuario);
    const pendente = percepcaoDeTela.pendenteDe(ctx.id_usuario);
    if (viva) {
      return {
        confirmado: true,
        evidencia:
          `sessão ${viva.sessao_percepcao} em estado ${viva.estado}, escopo ${viva.processos.join(',')}; ` +
          'a captura acontece no computador do operador e é relatada por ele',
      };
    }
    if (pendente) {
      return {
        confirmado: true,
        evidencia: `pedido ${pendente.sessao_percepcao} aguardando autorização; nada é observado`,
      };
    }
    return {
      confirmado: true,
      evidencia: 'nenhuma sessão de percepção viva para este operador',
    };
  },
};

// ---------------------------------------------------------------------------

async function solicitar(idUsuario: string, aplicativo: string | null) {
  const emCurso = await procedimentosEmCurso.emCurso(idUsuario);
  const r = percepcaoDeTela.solicitar({
    id_usuario: idUsuario,
    escopo: { processos: aplicativo ? [aplicativo] : [] },
    motivo: emCurso
      ? `acompanhar a execução do ${emCurso.codigo}`
      : 'acompanhar o operador na tela',
    procedimento: emCurso?.codigo ?? null,
  });

  if (!r.ok) {
    return {
      texto:
        `Não consigo começar a acompanhar sua tela agora: ${r.motivo}. ` +
        'O programa da IARA precisa estar aberto no computador que você quer que eu veja.',
      detalhe: `percepcao solicitar recusada: ${r.motivo}`,
      resolveu: false,
    };
  }

  const linhas: string[] = [];
  linhas.push(
    emCurso
      ? `Posso acompanhar sua tela enquanto você faz o **${emCurso.codigo}**.`
      : 'Posso acompanhar sua tela enquanto você trabalha.',
  );
  linhas.push('');
  for (const item of O_QUE_EU_FACO) linhas.push(`- ${item}`);
  linhas.push('');
  linhas.push(O_QUE_EU_NAO_FACO);
  linhas.push('');
  linhas.push(
    aplicativo
      ? `Para começar, responda **"pode observar o ${aplicativo}"**.`
      : 'Para começar, me diga qual programa devo acompanhar — por exemplo ' +
        '**"pode observar o chrome"**. Eu não escolho por você.',
  );
  linhas.push('');
  linhas.push(`_O pedido vale por ${MINUTOS(VALIDADE_DA_SOLICITACAO_MS)} minutos._`);

  return {
    texto: linhas.join('\n'),
    detalhe:
      `percepcao solicitada sessao=${r.estado.sessao_percepcao} ` +
      `escopo=${r.estado.processos.join(',') || 'indefinido'} pop=${r.estado.procedimento ?? 'nenhum'}`,
    resolveu: true,
  };
}

async function autorizar(idUsuario: string, aplicativo: string | null) {
  const r = percepcaoDeTela.autorizar(idUsuario, {
    ...(aplicativo ? { escopo: { processos: [aplicativo] } } : {}),
  });

  if (!r.ok) {
    return {
      texto:
        r.motivo === 'não sei qual programa devo acompanhar'
          ? 'Preciso que você diga qual programa devo acompanhar — por exemplo ' +
            '**"pode observar o chrome"**. Eu não escolho a janela por você.'
          : `Não consegui ligar a observação: ${r.motivo}.`,
      detalhe: `percepcao autorizar recusada: ${r.motivo}`,
      resolveu: false,
    };
  }

  return {
    texto:
      `Combinado. Vou acompanhar **${r.estado.processos.join(', ')}** a partir de agora.\n\n` +
      'O programa da IARA no seu computador mostra o indicador enquanto estiver observando, e ' +
      `para sozinho se você mudar de janela. Quando quiser parar, diga **"para de observar"**.\n\n` +
      `_${RESSALVA.inferencia} — o que eu vejo é que a tela mudou, não o que você fez nela._`,
    detalhe:
      `percepcao autorizada sessao=${r.estado.sessao_percepcao} ` +
      `escopo=${r.estado.processos.join(',')} autorizada_em=${r.estado.autorizada_em}`,
    resolveu: true,
  };
}

function encerrar(idUsuario: string) {
  const r = percepcaoDeTela.encerrar(idUsuario, 'o operador pediu para parar');
  if (!r.ok) {
    return {
      texto: 'Eu não estou acompanhando sua tela agora — não há nada para parar.',
      detalhe: `percepcao encerrar sem sessão: ${r.motivo}`,
      resolveu: true,
    };
  }
  return {
    texto:
      'Parei de acompanhar sua tela. Mandei o programa do seu computador desligar a observação ' +
      'e já marquei a sessão como encerrada aqui — nenhum evento novo é aceito nela.',
    detalhe: `percepcao encerrada sessao=${r.estado.sessao_percepcao} mudancas=${r.estado.mudancas}`,
    resolveu: true,
  };
}

function situacao(idUsuario: string) {
  const ativa = percepcaoDeTela.ativaDe(idUsuario);
  const pendente = percepcaoDeTela.pendenteDe(idUsuario);

  if (ativa) {
    const desde = ativa.autorizada_em ?? ativa.solicitada_em;
    return {
      texto:
        `Sim — estou acompanhando **${ativa.processos.join(', ')}** neste computador ` +
        `(${ativa.id_dispositivo})${desde ? `, desde ${desde.slice(11, 16)}` : ''}.\n\n` +
        (ativa.estado === 'suspensa'
          ? 'Agora mesmo estou **pausada**: a janela em foco não é a que você autorizou.\n\n'
          : `Já registrei ${ativa.mudancas} mudança(s) de tela.\n\n`) +
        'Para parar, diga **"para de observar"**.',
      detalhe: `percepcao situacao=${ativa.estado} sessao=${ativa.sessao_percepcao}`,
      resolveu: true,
    };
  }
  if (pendente) {
    return {
      texto:
        'Ainda não. Eu pedi para acompanhar sua tela e estou esperando você autorizar — ' +
        'responda **"pode observar o \\<programa\\>"** se quiser.',
      detalhe: `percepcao pendente sessao=${pendente.sessao_percepcao}`,
      resolveu: true,
    };
  }
  return {
    texto:
      'Não. Não estou vendo sua tela, e não tenho nenhum pedido aberto para isso. ' +
      'Eu só observo depois que você autoriza, e só a janela que você indicar.',
    detalhe: 'percepcao inativa',
    resolveu: true,
  };
}

export const HABILIDADES_PERCEPCAO: readonly Habilidade[] = [observarTela];
