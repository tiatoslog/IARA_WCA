/**
 * PlanilhaGenerica — leitura de `.xlsx`/`.xls` genérico de `dados/documentos/`.
 *
 * `lerPlanilhaGenerica` lê do disco de verdade (mesmo desenho de
 * `extrairTextoDocumento`, sem injeção de raiz) — por isso os testes escrevem
 * fixtures reais em `dados/documentos/` (pasta gitignorada) e removem tudo em
 * `t.after()`, mesmo padrão de `agente-local.test.ts` com `mkdtempSync`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

import { lerPlanilhaGenerica, LIMITE_LINHAS_PERFIL, TAMANHO_MAXIMO_BYTES } from '../servidor/nucleo/PlanilhaGenerica';

const PASTA = path.resolve(process.cwd(), 'dados', 'documentos');

function escreverXlsx(nome: string, abas: Record<string, unknown[][]>): void {
  mkdirSync(PASTA, { recursive: true });
  const wb = XLSX.utils.book_new();
  for (const [nomeAba, linhas] of Object.entries(abas)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), nomeAba);
  }
  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer;
  writeFileSync(path.join(PASTA, nome), buffer);
}

function limparAoFinal(t: import('node:test').TestContext, nome: string): void {
  t.after(() => rmSync(path.join(PASTA, nome), { force: true }));
}

test('lê planilha simples: cabeçalho, linhas e total corretos', async (t) => {
  const nome = 'teste-simples.xlsx';
  escreverXlsx(nome, {
    Dados: [
      ['Cliente', 'Regiao', 'Valor'],
      ['Fulano', 'Sul', 100],
      ['Ciclano', 'Norte', 200],
    ],
  });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.tabela.cabecalho, ['Cliente', 'Regiao', 'Valor']);
  assert.equal(r.tabela.total_linhas, 2);
  assert.equal(r.tabela.linhas.length, 2);
  assert.equal(r.tabela.aba, 'Dados');
  assert.equal(r.tabela.truncada, false);
});

test('cabeçalho com célula vazia vira coluna_N', async (t) => {
  const nome = 'teste-cabecalho-vazio.xlsx';
  escreverXlsx(nome, { Dados: [['Nome', '', 'Valor'], ['A', 'x', 1]] });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.tabela.cabecalho, ['Nome', 'coluna_2', 'Valor']);
});

test('cabeçalho com nome duplicado ganha sufixo _2', async (t) => {
  const nome = 'teste-cabecalho-duplicado.xlsx';
  escreverXlsx(nome, { Dados: [['Valor', 'Nome', 'Valor'], [1, 'A', 2]] });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.deepEqual(r.tabela.cabecalho, ['Valor', 'Nome', 'Valor_2']);
});

test('escolhe a primeira aba com dado — não necessariamente a primeira do arquivo', async (t) => {
  const nome = 'teste-aba-padrao.xlsx';
  escreverXlsx(nome, {
    Resumo: [['Cabecalho', 'Vazio']], // só cabeçalho, sem linha de dado
    Dados: [['Cabecalho'], ['linha 1']],
  });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tabela.aba, 'Dados');
  assert.deepEqual(r.tabela.abas_disponiveis, ['Resumo', 'Dados']);
});

test('aba pedida por nome exato é respeitada', async (t) => {
  const nome = 'teste-aba-pedida.xlsx';
  escreverXlsx(nome, { A: [['x'], [1]], B: [['y'], [2]] });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome, 'B');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tabela.aba, 'B');
});

test('aba pedida casa por acento/caixa, mesmo sem bater literalmente', async (t) => {
  const nome = 'teste-aba-normalizada.xlsx';
  escreverXlsx(nome, { 'Operação': [['x'], [1]] });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome, 'operacao');
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tabela.aba, 'Operação');
});

test('aba inexistente devolve as abas REAIS, nunca segue com a errada', async (t) => {
  const nome = 'teste-aba-inexistente.xlsx';
  escreverXlsx(nome, { Dados: [['x'], [1]] });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome, 'NaoExiste');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /Dados/);
});

test('arquivo ausente devolve erro sem lançar', async () => {
  const r = await lerPlanilhaGenerica('nao-existe-de-verdade.xlsx');
  assert.equal(r.ok, false);
});

test('trava de travessia: "../" no nome é recusado antes de qualquer I/O', async () => {
  const r = await lerPlanilhaGenerica('../../.env.local');
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /caminho inválido/);
});

test('caminho absoluto também é recusado', async () => {
  const r = await lerPlanilhaGenerica('C:\\Windows\\win.ini');
  assert.equal(r.ok, false);
});

test('extensão fora de .xlsx/.xls é recusada', async (t) => {
  const nome = 'teste-extensao-errada.csv';
  mkdirSync(PASTA, { recursive: true });
  writeFileSync(path.join(PASTA, nome), 'a,b,c\n1,2,3\n');
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /\.xlsx ou \.xls/);
});

test('arquivo acima do teto de tamanho é recusado sem tentar parsear', async (t) => {
  const nome = 'teste-arquivo-grande.xlsx';
  mkdirSync(PASTA, { recursive: true });
  writeFileSync(path.join(PASTA, nome), Buffer.alloc(TAMANHO_MAXIMO_BYTES + 1024));
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, false);
  if (r.ok) return;
  assert.match(r.motivo, /MB/);
});

test('planilha acima do limite de linhas vira truncada, nunca corta em silêncio', async (t) => {
  const nome = 'teste-truncada.xlsx';
  const linhas: unknown[][] = [['id']];
  const totalDado = LIMITE_LINHAS_PERFIL + 5;
  for (let i = 1; i <= totalDado; i += 1) linhas.push([i]);
  escreverXlsx(nome, { Dados: linhas });
  limparAoFinal(t, nome);

  const r = await lerPlanilhaGenerica(nome);
  assert.equal(r.ok, true);
  if (!r.ok) return;
  assert.equal(r.tabela.truncada, true);
  assert.equal(r.tabela.total_linhas, totalDado);
  assert.equal(r.tabela.linhas.length, LIMITE_LINHAS_PERFIL);
});
