/**
 * O MOTOR PROATIVO — o ciclo fechado, e o único módulo desta pasta que tem
 * efeitos colaterais.
 *
 *     OCORRÊNCIA → NORMALIZAÇÃO → CONTEXTO → RELEVÂNCIA → DECISÃO
 *               → POLÍTICA DE INTERRUPÇÃO → FALA → REAÇÃO → APRENDIZADO
 *
 * Cada seta acima é um módulo separado e puro; este arquivo é a costura. A
 * separação não é gosto arquitetural: é o que permite provar a política sem
 * disco, sem relógio e sem barramento, e provar a costura sem reimplementar a
 * política dentro do teste.
 *
 * ---------------------------------------------------------------------------
 * NÃO EXISTE UMA SEGUNDA IARA AQUI DENTRO
 * ---------------------------------------------------------------------------
 *
 * Este motor não tem LLM, não tem catálogo de habilidades, não tem executor e
 * não conhece o `Kernel`. Ele não é um agente de fundo; é uma POLÍTICA que
 * escuta fatos e decide se vale interromper alguém. A IARA continua tendo um
 * núcleo cognitivo só — quando a decisão é falar, a frase sai pelo mesmo canal
 * de qualquer outra fala dela, exatamente como o lembrete vencido e o aviso do
 * vigia já saíam.
 *
 * ---------------------------------------------------------------------------
 * ONDE ESTÁ O LAÇO, E POR QUE ELE NÃO É INFINITO
 * ---------------------------------------------------------------------------
 *
 * Não há laço. O motor é ACORDADO — por uma ocorrência que chegou, por uma
 * mensagem do operador, ou pelo tique do `CicloAutonomo`. Entre um despertar e
 * outro ele não consome nada. É a diferença entre "o sistema acorda quando há
 * motivo" e "o sistema pensa 24 horas por dia": a segunda forma custa dinheiro
 * proporcional ao tempo, e não ao que aconteceu.
 *
 * ---------------------------------------------------------------------------
 * O CUSTO DO SILÊNCIO
 * ---------------------------------------------------------------------------
 *
 * Uma ocorrência irrelevante custa: uma normalização em memória, uma leitura de
 * livro servida pelo cache, uma média ponderada de seis números. **Zero disco.**
 * O `transacao` só é aberto quando a decisão deixa de ser `ignorar`.
 *
 * Isso não é otimização prematura — é requisito. A capacidade que este módulo
 * precisa ter é a de ver dez mil eventos e permanecer calado; se calar custasse
 * uma gravação por evento, o silêncio seria a operação mais cara do sistema e
 * alguém acabaria "consertando" isso afrouxando o limiar.
 */

import { randomUUID } from 'node:crypto';
import type { PreferenciasOperador } from '../../../lib/perfil';
import { PREFERENCIAS_PADRAO } from '../../../lib/perfil';
import { nivelAtual, type NivelAutonomia } from '../kernel/Autonomia';
import { redigir } from '../kernel/Configuracao';
import { normalizar } from '../texto';
import { aplicarReacao, type Reacao } from './Atencao';
import { decidir, rebaixar, type Justificativa } from './DecisaoProativa';
import {
  assinarPasso,
  detectar,
  type Oportunidade,
  type RegistroPasso,
} from './DetectorDeRepeticao';
import {
  podeInterromper,
  registrarAtividade,
  registrarInterrupcao,
  type EstadoInterrupcao,
} from './Interrupcao';
import {
  atencaoDe,
  type Livro,
  type LivroDeOcorrencias,
  type VistaOcorrencia,
} from './LivroDeOcorrencias';
import { normalizarOcorrencia, vencida, type Ocorrencia } from './Ocorrencia';
import { avaliar } from './Relevancia';

/**
 * Quanto tempo uma proposta espera por uma reação antes de ser contada como
 * ignorada.
 *
 * Meia hora. Curto o bastante para a mensagem seguinte ainda ser sobre aquilo, e
 * longo o bastante para alguém sair para um café. Uma janela grande demais
 * atribuiria à proposta de manhã a conversa da tarde — que é como um sistema
 * aprende a coisa errada com confiança crescente.
 */
export const JANELA_REACAO_MS = 30 * 60 * 1000;

export interface FalaProativa {
  readonly id: string;
  readonly assunto: string;
  readonly texto: string;
  readonly justificativa: Justificativa;
}

