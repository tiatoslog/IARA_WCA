/**
 * Ingestão dos POPs — `.pptx` → conhecimento estruturado.
 *
 * Lê `arquivos/procedimentos/*.pptx` e escreve a base que o SOS consulta:
 *   dados/procedimentos/<codigo>/<hash8>.json   uma por VERSÃO, nunca sobrescrita
 *   dados/procedimentos/indice.json             qual versão está vigente
 *   public/procedimentos/<codigo>/<sha8>.png    as capturas, endereçadas por conteúdo
 *
 * POR QUE ISTO É UM PARSER DECLARATIVO, E NÃO UM PIPELINE MULTIMODAL. Os 11 POPs
 * são um corpus REGULAR: mesmo template, mesmo autor, cabeçalho em posição fixa,
 * 226 setas que são shapes vetoriais com o número dentro e coordenada própria. A
 * estrutura inteira é calculável — sem OCR, sem modelo de visão, sem inferência.
 * Ferramenta genérica de "documento arbitrário" resolveria um problema que este
 * corpus não tem, e traria uma escala de relevância própria junto.
 *
 * SEM DEPENDÊNCIA NOVA. `.pptx` é ZIP, e o Node não lê ZIP — mas lê DEFLATE, e o
 * resto do formato é cabeçalho de tamanho fixo. Mesma escolha que o extrator de
 * PDF em `habilidades/dados.ts`: cem linhas conhecidas valem mais que uma
 * dependência a auditar, ainda mais num script que roda offline.
 *
 * NÃO ESCREVE EM `arquivos/procedimentos/`. Nenhum caminho de código altera POP
 * (❌ nº 3 da carta). Este script só LÊ de lá.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import type {
  Captura,
  Etapa,
  PassoDoPop,
  Procedimento,
  SlideDoPop,
} from '../../lib/procedimento';

// ---------------------------------------------------------------------------
// Onde as coisas ficam
// ---------------------------------------------------------------------------

const RAIZ_WEB = path.resolve(process.cwd());
const RAIZ_REPO = path.resolve(RAIZ_WEB, '..', '..', '..');
const ORIGEM = path.join(RAIZ_REPO, 'arquivos', 'procedimentos');
const DESTINO_BASE = path.join(RAIZ_WEB, 'dados', 'procedimentos');
const DESTINO_IMAGENS = path.join(RAIZ_WEB, 'public', 'procedimentos');

/**
 * A que sistema cada família de POP pertence — DECLARADO, nunca adivinhado.
 *
 * O cabeçalho diz "SISTEMA DE GESTÃO INTEGRADA", que é o nome do sistema da
 * QUALIDADE, não do software. Detectar o software por menção no texto ("achei
 * 'GW' no slide 4") seria exatamente a heurística que a proibição ❌ nº 5 existe
 * para impedir. Prefixo desconhecido derruba a ingestão, alto e claro: é a hora
 * barata de descobrir, e não em produção mandando alguém fazer no GW o que o POP
 * de outro sistema dizia.
 */
const SISTEMA_POR_PREFIXO: Record<string, string> = {
  'IT-ADMLUFT': 'GW',
};

/** EMU (English Metric Units) por ponto tipográfico. Constante do OOXML. */
const EMU_POR_PONTO = 12700;

/** Abaixo disto no slide é cabeçalho; acima, rodapé. Medido nos 11 arquivos. */
const FAIXA_CABECALHO_PT = 70;
const FAIXA_RODAPE_PT = 480;

// ---------------------------------------------------------------------------
// Leitor de ZIP
// ---------------------------------------------------------------------------

const ASSINATURA_FIM_CENTRAL = 0x06054b50;
const ASSINATURA_CENTRAL = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

/**
 * Descompacta um ZIP inteiro para memória. Um `.pptx` desta pasta tem no máximo
 * 1,4 MB — carregar tudo é mais simples e mais rápido que indexar sob demanda.
 */
