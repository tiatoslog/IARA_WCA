/**
 * Árvore de blocos → arquivo .docx (OOXML).
 *
 * Um .docx é um ZIP com XML dentro. O mínimo que o Word aceita são quatro
 * peças: a lista de tipos de conteúdo, a relação da raiz, o documento e os
 * estilos. Tudo o mais aqui — numeração, rodapé com número de página,
 * hiperlink — existe porque este documento é entregue impresso ou anexado, e
 * documento de transferência sem número de página não se usa numa reunião.
 *
 * Medidas do OOXML, para o código abaixo não parecer mágica:
 *   - meio-ponto (tamanho de fonte): 22 = 11 pt
 *   - twip (1/20 de ponto), para espaçamento: 240 = 12 pt
 *   - DXA (twip) para largura de tabela: 9070 ≈ largura útil de uma A4
 */
import { zipar } from './zip.mjs';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Um `<w:r>` — o trecho de texto com formatação própria. */
function trecho(texto, { forte, enfase, codigo, ligacao } = {}) {
  const props = [
    codigo
      ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/><w:shd w:val="clear" w:fill="F1F1EF"/>'
      : '',
    forte ? '<w:b/>' : '',
    enfase ? '<w:i/>' : '',
    ligacao ? '<w:color w:val="1B5E5A"/><w:u w:val="single"/>' : '',
  ].join('');

  // xml:space="preserve" não é detalhe: sem ele o Word come o espaço entre um
  // trecho em negrito e o texto seguinte, e as palavras grudam.
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(texto)}</w:t></w:r>`;
}

function partesXml(partes, relacoes) {
  return partes
    .map((p) => {
      if (p.t === 'codigo') return trecho(p.v, { codigo: true });
      if (p.t === 'forte') return trecho(p.v, { forte: true });
      if (p.t === 'enfase') return trecho(p.v, { enfase: true });
      if (p.t === 'link') {
        // Link externo precisa de uma relação própria. Link interno (âncora,
        // caminho de arquivo) vira só texto sublinhado: apontar para um
        // arquivo do repositório de dentro de um .docx não resolve para nada.
        if (!/^https?:/.test(p.href)) return trecho(p.v, { ligacao: true });
        const id = `rLig${relacoes.length + 1}`;
        relacoes.push({ id, alvo: p.href });
        return `<w:hyperlink r:id="${id}">${trecho(p.v, { ligacao: true })}</w:hyperlink>`;
      }
      return trecho(p.v);
    })
    .join('');
}

const paragrafo = (conteudo, estilo) =>
  `<w:p>${estilo ? `<w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>` : ''}${conteudo}</w:p>`;

function tabelaXml(bloco, relacoes) {
  const colunas = bloco.cabecalho.length;
  const largura = Math.floor(9070 / colunas);

  const celula = (partes, cabecalho) =>
    `<w:tc><w:tcPr><w:tcW w:w="${largura}" w:type="dxa"/>` +
    (cabecalho ? '<w:shd w:val="clear" w:fill="EFEDE7"/>' : '') +
    '</w:tcPr>' +
    `<w:p><w:pPr><w:pStyle w:val="Celula"/></w:pPr>${partesXml(
      cabecalho ? partes.map((p) => ({ ...p, t: p.t === 'codigo' ? 'codigo' : 'forte' })) : partes,
      relacoes,
    )}</w:p></w:tc>`;

  const linhas = [
    // tblHeader repete o cabeçalho quando a tabela quebra de página.
    `<w:tr><w:trPr><w:tblHeader/></w:trPr>${bloco.cabecalho.map((c) => celula(c, true)).join('')}</w:tr>`,
    ...bloco.linhas.map(
      (l) =>
        `<w:tr>${Array.from({ length: colunas }, (_, i) =>
          celula(l[i] ?? [{ t: 'texto', v: '' }], false),
        ).join('')}</w:tr>`,
    ),
  ].join('');

  const bordas = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
    .map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="D8D4C8"/>`)
    .join('');

  return (
    `<w:tbl><w:tblPr><w:tblW w:w="9070" w:type="dxa"/><w:tblBorders>${bordas}</w:tblBorders></w:tblPr>${linhas}</w:tbl>` +
    // Parágrafo vazio depois da tabela: sem ele, duas tabelas seguidas se
    // fundem numa só quando o Word abre o arquivo.
    '<w:p/>'
  );
}

