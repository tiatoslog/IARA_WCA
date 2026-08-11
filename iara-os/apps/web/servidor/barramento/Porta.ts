/**
 * Porta do barramento: o que acontece quando um socket conecta.
 *
 * Vive separado do `principal.ts` porque a decisão de quem é o operador é a
 * fronteira de segurança do sistema — merece um arquivo próprio, não um bloco
 * dentro do bootstrap do servidor.
 *
 * Cada operador ganha o próprio Kernel, o próprio barramento de eventos e o
 * próprio compilador. Não existe estrutura compartilhada entre sessões, e é
 * isso que torna o kernel particionável sem reescrita: o dia em que cada
 * sessão precisar de um processo, só o transporte muda.
 */

import type { WebSocket } from 'ws';
import { EstadoAtomico } from '../nucleo/EstadoAtomico';
import { MemoriaOperacional } from '../nucleo/MemoriaOperacional';
import { SessaoOperador } from './SessaoOperador';
import { PonteProjecao } from './PonteProjecao';
import { BarramentoEventos } from '../nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../nucleo/kernel/CompiladorSnapshot';
import { Kernel } from '../nucleo/kernel/Kernel';
import { CicloAutonomo } from '../nucleo/CicloAutonomo';
import { prepararOperacionais } from '../nucleo/kernel/habilidades/operacionais';
import { lerPacoteCliente } from '../../lib/protocolo';
import { outrosOperadores } from '../../lib/operadores';
import {
  autenticacaoAtiva,
  identidadeLocal,
  verificarToken,
  type OperadorAutenticado,
} from '../nucleo/Autenticacao';

const memoria = new MemoriaOperacional();

/**
 * Espelhos simultâneos por operador. O mesmo operador pode estar no app
 * desktop, numa aba do Chrome (a que escuta o "ei IARA") e no celular ao mesmo
 * tempo — cada tela é uma sessão de transporte, o kernel é um só. O teto
 * existe porque sessão zumbi de reconexão (o TCP antigo expira minutos depois)
 * ocupa vaga até o close chegar.
 */
const MAX_ESPELHOS = 4;

interface Residente {
  estado: EstadoAtomico;
  barramento: BarramentoEventos;
  compilador: CompiladorSnapshot | null;
  kernel: Kernel | null;
  ciclo: CicloAutonomo | null;
  /** Uma sessão por tela conectada, em ordem de chegada. */
  sessoes: Set<SessaoOperador>;
  ponte: PonteProjecao | null;
}

const residentes = new Map<string, Residente>();

function residenteDe(idUsuario: string): Residente {
  let r = residentes.get(idUsuario);
  if (!r) {
    r = {
      estado: new EstadoAtomico(),
      barramento: new BarramentoEventos(idUsuario),
      compilador: null,
      kernel: null,
      ciclo: null,
      sessoes: new Set(),
      ponte: null,
    };
    residentes.set(idUsuario, r);
  }
  return r;
}

export async function prepararMotor(): Promise<void> {
  await prepararOperacionais();
}

