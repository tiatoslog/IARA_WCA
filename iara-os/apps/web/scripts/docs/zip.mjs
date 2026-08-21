/**
 * Escritor de ZIP mínimo. Existe porque um `.docx` É um ZIP de XML.
 *
 * POR QUE NÃO UMA BIBLIOTECA: a alternativa a estas 60 linhas era uma
 * dependência nova só para concatenar cabeçalhos de 30 bytes. O formato ZIP é
 * estável desde 1989 e o `zlib` já vem no Node — o custo real desta escolha é
 * o CRC-32 abaixo, e ele não muda nunca.
 *
 * Escreve sempre com data fixa: um documento gerado do mesmo commit tem que dar
 * o mesmo byte, senão o workflow que recommita a documentação vê diferença em
 * TODA publicação e entra em laço de commit vazio.
 */
import { deflateRawSync } from 'node:zlib';

const TABELA = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 1980-01-01 00:00 em data/hora MS-DOS: o menor valor legal do formato. */
const BARRA_INVERTIDA = String.fromCharCode(92);

const DATA_FIXA = 0x0021;
const HORA_FIXA = 0x0000;

/**
 * @param {Array<{nome: string, dados: string|Buffer}>} entradas
 * @returns {Buffer}
 */
export function zipar(entradas) {
  const locais = [];
  const central = [];
  let deslocamento = 0;

  for (const { nome } of entradas) {
    // Barra invertida no nome quebra o ZIP em leitor que não seja o Windows.
    if (nome.includes(BARRA_INVERTIDA)) throw new Error(`caminho inválido no zip: ${nome}`);
  }

  for (const { nome, dados } of entradas) {
    const cru = Buffer.isBuffer(dados) ? dados : Buffer.from(dados, 'utf8');
    const comprimido = deflateRawSync(cru, { level: 9 });
    // Guardar sem comprimir quando comprimir não paga: arquivo XML minúsculo
    // fica maior com o cabeçalho do deflate.
    const usaDeflate = comprimido.length < cru.length;
    const corpo = usaDeflate ? comprimido : cru;
    const metodo = usaDeflate ? 8 : 0;
    const soma = crc32(cru);
    const nomeBuf = Buffer.from(nome, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);           // versão necessária
    local.writeUInt16LE(0, 6);            // sinalizadores
    local.writeUInt16LE(metodo, 8);
    local.writeUInt16LE(HORA_FIXA, 10);
    local.writeUInt16LE(DATA_FIXA, 12);
    local.writeUInt32LE(soma, 14);
    local.writeUInt32LE(corpo.length, 18);
    local.writeUInt32LE(cru.length, 22);
    local.writeUInt16LE(nomeBuf.length, 26);
    local.writeUInt16LE(0, 28);           // campo extra
    locais.push(local, nomeBuf, corpo);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);             // versão de quem escreveu
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0, 8);
    dir.writeUInt16LE(metodo, 10);
    dir.writeUInt16LE(HORA_FIXA, 12);
    dir.writeUInt16LE(DATA_FIXA, 14);
    dir.writeUInt32LE(soma, 16);
    dir.writeUInt32LE(corpo.length, 20);
    dir.writeUInt32LE(cru.length, 24);
    dir.writeUInt16LE(nomeBuf.length, 28);
    dir.writeUInt32LE(0, 38);             // atributos externos
    dir.writeUInt32LE(deslocamento, 42);
    central.push(dir, nomeBuf);

    deslocamento += local.length + nomeBuf.length + corpo.length;
  }

  const dirBuf = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(dirBuf.length, 12);
  fim.writeUInt32LE(deslocamento, 16);

  return Buffer.concat([...locais, dirBuf, fim]);
}