export interface DependenciasMotor {
  readonly idUsuario: string;
  readonly livro: LivroDeOcorrencias;
  /** Como a frase chega à pessoa. O motor não conhece o barramento. */
  readonly falar: (fala: FalaProativa) => void;
  /** A ficha declarada. Nunca lança — ficha ilegível vira ficha vazia. */
  readonly preferencias: () => Promise<PreferenciasOperador>;
  readonly nivel?: () => NivelAutonomia;
  readonly agora?: () => number;
  /** Injetável para o teste pôr 3h da manhã sem esperar até lá. */
  readonly hora?: (agora: number) => number;
}

export interface MetricasProativas {
  readonly avaliadas: number;
  readonly recusadas: number;
  readonly duplicadas: number;
  readonly persistidas: number;
  readonly faladas: number;
  readonly suprimidas: number;
  readonly engajou: number;
  readonly agiu: number;
  readonly ignorou: number;
  readonly rejeitou: number;
  /** A métrica principal: das vezes que falou, quantas serviram. */
  readonly utilidade: number;
  readonly taxa_falso_positivo: number;
  readonly taxa_duplicata: number;
  readonly taxa_acao: number;
  readonly taxa_dispensa: number;
  readonly taxa_ignorado: number;
}

/**
 * "NÃO PRECISA ME AVISAR DISSO" — reconhecido deterministicamente.
 *
 * Sem LLM, de propósito. Esta é a frase com que a pessoa retira o consentimento,
 * e uma retirada de consentimento não pode depender de um modelo estar
 * disponível, de custar tokens, nem de variar entre execuções. Se a lista não
 * reconhecer uma forma nova, o pior caso é a rejeição virar um `ignorou` — o
 * peso cai de qualquer jeito, só mais devagar. O caso inverso, um modelo
 * enxergando rejeição onde não houve, calaria um assunto que a pessoa queria.
 *
 * Comparadas sobre `normalizar` — sem acento, sem caixa, espaço colapsado —
 * porque "não" e "nao" não são duas decisões diferentes.
 */
const REJEICAO: readonly RegExp[] = [
  /\bnao (me )?(precisa|preciso) (de )?avis/,
  /\bnao precisa (me )?(avisar|alertar|falar|contar)/,
  /\bnao (quero|queria) (mais )?(ser )?(avisad|alertad)/,
  /\bnao me (avise|avisa|alerte|alerta|incomode|incomoda)/,
  /\b(para|pare|parar) de (me )?(avisar|alertar|falar|incomodar)/,
  /\bchega de (aviso|avisos|alerta|alertas)/,
  /\bnao (me )?(interessa|importa)\b/,
  /\bnao (e|eh) relevante\b/,
  /\bdeixa (disso|pra la)\b/,
];

/**
 * A resposta direta à oferta. Toda fala proativa termina numa pergunta — "quer
 * que eu descubra?" —, então um "sim" curto na janela É a reação àquilo, e não
 * uma mensagem sobre outro assunto.
 */
const ACEITE =
  /^(sim|isso|claro|pode|quero|manda|vai|ok|beleza|descubr|investig|verific|analis|automatiz|mostra|explica)/;

const MINIMO_TOKEN = 4;

function tokensDe(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MINIMO_TOKEN);
}

function taxa(numerador: number, denominador: number): number {
  if (denominador <= 0) return 0;
  return Math.round((numerador / denominador) * 1000) / 1000;
}

export class MotorProativo {
  private readonly idUsuario: string;
  private readonly livro: LivroDeOcorrencias;
  private readonly falar: (fala: FalaProativa) => void;
  private readonly lerPreferencias: () => Promise<PreferenciasOperador>;
  private readonly nivel: () => NivelAutonomia;
  private readonly agora: () => number;
  private readonly hora: (agora: number) => number;

  /**
   * Passos observados desde o último tique, ainda em memória.
   *
   * Não vão direto ao disco porque um passo é o evento mais frequente do
   * sistema — vários por turno — e o detector de repetição olha janelas de
   * semanas. Gravar cada um na hora trocaria uma escrita por evento por nada:
   * ninguém pergunta ao livro entre um tique e o seguinte. Perder este buffer
   * numa queda custa alguns passos numa contagem de catorze dias.
   */
  private readonly passosPendentes: RegistroPasso[] = [];

