/**
 * O CONTRATO DA VALIDAÇÃO SISTÊMICA.
 *
 * A tese, em uma frase: **o veredito de release não é opinião de quem escreve o
 * relatório — é conta feita sobre evidência de execução.**
 *
 * O incidente que trouxe este arquivo à existência é uma auditoria, não um
 * defeito de produto. Em 17/08/2026 um relatório desta casa escreveu
 * `READY WITH KNOWN RISKS` no alto da página e, três seções abaixo, na mesma
 * página, listou que a campanha adversarial, o E2E de navegador, o ataque ao
 * sandbox, aos segredos e à exfiltração por RAG não tinham rodado. As duas
 * afirmações não cabem juntas:
 *
 *     "não encontramos vulnerabilidade"  ≠  "testamos o suficiente para encontrar"
 *
 * O mais duro é que a regra já existia no repositório, escrita e imposta — só
 * não valia para o auditor. `testes/campanha/contrato.ts` tem
 * `ESTADO_DESCONHECIDO` como desfecho de primeira classe justamente porque
 * oráculo cego não confirma nada. Este arquivo aplica ao processo de auditoria a
 * régua que a campanha já aplicava à IARA.
 *
 * A consequência de desenho, e é ela que importa:
 *
 *     O MODELO produz observação, diagnóstico, hipótese e correção.
 *     O VEREDITO vem do sistema.
 *
 * Não existe função aqui que aceite "na minha avaliação". Uma bateria tem
 * status porque alguém a rodou e deixou artefato; o veredito cai fora de uma
 * tabela de precedência fixa. É o que remove do resultado a classe de erro que
 * nenhuma revisão de texto pega — a do auditor que resume melhor do que mediu.
 */

// ---------------------------------------------------------------------------
// 1. Status de execução — quatro estados, e "não executada" é um deles
// ---------------------------------------------------------------------------

/**
 * QUATRO, e não dois, pela mesma razão que a campanha tem sete desfechos: um
 * status binário obriga a chamar de "passou" tudo que não explodiu, e a
 * omissão de uma bateria fica indistinguível do sucesso dela.
 */
export type StatusExecucao =
  /** Rodou nesta sessão, contra este commit, e o oráculo confirmou. */
  | 'EXECUTADA_PASSOU'
  /** Rodou e encontrou defeito. É informação boa: a bateria fez o trabalho. */
  | 'EXECUTADA_FALHOU'
  /**
   * Rodou e ninguém sabe. Oráculo não alcançou, ambiente faltou, cenário não
   * chegou ao fim. NUNCA vira "passou" — é o estado em que um harness distraído
   * fabrica verde.
   */
  | 'EXECUTADA_INCONCLUSIVA'
  /**
   * Não rodou. Inclui os dois casos que costumam ser confundidos, e a razão
   * mora em `Bateria.harness`: pode não haver harness, ou haver e ninguém ter
   * chamado. O veredito trata os dois igual — o backlog, não.
   */
  | 'NAO_EXECUTADA';

/** Só um status conta como prova a favor. Lista fechada, de propósito. */
export function ehProva(s: StatusExecucao): boolean {
  return s === 'EXECUTADA_PASSOU';
}

// ---------------------------------------------------------------------------
// 2. O veredito
// ---------------------------------------------------------------------------

/**
 * Cinco vereditos, em ordem de severidade — e a ordem É o algoritmo: quando
 * duas regras se aplicam, vale a mais severa. Sem essa ordem, o resultado
 * dependeria da ordem em que as baterias foram lidas do disco.
 *
 * Nomes em português porque veredito de release é termo de domínio desta casa
 * (ver `ROTULO_INTERNACIONAL` para o par em inglês, que é o que circula em
 * relatório para fora).
 */
export type Veredito =
  /** Bateria crítica falhou, ou houve violação crítica de segurança. */
  | 'BLOQUEADO'
  /** Bateria obrigatória não crítica falhou. Há defeito conhecido e aberto. */
  | 'FALHOU'
  /**
   * Falta medição. NÃO É REPROVAÇÃO — e é justamente por não ser que o veredito
   * anterior conseguiu se disfarçar de aprovação. Significa: o sistema pode
   * estar bom, e ninguém tem como saber daqui.
   */
  | 'VALIDACAO_INCOMPLETA'
  /** Tudo que é obrigatório rodou e passou; sobra bateria opcional sem medir. */
  | 'PRONTO_COM_RISCOS'
  /** Todas as baterias do registro rodaram e passaram, contra este commit. */
  | 'PRONTO';

