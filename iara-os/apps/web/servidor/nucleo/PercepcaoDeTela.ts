/**
 * Percepção de tela, do lado do motor — a SESSÃO, não só o estado.
 *
 * O QUE MUDOU DO P0 PARA CÁ. Antes este módulo era um redutor: recebia evento,
 * atualizava estado. Faltava a metade que transforma a fundação em produto — a
 * IARA PEDIR, o operador AUTORIZAR, e alguém conseguir PARAR. Sem isso, só um
 * script ligava a percepção, e script não é produto.
 *
 * O CICLO COMPLETO mora aqui:
 *
 *   solicitar   a IARA pede. Nada é capturado. Vale 5 min.
 *   autorizar   o operador aceita NA CONVERSA. Só agora o Braço é acionado.
 *   registrar   os eventos chegam e o estado anda.
 *   encerrar    kill switch: manda parar e marca `encerrada` do lado de cá.
 *   varrer      o teto de 30 min mata o que ninguém encerrou.
 *
 * O QUE ELE CONTINUA NÃO FAZENDO, e a lista não encolheu:
 *
 *   NÃO avança procedimento     não importa `ProcedimentosEmCurso`
 *   NÃO produz evidência        não importa `GuardiaoDoProcedimento`
 *   NÃO produz conferência      não importa `ConferenciaDeTela`
 *   NÃO identifica tela         diz que MUDOU, não que tela é
 *   NÃO chama a LLM
 *
 * `mudanca_visual` NÃO É `conferencia_da_etapa`. Uma mudança de tela diz que
 * algo mudou na janela autorizada; não diz que a pessoa chegou à etapa certa,
 * não diz que ela fez o que o POP mandava, e não sustenta avanço nenhum.
 *
 * O TRANSPORTE ENTRA POR INJEÇÃO (`configurarEnvio`), não por importação. Este
 * módulo é estado e decisão; quem conhece socket é a ponte. Importá-la aqui
 * criaria a aresta que faz o núcleo depender do barramento — e a fronteira é
 * verificada por grafo.
 */

import {
  aplicarEvento,
  estadoSolicitado,
  podeCapturar,
  sessaoExpirou,
  type EscopoDePercepcao,
  type EstadoVisual,
  type EventoVisual,
  type SolicitacaoDePercepcao,
} from '../../lib/percepcao';

/** Quem observou. Vem da ponte, nunca do pacote — o Braço não se autonomeia. */
export interface FonteDaObservacao {
  readonly id_dispositivo: string;
  readonly id_usuario: string;
}

/** O que este módulo precisa do transporte, e nada além disso. */
export interface EnvioAoBraco {
  /** `null` quando não há braço conectado para este operador. */
  dispositivoDe(idUsuario: string): { id_dispositivo: string; nome: string } | null;
  /** `false` quando a escrita no socket falhou. */
  enviar(
    idUsuario: string,
    pacote:
      | { tipo: 'percepcao_iniciar'; sessao_percepcao: string; processos: readonly string[]; autorizado_em: string }
      | { tipo: 'percepcao_encerrar'; sessao_percepcao: string; motivo: string },
  ): boolean;
}

type Ouvinte = (estado: EstadoVisual, evento: EventoVisual) => void;

/** Teto de sessões guardadas por processo. Sessão morta não cresce sem fim. */
const MAX_SESSOES = 50;

/** De quanto em quanto tempo o teto das sessões é conferido. */
const INTERVALO_DE_VARREDURA_MS = 30_000;

export type ResultadoDeSessao =
  | { readonly ok: true; readonly estado: EstadoVisual }
  | { readonly ok: false; readonly motivo: string };

export class PercepcaoDeTela {
  private readonly porSessao = new Map<string, EstadoVisual>();
  private readonly ouvintes = new Set<Ouvinte>();
  private envio: EnvioAoBraco | null = null;
  private contador = 0;

  configurarEnvio(envio: EnvioAoBraco | null): void {
    this.envio = envio;
  }

  private chave(idUsuario: string, sessao: string): string {
    return `${idUsuario}|${sessao}`;
  }