function lerZip(buffer: Buffer): Map<string, Buffer> {
  // O fim do diretório central fica no final do arquivo, atrás de um comentário
  // de tamanho variável. Varre de trás para frente, que é o que a spec manda.
  let fim = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === ASSINATURA_FIM_CENTRAL) {
      fim = i;
      break;
    }
  }
  if (fim < 0) throw new Error('não é um ZIP válido: fim do diretório central não encontrado');

  const total = buffer.readUInt16LE(fim + 10);
  const inicioCentral = buffer.readUInt32LE(fim + 16);
  if (inicioCentral === 0xffffffff) {
    throw new Error('ZIP64 não suportado — nenhum POP desta pasta chega perto do limite');
  }

  const entradas = new Map<string, Buffer>();
  let p = inicioCentral;

  for (let n = 0; n < total; n += 1) {
    if (buffer.readUInt32LE(p) !== ASSINATURA_CENTRAL) {
      throw new Error(`entrada ${n} do diretório central com assinatura inválida`);
    }
    const metodo = buffer.readUInt16LE(p + 10);
    const tamanhoComprimido = buffer.readUInt32LE(p + 20);
    const tamanhoNome = buffer.readUInt16LE(p + 28);
    const tamanhoExtra = buffer.readUInt16LE(p + 30);
    const tamanhoComentario = buffer.readUInt16LE(p + 32);
    const deslocamentoLocal = buffer.readUInt32LE(p + 42);
    const nome = buffer.toString('utf8', p + 46, p + 46 + tamanhoNome);

    if (buffer.readUInt32LE(deslocamentoLocal) !== ASSINATURA_LOCAL) {
      throw new Error(`cabeçalho local inválido para "${nome}"`);
    }
    // O cabeçalho LOCAL pode ter `extra` de tamanho diferente do central — ler o
    // do central aqui é o erro clássico que desalinha o buffer em silêncio.
    const nomeLocal = buffer.readUInt16LE(deslocamentoLocal + 26);
    const extraLocal = buffer.readUInt16LE(deslocamentoLocal + 28);
    const inicioDados = deslocamentoLocal + 30 + nomeLocal + extraLocal;
    const bruto = buffer.subarray(inicioDados, inicioDados + tamanhoComprimido);

    if (metodo === 0) entradas.set(nome, Buffer.from(bruto));
    else if (metodo === 8) entradas.set(nome, inflateRawSync(bruto));
    else throw new Error(`método de compressão ${metodo} não suportado em "${nome}"`);

    p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }

  return entradas;
}

// ---------------------------------------------------------------------------
// XML: o mínimo necessário, sem biblioteca
// ---------------------------------------------------------------------------

/**
 * Blocos `<tag ...>...</tag>` de PRIMEIRO NÍVEL, respeitando aninhamento.
 *
 * Aninhamento importa de verdade aqui: um `<p:sp>` pode viver dentro de um
 * `<p:grpSp>`, e um regex ingênuo fecharia no primeiro `</p:sp>` que encontrasse,
 * partindo a forma ao meio. Também trata `<tag/>` vazia, que aparece bastante.
 */
/**
 * Abertura REAL da tag, a partir de `de`.
 *
 * O nome tem de terminar num delimitador. Sem esta checagem, procurar `<p:sp`
 * casa com `<p:spPr>` — que é filho de `<p:sp>` e existe em toda forma. A
 * contagem de profundidade estourava, cada slide virava UM bloco só, e o parser
 * devolvia "1 etapa, 0 passos" para os 11 arquivos sem quebrar nada: o defeito
 * mais caro de achar, porque produz resultado plausível em vez de erro.
 */
function aberturaDeTag(xml: string, tag: string, de: number): number {
  let p = de;
  for (;;) {
    const i = xml.indexOf(`<${tag}`, p);
    if (i < 0) return -1;
    const seguinte = xml[i + tag.length + 1];
    if (seguinte === ' ' || seguinte === '>' || seguinte === '/' || seguinte === '\n') return i;
    p = i + 1;
  }
}

function blocos(xml: string, tag: string): string[] {
  const achados: string[] = [];
  let cursor = 0;

  for (;;) {
    const inicio = aberturaDeTag(xml, tag, cursor);
    if (inicio < 0) break;

    const fimTagAbertura = xml.indexOf('>', inicio);
    if (fimTagAbertura < 0) break;
    // Tag vazia: `<p:sp/>` — nada dentro, nada a extrair.
    if (xml[fimTagAbertura - 1] === '/') {
      cursor = fimTagAbertura + 1;
      continue;
    }

    let profundidade = 1;
    let p = fimTagAbertura + 1;
    while (profundidade > 0 && p < xml.length) {
      const proximoAbre = aberturaDeTag(xml, tag, p);
      const proximoFecha = xml.indexOf(`</${tag}>`, p);
      if (proximoFecha < 0) break;
      if (proximoAbre >= 0 && proximoAbre < proximoFecha) {
        const fecha = xml.indexOf('>', proximoAbre);
        if (fecha > 0 && xml[fecha - 1] !== '/') profundidade += 1;
        p = fecha + 1;
      } else {
        profundidade -= 1;
        p = proximoFecha + tag.length + 3;
      }
    }
    achados.push(xml.slice(inicio, p));
    cursor = p;
  }

  return achados;
}

function atributo(xml: string, tag: string, atr: string): string | null {
  const m = new RegExp(`<${tag}[^>]*\\s${atr}="([^"]*)"`).exec(xml);
  return m ? m[1] : null;
}

