/**
 * A MARCA IARA — o contrato da identidade.
 *
 * A identidade da IARA NÃO é um logotipo desenhado: é uma FOTOGRAFIA de uma
 * escultura de cromo. Reflexo, especular, profundidade e distorção são o
 * material da marca, não enfeite dela — e material não se desenha, se
 * fotografa. As imagens de origem estão em `ativos/referencia/`; tudo o
 * que a aplicação usa é recorte delas, feito por `scripts/gerar-marca.ts`.
 *
 * Este módulo guarda só o que é FATO da marca e não vem da fotografia: a
 * paleta e as letras. Um fato, um lugar.
 *
 * Duas tentativas anteriores foram descartadas pelo cliente — a cabeça
 * desenhada em gradientes SVG, e depois esculpida em three.js. As duas leram
 * como ilustração de robô, que é exatamente o que a marca não é. Sobrou a
 * tipografia, que é desenho por natureza.
 */

/* --------------------------------------------------------------------------
 * Paleta. Acromática por decisão: a sofisticação vem da luz e do metal, nunca
 * de cor. A cor viva do produto pertence à entidade dentro da sala — a marca
 * fica em cromo, prata, grafite e preto.
 * -------------------------------------------------------------------------- */

export const CROMO = {
  /** cinza de estúdio: o fundo do retrato */
  estudio_claro: '#d8dbdf',
  estudio: '#b4b8bd',
  estudio_escuro: '#8d9298',

  especular: '#ffffff',
  luz: '#eef1f4',
  prata: '#c4cad0',
  medio: '#878e96',
  grafite: '#3c4147',
  sombra: '#15181c',
  breu: '#04060a',
} as const;

/* --------------------------------------------------------------------------
 * TIPOGRAFIA DA MARCA — as quatro letras, desenhadas, não escolhidas.
 *
 * Geométrica de traço uniforme e leve, com dois detalhes que separam a palavra
 * de uma Futura qualquer: o A tem ÁPICE CHAPADO e o R tem PERNA RETA saindo da
 * barriga. Tracking largo — a palavra é GRAVADA em metal, e incisão pede ar
 * entre os cortes.
 *
 * Nada de fonte futurista, gamer ou de efeito: a palavra tem de sumir dentro
 * da escultura, não competir com ela.
 *
 * Os traços passam de propósito além da linha de base e do topo; recortar em
 * `y ∈ [0, ALTURA]` devolve pé e ápice chapados sem contornar letra por letra.
 * Com terminação reta sozinha a diagonal do A sairia cortada em ângulo, e o A
 * ficaria de pé torto ao lado do pé reto do I.
 *
 * O formato é `d` de path SVG porque serve aos dois consumidores sem tradução:
 * `new Path2D(d)` no canvas que grava a textura, e `<path d>` onde for preciso
 * desenhá-la em 2D.
 */

export const TIPOGRAFIA = {
  largura: 326,
  altura: 100,
  /** espessura do traço na grade nativa — ~0,12 da altura de versal */
  peso: 12,
  tracos: [
    // I
    'M 6,-8 L 6,108',
    // A — ápice chapado de 10 unidades
    'M 44,108 L 75,-8 L 85,-8 L 116,108',
    // A travessa alinha com a base da barriga do R (58): as duas horizontais
    // da palavra caem na MESMA linha e o olho lê um ritmo em vez de um
    // desencontro. A 68 elas ficavam dez unidades fora de registro — pouco
    // para parecer intenção, muito para parecer preciso.
    'M 56,60 L 104,60',
    // R — haste, barriga e perna reta
    'M 154,-8 L 154,108',
    'M 154,6 L 183,6 C 201,6 209,17 209,32 C 209,47 201,58 183,58 L 154,58',
    // A perna nasce DENTRO da barriga, não na aresta dela: junção tangente,
    // sem o bico que sobra quando duas linhas se encontram pela ponta.
    'M 178,55 L 212,108',
    // A
    'M 248,108 L 279,-8 L 289,-8 L 320,108',
    'M 260,60 L 308,60',
  ],
} as const;

/**
 * A palavra IARA como SVG isolado, na largura pedida.
 *
 * SVG, e não desenho em canvas, porque quem consome isto é o `sharp` — que roda
 * no Node, sem DOM — para compor a inscrição sobre a fotografia da escultura.
 * O recorte da caixa de versal vive aqui, e não em quem chama, porque ele é
 * PARTE da letra: quem desenhar a palavra sem ele desenha outra palavra.
 *
 * COMO A INCISÃO É FEITA. Uma cópia escura, levemente mais grossa, deslocada
 * de uma fração de unidade — só o bastante para escapar um FIO escuro na borda
 * de baixo do traço. É o que a luz faz na parede de um sulco raso.
 *
 * Não é sombra projetada. Sombra deslocada, e principalmente sombra borrada,
 * são o vocabulário de texto COLADO por cima de uma foto: leem como adesivo,
 * e adesivo é o oposto de gravação. A diferença entre as duas coisas é só
 * escala — a fração de unidade aqui, contra as cinco ou sete unidades que
 * transformam a mesma técnica em amadorismo.
 */
export function palavraSvg({
  largura,
  cor = CROMO.luz,
  peso = TIPOGRAFIA.peso,
  opacidade = 1,
  bisel = 0,
}: {
  largura: number;
  cor?: string;
  peso?: number;
  opacidade?: number;
  /** espessura do fio escuro na borda do sulco, na grade nativa de 326×100 */
  bisel?: number;
}): string {
  const escala = largura / TIPOGRAFIA.largura;
  const tracos = TIPOGRAFIA.tracos.map((d) => `<path d="${d}" />`).join('');
  const desenho = (pintura: string, dy: number, alfa: number, espessura: number) =>
    `<g transform="translate(0 ${dy})" clip-path="url(#caixa)" fill="none" stroke="${pintura}"` +
    ` stroke-width="${espessura}" stroke-linecap="butt" stroke-linejoin="miter"` +
    ` stroke-miterlimit="8" opacity="${alfa}">${tracos}</g>`;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg"` +
    ` width="${Math.round(TIPOGRAFIA.largura * escala)}"` +
    ` height="${Math.round(TIPOGRAFIA.altura * escala)}"` +
    ` viewBox="0 0 ${TIPOGRAFIA.largura} ${TIPOGRAFIA.altura}">` +
    `<defs><clipPath id="caixa">` +
    `<rect x="-2" y="0" width="${TIPOGRAFIA.largura + 4}" height="${TIPOGRAFIA.altura}" />` +
    `</clipPath></defs>` +
    (bisel > 0 ? desenho(CROMO.breu, bisel, opacidade * 0.7, peso + bisel * 1.4) : '') +
    desenho(cor, 0, opacidade, peso) +
    `</svg>`
  );
}
