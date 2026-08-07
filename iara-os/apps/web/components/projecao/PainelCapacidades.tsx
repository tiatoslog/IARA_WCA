'use client';

/**
 * Painel lateral da presença.
 *
 * REGRA DURA: cada barra aqui corresponde a uma faculdade que o Kernel
 * reporta de verdade. Nenhum número é calculado nesta camada — o que chega em
 * `snapshot.capacidades` é envelope de um fato observado (ver `projecao.ts`), e
 * o componente só desenha.
 *
 * São cinco, não sete. O `CapacidadeAtiva` do domínio tem cinco faculdades, e
 * inventar barras de "Planejamento", "Código" e "Conversação" produziria três
 * medidores que nunca sairiam do zero ou, pior, que subiriam por conta própria.
 * Quando o Kernel passar a emitir essas capacidades, elas aparecem aqui sem
 * mudar uma linha deste arquivo — a lista vem de `ROTULO_CAPACIDADE`.
 */

import type { CapacidadeAtiva } from '../../lib/estado';
import { ROTULO_CAPACIDADE, ROTULO_ESTAGIO, type SnapshotCognitivo } from '../../lib/projecao';

function Barra({ rotulo, valor, ativa }: { rotulo: string; valor: number; ativa: boolean }) {
  return (
    <div className="capacidade">
      <div className="capacidade-topo">
        <span className={ativa ? 'capacidade-nome ativa' : 'capacidade-nome'}>{rotulo}</span>
        <span className="capacidade-valor">{Math.round(valor * 100)}</span>
      </div>
      <div className="capacidade-trilho">
        <i style={{ transform: `scaleX(${Math.max(0.001, valor)})` }} />
      </div>
    </div>
  );
}

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="telemetria-item">
      <span>{rotulo}</span>
      <b>{valor}</b>
    </div>
  );
}

export function PainelCapacidades({ snapshot }: { snapshot: SnapshotCognitivo }) {
  const { telemetria } = snapshot;
  const chaves = Object.keys(ROTULO_CAPACIDADE) as CapacidadeAtiva[];

  return (
    <aside className="painel-presenca">
      <header className="presenca-cabecalho">
        <div className="presenca-identidade">
          <span className="presenca-nome">IARA</span>
          <span className={`presenca-estagio e-${snapshot.estagio}`}>
            {ROTULO_ESTAGIO[snapshot.estagio]}
          </span>
        </div>
        <span
          className={telemetria.conectado ? 'presenca-enlace ligado' : 'presenca-enlace'}
          title={telemetria.conectado ? 'barramento aberto' : 'barramento fechado'}
        />
      </header>

      <section className="presenca-bloco">
        <h3>Capacidades</h3>
        {chaves.map((chave) => (
          <Barra
            key={chave}
            rotulo={ROTULO_CAPACIDADE[chave]}
            valor={snapshot.capacidades[chave] ?? 0}
            ativa={snapshot.capacidade === chave}
          />
        ))}
      </section>

      <section className="presenca-bloco">
        <h3>Vitais</h3>
        <Barra rotulo="Energia cognitiva" valor={snapshot.energia} ativa={false} />
        <Barra rotulo="Paciência" valor={snapshot.paciencia} ativa={false} />
        <Barra rotulo="Carga de contexto" valor={snapshot.carga_contextual} ativa={false} />
      </section>

      <section className="presenca-bloco">
        <h3>Último turno</h3>
        <div className="telemetria">
          <Numero
            rotulo="latência"
            valor={telemetria.latencia_ms === null ? '—' : `${telemetria.latencia_ms} ms`}
          />
          <Numero
            rotulo="entrada"
            valor={telemetria.tokens_entrada === null ? '—' : `${telemetria.tokens_entrada} tk`}
          />
          <Numero
            rotulo="saída"
            valor={telemetria.tokens_saida === null ? '—' : `${telemetria.tokens_saida} tk`}
          />
          <Numero
            rotulo="cache"
            valor={telemetria.cache_lido === null ? '—' : `${telemetria.cache_lido} tk`}
          />
        </div>
      </section>

      {snapshot.nuvem_indisponivel && (
        <p className="presenca-aviso">
          Sem chave da Anthropic. A IARA responde em modo local e avisa em vez de improvisar.
        </p>
      )}
    </aside>
  );
}
