/**
 * Corta os ícones a partir do símbolo.
 *
 * A fonte é `public/marca/iara-simbolo.png` — a MESMA fotografia que a portaria
 * usa, em quadro fechado. Uma identidade, todas as escalas: o ícone não é um
 * desenho separado que "lembra" a marca, é a marca reduzida. Nada aqui sabe
 * desenhar coisa nenhuma; se a marca mudar, roda-se `npm run marca` antes.
 *
 * Saída:
 *   public/icones/*.png             PWA e Apple, cortados aqui
 *   ../desktop/icone-fonte.png      a chapa de 1024 que alimenta o Tauri
 *   ../desktop/src-tauri/icons/**   DELEGADO ao `tauri icon`
 *
 * POR QUE DELEGAR A ÁRVORE DO TAURI. Ela tem 52 arquivos: os quadrados do
 * instalador Windows, o StoreLogo, o .ico multirresolução, o .icns do macOS e
 * as árvores de iOS e Android. Uma versão anterior deste script gerava seis
 * deles na mão — e os outros quarenta e seis continuaram com o ícone ANTIGO,
 * silenciosamente, porque ninguém olha para `Square107x107Logo.png`. Ferramenta
 * que já sabe a lista inteira é dona da lista inteira.
 *
 * Uso: npm run icones
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const raiz = process.cwd();
const origem = path.join(raiz, 'public', 'marca', 'iara-simbolo.png');
const desktop = path.join(raiz, '..', 'desktop');

/**
 * CANTO ARREDONDADO — 22% do lado, a proporção do ícone de aplicativo moderno
 * (é a mesma do superellipse do Windows 11 e do iOS).
 *
 * Isto vale SÓ para os ícones que ninguém mais vai mascarar. A distinção é o
 * ponto todo desta função existir, porque arredondar o alvo errado estraga:
 *
 *  · Windows (a árvore do Tauri, o .ico, a barra de tarefas) NÃO arredonda
 *    ícone de app. O que o sistema desenha é exatamente o bitmap que recebe —
 *    então é aqui que o arredondamento tem de acontecer, senão o ícone fica
 *    quadrado no meio de uma barra de cantos redondos;
 *  · `icone-maskable-512` NÃO pode ser arredondado. "Maskable" quer dizer que
 *    a plataforma aplica a própria máscara; entregar já cortado produz canto
 *    duplo, com uma casca de fundo aparecendo por fora do recorte dela;
 *  · `apple-touch-icon` também não. O iOS arredonda sozinho, e ele compõe
 *    sobre PRETO em vez de respeitar alfa — canto transparente vira canto
 *    preto por baixo do recorte do sistema.
 */
const RAIO_CANTO = 0.22;

async function arredondar(corpo: Buffer, lado: number): Promise<Buffer> {
  const r = Math.round(lado * RAIO_CANTO);
  const mascara = Buffer.from(
    `<svg width="${lado}" height="${lado}">` +
      `<rect x="0" y="0" width="${lado}" height="${lado}" rx="${r}" ry="${r}" fill="#fff"/>` +
      '</svg>',
  );
  // `dest-in` mantém o destino onde a máscara é opaca: o que sobra fora do
  // raio vira transparente de verdade, não cinza pintado por cima.
  return sharp(corpo).composite([{ input: mascara, blend: 'dest-in' }]).png().toBuffer();
}

/**
 * Redimensiona o símbolo para um lado, com ou sem margem de segurança.
 * `canto` decide se o resultado sai com os cantos cortados — ver `arredondar`
 * para quem pode e quem não pode.
 */
async function quadro(lado: number, margem = 0, canto = false): Promise<Buffer> {
  const util = Math.round(lado * (1 - margem * 2));
  const corpo = await sharp(origem).resize(util, util, { fit: 'cover' }).png().toBuffer();
  if (margem === 0) return canto ? arredondar(corpo, lado) : corpo;

  // Máscara do Android e arredondamento do macOS comem borda. A margem de
  // segurança é preenchida com o cinza de estúdio da própria fotografia, para
  // o recorte não abrir buraco transparente no meio do fundo.
  return sharp({
    create: {
      width: lado,
      height: lado,
      channels: 4,
      background: { r: 0xb4, g: 0xb8, b: 0xbd, alpha: 1 },
    },
  })
    .composite([{ input: corpo, gravity: 'centre' }])
    .png()
    .toBuffer();
}

/** Roda o `tauri icon` no app desktop e espera. Falha alto se não terminar bem. */
function tauriIcon(): Promise<void> {
  return new Promise((resolver, rejeitar) => {
    const processo = spawn('npx', ['tauri', 'icon', 'icone-fonte.png'], {
      cwd: desktop,
      // `npx` no Windows é um .cmd, e .cmd só existe para o shell.
      shell: true,
      stdio: 'inherit',
    });
    processo.on('error', rejeitar);
    processo.on('close', (codigo) =>
      codigo === 0
        ? resolver()
        : rejeitar(
            new Error(
              `tauri icon saiu com código ${codigo}. ` +
                `Se o CLI não estiver instalado: npm install --prefix ../desktop`,
            ),
          ),
    );
  });
}

async function principal(): Promise<void> {
  try {
    await readFile(origem);
  } catch {
    throw new Error(`${origem} não existe. Rode antes: npm run marca`);
  }

  const icones = path.join(raiz, 'public', 'icones');
  await mkdir(icones, { recursive: true });

  const web: ReadonlyArray<readonly [string, number, number, boolean]> = [
    ['icone-192.png', 192, 0, true],
    ['icone-512.png', 512, 0, true],
    // Maskable e Apple saem QUADRADOS de propósito: os dois são recortados
    // pela plataforma, e cortar antes só produz canto duplo.
    ['icone-maskable-512.png', 512, 0.1, false],
    ['apple-touch-icon.png', 180, 0, false],
  ];
  for (const [nome, lado, margem, canto] of web) {
    await writeFile(path.join(icones, nome), await quadro(lado, margem, canto));
    console.log(`public/icones/${nome} (${lado}×${lado})${canto ? ' — canto 22%' : ''}`);
  }

  // A chapa que alimenta o `tauri icon` sai arredondada: o Windows desenha o
  // bitmap como recebe, então o canto tem de vir daqui.
  await writeFile(path.join(desktop, 'icone-fonte.png'), await quadro(1024, 0, true));
  console.log('../desktop/icone-fonte.png (1024×1024)');

  console.log('\n--- tauri icon: árvore do desktop, instalador e lojas ---');
  await tauriIcon();

  console.log(
    '\nO service worker serve /icones/ em cache-first: se a marca mudou, ' +
      'suba VERSAO em public/sw.js, senão quem já instalou o PWA fica com a antiga.',
  );
}

await principal();
