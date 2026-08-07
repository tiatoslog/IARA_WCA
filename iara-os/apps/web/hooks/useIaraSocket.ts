'use client';

/**
 * Barramento do lado do cliente.
 *
 * O React aqui é camada de projeção burra: ele não decide nada sobre o estado
 * da IARA, só desenha o último snapshot válido. Três garantias:
 *
 *  1. GUARDA DE SEQUÊNCIA — pacote com `seq` menor ou igual ao último aplicado
 *     é descartado. Sem isso, a enxurrada da reconexão faz a UI piscar.
 *  2. RECONEXÃO com backoff. A hidratação chega antes de qualquer telemetria.
 *  3. LOGS EM BUFFER LIMITADO — o console técnico nunca vira vazamento de
 *     memória numa aba aberta o dia inteiro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { estadoInicial, type EstadoEscritorio } from '../lib/estado';
import type { NivelLog, PacoteServidor } from '../lib/protocolo';

export interface Fala {
  id: string;
  papel: 'operador' | 'iara';
  texto: string;
  concluida: boolean;
  destino?: string;
  latencia_ms?: number;
  cache_lido?: number;
}

export interface LinhaLog {
  id: number;
  nivel: NivelLog;
  texto: string;
  instante: number;
}

const MAX_LOGS = 120;

export function useIaraSocket(idUsuario: string, nome: string) {
  const [estado, setEstado] = useState<EstadoEscritorio>(estadoInicial);
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

  const aplicar = useCallback(
    (pacote: PacoteServidor) => {
      // Guarda de sequência: o passado nunca sobrescreve o presente.
      if (pacote.seq <= ultimoSeq.current && pacote.tipo !== 'hidratacao') return;
      ultimoSeq.current = pacote.seq;

      switch (pacote.tipo) {
        case 'hidratacao':
          ultimoSeq.current = pacote.seq;
          setEstado(pacote.estado);
          break;

        case 'transicao':
          setEstado((s) => ({
            ...s,
            seq: pacote.seq,
            estagio: pacote.estagio,
            capacidade: pacote.capacidade,
          }));
          break;

        case 'pulso':
          setEstado((s) => ({
            ...s,
            seq: pacote.seq,
            metricas: pacote.metricas,
            leitura: pacote.leitura,
          }));
          break;

        case 'fala_inicio':
          setFalas((antes) => [
            ...antes,
            { id: pacote.id_mensagem, papel: 'iara', texto: '', concluida: false },
          ]);
          break;

        case 'fala_delta':
          setFalas((antes) =>
            antes.map((f) =>
              f.id === pacote.id_mensagem ? { ...f, texto: f.texto + pacote.texto } : f,
            ),
          );
          break;

        case 'fala_fim':
          setFalas((antes) =>
            antes.map((f) =>
              f.id === pacote.id_mensagem
                ? {
                    ...f,
                    texto: pacote.texto || f.texto,
                    concluida: true,
                    destino: pacote.destino,
                    latencia_ms: pacote.latencia_ms,
                    cache_lido: pacote.cache_lido,
                  }
                : f,
            ),
          );
          break;

        case 'log':
          registrarLog(pacote.nivel, pacote.texto);
          break;

        case 'erro':
          registrarLog('alerta', pacote.texto);
          break;
      }
    },
    [registrarLog],
  );

  useEffect(() => {
    desmontado.current = false;
    let timerReconexao: ReturnType<typeof setTimeout> | null = null;

    const conectar = () => {
      if (desmontado.current) return;
      const url = process.env.NEXT_PUBLIC_IARA_WS ?? 'ws://localhost:8787';
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        agendarReconexao();
        return;
      }
      socketRef.current = socket;

      socket.onopen = () => {
        tentativas.current = 0;
        setConectado(true);
        // Reconexão: zera a guarda para aceitar a nova hidratação.
        ultimoSeq.current = 0;
        socket.send(JSON.stringify({ tipo: 'ola', id_usuario: idUsuario, nome }));
      };

      socket.onmessage = (evento) => {
        try {
          aplicar(JSON.parse(evento.data as string) as PacoteServidor);
        } catch {
          /* pacote malformado é ignorado, nunca derruba a UI */
        }
      };

      socket.onclose = () => {
        setConectado(false);
        agendarReconexao();
      };

      socket.onerror = () => socket.close();
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
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [idUsuario, nome, aplicar]);

  const enviar = useCallback((texto: string) => {
    const limpo = texto.trim();
    const socket = socketRef.current;
    if (!limpo || !socket || socket.readyState !== WebSocket.OPEN) return false;
    setFalas((antes) => [
      ...antes,
      { id: `op-${Date.now()}`, papel: 'operador', texto: limpo, concluida: true },
    ]);
    socket.send(JSON.stringify({ tipo: 'mensagem', texto: limpo }));
    return true;
  }, []);

  const interromper = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ tipo: 'interromper' }));
    }
  }, []);

  return { estado, falas, logs, conectado, enviar, interromper };
}
