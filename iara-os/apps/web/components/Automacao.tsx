'use client';

/**
 * AUTOMAÇÃO — o programa que dá mãos à IARA, e só ele.
 * ("Braço" é o nome interno do executor; para a operadora, chama-se Automação.)
 *
 * QUE OBJETO DA SALA É ISTO. `Dispositivos` é o quadro de chaves: quais
 * máquinas atendem, parear uma nova, desconectar. Esta folha é sobre o
 * PROGRAMA: baixar uma vez, ver a versão, atualizar quando houver novidade —
 * o desenho fechado com a operadora em 15/08/2026, depois de um dia em que
 * três gavetas falavam do mesmo assunto.
 *
 * ESTE é o único botão de baixar do produto. O assistente de pareamento e o
 * quadro apontam para cá em vez de duplicá-lo: dois botões de baixar em telas
 * diferentes era duas chances de divergirem.
 */

import {
  frasearVersaoInstalada,
  lerManifestoBraco,
  type MaquinaDoOperador,
} from '../lib/execucao';

export function Automacao({
  maquinas,
  podeAgir,
  aoAtualizar,
  aoFechar,
}: {
  /** `null` = a lista ainda não chegou. */
  maquinas: MaquinaDoOperador[] | null;
  podeAgir: boolean;
  /** A mesma ordem de atualização da linha do quadro — ver `Dispositivos`. */
  aoAtualizar: (id: string) => void;
  aoFechar: () => void;
}) {
  const manifesto = lerManifestoBraco();
  const lista = maquinas ?? [];
  const conectadas = lista.filter((m) => m.conectada).length;
  /** Só as que dá para atualizar AGORA: desatualizadas, conectadas e sem uma
   *  atualização já em andamento. As desconectadas avisam na própria linha do
   *  quadro quando voltarem. */
  const atualizaveis = lista.filter(
    (m) => m.desatualizada && m.conectada && m.atualizando === null,
  );

  return (
    <section className="ficha" aria-label="Automação da IARA">
      <header className="ficha-cabecalho">
        <h2>Automação da IARA</h2>
        <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      </header>

      <p className="ficha-nota">
        A Automação é o que dá mãos à IARA num computador: sem ela, a IARA
        conversa mas não abre programa nem cria pasta em lugar nenhum. Instala-se
        uma vez em cada computador.
      </p>

      <div className="ficha-campo">
        <span>Status</span>
        <p className={conectadas > 0 ? 'automacao-status ativo' : 'automacao-status'}>
          <span aria-hidden className={conectadas > 0 ? 'maquina-sinal ligado' : 'maquina-sinal'} />
          {maquinas === null
            ? 'Perguntando…'
            : conectadas === 0
              ? 'Nenhum computador conectado agora'
              : conectadas === 1
                ? '1 computador conectado agora'
                : `${conectadas} computadores conectados agora`}
        </p>
      </div>

      {/*
        UM CONTROLE, TRÊS ESTADOS (15/08/2026, a pedido da operadora): "Baixar a
        Automação" ficava para sempre no mesmo lugar, dizendo a mesma coisa,
        mesmo depois de instalada — e um botão que não sabe o que já aconteceu
        faz a pessoa duvidar se o passo funcionou. O botão agora é consequência
        do fato observado (existe máquina pareada? alguma está desatualizada?),
        que é a mesma regra de todo o resto desta interface.

        O download NÃO some quando já há uma instalada: instalar no PRÓXIMO
        computador continua exigindo o arquivo. Ele deixa de ser o gesto
        principal e vira o secundário, que é o seu lugar depois da primeira vez.
      */}
      <div className="ficha-campo">
        <span>O programa</span>
        {!manifesto.url ? (
          <small>
            Ainda não há um instalador publicado nesta instalação. Quem cuida do
            sistema gera o programa com <code>npm run empacotar:braco</code> e
            publica o endereço dele em <code>NEXT_PUBLIC_IARA_INSTALADOR</code>.
          </small>
        ) : maquinas === null ? (
          <small>Perguntando…</small>
        ) : atualizaveis.length > 0 ? (
          <>
            {manifesto.notas && (
              <small className="maquina-notas-versao">Novidade: {manifesto.notas}</small>
            )}
            {atualizaveis.map((m) => (
              <button
                key={m.id}
                className="ficha-salvar instalar"
                disabled={!podeAgir}
                title="Baixa, confere e substitui sozinha — o computador reabre a IARA na versão nova"
                onClick={() => aoAtualizar(m.id)}
              >
                Atualizar em {m.nome}
              </button>
            ))}
          </>
        ) : lista.length > 0 ? (
          <>
            {/*
              A MARCA É DE CONCLUSÃO, NÃO DE ENLACE — corrigido em 20/08/2026,
              depois de a operadora ver as duas frases juntas na mesma folha:

                  Status      ○ Nenhum computador conectado agora
                  O programa  ● Instalada em Homeoffice — na versão atual

              A máquina estava desligada desde 16 de agosto e o ponto verde
              estava escrito à mão, sem estado nenhum atrás. "Instalada" é fato
              do passado; "conectada" é fato de agora. O produto inteiro usa o
              ponto verde para o segundo, então usá-lo para o primeiro fazia a
              folha se contradizer três linhas depois do próprio Status.
            */}
            <p className="instalar-confirmacao">
              <span aria-hidden className="marca-feito">
                ✓
              </span>{' '}
              Instalada
              {lista.length === 1
                ? ` em ${lista[0].nome}`
                : ` em ${lista.length} computadores`}
              {/* A frase mora em `frasearVersaoInstalada`, pura e testada. Aqui
                  havia `every(m => !m.desatualizada) && ' — na versão atual'`,
                  que afirmava estar em dia uma máquina cuja versão ninguém
                  tinha lido — ver o cabeçalho daquela função. */}
              {frasearVersaoInstalada(lista)}
            </p>
            <a className="automacao-baixar-de-novo" href={manifesto.url} download>
              Baixar de novo, para outro computador
            </a>
          </>
        ) : (
          <>
            <a className="ficha-salvar instalar" href={manifesto.url} download>
              Baixar a Automação
            </a>
            {/* O aviso azul do Windows NÃO pode ser surpresa — a decisão de não
                assinar o executável (e o porquê) está no cabeçalho de
                `scripts/empacotar-braco.ts`; a instrução mora aqui, onde a
                pessoa baixa. */}
            <small>
              O Windows mostra um aviso azul na primeira abertura (o programa
              ainda não tem assinatura de empresa): clique em{' '}
              <strong>Mais informações</strong> →{' '}
              <strong>Executar assim mesmo</strong>. Só na primeira vez.
            </small>
          </>
        )}
      </div>
    </section>
  );
}
