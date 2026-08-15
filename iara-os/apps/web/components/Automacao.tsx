'use client';

/**
 * AUTOMAÇÃO — a folha de manutenção do Braço, separada do quadro de chaves.
 *
 * QUE OBJETO DA SALA É ISTO. `Dispositivos` é o quadro de chaves: quais
 * máquinas atendem agora. Esta tela é a folha pregada ao lado — o programa em
 * si, a versão publicada, o que fazer se ele estiver desatualizado. Uma
 * pessoa que só quer saber "minhas mãos estão vivas?" nunca precisa passar
 * por aqui; uma que precisa reinstalar ou entender o Braço, sim.
 *
 * NÃO REPETE a lista de máquinas — isso já é fato de `Dispositivos`, e o
 * projeto tem uma regra escrita contra o mesmo fato aparecendo em dois
 * lugares (`PainelConversa`: "antes cada fato aparecia em dois ou três
 * lugares e a tela inteira virava eco"). Aqui só o AGREGADO (quantas
 * atendem agora), que é uma pergunta diferente de "quais são".
 */

import { lerManifestoBraco, type MaquinaDoOperador } from '../lib/execucao';

export function Automacao({
  maquinas,
  aoFechar,
}: {
  /** `null` = a lista ainda não chegou. */
  maquinas: MaquinaDoOperador[] | null;
  aoFechar: () => void;
}) {
  const manifesto = lerManifestoBraco();
  const conectadas = (maquinas ?? []).filter((m) => m.conectada).length;

  return (
    <section className="ficha" aria-label="Automação da IARA">
      <header className="ficha-cabecalho">
        <h2>Automação da IARA</h2>
        <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar">
          ✕
        </button>
      </header>

      <p className="ficha-nota">
        O Braço é a automação que dá mãos à IARA num computador: sem ele, ela
        conversa mas não abre programa nem cria pasta em lugar nenhum.
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
        <span>Baixar o Braço</span>
        {manifesto.url ? (
          <>
            <a className="ficha-salvar instalar" href={manifesto.url} download>
              Baixar o programa
            </a>
            {manifesto.notas && <small className="maquina-notas-versao">{manifesto.notas}</small>}
          </>
        ) : (
          <small>
            Ainda não há um instalador publicado nesta instalação. Quem cuida do
            sistema gera o programa com <code>npm run empacotar:braco</code> e
            publica o endereço dele em <code>NEXT_PUBLIC_IARA_INSTALADOR</code>.
          </small>
        )}
      </div>

      <p className="ficha-nota">
        Uma máquina desatualizada avisa sozinha, na sua própria linha do quadro
        de dispositivos — não é preciso conferir versão aqui uma a uma.
      </p>
    </section>
  );
}
