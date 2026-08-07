'use client';

/**
 * A portaria. Ninguém entra no escritório sem se identificar.
 *
 * Não é uma tela de login genérica: é a porta da sala. Mesmo aqui, a pergunta
 * é "que objeto isto é?" — é a recepção, com a mesma paleta e a mesma calma do
 * resto do ambiente.
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
    <main
      style={{
        height: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background:
          'radial-gradient(circle at 50% 30%, #f7f2e8 0%, var(--papel) 62%, #e9e1d3 100%)',
      }}
    >
      <form
        onSubmit={entrar}
        style={{
          width: '100%',
          maxWidth: 340,
          background: 'var(--painel)',
          border: '1px solid var(--linha)',
          borderRadius: 16,
          padding: 26,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
          boxShadow: '0 18px 40px var(--sombra)',
        }}
      >
        <div>
          <div style={{ fontSize: 19, fontWeight: 600, letterSpacing: 0.4 }}>IARA</div>
          <div style={{ fontSize: 12.5, color: 'var(--tinta-fraca)', marginTop: 4 }}>
            O escritório está fechado. Identifique-se para entrar.
          </div>
        </div>

        <label style={{ fontSize: 12, color: 'var(--tinta-fraca)' }}>
          E-mail
          <input
            className="campo"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ marginTop: 5 }}
          />
        </label>

        <label style={{ fontSize: 12, color: 'var(--tinta-fraca)' }}>
          Senha
          <input
            className="campo"
            type="password"
            autoComplete="current-password"
            required
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            style={{ marginTop: 5 }}
          />
        </label>

        {erro && (
          <div
            style={{
              fontSize: 12,
              padding: '8px 10px',
              borderRadius: 8,
              background: 'rgba(240, 135, 106, 0.13)',
              border: '1px solid rgba(240, 135, 106, 0.4)',
            }}
          >
            {erro}
          </div>
        )}

        <button className="botao" type="submit" disabled={ocupado}>
          {ocupado ? 'Abrindo…' : 'Entrar'}
        </button>

        <p style={{ fontSize: 11, color: 'var(--tinta-fraca)', lineHeight: 1.5, margin: 0 }}>
          Seus registros são exclusivamente seus. Nenhum outro operador — e nem a própria
          IARA em outra sessão — enxerga o que você conversa aqui.
        </p>
      </form>
    </main>
  );
}
