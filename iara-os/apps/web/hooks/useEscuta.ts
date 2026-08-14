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
 *
 * VIGÍLIA — "EI IARA"
 *
 * Com a vigília ligada, o MESMO reconhecedor fica aberto o tempo todo. Fora do
 * modo ligação ele não acumula nem envia nada: só procura o chamado ("ei
 * IARA"). Ao ouvi-lo, vira modo ligação — e o que veio na mesma frase depois
 * do chamado ("ei IARA, que horas são?") já entra como primeiro pedido.
 * Um reconhecedor só, sempre: dois `SpeechRecognition` simultâneos disputam o
 * microfone e o navegador mata um deles.
 *
 * Uma ligação aberta pelo chamado se fecha sozinha depois de um tempo sem
 * ninguém falar, voltando à vigília — senão o primeiro "ei IARA" do dia
 * deixaria o microfone em modo ligação para sempre.
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

/** Ligação aberta pelo chamado fecha sozinha após este ócio, voltando à vigília. */
const OCIO_VIGILIA_MS = 45_000;

/** Preferência do operador, por navegador. */
const CHAVE_VIGILIA = 'iara.vigilia';

/**
 * ORÇAMENTO DE FALHA DO RECONHECEDOR — e o defeito que ele encerra.
 *
 * `SpeechRecognition` responde `error: 'network'` quando o serviço de fala do
 * navegador não atende. Isso NÃO é raro: acontece em WebView2 (a moldura do
 * app desktop), em builds de Chromium sem a chave do serviço do Google, atrás
 * de proxy corporativo e simplesmente sem internet.
 *
 * O tratamento anterior era `atrasoReligar = 2000; return;` — sem contador,
 * sem teto, sem uma palavra ao operador. O resultado era o pior estado
 * possível de um sistema: `start()` funciona, `onstart` dispara, a faixa
 * escreve "vigília ligada — diga 'ei IARA'", e dois segundos depois tudo
 * recomeça, para sempre, sem nunca reconhecer nada. O operador dizia "ei
 * IARA" e NADA ACONTECIA, sem nenhum sinal de que havia algo errado.
 *
 * Falha que se repete sem parar não é resiliência, é silêncio disfarçado de
 * saúde. Depois deste teto a escuta se declara indisponível, diz por quê, e
 * oferece uma nova tentativa — que é um gesto humano, como toda religação
 * depois de uma recusa neste sistema.
 */
const TETO_FALHAS_SEGUIDAS = 4;

/** Espera antes de religar após falha de infraestrutura: 2 s, 4 s, 8 s… */
const ESPERA_BASE_FALHA_MS = 2000;

/**
 * O chamado exige a interjeição ("ei IARA"), não o nome sozinho: "Iara" é nome
 * de gente e apareceria em conversa de escritório. "yara" cobre a grafia que o
 * reconhecedor às vezes prefere.
 */
const PADRAO_CHAMADO = /(?:^|\s)(?:ei|hei|hey|oi|o)[\s,]+[iy]ara\b[\s,!.?]*/;

/**
 * Procura o chamado numa transcrição e devolve o que veio depois dele.
 *
 * A normalização remove acentos SÓ para comparar; o resto devolvido preserva o
 * texto original (o mapeamento de índices vale porque NFD + remoção de
 * combinantes não muda a contagem de caracteres-base).
 */
export function detectarChamado(transcricao: string): { chamou: boolean; resto: string } {
  const normalizada = transcricao
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  const m = PADRAO_CHAMADO.exec(normalizada);
  if (!m) return { chamou: false, resto: '' };
  return { chamou: true, resto: transcricao.slice(m.index + m[0].length).trim() };
}

/**
 * Um toque curto confirma que a IARA acordou — essencial quando o painel está
 * escondido atrás de outras janelas. Sem asset, sem dependência: um seno de
 * 880 Hz com envelope. Se o navegador bloquear áudio sem gesto, falha calada.
 */
function soarDespertar(): void {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const ganho = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    ganho.gain.setValueAtTime(0.0001, ctx.currentTime);
    ganho.gain.exponentialRampToValueAtTime(0.1, ctx.currentTime + 0.02);
    ganho.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(ganho).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => void ctx.close();
  } catch {
    /* sem áudio, sem drama */
  }
}

