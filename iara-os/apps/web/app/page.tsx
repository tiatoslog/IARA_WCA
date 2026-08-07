'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Escritorio } from '../components/Escritorio';
import { PainelConversa } from '../components/PainelConversa';
import { ConsoleTecnico } from '../components/ConsoleTecnico';
import { Portaria } from '../components/Portaria';
import { Presenca } from '../components/projecao/Presenca';
import { useIaraSocket, type Credencial } from '../hooks/useIaraSocket';
import { useVoz } from '../hooks/useVoz';
import { OPERADORES } from '../lib/operadores';
import { autenticacaoDisponivel, supabaseNavegador } from '../lib/supabaseNavegador';

/**
 * As duas projeções do mesmo snapshot. Não são temas: são periféricos de saída
 * diferentes lendo o mesmo contrato. O Kernel não sabe qual está montado.
 */
type Projecao = 'escritorio' | 'presenca';

const CHAVE_PROJECAO = 'iara.projecao';

function Medidor({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div style={{ minWidth: 96, flex: '1 1 96px' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: 10.5,
          color: 'var(--tinta-fraca)',
          marginBottom: 4,
        }}
      >
        <span>{rotulo}</span>
        <span>{Math.round(valor * 100)}%</span>
      </div>
      <div className="medidor">
        <i style={{ width: `${valor * 100}%`, background: cor }} />
      </div>
    </div>
  );
}

/** Alterna o periférico de saída. Só isso — não toca em nada do Kernel. */
function SeletorProjecao({ valor, aoTrocar }: { valor: Projecao; aoTrocar: (p: Projecao) => void }) {
  return (
    <div className="seletor-projecao" role="group" aria-label="Projeção">
      <button
        className={valor === 'escritorio' ? 'ativo' : undefined}
        onClick={() => aoTrocar('escritorio')}
      >
        Escritório
      </button>
      <button
        className={valor === 'presenca' ? 'ativo' : undefined}
        onClick={() => aoTrocar('presenca')}
      >
        Presença
      </button>
    </div>
  );
}

/** O escritório em si. Só monta quando já existe uma credencial resolvida. */
function Sala({ credencial, aoSair }: { credencial: Credencial; aoSair: (() => void) | null }) {
  const { snapshot: estado, falas, logs, conectado, enviar, interromper } = useIaraSocket(credencial);
  const [projecao, setProjecao] = useState<Projecao>('escritorio');

  useEffect(() => {
    const salva = window.localStorage.getItem(CHAVE_PROJECAO);
    if (salva === 'presenca' || salva === 'escritorio') setProjecao(salva);
  }, []);

  const trocarProjecao = useCallback((p: Projecao) => {
    window.localStorage.setItem(CHAVE_PROJECAO, p);
    setProjecao(p);
  }, []);

  /**
   * A última fala da IARA. É o relógio da articulação da boca no driver 3D —
   * ver `ControladorFacial`. Falas do operador não movem o rosto dela.
   */
  const falaCorrente = useMemo(() => {
    for (let i = falas.length - 1; i >= 0; i -= 1) {
      if (falas[i].papel === 'iara') return falas[i];
    }
    return null;
  }, [falas]);

  /**
   * A voz vive AQUI, acima das duas projeções. A IARA fala tanto no escritório
   * quanto na presença — só a boca é exclusiva do avatar 3D. Montar o áudio
   * dentro de `Presenca` a deixaria muda na sala em pixel art, e trocar de
   * projeção cortaria a fala no meio.
   */
  const voz = useVoz(falaCorrente, true);

  return (
    <main className="tela">
      {projecao === 'escritorio' ? (
        <section className="ambiente-sala">
          <div className="hud">
            {aoSair ? (
              <button className="botao" onClick={aoSair}>
                Sair
              </button>
            ) : (
              <SeletorLocal />
            )}
            <SeletorProjecao valor={projecao} aoTrocar={trocarProjecao} />
            <Medidor
              rotulo="energia cognitiva"
              valor={estado.metricas.energia_cognitiva}
              cor="var(--luz-quente)"
            />
            <Medidor
              rotulo="paciência"
              valor={estado.metricas.paciencia_operacional}
              cor="var(--luz-verde)"
            />
            <Medidor rotulo="afinidade" valor={estado.metricas.afinidade} cor="#c9a0dc" />
            <Medidor
              rotulo="carga de contexto"
              valor={estado.metricas.carga_contextual}
              cor="var(--luz-alerta)"
            />
          </div>

          <div className="enquadramento">
            <Escritorio estado={estado} />
          </div>

          <ConsoleTecnico logs={logs} />
        </section>
      ) : (
        <Presenca
          snapshot={estado}
          falaCorrente={falaCorrente}
          voz={voz}
          conectado={conectado}
          controles={<SeletorProjecao valor={projecao} aoTrocar={trocarProjecao} />}
        />
      )}

      <PainelConversa
        estado={estado}
        falas={falas}
        conectado={conectado}
        onEnviar={enviar}
        onInterromper={interromper}
      />

      {/* Política de mídia do navegador exige um gesto antes de tocar som.
          Não é erro — mas ficar em silêncio seria indistinguível de voz
          quebrada, e o operador acharia que a síntese falhou. Fica fora das
          duas projeções porque a voz também é das duas. */}
      {voz.bloqueado && (
        <button className="voz-bloqueada" onClick={voz.liberar}>
          Ativar a voz da IARA
        </button>
      )}
    </main>
  );
}

