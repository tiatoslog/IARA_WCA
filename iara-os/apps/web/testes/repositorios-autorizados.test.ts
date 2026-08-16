/**
 * A TRAVA da orquestração de agentes de código.
 *
 * O pedido do usuário foi explícito: "Se alguém disser 'Abra Claude Code em
 * C:\Windows\System32', a IARA não deveria simplesmente obedecer."
 *
 * A defesa não é uma lista de padrões proibidos — é a FORMA do parâmetro. O
 * operador informa APELIDO, nunca caminho. Uma habilidade que aceitasse caminho
 * teria de se defender de `..\..\Windows`, de UNC, de link simbólico, de
 * `%SystemRoot%`, de nome curto 8.3, de barra trocada — e a regra que faltasse
 * seria a usada. Sem parâmetro de caminho não há nada a escapar.
 *
 * Estes testes provam as duas metades: que caminho nenhum entra pela porta do
 * operador, e que a configuração do ADMINISTRADOR também é validada em vez de
 * obedecida — porque `IARA_REPOS_AGENTE=sistema=C:\Windows\System32` é
 * sintaticamente perfeito.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  lerAllowlist,
  motivoDeRecusa,
  repositoriosDisponiveis,
  resolverRepositorio,
  VARIAVEL_REPOS,
} from '../servidor/nucleo/RepositoriosAutorizados';

/** Um repositório git de verdade: a raiz do próprio submódulo. */
const REPO_REAL = path.resolve(process.cwd(), '..', '..', '..');
/** Uma pasta real que NÃO é repositório: o `apps/web` deste projeto. */
const PASTA_SEM_GIT = process.cwd();

const amb = (valor: string): Record<string, string> => ({ [VARIAVEL_REPOS]: valor });

// ---------------------------------------------------------------------------
// 1. O caminho não é parâmetro — é a defesa inteira
// ---------------------------------------------------------------------------

test('pedir um caminho de sistema não resolve para repositório nenhum', () => {
  const ambiente = amb(`iara=${REPO_REAL}`);
  for (const pedido of [
    'C:\\Windows\\System32',
    'c:/windows/system32',
    '..\\..\\Windows',
    '/etc',
    '\\\\servidor\\share',
    'C:\\',
    '%SystemRoot%',
  ]) {
    assert.equal(
      resolverRepositorio(pedido, ambiente),
      null,
      `caminho aceito como repositório: ${pedido}`,
    );
  }
});

test('a frase do operador só alcança o repositório pelo APELIDO', () => {
  const ambiente = amb(`iara=${REPO_REAL}`);
  assert.equal(resolverRepositorio('iara', ambiente)?.caminho, REPO_REAL);
  assert.equal(resolverRepositorio('abra uma sessão no iara', ambiente)?.caminho, REPO_REAL);
  assert.equal(resolverRepositorio('projeto desconhecido', ambiente), null);
});

/** `iara` não pode casar dentro de `iarada` — apelido é palavra, não substring. */
test('o apelido casa por palavra inteira', () => {
  const ambiente = amb(`iara=${REPO_REAL}`);
  assert.equal(resolverRepositorio('iarada', ambiente), null);
  assert.equal(resolverRepositorio('xiara', ambiente), null);
  assert.ok(resolverRepositorio('no iara, por favor', ambiente));
});

test('apelido mais longo vence o mais curto', () => {
  const ambiente = amb(`iara=${REPO_REAL};iara-wca=${REPO_REAL}`);
  assert.equal(resolverRepositorio('trabalhe no iara-wca', ambiente)?.apelido, 'iara-wca');
});

// ---------------------------------------------------------------------------
// 2. A configuração do administrador também é validada
// ---------------------------------------------------------------------------

test('área de sistema é recusada mesmo vinda da variável de ambiente', () => {
  for (const proibido of [
    'C:\\Windows\\System32',
    'C:\\Windows',
    'C:\\Program Files\\algo',
    '/etc/nginx',
    '/usr/bin',
  ]) {
    const motivo = motivoDeRecusa('sistema', proibido);
    assert.ok(motivo, `caminho de sistema aceito na configuração: ${proibido}`);
    assert.match(motivo, /área de sistema/);
  }
});

