/**
 * O CLIENTE DO BARRAMENTO — fala o mesmo protocolo que o navegador fala, e
 * GRAVA tudo.
 *
 * A gravação não é conveniência de depuração: é a terceira perna do tripé. Uma
 * campanha que só guarda "a IARA disse X" não consegue responder à pergunta que
 * separa um defeito de um mal-entendido — *em que ordem as camadas discordaram?*
 * Com `seq` e instante de cada pacote, "o jornal marcou verificada às 03:14:07 e
 * a fala negou às 03:14:09" é um fato reconstruível meses depois; sem eles, é
 * memória de quem estava olhando.
 *
 * Nenhum atalho de servidor aqui: `ws` de verdade, `ola` de verdade, o mesmo
 * `lerPacoteCliente` do outro lado. Se o handshake quebrar para o navegador,
 * quebra para a campanha — que é a propriedade que se quer.
 */

import { WebSocket } from 'ws';
import type { PacoteServidor } from '../../lib/protocolo';
import type { CadeiaCognitiva, FalaProjetada, SnapshotCognitivo } from '../../lib/snapshot';

export interface PacoteGravado {
  /** Milissegundos desde a abertura desta conexão. Relativo, não de parede. */
  readonly t: number;
  readonly direcao: 'entrada' | 'saida';
  readonly bruto: unknown;
}

export interface Turno {
  /** O que foi dito à IARA. */
  readonly pedido: string;
  /** O que ela respondeu. Vazio quando o turno não produziu fala. */
  readonly resposta: string;
  readonly concluida: boolean;
  readonly cadeia: CadeiaCognitiva | null;
  readonly snapshot: SnapshotCognitivo | null;
  /** Pacotes `erro` chegados durante o turno. */
  readonly erros: readonly string[];
  /**
   * Pacotes `log` de nível `alerta` chegados durante o turno — o kernel
   * relatando as próprias falhas, em canal TIPADO.
   *
   * ESTE CAMPO É FATO, NÃO JUÍZO: o cliente coleta e não interpreta. Quem
   * decide o que uma falha de provedor significa é `contrato.ts`, e a separação
   * é a mesma de sempre — o oráculo colhe, o contrato julga.
   *
   * EXISTE POR CAUSA DO PORTÃO CEGO DE 18/08/2026. A campanha CO contra a Groq
   * saiu `GO` com oito dos treze turnos mortos por `429` de cota. Nenhum
   * oráculo viu, porque a única evidência que a campanha lia era a FALA — e a
   * fala de um turno assim ("não consegui concluir esse pedido agora") é
   * indistinguível de uma recusa correta. As duas viravam `RECUSA_HONESTA`.
   *
   * O log estava chegando o tempo todo, no mesmo socket, e ninguém o guardava:
   *
   *     {"tipo":"log","nivel":"alerta",
   *      "texto":"kernel: groq respondeu 429: … tokens per minute (TPM): Limit 8000"}
   */
  readonly alertas: readonly string[];
  readonly ms: number;
  /** `true` quando o prazo estourou antes de a fala se declarar concluída. */
  readonly truncado: boolean;
}

export interface OpcoesConexao {
  readonly url: string;
  readonly id_usuario: string;
  readonly nome?: string;
  /** Origem enviada no handshake. Igual à do host: é o que o navegador faria. */
  readonly origem?: string;
  readonly prazo_ms?: number;
}

const PRAZO_TURNO_MS = 180_000;

export class ClienteBarramento {
  private socket: WebSocket | null = null;
  private readonly gravadas: PacoteGravado[] = [];
  private abertura = 0;
  private ultimoSnapshot: SnapshotCognitivo | null = null;
  private ultimaSeq = 0;
  private readonly errosPendentes: string[] = [];
  private readonly alertasPendentes: string[] = [];
  private readonly ouvintes = new Set<(p: PacoteServidor) => void>();
  private fechadoPor: { codigo: number; motivo: string } | null = null;

  constructor(private readonly opcoes: OpcoesConexao) {}

