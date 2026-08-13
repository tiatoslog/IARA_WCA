'use client';

/**
 * Reprodução da voz e o relógio que a boca segue.
 *
 * DOIS CAMINHOS DE VOZ, UMA POLÍTICA
 *
 * 1. Áudio do servidor (`fala.voz`) — síntese Convai feita no motor. É o
 *    caminho de qualidade: o kernel manda a URL e o elemento de áudio é a
 *    ÚNICA fonte de tempo da articulação. O `ControladorFacial` pergunta a
 *    este objeto onde o áudio está, quadro a quadro.
 * 2. Síntese do navegador (`speechSynthesis`) — fallback quando o servidor
 *    não mandou áudio (sem CONVAI_API_KEY). Nativa, gratuita, sem chave e
 *    sem enviar texto para servidor de terceiro. No Edge/Windows há vozes
 *    neurais em pt-BR; no Chrome, a voz do Google. A boca do avatar volta a
 *    ser aproximada pela cadência de leitura — aproximação honesta, já
 *    prevista no contrato de visemas.
 *
 * A REGRA DO HISTÓRICO: fala que já estava na tela quando o componente
 * montou não é falada. Reproduzir o passado em voz alta ao recarregar a
 * página seria a IARA repetindo a última resposta sem ninguém ter pedido.
 *
 * Nada aqui provoca re-render durante a fala: o `RelogioVoz` é um objeto
 * estável que lê `currentTime` na hora em que é perguntado. Um `setState` por
 * quadro de áudio derrubaria o frame budget da cena 3D.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { urlVoz } from '@/lib/supabaseNavegador';
import type { Fala } from './useIaraSocket';

const CHAVE_PREFERENCIA = 'iara.voz_navegador';

/**
 * O relógio da voz — e ele responde DUAS perguntas, não uma.
 *
 * `progresso()` sozinho não bastava, e a falta se via na tela. A síntese do
 * navegador (`speechSynthesis`) não tem linha do tempo: não existe elemento de
 * áudio para perguntar, então `progresso()` devolve `null` o tempo todo. A
 * presença lia esse `null` como "não há voz", saía do estado `respondendo` no
 * instante em que a fala era concluída, e a entidade voltava ao repouso —
 * cor de repouso, amplitude de repouso — enquanto a IARA ainda estava
 * FALANDO em voz alta. Era isso que se via como "a animação quase não muda de
 * cor e trava": ela não estava travando, estava desligada durante a fala.
 *
 * As duas perguntas são independentes de propósito:
 *  - `audivel()` — sai som da IARA agora? Verdadeiro para os DOIS caminhos.
 *  - `progresso()` — onde a fala está na linha do tempo? Só o áudio do
 *    servidor sabe; a síntese do navegador devolve `null` e a presença cai
 *    para a cadência de leitura, ancorada em `audivelDesde()`.
 */
export interface RelogioVoz {
  /** 0..1 enquanto há áudio carregado e tocando; `null` quando não há voz. */
  progresso(): number | null;
  /** Sai som da IARA agora — por áudio do servidor OU síntese do navegador. */
  audivel(): boolean;
  /**
   * `performance.now()` do instante em que a voz corrente ficou audível, ou
   * `null`. É a âncora da cadência de leitura: sem ela a articulação começava
   * na ABERTURA DO TURNO e terminava antes de a voz sair, deixando a fala
   * inteira sem presença nenhuma.
   */
  audivelDesde(): number | null;
}

