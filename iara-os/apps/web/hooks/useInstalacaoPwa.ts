'use client';

/**
 * A COLA ENTRE O OUVIDO INLINE E A GAVETA.
 *
 * O layout guarda o `beforeinstallprompt` em `window.__iaraEventoInstalacao`
 * (ver `OUVIDO_INSTALACAO` em `app/layout.tsx` — e o porquê de ele ser inline).
 * Este hook lê os fatos, entrega o estado classificado por
 * `classificarInstalacao` (lib pura, testada em Node) e expõe o único gesto:
 * `instalar()`.
 *
 * O evento só pode ser gasto UMA vez — um segundo `prompt()` no mesmo evento é
 * `InvalidStateError`. Por isso `instalar()` consome o guardado antes de
 * esperar a escolha, e `aguardando` desabilita o botão enquanto o diálogo do
 * navegador está aberto.
 */

import { useCallback, useEffect, useState } from 'react';
import { classificarInstalacao, type EstadoInstalacao } from '../lib/instalacaoPwa';

/** O formato do evento que o Chrome entrega. O TypeScript do DOM não o traz. */
interface EventoInstalacao extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

declare global {
  interface Window {
    __iaraEventoInstalacao?: EventoInstalacao | null;
  }
}

function estaStandalone(): boolean {
  if (window.matchMedia('(display-mode: standalone)').matches) return true;
  // iOS: a consulta de mídia só passou a valer em versões recentes; o campo
  // proprietário continua sendo o fato mais confiável lá.
  return (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function classificarAgora(): EstadoInstalacao {
  return classificarInstalacao({
    ua: navigator.userAgent,
    standalone: estaStandalone(),
    promptCapturado: Boolean(window.__iaraEventoInstalacao),
    toques: navigator.maxTouchPoints ?? 0,
  });
}

export function useInstalacaoPwa(): {
  estado: EstadoInstalacao;
  /** O diálogo do navegador está aberto — o botão espera. */
  aguardando: boolean;
  /** A operadora recusou o diálogo: o navegador guarda essa recusa por um
   *  tempo, então a gaveta explica o caminho manual em vez de reoferecer. */
  recusou: boolean;
  instalar: () => void;
} {
  // Começa em 'manual' no servidor e reclassifica na montagem: os fatos
  // (userAgent, standalone, evento capturado) só existem no navegador.
  const [estado, setEstado] = useState<EstadoInstalacao>('manual');
  const [aguardando, setAguardando] = useState(false);
  const [recusou, setRecusou] = useState(false);

  useEffect(() => {
    setEstado(classificarAgora());
    const aoInstalavel = () => setEstado(classificarAgora());
    const aoInstalada = () => setEstado('instalada');
    window.addEventListener('iara:instalavel', aoInstalavel);
    window.addEventListener('iara:instalada', aoInstalada);
    return () => {
      window.removeEventListener('iara:instalavel', aoInstalavel);
      window.removeEventListener('iara:instalada', aoInstalada);
    };
  }, []);

  const instalar = useCallback(() => {
    const evento = window.__iaraEventoInstalacao;
    if (!evento) return;
    // Consumido: nem um clique duplo nem um segundo aberto de gaveta podem
    // gastar o mesmo evento de novo.
    window.__iaraEventoInstalacao = null;
    setAguardando(true);
    void evento.prompt();
    void evento.userChoice
      .then(({ outcome }) => {
        if (outcome === 'accepted') {
          // O `appinstalled` confirma de verdade; antecipar aqui evita o
          // quadro em que a pessoa aceitou e o botão continua oferecendo.
          setEstado('instalada');
        } else {
          setRecusou(true);
          setEstado(classificarAgora());
        }
      })
      .catch(() => setEstado(classificarAgora()))
      .finally(() => setAguardando(false));
  }, []);

  return { estado, aguardando, recusou, instalar };
}
