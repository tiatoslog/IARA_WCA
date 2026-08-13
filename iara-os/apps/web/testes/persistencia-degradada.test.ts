/**
 * PERSISTÊNCIA DEGRADADA — a promessa que o cabeçalho fazia e o código não
 * cumpria.
 *
 * `ClienteSupabase` sempre afirmou: "se as variáveis não estiverem no ambiente,
 * retorna null e o sistema cai para os arquivos JSON. Nada quebra." A promessa
 * cobria a VARIÁVEL ausente e não cobria o ESQUEMA ausente — que é o estado de
 * todo projeto Supabase recém-criado, e era o estado do projeto configurado em
 * 13/08/2026: url e chave válidas, zero tabelas.
 *
 * O que isso produzia, medido rodando o catálogo de verdade: as três habilidades
 * de agenda respondiam ao operador com
 * `Supabase: Could not find the table 'public.agenda_lembretes' in the schema
 * cache`, e `MemoriaOperacional.registrar` lançava a cada turno — a IARA perdia
 * a memória da conversa e explicava isso em jargão de PostgREST.
 *
 * A ORDEM DOS TESTES É PARTE DO TESTE: a degradação é um estado de módulo e não
 * tem volta dentro do mesmo processo. O caso de rede precisa correr ANTES do
 * caso de tabela ausente — invertê-los faria o primeiro passar por herança do
 * segundo, provando nada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  conferirEsquemaSupabase,
  degradacaoDaPersistencia,
  ehTabelaAusente,
  persistenciaEmUso,
  tabelaAusenteNoProjeto,
  type SondaDeEsquema,
} from '../servidor/nucleo/ClienteSupabase';

/** Um banco de mentira que decide o erro OLHANDO O NOME DA TABELA. */
function sondaPorTabela(
  porTabela: (tabela: string) => { code?: string; message?: string } | null,
): SondaDeEsquema {
  return {
    from: (tabela: string) => ({
      select: () => ({
        limit: () => Promise.resolve({ error: porTabela(tabela) }),
      }),
    }),
  };
}

/** Um banco de mentira que devolve sempre o mesmo erro. */
function sondaQueResponde(erro: { code?: string; message?: string } | null): SondaDeEsquema {
  return sondaPorTabela(() => erro);
}

// ===========================================================================
// 1. A CLASSIFICAÇÃO — o que separa "não existe" de "não deu para falar"
// ===========================================================================

test('S1. tabela ausente é reconhecida pelo código do PostgREST e pela mensagem', () => {
  assert.equal(
    ehTabelaAusente({
      code: 'PGRST205',
      message: "Could not find the table 'public.agenda_lembretes' in the schema cache",
    }),
    true,
  );
  assert.equal(ehTabelaAusente({ code: 'PGRST106', message: 'schema must be one of' }), true);
  assert.equal(ehTabelaAusente({ code: '42P01', message: 'relation does not exist' }), true);
});

test('S2. falha de REDE e falha de PERMISSÃO não são tabela ausente', () => {
  /**
   * A asserção que impede a correção de virar um buraco maior que o defeito.
   *
   * Tratar qualquer erro como "esquema ausente" faria uma queda de rede de dez
   * segundos mudar a persistência do processo inteiro para disco — e o operador
   * voltaria a um banco que ficou sem as falas daquele intervalo, sem ninguém
   * nunca ter sido avisado. Transitório se resolve esperando, não degradando.
   */
  assert.equal(ehTabelaAusente({ message: 'fetch failed' }), false);
  assert.equal(ehTabelaAusente({ code: 'ECONNRESET', message: 'socket hang up' }), false);
  assert.equal(ehTabelaAusente({ code: '42501', message: 'permission denied for table' }), false);
  assert.equal(ehTabelaAusente({ code: 'PGRST301', message: 'JWT expired' }), false);
  assert.equal(ehTabelaAusente(null), false);

  /**
   * COLUNA ausente não é TABELA ausente — achado atacando esta correção.
   *
   * O padrão frouxo (`/does not exist/`) casava com `column "x" does not
   * exist`. Uma coluna renomeada num deploy mandaria a tabela inteira para
   * arquivo: a persistência mudaria de lugar por um erro que nada tem a ver
   * com a existência dela, e ninguém ligaria uma coisa à outra.
   */
  assert.equal(
    ehTabelaAusente({ code: '42703', message: 'column "entregue_em" does not exist' }),
    false,
    'coluna ausente degradou a tabela inteira',
  );
});

