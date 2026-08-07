/**
 * O escritório. Coordenadas em PIXELS DE ARTE (não em pixels de tela) — o
 * componente aplica a escala inteira. Isso mantém o pixel art alinhado ao
 * grid em qualquer zoom.
 *
 * Trocar de pack de arte = trocar `arquivo` e as dimensões aqui. Nenhum
 * componente conhece nome de arquivo.
 */

import type { EstagioCognitivo, IdObjeto } from './estado';

export const PIXEL = 3; // escala de renderização
export const TILE = 16; // grid do pack — toda posição é múltipla disto
export const SALA_LARGURA = 320;
export const SALA_ALTURA = 208;
export const ALTURA_PAREDE = 64;

// ---------------------------------------------------------------------------
// Profundidade
// ---------------------------------------------------------------------------

/**
 * Ordem de desenho derivada da posição, nunca escrita à mão. Quem tem a linha
 * de contato com o piso mais baixa na tela está mais perto da câmera e cobre
 * quem está atrás.
 *
 * As três primeiras faixas são fixas porque não competem por profundidade:
 * piso e parede são superfícies, e mural é o que está *chapado* na parede
 * (janela, quadro) — nada nunca passa atrás disso.
 */
export const CAMADA_PISO = 0;
export const CAMADA_PAREDE = 1;
export const CAMADA_MURAL = 2;
/** Piso da faixa dinâmica. Base 64..208 vira z 74..218 — acima de todo mural. */
export const CAMADA_OBJETOS = 10;

export function profundidade(base: number): number {
  return CAMADA_OBJETOS + Math.round(base);
}

export interface Sprite {
  arquivo: string;
  largura: number;
  altura: number;
  x: number;
  y: number;
  /** Objetos com `luz` reagem ao estado. Os demais são cenário morto. */
  luz?: IdObjeto;
  /**
   * Distância do topo do sprite até a linha em que o objeto toca o piso.
   * As folhas 64x64 do pack têm padding transparente embaixo, então a base
   * real fica acima da borda. Sem isto, objetos de parede se comportam como
   * se estivessem no meio da sala.
   */
  ancora?: number;
}

export function baseDoSprite(s: Sprite): number {
  return s.y + (s.ancora ?? s.altura);
}

// ---------------------------------------------------------------------------
// Zoneamento
// ---------------------------------------------------------------------------
//
// Grid de 16px. Colunas 0..19, linhas 0..12. Parede = linhas 0..3, piso = 4..12.
//
// CARGA DE PERÍMETRO — a regra que manda aqui. Móvel de corpo fechado
// (armário, estante, impressora, rack) tem costas: precisa encostar numa
// parede, senão lê como caixote largado no meio da sala. A sala tem três
// paredes utilizáveis: a faixa de fundo (y<64) e as duas bordas laterais
// (x=0 e x=320). O centro do piso não é parede — é circulação.
//
//        0    32   64   96  128  160  192  224  256  288  320
//   0    +--------+--------+-------+---------+-------+-----+
//        | estante|  C O P A| bebe | janela  | metas |rack |  parede de fundo
//  64    +--------+--------+-------+---------+-------+-----+
//        |escriv. |                                 |print|
//        |        |   est.1        est.2            |     |  piso
// 144    |        | [cadeiras encostadas nas mesas] |banca|
// 160    |--------+--- C O R R E D O R   L I V R E -+-----|
// 208    | planta |                                 |plant|
//        +-------------------------------------------------+
//
// Invariantes de layout:
//   - Nada de corpo fechado no piso aberto. Só cadeiras, plantas e o par
//     mesa/monitor vivem soltos, e cadeira sempre encostada na sua mesa.
//   - Estações compartilham base ~145: mesas paralelas e alinhadas.
//   - Cadeira = base da mesa + 6. Folga maior que isso lê como cadeira
//     abandonada longe da mesa, não como posto de trabalho.
//   - Monitor sobre mesa tem base na LINHA DA TAMPA, não no piso: assim a
//     frente da mesa desenha por cima do pé do monitor.
//   - Faixa y 160..208 vazia entre as bordas: é o corredor.