/** Desfaz as cinco entidades do XML. O OOXML não usa outras em `<a:t>`. */
function desescapar(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * O texto de uma forma, com quebra por parágrafo `<a:p>`.
 *
 * Parágrafo vira linha porque no POP cada parágrafo É um passo ("4. Colocar Data
 * De", "5. Colocar data para"). Juntar tudo com espaço transformaria uma lista
 * numerada num parágrafo corrido e apagaria a estrutura que o documento tem.
 */
function textoDe(xml: string): string {
  return blocos(xml, 'a:p')
    .map((p) =>
      [...p.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((m) => desescapar(m[1])).join(''),
    )
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Posição e tamanho da forma, em PONTOS. `null` quando não há `<a:xfrm>`. */
function caixaDe(xml: string): Caixa | null {
  const off = /<a:off\s+x="(-?\d+)"\s+y="(-?\d+)"\s*\/>/.exec(xml);
  const ext = /<a:ext\s+cx="(\d+)"\s+cy="(\d+)"\s*\/>/.exec(xml);
  if (!off || !ext) return null;
  return {
    x: Number(off[1]) / EMU_POR_PONTO,
    y: Number(off[2]) / EMU_POR_PONTO,
    w: Number(ext[1]) / EMU_POR_PONTO,
    h: Number(ext[2]) / EMU_POR_PONTO,
  };
}

// ---------------------------------------------------------------------------
// Geometria das setas
// ---------------------------------------------------------------------------

const SETAS = new Set(['rightArrow', 'leftArrow', 'upArrow', 'downArrow']);

/**
 * Para onde a seta APONTA — a ponta, não o canto da caixa.
 *
 * É a diferença entre acertar e errar. No slide 2 do POP 001 a seta "1" começa em
 * x=14 e a captura à qual ela se refere começa em x=61: o CANTO da seta cai fora
 * da imagem, e só a ponta (x = 14 + largura) cai dentro. Ancorar pelo canto
 * produziria `null` justamente onde a marcação existe.
 */
function pontaDaSeta(forma: string, c: Caixa): { x: number; y: number } | null {
  const prst = atributo(forma, 'a:prstGeom', 'prst');
  if (!prst || !SETAS.has(prst)) return null;
  switch (prst) {
    case 'rightArrow':
      return { x: c.x + c.w, y: c.y + c.h / 2 };
    case 'leftArrow':
      return { x: c.x, y: c.y + c.h / 2 };
    case 'downArrow':
      return { x: c.x + c.w / 2, y: c.y + c.h };
    case 'upArrow':
      return { x: c.x + c.w / 2, y: c.y };
    default:
      return null;
  }
}

function contem(c: Caixa, p: { x: number; y: number }): boolean {
  return p.x >= c.x && p.x <= c.x + c.w && p.y >= c.y && p.y <= c.y + c.h;
}

// ---------------------------------------------------------------------------
// Leitura de um POP
// ---------------------------------------------------------------------------

interface Chrome {
  codigo: string | null;
  /**
   * O código EXATAMENTE como está escrito no cabeçalho, mesmo malformado.
   *
   * O POP 010 traz `IT-ADMLUF-010` — sem o `T` de ADMLUFT. Guardar o literal é o
   * que permite dizer *"o cabeçalho diz X e o arquivo diz Y"* em vez de afrouxar
   * o reconhecimento até engolir a corrupção calado.
   */
  codigoBruto: string | null;
  titulo: string | null;
  revisao: string | null;
  pagina: { atual: number; total: number } | null;
  aprovadoPor: string | null;
  data: string | null;
}

/**
 * Cabeçalho e rodapé, lidos por REGEX sobre o texto das formas de moldura — não
 * por coordenada exata.
 *
 * A posição serve para SEPARAR moldura de conteúdo (isso é estável nos 11); o
 * valor sai do texto. Casar valor por coordenada exata quebraria no primeiro POP
 * que alguém salvasse com a caixa dois pontos mais para a direita.
 */
function lerChrome(formas: { caixa: Caixa; texto: string }[]): Chrome {
  const moldura = formas
    .filter((f) => f.caixa.y < FAIXA_CABECALHO_PT || f.caixa.y > FAIXA_RODAPE_PT)
    .map((f) => f.texto)
    .join('\n');

  const codigo = /IT\s*-?\s*ADMLUFT\s*-?\s*(\d{3})/i.exec(moldura);
  const codigoBruto = /\bIT\s*-?\s*[A-Z]{3,}\s*-?\s*\d{3}\b/i.exec(moldura);
  const titulo = /INSTRU[ÇC][ÃA]O\s+DE\s+TRABALHO\s*:?\s*(.+)/i.exec(moldura);
  const revisao = /REV\.?\s*:?\s*(\d+)/i.exec(moldura);
  const pagina = /P[áa]gina\s*:?\s*(\d+)\s*\/\s*(\d+)/i.exec(moldura);
  /**
   * `[ \t]*` — NUNCA `\s*` — depois dos dois-pontos.
   *
   * Dois defeitos moraram nesta linha, e o segundo foi bem pior que o primeiro.
   * `(.+)` casava com o próprio dois-pontos de um campo vazio e produzia
   * `aprovado_por: ":"`. Trocado por `[^\s:]`, o `\s*` passou a atravessar a
   * QUEBRA DE LINHA e colher a primeira linha do slide seguinte: o POP 001
   * ganhou "PREENCHIMENTO PLANILHA E AGENDAMENTO" como aprovador, e o 008
   * ganhou "4".
   *
   * Um campo vazio lido como vazio é informação. Um campo vazio preenchido com
   * o texto ao lado é um aval FABRICADO — a proibição nº 2 da carta, e a que
   * mais convence alguém a confiar sem conferir.
   */
  const aprovado = /Aprovado\s+por[ \t]*:[ \t]*([^\s:][^\n]*)/i.exec(moldura);
  const data = /Data[ \t]*:[ \t]*(\d{2}\/\d{2}\/\d{2,4})/i.exec(moldura);

  return {
    codigo: codigo ? `IT-ADMLUFT-${codigo[1]}` : null,
    codigoBruto: codigoBruto ? codigoBruto[0].trim() : null,
    titulo: titulo ? titulo[1].trim() : null,
    revisao: revisao ? `REV.:${revisao[1].padStart(2, '0')}` : null,
    pagina: pagina ? { atual: Number(pagina[1]), total: Number(pagina[2]) } : null,
    aprovadoPor: aprovado ? aprovado[1].trim() : null,
    data: data ? data[1] : null,
  };
}

interface SlideLido {
  indice: number;
  /** O `Página: N/M` do rodapé — guardado só para DENUNCIAR divergência. */
  paginaDeclarada: number | null;
  etapaNumero: number | null;
  etapaTitulo: string | null;
  texto: string;
  /** Exceções declaradas neste slide, abaixo de um cabeçalho de particularidade. */
  particularidades: string[];
  passos: PassoDoPop[];
  capturas: Captura[];
  chrome: Chrome;
}

/**
 * Cabeçalho que declara exceção. O POP 010 traz "PARTICULARIDADES" no MEIO de um
 * slide que já tinha outro cabeçalho de etapa — por isso a busca é por qualquer
 * caixa do corpo, e não só pelo título da etapa.
 */
const TITULO_DE_EXCECAO =
  /^\s*(PARTICULARIDADES?|EXCE[ÇC][ÕO]ES|EXCE[ÇC][ÃA]O|ATEN[ÇC][ÃA]O|OBSERVA[ÇC][ÕO]ES)\b/i;

function lerSlide(
  xml: string,
  rels: Map<string, string>,
  midia: Map<string, Buffer>,
  indice: number,
  codigo: string,
  gravarImagem: (dados: Buffer, ext: string) => string,
): SlideLido {
  const formas = blocos(xml, 'p:sp')
    .map((f) => ({ bruto: f, caixa: caixaDe(f), texto: textoDe(f) }))
    .filter((f): f is { bruto: string; caixa: Caixa; texto: string } => f.caixa !== null);

  const chrome = lerChrome(formas);

  // --- capturas -----------------------------------------------------------
  const capturas: Captura[] = [];
  const caixaPorEmbed = new Map<string, Caixa>();

  for (const pic of blocos(xml, 'p:pic')) {
    const embed = atributo(pic, 'a:blip', 'r:embed');
    const caixa = caixaDe(pic);
    if (!embed || !caixa) continue;

    const alvo = rels.get(embed);
    if (!alvo) continue;
    const ext = path.extname(alvo).toLowerCase().replace('.', '');
    // O `.emf` é o logo da moldura, idêntico nos 11 arquivos e em todo slide.
    // Não é captura de tela; entra na base só como ruído.
    if (ext !== 'png' && ext !== 'jpg' && ext !== 'jpeg') continue;

    const dados = midia.get(alvo);
    if (!dados) continue;

    const dimensao = dimensaoPng(dados);
    capturas.push({
      url: gravarImagem(dados, ext),
      largura: dimensao?.largura ?? 0,
      altura: dimensao?.altura ?? 0,
      caixa,
    });
    caixaPorEmbed.set(embed, caixa);
  }

  // --- passos -------------------------------------------------------------
  const passos: PassoDoPop[] = [];
  for (const f of formas) {
    const ponta = pontaDaSeta(f.bruto, f.caixa);
    if (!ponta) continue;

    const rotulo = f.texto.replace(/\s+/g, ' ').trim();
    const numero = /^\d+$/.test(rotulo) ? Number(rotulo) : null;

    // A captura que CONTÉM a ponta. Nenhuma? `ancora: null`, e fica null —
    // escolher "a mais próxima" produziria uma marcação que parece precisa e
    // aponta para o lugar errado.
    const dentro = capturas.find((c) => contem(c.caixa, ponta));
    passos.push({
      ordem: numero,
      rotulo,
      ancora: dentro
        ? {
            captura: dentro.url,
            x: Number(((ponta.x - dentro.caixa.x) / dentro.caixa.w).toFixed(4)),
            y: Number(((ponta.y - dentro.caixa.y) / dentro.caixa.h).toFixed(4)),
          }
        : null,
    });
  }
  passos.sort((a, b) => (a.ordem ?? 999) - (b.ordem ?? 999));

  // --- corpo --------------------------------------------------------------
  const corpo = formas.filter(
    (f) =>
      f.caixa.y >= FAIXA_CABECALHO_PT &&
      f.caixa.y <= FAIXA_RODAPE_PT &&
      !pontaDaSeta(f.bruto, f.caixa) &&
      f.texto.length > 0,
  );

  /**
   * O cabeçalho de etapa é a caixinha estreita colada na quina esquerda, logo
   * abaixo da moldura — medida nos 11 arquivos em (0,70) 45x23, com o título em
   * (46,70) 365x29.
   *
   * O TAMANHO entra no critério, não só a posição. Sem ele, qualquer marcador
   * numerado de passo que caísse na faixa de cima virava "número da etapa": foi
   * assim que o POP 001 passou a declarar as etapas 1, 2 e **7**, e o POP 002
   * ganhou uma etapa "0" sem título.
   */
  const caixaNumero = corpo.find(
    (f) =>
      f.caixa.x < 12 &&
      f.caixa.y >= 60 &&
      f.caixa.y <= 100 &&
      f.caixa.w <= 60 &&
      /^\d{1,2}$/.test(f.texto.trim()),
  );
  const caixaTitulo = corpo.find(
    (f) =>
      f.caixa.x >= 35 &&
      f.caixa.x <= 140 &&
      f.caixa.y >= 60 &&
      f.caixa.y <= 105 &&
      f.caixa.w >= 150 &&
      f.texto.trim().length > 2,
  );

  const restante = corpo
    .filter((f) => f !== caixaNumero && f !== caixaTitulo)
    .sort((a, b) => a.caixa.y - b.caixa.y || a.caixa.x - b.caixa.x);

  /**
   * Onde começam as exceções neste slide.
   *
   * Pode ser o próprio título da etapa (POP 001 slide 6: "PARTICULARIDADES -
   * AGENDAMENTO", o slide inteiro é exceção) ou uma caixa no meio do slide (POP
   * 010, que tem etapa e particularidades no mesmo slide). Tudo ABAIXO do
   * cabeçalho de exceção é exceção; o que está acima continua sendo passo.
   */
  // `-1` quando o slide INTEIRO é exceção (o título da etapa já é o cabeçalho de
  // particularidade): aí tudo o que vier abaixo de `-1` — ou seja, tudo — entra.
  const yExcecao: number | null =
    caixaTitulo && TITULO_DE_EXCECAO.test(caixaTitulo.texto)
      ? -1
      : (restante.find((f) => TITULO_DE_EXCECAO.test(f.texto))?.caixa.y ?? null);

  const particularidades: string[] = [];
  const corpoNormal: typeof restante = [];
  for (const f of restante) {
    if (yExcecao !== null && f.caixa.y > yExcecao) {
      if (TITULO_DE_EXCECAO.test(f.texto) && f.texto.trim().length < 40) continue;
      for (const linha of f.texto.split('\n').map((l) => l.trim()).filter(Boolean)) {
        // Número solto é marcador de etapa ou de passo que caiu na faixa, não
        // exceção. "2" não avisa ninguém de nada.
        if (/^\d{1,2}$/.test(linha)) continue;
        particularidades.push(linha);
      }
    } else {
      corpoNormal.push(f);
    }
  }

  return {
    indice,
    paginaDeclarada: chrome.pagina?.atual ?? null,
    etapaNumero: caixaNumero ? Number(caixaNumero.texto.trim()) : null,
    etapaTitulo: caixaTitulo ? caixaTitulo.texto.replace(/\s+/g, ' ').trim() : null,
    texto: corpoNormal.map((f) => f.texto).join('\n').trim(),
    particularidades,
    passos,
    capturas,
    chrome,
  };
}

/** Largura e altura de um PNG — bytes 16..24 do chunk IHDR. Sem dependência. */
function dimensaoPng(b: Buffer): { largura: number; altura: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20) };
}

// ---------------------------------------------------------------------------
// Montagem do procedimento
// ---------------------------------------------------------------------------

function montar(
  arquivo: string,
  slides: SlideLido[],
  hash: string,
  ingeridoEm: string,
  codigoDoNome: string,
): Procedimento {
  const chrome = slides.map((s) => s.chrome);
  const doCabecalho = chrome.find((c) => c.codigo)?.codigo ?? null;
  const bruto = chrome.find((c) => c.codigoBruto)?.codigoBruto ?? null;

  /**
   * O nome do arquivo é a SEGUNDA fonte, não a primeira — e ela existe porque o
   * cabeçalho do POP 010 está com erro de digitação (`IT-ADMLUF-010`). Cair para
   * o nome do arquivo e ANOTAR a divergência é diferente de afrouxar o regex
   * até aceitar qualquer coisa: aqui as duas fontes continuam sendo comparadas,
   * e a discordância vira lacuna que sai na resposta.
   */
  const codigo = doCabecalho ?? codigoDoNome;
  const divergencia =
    !doCabecalho && bruto
      ? `o cabeçalho traz "${bruto}", diferente do código do arquivo (${codigoDoNome})`
      : null;
  if (!doCabecalho && !bruto) {
    throw new Error(`${arquivo}: não achei código nenhum no cabeçalho`);
  }

  const prefixo = codigo.replace(/-\d{3}$/, '');
  const sistema = SISTEMA_POR_PREFIXO[prefixo];
  if (!sistema) {
    throw new Error(
      `${arquivo}: prefixo "${prefixo}" não está em SISTEMA_POR_PREFIXO. ` +
        'Declare o sistema antes de ingerir — adivinhar sistema é a proibição nº 5.',
    );
  }

  const titulo = chrome.find((c) => c.titulo)?.titulo ?? path.basename(arquivo, '.pptx');
  const aprovadoPor = chrome.find((c) => c.aprovadoPor)?.aprovadoPor ?? null;
  const vigenteDesde = chrome.find((c) => c.data)?.data ?? null;

  // A revisão sai como está. O POP 006 traz REV.:01 e REV.:02 no MESMO arquivo,
  // e normalizar isso em silêncio esconderia justamente o que precisa aparecer.
  const revisoes = [...new Set(chrome.map((c) => c.revisao).filter(Boolean))] as string[];
  const revisao = revisoes.join(' / ') || 'não informada';

  const particularidades: string[] = [];
  const porEtapa = new Map<number, SlideDoPop[]>();
  const tituloEtapa = new Map<number, string>();

  /**
   * A etapa PERSISTE entre slides. Só o primeiro slide de cada macro-passo traz
   * a caixinha com o número; os seguintes continuam nele — no POP 001 a etapa 2
   * cobre os slides 2 a 6, e apenas o slide 2 a declara. Sem carregar o número
   * adiante, cada slide sem cabeçalho virava uma etapa órfã.
   */
  let etapaCorrente = 1;

  for (const s of slides) {
    particularidades.push(...s.particularidades);
    if (s.etapaNumero !== null) etapaCorrente = s.etapaNumero;
    if (s.etapaTitulo && !tituloEtapa.has(etapaCorrente)) {
      tituloEtapa.set(etapaCorrente, s.etapaTitulo);
    }

    // Slide que era só exceção não vira passo do procedimento.
    if (s.texto.length === 0 && s.passos.length === 0) continue;

    const lista = porEtapa.get(etapaCorrente) ?? [];
    lista.push({
      indice: s.indice,
      texto: s.texto,
      passos: s.passos,
      capturas: s.capturas,
    });
    porEtapa.set(etapaCorrente, lista);
  }

  const etapas: Etapa[] = [...porEtapa.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([numero, lista]) => ({
      numero,
      titulo: tituloEtapa.get(numero) ?? 'sem título no documento',
      slides: lista.sort((a, b) => a.indice - b.indice),
    }));

  const lacunas: string[] = [];
  if (divergencia) lacunas.push(divergencia);

  // O rodapé "Página: N/M" é campo com valor em cache e mente quando alguém
  // duplica slide. A ordem vale; a divergência é registrada para quem for
  // arrumar o documento saber que existe.
  const paginaDivergente = slides.filter(
    (s) => s.paginaDeclarada !== null && s.paginaDeclarada !== s.indice,
  ).length;
  if (paginaDivergente > 0) {
    lacunas.push(
      `o rodapé "Página: N/M" diverge da ordem real em ${paginaDivergente} de ` +
        `${slides.length} slides`,
    );
  }

  if (!aprovadoPor) lacunas.push('o documento não informa quem aprovou');
  if (!vigenteDesde) lacunas.push('o documento não informa data de vigência');
  if (revisoes.length > 1) {
    lacunas.push(`o documento traz mais de uma revisão (${revisoes.join(', ')})`);
  }
  if (particularidades.length === 0) {
    lacunas.push('o documento não declara exceções ou casos particulares');
  }
  const semTexto = slides.filter((s) => s.texto.length < 80).length;
  if (semTexto > 0) {
    lacunas.push(
      `${semTexto} de ${slides.length} slides trazem pouca instrução escrita — ` +
        'a informação está na captura de tela',
    );
  }
  lacunas.push('o documento não cataloga mensagens de erro');

  const objetivoSlide = slides.find((s) => /OBJETIVO/i.test(s.etapaTitulo ?? ''));

  /**
   * A qualidade é CALCULADA, nunca digitada — mesma disciplina de
   * `criarHipotese` em `Investigacao.ts`, onde ninguém escreve `confianca`.
   *
   * `contraditorio` vence `incompleto` porque são problemas de gravidade
   * diferente: faltar aprovador atrapalha a citação; discordar de si mesmo
   * impede saber qual sequência a pessoa deve seguir.
   */
  const qualidade: Procedimento['qualidade'] =
    revisoes.length > 1 || divergencia
      ? 'contraditorio'
      : !aprovadoPor || !vigenteDesde
        ? 'incompleto'
        : 'completo';

  return {
    codigo,
    titulo,
    sistema,
    revisao,
    // Primeira ingestão de um código é `oficial`: o POP JÁ é o procedimento
    // oficial, aprovado fora deste sistema por quem o escreveu. O que exige
    // validação humana é a MUDANÇA — ver `estadoDaVersao`.
    estado: 'oficial',
    qualidade,
    arquivo_origem: path.basename(arquivo),
    hash_origem: hash,
    ingerido_em: ingeridoEm,
    objetivo: objetivoSlide?.texto ?? null,
    etapas,
    particularidades,
    aprovado_por: aprovadoPor,
    vigente_desde: vigenteDesde,
    lacunas,
  };
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

interface EntradaIndice {
  vigente: string;
  versoes: { hash: string; ingerido_em: string; estado: string; arquivo_origem: string }[];
}

/**
 * A ordem REAL de apresentação, lida de `ppt/presentation.xml`.
 *
 * NÃO é a ordem numérica de `slideN.xml` (que é ordem de criação, não de
 * exibição) e MUITO menos o "Página: N/M" do rodapé. Aquele rodapé é um campo
 * com valor em CACHE: duplicar um slide no PowerPoint copia o número junto, e
 * foi assim que a primeira ingestão produziu `[1,1,1,2]` para o POP 002 e seis
 * slides "1" no POP 008. Um índice de etapa errado é pior que ausente — a IARA
 * diria "etapa 1 de 9" três vezes seguidas para alguém tentando se localizar.
 */
function ordemDosSlides(zip: Map<string, Buffer>): string[] {
  const apresentacao = zip.get('ppt/presentation.xml')?.toString('utf8') ?? '';
  const rels = zip.get('ppt/_rels/presentation.xml.rels')?.toString('utf8') ?? '';

  const alvoPorId = new Map<string, string>();
  for (const m of rels.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
    alvoPorId.set(m[1], path.posix.normalize(path.posix.join('ppt', m[2])));
  }

  const ordenados: string[] = [];
  for (const m of apresentacao.matchAll(/<p:sldId\s[^>]*r:id="([^"]+)"/g)) {
    const alvo = alvoPorId.get(m[1]);
    if (alvo && zip.has(alvo)) ordenados.push(alvo);
  }

  if (ordenados.length > 0) return ordenados;

  // Sem `sldIdLst` legível, cai para a ordem numérica — mas isso é degradação
  // declarada, não o caminho normal.
  return [...zip.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)/.exec(a)![1]) - Number(/(\d+)/.exec(b)![1]));
}

