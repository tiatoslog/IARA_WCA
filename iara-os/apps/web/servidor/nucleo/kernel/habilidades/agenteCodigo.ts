/**
 * A IARA DELEGANDO TRABALHO A UM AGENTE DE CÓDIGO.
 *
 * Três verbos, e a separação entre eles não é cosmética — cada um tem risco,
 * semântica de repetição e evidência diferentes:
 *
 *   abrir   nasce uma sessão e a primeira instrução é enviada. Risco ALTO,
 *           não idempotente: repetir abre outra sessão e faz o trabalho de novo.
 *   mandar  outra instrução para uma sessão existente. Mesmo risco, mesma
 *           semântica, evidência diferente (a sessão precisa EXISTIR antes).
 *   olhar   consulta. Risco baixo, leitura, sem confirmação nem verificação.
 *
 * Encerrar mora junto de olhar por conveniência de leitura, mas é escrita.
 *
 * ONDE ESTÁ A TRAVA, e por que ela não está aqui. O esquema abaixo aceita
 * `repositorio` como TEXTO, e isso pareceria a brecha óbvia — até se notar que
 * o valor nunca vira caminho. Ele é resolvido por `resolverRepositorio` contra
 * uma allowlist de APELIDOS declarada em `IARA_REPOS_AGENTE`. "Abra o Claude
 * Code em C:\Windows\System32" não é barrado por uma regra sobre System32: ele
 * simplesmente não resolve para repositório nenhum, do mesmo jeito que "abra o
 * formatador de disco" não resolve para aplicativo nenhum. Ver
 * `RepositoriosAutorizados.ts`, e os testes adversariais em
 * `testes/repositorios-autorizados.test.ts`.
 *
 * RISCO ALTO é decisão, não excesso. Lançar um agente autônomo que edita
 * arquivos na máquina da operadora é a coisa mais poderosa deste catálogo, e o
 * `PorteiroAutorizacao` exige `operador` como fonte de autorização para risco
 * alto — ou seja, um plano emitido pela LLM não abre sessão sozinho. É a mesma
 * invariante que impede a LLM de desligar a máquina, aplicada aqui pelo mesmo
 * motivo: quem raciocina não autoriza.
 *
 * E A REGRA DE VERDADE, que é o ponto do exercício inteiro: nenhum destes
 * verbos afirma resultado a partir de "o processo foi lançado". O julgamento
 * mora em `SessoesAgenteCodigo.julgarSessao`, exige que saída do processo,
 * `is_error` e identidade da sessão CONCORDEM, e devolve `desconhecida` quando
 * não concordam. Duas armadilhas reais estão presas por teste lá — entre elas o
 * `subtype: "success"` que o binário devolve junto de `is_error: true`.
 */

import type { Habilidade } from '../Habilidade';
import { agenteLocal } from '../../AgenteLocal';
import { repositoriosDisponiveis, VARIAVEL_REPOS } from '../../RepositoriosAutorizados';

/** Desligada quando não há repositório autorizado — e a frase diz como ligar. */
function semRepositorios(): string | null {
  return repositoriosDisponiveis().startsWith('nenhum')
    ? `${VARIAVEL_REPOS} não está configurada neste computador: não há repositório autorizado ` +
        'para um agente de código trabalhar.'
    : null;
}

export const abrirSessaoAgenteCodigo: Habilidade = {
  manifesto: {
    id: 'abrir_sessao_agente_codigo',
    nome: 'Abrir sessão de agente de código',
    descricao:
      'Abre uma nova sessão do Claude Code num repositório AUTORIZADO e envia uma instrução de trabalho. ' +
      'O repositório é escolhido por apelido de uma lista fechada — nunca por caminho. ' +
      'Use para "abra uma sessão do Claude Code no repositório X e peça para ele fazer Y".',
    exemplos: [
      'Abra uma nova sessão do Claude Code no repositório IARA e peça para auditar a camada de voz',
      'Manda o Claude Code corrigir os testes quebrados no iara',
      'Abre o Claude Code no repositório iara e pede para revisar os botões',
    ],
    capacidades: [
      'delegar trabalho de código a um agente',
      'abrir sessão do Claude Code em repositório autorizado',
    ],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    /* Teto acima da janela de veredito antecipado do `AgenteLocal` (12 s): a
       habilidade precisa sobreviver à espera pela falha de partida. */
    timeout_ms: 20_000,
    custo: 'zero',
    risco: 'alto',
    /* Repetir NÃO converge: cada chamada abre outra sessão e refaz o trabalho. */
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      repositorio: { tipo: 'texto', obrigatorio: true, max: 120 },
      instrucao: { tipo: 'texto', obrigatorio: true, max: 4000 },
    },
  },

  indisponivelPorque: semRepositorios,

  async executar(ctx) {
    const repositorio = String(ctx.parametros.repositorio ?? '');
    const instrucao = String(ctx.parametros.instrucao ?? '');
    const relato = await agenteLocal.abrirSessaoAgente(ctx.id_usuario, repositorio, instrucao);
    return {
      texto: relato.texto,
      detalhe: `abrir_sessao_agente: ${relato.prova.evidencia}`,
      resolveu: relato.ok,
    };
  },

  /**
   * A QUINTA PORTA. Ela não repete o trabalho nem relê o texto que `executar`
   * devolveu — pergunta ao registro de sessões qual é o estado ATUAL, que é
   * outra fonte. Conferir o relato contra o próprio relato é o que esta porta
   * existe para impedir.
   */
  async verificar(_resultado, ctx) {
    const relato = agenteLocal.consultarSessaoAgente(ctx.id_usuario);
    return {
      confirmado: relato.prova.confirmado,
      evidencia: relato.prova.evidencia,
      ...(relato.prova.motivo ? { motivo: relato.prova.motivo } : {}),
    };
  },
};

