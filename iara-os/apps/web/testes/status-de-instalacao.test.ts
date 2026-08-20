/**
 * "NA VERSÃO ATUAL" É UMA AFIRMAÇÃO, E ELA PRECISA DE MEDIÇÃO.
 *
 * O DEFEITO, relatado pela operadora em 20/08/2026 com a tela na frente:
 *
 *     "tive que baixar o braço novamente no computador que estava com status
 *      conectado. ou seja, analise isso, os status estão coerentes???"
 *
 * Não estavam. A folha da Automação dizia, sobre uma máquina DESLIGADA desde
 * 16 de agosto:
 *
 *     ● Instalada em Homeoffice — na versão atual
 *
 * Duas mentiras em uma linha. O ponto verde (corrigido em `Automacao.tsx`) e
 * esta frase.
 *
 * ================= POR QUE A FRASE MENTE =================
 *
 * `MaquinaDoOperador.desatualizada` é `false` quando `versao` é `null`, e o
 * comentário do contrato explica por quê, com toda a razão:
 *
 *     "`false` quando `versao` é `null` — a máquina não está conectada agora,
 *      ou nunca reportou versão nenhuma. Não afirmar desatualização sobre um
 *      dado que não existe é a mesma disciplina que o resto do sistema já
 *      aplica a `sem_meio_de_verificar`."
 *
 * O contrato se recusa a dizer "desatualizada". A TELA então lia
 * `every(m => !m.desatualizada)` e concluía **"na versão atual"** — que é a
 * afirmação oposta, sobre o mesmo dado inexistente. O silêncio honesto do
 * contrato virava uma garantia na cara de quem lê.
 *
 * O custo é o que a operadora descreveu: a folha diz que está tudo em dia, o
 * computador não atende, e a pessoa reinstala às cegas porque a tela não lhe
 * deu nenhuma pista de que a versão nunca foi conferida.
 *
 * Três estados, e não dois: **atual**, **antiga**, e **não dá para saber**.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { frasearVersaoInstalada, type MaquinaDoOperador } from '../lib/execucao';

const maquina = (p: Partial<MaquinaDoOperador>): MaquinaDoOperador =>
  ({
    id: p.id ?? 'c1',
    nome: p.nome ?? 'Homeoffice',
    plataforma: 'win32',
    versao: p.versao ?? null,
    conectada: p.conectada ?? false,
    pareada: true,
    pareada_em: 0,
    vista_em: 0,
    desatualizada: p.desatualizada ?? false,
    atualizando: null,
    erroAtualizacao: null,
  }) as MaquinaDoOperador;

test('SI-01. máquina desligada NÃO é declarada "na versão atual"', () => {
  /* O caso exato da tela da operadora: uma máquina, desligada desde o dia 16,
     versão desconhecida. A frase antiga era " — na versão atual". */
  const f = frasearVersaoInstalada([maquina({ conectada: false, versao: null })]);
  assert.ok(!/vers[ãa]o atual/i.test(f), `afirmou versão sem medir: "${f}"`);
  assert.match(f, /desligad|n[ãa]o d[áa] para conferir|enquanto/i);
});

test('SI-02. máquina conectada e em dia PODE ser declarada atual', () => {
  const f = frasearVersaoInstalada([maquina({ conectada: true, versao: '1.3.0' })]);
  assert.match(f, /vers[ãa]o atual/i);
});

test('SI-03. versão antiga continua sendo dita, e ela vence o resto', () => {
  const f = frasearVersaoInstalada([
    maquina({ conectada: true, versao: '1.0.0', desatualizada: true }),
    maquina({ id: 'c2', nome: 'Pc Atos', conectada: false, versao: null }),
  ]);
  assert.match(f, /antig/i);
});

test('SI-04. com uma conferida e outra desligada, a frase não generaliza', () => {
  /**
   * O erro que esta linha evita é o de somar populações: uma máquina em dia
   * não autoriza dizer que "estão" em dia, e a outra é justamente a que a
   * pessoa não consegue usar.
   */
  const f = frasearVersaoInstalada([
    maquina({ id: 'c1', nome: 'Homeoffice', conectada: true, versao: '1.3.0' }),
    maquina({ id: 'c2', nome: 'Pc Atos', conectada: false, versao: null }),
  ]);
  assert.ok(!/^.*na vers[ãa]o atual$/i.test(f), `generalizou: "${f}"`);
  assert.match(f, /Pc Atos/, 'a máquina não conferida precisa ser nomeada');
});

test('SI-05. lista vazia não afirma nada', () => {
  assert.equal(frasearVersaoInstalada([]), '');
});
