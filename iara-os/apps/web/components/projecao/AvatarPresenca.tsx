'use client';

/**
 * O driver de projeção fotorrealista.
 *
 * Ele NÃO altera o GLB: não cria morph target, não renomeia osso, não injeta
 * animação. Ele lê o rig que existe, casa com a tabela semântica e escreve
 * influências quadro a quadro. Um modelo novo entra sem que este arquivo mude.
 *
 * Todo o movimento acontece dentro de `useFrame`, escrevendo em buffers que já
 * estão na GPU. Nenhum `setState` participa da animação — o único `setState`
 * do arquivo dispara uma vez, no diagnóstico do rig, e depois nunca mais.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import type { Bone, Object3D, SkinnedMesh } from 'three';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import { ControladorFacial } from './ControladorFacial';
import { resolverAlvos, rigSuficiente, type AlvoMorph, type ParametroFacial } from './mapaFacial';

export const CAMINHO_MODELO = '/identidade_iara/source.glb';

/** Uma malha já preparada para receber escrita por índice. */
interface MalhaLigada {
  malha: SkinnedMesh;
  alvos: Partial<Record<ParametroFacial, AlvoMorph[]>>;
}

export interface DiagnosticoRig {
  malhas: number;
  morphs: number;
  parametros_resolvidos: number;
  suficiente: boolean;
  /** Nomes de osso de cabeça encontrados. Vazio = sem controle de pose. */
  osso_cabeca: string | null;
}

function ehMalhaComMorph(o: Object3D): o is SkinnedMesh {
  const m = o as SkinnedMesh;
  return Boolean(m.isSkinnedMesh || (m as unknown as { isMesh?: boolean }).isMesh) &&
    Boolean(m.morphTargetDictionary);
}

/** O osso da cabeça, sob os nomes que MetaHuman e Mixamo usam. */
function acharOssoCabeca(raiz: Object3D): Bone | null {
  let achado: Bone | null = null;
  raiz.traverse((o) => {
    if (achado) return;
    const nome = o.name.toLowerCase();
    if (nome === 'head' || nome.startsWith('head_') || nome === 'mixamorighead') {
      achado = o as Bone;
    }
  });
  return achado;
}

export function AvatarPresenca({
  snapshot,
  fala,
  voz,
  aoDiagnosticar,
}: {
  snapshot: SnapshotCognitivo;
  /** A fala corrente da IARA — o texto que a boca articula. */
  fala: Fala | null;
  /** Relógio do áudio, quando há voz. Tem precedência sobre a cadência de leitura. */
  voz: RelogioVoz | null;
  aoDiagnosticar?: (d: DiagnosticoRig) => void;
}) {
  const { scene } = useGLTF(CAMINHO_MODELO);
  const controlador = useMemo(() => new ControladorFacial(), []);

  /**
   * Snapshot e fala entram por ref, não por dependência do frame loop. Se o
   * loop fechasse sobre as props, cada trecho de resposta recriaria o callback
   * e o R3F teria de reinscrever — trabalho por quadro que não precisa existir.
   */
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const falaRef = useRef(fala);
  falaRef.current = fala;

  const { malhas, ossoCabeca, diagnostico } = useMemo(() => {
    const encontradas: MalhaLigada[] = [];
    let morphs = 0;

    scene.traverse((o) => {
      if (!ehMalhaComMorph(o)) return;
      const dicionario = o.morphTargetDictionary as Record<string, number>;
      morphs += Object.keys(dicionario).length;
      const alvos = resolverAlvos(dicionario);
      if (Object.keys(alvos).length > 0) encontradas.push({ malha: o, alvos });
    });

    const osso = acharOssoCabeca(scene);
    const unificado = encontradas.reduce<Partial<Record<ParametroFacial, AlvoMorph[]>>>(
      (acc, m) => Object.assign(acc, m.alvos),
      {},
    );

    return {
      malhas: encontradas,
      ossoCabeca: osso,
      diagnostico: {
        malhas: encontradas.length,
        morphs,
        parametros_resolvidos: Object.keys(unificado).length,
        suficiente: rigSuficiente(unificado),
        osso_cabeca: osso?.name ?? null,
      } satisfies DiagnosticoRig,
    };
  }, [scene]);

  useEffect(() => {
    aoDiagnosticar?.(diagnostico);
  }, [diagnostico, aoDiagnosticar]);

  /** Rotação de repouso do osso, para o aceno ser relativo e não absoluto. */
  const repouso = useMemo(
    () =>
      ossoCabeca
        ? { x: ossoCabeca.rotation.x, y: ossoCabeca.rotation.y, z: ossoCabeca.rotation.z }
        : null,
    [ossoCabeca],
  );

  useFrame((_, dt) => {
    const quadro = controlador.atualizar(
      snapshotRef.current,
      falaRef.current,
      voz,
      performance.now(),
      dt,
    );

    for (const { malha, alvos } of malhas) {
      const influencias = malha.morphTargetInfluences;
      if (!influencias) continue;
      for (const [parametro, lista] of Object.entries(alvos) as Array<
        [ParametroFacial, AlvoMorph[]]
      >) {
        const valor = quadro.face[parametro];
        for (const alvo of lista) influencias[alvo.indice] = valor;
      }
    }

    if (ossoCabeca && repouso) {
      // `giro` e `inclinacao` já chegam em radianos, convertidos dos graus do
      // contrato. O aceno é normalizado -1..1, então tem amplitude própria:
      // 0.1 rad ≈ 6°, que numa cabeça enquadrada de perto já é um aceno claro.
      ossoCabeca.rotation.y = repouso.y + quadro.cabeca.giro;
      ossoCabeca.rotation.z = repouso.z + quadro.cabeca.inclinacao;
      ossoCabeca.rotation.x = repouso.x + quadro.cabeca.aceno * 0.1;
    }
  });

  return <primitive object={scene} />;
}

useGLTF.preload(CAMINHO_MODELO);
