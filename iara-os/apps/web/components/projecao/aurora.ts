'use client';

/**
 * A aurora aquática — as cortinas de luz em volta da entidade.
 *
 * ESTE ARQUIVO É O RESULTADO DE UM DESVIO, e vale registrar o desvio inteiro
 * porque a conclusão dele não é óbvia.
 *
 * A cortina original era aditiva e foi criticada por "não parecer da mesma
 * tela" que a pedra. O diagnóstico pareceu evidente: a pedra é PBR, iluminada
 * pelo estúdio; a cortina é luz emitida que ignora a iluminação. Duas
 * linguagens de renderização no mesmo quadro. Então a cortina foi refeita em
 * `MeshPhysicalMaterial` — e passou por quatro formas, todas recusadas: fita
 * torcida, argola, lençóis de vidro, filete d'água com bojo e pescoço.
 *
 * O QUE O DESVIO ENSINOU: superfície de vidro em volta da peça vira OBJETO, e
 * objeto compete. Anel, fita, lençol — todos leem como coisa pendurada em
 * torno da bolha, por melhor que esteja o material. O que envolve tem de ser
 * AMBIENTE, e ambiente é luz. A cortina aditiva estava certa desde o começo; o
 * que faltava nela não era matéria, era DESENHO.
 *
 * E o desenho que faltava é a cáustica. Debaixo d'água a luz não chega em
 * filetes retos: chega numa rede de fios claros que serpenteiam, se cruzam, se
 * fecham em malhas e se abrem de novo — o padrão no fundo de uma piscina. É a
 * assinatura mais reconhecível de água que existe, e é feita de refração, não
 * de material. Uma cortina aditiva pode desenhá-la; um anel de vidro, não.
 *
 * O que sobreviveu do desvio, e vale manter: a geometria não usa harmônico
 * inteiro do ângulo (isso fazia roseta), o estado escolhe uma janela da paleta
 * da marca em vez de tingir por fora, e o alerta tem sinalizador próprio.
 */

import {
  AdditiveBlending,
  CylinderGeometry,
  DoubleSide,
  ShaderMaterial,
  type BufferGeometry,
} from 'three';
import { GLSL_COMUM, GLSL_PALETA } from './glsl';

/** O vocabulário de uniformes que a cortina lê do controlador da entidade. */
export interface UniformesAurora {
  uT: { value: number };
  uAmp: { value: number };
  uVel: { value: number };
  uEnv: { value: number };
  uRaio: { value: number };
  uBrilho: { value: number };
  uMatiz: { value: { x: number; y: number } };
  uAlerta: { value: number };
}

/* ------------------------------------------------------------------------- */
/* Material                                                                  */
/* ------------------------------------------------------------------------- */

