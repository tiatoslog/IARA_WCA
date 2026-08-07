'use client';

/**
 * O escritório. Camada de projeção pura: recebe um snapshot e desenha.
 * Nenhuma decisão de estado acontece aqui.
 *
 * A pergunta ao adicionar qualquer elemento: "que objeto da sala é isto?" —
 * nunca "que componente de dashboard preciso?".
 */

import { useMemo } from 'react';
import {
  ALTURA_PAREDE,
  ANIMACOES,
  BASE_RACK,
  BICO_CAFETEIRA,
  CAMADA_MURAL,
  CENA,
  JANELA,
  MOBILIA,
  PIXEL,
  PLANTA_AMBIENTE,
  QUADRO_METAS,
  RACK,
  SALA_ALTURA,
  SALA_LARGURA,
  baseDoSprite,
  postoDoEstagio,
  profundidade,
  type Sprite,
} from '../lib/cenario';
import { OBJETO_DA_CAPACIDADE, type EstadoEscritorio, type IdObjeto } from '../lib/estado';
import { ArquiteturaSala } from './ArquiteturaSala';

const p = (n: number) => `${n * PIXEL}px`;

interface Foco {
  x: number;
  y: number;
  raio: number;
  /** O halo vive logo à frente do próprio objeto, nunca à frente da sala. */
  z: number;
}

/** Centro, raio e profundidade do halo de cada objeto, em pixels de arte. */
function focoDoObjeto(id: IdObjeto): Foco | null {
  const emMobilia = MOBILIA.find((s) => s.luz === id);
  if (emMobilia) {
    return {
      x: emMobilia.x + emMobilia.largura / 2,
      y: emMobilia.y + emMobilia.altura / 2,
      raio: Math.max(emMobilia.largura, emMobilia.altura) * 0.9,
      z: profundidade(baseDoSprite(emMobilia)) + 1,
    };
  }
  if (id === 'janela') {
    return {
      x: JANELA.x + JANELA.largura / 2,
      y: JANELA.y + JANELA.altura / 2,
      raio: 56,
      z: CAMADA_MURAL + 1,
    };
  }
  if (id === 'rack') {
    return {
      x: RACK.x + RACK.largura / 2,
      y: RACK.y + RACK.altura / 2,
      raio: 52,
      z: profundidade(BASE_RACK) + 1,
    };
  }
  if (id === 'quadro_metas') {
    return {
      x: QUADRO_METAS.x + QUADRO_METAS.largura / 2,
      y: QUADRO_METAS.y + QUADRO_METAS.altura / 2,
      raio: 34,
      z: CAMADA_MURAL + 1,
    };
  }
  return null;
}

const COR_DA_LUZ: Partial<Record<IdObjeto, string>> = {
  janela: 'var(--luz-fria)',
  rack: 'var(--luz-verde)',
  quadro_metas: 'var(--luz-alerta)',
};

function SpriteArte({ sprite }: { sprite: Sprite }) {
  return (
    <div
      className="sprite"
      style={{
        left: p(sprite.x),
        top: p(sprite.y),
        width: p(sprite.largura),
        height: p(sprite.altura),
        backgroundImage: `url(/escritorio/${sprite.arquivo})`,
        backgroundSize: `${p(sprite.largura)} ${p(sprite.altura)}`,
        zIndex: profundidade(baseDoSprite(sprite)),
      }}
    />
  );
}

