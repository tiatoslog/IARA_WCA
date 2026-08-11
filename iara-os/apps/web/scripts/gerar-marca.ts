/**
 * Recorta a marca a partir das FOTOGRAFIAS de referência.
 *
 * A identidade da IARA é a imagem que está em `public/marca/referencia/` — não
 * um desenho nosso, não um render. Este script não interpreta nada: ele corta,
 * compõe e redimensiona. Se o resultado ficar diferente da referência, o
 * problema está no corte, e o corte está todo em constantes aqui embaixo.
 *
 * Entra (a extensão não importa, só o nome):
 *   public/marca/referencia/cabeca.*   o rosto cromado
 *   public/marca/referencia/cromo.*    o metal líquido
 *
 * Sai:
 *   public/marca/iara-simbolo.png   quadrado, com IARA gravada na face
 *   public/marca/iara-hero.png      o fundo da portaria
 *
 * Uso: npm run marca   (depois: npm run icones)
 */

import { mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { palavraSvg } from '../lib/marca.js';

const raiz = process.cwd();
const referencia = path.join(raiz, 'public', 'marca', 'referencia');
const destino = path.join(raiz, 'public', 'marca');

/* --------------------------------------------------------------------------
 * ENQUADRAMENTO — as únicas decisões deste arquivo.
 *
 * Tudo em FRAÇÃO da imagem de origem, nunca em pixel: a referência pode ser
 * trocada por uma versão maior sem mexer numa linha.
 * -------------------------------------------------------------------------- */

const SIMBOLO = {
  lado: 1024,
  /**
   * Recorte quadrado sobre a cabeça. O centro é o meio do crânio e `altura` é a
   * fração da altura original que entra no quadro — apertar demais come a
   * calota, que é a parte da silhueta que sobrevive a 32 px.
   */
  centro_x: 0.5,
  centro_y: 0.44,
  /**
   * Da calota até o começo dos ombros. Cortar no queixo dava um busto
   * decapitado: o pescoço de cromo e a linha do trapézio são metade do que faz
   * a peça ler como ESCULTURA e não como máscara. O preço é a cabeça ocupar
   * menos quadro no ícone de 32 px — vale, porque a silhueta com pescoço ainda
   * é inconfundível, e cabeça flutuando não é.
   */
  altura: 0.78,
};

const INSCRICAO = {
  /** largura da palavra, em fração do lado do símbolo */
  largura: 0.3,
  /**
   * Centro da palavra dentro do símbolo, em fração do lado. Cai sobre o VAZIO
   * escuro do rosto — é ali que a referência põe a inscrição, e é o único
   * lugar da peça onde letra clara tem fundo escuro para ler contra.
   */
  centro_x: 0.503,
  centro_y: 0.445,
  /**
   * Espessura do traço na grade nativa de 326×100 — 0,09 da altura de versal.
   *
   * Fino de propósito. A palavra NÃO precisa ser lida a 32 px: o card da
   * portaria já escreve IARA em texto embaixo da marca, e num ícone de barra
   * de tarefas ninguém lê quatro letras de qualquer jeito. Ela é detalhe que
   * se revela de perto — que é como marca cara se comporta. Engrossar o traço
   * para vencer o tamanho pequeno é o que a fazia parecer carimbo.
   */
  peso: 9,
  opacidade: 0.9,
  /** fio escuro na borda do sulco — hairline, não sombra */
  bisel: 1.3,
};

const HERO = { largura: 1920, altura: 1200 };

/* -------------------------------------------------------------------------- */

/**
 * Acha a referência pelo NOME, ignorando extensão e caixa.
 *
 * Exigir exatamente `cabeca.png` transformava um "salvar como" em JPG num erro
 * de arquivo faltando. O que importa é qual foto é qual; o formato é problema
 * do `sharp`, que lê PNG, JPG, WebP e AVIF sem reclamar.
 */
async function acharReferencia(nome: string): Promise<string | null> {
  let entradas: string[];
  try {
    entradas = await readdir(referencia);
  } catch {
    return null;
  }
  const achado = entradas.find((e) => path.parse(e).name.toLowerCase() === nome);
  return achado ? path.join(referencia, achado) : null;
}

/**
 * Corta o quadrado da cabeça e grava a palavra na face.
 *
 * A inscrição entra como sobreposição em cromo claro com uma cópia escura
 * deslocada por baixo — a parede do sulco. Nunca vermelho: o vermelho da
 * referência é anotação de estudo, e vermelho saturado é invariante do
 * projeto (só o coral de alerta sobrevive).
 */
async function fazerSimbolo(origem: string): Promise<void> {
  const meta = await sharp(origem).metadata();
  const L = meta.width ?? 0;
  const A = meta.height ?? 0;
  if (!L || !A) throw new Error(`${origem}: não consegui ler as dimensões.`);

  const lado = Math.round(Math.min(A * SIMBOLO.altura, L));
  const esquerda = Math.max(0, Math.min(L - lado, Math.round(L * SIMBOLO.centro_x - lado / 2)));
  const topo = Math.max(0, Math.min(A - lado, Math.round(A * SIMBOLO.centro_y - lado / 2)));

  const recorte = await sharp(origem)
    .extract({ left: esquerda, top: topo, width: lado, height: lado })
    .resize(SIMBOLO.lado, SIMBOLO.lado)
    .png()
    .toBuffer();

  const larguraPalavra = Math.round(SIMBOLO.lado * INSCRICAO.largura);
  const palavra = await sharp(
    Buffer.from(
      palavraSvg({
        largura: larguraPalavra,
        peso: INSCRICAO.peso,
        opacidade: INSCRICAO.opacidade,
        bisel: INSCRICAO.bisel,
      }),
    ),
  )
    .png()
    .toBuffer();
  const alturaPalavra = (await sharp(palavra).metadata()).height ?? 0;

  await sharp(recorte)
    .composite([
      {
        input: palavra,
        left: Math.round(SIMBOLO.lado * INSCRICAO.centro_x - larguraPalavra / 2),
        top: Math.round(SIMBOLO.lado * INSCRICAO.centro_y - alturaPalavra / 2),
      },
    ])
    .png()
    .toFile(path.join(destino, 'iara-simbolo.png'));

  console.log(
    `iara-simbolo.png — recorte ${lado}×${lado} de ${L}×${A}, reduzido para ${SIMBOLO.lado}²`,
  );
}

/** O fundo da portaria. Sem desfoque: a profundidade de campo mora no CSS. */
async function fazerHero(origem: string): Promise<void> {
  await sharp(origem)
    .resize(HERO.largura, HERO.altura, { fit: 'cover', position: 'centre' })
    .png()
    .toFile(path.join(destino, 'iara-hero.png'));
  console.log(`iara-hero.png — ${HERO.largura}×${HERO.altura}`);
}

async function principal(): Promise<void> {
  await mkdir(destino, { recursive: true });

  const cabeca = await acharReferencia('cabeca');
  const cromo = await acharReferencia('cromo');
  const faltando: string[] = [];

  if (cabeca) await fazerSimbolo(cabeca);
  else faltando.push('cabeca');

  if (cromo) await fazerHero(cromo);
  else faltando.push('cromo');

  if (faltando.length) {
    // Falha explícita, e não silêncio: sem a referência a marca não existe, e
    // um script que "termina bem" sem produzir nada é pior que um que quebra.
    throw new Error(
      `Falta em public/marca/referencia/: ${faltando.join(', ')} ` +
        `(qualquer extensão de imagem serve). Veja o LEIA-ME.txt daquela pasta.`,
    );
  }
}

await principal();
