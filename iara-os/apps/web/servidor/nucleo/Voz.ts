/**
 * Voz da IARA — síntese de fala no SERVIDOR, com dois provedores.
 *
 * 1. CONVAI (paga, com chave) — qualidade premium. Tem precedência quando
 *    `CONVAI_API_KEY` + `CONVAI_VOZ` estão configuradas.
 * 2. NEURAL DO EDGE (grátis, padrão desde a V4) — o mesmo serviço de vozes
 *    "Natural" que o navegador Edge usa, acessado pelo motor. Voz padrão
 *    `pt-BR-FranciscaNeural` (feminina — identidade da IARA, inegociável; o
 *    Piper local foi descartado porque o catálogo pt-BR dele só tem vozes
 *    masculinas). Desligável com `IARA_VOZ_NEURAL=0`; trocável com
 *    `IARA_VOZ_EDGE`.
 *
 * HONESTIDADE SOBRE PRIVACIDADE: o provedor neural envia o TEXTO da resposta
 * ao serviço da Microsoft — exatamente o que o Edge faz quando usa uma voz
 *"Natural" no navegador. Quem precisar de voz 100% local desliga com
 * `IARA_VOZ_NEURAL=0` e fica com a síntese do navegador (Maria).
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
 */

import { createHash } from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

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

/** Voz neural do Edge. Feminina por identidade — ver o cabeçalho. */
function vozEdge(): string {
  return (process.env.IARA_VOZ_EDGE ?? '').trim() || 'pt-BR-FranciscaNeural';
}

type Provedor = 'convai' | 'edge';

/** Convai configurada tem precedência; o neural grátis é o padrão. */
function provedor(): Provedor | null {
  if (chave().length > 0 && vozEscolhida().length > 0) return 'convai';
  if (process.env.IARA_VOZ_NEURAL !== '0') return 'edge';
  return null;
}

export function vozDisponivel(): boolean {
  return provedor() !== null;
}

/** Diz o que está em uso, para o log de subida ser útil em vez de misterioso. */
export function diagnosticoVoz(): string {
  switch (provedor()) {
    case 'convai':
      return `Convai, voz "${vozEscolhida()}", ${encoding()}`;
    case 'edge':
      return `neural do Edge, voz "${vozEdge()}" (grátis; desligável com IARA_VOZ_NEURAL=0)`;
    default:
      return 'desligada (IARA_VOZ_NEURAL=0 e sem Convai) — síntese do navegador assume';
  }
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
  const voz = provedor() === 'edge' ? `edge:${vozEdge()}` : vozEscolhida();
  return createHash('sha256').update(`${voz}|${encoding()}|${texto}`).digest('hex').slice(0, 32);
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
  if (provedor() === 'edge') return buscarEdge(texto, hash);
  return buscarConvai(texto, hash);
}

/**
 * A CONEXÃO DE SÍNTESE É REUSADA — e isto vale ~2,4 s por resposta.
 *
 * Cada `new MsEdgeTTS()` + `setMetadata()` abre um WebSocket novo com o
 * serviço da Microsoft. Medido em 12/08/2026 (`npm run medir:voz`):
 *
 *     conexão nova por fala ....... 2515–3343 ms
 *     só o handshake .............. 1007 ms
 *     na conexão já aberta ........ 499–746 ms
 *
 * O custo é de CONEXÃO, não de comprimento: sintetizar uma sentença custava
 * praticamente o mesmo que sintetizar seis. Foi essa medição que descartou a
 * ideia de picotar a resposta em segmentos — cada segmento pagaria um
 * handshake novo e a fala começaria MAIS tarde, não antes.
 *
 * As duas disciplinas que o reuso obriga:
 *
 *  1. SERIALIZAÇÃO. Uma conexão, um stream por vez. Dois `toStream` em voo
 *     na mesma conexão entrelaçariam os quadros de áudio de duas falas.
 *  2. DESCARTE EM FALHA. Socket morto não se recupera sozinho; qualquer erro
 *     joga a conexão fora e a próxima fala reconstrói. Reusar um socket em
 *     estado desconhecido é como o fallback que mascara erro: funciona até
 *     não funcionar, e aí falha para sempre.
 */
let conexao: MsEdgeTTS | null = null;
let conexaoDeVoz = '';
/** Fila de um: a próxima síntese espera a anterior soltar a conexão. */
let vez: Promise<unknown> = Promise.resolve();