  /**
   * Contadores de volume acumulados fora do disco. Ver o cabeçalho: são eles que
   * tornam o silêncio barato. Consolidados no tique.
   */
  private avaliadasPendentes = 0;
  private recusadasPendentes = 0;

  private ultima: Justificativa | null = null;

  constructor(dep: DependenciasMotor) {
    this.idUsuario = dep.idUsuario;
    this.livro = dep.livro;
    this.falar = dep.falar;
    this.lerPreferencias = dep.preferencias;
    this.nivel = dep.nivel ?? nivelAtual;
    this.agora = dep.agora ?? (() => Date.now());
    this.hora = dep.hora ?? ((t) => new Date(t).getHours());
  }

  // -------------------------------------------------------------------------
  // Observabilidade
  // -------------------------------------------------------------------------

  /**
   * Uma linha JSON por etapa do ciclo, no canal `proativo`.
   *
   * `redigir` sobre a linha inteira, e não sobre cada campo: o resumo de uma
   * ocorrência é texto livre, e texto livre é onde uma credencial colada acaba
   * parando. É a mesma disciplina do jornal de operações.
   */
  private registrar(acao: string, dados: Record<string, unknown> = {}): void {
    /**
     * O ENVELOPE VENCE O PAYLOAD — `...dados` vem PRIMEIRO.
     *
     * O DEFEITO, encontrado pela suíte adversarial: com o spread por último, um
     * payload que carregasse `acao` (e o de `decisao_tomada` carregava, com a
     * ação decidida) SOBRESCREVIA o nome da etapa. A linha `decisao_tomada`
     * saía do processo dizendo `"acao":"alertar"` — e nenhuma etapa chamada
     * `decisao_tomada` aparecia no log, nunca. Um trilho de auditoria que troca
     * o nome do evento pelo valor de um campo é pior que não ter trilho: ele
     * responde a pergunta errada com a mesma cara de resposta certa.
     */
    console.log(
      redigir(
        JSON.stringify({
          ...dados,
          canal: 'proativo',
          acao,
          id_usuario: this.idUsuario,
          instante: new Date(this.agora()).toISOString(),
        }),
      ),
    );
  }

  // -------------------------------------------------------------------------
  // 1. Perceber
  // -------------------------------------------------------------------------

  /**
   * O ciclo inteiro para UMA ocorrência. Devolve a justificativa da decisão, ou
   * `null` quando a ocorrência foi recusada ou o livro estava indisponível.
   *
   * **NUNCA LANÇA.** Um detector que quebra a sessão do operador seria pior que
   * um detector ausente. Toda falha vira log e silêncio — nunca uma fala
   * improvisada, e nunca um evento inventado para "dar sinal de vida".
   */
  async perceber(bruto: unknown): Promise<Justificativa | null> {
    const agora = this.agora();
    this.avaliadasPendentes += 1;

    const leitura = normalizarOcorrencia(bruto, this.idUsuario, agora, randomUUID);
    if (!leitura.ok) {
      this.recusadasPendentes += 1;
      this.registrar('ocorrencia_recusada', { motivo: leitura.motivo });
      return null;
    }
    const o = leitura.ocorrencia;

    if (vencida(o, agora)) {
      this.recusadasPendentes += 1;
      this.registrar('ocorrencia_recusada', { motivo: 'vencida', assunto: o.assunto });
      return null;
    }

    try {
      const preferencias = await this.preferenciasSeguras();

      /**
       * PRÉVIA SOBRE O CACHE — a metade barata.
       *
       * Se a prévia der `ignorar`, nada é gravado e o disco nunca é tocado. O
       * risco de a prévia usar estado levemente velho é aceitável exatamente
       * aqui e em nenhum outro lugar: o pior desfecho é descartar um evento de
       * baixa relevância cuja atenção acabou de mudar. Toda decisão que produz
       * escrita é RECALCULADA sob trava, com o livro relido do disco.
       */
      const previa = await this.livro.ler(this.idUsuario);
      const j0 = this.julgar(previa, o, preferencias, agora);
      if (j0.acao === 'ignorar') {
        this.ultima = j0;
        this.registrar('decisao_tomada', {
          assunto: o.assunto,
          decisao: j0.acao,
          pontuacao: j0.pontuacao,
          motivos: j0.motivos,
          gravado: false,
        });
        return j0;
      }

      const resultado = await this.livro.transacao(this.idUsuario, (livro) =>
        this.aplicar(livro, o, preferencias, agora),
      );

      this.ultima = resultado.justificativa;

      /**
       * A ENTREGA TEM `catch` PRÓPRIO — e não é zelo, é honestidade de
       * diagnóstico.
       *
       * Encontrado pela suíte adversarial: um `falar` que explodia (socket
       * caindo no meio) caía no `catch` de baixo e era registrado como
       * `livro_indisponivel`. O log culpava o disco por uma falha de rede, e
       * quem investigasse amanhã procuraria o problema no lugar errado.
       *
       * A ordem importa e é a mesma da `Agenda`: o livro JÁ foi gravado quando
       * chegamos aqui. Uma entrega perdida vira um fato que a IARA sabe que
       * tentou dizer — nunca um fato que ela acha que nunca existiu. O oposto
       * (falar antes de gravar) transformaria toda falha de disco numa fala
       * repetida no próximo tique.
       */
      if (resultado.fala) {
        try {
          this.falar(resultado.fala);
        } catch (erro) {
          this.registrar('falha_na_entrega', {
            assunto: o.assunto,
            id_fala: resultado.fala.id,
            detalhe: (erro as Error).message.slice(0, 160),
          });
        }
      }
      return resultado.justificativa;
    } catch (erro) {
      /**
       * O LIVRO SUMIU — e a IARA CALA.
       *
       * Sem livro não há como saber o que já foi dito, o que a pessoa rejeitou
       * nem quantas vezes já se falou hoje. Falar sem essas três respostas é
       * exatamente o comportamento que esta camada existe para impedir. A
       * degradação segura é o silêncio COM registro, nunca o palpite.
       */
      this.registrar('livro_indisponivel', {
        assunto: o.assunto,
        detalhe: (erro as Error).message.slice(0, 160),
      });
      return null;
    }
  }

