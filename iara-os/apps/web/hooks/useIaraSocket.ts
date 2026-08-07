'use client';

/**
 * Barramento do lado do cliente.
 *
 * O React aqui é camada de projeção burra: ele não decide nada sobre o estado
 * da IARA, só desenha o último snapshot válido. Não existe redutor, não existe
 * remontagem de estado a partir de fragmentos — o servidor já mandou pronto.
 *
 * Três garantias:
 *
 *  1. GUARDA DE SEQUÊNCIA — pacote com `seq` menor ou igual ao último aplicado
 *     é descartado. Sem isso, a enxurrada da reconexão faz a UI piscar.
 *  2. RECONEXÃO com backoff e guarda de identidade por socket.
 *  3. BUFFERS LIMITADOS — nem falas nem logs crescem sem teto numa aba aberta
 *     o dia inteiro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { NivelLog, PacoteServidor } from '../lib/protocolo';
import { ESPACO_VAZIO, EXPRESSAO_NEUTRA, TELEMETRIA_ZERO, type SnapshotCognitivo } from '../lib/snapshot';
import { LEITURA_INICIAL, LUZES_APAGADAS, METRICAS_INICIAIS } from '../lib/estado';
import { enderecoBarramento } from '../lib/supabaseNavegador';

export interface Fala {
  id: string;
  papel: 'operador' | 'iara';
  texto: string;
  concluida: boolean;
  destino?: string;
  latencia_ms?: number;
  cache_lido?: number;
  tokens_entrada?: number;
  tokens_saida?: number;
  /** Caminho do áudio desta fala, quando a voz já foi sintetizada. */
  voz?: string | null;
  /**
   * `performance.now()` do instante em que o turno abriu. É o relógio que a
   * boca da projeção 3D usa para articular — precisa ser monotônico, então
   * `Date.now()` não serve: ajuste de horário do sistema faria o visema saltar.
   */
  iniciada_em: number;
}

export interface LinhaLog {
  id: number;
  nivel: NivelLog;
  texto: string;
  instante: number;
}

export interface Credencial {
  id_usuario: string;
  nome: string;
  /** Access token do Supabase. Quando presente, é ele que define a identidade. */
  token?: string;
}

const MAX_LOGS = 120;
const MAX_FALAS = 60;

export const SNAPSHOT_INICIAL: SnapshotCognitivo = {
  sessao: '',
  seq: 0,
  instante: 0,
  traco: '',
  operador: null,
  estagio: 'ocioso',
  objetivo: null,
  plano: null,
  capacidades: { ...ESPACO_VAZIO },
  metricas: { ...METRICAS_INICIAIS },
  leitura: { ...LEITURA_INICIAL },
  expressao: EXPRESSAO_NEUTRA,
  telemetria: TELEMETRIA_ZERO,
  luzes: { ...LUZES_APAGADAS },
  nuvem_indisponivel: false,
  fala: null,
};