async function conexaoViva(): Promise<MsEdgeTTS> {
  const voz = vozEdge();
  if (conexao && conexaoDeVoz === voz) return conexao;
  // Trocar de voz em tempo de execução (IARA_VOZ_EDGE) exige metadados novos.
  descartarConexao();
  const nova = new MsEdgeTTS();
  await nova.setMetadata(voz, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  conexao = nova;
  conexaoDeVoz = voz;
  return nova;
}

function descartarConexao(): void {
  const morta = conexao;
  conexao = null;
  conexaoDeVoz = '';
  try {
    morta?.close();
  } catch {
    /* já fechada: fechar duas vezes não é erro que interesse a ninguém */
  }
}

/**
 * Abre a conexão de síntese ANTES de haver texto para sintetizar.
 *
 * O ganho é de sobreposição, não de velocidade: o aperto de mão com o serviço
 * da Microsoft custa ~1 s (medido em `npm run medir:voz`), e até aqui ele era
 * pago DEPOIS de a resposta ficar pronta — somando ao tempo que o operador
 * espera em silêncio. Aquecendo no início do turno, esse segundo acontece
 * enquanto a IARA ainda está pensando, e quando o texto chega o socket já está
 * aberto. Nada muda na fala: mesma voz, mesma prosódia, mesmo áudio.
 *
 * Ficou mais valioso com o motor na nuvem: da máquina do operador o handshake
 * era local-ish; de um host nos EUA, cada ida e volta pesa mais.
 *
 * SILENCIOSA POR CONTRATO. É otimização, não funcionalidade — se falhar, a
 * síntese de verdade reconstrói a conexão como sempre fez, e ninguém percebe.
 * Por isso o erro não é logado: um aviso aqui apareceria em toda queda de rede
 * sem nada ter quebrado.
 */
export function aquecerVoz(): void {
  // Só o Edge mantém socket. A Convai é HTTP por requisição — não há o que aquecer.
  if (provedor() !== 'edge') return;
  void conexaoViva().catch(() => {
    descartarConexao();
  });
}

/** Só para o teste de encerramento — o processo não deve segurar socket. */
export function encerrarVoz(): void {
  descartarConexao();
}

/**
 * Síntese pelo serviço neural do Edge. O mp3 chega em stream via WebSocket da
 * biblioteca; aqui só se acumula em buffer e entra na MESMA cache e rota
 * `/voz/<hash>.mp3` da Convai — nenhum caminho novo no sistema.
 */
async function buscarEdge(texto: string, hash: string): Promise<boolean> {
  // Encadeia na fila e devolve a vez mesmo se esta síntese explodir.
  const minhaVez = vez.then(
    () => undefined,
    () => undefined,
  );
  let liberar!: () => void;
  vez = new Promise<void>((r) => {
    liberar = r;
  });
  await minhaVez;

  try {
    const tts = await conexaoViva();
    /**
     * PROSÓDIA MAIS MADURA — achado ao vivo em auditoria (14/08/2026): a voz
     * padrão da Francisca soa "animada" demais para o registro da IARA
     * ("Madura, calma, articulada", ver `ClienteClaude.ts`). O timbre não
     * muda — pitch e ritmo levemente abaixo do padrão bastam para tirar o
     * brilho de apresentadora sem soar arrastado ou robótico. Mesmo
     * princípio do `useVoz.ts` do lado do cliente: "SUTIL basta".
     */
    const { audioStream } = tts.toStream(texto, { pitch: '-6%', rate: '-6%' });

    const bytes = await new Promise<Buffer>((resolver, rejeitar) => {
      const pedacos: Buffer[] = [];
      const limite = setTimeout(
        () => rejeitar(new Error(`síntese excedeu ${TEMPO_LIMITE_MS}ms`)),
        TEMPO_LIMITE_MS,
      );
      audioStream.on('data', (p: Buffer) => pedacos.push(p));
      audioStream.on('end', () => {
        clearTimeout(limite);
        resolver(Buffer.concat(pedacos));
      });
      audioStream.on('error', (e: Error) => {
        clearTimeout(limite);
        rejeitar(e);
      });
    });

    // Corpo minúsculo é erro disfarçado — áudio de verdade não cabe em 1 KB.
    if (bytes.length < 1024) {
      console.warn(`[iara] voz neural: resposta de ${bytes.length} bytes, não parece áudio`);
      descartarConexao();
      return false;
    }

    porHash.set(hash, { bytes, tipo: TIPO_MIME.mp3, criado_em: Date.now() });
    podar();
    return true;
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    // Socket em estado desconhecido não se reusa: a próxima fala reconstrói.
    descartarConexao();
    /**
     * A conversa segue e o navegador assume a voz — AGORA IMEDIATAMENTE, não
     * depois de seis segundos. O cliente costumava adivinhar essa falha com um
     * timer cego; hoje ela viaja como fato no snapshot. Ver `PonteProjecao`.
     */
    console.warn(`[iara] voz neural indisponível: ${motivo}`);
    return false;
  } finally {
    liberar();
  }
}

async function buscarConvai(texto: string, hash: string): Promise<boolean> {
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
  if (!hash) return null;
  // O neural do Edge é sempre mp3; `CONVAI_ENCODING` só vale para a Convai.
  const extensao = provedor() === 'edge' ? 'mp3' : encoding();
  return `/voz/${hash}.${extensao}`;
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
