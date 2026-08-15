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

/**
 * SILÊNCIO DIGITAL — e por que ele é diferente de "ninguém falou".
 *
 * Um microfone de verdade nunca entrega zero. Mesmo numa sala vazia há ruído
 * térmico do próprio conversor e som de ambiente: o pico fica pequeno, mas
 * existe. Um dispositivo VIRTUAL sem fonte — webcam de celular desconectada,
 * cabo virtual, headset desligado — abre normalmente, reporta 48 kHz e uma
 * faixa ativa, e entrega amostras exatamente nulas.
 *
 * É essa diferença que este limiar mede, e é a única honesta: "não chegou som"
 * seria verdade sempre que a pessoa está calada. Abaixo disto não é uma sala
 * quieta, é um dispositivo que não capta.
 */
export const PISO_DE_SINAL = 0.002;

/**
 * Maior desvio do repouso numa janela de amostras, em 0..1.
 *
 * `getByteTimeDomainData` centra o silêncio em 128 — não em 0 — e é por isso
 * que o cálculo é a distância até o centro, e não o valor da amostra. Ler isto
 * errado daria "meio volume" para silêncio absoluto, que é exatamente o tipo de
 * medida que faria a faixa nunca aparecer.
 *
 * Separado do efeito para ser testável: o resto (AudioContext, fluxo, relógio)
 * só existe no navegador, mas a decisão "isto é um dispositivo mudo?" é pura e
 * é ela que decide se a IARA acusa ou cala.
 */
export function picoDe(amostras: Uint8Array): number {
  let pico = 0;
  for (let i = 0; i < amostras.length; i += 1) {
    const v = Math.abs(amostras[i] - 128) / 128;
    if (v > pico) pico = v;
  }
  return pico;
}

/** Abaixo do piso não é sala quieta, é dispositivo que não capta. */
export function ehSilencioDigital(pico: number): boolean {
  return pico <= PISO_DE_SINAL;
}

/**
 * Quanto tempo de silêncio digital seguido antes de dizer alguma coisa. Longo
 * de propósito: um alerta que pisca durante uma pausa da conversa é um alerta
 * que o operador aprende a ignorar — a mesma disciplina de carência do `Vigia`.
 */
const JANELA_SEM_SINAL_MS = 8000;

/** 4 Hz basta para isto e não disputa orçamento de quadro com a cena 3D. */
const CADENCIA_MEDICAO_MS = 250;

export interface DeteccaoVocal {
  estado: EstadoDeteccaoVocal;
  motivoIndisponivel: string | null;
  /**
   * O microfone abriu e não capta som há mais de `JANELA_SEM_SINAL_MS`. É um
   * FATO medido no fluxo de áudio, não uma suposição a partir de "não
   * reconheceu nada" — a distinção que custou uma semana em 15/08/2026, quando
   * o Windows apontava o dispositivo de comunicação para uma webcam sem fonte.
   */
  semSinal: boolean;
  /** Rótulo do dispositivo que o navegador entregou. É o que a IARA cita. */
  dispositivo: string | null;
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
  const [semSinal, setSemSinal] = useState(false);
  const [dispositivo, setDispositivo] = useState<string | null>(null);

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
    let fluxo: MediaStream | null = null;
    let contexto: AudioContext | null = null;
    let relogio: ReturnType<typeof setInterval> | null = null;
    setEstado('carregando');
    setMotivo(null);
    setSemSinal(false);