export function conectarOperador(socket: WebSocket): void {
  let residente: Residente | null = null;
  let operador: OperadorAutenticado | null = null;
  let abrindo = false;
  /** A sessão criada para ESTE socket. O close só desmonta o que é dele. */
  let minhaSessao: SessaoOperador | null = null;

  const recusar = (motivo: string) => {
    // seq 1, nunca 0: a guarda de ordem do cliente descarta `seq <= 0` e a
    // recusa de autenticação viraria um fechamento mudo, sem explicação.
    socket.send(JSON.stringify({ tipo: 'erro', seq: 1, instante: Date.now(), texto: motivo }));
    socket.close(4401, 'nao autenticado');
  };

  socket.on('message', (dado) => {
    const pacote = lerPacoteCliente(dado.toString());
    if (!pacote) return;

    if (pacote.tipo === 'ola') {
      if (operador || abrindo) return; // uma apresentação por conexão
      abrindo = true;

      void (async () => {
        try {
          /**
           * A FRONTEIRA. Com Supabase configurado, a identidade sai de um
           * token verificado pelo servidor. O `id_usuario` que o cliente
           * mandou é ignorado por completo — é decoração.
           */
          operador = autenticacaoAtiva()
            ? await verificarToken(pacote.token)
            : identidadeLocal(pacote.id_usuario, pacote.nome);

          if (!operador) {
            recusar('Sessão inválida ou expirada. Entre novamente.');
            return;
          }

          const r = residenteDe(operador.id_usuario);
          residente = r;

          /**
           * Teto de espelhos: recusa a tela NOVA, nunca derruba as
           * estabelecidas. A versão anterior derrubava a mais antiga — e como
           * cliente derrubado reconecta, quatro telas viravam um carrossel de
           * quedas perpétuo (cada uma era "a mais antiga" a cada poucos
           * segundos). Zumbis de reconexão não precisam desse sacrifício: o
           * heartbeat de 30 s do servidor os termina sozinho e a vaga volta.
           */
          if (r.sessoes.size >= MAX_ESPELHOS) {
            socket.send(
              JSON.stringify({
                tipo: 'erro',
                seq: 1,
                instante: Date.now(),
                texto: `Limite de ${MAX_ESPELHOS} telas simultâneas atingido. Feche uma tela e tente de novo.`,
              }),
            );
            socket.close(4000, 'limite de telas simultaneas');
            return;
          }

          /**
           * Espelho novo, não takeover: a tela nova ENTRA na sessão em vez de
           * derrubar a anterior. App desktop + navegador do mesmo operador
           * conviviam se derrubando em ciclo infinito — cada um via "recon-
           * ectando…" enquanto roubava a vez do outro.
           */
          const sessao = new SessaoOperador(socket);
          minhaSessao = sessao;
          r.sessoes.add(sessao);

          /**
           * A ficha entra JUNTO com a identidade, num único `definirOperador`.
           *
           * Em duas chamadas o primeiro snapshot sairia com a ficha vazia e o
           * segundo a corrigiria — e o formulário, que hidrata do snapshot,
           * abriria em branco por um instante antes de preencher. Pior: se o
           * operador fosse rápido no clique, digitaria em cima de um campo
           * prestes a ser sobrescrito. `lerPreferencias` nunca lança, então
           * não há risco de a ficha impedir a sessão de abrir.
           */
          await r.estado.definirOperador({
            id_usuario: operador.id_usuario,
            nome: operador.nome,
            visto_em: new Date().toISOString(),
            preferencias: await memoria.lerPreferencias(operador.id_usuario),
          });

          r.kernel ??= new Kernel({
            sessao: operador.id_usuario,
            idUsuario: operador.id_usuario,
            outrosOperadores: outrosOperadores(operador.id_usuario),
            estado: r.estado,
            memoria,
            barramento: r.barramento,
          });

          await r.estado.definirNuvemIndisponivel(!nuvemLigada());

          // Compilador, ponte e ciclo nascem com o PRIMEIRO espelho e morrem
          // com o último; espelhos seguintes só se penduram no que já existe.
          r.compilador ??= new CompiladorSnapshot(r.barramento, r.kernel.memoriaTrabalho);
          r.ponte ??= new PonteProjecao(r.barramento, r.compilador, r.estado, r.sessoes);

          if (!r.ciclo) {
            r.ciclo = new CicloAutonomo(operador.id_usuario, r.estado, memoria, () =>
              r.ponte?.hidratar(),
            );
            r.ciclo.iniciar();
          }

          r.ponte.hidratar();
          sessao.emitirLog(
            'info',
            autenticacaoAtiva()
              ? `Sessão autenticada para ${operador.nome}. Shard privado isolado; nenhum outro operador é visível deste contexto.`
              : `Sessão local para ${operador.nome}. Autenticação desligada — modo de desenvolvimento.`,
          );

          /**
           * Insight noturno é um MIMO, não um requisito de sessão.
           *
           * Estava dentro do try que chama `recusar()`: uma tabela ausente no
           * Supabase derrubava o socket com "não foi possível abrir a sessão",
           * e o operador via uma tela que nunca conectava. Ler memória não
           * pode impedir alguém de entrar no escritório.
           */
          try {
            const pendentes = await memoria.insightsPendentes(operador.id_usuario);
            for (const insight of pendentes.slice(0, 1)) {
              sessao.emitirLog(
                'info',
                `Insight do ciclo noturno: ${insight.titulo} — ${insight.detalhe}`,
              );
              await memoria.consumirInsight(operador.id_usuario, insight.id);
            }
          } catch (erro) {
            sessao.emitirLog(
              'alerta',
              `Memória persistente indisponível (${(erro as Error).message}). ` +
                'A sessão continua; o histórico não será gravado. ' +
                'Verifique se supabase/schema.sql foi aplicado.',
            );
          }
        } catch (erro) {
          console.warn(`[iara] falha ao abrir sessão: ${(erro as Error).message}`);
          recusar('Não foi possível abrir a sessão.');
        } finally {
          abrindo = false;
        }
      })();
      return;
    }

    // Nada além de `ola` é aceito antes da identidade estar resolvida.
    if (!operador || !residente?.kernel) return;

    if (pacote.tipo === 'interromper') {
      residente.kernel.cancelar('interrupção do operador');
      return;
    }

    if (pacote.tipo === 'preferencias') {
      /**
       * O shard de destino é `operador.id_usuario` — a identidade RESOLVIDA na
       * apresentação, verificada por token quando há Supabase. O pacote não
       * carrega id nenhum, e é por isso que não existe aqui a pergunta "de
       * quem é esta ficha": a resposta é a mesma de sempre, a sessão.
       */
      const r = residente;
      const dono = operador;
      void (async () => {
        try {
          const gravada = await memoria.gravarPreferencias(dono.id_usuario, pacote.preferencias);
          const atual = r.estado.instantaneo().operador;
          await r.estado.definirOperador({
            id_usuario: dono.id_usuario,
            nome: atual?.nome ?? dono.nome,
            visto_em: atual?.visto_em ?? new Date().toISOString(),
            preferencias: gravada,
          });
          // Reidrata TODOS os espelhos: a ficha mudou para o operador, não
          // para a aba que salvou. App desktop e navegador têm que concordar.
          r.ponte?.hidratar();
          minhaSessao?.emitirLog('info', 'Ficha do operador atualizada.');
        } catch (erro) {
          // Falha de escrita é dita em voz alta. Ficha que "salvou" e não
          // salvou faz o operador declarar a mesma coisa de novo na semana
          // seguinte, sem entender por quê.
          minhaSessao?.emitirErro(
            `Não foi possível salvar a ficha: ${(erro as Error).message}`,
          );
        }
      })();
      return;
    }

    if (pacote.tipo === 'mensagem') {
      // Comando humano tem prioridade absoluta sobre o ciclo autônomo.
      residente.ciclo?.parar();
      const kernel = residente.kernel;
      const r = residente;
      void kernel.processar(pacote.texto).finally(() => {
        /**
         * Religa APENAS o ciclo que ainda é o do residente. Se a última tela
         * fechou durante o turno, o close já fez `ciclo = null` — religar a
         * instância capturada criaria um timer de 15 s órfão, sem nenhuma
         * referência viva capaz de pará-lo, acumulando um por desconexão.
         */
        if (r.sessoes.size > 0) r.ciclo?.iniciar();
      });
    }
  });

  socket.on('close', () => {
    if (!residente || !minhaSessao) return;
    /**
     * PROPRIEDADE. O close só desmonta a sessão DESTE socket. Um close tardio
     * (TCP expirando minutos depois de a sessão já ter sido derrubada pelo
     * teto de espelhos) encontra a sessão fora do conjunto e morre calado.
     */
    if (!residente.sessoes.has(minhaSessao)) return;
    minhaSessao.fechar();
    residente.sessoes.delete(minhaSessao);

    // A última tela saiu: desmonta o transporte e para o trabalho em curso.
    // Com outra tela ainda aberta, o turno segue — fechar o navegador não pode
    // cancelar a resposta que o app desktop está esperando.
    if (residente.sessoes.size === 0) {
      residente.ponte?.encerrar();
      residente.ponte = null;
      residente.compilador?.encerrar();
      residente.compilador = null;
      residente.kernel?.cancelar('todas as telas encerradas');
      residente.ciclo?.parar();
      residente.ciclo = null;
    } else {
      // A tela que saiu podia ser a líder de voz. Reemitir promove a próxima
      // na hora — sem isto, a IARA ficaria muda até o próximo evento.
      residente.ponte?.hidratar();
    }
  });

  socket.on('error', (erro: Error) => {
    console.warn(`[iara] socket: ${erro.message}`);
  });
}

function nuvemLigada(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

export function encerrarResidentes(): void {
  for (const r of residentes.values()) {
    r.ciclo?.parar();
    r.kernel?.cancelar('desligamento');
    r.ponte?.encerrar();
    r.compilador?.encerrar();
    for (const sessao of r.sessoes) sessao.fechar();
    r.sessoes.clear();
    r.barramento.limpar();
  }
}
