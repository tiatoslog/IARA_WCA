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
 * A IDENTIDADE nunca vem do cliente, e essa é a única regra inegociável deste
 * arquivo. Um braço apresenta um token; QUEM DECIDE de quem ele é continua
 * sendo este processo. O `id_usuario` do pacote é decoração enquanto houver
 * autenticação ligada.
 *
 * Há DUAS autoridades possíveis, e a segunda é nova:
 *
 *   · o access token do Supabase — a mesma credencial de uma aba de navegador.
 *     Continua valendo, e é o que `IARA_TOKEN` cola durante o desenvolvimento;
 *   · o TOKEN DE DISPOSITIVO (`iad_…`), emitido pelo pareamento e verificado
 *     contra um hash no banco. É o que uma máquina de operadora carrega.
 *
 * A segunda existe porque a primeira, sozinha, obrigava a operadora a digitar
 * a senha da conta num terminal — e porque um access token vive uma hora, o que
 * transformava "funcionou de manhã e às onze parou" em comportamento normal.
 * Ver `nucleo/Pareamento.ts` para o porquê de a credencial ser nativa da IARA
 * em vez de um refresh token do Supabase relaído.
 *
 * O que NÃO mudou: duas autoridades, uma resolução. As duas passam por aqui, e
 * nenhuma delas é escolhida pelo cliente — o prefixo do token só diz a QUEM
 * perguntar, nunca qual resposta aceitar.
 */

import type { WebSocket } from 'ws';
import {
  lerPacoteBraco,
  type DescricaoDispositivo,
  type MaquinaDoOperador,
  type PacoteBraco,
  type PacoteMotor,
} from '../../lib/execucao';
import {
  autenticacaoAtiva,
  identidadeLocal,
  verificarToken,
  type OperadorAutenticado,
} from '../nucleo/Autenticacao';
import { pareamento, PREFIXO_TOKEN, type RegistroPareamento } from '../nucleo/Pareamento';
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

/**
 * O que a ponte precisa saber sobre pareamento, e nada além disso.
 *
 * Um tipo estreito em vez de `RegistroPareamento` inteiro: a porta que executa
 * faz UMA pergunta ao pareamento — "de quem é este token?" — e não tem por que
 * enxergar `abrir`, `aprovar` ou `revogar`. É a mesma disciplina de
 * `PedidoIntegracao`, que não carrega o jornal: um contrato estreito é o que
 * impede a camada errada de ganhar autoridade por conveniência.
 */
export interface AutoridadeDeDispositivo {
  verificar(token: string | undefined): Promise<{
    id_usuario: string;
    nome: string;
    id_credencial: string;
  } | null>;
}

type OuvintePacote = (dispositivo: DispositivoConectado, pacote: PacoteBraco) => void;

/** Um braço entrou ou saiu da lista deste operador. Ver `aoMudarInventario`. */
type OuvinteInventario = (idUsuario: string) => void;

export class PonteDispositivos {
  /** id_usuario → dispositivos, em ordem de chegada. */
  private readonly porOperador = new Map<string, DispositivoConectado[]>();
  private readonly ouvintes = new Set<OuvintePacote>();
  private readonly ouvintesInventario = new Set<OuvinteInventario>();
  private readonly vazao = new LimiteVazao(APRESENTACOES_POR_MINUTO, 60_000);
  private contador = 0;

  /**
   * A autoridade das credenciais de dispositivo entra por construtor, com o
   * registro de produção como padrão. Não é um encaixe de teste: é a mesma
   * forma de `PortalEfeitos(registro)` e `RegistroOperacoes(raiz)`, e ela é o
   * que permite exercitar a porta que EXECUTA — credencial válida, credencial
   * revogada, token inventado — sem um projeto Supabase real do outro lado.
   */
  constructor(private readonly autoridade: AutoridadeDeDispositivo = pareamento) {}

