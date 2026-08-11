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
 * O set — reescrito para cromo.
 *
 * O set anterior era um set de JOIA: fontes médias, coloridas, distribuídas em
 * volta. Funciona para uma pedra que se vê por dentro, e foi por isso que ele
 * existiu. Superfície de espelho não tem interior para mostrar: o que ela
 * mostra é o estúdio, e um estúdio de fontes médias vira, num espelho curvo,
 * um punhado de manchas pequenas — que é exatamente a "aparência de renderizado"
 * que o pedido recusa.
 *
 * A gramática de fotografar cromo é outra, e tem duas peças obrigatórias:
 *
 *  · O CÉU. Um difusor enorme em cima, de queda longa. Num corpo esférico ele
 *    se enrola como uma varredura contínua do alto até o equador — é a única
 *    coisa que produz aquele degradê branco largo e sem costura que toda foto
 *    de cromo tem. Painel pequeno não faz varredura, faz ponto.
 *
 *  · O HORIZONTE. Um chão grande e escuro embaixo. O espelho reflete a metade
 *    de baixo do mundo, e se essa metade for vazio preto o objeto perde o
 *    fundo do corpo e passa a flutuar sem massa. O chão escuro é o que dá a
 *    linha onde claro e escuro se encontram — a assinatura visual de cromo.
 *
 * As strips continuam, porque são elas que fazem o risco especular comprido, e
 * as fontes de cor continuam, porque a identidade é da IARA — mas todas
 * recuaram em intensidade e subiram em brancura. Num espelho, cor de fonte vira
 * cor de objeto: o mesmo lilás que era um toque na pedra translúcida pintaria a
 * peça inteira de lilás aqui.
 */
