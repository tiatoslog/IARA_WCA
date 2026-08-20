/**
 * A FAMÍLIA DE ARQUIVOS QUE NÃO EXISTIA — criar, renomear, mover, copiar.
 *
 * A auditoria de capacidades de 20/08/2026 mediu o buraco, e ele já tinha
 * aparecido na campanha antes disso, na voz da operadora:
 *
 *     "Cria um arquivo chamado notas-1029v1.txt na área de trabalho com o
 *      texto 'reuniao as 10h'."
 *
 * A IARA recusou — corretamente, porque a habilidade não existia:
 *
 *     "não tenho ferramenta de criação de arquivo de texto no catálogo:
 *      consigo criar pasta, mas escrever um .txt com conteúdo específico não
 *      está entre o que posso fazer."
 *
 * Recusa honesta é melhor que função falsa. Mas a lacuna é de PRODUTO, e é
 * esta família que a fecha.
 *
 * ================= AS REGRAS QUE VÊM DE `criarPasta` =================
 *
 * Nenhuma delas é nova; todas são a disciplina que o verbo irmão já tinha, e
 * copiá-la é deliberado — um verbo novo que invente as próprias regras é por
 * onde a allowlist vira decoração:
 *
 *   1. NOME, NUNCA CAMINHO. O operador escolhe um dos três locais nomeados
 *      (`area_de_trabalho`, `documentos`, `downloads`) e um nome validado. Não
 *      existe parâmetro de caminho — é o que impede travessia de diretório e o
 *      que impede a LLM de escrever em qualquer lugar do disco.
 *   2. `validarNomePasta` para o nome, mais a extensão conferida à parte.
 *   3. Toda ação verifica o MUNDO depois — `existsSync` no destino, e para
 *      conteúdo, o tamanho e o hash.
 *
 * ================= O QUE FICA DE FORA, E POR QUÊ =================
 *
 * `excluir_arquivo` NÃO entra nesta rodada. Apagar é o único verbo desta
 * família cujo erro não tem volta, e ele pede confirmação prévia do operador
 * (risco alto, como `acionar_energia`) — desenho que merece ser decidido com o
 * dono do produto, não junto de quatro verbos reversíveis.
 */

import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { AgenteLocal, validarNomeArquivo } from '../servidor/nucleo/AgenteLocal';

const OPERADOR = 'auditoria';

/**
 * Um sandbox com os três locais nomeados, e `USERPROFILE` apontado para ele.
 *
 * É o mesmo recurso da campanha (`Sandbox.ts`): sem os três diretórios,
 * `resolverRaiz` devolve `null` e a IARA recusa — e o teste mediria a recusa
 * achando que mediu a escrita.
 */
async function sandbox(): Promise<{ raiz: string; desfazer: () => Promise<void> }> {
  const raiz = await mkdtemp(path.join(tmpdir(), 'arq-'));
  for (const p of ['Desktop', 'Documents', 'Downloads']) {
    await mkdir(path.join(raiz, p), { recursive: true });
  }
  const antes = process.env.USERPROFILE;
  process.env.USERPROFILE = raiz;
  return {
    raiz,
    desfazer: async () => {
      if (antes === undefined) delete process.env.USERPROFILE;
      else process.env.USERPROFILE = antes;
      await rm(raiz, { recursive: true, force: true });
    },
  };
}

const naMesa = (raiz: string, nome: string): string => path.join(raiz, 'Desktop', nome);

// ===========================================================================
// 1. O nome do arquivo — a porta de segurança
// ===========================================================================

test('AR-01. nome de arquivo segue a regra da pasta, mais a extensão', () => {
  assert.equal(validarNomeArquivo('notas.txt'), 'notas.txt');
  assert.equal(validarNomeArquivo('  relatorio 2026.md  '), 'relatorio 2026.md');
  assert.equal(validarNomeArquivo('lista-de-cargas.csv'), 'lista-de-cargas.csv');
});

test('AR-02. travessia de diretório é RECUSADA', () => {
  for (const veneno of [
    '../fora.txt',
    '..\\fora.txt',
    'a/b.txt',
    'a\\b.txt',
    'C:\\Windows\\system32\\x.txt',
    '/etc/passwd',
    '..',
    '.',
  ]) {
    assert.equal(validarNomeArquivo(veneno), null, `aceitou "${veneno}"`);
  }
});

test('AR-03. extensão executável é RECUSADA', () => {
  /**
   * O verbo escreve conteúdo que a LLM redigiu. Deixar `.exe`, `.bat`, `.ps1`
   * ou `.cmd` passarem transformaria "criar arquivo" em "escrever programa e
   * deixar na Área de Trabalho de alguém" — e o duplo clique seguinte é do
   * operador, que confia no que a IARA pôs lá.
   */
  for (const perigo of [
    'x.exe',
    'x.bat',
    'x.cmd',
    'x.ps1',
    'x.vbs',
    'x.js',
    'x.msi',
    'x.scr',
    'x.lnk',
    'x.reg',
  ]) {
    assert.equal(validarNomeArquivo(perigo), null, `aceitou "${perigo}"`);
  }
});

test('AR-04. arquivo sem extensão é recusado — o operador precisa dizer o tipo', () => {
  assert.equal(validarNomeArquivo('notas'), null);
  assert.equal(validarNomeArquivo('CON.txt'), null, 'nome reservado do Windows');
});

// ===========================================================================
// 2. Criar arquivo
// ===========================================================================

