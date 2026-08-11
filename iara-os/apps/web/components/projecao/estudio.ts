'use client';

/**
 * O estúdio — a iluminação da entidade, pensada como set de fotografia, não
 * como "luzes de cena 3D".
 *
 * Três coisas moram aqui, e as três existem pelo mesmo motivo: um material
 * óptico só parece real se tiver o que refletir e o que refratar. Vidro num
 * vazio preto vira plástico escuro.
 *
 *  1. `criarCenaEstudio()` — os softboxes que viram o ambiente por PMREM.
 *     São painéis com borda difusa (não retângulos chapados): borda dura
 *     entrega CG na hora, porque difusor de verdade tem queda.
 *
 *  2. `criarRigInterno()` — as fontes que ficam ATRÁS da pedra, dentro da
 *     silhueta dela. Transmissão em three é espaço de tela: o vidro só refrata
 *     o que foi desenhado no quadro. Fonte fora do enquadramento não aparece
 *     dentro da pedra — por isso as barras vivem escondidas atrás dela, e é
 *     delas que nascem os riscos de luz e os arcos de dispersão.
 *
 *  3. `criarFundo()` — o ciclorama. Quase preto, com uma poça de luz muito
 *     baixa: dá profundidade ao quadro e dá à borda do vidro algo para
 *     distorcer. Sem isso a borda refrata preto e some.
 *
 * Tudo aqui é da família AMBIENTE (invariante do repositório): nunca reage a
 * dado, nunca para. Quem reage a estado é o encante e as cortinas.
 */

import {
  AdditiveBlending,
  Color,
  DoubleSide,
  Group,
  Mesh,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
} from 'three';

/* ------------------------------------------------------------------------- */
/* Painel difuso — o tijolo de luz do estúdio                                */
/* ------------------------------------------------------------------------- */

/**
 * Softbox: retângulo com queda suave até a borda. `redondo` mistura a métrica
 * retangular com a elíptica (0 = strip reto, 1 = disco); `nucleo` controla o
 * quanto a luz se concentra no meio do difusor.
 *
 * `opaco` NÃO é sobre aparência — é sobre em que lista o objeto cai. A
 * transmissão do three é passe de tela e desenha APENAS a lista opaca: fonte
 * marcada `transparent` fica de fora do buffer que o vidro amostra e some de
 * dentro da pedra por completo. O rig interno depende disso — soma aditiva,
 * sem escrever profundidade, mas declarado opaco para entrar no passe.
 */
