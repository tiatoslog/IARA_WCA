'use client';

/**
 * A entidade — a nova presença da IARA (design aprovado em 10/08/2026).
 *
 * Não é um rosto. É uma pedra encantada: vidro dispersivo fisicamente correto
 * (transmissão, dispersão cromática, iridescência) com um núcleo luminoso — o
 * encante — visto ATRAVÉS do material, envolta por cortinas de aurora com
 * gradiente fluido preenchido, topos arredondados e ondas viajantes cuja
 * amplitude é a energia da voz.
 *
 * Substitui `AvatarPresenca` na projeção Presença. O contrato não mudou: lê o
 * mesmo `SnapshotCognitivo`, a mesma `Fala`, o mesmo `RelogioVoz`. A tradução
 * estado→parâmetro mora em `mapaAurora.ts`, como a facial morava em
 * `mapaFacial.ts`. Zero assets externos: geometria e luz são procedurais —
 * sem GLB, sem rigging, sem pipeline de exportação.
 *
 * FRAMELOOP: a entidade é ambiente vivo (respira em repouso — decisão de
 * design), então o loop roda enquanto a janela está visível e desliga por
 * completo quando ela some (bandeja não paga GPU). O ReguladorDesempenho
 * continua valendo: em máquina fraca, cai a densidade de pixels, nunca a
 * aplicação.
 */

import { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  CatmullRomCurve3,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  type Group,
  type WebGLRenderer,
} from 'three';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import { ControladorEntidade } from './mapaAurora';
import { dprDoModo, lerModoDesempenho, EVENTO_DESEMPENHO } from './desempenho';

/* ------------------------------------------------------------------------- */
/* GLSL compartilhado                                                        */
/* ------------------------------------------------------------------------- */

const GLSL_COMUM = /* glsl */ `
float hash(vec3 p){ p=fract(p*0.3183099+vec3(0.1,0.2,0.3)); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 p){
  vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),
                 mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),
                 mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);
}
float fbm(vec3 p){ float v=0., a=0.5; for(int i=0;i<3;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
vec3 hsv2rgb(vec3 c){
  vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz)*6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
`;

/* Espectro da marca com o toque coral num segmento estreito. */
const GLSL_PALETA = /* glsl */ `
vec3 paletaMarca(float t){
  vec3 verde   = vec3(0.345, 0.902, 0.776);
  vec3 azul    = vec3(0.435, 0.714, 1.000);
  vec3 lilas   = vec3(0.706, 0.549, 1.000);
  vec3 laranja = vec3(1.000, 0.550, 0.360);
  vec3 ambar   = vec3(1.000, 0.851, 0.541);
  t = fract(t);
  vec3 c = mix(verde, azul, smoothstep(0.0, 0.26, t));
  c = mix(c, lilas, smoothstep(0.26, 0.52, t));
  c = mix(c, laranja, smoothstep(0.52, 0.68, t));
  c = mix(c, ambar, smoothstep(0.68, 0.80, t));
  c = mix(c, verde, smoothstep(0.80, 1.0, t));
  return c;
}
`;

interface UniformesEntidade {
  uT: { value: number };
  uAmp: { value: number };
  uVel: { value: number };
  uEnv: { value: number };
  uRaio: { value: number };
  uBrilho: { value: number };
  uInterno: { value: number };
  uMatiz: { value: Vector2 };
}

/* ------------------------------------------------------------------------- */
/* Estúdio preto com softboxes — a iluminação da referência                  */
/* ------------------------------------------------------------------------- */

