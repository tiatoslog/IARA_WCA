'use client';

/**
 * ESTE APARELHO — a linha do próprio aparelho no quadro de dispositivos.
 *
 * Nasceu como a gaveta "Instalar a IARA" (15/08/2026) e foi RECOLHIDA para
 * dentro de Dispositivos no mesmo dia, a pedido da operadora: três entradas de
 * menu (Dispositivos, Automação, Instalar) tratavam do mesmo assunto. O
 * aparelho em que a pessoa está TAMBÉM é um dispositivo — a linha dele mora no
 * quadro, acima dos computadores.
 *
 * O que ela oferece é o estado honesto da instalação do PWA, decidido por
 * `classificarInstalacao` (lib pura): botão nativo quando o navegador entregou
 * o convite, a instrução do Safari no iPhone, o caminho do menu no resto —
 * nunca um botão morto, nunca reoferecer dentro do app instalado.
 */

import { useInstalacaoPwa } from '../hooks/useInstalacaoPwa';

/** O endereço desta instalação, para a instrução "abra no Safari". */
function enderecoDaCasa(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin.replace(/^https?:\/\//, '');
}

export function EsteAparelho() {
  const { estado, aguardando, recusou, instalar } = useInstalacaoPwa();

  if (estado === 'instalada') {
    return (
      <p className="instalar-confirmacao">
        {/* Marca de conclusão, não ponto de enlace: instalar o PWA neste
            aparelho não diz nada sobre haver um braço atendendo agora, e o
            ponto verde é reservado para isso em todo o resto do produto. */}
        <span aria-hidden className="marca-feito">
          ✓
        </span>{' '}
        A IARA está instalada neste aparelho.
      </p>
    );
  }

  if (estado === 'pronta') {
    return (
      <>
        <button
          type="button"
          className="ficha-salvar instalar"
          disabled={aguardando}
          onClick={instalar}
        >
          {aguardando ? 'Aguardando o navegador…' : 'Instalar a IARA neste aparelho'}
        </button>
        <small>
          O navegador confirma e a IARA passa a abrir do ícone, em tela cheia.
        </small>
      </>
    );
  }

  if (estado === 'ios_safari') {
    return (
      <small>
        Para instalar a IARA neste iPhone/iPad: toque em{' '}
        <strong>Compartilhar</strong> (o quadrado com a seta) e depois em{' '}
        <strong>Adicionar à Tela de Início</strong>.
      </small>
    );
  }

  if (estado === 'ios_navegador') {
    return (
      <small>
        Este navegador não instala aplicativos no iPhone — só o Safari. Abra{' '}
        <strong>{enderecoDaCasa()}</strong> no Safari e toque em Compartilhar →
        Adicionar à Tela de Início.
      </small>
    );
  }

  // 'manual' — sem convite do navegador (ou recusado há pouco).
  return (
    <small>
      {recusou
        ? 'O navegador guarda a recusa por um tempo. Quando quiser instalar: '
        : 'Para instalar a IARA neste computador: '}
      procure o ícone de instalação na <strong>barra de endereço</strong> (um
      monitor com uma seta) ou, no menu do navegador,{' '}
      <strong>Instalar IARA OS</strong>.
    </small>
  );
}