  /** Ficha ilegível não pode derrubar a percepção; vira ficha vazia. */
  private async preferenciasSeguras(): Promise<PreferenciasOperador> {
    try {
      return await this.lerPreferencias();
    } catch {
      return { ...PREFERENCIAS_PADRAO };
    }
  }

  /** Contexto → relevância → decisão. Puro em relação ao livro recebido. */
  private julgar(
    livro: Livro,
    o: Ocorrencia,
    preferencias: PreferenciasOperador,
    agora: number,
  ): Justificativa {
    const atencao = atencaoDe(livro, o.assunto, agora);
    const vista = livro.vistas[o.chave_dedup];
    const relevancia = avaliar({
      ocorrencia: o,
      atencao,
      preferencias,
      vezesVisto: vista?.vezes ?? 0,
    });
    return decidir({ ocorrencia: o, relevancia, atencao, nivel: this.nivel(), agora });
  }

  /**
   * A metade que escreve. Roda SOB TRAVA, com o livro relido do disco.
   *
   * A ordem interna importa: a deduplicação acontece ANTES do julgamento, porque
   * `vezes` alimenta o sinal de novidade — e é essa dependência que faz cem
   * relatos do mesmo fato produzirem uma fala em vez de cem.
   */
  private aplicar(
    livro: Livro,
    o: Ocorrencia,
    preferencias: PreferenciasOperador,
    agora: number,
  ): { justificativa: Justificativa; fala: FalaProativa | null } {
    const anterior = livro.vistas[o.chave_dedup];
    if (anterior) livro.contadores.duplicadas += 1;

    /* UM FATO, VÁRIAS FONTES. Fontes novas se somam às antigas, sem repetir a
       mesma referência — é isto que transforma cinco publicações do mesmo
       acontecimento em uma ocorrência com cinco procedências. */
    const referencias = new Set(anterior?.fontes.map((f) => f.referencia) ?? []);
    const fontes = [
      ...(anterior?.fontes ?? []),
      ...o.fontes.filter((f) => !referencias.has(f.referencia)),
    ].slice(0, 8);

    const vista: VistaOcorrencia = {
      chave: o.chave_dedup,
      tipo: o.tipo,
      assunto: o.assunto,
      rotulo: o.rotulo,
      resumo: o.resumo,
      severidade: o.severidade,
      confianca: o.confianca,
      natureza: o.natureza,
      vezes: (anterior?.vezes ?? 0) + 1,
      primeira_em: anterior?.primeira_em ?? o.instante,
      ultima_em: o.instante,
      fontes,
    };
    livro.vistas[o.chave_dedup] = vista;
    livro.contadores.persistidas += 1;

    /* Julgado com o `vezes` JÁ atualizado menos um: a novidade é a de ANTES
       deste avistamento — do contrário o primeiro relato de um fato novo já
       nasceria com novidade reduzida por si mesmo. */
    const atencao = atencaoDe(livro, o.assunto, agora);
    const relevancia = avaliar({
      ocorrencia: o,
      atencao,
      preferencias,
      vezesVisto: vista.vezes - 1,
    });
    let justificativa = decidir({
      ocorrencia: o,
      relevancia,
      atencao,
      nivel: this.nivel(),
      agora,
    });

    this.registrar('relevancia_avaliada', {
      assunto: o.assunto,
      pontuacao: relevancia.pontuacao,
      sinais: relevancia.sinais,
    });

    let fala: FalaProativa | null = null;

    if (justificativa.acao === 'alertar' || justificativa.acao === 'sugerir' || justificativa.acao === 'perguntar') {
      const estado: EstadoInterrupcao = {
        interrupcoes: livro.interrupcoes,
        carencia: livro.carencia,
        atividade: livro.atividade,
      };
      const veredicto = podeInterromper({
        assunto: o.assunto,
        severidade: o.severidade,
        confianca: o.confianca,
        agora,
        estado,
        hora: this.hora(agora),
      });

      if (veredicto.permitido) {
        const id = randomUUID();
        const texto = comporFala(o, justificativa.acao);
        fala = { id, assunto: o.assunto, texto, justificativa };

        const novoEstado = registrarInterrupcao(estado, o.assunto, agora);
        livro.interrupcoes = [...novoEstado.interrupcoes];
        livro.carencia = { ...novoEstado.carencia };
        livro.contadores.faladas += 1;

        /* A pendência anterior que ainda não venceu é fechada como IGNORADA
           antes de a nova entrar. Duas pendências abertas tornariam a próxima
           mensagem evidência ambígua — ver `Pendencia`. */
        this.fecharPendencia(livro, 'ignorou', agora);
        livro.pendente = { id_decisao: id, assunto: o.assunto, rotulo: o.rotulo, em: agora };
        livro.atencao[o.assunto] = aplicarReacao(atencao, 'proposta', agora);

        livro.decisoes.push({ id, chave: o.chave_dedup, em: agora, justificativa, texto });
        this.registrar('fala_emitida', { assunto: o.assunto, decisao: justificativa.acao, id });
      } else {
        justificativa = rebaixar(justificativa, veredicto.motivo);
        livro.contadores.suprimidas += 1;
        livro.decisoes.push({
          id: randomUUID(),
          chave: o.chave_dedup,
          em: agora,
          justificativa,
          texto: null,
        });
        this.registrar('fala_suprimida', { assunto: o.assunto, motivo: veredicto.motivo });
      }
    } else {
      livro.decisoes.push({
        id: randomUUID(),
        chave: o.chave_dedup,
        em: agora,
        justificativa,
        texto: null,
      });
    }

    this.registrar('decisao_tomada', {
      assunto: o.assunto,
      decisao: justificativa.acao,
      pontuacao: justificativa.pontuacao,
      motivos: justificativa.motivos,
      gravado: true,
    });

    return { justificativa, fala };
  }