function criarEstudio(): Scene {
  const s = new Scene();
  const painel = (cor: number, intensidade: number, w: number, h: number, x: number, y: number, z: number) => {
    const m = new Mesh(
      new PlaneGeometry(w, h),
      new MeshBasicMaterial({ color: new Color(cor).multiplyScalar(intensidade), side: DoubleSide }),
    );
    m.position.set(x, y, z);
    m.lookAt(0, 0, 0);
    s.add(m);
  };
  painel(0xffffff, 22, 4.0, 2.2, -3.5, 4.0, 2.5);
  painel(0x9fd0ff, 13, 1.1, 5.0, 5.0, 0.5, -1.0);
  painel(0xffc890, 10, 2.5, 0.7, -4.0, -2.6, -1.8);
  painel(0xd8b0ff, 8, 0.7, 3.5, 2.5, 3.2, -3.5);
  painel(0xffb060, 8, 0.6, 2.8, -5.0, 0.2, -2.5);
  painel(0xff9fd8, 6, 2.0, 0.5, 3.5, -3.0, 1.5);
  return s;
}

/** PMREM do estúdio + tone mapping de cinema, uma vez por contexto GL. */
function AmbienteEstudio() {
  const gl = useThree((e) => e.gl);
  const cena = useThree((e) => e.scene);

  useEffect(() => {
    gl.toneMapping = ACESFilmicToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.outputColorSpace = SRGBColorSpace;
    const pmrem = new PMREMGenerator(gl as WebGLRenderer);
    const alvo = pmrem.fromScene(criarEstudio(), 0.04);
    cena.environment = alvo.texture;
    // Fundo opaco escuro (tom da casca): o buffer de transmissão do vidro
    // precisa de fundo real para não lavar — e a referência é estúdio preto.
    cena.background = new Color(0x050d0b);
    return () => {
      cena.environment = null;
      cena.background = null;
      alvo.dispose();
      pmrem.dispose();
    };
  }, [gl, cena]);

  return null;
}

/* ------------------------------------------------------------------------- */
/* A pedra: vidro dispersivo com deformação orgânica                         */
/* ------------------------------------------------------------------------- */

function criarMaterialPedra(deform: { value: number }, morph: { value: number }) {
  const mat = new MeshPhysicalMaterial({
    color: new Color(0xffffff),
    metalness: 0,
    roughness: 0.01,
    transmission: 1.0,
    thickness: 2.6,
    ior: 1.62,
    dispersion: 14.0,
    attenuationColor: new Color(0xe4f4ff),
    attenuationDistance: 5.0,
    iridescence: 0.45,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [140, 560],
    clearcoat: 1.0,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.25,
  });

  // Ondulação contínua no vertex shader; normais recalculadas pelo gradiente
  // do campo de ruído — os reflexos deslizam corretos pela superfície viva.
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDeform = deform;
    shader.uniforms.uMorph = morph;
    shader.vertexShader =
      `uniform float uDeform;\nuniform float uMorph;\n${GLSL_COMUM}\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        vec3 mOff = vec3(uMorph, uMorph*0.7, uMorph*1.3);
        float n0 = fbm(position*1.5 + mOff);
        float eD = 0.07;
        float nDx = fbm((position + vec3(eD,0.,0.))*1.5 + mOff);
        float nDy = fbm((position + vec3(0.,eD,0.))*1.5 + mOff);
        float nDz = fbm((position + vec3(0.,0.,eD))*1.5 + mOff);
        vec3 gradN = (vec3(nDx,nDy,nDz) - n0) / eD;
        vec3 objectNormal = normalize(normal - uDeform*(gradN - dot(gradN, normal)*normal));
        `,
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = position + normal * (n0 - 0.5) * uDeform * 2.0;',
      );
  };
  return mat;
}

/* O encante: núcleo emissivo visto através do vidro. Resposta quadrática ao
   `interno` — discreto em repouso, incandescente no pensar. */