function materialPainel(
  cor: number,
  intensidade: number,
  redondo: number,
  nucleo: number,
  opaco = false,
) {
  return new ShaderMaterial({
    uniforms: {
      uCor: { value: new Color(cor).multiplyScalar(intensidade) },
      uRedondo: { value: redondo },
      uNucleo: { value: nucleo },
    },
    transparent: !opaco,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCor; uniform float uRedondo; uniform float uNucleo;
      varying vec2 vUv;
      void main(){
        vec2 p = abs(vUv - 0.5) * 2.0;
        float d = mix(max(p.x, p.y), length(p), uRedondo);
        float m = 1.0 - smoothstep(0.0, 1.0, d);
        m = pow(m, uNucleo);
        gl_FragColor = vec4(uCor * m, m);
      }
    `,
  });
}

interface Painel {
  cor: number;
  intensidade: number;
  larg: number;
  alt: number;
  x: number;
  y: number;
  z: number;
  redondo?: number;
  nucleo?: number;
}

/**
 * O set. Uma key grande e macia, duas strips longas (as strips é que fazem o
 * risco especular comprido que denuncia a forma), rim atrás, kicker quente e
 * uma bandeja de rebote embaixo — nenhum estúdio real é preto absoluto no
 * chão, e o vidro fica morto sem esse pouco de retorno.
 */
const PAINEIS: Painel[] = [
  /* key — difusor grande, alto à esquerda, à frente */
  { cor: 0xffffff, intensidade: 44, larg: 5.2, alt: 3.2, x: -3.6, y: 3.9, z: 3.2, redondo: 0.75, nucleo: 0.9 },
  /* strip fria à direita — o risco vertical longo */
  { cor: 0x9fd0ff, intensidade: 34, larg: 0.5, alt: 6.4, x: 5.2, y: 0.4, z: -0.4, redondo: 0.15, nucleo: 0.55 },
  /* strip quente embaixo à esquerda — o risco horizontal */
  { cor: 0xffc08a, intensidade: 22, larg: 3.8, alt: 0.42, x: -4.4, y: -2.9, z: -1.4, redondo: 0.15, nucleo: 0.6 },
  /* rim violeta, atrás e acima à direita */
  { cor: 0xc9a6ff, intensidade: 13, larg: 0.55, alt: 3.8, x: 2.9, y: 2.8, z: -4.2, redondo: 0.3, nucleo: 0.7 },
  /* kicker água atrás à esquerda */
  { cor: 0x7ff0d0, intensidade: 11, larg: 0.5, alt: 3.2, x: -5.0, y: 0.1, z: -3.0, redondo: 0.3, nucleo: 0.7 },
  /* pino quente baixo à direita, à frente — o toque coral do repertório */
  { cor: 0xffa060, intensidade: 9, larg: 1.8, alt: 0.4, x: 3.6, y: -3.2, z: 2.0, redondo: 0.4, nucleo: 0.8 },
  /* bandeja de rebote — quase nada, mas tira o vidro do preto morto */
  { cor: 0x0e1c1a, intensidade: 2.2, larg: 9.0, alt: 9.0, x: 0, y: -5.2, z: 0, redondo: 0.9, nucleo: 1.4 },
];

/** A cena que vira o `environment` por PMREM. Descartável logo após gerar. */
export function criarCenaEstudio(): Scene {
  const cena = new Scene();
  for (const p of PAINEIS) {
    const malha = new Mesh(
      new PlaneGeometry(p.larg, p.alt),
      materialPainel(p.cor, p.intensidade, p.redondo ?? 0.5, p.nucleo ?? 0.8),
    );
    malha.position.set(p.x, p.y, p.z);
    malha.lookAt(0, 0, 0);
    cena.add(malha);
  }
  return cena;
}

/** Libera geometria e material de uma cena de estúdio já consumida pelo PMREM. */
export function descartarCenaEstudio(cena: Scene): void {
  cena.traverse((o) => {
    if (o instanceof Mesh) {
      o.geometry.dispose();
      (o.material as ShaderMaterial).dispose();
    }
  });
}

/* ------------------------------------------------------------------------- */
/* Rig interno — as fontes que só existem vistas através da pedra            */
/* ------------------------------------------------------------------------- */

/**
 * LIMITE DE SILHUETA. A pedra tem raio 1 e a deformação a leva, no pior caso,
 * a ~0,67. Com a lente de 24° a 11,6, um ponto em z = −2,4 encolhe para 0,83×
 * na projeção. Por isso nada aqui passa de 0,62 medido do eixo até a ponta:
 * projetado dá 0,52, e mesmo no lóbulo mais fundo da ondulação a fonte
 * continua coberta pelo vidro e nunca é vista diretamente — só refratada.
 *
 * A verificação abaixo é guarda de regressão, não decoração: fonte que estoure
 * o limite simplesmente não entra na cena, porque aparecer nua ao lado da
 * pedra é pior do que faltar dentro dela.
 *
 * Se algum dia a deformação crescer, este é o número a revisitar.
 */
const RAIO_MAXIMO_RIG = 0.62;

interface Barra {
  cor: number;
  intensidade: number;
  larg: number;
  alt: number;
  x: number;
  y: number;
  z: number;
  giro: number;
  /** Fase da respiração — cada fonte pulsa no seu tempo, nunca em uníssono. */
  fase: number;
}

/**
 * Fonte larga e macia, não barra fina.
 *
 * A pedra tem dezenas de lóbulos e refrata cada um deles: fonte pequena e
 * dura vira dezenas de cópias pequenas e duras, e o interior lê como chuvisco
 * de arco-íris — que é precisamente a aparência de efeito. A mesma luz servida
 * como painel largo de queda longa devolve campos de cor amplos, com gradiente,
 * que é o que a referência tem. Difusor grande é a primeira coisa que um
 * fotógrafo escolhe para um objeto de faceta miúda, pelo mesmo motivo.
 */
const BARRAS: Barra[] = [
  { cor: 0x6fb6ff, intensidade: 1.0, larg: 0.34, alt: 0.78, x: -0.14, y: 0.03, z: -1.8, giro: 0.52, fase: 0.0 },
  { cor: 0xb48cff, intensidade: 0.85, larg: 0.30, alt: 0.66, x: 0.16, y: -0.08, z: -2.15, giro: -0.92, fase: 1.7 },
  { cor: 0x58e6c6, intensidade: 1.1, larg: 0.26, alt: 0.60, x: 0.02, y: 0.18, z: -1.3, giro: 1.94, fase: 3.4 },
  { cor: 0xffd98a, intensidade: 0.6, larg: 0.20, alt: 0.36, x: -0.12, y: -0.18, z: -1.5, giro: 0.16, fase: 5.1 },
  /* o ponto quente: é dele que saem os arcos de dispersão */
  { cor: 0xfff4e8, intensidade: 1.9, larg: 0.30, alt: 0.30, x: 0.0, y: 0.02, z: -2.4, giro: 0, fase: 2.5 },
];

export interface RigInterno {
  grupo: Group;
  /** Respiração das fontes — amplitude minúscula, ciclos longos. */
  animar(t: number): void;
  descartar(): void;
}

export function criarRigInterno(): RigInterno {
  const grupo = new Group();
  const materiais: ShaderMaterial[] = [];
  const geometrias: PlaneGeometry[] = [];
  const bases: Color[] = [];

  for (const b of BARRAS) {
    const raio = Math.hypot(b.x, b.y) + Math.max(b.larg, b.alt) * 0.5;
    if (raio > RAIO_MAXIMO_RIG) {
      // Fonte fora do cone seguro apareceria ao lado do vidro — não entra.
      continue;
    }
    const geo = new PlaneGeometry(b.larg, b.alt);
    /* Sempre elíptico, nunca retangular. A pedra comprime a derivada do que
       refrata: uma queda suave pode virar borda dura depois da lente, e uma
       borda dura reta dentro do vidro lê como retângulo colado — artefato, não
       óptica. Poça de luz sem canto não tem como virar retângulo. */
    const mat = materialPainel(b.cor, b.intensidade, 1.0, 0.55, true);
    const malha = new Mesh(geo, mat);
    malha.position.set(b.x, b.y, b.z);
    malha.rotation.z = b.giro;
    // Depois do ciclorama, antes da pedra: soma aditiva precisa do fundo já
    // escrito, senão o ciclorama passa por cima do que ela somou.
    malha.renderOrder = -5;
    grupo.add(malha);
    materiais.push(mat);
    geometrias.push(geo);
    bases.push((mat.uniforms.uCor.value as Color).clone());
  }

  return {
    grupo,
    animar(t: number) {
      // O rig gira só no próprio plano: rotação em y jogaria as barras para
      // fora da silhueta. Uma oscilação mínima em y basta para o risco
      // interno deslizar sem sair do esconderijo.
      grupo.rotation.z = t * 0.031;
      grupo.rotation.y = 0.09 * Math.sin(t * 0.047);
      for (let i = 0; i < materiais.length; i += 1) {
        const b = BARRAS[i];
        const pulso = 0.82 + 0.18 * Math.sin(t * (0.07 + i * 0.013) + b.fase);
        (materiais[i].uniforms.uCor.value as Color).copy(bases[i]).multiplyScalar(pulso);
      }
    },
    descartar() {
      for (const g of geometrias) g.dispose();
      for (const m of materiais) m.dispose();
    },
  };
}

/* ------------------------------------------------------------------------- */
/* Ciclorama                                                                 */
/* ------------------------------------------------------------------------- */

export interface Fundo {
  malha: Mesh;
  descartar(): void;
}

/**
 * O fundo do estúdio. Quase preto — a poça central mal chega a 4% de luz —
 * mas é sobre ela que a borda do vidro se desenha. Fundo chapado devolve
 * refração invisível, que é a diferença entre "vidro" e "bola escura".
 */
export function criarFundo(): Fundo {
  const geo = new PlaneGeometry(48, 30);
  const mat = new ShaderMaterial({
    uniforms: { uCentro: { value: new Color(0x0a1614) }, uBorda: { value: new Color(0x010303) } },
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uCentro; uniform vec3 uBorda;
      varying vec2 vUv;
      void main(){
        vec2 p = (vUv - vec2(0.5, 0.52)) * vec2(1.9, 1.0);
        float d = length(p);
        // O plano tem 48 por 30 e a lente enquadra ~10 de altura nele: uma
        // poça de raio 0,26 em UV cobriria o quadro inteiro e viraria névoa.
        // 0,09 é do tamanho da pedra, que é o que uma poça de estúdio deve ser.
        float poca = 1.0 - smoothstep(0.005, 0.09, d);
        vec3 c = mix(uBorda, uCentro, poca);
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const malha = new Mesh(geo, mat);
  malha.position.set(0, 0.4, -13);
  // Primeiro de todos: é sobre ele que o rig soma.
  malha.renderOrder = -10;
  return {
    malha,
    descartar() {
      geo.dispose();
      mat.dispose();
    },
  };
}
