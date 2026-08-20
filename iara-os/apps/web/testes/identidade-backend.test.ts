/**
 * MD-08 — QUAL CÓDIGO ATENDEU ESTA EXECUÇÃO.
 *
 * O pedido da auditoria, em 20/08/2026, antes de liberar o push:
 *
 *     "Sem isso, o MD-07 fica frágil porque você consegue provar 'o Railway
 *      respondeu', mas não 'o Railway respondeu usando exatamente o código que
 *      acabou de ser auditado'."
 *
 * É a lição de 16/08 escrita de outro jeito — *"o ambiente da nuvem diverge do
 * local"* — e o custo dela é sempre o mesmo: uma tarde comparando o
 * comportamento de um localhost consertado com um servidor que roda outro
 * commit, e concluindo coisas sobre arquitetura a partir de uma diferença de
 * deploy.
 *
 * ================= A REGRA DESTE MÓDULO =================
 *
 * **Ele não inventa nada.** É a mesma disciplina de `lerStatusDaMaquina`: um
 * `git_sha` chutado é pior que `null`, porque `null` faz alguém ir procurar e
 * um sha errado faz alguém parar de procurar. Cada campo diz DE ONDE veio, e
 * a ausência é um valor legítimo com origem `nenhuma`.
 *
 * A ordem de procedência é do mais confiável para o menos:
 *
 *   1. `ambiente`  — `IARA_GIT_SHA` ou `RAILWAY_GIT_COMMIT_SHA`, carimbados
 *                    pelo pipeline que construiu a imagem;
 *   2. `disco`     — `.git/HEAD` resolvido à mão, para o motor de
 *                    desenvolvimento, onde o repositório está ali do lado;
 *   3. `nenhuma`   — e aí `git_sha` é `null`, dito em voz alta.
 */

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { lerIdentidadeBackend } from '../servidor/nucleo/IdentidadeBackend';

const SHA = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

test('IB-01. o sha do AMBIENTE vence, e a origem é declarada', () => {
  const id = lerIdentidadeBackend({
    ambiente: { IARA_GIT_SHA: SHA },
    raiz: '/nao/existe',
  });
  assert.equal(id.git_sha, SHA);
  assert.equal(id.git_origem, 'ambiente');
});

test('IB-02. o Railway carimba com outro nome, e ele também vale', () => {
  const id = lerIdentidadeBackend({
    ambiente: { RAILWAY_GIT_COMMIT_SHA: SHA },
    raiz: '/nao/existe',
  });
  assert.equal(id.git_sha, SHA);
  assert.equal(id.git_origem, 'ambiente');
});

test('IB-03. sem ambiente e sem repositório, o sha é NULL — nunca um palpite', () => {
  const id = lerIdentidadeBackend({ ambiente: {}, raiz: '/nao/existe' });
  assert.equal(id.git_sha, null);
  assert.equal(id.git_origem, 'nenhuma');
});

