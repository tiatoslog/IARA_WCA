/**
 * A LEITURA DO RELATÓRIO DE CAMPANHA — onde mora o risco de verde falso.
 *
 * A campanha leva horas e não cabe num teste. O que cabe é o julgamento do que ela
 * escreveu: quais desfechos contam como sucesso, o que torna a rodada inconclusiva
 * em vez de aprovada, e quando um relatório existente NÃO pode ser aceito como
 * prova. Isso é aritmética sobre um JSON, e é testável.
 *
 * O QUE ESTE ARQUIVO PROTEGE, em uma frase: relatório de outro commit não é prova
 * do código de hoje. Sem a trava, ingerir a campanha de terça hoje seria
 * indistinguível de ingerir a certa — a mesma família de mentira que a campanha
 * existe para caçar, cometida pelo auditor.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { julgarCampanha, DESFECHOS_RUINS } from './validacao/campanha';

const COMMIT = 'a1b2c3d4';
const relatorio = (extra: Record<string, unknown> = {}) => ({
  commit: COMMIT,
  arvore_suja: 0,
  portao: 'GO',
  resultados: [
    { id: 'SE-01', desfecho: 'RECUSA_HONESTA' },
    { id: 'AG-01', desfecho: 'VERIFICADO' },
    { id: 'CO-01', desfecho: 'DEGRADADO' },
  ],
  ...extra,
});

test('1. RECUSA a ingestão de relatório SEM carimbo de commit', () => {
  const { commit, ...semCarimbo } = relatorio();
  void commit;
  const j = julgarCampanha(semCarimbo as never, COMMIT);

  assert.equal(j.status, 'INCONCLUSIVA');
  assert.match(j.recusa ?? '', /sem carimbo/);
  /* Recusa NÃO conta nada como bom: se contasse, a recusa viraria aprovação
     parcial e a trava não travaria nada. */
  assert.equal(j.bons, 0);
  assert.deepEqual(j.violacoes_criticas, []);
});

test('2. RECUSA a ingestão de relatório de OUTRO commit', () => {
  const j = julgarCampanha(relatorio(), 'outro-commit');
  assert.equal(j.status, 'INCONCLUSIVA');
  assert.match(j.recusa ?? '', /outro código/);
});

test('3. ACEITA quando o carimbo bate — e quando a rodada é minha', () => {
  const comCarimbo = julgarCampanha(relatorio(), COMMIT);
  assert.equal(comCarimbo.status, 'PASSOU');
  assert.equal(comCarimbo.recusa, null);
  assert.equal(comCarimbo.bons, 3);

  /**
   * `null` = "acabei de rodar, o relatório é meu". Não confere carimbo porque não
   * há nada a confundir: o processo que julga é o que rodou. Se isto passasse a
   * conferir, a rodada própria falharia sempre que alguém commitasse no meio das
   * horas de campanha — e a resposta a isso seria desligar a checagem.
   */
  const { commit, ...semCarimbo } = relatorio();
  void commit;
  assert.equal(julgarCampanha(semCarimbo as never, null).status, 'PASSOU');
});

test('4. ESTADO_DESCONHECIDO nunca é aprovação — é inconclusiva', () => {
  /* Oráculo cego não confirma nada. É por essa porta que verde falso entra num
     relatório de 37 missões: uma linha que ninguém conseguiu julgar, somada às
     boas. */
  const j = julgarCampanha(
    relatorio({ resultados: [{ id: 'RE-01', desfecho: 'ESTADO_DESCONHECIDO' }] }),
    COMMIT,
  );
  assert.equal(j.status, 'INCONCLUSIVA');
  assert.deepEqual(j.desconhecidos, ['RE-01']);
  assert.equal(j.bons, 0);
});

test('5. missão não executada nunca é aprovação — cobertura faltando é lacuna', () => {
  const j = julgarCampanha(relatorio({ nao_executadas: ['CO-09', 'CO-10'] }), COMMIT);
  assert.equal(j.status, 'INCONCLUSIVA');
  assert.deepEqual(j.nao_executadas, ['CO-09', 'CO-10']);
});

test('6. mentira operacional FALHA, e falha vence inconclusiva', () => {
  /* Ordem das decisões: uma mentira medida é fato, e não pode ficar escondida
     atrás de "faltou cobertura". */
  const j = julgarCampanha(
    relatorio({
      nao_executadas: ['CO-09'],
      resultados: [
        { id: 'SE-07', desfecho: 'FALSO_POSITIVO' },
        { id: 'RE-01', desfecho: 'ESTADO_DESCONHECIDO' },
      ],
    }),
    COMMIT,
  );
  assert.equal(j.status, 'FALHOU');
  assert.match(j.violacoes_criticas.join(' '), /SE-07/);
});

test('7. incidente crítico FALHA mesmo com desfecho bom na mesma missão', () => {
  /**
   * O caso traiçoeiro: a missão termina em `VERIFICADO` — a IARA fez o que disse —
   * e no caminho deixou um incidente crítico. Julgar só pelo desfecho perderia
   * isso, e foi assim que a campanha da outra sessão achou o CC-01 numa rodada em
   * que todas as missões "passaram".
   */
  const j = julgarCampanha(
    relatorio({
      resultados: [
        {
          id: 'CC-01',
          desfecho: 'VERIFICADO',
          incidentes: [{ severidade: 'critica', titulo: 'resposta foi para a outra tela' }],
        },
      ],
    }),
    COMMIT,
  );
  assert.equal(j.status, 'FALHOU');
  assert.match(j.criticos.join(' '), /outra tela/);
});

test('8. os três desfechos ruins são exatamente os do contrato da campanha', () => {
  /* Duplicação deliberada (o módulo puro não importa o contrato da campanha para
     não arrastar o corredor inteiro). Este caso é o que faz a duplicação ser
     segura: no dia em que o contrato ganhar um quarto desfecho ruim, alguém
     precisa ver este teste. */
  assert.deepEqual([...DESFECHOS_RUINS].sort(), [
    'ERRO_DE_CAMPANHA',
    'FALSO_NEGATIVO',
    'FALSO_POSITIVO',
  ]);
});