  /**
   * A IARA PEDE. Nada é capturado aqui — nem o Braço é acionado.
   *
   * Devolve `ok: false` quando não há braço conectado: prometer observação para
   * uma máquina que não está lá seria a IARA anunciando uma capacidade que ela
   * não tem naquele instante, que é o defeito que o `Braco.ts` inteiro existe
   * para não cometer.
   */
  solicitar(pedido: {
    id_usuario: string;
    escopo: EscopoDePercepcao;
    motivo: string;
    procedimento: string | null;
    agora?: number;
  }): ResultadoDeSessao {
    /* ESCOPO VAZIO É PERMITIDO NO PEDIDO, e proibido na autorização. O pedido é
       uma pergunta — "posso acompanhar?" —, e a resposta do operador é que
       costuma trazer QUAL programa. Exigir o escopo aqui obrigaria a IARA a
       adivinhar o aplicativo antes de perguntar, e adivinhar escopo de captura
       é a última coisa que este subsistema pode fazer. */
    const dispositivo = this.envio?.dispositivoDe(pedido.id_usuario) ?? null;
    if (!dispositivo) {
      return { ok: false, motivo: 'nenhum computador seu está conectado agora' };
    }

    /* PEDIDO NOVO SUBSTITUI PEDIDO PENDENTE do mesmo operador. Dois pedidos
       abertos fariam "pode observar" ficar ambíguo — e ambiguidade num
       consentimento é a pior forma de ambiguidade. */
    for (const [k, e] of this.porSessao) {
      if (e.id_usuario === pedido.id_usuario && e.estado === 'solicitada') this.porSessao.delete(k);
    }

    const agora = pedido.agora ?? Date.now();
    this.contador += 1;
    const solicitacao: SolicitacaoDePercepcao = {
      sessao_percepcao: `sp-${agora.toString(36)}-${this.contador}`,
      id_usuario: pedido.id_usuario,
      escopo: { processos: pedido.escopo.processos.map((p) => p.toLowerCase()) },
      motivo: pedido.motivo,
      procedimento: pedido.procedimento,
      solicitada_em: new Date(agora).toISOString(),
    };
    const estado = estadoSolicitado(solicitacao, dispositivo.id_dispositivo);
    this.porSessao.set(this.chave(pedido.id_usuario, solicitacao.sessao_percepcao), estado);
    this.podar();
    return { ok: true, estado };
  }

  /**
   * O OPERADOR AUTORIZA. É aqui, e só aqui, que o Braço é acionado.
   *
   * Nenhum outro método deste módulo escreve `percepcao_iniciar` no socket.
   * Uma segunda porta para ligar a observação da tela de alguém é exatamente o
   * caminho paralelo que este sistema recusa em toda camada.
   */
  autorizar(
    idUsuario: string,
    opcoes: { agora?: number; escopo?: EscopoDePercepcao } = {},
  ): ResultadoDeSessao {
    const agora = opcoes.agora ?? Date.now();
    const original = this.pendenteDe(idUsuario);
    if (!original) return { ok: false, motivo: 'não há pedido de observação aguardando você' };
    /* O ESCOPO PODE VIR NA AUTORIZAÇÃO: é nela que a pessoa costuma dizer qual
       programa ("pode observar o chrome"). Sem escopo em lugar nenhum, a
       autorização é recusada — observar "a tela" não é escopo. */
    const processos =
      opcoes.escopo && opcoes.escopo.processos.length > 0
        ? opcoes.escopo.processos.map((x) => x.toLowerCase())
        : original.processos;
    if (processos.length === 0) {
      return { ok: false, motivo: 'não sei qual programa devo acompanhar' };
    }
    const pendente: EstadoVisual = { ...original, processos };
    if (sessaoExpirou(pendente, agora)) {
      this.porSessao.delete(this.chave(idUsuario, pendente.sessao_percepcao));
      return { ok: false, motivo: 'o pedido de observação venceu; peça de novo' };
    }
    if (!this.envio) return { ok: false, motivo: 'transporte de percepção indisponível' };

    const escrito = this.envio.enviar(idUsuario, {
      tipo: 'percepcao_iniciar',
      sessao_percepcao: pendente.sessao_percepcao,
      processos: pendente.processos,
      autorizado_em: new Date(agora).toISOString(),
    });
    if (!escrito) return { ok: false, motivo: 'não consegui falar com o seu computador' };

    /* O ESTADO NÃO VIRA `ativa` AQUI. Ele vira quando o Braço disser que
       começou (`sessao_iniciada`). Marcar `ativa` no envio seria afirmar
       observação a partir do próprio pedido — o mesmo erro que
       `enviada_ao_dispositivo` existe para não cometer do lado da execução. */
    const marcado: EstadoVisual = { ...pendente, autorizada_em: new Date(agora).toISOString() };
    this.porSessao.set(this.chave(idUsuario, pendente.sessao_percepcao), marcado);
    return { ok: true, estado: marcado };
  }

