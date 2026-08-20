'use client';

/**
 * Painel de trabalho — a camada MAIS EXTERNA e recuada da hierarquia.
 * Ele nunca disputa atenção com a sala; é uma prancheta apoiada na mesa.
 *
 * UMA FONTE PARA CADA FATO (decisão de 08/08/2026): identidade, estágio e
 * conexão vivem SÓ neste cabeçalho — o HUD lateral não os repete. Telemetria
 * de turno (rota, latência, tokens) vive SÓ no HUD — as bolhas não a repetem.
 * Antes cada fato aparecia em dois ou três lugares e a tela inteira virava eco.
 */

import { useEffect, useRef, useState } from 'react';
import type { EstadoConexao, Fala } from '../hooks/useIaraSocket';
import { useEscuta } from '../hooks/useEscuta';
import { useDeteccaoVocal } from '../hooks/useDeteccaoVocal';
import {
  IconeAnexarImagem,
  IconeEncerrar,
  IconeEnviar,
  IconeInterromper,
  IconeMaos,
  IconeMicrofone,
  IconeMudo,
  IconeVigilia,
  IconeVoz,
} from './Icones';
import type { EstagioCognitivo } from '../lib/estado';
import type { MaquinaDoOperador } from '../lib/execucao';
import type { PreferenciasOperador } from '../lib/perfil';
import type { SnapshotCognitivo } from '../lib/snapshot';
import { urlAnexo } from '../lib/supabaseNavegador';

/** O que sobe pelo botão de anexar — mesma forma que `useIaraSocket.enviar`
 *  aceita e que `PerguntaProjetada.imagem` carrega. */
type AnexoImagem = { url: string; largura: number; altura: number };
import { Automacao } from './Automacao';
import { Dispositivos } from './Dispositivos';
import { FichaOperador, fichaDoSnapshot } from './FichaOperador';
import { MenuPerfil } from './MenuPerfil';
import {
  lerHistorico,
  registrarPergunta,
  sugerir,
  type PerguntaContada,
} from '../lib/sugestoes';

const ROTULO_ESTAGIO: Record<EstagioCognitivo, string> = {
  ocioso: 'à disposição',
  escutando: 'ouvindo',
  executando: 'executando',
  consultando: 'consultando o arquivo',
  pensando: 'raciocinando',
  falando: 'respondendo',
};

/** Convites da sala vazia. Ficha tocável envia na hora — zero fricção. */
const SUGESTOES = [
  'Vai chover hoje?',
  'Quantas centrais ativas temos em MT?',
  'Crie uma pasta chamada Contratos na área de trabalho',
  'Esse erro de conexão do banco já aconteceu antes?',
];

interface Props {
  estado: SnapshotCognitivo;
  falas: Fala[];
  conectado: boolean;
  /** Estado fino do enlace — a UI diz a verdade sobre a conexão. */
  conexao?: EstadoConexao;
  /** Por que o servidor recusou (sessão expirada × limite de telas). */
  motivoDesconexao?: string | null;
  /** Religa depois de uma recusa terminal (sessão expirada, limite de telas). */
  onReligar?: () => void;
  onEnviar: (texto: string, anexo?: AnexoImagem) => boolean;
  /** Sobe o screenshot; `null` em qualquer falha (motivo já foi para o log). */
  onEnviarImagem?: (arquivo: File) => Promise<AnexoImagem | null>;
  onInterromper: () => void;
  /** A voz (áudio do servidor ou síntese local) está soando agora. */
  vozFalando?: boolean;
  /** Preferência do operador: a IARA fala em voz alta? */
  vozLigada?: boolean;
  /** O navegador tem síntese de fala. */
  vozDisponivel?: boolean;
  onAlternarVoz?: () => void;
  /** Fala um texto avulso da interface (saudação do "ei IARA"). */
  onFalar?: (texto: string) => boolean;
  /** O texto avulso soando agora — entra na guarda de eco junto com a fala. */
  textoAvulso?: string | null;
  /** Grava a ficha do operador. `false` = o barramento estava fechado. */
  onSalvarPreferencias?: (p: PreferenciasOperador) => boolean;
  /** Falha de gravação vinda do servidor DEPOIS do clique (socket estava
   *  aberto, mas a escrita em si não foi). `null` fora desse caminho. */
  erroPreferencias?: { instante: number; texto: string } | null;
  /** As mãos deste operador. `null` = ainda não perguntamos. */
  maquinas?: MaquinaDoOperador[] | null;
  pareamentoDisponivel?: boolean;
  acaoDispositivo?: { ok: boolean; texto: string } | null;
  onPedirDispositivos?: () => boolean;
  onAutorizarComputador?: (codigo: string, nome?: string) => boolean;
  onEsquecerComputador?: (id: string) => boolean;
  /** Etapa 2 (14/08/2026) — "Atualizar agora" numa máquina desatualizada. */
  onAtualizarComputador?: (id: string) => boolean;
  /** Etapa 4 (14/08/2026) — dar um nome à máquina, escolhido pela operadora. */
  onRenomearComputador?: (id: string, nome: string) => boolean;
  /** "Trabalhar nesta" — o gate multi-desktop (20/08/2026). */
  onEscolherComputador?: (id: string | null, nome?: string) => boolean;
  /** Qual máquina o operador escolheu. `null` = nenhuma. */
  computadorEscolhido?: string | null;
  /** Código lido do QR do braço (`?parear=`). `null` fora desse caminho. */
  codigoDePareamentoUrl?: string | null;
  /** Encerra a sessão. `null` no seletor local — não há sessão real para sair. */
  onSair?: (() => void) | null;
}