export const ROTULO_INTERNACIONAL: Readonly<Record<Veredito, string>> = {
  BLOQUEADO: 'BLOCKED',
  FALHOU: 'FAILED',
  VALIDACAO_INCOMPLETA: 'VALIDATION_INCOMPLETE',
  PRONTO_COM_RISCOS: 'READY_WITH_RISKS',
  PRONTO: 'READY',
};

/**
 * Severidade crescente. Usada para resolver conflito entre regras — nunca para
 * ordenar relatório.
 */
const PESO: Readonly<Record<Veredito, number>> = {
  PRONTO: 0,
  PRONTO_COM_RISCOS: 1,
  VALIDACAO_INCOMPLETA: 2,
  FALHOU: 3,
  BLOQUEADO: 4,
};

export function maisSevero(a: Veredito, b: Veredito): Veredito {
  return PESO[a] >= PESO[b] ? a : b;
}

/**
 * A pergunta que o gate da Fase 12 responde, e a única coisa que ele proíbe.
 *
 * `false` aqui NÃO significa "não distribua" — distribuir é decisão do dono,
 * tomada com a lista na mão. Significa: nenhum texto desta casa pode chamar
 * este estado de pronto, seguro ou validado.
 */
export function podeChamarDePronto(v: Veredito): boolean {
  return v === 'PRONTO' || v === 'PRONTO_COM_RISCOS';
}

// ---------------------------------------------------------------------------
// 3. A bateria
// ---------------------------------------------------------------------------

export interface Bateria {
  readonly id: string;
  readonly nome: string;
  /** A pergunta que SÓ esta bateria responde. Se duas repetem, uma é sobra. */
  readonly pergunta: string;
  /**
   * Obrigatória para haver veredito de sistema. Uma obrigatória sem execução
   * força `VALIDACAO_INCOMPLETA` — é o mecanismo inteiro deste módulo.
   */
  readonly obrigatoria: boolean;
  /**
   * Falha dela BLOQUEIA. Reservado ao que, falhando, torna a IARA perigosa e
   * não apenas ruim: mentir sobre efeito, vazar entre operadores, escapar do
   * sandbox, duplicar efeito externo, regressão na suíte.
   */
  readonly critica: boolean;
  /**
   * Onde o harness vive, ou `null` quando ele não existe ainda. CAMPO BINÁRIO:
   * ou existe algo que roda esta bateria inteira, ou não existe. "Parcial" aqui
   * seria a mentira que este módulo caça — foi tentado e removido: quatro
   * baterias diziam `parcial — <alguma coisa>` e o relatório saía com "harness
   * existe e ninguém o chamou", quando o certo era "não há o que chamar".
   */
  readonly harness: string | null;
  /**
   * O que a suíte de hoje JÁ cobre desta bateria, quando cobre um pedaço. Vive
   * separado de `harness` porque cobertura parcial não é harness: ela explica
   * por que a bateria não parte de zero, e não muda o status — que continua
   * `NAO_EXECUTADA` até alguém medir o todo.
   */
  readonly cobertura_parcial?: string;
}

// ---------------------------------------------------------------------------
// 4. O Evidence Record
// ---------------------------------------------------------------------------

/**
 * Uma linha de evidência por execução de bateria. Ela é o que permite responder,
 * meses depois, à única pergunta que interessa numa investigação:
 *
 *     "por que o sistema foi considerado validado NAQUELE commit?"
 *
 * — sem depender do texto de um relatório, que é prosa de quem escreveu.
 *
 * `commit` não é decoração: evidência é sempre evidência SOBRE UM CÓDIGO. Um
 * registro de ontem, num commit que já mudou, não prova nada sobre hoje — e o
 * motor o reporta como obsoleto em vez de descartá-lo em silêncio, porque
 * descartar em silêncio é como uma bateria "sempre verde" nasce.
 */
export interface RegistroEvidencia {
  readonly bateria: string;
  /** Id da rodada. Duas baterias da mesma rodada compartilham este valor. */
  readonly execucao: string;
  /** SHA do commit medido. Curto ou longo; comparado por prefixo. */
  readonly commit: string;
  /** Máquina, sistema, runtime, provedor. Uma linha, para o leitor humano. */
  readonly ambiente: string;
  readonly instante: string;
  readonly status: StatusExecucao;
  readonly cenarios: number;
  readonly passou: number;
  readonly falhou: number;
  readonly inconclusivo: number;
  /** Cenário que nem chegou a rodar (dependência ausente, teto de tempo). */
  readonly bloqueado: number;
  /**
   * Caminho da evidência BRUTA — log, dossiê, trace, screenshot. Sem ele, um
   * `EXECUTADA_PASSOU` é a palavra de alguém, e a palavra de alguém é
   * exatamente o que este módulo recusa aceitar.
   */
  readonly artefato: string | null;
  /** As taxas que a bateria mediu. Vazio é legítimo; ausente do JSON, não. */
  readonly metricas: Readonly<Record<string, number>>;
  /**
   * Versão do oráculo que julgou. Oráculo que muda sem trocar de versão
   * transforma comparação entre rodadas em ilusão.
   */
  readonly versao_oraculo: string;
  /**
   * Violações que bloqueiam sozinhas, nomeadas. Uma linha por violação, em
   * texto — o motor só precisa saber que a lista não está vazia; quem lê o
   * relatório precisa saber qual foi.
   */
  readonly violacoes_criticas: readonly string[];
}

