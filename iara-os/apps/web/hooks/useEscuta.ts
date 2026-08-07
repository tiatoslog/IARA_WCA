'use client';

/**
 * Escuta contínua — a entrada de áudio da IARA.
 *
 * O QUE ISTO É, E O QUE NÃO É
 *
 * É meio-duplex com interrupção: a IARA ouve, responde, e você pode cortá-la no
 * meio falando por cima. Não é duplex pleno (os dois falando ao mesmo tempo),
 * porque duplex pleno exige STT em streaming no servidor — provedor pago, canal
 * de áudio próprio e cancelamento de eco. Para pergunta operacional respondida
 * em 20ms, meio-duplex entrega quase toda a sensação de ligação por uma fração
 * do trabalho.
 *
 * RECONHECIMENTO NO NAVEGADOR, DE PROPÓSITO
 *
 * `SpeechRecognition` é nativo, gratuito, sem dependência e sem enviar áudio
 * para servidor nosso. O preço é honesto: só Chrome e Edge. Firefox e Safari
 * ficam sem — e o componente diz isso em vez de o botão não fazer nada.
 *
 * DETECÇÃO DE FIM DE FALA
 *
 * O `SpeechRecognition` já entrega resultado final ao detectar pausa, mas o
 * critério dele é curto demais para fala pensada: quem hesita no meio de uma
 * frase tem o pedido cortado ao meio. Por isso existe um silêncio próprio, mais
 * longo, que só dispara o envio quando a pessoa realmente parou.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

// ---------------------------------------------------------------------------
// Tipos da Web Speech API — não vêm no lib.dom padrão.
// ---------------------------------------------------------------------------

interface ResultadoFala {
  readonly isFinal: boolean;
  readonly length: number;
  item(i: number): { transcript: string; confidence: number };
  [i: number]: { transcript: string; confidence: number };
}

interface EventoResultado extends Event {
  readonly resultIndex: number;
  readonly results: { length: number; item(i: number): ResultadoFala; [i: number]: ResultadoFala };
}

interface EventoErroFala extends Event {
  readonly error: string;
}

interface Reconhecedor extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: EventoResultado) => void) | null;
  onerror: ((e: EventoErroFala) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type ConstrutorReconhecedor = new () => Reconhecedor;

function construtor(): ConstrutorReconhecedor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: ConstrutorReconhecedor;
    webkitSpeechRecognition?: ConstrutorReconhecedor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

// ---------------------------------------------------------------------------

/** Silêncio que caracteriza fim de turno. Curto demais corta quem pensa. */
const SILENCIO_MS = 1100;

/** Abaixo disto é ruído, tosse, "ãã". Não vale acordar o kernel. */
const MINIMO_CARACTERES = 2;

export type EstadoEscuta = 'inativa' | 'ouvindo' | 'processando' | 'indisponivel';

export interface Escuta {
  estado: EstadoEscuta;
  /** O que está sendo reconhecido agora, ainda não enviado. */
  parcial: string;
  /** Ligar/desligar o modo ligação. */
  alternar: () => void;
  ativa: boolean;
  motivoIndisponivel: string | null;
}

export interface OpcoesEscuta {
  /** Chamado quando a pessoa termina de falar. */
  aoConcluirFala: (texto: string) => void;
  /** Chamado quando a pessoa começa a falar enquanto a IARA fala. */
  aoInterromper: () => void;
  /** A IARA está falando agora? Define se uma fala nova é interrupção. */
  iaraFalando: boolean;
}