/** `C:\projetos\..\Windows` precisa cair na mesma rede: a comparação é sobre o
 *  caminho JÁ resolvido, não sobre o texto. */
test('travessia embutida na configuração é resolvida antes de comparar', () => {
  const motivo = motivoDeRecusa('x', 'C:\\projetos\\..\\Windows\\System32');
  assert.ok(motivo);
  assert.match(motivo, /área de sistema/);
});

/** E o inverso: uma pasta cujo nome COMEÇA com o de uma raiz proibida não é
 *  filha dela. Comparar por prefixo de string erraria aqui. */
test('pasta com nome parecido com raiz de sistema não é confundida com ela', () => {
  const motivo = motivoDeRecusa('x', 'C:\\windows-projetos\\meu-repo');
  assert.ok(motivo);
  assert.ok(!/área de sistema/.test(motivo), `recusado como sistema: ${motivo}`);
});

test('caminho relativo e UNC são recusados', () => {
  assert.match(String(motivoDeRecusa('x', 'projetos/iara')), /absoluto/);
  assert.match(String(motivoDeRecusa('x', '\\\\servidor\\share')), /rede \(UNC\)/);
});

test('pasta inexistente é recusada, e o motivo diz isso', () => {
  const motivo = motivoDeRecusa('x', path.join(REPO_REAL, 'pasta-que-nao-existe-jamais'));
  assert.match(String(motivo), /não existe/);
});

/**
 * EXIGIR `.git` é o que impede um apelido de apontar para Documentos inteiro.
 * Um repositório tem fronteira e histórico: o que o agente fizer lá é revisável
 * e reversível. Fora de um, não é.
 */
test('pasta que não é repositório git é recusada', () => {
  const motivo = motivoDeRecusa('x', PASTA_SEM_GIT);
  assert.match(String(motivo), /não é um repositório git/);
});

test('repositório git de verdade é aceito — inclusive submódulo, onde .git é ARQUIVO', () => {
  assert.equal(motivoDeRecusa('iara', REPO_REAL), null);
});

test('apelido fora de forma é recusado', () => {
  for (const ruim of ['IARA MAIÚSCULA', 'com espaço', 'c:\\caminho', '../x', '', 'a'.repeat(33)]) {
    assert.ok(motivoDeRecusa(ruim, REPO_REAL), `apelido aceito: ${JSON.stringify(ruim)}`);
  }
});

// ---------------------------------------------------------------------------
// 3. Uma entrada ruim não derruba as boas, e nenhuma some em silêncio
// ---------------------------------------------------------------------------

test('entrada inválida vira recusa DECLARADA e as válidas continuam valendo', () => {
  const lista = lerAllowlist(amb(`iara=${REPO_REAL};sistema=C:\\Windows\\System32;quebrada`));
  assert.deepEqual(
    lista.autorizados.map((r) => r.apelido),
    ['iara'],
  );
  assert.equal(lista.recusadas.length, 2);
  assert.match(lista.recusadas[0].motivo, /área de sistema/);
  assert.match(lista.recusadas[1].motivo, /apelido=caminho/);
});

/** Deixar o ÚLTIMO vencer permitiria que uma entrada no fim da variável
 *  sequestrasse um apelido que a operadora já conhece. */
test('apelido repetido: vale o primeiro, e o segundo é declarado como recusado', () => {
  const lista = lerAllowlist(amb(`iara=${REPO_REAL};iara=${REPO_REAL}`));
  assert.equal(lista.autorizados.length, 1);
  assert.match(lista.recusadas[0].motivo, /repetido/);
});

test('variável ausente desliga a capacidade e a frase diz COMO ligar', () => {
  const lista = lerAllowlist({});
  assert.deepEqual(lista.autorizados, []);
  assert.match(repositoriosDisponiveis({}), new RegExp(VARIAVEL_REPOS));
  assert.equal(resolverRepositorio('iara', {}), null);
});

test('sem allowlist, nenhum pedido resolve — nem um apelido plausível', () => {
  for (const pedido of ['iara', 'projeto', 'repositório principal']) {
    assert.equal(resolverRepositorio(pedido, {}), null);
  }
});
