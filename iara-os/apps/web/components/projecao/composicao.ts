'use client';

/**
 * A câmera — a última etapa entre a cena e a tela.
 *
 * O que separa um render 3D de uma fotografia raramente é o material: é o que
 * a lente e o sensor fazem depois. Um objeto óptico filmado tem estouro nos
 * realces, tem separação cromática mínima nas bordas do quadro, tem queda de
 * luz nos cantos e tem grão. Sem isso a imagem fica limpa demais para ser real.
 *
 * Cada passe aqui tem justificativa física, que é a regra de ouro do pedido:
 *  - `UnrealBloomPass` — o estouro do realce especular no vidro da lente;
 *  - aberração cromática radial — dispersão da própria lente, ínfima;
 *  - vinheta — queda de iluminação do sistema óptico nos cantos;
 *  - ACES + sRGB — a resposta do sensor, feita aqui porque com composer o
 *    renderer não aplica tone mapping (ele só o faz desenhando direto na tela);
 *  - grão e dither — ruído de sensor, mais presente na sombra, e a única
 *    defesa contra banding em gradiente quase preto. Sem o dither, o degradê
 *    do fundo vira faixa e a imagem entrega que é digital.
 *
 * O antialiasing não é passe: é MSAA no alvo do composer (`amostras`), que
 * resolve borda geométrica melhor e mais barato que um filtro de imagem.
 */

import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type Camera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

/* ------------------------------------------------------------------------- */
/* Passe de lente e sensor                                                   */
/* ------------------------------------------------------------------------- */

const ShaderLente = {
  uniforms: {
    tDiffuse: { value: null as unknown },
    /* Dispersão de lente em três milésimos, não quatro e meio. Sobre um fundo
       chapado ninguém a via; sobre um degradê de laca ela vira franja colorida
       visível na borda do quadro, e franja visível não é lente boa — é lente
       ruim. O papel dela aqui é ser sentida, nunca notada. */
    uAberracao: { value: 0.003 },
    uVinheta: { value: 0.58 },
    /* Abaixo de 0,6 a curva ACES deixa de ter o pré-ganho que preserva o
       cinza médio e passa a fechar a sombra. É intencional: a referência é
       estúdio preto, e preto de estúdio é preto — não cinza levantado. */
    uExposicao: { value: 0.86 },
    uGrao: { value: 0.016 },
    uTempo: { value: 0 },
    uProporcao: { value: 1.6 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uAberracao, uVinheta, uExposicao, uGrao, uTempo, uProporcao;
    varying vec2 vUv;

    vec3 ajusteACES(vec3 v){
      vec3 a = v * (v + 0.0245786) - 0.000090537;
      vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
      return a / b;
    }
    vec3 aces(vec3 cor){
      const mat3 entrada = mat3(
        0.59719, 0.07600, 0.02840,
        0.35458, 0.90834, 0.13383,
        0.04823, 0.01566, 0.83777
      );
      const mat3 saida = mat3(
         1.60475, -0.10208, -0.00327,
        -0.53108,  1.10813, -0.07276,
        -0.07367, -0.00605,  1.07602
      );
      cor *= uExposicao / 0.6;
      cor = entrada * cor;
      cor = ajusteACES(cor);
      cor = saida * cor;
      return clamp(cor, 0.0, 1.0);
    }
    vec3 paraSRGB(vec3 c){
      return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055, step(vec3(0.0031308), c));
    }
    float ruido(vec2 p){
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);

      // Dispersão da lente: separação radial, quadrática do centro para a
      // borda — no centro do quadro é literalmente zero, como numa lente boa.
      float k = uAberracao * r2;
      vec3 cor;
      cor.r = texture2D(tDiffuse, vUv - c * k).r;
      cor.g = texture2D(tDiffuse, vUv).g;
      cor.b = texture2D(tDiffuse, vUv + c * k).b;

      // Queda de iluminação nos cantos, medida na proporção real do quadro.
      float raio = length(c * vec2(uProporcao, 1.0));
      float vinheta = smoothstep(1.05, 0.28, raio);
      cor *= mix(1.0, vinheta, uVinheta);

      cor = paraSRGB(aces(cor));

      // Grão de sensor: mais visível na sombra, como em qualquer captura real,
      // e forte o bastante para quebrar o banding do fundo quase preto.
      float luma = dot(cor, vec3(0.2126, 0.7152, 0.0722));
      float g = ruido(gl_FragCoord.xy + fract(uTempo) * 91.7);
      cor += (g - 0.5) * uGrao * (1.0 - 0.65 * luma);

      gl_FragColor = vec4(cor, 1.0);
    }
  `,
};

/* ------------------------------------------------------------------------- */
/* Montagem                                                                  */
/* ------------------------------------------------------------------------- */

export interface Composicao {
  renderizar(t: number): void;
  redimensionar(largura: number, altura: number, densidade: number): void;
  descartar(): void;
}

export interface OpcoesComposicao {
  /** Estouro de realce. Desligado em máquina fraca — é o passe mais caro. */
  bloom: boolean;
  /** Amostras de MSAA no alvo do composer (0 desliga). */
  amostras: number;
}

export function criarComposicao(
  gl: WebGLRenderer,
  cena: Scene,
  camera: Camera,
  opcoes: OpcoesComposicao,
): Composicao {
  const alvo = new WebGLRenderTarget(1, 1, {
    type: HalfFloatType,
    samples: opcoes.amostras,
  });

  const composer = new EffectComposer(gl, alvo);
  composer.addPass(new RenderPass(cena, camera));

  let bloom: UnrealBloomPass | null = null;
  if (opcoes.bloom) {
    /* Raio curto e limiar alto: só o que já estourou na cena floresce, e
       floresce perto. Com raio largo o estouro atravessa a franja da aurora,
       preenche o vão entre um risco e o seguinte e transforma a cortina de luz
       numa fita de cetim — deixa de ser luz e vira pano. Halo largo é
       assinatura de videogame; lente de verdade espalha pouco e perto. */
    bloom = new UnrealBloomPass(new Vector2(1, 1), 0.2, 0.12, 1.25);
    composer.addPass(bloom);
  }

  const lente = new ShaderPass(ShaderLente as unknown as { uniforms: Record<string, { value: unknown }> });
  lente.renderToScreen = true;
  composer.addPass(lente);

  return {
    renderizar(t: number) {
      lente.uniforms.uTempo.value = t;
      composer.render();
    },
    redimensionar(largura: number, altura: number, densidade: number) {
      composer.setPixelRatio(densidade);
      composer.setSize(largura, altura);
      lente.uniforms.uProporcao.value = altura > 0 ? largura / altura : 1.6;
    },
    descartar() {
      bloom?.dispose();
      lente.dispose();
      composer.dispose();
      alvo.dispose();
    },
  };
}
