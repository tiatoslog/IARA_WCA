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

// ---------------------------------------------------------------------------
// Conferência de esquema
// ---------------------------------------------------------------------------

/**
 * AS TABELAS QUE A IARA ESCREVE. Não é o inventário do banco — é o que precisa
 * existir do outro lado para que o estado dela sobreviva ao processo.
 */
const TABELAS_EXIGIDAS = [
  'memoria_registros',
  'operador_preferencias',
  'insights_relacionais',
  'agenda_lembretes',
] as const;

export type TabelaIara = (typeof TABELAS_EXIGIDAS)[number];

/** As que a conferência não encontrou no projeto. Vazio até conferir. */
const ausentes = new Set<string>();

/**
 * O erro é "esta tabela não existe" — e NÃO "a rede caiu"?
 *
 * A distinção decide tudo: tabela ausente é configuração incompleta, e a
 * resposta certa é cair para arquivo. Rede fora é transitório, e cair para
 * arquivo ali significaria gravar num lugar que ninguém vai ler quando a rede
 * voltar. `PGRST205` é o código do PostgREST para relação desconhecida;
 * `PGRST106` é esquema fora da lista exposta; `42P01` é o SQLSTATE do Postgres
 * para "undefined_table".
 */
export function ehTabelaAusente(erro: { code?: string; message?: string } | null): boolean {
  if (!erro) return false;
  if (erro.code && ['PGRST205', 'PGRST106', '42P01'].includes(erro.code)) return true;
  /**
   * `relation ... does not exist`, NUNCA só `does not exist`.
   *
   * Achado atacando a própria correção: `column "x" does not exist` (SQLSTATE
   * 42703) casava com o padrão frouxo. Uma coluna renomeada derrubaria a tabela
   * INTEIRA para arquivo — a persistência mudaria de lugar por causa de um erro
   * que não tem nada a ver com a existência dela.
   */
  return /could not find the table|relation\s+\S+\s+does not exist|schema cache/i.test(
    erro.message ?? '',
  );
}

/**
 * O mínimo que a conferência precisa saber fazer. Existe para que o teste possa
 * entregar um banco de mentira SEM que o resto do sistema ganhe uma porta nova:
 * quem chama de verdade não passa argumento nenhum.
 */
export interface SondaDeEsquema {
  from(tabela: string): {
    select(colunas: string): {
      limit(n: number): PromiseLike<{ error: { code?: string; message?: string } | null }>;
    };
  };
}

/**
 * CONFERE O ESQUEMA ANTES DE PROMETER PERSISTÊNCIA — e degrada em voz alta.
 *
 * O buraco que isto fecha foi encontrado executando o catálogo de verdade, não
 * lendo código: com `SUPABASE_URL` e a chave presentes mas o projeto VAZIO, o
 * cabeçalho deste arquivo continuava afirmando que "se as variáveis não
 * estiverem no ambiente, o sistema cai para os arquivos JSON — nada quebra". A
 * promessa cobria a variável ausente e não cobria o esquema ausente, que é o
 * estado real de um projeto recém-criado no Supabase.
 *
 * O preço era alto e silencioso: as três habilidades de agenda subiam
 * `Supabase: Could not find the table 'public.agenda_lembretes'` como resposta
 * ao operador, e `MemoriaOperacional.registrar` lançava a cada turno — a IARA
 * perdia a memória da conversa e dizia isso em jargão de PostgREST.
 *
 * A DEGRADAÇÃO É POR TABELA, e a primeira versão desta correção errava aqui.
 *
 * Ela desligava o Supabase inteiro à primeira ausência. Parecia a escolha
 * conservadora e era a destrutiva: no projeto real, `memoria_registros`,
 * `operador_preferencias` e `insights_relacionais` EXISTEM e estavam em uso —
 * só `agenda_lembretes` faltava. Desligar tudo teria mudado, em silêncio, a
 * memória de todas as conversas para o disco de uma máquina, e o histórico que
 * está no banco pararia de ser lido. Consertar a agenda derrubando a memória é
 * uma troca que ninguém pediu.
 *
 * Cada tabela responde por si: a que existe continua no banco, a que falta cai
 * para arquivo. É a mesma disciplina de `consultar_infraestrutura`, que cai para
 * JSON sem arrastar o resto do sistema junto.
 *
 * Só a AUSÊNCIA degrada. Falha de rede, timeout ou chave errada deixam a tabela
 * ligada: são transitórios ou de configuração, e escrever em disco por causa
 * deles espalharia o estado em dois lugares por um problema que passa.
 */
