'use client';

/**
 * A ficha do operador — onde a IARA fica sabendo com quem está falando.
 *
 * QUE OBJETO DA SALA É ISTO. É a ficha que o mordomo mantém sobre quem
 * frequenta a casa: como a pessoa gosta de ser chamada, o que ela faz, o que
 * ela já pediu que fosse levado em conta. Não é "configurações do usuário" —
 * é o caderno dele, e por isso o texto da tela fala na voz dela ("Como devo
 * chamar você?"), não na voz de um formulário ("Nome de exibição").
 *
 * Fica numa gaveta, não na mesa: abre pelo nome do operador no cabeçalho da
 * conversa e cobre o painel de trabalho enquanto está aberta. Não flutua sobre
 * o palco — a hierarquia espacial é fixa, e a ficha é conteúdo do painel, a
 * camada mais externa.
 *
 * O QUE ELA NÃO FAZ: não deduz nada. Nenhum campo aqui é pré-preenchido a
 * partir de outro. Tratamento nasce em "só o nome" e só sai dali por escolha
 * — ver `lib/perfil.ts` para o motivo.
 */

import { useEffect, useRef, useState } from 'react';
import {
  LIMITES_PREFERENCIAS,
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  ROTULO_TRATAMENTO,
  type PreferenciasOperador,
  type TratamentoOperador,
} from '../lib/perfil';

const TRATAMENTOS: TratamentoOperador[] = ['nome', 'senhora', 'senhor'];

