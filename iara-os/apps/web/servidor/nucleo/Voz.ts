/**
 * Voz da IARA — síntese de fala via Convai.
 *
 * A CONVAI NÃO PENSA AQUI. Ela recebe um texto que o Kernel já produziu e
 * devolve áudio. O personagem configurado no painel deles tem persona, memória
 * e cérebro próprios; nada disso é usado, e é deliberado: usar o personagem
 * completo colocaria uma LLM de terceiro no lugar do `RoteadorIntencoes`, do
 * `RagHistorico` e dos shards privados, e mandaria mensagem de operador para
 * fora. O endpoint de TTS é o único que aceita texto pronto.
 *
 * A CHAVE VIVE SÓ AQUI. O SDK web da Convai roda no navegador e embute a chave
 * no bundle — qualquer um abre o devtools e leva. Como o IARA OS já tem
 * processo próprio, a síntese acontece no servidor e o navegador recebe apenas
 * um caminho para os bytes. `CONVAI_API_KEY` nunca é prefixada com
 * `NEXT_PUBLIC_`, e não pode ser.
 *
 * Sem chave, o sistema roda inteiro e a IARA fica muda — a mesma regra que vale
 * para `ANTHROPIC_API_KEY`: ela avisa em vez de improvisar.
 */

import { createHash } from 'node:crypto';

const ENDPOINT = 'https://api.convai.com/tts/';

/** Limite defensivo. Resposta longa demais é custo e latência, não voz. */
const MAX_CARACTERES = 1200;
const TEMPO_LIMITE_MS = 20_000;

/**
 * Quantos áudios ficam em memória. Cada um é um mp3 de poucos segundos; 40
 * cabem folgados e cobrem uma sessão inteira de conversa. Sem teto, uma aba
 * aberta o dia todo vira vazamento.
 */
const MAX_AUDIOS = 40;

export type Encoding = 'mp3' | 'wav';

const TIPO_MIME: Record<Encoding, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

/**
 * O ambiente é lido em FUNÇÃO, nunca no topo do módulo.
 *
 * `import` é hasteado: todo módulo importado por `principal.ts` é avaliado
 * ANTES da primeira linha do corpo dele — e é no corpo que `dotenv` carrega o
 * `.env.local`. Um `const CHAVE = process.env.CONVAI_API_KEY` no topo daqui lê
 * `undefined` sempre, e o sintoma é cruel: a chave está no arquivo, o servidor
 * jura que não está. É por isso que `ClienteSupabase` e `Autenticacao` também
 * leem em função.
 */
function chave(): string {
  return (process.env.CONVAI_API_KEY ?? '').trim();
}

/** `voice_value` da Voice List API. Vozes "realtime" não servem para TTS. */
function vozEscolhida(): string {
  return (process.env.CONVAI_VOZ ?? '').trim();
}

function encoding(): Encoding {
  return process.env.CONVAI_ENCODING === 'wav' ? 'wav' : 'mp3';
}

export function vozDisponivel(): boolean {
  return chave().length > 0 && vozEscolhida().length > 0;
}

/** Diz o que falta, para o log de subida ser útil em vez de misterioso. */
export function diagnosticoVoz(): string {
  const temChave = chave().length > 0;
  const voz = vozEscolhida();
  if (!temChave && !voz) return 'desligada (sem CONVAI_API_KEY e CONVAI_VOZ)';
  if (!temChave) return 'desligada (sem CONVAI_API_KEY)';
  if (!voz) return 'desligada (sem CONVAI_VOZ — rode `npm run vozes`)';
  return `Convai, voz "${voz}", ${encoding()}`;
}

interface Audio {
  bytes: Buffer;
  tipo: string;
  criado_em: number;
}

/** hash do texto -> áudio. Duas respostas iguais não são sintetizadas duas vezes. */
const porHash = new Map<string, Audio>();
/** id da mensagem -> hash. É o que a ponte consulta para montar o caminho. */
const porMensagem = new Map<string, string>();
/** Evita duas sínteses simultâneas do mesmo texto quando o turno reemite. */
const emVoo = new Map<string, Promise<boolean>>();

