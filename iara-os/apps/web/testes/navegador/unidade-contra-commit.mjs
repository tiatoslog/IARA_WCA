/**
 * Roda um arquivo de teste da árvore de AGORA contra o CÓDIGO DE OUTRO COMMIT.
 *
 * Existe por causa de uma cobrança legítima da auditoria de garantia: a linha
 * CT-09 do test-plan exige "reprodução automatizada que FALHA antes da correção
 * e passa depois — saída bruta do teste", e a metade CC-01 tinha só o verde. O
 * vermelho não existia porque o teste nasceu junto com a correção; sem isto, a
 * única forma de produzi-lo seria desfazer a correção na árvore de trabalho,
 * com outra sessão possivelmente editando ao lado.
 *
 * Mesma mecânica do `--referencia` da bateria de navegador: espelho do app com
 * junção para `node_modules`, código copiado, e por cima a versão daquele
 * commit apenas dos arquivos que divergem. A árvore de trabalho não é tocada.
 *
 *   node testes/navegador/unidade-contra-commit.mjs 6aa2d3f testes/cross-talk-espelhos.test.ts
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const [commit, arquivoDeTeste] = process.argv.slice(2);
if (!commit || !arquivoDeTeste) {
  console.error('uso: node testes/navegador/unidade-contra-commit.mjs <commit> <arquivo-de-teste>');
  process.exit(2);
}

const COPIAR_DIR = ['servidor', 'lib', 'testes'];
const base = mkdtempSync(path.join(os.tmpdir(), 'iara-unidade-'));
const espelho = path.join(base, 'app');
mkdirSync(espelho, { recursive: true });

try {
  symlinkSync(path.join(APP, 'node_modules'), path.join(espelho, 'node_modules'), 'junction');
  for (const d of COPIAR_DIR) cpSync(path.join(APP, d), path.join(espelho, d), { recursive: true });
  for (const f of ['package.json', 'tsconfig.json']) {
    if (existsSync(path.join(APP, f))) cpSync(path.join(APP, f), path.join(espelho, f));
  }
  /* `dados/` é lido em tempo de execução por algumas habilidades do catálogo. */
  symlinkSync(path.join(APP, 'dados'), path.join(espelho, 'dados'), 'junction');

  const git = (args) => execFileSync('git', args, { cwd: APP, encoding: 'utf8' });
  const divergentes = git(['diff', '--name-only', commit, '--', '.'])
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let revertidos = 0;
  for (const rel of divergentes) {
    const dentro = rel.replace(/^.*?apps\/web\//, '');
    // O ARQUIVO DE TESTE não volta: é ele, o de agora, que precisa ser exercido
    // contra o código velho. Reverter os dois provaria nada.
    if (dentro === arquivoDeTeste) continue;
    if (!COPIAR_DIR.some((d) => dentro.startsWith(`${d}/`))) continue;
    try {
      writeFileSync(path.join(espelho, dentro), git(['show', `${commit}:${rel}`]));
    } catch {
      /* Não existia naquele commit: some do espelho. É o caso dos arquivos que
         nasceram com a correção — deixá-los seria misturar código novo com
         código velho e o resultado não provaria nada. */
      rmSync(path.join(espelho, dentro), { force: true });
    }
    revertidos += 1;
  }
  console.log(`[unidade] ${revertidos} arquivo(s) revertido(s) para ${commit}`);
  console.log(`[unidade] rodando ${arquivoDeTeste} contra esse código\n`);

  const r = spawnSync(
    process.execPath,
    [path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), '--test', arquivoDeTeste],
    { cwd: espelho, stdio: 'inherit', env: { ...process.env } },
  );
  process.exitCode = r.status ?? 1;
} finally {
  for (const d of ['node_modules', 'dados']) {
    try {
      rmSync(path.join(espelho, d), { recursive: false });
    } catch {
      /* junção já removida */
    }
  }
  try {
    rmSync(base, { recursive: true, force: true });
  } catch {
    console.warn(`[unidade] não removi ${base}`);
  }
}
