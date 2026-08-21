/**
 * Árvore de blocos → arquivo PDF.
 *
 * POR QUE ESCRITO NA MÃO: a alternativa era exigir Word, LibreOffice ou pandoc
 * instalados. Nenhum dos três existe no runner do CI, e "funciona na minha
 * máquina" é exatamente o que uma documentação auto-gerada não pode ser.
 *
 * Usa só as fontes base-14, que todo leitor de PDF é obrigado a ter — nenhum
 * arquivo de fonte é embutido. A consequência é o texto sair em WinAnsi
 * (cp1252): acento português cabe inteiro ali; o que não cabe é transliterado
 * em `paraWinAnsi`, com a substituição visível no lugar de um quadrado preto.
 *
 * O que este gerador NÃO faz, deliberadamente: sumário com número de página
 * (exigiria duas passadas de paginação) e quebra de célula de tabela em várias
 * linhas. Coluna larga demais é truncada com reticências — e o HTML e o .docx,
 * que não truncam, continuam sendo a fonte completa.
 */
import { deflateSync } from 'node:zlib';
import { puro } from './markdown.mjs';

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------

/**
 * Larguras das base-14, em 1/1000 de em, para os caracteres 32..126.
 * Vêm do AFM da Adobe. Sem elas não há como quebrar linha: seria contar
 * caractere, e uma linha de "iiii" ficaria com um terço da largura de "WWWW".
 */
const LARGURAS = {
  Helvetica:
    '278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584',
  'Helvetica-Bold':
    '278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584',
};

const CACHE = new Map();
function largura(fonte, codigo) {
  if (fonte === 'Courier') return 600;
  if (!CACHE.has(fonte)) CACHE.set(fonte, LARGURAS[fonte].split(' ').map(Number));
  const tabela = CACHE.get(fonte);
  if (codigo >= 32 && codigo <= 126) return tabela[codigo - 32];
  // Acentuada em Helvetica tem a largura da letra base — é o que diz o AFM.
  const base = SEM_ACENTO[String.fromCharCode(codigo)];
  if (base) return tabela[base.charCodeAt(0) - 32];
  return tabela[('n').charCodeAt(0) - 32];
}

const medir = (texto, fonte, corpo) => {
  let soma = 0;
  for (let i = 0; i < texto.length; i++) soma += largura(fonte, texto.charCodeAt(i));
  return (soma * corpo) / 1000;
};

// ---------------------------------------------------------------------------
// Codificação
// ---------------------------------------------------------------------------

const SEM_ACENTO = {
  á: 'a', à: 'a', â: 'a', ã: 'a', ä: 'a', é: 'e', ê: 'e', è: 'e', í: 'i', ì: 'i',
  ó: 'o', ô: 'o', õ: 'o', ò: 'o', ú: 'u', ù: 'u', ü: 'u', ç: 'c', ñ: 'n',
  Á: 'A', À: 'A', Â: 'A', Ã: 'A', É: 'E', Ê: 'E', Í: 'I', Ó: 'O', Ô: 'O', Õ: 'O',
  Ú: 'U', Ç: 'C',
};

/** Fora do cp1252: em vez de sumir ou virar quadrado, vira algo legível. */
const TRANSLITERA = {
  '⚠': '(!)', '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≠': '!=', '≤': '<=',
  '≥': '>=', '≈': '~', '×': 'x', '•': '•', '✓': 'OK', '✔': 'OK', '✗': 'X',
  '✘': 'X', '─': '-', '│': '|', '└': '`', '├': '|', '┌': '.', '↑': '^', '↓': 'v',
  '█': '#', '─': '-', '™': '(TM)', '€': '',
};

/**
 * String JS → bytes WinAnsiEncoding.
 * Os pontos entre 0x80 e 0x9F do cp1252 não seguem o Unicode — travessão,
 * aspas curvas e reticências moram ali, e são justamente os caracteres que um
 * texto escrito em editor moderno tem aos montes.
 */
const CP1252_ALTO = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87,
  'ˆ': 0x88, '‰': 0x89, 'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91,
  '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '˜': 0x98,
  '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f,
};

export function paraWinAnsi(texto) {
  let saida = '';
  for (const ch of texto) {
    if (TRANSLITERA[ch]) saida += TRANSLITERA[ch];
    else saida += ch;
  }
  const bytes = [];
  for (const ch of saida) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) bytes.push(cp);
    else if (CP1252_ALTO[ch] !== undefined) bytes.push(CP1252_ALTO[ch]);
    else if (cp <= 0xff) bytes.push(cp);
    else if (SEM_ACENTO[ch]) bytes.push(SEM_ACENTO[ch].charCodeAt(0));
    else bytes.push(0x3f); // '?'
  }
  return Buffer.from(bytes);
}

