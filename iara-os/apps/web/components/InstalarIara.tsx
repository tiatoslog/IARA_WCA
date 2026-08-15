'use client';

/**
 * INSTALAR A IARA — a gaveta que entrega a IARA para o aparelho da pessoa.
 *
 * QUE OBJETO DA SALA É ISTO. É o cartão de visita na saída do escritório: quem
 * gostou da sala leva a IARA consigo — um ícone na tela inicial, sem barra de
 * navegador. Não é uma "página de download": os dois passos que existem são os
 * dois lugares onde a IARA pode passar a existir para a pessoa — no aparelho
 * dela (o app) e nas máquinas onde ela precisa de mãos (o Braço).
 *
 * POR QUE UMA GAVETA, e não um banner: o convite automático do navegador é
 * exatamente o que o `preventDefault` do layout segura. Instalação é um gesto
 * da operadora, dado quando ela quer — nunca um banner que interrompe.
 *
 * O QUE ELA NÃO FAZ: prometer o que a plataforma não cumpre. Cada estado de
 * `classificarInstalacao` vira o texto honesto daquela plataforma — o botão
 * nativo só aparece quando o navegador entregou o convite de verdade. E o
 * passo do Braço não repete a folha de Automação: aponta para ela.
 */

import { useInstalacaoPwa } from '../hooks/useInstalacaoPwa';
import { lerManifestoBraco } from '../lib/execucao';

const MANIFESTO = lerManifestoBraco();

/** O endereço desta instalação, para a instrução "abra no Safari". */
function enderecoDaCasa(): string {
  if (typeof window === 'undefined') return '';
  return window.location.origin.replace(/^https?:\/\//, '');
}

function PassoInstalarApp() {
  const { estado, aguardando, recusou, instalar } = useInstalacaoPwa();

  if (estado === 'instalada') {
    return (
      <p className="instalar-confirmacao">
        <span aria-hidden className="maquina-sinal ligado" /> A IARA já está
        instalada neste aparelho.
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
          {aguardando ? 'Aguardando o navegador…' : 'Instalar a IARA'}
        </button>
        <small>
          O navegador vai confirmar. Depois disso a IARA abre do ícone, em tela
          cheia, como um aplicativo.
        </small>
      </>
    );
  }

  if (estado === 'ios_safari') {
    return (
      <small>
        No iPhone e no iPad quem instala é o Safari: toque em{' '}
        <strong>Compartilhar</strong> (o quadrado com a seta para cima) e depois
        em <strong>Adicionar à Tela de Início</strong>. A IARA vira um ícone e
        abre em tela cheia.
      </small>
    );
  }

  if (estado === 'ios_navegador') {
    return (
      <small>
        Este navegador não instala aplicativos no iPhone — só o Safari faz isso.
        Abra <strong>{enderecoDaCasa()}</strong> no Safari e toque em
        Compartilhar → Adicionar à Tela de Início.
      </small>
    );
  }

  // 'manual' — o navegador não entregou o convite (ou a operadora recusou o
  // diálogo há pouco e ele está em carência).
  return (
    <small>
      {recusou
        ? 'Sem problema — o navegador guarda a recusa por um tempo. Quando quiser instalar: '
        : 'Neste navegador o convite fica na moldura da janela: '}
      procure o ícone de instalação na <strong>barra de endereço</strong> (um
      monitor com uma seta) ou, no menu do navegador, a opção{' '}
      <strong>Instalar IARA OS</strong>.
    </small>
  );
}

export function InstalarIara({
  aoAbrirDispositivos,
  aoFechar,
}: {
  /** O passo 2 não repete o quadro de chaves — leva até ele. */
  aoAbrirDispositivos: () => void;
  aoFechar: () => void;
}) {
  return (
    <section className="ficha" aria-label="Instalar a IARA">
      <header className="ficha-cabecalho">
        <h2>Instalar a IARA</h2>
        <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      </header>

      <ol className="dispositivos-passos">
        <li className="dispositivos-passo">
          <span className="dispositivos-passo-numero">1</span>
          <div className="dispositivos-passo-corpo">
            <p>Leve a IARA neste aparelho</p>
            <PassoInstalarApp />
          </div>
        </li>
        <li className="dispositivos-passo">
          <span className="dispositivos-passo-numero">2</span>
          <div className="dispositivos-passo-corpo">
            <p>Dê mãos a ela nos computadores</p>
            <small>
              O app conversa; quem abre programa e cria pasta é o Braço,
              instalado em cada computador que a IARA deve alcançar.
            </small>
            {MANIFESTO.url ? (
              <a className="ficha-salvar instalar" href={MANIFESTO.url} download>
                Baixar o Braço
              </a>
            ) : (
              <small>
                Ainda não há um instalador publicado nesta instalação. Quem cuida
                do sistema gera o programa com <code>npm run empacotar:braco</code>{' '}
                e publica o endereço dele em{' '}
                <code>NEXT_PUBLIC_IARA_INSTALADOR</code>.
              </small>
            )}
            <button
              type="button"
              className="dispositivos-conectar-novo"
              onClick={aoAbrirDispositivos}
            >
              Conectar um computador →
            </button>
          </div>
        </li>
      </ol>
    </section>
  );
}
