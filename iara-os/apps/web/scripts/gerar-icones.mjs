/**
 * Gera os ícones do PWA sem dependência externa.
 *
 * Escreve PNG na mão (zlib + CRC32) em vez de puxar sharp/canvas: são 40
 * linhas, funcionam em qualquer máquina e não adicionam módulo nativo ao
 * projeto — a mesma regra que vale para o resto do repositório.
 *
 * Uso: node scripts/gerar-icones.mjs
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = TABELA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function bloco(tipo, dados) {
  const tam = Buffer.alloc(4);
  tam.writeUInt32BE(dados.length);
  const corpo = Buffer.concat([Buffer.from(tipo, 'ascii'), dados]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(corpo));
  return Buffer.concat([tam, corpo, crc]);
}

/** pixels: Uint8Array RGBA de lado*lado*4 */
function png(lado, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr[8] = 8; // profundidade
  ihdr[9] = 6; // RGBA
  // Cada linha do PNG começa com um byte de filtro; 0 = nenhum.
  const bruto = Buffer.alloc(lado * (lado * 4 + 1));
  for (let y = 0; y < lado; y += 1) {
    bruto[y * (lado * 4 + 1)] = 0;
    pixels.copy
      ? pixels.copy(bruto, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4)
      : Buffer.from(pixels).copy(bruto, y * (lado * 4 + 1) + 1, y * lado * 4, (y + 1) * lado * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloco('IHDR', ihdr),
    bloco('IDAT', deflateSync(bruto, { level: 9 })),
    bloco('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * O ícone é a sala vista de longe: parede clara, piso, e a janela acesa.
 * Mesmo grid de 16 unidades do pack de arte — o ícone é o escritório, não um
 * logotipo abstrato.
 */
function desenhar(lado, comFundo) {
  const px = Buffer.alloc(lado * lado * 4);
  const u = lado / 16; // unidade do grid
  const por = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= lado || y >= lado) return;
    const i = (y * lado + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = a;
  };
  const caixa = (cx, cy, cw, ch, cor) => {
    for (let y = Math.round(cy * u); y < Math.round((cy + ch) * u); y += 1)
      for (let x = Math.round(cx * u); x < Math.round((cx + cw) * u); x += 1) por(x, y, cor);
  };

  const PAREDE = [232, 223, 208];
  const PISO = [217, 200, 173];
  const RODAPE = [203, 187, 164];
  const JANELA = [168, 216, 255];
  const LUZ = [255, 217, 160];
  const TINTA = [51, 48, 43];

  if (comFundo) caixa(0, 0, 16, 16, PAREDE);
  else caixa(1, 1, 14, 14, PAREDE); // maskable: margem de segurança

  const o = comFundo ? 0 : 1;
  const l = comFundo ? 16 : 14;

  caixa(o, o + l * 0.55, l, l * 0.45, PISO);
  caixa(o, o + l * 0.55 - 0.35, l, 0.35, RODAPE);

  // janela acesa
  caixa(o + l * 0.12, o + l * 0.14, l * 0.3, l * 0.24, JANELA);
  // feixe de luz no piso
  caixa(o + l * 0.1, o + l * 0.55, l * 0.34, l * 0.16, LUZ);

  // rack, com o LED verde
  caixa(o + l * 0.74, o + l * 0.12, l * 0.14, l * 0.42, TINTA);
  caixa(o + l * 0.77, o + l * 0.18, l * 0.05, l * 0.05, [159, 214, 168]);
  caixa(o + l * 0.77, o + l * 0.3, l * 0.05, l * 0.05, LUZ);

  // a IARA, de costas para a mesa
  caixa(o + l * 0.44, o + l * 0.44, l * 0.11, l * 0.2, TINTA);

  return px;
}

const destino = path.resolve(process.cwd(), 'public', 'icones');
mkdirSync(destino, { recursive: true });

for (const [nome, lado, comFundo] of [
  ['icone-192.png', 192, true],
  ['icone-512.png', 512, true],
  ['icone-maskable-512.png', 512, false],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(path.join(destino, nome), png(lado, desenhar(lado, comFundo)));
  console.log(`gerado public/icones/${nome} (${lado}x${lado})`);
}
