'use client';

/**
 * A portaria. Ninguém entra no escritório sem se identificar.
 *
 * Não é uma tela de login genérica: é a porta da sala. A pergunta continua
 * sendo "que objeto isto é?" — é a superfície de metal da entrada, com a marca
 * gravada nela, e uma placa de vidro no meio onde se escreve o nome.
 *
 * O fundo é o campo de cromo da marca (`lib/marca.ts`), desfocado. Desfocado
 * de propósito: um fundo em foco competiria com o card, e a portaria existe
 * para levar o operador para dentro — não para ser contemplada. A deriva lenta
 * é AMBIENTE (ciclo de 32 s, amplitude mínima): nunca reage a dado, nunca
 * para, existe só para a porta não parecer um print.
 */

import { useState } from 'react';
import { supabaseNavegador } from '../lib/supabaseNavegador';

export function Portaria({ aoEntrar }: { aoEntrar: () => void }) {
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const entrar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    const bd = supabaseNavegador();
    if (!bd) return;

    setOcupado(true);
    setErro(null);
    // `password` é o contrato do SDK — infraestrutura externa mantém o nome de
    // mercado. Só o domínio da IARA fala português.
    const { error } = await bd.auth.signInWithPassword({
      email: email.trim(),
      password: senha,
    });
    setOcupado(false);

    if (error) {
      // Mensagem única para credencial errada: não revela se o e-mail existe.
      setErro('E-mail ou senha não conferem.');
      return;
    }
    aoEntrar();
  };

  return (
    <main className="portaria">
      <div className="portaria-cromo" aria-hidden="true" />
      <div className="portaria-veu" aria-hidden="true" />

      <form className="portaria-placa" onSubmit={entrar}>
        <img
          className="portaria-marca"
          src="/marca/iara-simbolo.png"
          alt="IARA"
          width={92}
          height={92}
          draggable={false}
        />

        {/* Só o nome. O logotipo traz IARA gravada no metal, mas a 92 px aquilo
            é textura, não palavra — e a porta é o único lugar onde alguém pode
            chegar sem saber de quem é a casa.

            Nada de "identifique-se para entrar": os rótulos dos campos e o
            botão já dizem isso. Instrução redundante é ruído, e ruído é o que
            tira o ar de uma tela premium. */}
        <h1 className="portaria-nome">IARA</h1>

        <label className="portaria-campo">
          <span>E-mail</span>
          <input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>

        <label className="portaria-campo">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
          />
        </label>

        {erro && (
          <div className="portaria-erro" role="alert">
            {erro}
          </div>
        )}

        <button className="portaria-entrar" type="submit" disabled={ocupado}>
          {ocupado ? 'Abrindo…' : 'Entrar'}
        </button>

        {/* O que a IARA é, em três verbos — e não é slogan: é o laço do kernel
            (Percepcao → Planejador → OrquestradorAcoes). "Agente cognitivo"
            nomeia a categoria; isto nomeia a diferença, que é EXECUTAR. */}
        <p className="portaria-natureza">Percebe, decide e executa.</p>
      </form>
    </main>
  );
}