  // -------------------------------------------------------------------------
  // 2. Aprender com a reação
  // -------------------------------------------------------------------------

  /**
   * O operador falou. Duas coisas acontecem, e as duas são evidência — nenhuma é
   * inferência sobre o que ele quis dizer:
   *
   *  1. a HORA entra no histograma de atividade, que é o que ensina à IARA
   *     quando esta pessoa está trabalhando;
   *  2. se havia uma proposta pendente na janela, a mensagem é lida como reação.
   *
   * A mensagem que não casa com nada NÃO fecha a pendência. A pessoa mudou de
   * assunto — insistir em interpretar seria atribuir uma reação que ela não deu.
   * A pendência vence sozinha no tique, e vencer conta como ignorada.
   */
  async observarMensagem(texto: string): Promise<void> {
    const agora = this.agora();
    const hora = this.hora(agora);
    try {
      await this.livro.transacao(this.idUsuario, (livro) => {
        livro.atividade = registrarAtividade(livro.atividade, hora);

        const p = livro.pendente;
        if (!p || agora - p.em > JANELA_REACAO_MS) return;

        const limpo = normalizar(texto);
        const reacao = this.lerReacao(limpo, p.assunto, p.rotulo);
        if (!reacao) return;

        this.fecharPendencia(livro, reacao, agora);
        this.registrar('reacao_registrada', { assunto: p.assunto, reacao });
      });
    } catch (erro) {
      this.registrar('livro_indisponivel', {
        etapa: 'observarMensagem',
        detalhe: (erro as Error).message.slice(0, 160),
      });
    }
  }

