/**
 * Transcrição de fala — o STT da IARA, no SERVIDOR.
 *
 * ESTA CAMADA ESTÁ DESLIGADA, E O MOTIVO É O MELHOR QUE EXISTE
 *
 * Ela foi escrita em 15/08/2026 para tirar a fala de dentro do navegador,
 * porque o `SpeechRecognition` da Web Speech API supostamente não servia no
 * iPhone. A sonda (`public/sonda-voz.html`) rodou no aparelho e desmentiu:
 * iPhone/iOS 18.7, Safari 26.6 — duas frases transcritas em pt-BR, `continuous`
 * HONRADO (dois enunciados numa sessão só) e o primeiro parcial 2 ms depois de
 * detectar fala. O `MediaRecorder` de lá ainda entregou webm/opus, não o
 * mp4/aac que se esperava.
 *
 * Sem chave (`IARA_STT_CHAVE` vazia) nada aqui roda e o navegador continua
 * reconhecendo como sempre. É de propósito: o código fica pronto e o caminho
 * fica fechado até haver um motivo medido para abri-lo.
 *
 * O QUE CONTINUA VERDADE sobre a Web Speech, e que um dia pode reabrir isto:
 *
 *  1. NÃO DEIXA ESCOLHER NEM INFORMAR O DISPOSITIVO. Ele usa o padrão de
 *     COMUNICAÇÃO do sistema — que no Windows é um segundo padrão, escondido
 *     num painel legado. Foi assim que a IARA passou dias "sem ouvir" com o
 *     Windows apontando para uma webcam de celular sem fonte. Isso hoje é
 *     acusado pela faixa de `semSinal` em `useDeteccaoVocal`, sem trocar nada
 *     de arquitetura.
 *  2. DEPENDE do serviço de fala do navegador estar de pé e alcançável — a
 *     origem do `error: 'network'` já tratado em `useEscuta`.
 *  3. O RELIGAMENTO SEM GESTO no iOS segue NÃO MEDIDO. É o que a vigília do
 *     "ei IARA" precisa fazer o dia inteiro, e é a única pergunta aberta.
 *
 * A saída é a mesma do `Voz.ts`, na direção oposta: o navegador captura, o
 * motor transcreve. O que muda de lugar é a INTERPRETAÇÃO da fala, não a
 * percepção — a transcrição entra no `Percepcao` existente pela mesma porta por
 * onde entra o texto digitado. Nenhum caminho novo de intenção.
 *
 * HONESTIDADE SOBRE PRIVACIDADE — e o mal-entendido que ela desfaz
 *
 * Isto envia o ÁUDIO do operador a um provedor externo. Antes de parecer uma
 * regressão: o `SpeechRecognition` do Chrome já enviava esse mesmo áudio ao
 * serviço de fala do Google. O comentário em `useEscuta` diz "sem enviar áudio
 * para servidor NOSSO" — verdade, e fácil de ler como se nada saísse da
 * máquina. A fronteira não é nova; o que muda é ela passar a ser escolhida,
 * declarada e trocável em vez de ser um comportamento não documentado do
 * navegador.
 *
 * A CHAVE VIVE SÓ AQUI, pela mesma razão da Convai: SDK no navegador embute a
 * chave no bundle e qualquer um a leva do devtools. `IARA_STT_CHAVE` nunca é
 * prefixada com `NEXT_PUBLIC_`, e não pode ser.
 *
 * O MOTOR É UMA PORTA, NÃO UM ACOPLAMENTO. `MotorTranscricao` tem uma
 * implementação hoje; trocar por outro provedor — ou por um Whisper local
 * rodando no braço do operador, que é o caminho de latência zero para o
 * desktop — é uma classe nova, não uma refatoração.
 */

const ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

/**
 * Teto de bytes. Um enunciado de operador é de segundos: 8 MB de Opus são
 * minutos de fala com folga larga. O teto existe porque a rota aceita upload —
 * e toda rota que aceita upload sem teto é memória do motor à disposição de
 * quem quiser gastá-la.
 */
export const MAX_BYTES_AUDIO = 8 * 1024 * 1024;

/**
 * Corpo pequeno demais nunca é fala. O `MediaRecorder` produz ~250 bytes/s
 * codificando silêncio e alguns milhares codificando voz — abaixo disto não há
 * o que transcrever, e mandar assim é pagar uma chamada para receber vazio.
 */
const MINIMO_BYTES_AUDIO = 2048;

const TEMPO_LIMITE_MS = 30_000;

export interface ResultadoTranscricao {
  ok: boolean;
  /** O que foi dito, quando `ok`. String vazia quando o áudio era silêncio. */
  texto: string;
  /** Por que falhou, quando `!ok`. Nunca contém a chave nem corpo de resposta cru. */
  motivo: string;
  /** Quanto custou, para `medir:stt` e para a telemetria de latência. */
  ms: number;
}

export interface MotorTranscricao {
  nome: string;
  transcrever(bytes: Buffer, tipoMime: string): Promise<ResultadoTranscricao>;
}

