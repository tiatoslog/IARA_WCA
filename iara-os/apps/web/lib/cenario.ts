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
export const SALA_LARGURA = 320;
export const SALA_ALTURA = 208;
export const ALTURA_PAREDE = 64;

export interface Sprite {
  arquivo: string;
  largura: number;
  altura: number;
  x: number;
  y: number;
  /** Objetos com `luz` reagem ao estado. Os demais são cenário morto. */
  luz?: IdObjeto;
  /** Ordem de desenho. Maior = mais à frente. */
  camada?: number;
}

/** Mobília e adereços. Nada aqui reage a dado — a luz é aplicada por cima. */
export const MOBILIA: Sprite[] = [
  // --- parede ---
  { arquivo: 'cabinet.png', largura: 64, altura: 64, x: 16, y: 24, luz: 'estante' },
  { arquivo: 'coffee-maker.png', largura: 64, altura: 64, x: 236, y: 24, luz: 'cafeteira' },
  { arquivo: 'sink.png', largura: 64, altura: 64, x: 172, y: 24 },

  // --- chão, fileira de trabalho ---
  { arquivo: 'desk-with-pc.png', largura: 64, altura: 64, x: 96, y: 104, luz: 'terminal', camada: 2 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 120, y: 152, camada: 1 },

  { arquivo: 'writing-table.png', largura: 64, altura: 64, x: 236, y: 112, luz: 'gaveteiro', camada: 2 },
  { arquivo: 'desk.png', largura: 64, altura: 32, x: 20, y: 128, camada: 2 },
  { arquivo: 'PC1.png', largura: 32, altura: 32, x: 36, y: 112, camada: 2 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 44, y: 160, camada: 1 },

  { arquivo: 'stamping-table.png', largura: 64, altura: 32, x: 160, y: 160, camada: 3 },
  { arquivo: 'printer.png', largura: 64, altura: 32, x: 96, y: 176, camada: 3 },

  // --- adereços ---
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 288, y: 88, luz: 'planta', camada: 2 },
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 0, y: 168, camada: 3 },
  { arquivo: 'water-cooler.png', largura: 16, altura: 32, x: 216, y: 80, camada: 2 },
  { arquivo: 'Trash.png', largura: 16, altura: 16, x: 200, y: 184, camada: 3 },
  { arquivo: 'office-partitions-1.png', largura: 64, altura: 64, x: 168, y: 88, camada: 1 },
];

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

/** Duas âncoras apenas. O avatar caminha entre elas, nunca teleporta. */
export const POSTO_MESA = { x: 112, y: 108 };
export const POSTO_SALA = { x: 168, y: 132 };

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

export const JANELA: Retangulo = { id: 'janela', x: 96, y: 16, largura: 64, altura: 40 };
export const RACK: Retangulo = { id: 'rack', x: 284, y: 8, largura: 28, altura: 72 };
export const QUADRO_METAS: Retangulo = { id: 'quadro_metas', x: 196, y: 12, largura: 40, altura: 28 };