/** Mobília e adereços. Nada aqui reage a dado — a luz é aplicada por cima. */
export const MOBILIA: Sprite[] = [
  // --- parede de fundo, esquerda para a direita ---
  { arquivo: 'cabinet.png', largura: 64, altura: 64, x: 0, y: 8, luz: 'estante', ancora: 60 },
  { arquivo: 'sink.png', largura: 64, altura: 64, x: 52, y: 8, ancora: 56 },
  { arquivo: 'coffee-maker.png', largura: 64, altura: 64, x: 104, y: 8, luz: 'cafeteira', ancora: 56 },
  { arquivo: 'water-cooler.png', largura: 16, altura: 32, x: 160, y: 32 },

  // --- borda esquerda: escrivaninha de costas para a parede lateral ---
  { arquivo: 'writing-table.png', largura: 64, altura: 64, x: 0, y: 96, luz: 'gaveteiro', ancora: 60 },

  // --- borda direita: coluna tech inteira sob o rack ---
  { arquivo: 'printer.png', largura: 64, altura: 32, x: 252, y: 104 },
  { arquivo: 'stamping-table.png', largura: 64, altura: 32, x: 252, y: 148 },
  { arquivo: 'Trash.png', largura: 16, altura: 16, x: 236, y: 152 },

  // --- operacional: ilha central, duas estações paralelas ---
  { arquivo: 'desk.png', largura: 64, altura: 32, x: 60, y: 112 },
  // `ancora: 22` põe a base do monitor na tampa da mesa (112+6), não no piso.
  { arquivo: 'PC1.png', largura: 32, altura: 32, x: 76, y: 96, ancora: 22 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 84, y: 134 },

  { arquivo: 'desk-with-pc.png', largura: 64, altura: 64, x: 140, y: 84, luz: 'terminal', ancora: 58 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 164, y: 132 },

  // --- adereços: plantas nos dois cantos inferiores, fechando o corredor ---
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 0, y: 172, luz: 'planta' },
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 288, y: 176 },
];

/**
 * A cena pronta para desenhar: ordenada por base crescente. O componente
 * itera nesta ordem e nunca decide profundidade.
 */
export const CENA: Sprite[] = [...MOBILIA].sort((a, b) => baseDoSprite(a) - baseDoSprite(b));

/** A planta que balança. Ambiente puro — precisa ser UMA, nunca duplicada. */
export const PLANTA_AMBIENTE = MOBILIA[MOBILIA.length - 1];

/** De onde sai o vapor. Derivado da cafeteira, não digitado à mão. */
const cafeteira = MOBILIA.find((s) => s.luz === 'cafeteira')!;
export const BICO_CAFETEIRA = {
  x: cafeteira.x + 26,
  y: cafeteira.y + 6,
  z: profundidade(baseDoSprite(cafeteira)) + 1,
};

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export interface Animacao {
  arquivo: string;
  quadros: number;
  largura: number;
  altura: number;
  duracao_ms: number;
}

/**
 * Folhas de quadros do pack (medidas do arquivo, não chutadas):
 *   Julia-Idle.png ............ 128x32  -> 4 quadros de 32x32
 *   Julia.png ................. 128x32  -> 4 quadros de 32x32
 *   Julia_PC.png .............. 384x64  -> 6 quadros de 64x64
 *   Julia_Drinking_Coffee.png .  96x32  -> 3 quadros de 32x32
 */
export const ANIMACOES: Record<EstagioCognitivo, Animacao> = {
  ocioso: { arquivo: 'Julia-Idle.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 2400 },
  escutando: { arquivo: 'Julia.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 1400 },
  executando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 1000 },
  consultando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 1200 },
  // Piso de ~700ms mesmo no estágio mais pesado: frenético quebra a identidade.
  pensando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 760 },
  falando: { arquivo: 'Julia.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 1100 },
};

/**
 * Duas âncoras apenas. O avatar caminha entre elas, nunca teleporta.
 * `y` é a linha de contato com o piso — entra na mesma ordenação da mobília,
 * então a IARA passa atrás do que está à frente dela.
 */
export const POSTO_MESA = { x: 176, y: 144 };
export const POSTO_SALA = { x: 160, y: 192 };

export function postoDoEstagio(estagio: EstagioCognitivo): { x: number; y: number } {
  return estagio === 'ocioso' || estagio === 'escutando' ? POSTO_SALA : POSTO_MESA;
}

// ---------------------------------------------------------------------------
// Objetos desenhados à mão (o pack não traz parede, janela, rack nem quadro)
// ---------------------------------------------------------------------------

export interface Retangulo {
  id: IdObjeto;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/** Chapados na parede: nada passa atrás, então vivem em `CAMADA_MURAL`. */
export const JANELA: Retangulo = { id: 'janela', x: 208, y: 12, largura: 64, altura: 40 };
export const QUADRO_METAS: Retangulo = { id: 'quadro_metas', x: 8, y: 16, largura: 40, altura: 28 };

/** O rack fica no piso: tem base e entra na ordenação por profundidade. */
export const RACK: Retangulo = { id: 'rack', x: 288, y: 12, largura: 28, altura: 96 };
export const BASE_RACK = RACK.y + RACK.altura;
