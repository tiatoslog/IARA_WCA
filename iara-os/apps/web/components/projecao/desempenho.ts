'use client';

/**
 * Modo de desempenho do palco 3D — preferência do operador, por navegador.
 *
 * `auto` é o padrão e o recomendado: o palco mede o próprio tempo de quadro e
 * degrada a densidade de pixels sozinho quando a máquina não acompanha (ver
 * `ReguladorDesempenho` em PalcoPresenca). Os modos fixos existem para quem
 * quer decidir por conta própria — notebook na bateria, por exemplo.
 */

export type ModoDesempenho = 'auto' | 'alto' | 'equilibrado' | 'baixo';

const CHAVE = 'iara.desempenho';

/** Evento local que avisa o palco quando a preferência muda na mesma aba. */
export const EVENTO_DESEMPENHO = 'iara-desempenho';

export function lerModoDesempenho(): ModoDesempenho {
  try {
    const salvo = window.localStorage.getItem(CHAVE);
    if (salvo === 'alto' || salvo === 'equilibrado' || salvo === 'baixo') return salvo;
  } catch {
    /* sem localStorage, auto */
  }
  return 'auto';
}

export function gravarModoDesempenho(modo: ModoDesempenho): void {
  try {
    if (modo === 'auto') window.localStorage.removeItem(CHAVE);
    else window.localStorage.setItem(CHAVE, modo);
  } catch {
    /* preferência não persiste, mas a sessão atual aplica */
  }
  window.dispatchEvent(new Event(EVENTO_DESEMPENHO));
}

/** Densidade de pixels inicial de cada modo. `auto` parte do teto e mede. */
export function dprDoModo(modo: ModoDesempenho): number {
  switch (modo) {
    case 'alto':
      return 1.5;
    case 'equilibrado':
      return 1.15;
    case 'baixo':
      return 0.8;
    default:
      return 1.5;
  }
}
