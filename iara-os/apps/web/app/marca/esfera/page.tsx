'use client';

/**
 * A FORJA DA ESFERA — de onde sai a imagem da bolha do desktop.
 *
 * A bolha do Tauri é uma janela minúscula sempre visível. Um contexto WebGL
 * permanente ali custaria GPU o dia inteiro por estética, então ela mostra uma
 * IMAGEM ASSADA — a mesma decisão que já valia quando a bolha usava o rosto
 * cromado (ver `apps/desktop/ui/bolha.html`).
 *
 * O que muda é a origem da imagem. O rosto vem de fotografia recortada
 * (`scripts/gerar-marca.ts`); a esfera não existe como fotografia — ela existe
 * como CÓDIGO. Então esta página renderiza a entidade com exatamente os mesmos
 * materiais, o mesmo estúdio e a mesma lente do palco, e o PNG sai daqui.
 *
 * A consequência é a que importa: o ícone não "lembra" a IARA, ele É a IARA.
 * Se o material da pedra mudar, roda-se esta forja de novo e a bolha acompanha
 * — nenhum desenho paralelo para manter em dia.
 *
 * O QUE NÃO ENTRA, e por quê:
 *  · a aurora — num disco de 48 px ela vira sujeira em volta da silhueta;
 *  · o movimento — a bolha é um ponto de acesso, não um indicador de estado.
 *    Ela não pode inventar estado (invariante do repositório), e uma imagem
 *    parada não inventa nada.
 *
 * `preserveDrawingBuffer` é a razão de esta página existir em vez de um
 * print de tela: sem ele o canvas devolve preto para `toDataURL`, e com ele o
 * PNG sai exato, sem compressão de captura e sem a barra do navegador.
 *
 * Uso: abrir /marca/esfera, clicar em Baixar, salvar como
 *      `public/marca/iara-esfera.png` e rodar `npm run icones`.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Color,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  Vector2,
  type BufferGeometry,
  type PerspectiveCamera,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  AmbienteEstudio,
  Composicao,
  criarMaterialNucleo,
  criarMaterialPedra,
  type UniformesEntidade,
} from '../../../components/projecao/EntidadePresenca';
import { criarFundo, criarRigInterno } from '../../../components/projecao/estudio';

/** Lado do PNG. 640 dá folga de sobra para a bolha de 48 px em tela HiDPI. */
const LADO = 640;

/**
 * Enquadramento apertado, e é a única diferença de direção em relação ao palco.
 *
 * No palco a peça ocupa um quarto da altura, porque lá o que se vende é o campo
 * negativo em volta. Num ícone circular de 48 px campo negativo é desperdício:
 * a silhueta é tudo o que sobrevive à redução.
 *
 * A conta tem uma sutileza que custou duas tentativas. A meia-altura visível
 * no plano da peça é `DISTANCIA * tan(ABERTURA/2)`, e a pergunta é o que
 * precisa caber ali:
 *
 *  · o raio MÁXIMO da silhueta é 1,41, mas só alguns lóbulos chegam lá. Enquadrar
 *    por ele (distância 7,8) deixa a peça ocupando ~0,65 da largura, e o resto
 *    é margem preta. Num disco de 48 px essa margem vira a maior parte do
 *    ícone: o que se vê é um ponto claro dentro de uma bolinha preta;
 *  · o raio MÉDIO é ~1,0, e é ele que define a MASSA que o olho lê. Enquadrando
 *    por ele — 1,0 / 0,80 = 1,25 de meia-altura, 1,25 / tan(12°) = 5,9 — a
 *    silhueta preenche o disco e os poucos lóbulos que passam de 1,25 são
 *    cortados pelo recorte redondo. Cortar lóbulo é o comportamento certo aqui:
 *    ícone é silhueta, e silhueta que não toca a borda parece encolhida.
 *
 * (Foi tentado 3,05 antes de tudo, que enquadra 0,65 — menos da metade do raio.
 * O resultado é um close na superfície, não um ícone.)
 */
const ABERTURA = 24;
const DISTANCIA = 5.9;

/**
 * O instante congelado. A entidade é ambiente vivo no palco; aqui ela para.
 *
 * O tempo não é zero: em t = 0 o campo de ruído cai num ponto particular e a
 * silhueta sai simétrica demais. 7,3 é só um instante qualquer com a pedra bem
 * virada — e é fixo, para a forja ser REPETÍVEL. Assar duas vezes tem de dar o
 * mesmo arquivo, senão o ícone muda sozinho a cada regeneração.
 */
const INSTANTE = 7.3;

