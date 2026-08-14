'use client';

/**
 * Barramento do lado do cliente.
 *
 * O React aqui é camada de projeção burra: ele não decide nada sobre o estado
 * da IARA, só desenha o último snapshot válido. Não existe redutor, não existe
 * remontagem de estado a partir de fragmentos — o servidor já mandou pronto.
 *
 * Três garantias:
 *
 *  1. GUARDA DE SEQUÊNCIA — pacote com `seq` menor ou igual ao último aplicado
 *     é descartado. Sem isso, a enxurrada da reconexão faz a UI piscar.
 *  2. RECONEXÃO com backoff e guarda de identidade por socket.
 *  3. BUFFERS LIMITADOS — nem falas nem logs crescem sem teto numa aba aberta
 *     o dia inteiro.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { MaquinaDoOperador } from '../lib/execucao';
import type { NivelLog, PacoteCliente, PacoteServidor } from '../lib/protocolo';
import { ESPACO_VAZIO, EXPRESSAO_NEUTRA, TELEMETRIA_ZERO, type SnapshotCognitivo } from '../lib/snapshot';
import { LEITURA_INICIAL, LUZES_APAGADAS, METRICAS_INICIAIS } from '../lib/estado';
import type { PreferenciasOperador } from '../lib/perfil';
import { enderecoBarramento } from '../lib/supabaseNavegador';

export interface Fala {
  id: string;
  papel: 'operador' | 'iara';
  texto: string;
  concluida: boolean;
  destino?: string;
  latencia_ms?: number;
  cache_lido?: number;
  tokens_entrada?: number;
  tokens_saida?: number;
  /** Caminho do áudio desta fala, quando a voz já foi sintetizada. */
  voz?: string | null;
  /** O servidor vai mandar áudio desta fala (Convai ligada) — espere por ele. */
  voz_prevista?: boolean;
  /**
   * `performance.now()` do instante em que o turno abriu. É o relógio que a
   * boca da projeção 3D usa para articular — precisa ser monotônico, então
   * `Date.now()` não serve: ajuste de horário do sistema faria o visema saltar.
   */
  iniciada_em: number;
}

export interface LinhaLog {
  id: number;
  nivel: NivelLog;
  texto: string;
  instante: number;
}

export interface Credencial {
  id_usuario: string;
  nome: string;
  /** Access token do Supabase. Quando presente, é ele que define a identidade. */
  token?: string;
}

const MAX_LOGS = 120;
const MAX_FALAS = 60;

/**
 * Estado do enlace, para a UI dizer a verdade sobre a conexão:
 *  - `conectando`: primeira tentativa desta credencial.
 *  - `conectado`: barramento aberto.
 *  - `reconectando`: caiu e o backoff está trabalhando (1→2→4→8→16 s).
 *  - `desconectado`: o servidor RECUSOU (sessão expirada, limite de telas) —
 *    reconectar automaticamente viraria um loop infinito de recusa a cada
 *    poucos segundos, para sempre. Aqui só um gesto humano religa.
 */
export type EstadoConexao = 'conectando' | 'conectado' | 'reconectando' | 'desconectado';

/** Fechamentos que o servidor usa para dizer "não volte sozinho". */
const FECHAMENTOS_TERMINAIS = new Set([4401, 4000]);

export const SNAPSHOT_INICIAL: SnapshotCognitivo = {
  sessao: '',
  seq: 0,
  instante: 0,
  traco: '',
  operador: null,
  estagio: 'ocioso',
  objetivo: null,
  plano: null,
  capacidades: { ...ESPACO_VAZIO },
  metricas: { ...METRICAS_INICIAIS },
  leitura: { ...LEITURA_INICIAL },
  expressao: EXPRESSAO_NEUTRA,
  telemetria: TELEMETRIA_ZERO,
  luzes: { ...LUZES_APAGADAS },
  nuvem_indisponivel: false,
  fala: null,
};

