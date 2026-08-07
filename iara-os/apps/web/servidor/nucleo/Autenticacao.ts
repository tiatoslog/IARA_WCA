/**
 * Autenticação dos operadores.
 *
 * O PONTO INTEIRO desta camada: o `id_usuario` passa a vir de um token
 * verificado pelo servidor, nunca de um campo que o cliente escolheu.
 *
 * Sem isto, todo o isolamento de shards é protegido por um `<select>` — em
 * localhost tudo bem, publicado é nada. Quem controla o navegador controla o
 * que digita no socket.
 */

import { supabase } from './ClienteSupabase';

export interface OperadorAutenticado {
  id_usuario: string;
  nome: string;
  email: string;
}

export function autenticacaoAtiva(): boolean {
  return supabase() !== null;
}

/**
 * Verifica o access token do Supabase. Retorna `null` para qualquer token
 * inválido, expirado ou ausente — sem distinguir o motivo, para não virar
 * oráculo de enumeração.
 */
export async function verificarToken(token: string | undefined): Promise<OperadorAutenticado | null> {
  const bd = supabase();
  if (!bd) return null;
  if (!token || token.length < 20) return null;

  const { data, error } = await bd.auth.getUser(token);
  if (error || !data?.user) return null;

  const usuario = data.user;
  const email = usuario.email ?? '';
  const nome =
    (usuario.user_metadata?.nome as string | undefined) ??
    (usuario.user_metadata?.full_name as string | undefined) ??
    (email ? email.split('@')[0] : 'operador');

  return {
    // O id do Supabase é uuid: estável, único e não escolhido pelo cliente.
    id_usuario: usuario.id,
    nome,
    email,
  };
}

/**
 * Identidade em modo local, quando não há Supabase configurado. Aceita o id
 * que o cliente mandou — é o comportamento de desenvolvimento, e o motor grita
 * na subida que não se deve expor o processo assim.
 */
export function identidadeLocal(idBruto: string, nome: string): OperadorAutenticado {
  const limpo = idBruto.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return {
    id_usuario: limpo || 'operador',
    nome: nome || limpo || 'operador',
    email: '',
  };
}