  get pacotes(): readonly PacoteGravado[] {
    return this.gravadas;
  }
  get snapshot(): SnapshotCognitivo | null {
    return this.ultimoSnapshot;
  }
  get sessao(): string | null {
    return this.ultimoSnapshot?.sessao ?? null;
  }
  get fechamento(): { codigo: number; motivo: string } | null {
    return this.fechadoPor;
  }
  get conectado(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  /**
   * Quantas tentativas o handshake precisou. Maior que 1 é sinal, não ruído:
   * ver o comentário em `conectar`.
   */
  private tentativasDeConexao = 0;
  get tentativas(): number {
    return this.tentativasDeConexao;
  }

  /**
   * Abre o socket, com reentrega.
   *
   * A tentativa única foi o desenho original e estava errada por uma razão que
   * só a primeira campanha real mostrou: o motor é um processo Node, e enquanto
   * ele está no meio de um turno pesado o laço de eventos pode não chegar ao
   * `upgrade` a tempo. O socket não é recusado — ele simplesmente não é aceito
   * ainda. Sem reentrega, isso vira `ERRO_DE_CAMPANHA` e a missão deixa de
   * medir a IARA para medir o agendamento do event loop.
   *
   * A reentrega NÃO esconde o fato: `tentativas` fica registrado, e o corredor
   * anota no relatório quando precisou de mais de uma. Um motor que só aceita
   * conexão na terceira tentativa é um achado — só não é o achado que aquela
   * missão estava tentando fazer.
   */
  async conectar(): Promise<void> {
    const porta = new URL(this.opcoes.url).port;
    const origem = this.opcoes.origem ?? `http://127.0.0.1:${porta}`;
    const MAX = 3;

    let ultimoErro: Error | null = null;
    let socket: WebSocket | null = null;
    for (let tentativa = 1; tentativa <= MAX; tentativa++) {
      this.tentativasDeConexao = tentativa;
      this.abertura = Date.now();
      const candidato = new WebSocket(this.opcoes.url, { headers: { Origin: origem } });
      try {
        await new Promise<void>((resolver, rejeitar) => {
          const prazo = setTimeout(
            () => rejeitar(new Error(`handshake não completou em 30 s (tentativa ${tentativa})`)),
            30_000,
          );
          candidato.once('open', () => {
            clearTimeout(prazo);
            resolver();
          });
          candidato.once('error', (e) => {
            clearTimeout(prazo);
            rejeitar(e);
          });
        });
        socket = candidato;
        break;
      } catch (e) {
        ultimoErro = e as Error;
        /* O socket meio-aberto não pode ficar pendurado: ele contaria como
           espelho ocupado até o heartbeat de 30 s do servidor o terminar. */
        candidato.removeAllListeners();
        candidato.on('error', () => undefined);
        candidato.terminate();
        if (tentativa < MAX) await new Promise((r) => setTimeout(r, 2000 * tentativa));
      }
    }
    if (!socket) throw ultimoErro ?? new Error('handshake falhou sem erro registrado');
    this.socket = socket;

    socket.on('message', (dado) => {
      let pacote: PacoteServidor;
      try {
        pacote = JSON.parse(dado.toString()) as PacoteServidor;
      } catch {
        this.gravadas.push({
          t: Date.now() - this.abertura,
          direcao: 'entrada',
          bruto: { ilegivel: dado.toString().slice(0, 200) },
        });
        return;
      }
      this.gravadas.push({ t: Date.now() - this.abertura, direcao: 'entrada', bruto: pacote });

      /**
       * A MESMA guarda de ordem do cliente real: pacote com `seq` menor ou
       * igual ao último aplicado é descartado. Replicá-la aqui não é zelo — é o
       * que faz a campanha enxergar o estado que a TELA enxergaria. Um harness
       * que aplica tudo veria snapshots que o navegador nunca mostrou.
       */
      if ('seq' in pacote && typeof pacote.seq === 'number') {
        if (pacote.seq <= this.ultimaSeq) return;
        this.ultimaSeq = pacote.seq;
      }
      if (pacote.tipo === 'snapshot') this.ultimoSnapshot = pacote.snapshot;
      if (pacote.tipo === 'erro') this.errosPendentes.push(pacote.texto);
      /* Só `alerta`. `NivelLog` é `traco | info | alerta` e não tem grau acima —
         guardar os outros dois seria guardar o log inteiro do motor. O que
         interessa é o que o próprio kernel CLASSIFICOU como digno de alerta. */
      if (pacote.tipo === 'log' && pacote.nivel === 'alerta') {
        this.alertasPendentes.push(pacote.texto);
      }
      for (const o of this.ouvintes) o(pacote);
    });

    socket.on('close', (codigo, motivo) => {
      this.fechadoPor = { codigo, motivo: motivo.toString() };
    });
    /* Sem ouvinte de `error` o `ws` promove a falha a exceção não capturada e
       derruba o corredor inteiro — uma queda de socket é DADO da campanha. */
    socket.on('error', () => undefined);

    this.enviar({
      tipo: 'ola',
      id_usuario: this.opcoes.id_usuario,
      nome: this.opcoes.nome ?? this.opcoes.id_usuario,
    });

    /* O primeiro snapshot é o aceite da sessão. Sem ele não há conversa —
       e o `erro` seguido de `close` é a recusa, que também precisa ser vista. */
    await this.esperarPacote((p) => p.tipo === 'snapshot' || p.tipo === 'erro', 20_000);
  }

  enviar(pacote: unknown): void {
    this.gravadas.push({ t: Date.now() - this.abertura, direcao: 'saida', bruto: pacote });
    this.socket?.send(JSON.stringify(pacote));
  }

  /** Envia texto CRU, sem passar por JSON — para as missões de parser. */
  enviarBruto(texto: string): void {
    this.gravadas.push({ t: Date.now() - this.abertura, direcao: 'saida', bruto: { cru: texto.slice(0, 200) } });
    this.socket?.send(texto);
  }

  private esperarPacote(
    aceita: (p: PacoteServidor) => boolean,
    prazoMs: number,
  ): Promise<PacoteServidor | null> {
    return new Promise((resolver) => {
      const encerrar = (p: PacoteServidor | null) => {
        clearTimeout(t);
        this.ouvintes.delete(ouvinte);
        resolver(p);
      };
      const ouvinte = (p: PacoteServidor) => {
        if (aceita(p)) encerrar(p);
      };
      const t = setTimeout(() => encerrar(null), prazoMs);
      this.ouvintes.add(ouvinte);
    });
  }

  /**
   * Um turno completo: manda a frase e espera a fala se declarar concluída.
   *
   * O SINAL DE FIM É `fala.concluida`, e a escolha merece defesa: seria mais
   * fácil esperar `estagio === 'ocioso'`, e seria errado. O estágio volta a
   * ocioso em vários caminhos que não são "terminei de responder" — inclusive
   * antes do primeiro token, na janela entre roteamento e streaming. Já
   * `concluida` é escrito pelo mesmo evento que fecha o turno no kernel
   * (`TAREFA_CONCLUIDA`). Esperar o estágio produziria turnos "vazios" que a
   * campanha contaria como silêncio da IARA — um falso incidente.
   *
   * O `id` da fala anterior é capturado ANTES do envio porque o snapshot
   * carrega a ÚLTIMA fala mesmo depois do turno acabar: sem comparar id, a
   * primeira leitura já casaria com a resposta anterior e o turno "terminaria"
   * antes de começar.
   */
  async dizer(texto: string, prazoMs: number = PRAZO_TURNO_MS): Promise<Turno> {
    const inicio = Date.now();
    const falaAnterior = this.ultimoSnapshot?.fala?.id ?? null;
    this.errosPendentes.length = 0;
    this.alertasPendentes.length = 0;

    const idLocal = `camp${this.gravadas.length}`;
    /**
     * `op:${idLocal}` — a mesma transformação determinística que o servidor
     * aplica em `PerguntaProjetada.id` (ver `lib/snapshot.ts`). É o endereço
     * da PRÓPRIA pergunta deste cliente.
     */
    const minhaPergunta = `op:${idLocal}`;
    this.enviar({ tipo: 'mensagem', texto, id_local: idLocal });

    /**
     * FILTRA POR `responde_a`, NÃO SÓ POR "É UMA FALA NOVA".
     *
     * ACHADO EM 17/08/2026: com dois espelhos falando ao mesmo tempo (missão
     * `CC-01`), este cliente aceitava a primeira fala concluída diferente da
     * anterior — inclusive a de OUTRO espelho. O oráculo de disco conferia o
     * efeito do próprio pedido antes dele existir de verdade (a resposta real
     * ainda estava a caminho), e a missão saía `FALSO_POSITIVO` por um buraco
     * no HARNESS, não no produto: o jornal do motor mostrava as duas
     * operações executadas e verificadas.
     *
     * `hooks/useIaraSocket.ts` (o cliente real) já resolve isso comparando
     * `responde_a` com o id da própria bolha — a mesma correção de
     * `FalaProjetada.responde_a`, cujo comentário cita este mesmo CC-01 de
     * 16/08/2026 como o defeito original. Replicar aqui é o que falta para o
     * harness enxergar o que a tela enxergaria.
     */
    const nova = (f: FalaProjetada | null | undefined): boolean =>
      !!f && f.concluida && f.id !== falaAnterior && f.responde_a === minhaPergunta;

    const pacote = await this.esperarPacote(
      (p) =>
        (p.tipo === 'snapshot' && nova(p.snapshot.fala)) ||
        /* Recusa de sessão fecha o turno: esperar fala que não vem é o modo mais
           caro de descobrir que o socket morreu. */
        (p.tipo === 'erro' && !this.conectado),
      prazoMs,
    );

    const snap = this.ultimoSnapshot;
    const fala = pacote?.tipo === 'snapshot' ? pacote.snapshot.fala : (snap?.fala ?? null);
    const houve = nova(fala);
    return {
      pedido: texto,
      resposta: houve ? (fala?.texto ?? '') : '',
      concluida: houve,
      cadeia: snap?.cadeia ?? null,
      snapshot: snap,
      erros: [...this.errosPendentes],
      alertas: [...this.alertasPendentes],
      ms: Date.now() - inicio,
      truncado: !houve,
    };
  }

  /** Interrompe o turno em andamento — a missão de barge-in. */
  interromper(): void {
    this.enviar({ tipo: 'interromper' });
  }

  async fechar(): Promise<void> {
    if (!this.socket) return;
    const s = this.socket;
    this.socket = null;
    if (s.readyState === WebSocket.OPEN || s.readyState === WebSocket.CONNECTING) s.close();
    await new Promise((r) => setTimeout(r, 120));
  }
}
