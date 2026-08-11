/**
 * Operação — a identidade de uma coisa que a IARA vai fazer no mundo.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE, e que nenhum outro respondia:
 *
 *   de que exatamente estamos falando quando dizemos "essa ação"?
 *
 * Até aqui não havia resposta. Um passo de plano era um objeto anônimo que
 * nascia e morria dentro de `executarPlano`: não tinha nome, não tinha estado
 * persistido e não tinha identidade. Isso é suportável enquanto tudo que a IARA
 * faz é LER — uma leitura repetida devolve a mesma coisa e ninguém se machuca.
 * Deixa de ser suportável no primeiro efeito não idempotente. "Reenvie" e
 * "envie de novo" precisam ser distinguíveis, e sem identidade não são.
 *
 * `Verdade.ts` já dava vocabulário para o que se SABE sobre uma ação. Este
 * arquivo dá vocabulário para a ação em si — quem é ela, o que a identifica, e
 * por quais estados ela pode passar. São camadas diferentes de propósito:
 * `EstadoExecucao` descreve a evidência de UM passo dentro de um turno;
 * `EstadoOperacao` descreve o ciclo de vida de uma coisa que sobrevive ao turno,
 * ao processo e ao restart.
 *
 * Nada aqui tem dependência de I/O. É contrato puro: tipos, uma máquina de
 * transições e duas funções de derivação. Quem persiste é `RegistroOperacoes`.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { Risco } from './Habilidade';

// ---------------------------------------------------------------------------
// 1. Semântica de efeito — o que acontece se isto rodar duas vezes
// ---------------------------------------------------------------------------

/**
 * A pergunta que toda habilidade que alcança o mundo precisa saber responder.
 *
 * Não é o mesmo que `risco`. Risco é QUANTO CUSTA ERRAR — e por isso governa
 * confirmação prévia. Semântica de efeito é O QUE ACONTECE SE REPETIR — e por
 * isso governa deduplicação e retry. Uma habilidade pode ser de risco baixo e
 * não idempotente (incrementar um contador), ou de risco alto e idempotente
 * (desligar uma máquina já desligada). Fundir as duas perguntas numa só é como
 * se autoriza um reenvio achando que se autorizou uma releitura.
 */
export type SemanticaEfeito =
  /** Não altera nada. Repetir é grátis e devolve o mesmo. */
  | 'leitura'
  /**
   * Altera, mas repetir converge para o mesmo estado. `criar_pasta` é o caso
   * canônico: a segunda chamada encontra a pasta e não cria outra.
   */
  | 'escrita_idempotente'
  /**
   * Repetir produz DOIS efeitos. Mensagem enviada, e-mail, pedido, pagamento,
   * documento emitido. É a família inteira que exige o controle deste arquivo.
   */
  | 'escrita_nao_idempotente'
  /**
   * A habilidade não sabe declarar o que acontece se repetir.
   *
   * Valor legítimo e deliberadamente inútil: quem declara isto NÃO é liberado
   * para execução real (`podeExecutar` recusa). "Não sei" é uma resposta
   * honesta e uma razão suficiente para não deixar o efeito acontecer — o
   * contrário, deixar rodar o que ninguém soube classificar, é exatamente como
   * um duplo envio chega ao cliente.
   */
  | 'efeito_desconhecido';

/** Esta semântica pode alcançar o mundo? */
export function podeExecutar(s: SemanticaEfeito): boolean {
  return s !== 'efeito_desconhecido';
}

/** Esta semântica exige controle de duplicidade antes de executar? */
export function exigeControleDeDuplicidade(s: SemanticaEfeito): boolean {
  return s === 'escrita_nao_idempotente';
}

// ---------------------------------------------------------------------------
// 2. Evidência — quem tem autoridade para afirmar o que
// ---------------------------------------------------------------------------

/**
 * A FONTE é o campo que carrega a segurança inteira deste módulo.
 *
 * Um estado só avança porque alguém apurou alguma coisa, e nem todo mundo pode
 * apurar qualquer coisa. Modelar evidência como string livre seria devolver à
 * camada de raciocínio a autoridade que o `PorteiroAutorizacao` tirou dela: a
 * LLM escreve uma frase convincente, alguém a passa adiante como `evidencia`, e
 * `desconhecida` vira `verificada` sem ninguém ter conferido nada.
 *
 * Repare no que NÃO está na lista: não existe fonte `llm`, não existe fonte
 * `documento`, não existe fonte `memoria`. Não é omissão — é a regra. Conteúdo
 * externo e saída de modelo entram no sistema como MATÉRIA, nunca como prova.
 */
