'use client';

/**
 * Detecção de atividade vocal (VAD) — o gatilho ACÚSTICO do barge-in.
 *
 * O QUE ISTO ACELERA, E O QUE NÃO MUDA
 *
 * `useEscuta` já interrompe a IARA hoje: quando `SpeechRecognition` devolve um
 * resultado reconhecível enquanto ela fala, dispara `aoInterromper`. O
 * problema é a latência — o reconhecedor só entrega o primeiro resultado
 * centenas de ms a mais de 1s depois da pessoa abrir a boca. Este hook ouve o
 * mesmo microfone com um modelo de VAD real (Silero, via `@ricky0123/vad-web`)
 * e dispara o MESMO callback assim que detecta energia de fala — antes de
 * qualquer transcrição existir. O caminho de interrupção (`interromperTudo`)
 * não muda; só o gatilho fica mais rápido.
 *
 * POR QUE NÃO HÁ MEIO-TERMO AQUI
 *
 * `interromperTudo` cancela o turno do kernel de verdade — não existe "pausa
 * reversível". Um VAD tem falso positivo (tosse, eco residual sem fone). A
 * mitigação fica nos parâmetros do próprio modelo (limiar, frames mínimos),
 * não numa lógica de confirmar-depois-desfazer: desfazer exigiria um estado
 * "pausado, turno ainda vivo" que não existe no kernel hoje. Ver
 * `docs/prd/test-plan-voz-tempo-real.md`, item VAD-011 — a taxa real de falso
 * positivo só se mede falando de verdade com o app rodando.
 *
 * DUAS CAPTURAS DE MICROFONE, DE PROPÓSITO
 *
 * `SpeechRecognition` (em `useEscuta`) e o `getUserMedia` deste hook são dois
 * fluxos independentes do mesmo dispositivo. `echoCancellation` pedido aqui é
 * cancelamento acústico real (WebRTC AEC) — mais robusto contra a própria voz
 * da IARA voltando pelo alto-falante do que a guarda textual de `pareceEco`,
 * que continua ativa como rede de segurança na transcrição.
 *
 * ASSETS DO MODELO
 *
 * Carregados do CDN padrão da biblioteca (jsdelivr), não autohospedados: os
 * binários do ONNX Runtime somam dezenas de MB — inflar o repo com isso é
 * pior que depender de rede, na mesma lógica de "cópia velha é pior que
 * nenhuma cópia" que já vale para os outros assets deste projeto.
 */

import { useEffect, useRef, useState } from 'react';

export type EstadoDeteccaoVocal = 'inativa' | 'carregando' | 'ativa' | 'indisponivel';

export interface DeteccaoVocal {
  estado: EstadoDeteccaoVocal;
  motivoIndisponivel: string | null;
}

export interface OpcoesDeteccaoVocal {
  /** Só captura microfone quando a escuta (vigília ou ligação) já está aberta. */
  ativar: boolean;
  /** A IARA está falando agora? Só dispara interrupção se estiver. */
  iaraFalando: boolean;
  /** Chamado no instante em que o VAD detecta início de fala. */
  aoIniciarFala: () => void;
}

export function useDeteccaoVocal({
  ativar,
  iaraFalando,
  aoIniciarFala,
}: OpcoesDeteccaoVocal): DeteccaoVocal {
  const [estado, setEstado] = useState<EstadoDeteccaoVocal>('inativa');
  const [motivoIndisponivel, setMotivo] = useState<string | null>(null);

  const falandoRef = useRef(iaraFalando);
  const cbIniciarFala = useRef(aoIniciarFala);
  useEffect(() => {
    falandoRef.current = iaraFalando;
  }, [iaraFalando]);
  useEffect(() => {
    cbIniciarFala.current = aoIniciarFala;
  }, [aoIniciarFala]);

  useEffect(() => {
    if (!ativar) {
      setEstado('inativa');
      return;
    }
    if (typeof window === 'undefined' || !window.isSecureContext) {
      setEstado('indisponivel');
      setMotivo('VAD exige contexto seguro (HTTPS ou localhost).');
      return;
    }

    let cancelado = false;
    let instancia: { destroy: () => void } | null = null;
    setEstado('carregando');
    setMotivo(null);

    import('@ricky0123/vad-web')
      .then(({ MicVAD }) =>
        MicVAD.new({
          // `getStream` padrão da lib já pede echoCancellation/autoGainControl/
          // noiseSuppression — não precisa ser repetido aqui.
          //
          // Caminho ("./") explícito para o CDN: o padrão da lib resolve os
          // assets relativo à própria URL da página, o que exigiria
          // autohospedar dezenas de MB de binário do ONNX Runtime em
          // `public/`. Versões travadas nas instaladas em `package.json`.
          baseAssetPath: 'https://cdn.jsdelivr.net/npm/@ricky0123/vad-web@0.0.30/dist/',
          onnxWASMBasePath: 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.27.0/dist/',
          onSpeechStart: () => {
            if (falandoRef.current) cbIniciarFala.current();
          },
        }),
      )
      .then((vad) => {
        if (cancelado) {
          vad.destroy();
          return;
        }
        instancia = vad;
        vad.start();
        setEstado('ativa');
      })
      .catch((erro: unknown) => {
        if (cancelado) return;
        // Falha de asset, permissão ou navegador sem AudioWorklet: cai para o
        // barge-in textual de sempre — nunca trava a escuta por causa disto.
        setEstado('indisponivel');
        setMotivo(erro instanceof Error ? erro.message : 'VAD indisponível.');
      });

    return () => {
      cancelado = true;
      instancia?.destroy();
      instancia = null;
    };
  }, [ativar]);

  return { estado, motivoIndisponivel };
}