export function gerarDocx(blocos, { titulo, subtitulo }) {
  const relacoes = [];
  const corpo = [];

  corpo.push(paragrafo(trecho(titulo), 'Titulo'));
  if (subtitulo) corpo.push(paragrafo(trecho(subtitulo), 'Subtitulo'));

  for (const b of blocos) {
    if (b.tipo === 'titulo') {
      corpo.push(paragrafo(partesXml(b.partes, relacoes), `Rubrica${Math.min(b.nivel, 4)}`));
    } else if (b.tipo === 'paragrafo') {
      corpo.push(paragrafo(partesXml(b.partes, relacoes)));
    } else if (b.tipo === 'lista') {
      for (const item of b.itens) {
        corpo.push(
          `<w:p><w:pPr><w:pStyle w:val="Item"/><w:numPr><w:ilvl w:val="${Math.min(item.nivel, 2)}"/>` +
            `<w:numId w:val="${b.ordenada ? 2 : 1}"/></w:numPr></w:pPr>${partesXml(item.partes, relacoes)}</w:p>`,
        );
      }
    } else if (b.tipo === 'tabela') {
      corpo.push(tabelaXml(b, relacoes));
    } else if (b.tipo === 'codigo') {
      // Cada linha vira um parágrafo próprio: quebra de linha dentro de um
      // <w:t> é ignorada, e o bloco inteiro sairia numa linha só.
      for (const linha of b.texto.split('\n')) {
        corpo.push(paragrafo(trecho(linha || ' ', { codigo: true }), 'Codigo'));
      }
    } else if (b.tipo === 'citacao') {
      corpo.push(paragrafo(partesXml(b.partes, relacoes), 'Citacao'));
    } else if (b.tipo === 'regua') {
      corpo.push(
        '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="D8D4C8"/></w:pBdr></w:pPr></w:p>',
      );
    }
  }

  const documento =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${corpo.join('')}` +
    '<w:sectPr><w:footerReference w:type="default" r:id="rRodape"/>' +
    '<w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418" w:header="709" w:footer="709"/>' +
    '</w:sectPr></w:body></w:document>';

  const relsDoc =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rNumeracao" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    '<Relationship Id="rRodape" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>' +
    relacoes
      .map(
        (r) =>
          `<Relationship Id="${r.id}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" ' +
          `Target="${esc(r.alvo)}" TargetMode="External"/>`,
      )
      .join('') +
    '</Relationships>';

  return zipar([
    { nome: '[Content_Types].xml', dados: TIPOS },
    { nome: '_rels/.rels', dados: RELS_RAIZ },
    { nome: 'docProps/core.xml', dados: propriedades(titulo, subtitulo) },
    { nome: 'word/document.xml', dados: documento },
    { nome: 'word/_rels/document.xml.rels', dados: relsDoc },
    { nome: 'word/styles.xml', dados: ESTILOS },
    { nome: 'word/numbering.xml', dados: NUMERACAO },
    { nome: 'word/footer1.xml', dados: RODAPE },
  ]);
}

const TIPOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/word/footer1.xml" ' +
  'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
  '<Override PartName="/docProps/core.xml" ' +
  'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>';

const RELS_RAIZ =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" ' +
  'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" ' +
  'Target="word/document.xml"/>' +
  '<Relationship Id="rId2" ' +
  'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" ' +
  'Target="docProps/core.xml"/>' +
  '</Relationships>';

const propriedades = (titulo, subtitulo) =>
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
  'xmlns:dc="http://purl.org/dc/elements/1.1/">' +
  `<dc:title>${esc(titulo)}</dc:title>` +
  `<dc:description>${esc(subtitulo ?? '')}</dc:description>` +
  '<dc:creator>IARA OS — scripts/docs/</dc:creator>' +
  '</cp:coreProperties>';