export interface EstadoVoz {
  relogio: RelogioVoz;
  /** true enquanto a IARA está audível — áudio do servidor OU síntese local. */
  tocando: boolean;
  /**
   * O navegador recusou o autoplay. Não é erro nosso: política de mídia exige
   * gesto do usuário. A UI precisa saber para oferecer o botão.
   */
  bloqueado: boolean;
  /** Libera o áudio após um gesto do operador. */
  liberar(): void;
  /** A síntese local existe neste navegador? (Firefox antigo: não.) */
  sinteseDisponivel: boolean;
  /** Preferência do operador: a IARA fala em voz alta? Persistida. */
  vozLigada: boolean;
  /** Liga/desliga a voz — vale para os dois caminhos. */
  alternarVoz(): void;
  /** Cala a IARA agora: para o áudio e cancela a síntese em curso. */
  silenciar(): void;
  /**
   * Fala um texto avulso — fora do fluxo de falas do kernel. Existe para a
   * saudação do chamado de voz ("Oi Daiane, pode falar"): é fala da INTERFACE,
   * não do kernel, então não passa pelo snapshot. Respeita a preferência de
   * voz e cala qualquer síntese em curso antes. Devolve `false` quando a voz
   * está desligada/indisponível — quem chamou decide o feedback alternativo.
   */
  falar(texto: string): boolean;
  /**
   * O texto avulso que está saindo no alto-falante AGORA (ou `null`). A guarda
   * de eco da escuta compara o que o microfone ouviu com o que a IARA está
   * dizendo — e a saudação não passa pelo snapshot, então sem este campo o
   * microfone ouvia "Oi Daiane, pode falar" pelo alto-falante, não reconhecia
   * como eco e tratava como interrupção + pergunta nova: a IARA respondia ao
   * próprio eco por cima da própria voz.
   */
  textoAvulso: string | null;
}

/**
 * Quebra o texto em sentenças. O `speechSynthesis` do Chrome trava em
 * enunciados longos (bug antigo de ~15 s); sentenças contornam isso e ainda
 * deixam a interrupção soar imediata.
 *
 * A quebra é SÓ em fim de sentença. A versão anterior fatiava sentenças
 * grandes por vírgula — e cada fatia vira um enunciado com prosódia própria e
 * pausa dura entre elas: era isso que soava "atropelado", a IARA lendo uma
 * frase como se fosse uma lista. Vírgula só entra como último recurso em
 * sentença realmente gigante (> 400 caracteres sem ponto), onde o risco de
 * travar a síntese pesa mais que a prosódia.
 */
