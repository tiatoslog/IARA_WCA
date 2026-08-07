'use client';

import { useEffect, useState } from 'react';
import { Escritorio } from '../components/Escritorio';
import { PainelConversa } from '../components/PainelConversa';
import { ConsoleTecnico } from '../components/ConsoleTecnico';
import { useIaraSocket } from '../hooks/useIaraSocket';
import { OPERADORES } from '../lib/operadores';

/**
 * Cada operador abre um shard privado no motor. Trocar de operador aqui não dá
 * acesso a nada do outro: o servidor deriva o caminho do shard do id da sessão,
 * e a sondagem cruzada é barrada por arquitetura (roteador) antes de ser
 * barrada por prompt.
 */

function Medidor({ rotulo, valor, cor }: { rotulo: string; valor: number; cor: string }) {
  return (
    <div style={{ minWidth: 118 }}>
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

export default function Pagina() {
  const [operador, setOperador] = useState(OPERADORES[0]);

  // O operador escolhido sobrevive ao recarregamento — a IARA reencontra o
  // shard certo sem perguntar de novo.
  useEffect(() => {
    const salvo = window.localStorage.getItem('iara.operador');
    const achado = OPERADORES.find((o) => o.id === salvo);
    if (achado) setOperador(achado);
  }, []);

  const { estado, falas, logs, conectado, enviar, interromper } = useIaraSocket(
    operador.id,
    operador.nome,
  );

  const trocar = (id: string) => {
    const alvo = OPERADORES.find((o) => o.id === id);
    if (!alvo) return;
    window.localStorage.setItem('iara.operador', alvo.id);
    setOperador(alvo);
  };

  return (
    <main style={{ display: 'flex', height: '100vh', width: '100vw', overflow: 'hidden' }}>
      <section
        style={{
          flex: 1,
          minWidth: 0,
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: 24,
          background:
            'radial-gradient(circle at 50% 30%, #f7f2e8 0%, var(--papel) 62%, #e9e1d3 100%)',
        }}
      >
        {/* HUD: fina, discreta, acima da sala e abaixo do painel. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '10px 18px',
            borderRadius: 12,
            background: 'rgba(251, 248, 242, 0.8)',
            border: '1px solid var(--linha)',
          }}
        >
          <select
            className="botao"
            value={operador.id}
            onChange={(e) => trocar(e.target.value)}
            style={{ padding: '7px 10px' }}
          >
            {OPERADORES.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </select>
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

        <Escritorio estado={estado} />

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
