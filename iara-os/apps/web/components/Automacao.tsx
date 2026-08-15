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

import { lerManifestoBraco, type MaquinaDoOperador } from '../lib/execucao';

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

      <div className="ficha-campo">
        <span>Baixar a Automação</span>
        {manifesto.url ? (
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
        ) : (
          <small>
            Ainda não há um instalador publicado nesta instalação. Quem cuida do
            sistema gera o programa com <code>npm run empacotar:braco</code> e
            publica o endereço dele em <code>NEXT_PUBLIC_IARA_INSTALADOR</code>.
          </small>
        )}
      </div>

      <div className="ficha-campo">
        <span>Versão</span>
        {maquinas === null ? (
          <small>Perguntando…</small>
        ) : lista.length === 0 ? (
          <small>Nenhum computador pareado ainda — a versão aparece aqui depois.</small>
        ) : atualizaveis.length === 0 && lista.every((m) => !m.desatualizada) ? (
          <p className="automacao-status ativo">
            <span aria-hidden className="maquina-sinal ligado" />
            Todos os computadores estão na versão atual.
          </p>
        ) : (
          <>
            {manifesto.notas && (
              <small className="maquina-notas-versao">Novidade: {manifesto.notas}</small>
            )}
            {atualizaveis.map((m) => (
              <button
                key={m.id}
                className="ficha-salvar"
                disabled={!podeAgir}
                title="Baixa, confere e substitui sozinha — o computador reabre a IARA na versão nova"
                onClick={() => aoAtualizar(m.id)}
              >
                Atualizar aplicativo em {m.nome}
              </button>
            ))}
            {atualizaveis.length === 0 && (
              <small>
                Há computador desatualizado, mas desligado agora — quando ligar,
                a linha dele no quadro de Dispositivos oferece a atualização.
              </small>
            )}
          </>
        )}
      </div>
    </section>
  );
}