function criarMaterialNucleo(uniformes: UniformesEntidade) {
  return new ShaderMaterial({
    uniforms: uniformes as unknown as Record<string, { value: unknown }>,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main(){ vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uInterno; uniform vec2 uMatiz;
      varying vec3 vPos;
      ${GLSL_COMUM}
      void main(){
        float n = fbm(vPos*3.2 + vec3(0.0, uT*0.08, 0.0));
        float hue = mix(uMatiz.x, uMatiz.y, fract(n*2.1 + uT*0.02));
        float centro = smoothstep(0.32, 0.0, length(vPos));
        float pulso = mix(0.75 + 0.25*sin(uT*0.6), 0.5 + 0.5*sin(uT*3.8), step(0.8, uInterno));
        float sat = mix(0.7, 0.3, centro);
        vec3 c = hsv2rgb(vec3(hue, sat, 1.0)) * (0.3 + 6.0*uInterno*uInterno*pulso) * (0.4 + 0.6*n) * (0.25 + 0.75*centro*centro);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------------- */
/* Cortinas de aurora: gradiente fluido preenchido, topos arredondados       */
/* ------------------------------------------------------------------------- */

function criarMaterialCortina(uniformes: UniformesEntidade, indice: number, forca: number) {
  return new ShaderMaterial({
    uniforms: {
      ...(uniformes as unknown as Record<string, { value: unknown }>),
      uIdx: { value: indice },
      uForca: { value: forca },
    },
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uT, uAmp, uVel, uEnv, uRaio, uIdx;
      varying vec2 vUv;
      ${GLSL_COMUM}
      void main(){
        vUv = uv;
        vec3 p = position;
        float ang = atan(p.z, p.x);
        float vy = uv.y;
        float ondaViaja = sin(5.0*ang - uT*uVel*2.0 + uIdx*1.7) + 0.5*sin(9.0*ang + uT*uVel*1.3 + uIdx*3.1);
        float dobraLenta = 0.16*sin(3.0*ang + uT*uVel*1.0 + uIdx*2.0)
                         + 0.30*(noise(vec3(ang*1.5 + uIdx*3.0, uT*0.18, uIdx)) - 0.5);
        float forca = 0.5 + 0.7*uAmp*(0.3 + uEnv);
        float fator = uRaio * (1.0 + dobraLenta*forca*0.6 + ondaViaja*forca*(0.14 + 0.20*vy));
        p.x *= fator; p.z *= fator;
        p.y += (0.10 + 0.10*vy) * sin(2.0*ang + uT*uVel*0.5 + uIdx)
             + 0.10 * ondaViaja * uAmp * (0.3 + uEnv) * vy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT, uBrilho, uIdx, uForca; uniform vec2 uMatiz;
      varying vec2 vUv;
      ${GLSL_COMUM}
      ${GLSL_PALETA}
      void main(){
        float v = vUv.y;
        float r1 = noise(vec3(vUv.x*180.0 + uIdx*13.0, v*2.5 - uT*0.35, uT*0.30));
        float r2 = noise(vec3(vUv.x*60.0 - uT*0.18, v*1.2, uIdx*5.0 + 3.0));
        float r3 = noise(vec3(vUv.x*340.0, v*4.0 - uT*0.55, uIdx*9.0));
        float riscos = pow(0.30 + 0.70*(r1*0.55 + r2*0.45), 1.6) * (0.6 + 0.4*r3);
        // topo ondulado por ângulo, terminação em cúpula — nunca corte reto
        float topo = 0.55 + 0.35*noise(vec3(vUv.x*5.0 + uIdx*3.0, uT*0.08, uIdx*2.0));
        float vn = clamp(v / topo, 0.0, 1.0);
        float perfil = smoothstep(0.0, 0.16, v) * pow(1.0 - vn*vn, 1.8);
        // gradiência preenchida: o riscado modula e se dissolve perto do topo
        float corpo = 0.5 + 0.5*mix(riscos, 0.55, smoothstep(0.35, 0.95, vn));
        // gradiente fluido com domain warping
        float w1 = noise(vec3(vUv.x*3.0 + uT*0.15, v*2.0, uIdx*2.0));
        float w2 = noise(vec3(vUv.x*2.0 - uT*0.10, v*1.5 + w1*1.5, uIdx*2.0 + 5.0));
        float tGrad = fract(vUv.x + w2*0.7 - uT*0.05 + uIdx*0.3);
        vec3 grad = paletaMarca(tGrad);
        float hue = mix(uMatiz.x, uMatiz.y, tGrad);
        vec3 tinta = hsv2rgb(vec3(hue, 0.85, 1.0));
        // espectro da marca domina; só o alerta (matiz baixo) tinge forte
        float pesoTinta = mix(0.3, 0.9, step(uMatiz.x, 0.2));
        vec3 c = mix(grad, tinta, pesoTinta);
        c = c * c * 1.9; // satura — soma aditiva tende ao branco sem isso
        vec3 rosa = vec3(1.0, 0.42, 0.60);
        c = mix(c, rosa * rosa * 1.9, smoothstep(0.30, 0.0, v) * 0.5);
        gl_FragColor = vec4(c * corpo * perfil * uBrilho * 0.95 * uForca, 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------------- */
/* A cena                                                                    */
/* ------------------------------------------------------------------------- */

function CenaEntidade({
  snapshot,
  fala,
  voz,
}: {
  snapshot: SnapshotCognitivo;
  fala: Fala | null;
  voz: RelogioVoz | null;
}) {
  const controlador = useMemo(() => new ControladorEntidade(), []);

  // Snapshot e fala por ref: o frame loop não fecha sobre props.
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const falaRef = useRef(fala);
  falaRef.current = fala;

  const uniformes = useMemo<UniformesEntidade>(
    () => ({
      uT: { value: 0 },
      uAmp: { value: 0.15 },
      uVel: { value: 0.25 },
      uEnv: { value: 0.35 },
      uRaio: { value: 1 },
      uBrilho: { value: 0.62 },
      uInterno: { value: 0.3 },
      uMatiz: { value: new Vector2(0.42, 0.72) },
    }),
    [],
  );
  const uDeform = useMemo(() => ({ value: 0.18 }), []);
  const uMorph = useMemo(() => ({ value: 0 }), []);

  const { geoPedra, matPedra, geoNucleo, matNucleo, cortinas } = useMemo(() => {
    const alturas = [0.85, 1.05, 1.3];
    const raios = [1.75, 2.25, 2.8];
    const forcas = [1.0, 0.65, 0.4];
    return {
      geoPedra: new IcosahedronGeometry(1, 48),
      matPedra: criarMaterialPedra(uDeform, uMorph),
      geoNucleo: new IcosahedronGeometry(0.3, 4),
      matNucleo: criarMaterialNucleo(uniformes),
      cortinas: raios.map((raio, i) => ({
        geo: new CylinderGeometry(raio, raio * 1.03, alturas[i], 320, 48, true),
        mat: criarMaterialCortina(uniformes, i, forcas[i]),
        y: [0.08, 0.14, 0.2][i],
      })),
    };
  }, [uniformes, uDeform, uMorph]);

  useEffect(
    () => () => {
      geoPedra.dispose();
      matPedra.dispose();
      geoNucleo.dispose();
      matNucleo.dispose();
      for (const c of cortinas) {
        c.geo.dispose();
        c.mat.dispose();
      }
    },
    [geoPedra, matPedra, geoNucleo, matNucleo, cortinas],
  );

  // Cores de atenuação: o vidro muda de humor junto com o alerta.
  const corAgua = useMemo(() => new Color(0xe4f4ff), []);
  const corAlerta = useMemo(() => new Color(0xf0876a), []);

  const pedraRef = useRef<Mesh>(null);
  const nucleoRef = useRef<Mesh>(null);
  const fitasRef = useRef<Group>(null);

  const morphRef = useRef(0);

  useFrame((estado, dt) => {
    const t = estado.clock.elapsedTime;
    const passo = Math.min(dt, 0.1);
    const quadro = controlador.atualizar(
      snapshotRef.current,
      falaRef.current,
      voz,
      performance.now(),
      passo,
    );

    uniformes.uT.value = t;
    uniformes.uAmp.value = quadro.amp;
    uniformes.uVel.value = quadro.vel;
    uniformes.uEnv.value = quadro.env;
    uniformes.uRaio.value = quadro.raio;
    uniformes.uBrilho.value = quadro.brilho;
    uniformes.uInterno.value = quadro.interno;
    uniformes.uMatiz.value.set(quadro.m0, quadro.m1);

    // Ondulação orgânica: sempre viva, mais intensa com a voz.
    morphRef.current += passo * (0.1 + 0.3 * quadro.vel);
    uMorph.value = morphRef.current;
    uDeform.value = 0.14 + 0.05 * quadro.amp + 0.14 * quadro.amp * quadro.env;

    const pesoAlerta = quadro.m0 < 0.2 ? 1 - quadro.m0 / 0.2 : 0;
    matPedra.attenuationColor.copy(corAgua).lerp(corAlerta, pesoAlerta);

    const pedra = pedraRef.current;
    if (pedra) {
      pedra.rotation.y = t * 0.06;
      pedra.rotation.z = 0.05 * Math.sin(t * 0.18);
      pedra.scale.setScalar(1 + 0.008 * Math.sin(t * ((Math.PI * 2) / 9)));
    }
    if (nucleoRef.current) nucleoRef.current.rotation.y = -t * 0.04;
    if (fitasRef.current) fitasRef.current.rotation.y = t * 0.03;
  });

  return (
    <>
      <directionalLight position={[-2.2, 3.0, 2.4]} intensity={1.6} color="#eafff5" />
      <directionalLight position={[2.4, -0.6, -2.2]} intensity={0.5} color="#9fd0ff" />
      <mesh ref={pedraRef} geometry={geoPedra} material={matPedra} />
      <mesh ref={nucleoRef} geometry={geoNucleo} material={matNucleo} />
      <group ref={fitasRef} rotation={[0.32, 0, 0]}>
        {cortinas.map((c, i) => (
          <mesh key={i} geometry={c.geo} material={c.mat} position={[0, c.y, 0]} />
        ))}
      </group>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Infraestrutura do palco (mesmos padrões do PalcoPresenca)                 */
/* ------------------------------------------------------------------------- */

/**
 * Enquadramento da entidade — medido, não chutado, e o único lugar onde a
 * proporção da arte se decide.
 *
 * A altura visível no plano da pedra é `DISTANCIA * tan(ABERTURA/2)`. Como a
 * pedra tem raio 1, a fração da altura do palco que ela ocupa é exatamente
 * `1 / (DISTANCIA * tan(ABERTURA/2))`. Em 5.6 / 30° isso dava 0,67: a pedra
 * tomava dois terços do palco, e presença nesse tamanho vira volume, não
 * refinamento. Em 11.6 / 24° cai para 0,41 — joia sobre campo escuro.
 *
 * A lente longa anda junto com o recuo, e é decisão de direção, não
 * consequência aritmética: 24° achata a perspectiva e o vidro passa a ler como
 * objeto fotografado. Com 30° a esfera cresce nas bordas do quadro, que é
 * precisamente a assinatura de grande angular que a referência não tem.
 *
 * Para reenquadrar, mexa só na distância: a abertura é a lente, e trocar de
 * lente troca o caráter da imagem, não o tamanho do objeto.
 */
const ABERTURA = 24;
const DISTANCIA_CAMERA = 11.6;
/** Leve mergulho de ~4°, o mesmo do enquadramento anterior. */
const ALTURA_CAMERA = 0.8;

function CameraEntidade() {
  const camera = useThree((e) => e.camera);
  useEffect(() => {
    camera.position.set(0, ALTURA_CAMERA, DISTANCIA_CAMERA);
    camera.lookAt(0, 0, 0);
    (camera as PerspectiveCamera).updateProjectionMatrix();
  }, [camera]);
  return null;
}

/** Mesma trava de tamanho do PalcoPresenca — o bug de 300x150 não volta. */
function TravaDeTamanho() {
  const gl = useThree((e) => e.gl);
  const setSize = useThree((e) => e.setSize);
  const invalidate = useThree((e) => e.invalidate);

  useEffect(() => {
    const raiz = gl.domElement.closest('.palco-presenca') as HTMLElement | null;
    if (!raiz) return;
    const aplicar = (largura: number, altura: number) => {
      if (largura < 2 || altura < 2) return;
      setSize(largura, altura);
      invalidate();
    };
    const r = raiz.getBoundingClientRect();
    aplicar(r.width, r.height);
    const observador = new ResizeObserver((entradas) => {
      const caixa = entradas[0]?.contentRect;
      if (caixa) aplicar(caixa.width, caixa.height);
    });
    observador.observe(raiz);
    return () => observador.disconnect();
  }, [gl, setSize, invalidate]);

  return null;
}

/** Mesmo regulador do PalcoPresenca: degrada densidade, nunca a aplicação. */
function ReguladorDesempenho() {
  const setDpr = useThree((e) => e.setDpr);
  const modo = useRef(lerModoDesempenho());
  const nivel = useRef(dprDoModo(modo.current));
  const somaDt = useRef(0);
  const quadros = useRef(0);
  const folga = useRef(0);

  useEffect(() => {
    const aplicarModo = () => {
      modo.current = lerModoDesempenho();
      nivel.current = dprDoModo(modo.current);
      setDpr(Math.min(nivel.current, window.devicePixelRatio || 1.5));
    };
    aplicarModo();
    window.addEventListener(EVENTO_DESEMPENHO, aplicarModo);
    return () => window.removeEventListener(EVENTO_DESEMPENHO, aplicarModo);
  }, [setDpr]);

  useFrame((_, dt) => {
    if (modo.current !== 'auto') return;
    somaDt.current += dt;
    quadros.current += 1;
    if (quadros.current < 90) return;
    const media = somaDt.current / quadros.current;
    somaDt.current = 0;
    quadros.current = 0;

    if (media > 0.026 && nivel.current > 0.8) {
      nivel.current = Math.max(0.8, nivel.current - 0.25);
      folga.current = 0;
      setDpr(Math.min(nivel.current, window.devicePixelRatio || 1.5));
      return;
    }
    if (media < 0.014 && nivel.current < 1.5) {
      folga.current += 1;
      if (folga.current >= 5) {
        folga.current = 0;
        nivel.current = Math.min(1.5, nivel.current + 0.25);
        setDpr(Math.min(nivel.current, window.devicePixelRatio || 1.5));
      }
    } else {
      folga.current = 0;
    }
  });

  return null;
}

/** Janela oculta não paga GPU: `never` na bandeja, `always` visível. */
function RegenciaVisibilidade() {
  const setFrameloop = useThree((e) => e.setFrameloop);
  useEffect(() => {
    const aoMudar = () => {
      setFrameloop(document.visibilityState === 'visible' ? 'always' : 'never');
    };
    aoMudar();
    document.addEventListener('visibilitychange', aoMudar);
    return () => document.removeEventListener('visibilitychange', aoMudar);
  }, [setFrameloop]);
  return null;
}

export function EntidadePresenca({
  snapshot,
  fala,
  voz,
}: {
  snapshot: SnapshotCognitivo;
  fala: Fala | null;
  voz: RelogioVoz | null;
}) {
  return (
    <Canvas
      className="palco-presenca"
      camera={{ fov: ABERTURA, near: 0.1, far: 40 }}
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <CameraEntidade />
      <TravaDeTamanho />
      <ReguladorDesempenho />
      <RegenciaVisibilidade />
      <AmbienteEstudio />
      <CenaEntidade snapshot={snapshot} fala={fala} voz={voz} />
    </Canvas>
  );
}