export function FichaOperador({
  nomeCredencial,
  preferencias,
  conectado,
  aoSalvar,
  erroSalvar = null,
  aoFechar,
}: {
  /** Nome que veio da credencial. É o padrão de "como chamar", nunca um palpite. */
  nomeCredencial: string;
  /** O que está gravado AGORA, vindo do snapshot. */
  preferencias: PreferenciasOperador;
  conectado: boolean;
  /** `false` quando o barramento estava fechado e o pacote não saiu. */
  aoSalvar: (p: PreferenciasOperador) => boolean;
  /** Falha vinda do servidor DEPOIS do clique — ver `Porta.ts`. `null` fora
   *  desse caminho. */
  erroSalvar?: { instante: number; texto: string } | null;
  aoFechar: () => void;
}) {
  const [rascunho, setRascunho] = useState<PreferenciasOperador>(preferencias);
  const [estado, setEstado] = useState<'limpo' | 'sujo' | 'salvo' | 'falhou'>('limpo');
  const [mensagemFalha, setMensagemFalha] = useState<string | null>(null);

  /**
   * Rehidrata quando o servidor confirma. A dependência é o CONTEÚDO
   * serializado, não o objeto: o snapshot chega novo a cada atualização de
   * estado (~20x/s durante um turno) e um `[preferencias]` cru descartaria o
   * que a pessoa está digitando a cada pacote. Com o conteúdo, o efeito só
   * dispara quando a ficha realmente mudou.
   */
  const gravadas = JSON.stringify(preferencias);
  useEffect(() => {
    setRascunho(JSON.parse(gravadas) as PreferenciasOperador);
    setEstado((e) => (e === 'sujo' ? 'salvo' : e));
  }, [gravadas]);

  /**
   * O clique dizia "saiu" (o pacote foi para o socket), nunca "gravou" — a
   * confirmação real é o `useEffect` acima, quando `preferencias` muda. Uma
   * gravação que falha DEPOIS do clique (Supabase fora do ar, por exemplo)
   * nunca disparava aquele efeito, então a ficha ficava com `estado==='sujo'`
   * para sempre: nem "Guardado", nem aviso nenhum — silêncio indistinguível
   * de "nunca gravou". `erroSalvar` fecha esse buraco.
   *
   * Só reage se AINDA estivermos esperando a confirmação desta tentativa
   * (`estado==='sujo'`) e se o erro é recente — sem a janela de 10s, reabrir a
   * ficha bem depois de uma falha antiga reexibiria um erro que já não é
   * desta sessão de edição.
   */
  const ultimoErroTratado = useRef(0);
  useEffect(() => {
    if (!erroSalvar || erroSalvar.instante <= ultimoErroTratado.current) return;
    ultimoErroTratado.current = erroSalvar.instante;
    if (estado !== 'sujo' || Date.now() - erroSalvar.instante > 10_000) return;
    setEstado('falhou');
    setMensagemFalha(erroSalvar.texto);
  }, [erroSalvar, estado]);

  const alterar = <C extends keyof PreferenciasOperador>(
    campo: C,
    valor: PreferenciasOperador[C],
  ) => {
    setRascunho((r) => ({ ...r, [campo]: valor }));
    setEstado('sujo');
  };

  const salvar = () => {
    // Sanea com a MESMA função do servidor antes de enviar: o que a tela mostra
    // salvo é o que o outro lado vai gravar, sem divergência silenciosa.
    const limpo = normalizarPreferencias(rascunho);
    setRascunho(limpo);
    // Toda NOVA tentativa apaga o eco da falha anterior — senão um clique
    // que falha na hora (socket fechado) mostraria a mensagem de um erro de
    // servidor de uma tentativa anterior, que não é o que está acontecendo agora.
    setMensagemFalha(null);
    setEstado(aoSalvar(limpo) ? 'sujo' : 'falhou');
  };

  const nomeEmUso = rascunho.como_chamar.trim() || nomeCredencial;

  return (
    <section className="ficha" aria-label="Ficha do operador">
      <header className="ficha-cabecalho">
        <h2>Como você quer ser atendido</h2>
        <button className="ficha-fechar" onClick={aoFechar} aria-label="Fechar a ficha">
          ✕
        </button>
      </header>

      <p className="ficha-nota">
        A IARA não adivinha nada disto. O que estiver em branco aqui ela
        simplesmente não usa.
      </p>

      <label className="ficha-campo">
        <span>Como devo chamar você?</span>
        <input
          type="text"
          value={rascunho.como_chamar}
          maxLength={LIMITES_PREFERENCIAS.curto}
          placeholder={nomeCredencial || 'seu nome'}
          onChange={(e) => alterar('como_chamar', e.target.value)}
        />
      </label>

      <fieldset className="ficha-campo">
        <legend>Forma de tratamento</legend>
        <div className="ficha-opcoes" role="radiogroup">
          {TRATAMENTOS.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={rascunho.tratamento === t}
              className={rascunho.tratamento === t ? 'ativo' : undefined}
              onClick={() => alterar('tratamento', t)}
            >
              {ROTULO_TRATAMENTO[t]}
            </button>
          ))}
        </div>
        <small>
          {rascunho.tratamento === 'nome'
            ? `Ela vai dizer “${nomeEmUso}” e nada além disso — sem “senhor”, sem “senhora”.`
            : `Ela vai tratar você por “${ROTULO_TRATAMENTO[rascunho.tratamento].toLowerCase()}”, sem repetir a cada frase.`}
        </small>
      </fieldset>

      <label className="ficha-campo">
        <span>Sua função na empresa</span>
        <input
          type="text"
          value={rascunho.funcao}
          maxLength={LIMITES_PREFERENCIAS.curto}
          placeholder="opcional — ex.: TI, financeiro, operação"
          onChange={(e) => alterar('funcao', e.target.value)}
        />
      </label>

      <label className="ficha-campo">
        <span>O que ela deve levar em conta</span>
        <textarea
          rows={5}
          value={rascunho.observacoes}
          maxLength={LIMITES_PREFERENCIAS.longo}
          placeholder={
            'Escreva do seu jeito. Ex.: "vá direto ao ponto", "sempre me diga o custo\nantes de rodar", "não use termo em inglês quando existir em português".'
          }
          onChange={(e) => alterar('observacoes', e.target.value)}
        />
        <small className="ficha-contador">
          {rascunho.observacoes.length}/{LIMITES_PREFERENCIAS.longo}
        </small>
      </label>

      <div className="ficha-acoes">
        <button
          className={estado === 'salvo' ? 'ficha-salvar salvo' : 'ficha-salvar'}
          onClick={salvar}
          disabled={!conectado || estado === 'limpo' || estado === 'salvo'}
        >
          Salvar
        </button>
        <span
          className={estado === 'falhou' ? 'ficha-estado falhou' : 'ficha-estado'}
          role="status"
        >
          {estado === 'salvo' && 'Guardado. Ela já sabe.'}
          {estado === 'falhou' && (mensagemFalha || 'Não saiu — o barramento está fechado.')}
          {estado === 'limpo' && !conectado && 'Sem enlace com o motor.'}
        </span>
      </div>
    </section>
  );
}

/** Ficha nunca aberta ainda: o `null` do snapshot vira a ficha em branco. */
export function fichaDoSnapshot(
  preferencias: PreferenciasOperador | undefined,
): PreferenciasOperador {
  return preferencias ? normalizarPreferencias(preferencias) : { ...PREFERENCIAS_PADRAO };
}