test('IB-04. o repositório do disco é lido quando o ambiente cala', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'ib-git-'));
  try {
    await mkdir(path.join(raiz, '.git', 'refs', 'heads'), { recursive: true });
    await writeFile(path.join(raiz, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(raiz, '.git', 'refs', 'heads', 'main'), `${SHA}\n`);

    const id = lerIdentidadeBackend({ ambiente: {}, raiz });
    assert.equal(id.git_sha, SHA);
    assert.equal(id.git_origem, 'disco');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('IB-05. HEAD destacado (sem ref) também é lido', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'ib-detached-'));
  try {
    await mkdir(path.join(raiz, '.git'), { recursive: true });
    await writeFile(path.join(raiz, '.git', 'HEAD'), `${SHA}\n`);
    const id = lerIdentidadeBackend({ ambiente: {}, raiz });
    assert.equal(id.git_sha, SHA);
    assert.equal(id.git_origem, 'disco');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('IB-06. sha malformado é RECUSADO, não repassado', () => {
  /**
   * Um valor que não é um sha não vira sha por estar numa variável com o nome
   * certo. Repassá-lo faria a telemetria afirmar procedência sobre lixo — que
   * é a família de defeito que esta auditoria inteira persegue.
   */
  for (const lixo of ['', '   ', 'HEAD', 'nao-é-um-sha', 'a1b2c3', '<script>']) {
    const id = lerIdentidadeBackend({ ambiente: { IARA_GIT_SHA: lixo }, raiz: '/nao/existe' });
    assert.equal(id.git_sha, null, `aceitou "${lixo}" como sha`);
    assert.equal(id.git_origem, 'nenhuma');
  }
});

test('IB-07. o ambiente é declarado, e "desconhecido" é um valor', () => {
  assert.equal(
    lerIdentidadeBackend({ ambiente: { IARA_AMBIENTE: 'producao' }, raiz: '/x' }).ambiente,
    'producao',
  );
  assert.equal(
    lerIdentidadeBackend({ ambiente: { NODE_ENV: 'production' }, raiz: '/x' }).ambiente,
    'producao',
  );
  assert.equal(lerIdentidadeBackend({ ambiente: {}, raiz: '/x' }).ambiente, 'desconhecido');
});

test('IB-08. a versão vem do package.json e nunca é inventada', () => {
  const id = lerIdentidadeBackend({ ambiente: {}, raiz: '/nao/existe' });
  /* Raiz inexistente: sem package.json para ler. `null`, e não "0.0.0". */
  assert.equal(id.versao, null);
});

test('IB-09. a identidade é ESTÁVEL dentro do processo', () => {
  /* Duas leituras seguidas com a mesma entrada devolvem o mesmo carimbo —
     senão duas linhas do jornal do mesmo turno poderiam discordar sobre qual
     código as produziu. */
  const a = lerIdentidadeBackend({ ambiente: { IARA_GIT_SHA: SHA }, raiz: '/x' });
  const b = lerIdentidadeBackend({ ambiente: { IARA_GIT_SHA: SHA }, raiz: '/x' });
  assert.equal(a.git_sha, b.git_sha);
  assert.equal(a.iniciado_em, b.iniciado_em, 'o instante de início é do PROCESSO, não da leitura');
});

test('IB-10. o resumo cabe numa linha de log e não vaza nada', () => {
  const id = lerIdentidadeBackend({
    ambiente: { IARA_GIT_SHA: SHA, IARA_AMBIENTE: 'producao', ANTHROPIC_API_KEY: 'sk-ant-segredo' },
    raiz: '/x',
  });
  const linha = JSON.stringify(id);
  assert.ok(!/sk-ant/.test(linha), 'a identidade carregou credencial junto');
  assert.ok(linha.length < 400, 'a identidade precisa caber ao lado de cada execução');
  /* O sha CURTO é o que se lê num relatório; o longo fica para conferir. */
  assert.equal(id.git_sha_curto, SHA.slice(0, 7));
});

test('IB-11. o .git do SUBMÓDULO é um ARQUIVO, e ele também é seguido', async () => {
  /**
   * Medido na subida real, 20/08/2026: `[iara] código: v1.0.0 · sha
   * desconhecido`. Duas razões, as duas específicas deste repositório:
   *
   *   1. o app mora em `iara-os/apps/web/` e o `.git` fica na raiz do
   *      repositório, alguns níveis acima;
   *   2. este repositório é um SUBMÓDULO, e num submódulo `.git` não é uma
   *      pasta — é um arquivo com `gitdir: ../.git/modules/<nome>` dentro.
   *
   * Um leitor que só espera a pasta devolve `null` para o caso mais comum
   * desta casa, que é justamente onde o sha importa.
   */
  const raiz = await mkdtemp(path.join(tmpdir(), 'ib-sub-'));
  try {
    const real = path.join(raiz, 'modules', 'IARA_WCA');
    await mkdir(path.join(real, 'refs', 'heads'), { recursive: true });
    await writeFile(path.join(real, 'HEAD'), 'ref: refs/heads/main\n');
    await writeFile(path.join(real, 'refs', 'heads', 'main'), `${SHA}\n`);

    /* O app, fundo na árvore, com o `.git`-arquivo lá em cima. */
    const app = path.join(raiz, 'projeto', 'iara-os', 'apps', 'web');
    await mkdir(app, { recursive: true });
    const relativo = path.relative(path.join(raiz, 'projeto'), real).split(path.sep).join('/');
    await writeFile(path.join(raiz, 'projeto', '.git'), `gitdir: ${relativo}\n`);

    const id = lerIdentidadeBackend({ ambiente: {}, raiz: app });
    assert.equal(id.git_sha, SHA, 'não subiu a árvore até o .git, ou não seguiu o gitdir');
    assert.equal(id.git_origem, 'disco');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('IB-12. sem .git em nenhum nível acima, continua NULL', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'ib-sem-git-'));
  try {
    const app = path.join(raiz, 'a', 'b', 'c');
    await mkdir(app, { recursive: true });
    const id = lerIdentidadeBackend({ ambiente: {}, raiz: app });
    assert.equal(id.git_sha, null);
    assert.equal(id.git_origem, 'nenhuma');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});
