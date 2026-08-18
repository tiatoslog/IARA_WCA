/**
 * AnaliseTabular — puro, sem I/O. `localizarColuna` NUNCA adivinha (nome que
 * não bate ou que bate com mais de uma coluna volta como erro explícito,
 * nunca um índice escolhido por desempate silencioso).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { agregarTabela, localizarColuna, perfilarTabela } from '../servidor/nucleo/kernel/AnaliseTabular';
import type { CelulaValor, TabelaGenerica } from '../servidor/nucleo/PlanilhaGenerica';

function tabela(cabecalho: readonly string[], linhas: readonly (readonly CelulaValor[])[]): TabelaGenerica {
  return {
    arquivo: 'teste.xlsx',
    aba: 'Dados',
    abas_disponiveis: ['Dados'],
    cabecalho,
    linhas,
    total_linhas: linhas.length,
    truncada: false,
  };
}

// ---------------------------------------------------------------------------
// perfilarTabela
// ---------------------------------------------------------------------------

test('perfilarTabela: coluna 100% numérica tem tipo_dominante "numero"', () => {
  const t = tabela(['Valor'], [[10], [20], [30]]);
  const [p] = perfilarTabela(t);
  assert.equal(p.tipo_dominante, 'numero');
  assert.equal(p.nulos, 0);
  assert.equal(p.taxa_nulo, 0);
});

test('perfilarTabela: célula null e string vazia contam como nulo', () => {
  const t = tabela(['Nome'], [['A'], [null], [''], ['B']]);
  const [p] = perfilarTabela(t);
  assert.equal(p.nulos, 2);
  assert.equal(p.taxa_nulo, 0.5);
});

test('perfilarTabela: coluna inteiramente vazia tem tipo_dominante "vazio"', () => {
  const t = tabela(['Nada'], [[null], [''], [null]]);
  const [p] = perfilarTabela(t);
  assert.equal(p.tipo_dominante, 'vazio');
});

test('perfilarTabela: mistura sem dominância clara vira "misto"', () => {
  // 5 números, 5 textos — nenhum tipo passa de 90% (DOMINANCIA_TIPO).
  const linhas: (readonly CelulaValor[])[] = [
    ...Array.from({ length: 5 }, (_, i) => [i] as CelulaValor[]),
    ...Array.from({ length: 5 }, (_, i) => [`texto${i}`] as CelulaValor[]),
  ];
  const t = tabela(['Coluna'], linhas);
  const [p] = perfilarTabela(t);
  assert.equal(p.tipo_dominante, 'misto');
});

test('perfilarTabela: data em formato dd/mm/aaaa é reconhecida', () => {
  const t = tabela(['Data'], [['17/08/2026'], ['18/08/2026']]);
  const [p] = perfilarTabela(t);
  assert.equal(p.tipo_dominante, 'data');
});

test('perfilarTabela: valor_mais_frequente conta certo', () => {
  const t = tabela(['Status'], [['ativo'], ['ativo'], ['inativo']]);
  const [p] = perfilarTabela(t);
  assert.deepEqual(p.valor_mais_frequente, { valor: 'ativo', contagem: 2 });
});

// ---------------------------------------------------------------------------
// localizarColuna
// ---------------------------------------------------------------------------

test('localizarColuna: casa nome exato', () => {
  const r = localizarColuna(['Cliente', 'Valor'], 'Valor');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.indice, 1);
});

test('localizarColuna: casa por normalização (acento e caixa)', () => {
  const r = localizarColuna(['Região', 'Valor'], 'regiao');
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.nome, 'Região');
});

test('localizarColuna: nome inexistente devolve erro com candidatas vazias', () => {
  const r = localizarColuna(['Cliente', 'Valor'], 'Data');
  assert.equal(r.ok, false);
  if (!r.ok) assert.deepEqual(r.candidatas, []);
});

test('localizarColuna: ambiguidade (duas colunas colidem após normalizar) recusa e lista as duas', () => {
  const r = localizarColuna(['VALOR', 'valor'], 'valor');
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.candidatas.length, 2);
    assert.deepEqual(r.candidatas, ['VALOR', 'valor']);
  }
});

// ---------------------------------------------------------------------------
// agregarTabela
// ---------------------------------------------------------------------------

test('agregarTabela: sem agrupar, contagem soma todas as linhas num grupo "total"', () => {
  const t = tabela(['x'], [[1], [2], [3]]);
  const grupos = agregarTabela(t, null, 'contagem', null);
  assert.deepEqual(grupos, [{ chave: 'total', contagem: 3 }]);
});

test('agregarTabela: agrupa por coluna e conta', () => {
  const t = tabela(['Regiao'], [['Sul'], ['Sul'], ['Norte']]);
  const grupos = [...agregarTabela(t, 0, 'contagem', null)].sort((a, b) => b.contagem - a.contagem);
  assert.deepEqual(grupos, [
    { chave: 'Sul', contagem: 2 },
    { chave: 'Norte', contagem: 1 },
  ]);
});

test('agregarTabela: soma, media, minimo, maximo por grupo', () => {
  const t = tabela(['Regiao', 'Valor'], [
    ['Sul', 10],
    ['Sul', 30],
    ['Norte', 5],
  ]);
  const soma = agregarTabela(t, 0, 'soma', 1);
  const sul = soma.find((g) => g.chave === 'Sul');
  assert.equal(sul?.valor, 40);

  const media = agregarTabela(t, 0, 'media', 1);
  assert.equal(media.find((g) => g.chave === 'Sul')?.valor, 20);

  const minimo = agregarTabela(t, 0, 'minimo', 1);
  assert.equal(minimo.find((g) => g.chave === 'Sul')?.valor, 10);

  const maximo = agregarTabela(t, 0, 'maximo', 1);
  assert.equal(maximo.find((g) => g.chave === 'Sul')?.valor, 30);
});

test('agregarTabela: valor não numérico na coluna de métrica é ignorado, não vira NaN', () => {
  const t = tabela(['Regiao', 'Valor'], [
    ['Sul', 10],
    ['Sul', 'não é número' as CelulaValor],
  ]);
  const soma = agregarTabela(t, 0, 'soma', 1);
  assert.equal(soma.find((g) => g.chave === 'Sul')?.valor, 10);
  assert.equal(soma.find((g) => g.chave === 'Sul')?.contagem, 2);
});

test('agregarTabela: filtro por igualdade restringe antes de agregar', () => {
  const t = tabela(['Regiao', 'Valor'], [
    ['Sul', 10],
    ['Norte', 20],
  ]);
  const grupos = agregarTabela(t, null, 'contagem', null, { indiceColuna: 0, valor: 'Sul' });
  assert.deepEqual(grupos, [{ chave: 'total', contagem: 1 }]);
});

test('agregarTabela: célula vazia no agrupamento vira "(vazio)", não some da contagem', () => {
  const t = tabela(['Regiao'], [[''], ['Sul']]);
  const grupos = agregarTabela(t, 0, 'contagem', null);
  assert.ok(grupos.some((g) => g.chave === '(vazio)' && g.contagem === 1));
});