  /**
   * Resolve a identidade de um braço a partir do que ele apresentou.
   *
   * É a fronteira de segurança desta porta, e ela merece ser lida sozinha, sem
   * o ruído do ciclo de vida do socket.
   */
  private async identificar(pacote: {
    token?: string;
    id_usuario: string;
    nome: string;
  }): Promise<{ operador: OperadorAutenticado; id_credencial: string | null } | null> {
    /**
     * O token de dispositivo é conferido PRIMEIRO, e só quando o prefixo bate.
     * Sem essa checagem barata, todo braço pareado pagaria uma ida ao Supabase
     * Auth para ouvir "este token não é meu" antes de chegar na tabela certa — e
     * a ida acontece a cada reconexão, ou seja, a cada oscilação de Wi-Fi.
     *
     * A consulta é feita A CADA apresentação, nunca cacheada. É o que faz o
     * "desconectar" da aba Dispositivos valer: revogada a linha, a próxima
     * reconexão do braço — que acontece em segundos — encontra a recusa.
     */
    if (pacote.token?.startsWith(PREFIXO_TOKEN)) {
      const dispositivo = await this.autoridade.verificar(pacote.token);
      if (!dispositivo) return null;
      return {
        operador: { id_usuario: dispositivo.id_usuario, nome: dispositivo.nome, email: '' },
        id_credencial: dispositivo.id_credencial,
      };
    }

    const operador = autenticacaoAtiva()
      ? await verificarToken(pacote.token)
      : identidadeLocal(pacote.id_usuario, pacote.nome);

    /**
     * `id_credencial: null` é a marca de um braço SEM credencial durável —
     * token colado à mão ou modo local. Ele conecta e funciona, mas não aparece
     * na aba Dispositivos como algo que se possa revogar, porque não há o que
     * revogar: quem o autorizou foi quem digitou a variável de ambiente.
     */
    return operador ? { operador, id_credencial: null } : null;
  }

  /** O Braço se inscreve aqui. A ponte não conhece o Braço — só publica. */
  aoPacote(ouvinte: OuvintePacote): () => void {
    this.ouvintes.add(ouvinte);
    return () => this.ouvintes.delete(ouvinte);
  }

  /**
   * Avisa quando a lista de braços de um operador muda.
   *
   * Existe por causa do CONTADOR no cabeçalho da conversa. Ele diz quantas mãos
   * atendem agora, e um número desses só pode existir se for verdade a cada
   * instante — o invariante da sala é que todo elemento visual nasce de fato
   * observado. Deixá-lo depender de a gaveta estar aberta produziria o pior
   * caso: a tela afirmando que há um computador atendendo dez minutos depois de
   * ele ter sido desligado.
   *
   * Empurrar em vez de deixar o cliente perguntar é barato porque o evento é
   * raro — um braço conecta quando a pessoa liga a máquina, e desconecta quando
   * ela desliga.
   */
  aoMudarInventario(ouvinte: OuvinteInventario): () => void {
    this.ouvintesInventario.add(ouvinte);
    return () => this.ouvintesInventario.delete(ouvinte);
  }

  private anunciarMudanca(idUsuario: string): void {
    for (const ouvinte of this.ouvintesInventario) {
      try {
        ouvinte(idUsuario);
      } catch (erro) {
        /* Um ouvinte que explode não pode derrubar o registro de um braço: a
           ponte é transporte, e o aviso é enfeite de tela ao lado dela. */
        console.warn(`[iara] ouvinte de inventário falhou: ${(erro as Error).message}`);
      }
    }
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
      id_credencial: d.id_credencial ?? null,
    }));
  }

  /**
   * Derruba os braços que usam uma credencial revogada.
   *
   * Chamado DEPOIS da revogação no banco, nunca antes: se a ordem se invertesse
   * e a escrita falhasse, a máquina reconectaria em segundos com a credencial
   * ainda válida e a operadora veria o botão "desconectar" não funcionar.
   *
   * Devolve quantos sockets caíram. Zero é normal — a máquina revogada pode
   * simplesmente estar desligada, e nesse caso a credencial já morreu no banco.
   */
  derrubarPorCredencial(idUsuario: string, idCredencial: string): number {
    const lista = this.porOperador.get(idUsuario) ?? [];
    const alvos = lista.filter((d) => d.id_credencial === idCredencial);
    for (const d of alvos) d.fechar('credencial revogada pelo operador');
    return alvos.length;
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
            const identidade = await this.identificar(pacote);

            if (!identidade) {
              recusar(
                'Este computador não está autorizado. Abra a IARA no celular, vá em ' +
                  'Dispositivos e autorize o código que aparece aqui.',
              );
              return;
            }
            const operador: OperadorAutenticado = identidade.operador;

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
              id_credencial: identidade.id_credencial,
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
            this.anunciarMudanca(operador.id_usuario);
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
      const dono = dispositivo.id_usuario;
      const lista = this.porOperador.get(dono);
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
      this.anunciarMudanca(dono);
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
    this.ouvintesInventario.clear();
  }
}

