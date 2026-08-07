'use client';

import { useCallback, useEffect, useState } from 'react';
import { Escritorio } from '../components/Escritorio';
import { PainelConversa } from '../components/PainelConversa';
import { ConsoleTecnico } from '../components/ConsoleTecnico';
import { Portaria } from '../components/Portaria';
import { useIaraSocket, type Credencial } from '../hooks/useIaraSocket';
import { OPERADORES } from '../lib/operadores';
import { autenticacaoDisponivel, supabaseNavegador } from '../lib/supabaseNavegador';

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

/** O escritório em si. Só monta quando já existe uma credencial resolvida. */
function Sala({ credencial, aoSair }: { credencial: Credencial; aoSair: (() => void) | null }) {
  const { estado, falas, logs, conectado, enviar, interromper } = useIaraSocket(credencial);

  return (
    <main className="tela">
      <section className="ambiente-sala">
        <div className="hud">
          {aoSair ? (
            <button className="botao" onClick={aoSair}>
              Sair
            </button>
          ) : (
            <SeletorLocal />
          )}
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

      <PainelConversa
        estado={estado}
        falas={falas}
        conectado={conectado}
        onEnviar={enviar}
        onInterromper={interromper}
      />
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