export type FonteEvidencia =
  /** Conferiu o mundo depois de agir. A única que promove a `verificada`. */
  | 'verificador'
  /** O executor relatou. Vale para registrar, nunca para confirmar. */
  | 'executor'
  /** O porteiro/autorização decidiu. Vale para barrar e para autorizar. */
  | 'porteiro'
  /** O relógio venceu. Vale para expirar. */
  | 'relogio'
  /** O operador falou. Vale para confirmar e para cancelar. */
  | 'operador'
  /** A reidratação encontrou a operação neste estado depois de um restart. */
  | 'reidratacao'
  /**
   * O provedor externo respondeu. Vale para registrar aceite e para declarar
   * recusa — NUNCA para confirmar que o efeito chegou ao mundo. Um `200 OK` é
   * uma afirmação sobre a fila do provedor, não sobre o destinatário.
   */
  | 'provedor';

export interface Evidencia {
  readonly fonte: FonteEvidencia;
  /** Uma linha: o que foi apurado. Vai para o jornal e para a auditoria. */
  readonly descricao: string;
  /** ISO 8601. */
  readonly instante: string;
}

export function evidencia(fonte: FonteEvidencia, descricao: string): Evidencia {
  return { fonte, descricao, instante: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// 3. Estados
// ---------------------------------------------------------------------------

/**
 * O ciclo de vida de uma operação.
 *
 * Estes estados são EXPLÍCITOS e persistidos. A alternativa — que era o que
 * existia — é estado implícito espalhado em booleanos e strings pelo Kernel:
 * `resolveu`, `confirmado`, ausência de exceção. Estado implícito não sobrevive
 * a um restart, porque não há o que reidratar.
 */
export type EstadoOperacao =
  /** Existe, tem identidade, ainda não pediu nada a ninguém. */
  | 'planejada'
  /** Risco alto: precisa de uma fala humana antes de qualquer efeito. */
  | 'aguardando_autorizacao'
  /** Pode executar. Nunca é o mesmo que ter executado. */
  | 'autorizada'
  /**
   * O efeito PODE estar acontecendo agora. Este estado é gravado ANTES de
   * chamar o executor, e é por isso que ele existe: se o processo morrer no
   * meio, é o que a reidratação encontra — e "pode ter acontecido" é a única
   * leitura honesta de um registro assim.
   */
  | 'executando'
  /** O executor voltou sem erro. Ainda NÃO é verdade — só um relato. */
  | 'executada_nao_verificada'
  /**
   * O PROVEDOR ACEITOU — e aceitar não é entregar.
   *
   * Estado próprio porque a diferença é a que mais engana. A Meta devolve um
   * `message id` e HTTP 200: isso prova que a requisição foi recebida e
   * enfileirada, não que a mensagem chegou a alguém. Colapsar os dois em
   * "enviado" é a mentira operacional na sua forma mais confortável, porque o
   * provedor de fato respondeu que sim.
   *
   * Fica entre `executando` e `verificada`: mais forte que "mandei e não sei",
   * mais fraco que "o mundo confirma". Só um verificador atravessa a última
   * fronteira.
   */
  | 'aceita_pelo_provedor'
  /** O mundo confirmou. Só aqui se pode dizer "feito". */
  | 'verificada'
  /** Não aconteceu, e isso é FATO apurado — não a ausência de notícia. */
  | 'falhou'
  /**
   * O estado mais importante da lista.
   *
   * Cobre "o efeito pode existir e eu não consigo provar". Timeout depois de a
   * requisição sair, resposta perdida, processo morto no meio, verificador sem
   * meio de conferir. Sem este estado, tudo isso vira `falhou` — e `falhou`
   * autoriza um retry que duplica o efeito. É literalmente aqui que mora a
   * diferença entre um sistema que reenvia e um que pergunta antes.
   */
  | 'desconhecida'
  /** O operador desistiu. Terminal e definitivo. */
  | 'cancelada'
  /** A janela de autorização venceu sem fala humana. */
  | 'expirada';

/** O ciclo acabou? */
export function ehTerminalOperacao(e: EstadoOperacao): boolean {
  return e === 'verificada' || e === 'falhou' || e === 'cancelada' || e === 'expirada';
}

/**
 * Estados em que o efeito PODE existir no mundo.
 *
 * É a pergunta que um retry tem que fazer antes de repetir qualquer coisa. Note
 * que `executando` está aqui: uma operação encontrada nesse estado depois de um
 * restart é exatamente o caso "o processo morreu com a requisição em voo".
 */
export function efeitoPodeExistir(e: EstadoOperacao): boolean {
  return (
    e === 'executando' ||
    e === 'executada_nao_verificada' ||
    e === 'aceita_pelo_provedor' ||
    e === 'verificada' ||
    e === 'desconhecida'
  );
}

// ---------------------------------------------------------------------------
// 4. A máquina de transições
// ---------------------------------------------------------------------------

/**
 * As arestas permitidas. O que não está aqui é impossível, e tentar é erro —
 * não um silêncio, não um estado aplicado pela metade.
 *
 * Leia as AUSÊNCIAS, que são o conteúdo real desta tabela:
 *
 *  - nada chega em `verificada` vindo de `planejada` ou `aguardando_autorizacao`:
 *    não se pode ter provado um efeito que nunca foi autorizado a acontecer;
 *  - `falhou` não vai a lugar nenhum: "não aconteceu" é apurado, e mudar de
 *    ideia sobre isso exige uma operação NOVA, com identidade nova;
 *  - `cancelada` não vai a lugar nenhum, em especial não vai para `autorizada`:
 *    um "confirmo" atrasado nunca ressuscita o que o operador desistiu de fazer;
 *  - `expirada` não vai a lugar nenhum: janela vencida não se reabre, pede-se
 *    de novo;
 *  - `desconhecida` PODE ir para `verificada` ou `falhou` — mas só com evidência
 *    de verificador, e é `transicionar` que impõe isso, não esta tabela.
 */
const TRANSICOES: Record<EstadoOperacao, readonly EstadoOperacao[]> = {
  planejada: ['aguardando_autorizacao', 'autorizada', 'cancelada', 'expirada', 'falhou'],
  aguardando_autorizacao: ['autorizada', 'cancelada', 'expirada'],
  autorizada: ['executando', 'cancelada', 'expirada'],
  executando: [
    'executada_nao_verificada',
    'aceita_pelo_provedor',
    'verificada',
    'falhou',
    'desconhecida',
  ],
  executada_nao_verificada: ['verificada', 'falhou', 'desconhecida'],
  aceita_pelo_provedor: ['verificada', 'falhou', 'desconhecida'],
  desconhecida: ['verificada', 'falhou'],
  verificada: [],
  falhou: [],
  cancelada: [],
  expirada: [],
};

export function transicaoPermitida(de: EstadoOperacao, para: EstadoOperacao): boolean {
  return TRANSICOES[de].includes(para);
}

export class TransicaoInvalida extends Error {}
export class EvidenciaInsuficiente extends Error {}

// ---------------------------------------------------------------------------
// 5. A operação
// ---------------------------------------------------------------------------

export interface Operacao {
  readonly id_operacao: string;
  /**
   * A identidade do EFEITO PRETENDIDO — não do texto que o operador escreveu.
   * Ver `derivarChaveIdempotencia`.
   */
  readonly chave_idempotencia: string;
  readonly id_usuario: string;
  readonly sessao: string;
  readonly habilidade: string;
  readonly risco: Risco;
  readonly semantica: SemanticaEfeito;
  /** Parâmetros canônicos. Ficam no jornal para a auditoria poder reproduzir. */
  readonly parametros: Readonly<Record<string, unknown>>;
  readonly estado: EstadoOperacao;
  /**
   * O nonce da autorização. Nasce com a operação e é consumido UMA vez.
   *
   * Existe separado do `id_operacao` porque as duas coisas têm tempos de vida
   * diferentes: a operação permanece no jornal para sempre (é o registro), o
   * nonce vale uma única confirmação e some. Reaproveitar o id da operação como
   * nonce faria de todo registro de auditoria uma chave de autorização.
   */
  readonly nonce: string;
  /** `null` até alguém autorizar. Preenchido só por evidência de operador. */
  readonly autorizada_em: string | null;
  /** Prazo da janela de autorização. Depois disto, só `expirada`. */
  readonly expira_em: number;
  readonly criada_em: string;
  readonly atualizada_em: string;
  /** Tudo que já se apurou sobre esta operação, em ordem. */
  readonly historico: readonly Evidencia[];
}

/**
 * Aplica uma transição. Devolve uma operação NOVA — o registro é imutável, e é
 * assim que o jornal consegue ser um jornal.
 *
 * As duas regras que este método impõe, e que a tabela sozinha não impõe:
 *
 *  1. SÓ VERIFICADOR PROMOVE A `verificada`. É a tradução em código de
 *     "execução não é verificação". Um executor entusiasmado, um relógio, um
 *     porteiro — nenhum deles pode dizer que o efeito existe. E como a lista de
 *     fontes não tem `llm`, a camada de raciocínio não tem sequer como tentar.
 *  2. SÓ OPERADOR AUTORIZA. Nem porteiro, nem executor, nem reidratação. O
 *     porteiro decide se a fala do operador BASTA; a fala em si tem que existir.
 */
export function transicionar(
  op: Operacao,
  destino: EstadoOperacao,
  prova: Evidencia,
): Operacao {
  if (!transicaoPermitida(op.estado, destino)) {
    throw new TransicaoInvalida(
      `${op.habilidade}: transição proibida ${op.estado} → ${destino} (operação ${op.id_operacao})`,
    );
  }

  if (destino === 'verificada' && prova.fonte !== 'verificador') {
    throw new EvidenciaInsuficiente(
      `só o verificador promove a "verificada"; veio de "${prova.fonte}" (operação ${op.id_operacao})`,
    );
  }

  if (destino === 'autorizada') {
    /**
     * RISCO ALTO SÓ É AUTORIZADO POR FALA HUMANA — e esta é a SEGUNDA barreira,
     * independente do `PorteiroAutorizacao`.
     *
     * O porteiro decide se um passo pode seguir olhando a ORIGEM do plano. Ele
     * funciona, tem teste, e é a primeira linha. Mas ele é uma checagem num
     * ponto do Kernel: alguém que reordene aquele bloco, ou que acrescente um
     * caminho novo de execução daqui a seis meses, contorna o porteiro sem
     * perceber que contornou.
     *
     * Esta trava não é contornável reordenando código, porque não está no
     * caminho — está no TIPO. Uma operação de risco alto não CONSEGUE chegar a
     * `autorizada` sem uma evidência carimbada `operador`, e quem carimba é
     * quem leu a fala humana. A camada de raciocínio não tem como produzir esse
     * carimbo: `FonteEvidencia` não tem `llm`, e um plano emergente carimba
     * `porteiro` — que aqui é recusado.
     *
     * É o invariante LLM_OUTPUT_IS_NOT_AUTHORIZATION expresso onde ele não
     * depende de ninguém se lembrar dele.
     */
    if (op.risco === 'alto' && prova.fonte !== 'operador') {
      throw new EvidenciaInsuficiente(
        `"${op.habilidade}" é de risco alto e só a fala do operador autoriza; ` +
          `veio de "${prova.fonte}" (operação ${op.id_operacao})`,
      );
    }
    /**
     * Risco baixo e médio dispensam confirmação prévia (ver `PoliticaRisco`) —
     * mas não dispensam AUTORIZAÇÃO REGISTRADA. Quem autoriza é o porteiro, e
     * fica escrito no jornal que foi ele. Executor não se autoriza.
     */
    if (prova.fonte !== 'operador' && prova.fonte !== 'porteiro') {
      throw new EvidenciaInsuficiente(
        `autorização só nasce de "operador" ou "porteiro"; veio de "${prova.fonte}" ` +
          `(operação ${op.id_operacao})`,
      );
    }
  }

  return {
    ...op,
    estado: destino,
    autorizada_em: destino === 'autorizada' ? prova.instante : op.autorizada_em,
    atualizada_em: prova.instante,
    historico: [...op.historico, prova],
  };
}

// ---------------------------------------------------------------------------
// 6. Identidade do efeito
// ---------------------------------------------------------------------------

/**
 * Serialização canônica dos parâmetros: chaves ordenadas, sem espaço.
 *
 * Sem canonicalizar, `{a:1,b:2}` e `{b:2,a:1}` produzem chaves diferentes para
 * o MESMO efeito — e a deduplicação vira sorteio conforme a ordem em que a LLM
 * emitiu o objeto.
 */
function canonico(parametros: Readonly<Record<string, unknown>>): string {
  const chaves = Object.keys(parametros).sort();
  return JSON.stringify(chaves.map((k) => [k, parametros[k]]));
}

/**
 * A CHAVE DE IDEMPOTÊNCIA — a decisão de projeto mais delicada deste trabalho.
 *
 * O que NÃO serve como identidade:
 *
 *  - o texto do operador. "manda de novo" e "reenvia" são o mesmo efeito com
 *    textos diferentes; "manda pro João" duas vezes são efeitos diferentes com
 *    o mesmo texto. Hash de prompt erra os dois casos;
 *  - só (usuário + habilidade + parâmetros). Isso colapsaria DOIS envios
 *    legítimos e idênticos — "avisa o João que cheguei" hoje e amanhã — numa
 *    operação só. Deduplicar demais é tão defeito quanto deduplicar de menos:
 *    a mensagem de amanhã simplesmente não sai, e ninguém fica sabendo.
 *
 * O que identifica é (usuário + habilidade + parâmetros + ORIGEM DO PEDIDO),
 * onde a origem é o turno em que o pedido nasceu. É o discriminador certo
 * porque separa exatamente as duas coisas que precisam ser separadas:
 *
 *  - MESMO turno reentregue ou reexecutado → mesma chave → é retry, deduplica;
 *  - turno NOVO com o mesmo conteúdo → chave nova → é intenção nova, executa.
 *
 * Uma pessoa que pede duas vezes quis duas vezes. Um webhook reentregue não
 * quis nada — quis o provedor.
 */
export function derivarChaveIdempotencia(entrada: {
  id_usuario: string;
  habilidade: string;
  parametros: Readonly<Record<string, unknown>>;
  /** Identidade do turno: id da mensagem do canal, ou o traço do barramento. */
  origem_pedido: string;
}): string {
  return createHash('sha256')
    .update(
      [
        entrada.id_usuario,
        entrada.habilidade,
        canonico(entrada.parametros),
        entrada.origem_pedido,
      ].join(' '),
    )
    .digest('hex')
    .slice(0, 32);
}

/**
 * A IMPRESSÃO DO EFEITO, sem o turno. Duas operações com a mesma impressão
 * querem a mesma coisa — em turnos possivelmente diferentes.
 *
 * Serve à segunda barreira, a do duplo-clique: um efeito não idempotente
 * repetido em segundos quase nunca é uma segunda intenção, é a mesma intenção
 * chegando duas vezes (operador impaciente, canal reentregando, tela travada).
 * A chave de idempotência sozinha não pega esse caso porque os turnos são
 * genuinamente diferentes — e é por isso que existem as duas.
 */
export function impressaoDoEfeito(entrada: {
  id_usuario: string;
  habilidade: string;
  parametros: Readonly<Record<string, unknown>>;
}): string {
  return createHash('sha256')
    .update([entrada.id_usuario, entrada.habilidade, canonico(entrada.parametros)].join(' '))
    .digest('hex')
    .slice(0, 32);
}

// ---------------------------------------------------------------------------

/** Janela padrão para a fala humana chegar. Mesma ordem de grandeza da
 *  pendência de energia — confirmação velha executando ação esquecida é o
 *  acidente que a janela existe para impedir. */
export const VALIDADE_AUTORIZACAO_MS = 60_000;

export function criarOperacao(entrada: {
  id_usuario: string;
  sessao: string;
  habilidade: string;
  risco: Risco;
  semantica: SemanticaEfeito;
  parametros: Readonly<Record<string, unknown>>;
  origem_pedido: string;
  validade_ms?: number;
}): Operacao {
  const agora = new Date();
  return {
    id_operacao: randomUUID(),
    chave_idempotencia: derivarChaveIdempotencia(entrada),
    id_usuario: entrada.id_usuario,
    sessao: entrada.sessao,
    habilidade: entrada.habilidade,
    risco: entrada.risco,
    semantica: entrada.semantica,
    parametros: { ...entrada.parametros },
    estado: 'planejada',
    nonce: randomUUID(),
    autorizada_em: null,
    expira_em: agora.getTime() + (entrada.validade_ms ?? VALIDADE_AUTORIZACAO_MS),
    criada_em: agora.toISOString(),
    atualizada_em: agora.toISOString(),
    historico: [],
  };
}
