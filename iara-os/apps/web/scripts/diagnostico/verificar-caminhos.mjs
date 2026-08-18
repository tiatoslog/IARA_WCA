/**
 * Guarda contra a armadilha que quebra toda reorganização de pastas: o import
 * relativo que ficou apontando para o lugar antigo.
 *
 * POR QUE EXISTE: mover um arquivo um nível para baixo invalida TODOS os seus
 * `../` de uma vez. O `tsc --noEmit` pega os imports de TypeScript, mas não
 * pega o que o Node resolve em tempo de execução — `readFileSync` de um
 * caminho literal, `new URL(..., import.meta.url)`, um `.mjs` fora do
 * `tsconfig`. Esses só falham quando alguém roda o script, semanas depois.
 *
 * Roda a partir de iara-os/apps/web.  `npm run verificar`
 */
import { readFileSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';

const raiz = process.cwd();

/** Arquivos versionados que podem conter referência de caminho. */
const fontes = execSync('git ls-files', { encoding: 'utf8', cwd: raiz })
  .split('\n')
  .filter((a) => /\.(ts|tsx|mjs|js)$/.test(a) && existsSync(join(raiz, a)));

/**
 * Um import sem extensão pode resolver para vários arquivos reais. A ordem
 * segue a do resolvedor: o arquivo exato, depois as extensões, depois o index.
 * `.js` em código-fonte TypeScript é o alvo COMPILADO — `lib/marca.js` no
 * import significa `lib/marca.ts` no disco (é o modo `NodeNext`).
 */
function resolveAlvo(base, especificador) {
  const alvo = resolve(dirname(base), especificador);

  // Barra final = PASTA por construção. `new URL('../public/escritorio/', …)`
  // seguido de readdirSync é referência legítima, e exigir um arquivo ali
  // reprovaria código correto.
  if (especificador.endsWith('/')) {
    return existsSync(alvo) && statSync(alvo).isDirectory() ? alvo : null;
  }

  const semJs = alvo.replace(/\.js$/, '');
  const candidatos = [
    alvo,
    `${semJs}.ts`,
    `${semJs}.tsx`,
    `${alvo}.ts`,
    `${alvo}.tsx`,
    `${alvo}.mjs`,
    `${alvo}.js`,
    join(alvo, 'index.ts'),
    join(alvo, 'index.tsx'),
  ];
  return candidatos.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

const faltas = [];
let conferidos = 0;

for (const arquivo of fontes) {
  const absoluto = join(raiz, arquivo);
  const texto = readFileSync(absoluto, 'utf8');

  // 1) imports e re-exports relativos, estáticos e dinâmicos.
  const estaticos = [
    ...texto.matchAll(/(?:from|import)\s*\(?\s*['"](\.\.?\/[^'"]+)['"]/g),
  ].map((m) => m[1]);

  // 2) caminhos que o Node resolve em RUNTIME, não o compilador.
  const runtime = [
    ...texto.matchAll(/new URL\(\s*['"](\.\.?\/[^'"]+)['"]\s*,\s*import\.meta\.url/g),
  ].map((m) => m[1]);

  for (const esp of [...estaticos, ...runtime]) {
    conferidos++;
    if (!resolveAlvo(absoluto, esp)) faltas.push({ arquivo, esp });
  }
}

// 3) caminhos literais lidos a partir da RAIZ do app (cwd), não do arquivo.
const literais = [];
for (const arquivo of fontes) {
  const texto = readFileSync(join(raiz, arquivo), 'utf8');
  for (const m of texto.matchAll(
    /(?:readFileSync|readdirSync)\(\s*['"]((?:servidor|lib|components|app|dados|testes|scripts|public|ativos)\/[^'"]*)['"]/g,
  )) {
    literais.push({ arquivo, alvo: m[1] });
  }
  for (const m of texto.matchAll(
    /^const raiz = ['"]((?:servidor|lib|components|app|scripts)\/[^'"]*)['"]/gm,
  )) {
    literais.push({ arquivo, alvo: m[1] });
  }
}
for (const { arquivo, alvo } of literais) {
  conferidos++;
  if (!existsSync(join(raiz, alvo))) faltas.push({ arquivo, esp: `${alvo} (relativo à raiz do app)` });
}

if (faltas.length) {
  console.error(`\nReferências quebradas: ${faltas.length}\n`);
  for (const f of faltas) console.error(`  ${f.arquivo}\n    → ${f.esp}`);
  console.error('');
  process.exit(1);
}

console.log(`caminhos: ${conferidos} referências em ${fontes.length} arquivos, todas resolvem.`);