// ---------------------------------------------------------------------------
// 5. O validador de evidência — a Fase 6 em código
// ---------------------------------------------------------------------------

export interface ProblemaEvidencia {
  readonly campo: string;
  readonly motivo: string;
}

const HEX_COMMIT = /^[0-9a-f]{7,40}$/;

/**
 * "PASS sem evidência → INVALID" era regra em prosa na SKILL. Aqui ela executa.
 *
 * A parte que importa é o que o motor faz com o resultado: registro inválido
 * NÃO é descartado e NÃO vira falha — vira `EXECUTADA_INCONCLUSIVA`. Descartar
 * apagaria a tentativa; chamar de falha inventaria defeito de produto onde houve
 * defeito de registro. Inconclusiva é a verdade: alguém rodou algo e não deixou
 * como conferir.
 */
export function conferirRegistro(r: RegistroEvidencia): ProblemaEvidencia[] {
  const p: ProblemaEvidencia[] = [];

  if (!r.bateria.trim()) p.push({ campo: 'bateria', motivo: 'vazia' });
  if (!r.execucao.trim()) p.push({ campo: 'execucao', motivo: 'vazia' });
  if (!HEX_COMMIT.test(r.commit)) {
    p.push({ campo: 'commit', motivo: 'não é um SHA de 7 a 40 hexadecimais' });
  }
  if (!r.ambiente.trim()) p.push({ campo: 'ambiente', motivo: 'vazio' });
  if (!r.versao_oraculo.trim()) p.push({ campo: 'versao_oraculo', motivo: 'vazia' });
  if (Number.isNaN(Date.parse(r.instante))) {
    p.push({ campo: 'instante', motivo: 'não é uma data ISO válida' });
  }

  for (const [campo, valor] of [
    ['cenarios', r.cenarios],
    ['passou', r.passou],
    ['falhou', r.falhou],
    ['inconclusivo', r.inconclusivo],
    ['bloqueado', r.bloqueado],
  ] as const) {
    if (!Number.isInteger(valor) || valor < 0) {
      p.push({ campo, motivo: 'deveria ser inteiro não negativo' });
    }
  }

  const soma = r.passou + r.falhou + r.inconclusivo + r.bloqueado;

  if (r.status === 'NAO_EXECUTADA') {
    // Um registro que diz "não rodei" e traz contagem está descrevendo outra
    // coisa. Sem esta checagem, meia execução entra como ausência.
    if (r.cenarios !== 0 || soma !== 0) {
      p.push({ campo: 'status', motivo: 'NAO_EXECUTADA com cenário contado' });
    }
    if (r.artefato) {
      p.push({ campo: 'artefato', motivo: 'NAO_EXECUTADA com artefato' });
    }
    return p;
  }

  if (r.cenarios === 0) {
    p.push({ campo: 'cenarios', motivo: 'execução sem nenhum cenário não é execução' });
  }
  if (soma !== r.cenarios) {
    p.push({
      campo: 'cenarios',
      motivo: `passou+falhou+inconclusivo+bloqueado (${soma}) não fecha com cenarios (${r.cenarios})`,
    });
  }

  if (r.status === 'EXECUTADA_PASSOU') {
    if (!r.artefato) {
      p.push({ campo: 'artefato', motivo: 'PASSOU sem evidência bruta é a palavra de alguém' });
    }
    if (r.falhou > 0) p.push({ campo: 'falhou', motivo: 'PASSOU com cenário falhado' });
    if (r.inconclusivo > 0) {
      p.push({ campo: 'inconclusivo', motivo: 'PASSOU com cenário inconclusivo' });
    }
    if (r.bloqueado > 0) p.push({ campo: 'bloqueado', motivo: 'PASSOU com cenário bloqueado' });
    if (r.violacoes_criticas.length > 0) {
      p.push({ campo: 'violacoes_criticas', motivo: 'PASSOU com violação crítica registrada' });
    }
  }

  if (r.status === 'EXECUTADA_FALHOU' && r.falhou === 0 && r.violacoes_criticas.length === 0) {
    p.push({ campo: 'falhou', motivo: 'FALHOU sem cenário falhado nem violação nomeada' });
  }

  return p;
}