export function ingerir(
  arquivo: string,
  ingeridoEm: string,
  /** Onde gravar as capturas. O teste manda um temporário — `scripts/provas/`
   *  escreve só em temporário, e um teste que sujasse `public/` seria pior. */
  pastaImagensBase: string = DESTINO_IMAGENS,
): Procedimento {
  const bruto = readFileSync(arquivo);
  const hash = createHash('sha256').update(bruto).digest('hex').slice(0, 16);
  const zip = lerZip(bruto);

  const midia = new Map<string, Buffer>();
  for (const [nome, dados] of zip) {
    if (nome.startsWith('ppt/media/')) midia.set(nome, dados);
  }

  const nomesSlides = ordemDosSlides(zip);

  // A pasta de destino sai do NOME DO ARQUIVO, não do cabeçalho: é preciso saber
  // onde gravar a imagem antes de ler o cabeçalho, e o nome é a fonte que não
  // depende do documento estar bem preenchido por dentro.
  const codigoProvavel = /(\d{3})/.exec(path.basename(arquivo))?.[1];
  if (!codigoProvavel) throw new Error(`${arquivo}: o nome do arquivo não traz o número do POP`);
  const pastaImagens = path.join(pastaImagensBase, `IT-ADMLUFT-${codigoProvavel}`);
  mkdirSync(pastaImagens, { recursive: true });

  /**
   * Grava a imagem endereçada pelo CONTEÚDO.
   *
   * Duas capturas iguais em slides diferentes viram um arquivo só — e uma versão
   * nova do POP que não mexeu na tela reaproveita o arquivo em vez de duplicar
   * 7 MB por revisão. A distinção entre "a mesma imagem no slide 3 e no slide 8"
   * continua existindo onde importa: são duas entradas de `Captura`, com caixas
   * diferentes.
   */
  const gravarImagem = (dados: Buffer, ext: string): string => {
    const sha = createHash('sha256').update(dados).digest('hex').slice(0, 12);
    const nome = `${sha}.${ext}`;
    const destino = path.join(pastaImagens, nome);
    if (!existsSync(destino)) writeFileSync(destino, dados);
    return `/procedimentos/IT-ADMLUFT-${codigoProvavel}/${nome}`;
  };

  const slides: SlideLido[] = nomesSlides.map((nome, i) => {
    const xml = zip.get(nome)!.toString('utf8');
    const relNome = nome.replace(/slides\/(slide\d+)\.xml/, 'slides/_rels/$1.xml.rels');
    const relXml = zip.get(relNome)?.toString('utf8') ?? '';
    const rels = new Map<string, string>();
    for (const m of relXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)) {
      rels.set(m[1], path.posix.normalize(path.posix.join('ppt/slides', m[2])));
    }
    return lerSlide(xml, rels, midia, i + 1, `IT-ADMLUFT-${codigoProvavel}`, gravarImagem);
  });

  return montar(arquivo, slides, hash, ingeridoEm, `IT-ADMLUFT-${codigoProvavel}`);
}