export const enviarParaAgenteCodigo: Habilidade = {
  manifesto: {
    id: 'enviar_para_agente_codigo',
    nome: 'Mandar instrução para uma sessão de agente',
    descricao:
      'Envia uma nova instrução para uma sessão do Claude Code JÁ ABERTA, continuando o trabalho dela. ' +
      'Exige o id da sessão. Use para "manda o Claude Code continuar", "diz para ele também corrigir Z".',
    exemplos: [
      'Manda o Claude Code continuar a tarefa',
      'Diz para a sessão do Claude Code também rodar os testes',
    ],
    capacidades: ['continuar trabalho de um agente de código já aberto'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 20_000,
    custo: 'zero',
    risco: 'alto',
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      sessao: { tipo: 'texto', obrigatorio: true, max: 60 },
      instrucao: { tipo: 'texto', obrigatorio: true, max: 4000 },
    },
  },

  indisponivelPorque: semRepositorios,

  async executar(ctx) {
    const sessao = String(ctx.parametros.sessao ?? '');
    const instrucao = String(ctx.parametros.instrucao ?? '');
    const relato = await agenteLocal.enviarParaSessaoAgente(ctx.id_usuario, sessao, instrucao);
    return {
      texto: relato.texto,
      detalhe: `enviar_para_sessao_agente: ${relato.prova.evidencia}`,
      resolveu: relato.ok,
    };
  },

  async verificar(_resultado, ctx) {
    const relato = agenteLocal.consultarSessaoAgente(ctx.id_usuario);
    return {
      confirmado: relato.prova.confirmado,
      evidencia: relato.prova.evidencia,
      ...(relato.prova.motivo ? { motivo: relato.prova.motivo } : {}),
    };
  },
};

export const acompanharAgenteCodigo: Habilidade = {
  manifesto: {
    id: 'acompanhar_agente_codigo',
    nome: 'Acompanhar sessões de agente de código',
    descricao:
      'Diz o estado das sessões do Claude Code abertas nesta conversa: qual repositório, se ainda está ' +
      'trabalhando, se terminou, se falhou. Use para "o que o Claude Code está fazendo?", ' +
      '"a sessão terminou?".',
    exemplos: [
      'O que o Claude Code está fazendo?',
      'A sessão do Claude Code já terminou?',
      'Como está o agente de código?',
    ],
    capacidades: ['estado das sessões de agente de código'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 5000,
    custo: 'zero',
    /* Leitura: a resposta É o resultado, e não há o que confirmar depois. */
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      sessao: { tipo: 'texto', obrigatorio: false, max: 60 },
    },
  },

  async executar(ctx) {
    const pedido = ctx.parametros.sessao;
    const sessao = typeof pedido === 'string' && pedido.trim() ? pedido.trim() : undefined;
    const relato = agenteLocal.consultarSessaoAgente(ctx.id_usuario, sessao);
    return {
      texto: relato.texto,
      detalhe: `consultar_sessao_agente: ${relato.prova.evidencia}`,
      resolveu: relato.ok,
    };
  },
};

export const encerrarAgenteCodigo: Habilidade = {
  manifesto: {
    id: 'encerrar_agente_codigo',
    nome: 'Encerrar sessão de agente de código',
    descricao:
      'Encerra uma sessão do Claude Code que está em andamento. Use para "para o Claude Code", ' +
      '"encerra essa sessão", "cancela o agente".',
    exemplos: ['Encerra a sessão do Claude Code', 'Para o agente de código'],
    capacidades: ['encerrar sessão de agente de código'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 5000,
    custo: 'zero',
    risco: 'medio',
    /* Repetir converge: a segunda chamada encontra a sessão já parada. */
    idempotencia: 'escrita_idempotente',
    esquema: {
      sessao: { tipo: 'texto', obrigatorio: true, max: 60 },
    },
  },

  async executar(ctx) {
    const relato = agenteLocal.encerrarSessaoAgente(ctx.id_usuario, String(ctx.parametros.sessao ?? ''));
    return {
      texto: relato.texto,
      detalhe: `encerrar_sessao_agente: ${relato.prova.evidencia}`,
      resolveu: relato.ok,
    };
  },

  async verificar(_resultado, ctx) {
    const relato = agenteLocal.consultarSessaoAgente(ctx.id_usuario);
    return {
      confirmado: relato.prova.confirmado,
      evidencia: relato.prova.evidencia,
      ...(relato.prova.motivo ? { motivo: relato.prova.motivo } : {}),
    };
  },
};

export const HABILIDADES_AGENTE_CODIGO: readonly Habilidade[] = [
  abrirSessaoAgenteCodigo,
  enviarParaAgenteCodigo,
  acompanharAgenteCodigo,
  encerrarAgenteCodigo,
];