    import('@ricky0123/vad-web')
      .then(({ MicVAD }) =>
        MicVAD.new({
          /**
           * O FLUXO É NOSSO AGORA — e é uma captura só, não duas.
           *
           * O `getStream` padrão da lib abriria um microfone que só ela enxerga,
           * e medir nível exigiria um segundo `getUserMedia` do mesmo
           * dispositivo. Fornecendo o fluxo, o VAD e o medidor de sinal olham
           * exatamente as mesmas amostras — que é o que torna a medição uma
           * afirmação sobre o áudio que a IARA realmente ouve, e não sobre um
           * fluxo parecido aberto ao lado.
           *
           * As três restrições eram implícitas no padrão da lib e passam a ser
           * explícitas aqui: `echoCancellation` é o AEC de verdade contra a
           * própria voz da IARA voltando pelo alto-falante.
           */
          getStream: () =>
            navigator.mediaDevices
              .getUserMedia({
                audio: {
                  echoCancellation: true,
                  noiseSuppression: true,
                  autoGainControl: true,
                },
              })
              .then((f) => {
                fluxo = f;
                const faixa = f.getAudioTracks()[0];
                if (faixa) setDispositivo(faixa.label || null);
                return f;
              }),
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
        if (fluxo) medirSinal(fluxo);
      })
      .catch((erro: unknown) => {
        if (cancelado) return;
        // Falha de asset, permissão ou navegador sem AudioWorklet: cai para o
        // barge-in textual de sempre — nunca trava a escuta por causa disto.
        setEstado('indisponivel');
        setMotivo(erro instanceof Error ? erro.message : 'VAD indisponível.');
      });

    /**
     * Medição por intervalo, não por quadro. O único fato que sai daqui é
     * `semSinal`, que muda raramente — publicar o nível a 60 Hz custaria um
     * `setState` por quadro e derrubaria o orçamento da cena 3D pela mesma
     * razão que o `RelogioVoz` é um objeto estável em vez de estado.
     */
    function medirSinal(f: MediaStream): void {
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      try {
        contexto = new Ctx();
        /**
         * O iOS ENTREGA O CONTEXTO SUSPENSO, mesmo criado dentro de um gesto —
         * medido em iPhone/iOS 18.7 em 15/08/2026: `AudioContext: suspended @
         * 16000Hz`. Um analisador pendurado num contexto suspenso lê zeros para
         * sempre, e zero é exatamente o que esta medição interpreta como
         * "dispositivo mudo": sem esta linha a IARA acusaria microfone morto no
         * iPhone com o microfone perfeitamente bom.
         *
         * É o falso positivo que a faixa existe para não cometer, e ele entrou
         * aqui porque a sonda tratava o caso e o hook foi escrito sem olhar para
         * ela. Só apareceu porque a sonda rodou num aparelho de verdade.
         */
        if (contexto.state === 'suspended') void contexto.resume().catch(() => undefined);
        const analisador = contexto.createAnalyser();
        analisador.fftSize = 512;
        contexto.createMediaStreamSource(f).connect(analisador);
        const amostras = new Uint8Array(analisador.fftSize);
        let ultimoSinalEm = Date.now();

        relogio = setInterval(() => {
          analisador.getByteTimeDomainData(amostras);
          if (!ehSilencioDigital(picoDe(amostras))) {
            ultimoSinalEm = Date.now();
            setSemSinal((s) => (s ? false : s));
            return;
          }
          if (Date.now() - ultimoSinalEm > JANELA_SEM_SINAL_MS) {
            setSemSinal((s) => (s ? s : true));
          }
        }, CADENCIA_MEDICAO_MS);
      } catch {
        // Sem medição de nível a escuta continua inteira — isto é diagnóstico,
        // não caminho crítico. Silenciar aqui é a mesma política do `soarDespertar`.
      }
    }

    return () => {
      cancelado = true;
      if (relogio) clearInterval(relogio);
      relogio = null;
      instancia?.destroy();
      instancia = null;
      void contexto?.close().catch(() => undefined);
      contexto = null;
      // O fluxo é nosso: quem abre, fecha. Deixá-lo vivo mantém o indicador de
      // microfone em uso aceso com a escuta desligada — a tela mentindo de novo.
      fluxo?.getTracks().forEach((t) => t.stop());
      fluxo = null;
    };
  }, [ativar]);

  return { estado, motivoIndisponivel, semSinal, dispositivo };
}
