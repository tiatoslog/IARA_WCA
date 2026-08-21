/**
 * Sessão de um operador no barramento.
 *
 * Só três responsabilidades, todas de transporte — nenhuma cognitiva:
 *
 *  1. CARIMBO: aplica `seq` monotônico e `instante` em todo pacote.
 *  2. FILA: entrega via ring buffer com descarte semântico, para que rede ruim
 *     não vire vazamento de memória nem enxurrada retroativa.
 *  3. BACKPRESSURE: respeita o buffer do socket do sistema operacional.
 *  4. REDAÇÃO: nenhum segredo do processo atravessa esta fronteira. Ver
 *     `enviar` — é transporte, não cognição, e é justamente por ser o único
 *     ponto de saída que a garantia pode ser dada aqui.
 *
 * Ela não sabe o que é percepção, plano ou habilidade. Recebe snapshot pronto
 * da `PonteProjecao` e transmite.
 */

import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { MaquinaDoOperador } from '../../lib/execucao';
import type { NivelLog, PacoteServidor } from '../../lib/protocolo';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import { redigir } from '../nucleo/kernel/Configuracao';
import { FilaTelemetria } from './FilaTelemetria';

const JANELA_MS = 40;

export class SessaoOperador {
  private readonly fila = new FilaTelemetria();
  private seq = 0;
  private timer: NodeJS.Timeout | null = null;
  private fechada = false;

  /**
   * A IDENTIDADE DESTA TELA. Não sai para o cliente e não identifica a pessoa:
   * identifica o ESPELHO, para o Kernel poder distinguir "a mesma tela mandou de
   * novo" de "outra tela mandou" — a distinção que faltava no CC-01. Vive o
   * tempo do socket; reconexão é uma tela nova, e é isso mesmo que se quer.
   */
  readonly id = randomUUID();

  constructor(private readonly socket: WebSocket) {}

  /**
   * Drenagem SOB DEMANDA, não por relógio. Um `setInterval` de 40 ms por tela
   * conectada acordava o event loop 25 vezes por segundo com a fila vazia —
   * multiplicado por espelho, era o maior custo fixo do servidor em ócio.
   * Agora o timer só existe quando há pacote esperando janela de aglutinação
   * (logs) ou backpressure segurando a fila.
   */
  private agendarDrenagem(): void {
    if (this.timer || this.fechada) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.drenar();
      // Sobrou pacote (backpressure ou socket ainda abrindo)? Reagenda.
      if (this.fila.tamanho > 0) this.agendarDrenagem();
    }, JANELA_MS);
    this.timer.unref?.();
  }

  emitirSnapshot(snapshot: SnapshotCognitivo): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({
      tipo: 'snapshot',
      seq: this.seq,
      instante: Date.now(),
      // O `seq` do envelope manda: é o que o cliente usa como guarda de ordem.
      snapshot: { ...snapshot, seq: this.seq },
    });
    this.drenar();
  }

  emitirLog(nivel: NivelLog, texto: string): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({ tipo: 'log', seq: this.seq, instante: Date.now(), nivel, texto });
    this.agendarDrenagem();
  }

  /**
   * O inventário de mãos, para ESTA tela.
   *
   * Não vai para os espelhos, e a diferença com a ficha do operador é
   * proposital: a ficha muda o que a IARA sabe sobre a pessoa e precisa
   * concordar em todas as telas; a lista de máquinas é uma consulta, aberta na
   * gaveta de quem perguntou. Reidratar todos os espelhos por causa dela faria
   * uma gaveta fechada no computador receber tráfego por um clique no celular.
   */
  emitirDispositivos(
    maquinas: MaquinaDoOperador[],
    pareamentoDisponivel: boolean,
    escolhido: string | null,
    ultimaAcao?: { ok: boolean; texto: string },
  ): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({
      tipo: 'dispositivos',
      seq: this.seq,
      instante: Date.now(),
      maquinas,
      pareamento_disponivel: pareamentoDisponivel,
      escolhido,
      ...(ultimaAcao ? { ultima_acao: ultimaAcao } : {}),
    });
    this.drenar();
  }

  emitirErro(texto: string, contexto?: 'preferencias'): void {
    if (this.fechada) return;
    this.seq += 1;
    this.fila.enfileirar({
      tipo: 'erro',
      seq: this.seq,
      instante: Date.now(),
      texto,
      ...(contexto ? { contexto } : {}),
    });
    this.drenar();
  }

  private drenar(): void {
    if (this.fechada) return;
    // Socket ainda abrindo, ou backpressure real do SO: não empilha agora,
    // mas REAGENDA — sem o interval fixo de antes, ninguém mais tentaria.
    if (this.socket.readyState !== 1 || this.socket.bufferedAmount > 1_000_000) {
      if (this.fila.tamanho > 0) this.agendarDrenagem();
      return;
    }
    for (const pacote of this.fila.drenar()) this.enviar(pacote);
  }

  /**
   * O ÚLTIMO PONTO ANTES DO OLHO HUMANO — e por isso o lugar da redação.
   *
   * Um incidente de 13/08 ensinou por que ela não pode morar no ponto de
   * origem: `ANTHROPIC_API_KEY` chegou contaminada com um segundo segredo
   * colado dentro, o SDK a pôs num cabeçalho, o `Headers` recusou, e a exceção
   * subiu com a chave INTEIRA na mensagem. O `Kernel` a publicou como fala. A
   * operadora leu a credencial no celular, e ela acabou numa captura de tela.
   *
   * Consertar aquele `catch` teria consertado aquele caminho. Existem trinta —
   * toda `(erro as Error).message` que vira texto de pacote, e as que forem
   * escritas depois desta linha. Redigir no ORIGEM é uma disciplina que se
   * esquece; redigir na SAÍDA é uma propriedade do canal.
   *
   * Sobre o pacote SERIALIZADO, não campo a campo, de propósito: assim vale
   * para todo campo de texto de todo tipo de pacote — inclusive os que ainda
   * não existem — sem que ninguém precise lembrar de marcar quais são
   * sensíveis. Custa uma varredura de string por pacote drenado, no caminho
   * que já paga um `JSON.stringify`.
   *
   * Isto é a SEGUNDA porta. A primeira é `conferirAmbiente` recusando a subida
   * com configuração contaminada; esta existe para o dia em que um segredo
   * escapar por um caminho que ninguém mapeou.
   */
  private enviar(pacote: PacoteServidor): void {
    if (this.socket.readyState !== 1) return;
    this.socket.send(redigir(JSON.stringify(pacote)));
  }

  get descartados(): number {
    return this.fila.totalDescartado;
  }

  fechar(): void {
    this.fechada = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.fila.limpar();
  }

  /**
   * Fecha a sessão E derruba o transporte. É o que o takeover de reconexão
   * precisa: `fechar()` sozinho deixa o socket antigo vivo no SO, e o `close`
   * tardio dele (minutos depois, quando o TCP expira) executaria a desmontagem
   * em cima da sessão nova.
   */
  derrubar(codigo = 4000, motivo = 'substituida por conexao nova'): void {
    this.fechar();
    try {
      this.socket.close(codigo, motivo);
    } catch {
      /* transporte já encerrado */
    }
  }
}