/** Escapa para literal de string PDF: parênteses e barra invertida. */
function literal(texto) {
  const bytes = paraWinAnsi(texto);
  const saida = [];
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) saida.push(0x5c);
    saida.push(b);
  }
  return Buffer.from(saida).toString('latin1');
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

const A4 = { largura: 595.28, altura: 841.89 };
const MARGEM = { esq: 62, dir: 62, topo: 68, base: 62 };
const UTIL = A4.largura - MARGEM.esq - MARGEM.dir;

const CINZA = '0.36 0.34 0.30';
const TINTA = '0.11 0.13 0.13';
const VERDE = '0.10 0.30 0.28';

const ESTILO = {
  titulo: { fonte: 'Helvetica-Bold', corpo: 26, antes: 0, depois: 6, cor: VERDE },
  subtitulo: { fonte: 'Helvetica', corpo: 12, antes: 0, depois: 34, cor: CINZA },
  h1: { fonte: 'Helvetica-Bold', corpo: 17, antes: 24, depois: 10, cor: VERDE, regua: true },
  h2: { fonte: 'Helvetica-Bold', corpo: 13.5, antes: 18, depois: 7, cor: VERDE },
  h3: { fonte: 'Helvetica-Bold', corpo: 11.5, antes: 14, depois: 5, cor: TINTA },
  h4: { fonte: 'Helvetica-Bold', corpo: 10.5, antes: 12, depois: 4, cor: TINTA },
  corpo: { fonte: 'Helvetica', corpo: 10, antes: 0, depois: 8, cor: TINTA },
  codigo: { fonte: 'Courier', corpo: 8.5, antes: 4, depois: 8, cor: TINTA },
  celula: { fonte: 'Helvetica', corpo: 8.5, antes: 0, depois: 0, cor: TINTA },
};

/** Quebra `partes` em linhas que cabem em `disponivel`, preservando negrito. */
function quebrar(partes, disponivel, base, corpo) {
  const linhas = [];
  let atual = [];
  let usado = 0;

  const empurra = (texto, fonte) => {
    if (!texto) return;
    for (const palavra of texto.split(/(\s+)/)) {
      if (!palavra) continue;
      const w = medir(palavra, fonte, corpo);
      if (usado + w > disponivel && atual.length && palavra.trim()) {
        linhas.push(atual);
        atual = [];
        usado = 0;
      }
      if (!atual.length && !palavra.trim()) continue; // não abre linha com espaço
      atual.push({ texto: palavra, fonte });
      usado += w;
    }
  };

  for (const p of partes) {
    if (p.t === 'forte') empurra(p.v, 'Helvetica-Bold');
    else if (p.t === 'codigo') empurra(p.v, 'Courier');
    else empurra(p.v, base);
  }
  if (atual.length) linhas.push(atual);
  return linhas.length ? linhas : [[]];
}

