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

interface Residente {
  estado: EstadoAtomico;
  barramento: BarramentoEventos;
  compilador: CompiladorSnapshot | null;
  kernel: Kernel | null;
  ciclo: CicloAutonomo | null;
  sessao: SessaoOperador | null;
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
      sessao: null,
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

          // Reconexão: derruba o transporte antigo, preserva estado e kernel.
          r.ponte?.encerrar();
          r.sessao?.fechar();
          r.compilador?.encerrar();
          r.ciclo?.parar();

          const sessao = new SessaoOperador(socket);
          r.sessao = sessao;

          await r.estado.definirOperador({
            id_usuario: operador.id_usuario,
            nome: operador.nome,
            visto_em: new Date().toISOString(),
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

          r.compilador = new CompiladorSnapshot(r.barramento, r.kernel.memoriaTrabalho);
          r.ponte = new PonteProjecao(r.barramento, r.compilador, r.estado, sessao);

          r.ciclo = new CicloAutonomo(operador.id_usuario, r.estado, memoria, () =>
            r.ponte?.hidratar(),
          );
          r.ciclo.iniciar();

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

    if (pacote.tipo === 'mensagem') {
      // Comando humano tem prioridade absoluta sobre o ciclo autônomo.
      residente.ciclo?.parar();
      const kernel = residente.kernel;
      const ciclo = residente.ciclo;
      void kernel.processar(pacote.texto).finally(() => ciclo?.iniciar());
    }
  });

  socket.on('close', () => {
    if (!residente) return;
    residente.ponte?.encerrar();
    residente.ponte = null;
    residente.compilador?.encerrar();
    residente.compilador = null;
    residente.sessao?.fechar();
    residente.sessao = null;
    residente.kernel?.cancelar('socket encerrado');
    residente.ciclo?.parar();
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
    r.sessao?.fechar();
    r.barramento.limpar();
  }
}