test('S2b. quem persiste estado passa por `bancoPara`, nunca por `supabase()` direto', () => {
  /**
   * A trava que sobrevive a quem não leu nada disto.
   *
   * `bancoPara` é a única porta que conhece o esquema conferido. Um consumidor
   * novo que chame `supabase()` direto volta a gravar numa tabela que pode não
   * existir — e o sintoma reaparece exatamente igual: exceção de PostgREST na
   * cara do operador, no meio de uma conversa.
   */
  const raiz = process.cwd();
  for (const arquivo of ['servidor/nucleo/Agenda.ts', 'servidor/nucleo/MemoriaOperacional.ts']) {
    const fonte = readFileSync(path.join(raiz, arquivo), 'utf8');
    assert.doesNotMatch(
      fonte,
      /=\s*supabase\(\)/,
      `${arquivo} voltou a pegar o cliente sem passar pela conferência de esquema`,
    );
    assert.match(fonte, /bancoPara\(/, `${arquivo} deixou de usar a porta que confere o esquema`);
  }
});

// ===========================================================================
// 2. O EFEITO — degradar só quando é para degradar
// ===========================================================================

test('S3. erro de rede na conferência NÃO degrada a persistência', async () => {
  await conferirEsquemaSupabase(sondaQueResponde({ message: 'fetch failed' }));

  assert.equal(
    degradacaoDaPersistencia(),
    null,
    'uma falha transitória desligou o banco do processo inteiro',
  );
});

test('S4. só a tabela AUSENTE degrada — as que existem continuam no banco', async () => {
  /**
   * O ESTADO REAL medido em 13/08/2026, e a razão de esta ser a asserção
   * central: o projeto tinha `memoria_registros`, `operador_preferencias` e
   * `insights_relacionais`, e não tinha `agenda_lembretes`.
   *
   * A primeira versão da correção desligava o Supabase inteiro na primeira
   * ausência. Teria consertado a agenda mudando, em silêncio, a memória de
   * todas as conversas para o disco de UMA máquina — e o histórico gravado no
   * banco pararia de ser lido. Este teste existe para que ninguém volte a essa
   * troca sem que a suíte reclame.
   */
  await conferirEsquemaSupabase(
    sondaPorTabela((tabela) =>
      tabela === 'agenda_lembretes'
        ? {
            code: 'PGRST205',
            message: "Could not find the table 'public.agenda_lembretes' in the schema cache",
          }
        : null,
    ),
  );

  assert.equal(tabelaAusenteNoProjeto('agenda_lembretes'), true);
  assert.equal(
    tabelaAusenteNoProjeto('memoria_registros'),
    false,
    'a memória foi degradada junto por uma tabela que não é dela',
  );
  assert.equal(tabelaAusenteNoProjeto('operador_preferencias'), false);
  assert.equal(tabelaAusenteNoProjeto('insights_relacionais'), false);

  const motivo = degradacaoDaPersistencia();
  assert.ok(motivo, 'degradou sem registrar o motivo');
  assert.match(motivo!, /agenda_lembretes/, 'o motivo não nomeia a tabela que falta');
  assert.doesNotMatch(motivo!, /memoria_registros/);

  /**
   * O RÓTULO PRECISA CARREGAR O QUE FICOU DE FORA. É o campo que o
   * `diagnosticar_sistema` mostra ao operador: "Supabase" sozinho esconderia
   * que os lembretes dele estão no disco de uma máquina só.
   */
  assert.match(persistenciaEmUso(), /agenda_lembretes/);
});

test('S5. sem banco nenhum, a conferência é um silêncio — não um erro', async () => {
  // `null` é o estado de quem nunca configurou Supabase. A conferência não pode
  // lançar nem inventar degradação: não há nada de errado em rodar local.
  await assert.doesNotReject(() => conferirEsquemaSupabase(null as unknown as SondaDeEsquema));
});
