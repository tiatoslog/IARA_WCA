/**
 * Anexo de imagem — screenshot que o operador manda para a IARA analisar.
 *
 * MESMO PADRÃO de `Voz.ts`: bytes em memória do processo, indexados por hash,
 * servidos por uma rota HTTP própria fora do WebSocket. Nunca em disco nesta
 * versão — não há necessidade de sobreviver a um restart do motor, e cache em
 * memória evita gerir limpeza de arquivo órfão. `podar()` limita o teto do
 * jeito que `Voz.ts` já limita áudio: Map preserva ordem de inserção, o mais
 * antigo sai primeiro quando o teto estoura.
 */

import { createHash, randomBytes } from 'node:crypto';

/** Espelha `MAX_BYTES_AUDIO` de `Transcricao.ts`: teto contado enquanto o
 *  corpo chega, nunca depois. Screenshot de tela cheia em PNG passa disto com
 *  folga; se não passar, é vídeo ou várias telas coladas — não é o caso de uso. */
export const MAX_BYTES_IMAGEM = 6 * 1024 * 1024;

const MINIMO_BYTES_IMAGEM = 256;

/** Quantos anexos ficam vivos ao mesmo tempo. Cada um pesa até `MAX_BYTES_IMAGEM`;
 *  o teto existe pela mesma razão do teto de áudio de `Voz.ts`. */
const MAX_ANEXOS = 60;

const TIPO_PARA_EXTENSAO: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function extensaoDeImagem(tipoMime: string): string | null {
  return TIPO_PARA_EXTENSAO[tipoMime] ?? null;
}

/**
 * A ASSINATURA DOS PRIMEIROS BYTES, não o `Content-Type` que o cliente
 * declarou — achado em QA (18/08/2026, bateria da INSTRUTORA-V1): 4000 bytes
 * de texto puro com header `Content-Type: image/png` eram aceitos e ficavam
 * disponíveis por `GET /anexo/<hash>.png`, servidos de volta como se fossem
 * PNG de verdade. `guardar()` só validava o header — exatamente o que o
 * test-plan (EC-002) já previa como risco antes de existir prova. Confiar no
 * header declarado para decidir o que ENTRA no armazenamento é a mesma classe
 * de erro que confiar nele para decidir o que SAI — a diferença é só de lado.
 */
function assinaturaBate(bytes: Buffer, tipoMime: string): boolean {
  if (tipoMime === 'image/png') {
    return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }
  if (tipoMime === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (tipoMime === 'image/webp') {
    return (
      bytes.length >= 12 &&
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}

interface Anexo {
  readonly bytes: Buffer;
  readonly tipo: string;
  readonly criado_em: number;
}

const porHash = new Map<string, Anexo>();

function podar(): void {
  while (porHash.size > MAX_ANEXOS) {
    const maisAntigo = porHash.keys().next().value;
    if (maisAntigo === undefined) break;
    porHash.delete(maisAntigo);
  }
}

/**
 * Recusa explícita, nunca exceção — o chamador (a rota HTTP) decide o código
 * de status a partir do motivo, do mesmo jeito que `transcrever()` devolve
 * `{ok:false, motivo}` em vez de lançar.
 */
export type VeredictoAnexo =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly motivo: string };

/**
 * Guarda os bytes e devolve a URL pela qual `GET /anexo/<hash>.<ext>` os
 * serve. O hash inclui bytes aleatórios além do conteúdo — duas imagens
 * idênticas de operadores diferentes não podem colidir no mesmo hash, porque
 * isso deixaria a URL de uma imagem servir a outra pessoa sem nenhuma troca
 * de conteúdo ter acontecido (a mesma preocupação de SEC-003 no test-plan).
 */
export function guardar(bytes: Buffer, tipoMime: string): VeredictoAnexo {
  const ext = extensaoDeImagem(tipoMime);
  if (!ext) return { ok: false, motivo: `formato de imagem não suportado: ${tipoMime}` };
  if (bytes.length > MAX_BYTES_IMAGEM) {
    return { ok: false, motivo: `imagem grande demais (${bytes.length} bytes)` };
  }
  if (bytes.length < MINIMO_BYTES_IMAGEM) {
    return { ok: false, motivo: 'imagem pequena demais para ser um screenshot' };
  }
  if (!assinaturaBate(bytes, tipoMime)) {
    return { ok: false, motivo: `o conteúdo não é um ${ext} de verdade (assinatura não bate)` };
  }

  const sal = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(sal).update(bytes).digest('hex').slice(0, 32);
  porHash.set(hash, { bytes, tipo: tipoMime, criado_em: Date.now() });
  podar();

  return { ok: true, url: `/anexo/${hash}.${ext}` };
}

/** Para a rota GET: bytes + tipo, ou `null` quando o hash não existe (nunca
 *  existiu, ou saiu por poda / restart do processo). */
export function porHashDeArquivo(hash: string): { bytes: Buffer; tipo: string } | null {
  const a = porHash.get(hash);
  return a ? { bytes: a.bytes, tipo: a.tipo } : null;
}

const ROTA_ANEXO = /^\/anexo\/([0-9a-f]{16,64})\.(png|jpe?g|webp)$/;

/** Para o Kernel: extrai o hash de uma URL de anexo e devolve os bytes — sem
 *  reimplementar o parsing da URL num segundo lugar. `null` em qualquer
 *  formato que não seja exatamente o que `guardar()` produz. */
export function porUrl(url: string): { bytes: Buffer; tipo: string } | null {
  const m = ROTA_ANEXO.exec(url);
  if (!m) return null;
  return porHashDeArquivo(m[1]);
}

export { ROTA_ANEXO };