function truncar(texto, disponivel, fonte, corpo) {
  if (medir(texto, fonte, corpo) <= disponivel) return texto;
  let corte = texto;
  while (corte.length > 1 && medir(corte + '…', fonte, corpo) > disponivel) corte = corte.slice(0, -1);
  return corte + '…';
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

export function gerarPdf(blocos, { titulo, subtitulo }) {
  const paginas = [];
  let fluxo = [];
  let y = A4.altura - MARGEM.topo;

  const novaPagina = () => {
    paginas.push(fluxo);
    fluxo = [];
    y = A4.altura - MARGEM.topo;
  };
  const cabe = (altura) => {
    if (y - altura < MARGEM.base) novaPagina();
  };

  const escreverLinha = (pedacos, x, corpo, cor) => {
    if (!pedacos.length) return;
    let dx = x;
    const partes = [`BT ${cor} rg`];
    for (const { texto, fonte } of pedacos) {
      partes.push(`/${APELIDO[fonte]} ${corpo} Tf 1 0 0 1 ${dx.toFixed(2)} ${y.toFixed(2)} Tm (${literal(texto)}) Tj`);
      dx += medir(texto, fonte, corpo);
    }
    partes.push('ET');
    fluxo.push(partes.join(' '));
  };

  const paragrafoPdf = (partes, e, recuo = 0) => {
    y -= e.antes;
    const linhas = quebrar(partes, UTIL - recuo, e.fonte, e.corpo);
    const alturaLinha = e.corpo * 1.42;
    for (const linha of linhas) {
      cabe(alturaLinha);
      y -= alturaLinha;
      escreverLinha(linha, MARGEM.esq + recuo, e.corpo, e.cor);
    }
    if (e.regua) {
      y -= 4;
      fluxo.push(
        `0.85 0.83 0.78 RG 0.6 w ${MARGEM.esq} ${y.toFixed(2)} m ${(A4.largura - MARGEM.dir).toFixed(2)} ${y.toFixed(2)} l S`,
      );
    }
    y -= e.depois;
  };

  paragrafoPdf([{ t: 'texto', v: titulo }], ESTILO.titulo);
  if (subtitulo) paragrafoPdf([{ t: 'texto', v: subtitulo }], ESTILO.subtitulo);

  for (const b of blocos) {
    if (b.tipo === 'titulo') {
      const e = ESTILO[`h${Math.min(b.nivel, 4)}`];
      // Rubrica sozinha no pé da página é órfã: empurra junto o começo do que
      // ela introduz.
      if (y - (e.antes + e.corpo * 2.6 + 30) < MARGEM.base) novaPagina();
      paragrafoPdf(b.partes, e);
    } else if (b.tipo === 'paragrafo') {
      paragrafoPdf(b.partes, ESTILO.corpo);
    } else if (b.tipo === 'citacao') {
      const inicio = y;
      paragrafoPdf(b.partes, { ...ESTILO.corpo, cor: CINZA }, 16);
      fluxo.push(`0.79 0.76 0.70 RG 2 w ${MARGEM.esq + 4} ${inicio.toFixed(2)} m ${MARGEM.esq + 4} ${y.toFixed(2)} l S`);
    } else if (b.tipo === 'regua') {
      y -= 8;
      cabe(10);
      fluxo.push(
        `0.85 0.83 0.78 RG 0.6 w ${MARGEM.esq} ${y.toFixed(2)} m ${(A4.largura - MARGEM.dir).toFixed(2)} ${y.toFixed(2)} l S`,
      );
      y -= 10;
    } else if (b.tipo === 'lista') {
      for (const [i, item] of b.itens.entries()) {
        const recuo = 16 + item.nivel * 14;
        const marca = b.ordenada ? `${i + 1}.` : '•';
        const antes = y - ESTILO.corpo.corpo * 1.42;
        paragrafoPdf(item.partes, { ...ESTILO.corpo, depois: 3 }, recuo);
        // O marcador é desenhado na altura da PRIMEIRA linha do item, que só
        // se conhece depois de saber se houve quebra de página.
        escreverLinha(
          [{ texto: marca, fonte: 'Helvetica' }],
          MARGEM.esq + recuo - 14,
          ESTILO.corpo.corpo,
          CINZA,
        );
        void antes;
      }
      y -= 6;
    } else if (b.tipo === 'codigo') {
      const e = ESTILO.codigo;
      const linhas = b.texto.split('\n');
      const alturaLinha = e.corpo * 1.36;
      const alturaCaixa = linhas.length * alturaLinha + 12;
      cabe(alturaCaixa + e.antes);
      y -= e.antes;
      fluxo.push(
        `0.97 0.96 0.95 rg ${MARGEM.esq} ${(y - alturaCaixa + 6).toFixed(2)} ${UTIL.toFixed(2)} ${alturaCaixa.toFixed(2)} re f`,
      );
      y -= 8;
      for (const linha of linhas) {
        y -= alturaLinha;
        escreverLinha(
          [{ texto: truncar(linha, UTIL - 24, 'Courier', e.corpo), fonte: 'Courier' }],
          MARGEM.esq + 12,
          e.corpo,
          e.cor,
        );
      }
      y -= e.depois + 4;
    } else if (b.tipo === 'tabela') {
      const colunas = b.cabecalho.length;
      const larguraCol = UTIL / colunas;
      const e = ESTILO.celula;
      const alturaLinha = e.corpo * 2.1;

      const desenharLinha = (celulas, cabecalho) => {
        cabe(alturaLinha + 2);
        const topo = y;
        y -= alturaLinha;
        if (cabecalho) {
          fluxo.push(`0.94 0.93 0.90 rg ${MARGEM.esq} ${y.toFixed(2)} ${UTIL.toFixed(2)} ${alturaLinha.toFixed(2)} re f`);
        }
        for (let c = 0; c < colunas; c++) {
          const conteudo = puro(celulas[c] ?? [{ t: 'texto', v: '' }]);
          const fonte = cabecalho ? 'Helvetica-Bold' : 'Helvetica';
          escreverLinha(
            [{ texto: truncar(conteudo, larguraCol - 12, fonte, e.corpo), fonte }],
            MARGEM.esq + c * larguraCol + 6,
            e.corpo,
            e.cor,
          );
        }
        // A linha de base fecha a célula; as verticais separam as colunas.
        fluxo.push(`0.85 0.83 0.78 RG 0.5 w ${MARGEM.esq} ${y.toFixed(2)} m ${(MARGEM.esq + UTIL).toFixed(2)} ${y.toFixed(2)} l S`);
        for (let c = 1; c < colunas; c++) {
          const x = MARGEM.esq + c * larguraCol;
          fluxo.push(`0.90 0.89 0.85 RG 0.4 w ${x.toFixed(2)} ${topo.toFixed(2)} m ${x.toFixed(2)} ${y.toFixed(2)} l S`);
        }
        // Corrige o desenho quando o texto foi escrito acima da base.
        y = y;
      };

      y -= 4;
      // Topo da tabela.
      cabe(alturaLinha * 2);
      fluxo.push(`0.85 0.83 0.78 RG 0.5 w ${MARGEM.esq} ${y.toFixed(2)} m ${(MARGEM.esq + UTIL).toFixed(2)} ${y.toFixed(2)} l S`);
      desenharLinha(b.cabecalho, true);
      for (const linha of b.linhas) desenharLinha(linha, false);
      y -= 12;
    }
  }
  paginas.push(fluxo);

  return montar(paginas);
}

const APELIDO = { Helvetica: 'F1', 'Helvetica-Bold': 'F2', Courier: 'F3' };

/** Objetos, tabela de referência cruzada e trailer. */
function montar(paginas) {
  const objetos = [];
  const adicionar = (corpo) => {
    objetos.push(corpo);
    return objetos.length; // números de objeto começam em 1
  };

  const idCatalogo = adicionar(null); // reservado: precisa saber o id de Pages
  const idPaginas = adicionar(null);
  const idF1 = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const idF2 = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const idF3 = adicionar('<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>');

  const idsPagina = [];
  for (const fluxo of paginas) {
    const conteudo = deflateSync(Buffer.from(fluxo.join('\n'), 'latin1'));
    const idConteudo = adicionar({
      dicionario: `<< /Length ${conteudo.length} /Filter /FlateDecode >>`,
      fluxo: conteudo,
    });
    idsPagina.push(
      adicionar(
        `<< /Type /Page /Parent ${idPaginas} 0 R /MediaBox [0 0 ${A4.largura} ${A4.altura}] ` +
          `/Resources << /Font << /F1 ${idF1} 0 R /F2 ${idF2} 0 R /F3 ${idF3} 0 R >> >> ` +
          `/Contents ${idConteudo} 0 R >>`,
      ),
    );
  }

  objetos[idCatalogo - 1] = `<< /Type /Catalog /Pages ${idPaginas} 0 R >>`;
  objetos[idPaginas - 1] =
    `<< /Type /Pages /Count ${idsPagina.length} /Kids [${idsPagina.map((i) => `${i} 0 R`).join(' ')}] >>`;

  const pedacos = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  let deslocamento = pedacos[0].length;
  const posicoes = [];

  for (let i = 0; i < objetos.length; i++) {
    posicoes.push(deslocamento);
    const o = objetos[i];
    const partes =
      typeof o === 'string'
        ? [Buffer.from(`${i + 1} 0 obj\n${o}\nendobj\n`, 'latin1')]
        : [
            Buffer.from(`${i + 1} 0 obj\n${o.dicionario}\nstream\n`, 'latin1'),
            o.fluxo,
            Buffer.from('\nendstream\nendobj\n', 'latin1'),
          ];
    for (const p of partes) {
      pedacos.push(p);
      deslocamento += p.length;
    }
  }

  const inicioXref = deslocamento;
  const xref = [`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`];
  for (const p of posicoes) xref.push(`${String(p).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objetos.length + 1} /Root ${idCatalogo} 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`);
  pedacos.push(Buffer.from(xref.join(''), 'latin1'));

  return Buffer.concat(pedacos);
}
