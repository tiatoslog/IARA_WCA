/**
 * Analisador do subconjunto de Markdown que esta documentação usa.
 *
 * POR QUE NÃO UMA BIBLIOTECA: o que sai daqui não é HTML. São três formatos
 * (HTML, OOXML e PDF) e os dois últimos precisam da ESTRUTURA, não de string
 * de marcação. Um conversor markdown→HTML obrigaria a reanalisar HTML para
 * chegar em Word e PDF — analisar duas vezes, com duas chances de errar.
 *
 * O subconjunto é o que os documentos do repositório realmente usam. Se um dia
 * precisar de mais, acrescente aqui: é melhor que a árvore diga "não sei o que
 * é isto" do que renderizar marcação crua no documento entregue ao cliente.
 */

/** @returns {Array<Bloco>} */
export function analisar(markdown) {
  const linhas = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocos = [];
  let i = 0;

  while (i < linhas.length) {
    const linha = linhas[i];

    if (!linha.trim()) { i++; continue; }

    // Bloco de código cercado. Conteúdo é literal: nada de inline aqui dentro.
    if (/^```/.test(linha)) {
      const lingua = linha.slice(3).trim();
      const corpo = [];
      i++;
      while (i < linhas.length && !/^```/.test(linhas[i])) corpo.push(linhas[i++]);
      i++; // fecha a cerca
      blocos.push({ tipo: 'codigo', lingua, texto: corpo.join('\n') });
      continue;
    }

    const titulo = /^(#{1,6})\s+(.*)$/.exec(linha);
    if (titulo) {
      blocos.push({ tipo: 'titulo', nivel: titulo[1].length, partes: emLinha(titulo[2]) });
      i++;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(linha)) {
      blocos.push({ tipo: 'regua' });
      i++;
      continue;
    }

    // Tabela: uma linha de cabeçalho seguida da linha de traços.
    if (/^\s*\|/.test(linha) && i + 1 < linhas.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(linhas[i + 1])) {
      const celulas = (l) => l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => emLinha(c.trim()));
      const cabecalho = celulas(linha);
      i += 2;
      const corpo = [];
      while (i < linhas.length && /^\s*\|/.test(linhas[i])) corpo.push(celulas(linhas[i++]));
      blocos.push({ tipo: 'tabela', cabecalho, linhas: corpo });
      continue;
    }

    if (/^\s*>\s?/.test(linha)) {
      const corpo = [];
      while (i < linhas.length && /^\s*>\s?/.test(linhas[i])) corpo.push(linhas[i++].replace(/^\s*>\s?/, ''));
      blocos.push({ tipo: 'citacao', partes: emLinha(corpo.join(' ')) });
      continue;
    }

    const marcador = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linha);
    if (marcador) {
      const ordenada = /\d/.test(marcador[2]);
      const itens = [];
      while (i < linhas.length) {
        const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(linhas[i]);
        if (!m || /\d/.test(m[2]) !== ordenada) break;
        // Continuação recuada pertence ao item anterior, não a um novo.
        let texto = m[3];
        i++;
        while (i < linhas.length && /^\s{2,}\S/.test(linhas[i]) && !/^\s*([-*+]|\d+[.)])\s/.test(linhas[i])) {
          texto += ' ' + linhas[i++].trim();
        }
        itens.push({ nivel: Math.floor(m[1].length / 2), partes: emLinha(texto) });
      }
      blocos.push({ tipo: 'lista', ordenada, itens });
      continue;
    }

    // Parágrafo: junta até a linha em branco.
    const corpo = [];
    while (
      i < linhas.length &&
      linhas[i].trim() &&
      !/^(#{1,6}\s|```|\s*>|\s*\|)/.test(linhas[i]) &&
      !/^\s*([-*+]|\d+[.)])\s/.test(linhas[i]) &&
      !/^(-{3,}|\*{3,}|_{3,})\s*$/.test(linhas[i])
    ) corpo.push(linhas[i++]);
    blocos.push({ tipo: 'paragrafo', partes: emLinha(corpo.join(' ')) });
  }

  return blocos;
}

/**
 * Marcação dentro da linha. A ordem importa: `código` é reconhecido ANTES de
 * **forte**, senão um asterisco literal dentro de um trecho de código viraria
 * negrito e o documento passaria a mentir sobre o que está escrito no arquivo.
 */
export function emLinha(texto) {
  const partes = [];
  const padrao = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)]+\))|(\*[^*]+\*)/g;
  let ultimo = 0;
  let m;

  while ((m = padrao.exec(texto))) {
    if (m.index > ultimo) partes.push({ t: 'texto', v: texto.slice(ultimo, m.index) });
    if (m[1]) partes.push({ t: 'codigo', v: m[1].slice(1, -1) });
    else if (m[2]) partes.push({ t: 'forte', v: m[2].slice(2, -2) });
    else if (m[3]) {
      const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(m[3]);
      partes.push({ t: 'link', v: link[1], href: link[2] });
    } else if (m[4]) partes.push({ t: 'enfase', v: m[4].slice(1, -1) });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) partes.push({ t: 'texto', v: texto.slice(ultimo) });
  return partes.length ? partes : [{ t: 'texto', v: '' }];
}

/** Texto puro de uma sequência de partes — para sumário e nome de âncora. */
export const puro = (partes) => partes.map((p) => p.v).join('');