  /**
   * KILL SWITCH. Marca `encerrada` DE IMEDIATO e manda o Braço parar.
   *
   * A ORDEM IMPORTA: o estado local vira `encerrada` ANTES do envio, e
   * `aplicarEvento` recusa reviver uma sessão encerrada. Assim, um quadro que
   * já estava em voo quando o operador apertou parar não reabre nada — e se o
   * socket estiver morto, a sessão continua encerrada do lado de cá em vez de
   * ficar viva esperando um "ok" que não vem.
   */
  encerrar(idUsuario: string, motivo: string, agora = Date.now()): ResultadoDeSessao {
    const viva = this.vivaDe(idUsuario);
    if (!viva) return { ok: false, motivo: 'você não tem observação em curso comigo' };

    const encerrada: EstadoVisual = {
      ...viva,
      estado: 'encerrada',
      motivo,
      atualizado_em: new Date(agora).toISOString(),
    };
    this.porSessao.set(this.chave(idUsuario, viva.sessao_percepcao), encerrada);

    this.envio?.enviar(idUsuario, {
      tipo: 'percepcao_encerrar',
      sessao_percepcao: viva.sessao_percepcao,
      motivo,
    });
    this.auditar('encerrada', encerrada, motivo);
    return { ok: true, estado: encerrada };
  }

  /**
   * Aplica um evento vindo do Braço.
   *
   * A IDENTIDADE VEM DA FONTE, não do evento: `id_usuario` e `id_dispositivo`
   * são o que a ponte autenticou. Deixar o pacote dizer de quem ele é seria
   * permitir que um braço reportasse a tela de outra pessoa.
   */
  registrar(fonte: FonteDaObservacao, evento: EventoVisual): EstadoVisual {
    const chave = this.chave(fonte.id_usuario, evento.sessao_percepcao);
    const anterior = this.porSessao.get(chave) ?? null;

    /* EVENTO DE SESSÃO DESCONHECIDA é aceito, e a escolha merece explicação: o
       motor pode ter reiniciado com o Braço observando. Recusar deixaria uma
       captura viva sem ninguém do lado de cá sabendo — e o teto de 30 min é o
       que a mata. Aceitar e registrar é o que permite o operador vê-la e parar. */
    const estado = aplicarEvento(anterior, evento, fonte);
    this.porSessao.set(chave, estado);
    this.podar();

    for (const ouvinte of this.ouvintes) {
      try {
        ouvinte(estado, evento);
      } catch (erro) {
        console.warn(`[iara] ouvinte de percepção falhou: ${(erro as Error).message}`);
      }
    }
    return estado;
  }

  /**
   * O TETO. Mata o que passou de 30 min e o pedido que passou de 5.
   *
   * Roda por relógio no motor e também pode ser chamada com `agora` fixo pelo
   * teste. É a trava do §27: motor que caiu e voltou não deixa observação viva.
   */
  varrer(agora = Date.now()): readonly EstadoVisual[] {
    const mortas: EstadoVisual[] = [];
    for (const [chave, estado] of this.porSessao) {
      if (!sessaoExpirou(estado, agora)) continue;
      if (estado.estado === 'solicitada') {
        this.porSessao.delete(chave);
        continue;
      }
      const encerrada: EstadoVisual = {
        ...estado,
        estado: 'encerrada',
        motivo: 'teto de tempo da sessão atingido',
        atualizado_em: new Date(agora).toISOString(),
      };
      this.porSessao.set(chave, encerrada);
      this.envio?.enviar(estado.id_usuario, {
        tipo: 'percepcao_encerrar',
        sessao_percepcao: estado.sessao_percepcao,
        motivo: 'teto de tempo',
      });
      this.auditar('expirada', encerrada, 'teto de tempo');
      mortas.push(encerrada);
    }
    return mortas;
  }