function criarMaterialCortina(uniformes: UniformesAurora, indice: number, forca: number) {
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

        /* Ruído amostrado no CÍRCULO, nunca harmônico inteiro do ângulo.
           sin(5*ang) fecha a volta em cinco lóbulos iguais e igualmente
           espaçados, e lóbulo repetido em torno de um centro é a definição de
           pétala — foi a crítica da flor. Amostrar em (cos, sen) também elimina
           a costura: ang = pi encontra ang = -pi sendo o mesmo ponto.

           Dois campos contrarrotativos, em +0,21 e -0,13. Como as taxas não têm
           razão racional simples, as camadas passam uma pela outra sem nunca
           voltar ao mesmo arranjo, e o olho não encontra o ponto onde a
           animação recomeça. */
        vec2 dir = vec2(cos(ang), sin(ang));
        float g1 = uT*uVel*0.21 + uIdx*2.1;
        float g2 = -uT*uVel*0.13 + uIdx*4.7;
        vec2 d1 = vec2(dir.x*cos(g1) - dir.y*sin(g1), dir.x*sin(g1) + dir.y*cos(g1));
        vec2 d2 = vec2(dir.x*cos(g2) - dir.y*sin(g2), dir.x*sin(g2) + dir.y*cos(g2));

        float ondaViaja = (noise(vec3(d2*2.9, uT*0.11 + uIdx*6.0)) - 0.5)*2.0
                        + (noise(vec3(d1*4.9, uT*0.16 + uIdx*2.0)) - 0.5)*1.0;
        float dobraLenta = (noise(vec3(d1*1.4, uT*0.05 + uIdx*9.0)) - 0.5)*0.62
                         + (noise(vec3(d2*2.6, uT*0.08 + uIdx*3.0)) - 0.5)*0.30;

        /* O piso de 0,72 é o que se vê em repouso: com a IARA ociosa o termo da
           voz contribui com menos de um décimo, então quem desenha o movimento
           no estado mais comum do produto é o PISO, não a fala.
           O chicote — a amplitude crescendo com a altura, 0,18 na base e 0,44
           no topo — é o que faz a ponta solta ondular mais que o pé, como pano
           pendurado. Sem esse gradiente o lençol ondula rígido e lê como tubo. */
        float forca = 0.72 + 0.7*uAmp*(0.3 + uEnv);
        float fator = uRaio * (1.0 + dobraLenta*forca*0.85 + ondaViaja*forca*(0.18 + 0.26*vy));
        p.x *= fator; p.z *= fator;
        p.y += (0.10 + 0.10*vy) * (noise(vec3(d1*2.3, uT*0.07 + uIdx*5.0)) - 0.5)*2.0
             + 0.10 * ondaViaja * uAmp * (0.3 + uEnv) * vy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uT, uBrilho, uIdx, uForca, uAlerta; uniform vec2 uMatiz;
      varying vec2 vUv;
      ${GLSL_COMUM}
      ${GLSL_PALETA}

      /**
       * A REDE DE CÁUSTICA — o efeito aquático, e a única novidade real desta
       * versão. Duas coisas a produzem, e faltavam as duas:
       *
       *  · DOMÍNIO DOBRADO DUAS VEZES. Uma dobra faz o filete ondular; duas
       *    fazem ele meandrar, voltar sobre si e se cruzar. É a diferença
       *    entre uma onda e uma REDE, e rede é o que se vê no fundo d'água.
       *
       *  · CRISTA, e não mancha. 1 - abs(2n - 1) transforma o ruído em LINHA:
       *    o valor cai a zero em todo lugar menos onde o ruído passa pelo meio,
       *    e ali sobe a um. Ruído cru dá manchas suaves, que é névoa. Cáustica
       *    é fio fino e claro com escuro em volta — e a potência no fim é o que
       *    estreita o fio.
       */
      float caustica(vec2 q, float t){
        float w1 = noise(vec3(q*1.6, t*0.09));
        vec2 q1 = q + vec2(w1, -w1)*0.95;
        float w2 = noise(vec3(q1*3.1 + 5.0, t*0.13));
        vec2 q2 = q1 + vec2(-w2, w2)*0.55;
        float n = noise(vec3(q2*5.0, t*0.07));
        float crista = 1.0 - abs(2.0*n - 1.0);
        return pow(crista, 3.2);
      }

      void main(){
        float v = vUv.y;

        // Duas escalas da rede: a larga dá a malha, a fina dá o fio de dentro.
        vec2 q = vec2(vUv.x*7.5 + uIdx*3.0, v*2.2);
        float rede = 0.62*caustica(q, uT + uIdx*11.0)
                   + 0.38*caustica(q*2.15 + 13.0, uT*0.72 + uIdx*5.0);

        /* O riscado vertical da aurora não sumiu: ficou como VÉU de fundo, com
           menos de um terço do peso. Ele é a lembrança de cortina; a rede é a
           água. Tirar os dois deixaria a cortina lisa, e lisa é chapa. */
        float veu = noise(vec3(vUv.x*95.0 + uIdx*13.0, v*1.7 - uT*0.10, uT*0.08));

        /* Topo ondulado por ângulo, terminação em cúpula — nunca corte reto.
           Amostrado no círculo pelo mesmo motivo do vértice: em vUv.x cru o
           ruído não fecha a volta e deixa um vinco vertical na costura. */
        float aTopo = vUv.x*6.28318530718;
        float topo = 0.55 + 0.35*noise(vec3(cos(aTopo)*1.9, sin(aTopo)*1.9, uT*0.08 + uIdx*4.0));
        float vn = clamp(v / topo, 0.0, 1.0);
        // A base é o lugar mais aceso de uma aurora real; o topo dissolve alto.
        float perfil = smoothstep(0.0, 0.14, v) * pow(1.0 - vn*vn, 2.2);

        /* Piso baixo (0,14) porque é o VÃO que faz a rede existir. Com piso
           alto, boa parte do brilho vira chapa uniforme e o fio de cáustica
           não tem de onde se destacar — vira névoa de novo, que foi o defeito
           de todas as versões leitosas. */
        float corpo = 0.14 + 0.86*mix(0.70*rede + 0.30*veu, 0.45, smoothstep(0.40, 0.95, vn));

        /* O ESTADO ESCOLHE UMA JANELA da paleta da marca, e o gradiente local
           só percorre essa faixa. Antes o estado entrava como tingimento HSV
           por fora, a 18% de peso, contra um gradiente que varria a paleta
           inteira sozinho — o sinal chegava com ~6% de força e nenhum estado
           podia parecer diferente de outro. O domain warping continua, agora
           fazendo o papel de corrente. */
        float w1 = noise(vec3(vUv.x*3.0 + uT*0.15, v*2.0, uIdx*2.0));
        float w2 = noise(vec3(vUv.x*2.0 - uT*0.10, v*1.5 + w1*1.5, uIdx*2.0 + 5.0));
        float tLocal = fract(vUv.x + w2*0.7 - uT*0.05 + uIdx*0.3);
        vec3 c = paletaMarca(mix(uMatiz.x, uMatiz.y, tLocal));

        // Coral não é cor da paleta: é a saída dela, e é por não pertencer ao
        // espectro do cromo que funciona como alerta. Entra por cima.
        c = mix(c, vec3(0.941, 0.529, 0.416), uAlerta * 0.9);

        c = c * c * 1.7; // satura — soma aditiva tende ao branco sem isso
        /* Dessatura DEPOIS do quadrado. Quadrar é operação por canal: ela
           afasta os canais entre si, ou seja, satura. Dessaturar antes e
           quadrar depois desfaz metade do trabalho — foi assim que a cortina
           continuou verde mesmo com a mistura em 62%. */
        float lumaC = dot(c, vec3(0.2126, 0.7152, 0.0722));
        c = mix(c, vec3(lumaC), mix(0.22, 0.06, uAlerta));
        /* Guarda de matiz. Filme fino sobre metal polido percorre azul,
           violeta e champanhe, e nunca passa pelo verde — mas metade do
           caminho até a tela é operação por canal (o quadrado acima, o ACES do
           passe de lente), e operação por canal não sabe o que é matiz: ela
           abre a distância entre os canais e, num ciano discreto, quem cresce é
           o verde. Em vez de perseguir cada operação, o invariante fica
           declarado aqui: o verde nunca lidera. */
        c.g = min(c.g, max(c.r, c.b));

        gl_FragColor = vec4(paraLinear(c * corpo * perfil * uBrilho * 1.05 * uForca, 1.5), 1.0);
      }
    `,
  });
}

/* ------------------------------------------------------------------------- */
/* Montagem                                                                  */
/* ------------------------------------------------------------------------- */

export interface Cortina {
  geo: BufferGeometry;
  mat: ShaderMaterial;
  pos: [number, number, number];
  rot: [number, number, number];
}

export interface Aurora {
  cortinas: Cortina[];
  descartar(): void;
}

/**
 * Três cortinas, e cada uma com EIXO PRÓPRIO.
 *
 * Concêntrico e coaxial é metade do problema da pétala: por mais irregular que
 * fique o contorno de cada uma, três cilindros que compartilham o centro leem
 * como miolo e pétalas. Inclinando cada uma alguns graus em eixos diferentes e
 * deslocando o centro em frações de unidade, o que aparece é um empilhamento
 * de lençóis à deriva. Os ângulos são pequenos (menos de 10°) e as translações
 * menores que um sexto do raio: não é para ser visto como desalinhamento, é
 * para não haver eixo de simetria a encontrar.
 *
 * Os raios ficam entre 1,72 e 2,68 — aproximados da peça a pedido, depois de
 * o desenho ser aprovado. A altura acompanhou na mesma proporção: cortina que
 * chega mais perto e continua alta cobre a pedra em vez de envolvê-la, porque
 * o que encurta com o raio é a distância, não a extensão vertical.
 *
 * O limite inferior é a própria silhueta: a pedra chega a 1,41 de raio no
 * lóbulo mais alto da deformação, e a modulação da cortina já a leva bem para
 * dentro disso em parte da volta. Isso é intencional e só funciona porque a
 * cortina é ADITIVA e não escreve profundidade — ela soma luz onde cruza a
 * peça em vez de recortá-la. Se um dia esta camada deixar de ser aditiva, os
 * raios têm de subir junto, ou a cortina passa a cortar a pedra ao meio.
 *
 * Mais longe (foi tentado 3,8) elas saem do enquadramento e o que sobra na
 * tela é a franja, que é a parte que menos tem desenho.
 */
export function criarAurora(uniformes: UniformesAurora): Aurora {
  const alturas = [0.92, 1.12, 1.38];
  const raios = [1.72, 2.18, 2.68];
  const forcas = [1.0, 0.62, 0.38];
  const posicoes: [number, number, number][] = [
    [0, 0.08, 0],
    [0.24, 0.14, -0.16],
    [-0.31, 0.2, 0.22],
  ];
  const rotacoes: [number, number, number][] = [
    [0, 0, 0],
    [0.14, 0.9, -0.08],
    [-0.11, 2.1, 0.15],
  ];

  const cortinas: Cortina[] = raios.map((raio, i) => ({
    geo: new CylinderGeometry(raio, raio * 1.03, alturas[i], 320, 48, true),
    mat: criarMaterialCortina(uniformes, i, forcas[i]),
    pos: posicoes[i],
    rot: rotacoes[i],
  }));

  return {
    cortinas,
    descartar() {
      for (const c of cortinas) {
        c.geo.dispose();
        c.mat.dispose();
      }
    },
  };
}