function sentencas(texto: string): string[] {
  const limpo = texto
    .replace(/[•*#_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo) return [];
  const partes = limpo.match(/[^.!?…]+[.!?…]*/g) ?? [limpo];
  const saida: string[] = [];
  for (const parte of partes) {
    const p = parte.trim();
    if (!p) continue;
    if (p.length > 400) {
      for (const sub of p.split(/,\s*/)) {
        const s = sub.trim();
        if (s) saida.push(s);
      }
    } else {
      saida.push(p);
    }
  }
  return saida;
}

/**
 * A IARA tem voz FEMININA — isso é identidade, não preferência do sistema.
 * Windows/Edge não expõem gênero na API, então o filtro é por nome: a lista
 * cobre todas as vozes femininas pt-BR que a Microsoft e o Google publicam.
 */
const VOZES_FEMININAS =
  /francisca|thalita|maria|brenda|elza|giovanna|leila|leticia|luciana|manuela|yara|camila|vitoria|google português/i;
const VOZES_MASCULINAS = /daniel|antonio|antônio|donato|fabio|fábio|humberto|julio|júlio|nicolau|valerio|valério/i;

/**
 * Escolhe a voz mais humana e feminina disponível, nesta ordem:
 *  1. Neural feminina ("Natural" do Edge — qualidade de gente de verdade);
 *  2. Feminina clássica (Maria do Windows, voz do Google no Chrome);
 *  3. Qualquer pt-BR que não seja masculina conhecida;
 *  4. Último recurso: qualquer pt.
 * A lista carrega de forma assíncrona — por isso a escolha acontece NA HORA
 * de falar, nunca na montagem.
 */
function escolherVoz(): SpeechSynthesisVoice | null {
  const vozes = window.speechSynthesis.getVoices();
  if (vozes.length === 0) return null;
  const ptBr = vozes.filter((v) => v.lang.toLowerCase().startsWith('pt-br'));

  const pontuar = (v: SpeechSynthesisVoice): number => {
    let pontos = 0;
    // "Natural"/"Online" são as neurais do Edge — qualidade de gente de
    // verdade, sempre à frente de qualquer voz SAPI clássica.
    if (/natural|online/i.test(v.name)) pontos += 6;
    // A voz do Google no Chrome é neural também — melhor que a Maria local.
    if (/google/i.test(v.name)) pontos += 3;
    if (VOZES_FEMININAS.test(v.name)) pontos += 8;
    if (VOZES_MASCULINAS.test(v.name)) pontos -= 100;
    return pontos;
  };

  const melhor = [...ptBr].sort((a, b) => pontuar(b) - pontuar(a))[0];
  if (melhor && pontuar(melhor) >= 0) return melhor;

  /**
   * NUNCA uma voz masculina conhecida — a voz é identidade, e identidade não
   * degrada para o oposto. A escada de último recurso é: qualquer pt que não
   * seja masculina; qualquer feminina de outra língua (sotaque é melhor que
   * troca de gênero); e aí desiste com aviso — o navegador falaria com a voz
   * padrão do sistema, que costuma ser exatamente a masculina que se evita.
   */
  const ptNaoMasculina = vozes.find(
    (v) => v.lang.toLowerCase().startsWith('pt') && !VOZES_MASCULINAS.test(v.name),
  );
  if (ptNaoMasculina) return ptNaoMasculina;
  const femininaQualquer = vozes.find((v) => VOZES_FEMININAS.test(v.name));
  if (femininaQualquer) return femininaQualquer;
  console.warn(
    '[voz] nenhuma voz feminina instalada neste navegador — a IARA fica muda. ' +
      'Windows: Configurações → Hora e idioma → Fala → adicionar vozes (pt-BR).',
  );
  return null;
}

/**
 * `getVoices()` chega VAZIO na primeira chamada em Chrome/Edge/WebView2 — a
 * lista carrega assíncrona e chega no evento `voiceschanged`. Falar antes dela
 * usa a voz padrão do sistema, que em Windows pt-BR costuma ser masculina: era
 * exatamente o bug da saudação "Oi Daiane" sair com voz de homem.
 */
function quandoHouverVozes(cb: () => void): void {
  const sintese = window.speechSynthesis;
  if (sintese.getVoices().length > 0) {
    cb();
    return;
  }
  let feito = false;
  const pronto = () => {
    if (feito) return;
    feito = true;
    sintese.removeEventListener('voiceschanged', pronto);
    cb();
  };
  sintese.addEventListener('voiceschanged', pronto);
  // Navegador que nunca dispara o evento (lista realmente vazia): fala assim
  // mesmo depois de um instante — voz padrão é melhor que silêncio eterno.
  setTimeout(pronto, 1500);
}

export function useVoz(fala: Fala | null, ativa: boolean, lider: boolean = true): EstadoVoz {
  const elemento = useRef<HTMLAudioElement | null>(null);
  const [tocando, setTocando] = useState(false);
  const [bloqueado, setBloqueado] = useState(false);

  const [sinteseDisponivel, setSinteseDisponivel] = useState(false);
  const [vozLigada, setVozLigada] = useState(true);
  const [textoAvulso, setTextoAvulso] = useState<string | null>(null);
  /**
   * Geração da fonte de áudio corrente. `calarTudo` incrementa; quem falou em
   * DIFERIDO (a síntese esperando a lista de vozes carregar — até 1,5 s no
   * WebView2) confere a geração antes de abrir a boca. Sem isto, o áudio do
   * servidor que chegasse durante a espera começava a tocar e a síntese
   * atrasada falava POR CIMA — duas vozes juntas, a fala "embolada".
   */
  const geracao = useRef(0);
  /**
   * Falas que JÁ tiveram voz — por qualquer caminho. É um conjunto só para os
   * dois caminhos de propósito: uma fala tem exatamente UMA voz. Antes eram
   * controles separados (URL para o áudio, ids para a síntese) e a mesma fala
   * saía duas vezes — a síntese disparava na conclusão e o áudio da Convai
   * chegava um segundo depois por cima.
   */
  const vistas = useRef<Set<string> | null>(null);
  /** Mantém o Chrome acordado durante síntese longa (bug de pausa). */
  const despertador = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Instante em que a voz corrente ficou audível. Ref, e não estado: o loop de
   * animação lê isto a 60 Hz e um `setState` por quadro derrubaria o orçamento
   * de quadro da cena 3D — a mesma razão pela qual `relogio` é estável.
   */
  const audivelDesde = useRef<number | null>(null);

  // Estável por toda a vida do componente: o loop de animação guarda esta
  // referência uma vez e nunca mais pergunta por ela.
  const relogio = useRef<RelogioVoz>({
    progresso() {
      const a = elemento.current;
      if (!a || !a.duration || !Number.isFinite(a.duration) || a.paused) return null;
      return a.currentTime / a.duration;
    },
    audivel() {
      return audivelDesde.current !== null;
    },
    audivelDesde() {
      return audivelDesde.current;
    },
  }).current;

  useEffect(() => {
    const tem = typeof window !== 'undefined' && 'speechSynthesis' in window;
    setSinteseDisponivel(tem);
    setVozLigada(window.localStorage.getItem(CHAVE_PREFERENCIA) !== '0');
    // Primeira chamada dispara o carregamento assíncrono da lista de vozes —
    // assim ela já está pronta quando a primeira fala precisar dela.
    if (tem) window.speechSynthesis.getVoices();
  }, []);

  /**
   * UM lugar move os dois: `tocando` (que a UI lê) e `audivelDesde` (que o
   * loop de animação lê). Mover cada um no seu handler foi o que já produziu
   * `tocando` preso em true depois de um `cancel()`; dois fatos derivados do
   * mesmo evento não podem ter dois donos.
   */
  const marcarAudivel = useCallback((soando: boolean) => {
    audivelDesde.current = soando ? performance.now() : null;
    setTocando(soando);
  }, []);

  const pararSintese = useCallback(() => {
    if (despertador.current) {
      clearInterval(despertador.current);
      despertador.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  /**
   * UMA IARA = UMA FONTE DE VOZ. Cala tudo que possa estar soando — áudio do
   * servidor E síntese local — antes de qualquer fonte nova começar. É a
   * função que os dois caminhos chamam primeiro.
   */
  const calarTudo = useCallback(() => {
    geracao.current += 1;
    setTextoAvulso(null);
    audivelDesde.current = null;
    const a = elemento.current;
    if (a) {
      a.onended = null;
      a.onerror = null;
      a.pause();
      a.src = '';
    }
    elemento.current = null;
    pararSintese();
  }, [pararSintese]);

  const sintetizar = useCallback(
    (texto: string) => {
      const frases = sentencas(texto);
      if (frases.length === 0) return;
      calarTudo();
      const minhaGeracao = geracao.current;

      // A fala só começa com a lista de vozes carregada — ver quandoHouverVozes.
      quandoHouverVozes(() => {
        // Outra fonte assumiu (áudio do servidor, outra síntese) ou o operador
        // calou a IARA enquanto a lista carregava: esta fala já morreu. Falar
        // agora seria voz em cima de voz — ou fala fantasma depois do corte.
        if (geracao.current !== minhaGeracao) return;
        const voz = escolherVoz();
        const ultima = frases.length - 1;
        frases.forEach((frase, i) => {
          const u = new SpeechSynthesisUtterance(frase);
          u.lang = 'pt-BR';
          if (voz) u.voice = voz;
          /**
           * PITCH NEUTRO, sempre. A afinação anterior (pitch 1.08) tentava
           * disfarçar o timbre metálico da Maria — mas pitch-shifting em voz
           * SAPI é resampling barato: é exatamente o que soava "bêbado".
           * Ritmo levemente acima do neutro tira o arrastado sem atropelar; a
           * voz que sai daqui é a melhor que ESTE navegador tem — a qualidade
           * de verdade vem de voz neural (Edge "Natural", Google, ou síntese
           * no servidor), nunca de maquiagem no pitch.
           */
          u.rate = 1.04;
          u.pitch = 1.0;
          if (i === 0) u.onstart = () => marcarAudivel(true);
          if (i === ultima) {
            u.onend = () => {
              marcarAudivel(false);
              setTextoAvulso(null);
            };
            // `cancel()` dispara onerror, não onend — sem isto, interromper a
            // síntese deixaria `tocando` preso em true.
            u.onerror = () => {
              marcarAudivel(false);
              setTextoAvulso(null);
            };
          }
          window.speechSynthesis.speak(u);
        });

        // Chrome pausa síntese longa sozinho; um resume() periódico evita.
        despertador.current = setInterval(() => {
          if (!window.speechSynthesis.speaking) {
            if (despertador.current) clearInterval(despertador.current);
            despertador.current = null;
            return;
          }
          window.speechSynthesis.resume();
        }, 5000);
      });
    },
    [calarTudo, pararSintese],
  );

  const tocar = useCallback(
    (url: string) => {
      calarTudo();

      const audio = new Audio(url);
      audio.preload = 'auto';
      elemento.current = audio;

      /**
       * A PERNA QUE SÓ ESTE LADO ENXERGA: bytes prontos no motor → som saindo.
       *
       * O motor mede o que ele controla (pensar e sintetizar) e publica em
       * `canal: "voz"`. O que ele não tem como medir é isto — o download do mp3
       * até um celular, que com o motor hospedado fora do país é uma travessia
       * de verdade, e que estava sendo contado como "voz atrasada" sem ninguém
       * saber de quem era o segundo.
       *
       * Fica no console, não na tela: é instrumento de diagnóstico, e o operador
       * não tem nada a fazer com este número.
       */
      const pedidoEm = performance.now();
      const contar = (marco: string) =>
        console.info(
          `[voz] ${marco}: ${Math.round(performance.now() - pedidoEm)} ms desde o pedido do áudio`,
        );
      audio.addEventListener('loadedmetadata', () => contar('metadados'), { once: true });
      audio.addEventListener('canplaythrough', () => contar('baixado'), { once: true });
      audio.addEventListener('playing', () => contar('som saindo'), { once: true });

      /**
       * Guarda de identidade: `src = ''` num elemento substituído dispara
       * `error` ASSÍNCRONO — sem a guarda, o handler do áudio velho derrubava
       * `tocando` do novo, e com `tocando` falso o barge-in deixava de ser
       * interrupção (a fala do operador virava pergunta nova).
       */
      const atual = () => elemento.current === audio;
      audio.onended = () => {
        if (atual()) marcarAudivel(false);
      };
      audio.onerror = () => {
        if (atual()) marcarAudivel(false);
      };

      void audio
        .play()
        .then(() => {
          if (!atual()) return;
          marcarAudivel(true);
          setBloqueado(false);
        })
        .catch(() => {
          if (!atual()) return;
          // Autoplay barrado. O áudio fica carregado esperando o gesto.
          marcarAudivel(false);
          setBloqueado(true);
        });
    },
    [calarTudo, marcarAudivel],
  );

  /**
   * REGRA DO HISTÓRICO, para os DOIS caminhos: a fala que já estava concluída
   * quando o componente montou não é falada — nem pela síntese, nem pelo
   * áudio do servidor. Recarregar a página não pode fazer a IARA repetir a
   * última resposta sem ninguém ter pedido. Roda antes dos dois efeitos de
   * voz porque a ordem de declaração é a ordem de execução no mesmo commit.
   */
  useEffect(() => {
    if (vistas.current === null) {
      vistas.current = new Set(fala && fala.concluida ? [fala.id] : []);
    }
  }, [fala]);

  // Caminho 1 — áudio do servidor.
  useEffect(() => {
    if (!ativa || !vozLigada) return;
    if (!fala || !fala.voz) return;
    if (vistas.current?.has(fala.id)) return; // já teve voz (ou é histórico)
    vistas.current?.add(fala.id);
    /**
     * Espelho não-líder marca a fala como vista e cala. A eleição é do
     * servidor (`voz_lider` no snapshot): com app + abas espelhando o mesmo
     * operador, exatamente UMA tela reproduz — era daqui que vinha a IARA
     * falando a mesma coisa quatro vezes, uma voz em cima da outra.
     */
    if (!lider) return;
    // `tocar` já cala tudo (fallback agendado e síntese em curso) antes.
    // `urlVoz` resolve o caminho contra o host do motor: com a interface na
    // nuvem e o motor noutro endereço, um caminho relativo bateria no host do
    // front, onde o áudio não existe — os bytes vivem na MEMÓRIA do motor.
    tocar(urlVoz(fala.voz));
  }, [fala, ativa, vozLigada, lider, tocar]);

  // Caminho 2 — síntese do navegador quando o servidor não manda áudio.
  useEffect(() => {
    if (!ativa || !sinteseDisponivel) return;
    if (!fala || fala.papel !== 'iara' || !fala.concluida) return;
    if (fala.voz) return; // o caminho 1 cuida
    if (vistas.current === null || vistas.current.has(fala.id)) return;

    if (!lider || !vozLigada) {
      vistas.current.add(fala.id);
      return;
    }

    const falar = () => {
      if (vistas.current!.has(fala.id)) return;
      vistas.current!.add(fala.id);
      sintetizar(fala.texto);
    };

    /**
     * O servidor avisou que o áudio DESTA fala está sendo sintetizado agora
     * (`voz_prevista`): espera — sem relógio.
     *
     * ATÉ 12/08/2026 AQUI HAVIA UM `setTimeout(falar, 6000)`, e ele era metade
     * dos ~7 s que o operador contava entre mandar a mensagem e ouvir a IARA.
     * A espera era CEGA: o servidor já sabia que a síntese tinha falhado e não
     * tinha como dizer, porque `voz_prevista` era a configuração do servidor
     * ("tenho voz ligada"), não um fato sobre este turno ("o áudio vem aí").
     *
     * Hoje é fato: a ponte tira a fala de `vozEmVoo` assim que a síntese
     * resolve — dando certo ou dando errado — e reemite. O snapshot seguinte
     * chega com `voz` (caminho 1 toca) ou com `voz_prevista: false` (este
     * efeito reexecuta e fala na hora). Um timer aqui só poderia atrasar uma
     * decisão que já chegou pronta.
     *
     * Nada se perde se o servidor morrer no meio da síntese: o socket cai, a
     * reconexão hidrata, e uma fala sem `voz` e sem `voz_prevista` é falada.
     */
    if (fala.voz_prevista) return;

    falar();
  }, [fala, ativa, vozLigada, lider, sinteseDisponivel, sintetizar]);

  // Trocar de projeção ou desmontar não pode deixar voz tocando no vazio.
  useEffect(() => {
    if (ativa) return;
    calarTudo();
    marcarAudivel(false);
  }, [ativa, calarTudo, marcarAudivel]);

  useEffect(() => () => calarTudo(), [calarTudo]);

  const liberar = useCallback(() => {
    const a = elemento.current;
    if (!a) return;
    void a
      .play()
      .then(() => {
        marcarAudivel(true);
        setBloqueado(false);
      })
      .catch(() => setBloqueado(true));
  }, [marcarAudivel]);

  const silenciar = useCallback(() => {
    // Interromper cala TUDO: o áudio do servidor e a síntese em curso.
    calarTudo();
    marcarAudivel(false);
  }, [calarTudo, marcarAudivel]);

  const alternarVoz = useCallback(() => {
    setVozLigada((v) => {
      const novo = !v;
      window.localStorage.setItem(CHAVE_PREFERENCIA, novo ? '1' : '0');
      if (!novo) {
        calarTudo();
        marcarAudivel(false);
      }
      return novo;
    });
  }, [calarTudo, marcarAudivel]);

  const falar = useCallback(
    (texto: string): boolean => {
      // Devolve se VAI falar: quem chama (o despertar do "ei IARA") precisa
      // saber para dar o feedback sonoro alternativo quando a voz está muda.
      if (!sinteseDisponivel || !vozLigada) return false;
      /**
       * Espelho não-líder não fala NEM apita: a eleição de líder já cala as
       * falas do kernel nos espelhos, mas a saudação passava por fora dela —
       * com app + aba abertas, "ei IARA" saía em todas as telas com offset de
       * milissegundos, uma voz arrastando a outra. Devolve `true` porque a
       * resposta EXISTE (na tela líder); `false` faria o espelho apitar.
       */
      if (!lider) return true;
      sintetizar(texto);
      setTextoAvulso(texto);
      return true;
    },
    [sinteseDisponivel, vozLigada, lider, sintetizar],
  );

  return {
    relogio,
    tocando,
    bloqueado,
    liberar,
    sinteseDisponivel,
    vozLigada,
    alternarVoz,
    silenciar,
    falar,
    textoAvulso,
  };
}