const PAINEIS: Painel[] = [
  /* céu — o difusor de teto. A varredura contínua do alto do cromo é ele. */
  { cor: 0xffffff, intensidade: 30, larg: 15.0, alt: 10.0, x: 0, y: 6.8, z: 1.6, redondo: 0.85, nucleo: 1.15 },
  /* key — difusor grande, alto à esquerda, à frente */
  { cor: 0xffffff, intensidade: 42, larg: 7.2, alt: 4.4, x: -3.8, y: 3.5, z: 3.4, redondo: 0.8, nucleo: 1.0 },
  /* A PLACA DE REBOTE, atrás da câmera. É o que faltava, e é a razão de a peça
     chegar escura mesmo com key forte.
     Um espelho não tem meia-luz própria: cada ponto da superfície mostra o que
     está na direção espelhada, e num estúdio de fontes isoladas a maior parte
     dessas direções aponta para vazio preto. Foi isso que se viu — uma peça
     acesa em três lugares e morta no resto, que é aparência de renderizado.
     A referência em p&b não tem fonte a mais: tem uma PAREDE inteira na frente
     do objeto, e é ela que preenche a face voltada para a câmera com um
     degradê em vez de preto.
     Fica em z = 7,0, atrás da câmera (que está em 18,5): nunca é vista
     diretamente, só refletida — que é exatamente o papel de uma placa. */
  { cor: 0xffffff, intensidade: 17, larg: 15.0, alt: 10.0, x: 0.6, y: 1.0, z: 7.0, redondo: 0.85, nucleo: 1.2 },
  /* strip fria à direita — o risco vertical longo */
  { cor: 0xdae9ff, intensidade: 27, larg: 0.44, alt: 7.4, x: 5.2, y: 0.4, z: -0.3, redondo: 0.12, nucleo: 0.5 },
  /* strip quente embaixo à esquerda — o risco horizontal */
  { cor: 0xffe8d6, intensidade: 10, larg: 4.6, alt: 0.4, x: -4.4, y: -2.9, z: -1.3, redondo: 0.12, nucleo: 0.55 },
  /* rim violeta, atrás e acima à direita */
  { cor: 0xd6c2ff, intensidade: 7.5, larg: 0.5, alt: 4.2, x: 2.9, y: 2.8, z: -4.2, redondo: 0.28, nucleo: 0.7 },
  /* kicker frio atrás à esquerda. Era menta (0xa8ece0) e ficava verde na
     superfície: num espelho a cor da fonte vira a cor do objeto, e o verde não
     tem de onde vir depois da PALETA GRAFITE. */
  { cor: 0xbdd8ea, intensidade: 6.0, larg: 0.48, alt: 3.6, x: -5.0, y: 0.1, z: -3.0, redondo: 0.28, nucleo: 0.7 },
  /* pino quente baixo à direita, à frente — o toque coral do repertório */
  { cor: 0xffbb8c, intensidade: 4.5, larg: 1.8, alt: 0.4, x: 3.6, y: -3.2, z: 2.0, redondo: 0.4, nucleo: 0.8 },
  /* o chão — grande, grafite, discreto. É o horizonte. Sobe junto com o resto
     porque a metade de baixo do espelho é ele: chão apagado devolve barriga
     preta, e a peça perde o fundo do corpo. */
  { cor: 0x2b353b, intensidade: 5.0, larg: 14.0, alt: 11.0, x: 0, y: -5.4, z: 0, redondo: 0.9, nucleo: 1.1 },
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
 * a 1 − 0,41 = 0,59 (o `uDeform` máximo mora em `EntidadePresenca`, no
 * `useFrame`; ele subiu de 0,33 para 0,41 quando a frequência do campo caiu e
 * a amplitude teve de compensar). Com a lente de 24° a 18,5, um ponto em
 * z = −2,4 encolhe para 0,885×
 * na projeção. Por isso nada aqui passa de 0,55 medido do eixo até a ponta:
 * projetado dá 0,49, e mesmo no lóbulo mais fundo da ondulação a fonte
 * continua coberta pelo vidro e nunca é vista diretamente — só refratada.
 *
 * A verificação abaixo é guarda de regressão, não decoração: fonte que estoure
 * o limite simplesmente não entra na cena, porque aparecer nua ao lado da
 * pedra é pior do que faltar dentro dela. Hoje a fonte mais larga mede 0,533,
 * então todas passam — a folga é de sete centésimos, não de meia unidade.
 *
 * O RECUO DA CÂMERA (11,6 → 14,8) MEXE NESTA CONTA e por isso está anotado:
 * quanto mais longe a câmera, MENOS o rig encolhe na projeção (0,83× em 11,6
 * virou 0,885× em 18,5), ou seja, ele fica proporcionalmente maior dentro da
 * silhueta. A margem CAI a cada recuo, não sobe — é contra-intuitivo e é o
 * motivo de esta conta estar escrita por extenso.
 * Hoje: 0,49 projetado contra 0,59 de silhueta mínima. Sobram dez centésimos.
 * No limite (câmera no infinito) o fator vai a 1 e o rig projetaria 0,533 —
 * ainda cabe, mas com folga de seis centésimos. Ou seja: recuar mais é seguro,
 * ENGORDAR o rig ou a deformação da pedra é que não é.
 *
 * Se a deformação crescer de novo, este é o número a revisitar, e o cálculo
 * inteiro está acima para poder ser refeito em vez de chutado.
 */
const RAIO_MAXIMO_RIG = 0.55;

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
 * O ciclorama — laca preta, não vazio preto.
 *
 * A versão anterior era preta chapada com uma poça central minúscula (raio
 * 0,09 em UV, do tamanho da própria pedra). Na tela isso não lê como fundo:
 * lê como AUSÊNCIA de fundo, e objeto sobre ausência é o formato de imagem
 * gerada — falta o quarto onde a coisa está.
 *
 * O que substitui é a superfície que o pedido nomeia: piano black. Laca preta
 * de verdade nunca é uma cor só — é um gradiente longo e sem costura que vai do
 * grafite iluminado ao quase-nada, com uma reflexão macia onde a luz do
 * ambiente bate. Três camadas fazem isso, nesta ordem:
 *
 *  1. o degradê vertical, longo — a laca pegando a luz do céu do estúdio;
 *  2. a poça atrás da peça, larga e de baixíssimo contraste — profundidade,
 *     não holofote. É ela que dá à borda do cromo algo para distorcer;
 *  3. o fechamento nos cantos, que é onde a laca escurece de verdade.
 *
 * O grão e o dither do passe de lente são obrigatórios com um fundo assim: um
 * degradê deste comprimento em 8 bits sem ruído vira faixa, e faixa entrega
 * digital na hora. Eles já estão lá (`composicao.ts`) — esta é a razão.
 */
export function criarFundo(): Fundo {
  const geo = new PlaneGeometry(48, 30);
  const mat = new ShaderMaterial({
    uniforms: {
      uAlto: { value: new Color(0x2a3238) },
      uBaixo: { value: new Color(0x0b0e10) },
      uPoca: { value: new Color(0x1a2126) },
    },
    side: DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uAlto; uniform vec3 uBaixo; uniform vec3 uPoca;
      varying vec2 vUv;
      void main(){
        // O plano tem 48 por 30 e a lente enquadra ~10 de altura nele: o
        // quadro inteiro vive na faixa vUv.y ≈ 0,33..0,67. Todos os intervalos
        // abaixo estão medidos NESSA faixa, não no plano inteiro.
        vec2 p = (vUv - vec2(0.5, 0.53)) * vec2(1.9, 1.0);
        float d = length(p);
        float v = smoothstep(0.30, 0.72, vUv.y);
        vec3 c = mix(uBaixo, uAlto, v);
        c += uPoca * (1.0 - smoothstep(0.02, 0.26, d));
        // fechamento: a laca não termina, ela some
        c *= mix(0.30, 1.0, 1.0 - smoothstep(0.12, 0.60, d));
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
