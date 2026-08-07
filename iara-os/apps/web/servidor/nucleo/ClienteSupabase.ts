/**
 * Conexão com o Supabase.
 *
 * Mesmo contrato do `ClienteClaude`: se as variáveis não estiverem no
 * ambiente, retorna `null` e o sistema cai para os arquivos JSON. Nada quebra,
 * e o motor diz no log qual persistência está em uso — nunca deixa dúvida.
 *
 * Só o servidor importa este módulo. A `service_role` ignora RLS; se ela
 * chegasse ao navegador, o banco inteiro estaria aberto.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let memo: SupabaseClient | null | undefined;

/**
 * Lê o papel declarado dentro do JWT sem validar assinatura — só para
 * diagnóstico. Trocar service_role por anon é o erro de configuração mais
 * comum, e o sintoma é silencioso: leitura devolve zero linha e escrita falha,
 * porque o RLS está ligado sem policy. Melhor gritar na subida.
 */
function papelDaChave(chave: string): string | null {
  try {
    const corpo = chave.split('.')[1];
    if (!corpo) return null;
    const json = Buffer.from(corpo.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const dado = JSON.parse(json) as { role?: string };
    return dado.role ?? null;
  } catch {
    return null;
  }
}

export function supabase(): SupabaseClient | null {
  if (memo !== undefined) return memo;

  const url = process.env.SUPABASE_URL?.trim();
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url || !chave) {
    memo = null;
    return memo;
  }

  const papel = papelDaChave(chave);
  if (papel && papel !== 'service_role') {
    console.warn(
      `[iara] ATENÇÃO: SUPABASE_SERVICE_ROLE_KEY contém uma chave de papel "${papel}", ` +
        'não "service_role". Com RLS ligado e sem policy, toda leitura volta vazia e toda ' +
        'escrita falha. Pegue a chave em Project Settings → API → service_role → Reveal.',
    );
  }

  memo = createClient(url, chave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return memo;
}

export function supabaseAtivo(): boolean {
  return supabase() !== null;
}

/** Rótulo para o log de subida. */
export function persistenciaEmUso(): string {
  return supabaseAtivo() ? 'Supabase' : 'arquivos locais (dados/)';
}
