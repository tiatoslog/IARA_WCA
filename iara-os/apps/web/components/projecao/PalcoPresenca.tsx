'use client';

/**
 * O palco: câmera, luz e enquadramento.
 *
 * Referência é chamada de vídeo, não vitrine de personagem. Isso decide tudo o
 * que está aqui — lente longa, luz suave de estúdio, fundo neutro, sem chão,
 * sem sombra dura, sem contraluz dramática. Nada de estética de jogo.
 *
 * O enquadramento é medido, não chutado. Exportador de Unreal entrega
 * centímetros, exportador de Blender entrega metros, e o mesmo `position` de
 * câmera enquadra o busto num caso e um pixel do ombro no outro. Aqui o modelo
 * é medido na montagem e normalizado para 1.7 unidade de altura — depois disso
 * a câmera é fixa e confiável.
 */

import { Suspense, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { Box3, Vector3, type Group } from 'three';

/** Altura normalizada do corpo, em unidades de cena. */
const ALTURA_ALVO = 1.7;

/**
 * Mede o conteúdo e o normaliza. Roda em `useLayoutEffect` para acontecer antes
 * do primeiro quadro pintado: sem isso o avatar aparece no tamanho errado por
 * um frame, que é exatamente o tipo de piscada que denuncia a montagem.
 */
function Normalizar({ children }: { children: ReactNode }) {
  const grupo = useRef<Group>(null);

  useLayoutEffect(() => {
    const alvo = grupo.current;
    if (!alvo) return;

    const caixa = new Box3().setFromObject(alvo);
    const tamanho = caixa.getSize(new Vector3());
    if (tamanho.y <= 0) return;

    const escala = ALTURA_ALVO / tamanho.y;
    alvo.scale.setScalar(escala);

    // Reposiciona para os pés ficarem em y=0 e o eixo do corpo em x=z=0.
    const centro = caixa.getCenter(new Vector3()).multiplyScalar(escala);
    alvo.position.set(-centro.x, -caixa.min.y * escala, -centro.z);
  }, []);

  return <group ref={grupo}>{children}</group>;
}

/**
 * Enquadra do peito para cima. Com o corpo normalizado em 1.7, a cabeça vive
 * por volta de 1.55 e o peito por volta de 1.30 — a câmera olha para o meio
 * desse trecho, com lente de 28° que é o que evita a distorção de grande
 * angular no rosto.
 */
function CameraBusto() {
  const camera = useThree((e) => e.camera);

  useLayoutEffect(() => {
    camera.position.set(0, 1.5, 1.05);
    camera.lookAt(0, 1.46, 0);
    camera.updateProjectionMatrix();
  }, [camera]);

  return null;
}

export function PalcoPresenca({ children }: { children: ReactNode }) {
  return (
    <Canvas
      className="palco-presenca"
      camera={{ fov: 28, near: 0.05, far: 40 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      // A cena é estática por construção: o que muda é o rosto. Ainda assim o
      // loop precisa ser contínuo, porque a boca é amostrada por tempo.
      frameloop="always"
    >
      <CameraBusto />

      {/* Luz de estúdio de três pontos, toda suave. Nenhuma delas reage a dado:
          iluminação é ambiente, e ambiente nunca informa. */}
      <hemisphereLight args={['#fdf6ea', '#3a3f4a', 0.9] as const} />
      <directionalLight position={[1.4, 2.2, 2.0]} intensity={1.35} color="#fff4e2" />
      <directionalLight position={[-1.8, 1.4, 1.2]} intensity={0.45} color="#cfe2ff" />
      <directionalLight position={[0, 1.6, -2.2]} intensity={0.6} color="#ffffff" />

      <Suspense fallback={null}>
        <Normalizar>{children}</Normalizar>
      </Suspense>
    </Canvas>
  );
}
