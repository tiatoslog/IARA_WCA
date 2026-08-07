'use client';

/**
 * Cliente Supabase do navegador. Usa a chave `anon`, que é pública por
 * natureza — quem protege os dados é o RLS, e nesta arquitetura o RLS nega
 * tudo para `anon`. O navegador usa este cliente para UMA coisa só: obter o
 * access token do operador logado.
 *
 * Quem lê e escreve dados é o motor, com a `service_role`, no servidor.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let memo: SupabaseClient | null | undefined;

export function supabaseNavegador(): SupabaseClient | null {
  if (memo !== undefined) return memo;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  memo = url && chave ? createClient(url, chave) : null;
  return memo;
}

/** Sem estas variáveis, o app roda em modo local com o seletor de operador. */
export function autenticacaoDisponivel(): boolean {
  return supabaseNavegador() !== null;
}

/**
 * Endereço do barramento. Derivado da própria página por padrão: mesma origem,
 * e `wss://` automático quando a página é HTTPS — página segura recusa
 * WebSocket inseguro, e essa é a falha nº 1 de quem publica isso pela primeira
 * vez.
 */
export function enderecoBarramento(): string {
  const explicito = process.env.NEXT_PUBLIC_IARA_WS;
  if (explicito) return explicito;
  if (typeof window === 'undefined') return '';
  const protocolo = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocolo}//${window.location.host}/barramento`;
}
