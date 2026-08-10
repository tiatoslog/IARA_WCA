'use client';

/**
 * Painel lateral da presença.
 *
 * REGRA DURA: nenhum número é calculado nesta camada. `capacidades` já chega
 * como `EspacoCognitivo` — um float por faculdade, aceso por evento do Kernel e
 * esfriado por ele. O componente desenha e mais nada.
 *
 * São cinco barras, não sete. `CapacidadeAtiva` tem cinco faculdades; inventar
 * "Planejamento", "Código" e "Conversação" produziria medidores que nunca sairiam
 * do zero — ou, pior, que subiriam por conta própria. Quando o Kernel passar a
 * emitir essas capacidades, elas aparecem aqui sem que este arquivo mude: a
 * lista vem de `ROTULO_CAPACIDADE`.
 *
 * O plano está aqui porque planejar é a coisa mais real que o Kernel sabe de si:
 * `snapshot.plano` vem do `MemoriaTrabalho`, com o estado verdadeiro de cada
 * passo. É o que transforma "ela está pensando" em "ela está no passo 2 de 4".
 */

import type { ReactNode } from 'react';
import type { CapacidadeAtiva } from '../../lib/estado';
import type { SnapshotCognitivo } from '../../lib/snapshot';

export const ROTULO_CAPACIDADE: Record<CapacidadeAtiva, string> = {
  raciocinio: 'Raciocínio',
  conhecimento: 'Conhecimento',
  memoria: 'Memória',
  automacao: 'Automação',
  percepcao: 'Percepção',
};

function Barra({ rotulo, valor }: { rotulo: string; valor: number }) {
  // Acima de 0.03 o Kernel considera a capacidade acesa (ver `projetarLuzes`).
  const acesa = valor > 0.03;
  return (
    <div className="capacidade">
      <div className="capacidade-topo">
        <span className={acesa ? 'capacidade-nome acesa' : 'capacidade-nome'}>{rotulo}</span>
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

/**
 * Identidade, estágio, conexão e aviso de nuvem NÃO moram aqui: moram no
 * cabeçalho da conversa, uma vez. Este painel é o HUD de instrumentos — o
 * que ele mostra, nenhum outro painel repete (decisão de 08/08/2026).
 *
 * Desde a V4 ele é OCULTO por padrão: instrumentação se abre quando se quer
 * inspecionar, não mora permanentemente na tela principal.
 */
export function PainelCapacidades({
  snapshot,
  extra,
}: {
  snapshot: SnapshotCognitivo;
  /** Blocos extras do painel técnico (ex.: seletor de desempenho). */
  extra?: ReactNode;
}) {
  const { telemetria, metricas, plano } = snapshot;
  const chaves = Object.keys(ROTULO_CAPACIDADE) as CapacidadeAtiva[];

  return (
    <aside className="painel-presenca rolagem">
      <section className="presenca-bloco">
        <h3>Capacidades</h3>
        {chaves.map((chave) => (
          <Barra key={chave} rotulo={ROTULO_CAPACIDADE[chave]} valor={snapshot.capacidades[chave]} />
        ))}
      </section>

      {plano && (
        <section className="presenca-bloco">
          <h3>
            Plano
            <em className={plano.origem === 'emergente' ? 'selo emergente' : 'selo'}>
              {plano.origem === 'emergente' ? 'emergente' : 'determinístico'}
            </em>
          </h3>
          <p className="presenca-objetivo">{plano.objetivo}</p>
          <ol className="plano">
            {plano.passos.map((passo) => (
              <li key={passo.indice} className={`passo ${passo.estado}`}>
                {passo.descricao}
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="presenca-bloco">
        <h3>Vitais</h3>
        <Barra rotulo="Energia cognitiva" valor={metricas.energia_cognitiva} />
        <Barra rotulo="Paciência" valor={metricas.paciencia_operacional} />
        <Barra rotulo="Carga de contexto" valor={metricas.carga_contextual} />
      </section>

      <section className="presenca-bloco">
        <h3>Último turno</h3>
        <div className="telemetria">
          <Numero rotulo="rota" valor={telemetria.rota ?? '—'} />
          <Numero
            rotulo="latência"
            valor={telemetria.latencia_ms === null ? '—' : `${telemetria.latencia_ms} ms`}
          />
          <Numero rotulo="entrada" valor={`${telemetria.tokens_entrada} tk`} />
          <Numero rotulo="saída" valor={`${telemetria.tokens_saida} tk`} />
          <Numero rotulo="cache" valor={`${telemetria.cache_lido} tk`} />
          <Numero rotulo="eventos" valor={`${telemetria.eventos_no_traco}`} />
        </div>
        {telemetria.descartados > 0 && (
          <p className="presenca-nota">
            {telemetria.descartados} pacote(s) descartado(s) por pressão de fila.
          </p>
        )}
      </section>

      {snapshot.operador && (
        <section className="presenca-bloco">
          <h3>Sessão</h3>
          <div className="telemetria">
            <Numero rotulo="operador" valor={snapshot.operador.nome} />
            <Numero rotulo="leitura" valor={snapshot.leitura.estado} />
          </div>
        </section>
      )}

      {extra}
    </aside>
  );
}
