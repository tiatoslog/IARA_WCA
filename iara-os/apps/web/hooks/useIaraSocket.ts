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
import { ESPACO_VAZIO, EXPRESSAO_NEUTRA, TELEMETRIA_ZERO, type Ilustracao, type SnapshotCognitivo } from '../lib/snapshot';
import { LEITURA_INICIAL, LUZES_APAGADAS, METRICAS_INICIAIS } from '../lib/estado';
import type { PreferenciasOperador } from '../lib/perfil';
import { enderecoBarramento, origemMotor } from '../lib/supabaseNavegador';

export interface Fala {
  id: string;
  papel: 'operador' | 'iara';
  texto: string;
  concluida: boolean;
  /**
   * Para falas da IARA: o id da bolha do operador que esta resposta responde.
   * É o que decide ONDE ela entra na lista — ver `absorverFala`. Ausente em
   * bolhas do operador e em recado que a IARA dá sem ninguém ter perguntado.
   */
  responde_a?: string | null;
  /**
   * Para bolhas do operador: este pedido ainda está ESPERANDO A VEZ atrás do
   * pedido de outra tela. Derivado de `snapshot.fila` a cada pacote, nunca
   * guardado — é estado do servidor, e o cliente aqui é projeção burra.
   */
  na_fila?: boolean;
  destino?: string;
  latencia_ms?: number;
  cache_lido?: number;
  tokens_entrada?: number;
  tokens_saida?: number;
  /** Caminho do áudio desta fala, quando a voz já foi sintetizada. */
  voz?: string | null;
  /** O servidor vai mandar áudio desta fala (Convai ligada) — espere por ele. */
  voz_prevista?: boolean;
  /** Para bolhas do operador: o screenshot anexado a esta pergunta, se houver. */
  imagem?: { url: string; largura: number; altura: number } | null;
  /** Para falas da IARA: onde ela aponta na imagem da pergunta que respondeu. */
  marcacao?: { alvo_x: number; alvo_y: number; elemento: string } | null;
  /** Para falas da IARA: as telas do documento que esta orientação mostra. */
  ilustracao?: Ilustracao | null;
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
  origem_raciocinio: 'nenhuma',
  fala: null,
  cadeia: null,
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
  /** Última falha de gravação da ficha vinda do servidor — ver `Porta.ts`
   *  (`emitirErro(texto, 'preferencias')`). A ficha usa isto para não ficar
   *  muda quando a gravação falha depois do clique, não só quando o socket
   *  já estava fechado na hora. */
  const [erroPreferencias, setErroPreferencias] = useState<{ instante: number; texto: string } | null>(
    null,
  );
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
  /**
   * A PERGUNTA VINDA DO SERVIDOR — o que faz a conversa existir nos espelhos.
   *
   * Idempotente por id: na tela que digitou, a bolha já está na lista com o
   * mesmo `op:<id_local>` e nada acontece; nas outras, ela entra. É por isso que
   * o id vem do cliente e não do servidor — comparar TEXTO falharia justamente
   * quando alguém manda a mesma frase duas vezes seguidas, que é o que a pessoa
   * faz quando acha que a primeira não chegou.
   *
   * Nunca ATUALIZA uma bolha existente: a frase do operador não muda depois de
   * enviada. Só acrescenta o que ainda não está lá.
   */
  const absorverPergunta = useCallback((s: SnapshotCognitivo) => {
    const p = s.pergunta;
    if (!p) return;
    setFalas((antes) => {
      if (antes.some((x) => x.id === p.id)) return antes;
      const proximo: Fala[] = [
        ...antes,
        {
          id: p.id,
          papel: 'operador',
          texto: p.texto,
          concluida: true,
          iniciada_em: performance.now(),
          imagem: p.imagem ?? null,
        },
      ];
      return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
    });
  }, []);

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
        responde_a: f.responde_a ?? null,
        destino: f.destino ?? undefined,
        latencia_ms: f.latencia_ms ?? undefined,
        cache_lido: f.cache_lido,
        voz: f.voz,
        voz_prevista: f.voz_prevista,
        marcacao: f.marcacao ?? null,
        ilustracao: f.ilustracao ?? null,
        tokens_entrada: s.telemetria.tokens_entrada,
        tokens_saida: s.telemetria.tokens_saida,
        // Carimbado uma vez, na abertura do turno, e PRESERVADO nas
        // atualizações seguintes: se fosse recarimbado a cada snapshot, o
        // relógio da articulação reiniciaria a cada trecho e a boca gaguejaria.
        iniciada_em: i < 0 ? performance.now() : antes[i].iniciada_em,
      };
      if (i < 0) {
        /**
         * A RESPOSTA ENTRA JUNTO DA PERGUNTA QUE ELA RESPONDE — não no fim.
         *
         * Uma sessão tem até quatro espelhos e um kernel só. Quando duas telas
         * pedem quase ao mesmo tempo, a bolha local desta tela já está na lista
         * e a pergunta ECOADA da outra chega em seguida; encostar toda fala no
         * fim faria a resposta da pergunta de cima aparecer embaixo da pergunta
         * de baixo — que é como esta tela acabava exibindo a confirmação de um
         * pedido que ninguém aqui fez (CC-01, 16/08/2026).
         *
         * Sem `responde_a` (servidor antigo, ou recado espontâneo) o
         * comportamento é o de sempre: vai para o fim.
         */
        const alvo = nova.responde_a ? antes.findIndex((x) => x.id === nova.responde_a) : -1;
        if (alvo < 0) {
          const proximo = [...antes, nova];
          return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
        }
        // Depois da pergunta E das falas que já responderam a ela: um turno
        // pode falar mais de uma vez, e a ordem entre elas é a de chegada.
        let pos = alvo + 1;
        while (pos < antes.length && antes[pos].responde_a === nova.responde_a) pos += 1;
        const proximo = [...antes.slice(0, pos), nova, ...antes.slice(pos)];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      }
      // `voz` entra na comparação porque ela chega DEPOIS, num snapshot em que
      // texto e conclusão já não mudam mais. Sem isto, o áudio nunca chegaria
      // ao componente — o turno seria descartado como repetido.
      if (
        antes[i].texto === nova.texto &&
        antes[i].concluida === nova.concluida &&
        antes[i].voz === nova.voz &&
        antes[i].marcacao === nova.marcacao &&
        // Pela FONTE, não pelo objeto: cada pacote traz uma ilustração recém
        // desserializada, e comparar referência diria "mudou" a cada snapshot
        // de uma orientação parada na mesma etapa.
        antes[i].ilustracao?.fonte === nova.ilustracao?.fonte
      ) {
        return antes;
      }
      const copia = [...antes];
      copia[i] = nova;
      return copia;
    });
  }, []);

  /**
   * QUEM AINDA ESPERA A VEZ.
   *
   * A fila do snapshot vale para a sessão inteira; esta tela se reconhece nela
   * pelos ids `op:` das bolhas que ELA criou. Marca e desmarca a cada pacote —
   * um pedido que saiu da fila precisa parar de dizer que está nela, e como o
   * evento carrega a fila inteira, "não está na lista" é informação tão boa
   * quanto "está".
   *
   * Servidor antigo não manda `fila`: nesse caso nada é marcado, e a tela se
   * comporta como antes de o campo existir.
   */
  const absorverFila = useCallback((s: SnapshotCognitivo) => {
    if (!s.fila) return;
    const esperando = new Set(s.fila.map((p) => p.id));
    setFalas((antes) => {
      let mudou = false;
      const proximo = antes.map((f) => {
        if (f.papel !== 'operador') return f;
        const agora = esperando.has(f.id);
        if (Boolean(f.na_fila) === agora) return f;
        mudou = true;
        return { ...f, na_fila: agora };
      });
      return mudou ? proximo : antes;
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
        if (pacote.contexto === 'preferencias') {
          setErroPreferencias({ instante: pacote.instante, texto: pacote.texto });
        }
        return;
      }

      // Guarda de sequência: o passado nunca sobrescreve o presente.
      if (pacote.seq <= ultimoSeq.current) return;
      ultimoSeq.current = pacote.seq;

      if (pacote.tipo === 'dispositivos') {
        setMaquinas(pacote.maquinas);
        setPareamentoDisponivel(pacote.pareamento_disponivel);
        /**
         * SÓ SUBSTITUI quando o pacote traz uma ação nova — nunca apaga com
         * `null`. Achado em auditoria (14/08/2026): a gaveta reconsulta a
         * lista a cada 15 s enquanto está aberta (ver `Dispositivos.tsx`), e
         * essa consulta periódica não carrega `ultima_acao` nenhuma — a
         * versão antiga fazia `pacote.ultima_acao ?? null`, que apagava
         * "autorizado com sucesso" quase instantaneamente, bem na hora em
         * que o operador mais precisava ver a confirmação. Uma ação NOVA
         * (autorizar, esquecer, renomear, atualizar) sempre chega com
         * `ultima_acao` preenchida e substitui a anterior por conta própria;
         * quem faz o recado sumir depois de um tempo é a gaveta, não o poll.
         */
        if (pacote.ultima_acao) setAcaoDispositivo(pacote.ultima_acao);
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
        // A pergunta ANTES da fala: as duas podem chegar no mesmo snapshot
        // aglutinado, e invertida a ordem a resposta apareceria acima da
        // pergunta que a provocou.
        absorverPergunta(pacote.snapshot);
        absorverFala(pacote.snapshot);
        absorverFila(pacote.snapshot);
        return;
      }
      registrarLog(pacote.nivel, pacote.texto);
    },
    [registrarLog, absorverPergunta, absorverFala, absorverFila],
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
    (texto: string, anexo?: { url: string; largura: number; altura: number }) => {
      const limpo = texto.trim();
      const socket = socketRef.current;
      // Sem texto SÓ é inválido sem anexo — a imagem é o pedido quando não há
      // pergunta escrita. Ver `lib/protocolo.ts#lerPacoteCliente`.
      if (!limpo && !anexo) return false;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        // Falha de envio nunca é silenciosa: some da caixa sem explicação é o
        // que faz o operador achar que a IARA travou.
        registrarLog('alerta', 'Mensagem não enviada: o barramento não está aberto. Reconectando…');
        setConexao((c) => (c === 'conectado' ? 'reconectando' : c));
        return false;
      }
      /**
       * O id é gerado AQUI e mandado junto. O servidor o devolve em
       * `snapshot.pergunta` prefixado por `op:` — é assim que esta tela
       * reconhece a própria bolha quando ela volta projetada, e as OUTRAS telas
       * do mesmo operador a acrescentam. Sem o id, o eco voltaria como uma
       * segunda bolha idêntica logo abaixo da primeira.
       */
      const idLocal = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      setFalas((antes) => {
        const proximo: Fala[] = [
          ...antes,
          {
            id: `op:${idLocal}`,
            papel: 'operador',
            texto: limpo,
            concluida: true,
            iniciada_em: performance.now(),
            imagem: anexo ?? null,
          },
        ];
        return proximo.length > MAX_FALAS ? proximo.slice(-MAX_FALAS) : proximo;
      });
      socket.send(
        JSON.stringify({
          tipo: 'mensagem',
          texto: limpo,
          id_local: idLocal,
          ...(anexo ? { anexo } : {}),
        }),
      );
      return true;
    },
    [registrarLog],
  );

  /**
   * Sobe o screenshot por `POST /anexo` (fora do WebSocket — ver
   * `docs/prd/test-plan.md`, ADR-3) e devolve a URL + dimensões prontas para
   * `enviar(texto, anexo)`. `null` em qualquer falha; o motivo já foi para o
   * log.
   */
  const enviarImagem = useCallback(
    async (arquivo: File): Promise<{ url: string; largura: number; altura: number } | null> => {
      let largura = 0;
      let altura = 0;
      try {
        const bitmap = await createImageBitmap(arquivo);
        largura = bitmap.width;
        altura = bitmap.height;
        bitmap.close();
      } catch {
        registrarLog('alerta', 'Não consegui ler essa imagem.');
        return null;
      }

      try {
        const resposta = await fetch(`${origemMotor()}/anexo`, {
          method: 'POST',
          headers: {
            'Content-Type': arquivo.type,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: arquivo,
        });
        if (!resposta.ok) {
          const corpo = (await resposta.json().catch(() => ({}))) as { erro?: string };
          registrarLog('alerta', `Não foi possível enviar a imagem: ${corpo.erro ?? resposta.status}`);
          return null;
        }
        const corpo = (await resposta.json()) as { url: string };
        return { url: corpo.url, largura, altura };
      } catch (erro) {
        registrarLog('alerta', `Não foi possível enviar a imagem: ${(erro as Error).message}`);
        return null;
      }
    },
    [token, registrarLog],
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
    (codigo: string, nome?: string) =>
      pedirAoBarramento({ tipo: 'parear', codigo, ...(nome ? { nome } : {}) }),
    [pedirAoBarramento],
  );
  const esquecerComputador = useCallback(
    (id: string) => pedirAoBarramento({ tipo: 'esquecer_dispositivo', id }),
    [pedirAoBarramento],
  );
  /** Etapa 2 (14/08/2026) — "Atualizar agora" na gaveta Dispositivos. */
  const atualizarComputador = useCallback(
    (id: string) => pedirAoBarramento({ tipo: 'atualizar_dispositivo', id }),
    [pedirAoBarramento],
  );
  /** Etapa 4 (14/08/2026) — dar um nome à máquina, escolhido pela operadora. */
  const renomearComputador = useCallback(
    (id: string, nome: string) => pedirAoBarramento({ tipo: 'renomear_dispositivo', id, nome }),
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
    enviarImagem,
    interromper,
    religar,
    salvarPreferencias,
    erroPreferencias,
    maquinas,
    pareamentoDisponivel,
    acaoDispositivo,
    pedirDispositivos,
    autorizarComputador,
    esquecerComputador,
    atualizarComputador,
    renomearComputador,
  };
}
