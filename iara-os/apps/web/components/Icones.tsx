/**
 * Ícones da interface — SVG inline, traço 1.8, cantos redondos.
 *
 * Por que não emoji: emoji renderiza com a fonte do sistema — colorido, com
 * tamanho e estilo fora do nosso controle, diferente em cada máquina. Ícone de
 * traço herda `currentColor` e pesa o mesmo que o texto ao lado, que é o que
 * separa interface profissional de protótipo.
 *
 * Por que não uma biblioteca: são seis desenhos. Uma dependência inteira para
 * isso é custo de manutenção sem retorno — e o estilo (traço fino, geometria
 * calma) segue o mesmo sistema visual do resto da IARA.
 */

interface Props {
  /** Lado do quadrado, em px. O padrão casa com texto de botão. */
  tamanho?: number;
}

function Base({ tamanho = 15, children }: Props & { children: React.ReactNode }) {
  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      style={{ flex: 'none', verticalAlign: '-2px' }}
    >
      {children}
    </svg>
  );
}

/** Microfone — abrir o modo ligação. */
export function IconeMicrofone(p: Props) {
  return (
    <Base {...p}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </Base>
  );
}

/** Encerrar a ligação — quadrado de parada. */
export function IconeEncerrar(p: Props) {
  return (
    <Base {...p}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
    </Base>
  );
}

/** Vigília do chamado "ei IARA" — ondas de escuta. */
export function IconeVigilia(p: Props) {
  return (
    <Base {...p}>
      <path d="M4 12v0" />
      <path d="M8 9v6" />
      <path d="M12 6v12" />
      <path d="M16 9v6" />
      <path d="M20 12v0" />
    </Base>
  );
}

/** Voz ligada. */
export function IconeVoz(p: Props) {
  return (
    <Base {...p}>
      <path d="M11 5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 19z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
      <path d="M18.5 6a9 9 0 0 1 0 12" />
    </Base>
  );
}

/** Voz silenciada. */
export function IconeMudo(p: Props) {
  return (
    <Base {...p}>
      <path d="M11 5 6.5 9H4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h2.5L11 19z" />
      <path d="M16 9.5 21 14.5" />
      <path d="M21 9.5 16 14.5" />
    </Base>
  );
}

/** Enviar mensagem. */
export function IconeEnviar(p: Props) {
  return (
    <Base {...p}>
      <path d="M5 12h13" />
      <path d="m13 6 6 6-6 6" />
    </Base>
  );
}

/**
 * As mãos da IARA — o rack de computadores ligados a ela.
 *
 * Duas placas empilhadas com um LED cada, e não um monitor: a pergunta que o
 * ícone responde é "quantas máquinas atendem?", não "onde está minha tela". Um
 * monitor sugeriria a tela em que a pessoa já está olhando.
 */
export function IconeMaos(p: Props) {
  return (
    <Base {...p}>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5v0" />
      <path d="M7 16.5v0" />
    </Base>
  );
}

/** Interromper o turno — mão aberta estilizada em barra. */
export function IconeInterromper(p: Props) {
  return (
    <Base {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12h7" />
    </Base>
  );
}