/**
 * GUARDA DE ECO. Sem cancelamento de eco de hardware, a voz da própria IARA
 * saindo do alto-falante volta pelo microfone — e sem esta guarda ela se
 * auto-interrompia e ainda transcrevia a própria fala como pergunta nova
 * (loop de autoconversa em qualquer setup sem fone).
 *
 * O critério é textual e local: se o que o reconhecedor ouviu enquanto a IARA
 * falava é um trecho do que ELA está dizendo, é eco, não gente. Comparação
 * normalizada (sem acento/caixa/pontuação) e por inclusão, porque o
 * reconhecedor devolve fragmentos.
 */
export function pareceEco(ouvido: string, falaDaIara: string | null): boolean {
  if (!falaDaIara) return false;
  const normalizar = (t: string) =>
    t
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const o = normalizar(ouvido);
  if (o.length < 3) return true; // "ãã", ruído: nunca é interrupção válida
  return normalizar(falaDaIara).includes(o);
}

/**
 * `reconectando` é DIFERENTE de `indisponivel`: o orçamento de falha ainda não
 * estourou, o microfone vai voltar sozinho em segundos, e não há nada para o
 * operador decidir — não é o "Tentar de novo" do religamento manual, é só a
 * IARA sendo honesta sobre um intervalo em que ela ainda não está ouvindo de
 * verdade, apesar da vigília continuar ligada.
 */
export type EstadoEscuta =
  | 'inativa'
  | 'vigiando'
  | 'ouvindo'
  | 'processando'
  | 'reconectando'
  | 'indisponivel';

export interface Escuta {
  estado: EstadoEscuta;
  /** O que está sendo reconhecido agora, ainda não enviado. */
  parcial: string;
  /** Ligar/desligar o modo ligação. */
  alternar: () => void;
  ativa: boolean;
  /** A vigília do chamado "ei IARA" está ligada? */
  vigilia: boolean;
  /** Ligar/desligar a vigília (preferência persistida por navegador). */
  alternarVigilia: () => void;
  motivoIndisponivel: string | null;
  /**
   * Nova tentativa depois de a escuta se declarar indisponível. Existe porque
   * a alternativa a um gesto humano é o religamento automático eterno — que é
   * exatamente o defeito que o orçamento de falha encerrou.
   */
  religar: () => void;
}

export interface OpcoesEscuta {
  /**
   * Chamado quando a pessoa termina de falar.
   *
   * O RETORNO IMPORTA — achado em auditoria (14/08/2026). Antes era `void`, e
   * `enviarAcumulado` nunca sabia se o texto reconhecido de fato saiu para o
   * barramento. Quando o socket caía bem no instante do silêncio que dispara o
   * envio, o comando reconhecido desaparecia: `estado` ficava preso em
   * `'processando'` para sempre (só um `onresult` novo o tira de lá), e do
   * ponto de vista de quem chamou "ei IARA" e falou um comando, "nada
   * acontece" — sem nenhum jeito de saber que a causa foi a conexão, e sem o
   * microfone voltar a ouvir sozinho. `false` é o sinal para `enviarAcumulado`
   * desistir da espera e voltar a ouvir.
   */
  aoConcluirFala: (texto: string) => boolean | void;
  /** Chamado quando a pessoa começa a falar enquanto a IARA fala. */
  aoInterromper: () => void;
  /**
   * Chamado quando o "ei IARA" acorda a vigília. É a vez da saudação falada
   * ("Oi Daiane, pode falar"). Devolver `false` significa "não consegui dar
   * feedback" (voz desligada) — aí sai o toque de 880 Hz no lugar, para o
   * despertar nunca ser mudo com o painel escondido atrás de outras janelas.
   */
  aoAcordar?: () => boolean | void;
  /** A IARA está falando agora? Define se uma fala nova é interrupção. */
  iaraFalando: boolean;
  /** O texto que a IARA está falando agora — base da guarda de eco. */
  textoFalado?: string | null;
}

