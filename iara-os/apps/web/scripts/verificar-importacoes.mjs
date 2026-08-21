/**
 * Guarda contra o defeito que derrubou o deploy em 20/08/2026: um import cujo
 * arquivo ficou fora do `git add`.
 *
 * `cargasLuft.ts` passou a importar `../Cobertura` no commit eb30c75, e o
 * `servidor/nucleo/kernel/Cobertura.ts` — arquivo NOVO — só entrou no commit
 * seguinte. Na máquina de quem escreveu, tudo compilava: o arquivo estava lá,
 * apenas não estava no commit. No Railway o `next build` morreu com
 *
 *     Type error: Cannot find module '../Cobertura'
 *
 * Nenhum `tsc --noEmit` local pega isso, porque tsc lê o DISCO e o disco está
 * certo. O que estava errado era a ÁRVORE DO COMMIT. Por isso esta verificação
 * não olha arquivo nenhum do disco: ela lê o conteúdo e a lista de arquivos de
 * dentro do próprio objeto do git, que é exatamente o que o servidor de build
 * vai receber.
 *
 * É também o motivo de o hook checar TODOS os commits do push, não só a ponta:
 * o Railway construiu eb30c75, um commit do meio. Uma ponta verde não diz nada
 * sobre o que o host escolhe construir.
 *
 * Uso:
 *     node scripts/verificar-importacoes.mjs [ref]      # padrão: HEAD
 *
 * Sai com 1 e lista arquivo, linha e especificador de cada import que não
 * resolve dentro daquela árvore.
 */
import { execFileSync } from 'node:child_process';

const ref = process.argv[2] ?? 'HEAD';

/**
 * Roda git sem passar por shell — nada aqui precisa de aspas.
 *
 * SEMPRE ancorado na raiz do repositório (`-C`). `ls-tree` e `grep` são os dois
 * sensíveis ao diretório de onde se chama, e de formas DIFERENTES: chamado de
 * `iara-os/apps/web`, o `ls-tree` enxerga 910 dos 1.580 arquivos e os nomeia
 * relativo dali, enquanto o `grep` nomeia relativo dali mas procura onde o
 * pathspec mandar. Duas listas com convenções distintas não casam, e o
 * resultado não é erro: é uma verificação que aprova ou reprova o repositório
 * inteiro conforme o lado que estiver errado. Ancorar mata a classe toda.
 */
const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