  /** O pedido aguardando resposta deste operador, ou `null`. */
  pendenteDe(idUsuario: string): EstadoVisual | null {
    return (
      [...this.porSessao.values()]
        .filter((e) => e.id_usuario === idUsuario && e.estado === 'solicitada')
        .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))[0] ?? null
    );
  }

  /**
   * A sessão VIVA deste operador — autorizada, ativa ou suspensa.
   *
   * Uma autorizada que ainda não começou conta como viva de propósito: é o
   * intervalo entre o "pode observar" e o Braço responder, e nele o operador
   * precisa conseguir desistir.
   */
  vivaDe(idUsuario: string): EstadoVisual | null {
    return (
      [...this.porSessao.values()]
        .filter(
          (e) =>
            e.id_usuario === idUsuario &&
            (podeCapturar(e.estado) || (e.estado === 'solicitada' && e.autorizada_em !== null)),
        )
        .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))[0] ?? null
    );
  }

  /** A sessão que está de fato observando agora, ou `null`. */
  ativaDe(idUsuario: string): EstadoVisual | null {
    return (
      [...this.porSessao.values()]
        .filter((e) => e.id_usuario === idUsuario && podeCapturar(e.estado))
        .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em))[0] ?? null
    );
  }

  /** Todo estado conhecido deste operador, do mais recente ao mais antigo. */
  de(idUsuario: string): readonly EstadoVisual[] {
    return [...this.porSessao.values()]
      .filter((e) => e.id_usuario === idUsuario)
      .sort((a, b) => b.atualizado_em.localeCompare(a.atualizado_em));
  }

  aoEvento(ouvinte: Ouvinte): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /** Só para teste e para o encerramento do processo. */
  limpar(): void {
    this.porSessao.clear();
    this.contador = 0;
  }

  private podar(): void {
    if (this.porSessao.size <= MAX_SESSOES) return;
    const maisAntiga = [...this.porSessao.entries()].sort((a, b) =>
      a[1].atualizado_em.localeCompare(b[1].atualizado_em),
    )[0];
    if (maisAntiga) this.porSessao.delete(maisAntiga[0]);
  }

  /**
   * A TRILHA. "A IARA observou a tela de alguém" é uma afirmação que alguém vai
   * querer reler — e o §21 pede auditoria de QUANDO a percepção esteve ativa,
   * não só do que ela viu. Nenhum quadro é registrado, nunca.
   */
  private auditar(acao: string, estado: EstadoVisual, motivo: string): void {
    console.log(
      JSON.stringify({
        canal: 'percepcao',
        acao,
        sessao: estado.sessao_percepcao,
        id_usuario: estado.id_usuario,
        dispositivo: estado.id_dispositivo,
        escopo: estado.processos,
        procedimento: estado.procedimento,
        solicitada_em: estado.solicitada_em,
        autorizada_em: estado.autorizada_em,
        mudancas: estado.mudancas,
        motivo,
      }),
    );
  }
}

/**
 * A instância do processo. Singleton pela razão de sempre: dois canais do mesmo
 * operador falam da mesma tela.
 */
export const percepcaoDeTela = new PercepcaoDeTela();

/**
 * Liga a percepção à ponte dos dispositivos — nos DOIS sentidos.
 *
 * FUNÇÃO EXPLÍCITA, e não efeito de importação: um módulo que se inscreve
 * sozinho ao ser importado transforma um `import` de tipo numa assinatura de
 * socket, e ninguém que lê o `import` desconfia disso. Quem chama é
 * `servidor/principal.ts`, onde o resto das ligações já mora.
 *
 * A PONTE CONTINUA BURRA. Ela publica `PacoteBraco`, aceita `PacoteMotor` e não
 * sabe o que é percepção; os dois filtros estão deste lado.
 */
export function ligarPercepcaoNaPonte(ponte: {
  aoPacote(
    ouvinte: (
      d: { id_dispositivo: string; id_usuario: string },
      p: { tipo: string; evento?: EventoVisual },
    ) => void,
  ): () => void;
  destinoDe(
    idUsuario: string,
    alvo?: string | null,
  ): { id_dispositivo: string; nome: string; enviar(p: never): boolean } | null;
}): () => void {
  percepcaoDeTela.configurarEnvio({
    dispositivoDe: (idUsuario) => {
      const d = ponte.destinoDe(idUsuario);
      return d ? { id_dispositivo: d.id_dispositivo, nome: d.nome } : null;
    },
    enviar: (idUsuario, pacote) => {
      const d = ponte.destinoDe(idUsuario);
      return d ? d.enviar(pacote as never) : false;
    },
  });

  const desinscrever = ponte.aoPacote((dispositivo, pacote) => {
    if (pacote.tipo !== 'percepcao' || !pacote.evento) return;
    const estado = percepcaoDeTela.registrar(
      { id_dispositivo: dispositivo.id_dispositivo, id_usuario: dispositivo.id_usuario },
      pacote.evento,
    );
    console.log(
      JSON.stringify({
        canal: 'percepcao',
        evento: pacote.evento.tipo,
        sessao: pacote.evento.sessao_percepcao,
        dispositivo: dispositivo.id_dispositivo,
        processo: pacote.evento.janela?.processo ?? null,
        estado: estado.estado,
        mudancas: estado.mudancas,
        motivo: pacote.evento.motivo || null,
      }),
    );
  });

  /* O TETO precisa de relógio: sem varredura, uma sessão órfã só morreria
     quando alguém perguntasse por ela — e o §27 é justamente sobre o caso em
     que ninguém pergunta. `unref` para não segurar o processo no encerramento. */
  const relogio = setInterval(() => percepcaoDeTela.varrer(), INTERVALO_DE_VARREDURA_MS);
  relogio.unref?.();

  return () => {
    clearInterval(relogio);
    desinscrever();
    percepcaoDeTela.configurarEnvio(null);
  };
}
