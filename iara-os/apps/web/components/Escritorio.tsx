'use client';

/**
 * O escritório. Camada de projeção pura: recebe um snapshot e desenha.
 * Nenhuma decisão de estado acontece aqui.
 *
 * A pergunta ao adicionar qualquer elemento: "que objeto da sala é isto?" —
 * nunca "que componente de dashboard preciso?".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ALTURA_PAREDE,
  ANIMACOES,
  BASE_RACK,
  BICO_CAFETEIRA,
  CAMADA_MURAL,
  CAMINHADAS,
  CAMINHADA_MAX_MS,
  CAMINHADA_MIN_MS,
  CENA,
  JANELA,
  MOBILIA,
  PIXEL,
  PLANTA_AMBIENTE,
  QUADRO_METAS,
  RACK,
  RITMO_CAMINHADA_MS_POR_PX,
  SALA_ALTURA,
  SALA_LARGURA,
  baseDoSprite,
  direcaoDaCaminhada,
  postoDoEstagio,
  profundidade,
  type Sprite,
} from '../lib/cenario';
import { OBJETO_DA_CAPACIDADE, type CapacidadeAtiva, type IdObjeto } from '../lib/estado';
import type { SnapshotCognitivo } from '../lib/snapshot';
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

/**
 * A caminhada da IARA. O posto é decidido pelo estágio (fato do kernel); o
 * que este hook acrescenta é o TRAJETO: em vez de o avatar teleportar para o
 * posto novo, ele desliza até lá no ritmo de passos calmos, com a folha de
 * caminhada da direção certa. Sutileza é isso — mesma informação, sem salto.
 */
function useCaminhada(posto: { x: number; y: number }) {
  const [alvo, setAlvo] = useState(posto);
  const [caminhando, setCaminhando] = useState<{
    direcao: keyof typeof CAMINHADAS;
    duracao_ms: number;
  } | null>(null);
  const anterior = useRef(posto);

  useEffect(() => {
    const de = anterior.current;
    if (de.x === posto.x && de.y === posto.y) return;
    anterior.current = posto;

    const distancia = Math.hypot(posto.x - de.x, posto.y - de.y);
    const duracao_ms = Math.min(
      CAMINHADA_MAX_MS,
      Math.max(CAMINHADA_MIN_MS, distancia * RITMO_CAMINHADA_MS_POR_PX),
    );
    setCaminhando({ direcao: direcaoDaCaminhada(de, posto), duracao_ms });
    setAlvo(posto);

    const chegada = setTimeout(() => setCaminhando(null), duracao_ms);
    return () => clearTimeout(chegada);
  }, [posto.x, posto.y, posto]);

  return { alvo, caminhando };
}

export function Escritorio({ estado }: { estado: SnapshotCognitivo }) {
  const posto = postoDoEstagio(estado.estagio);
  const { alvo, caminhando } = useCaminhada(posto);
  // Durante o trajeto, a folha é a da direção do passo; parada, a do estágio.
  const animacao = caminhando ? CAMINHADAS[caminhando.direcao] : ANIMACOES[estado.estagio];
  const transicaoAvatar = caminhando
    ? `left ${caminhando.duracao_ms}ms linear, top ${caminhando.duracao_ms}ms linear`
    : undefined;

  const halos = useMemo(
    () =>
      (Object.entries(estado.luzes) as Array<[IdObjeto, number]>)
        .filter(([, valor]) => valor > 0.03)
        .map(([id, valor]) => ({ id, valor, foco: focoDoObjeto(id) }))
        .filter((h) => h.foco !== null),
    [estado.luzes],
  );

  /**
   * O objeto que pulsa mais rápido é o da capacidade mais intensa. Com o
   * espaço cognitivo sendo um vetor, "a capacidade ativa" virou "a de maior
   * peso" — e um turno que usa duas faculdades acende as duas, em vez de a
   * projeção ter que escolher uma e mentir.
   */
  const objetoAtivo = useMemo(() => {
    const entradas = Object.entries(estado.capacidades) as Array<[CapacidadeAtiva, number]>;
    const topo = entradas.reduce((a, b) => (b[1] > a[1] ? b : a), entradas[0]);
    return topo && topo[1] > 0.5 ? OBJETO_DA_CAPACIDADE[topo[0]] : null;
  }, [estado.capacidades]);

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

      {/* --- IARA: profundidade vem do posto, igual a qualquer móvel.
             A posição transiciona no ritmo da caminhada — o avatar e a sombra
             usam a MESMA duração, senão a sombra chega antes da dona. --- */}
      <div
        className={`avatar q${animacao.quadros}`}
        style={
          {
            left: p(alvo.x - animacao.largura / 2),
            top: p(alvo.y - animacao.altura),
            zIndex: profundidade(alvo.y),
            width: p(animacao.largura),
            height: p(animacao.altura),
            backgroundImage: `url(/escritorio/${animacao.arquivo})`,
            backgroundSize: `${p(animacao.largura * animacao.quadros)} ${p(animacao.altura)}`,
            animationDuration: `${animacao.duracao_ms}ms`,
            transition: transicaoAvatar,
            '--fim': p(-animacao.largura * animacao.quadros),
          } as React.CSSProperties
        }
      />

      {/* sombra de contato: dá peso ao avatar no piso */}
      <div
        style={{
          position: 'absolute',
          left: p(alvo.x - 11),
          top: p(alvo.y - 3),
          width: p(22),
          height: p(5),
          borderRadius: '50%',
          background: 'rgba(90, 72, 48, 0.22)',
          filter: 'blur(2px)',
          transition: caminhando
            ? `left ${caminhando.duracao_ms}ms linear, top ${caminhando.duracao_ms}ms linear`
            : 'left 1.4s cubic-bezier(0.4,0,0.2,1), top 1.4s cubic-bezier(0.4,0,0.2,1)',
          zIndex: profundidade(alvo.y) - 1,
        }}
      />
    </div>
  );
}
