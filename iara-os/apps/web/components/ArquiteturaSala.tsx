'use client';

/**
 * Arquitetura desenhada à mão: parede, rodapé, piso, janela, rack e quadro de
 * metas. O pack de arte não traz nenhum destes, e são justamente os elementos
 * que dão escala e identidade à sala.
 *
 * Tudo no mesmo grid de pixels do pack (unidade de 16px, escala PIXEL).
 */

import {
  ALTURA_PAREDE,
  JANELA,
  PIXEL,
  QUADRO_METAS,
  RACK,
  SALA_ALTURA,
  SALA_LARGURA,
} from '../lib/cenario';
import type { MapaLuzes } from '../lib/estado';

const p = (n: number) => `${n * PIXEL}px`;

export function ArquiteturaSala({ luzes }: { luzes: MapaLuzes }) {
  const tabuas = [];
  for (let y = ALTURA_PAREDE; y < SALA_ALTURA; y += 16) {
    tabuas.push(y);
  }

  return (
    <>
      {/* parede */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: p(SALA_LARGURA),
          height: p(ALTURA_PAREDE),
          background: 'linear-gradient(180deg, var(--parede-alta) 0%, var(--parede) 100%)',
        }}
      />
      {/* rodapé */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: p(ALTURA_PAREDE - 4),
          width: p(SALA_LARGURA),
          height: p(4),
          background: 'var(--rodape)',
        }}
      />
      {/* piso */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: p(ALTURA_PAREDE),
          width: p(SALA_LARGURA),
          height: p(SALA_ALTURA - ALTURA_PAREDE),
          background: 'var(--piso)',
        }}
      />
      {tabuas.map((y, i) =>
        i % 2 === 1 ? (
          <div
            key={y}
            style={{
              position: 'absolute',
              left: 0,
              top: p(y),
              width: p(SALA_LARGURA),
              height: p(16),
              background: 'var(--piso-alt)',
            }}
          />
        ) : null,
      )}

      {/* --- janela: a luz do mundo externo entra por aqui --- */}
      <div
        style={{
          position: 'absolute',
          left: p(JANELA.x),
          top: p(JANELA.y),
          width: p(JANELA.largura),
          height: p(JANELA.altura),
          background: 'linear-gradient(180deg, #cfe8f7 0%, #eaf4fb 100%)',
          border: `${p(2)} solid #b7a68c`,
          boxShadow: `inset 0 0 0 ${p(1)} #ffffff`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: p(JANELA.x + JANELA.largura / 2 - 1),
          top: p(JANELA.y),
          width: p(2),
          height: p(JANELA.altura),
          background: '#b7a68c',
        }}
      />
      {/* feixe de luz no piso — ambiente puro, não reage a dado */}
      <div
        className="ambiente"
        style={{
          left: p(JANELA.x - 8),
          top: p(ALTURA_PAREDE),
          width: p(JANELA.largura + 24),
          height: p(52),
          background:
            'linear-gradient(180deg, rgba(255,246,214,0.55) 0%, rgba(255,246,214,0) 100%)',
          animation: 'respirar 18s ease-in-out infinite',
        }}
      />

      {/* --- quadro de metas --- */}
      <div
        style={{
          position: 'absolute',
          left: p(QUADRO_METAS.x),
          top: p(QUADRO_METAS.y),
          width: p(QUADRO_METAS.largura),
          height: p(QUADRO_METAS.altura),
          background: '#fbf6e9',
          border: `${p(2)} solid #a8927a`,
          padding: p(3),
          display: 'flex',
          flexDirection: 'column',
          gap: p(2),
          justifyContent: 'center',
        }}
      >
        {[0.9, 0.62, 0.4].map((largura, i) => (
          <div
            key={i}
            style={{
              height: p(2),
              width: `${largura * 100}%`,
              background: i === 0 ? 'var(--luz-alerta)' : '#c2b39c',
              opacity: 0.4 + luzes.quadro_metas,
            }}
          />
        ))}
      </div>

      {/* --- rack do servidor: o objeto mais honesto da sala --- */}
      <div
        style={{
          position: 'absolute',
          left: p(RACK.x),
          top: p(RACK.y),
          width: p(RACK.largura),
          height: p(RACK.altura),
          background: 'linear-gradient(180deg, #6e6a63 0%, #565149 100%)',
          border: `${p(1)} solid #46423b`,
          display: 'flex',
          flexDirection: 'column',
          gap: p(2),
          padding: p(3),
        }}
      >
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              background: '#403c36',
              display: 'flex',
              alignItems: 'center',
              paddingLeft: p(2),
              gap: p(2),
            }}
          >
            {/* Os LEDs aceleram com a carga real. Nunca abaixo de ~0,8s: */}
            {/* frenético quebra a identidade da sala. */}
            <span
              style={{
                width: p(2),
                height: p(2),
                borderRadius: '50%',
                background: 'var(--luz-verde)',
                animationName: 'led',
                animationDuration: `${(2.6 - luzes.rack * 1.6).toFixed(2)}s`,
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
                animationDelay: `${i * 0.18}s`,
              }}
            />
            <span
              style={{
                width: p(2),
                height: p(2),
                borderRadius: '50%',
                background: 'var(--luz-quente)',
                opacity: 0.2 + luzes.rack * 0.8,
              }}
            />
          </div>
        ))}
      </div>
    </>
  );
}