/**
 * Seletor de operador do MODO LOCAL. Só existe quando não há Supabase Auth
 * configurado. Trocar de operador aqui é desenvolvimento, não segurança — e a
 * faixa de aviso na página deixa isso explícito.
 */
function SeletorLocal() {
  const [id, setId] = useState(OPERADORES[0].id);

  useEffect(() => {
    const salvo = window.localStorage.getItem('iara.operador');
    if (salvo && OPERADORES.some((o) => o.id === salvo)) setId(salvo);
  }, []);

  return (
    <select
      className="botao"
      value={id}
      onChange={(e) => {
        window.localStorage.setItem('iara.operador', e.target.value);
        window.location.reload();
      }}
      style={{ padding: '7px 10px' }}
    >
      {OPERADORES.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
        </option>
      ))}
    </select>
  );
}

export default function Pagina() {
  const comAuth = autenticacaoDisponivel();
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const [verificando, setVerificando] = useState(comAuth);

  const lerSessao = useCallback(async () => {
    const bd = supabaseNavegador();
    if (!bd) return;
    const { data } = await bd.auth.getSession();
    const sessao = data.session;
    if (!sessao) {
      setCredencial(null);
      setVerificando(false);
      return;
    }
    setCredencial({
      id_usuario: sessao.user.id,
      nome:
        (sessao.user.user_metadata?.nome as string | undefined) ??
        sessao.user.email?.split('@')[0] ??
        'operador',
      token: sessao.access_token,
    });
    setVerificando(false);
  }, []);

  useEffect(() => {
    if (!comAuth) {
      // Modo local: identidade vem do seletor. Nunca em produção.
      const salvo = window.localStorage.getItem('iara.operador');
      const alvo = OPERADORES.find((o) => o.id === salvo) ?? OPERADORES[0];
      setCredencial({ id_usuario: alvo.id, nome: alvo.nome });
      return;
    }

    void lerSessao();
    const bd = supabaseNavegador();
    // O token expira; `onAuthStateChange` entrega o renovado e o socket
    // reconecta com ele, porque `token` está nas dependências do efeito.
    const { data } = bd!.auth.onAuthStateChange(() => void lerSessao());
    return () => data.subscription.unsubscribe();
  }, [comAuth, lerSessao]);

  if (verificando) {
    return (
      <main className="carregando">
        <span>Abrindo o escritório…</span>
      </main>
    );
  }

  if (comAuth && !credencial) {
    return <Portaria aoEntrar={() => void lerSessao()} />;
  }

  if (!credencial) return null;

  return (
    <>
      {!comAuth && (
        <div className="faixa-aviso">
          Modo local sem autenticação — a identidade vem de um seletor, não de um login.
          Não exponha este processo à internet.
        </div>
      )}
      <Sala
        credencial={credencial}
        aoSair={
          comAuth
            ? () => {
                void supabaseNavegador()!.auth.signOut();
                setCredencial(null);
              }
            : null
        }
      />
    </>
  );
}
