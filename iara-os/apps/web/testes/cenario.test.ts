/**
 * Testes de layout do escritório.
 *
 * POR QUE ESTE ARQUIVO EXISTE. As coordenadas em `cenario.ts` são posições de
 * FOLHA, e toda folha do pack tem padding transparente assimétrico. Espaçar dois
 * móveis pela largura declarada não diz nada sobre a arte que aparece na tela —
 * `cabinet.png` é 64 de folha para 25 de arte, `coffee-maker.png` é 64 para 62.
 * O resultado é que a sobreposição não é visível na leitura do código: ela só
 * aparece na tela, e só para quem estiver olhando.
 *
 * Então o teste faz o que o olho não faz de forma confiável: decodifica cada
 * PNG, extrai o retângulo de alpha e cruza todos contra todos. Se um sprite for
 * trocado por outro de padding diferente, isto acusa antes de chegar na tela.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  ALTURA_PAREDE,
  JANELA,
  LINHA_FUNDO,
  MOBILIA,
  QUADRO_METAS,
  RACK,
  SALA_LARGURA,
  baseDoSprite,
  type Sprite,
} from '../lib/cenario';

// ---------------------------------------------------------------------------
// Medição
// ---------------------------------------------------------------------------

interface Retangulo {
  nome: string;
  arquivo: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Caixa de alpha de um PNG. Decodificador mínimo — só o necessário para saber
 * onde há pixel opaco. Depender de uma biblioteca de imagem só para isto seria
 * uma dependência a mais no projeto, contra a regra do resto do repositório.
 */
