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
import { GLSL_COMUM, GLSL_PALETA } from './glsl';
import { criarAurora } from './aurora';
import { ALTURA_CAMERA, ABERTURA, distanciaDoEnquadramento } from './enquadramento';
import {
  criarCenaEstudio,
  criarFundo,
  criarRigInterno,
  descartarCenaEstudio,
  type Fundo,
  type RigInterno,
} from './estudio';

/* GLSL compartilhado com a aurora — ver `glsl.ts`. */

export interface UniformesEntidade {
  uT: { value: number };
  uAmp: { value: number };
  uVel: { value: number };
  uEnv: { value: number };
  uRaio: { value: number };
  uBrilho: { value: number };
  uInterno: { value: number };
  /**
   * A faixa da `paletaMarca` que o estado corrente ocupa (início, fim), na
   * mesma escala 0..1 da paleta. NÃO é matiz HSV — foi, até 11/08, e a troca
   * é o que devolveu legibilidade ao canal de cor: o estado agora escolhe uma
   * REGIÃO do espectro da marca em vez de tingir por fora um gradiente que o
   * ignorava.
   */
  uMatiz: { value: Vector2 };
  /**
   * 0 no repertório normal, 1 no alerta. Substituiu o teste `uMatiz.x < 0.2`,
   * que era um acoplamento escondido: o alerta era deduzido de "matiz baixo",
   * então qualquer faixa que começasse embaixo disparava coral por engano —
   * e a renumeração das faixas passa exatamente por lá. Sinalizador explícito
   * não tem esse problema, e interpola junto com o resto no controlador.
   */
  uAlerta: { value: number };
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
export function AmbienteEstudio() {
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
    /* Grafite neutro, não preto esverdeado. O ciclorama cobre o quadro inteiro
       e é ele que desenha a profundidade — isto aqui só aparece no buffer de
       transmissão, e mesmo lá a temperatura importa: o verde antigo tingia o
       que o cromo refrata. */
    cena.background = new Color(0x080a0c);

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
export function Composicao() {
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
      /* MSAA de volta, e a causa do apagão ficou PROVADA por eliminação.
         Durante o desvio das fitas de vidro, ligar `samples: 4` aqui deixava a
         tela inteiramente preta: nenhum programa de shader chegava a ser
         compilado, nenhum quadro era desenhado, e não havia erro no console.
         Preto silencioso, a pior falha possível.
         Na época a suspeita era interação entre o passe de transmissão do three
         e um alvo multiamostrado de meia precisão, mas ficou escrita como
         suspeita porque as fitas eram a única evidência. Removidas as fitas —
         as únicas superfícies com `transmission` além da própria pedra — o MSAA
         voltou a funcionar sem tocar em mais nada. A suspeita era a resposta.
         CONSEQUÊNCIA PRÁTICA: introduzir uma SEGUNDA superfície transmissiva na
         cena reabre o bug. Se um dia isso for necessário, este é o primeiro
         lugar a desligar. */
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
const FILME_MIN = 210;
const FILME_MAX = 430;

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
export function criarMaterialPedra(
  deform: { value: number },
  morph: { value: number },
  matrizNormal: { value: Matrix3 },
) {
  const mat = new MeshPhysicalMaterial({
    /* A cor da fração NÃO transmitida. Com transmissão total ela não existia e
       o branco era inócuo; agora ela é o corpo grafite sob o cromo, e é dela
       que vem o peso da peça. Grafite claro, não preto: em 0x0b1216 a metade
       sem luz fechava por completo e a peça virava bola de boliche — o corpo
       precisa de meio-tom para as dobras existirem na sombra. */
    color: new Color(0x4a545b),
    metalness: 0,
    roughness: 0.006,
    /* A mudança que mais mexe na leitura do material, e a que precisou de duas
       tentativas para achar o ponto.

       Em 1,0 a superfície é dominada pela refração: a luz atravessa, o
       interior fica claro e a peça lê como bala de vidro — sem peso, sem
       metade escura, sem o reflexo contínuo que faz cromo ser cromo.

       Em 0,72 o pêndulo passou do outro lado: 28% de base opaca escura é muita
       base, e o que sobrou na tela foi uma esfera preta com três realces. Preto
       polido é UMA das referências, mas o pedido é cromo AQUÁTICO — e água
       precisa deixar luz passar para ter profundidade.

       0,84 é o meio-termo com função: sobra base o bastante (16%) para o
       reflexo do estúdio ter contra o que se destacar e para a peça ter peso,
       e passa luz o bastante para o corpo ter interior. */
    transmission: 0.84,
    thickness: 1.9,
    ior: 1.55,
    /* O franjado saiu de 4,0 para 1,3, e é aqui que mora a delicadeza.
       Dispersão alta com dezenas de lóbulos multiplica o arco por lóbulo: o que
       chega à tela não é prisma, é confete de arco-íris — foi o que deixou o
       interior sujo. Em 1,3 a separação só aparece onde o caminho óptico é
       longo (borda, vale de dobra), que é onde uma peça real a mostra. */
    dispersion: 1.3,
    /* Absorção fria de aço: o corpo escurece por caminho percorrido, e é esse
       gradiente — borda clara, miolo denso — que dá volume. Sem ele o vidro é
       casca. A cor recuou de grafite escuro para azul-aço claro pelo mesmo
       motivo da transmissão: absorção escura somada a base escura fechava o
       interior duas vezes. */
    /* Valor inicial apenas: o loop reescreve isto todo quadro a partir de
       `corAgua`/`corAlerta` na cena. Os dois precisam concordar. */
    attenuationColor: new Color(0xbcd2e2),
    attenuationDistance: 3.6,
    /* Um décimo, não um quarto. A iridescência é sofisticação quando é
       insinuação na borda e é verniz de bijuteria quando cobre o corpo. */
    iridescence: 0.1,
    iridescenceIOR: 1.28,
    iridescenceThicknessRange: [FILME_MIN, FILME_MAX],
    clearcoat: 1.0,
    clearcoatRoughness: 0.012,
    /* Cromo é quase só ambiente: o que se vê na superfície é o estúdio, não a
       cor do objeto. Subir isto e agrandar os difusores em `estudio.ts` são a
       mesma decisão vista de dois lados. */
    envMapIntensity: 3.6,
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
        float n0 = campoPedra(position, mOff);
        float eD = 0.07;
        float nDx = campoPedra(position + vec3(eD,0.,0.), mOff);
        float nDy = campoPedra(position + vec3(0.,eD,0.), mOff);
        float nDz = campoPedra(position + vec3(0.,0.,eD), mOff);
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
        vec3 pMicro = vPedra * 11.0;
        float micro0 = noise(pMicro);
        const float eMicro = 0.16;
        vec3 gradMicro = (vec3(
          noise(pMicro + vec3(eMicro, 0.0, 0.0)),
          noise(pMicro + vec3(0.0, eMicro, 0.0)),
          noise(pMicro + vec3(0.0, 0.0, eMicro))) - micro0) / eMicro;
        vec3 gradMicroVista = uMatrizNormal * gradMicro;
        float polimento = noise(vPedra * 4.2 + 11.0);
        float densidade = fbm(vPedra * 1.7 + 3.0);
        /* A variação de polimento caiu quase pela metade e o teto desceu de
           0,24 para 0,11. Numa peça que agora é espelho, meio ponto de
           rugosidade já é uma mancha fosca do tamanho de um dedo — e mancha
           fosca em cromo lê como sujeira, não como microimperfeição. */
        roughnessFactor = clamp(roughnessFactor + 0.026*polimento*polimento + 0.007*micro0, 0.003, 0.11);
        `,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `
        #include <normal_fragment_maps>
        normal = normalize(normal + (gradMicroVista - dot(gradMicroVista, normal)*normal) * 0.0032);
        `,
      )
      .replace(
        '#include <clearcoat_normal_fragment_maps>',
        /* glsl */ `
        #include <clearcoat_normal_fragment_maps>
        #ifdef USE_CLEARCOAT
        clearcoatNormal = normalize(clearcoatNormal + (gradMicroVista - dot(gradMicroVista, clearcoatNormal)*clearcoatNormal) * 0.0065);
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
export function criarMaterialNucleo(uniformes: UniformesEntidade) {
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
      uniform float uT; uniform float uInterno; uniform float uAlerta; uniform vec2 uMatiz;
      varying vec3 vPos; varying vec3 vN; varying vec3 vV;
      ${GLSL_COMUM}
      ${GLSL_PALETA}
      void main(){
        float n = fbm(vPos*3.2 + vec3(0.0, uT*0.08, 0.0));
        /* Mesma escala das cortinas: uMatiz é a faixa da paleta do estado, e
           o encante fica DENTRO dela. Antes isto era matiz HSV cru, o que
           dava ao núcleo um sistema de cores próprio — a peça podia estar num
           tom e o miolo dela em outro, e nada no contrato dizia qual dos dois
           era o estado. Um fato, uma cor.
           O branco no centro é físico, não estilo: onde a vista atravessa mais
           matéria luminosa a soma satura, e é o que separa "luz presa no
           vidro" de "bola colorida". Por isso a cor mora na borda do encante e
           some no miolo. */
        float tGrad = mix(uMatiz.x, uMatiz.y, fract(n*2.1 + uT*0.02));
        vec3 tom = mix(paletaMarca(tGrad), vec3(0.941, 0.529, 0.416), uAlerta * 0.9);
        float face = clamp(dot(normalize(vN), normalize(vV)), 0.0, 1.0);
        float centro = pow(face, 2.4);
        float pulso = mix(0.75 + 0.25*sin(uT*0.6), 0.5 + 0.5*sin(uT*3.8), step(0.8, uInterno));
        vec3 c = mix(tom, vec3(1.0), centro*0.65)
               * (0.3 + 3.0*uInterno*uInterno*pulso) * (0.4 + 0.6*n);
        gl_FragColor = vec4(paraLinear(c * centro, 2.2), 1.0);
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
      // A faixa de `disponivel` em mapaAurora — o primeiro quadro desenha
      // antes de o controlador rodar, e divergir aqui pinta a abertura na cor
      // de outro estado.
      uMatiz: { value: new Vector2(0.0, 0.14) },
      uAlerta: { value: 0 },
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

  const { geoPedra, matPedra, geoNucleo, matNucleo } = useMemo(
    () => ({
      // Icosaedro subdividido — a mesma esfera de antes, agora indexada. O
      // poliedro do three nasce sem índice e repete cada vértice em toda face
      // que o toca; com o campo de ruído avaliado no vértice, isso era o mesmo
      // fbm calculado seis vezes pelo mesmo ponto. Soldar não muda um pixel da
      // forma e devolve o orçamento que a composição passou a gastar.
      geoPedra: mergeVertices(new IcosahedronGeometry(1, 48)) as BufferGeometry,
      matPedra: criarMaterialPedra(uDeform, uMorph, uMatrizNormal),
      geoNucleo: new IcosahedronGeometry(0.34, 5),
      matNucleo: criarMaterialNucleo(uniformes),
    }),
    [uniformes, uDeform, uMorph, uMatrizNormal],
  );

  /* As cortinas de aurora — agora com rede de cáustica. Ver `aurora.ts` para
     o desvio inteiro: foram tentadas quatro formas em vidro PBR antes de ficar
     claro que superfície em volta da peça vira OBJETO, e objeto compete. O que
     envolve tem de ser ambiente, e ambiente é luz. */
  const aurora = useMemo(() => criarAurora(uniformes), [uniformes]);

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
      aurora.descartar();
    },
    [geoPedra, matPedra, geoNucleo, matNucleo, aurora, rig, fundo],
  );

  /* Cores de atenuação: o vidro muda de humor junto com o alerta.
     ATENÇÃO — estas duas MANDAM. O `useFrame` reescreve
     `matPedra.attenuationColor` todo quadro, então o valor declarado em
     `criarMaterialPedra` é só o estado inicial de um quadro; quem se vê na
     tela é sempre `corAgua` interpolada com `corAlerta`. Afinar a absorção
     mexendo lá e não aqui não muda um pixel — os dois lugares existem e
     precisam concordar. */
  const corAgua = useMemo(() => new Color(0xcedbe4), []);
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
    uniformes.uAlerta.value = quadro.alerta;

    // Ondulação orgânica: sempre viva, mais intensa com a voz.
    morphRef.current += passo * (0.1 + 0.3 * quadro.vel);
    uMorph.value = morphRef.current;
    /* Subiu de 0,14 para 0,19 de base (máximo 0,41 contra 0,33) para COMPENSAR
       a frequência mais baixa do campo, não para deformar mais. O relevo
       percebido vai com amplitude vezes frequência ao quadrado; a frequência
       caiu de 1,5 para 1,12, o que sozinho custaria quase metade do relevo
       visível. A amplitude devolve parte disso: mesma quantidade de forma,
       distribuída em dobras maiores em vez de caroços.

       Este número tem consequência em estudio.ts: o raio mínimo da silhueta vai
       de 0,67 para 0,59, e o RAIO_MAXIMO_RIG foi recontado junto. Mexer aqui
       sem mexer lá expõe as fontes do rig nuas ao lado da pedra. */
    uDeform.value = 0.19 + 0.06 * quadro.amp + 0.16 * quadro.amp * quadro.env;

    /* O tingimento do vidro segue o mesmo sinalizador das cortinas e do
       encante. Era deduzido da faixa de matiz (`m0 < 0,2`), o que fazia a cor
       do VIDRO depender de onde o estado calhava de cair no círculo — um
       acoplamento que ninguém declarou e que quebra sozinho toda vez que as
       faixas mudam. Um fato, um lugar. */
    matPedra.attenuationColor.copy(corAgua).lerp(corAlerta, quadro.alerta);

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
    /**
     * A distância vem do enquadramento corrente, não da constante do palco.
     * Este `set` roda a cada quadro: deixá-lo em `DISTANCIA_CAMERA` desfazia o
     * recuo do ícone no quadro seguinte ao que a câmera se posicionava — a
     * gema aparecia por um frame e sumia, que é pior que nunca aparecer,
     * porque parece defeito de renderização em vez de erro de enquadramento.
     */
    camera.position.set(
      0.022 * Math.sin(t * 0.0371),
      ALTURA_CAMERA + 0.016 * Math.sin(t * 0.0293 + 1.3),
      distanciaDoEnquadramento(estado.size.width, estado.size.height),
    );
    camera.lookAt(0, 0, 0);
  });

  return (
    <>
      {/* Direcionais recuadas: numa superfície de rugosidade 0,006 uma fonte
          pontual não vira realce, vira um ponto duro de um pixel — e ponto duro
          é a marca registrada de luz de cena 3D. Quem faz o realce agora são os
          difusores do estúdio, via ambiente, que é como um set real trabalha.
          Estas duas ficam só para dar direção e cor de temperatura ao volume. */}
      <directionalLight position={[-2.2, 3.0, 2.4]} intensity={0.85} color="#f5f9fd" />
      <directionalLight position={[2.4, -0.6, -2.2]} intensity={0.3} color="#a8cfff" />
      <primitive object={fundo.malha} />
      <primitive object={rig.grupo} />
      <mesh ref={pedraRef} geometry={geoPedra} material={matPedra} />
      <mesh ref={nucleoRef} geometry={geoNucleo} material={matNucleo} renderOrder={-4} />
      <group ref={fitasRef} rotation={[0.32, 0, 0]}>
        {aurora.cortinas.map((c, i) => (
          <mesh key={i} geometry={c.geo} material={c.mat} position={c.pos} rotation={c.rot} />
        ))}
      </group>
    </>
  );
}

/* ------------------------------------------------------------------------- */
/* Infraestrutura do palco (mesmos padrões do PalcoPresenca)                 */
/* ------------------------------------------------------------------------- */

function CameraEntidade() {
  const camera = useThree((e) => e.camera);
  const tamanho = useThree((e) => e.size);
  const invalidate = useThree((e) => e.invalidate);
  const distancia = distanciaDoEnquadramento(tamanho.width, tamanho.height);
  useEffect(() => {
    camera.position.set(0, ALTURA_CAMERA, distancia);
    camera.lookAt(0, 0, 0);
    (camera as PerspectiveCamera).updateProjectionMatrix();
    /**
     * Sem isto o reenquadramento só aparece no próximo quadro que alguém
     * pedir — e em repouso o frameloop é sob demanda (ver `RegenciaVisibilidade`).
     * Recolher a gema ficaria com a moldura nova e a câmera velha até a IARA
     * falar alguma coisa.
     */
    invalidate();
  }, [camera, distancia, invalidate]);
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

/**
 * Janela oculta não paga GPU: `never` na bandeja, `always` visível.
 *
 * `document.visibilityState` só cobre a aba inteira sumir (minimizar, trocar
 * de app). Desde 14/08/2026 a gema também some no celular por CSS puro
 * (`.presenca { display: none }` — ver globals.css), e display:none em um
 * ancestral zera o tamanho medido do Canvas sem disparar visibilitychange
 * nenhum: sem este segundo gatilho, o loop continuava rodando useFrame a
 * 60 Hz — câmera, respiração procedural, lipsync — para um canvas 0×0, o
 * tempo todo em que a conversa está aberta no celular (que hoje é o único
 * estado alcançável lá). `size` vem do próprio R3F, que já observa o
 * container por ResizeObserver; zero largura/altura é o mesmo sinal.
 */
function RegenciaVisibilidade() {
  const setFrameloop = useThree((e) => e.setFrameloop);
  const largura = useThree((e) => e.size.width);
  const altura = useThree((e) => e.size.height);
  useEffect(() => {
    const aoMudar = () => {
      const visivel = document.visibilityState === 'visible' && largura > 0 && altura > 0;
      setFrameloop(visivel ? 'always' : 'never');
    };
    aoMudar();
    document.addEventListener('visibilitychange', aoMudar);
    return () => document.removeEventListener('visibilitychange', aoMudar);
  }, [setFrameloop, largura, altura]);
  return null;
}

/**
 * O ÍCONE NÃO É OUTRA ARTE. Quando o palco encolhe para o círculo do celular, o
 * que muda é UMA coisa — a distância da câmera. Nada de material, nada de
 * animação, nada de shader, nenhuma imagem estática no lugar. É o mesmo objeto,
 * visto de perto, e é por isso que a miniatura continua reagindo ao que a IARA
 * está fazendo em vez de virar um selo parado no canto.
 */
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
      /* `far` com folga: o ciclorama mora em z = -13 e a câmera recuou para
         18.5, então o plano de fundo está a 31,5 da lente. Em 40 a margem ficou
         fina demais para o próximo recuo — 60 devolve espaço sem custo. */
      camera={{ fov: ABERTURA, near: 0.1, far: 60 }}
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


