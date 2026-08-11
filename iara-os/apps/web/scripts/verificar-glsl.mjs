/**
 * Guarda contra a armadilha que já custou três compilações quebradas: uma
 * CRASE dentro de um bloco GLSL.
 *
 * Os shaders da projeção moram em template literals. Escrever `uMatiz` num
 * comentário GLSL — hábito natural, porque é assim que se cita um símbolo em
 * comentário de TypeScript — FECHA o template ali, e o resto do shader vira
 * código JavaScript. O erro que o compilador reporta não menciona crase
 * nenhuma: ele aponta para uma palavra qualquer do comentário e diz
 * "Expected a semicolon", dezenas de linhas antes do problema real.
 *
 * Por isso a verificação existe: o custo de achar isso na mão é alto demais
 * para um erro tão barato de cometer. Dentro de GLSL, cite símbolos sem crase.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const raiz = 'components/projecao';
let faltas = 0;

for (const arquivo of readdirSync(raiz).filter((a) => /\.tsx?$/.test(a))) {
  const caminho = join(raiz, arquivo);
  const linhas = readFileSync(caminho, 'utf8').split(/\r?\n/);
  let dentro = false;

  linhas.forEach((linha, i) => {
    // Abertura: `/* glsl */ \`` — a marca que o repositório já usa em todos os
    // shaders. Fechamento: uma linha que só tem a crase e um delimitador.
    if (!dentro && /\/\* glsl \*\/\s*`/.test(linha)) {
      dentro = true;
      return;
    }
    if (!dentro) return;
    if (/^\s*`\s*[,;)]?\s*$/.test(linha)) {
      dentro = false;
      return;
    }
    if (linha.includes('`')) {
      console.error(`${caminho}:${i + 1}  crase dentro de bloco GLSL\n    ${linha.trim()}`);
      faltas += 1;
    }
  });
}

if (faltas > 0) {
  console.error(`\n${faltas} crase(s) em GLSL. Cite símbolos sem crase dentro do shader.`);
  process.exit(1);
}
console.log('GLSL: nenhuma crase solta.');