export async function conferirEsquemaSupabase(sonda?: SondaDeEsquema): Promise<void> {
  const bd = sonda ?? (supabase() as unknown as SondaDeEsquema | null);
  if (!bd) return;

  for (const tabela of TABELAS_EXIGIDAS) {
    /**
     * `select('*').limit(1)` — um GET QUE TRAZ CORPO, e nunca `head: true`.
     *
     * Medido em 13/08/2026 contra uma tabela que comprovadamente não existe:
     *
     *   .select('*').limit(1)                    → error PGRST205
     *   .select('*', {count:'exact', head:true}) → error null, count null
     *
     * A requisição HEAD volta limpa para tabela inexistente. Uma conferência de
     * esquema escrita com ela diria "está tudo lá" sobre um projeto vazio — e
     * seria pior que não conferir, porque teria a forma de uma prova. A primeira
     * sondagem manual desta auditoria caiu exatamente nessa armadilha e chegou a
     * relatar a tabela como existente.
     */
    /**
     * A CONFERÊNCIA NÃO PODE IMPEDIR O MOTOR DE SUBIR.
     *
     * Ela roda dentro de `prepararMotor`, que é awaited antes de a porta
     * aceitar operador. Uma exceção aqui — DNS fora, TLS recusado, cliente que
     * lança em vez de devolver `error` — derrubaria a subida inteira por causa
     * de um diagnóstico. Falhar em CONFERIR é diferente de falhar em FUNCIONAR:
     * na dúvida, a tabela segue considerada presente e quem decide é o erro
     * real da primeira gravação.
     */
    let error: { code?: string; message?: string } | null = null;
    try {
      ({ error } = await bd.from(tabela).select('*').limit(1));
    } catch (falha) {
      console.warn(
        `[iara] não consegui conferir a tabela ${tabela}: ${(falha as Error).message}. ` +
          'Sigo tratando-a como presente.',
      );
      continue;
    }
    if (ehTabelaAusente(error)) ausentes.add(tabela);
  }

  if (ausentes.size === 0) return;

  console.warn(
    `[iara] Supabase incompleto: ${[...ausentes].join(', ')} não existe(m) no projeto. ` +
      'O que depende dessas tabelas vai para dados/ nesta máquina; o resto continua no banco. ' +
      'Crie o esquema e reinicie para persistir remoto.',
  );
}

/**
 * O BANCO PARA ESTA TABELA — `null` quando ela não existe do outro lado.
 *
 * É a porta única por onde a persistência remota é obtida. Chamar `supabase()`
 * direto para ler ou gravar volta a ignorar o esquema, e é por isso que os
 * consumidores de estado (memória, preferências, insights, agenda) passam por
 * aqui: a pergunta "dá para gravar isto no banco?" não é a mesma que "existe um
 * cliente configurado?".
 */
export function bancoPara(tabela: TabelaIara): SupabaseClient | null {
  if (ausentes.has(tabela)) return null;
  return supabase();
}

/**
 * Esta tabela faltou na conferência? Exposto para o teste poder provar que a
 * degradação é POR TABELA sem precisar de um Supabase de verdade — `bancoPara`
 * devolve `null` tanto para a tabela ausente quanto para a máquina que nunca
 * configurou banco, e um teste que não distingue os dois casos não prova o que
 * esta correção fez.
 */
export function tabelaAusenteNoProjeto(tabela: string): boolean {
  return ausentes.has(tabela);
}

/**
 * O que a persistência remota deixou de cobrir. `null` quando cobre tudo — ou
 * quando não há Supabase nenhum, que é um caso diferente e não uma degradação.
 */
export function degradacaoDaPersistencia(): string | null {
  if (ausentes.size === 0) return null;
  return `${ausentes.size} tabela(s) ausente(s) no projeto: ${[...ausentes].join(', ')}`;
}

/**
 * Rótulo para o log de subida e para o diagnóstico.
 *
 * A ausência de tabela é dita mesmo quando o resto está de pé: "Supabase"
 * sozinho, num projeto sem `agenda_lembretes`, esconderia do operador que os
 * lembretes dele vivem no disco de uma máquina só.
 */
export function persistenciaEmUso(): string {
  const faltando = [...ausentes];
  if (faltando.length === 0) return supabaseAtivo() ? 'Supabase' : 'arquivos locais (dados/)';
  if (faltando.length === TABELAS_EXIGIDAS.length) {
    return 'arquivos locais (dados/) — nenhuma tabela da IARA existe no Supabase configurado';
  }
  return `Supabase, menos ${faltando.join(' e ')} (tabela ausente; vai para dados/)`;
}