function git(...args) {
  return execFileSync('git', ['-C', raiz, ...args], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
}

// Onde o app vive dentro do repositório. O `paths` do tsconfig (`@/*` -> `./*`)
// é relativo a esta pasta, não à raiz do git.
const APP = 'iara-os/apps/web';
// Pathspec do git é relativo ao diretório de onde se chama. `:(top)` ancora na
// raiz do repositório — sem isso, rodar de dentro de `apps/web` procuraria em
// `iara-os/apps/web/iara-os/apps/web` e não acharia nada. Um detector que não
// acha nada por engano parece aprovado, que é o pior jeito de falhar.
const ESCOPO = `:(top)${APP}`;

/** Todos os caminhos versionados naquela árvore — a verdade contra a qual se resolve. */
const existentes = new Set(
  git('ls-tree', '-r', '--full-name', '--name-only', ref).split('\n').filter(Boolean),
);

/**
 * As extensões que o resolvedor do TypeScript tenta, na ordem. `''` primeiro
 * porque o import pode já trazer a extensão (`./dados.json`).
 */
const SUFIXOS = [
  '', '.ts', '.tsx', '.d.ts', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs', '.json',
  '/index.ts', '/index.tsx', '/index.js', '/index.mjs',
];

function resolve(alvo) {
  for (const sufixo of SUFIXOS) if (existentes.has(alvo + sufixo)) return true;
  // TypeScript com `moduleResolution` moderno deixa escrever `./x.js` para um
  // arquivo que no disco é `./x.ts`. Sem isto, todo import assim vira falso
  // positivo — e um detector que grita sem motivo é desligado na primeira semana.
  const trocado = alvo.replace(/\.(js|mjs|cjs|jsx)$/, '');
  if (trocado !== alvo) {
    for (const sufixo of ['.ts', '.tsx', '.mts', '.cts', '.d.ts']) {
      if (existentes.has(trocado + sufixo)) return true;
    }
  }
  return false;
}

/** Junta um caminho relativo sem tocar no `path` do SO: git fala sempre com `/`. */
function juntar(base, relativo) {
  const partes = base.split('/');
  partes.pop(); // sai do arquivo, fica na pasta dele
  for (const parte of relativo.split('/')) {
    if (parte === '.' || parte === '') continue;
    if (parte === '..') partes.pop();
    else partes.push(parte);
  }
  return partes.join('/');
}

// Uma passada de `git grep` na árvore inteira em vez de um `git show` por
// arquivo: são ~1.600 arquivos, e mil processos custariam mais que a checagem.
let linhas = [];
try {
  linhas = git(
    // `--full-name`: sem ele o git imprime o caminho relativo ao diretório de
    // onde se chamou, e `ls-tree` imprime relativo à raiz. As duas listas não
    // casariam, NADA resolveria, e a verificação passaria a acusar o repositório
    // inteiro — ou, se ninguém olhasse a lista, a "achar" o defeito certo pelo
    // motivo errado. Foi o que aconteceu na primeira execução deste script.
    'grep', '--full-name', '-n', '-E', '-e',
    String.raw`(from|import|require)[[:space:]]*\(?[[:space:]]*['"](\.|@/)`,
    ref, '--', ESCOPO,
  ).split('\n').filter(Boolean);
} catch (erro) {
  // git grep sai com 1 quando não acha nada. Árvore sem import relativo é
  // estranha, mas não é falha desta verificação.
  if (erro.status !== 1) throw erro;
}

const PADROES = [
  /(?:^|[^\w$])(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]/,
  /^\s*import\s*['"]([^'"]+)['"]/,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/,
  /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/,
];

const faltas = [];

for (const bruta of linhas) {
  // Formato: <ref>:<caminho>:<linha>:<conteúdo>
  const resto = bruta.slice(ref.length + 1);
  const corte = resto.indexOf(':');
  const caminho = resto.slice(0, corte);
  const depois = resto.slice(corte + 1);
  const corte2 = depois.indexOf(':');
  const numero = depois.slice(0, corte2);
  const conteudo = depois.slice(corte2 + 1);

  if (!/\.(ts|tsx|mts|cts)$/.test(caminho)) continue;

  // Linha de comentário não importa nada. Vários arquivos deste repositório
  // DOCUMENTAM a sintaxe de import em docblock (`* \`import ... from '...'\``),
  // e sem esta linha cada um deles vira uma falta inventada.
  if (/^\s*(\*|\/\/|\/\*)/.test(conteudo)) continue;

  for (const padrao of PADROES) {
    const achado = conteudo.match(padrao);
    if (!achado) continue;
    const spec = achado[1];

    let alvo;
    if (spec.startsWith('@/')) alvo = `${APP}/${spec.slice(2)}`;
    else if (spec.startsWith('.')) alvo = juntar(caminho, spec);
    else break; // pacote do node_modules — não é assunto desta verificação

    if (!resolve(alvo)) faltas.push({ caminho, numero, spec, conteudo: conteudo.trim() });
    break;
  }
}

if (faltas.length > 0) {
  console.error(`\nimport sem arquivo na árvore de ${ref}:\n`);
  for (const f of faltas) {
    console.error(`  ${f.caminho}:${f.numero}`);
    console.error(`    ${f.spec}  —  não existe neste commit`);
    console.error(`    ${f.conteudo}\n`);
  }
  console.error(
    `${faltas.length} import(s) sem arquivo. O build vai quebrar com ` +
    `"Cannot find module".\nProvavelmente é arquivo novo que ficou fora do ` +
    `\`git add\` — confira com \`git status\`.\n`,
  );
  process.exit(1);
}

console.log(`importações de ${ref}: todas resolvem dentro do commit`);
