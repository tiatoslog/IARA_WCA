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

/**
 * Origem HTTP do motor. Vazia quando ele É este host — o caso unificado, em que
 * caminho relativo já resolve sozinho.
 *
 * DERIVADA de `NEXT_PUBLIC_IARA_WS`, e isso é deliberado: uma variável só, uma
 * verdade só. Duas variáveis independentes (uma para o WebSocket, outra para o
 * HTTP) divergem no dia em que alguém troca o domínio do motor e atualiza
 * apenas a primeira — e o sintoma dessa divergência é a IARA conversar
 * normalmente e ficar MUDA, sem erro no console, porque só o áudio quebrou.
 *
 * `NEXT_PUBLIC_IARA_MOTOR` existe como escape para o caso em que os dois de
 * fato moram em endereços diferentes (um proxy de WebSocket na frente, por
 * exemplo). Não é o caminho esperado.
 */
export function origemMotor(): string {
  const explicito = process.env.NEXT_PUBLIC_IARA_MOTOR;
  if (explicito) return explicito.replace(/\/$/, '');
  const ws = process.env.NEXT_PUBLIC_IARA_WS;
  if (ws) return ws.replace(/^ws/, 'http').replace(/\/barramento\/?$/, '');
  return '';
}

/**
 * `/voz/<hash>.mp3` → URL absoluta quando o motor mora noutro host.
 *
 * O `SnapshotCognitivo` carrega um CAMINHO, não uma URL, e continua assim: ele
 * é o contrato do sistema, e enfiar o endereço do motor dentro dele faria o
 * contrato de domínio carregar detalhe de transporte — um snapshot só válido no
 * deployment que o gerou. Quem sabe onde esse caminho mora é esta camada, a
 * mesma que já sabe onde o barramento mora.
 */
export function urlVoz(caminho: string): string {
  if (/^https?:\/\//.test(caminho)) return caminho;
  return `${origemMotor()}${caminho}`;
}

/** `/anexo/<hash>.png` → URL absoluta, mesma razão de `urlVoz`: o snapshot
 *  carrega caminho, não endereço — quem sabe onde o motor mora é esta camada. */
export function urlAnexo(caminho: string): string {
  if (/^https?:\/\//.test(caminho)) return caminho;
  return `${origemMotor()}${caminho}`;
}
