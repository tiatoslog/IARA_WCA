/**
 * A PONTE DE DISPOSITIVOS — o elo que faltava entre a nuvem e o computador.
 *
 * O PROBLEMA, dito sem rodeio. Até aqui, "a máquina do operador" e "a máquina
 * onde o motor roda" eram a mesma coisa por acidente de implantação, nunca por
 * contrato. Quando o motor subiu para a nuvem (12/08/2026, ver o cabeçalho de
 * `apps/desktop/src-tauri/src/main.rs`, que já anunciava esta fase), o acidente
 * acabou e ninguém foi avisado: um "abra o Chrome" vindo do celular chegava ao
 * contêiner Linux e tentava executar LÁ. O `AgenteLocal` não tinha como
 * perceber — ele sempre foi as mãos da máquina em que está.
 *
 * A ponte inverte a direção da conexão, e essa escolha é a coisa mais
 * importante deste arquivo. O motor NÃO alcança o desktop: é o desktop que
 * alcança o motor e fica pendurado. O motivo é banal e decisivo — o computador
 * do operador está atrás de NAT, de roteador doméstico, de firewall corporativo
 * e de um IP que muda. Não existe endereço estável para bater. Existe, do outro
 * lado, um motor com nome e TLS. Quem tem endereço é quem recebe.
 *
 * Consequência de segurança que vem de graça: nenhuma porta é aberta no
 * computador de ninguém. O braço é um cliente, como o navegador.
 *
 * A IDENTIDADE é a mesma do resto do sistema. Um braço se apresenta com o mesmo
 * token do Supabase que uma aba do navegador usaria, e `verificarToken` decide
 * de quem ele é. Sem isso, a ponte seria uma forma de qualquer um pedir
 * execução no computador de qualquer outro — o oposto exato do que o shard
 * privado protege no resto do sistema.
 */

import type { WebSocket } from 'ws';
import {
  lerPacoteBraco,
  type DescricaoDispositivo,
  type PacoteBraco,
  type PacoteMotor,
} from '../../lib/execucao';
import {
  autenticacaoAtiva,
  identidadeLocal,
  verificarToken,
  type OperadorAutenticado,
} from '../nucleo/Autenticacao';
import { LimiteVazao } from '../nucleo/kernel/Seguranca';

/**
 * Teto de braços por operador.
 *
 * Mais de um é legítimo — desktop do escritório e notebook de casa —, e é por
 * isso que o teto não é 1. Mas ele existe: uma reconexão em laço deixa sockets
 * meio-mortos para trás (o TCP antigo só expira minutos depois), e sem teto
 * cada queda de Wi-Fi somaria um fantasma na lista de destinos possíveis.
 */
const MAX_DISPOSITIVOS = 3;

/** Mesma trava do barramento do operador, e pelo mesmo motivo: `verificarToken`
 *  é uma chamada de rede, e abrir socket é de graça. */
const APRESENTACOES_POR_MINUTO = 60;

export interface DispositivoConectado extends DescricaoDispositivo {
  readonly id_usuario: string;
  /** `false` quando o socket já não aceita escrita — o chamador trata como ausência. */
  enviar(pacote: PacoteMotor): boolean;
  fechar(motivo: string): void;
}

type OuvintePacote = (dispositivo: DispositivoConectado, pacote: PacoteBraco) => void;

export class PonteDispositivos {
  /** id_usuario → dispositivos, em ordem de chegada. */
  private readonly porOperador = new Map<string, DispositivoConectado[]>();
  private readonly ouvintes = new Set<OuvintePacote>();
  private readonly vazao = new LimiteVazao(APRESENTACOES_POR_MINUTO, 60_000);
  private contador = 0;

  /** O Braço se inscreve aqui. A ponte não conhece o Braço — só publica. */
  aoPacote(ouvinte: OuvintePacote): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /**
   * O destino de uma ordem para este operador.
   *
   * O MAIS RECENTE, e não o primeiro: quem acabou de conectar é quem está na
   * frente do computador agora. Um braço esquecido ligado numa máquina no
   * escritório não deve engolir o comando de quem está com o notebook aberto.
   */
  destinoDe(idUsuario: string): DispositivoConectado | null {
    const lista = this.porOperador.get(idUsuario);
    return lista && lista.length > 0 ? lista[lista.length - 1] : null;
  }

  listar(idUsuario: string): DescricaoDispositivo[] {
    return (this.porOperador.get(idUsuario) ?? []).map((d) => ({
      id_dispositivo: d.id_dispositivo,
      nome: d.nome,
      plataforma: d.plataforma,
      versao: d.versao,
      conectado_em: d.conectado_em,
      visto_em: d.visto_em,
    }));
  }

  /** Quantos braços há no processo inteiro. Usado pelo `/saude`. */
  total(): number {
    let n = 0;
    for (const lista of this.porOperador.values()) n += lista.length;
    return n;
  }

