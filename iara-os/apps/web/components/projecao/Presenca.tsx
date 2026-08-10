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
import { gravarModoDesempenho, lerModoDesempenho, type ModoDesempenho } from './desempenho';

/**
 * O palco só existe no navegador. Três.js toca `window` na importação, então
 * renderizar no servidor quebra o build antes de qualquer coisa aparecer.
 *
 * NOVA PRESENÇA (design aprovado em 10/08/2026): a entidade — pedra encantada
 * de vidro dispersivo com cortinas de aurora — substitui o avatar humanoide.
 * Geometria procedural: sem GLB, sem rig, sem diagnóstico de morph targets.
 * O avatar antigo permanece em `AvatarPresenca.tsx` caso seja preciso voltar.
 */
const EntidadePresenca = dynamic(
  () => import('./EntidadePresenca').then((m) => m.EntidadePresenca),
  { ssr: false },
);

/** Falha de inicialização do WebGL não pode derrubar a página inteira. */
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

/**
 * Seletor de desempenho do palco — vive DENTRO do painel técnico, porque é
 * decisão de máquina, não de conversa. `auto` é o padrão recomendado.
 */
function SeletorDesempenho() {
  const [modo, setModo] = useState<ModoDesempenho>(() => lerModoDesempenho());
  const opcoes: Array<[ModoDesempenho, string]> = [
    ['auto', 'Auto'],
    ['alto', 'Alto'],
    ['equilibrado', 'Equilibrado'],
    ['baixo', 'Baixo'],
  ];
  return (
    <section className="presenca-bloco">
      <h3>Desempenho</h3>
      <div className="seletor-desempenho" role="radiogroup" aria-label="Modo de desempenho">
        {opcoes.map(([valor, rotulo]) => (
          <button
            key={valor}
            className={modo === valor ? 'ativo' : undefined}
            role="radio"
            aria-checked={modo === valor}
            onClick={() => {
              setModo(valor);
              gravarModoDesempenho(valor);
            }}
          >
            {rotulo}
          </button>
        ))}
      </div>
    </section>
  );
}

export function Presenca({
  snapshot,
  falaCorrente,
  voz,
  controles,
}: {
  snapshot: SnapshotCognitivo;
  /** Última fala da IARA — o texto que a boca articula. */
  falaCorrente: Fala | null;
  /** Voz, vinda de cima: ela toca nas duas projeções, não só nesta. */
  voz: EstadoVoz;
  /** Controles da página (troca de projeção, sair). Flutuam sobre o palco. */
  controles?: ReactNode;
}) {
  const [falha, setFalha] = useState<string | null>(null);
  /**
   * PAINEL TÉCNICO OCULTO por padrão (decisão da reestruturação V4): a tela
   * principal é presença e conversa. Capacidades, vitais e telemetria são
   * instrumentação — quem quiser, abre. Quando a IARA trabalha, isso aparece
   * pelo comportamento dela, não por medidores permanentes.
   */
  const [tecnicoAberto, setTecnicoAberto] = useState(false);

  const aoFalhar = useCallback((motivo: string) => setFalha(motivo), []);

  return (
    <section className="presenca">
      <div className="presenca-palco">
        {controles && <div className="presenca-controles">{controles}</div>}

        <button
          className={tecnicoAberto ? 'botao-tecnico aberto' : 'botao-tecnico'}
          onClick={() => setTecnicoAberto((v) => !v)}
          title={tecnicoAberto ? 'Fechar o painel técnico' : 'Abrir o painel técnico'}
          aria-label="Painel técnico"
          aria-expanded={tecnicoAberto}
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden>
            <path
              d="M2 11.5h2.4M7.4 11.5H13M2 7.5h6.4M11.4 7.5H13M2 3.5h1.4M6.4 3.5H13"
              stroke="currentColor"
              strokeWidth="1.2"
              strokeLinecap="round"
            />
            <circle cx="5.9" cy="11.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="9.9" cy="7.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="4.9" cy="3.5" r="1.5" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>

        {falha === null && (
          <LimiteDeFalha aoFalhar={aoFalhar}>
            <EntidadePresenca
              snapshot={snapshot}
              fala={falaCorrente}
              voz={voz.relogio}
            />
          </LimiteDeFalha>
        )}

        {falha !== null && (
          <AvisoModelo
            titulo="A entidade não pôde ser renderizada"
            detalhe={`O WebGL desta máquina recusou o palco — ${falha}`}
          />
        )}
      </div>

      {tecnicoAberto && (
        <PainelCapacidades snapshot={snapshot} extra={<SeletorDesempenho />} />
      )}
    </section>
  );
}
