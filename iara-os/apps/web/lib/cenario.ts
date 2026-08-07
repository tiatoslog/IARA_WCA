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
//        0    32   64   96  128  160  192  224  256  288  320
//   0    +---------+----------------+--------+---------+----+
//        | quadro  |  C O P A       | janela |  metas  |rack|   parede
//  64    +---------+----------------+--------+---------+----+
//        |         |                        |               |
//        | ARQUIVO |   O P E R A C I O N A L |  T E C H     |   piso
// 128    | estante |   est.1     est.2      |  impressora   |
//        | escriv. |   [cadeiras alinhadas] |  bancada      |
// 176    +---------- C O R R E D O R  L I V R E ------------+
// 208    +--------------------------------------------------+
//
// Regras que o layout respeita:
//   - Faixa y >= 176 fica vazia de ponta a ponta: é o corredor por onde a
//     IARA caminha entre os postos.
//   - Estações de trabalho compartilham a MESMA base (140) — mesas paralelas
//     e alinhadas. As cadeiras também (160), sempre à frente das mesas.
//   - Zona tech encostada na borda direita, sob o rack: o ruído visual de
//     infraestrutura fica isolado num canto só.
//   - Copa contígua na parede: pia, cafeteira e bebedouro no mesmo pano.

/** Mobília e adereços. Nada aqui reage a dado — a luz é aplicada por cima. */
export const MOBILIA: Sprite[] = [
  // --- copa: balcão contíguo na parede ---
  { arquivo: 'sink.png', largura: 64, altura: 64, x: 56, y: 20, ancora: 56 },
  { arquivo: 'coffee-maker.png', largura: 64, altura: 64, x: 116, y: 20, luz: 'cafeteira', ancora: 56 },
  { arquivo: 'water-cooler.png', largura: 16, altura: 32, x: 184, y: 48 },

  // --- arquivo: coluna esquerda, estante em cima e escrivaninha embaixo ---
  { arquivo: 'cabinet.png', largura: 64, altura: 64, x: 0, y: 68, luz: 'estante', ancora: 60 },
  { arquivo: 'writing-table.png', largura: 64, altura: 64, x: 0, y: 136, luz: 'gaveteiro' },

  // --- operacional: duas estações paralelas, bases alinhadas em 140 ---
  { arquivo: 'desk.png', largura: 64, altura: 32, x: 72, y: 108 },
  { arquivo: 'PC1.png', largura: 32, altura: 32, x: 88, y: 92 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 96, y: 144 },

  { arquivo: 'desk-with-pc.png', largura: 64, altura: 64, x: 144, y: 76, luz: 'terminal' },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 168, y: 144 },

  // --- tech: coluna direita, sob o rack ---
  { arquivo: 'printer.png', largura: 64, altura: 32, x: 248, y: 100 },
  { arquivo: 'stamping-table.png', largura: 64, altura: 32, x: 248, y: 140 },
  { arquivo: 'Trash.png', largura: 16, altura: 16, x: 232, y: 180 },

  // --- adereços: as duas plantas balizam o corredor vertical ---
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 212, y: 56, luz: 'planta' },
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 212, y: 176 },
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
