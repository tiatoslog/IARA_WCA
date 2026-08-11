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

import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  Matrix3,
  Matrix4,
  Mesh,
  MeshPhysicalMaterial,
  NoToneMapping,
  PerspectiveCamera,
  PMREMGenerator,
  ShaderChunk,
  ShaderMaterial,
  SRGBColorSpace,
  Vector2,
  type BufferGeometry,
  type Camera,
  type Group,
  type WebGLRenderer,
} from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import { ControladorEntidade } from './mapaAurora';
import {
  dprDoModo,
  lerModoDesempenho,
  EVENTO_DESEMPENHO,
  type ModoDesempenho,
} from './desempenho';
import { criarComposicao, type Composicao } from './composicao';
import {
  criarCenaEstudio,
  criarFundo,
  criarRigInterno,
  descartarCenaEstudio,
  type Fundo,
  type RigInterno,
} from './estudio';

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
/* Radiância, não valor de tela.
   A cor da aurora e do encante foi afinada quando o shader escrevia direto no
   canvas sRGB — o número saía como o olho o via. Com a composição no meio, o
   quadro inteiro é linear até o passe de lente, e escrever o mesmo número ali
   estoura tudo (foi exatamente o que aconteceu: chapado pastel com borda dura,
   que é o formato do corte de faixa). Esta conversão devolve o valor afinado
   para radiância; a curva do sensor o traz de volta ao mesmo lugar, agora com
   o joelho de filme no alto em vez de tesoura.

   O grau não é sempre 2,2. A conversão exata devolve a luminância, mas também
   devolve a saturação que o corte antigo lavava: a aurora vinha pastel porque
   estourava, e em 2,2 ela reaparece azul-marinho e vinho — outra cor, não
   outra exposição. 1,5 é o meio-termo que preserva o pastel da identidade. O
   encante não tem esse problema e usa a conversão inteira. */
vec3 paraLinear(vec3 c, float grau){ return pow(max(c, vec3(0.0)), vec3(grau)); }
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

/**
 * PMREM do estúdio + ciclorama, uma vez por contexto GL.
 *
 * O tone mapping NÃO fica no renderer: com composer, three só aplica curva
 * desenhando direto na tela, e aqui todo mundo desenha em alvo intermediário.
 * A resposta do sensor mora no passe de lente (`composicao.ts`) — se voltar a
 * ligar aqui, a imagem apanha ACES duas vezes e lava.
 */