/** Qual gaveta está aberta sobre o fluxo da conversa. Uma de cada vez: as
 *  quatro ocupam o mesmo espaço, e "aberta" é um estado do painel, não de
 *  cada uma. `perfil` é o menu pequeno; as outras três ocupam o fluxo inteiro. */
type Gaveta = 'nenhuma' | 'perfil' | 'ficha' | 'dispositivos' | 'automacao';

export function PainelConversa({
  estado,
  falas,
  conectado,
  conexao = 'conectado',
  motivoDesconexao = null,
  onReligar,
  onEnviar,
  onEnviarImagem,
  onInterromper,
  vozFalando = false,
  vozLigada = true,
  vozDisponivel = false,
  onAlternarVoz,
  onFalar,
  textoAvulso = null,
  onSalvarPreferencias,
  erroPreferencias = null,
  maquinas = null,
  pareamentoDisponivel = true,
  acaoDispositivo = null,
  onPedirDispositivos,
  onAutorizarComputador,
  onEsquecerComputador,
  onAtualizarComputador,
  onRenomearComputador,
  onEscolherComputador,
  computadorEscolhido,
  codigoDePareamentoUrl = null,
  onSair = null,
}: Props) {
  const [rascunho, setRascunho] = useState('');
  const [gaveta, setGaveta] = useState<Gaveta>('nenhuma');
  /** O screenshot escolhido, já enviado ao motor, esperando o Enter/clique de
   *  envio — a IMAGEM chega antes do turno começar, não junto do texto. */
  const [anexoPendente, setAnexoPendente] = useState<AnexoImagem | null>(null);
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [erroAnexo, setErroAnexo] = useState<string | null>(null);
  const arquivoRef = useRef<HTMLInputElement | null>(null);

  /** O QR só poupa dois gestos: abrir a gaveta certa e digitar o código. */
  useEffect(() => {
    if (codigoDePareamentoUrl) setGaveta('dispositivos');
  }, [codigoDePareamentoUrl]);
  const fim = useRef<HTMLDivElement | null>(null);

  /**
   * O menu fecha ao clicar fora — é um popover, não uma gaveta: some com
   * qualquer clique que não seja nele mesmo ou no botão que o abriu, do
   * mesmo jeito que um menu de sistema se comporta.
   */
  const menuPerfilRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (gaveta !== 'perfil') return;
    const aoClicarFora = (e: MouseEvent) => {
      if (menuPerfilRef.current && !menuPerfilRef.current.contains(e.target as Node)) {
        setGaveta('nenhuma');
      }
    };
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, [gaveta]);

  /**
   * Rolagem por quadro, não por atualização: durante o streaming `falas` muda
   * ~20x/s, e um `scrollIntoView({smooth})` por mudança reiniciava vinte
   * animações de rolagem por segundo — trabalho contínuo no compositor
   * durante todo o turno. Um rAF aglutina a rajada num ajuste seco por quadro.
   */
  const rolagemPendente = useRef(0);
  useEffect(() => {
    if (rolagemPendente.current) return;
    rolagemPendente.current = requestAnimationFrame(() => {
      rolagemPendente.current = 0;
      fim.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
    });
    return () => {
      if (rolagemPendente.current) {
        cancelAnimationFrame(rolagemPendente.current);
        rolagemPendente.current = 0;
      }
    };
  }, [falas]);

  const ocupada = estado.estagio !== 'ocioso' && estado.estagio !== 'escutando';
  /**
   * Tem pedido MEU esperando a vez? Se tem, "parar" precisa estar disponível —
   * é o único momento em que desistir ainda cancela alguma coisa sem que nada
   * tenha acontecido no mundo. Antes disto o botão dependia só de a sessão
   * estar ocupada, e ficava indistinguível para quem esperava e para quem
   * estava sendo atendido.
   */
  const meuPedidoEspera = falas.some((f) => f.papel === 'operador' && f.na_fila);

  /**
   * OS ATALHOS DA SALA VAZIA SÃO DE QUEM PERGUNTA (15/08/2026, a pedido da
   * operadora): as 3 perguntas mais repetidas DESTA conta, completadas com as
   * padrão enquanto o histórico não existe. A conta mora em `lib/sugestoes`
   * (pura, testada); aqui só se guarda por `id_usuario` no localStorage — o
   * histórico é deste aparelho, o que é honesto: é nele que a pessoa digita.
   */
  const idOperador = estado.operador?.id_usuario ?? 'local';
  const [historicoPerguntas, setHistoricoPerguntas] = useState<PerguntaContada[]>([]);
  useEffect(() => {
    setHistoricoPerguntas(lerHistorico(window.localStorage.getItem(`iara.perguntas.${idOperador}`)));
  }, [idOperador]);

  const contarPergunta = (texto: string) => {
    setHistoricoPerguntas((atual) => {
      const novo = registrarPergunta(atual, texto, Date.now());
      try {
        window.localStorage.setItem(`iara.perguntas.${idOperador}`, JSON.stringify(novo));
      } catch {
        /* localStorage cheio ou bloqueado: os atalhos degradam para as
           sugestões padrão, e a conversa em si não pode ser afetada. */
      }
      return novo;
    });
  };

  const sugestoes = sugerir(historicoPerguntas, SUGESTOES);

  const enviarContando = (texto: string, anexo?: AnexoImagem): boolean => {
    const aceitou = onEnviar(texto, anexo);
    if (aceitou && texto.trim()) contarPergunta(texto);
    return aceitou;
  };

  const submeter = () => {
    if (enviarContando(rascunho, anexoPendente ?? undefined)) {
      setRascunho('');
      setAnexoPendente(null);
      setErroAnexo(null);
    }
  };

  const aoEscolherArquivo = async (arquivo: File | undefined) => {
    if (!arquivo || !onEnviarImagem) return;
    setErroAnexo(null);
    setEnviandoAnexo(true);
    try {
      const resultado = await onEnviarImagem(arquivo);
      // `null` já foi explicado no console técnico por `useIaraSocket` — aqui
      // só se garante que a tentativa fica visível perto do botão também.
      setAnexoPendente(resultado);
      if (!resultado) setErroAnexo('Não foi possível anexar essa imagem.');
    } finally {
      setEnviandoAnexo(false);
    }
  };

  /**
   * O nome que a IARA usa. É a MESMA regra do prompt — ficha primeiro,
   * credencial depois — e por isso a saudação do "ei IARA" muda junto quando o
   * operador troca o nome na ficha. Duas regras diferentes para o mesmo fato
   * fariam a voz e o texto chamarem a pessoa de coisas diferentes.
   */
  const preferencias = fichaDoSnapshot(estado.operador?.preferencias);
  const nomeOperador = preferencias.como_chamar || estado.operador?.nome || '';

  /**
   * O nome vem do login em caixa baixa (`daiane`) porque é derivado do e-mail.
   * Numa saudação isso lê como campo de banco de dados vazando para a tela.
   * Só a primeira letra: `de`, `da`, `dos` de sobrenome não são nomes próprios
   * e capitalizá-los seria pior que não tocar em nada.
   */
  const nomeExibido = nomeOperador
    ? nomeOperador.charAt(0).toLocaleUpperCase('pt-BR') + nomeOperador.slice(1)
    : '';

  /**
   * O cabeçalho tem UMA vaga, e quem a ocupa depende do que está acontecendo.
   *
   * Trocar "à disposição" por uma saudação não esconde nada: `ocioso` É a
   * ausência de trabalho, e dizer isso com o nome de quem chegou informa mais
   * que um rótulo de estado. No instante em que a IARA começa a pensar, agir ou
   * falar, o estado real toma a vaga de volta — porque aí ele é fato observado,
   * e fato observado ganha da cortesia.
   *
   * "Boas-vindas" e não "bem-vindo": a IARA atende uma equipe inteira e não
   * pergunta o gênero de ninguém para montar uma frase.
   */
  const saudando = conexao === 'conectado' && estado.estagio === 'ocioso' && Boolean(nomeExibido);

  /** Mãos ATENDENDO agora. Máquina pareada e desligada não conta: o número no
   *  cabeçalho responde "posso pedir algo no computador?", não "quantas máquinas
   *  já autorizei". */
  const maosLigadas = (maquinas ?? []).filter((m) => m.conectada).length;

  /**
   * Modo ligação. A IARA "está falando" quando há fala em curso não concluída
   * — é esse sinal que transforma voz do operador em interrupção em vez de
   * nova pergunta.
   */
  const falaEmCurso = falas.length > 0 ? falas[falas.length - 1] : null;
  // `vozFalando` entra na conta: com síntese local, o áudio continua soando
  // DEPOIS de a fala estar concluída no snapshot — e cortar a IARA no meio
  // do áudio também é interrupção.
  const iaraFalando =
    estado.estagio === 'falando' ||
    vozFalando ||
    Boolean(falaEmCurso && falaEmCurso.papel === 'iara' && !falaEmCurso.concluida);

  const escuta = useEscuta({
    iaraFalando,
    // Guarda de eco: o texto que a IARA está dizendo agora — se o microfone
    // ouvir exatamente isto, é o alto-falante, não a operadora. A saudação
    // ("Oi Daiane, pode falar") não passa pelo snapshot, então entra pelo
    // texto avulso — sem ela na guarda, a IARA se interrompia com o próprio
    // eco e ainda respondia à própria saudação como pergunta nova.
    textoFalado:
      [
        falaEmCurso && falaEmCurso.papel === 'iara' ? falaEmCurso.texto : null,
        textoAvulso,
      ]
        .filter(Boolean)
        .join(' ') || null,
    // Pergunta falada conta como pergunta: os atalhos da sala são de quem
    // pergunta, por qualquer boca.
    aoConcluirFala: (texto) => enviarContando(texto),
    aoInterromper: onInterromper,
    // "Ei IARA" respondido com voz: a confirmação de que ela está ouvindo.
    // Devolver `false` (voz desligada) faz a escuta soar o toque de despertar.
    aoAcordar: onFalar
      ? () =>
          onFalar(nomeOperador ? `Oi ${nomeOperador}, pode falar.` : 'Oi, pode falar.')
      : undefined,
  });

  /**
   * Mesmo gatilho de barge-in de sempre (`onInterromper`), só que acionado
   * pelo VAD acústico em vez de esperar o `SpeechRecognition` devolver texto.
   * Só captura microfone quando a escuta já está aberta (vigília ou ligação) —
   * nunca antes de a operadora ter pedido para ouvir.
   */
  const deteccao = useDeteccaoVocal({
    ativar: escuta.ativa || escuta.vigilia,
    iaraFalando,
    aoIniciarFala: onInterromper,
  });

  return (
    <aside className="painel-conversa">
      {/*
        UMA informação contextual, nunca um painel de estados: "IARA · pensando"
        e o ponto de enlace. Identidade da sessão e leitura do operador moram no
        painel técnico — aqui é conversa, não instrumentação.
      */}
      <header className="conversa-cabecalho">
        <div className="conversa-cabecalho-linha">
          <span className="conversa-titulo">IARA</span>
          {/*
            A porta continua sendo o NOME de quem está na sala — não uma
            engrenagem de configurações. Preferência sobre como ser tratado
            não é ajuste de sistema; é sobre a pessoa, e o lugar dela é onde a
            pessoa aparece. O que mudou (15/08/2026) é o destino: o nome não
            leva mais direto à Ficha — abre um menu pequeno, ancorado nele
            mesmo, com Ficha como um dos destinos possíveis.
          */}
          {saudando && onSalvarPreferencias ? (
            <div className="conversa-perfil" ref={menuPerfilRef}>
              <button
                className={gaveta === 'perfil' ? 'conversa-saudacao aberto' : 'conversa-saudacao'}
                onClick={() => setGaveta((g) => (g === 'perfil' ? 'nenhuma' : 'perfil'))}
                title="Perfil, dispositivos e automação"
                aria-haspopup="menu"
                aria-expanded={gaveta === 'perfil'}
              >
                <span className="saudacao-cortesia">Boas-vindas,</span>{' '}
                <span className="saudacao-nome">{nomeExibido}</span>
              </button>
              {gaveta === 'perfil' && (
                <MenuPerfil
                  aoAbrirPerfil={() => setGaveta('ficha')}
                  aoAbrirDispositivos={() => setGaveta('dispositivos')}
                  aoAbrirAutomacao={() => setGaveta('automacao')}
                  aoSair={onSair ? () => onSair() : null}
                />
              )}
            </div>
          ) : (
            <span className="conversa-estagio">
              {conexao === 'conectado'
                ? ROTULO_ESTAGIO[estado.estagio]
                : conexao === 'desconectado'
                  ? 'desconectada'
                  : conexao === 'conectando'
                    ? 'abrindo…'
                    : 'reconectando…'}
            </span>
          )}
          {/*
            A porta do quadro de chaves. Fica ANTES do ponto de enlace e depois
            do estado, na ordem em que as três coisas importam: o que a IARA
            está fazendo, o que ela alcança, se o fio está de pé.

            O número ao lado do ícone é fato observado — quantos braços estão
            conectados agora —, e por isso ele some quando não há nenhum em vez
            de virar um zero. Um "0" permanente no cabeçalho é ruído que a pessoa
            aprende a ignorar; a ausência é a mesma informação sem o custo.
          */}
          {onPedirDispositivos && (
            <button
              className={gaveta === 'dispositivos' ? 'conversa-maos aberto' : 'conversa-maos'}
              onClick={() => setGaveta((g) => (g === 'dispositivos' ? 'nenhuma' : 'dispositivos'))}
              title="Onde a IARA tem mãos — computadores ligados a você"
              aria-label="Computadores conectados"
              aria-expanded={gaveta === 'dispositivos'}
            >
              <IconeMaos tamanho={14} />
              {maosLigadas > 0 && <span className="conversa-maos-conta">{maosLigadas}</span>}
            </button>
          )}
          <span
            className={conectado ? 'conversa-enlace ligado' : 'conversa-enlace'}
            title={conectado ? 'barramento aberto' : 'barramento fechado'}
          />
        </div>
        {estado.origem_raciocinio === 'local' && (
          <div className="conversa-aviso">
            Raciocínio rodando localmente via Ollama — nada sai da sua rede. Clima,
            infraestrutura, histórico, hora e busca seguem ativos.
          </div>
        )}
        {estado.origem_raciocinio === 'nenhuma' && estado.nuvem_indisponivel && (
          <div className="conversa-aviso">
            Raciocínio em nuvem desligado (sem <code>ANTHROPIC_API_KEY</code>) — clima,
            infraestrutura, histórico, hora e busca seguem ativos.
          </div>
        )}
        {conexao === 'desconectado' && (
          <div className="conversa-aviso">
            {motivoDesconexao ?? 'A sessão foi encerrada pelo servidor.'}{' '}
            {onReligar && (
              <button className="religar" onClick={onReligar}>
                Reconectar
              </button>
            )}
          </div>
        )}
      </header>

      {/*
        A ficha OCUPA o fluxo, não flutua sobre ele. Modal sobreposto exigiria
        uma camada acima do painel — e o painel já é a camada mais externa da
        hierarquia espacial. Enquanto a ficha está aberta, o rodapé de escrita
        continua vivo: quem abriu para trocar o próprio nome não deveria perder
        a conversa por isso.
      */}
      {gaveta === 'ficha' && onSalvarPreferencias ? (
        <div className="conversa-fluxo rolagem">
          <FichaOperador
            nomeCredencial={estado.operador?.nome ?? ''}
            preferencias={preferencias}
            conectado={conectado}
            aoSalvar={onSalvarPreferencias}
            erroSalvar={erroPreferencias}
            aoFechar={() => setGaveta('nenhuma')}
          />
        </div>
      ) : gaveta === 'dispositivos' && onPedirDispositivos ? (
        <div className="conversa-fluxo rolagem">
          <Dispositivos
            maquinas={maquinas}
            conectado={conectado}
            pareamentoDisponivel={pareamentoDisponivel}
            ultimaAcao={acaoDispositivo}
            codigoInicial={codigoDePareamentoUrl}
            aoPedirLista={onPedirDispositivos}
            aoAutorizar={onAutorizarComputador ?? (() => false)}
            aoEsquecer={(id) => onEsquecerComputador?.(id)}
            aoAtualizar={(id) => onAtualizarComputador?.(id) ?? false}
            aoRenomear={(id, nome) => onRenomearComputador?.(id, nome) ?? false}
            aoEscolher={(id, nome) => onEscolherComputador?.(id, nome)}
            escolhida={computadorEscolhido ?? null}
            aoAbrirAutomacao={() => setGaveta('automacao')}
            aoFechar={() => setGaveta('nenhuma')}
          />
        </div>
      ) : gaveta === 'automacao' ? (
        <div className="conversa-fluxo rolagem">
          <Automacao
            maquinas={maquinas}
            podeAgir={conectado}
            aoAtualizar={(id) => onAtualizarComputador?.(id) ?? false}
            aoFechar={() => setGaveta('nenhuma')}
          />
        </div>
      ) : (
      <div className="conversa-fluxo rolagem">
        {falas.length === 0 && (
          <div className="sugestoes">
            <p className="sugestoes-titulo">A sala está aberta</p>
            {sugestoes.map((s) => (
              <button
                key={s}
                className="sugestao"
                onClick={() => enviarContando(s)}
                disabled={!conectado}
              >
                {s}
              </button>
            ))}
          </div>
        )}

        {falas.map((f) => {
          /**
           * A imagem que esta fala da IARA marca é a da PERGUNTA que ela
           * responde — nunca uma imagem própria: a IARA nunca gera mídia
           * nova, só aponta sobre a que o operador mandou (ver ADR-4 em
           * `docs/prd/test-plan.md`).
           */
          const imagemDaPergunta =
            f.papel === 'iara' && f.responde_a
              ? falas.find((x) => x.id === f.responde_a)?.imagem
              : null;
          return (
            <div
              key={f.id}
              className={
                f.papel === 'operador'
                  ? f.na_fila
                    ? 'balao operador esperando'
                    : 'balao operador'
                  : 'balao iara'
              }
            >
              {(f.imagem || imagemDaPergunta) && (
                <div className="balao-imagem">
                  <img src={urlAnexo((f.imagem ?? imagemDaPergunta)!.url)} alt="Screenshot anexado" />
                  {f.marcacao && (
                    <span
                      className="marcacao-alvo"
                      style={{ left: `${f.marcacao.alvo_x * 100}%`, top: `${f.marcacao.alvo_y * 100}%` }}
                      title={f.marcacao.elemento}
                    />
                  )}
                </div>
              )}
              {f.texto || <span className="reticencias">…</span>}
              {/* A ESPERA DITA COM TODAS AS LETRAS. Sem isto, um pedido atrás do
                  pedido de outra tela é indistinguível de um pedido lento — e a
                  pessoa não sabe se ainda dá tempo de desistir. */}
              {f.na_fila && <span className="balao-espera">esperando a vez</span>}
              {/* A ENTREGA NÃO CONFIRMADA, dita na própria bolha. O log rola
                  para fora da vista; a conversa fica. Sem isto, a mensagem que
                  se perdeu numa reconexão fica indistinguível da que chegou —
                  foi o OBS-1 de 19/08/2026. Ver `VigiaDoEco`. */}
              {f.sem_confirmacao && (
                <span className="balao-espera" title="O motor não devolveu o eco desta mensagem dentro do prazo">
                  sem confirmação de entrega
                </span>
              )}
              {/*
                A HORA, como no WhatsApp: pequena, no canto, depois do texto.
                Formatada no fuso de quem lê — o carimbo chega em ISO do
                servidor, porque o relógio do navegador daria "agora" a toda
                mensagem antiga depois de um recarregamento.
              */}
              {f.instante && (
                <time className="balao-hora" dateTime={f.instante}>
                  {new Date(f.instante).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              )}
            </div>
          );
        })}
        <div ref={fim} />
      </div>
      )}

      <footer className="conversa-rodape">
        {/* Faixa da ligação: só aparece quando o microfone está aberto. */}
        {escuta.ativa && (
          <div className="escuta-faixa">
            <span
              aria-hidden
              className={escuta.estado === 'ouvindo' ? 'escuta-ponto' : 'escuta-ponto espera'}
            />
            <span className={escuta.parcial ? 'parcial' : undefined}>
              {escuta.parcial ||
                (iaraFalando
                  ? 'A IARA está falando — pode cortar, é só falar.'
                  : 'Ouvindo. Fale normalmente; eu envio quando você parar.')}
            </span>
          </div>
        )}

        {/*
          A escuta indisponível DIZ o que houve e oferece a volta. Antes o
          reconhecedor podia falhar em laço para sempre sem uma palavra, e os
          dois botões de voz ficavam desabilitados sem explicação — o operador
          só via "nada acontece". Ver o orçamento de falha em `useEscuta`.
        */}
        {escuta.motivoIndisponivel && (
          <div className="escuta-faixa alerta">
            {escuta.motivoIndisponivel}{' '}
            {escuta.estado === 'indisponivel' && (
              <button className="religar" onClick={escuta.religar}>
                Tentar de novo
              </button>
            )}
          </div>
        )}

        {/*
          MICROFONE ABERTO E MUDO — o defeito que custou uma semana em 15/08/2026
          e que a interface não tinha como contar.

          O microfone padrão do Windows apontava para uma webcam de celular
          desconectada: fluxo válido, 48 kHz, faixa ativa, silêncio digital. Tudo
          acendia, o botão ficava habilitado, a faixa dizia "ouvindo" — e nada
          era reconhecido, sem uma palavra sobre o porquê.

          O reconhecedor não sabe disto nem pode: `SpeechRecognition` não informa
          nem deixa escolher dispositivo. Quem sabe é o fluxo do VAD, que é áudio
          de verdade e mede zero. É por isso que esta faixa nasce ali e não aqui —
          fato observado, como todo evento visual deste sistema.
        */}
        {deteccao.semSinal && (
          <div className="escuta-faixa alerta">
            Estou ouvindo
            {deteccao.dispositivo ? ` "${deteccao.dispositivo}"` : ' o microfone'} e não chega som
            nenhum. Verifique o dispositivo de entrada do Windows — o Chrome usa o{' '}
            <strong>dispositivo de comunicação padrão</strong>, que é outro campo, no painel antigo
            de Som.
          </div>
        )}

        {(anexoPendente || enviandoAnexo || erroAnexo) && (
          <div className="anexo-pendente">
            {enviandoAnexo && <span className="reticencias">enviando imagem…</span>}
            {anexoPendente && !enviandoAnexo && (
              <>
                <img src={urlAnexo(anexoPendente.url)} alt="Screenshot a anexar" />
                <button
                  type="button"
                  className="anexo-remover"
                  onClick={() => setAnexoPendente(null)}
                  aria-label="Remover imagem anexada"
                  title="Remover imagem"
                >
                  ×
                </button>
              </>
            )}
            {erroAnexo && !enviandoAnexo && <span className="anexo-erro">{erroAnexo}</span>}
          </div>
        )}

        {/*
          O campo NUNCA trava: digitar durante uma reconexão é legítimo — o
          texto fica pronto para o Enter quando o enlace voltar. Só o envio
          depende da conexão.
        */}
        <textarea
          className="campo-conversa"
          rows={2}
          value={rascunho}
          placeholder={
            conectado ? 'Fale ou escreva para a IARA…' : 'Pode escrever — envio quando reconectar…'
          }
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submeter();
            }
          }}
        />
        <div className="conversa-acoes">
          <button
            className={escuta.ativa ? 'cb ativo' : 'cb'}
            onClick={escuta.alternar}
            disabled={!conectado || escuta.estado === 'indisponivel'}
            title={
              escuta.estado === 'indisponivel'
                ? (escuta.motivoIndisponivel ?? 'Indisponível')
                : escuta.ativa
                  ? 'Encerrar a ligação'
                  : 'Conversar por voz'
            }
            aria-label={escuta.ativa ? 'Encerrar a ligação' : 'Conversar por voz'}
            aria-pressed={escuta.ativa}
          >
            {escuta.ativa ? <IconeEncerrar /> : <IconeMicrofone />}
          </button>
          <button
            className={escuta.vigilia ? 'cb ativo' : 'cb'}
            onClick={escuta.alternarVigilia}
            disabled={escuta.estado === 'indisponivel'}
            title={
              escuta.estado === 'indisponivel'
                ? (escuta.motivoIndisponivel ?? 'Indisponível')
                : escuta.vigilia
                  ? 'Parar de atender ao chamado "ei IARA"'
                  : 'Atender ao chamado de voz: diga "ei IARA" para abrir a ligação'
            }
            aria-label='Vigília do chamado "ei IARA"'
            aria-pressed={escuta.vigilia}
          >
            <IconeVigilia />
          </button>
          {vozDisponivel && onAlternarVoz && (
            <button
              className="cb"
              onClick={onAlternarVoz}
              title={vozLigada ? 'Silenciar a voz da IARA' : 'Ligar a voz da IARA'}
              aria-label={vozLigada ? 'Silenciar a voz da IARA' : 'Ligar a voz da IARA'}
              aria-pressed={vozLigada}
            >
              {vozLigada ? <IconeVoz /> : <IconeMudo />}
            </button>
          )}
          <button
            className="cb"
            onClick={onInterromper}
            disabled={!ocupada && !vozFalando && !meuPedidoEspera}
            title={meuPedidoEspera ? 'Desistir do pedido que está na fila' : 'Interromper a IARA'}
            aria-label="Interromper a IARA"
          >
            <IconeInterromper />
          </button>
          {onEnviarImagem && (
            <>
              <input
                ref={arquivoRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="anexo-input"
                onChange={(e) => {
                  const arquivo = e.target.files?.[0];
                  // Some do DOM assim que lido: escolher o MESMO arquivo duas
                  // vezes seguidas não dispara `onChange` sem isto, e "tentei
                  // de novo" é exatamente o caso de quem viu o primeiro falhar.
                  e.target.value = '';
                  void aoEscolherArquivo(arquivo);
                }}
              />
              <button
                className={anexoPendente ? 'cb ativo' : 'cb'}
                onClick={() => arquivoRef.current?.click()}
                disabled={!conectado || enviandoAnexo}
                title="Anexar um screenshot"
                aria-label="Anexar um screenshot"
              >
                <IconeAnexarImagem />
              </button>
            </>
          )}
          <button
            className="cb-enviar"
            onClick={submeter}
            disabled={!conectado || (!rascunho.trim() && !anexoPendente)}
            title="Enviar"
            aria-label="Enviar"
          >
            <IconeEnviar tamanho={16} />
          </button>
        </div>
        {escuta.estado === 'vigiando' && (
          <div className="conversa-dica">
            vigília ligada — diga <b>“ei IARA”</b> para abrir a ligação
          </div>
        )}
        {/*
          Achado em auditoria (14/08/2026): sem esta linha, a dica acima ficava
          congelada dizendo "vigília ligada" durante as tentativas silenciosas
          de religar o reconhecedor (até ~14 s por falha) — quem chamasse "ei
          IARA" nessa janela via a mesma frase de sempre e nenhum indício de
          que o microfone não estava, de fato, ouvindo nada.
        */}
        {escuta.estado === 'reconectando' && (
          <div className="conversa-dica">
            o microfone caiu por um instante — religando sozinha…
          </div>
        )}
      </footer>
    </aside>
  );
}
