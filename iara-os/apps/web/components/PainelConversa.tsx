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
import { Automacao } from './Automacao';
import { Dispositivos } from './Dispositivos';
import { FichaOperador, fichaDoSnapshot } from './FichaOperador';
import { MenuPerfil } from './MenuPerfil';

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
  onEnviar: (texto: string) => boolean;
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
  onAutorizarComputador?: (codigo: string) => boolean;
  onEsquecerComputador?: (id: string) => boolean;
  /** Etapa 2 (14/08/2026) — "Atualizar agora" numa máquina desatualizada. */
  onAtualizarComputador?: (id: string) => boolean;
  /** Etapa 4 (14/08/2026) — dar um nome à máquina, escolhido pela operadora. */
  onRenomearComputador?: (id: string, nome: string) => boolean;
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
  codigoDePareamentoUrl = null,
  onSair = null,
}: Props) {
  const [rascunho, setRascunho] = useState('');
  const [gaveta, setGaveta] = useState<Gaveta>('nenhuma');

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

  const submeter = () => {
    if (onEnviar(rascunho)) setRascunho('');
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
    aoConcluirFala: (texto) => onEnviar(texto),
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
  useDeteccaoVocal({
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
        {estado.nuvem_indisponivel && (
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
            aoFechar={() => setGaveta('nenhuma')}
          />
        </div>
      ) : gaveta === 'automacao' ? (
        <div className="conversa-fluxo rolagem">
          <Automacao maquinas={maquinas} aoFechar={() => setGaveta('nenhuma')} />
        </div>
      ) : (
      <div className="conversa-fluxo rolagem">
        {falas.length === 0 && (
          <div className="sugestoes">
            <p className="sugestoes-titulo">A sala está aberta</p>
            {SUGESTOES.map((s) => (
              <button key={s} className="sugestao" onClick={() => onEnviar(s)} disabled={!conectado}>
                {s}
              </button>
            ))}
          </div>
        )}

        {falas.map((f) => (
          <div key={f.id} className={f.papel === 'operador' ? 'balao operador' : 'balao iara'}>
            {f.texto || <span className="reticencias">…</span>}
          </div>
        ))}
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
            disabled={!ocupada && !vozFalando}
            title="Interromper a IARA"
            aria-label="Interromper a IARA"
          >
            <IconeInterromper />
          </button>
          <button
            className="cb-enviar"
            onClick={submeter}
            disabled={!conectado || !rascunho.trim()}
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