export function useIaraSocket(credencial: Credencial) {
  const { id_usuario: idUsuario, nome, token } = credencial;

  const [snapshot, setSnapshot] = useState<SnapshotCognitivo>(SNAPSHOT_INICIAL);
  const [falas, setFalas] = useState<Fala[]>([]);
  const [logs, setLogs] = useState<LinhaLog[]>([]);
  const [conectado, setConectado] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const ultimoSeq = useRef(0);
  const contadorLog = useRef(0);
  const tentativas = useRef(0);
  const desmontado = useRef(false);

  const registrarLog = useCallback((nivel: NivelLog, texto: string) => {
    contadorLog.current += 1;
    const linha: LinhaLog = { id: contadorLog.current, nivel, texto, instante: Date.now() };
    setLogs((antes) => {
      const proximo = [...antes, linha];
      return proximo.length > MAX_LOGS ? proximo.slice(-MAX_LOGS) : proximo;
    });
  }, []);

  /**
   * A fala vem SUBSTITUÍDA a cada snapshot, nunca concatenada. Por isso um
   * pacote perdido não corrompe o texto: o próximo já traz o acumulado.
   */
  const absorverFala = useCallback((s: SnapshotCognitivo) => {
    if (!s.fala) return;
    const f = s.fala;
    setFalas((antes) => {
      const i = antes.findIndex((x) => x.id === f.id);
      const nova: Fala = {
        id: f.id,
        papel: 'iara',
        texto: f.texto,
        concluida: f.concluida,
        destino: f.destino ?? undefined,
        latencia_ms: f.latencia_ms ?? undefined,
        cache_lido: f.cache_lido,
        voz: f.voz,
        tokens_entrada: s.telemetria.tokens_entrada,
        tokens_saida: s.telemetria.tokens_saida,
        // Carimbado uma vez, na abertura do turno, e PRESERVADO nas
        // atualizações seguintes: se fosse recarimbado a cada snapshot, o
        // relógio da articulação reiniciaria a cada trecho e a boca gaguejaria.
        iniciada_em: i < 0 ? performance.now() : antes[i].iniciada_em,
      };
      if (i < 0) {
        const proximo = [...antes, nova];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      }
      // `voz` entra na comparação porque ela chega DEPOIS, num snapshot em que
      // texto e conclusão já não mudam mais. Sem isto, o áudio nunca chegaria
      // ao componente — o turno seria descartado como repetido.
      if (
        antes[i].texto === nova.texto &&
        antes[i].concluida === nova.concluida &&
        antes[i].voz === nova.voz
      ) {
        return antes;
      }
      const copia = [...antes];
      copia[i] = nova;
      return copia;
    });
  }, []);

  const aplicar = useCallback(
    (pacote: PacoteServidor) => {
      // Guarda de sequência: o passado nunca sobrescreve o presente.
      if (pacote.seq <= ultimoSeq.current) return;
      ultimoSeq.current = pacote.seq;

      if (pacote.tipo === 'snapshot') {
        setSnapshot(pacote.snapshot);
        absorverFala(pacote.snapshot);
        return;
      }
      if (pacote.tipo === 'log') {
        registrarLog(pacote.nivel, pacote.texto);
        return;
      }
      registrarLog('alerta', pacote.texto);
    },
    [registrarLog, absorverFala],
  );

  useEffect(() => {
    desmontado.current = false;
    let timerReconexao: ReturnType<typeof setTimeout> | null = null;

    const conectar = () => {
      if (desmontado.current) return;
      const url = enderecoBarramento();
      if (!url) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        agendarReconexao();
        return;
      }
      socketRef.current = socket;

      /**
       * Guarda de identidade. Sem ela, o `onclose` de um socket já substituído
       * agenda uma reconexão que sobrescreve `socketRef`, enquanto outro socket
       * que abriu marca `conectado = true`. O resultado é o pior tipo de bug:
       * a UI diz "conectado" e o envio falha em silêncio.
       */
      const atual = () => socketRef.current === socket;

      socket.onopen = () => {
        if (!atual()) {
          socket.close();
          return;
        }
        tentativas.current = 0;
        setConectado(true);
        // Reconexão: zera a guarda para aceitar a nova hidratação.
        ultimoSeq.current = 0;
        socket.send(JSON.stringify({ tipo: 'ola', id_usuario: idUsuario, nome, token }));
      };

      socket.onmessage = (evento) => {
        if (!atual()) return;
        try {
          aplicar(JSON.parse(evento.data as string) as PacoteServidor);
        } catch {
          /* pacote malformado é ignorado, nunca derruba a UI */
        }
      };

      socket.onclose = () => {
        if (!atual()) return; // socket órfão: morre calado, não reagenda nada
        socketRef.current = null;
        setConectado(false);
        agendarReconexao();
      };

      socket.onerror = () => {
        if (atual()) socket.close();
      };
    };

    const agendarReconexao = () => {
      if (desmontado.current) return;
      tentativas.current += 1;
      const espera = Math.min(8000, 400 * 2 ** Math.min(tentativas.current, 5));
      timerReconexao = setTimeout(conectar, espera);
    };

    conectar();

    return () => {
      desmontado.current = true;
      if (timerReconexao) clearTimeout(timerReconexao);
      const socket = socketRef.current;
      // Solta a referência ANTES de fechar: o `onclose` que vem a seguir vê um
      // socket órfão e não reagenda reconexão.
      socketRef.current = null;
      socket?.close();
    };
  }, [idUsuario, nome, token, aplicar]);

  const enviar = useCallback(
    (texto: string) => {
      const limpo = texto.trim();
      const socket = socketRef.current;
      if (!limpo) return false;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Falha de envio nunca é silenciosa: some da caixa sem explicação é o
        // que faz o operador achar que a IARA travou.
        registrarLog('alerta', 'Mensagem não enviada: o barramento não está aberto. Reconectando…');
        setConectado(false);
        return false;
      }
      setFalas((antes) => {
        const proximo: Fala[] = [
          ...antes,
          {
            id: `op-${Date.now()}`,
            papel: 'operador',
            texto: limpo,
            concluida: true,
            iniciada_em: performance.now(),
          },
        ];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      });
      socket.send(JSON.stringify({ tipo: 'mensagem', texto: limpo }));
      return true;
    },
    [registrarLog],
  );

  const interromper = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ tipo: 'interromper' }));
    }
  }, []);

  return { snapshot, falas, logs, conectado, enviar, interromper };
}
