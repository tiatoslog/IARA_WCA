/**
 * Porta do barramento: o que acontece quando um socket conecta.
 *
 * Vive separado do `principal.ts` porque a decisão de quem é o operador é a
 * fronteira de segurança do sistema — merece um arquivo próprio, não um bloco
 * dentro do bootstrap do servidor.
 *
 * O estado de cada operador vive AQUI, fora da conexão. Queda de rede derruba
 * a `SessaoOperador`, nunca o `EstadoAtomico`: é isso que faz a reconexão
 * hidratar em vez de reiniciar.
 */

import type { WebSocket } from 'ws';
import { EstadoAtomico } from '../nucleo/EstadoAtomico';
import { MemoriaOperacional } from '../nucleo/MemoriaOperacional';
import { RagHistorico } from '../nucleo/RagHistorico';
import { ClienteClaude } from '../nucleo/ClienteClaude';
import { MotorCognitivo } from '../nucleo/MotorCognitivo';
import { CicloAutonomo } from '../nucleo/CicloAutonomo';
import { SessaoOperador } from './SessaoOperador';
import { lerPacoteCliente } from '../../lib/protocolo';
import {
  autenticacaoAtiva,
  identidadeLocal,
  verificarToken,
  type OperadorAutenticado,
} from '../nucleo/Autenticacao';

const memoria = new MemoriaOperacional();
const rag = new RagHistorico();
const claude = new ClienteClaude();

interface Residente {
  estado: EstadoAtomico;
  ciclo: CicloAutonomo | null;
  motor: MotorCognitivo | null;
  sessao: SessaoOperador | null;
}

const residentes = new Map<string, Residente>();

function residenteDe(idUsuario: string): Residente {
  let r = residentes.get(idUsuario);
  if (!r) {
    r = { estado: new EstadoAtomico(), ciclo: null, motor: null, sessao: null };
    residentes.set(idUsuario, r);
  }
  return r;
}

export async function prepararMotor(): Promise<void> {
  await rag.carregar();
}

export function conectarOperador(socket: WebSocket): void {
  let residente: Residente | null = null;
  let operador: OperadorAutenticado | null = null;
  // Enquanto a apresentação não termina, mensagens ficam de fora. Sem isto,
  // uma corrida entre `ola` e `mensagem` deixaria o motor nulo.
  let abrindo = false;

  const recusar = (motivo: string) => {
    socket.send(JSON.stringify({ tipo: 'erro', seq: 0, instante: Date.now(), texto: motivo }));
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

          // Reconexão: derruba a sessão antiga, preserva o estado.
          r.sessao?.fechar();
          r.ciclo?.parar();

          const sessao = new SessaoOperador(socket, r.estado);
          r.sessao = sessao;

          await r.estado.definirOperador({
            id_usuario: operador.id_usuario,
            nome: operador.nome,
            visto_em: new Date().toISOString(),
          });
          await r.estado.definirNuvemIndisponivel(!claude.disponivel);

          r.motor = new MotorCognitivo(operador.id_usuario, {
            estado: r.estado,
            memoria,
            rag,
            claude,
            emitir: sessao.emitir,
          });
          r.ciclo = new CicloAutonomo(operador.id_usuario, r.estado, memoria, sessao.emitir);
          r.ciclo.iniciar();

          sessao.hidratar();
          sessao.emitir({
            tipo: 'log',
            nivel: 'info',
            texto: autenticacaoAtiva()
              ? `Sessão autenticada para ${operador.nome}. Shard privado isolado; nenhum outro operador é visível deste contexto.`
              : `Sessão local para ${operador.nome}. Autenticação desligada — modo de desenvolvimento.`,
          });

          const pendentes = await memoria.insightsPendentes(operador.id_usuario);
          for (const insight of pendentes.slice(0, 1)) {
            sessao.emitir({
              tipo: 'log',
              nivel: 'info',
              texto: `Insight do ciclo noturno: ${insight.titulo} — ${insight.detalhe}`,
            });
            await memoria.consumirInsight(operador.id_usuario, insight.id);
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
    if (!operador || !residente?.motor) return;

    if (pacote.tipo === 'interromper') {
      residente.motor.cancelar('interrupção do operador');
      void residente.motor.transicionar('ocioso', null, 'interrompido');
      return;
    }

    if (pacote.tipo === 'mensagem') {
      residente.ciclo?.parar();
      const motor = residente.motor;
      const ciclo = residente.ciclo;
      void motor.transicionar('escutando', null, 'mensagem recebida');
      void motor.processar(pacote.texto).finally(() => ciclo?.iniciar());
    }
  });

  socket.on('close', () => {
    if (!residente) return;
    residente.sessao?.fechar();
    residente.sessao = null;
    residente.motor?.cancelar('socket encerrado');
    residente.ciclo?.parar();
  });

  socket.on('error', (erro: Error) => {
    console.warn(`[iara] socket: ${erro.message}`);
  });
}

export function encerrarResidentes(): void {
  for (const r of residentes.values()) {
    r.ciclo?.parar();
    r.motor?.cancelar('desligamento');
    r.sessao?.fechar();
  }
}