function caixaDeAlpha(caminho: string): { x0: number; y0: number; x1: number; y1: number } {
  const buf = readFileSync(caminho);
  assert.equal(buf.readUInt32BE(0), 0x89504e47, `${caminho} não é PNG`);

  let off = 8;
  let largura = 0;
  let altura = 0;
  let profundidade = 0;
  let tipoCor = 0;
  let transparencia: Buffer | null = null;
  const blocos: Buffer[] = [];

  while (off < buf.length) {
    const tamanho = buf.readUInt32BE(off);
    const tipo = buf.toString('latin1', off + 4, off + 8);
    const dados = buf.subarray(off + 8, off + 8 + tamanho);
    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      profundidade = dados[8];
      tipoCor = dados[9];
      assert.equal(dados[12], 0, `${caminho}: PNG entrelaçado não é suportado`);
    } else if (tipo === 'tRNS') transparencia = dados;
    else if (tipo === 'IDAT') blocos.push(dados);
    else if (tipo === 'IEND') break;
    off += 12 + tamanho;
  }

  assert.equal(profundidade, 8, `${caminho}: profundidade ${profundidade} não suportada`);
  const canais = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[tipoCor];
  assert.ok(canais, `${caminho}: tipo de cor ${tipoCor} não suportado`);

  // Desfiltragem linha a linha — o filtro de cada linha referencia a anterior.
  const bruto = inflateSync(Buffer.concat(blocos));
  const passo = largura * canais;
  const pixels = Buffer.alloc(altura * passo);
  let pos = 0;

  for (let y = 0; y < altura; y += 1) {
    const filtro = bruto[pos];
    pos += 1;
    const linha = bruto.subarray(pos, pos + passo);
    pos += passo;
    const destino = pixels.subarray(y * passo, (y + 1) * passo);
    const acima = y > 0 ? pixels.subarray((y - 1) * passo, y * passo) : null;

    for (let i = 0; i < passo; i += 1) {
      const a = i >= canais ? destino[i - canais] : 0;
      const b = acima ? acima[i] : 0;
      const c = acima && i >= canais ? acima[i - canais] : 0;
      let v = linha[i];
      if (filtro === 1) v += a;
      else if (filtro === 2) v += b;
      else if (filtro === 3) v += (a + b) >> 1;
      else if (filtro === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      destino[i] = v & 0xff;
    }
  }

  const alpha = (x: number, y: number): number => {
    const i = y * passo + x * canais;
    if (tipoCor === 6) return pixels[i + 3];
    if (tipoCor === 4) return pixels[i + 1];
    if (tipoCor === 3) {
      const indice = pixels[i];
      return transparencia && indice < transparencia.length ? transparencia[indice] : 255;
    }
    return 255;
  };

  let x0 = largura;
  let y0 = altura;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < altura; y += 1) {
    for (let x = 0; x < largura; x += 1) {
      if (alpha(x, y) <= 8) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  assert.ok(x1 >= 0, `${caminho} está inteiramente transparente`);
  return { x0, y0, x1, y1 };
}

const PASTA = fileURLToPath(new URL('../public/escritorio/', import.meta.url));
const cache = new Map<string, ReturnType<typeof caixaDeAlpha>>();

function conteudo(s: Sprite): Retangulo {
  let caixa = cache.get(s.arquivo);
  if (!caixa) {
    caixa = caixaDeAlpha(PASTA + s.arquivo);
    cache.set(s.arquivo, caixa);
  }
  return {
    nome: `${s.arquivo}@${s.x},${s.y}`,
    arquivo: s.arquivo,
    x0: s.x + caixa.x0,
    y0: s.y + caixa.y0,
    x1: s.x + caixa.x1,
    y1: s.y + caixa.y1,
  };
}

// ---------------------------------------------------------------------------
// Sobreposição
// ---------------------------------------------------------------------------

/**
 * Pares que PODEM se sobrepor, porque a sobreposição é o desenho: monitor em
 * cima da mesa, cadeira à frente da mesa. Qualquer outro par é erro de layout.
 */
const EMPILHAMENTO_PERMITIDO: Array<[string, string]> = [
  ['desk.png', 'PC1.png'],
  ['desk.png', 'Chair.png'],
  ['desk-with-pc.png', 'Chair.png'],
];

function permitido(a: string, b: string): boolean {
  return EMPILHAMENTO_PERMITIDO.some(
    ([p, q]) => (a === p && b === q) || (a === q && b === p),
  );
}

function cruzam(a: Retangulo, b: Retangulo): boolean {
  return a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1;
}

/** Os desenhados à mão entram na mesma conta — parede também tem geometria. */
const MURAIS: Retangulo[] = [QUADRO_METAS, JANELA, RACK].map((r) => ({
  nome: r.id,
  arquivo: `:${r.id}`,
  x0: r.x,
  y0: r.y,
  x1: r.x + r.largura - 1,
  y1: r.y + r.altura - 1,
}));

test('nenhum móvel se sobrepõe a outro', () => {
  const todos = [...MOBILIA.map(conteudo), ...MURAIS];
  const colisoes: string[] = [];

  for (let i = 0; i < todos.length; i += 1) {
    for (let j = i + 1; j < todos.length; j += 1) {
      const a = todos[i];
      const b = todos[j];
      if (!cruzam(a, b)) continue;
      if (permitido(a.arquivo, b.arquivo)) continue;
      const x = `${Math.max(a.x0, b.x0)}..${Math.min(a.x1, b.x1)}`;
      const y = `${Math.max(a.y0, b.y0)}..${Math.min(a.y1, b.y1)}`;
      colisoes.push(`${a.nome} × ${b.nome} em x ${x}, y ${y}`);
    }
  }

  assert.deepEqual(colisoes, [], `sobreposição de arte:\n  ${colisoes.join('\n  ')}`);
});

test('nada escapa pelas bordas da sala', () => {
  for (const r of MOBILIA.map(conteudo)) {
    assert.ok(r.x0 >= 0, `${r.nome} começa antes da parede esquerda (x=${r.x0})`);
    assert.ok(r.x1 < SALA_LARGURA, `${r.nome} passa da parede direita (x=${r.x1})`);
  }
});

test('a fileira do fundo apoia no piso, não na emenda da parede', () => {
  // Base ALINHADA em ALTURA_PAREDE foi o primeiro erro: o móvel encosta a
  // emenda e lê como pendurado. Ele precisa estar À FRENTE da parede.
  const fundo = MOBILIA.filter((s) => baseDoSprite(s) <= LINHA_FUNDO);
  assert.ok(fundo.length >= 4, 'esperava a fileira do fundo completa');

  for (const s of fundo) {
    assert.equal(
      baseDoSprite(s),
      LINHA_FUNDO,
      `${s.arquivo} tem base ${baseDoSprite(s)}, deveria ser ${LINHA_FUNDO}`,
    );
    assert.ok(
      baseDoSprite(s) > ALTURA_PAREDE,
      `${s.arquivo} apoia na emenda da parede — vai ler como quadro pendurado`,
    );
  }
});

/**
 * Sprites que NÃO tocam o piso, e por isso ancoram noutra coisa. Cada entrada
 * precisa de motivo — é a porta pela qual uma âncora errada entraria de novo.
 */
const ANCORA_FORA_DO_PISO: Record<string, string> = {
  'PC1.png': 'monitor apoiado na tampa da mesa, não no chão',
};

test('ancora é o fundo real da arte, medido da folha', () => {
  // Se a âncora não for o fundo da arte, a base mente e a ordem de desenho
  // mente junto: o móvel passa à frente de quem deveria estar na frente dele.
  // Foi essa mentira que deixou a fileira do fundo parecendo pendurada.
  for (const s of MOBILIA) {
    if (ANCORA_FORA_DO_PISO[s.arquivo]) continue;
    assert.notEqual(s.ancora, undefined, `${s.arquivo}: ancora não declarada`);
    const caixa = caixaDeAlpha(PASTA + s.arquivo);
    assert.equal(
      s.ancora,
      caixa.y1,
      `${s.arquivo}: ancora ${s.ancora}, mas a arte termina em ${caixa.y1}`,
    );
  }
});

test('o corredor central fica livre', () => {
  // Faixa y 160..208 entre as bordas laterais: é por onde a IARA caminha.
  const BORDA = 48;
  for (const r of MOBILIA.map(conteudo)) {
    const noCorredor = r.y1 >= 160 && r.x0 > BORDA && r.x1 < SALA_LARGURA - BORDA;
    assert.ok(!noCorredor, `${r.nome} invade o corredor`);
  }
});