function hashDe(texto: string): string {
  return createHash('sha256').update(`${vozEscolhida()}|${encoding()}|${texto}`).digest('hex').slice(0, 32);
}

function podar(): void {
  while (porHash.size > MAX_AUDIOS) {
    // Map preserva ordem de inserção: o primeiro é o mais antigo.
    const maisAntigo = porHash.keys().next().value;
    if (maisAntigo === undefined) break;
    porHash.delete(maisAntigo);
    for (const [id, h] of porMensagem) if (h === maisAntigo) porMensagem.delete(id);
  }
}

/**
 * Sintetiza o texto e associa o resultado a `idMensagem`.
 *
 * Nunca lança. Falha de rede, chave inválida ou voz inexistente viram `false` e
 * uma linha de log — a conversa continua, muda. Voz é enfeite de alta qualidade,
 * não caminho crítico.
 */
export async function sintetizar(idMensagem: string, texto: string): Promise<boolean> {
  if (!vozDisponivel()) return false;

  const limpo = texto.trim().slice(0, MAX_CARACTERES);
  if (!limpo) return false;

  const hash = hashDe(limpo);

  // Já sintetizado antes: só reaponta a mensagem para o áudio existente.
  if (porHash.has(hash)) {
    porMensagem.set(idMensagem, hash);
    return true;
  }

  const jaEmVoo = emVoo.get(hash);
  if (jaEmVoo) {
    const ok = await jaEmVoo;
    if (ok) porMensagem.set(idMensagem, hash);
    return ok;
  }

  const tarefa = buscar(limpo, hash);
  emVoo.set(hash, tarefa);

  try {
    const ok = await tarefa;
    if (ok) porMensagem.set(idMensagem, hash);
    return ok;
  } finally {
    emVoo.delete(hash);
  }
}

async function buscar(texto: string, hash: string): Promise<boolean> {
  const abortar = new AbortController();
  const timer = setTimeout(() => abortar.abort(), TEMPO_LIMITE_MS);

  try {
    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'CONVAI-API-KEY': chave(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcript: texto, voice: vozEscolhida(), encoding: encoding() }),
      signal: abortar.signal,
    });

    if (!resposta.ok) {
      // O corpo do erro da Convai é texto curto; vale para o log.
      const detalhe = await resposta.text().catch(() => '');
      console.warn(`[iara] voz: ${resposta.status} ${resposta.statusText} ${detalhe.slice(0, 200)}`);
      return false;
    }

    const bytes = Buffer.from(await resposta.arrayBuffer());
    // A Convai responde com bytes crus. Corpo minúsculo é erro disfarçado de
    // sucesso — áudio de verdade não cabe em 1 KB.
    if (bytes.length < 1024) {
      console.warn(`[iara] voz: resposta de ${bytes.length} bytes, não parece áudio`);
      return false;
    }

    porHash.set(hash, { bytes, tipo: TIPO_MIME[encoding()], criado_em: Date.now() });
    podar();
    return true;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.warn(`[iara] voz indisponível: ${motivo}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Caminho público do áudio de uma mensagem, ou `null`.
 *
 * Consulta síncrona de propósito: a ponte chama isto ao montar cada snapshot, e
 * o snapshot não pode esperar rede.
 */
export function caminhoDaVoz(idMensagem: string): string | null {
  const hash = porMensagem.get(idMensagem);
  return hash ? `/voz/${hash}.${encoding()}` : null;
}

/** Os bytes, para a rota HTTP. O hash vem da URL — nada de caminho de arquivo. */
export function audioPorHash(hash: string): { bytes: Buffer; tipo: string } | null {
  const audio = porHash.get(hash);
  return audio ? { bytes: audio.bytes, tipo: audio.tipo } : null;
}

/** Lista de vozes da conta. Só para diagnóstico — ver `scripts/vozes.mjs`. */
export async function vozesDisponiveis(): Promise<unknown> {
  if (!chave()) throw new Error('CONVAI_API_KEY ausente');
  const resposta = await fetch('https://api.convai.com/tts/get_available_voices', {
    headers: { 'CONVAI-API-KEY': chave() },
  });
  if (!resposta.ok) throw new Error(`${resposta.status} ${resposta.statusText}`);
  return resposta.json();
}