export function useEscuta({
  aoConcluirFala,
  aoInterromper,
  aoAcordar,
  iaraFalando,
  textoFalado = null,
}: OpcoesEscuta): Escuta {
  const [ativa, setAtiva] = useState(false);
  const [vigilia, setVigilia] = useState(false);
  const [estado, setEstado] = useState<EstadoEscuta>('inativa');
  const [parcial, setParcial] = useState('');
  const [motivoIndisponivel, setMotivo] = useState<string | null>(null);

  const reconhecedor = useRef<Reconhecedor | null>(null);
  const relogioSilencio = useRef<ReturnType<typeof setTimeout> | null>(null);
  const acumulado = useRef('');
  const querendoOuvir = useRef(false);
  // Lidos por handlers que vivem fora do ciclo de render.
  const falandoRef = useRef(iaraFalando);
  const textoFaladoRef = useRef(textoFalado);
  const cbConcluir = useRef(aoConcluirFala);
  const cbInterromper = useRef(aoInterromper);
  const cbAcordar = useRef(aoAcordar);
  /**
   * O reconhecedor NÃO é recriado quando vigília vira ligação (é a mesma
   * sessão de microfone); os handlers decidem o comportamento pelo modo do
   * momento, lido destes refs.
   */
  const ativaRef = useRef(false);
  const vigiliaRef = useRef(false);
  /** Finais da frase em curso durante a vigília, só para procurar o chamado. */
  const fraseVigilia = useRef('');
  /** Instante do último final da vigília — fecha a janela de 3,5 s do buffer. */
  const ultimoFinalVigilia = useRef(0);
  /** O chamado chegou num resultado parcial; cortar o prefixo do final seguinte. */
  const cortarChamadoDoFinal = useRef(false);
  /** A ligação atual nasceu do chamado (e por isso fecha sozinha no ócio). */
  const origemChamado = useRef(false);
  const relogioOcio = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Respiro entre o `onend` do navegador e o religamento do reconhecedor. */
  const relogioReligar = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Religamento atrasado após falha de rede/captura (anti loop quente). */
  const atrasoReligar = useRef(0);
  /**
   * Falhas de infraestrutura desde o último reconhecimento BEM-SUCEDIDO. Conta
   * só as seguidas: um tropeço de rede isolado numa sessão de horas não pode
   * somar com outro tropeço três horas depois e derrubar a escuta. Ver
   * `TETO_FALHAS_SEGUIDAS`.
   */
  const falhasSeguidas = useRef(0);
  /** Gesto humano de nova tentativa — remonta o efeito da escuta. */
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    falandoRef.current = iaraFalando;
    textoFaladoRef.current = textoFalado;
  }, [iaraFalando, textoFalado]);
  useEffect(() => {
    cbConcluir.current = aoConcluirFala;
    cbInterromper.current = aoInterromper;
    cbAcordar.current = aoAcordar;
  }, [aoConcluirFala, aoInterromper, aoAcordar]);

  useEffect(() => {
    if (!construtor()) {
      setEstado('indisponivel');
      setMotivo('Este navegador não reconhece voz. Use Chrome ou Edge.');
      return;
    }
    // A vigília é preferência durável: quem ligou uma vez quer a IARA
    // atendendo ao chamado em toda sessão, não só na aba em que clicou.
    try {
      if (localStorage.getItem(CHAVE_VIGILIA) === '1') {
        vigiliaRef.current = true;
        setVigilia(true);
      }
    } catch {
      /* sem localStorage (modo privado agressivo), vigília começa desligada */
    }
  }, []);

  const enviarAcumulado = useCallback(() => {
    const texto = acumulado.current.trim();
    acumulado.current = '';
    setParcial('');
    if (texto.length < MINIMO_CARACTERES) return;
    setEstado('processando');
    const enviou = cbConcluir.current(texto);
    /**
     * `false` EXPLÍCITO — não a ausência de erro — é o único sinal que conta.
     * `enviar()` do socket já registra um alerta próprio quando o barramento
     * está fechado; o que faltava era o MICROFONE saber que o pedido não foi
     * a lugar nenhum. Sem isto, `estado` ficava preso em `'processando'` até
     * a pessoa falar de novo por conta própria — e como a vigília às vezes
     * está sozinha, sem ninguém olhando o log técnico, o efeito observado era
     * "falei o comando e não aconteceu nada", sem explicação nem religamento.
     * Volta a ouvir na hora: se o operador falar de novo, tenta de novo.
     */
    if (enviou === false) setEstado(ativaRef.current ? 'ouvindo' : 'vigiando');
  }, []);

  const rearmarSilencio = useCallback(() => {
    if (relogioSilencio.current) clearTimeout(relogioSilencio.current);
    relogioSilencio.current = setTimeout(enviarAcumulado, SILENCIO_MS);
  }, [enviarAcumulado]);

  /**
   * Ligação nascida do chamado fecha sozinha no ócio. O relógio rearma a cada
   * som reconhecido; só expira quando ninguém fala há OCIO_VIGILIA_MS.
   */
  const rearmarOcio = useCallback(() => {
    if (relogioOcio.current) clearTimeout(relogioOcio.current);
    if (!origemChamado.current) return;
    relogioOcio.current = setTimeout(() => {
      if (!origemChamado.current || !ativaRef.current) return;
      ativaRef.current = false;
      origemChamado.current = false;
      acumulado.current = '';
      setAtiva(false);
      setParcial('');
      setEstado('vigiando');
    }, OCIO_VIGILIA_MS);
  }, []);

  // -------------------------------------------------------------------------

  const escutando = ativa || vigilia;

  useEffect(() => {
    if (!escutando) return;
    const Reconhecimento = construtor();
    if (!Reconhecimento) return;

    const r = new Reconhecimento();
    r.lang = 'pt-BR';
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    reconhecedor.current = r;
    querendoOuvir.current = true;

    r.onstart = () => setEstado(ativaRef.current ? 'ouvindo' : 'vigiando');

    r.onresult = (evento) => {
      /**
       * PROVA DE VIDA do serviço de fala, e o único lugar que a produz.
       *
       * `start()` e `onstart` não provam nada: em WebView2 os dois acontecem e
       * o reconhecimento nunca funciona. Chegar aqui significa que áudio virou
       * texto de verdade — é o que zera o orçamento de falha.
       */
      falhasSeguidas.current = 0;

      let novoFinal = '';
      let emCurso = '';

      for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
        const res = evento.results[i];
        const texto = res[0].transcript;
        if (res.isFinal) novoFinal += texto;
        else emCurso += texto;
      }

      /**
       * VIGÍLIA: nada é acumulado nem enviado; a única pergunta é "alguém
       * chamou?". O buffer da frase em curso existe porque o chamado pode vir
       * quebrado entre resultados ("ei" num final, "iara" no seguinte).
       */
      if (!ativaRef.current) {
        /**
         * Janela temporal do buffer: "…tá bom, ei" numa frase e "Iara ligou
         * ontem" na frase seguinte concatenavam em "ei iara" e acordavam a
         * vigília. Finais com mais de 3,5 s de distância não são a mesma frase.
         */
        const agora = Date.now();
        if (novoFinal && agora - ultimoFinalVigilia.current > 3500) fraseVigilia.current = '';
        if (novoFinal) ultimoFinalVigilia.current = agora;

        const frase = `${fraseVigilia.current} ${novoFinal} ${emCurso}`;
        if (novoFinal) fraseVigilia.current = `${fraseVigilia.current} ${novoFinal}`.slice(-200);

        const chamadoNoFinal = detectarChamado(`${fraseVigilia.current}`);
        const chamado = chamadoNoFinal.chamou ? chamadoNoFinal : detectarChamado(frase);
        if (!chamado.chamou) return;

        // ACORDOU. A mesma sessão de microfone vira ligação; o que veio na
        // frase depois do chamado já é o primeiro pedido.
        fraseVigilia.current = '';
        ativaRef.current = true;
        origemChamado.current = true;
        // Quem chama quer ser ouvido: se a IARA estiver falando, ela se cala.
        if (falandoRef.current) cbInterromper.current();
        // Saudação falada; se a voz estiver desligada, o toque de 880 Hz
        // responde no lugar — o despertar nunca é mudo.
        if (!cbAcordar.current || cbAcordar.current() === false) soarDespertar();
        if (chamadoNoFinal.chamou) {
          // O chamado (e talvez o pedido) já está em resultados finais.
          acumulado.current = chamadoNoFinal.resto ? `${chamadoNoFinal.resto} ` : '';
        } else {
          // O chamado ainda é parcial; o final correspondente chega já em modo
          // ligação e precisa perder o prefixo "ei IARA".
          cortarChamadoDoFinal.current = true;
        }
        setAtiva(true);
        setEstado('ouvindo');
        setParcial(acumulado.current.trim());
        rearmarSilencio();
        rearmarOcio();
        return;
      }

      // MODO LIGAÇÃO -------------------------------------------------------

      // Voltar de `processando` para `ouvindo`: o envio já aconteceu e o
      // reconhecedor continua vivo — sem isto a faixa fica presa em
      // "processando" para sempre, mesmo com o microfone aberto.
      setEstado((e) => (e === 'processando' ? 'ouvindo' : e));

      if (cortarChamadoDoFinal.current && novoFinal) {
        const d = detectarChamado(novoFinal);
        if (d.chamou) novoFinal = d.resto;
        cortarChamadoDoFinal.current = false;
      }

      /**
       * BARGE-IN com guarda de eco. Som reconhecível enquanto a IARA fala é
       * interrupção — dispara ANTES de acumular, porque quem corta a IARA
       * quer que ela pare agora. MAS: se o que chegou é a voz DELA voltando
       * pelo alto-falante (eco), não é gente falando — ignorar por completo,
       * senão ela se auto-interrompe e transcreve a própria fala como
       * pergunta nova.
       */
      if (falandoRef.current && (novoFinal || emCurso)) {
        const ouvido = `${novoFinal} ${emCurso}`.trim();
        if (pareceEco(ouvido, textoFaladoRef.current)) return;
        cbInterromper.current();
      }

      if (novoFinal) acumulado.current += novoFinal;
      setParcial((acumulado.current + ' ' + emCurso).trim());
      rearmarSilencio();
      rearmarOcio();
    };

    r.onerror = (evento) => {
      // `no-speech` e `aborted` são rotina numa escuta contínua: acontecem
      // toda vez que a pessoa fica quieta. Tratar como falha faria o modo
      // ligação se desligar sozinho a cada pausa.
      if (evento.error === 'no-speech' || evento.error === 'aborted') return;
      /**
       * Falha de infraestrutura (serviço de fala do navegador, captura de
       * áudio). Religar imediatamente vira loop quente erro→onend→start; mas
       * religar PARA SEMPRE é pior, porque some com o problema em vez de
       * mostrá-lo. Recua em dobro a cada tentativa e desiste no teto,
       * dizendo o que houve. Ver `TETO_FALHAS_SEGUIDAS`.
       */
      if (evento.error === 'network' || evento.error === 'audio-capture') {
        falhasSeguidas.current += 1;
        if (falhasSeguidas.current < TETO_FALHAS_SEGUIDAS) {
          atrasoReligar.current = ESPERA_BASE_FALHA_MS * 2 ** (falhasSeguidas.current - 1);
          /**
           * A TELA NÃO PODE MENTIR DURANTE O RELIGAMENTO — achado em auditoria
           * (14/08/2026): até aqui, nada tocava `estado` nas primeiras
           * `TETO_FALHAS_SEGUIDAS - 1` falhas (até ~14 s de backoff). A faixa
           * ficava parada em `'vigiando'`, e "vigília ligada — diga 'ei IARA'"
           * continuava na tela, palavra por palavra igual ao caso em que o
           * microfone está de fato ouvindo. Quem chamasse bem nesse intervalo
           * via exatamente o sintoma relatado: nenhuma mudança, silêncio total.
           * `onstart` (linha abaixo) volta a `'ouvindo'`/`'vigiando'` sozinho
           * assim que um religamento realmente pega — este estado é só a
           * verdade sobre a janela em que ainda não pegou.
           */
          setEstado('reconectando');
          return;
        }
        // Orçamento estourado: parar de tentar e CONTAR.
        querendoOuvir.current = false;
        ativaRef.current = false;
        vigiliaRef.current = false;
        origemChamado.current = false;
        setAtiva(false);
        setVigilia(false);
        setEstado('indisponivel');
        setMotivo(
          evento.error === 'network'
            ? 'O serviço de reconhecimento de voz do navegador não respondeu ' +
                `(${TETO_FALHAS_SEGUIDAS} tentativas). Ele exige internet e não existe em ` +
                'toda moldura de aplicativo. Você pode escrever normalmente.'
            : 'Não consegui capturar áudio do microfone ' +
                `(${TETO_FALHAS_SEGUIDAS} tentativas). Verifique se outro programa está usando o dispositivo.`,
        );
        return;
      }
      if (evento.error === 'not-allowed' || evento.error === 'service-not-allowed') {
        querendoOuvir.current = false;
        ativaRef.current = false;
        vigiliaRef.current = false;
        origemChamado.current = false;
        setAtiva(false);
        // Sem microfone não há vigília; manter a preferência gravada faria a
        // página tentar (e falhar) de novo a cada carga.
        setVigilia(false);
        try {
          localStorage.removeItem(CHAVE_VIGILIA);
        } catch {
          /* indiferente */
        }
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
     * O religamento tem um respiro (250 ms, ou 2 s após falha de rede): o
     * `start()` imediato dentro do `onend` era um loop quente quando o
     * serviço de voz falhava em sequência.
     */
    r.onend = () => {
      if (!querendoOuvir.current) {
        setEstado('inativa');
        return;
      }
      const espera = atrasoReligar.current || 250;
      atrasoReligar.current = 0;
      relogioReligar.current = setTimeout(() => {
        relogioReligar.current = null;
        if (!querendoOuvir.current) return;
        try {
          r.start();
        } catch {
          // `start()` durante um encerramento em curso lança; o próximo
          // `onend` religa.
        }
      }, espera);
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
      if (relogioOcio.current) clearTimeout(relogioOcio.current);
      relogioOcio.current = null;
      if (relogioReligar.current) clearTimeout(relogioReligar.current);
      relogioReligar.current = null;
      atrasoReligar.current = 0;
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
      fraseVigilia.current = '';
      cortarChamadoDoFinal.current = false;
      origemChamado.current = false;
      setParcial('');
      setEstado((e) => (e === 'indisponivel' ? e : 'inativa'));
    };
  }, [escutando, tentativa, rearmarSilencio, rearmarOcio]);

  const alternar = useCallback(() => {
    if (!construtor()) return;
    const nova = !ativaRef.current;
    ativaRef.current = nova;
    origemChamado.current = false;
    if (relogioOcio.current) clearTimeout(relogioOcio.current);
    setAtiva(nova);
    /**
     * Abrir a ligação PUBLICA o estado. Faltava esta linha: com a vigília já
     * ligada, `escutando` não mudava, o efeito não remontava, `onstart` não
     * disparava — e o estado ficava preso em `vigiando` com a ligação aberta.
     * A tela continuava escrevendo "diga 'ei IARA' para abrir a ligação"
     * DEPOIS de a ligação ter sido aberta pelo botão.
     */
    if (nova) setEstado('ouvindo');
    if (!nova) {
      acumulado.current = '';
      if (relogioSilencio.current) clearTimeout(relogioSilencio.current);
      setParcial('');
      // Com vigília ligada o reconhecedor NÃO morre — só volta a vigiar.
      // (Sem vigília, a desmontagem do efeito põe 'inativa'.)
      if (vigiliaRef.current) setEstado('vigiando');
    }
  }, []);

  const alternarVigilia = useCallback(() => {
    if (!construtor()) return;
    const nova = !vigiliaRef.current;
    vigiliaRef.current = nova;
    setVigilia(nova);
    try {
      if (nova) localStorage.setItem(CHAVE_VIGILIA, '1');
      else localStorage.removeItem(CHAVE_VIGILIA);
    } catch {
      /* preferência não persiste, mas a sessão atual funciona */
    }
    if (!nova && !ativaRef.current) return; // efeito desmonta e põe 'inativa'
    if (nova && !ativaRef.current) setEstado('vigiando');
  }, []);

  /**
   * Nova tentativa depois da desistência. Zera o orçamento, limpa o motivo e
   * religa a vigília — o mesmo desenho do `religar()` do barramento, e pelo
   * mesmo motivo: depois de uma recusa, quem decide voltar é a pessoa.
   */
  const religar = useCallback(() => {
    if (!construtor()) return;
    falhasSeguidas.current = 0;
    atrasoReligar.current = 0;
    setMotivo(null);
    vigiliaRef.current = true;
    setVigilia(true);
    setEstado('vigiando');
    setTentativa((n) => n + 1);
  }, []);

  return {
    estado,
    parcial,
    alternar,
    ativa,
    vigilia,
    alternarVigilia,
    motivoIndisponivel,
    religar,
  };
}