  private lerReacao(
    normalizado: string,
    assunto: string,
    rotulo: string,
  ): Exclude<Reacao, 'proposta' | 'agiu'> | null {
    /* A rejeição é conferida PRIMEIRO. "não, não precisa me avisar disso"
       começa com uma palavra que o aceite reconheceria. */
    if (REJEICAO.some((r) => r.test(normalizado))) return 'rejeitou';
    if (ACEITE.test(normalizado)) return 'engajou';

    const alvo = new Set(tokensDe(`${assunto} ${rotulo}`));
    if (tokensDe(normalizado).some((t) => alvo.has(t))) return 'engajou';
    return null;
  }

  private fecharPendencia(livro: Livro, reacao: Reacao, agora: number): void {
    const p = livro.pendente;
    if (!p) return;
    const atencao = atencaoDe(livro, p.assunto, agora);
    livro.atencao[p.assunto] = aplicarReacao(atencao, reacao, agora);
    livro.pendente = null;

    if (reacao === 'engajou') livro.contadores.engajou += 1;
    else if (reacao === 'agiu') livro.contadores.agiu += 1;
    else if (reacao === 'ignorou') livro.contadores.ignorou += 1;
    else if (reacao === 'rejeitou') livro.contadores.rejeitou += 1;

    this.registrar('preferencia_atualizada', {
      assunto: p.assunto,
      reacao,
      peso: undefined,
    });
  }

  // -------------------------------------------------------------------------
  // 3. Observar o trabalho
  // -------------------------------------------------------------------------

