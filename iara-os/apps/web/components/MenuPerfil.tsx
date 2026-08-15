'use client';

/**
 * O MENU DA PORTA DA FICHA — não uma engrenagem.
 *
 * `PainelConversa` já decidiu (ver comentário lá) que o nome de quem está na
 * sala é a porta, nunca um ícone de configurações genérico. Este menu não
 * muda essa decisão — só dá à porta mais de um destino: antes o clique no
 * nome levava direto à Ficha, e "Dispositivos"/"Automação" só existiam no
 * ícone das mãos. Agora o nome abre um menu pequeno, ancorado onde a pessoa
 * clicou, com os três — e o Sair, pela mesma razão que os outros: a pessoa
 * já está com a mão ali.
 */

export function MenuPerfil({
  aoAbrirPerfil,
  aoAbrirDispositivos,
  aoAbrirAutomacao,
  aoSair,
}: {
  aoAbrirPerfil: () => void;
  aoAbrirDispositivos: () => void;
  aoAbrirAutomacao: () => void;
  /** `null` no seletor local (sem credencial real para encerrar sessão). */
  aoSair: (() => void) | null;
}) {
  return (
    <div className="menu-perfil" role="menu">
      <button type="button" role="menuitem" className="menu-perfil-item" onClick={aoAbrirPerfil}>
        Meu perfil
      </button>
      <button type="button" role="menuitem" className="menu-perfil-item" onClick={aoAbrirDispositivos}>
        Dispositivos
      </button>
      <button type="button" role="menuitem" className="menu-perfil-item" onClick={aoAbrirAutomacao}>
        Automação
      </button>
      {aoSair && (
        <>
          <hr className="menu-perfil-separador" />
          <button type="button" role="menuitem" className="menu-perfil-item sair" onClick={aoSair}>
            Sair
          </button>
        </>
      )}
    </div>
  );
}