function CenaEsfera() {
  const uniformes = useMemo<UniformesEntidade>(
    () => ({
      uT: { value: INSTANTE },
      uAmp: { value: 0.15 },
      uVel: { value: 0.25 },
      uEnv: { value: 0.35 },
      uRaio: { value: 1 },
      uBrilho: { value: 0.62 },
      uInterno: { value: 0.42 },
      // A faixa de `disponivel` em mapaAurora: a esfera em repouso.
      uMatiz: { value: new Vector2(0.04, 0.18) },
      uAlerta: { value: 0 },
    }),
    [],
  );

  const uDeform = useMemo(() => ({ value: 0.19 }), []);
  const uMorph = useMemo(() => ({ value: INSTANTE * 0.28 }), []);
  const uMatrizNormal = useMemo(() => ({ value: new Matrix3() }), []);
  const modeloVista = useMemo(() => new Matrix4(), []);

  const { geo, mat, geoNucleo, matNucleo } = useMemo(
    () => ({
      geo: mergeVertices(new IcosahedronGeometry(1, 48)) as BufferGeometry,
      mat: criarMaterialPedra(uDeform, uMorph, uMatrizNormal),
      geoNucleo: new IcosahedronGeometry(0.34, 5),
      matNucleo: criarMaterialNucleo(uniformes),
    }),
    [uDeform, uMorph, uMatrizNormal, uniformes],
  );

  const rig = useMemo(() => criarRigInterno(), []);
  const fundo = useMemo(() => criarFundo(), []);
  const pedra = useRef<Mesh>(null);

  useEffect(() => {
    mat.attenuationColor.copy(new Color(0xbcd2e2));
    rig.animar(INSTANTE);
  }, [mat, rig]);

  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      geoNucleo.dispose();
      matNucleo.dispose();
      rig.descartar();
      fundo.descartar();
    },
    [geo, mat, geoNucleo, matNucleo, rig, fundo],
  );

  /* A matriz do microrrelevo precisa valer também no passe de transmissão, que
     desenha a cena uma segunda vez com outra câmera — por isso ela é preenchida
     no gancho de desenho, e não uma vez só. */
  useEffect(() => {
    const m = pedra.current;
    if (!m) return;
    m.onBeforeRender = (_gl, _cena, camera) => {
      modeloVista.multiplyMatrices(camera.matrixWorldInverse, m.matrixWorld);
      uMatrizNormal.value.getNormalMatrix(modeloVista);
    };
    return () => {
      m.onBeforeRender = () => {};
    };
  }, [modeloVista, uMatrizNormal]);

  // Pose fixa, derivada do mesmo instante — nada anima, mas o quadro precisa
  // ser desenhado mais de uma vez: PMREM e o passe de transmissão só ficam
  // corretos depois que o ambiente existe.
  useFrame(({ camera }) => {
    if (pedra.current) {
      pedra.current.rotation.set(0.05, INSTANTE * 0.06, 0.04);
    }
    camera.position.set(0, 0.12, DISTANCIA);
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <directionalLight position={[-2.2, 3.0, 2.4]} intensity={0.85} color="#f5f9fd" />
      <directionalLight position={[2.4, -0.6, -2.2]} intensity={0.3} color="#a8cfff" />
      <primitive object={fundo.malha} />
      <primitive object={rig.grupo} />
      <mesh ref={pedra} geometry={geo} material={mat} />
      <mesh geometry={geoNucleo} material={matNucleo} renderOrder={-4} />
    </>
  );
}

function CameraForja() {
  const camera = useThree((e) => e.camera);
  useEffect(() => {
    camera.position.set(0, 0.12, DISTANCIA);
    camera.lookAt(0, 0, 0);
    (camera as PerspectiveCamera).updateProjectionMatrix();
  }, [camera]);
  return null;
}

export default function Forja() {
  const baixar = () => {
    const canvas = document.querySelector('canvas');
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = 'iara-esfera.png';
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  return (
    <main
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 18,
        background: '#0b0d0f',
        color: '#eef1f4',
        fontFamily: 'var(--fonte)',
      }}
    >
      <div style={{ width: LADO, height: LADO }}>
        <Canvas
          camera={{ fov: ABERTURA, near: 0.1, far: 60 }}
          dpr={1}
          /* `preserveDrawingBuffer` é o motivo desta página: sem ele o canvas
             devolve preto para toDataURL. `antialias` não vale nada aqui —
             nada é desenhado direto na tela, tudo passa pelo composer. */
          gl={{ antialias: false, alpha: false, preserveDrawingBuffer: true }}
        >
          <CameraForja />
          <AmbienteEstudio />
          <CenaEsfera />
          <Composicao />
        </Canvas>
      </div>

      <button
        onClick={baixar}
        style={{
          fontFamily: 'inherit',
          fontSize: 'var(--t-ui)',
          fontWeight: 600,
          letterSpacing: 'var(--tr-ui)',
          color: '#14171a',
          background: 'linear-gradient(180deg, #ffffff 0%, #d5dade 46%, #a9b0b6 54%, #e6eaed 100%)',
          border: 'none',
          borderRadius: 'var(--r-capsula)',
          padding: '10px 20px',
          cursor: 'pointer',
        }}
      >
        Baixar PNG
      </button>

      <p style={{ fontSize: 'var(--t-rotulo)', color: '#8b959d', maxWidth: 420, textAlign: 'center' }}>
        Salve como <code>public/marca/iara-esfera.png</code> e rode{' '}
        <code>npm run icones</code>. A bolha do desktop lê este arquivo.
      </p>
    </main>
  );
}