export function useEscuta({ aoConcluirFala, aoInterromper, iaraFalando }: OpcoesEscuta): Escuta {
  const [ativa, setAtiva] = useState(false);
  const [estado, setEstado] = useState<EstadoEscuta>('inativa');
  const [parcial, setParcial] = useState('');
  const [motivoIndisponivel, setMotivo] = useState<string | null>(null);

  const reconhecedor = useRef<Reconhecedor | null>(null);
  const relogioSilencio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acumulado = useRef('');
  const querendoOuvir = useRef(false);
  // Lidos por handlers que vivem fora do ciclo de render.
  const falandoRef = useRef(iaraFalando);
  const cbConcluir = useRef(aoConcluirFala);
  const cbInterromper = useRef(aoInterromper);

  useEffect(() => {
    falandoRef.current = iaraFalando;
  }, [iaraFalando]);
  useEffect(() => {
    cbConcluir.current = aoConcluirFala;
    cbInterromper.current = aoInterromper;
  }, [aoConcluirFala, aoInterromper]);

  useEffect(() => {
    if (!construtor()) {
      setEstado('indisponivel');
      setMotivo('Este navegador não reconhece voz. Use Chrome ou Edge.');
    }
  }, []);

  const enviarAcumulado = useCallback(() => {
    const texto = acumulado.current.trim();
    acumulado.current = '';
    setParcial('');
    if (texto.length < MINIMO_CARACTERES) return;
    setEstado('processando');
    cbConcluir.current(texto);
  }, []);

  const rearmarSilencio = useCallback(() => {
    if (relogioSilencio.current) clearTimeout(relogioSilencio.current);
    relogioSilencio.current = setTimeout(enviarAcumulado, SILENCIO_MS);
  }, [enviarAcumulado]);

  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!ativa) return;
    const Reconhecimento = construtor();
    if (!Reconhecimento) return;

    const r = new Reconhecimento();
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    reconhecedor.current = r;
    querendoOuvir.current = true;

    r.onstart = () => setEstado('ouvindo');

    r.onresult = (evento) => {
      let novoFinal = '';
      let emCurso = '';

      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const res = evento.results[i];
        const texto = res[0].transcript;
        if (res.isFinal) novoFinal += texto;
        else emCurso += texto;
      }

      /**
       * BARGE-IN. Qualquer som reconhecível enquanto a IARA fala é interrupção.
       * Dispara ANTES de acumular: quem corta a IARA quer que ela pare agora,
       * não quando terminar a frase.
       */
      if (falandoRef.current && (novoFinal || emCurso)) {
        cbInterromper.current();
      }

      if (novoFinal) acumulado.current += novoFinal;
      setParcial((acumulado.current + ' ' + emCurso).trim());
      rearmarSilencio();
    };

    r.onerror = (evento) => {
      // `no-speech` e `aborted` são rotina numa escuta contínua: acontecem
      // toda vez que a pessoa fica quieta. Tratar como falha faria o modo
      // ligação se desligar sozinho a cada pausa.
      if (evento.error === 'no-speech' || evento.error === 'aborted') return;
      if (evento.error === 'not-allowed' || evento.error === 'service-not-allowed') {
        querendoOuvir.current = false;
        setAtiva(false);
        setEstado('indisponivel');
        setMotivo('Permissão de microfone negada. Libere no cadeado da barra de endereço.');
        return;
      }
      setMotivo(`Falha no reconhecimento: ${evento.error}`);
    };

    /**
     * O navegador encerra o reconhecimento sozinho depois de um tempo, mesmo
     * em modo contínuo. Sem religar, o "modo ligação" morre calado depois de
     * alguns segundos — e o operador acha que o microfone parou de funcionar.
     */
    r.onend = () => {
      if (!querendoOuvir.current) {
        setEstado('inativa');
        return;
      }
      try {
        r.start();
      } catch {
        // `start()` durante o encerramento lança; a próxima volta religa.
      }
    };

    try {
      r.start();
    } catch {
      setMotivo('Não consegui iniciar o microfone.');
    }

    return () => {
      querendoOuvir.current = false;
      if (relogioSilencio.current) clearTimeout(relogioSilencio.current);
      relogioSilencio.current = null;
      r.onresult = null;
      r.onerror = null;
      r.onend = null;
      r.onstart = null;
      try {
        r.abort();
      } catch {
        /* já encerrado */
      }
      reconhecedor.current = null;
      acumulado.current = '';
      setParcial('');
      setEstado('inativa');
    };
  }, [ativa, rearmarSilencio]);

  const alternar = useCallback(() => {
    if (!construtor()) return;
    setAtiva((v) => !v);
  }, []);

  return { estado, parcial, alternar, ativa, motivoIndisponivel };
}
