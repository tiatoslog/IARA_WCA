/**
 * As 3 habilidades de planilha genérica, pela porta `executar()` — prova que
 * `consultar_planilha_generica` NUNCA segue com um índice de coluna adivinhado
 * e que `diagnosticar_qualidade_planilha` distingue "nada fora do padrão" de
 * "achei algo".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';

import {
  consultarPlanilhaGenerica,
  descreverPlanilha,
  diagnosticarQualidadePlanilha,
} from '../servidor/nucleo/kernel/habilidades/planilhaGenerica';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const PASTA = path.resolve(process.cwd(), 'dados', 'documentos');

function escreverXlsx(nome: string, linhas: unknown[][]): void {
  mkdirSync(PASTA, { recursive: true });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(linhas), 'Dados');
  writeFileSync(path.join(PASTA, nome), XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' }) as Buffer);
}

function limpar(t: import('node:test').TestContext, nome: string): void {
  t.after(() => rmSync(path.join(PASTA, nome), { force: true }));
}

function contexto(parametros: Record<string, unknown>): ContextoHabilidade {
  return {
    parametros,
    enunciado: 'teste',
    id_usuario: 'op-teste',
    sessao: 'teste',
    sinal: new AbortController().signal,
  } as unknown as ContextoHabilidade;
}

test('descrever_planilha: lista as colunas reais do arquivo', async (t) => {
  const nome = 'hab-descrever.xlsx';
  escreverXlsx(nome, [['Cliente', 'Valor'], ['A', 10], ['B', 20]]);
  limpar(t, nome);

  const r = await descreverPlanilha.executar(contexto({ arquivo: nome }));
  assert.equal(r.resolveu, true);
  assert.match(r.texto, /Cliente/);
  assert.match(r.texto, /Valor/);
});

test('consultar_planilha_generica: agrupar_por com coluna inexistente devolve a lista REAL, nunca adivinha', async (t) => {
  const nome = 'hab-agrupar-invalido.xlsx';
  escreverXlsx(nome, [['Cliente', 'Valor'], ['A', 10]]);
  limpar(t, nome);

  const r = await consultarPlanilhaGenerica.executar(contexto({ arquivo: nome, agrupar_por: 'ColunaQueNaoExiste' }));
  assert.equal(r.resolveu, false);
  assert.match(r.texto, /Cliente/);
  assert.match(r.texto, /Valor/);
});

test('consultar_planilha_generica: soma agrupada por coluna real', async (t) => {
  const nome = 'hab-soma.xlsx';
  escreverXlsx(nome, [
    ['Regiao', 'Valor'],
    ['Sul', 100],
    ['Sul', 50],
    ['Norte', 30],
  ]);
  limpar(t, nome);

  const r = await consultarPlanilhaGenerica.executar(
    contexto({ arquivo: nome, agrupar_por: 'Regiao', metrica: 'soma', coluna_metrica: 'Valor' }),
  );
  assert.equal(r.resolveu, true);
  assert.match(r.texto, /Sul/);
  assert.match(r.texto, /150/);
});

test('consultar_planilha_generica: pedir métrica numérica sem coluna_metrica recusa em vez de adivinhar', async (t) => {
  const nome = 'hab-sem-coluna-metrica.xlsx';
  escreverXlsx(nome, [['Regiao', 'Valor'], ['Sul', 10]]);
  limpar(t, nome);

  const r = await consultarPlanilhaGenerica.executar(contexto({ arquivo: nome, metrica: 'soma' }));
  assert.equal(r.resolveu, false);
  assert.match(r.texto, /coluna_metrica/);
});

test('diagnosticar_qualidade_planilha: planilha limpa diz explicitamente que não achou nada', async (t) => {
  const nome = 'hab-diagnostico-limpo.xlsx';
  escreverXlsx(nome, [['Nome', 'Valor'], ['A', 10], ['B', 11], ['C', 12], ['D', 13]]);
  limpar(t, nome);

  const r = await diagnosticarQualidadePlanilha.executar(contexto({ arquivo: nome }));
  assert.equal(r.resolveu, true);
  assert.match(r.texto, /não encontrei/i);
});

test('diagnosticar_qualidade_planilha: coluna suspeita aparece com hipótese, não como afirmação de causa', async (t) => {
  const nome = 'hab-diagnostico-suspeito.xlsx';
  const linhas: unknown[][] = [['Status']];
  for (let i = 0; i < 3; i += 1) linhas.push(['']);
  for (let i = 0; i < 7; i += 1) linhas.push(['X']);
  escreverXlsx(nome, linhas);
  limpar(t, nome);

  const r = await diagnosticarQualidadePlanilha.executar(contexto({ arquivo: nome }));
  assert.equal(r.resolveu, true);
  assert.match(r.texto, /Status/);
  assert.match(r.texto, /tenho alta confiança|minha leitura é que|é uma possibilidade/);
});

test('arquivo inexistente: as 3 habilidades devolvem resolveu:false sem lançar', async () => {
  const ctx = contexto({ arquivo: 'nao-existe-mesmo.xlsx' });
  const [d1, d2, d3] = await Promise.all([
    descreverPlanilha.executar(ctx),
    consultarPlanilhaGenerica.executar(ctx),
    diagnosticarQualidadePlanilha.executar(ctx),
  ]);
  assert.equal(d1.resolveu, false);
  assert.equal(d2.resolveu, false);
  assert.equal(d3.resolveu, false);
});