const RODAPE =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:p><w:pPr><w:jc w:val="center"/></w:pPr>' +
  '<w:r><w:rPr><w:sz w:val="16"/><w:color w:val="8A8578"/></w:rPr><w:fldChar w:fldCharType="begin"/></w:r>' +
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>' +
  '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';

const estilo = (id, nome, pPr, rPr) =>
  `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${nome}"/>` +
  `<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  '<w:docDefaults><w:rPrDefault><w:rPr>' +
  '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="21"/><w:lang w:val="pt-BR"/>' +
  '</w:rPr></w:rPrDefault>' +
  '<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>' +
  '</w:docDefaults>' +
  estilo('Titulo', 'Title', '<w:spacing w:after="60"/>', '<w:b/><w:sz w:val="52"/><w:color w:val="1B3A38"/>') +
  estilo('Subtitulo', 'Subtitle', '<w:spacing w:after="480"/>', '<w:sz w:val="24"/><w:color w:val="7A7568"/>') +
  estilo(
    'Rubrica1',
    'heading 1',
    '<w:spacing w:before="480" w:after="200"/><w:outlineLvl w:val="0"/>' +
      '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="6" w:color="D8D4C8"/></w:pBdr>',
    '<w:b/><w:sz w:val="34"/><w:color w:val="1B3A38"/>',
  ) +
  estilo(
    'Rubrica2',
    'heading 2',
    '<w:spacing w:before="360" w:after="160"/><w:outlineLvl w:val="1"/>',
    '<w:b/><w:sz w:val="27"/><w:color w:val="1B5E5A"/>',
  ) +
  estilo(
    'Rubrica3',
    'heading 3',
    '<w:spacing w:before="280" w:after="120"/><w:outlineLvl w:val="2"/>',
    '<w:b/><w:sz w:val="23"/><w:color w:val="2F4F4C"/>',
  ) +
  estilo(
    'Rubrica4',
    'heading 4',
    '<w:spacing w:before="240" w:after="100"/><w:outlineLvl w:val="3"/>',
    '<w:b/><w:sz w:val="21"/><w:color w:val="5A554A"/>',
  ) +
  estilo('Item', 'List Paragraph', '<w:spacing w:after="60"/><w:ind w:left="454"/>', '') +
  estilo('Celula', 'Cell', '<w:spacing w:before="60" w:after="60"/>', '<w:sz w:val="19"/>') +
  estilo(
    'Codigo',
    'Code',
    '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/><w:ind w:left="284"/>' +
      '<w:shd w:val="clear" w:fill="F7F6F2"/>',
    '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="18"/>',
  ) +
  estilo(
    'Citacao',
    'Quote',
    '<w:ind w:left="284"/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="C9C3B2"/></w:pBdr>',
    '<w:i/><w:color w:val="5A554A"/>',
  ) +
  '</w:styles>';

const MARCADORES = ['&#8226;', '&#9702;', '&#8259;'];

const nivel = (i, ordenada) =>
  `<w:lvl w:ilvl="${i}"><w:start w:val="1"/>` +
  `<w:numFmt w:val="${ordenada ? 'decimal' : 'bullet'}"/>` +
  `<w:lvlText w:val="${ordenada ? `%${i + 1}.` : MARCADORES[i]}"/>` +
  `<w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${454 + i * 340}" w:hanging="284"/></w:pPr>` +
  (ordenada ? '' : '<w:rPr><w:rFonts w:ascii="Segoe UI Symbol" w:hAnsi="Segoe UI Symbol"/></w:rPr>') +
  '</w:lvl>';

const NUMERACAO =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
  `<w:abstractNum w:abstractNumId="1">${[0, 1, 2].map((i) => nivel(i, false)).join('')}</w:abstractNum>` +
  `<w:abstractNum w:abstractNumId="2">${[0, 1, 2].map((i) => nivel(i, true)).join('')}</w:abstractNum>` +
  '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num>' +
  '<w:num w:numId="2"><w:abstractNumId w:val="2"/></w:num>' +
  '</w:numbering>';
