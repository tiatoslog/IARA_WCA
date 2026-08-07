'use client';

/**
 * Reprodução da voz e o relógio que a boca segue.
 *
 * O elemento de áudio é a ÚNICA fonte de tempo da articulação quando há voz.
 * Não há sincronização a manter entre dois relógios — o `ControladorFacial`
 * pergunta a este objeto onde o áudio está, quadro a quadro. Se o navegador
 * engasgar, atrasar ou o operador pausar, a boca acompanha, porque ela não tem
 * relógio próprio para divergir.
 *
 * Nada aqui provoca re-render durante a fala: o `RelogioVoz` é um objeto
 * estável que lê `currentTime` na hora em que é perguntado. Um `setState` por
 * quadro de áudio derrubaria o frame budget da cena 3D.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Fala } from './useIaraSocket';

export interface RelogioVoz {
  /** 0..1 enquanto há áudio carregado e tocando; `null` quando não há voz. */
  progresso(): number | null;
}

export interface EstadoVoz {
  relogio: RelogioVoz;
  /** true entre o `play()` aceito e o fim do áudio. Para a UI, não para a boca. */
  tocando: boolean;
  /**
   * O navegador recusou o autoplay. Não é erro nosso: política de mídia exige
   * gesto do usuário. A UI precisa saber para oferecer o botão.
   */
  bloqueado: boolean;
  /** Libera o áudio após um gesto do operador. */
  liberar(): void;
}

export function useVoz(fala: Fala | null, ativa: boolean): EstadoVoz {
  const elemento = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);
  const ultimaUrl = useRef<string | null>(null);

  // Estável por toda a vida do componente: o loop de animação guarda esta
  // referência uma vez e nunca mais pergunta por ela.
  const relogio = useRef<RelogioVoz>({
    progresso() {
      const a = elemento.current;
      if (!a || !a.duration || !Number.isFinite(a.duration) || a.paused) return null;
      return a.currentTime / a.duration;
    },
  }).current;

  const tocar = useCallback((url: string) => {
    const anterior = elemento.current;
    if (anterior) {
      anterior.pause();
      anterior.src = '';
    }

    const audio = new Audio(url);
    audio.preload = 'auto';
    elemento.current = audio;

    audio.addEventListener('ended', () => setTocando(false));
    audio.addEventListener('error', () => setTocando(false));

    void audio
      .play()
      .then(() => {
        setTocando(true);
        setBloqueado(false);
      })
      .catch(() => {
        // Autoplay barrado. O áudio fica carregado esperando o gesto.
        setTocando(false);
        setBloqueado(true);
      });
  }, []);

  useEffect(() => {
    if (!ativa) return;
    const url = fala?.voz ?? null;
    if (!url || url === ultimaUrl.current) return;
    ultimaUrl.current = url;
    tocar(url);
  }, [fala?.voz, ativa, tocar]);

  // Trocar de projeção ou desmontar não pode deixar voz tocando no vazio.
  useEffect(() => {
    if (ativa) return;
    const a = elemento.current;
    if (a) {
      a.pause();
      a.src = '';
    }
    elemento.current = null;
    ultimaUrl.current = null;
    setTocando(false);
  }, [ativa]);

  useEffect(
    () => () => {
      const a = elemento.current;
      if (a) {
        a.pause();
        a.src = '';
      }
      elemento.current = null;
    },
    [],
  );

  const liberar = useCallback(() => {
    const a = elemento.current;
    if (!a) return;
    void a
      .play()
      .then(() => {
        setTocando(true);
        setBloqueado(false);
      })
      .catch(() => setBloqueado(true));
  }, []);

  return { relogio, tocando, bloqueado, liberar };
}