function AmbienteEstudio() {
  const gl = useThree((e) => e.gl);
  const cena = useThree((e) => e.scene);

  useEffect(() => {
    gl.toneMapping = NoToneMapping;
    gl.outputColorSpace = SRGBColorSpace;

    const pmrem = new PMREMGenerator(gl as WebGLRenderer);
    const estudio = criarCenaEstudio();
    const alvo = pmrem.fromScene(estudio, 0.035);
    descartarCenaEstudio(estudio);
    cena.environment = alvo.texture;
    // Preto quase absoluto: o ciclorama é que desenha a profundidade, e o
    // buffer de transmissão precisa de fundo real para o vidro não lavar.
    cena.background = new Color(0x030807);

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
/* Composição — a lente e o sensor tomam conta do desenho final              */
/* ------------------------------------------------------------------------- */

/**
 * Assume o render com prioridade 1: a partir daqui o R3F não desenha sozinho,
 * quem desenha é o composer. O MSAA vive no alvo dele (o `antialias` do canvas
 * não vale mais nada quando nada é desenhado direto na tela).
 */
function Composicao() {
  const gl = useThree((e) => e.gl);
  const cena = useThree((e) => e.scene);
  const camera = useThree((e) => e.camera);
  const tamanho = useThree((e) => e.size);
  const densidade = useThree((e) => e.viewport.dpr);

  const composicao = useRef<Composicao | null>(null);
  /* Bloom e MSAA são decididos na montagem dos alvos, não por quadro: mudar de
     modo remonta a cadeia, e é a única razão de o modo virar estado. */
  const [modo, setModo] = useState<ModoDesempenho>(() => lerModoDesempenho());

  useEffect(() => {
    const aoMudar = () => setModo(lerModoDesempenho());
    window.addEventListener(EVENTO_DESEMPENHO, aoMudar);
    return () => window.removeEventListener(EVENTO_DESEMPENHO, aoMudar);
  }, []);

  useEffect(() => {
    const alvo = criarComposicao(gl as WebGLRenderer, cena, camera as Camera, {
      bloom: modo !== 'baixo',
      amostras: modo === 'baixo' ? 0 : 4,
    });
    alvo.redimensionar(tamanho.width, tamanho.height, densidade);
    composicao.current = alvo;
    return () => {
      composicao.current = null;
      alvo.descartar();
    };
    // Tamanho e densidade não remontam a cadeia — o efeito abaixo cuida deles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, cena, camera, modo]);

  useEffect(() => {
    composicao.current?.redimensionar(tamanho.width, tamanho.height, densidade);
  }, [tamanho, densidade]);

  useFrame((estado) => {
    composicao.current?.renderizar(estado.clock.elapsedTime);
  }, 1);

  return null;
}

/* ------------------------------------------------------------------------- */
/* A pedra: vidro dispersivo com deformação orgânica                         */
/* ------------------------------------------------------------------------- */

/**
 * Faixa de espessura do filme iridescente, em nanômetros. É o mesmo intervalo
 * do material, repetido aqui porque agora ele varia por fragmento: filme fino
 * de verdade não tem espessura única, e é a variação que produz a mancha de
 * cor que anda pela superfície em vez do verniz uniforme.
 */
const FILME_MIN = 150;
const FILME_MAX = 540;

/**
 * O corpo da pedra. Vidro óptico: transmissão total, dispersão, iridescência,
 * verniz. Tudo o que se acrescenta ao `MeshPhysicalMaterial` responde à mesma
 * pergunta — o que uma pedra real teria que este material ainda não tem?
 *
 *  · a normal recalculada do campo de deformação, para o realce deslizar pela
 *    superfície viva em vez de patinar sobre ela;
 *  · microrrelevo por fragmento, alta frequência, amplitude ínfima: nenhuma
 *    peça polida é opticamente lisa na escala do realce;
 *  · variação de polimento na rugosidade, pela mesma razão;
 *  · espessura e distância de atenuação variáveis, que é o que cria zona densa
 *    e zona translúcida dentro do mesmo corpo;
 *  · espessura de filme variável, a iridescência física.
 *
 * A DEFORMAÇÃO NÃO MUDOU. Mesmo ruído, mesma escala, mesma amplitude — a
 * silhueta é identidade e não está em discussão. O que mudou foi a conta da
 * normal, que antes esquecia o fator 2 da amplitude e por isso devolvia
 * reflexo raso demais para o relevo que a geometria realmente tem.
 */
function criarMaterialPedra(
  deform: { value: number },
  morph: { value: number },
  matrizNormal: { value: Matrix3 },
) {
  const mat = new MeshPhysicalMaterial({
    color: new Color(0xffffff),
    metalness: 0,
    roughness: 0.012,
    transmission: 1.0,
    thickness: 2.6,
    ior: 1.62,
    // O franjado de cor é identidade — está na referência e está na pedra
    // desde o primeiro dia. Só recuou de 14 para 10: acima disso as três
    // amostras que a transmissão de tela oferece param de ler como arco e
    // passam a ler como três fantasmas separados, que é aparência de efeito.
    dispersion: 4.0,
    /* Absorção mais curta. O vidro não escurece por igual: escurece por
       caminho percorrido, e é justamente esse gradiente que faz a peça ter
       volume em vez de ser casca acesa. Com 5,0 o corpo inteiro chegava claro
       e a pedra lia como mármore leitoso. */
    attenuationColor: new Color(0xd0eaff),
    attenuationDistance: 2.6,
    iridescence: 0.26,
    iridescenceIOR: 1.3,
    iridescenceThicknessRange: [FILME_MIN, FILME_MAX],
    clearcoat: 1.0,
    clearcoatRoughness: 0.035,
    envMapIntensity: 1.9,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uDeform = deform;
    shader.uniforms.uMorph = morph;
    shader.uniforms.uMatrizNormal = matrizNormal;

    /* --- vértice: forma viva, normal correta ---------------------------- */

    shader.vertexShader =
      `uniform float uDeform;\nuniform float uMorph;\nvarying vec3 vPedra;\n${GLSL_COMUM}\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `
        vPedra = position;
        vec3 mOff = vec3(uMorph, uMorph*0.7, uMorph*1.3);
        float n0 = fbm(position*1.5 + mOff);
        float eD = 0.07;
        float nDx = fbm((position + vec3(eD,0.,0.))*1.5 + mOff);
        float nDy = fbm((position + vec3(0.,eD,0.))*1.5 + mOff);
        float nDz = fbm((position + vec3(0.,0.,eD))*1.5 + mOff);
        // h = (n0 - 0.5) * uDeform * 2  =>  grad(h) = grad(n) * uDeform * 2
        vec3 gradH = ((vec3(nDx,nDy,nDz) - n0) / eD) * uDeform * 2.0;
        vec3 gradT = gradH - dot(gradH, normal) * normal;
        vec3 objectNormal = normalize(normal - gradT);
        `,
      )
      .replace(
        '#include <begin_vertex>',
        'vec3 transformed = position + normal * (n0 - 0.5) * uDeform * 2.0;',
      );

    /* --- fragmento: microrrelevo, polimento, densidade, filme ----------- */

    shader.fragmentShader =
      `uniform mat3 uMatrizNormal;\nvarying vec3 vPedra;\n${GLSL_COMUM}\n${shader.fragmentShader}`;

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `
        #include <roughnessmap_fragment>
        vec3 pMicro = vPedra * 15.0;
        float micro0 = noise(pMicro);
        const float eMicro = 0.16;
        vec3 gradMicro = (vec3(
          noise(pMicro + vec3(eMicro, 0.0, 0.0)),
          noise(pMicro + vec3(0.0, eMicro, 0.0)),
          noise(pMicro + vec3(0.0, 0.0, eMicro))) - micro0) / eMicro;
        vec3 gradMicroVista = uMatrizNormal * gradMicro;
        float polimento = noise(vPedra * 5.5 + 11.0);
        float densidade = fbm(vPedra * 1.7 + 3.0);
        roughnessFactor = clamp(roughnessFactor + 0.048*polimento*polimento + 0.012*micro0, 0.004, 0.24);
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + (gradMicroVista - dot(gradMicroVista, normal)*normal) * 0.005);
        `,
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        /* glsl */ `
        #include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        clearcoatNormal = normalize(clearcoatNormal + (gradMicroVista - dot(gradMicroVista, clearcoatNormal)*clearcoatNormal) * 0.011);
        #endif
        `,
      )
      /* A espessura do filme se decide em `lights_physical_fragment`, que é
         onde o `material` é montado — `iridescence_fragment` é só a biblioteca
         de funções, e mora fora de qualquer função. */
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
        #include <lights_physical_fragment>
        #ifdef USE_IRIDESCENCE
        material.iridescenceThickness = mix(${FILME_MIN.toFixed(1)}, ${FILME_MAX.toFixed(1)}, clamp(0.5 + 1.7*(densidade - 0.5), 0.0, 1.0));
        #endif
        `,
      );

    /* Espessura e atenuação variáveis: three lê as duas de uniforme, então o
       jeito de fazê-las variar por fragmento é servir o trecho já editado no
       lugar do include. Se um dia o trecho mudar de forma no three, a troca
       simplesmente não acontece e o material volta ao comportamento uniforme
       em vez de deixar de compilar. */
    const trecho = ShaderChunk.transmission_fragment;
    if (
      trecho.includes('material.thickness = thickness;') &&
      trecho.includes('material.attenuationDistance = attenuationDistance;')
    ) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <transmission_fragment>',
        trecho
          .replace(
            'material.thickness = thickness;',
            'material.thickness = thickness * (0.45 + 1.25*densidade);',
          )
          .replace(
            'material.attenuationDistance = attenuationDistance;',
            'material.attenuationDistance = attenuationDistance * (0.6 + 0.9*densidade);',
          ),
      );
    }
  };
  return mat;
}

/**
 * O encante: núcleo emissivo visto através do vidro. Resposta quadrática ao
 * `interno` — discreto em repouso, incandescente no pensar.
 *
 * É luz, não bola. A esfera de silhueta dura lia como objeto sólido dentro do
 * cristal; agora a intensidade cai com o ângulo de face (máxima onde a vista
 * atravessa o maior caminho de matéria luminosa, nula na borda), soma-se ao
 * que está atrás e não escreve profundidade. O que a pedra refrata é um brilho
 * com queda, que é como luz presa em vidro se comporta.
 *
 * `transparent: false` é obrigatório e não é sobre opacidade: o passe de
 * transmissão do three só desenha a lista opaca, e o encante marcado
 * transparente sumiria de dentro do vidro — que é o único lugar onde ele
 * deveria aparecer.
 */
function criarMaterialNucleo(uniformes: UniformesEntidade) {
  return new ShaderMaterial({
    uniforms: uniformes as unknown as Record<string, { value: unknown }>,
    transparent: false,
    blending: AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vPos; varying vec3 vN; varying vec3 vV;
      void main(){
        vPos = position;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT; uniform float uInterno; uniform vec2 uMatiz;
      varying vec3 vPos; varying vec3 vN; varying vec3 vV;
      ${GLSL_COMUM}
      void main(){
        float n = fbm(vPos*3.2 + vec3(0.0, uT*0.08, 0.0));
        float hue = mix(uMatiz.x, uMatiz.y, fract(n*2.1 + uT*0.02));
        float face = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float centro = pow(face, 2.4);
        float pulso = mix(0.75 + 0.25*sin(uT*0.6), 0.5 + 0.5*sin(uT*3.8), step(0.8, uInterno));
        float sat = mix(0.7, 0.28, centro);
        vec3 c = hsv2rgb(vec3(hue, sat, 1.0)) * (0.3 + 3.0*uInterno*uInterno*pulso) * (0.4 + 0.6*n);
        gl_FragColor = vec4(paraLinear(c * centro, 2.2), 1.0);
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
        /* O 0,42 é recuo, e é a única mudança de intenção nas cortinas.
           Escrevendo direto no canvas elas cortavam no branco: o miolo virava
           chapa saturada e só a franja mostrava estrutura — era o corte que
           desenhava a aurora. Numa curva de filme nada corta, e o miolo inteiro
           passa a aparecer: a cortina de luz vira fita de cetim e disputa o
           primeiro plano com a pedra. Baixar o nível devolve a franja ao lugar
           de sempre e devolve a pedra ao papel de protagonista. Movimento,
           forma, cor e resposta à voz continuam exatamente os mesmos. */
        gl_FragColor = vec4(paraLinear(c * corpo * perfil * uBrilho * 0.95 * uForca, 1.5), 1.0);
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
  /**
   * A rotação objeto→vista da pedra. O microrrelevo nasce em espaço de objeto
   * (é a superfície da pedra, gira com ela) e a normal do fragmento mora em
   * espaço de vista — sem esta matriz o relevo escorregaria contra o corpo.
   * Preenchida em `onBeforeRender`, quando a matriz da câmera do passe
   * corrente já é a definitiva: assim vale igual no passe de transmissão.
   */
  const uMatrizNormal = useMemo(() => ({ value: new Matrix3() }), []);

  const { geoPedra, matPedra, geoNucleo, matNucleo, cortinas } = useMemo(() => {
    const alturas = [0.85, 1.05, 1.3];
    const raios = [1.75, 2.25, 2.8];
    const forcas = [1.0, 0.65, 0.4];
    return {
      // Icosaedro subdividido — a mesma esfera de antes, agora indexada. O
      // poliedro do three nasce sem índice e repete cada vértice em toda face
      // que o toca; com o campo de ruído avaliado no vértice, isso era o mesmo
      // fbm calculado seis vezes pelo mesmo ponto. Soldar não muda um pixel da
      // forma e devolve o orçamento que a composição passou a gastar.
      geoPedra: mergeVertices(new IcosahedronGeometry(1, 48)) as BufferGeometry,
      matPedra: criarMaterialPedra(uDeform, uMorph, uMatrizNormal),
      geoNucleo: new IcosahedronGeometry(0.34, 5),
      matNucleo: criarMaterialNucleo(uniformes),
      cortinas: raios.map((raio, i) => ({
        geo: new CylinderGeometry(raio, raio * 1.03, alturas[i], 320, 48, true),
        mat: criarMaterialCortina(uniformes, i, forcas[i]),
        y: [0.08, 0.14, 0.2][i],
      })),
    };
  }, [uniformes, uDeform, uMorph, uMatrizNormal]);

  /* Iluminação de estúdio que não cabe no ambiente: o rig escondido atrás da
     pedra (única coisa que a transmissão de tela consegue refratar) e o
     ciclorama que dá à borda do vidro algo para distorcer. */
  const rig = useMemo<RigInterno>(() => criarRigInterno(), []);
  const fundo = useMemo<Fundo>(() => criarFundo(), []);

  useEffect(
    () => () => {
      geoPedra.dispose();
      matPedra.dispose();
      geoNucleo.dispose();
      matNucleo.dispose();
      rig.descartar();
      fundo.descartar();
      for (const c of cortinas) {
        c.geo.dispose();
        c.mat.dispose();
      }
    },
    [geoPedra, matPedra, geoNucleo, matNucleo, cortinas, rig, fundo],
  );

  // Cores de atenuação: o vidro muda de humor junto com o alerta.
  const corAgua = useMemo(() => new Color(0xe4f4ff), []);
  const corAlerta = useMemo(() => new Color(0xf0876a), []);

  const pedraRef = useRef<Mesh>(null);
  const nucleoRef = useRef<Mesh>(null);
  const fitasRef = useRef<Group>(null);

  const morphRef = useRef(0);
  /** Rascunho da modelo-vista da pedra; existe para não alocar por quadro. */
  const modeloVista = useMemo(() => new Matrix4(), []);

  /* A matriz do microrrelevo é preenchida no gancho de desenho, não no loop:
     o passe de transmissão desenha a cena uma segunda vez, e é a câmera
     daquele passe que precisa valer ali. */
  useEffect(() => {
    const pedra = pedraRef.current;
    if (!pedra) return;
    pedra.onBeforeRender = (_gl, _cena, camera) => {
      modeloVista.multiplyMatrices(camera.matrixWorldInverse, pedra.matrixWorld);
      uMatrizNormal.value.getNormalMatrix(modeloVista);
    };
    return () => {
      pedra.onBeforeRender = () => {};
    };
  }, [modeloVista, uMatrizNormal]);

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

    /* ---------------------------------------------------------------------
     * O movimento.
     *
     * A cadência é a mesma de sempre — giro em y a 0,06 rad/s, o balanço de
     * 0,05 em z, a respiração de nove segundos na escala. O que entrou foram
     * termos de período incomensurável somados por cima: como 0,107 e 0,0431
     * não têm razão racional simples com 0,18 nem entre si, a soma nunca fecha
     * um ciclo, e o olho para de encontrar o ponto onde a animação recomeça.
     *
     * O efeito colateral é o que interessa: a velocidade angular passa a
     * variar de ~0,049 a ~0,071 rad/s em vez de ser constante. Rotação de
     * velocidade fixa é a assinatura mais barata de objeto 3D — coisa pendurada
     * no ar acelera e desacelera.
     * ------------------------------------------------------------------- */
    const pedra = pedraRef.current;
    if (pedra) {
      pedra.rotation.y = t * 0.06 + 0.085 * Math.sin(t * 0.107) + 0.045 * Math.sin(t * 0.0431 + 1.7);
      pedra.rotation.z = 0.05 * Math.sin(t * 0.18) + 0.028 * Math.sin(t * 0.0733 + 2.4);
      pedra.rotation.x = 0.038 * Math.sin(t * 0.0911 + 0.9) + 0.021 * Math.sin(t * 0.0412 + 3.1);
      pedra.position.set(
        0.032 * Math.sin(t * 0.0829 + 2.2) + 0.014 * Math.sin(t * 0.0349 + 4.0),
        0.05 * Math.sin(t * 0.1291) + 0.022 * Math.sin(t * 0.0577 + 1.1),
        0.03 * Math.sin(t * 0.0619 + 0.4),
      );
      pedra.scale.setScalar(
        1 + 0.008 * Math.sin(t * ((Math.PI * 2) / 9)) + 0.004 * Math.sin(t * 0.0713 + 2.0),
      );
    }
    // O encante é da entidade: acompanha o corpo. O rig é do estúdio, e por
    // isso fica onde está — luz não flutua junto com o que ela ilumina.
    if (nucleoRef.current) {
      nucleoRef.current.rotation.y = -t * 0.04;
      if (pedra) nucleoRef.current.position.copy(pedra.position);
    }
    if (fitasRef.current) fitasRef.current.rotation.y = t * 0.03;
    rig.animar(t);

    /* Deriva de câmera: dois centésimos de unidade, ciclos de minutos. Não é
       para ser vista, é para não ser uma câmera perfeitamente imóvel — a única
       câmera que nunca existiu num set de verdade. */
    const camera = estado.camera;
    camera.position.set(
      0.022 * Math.sin(t * 0.0371),
      ALTURA_CAMERA + 0.016 * Math.sin(t * 0.0293 + 1.3),
      DISTANCIA_CAMERA,
    );
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      <directionalLight position={[-2.2, 3.0, 2.4]} intensity={1.6} color="#eafff5" />
      <directionalLight position={[2.4, -0.6, -2.2]} intensity={0.5} color="#9fd0ff" />
      <primitive object={fundo.malha} />
      <primitive object={rig.grupo} />
      <mesh ref={pedraRef} geometry={geoPedra} material={matPedra} />
      <mesh ref={nucleoRef} geometry={geoNucleo} material={matNucleo} renderOrder={-4} />
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
      /* O antialias do canvas ficou sem função: nada é desenhado direto na
         tela, tudo passa pelo alvo do composer — e é lá que o MSAA mora. */
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
    >
      <CameraEntidade />
      <TravaDeTamanho />
      <ReguladorDesempenho />
      <RegenciaVisibilidade />
      <AmbienteEstudio />
      <CenaEntidade snapshot={snapshot} fala={fala} voz={voz} />
      <Composicao />
    </Canvas>
  );
}


