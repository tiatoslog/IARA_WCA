/**
 * Motor cognitivo da IARA — processo do servidor.
 *
 * Sobe um WebSocket puro (sem HTTP de aplicação) na porta IARA_PORTA. O Next
 * roda separado, na 3000. Dois processos, um comando: `npm run dev`.
 *
 * Estado por operador é mantido AQUI, fora da conexão. Uma queda de rede
 * derruba a `SessaoOperador`, nunca o `EstadoAtomico` — é isso que faz a
 * reconexão hidratar em vez de reiniciar.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import { config as carregarEnv } from 'dotenv';
import { EstadoAtomico } from './nucleo/EstadoAtomico';
import { MemoriaOperacional } from './nucleo/MemoriaOperacional';
import { RagHistorico } from './nucleo/RagHistorico';
import { ClienteClaude } from './nucleo/ClienteClaude';
import { MotorCognitivo } from './nucleo/MotorCognitivo';
import { CicloAutonomo } from './nucleo/CicloAutonomo';
import { SessaoOperador } from './barramento/SessaoOperador';
import { lerPacoteCliente } from '../lib/protocolo';

carregarEnv({ path: '.env.local' });
carregarEnv();

const PORTA = Number(process.env.IARA_PORTA ?? 8787);

const memoria = new MemoriaOperacional();
const rag = new RagHistorico();
const claude = new ClienteClaude();

interface Residente {
  estado: EstadoAtomico;
  ciclo: CicloAutonomo | null;
  motor: MotorCognitivo | null;
  sessao: SessaoOperador | null;
}

/** Estado vive por operador, não por socket. */
const residentes = new Map<string, Residente>();

function residenteDe(idUsuario: string): Residente {
  let r = residentes.get(idUsuario);
  if (!r) {
    r = { estado: new EstadoAtomico(), ciclo: null, motor: null, sessao: null };
    residentes.set(idUsuario, r);
  }
  return r;
}

const servidor = new WebSocketServer({ port: PORTA });

servidor.on('listening', () => {
  console.log(`[iara] motor cognitivo escutando em ws://localhost:${PORTA}`);
  console.log(
    claude.disponivel
      ? '[iara] camada de nuvem: ATIVA'
      : '[iara] camada de nuvem: DESLIGADA (defina ANTHROPIC_API_KEY em .env.local). ' +
          'Rotas locais seguem 100% funcionais.',
  );
  void rag.carregar().then(
    () => console.log('[iara] índice histórico carregado'),
    (e: Error) => console.warn(`[iara] índice histórico indisponível: ${e.message}`),
  );
});

servidor.on('connection', (socket: WebSocket) => {
  let residente: Residente | null = null;
  let idUsuario = '';

  socket.on('message', (dado) => {
    const pacote = lerPacoteCliente(dado.toString());
    if (!pacote) return;

    // ---- apresentação: abre (ou reabre) a sessão ----
    if (pacote.tipo === 'ola') {
      idUsuario = pacote.id_usuario;
      residente = residenteDe(idUsuario);

      // Reconexão: derruba a sessão antiga, preserva o estado.
      residente.sessao?.fechar();
      residente.ciclo?.parar();

      const sessao = new SessaoOperador(socket, residente.estado);
      residente.sessao = sessao;

      void (async () => {
        const r = residente!;
        await r.estado.definirOperador({
          id_usuario: idUsuario,
          nome: pacote.nome,
          visto_em: new Date().toISOString(),
        });
        await r.estado.definirNuvemIndisponivel(!claude.disponivel);

        r.motor = new MotorCognitivo(idUsuario, {
          estado: r.estado,
          memoria,
          rag,
          claude,
          emitir: sessao.emitir,
        });
        r.ciclo = new CicloAutonomo(idUsuario, r.estado, memoria, sessao.emitir);
        r.ciclo.iniciar();

        sessao.hidratar();
        sessao.emitir({
          tipo: 'log',
          nivel: 'info',
          texto: `Sessão aberta para ${pacote.nome}. Shard privado isolado; nenhum outro operador é visível deste contexto.`,
        });

        // Postura proativa: insight consolidado na madrugada abre o dia.
        const pendentes = await memoria.insightsPendentes(idUsuario);
        for (const insight of pendentes.slice(0, 1)) {
          sessao.emitir({
            tipo: 'log',
            nivel: 'info',
            texto: `Insight do ciclo noturno: ${insight.titulo} — ${insight.detalhe}`,
          });
          await memoria.consumirInsight(idUsuario, insight.id);
        }
      })();
      return;
    }

    if (!residente?.motor) return;

    if (pacote.tipo === 'interromper') {
      residente.motor.cancelar('interrupção do operador');
      void residente.motor.transicionar('ocioso', null, 'interrompido');
      return;
    }

    if (pacote.tipo === 'mensagem') {
      // Pausa o ciclo autônomo: comando humano tem prioridade absoluta.
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
    console.log(`[iara] operador ${idUsuario || '?'} desconectou; estado preservado`);
  });

  socket.on('error', (erro: Error) => {
    console.warn(`[iara] socket: ${erro.message}`);
  });
});

function encerrar(): void {
  console.log('\n[iara] encerrando motor...');
  for (const r of residentes.values()) {
    r.ciclo?.parar();
    r.motor?.cancelar('desligamento');
    r.sessao?.fechar();
  }
  servidor.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1500).unref();
}

process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);