  /**
   * Um braço chegou. Espelha `Porta.conectarOperador` de propósito: as duas
   * portas resolvem a mesma pergunta (quem é você?) e devem resolvê-la do mesmo
   * jeito. Duas maneiras diferentes de autenticar no mesmo processo é como uma
   * delas fica para trás.
   */
  conectar(socket: WebSocket): void {
    let dispositivo: DispositivoConectado | null = null;
    let abrindo = false;

    const recusar = (motivo: string) => {
      try {
        socket.send(JSON.stringify({ tipo: 'recusado', motivo } satisfies PacoteMotor));
      } catch {
        /* socket já morto: não há a quem explicar */
      }
      socket.close(4401, 'nao autenticado');
    };

    socket.on('message', (dado) => {
      const pacote = lerPacoteBraco(dado.toString());
      if (!pacote) return;

      if (pacote.tipo === 'apresentacao') {
        if (dispositivo || abrindo) return; // uma apresentação por conexão
        if (!this.vazao.permitir()) {
          socket.close(4429, 'excesso de tentativas');
          return;
        }
        abrindo = true;

        void (async () => {
          try {
            /**
             * A MESMA FRONTEIRA do navegador. Com Supabase ligado, quem manda é
             * o token; o `id_usuario` do pacote é decoração. Sem essa linha, o
             * braço seria a única porta do sistema onde o cliente escolhe de
             * quem ele é — e ela é justamente a porta que executa coisas.
             */
            const operador: OperadorAutenticado | null = autenticacaoAtiva()
              ? await verificarToken(pacote.token)
              : identidadeLocal(pacote.id_usuario, pacote.nome);

            if (!operador) {
              recusar('Sessão inválida ou expirada. Entre novamente no aplicativo da IARA.');
              return;
            }

            const lista = this.porOperador.get(operador.id_usuario) ?? [];
            if (lista.length >= MAX_DISPOSITIVOS) {
              /**
               * Recusa o NOVO, nunca derruba os estabelecidos — mesma decisão do
               * teto de espelhos em `Porta.ts`, e pela mesma razão: cliente
               * derrubado reconecta, e derrubar o mais antigo transformaria o
               * teto num carrossel de quedas perpétuo.
               */
              recusar(`Limite de ${MAX_DISPOSITIVOS} computadores conectados atingido para este operador.`);
              return;
            }

            this.contador += 1;
            const id = `disp-${this.contador}`;
            const agora = Date.now();
            const registro: DispositivoConectado = {
              id_dispositivo: id,
              id_usuario: operador.id_usuario,
              nome: pacote.nome,
              plataforma: pacote.plataforma,
              versao: pacote.versao,
              conectado_em: agora,
              visto_em: agora,
              enviar: (p) => {
                if (socket.readyState !== socket.OPEN) return false;
                try {
                  socket.send(JSON.stringify(p));
                  return true;
                } catch {
                  return false;
                }
              },
              fechar: (motivo) => socket.close(4000, motivo.slice(0, 100)),
            };

            dispositivo = registro;
            lista.push(registro);
            this.porOperador.set(operador.id_usuario, lista);

            registro.enviar({ tipo: 'bem_vindo', id_dispositivo: id });
            console.log(
              `[iara] braço conectado: ${pacote.nome} (${pacote.plataforma}, ${pacote.versao}) ` +
                `para ${operador.id_usuario} — ${id}`,
            );
          } catch (erro) {
            console.warn(`[iara] falha ao registrar braço: ${(erro as Error).message}`);
            recusar('Não foi possível registrar este computador.');
          } finally {
            abrindo = false;
          }
        })();
        return;
      }

      // Nada mais é aceito antes de a identidade estar resolvida.
      if (!dispositivo) return;
      /**
       * `visto_em` é atualizado por QUALQUER pacote, e não só por um ping
       * dedicado: um braço que está reportando execução está evidentemente vivo,
       * e exigir a batida separada faria um dispositivo ocupado parecer morto.
       */
      (dispositivo as { visto_em: number }).visto_em = Date.now();
      for (const ouvinte of this.ouvintes) ouvinte(dispositivo, pacote);
    });

    socket.on('close', () => {
      if (!dispositivo) return;
      const lista = this.porOperador.get(dispositivo.id_usuario);
      if (!lista) return;
      const restante = lista.filter((d) => d !== dispositivo);
      if (restante.length > 0) this.porOperador.set(dispositivo.id_usuario, restante);
      else this.porOperador.delete(dispositivo.id_usuario);
      console.log(`[iara] braço desconectado: ${dispositivo.id_dispositivo} (${dispositivo.nome})`);
      /**
       * As execuções que este braço estava tocando NÃO são resolvidas aqui, e a
       * omissão é deliberada. Quem sabe o que fazer com elas é o Braço, que tem
       * o prazo de cada uma — e o desfecho certo para uma ordem cuja conexão
       * caiu no meio é `expirou` (não sei), nunca `falhou` (sei que não deu).
       * Uma execução pode ter acontecido inteira e morrido na hora de contar.
       */
      dispositivo = null;
    });

    socket.on('error', (erro: Error) => {
      console.warn(`[iara] socket de dispositivo: ${erro.message}`);
    });
  }

  /** Desmonta tudo no encerramento do processo. */
  encerrar(): void {
    for (const lista of this.porOperador.values()) {
      for (const d of lista) d.fechar('motor encerrando');
    }
    this.porOperador.clear();
    this.ouvintes.clear();
  }
}

/** Instância única do processo — a ponte é do motor, não da sessão. */
export const ponteDispositivos = new PonteDispositivos();
