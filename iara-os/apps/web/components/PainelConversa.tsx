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
import {
  IconeEncerrar,
  IconeEnviar,
  IconeInterromper,
  IconeMicrofone,
  IconeMudo,
  IconeVigilia,
  IconeVoz,
} from './Icones';
import type { EstagioCognitivo } from '../lib/estado';
import type { SnapshotCognitivo } from '../lib/snapshot';

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
}

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
}: Props) {
  const [rascunho, setRascunho] = useState('');
  const fim = useRef<HTMLDivElement | null>(null);

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
    aoConcluirFala: (texto) => {
      onEnviar(texto);
    },
    aoInterromper: onInterromper,
    // "Ei IARA" respondido com voz: a confirmação de que ela está ouvindo.
    // Devolver `false` (voz desligada) faz a escuta soar o toque de despertar.
    aoAcordar: onFalar
      ? () => {
          const nome = estado.operador?.nome;
          return onFalar(nome ? `Oi ${nome}, pode falar.` : 'Oi, pode falar.');
        }
      : undefined,
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
          <span className="conversa-estagio">
            {conexao === 'conectado'
              ? ROTULO_ESTAGIO[estado.estagio]
              : conexao === 'desconectado'
                ? 'desconectada'
                : conexao === 'conectando'
                  ? 'abrindo…'
                  : 'reconectando…'}
          </span>
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

        {escuta.motivoIndisponivel && (
          <div className="escuta-faixa alerta">{escuta.motivoIndisponivel}</div>
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
      </footer>
    </aside>
  );
}