/** Instância única do processo — a ponte é do motor, não da sessão. */
export const ponteDispositivos = new PonteDispositivos();

/**
 * O INVENTÁRIO DE MÃOS de um operador: sockets vivos e credenciais gravadas,
 * fundidos numa lista só.
 *
 * A fusão acontece AQUI, no servidor, e não na tela. Decidir se um socket e uma
 * linha de tabela são "a mesma máquina" é conhecimento de domínio — a chave é a
 * credencial, não o nome, porque dois computadores podem se chamar `DESKTOP-PC`
 * e a mesma máquina troca de nome quando alguém renomeia o Windows. Deixar essa
 * regra no cliente produziria uma resposta por projeção, e a projeção nova
 * herdaria o bug em silêncio.
 *
 * Um braço conectado SEM credencial durável (token colado, modo local) aparece
 * na lista mesmo assim, marcado `pareada: false`. Escondê-lo seria pior que
 * mostrá-lo: ele tem as mãos, executa de verdade, e não estar na tela é
 * exatamente como um computador esquecido ligado vira um mistério.
 */
export async function inventarioDeMaquinas(
  idUsuario: string,
  ponte: Pick<PonteDispositivos, 'listar'> = ponteDispositivos,
  registro: Pick<RegistroPareamento, 'listar'> = pareamento,
): Promise<MaquinaDoOperador[]> {
  const conectados = ponte.listar(idUsuario);
  /* A tabela pode estar indisponível (sem banco, schema não aplicado, rede) e
     isso não pode apagar da tela os computadores que estão conectados AGORA —
     esses o processo conhece de primeira mão. */
  const pareados = await registro.listar(idUsuario).catch(() => []);

  const vivosPorCredencial = new Map<string, (typeof conectados)[number]>();
  for (const c of conectados) if (c.id_credencial) vivosPorCredencial.set(c.id_credencial, c);

  const maquinas: MaquinaDoOperador[] = pareados.map((p) => {
    const vivo = vivosPorCredencial.get(p.id_credencial);
    return {
      id: p.id_credencial,
      nome: vivo?.nome ?? p.nome,
      plataforma: vivo?.plataforma ?? p.plataforma,
      versao: vivo?.versao ?? null,
      conectada: Boolean(vivo),
      pareada: true,
      pareada_em: p.pareado_em,
      /* Conectado agora vale mais que a coluna do banco: `ultimo_uso_em` é
         carimbado na apresentação e ficaria parado o dia inteiro numa máquina
         que está trabalhando. */
      vista_em: vivo?.visto_em ?? p.ultimo_uso_em,
    };
  });

  const jaListadas = new Set(maquinas.map((m) => m.id));
  for (const c of conectados) {
    /**
     * Sobram dois casos, e os dois são reais: o braço sem credencial durável, e
     * o braço pareado cuja linha não veio (banco fora do ar, schema ainda não
     * aplicado). Nos dois, o socket é fato observado e entra na lista — só sem
     * a data de pareamento, que ninguém tem como afirmar aqui.
     */
    if (c.id_credencial && jaListadas.has(c.id_credencial)) continue;
    maquinas.push({
      id: c.id_credencial ?? c.id_dispositivo,
      nome: c.nome,
      plataforma: c.plataforma,
      versao: c.versao,
      conectada: true,
      pareada: false,
      pareada_em: null,
      vista_em: c.visto_em,
    });
  }

  // Conectadas primeiro; entre iguais, a que deu sinal mais recentemente.
  return maquinas.sort(
    (a, b) => Number(b.conectada) - Number(a.conectada) || (b.vista_em ?? 0) - (a.vista_em ?? 0),
  );
}