export function Escritorio({ estado }: { estado: EstadoEscritorio }) {
  const animacao = ANIMACOES[estado.estagio];
  const posto = postoDoEstagio(estado.estagio);

  const halos = useMemo(
    () =>
      (Object.entries(estado.luzes) as Array<[IdObjeto, number]>)
        .filter(([, valor]) => valor > 0.03)
        .map(([id, valor]) => ({ id, valor, foco: focoDoObjeto(id) }))
        .filter((h) => h.foco !== null),
    [estado.luzes],
  );

  const objetoAtivo = estado.capacidade ? OBJETO_DA_CAPACIDADE[estado.capacidade] : null;

  return (
    <div
      className="palco"
      style={{ width: p(SALA_LARGURA), height: p(SALA_ALTURA) }}
      aria-label={`Escritório da IARA. Estágio: ${estado.estagio}.`}
    >
      <ArquiteturaSala luzes={estado.luzes} />

      {/* Ordem vem de `CENA`, já ordenada por base. Nunca reordenar aqui. */}
      {CENA.map((sprite, i) =>
        sprite === PLANTA_AMBIENTE ? null : (
          <SpriteArte key={`${sprite.arquivo}-${i}`} sprite={sprite} />
        ),
      )}

      {/* --- vapor da cafeteira: ambiente, nunca reage a dado --- */}
      {[0, 1, 2].map((i) => (
        <div
          key={`vapor-${i}`}
          className="ambiente"
          style={{
            left: p(BICO_CAFETEIRA.x + i * 4),
            top: p(BICO_CAFETEIRA.y),
            width: p(3),
            height: p(3),
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.8)',
            // Longhand em todas as propriedades: misturar `animation` com
            // `animationDelay` no mesmo objeto faz o React reclamar a cada
            // re-render e pode zerar o delay silenciosamente.
            animationName: 'vapor',
            animationDuration: `${8 + i}s`,
            animationTimingFunction: 'ease-in-out',
            animationIterationCount: 'infinite',
            animationDelay: `${i * 2.4}s`,
            zIndex: BICO_CAFETEIRA.z,
          }}
        />
      ))}

      {/* --- poeira no feixe da janela --- */}
      {[0, 1, 2, 3].map((i) => (
        <div
          key={`poeira-${i}`}
          className="ambiente"
          style={{
            left: p(JANELA.x + 4 + i * 13),
            top: p(ALTURA_PAREDE + 14 + (i % 2) * 14),
            width: p(1),
            height: p(1),
            borderRadius: '50%',
            background: 'rgba(255, 240, 200, 0.95)',
            animationName: 'poeira',
            animationDuration: `${17 + i * 3}s`,
            animationTimingFunction: 'linear',
            animationIterationCount: 'infinite',
            animationDelay: `${i * 4}s`,
            zIndex: profundidade(ALTURA_PAREDE + 20),
          }}
        />
      ))}

      {/* --- planta balançando: única fonte deste sprite, nunca duplicada --- */}
      <div
        className="ambiente"
        style={{
          left: p(PLANTA_AMBIENTE.x),
          top: p(PLANTA_AMBIENTE.y),
          width: p(PLANTA_AMBIENTE.largura),
          height: p(PLANTA_AMBIENTE.altura),
          transformOrigin: 'bottom center',
          animation: 'balancar 9s ease-in-out infinite',
          zIndex: profundidade(baseDoSprite(PLANTA_AMBIENTE)),
          backgroundImage: `url(/escritorio/${PLANTA_AMBIENTE.arquivo})`,
          backgroundSize: `${p(PLANTA_AMBIENTE.largura)} ${p(PLANTA_AMBIENTE.altura)}`,
        }}
      />

      {/* --- halos: consequência de estado, um por objeto aceso --- */}
      {halos.map(({ id, valor, foco }) => (
        <div
          key={id}
          className="halo"
          style={
            {
              left: p(foco!.x - foco!.raio),
              top: p(foco!.y - foco!.raio),
              width: p(foco!.raio * 2),
              height: p(foco!.raio * 2),
              background: `radial-gradient(circle, ${COR_DA_LUZ[id] ?? 'var(--luz-quente)'} 0%, transparent 68%)`,
              opacity: valor,
              '--intensidade': valor,
              animationDuration: id === objetoAtivo ? '2.2s' : '7s',
              zIndex: foco!.z,
            } as React.CSSProperties
          }
        />
      ))}

      {/* --- IARA: profundidade vem do posto, igual a qualquer móvel --- */}
      <div
        className={`avatar q${animacao.quadros}`}
        style={
          {
            left: p(posto.x - animacao.largura / 2),
            top: p(posto.y - animacao.altura),
            zIndex: profundidade(posto.y),
            width: p(animacao.largura),
            height: p(animacao.altura),
            backgroundImage: `url(/escritorio/${animacao.arquivo})`,
            backgroundSize: `${p(animacao.largura * animacao.quadros)} ${p(animacao.altura)}`,
            animationDuration: `${animacao.duracao_ms}ms`,
            '--fim': p(-animacao.largura * animacao.quadros),
          } as React.CSSProperties
        }
      />

      {/* sombra de contato: dá peso ao avatar no piso */}
      <div
        style={{
          position: 'absolute',
          left: p(posto.x - 11),
          top: p(posto.y - 3),
          width: p(22),
          height: p(5),
          borderRadius: '50%',
          background: 'rgba(90, 72, 48, 0.22)',
          filter: 'blur(2px)',
          transition: 'left 1.4s cubic-bezier(0.4,0,0.2,1), top 1.4s cubic-bezier(0.4,0,0.2,1)',
          zIndex: profundidade(posto.y) - 1,
        }}
      />
    </div>
  );
}
