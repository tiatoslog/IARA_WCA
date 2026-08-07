'use client';

/**
 * Painel de trabalho — a camada MAIS EXTERNA e recuada da hierarquia.
 * Ele nunca disputa atenção com a sala; é uma prancheta apoiada na mesa.
 */

import { useEffect, useRef, useState } from 'react';
import type { Fala } from '../hooks/useIaraSocket';
import { useEscuta } from '../hooks/useEscuta';
import type { EstagioCognitivo } from '../lib/estado';
import type { SnapshotCognitivo } from '../lib/snapshot';

const ROTULO_DESTINO: Record<string, string> = {
  sistema_local: 'ação local',
  rag_historico: 'base histórica',
  claude_nuvem: 'raciocínio',
  recusa_sigilo: 'sigilo',
};

const ROTULO_ESTAGIO: Record<EstagioCognitivo, string> = {
  ocioso: 'à disposição',
  escutando: 'ouvindo',
  executando: 'executando',
  consultando: 'consultando o arquivo',
  pensando: 'raciocinando',
  falando: 'respondendo',
};

interface Props {
  estado: SnapshotCognitivo;
  falas: Fala[];
  conectado: boolean;
  onEnviar: (texto: string) => boolean;
  onInterromper: () => void;
}

export function PainelConversa({ estado, falas, conectado, onEnviar, onInterromper }: Props) {
  const [rascunho, setRascunho] = useState('');
  const fim = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fim.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
  const iaraFalando =
    estado.estagio === 'falando' || Boolean(falaEmCurso && falaEmCurso.papel === 'iara' && !falaEmCurso.concluida);

  const escuta = useEscuta({
    iaraFalando,
    aoConcluirFala: (texto) => {
      onEnviar(texto);
    },
    aoInterromper: onInterromper,
  });

  return (
    <aside
      className="painel-conversa"
      style={{
        width: 400,
        flex: 'none',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--painel)',
        borderLeft: '1px solid var(--linha)',
        height: '100%',
        minHeight: 0,
      }}
    >
      <header style={{ padding: '16px 18px 12px', borderBottom: '1px solid var(--linha)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <strong style={{ fontSize: 15, letterSpacing: 0.3 }}>IARA</strong>
          <span style={{ fontSize: 12, color: 'var(--tinta-fraca)' }}>
            {conectado ? ROTULO_ESTAGIO[estado.estagio] : 'reconectando…'}
          </span>
          <span
            style={{
              marginLeft: 'auto',
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: conectado ? 'var(--luz-verde)' : 'var(--luz-alerta)',
            }}
          />
        </div>
        {estado.operador && (
          <div style={{ fontSize: 12, color: 'var(--tinta-fraca)', marginTop: 5 }}>
            {estado.operador.nome} · shard privado · leitura:{' '}
            <span style={{ color: 'var(--tinta)' }}>{estado.leitura.estado}</span>
          </div>
        )}
        {estado.nuvem_indisponivel && (
          <div
            style={{
              marginTop: 10,
              fontSize: 11.5,
              lineHeight: 1.45,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(240, 135, 106, 0.13)',
              border: '1px solid rgba(240, 135, 106, 0.4)',
            }}
          >
            Camada de raciocínio desligada — sem <code>ANTHROPIC_API_KEY</code>. Rotas locais
            (clima, infraestrutura, histórico, hora, busca) seguem ativas.
          </div>
        )}
      </header>

      <div
        className="rolagem"
        style={{ flex: 1, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {falas.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--tinta-fraca)', lineHeight: 1.6, margin: 0 }}>
            A sala está aberta. Experimente:
            <br />· “vai chover hoje?”
            <br />· “quantas centrais ativas temos em MT?”
            <br />· “esse erro de conexão do banco já aconteceu antes?”
            <br />· “que horas são?”
          </p>
        )}

        {falas.map((f) => (
          <div
            key={f.id}
            style={{
              alignSelf: f.papel === 'operador' ? 'flex-end' : 'flex-start',
              maxWidth: '88%',
            }}
          >
            <div
              style={{
                fontSize: 13.5,
                lineHeight: 1.55,
                padding: '10px 13px',
                borderRadius: 12,
                whiteSpace: 'pre-wrap',
                background: f.papel === 'operador' ? '#ece4d5' : '#fff',
                border: '1px solid var(--linha)',
              }}
            >
              {f.texto || <span style={{ color: 'var(--tinta-fraca)' }}>…</span>}
            </div>
            {f.papel === 'iara' && f.concluida && f.destino && (
              <div style={{ fontSize: 10.5, color: 'var(--tinta-fraca)', marginTop: 4 }}>
                {ROTULO_DESTINO[f.destino] ?? f.destino} · {f.latencia_ms} ms
                {f.cache_lido ? ` · ${f.cache_lido} tokens de cache` : ''}
              </div>
            )}
          </div>
        ))}
        <div ref={fim} />
      </div>

      <footer style={{ padding: 14, borderTop: '1px solid var(--linha)' }}>
        {/* Faixa da ligação: só aparece quando o microfone está aberto. */}
        {escuta.ativa && (
          <div
            style={{
              marginBottom: 10,
              padding: '9px 12px',
              borderRadius: 10,
              fontSize: 12.5,
              lineHeight: 1.45,
              minHeight: 38,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: 'rgba(159, 214, 168, 0.16)',
              border: '1px solid rgba(159, 214, 168, 0.55)',
            }}
          >
            <span
              aria-hidden
              style={{
                width: 8,
                height: 8,
                flex: 'none',
                borderRadius: '50%',
                background: escuta.estado === 'ouvindo' ? 'var(--luz-verde)' : 'var(--luz-quente)',
                animationName: 'pulsar',
                animationDuration: escuta.estado === 'ouvindo' ? '1.6s' : '3s',
                animationTimingFunction: 'ease-in-out',
                animationIterationCount: 'infinite',
              }}
            />
            <span style={{ color: escuta.parcial ? 'var(--tinta)' : 'var(--tinta-fraca)' }}>
              {escuta.parcial ||
                (iaraFalando
                  ? 'A IARA está falando — pode cortar, é só falar.'
                  : 'Ouvindo. Fale normalmente; eu envio quando você parar.')}
            </span>
          </div>
        )}

        {escuta.motivoIndisponivel && (
          <div
            style={{
              marginBottom: 10,
              padding: '8px 10px',
              borderRadius: 8,
              fontSize: 11.5,
              background: 'rgba(240, 135, 106, 0.13)',
              border: '1px solid rgba(240, 135, 106, 0.4)',
            }}
          >
            {escuta.motivoIndisponivel}
          </div>
        )}

        <textarea
          className="campo"
          rows={2}
          value={rascunho}
          placeholder={conectado ? 'Fale com a IARA…' : 'Aguardando o motor cognitivo…'}
          disabled={!conectado}
          onChange={(e) => setRascunho(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submeter();
            }
          }}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
          <button
            className="botao"
            onClick={escuta.alternar}
            disabled={!conectado || escuta.estado === 'indisponivel'}
            title={
              escuta.estado === 'indisponivel'
                ? (escuta.motivoIndisponivel ?? 'Indisponível')
                : 'Conversar por voz'
            }
            style={{
              flex: 'none',
              background: escuta.ativa ? 'var(--luz-verde)' : undefined,
              borderColor: escuta.ativa ? 'transparent' : undefined,
            }}
            aria-pressed={escuta.ativa}
          >
            {escuta.ativa ? '● Encerrar' : '🎙 Ligar'}
          </button>
          <button
            className="botao"
            onClick={submeter}
            disabled={!conectado || !rascunho.trim()}
            style={{ flex: 1 }}
          >
            Enviar
          </button>
          <button className="botao" onClick={onInterromper} disabled={!ocupada}>
            Interromper
          </button>
        </div>
      </footer>
    </aside>
  );
}