function principal(): void {
  if (!existsSync(ORIGEM)) throw new Error(`não achei ${ORIGEM}`);
  const arquivos = readdirSync(ORIGEM)
    .filter((n) => n.toLowerCase().endsWith('.pptx'))
    .sort();
  if (arquivos.length === 0) throw new Error(`nenhum .pptx em ${ORIGEM}`);

  const ingeridoEm = new Date().toISOString();
  const caminhoIndice = path.join(DESTINO_BASE, 'indice.json');
  const indice: Record<string, EntradaIndice> = existsSync(caminhoIndice)
    ? JSON.parse(readFileSync(caminhoIndice, 'utf8'))
    : {};

  mkdirSync(DESTINO_BASE, { recursive: true });

  for (const nome of arquivos) {
    const p = ingerir(path.join(ORIGEM, nome), ingeridoEm);
    const anterior = indice[p.codigo];

    /**
     * A MUDANÇA é o que exige gente. Versão nova de um POP que já tinha uma
     * oficial entra como `em_revisao` e a antiga continua vigente até alguém
     * com papel de supervisão promover — proibições nº 3 (nunca alterar POP
     * automaticamente) e nº 4 (nunca apagar versão anterior).
     */
    const jaConhecida = anterior?.versoes.some((v) => v.hash === p.hash_origem);
    const estado: Procedimento['estado'] =
      !anterior || jaConhecida ? p.estado : 'em_revisao';
    const registro: Procedimento = { ...p, estado };

    const pasta = path.join(DESTINO_BASE, p.codigo);
    mkdirSync(pasta, { recursive: true });
    writeFileSync(
      path.join(pasta, `${p.hash_origem}.json`),
      `${JSON.stringify(registro, null, 2)}\n`,
      'utf8',
    );

    const versoes = anterior?.versoes.filter((v) => v.hash !== p.hash_origem) ?? [];
    versoes.push({
      hash: p.hash_origem,
      ingerido_em: p.ingerido_em,
      estado,
      arquivo_origem: p.arquivo_origem,
    });
    indice[p.codigo] = {
      vigente: anterior && !jaConhecida ? anterior.vigente : p.hash_origem,
      versoes,
    };

    const passos = p.etapas.reduce(
      (n, e) => n + e.slides.reduce((m, s) => m + s.passos.length, 0),
      0,
    );
    const ancorados = p.etapas.reduce(
      (n, e) =>
        n + e.slides.reduce((m, s) => m + s.passos.filter((x) => x.ancora).length, 0),
      0,
    );
    console.log(
      `${p.codigo}  ${p.etapas.length} etapas · ${passos} passos (${ancorados} ancorados) · ` +
        `${p.particularidades.length} particularidades · ${estado}`,
    );
  }

  writeFileSync(caminhoIndice, `${JSON.stringify(indice, null, 2)}\n`, 'utf8');
  console.log(`\n${arquivos.length} POPs em ${DESTINO_BASE}`);
}

/**
 * Só roda quando alguém executa o script. Importar este arquivo — o que o teste
 * faz — não pode disparar escrita em `dados/` nem em `public/`.
 */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  principal();
}
