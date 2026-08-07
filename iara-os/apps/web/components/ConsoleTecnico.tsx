'use client';

/**
 * Console técnico.
 *
 * É aqui que os micro-eventos vivem. Eles NÃO viram animação na sala — se cada
 * traço de processamento acendesse uma luz, a tela viraria ruído e mentiria
 * sobre o que está acontecendo. Marco de estágio vai para a sala; detalhe vem
 * para cá.
 */

import { useEffect, useRef, useState } from 'react';
import type { LinhaLog } from '../hooks/useIaraSocket';

const COR: Record<LinhaLog['nivel'], string> = {
  traco: 'var(--tinta-fraca)',
  info: 'var(--tinta)',
  alerta: 'var(--luz-alerta)',
};

function hora(t: number): string {
  return new Date(t).toLocaleTimeString('pt-BR', { hour12: false });
}

export function ConsoleTecnico({ logs }: { logs: LinhaLog[] }) {
  const [aberto, setAberto] = useState(false);
  const fim = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (aberto) fim.current?.scrollIntoView({ block: 'end' });
  }, [logs, aberto]);

  const alertas = logs.filter((l) => l.nivel === 'alerta').length;

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        borderTop: '1px solid var(--linha)',
        background: 'rgba(251, 248, 242, 0.97)',
        backdropFilter: 'blur(6px)',
        zIndex: 20,
      }}
    >
      <button
        onClick={() => setAberto((v) => !v)}
        style={{
          all: 'unset',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '7px 16px',
          fontSize: 11.5,
          fontFamily: 'var(--mono)',
          color: 'var(--tinta-fraca)',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <span>{aberto ? '▾' : '▸'}</span>
        <span>console técnico</span>
        <span style={{ opacity: 0.65 }}>({logs.length})</span>
        {alertas > 0 && <span style={{ color: 'var(--luz-alerta)' }}>{alertas} alerta(s)</span>}
      </button>

      {aberto && (
        <div
          className="rolagem"
          style={{
            height: 190,
            padding: '4px 16px 12px',
            fontFamily: 'var(--mono)',
            fontSize: 11.5,
            lineHeight: 1.65,
          }}
        >
          {logs.length === 0 && <div style={{ color: 'var(--tinta-fraca)' }}>sem eventos</div>}
          {logs.map((l) => (
            <div key={l.id} style={{ color: COR[l.nivel], display: 'flex', gap: 10 }}>
              <span style={{ opacity: 0.5, flex: 'none' }}>{hora(l.instante)}</span>
              <span>{l.texto}</span>
            </div>
          ))}
          <div ref={fim} />
        </div>
      )}
    </div>
  );
}
