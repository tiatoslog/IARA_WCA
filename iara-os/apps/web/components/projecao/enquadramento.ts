/**
 * ENQUADRAMENTO DA ENTIDADE — a única aritmética que decide o tamanho da gema.
 *
 * Mora fora do componente por uma razão prática: o palco é WebGL e não abre num
 * teste de Node, mas a conta que decide se a pedra aparece ou não é pura. Foi
 * exatamente essa conta que falhou em 13/08/2026 — a gema não aparecia dentro do
 * ícone de 56px do celular, e a causa não era render, era enquadramento. Com a
 * fórmula aqui, o próximo erro desses cai num teste em vez de num print.
 *
 * A FÓRMULA. A altura visível no plano da pedra é `distância × tan(abertura/2)`.
 * Como a esfera tem raio 1, a fração da altura do palco que ela ocupa é
 * `1 / (distância × tan(abertura/2))`.
 *
 * A REGRA. Reenquadrar é mexer na DISTÂNCIA, nunca na abertura: a abertura é a
 * lente, e trocar de lente troca o caráter da imagem (24° achata a perspectiva e
 * faz o vidro ler como objeto fotografado; 30° devolve a assinatura de grande
 * angular que a referência não tem).
 */

/** A lente. Ver a regra acima antes de pensar em mudar este número. */
export const ABERTURA = 24;

/** Palco inteiro: a pedra ocupa ~0,25 da altura — um quarto, com campo negativo
 *  em volta, que é o que separa joia exposta de ícone centralizado. */
export const DISTANCIA_CAMERA = 18.5;

/**
 * Ícone do celular: ~0,76 da altura. Não é 1,0 de propósito — pedra encostando
 * na borda do círculo vira mancha, e a folga é o que a mantém parecendo joia
 * também na miniatura.
 */
export const DISTANCIA_ICONE = 6.2;

/** Leve mergulho de ~4°. */
export const ALTURA_CAMERA = 0.8;

/**
 * Abaixo disto o palco não é palco, é ícone.
 *
 * O LIMIAR VEM DO TAMANHO REAL DO CANVAS, e a escolha custou uma correção antes
 * de sair daqui. A primeira versão recebia a intenção por propriedade
 * (`recolhida`, do React) — e no computador aquele estado nasce `true`, porque
 * quem decide se ele vale é a consulta de mídia do CSS, não o React. O resultado
 * teria sido a câmera de ícone num palco de 900px: o defeito oposto do que se
 * estava consertando, e bem mais difícil de enxergar.
 *
 * Medir o canvas não pode discordar do CSS, porque é o CSS que produz a medida.
 * 160 é folgado: o ícone tem 56 e o menor palco de celular passa de 300.
 */
export const LADO_MAXIMO_DO_ICONE = 160;

/** A fração da altura do quadro que a pedra ocupa a uma dada distância. */
export function fracaoDaAltura(distancia: number, aberturaGraus = ABERTURA): number {
  return 1 / (distancia * Math.tan((aberturaGraus * Math.PI) / 360));
}

/**
 * O enquadramento é função do tamanho do palco, e de mais nada.
 *
 * Tamanho zero (o instante antes do primeiro `ResizeObserver`) devolve o palco
 * inteiro — errar para o enquadramento grande é invisível por um quadro; errar
 * para o de ícone daria um salto de câmera na abertura da página.
 */
export function distanciaDoEnquadramento(largura: number, altura: number): number {
  const menorLado = Math.min(largura, altura);
  return menorLado > 0 && menorLado <= LADO_MAXIMO_DO_ICONE ? DISTANCIA_ICONE : DISTANCIA_CAMERA;
}
