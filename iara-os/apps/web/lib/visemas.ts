/**
 * Visemas de português brasileiro.
 *
 * DE ONDE VEM O MOVIMENTO DA BOCA — e por que isso importa.
 *
 * Não existe TTS neste sistema. Então a boca não pode ser dirigida por áudio,
 * e a alternativa preguiçosa — abrir e fechar num loop enquanto `estagio ===
 * 'falando'` — é exatamente a animação mentirosa que a direção de arte proíbe:
 * seria movimento que não corresponde a fato nenhum.
 *
 * A saída honesta é a única fonte de verdade que existe: o texto que está
 * chegando pelo `fala_delta`. Cada caractere que o motor emitiu de fato vira
 * um visema. Se o stream trava, a boca alcança o fim do texto e fecha —
 * porque é isso que está acontecendo de verdade.
 *
 * Quando houver TTS, troca-se a fonte do cursor (tempo do áudio em vez de
 * cadência de leitura) e o resto deste arquivo continua valendo.
 */

/**
 * Conjunto reduzido, no padrão que os rigs faciais entendem. É deliberadamente
 * pequeno: visema demais em rig de blendshape vira tremor, não fala.
 */
export type Visema =
  | 'repouso'
  | 'PP' // p, b, m — lábios selados
  | 'FF' // f, v — lábio inferior no dente
  | 'DD' // t, d, n, l — língua no alvéolo
  | 'KK' // c, g, q — dorso da língua
  | 'CH' // ch, j, x, lh, nh — lábios projetados
  | 'SS' // s, z, ç — dentes quase juntos
  | 'RR' // r, rr
  | 'AA' // a
  | 'EE' // e, é
  | 'II' // i
  | 'OO' // o, ó
  | 'UU'; // u

/** Quanto a mandíbula abre em cada visema. 0 = fechada, 1 = aberta. */
export const ABERTURA_DO_VISEMA: Record<Visema, number> = {
  repouso: 0,
  PP: 0,
  FF: 0.12,
  DD: 0.22,
  KK: 0.3,
  CH: 0.26,
  SS: 0.14,
  RR: 0.28,
  AA: 0.85,
  EE: 0.55,
  II: 0.34,
  OO: 0.6,
  UU: 0.4,
};

/** Quanto os lábios arredondam. Separa 'OO'/'UU'/'CH' de 'II'/'EE'. */
export const ARREDONDAMENTO_DO_VISEMA: Record<Visema, number> = {
  repouso: 0,
  PP: 0.1,
  FF: 0,
  DD: 0,
  KK: 0,
  CH: 0.7,
  SS: 0,
  RR: 0.2,
  AA: 0,
  EE: 0,
  II: 0,
  OO: 0.8,
  UU: 1,
};

/**
 * Grafema -> visema. Português é raso o bastante na direção grafema→som para
 * que uma tabela resolva: não precisamos de um transcritor fonético, e um
 * transcritor completo custaria mais do que a boca entrega de expressividade.
 */
const LETRA: Record<string, Visema> = {
  a: 'AA',
  á: 'AA',
  à: 'AA',
  â: 'AA',
  ã: 'AA',
  e: 'EE',
  é: 'EE',
  ê: 'EE',
  i: 'II',
  í: 'II',
  o: 'OO',
  ó: 'OO',
  ô: 'OO',
  õ: 'OO',
  u: 'UU',
  ú: 'UU',
  ü: 'UU',
  p: 'PP',
  b: 'PP',
  m: 'PP',
  f: 'FF',
  v: 'FF',
  t: 'DD',
  d: 'DD',
  n: 'DD',
  l: 'DD',
  c: 'KK',
  k: 'KK',
  g: 'KK',
  q: 'KK',
  j: 'CH',
  x: 'CH',
  s: 'SS',
  z: 'SS',
  ç: 'SS',
  r: 'RR',
  w: 'UU',
  y: 'II',
  h: 'repouso',
};

/** Dígrafos que valem mais que a soma das letras. Testados antes das letras. */
const DIGRAFO: Array<[string, Visema]> = [
  ['ch', 'CH'],
  ['lh', 'CH'],
  ['nh', 'CH'],
  ['rr', 'RR'],
  ['ss', 'SS'],
  ['qu', 'KK'],
  ['gu', 'KK'],
];

/**
 * Cadência de fala em caracteres por segundo. 14 c/s ≈ 170 palavras/min, que é
 * ritmo de locução calma — coerente com a IARA, que não é tagarela (extroversão
 * 0.38 na matriz OCEAN).
 */
export const CARACTERES_POR_SEGUNDO = 14;

/**
 * Converte um texto na trilha de visemas correspondente.
 *
 * Espaço e pontuação viram `repouso`: é a pausa entre palavras, e é ela que
 * impede a boca de virar uma máquina de costura.
 */
export function trilhaDeVisemas(texto: string): Visema[] {
  const limpo = texto.toLowerCase();
  const trilha: Visema[] = [];

  for (let i = 0; i < limpo.length; i += 1) {
    const par = limpo.slice(i, i + 2);
    const digrafo = DIGRAFO.find(([grafia]) => grafia === par);
    if (digrafo) {
      // O dígrafo ocupa os dois caracteres: assim o cursor de tempo continua
      // alinhado com o índice do texto original.
      trilha.push(digrafo[1], digrafo[1]);
      i += 1;
      continue;
    }
    trilha.push(LETRA[limpo[i]] ?? 'repouso');
  }

  return trilha;
}

/**
 * Onde a boca está agora.
 *
 * `revelados` é quantos caracteres o servidor já entregou — fato observado.
 * `decorridos_ms` é há quanto tempo a fala começou. O cursor é o menor dos
 * dois: a boca nunca articula texto que ainda não chegou (mentira sobre o
 * futuro), nem corre na frente da cadência de locução (mentira sobre o ritmo).
 *
 * Quando o cursor alcança o texto revelado e a fala já terminou, devolve
 * `repouso` — boca fechada, que é o estado verdadeiro de quem parou de falar.
 */
export function visemaAgora(
  trilha: Visema[],
  revelados: number,
  decorridos_ms: number,
): { visema: Visema; progresso: number } {
  if (trilha.length === 0) return { visema: 'repouso', progresso: 0 };

  const porTempo = (decorridos_ms / 1000) * CARACTERES_POR_SEGUNDO;
  const cursor = Math.min(porTempo, revelados, trilha.length);

  if (cursor >= trilha.length) {
    return { visema: 'repouso', progresso: 1 };
  }

  return {
    visema: trilha[Math.floor(cursor)] ?? 'repouso',
    progresso: cursor / trilha.length,
  };
}