test('AR-05. cria o arquivo com o conteúdo pedido, e o disco confirma', async () => {
  const s = await sandbox();
  try {
    const agente = new AgenteLocal();
    const r = await agente.criarArquivo(OPERADOR, 'notas.txt', 'area_de_trabalho', 'reuniao as 10h');

    const destino = naMesa(s.raiz, 'notas.txt');
    assert.ok(existsSync(destino), `o arquivo não nasceu: ${r}`);
    assert.equal(await readFile(destino, 'utf8'), 'reuniao as 10h');
    assert.match(r, /notas\.txt/);
  } finally {
    await s.desfazer();
  }
});

test('AR-06. arquivo que já existe NÃO é sobrescrito', async () => {
  /**
   * A regra é a de `criarPasta` ("já existe, não mexi em nada"), e aqui ela
   * vale dobrado: sobrescrever apagaria conteúdo do operador em silêncio, e
   * "criar" nunca deveria significar "destruir".
   */
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'notas.txt'), 'o que já estava lá');
    const agente = new AgenteLocal();
    const r = await agente.criarArquivo(OPERADOR, 'notas.txt', 'area_de_trabalho', 'novo');

    assert.equal(await readFile(naMesa(s.raiz, 'notas.txt'), 'utf8'), 'o que já estava lá');
    assert.match(r, /j[áa] existe/i);
  } finally {
    await s.desfazer();
  }
});

test('AR-07. conteúdo vazio é legítimo — arquivo em branco é arquivo', async () => {
  const s = await sandbox();
  try {
    const agente = new AgenteLocal();
    await agente.criarArquivo(OPERADOR, 'vazio.txt', 'documentos', '');
    const destino = path.join(s.raiz, 'Documents', 'vazio.txt');
    assert.ok(existsSync(destino));
    assert.equal((await stat(destino)).size, 0);
  } finally {
    await s.desfazer();
  }
});

test('AR-08. conteúdo grande demais é recusado ANTES de escrever', async () => {
  const s = await sandbox();
  try {
    const agente = new AgenteLocal();
    const r = await agente.criarArquivo(
      OPERADOR,
      'grande.txt',
      'area_de_trabalho',
      'x'.repeat(2_000_001),
    );
    assert.ok(!existsSync(naMesa(s.raiz, 'grande.txt')), 'escreveu mesmo assim');
    assert.match(r, /grande|limite/i);
  } finally {
    await s.desfazer();
  }
});

// ===========================================================================
// 3. Renomear, mover, copiar
// ===========================================================================

test('AR-09. renomeia dentro do mesmo local', async () => {
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'antigo.txt'), 'conteudo');
    const agente = new AgenteLocal();
    const r = await agente.renomearArquivo(OPERADOR, 'antigo.txt', 'novo.txt', 'area_de_trabalho');

    assert.ok(!existsSync(naMesa(s.raiz, 'antigo.txt')), 'o antigo continua lá');
    assert.equal(await readFile(naMesa(s.raiz, 'novo.txt'), 'utf8'), 'conteudo');
    assert.match(r, /novo\.txt/);
  } finally {
    await s.desfazer();
  }
});

test('AR-10. renomear para um nome OCUPADO não destrói o ocupante', async () => {
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'a.txt'), 'origem');
    await writeFile(naMesa(s.raiz, 'b.txt'), 'destino que ja existia');
    const agente = new AgenteLocal();
    const r = await agente.renomearArquivo(OPERADOR, 'a.txt', 'b.txt', 'area_de_trabalho');

    assert.equal(await readFile(naMesa(s.raiz, 'b.txt'), 'utf8'), 'destino que ja existia');
    assert.ok(existsSync(naMesa(s.raiz, 'a.txt')), 'a origem sumiu numa operação que falhou');
    assert.match(r, /j[áa] existe/i);
  } finally {
    await s.desfazer();
  }
});

test('AR-11. renomear o que não existe é recusa honesta, não silêncio', async () => {
  const s = await sandbox();
  try {
    const agente = new AgenteLocal();
    const r = await agente.renomearArquivo(OPERADOR, 'fantasma.txt', 'x.txt', 'area_de_trabalho');
    assert.match(r, /n[ãa]o encontrei|n[ãa]o existe/i);
  } finally {
    await s.desfazer();
  }
});

test('AR-12. move entre os locais nomeados', async () => {
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'mover.txt'), 'viajante');
    const agente = new AgenteLocal();
    await agente.moverArquivo(OPERADOR, 'mover.txt', 'area_de_trabalho', 'documentos');

    assert.ok(!existsSync(naMesa(s.raiz, 'mover.txt')));
    assert.equal(
      await readFile(path.join(s.raiz, 'Documents', 'mover.txt'), 'utf8'),
      'viajante',
    );
  } finally {
    await s.desfazer();
  }
});

test('AR-13. copiar deixa os DOIS', async () => {
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'copia.txt'), 'original');
    const agente = new AgenteLocal();
    await agente.copiarArquivo(OPERADOR, 'copia.txt', 'area_de_trabalho', 'downloads');

    assert.equal(await readFile(naMesa(s.raiz, 'copia.txt'), 'utf8'), 'original');
    assert.equal(
      await readFile(path.join(s.raiz, 'Downloads', 'copia.txt'), 'utf8'),
      'original',
    );
  } finally {
    await s.desfazer();
  }
});

test('AR-14. mover para o MESMO local não é operação — e não some com o arquivo', async () => {
  const s = await sandbox();
  try {
    await writeFile(naMesa(s.raiz, 'x.txt'), 'intacto');
    const agente = new AgenteLocal();
    const r = await agente.moverArquivo(OPERADOR, 'x.txt', 'area_de_trabalho', 'area_de_trabalho');
    assert.equal(await readFile(naMesa(s.raiz, 'x.txt'), 'utf8'), 'intacto');
    assert.match(r, /mesmo lugar|j[áa] est/i);
  } finally {
    await s.desfazer();
  }
});
