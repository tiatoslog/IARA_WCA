'use client';

/**
 * A projeção "presença": a IARA como interlocutora enquadrada, no lugar da sala.
 *
 * Esta é a SEGUNDA projeção do mesmo `SnapshotCognitivo` — a primeira é o
 * escritório em pixel art. As duas leem o mesmo objeto e nenhuma delas conhece
 * o Kernel. Trocar de projeção não muda uma linha do servidor, que é o ponto
 * inteiro de existir um contrato no meio.
 *
 * O QUE ACONTECE QUANDO O MODELO NÃO SERVE. O sistema já tem uma regra para
 * isso, e ela vale aqui: sem chave da Anthropic, a IARA avisa em vez de
 * improvisar resposta. Sem rig facial, ela avisa em vez de improvisar rosto.
 * Um rosto parado em cima de um sistema que está trabalhando afirma que nada
 * está acontecendo — é pior do que não ter rosto.
 */

import dynamic from 'next/dynamic';
import { Component, useCallback, useState, type ReactNode } from 'react';
import type { SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { EstadoVoz } from '../../hooks/useVoz';
import { PainelCapacidades } from './PainelCapacidades';
import type { DiagnosticoRig } from './AvatarPresenca';

/**
 * O palco só existe no navegador. Três.js toca `window` na importação, então
 * renderizar no servidor quebra o build antes de qualquer coisa aparecer.
 */
const PalcoPresenca = dynamic(() => import('./PalcoPresenca').then((m) => m.PalcoPresenca), {
  ssr: false,
});
const AvatarPresenca = dynamic(() => import('./AvatarPresenca').then((m) => m.AvatarPresenca), {
  ssr: false,
});

/** Falha de carga do GLB não pode derrubar a página inteira. */
class LimiteDeFalha extends Component<
  { aoFalhar: (motivo: string) => void; children: ReactNode },
  { caiu: boolean }
> {
  state = { caiu: false };

  static getDerivedStateFromError() {
    return { caiu: true };
  }

  componentDidCatch(erro: Error) {
    this.props.aoFalhar(erro.message);
  }

  render() {
    return this.state.caiu ? null : this.props.children;
  }
}

function AvisoModelo({ titulo, detalhe }: { titulo: string; detalhe: string }) {
  return (
    <div className="presenca-vazio">
      <div className="presenca-vazio-marca" aria-hidden />
      <h2>{titulo}</h2>
      <p>{detalhe}</p>
    </div>
  );
}

export function Presenca({
  snapshot,
  falaCorrente,
  voz,
  conectado,
  controles,
}: {
  snapshot: SnapshotCognitivo;
  /** Última fala da IARA — o texto que a boca articula. */
  falaCorrente: Fala | null;
  /** Voz, vinda de cima: ela toca nas duas projeções, não só nesta. */
  voz: EstadoVoz;
  conectado: boolean;
  /** Controles da página (troca de projeção, sair). Flutuam sobre o palco. */
  controles?: ReactNode;
}) {
  const [diagnostico, setDiagnostico] = useState<DiagnosticoRig | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  // Estável: se fosse recriada a cada render, o `useEffect` do avatar
  // redispararia o diagnóstico a cada snapshot recebido.
  const aoDiagnosticar = useCallback((d: DiagnosticoRig) => setDiagnostico(d), []);
  const aoFalhar = useCallback((motivo: string) => setFalha(motivo), []);

  const rigInsuficiente = diagnostico !== null && !diagnostico.suficiente;

  return (
    <section className="presenca">
      <div className="presenca-palco">
        {controles && <div className="presenca-controles">{controles}</div>}

        {falha === null && (
          <LimiteDeFalha aoFalhar={aoFalhar}>
            <PalcoPresenca>
              <AvatarPresenca
                snapshot={snapshot}
                fala={falaCorrente}
                voz={voz.relogio}
                aoDiagnosticar={aoDiagnosticar}
              />
            </PalcoPresenca>
          </LimiteDeFalha>
        )}

        {falha !== null && (
          <AvisoModelo
            titulo="Modelo não carregou"
            detalhe={`Falha ao abrir /identidade_iara/source.glb — ${falha}`}
          />
        )}

        {falha === null && rigInsuficiente && (
          <AvisoModelo
            titulo="Sem rig facial"
            detalhe={
              `O modelo carregou (${diagnostico!.morphs} morph targets, ` +
              `${diagnostico!.parametros_resolvidos} parâmetros resolvidos), mas não tem os ` +
              'blendshapes de mandíbula, pálpebra e olhar. A IARA não vai fingir uma ' +
              'expressão que o modelo não sabe fazer. Ver EXPORTACAO.md.'
            }
          />
        )}
      </div>

      <PainelCapacidades snapshot={snapshot} conectado={conectado} />
    </section>
  );
}