export function useIaraSocket(credencial: Credencial) {
  const { id_usuario: idUsuario, nome, token } = credencial;

  const [snapshot, setSnapshot] = useState<SnapshotCognitivo>(SNAPSHOT_INICIAL);
  const [falas, setFalas] = useState<Fala[]>([]);
  const [logs, setLogs] = useState<LinhaLog[]>([]);
  const [conexao, setConexao] = useState<EstadoConexao>('conectando');
  /** Por que o servidor mandou parar — mostrado no aviso de desconexão. */
  const [motivoDesconexao, setMotivoDesconexao] = useState<string | null>(null);
  /**
   * As máquinas deste operador. `null` — e não `[]` — enquanto ninguém
   * perguntou: a gaveta precisa distinguir "ainda não sei" de "você não tem
   * nenhum computador conectado". As duas telas são diferentes, e mostrar a
   * segunda no lugar da primeira faria a operadora achar que perdeu o
   * pareamento toda vez que abrisse a aba.
   */
  const [maquinas, setMaquinas] = useState<MaquinaDoOperador[] | null>(null);
  const [pareamentoDisponivel, setPareamentoDisponivel] = useState(true);
  const [acaoDispositivo, setAcaoDispositivo] = useState<{ ok: boolean; texto: string } | null>(null);
  const conectado = conexao === 'conectado';

  const socketRef = useRef<WebSocket | null>(null);
  /**
   * Espelho de `falas` para o `onclose`, que é registrado uma vez por efeito
   * (dependências não incluem `falas`) e leria um valor congelado se lesse o
   * state direto — mesmo problema que `enviar`/`aplicar` evitam com
   * `setState` funcional, só que `onclose` não é um setter, é uma leitura.
   */
  const falasRef = useRef<Fala[]>([]);
  const ultimoSeq = useRef(0);
  const contadorLog = useRef(0);
  const tentativas = useRef(0);
  const desmontado = useRef(false);
  /** O servidor mandou não voltar (4401/4000). Só `religar()` limpa. */
  const recusado = useRef(false);
  /** Religa manualmente após uma recusa terminal. */
  const [chaveReligar, setChaveReligar] = useState(0);

  useEffect(() => {
    falasRef.current = falas;
  }, [falas]);

  const registrarLog = useCallback((nivel: NivelLog, texto: string) => {
    contadorLog.current += 1;
    const linha: LinhaLog = { id: contadorLog.current, nivel, texto, instante: Date.now() };
    setLogs((antes) => {
      const proximo = [...antes, linha];
      return proximo.length > MAX_LOGS ? proximo.slice(-MAX_LOGS) : proximo;
    });
  }, []);

  /**
   * A fala vem SUBSTITUÍDA a cada snapshot, nunca concatenada. Por isso um
   * pacote perdido não corrompe o texto: o próximo já traz o acumulado.
   */
  const absorverFala = useCallback((s: SnapshotCognitivo) => {
    if (!s.fala) return;
    const f = s.fala;
    setFalas((antes) => {
      const i = antes.findIndex((x) => x.id === f.id);
      const nova: Fala = {
        id: f.id,
        papel: 'iara',
        texto: f.texto,
        concluida: f.concluida,
        destino: f.destino ?? undefined,
        latencia_ms: f.latencia_ms ?? undefined,
        cache_lido: f.cache_lido,
        voz: f.voz,
        voz_prevista: f.voz_prevista,
        tokens_entrada: s.telemetria.tokens_entrada,
        tokens_saida: s.telemetria.tokens_saida,
        // Carimbado uma vez, na abertura do turno, e PRESERVADO nas
        // atualizações seguintes: se fosse recarimbado a cada snapshot, o
        // relógio da articulação reiniciaria a cada trecho e a boca gaguejaria.
        iniciada_em: i < 0 ? performance.now() : antes[i].iniciada_em,
      };
      if (i < 0) {
        const proximo = [...antes, nova];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      }
      // `voz` entra na comparação porque ela chega DEPOIS, num snapshot em que
      // texto e conclusão já não mudam mais. Sem isto, o áudio nunca chegaria
      // ao componente — o turno seria descartado como repetido.
      if (
        antes[i].texto === nova.texto &&
        antes[i].concluida === nova.concluida &&
        antes[i].voz === nova.voz
      ) {
        return antes;
      }
      const copia = [...antes];
      copia[i] = nova;
      return copia;
    });
  }, []);

  const aplicar = useCallback(
    (pacote: PacoteServidor) => {
      /**
       * Erro passa POR FORA da guarda de sequência. A recusa de autenticação
       * chega antes de qualquer snapshot e o socket fecha em seguida — se a
       * guarda a descartasse, o operador veria um loop de reconexão mudo em
       * vez de "sessão expirada, entre novamente".
       */
      if (pacote.tipo === 'erro') {
        registrarLog('alerta', pacote.texto);
        return;
      }

      // Guarda de sequência: o passado nunca sobrescreve o presente.
      if (pacote.seq <= ultimoSeq.current) return;
      ultimoSeq.current = pacote.seq;

      if (pacote.tipo === 'dispositivos') {
        setMaquinas(pacote.maquinas);
        setPareamentoDisponivel(pacote.pareamento_disponivel);
        /**
         * `null` quando o pacote não traz ação: uma simples atualização de
         * lista APAGA o recado anterior. Sem isso, "código não confere" ficaria
         * na tela por cima de uma lista que já mudou — o recado sobreviveria ao
         * fato que o produziu.
         */
        setAcaoDispositivo(pacote.ultima_acao ?? null);
        return;
      }

      if (pacote.tipo === 'snapshot') {
        // Snapshot estruturalmente idêntico (só `seq`/`instante` mudaram) não
        // re-renderiza a aplicação: o servidor já deduplica, mas a hidratação
        // da reconexão passa por fora — esta guarda cobre o que sobra.
        setSnapshot((antes) => {
          const a = JSON.stringify({ ...antes, seq: 0, instante: 0 });
          const b = JSON.stringify({ ...pacote.snapshot, seq: 0, instante: 0 });
          return a === b ? antes : pacote.snapshot;
        });
        absorverFala(pacote.snapshot);
        return;
      }
      registrarLog(pacote.nivel, pacote.texto);
    },
    [registrarLog, absorverFala],
  );

  useEffect(() => {
    desmontado.current = false;
    let timerReconexao: ReturnType<typeof setTimeout> | null = null;

    const conectar = () => {
      if (desmontado.current) return;
      const url = enderecoBarramento();
      if (!url) return;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        agendarReconexao();
        return;
      }
      socketRef.current = socket;

      /**
       * Guarda de identidade. Sem ela, o `onclose` de um socket já substituído
       * agenda uma reconexão que sobrescreve `socketRef`, enquanto outro socket
       * que abriu marca `conectado = true`. O resultado é o pior tipo de bug:
       * a UI diz "conectado" e o envio falha em silêncio.
       */
      const atual = () => socketRef.current === socket;

      socket.onopen = () => {
        if (!atual()) {
          socket.close();
          return;
        }
        tentativas.current = 0;
        setConexao('conectado');
        // Reconexão: zera a guarda para aceitar a nova hidratação.
        ultimoSeq.current = 0;
        socket.send(JSON.stringify({ tipo: 'ola', id_usuario: idUsuario, nome, token }));
      };

      socket.onmessage = (evento) => {
        if (!atual()) return;
        try {
          aplicar(JSON.parse(evento.data as string) as PacoteServidor);
        } catch {
          /* pacote malformado é ignorado, nunca derruba a UI */
        }
      };

      socket.onclose = (evento) => {
        if (!atual()) return; // socket órfão: morre calado, não reagenda nada
        socketRef.current = null;
        /**
         * Recusa TERMINAL (4401 sessão inválida, 4000 limite de telas): parar.
         * Reconectar automaticamente aqui era um loop infinito — recusa a cada
         * 8 s, para sempre, com log de alerta empilhando. O caminho de volta é
         * humano (`religar`) ou um token novo via `onAuthStateChange`, que
         * troca as dependências deste efeito e reconecta com credencial nova.
         */
        if (FECHAMENTOS_TERMINAIS.has(evento.code)) {
          recusado.current = true;
          setMotivoDesconexao(
            evento.code === 4000
              ? 'Limite de telas simultâneas atingido — feche outra tela e reconecte.'
              : 'A sessão expirou ou foi recusada. Entre novamente.',
          );
          setConexao('desconectado');
          return;
        }
        /**
         * MENSAGEM PERDIDA EM VOO — achado ao vivo em auditoria (14/08):
         * `enviar()` despacha e esquece; sem isto, um restart do motor no
         * meio do processamento derrubava a conexão, o cliente reconectava
         * sozinho, e o pedido do operador ficava sem resposta E sem aviso —
         * ela precisava notar e reenviar por conta própria.
         *
         * O sinal é barato e não depende de correlacionar mensagem com
         * resposta pelo barramento: se a ÚLTIMA fala conhecida é do
         * OPERADOR (nenhuma fala da IARA chegou depois dela), a conexão caiu
         * com um pedido pendente. Falso positivo é impossível aqui: em uso
         * normal, a última fala só é do operador no instante entre enviar e
         * a primeira resposta chegar — e nesse instante a conexão não caiu.
         */
        const ultima = falasRef.current[falasRef.current.length - 1];
        if (ultima?.papel === 'operador') {
          registrarLog(
            'alerta',
            'Perdi a conexão enquanto respondia. Não sei se a mensagem chegou — ' +
              'confira a resposta e, se não vier, envie de novo.',
          );
        }
        setConexao('reconectando');
        agendarReconexao();
      };

      socket.onerror = () => {
        if (atual()) socket.close();
      };
    };

    const agendarReconexao = () => {
      if (desmontado.current) return;
      tentativas.current += 1;
      // 1 → 2 → 4 → 8 → 16 s, com jitter de até 20%: N telas derrubadas pelo
      // mesmo restart do motor não voltam em fase batendo no mesmo instante.
      const base = Math.min(16_000, 1000 * 2 ** Math.min(tentativas.current - 1, 4));
      const espera = base + Math.random() * base * 0.2;
      timerReconexao = setTimeout(conectar, espera);
    };

    if (recusado.current) {
      // Religação manual depois de uma recusa: uma tentativa limpa.
      recusado.current = false;
    }
    setConexao((c) => (c === 'conectado' ? c : 'conectando'));
    conectar();

    return () => {
      desmontado.current = true;
      if (timerReconexao) clearTimeout(timerReconexao);
      const socket = socketRef.current;
      // Solta a referência ANTES de fechar: o `onclose` que vem a seguir vê um
      // socket órfão e não reagenda reconexão.
      socketRef.current = null;
      socket?.close();
    };
  }, [idUsuario, nome, token, aplicar, chaveReligar]);

  const enviar = useCallback(
    (texto: string) => {
      const limpo = texto.trim();
      const socket = socketRef.current;
      if (!limpo) return false;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Falha de envio nunca é silenciosa: some da caixa sem explicação é o
        // que faz o operador achar que a IARA travou.
        registrarLog('alerta', 'Mensagem não enviada: o barramento não está aberto. Reconectando…');
        setConexao((c) => (c === 'conectado' ? 'reconectando' : c));
        return false;
      }
      setFalas((antes) => {
        const proximo: Fala[] = [
          ...antes,
          {
            id: `op-${Date.now()}`,
            papel: 'operador',
            texto: limpo,
            concluida: true,
            iniciada_em: performance.now(),
          },
        ];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      });
      socket.send(JSON.stringify({ tipo: 'mensagem', texto: limpo }));
      return true;
    },
    [registrarLog],
  );

  const interromper = useCallback(() => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ tipo: 'interromper' }));
    }
  }, []);

  /**
   * Salva a ficha do operador. Não devolve a ficha gravada: quem manda no que
   * está valendo é o snapshot que volta pelo barramento, como em todo o resto
   * do sistema. Devolve só se o pacote SAIU — o formulário precisa distinguir
   * "salvo" de "o barramento estava fechado e ninguém ouviu".
   */
  const salvarPreferencias = useCallback(
    (preferencias: PreferenciasOperador) => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        registrarLog('alerta', 'Ficha não salva: o barramento não está aberto.');
        return false;
      }
      socket.send(JSON.stringify({ tipo: 'preferencias', preferencias }));
      return true;
    },
    [registrarLog],
  );

  /**
   * A POSIÇÃO DO APARELHO, pedida uma vez por sessão.
   *
   * Vive aqui e não em `useVoz`/`Presenca` porque é o socket que a leva ao
   * motor, e porque o dado tem UM consumidor no servidor: a previsão do tempo.
   *
   * Três decisões escritas no comportamento:
   *
   *  · UMA VEZ. `pediuLocal` trava a repetição. O navegador lembra a resposta,
   *    mas insistir a cada reconexão faria a caixa de permissão piscar em toda
   *    queda de Wi-Fi.
   *  · SILÊNCIO NA RECUSA. Negar localização é uma resposta legítima e não vira
   *    log de alerta nem aviso na tela. A IARA só menciona o assunto se alguém
   *    perguntar sobre o tempo e ela não tiver de onde responder.
   *  · BAIXA PRECISÃO. `enableHighAccuracy: false` não liga o GPS: usa rede e
   *    Wi-Fi, resolve em centenas de metros e não drena bateria. Previsão do
   *    tempo é de cidade; metros não mudam a resposta e só aumentariam o que se
   *    sabe sobre a pessoa.
   */
  const pediuLocal = useRef(false);

  useEffect(() => {
    if (!conectado || pediuLocal.current) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    pediuLocal.current = true;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const socket = socketRef.current;
        if (socket?.readyState !== WebSocket.OPEN) return;
        socket.send(
          JSON.stringify({
            tipo: 'local',
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        );
      },
      // Recusa, indisponibilidade e estouro de tempo caem todos aqui, e todos
      // são o mesmo fato para a IARA: não há posição. Nada a registrar.
      () => {},
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 10 * 60 * 1000 },
    );
  }, [conectado]);

  /**
   * Os três gestos da aba Dispositivos. Um caminho só para os três porque os
   * três têm a mesma resposta — a lista atualizada, num pacote `dispositivos` —
   * e porque o que fazer quando o barramento está fechado não muda entre eles.
   */
  const pedirAoBarramento = useCallback(
    (pacote: PacoteCliente): boolean => {
      const socket = socketRef.current;
      if (socket?.readyState !== WebSocket.OPEN) {
        setAcaoDispositivo({
          ok: false,
          texto: 'Sem enlace com a IARA agora. Tente de novo quando reconectar.',
        });
        return false;
      }
      socket.send(JSON.stringify(pacote));
      return true;
    },
    [],
  );

  const pedirDispositivos = useCallback(
    () => pedirAoBarramento({ tipo: 'dispositivos' }),
    [pedirAoBarramento],
  );
  const autorizarComputador = useCallback(
    (codigo: string) => pedirAoBarramento({ tipo: 'parear', codigo }),
    [pedirAoBarramento],
  );
  const esquecerComputador = useCallback(
    (id: string) => pedirAoBarramento({ tipo: 'esquecer_dispositivo', id }),
    [pedirAoBarramento],
  );

  /** Religa após uma recusa terminal — o gesto humano que zera a decisão. */
  const religar = useCallback(() => {
    tentativas.current = 0;
    setMotivoDesconexao(null);
    setChaveReligar((v) => v + 1);
  }, []);

  return {
    snapshot,
    falas,
    logs,
    conectado,
    conexao,
    motivoDesconexao,
    enviar,
    interromper,
    religar,
    salvarPreferencias,
    maquinas,
    pareamentoDisponivel,
    acaoDispositivo,
    pedirDispositivos,
    autorizarComputador,
    esquecerComputador,
  };
}