/**
 * O ambiente é lido em FUNÇÃO, nunca no topo do módulo — `import` é hasteado e
 * o `dotenv` carrega depois. É a mesma armadilha documentada em `Voz.ts`, e o
 * sintoma é cruel: a chave está no arquivo e o servidor jura que não está.
 */
function chave(): string {
  return (process.env.IARA_STT_CHAVE ?? process.env.OPENAI_API_KEY ?? '').trim();
}

function modelo(): string {
  return (process.env.IARA_STT_MODELO ?? '').trim() || 'gpt-4o-mini-transcribe';
}

/**
 * Dizer o idioma ao provedor não é detalhe: sem isso ele adivinha pelo áudio, e
 * um "ok" ou um "tá" solto em português vira inglês com frequência
 * desconfortável. A IARA opera em pt-BR.
 */
function idioma(): string {
  return (process.env.IARA_STT_IDIOMA ?? '').trim() || 'pt';
}

export function transcricaoDisponivel(): boolean {
  return chave().length > 0;
}

/** Para o log de subida ser útil em vez de misterioso — igual ao `diagnosticoVoz`. */
export function diagnosticoTranscricao(): string {
  if (!transcricaoDisponivel()) {
    return 'desligada (sem IARA_STT_CHAVE) — a fala continua sendo reconhecida pelo navegador';
  }
  return `${modelo()}, idioma "${idioma()}"`;
}

/**
 * O provedor infere o formato pela EXTENSÃO do arquivo enviado, não pelo
 * content-type — mandar tudo como "audio" faz ele recusar áudio perfeitamente
 * válido. O Chrome grava webm/opus e o iOS grava mp4/aac: os dois precisam
 * chegar com o nome certo, e é por isso que este mapa existe em vez de um
 * padrão fixo.
 */
const EXTENSAO: Array<[RegExp, string]> = [
  [/webm/i, 'webm'],
  [/ogg|opus/i, 'ogg'],
  [/mp4|m4a|aac/i, 'mp4'],
  [/mpeg|mp3/i, 'mp3'],
  [/wav/i, 'wav'],
];

export function extensaoDe(tipoMime: string): string | null {
  for (const [padrao, ext] of EXTENSAO) if (padrao.test(tipoMime)) return ext;
  return null;
}

/**
 * Transcreve. NUNCA lança — falha de rede, chave inválida ou formato recusado
 * viram `ok: false` com motivo. A conversa segue: quem chamou decide se avisa o
 * operador ou cai para outro caminho, exatamente como a voz faz na direção
 * oposta.
 */
export async function transcrever(bytes: Buffer, tipoMime: string): Promise<ResultadoTranscricao> {
  const inicio = Date.now();
  const falha = (motivo: string): ResultadoTranscricao => ({
    ok: false,
    texto: '',
    motivo,
    ms: Date.now() - inicio,
  });

  if (!transcricaoDisponivel()) return falha('transcrição desligada (sem chave)');
  if (bytes.length > MAX_BYTES_AUDIO) return falha(`áudio grande demais (${bytes.length} bytes)`);
  if (bytes.length < MINIMO_BYTES_AUDIO) return falha('áudio curto demais para conter fala');

  const ext = extensaoDe(tipoMime);
  if (!ext) return falha(`formato não reconhecido: ${tipoMime}`);

  const abortar = new AbortController();
  const timer = setTimeout(() => abortar.abort(), TEMPO_LIMITE_MS);

  try {
    const formulario = new FormData();
    formulario.append('file', new Blob([new Uint8Array(bytes)], { type: tipoMime }), `fala.${ext}`);
    formulario.append('model', modelo());
    formulario.append('language', idioma());

    const resposta = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${chave()}` },
      body: formulario,
      signal: abortar.signal,
    });

    if (!resposta.ok) {
      /**
       * O corpo do erro fica no LOG do motor e não sobe na resposta. Mensagem de
       * provedor às vezes ecoa o que foi enviado, e a rota devolve isto a um
       * navegador — a mesma disciplina de redação de segredo que já vale em
       * `SessaoOperador.enviar`.
       */
      const detalhe = await resposta.text().catch(() => '');
      console.warn(`[iara] stt: ${resposta.status} ${resposta.statusText} ${detalhe.slice(0, 300)}`);
      return falha(`provedor recusou (${resposta.status})`);
    }

    const corpo = (await resposta.json()) as { text?: unknown };
    const texto = typeof corpo.text === 'string' ? corpo.text.trim() : '';
    return { ok: true, texto, motivo: '', ms: Date.now() - inicio };
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : String(erro);
    console.warn(`[iara] stt indisponível: ${motivo}`);
    return falha(motivo);
  } finally {
    clearTimeout(timer);
  }
}

/** A implementação de hoje, atrás da porta. Ver o cabeçalho sobre trocá-la. */
export const motorPadrao: MotorTranscricao = {
  get nome() {
    return modelo();
  },
  transcrever,
};