  /**
   * Um passo do kernel terminou. Só o buffer em memória é tocado aqui — ver
   * `passosPendentes` para por que não vai direto ao disco.
   *
   * O EFEITO COLATERAL QUE IMPORTA: se havia uma proposta pendente, executar
   * algo logo depois dela é a evidência mais forte de que o aviso serviu. É
   * assim que `agiu` é observado sem nenhuma alteração no `Kernel` — o sinal já
   * passava pelo barramento.
   */
  registrarPasso(habilidade: string, parametros: unknown, traco?: string): void {
    const agora = this.agora();
    const assinatura = assinarPasso(habilidade, parametros);

    /**
     * UM REGISTRO POR PROCEDIMENTO POR TURNO. Ver `RegistroPasso.traco`.
     *
     * A deduplicação acontece aqui além de em `detectar`, e as duas são
     * necessárias por razões diferentes: `detectar` garante a GRANDEZA certa
     * mesmo sobre um livro velho; esta garante que o buffer não encha. Com o
     * laço de agente, um turno pode emitir vinte passos, e um buffer de 200
     * viraria dez turnos de memória — o detector olha CATORZE DIAS.
     */
    const jaNesteTurno =
      traco !== undefined &&
      this.passosPendentes.some((p) => p.assinatura === assinatura && p.traco === traco);

    if (!jaNesteTurno) {
      this.passosPendentes.push({ assinatura, rotulo: habilidade, instante: agora, traco });
      if (this.passosPendentes.length > 200) this.passosPendentes.shift();
    }

    void this.livro
      .transacao(
        this.idUsuario,
        (livro) => {
          const p = livro.pendente;
          if (!p || agora - p.em > JANELA_REACAO_MS) return false;
          this.fecharPendencia(livro, 'agiu', agora);
          return true;
        },
        (mudou) => mudou,
      )
      .catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // 4. O tique
  // -------------------------------------------------------------------------

  /**
   * Chamado pelo `CicloAutonomo`. Três trabalhos, nesta ordem:
   *
   *  1. consolidar o que estava em memória (contadores de volume, passos);
   *  2. vencer a pendência que ninguém respondeu — silêncio é `ignorou`;
   *  3. procurar oportunidades de automação nos passos acumulados.
   *
   * O passo 3 acontece FORA da trava. `perceber` abre a própria transação, e
   * chamá-lo com o livro travado seria um impasse — o modo de falha mais chato
   * de diagnosticar, porque o sintoma é "a IARA parou de responder".
   *
   * **NUNCA LANÇA.** Ele roda dentro do metabolismo do operador, e o cabeçalho
   * do `CicloAutonomo` é explícito: uma sonda que falhou não pode derrubar o
   * ciclo.
   */
  async tique(): Promise<void> {
    const agora = this.agora();
    let oportunidades: Oportunidade[] = [];

    try {
      const passos = this.passosPendentes.splice(0, this.passosPendentes.length);
      const avaliadas = this.avaliadasPendentes;
      const recusadas = this.recusadasPendentes;
      this.avaliadasPendentes = 0;
      this.recusadasPendentes = 0;

      oportunidades = await this.livro.transacao(this.idUsuario, (livro) => {
        livro.contadores.avaliadas += avaliadas;
        livro.contadores.recusadas += recusadas;
        livro.passos.push(...passos);

        const p = livro.pendente;
        if (p && agora - p.em > JANELA_REACAO_MS) {
          this.fecharPendencia(livro, 'ignorou', agora);
        }

        return detectar(livro.passos, agora);
      });
    } catch (erro) {
      /* Devolve o que foi consumido? Não: os contadores de volume são
         estatística, e recontá-los depois de uma falha de disco produziria
         números maiores que a realidade. Perder alguns é mais honesto. */
      this.registrar('livro_indisponivel', {
        etapa: 'tique',
        detalhe: (erro as Error).message.slice(0, 160),
      });
      return;
    }

    for (const op of oportunidades) {
      this.registrar('oportunidade_detectada', {
        rotulo: op.rotulo,
        vezes: op.vezes,
        patamar: op.patamar,
      });
      await this.perceber(ocorrenciaDeOportunidade(op));
    }
  }

  // -------------------------------------------------------------------------
  // 5. Prestar contas
  // -------------------------------------------------------------------------

  /** "Por que você me chamou?" — a justificativa da última decisão, em prosa. */
  explicarUltima(): string | null {
    const j = this.ultima;
    if (!j) return null;
    return (
      `Falei por causa de "${j.assunto}" (${j.gatilho}). ` +
      `Ação: ${j.acao}. Motivos: ${j.motivos.join(', ')}. ` +
      `Confiança: ${j.confianca}. Natureza: ${j.natureza}. ` +
      `Pontuação de relevância: ${j.pontuacao}.` +
      (j.evidencia.length > 0 ? ` Evidência: ${j.evidencia.join('; ')}.` : '') +
      (j.suprimida_por ? ` Fala represada por: ${j.suprimida_por}.` : '')
    );
  }

  /**
   * O que está guardado e ainda não foi dito. É o `DIGEST` — o destino de tudo
   * que foi julgado digno de fala e represado pela política de interrupção.
   *
   * `null` quando não há nada. Um resumo vazio dito em voz alta seria a própria
   * definição do problema que esta camada existe para evitar.
   */
  async resumoPendente(limite = 5): Promise<string | null> {
    const livro = await this.livro.ler(this.idUsuario);
    const represadas = livro.decisoes
      .filter((d) => d.justificativa.suprimida_por !== null)
      .slice(-limite);
    if (represadas.length === 0) return null;

    const linhas = represadas.map((d) => {
      const vista = livro.vistas[d.chave];
      return `· ${vista?.resumo ?? d.justificativa.assunto}`;
    });
    return `Enquanto você trabalhava, anotei ${represadas.length} coisa(s):\n${linhas.join('\n')}`;
  }

  async metricas(): Promise<MetricasProativas> {
    const livro = await this.livro.ler(this.idUsuario);
    const c = livro.contadores;
    const faladas = c.faladas;
    return {
      ...c,
      /* Os pendentes entram na conta: a métrica de hoje não pode esperar o
         próximo tique para ficar verdadeira. */
      avaliadas: c.avaliadas + this.avaliadasPendentes,
      recusadas: c.recusadas + this.recusadasPendentes,
      utilidade: taxa(c.engajou + c.agiu, faladas),
      taxa_falso_positivo: taxa(c.ignorou + c.rejeitou, faladas),
      taxa_duplicata: taxa(c.duplicadas, c.avaliadas + this.avaliadasPendentes),
      taxa_acao: taxa(c.agiu, faladas),
      taxa_dispensa: taxa(c.rejeitou, faladas),
      taxa_ignorado: taxa(c.ignorou, faladas),
    };
  }
}

// ---------------------------------------------------------------------------
// A frase
// ---------------------------------------------------------------------------

/**
 * A FALA, COMPOSTA DETERMINISTICAMENTE — e a escolha merece defesa, porque a
 * especificação admite a LLM aqui.
 *
 * Três razões, todas operacionais:
 *
 *  1. Isto sai sem ninguém pedir. Uma frase gerada por modelo, num caminho que
 *     ninguém está olhando, é onde uma alucinação vira uma afirmação sobre a
 *     operação — e a IARA já tem `AfirmacaoDeFeito` retendo a fala justamente
 *     por isso no caminho reativo.
 *  2. A frase tem de ser a MESMA para o mesmo fato, ou o teste de spam não
 *     significa nada: duas redações diferentes do mesmo evento seriam duas
 *     ocorrências para qualquer deduplicação por texto.
 *  3. A IARA roda sem provedor. Uma proatividade que emudece quando a chave
 *     acaba é uma proatividade que não existe.
 *
 * A FORMA é o que a especificação pede — curta, específica, acionável, sem
 * teatro. Nada de "Olá! Identifiquei uma nova informação relevante": o resumo
 * carrega o fato, a evidência carrega o número, e a frase termina numa OFERTA,
 * nunca num anúncio. É a mesma voz que o `Vigia` já tinha.
 */
export function comporFala(o: Ocorrencia, acao: 'alertar' | 'sugerir' | 'perguntar'): string {
  /**
   * O resumo vem de um detector, e detector nenhum é obrigado a terminar a
   * frase com ponto. Sem esta linha, "…no processo de coleta" e "O normal
   * seria…" se colavam numa oração só — o tipo de emenda que faz um alerta
   * parecer texto de máquina em vez de frase de alguém.
   */
  const fato = /[.!?…]$/.test(o.resumo) ? o.resumo : `${o.resumo}.`;
  const numeros = o.evidencia.length > 0 ? ` ${o.evidencia.join('; ')}.` : '';

  switch (acao) {
    case 'alertar':
      return `${fato}${numeros} Não investiguei ainda nem mexi em nada — quer que eu descubra o motivo?`;

    case 'sugerir':
      return `${fato}${numeros} Quer que eu veja se dá para automatizar?`;

    case 'perguntar':
      /* A incerteza vai na frase, não numa nota de rodapé. É a diferença entre
         "seu processo está com problema" e "medi isto e ainda não sei a causa". */
      return `${fato}${numeros} Ainda não confirmei — quer que eu verifique antes de a gente tratar isso como certo?`;
  }
}

/**
 * A oportunidade vira ocorrência. `natureza: 'observado'` porque a contagem É
 * uma medição — o número de execuções está no livro, não numa suposição sobre o
 * que a pessoa faz.
 *
 * `severidade: 'moderada'`, e nunca `grave`. A severidade responde "quanto custa
 * se isto for verdade e ninguém souber" — e horas por semana gastas repetindo um
 * procedimento à mão custam de verdade, o que descarta `leve`. O teto em
 * `moderada` é o que importa: furar a janela de silêncio exige `grave` **e**
 * confiança alta (ver `Interrupcao.podeInterromper`), então uma sugestão de
 * automação nunca acorda ninguém — que é exatamente a leitura certa. Não é
 * urgente, mas há o que fazer, e `acionavel: true` é o que diz isso.
 */
export function ocorrenciaDeOportunidade(op: Oportunidade): Record<string, unknown> {
  const dias = Math.max(1, Math.round((op.ultima_em - op.primeira_em) / (24 * 60 * 60 * 1000)));
  return {
    tipo: 'automacao.oportunidade',
    origem: 'kernel',
    instante: op.ultima_em,
    assunto: `automacao_${op.assinatura}`,
    rotulo: op.rotulo,
    resumo: `Você repetiu "${op.rotulo}" ${op.vezes} vezes nos últimos ${dias} dia(s), sempre com os mesmos parâmetros.`,
    evidencia: [`${op.vezes} execuções em ${op.dias_distintos} dias distintos`],
    confianca: 'alta',
    severidade: 'moderada',
    natureza: 'observado',
    acionavel: true,
    /* A chave inclui o PATAMAR: é o que permite a conversa voltar em 20 e em 100
       sem que ela se repita a cada execução. Ver `DetectorDeRepeticao`. */
    chave_dedup: `oportunidade:${op.assinatura}:${op.patamar}`,
  };
}
