/**
 * SONDA DE CONEXÕES REAIS — §4 e §5 da auditoria de go-live.
 *
 * A regra que este arquivo existe para obedecer: **disponibilidade não é
 * conexão**. `HTTP 200`, `WebSocket CONNECTED` e `process ONLINE` não provam
 * nada. Cada linha aqui faz uma OPERAÇÃO de verdade e confere o CONTEÚDO da
 * resposta, não o status.
 *
 * Exemplo da diferença, que já custou caro nesta casa: a chave da Anthropic
 * responde `401` com crédito zerado e `200` com crédito — as duas são "o
 * serviço está no ar". Só a segunda deixa a IARA raciocinar.
 *
 * Nenhum valor de credencial é impresso. O relatório diz o que aconteceu,
 * nunca com o quê.
 *
 * Uso: node --env-file=.env.local --import tsx testes/gate/sonda-conexoes.mts
 */

interface Resultado {
  readonly origem: string;
  readonly destino: string;
  readonly protocolo: string;
  readonly credencial: string;
  readonly operacao: string;
  readonly status: 'OPERACAO_OK' | 'FALHOU' | 'SEM_CREDENCIAL';
  readonly evidencia: string;
  readonly ms: number;
}

const resultados: Resultado[] = [];

async function sondar(
  meta: Omit<Resultado, 'status' | 'evidencia' | 'ms'>,
  credencialPresente: boolean,
  corpo: () => Promise<string>,
): Promise<void> {
  if (!credencialPresente) {
    resultados.push({
      ...meta,
      status: 'SEM_CREDENCIAL',
      evidencia: 'variável ausente ou vazia no ambiente',
      ms: 0,
    });
    return;
  }
  const t = Date.now();
  try {
    const evidencia = await corpo();
    resultados.push({ ...meta, status: 'OPERACAO_OK', evidencia, ms: Date.now() - t });
  } catch (e) {
    resultados.push({
      ...meta,
      status: 'FALHOU',
      evidencia: (e as Error).message.slice(0, 160),
      ms: Date.now() - t,
    });
  }
}

const env = (n: string): string => (process.env[n] ?? '').trim();
const tem = (n: string): boolean => env(n).length > 0;

/** Falha alto quando o corpo não é o que a operação promete. */
function exigir(condicao: boolean, motivo: string): void {
  if (!condicao) throw new Error(motivo);
}

// ---------------------------------------------------------------------------
// 1. Provedores de raciocínio — cada um responde uma pergunta com resposta certa
// ---------------------------------------------------------------------------

/** A operação é a MESMA para os quatro: 2+2. Resposta errada é falha. */
const PERGUNTA = 'Responda apenas com o número: quanto é 2+2?';
/* 256 e não 16: modelos de raciocínio gastam o teto pensando e devolvem
   conteúdo VAZIO quando ele é curto. A primeira versão desta sonda usou 16 e
   reprovou Groq e Gemini com resposta "" — mediu o meu teto, não o provedor. */
const respostaTem4 = (t: string): boolean => /\b4\b/.test(t);

await sondar(
  {
    origem: 'motor',
    destino: 'Anthropic Messages API',
    protocolo: 'HTTPS',
    credencial: 'ANTHROPIC_API_KEY',
    operacao: 'completar "2+2" e conferir a resposta',
  },
  tem('ANTHROPIC_API_KEY'),
  async () => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: env('IARA_MODELO') || 'claude-sonnet-5',
        max_tokens: 256,
        messages: [{ role: 'user', content: PERGUNTA }],
      }),
    });
    const j = (await r.json()) as { content?: { text?: string }[]; error?: { message?: string } };
    exigir(r.ok, `HTTP ${r.status}: ${j.error?.message ?? 'sem detalhe'}`);
    const texto = j.content?.[0]?.text ?? '';
    exigir(respostaTem4(texto), `respondeu "${texto.slice(0, 40)}" em vez de 4`);
    return `modelo respondeu "${texto.trim().slice(0, 20)}"`;
  },
);

for (const [nome, url, chave, modelo, padrao] of [
  /* Os padrões vêm de `ClienteCompativelOpenAI` — copiados de propósito, e a
     cópia é conferida por `sonda-conexoes-padroes.test.ts`. Inventar um modelo
     aqui mediria a sonda, não o produto: a primeira versão deste arquivo usou
     `llama-3.3-70b-versatile` e `anthropic/claude-3.5-haiku` e produziu dois
     404 que não eram defeito nenhum. */
  ['OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY', 'OPENROUTER_MODELO', 'nvidia/nemotron-3-ultra-550b-a55b:free'],
  ['Groq', 'https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY', 'GROQ_MODELO', 'openai/gpt-oss-120b'],
] as const) {
  await sondar(
    {
      origem: 'motor',
      destino: `${nome} (compatível OpenAI)`,
      protocolo: 'HTTPS',
      credencial: chave,
      operacao: 'completar "2+2" e conferir a resposta',
    },
    tem(chave),
    async () => {
      const r = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${env(chave)}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          model: env(modelo) || padrao,
          max_tokens: 256,
          messages: [{ role: 'user', content: PERGUNTA }],
        }),
      });
      const j = (await r.json()) as {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      exigir(r.ok, `HTTP ${r.status}: ${j.error?.message ?? 'sem detalhe'}`);
      const texto = j.choices?.[0]?.message?.content ?? '';
      exigir(respostaTem4(texto), `respondeu "${texto.slice(0, 40)}" em vez de 4`);
      return `modelo respondeu "${texto.trim().slice(0, 20)}"`;
    },
  );
}

await sondar(
  {
    origem: 'motor',
    destino: 'Google Gemini (endpoint compatível)',
    protocolo: 'HTTPS',
    credencial: 'GEMINI_API_KEY',
    operacao: 'completar "2+2" e conferir a resposta',
  },
  tem('GEMINI_API_KEY'),
  async () => {
    /* O ENDPOINT COMPATÍVEL e o ALIAS, exatamente como `GEMINI` em
       `ClienteCompativelOpenAI`. A primeira versão desta sonda chamou a API
       nativa com `gemini-2.0-flash` — modelo que o Google aposentou — e
       reprovou um elo que o produto nunca usou. */
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${env('GEMINI_API_KEY')}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: env('GEMINI_MODELO') || 'gemini-flash-latest',
        max_tokens: 256,
        messages: [{ role: 'user', content: PERGUNTA }],
      }),
    });
    const j = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    exigir(r.ok, `HTTP ${r.status}: ${(j.error?.message ?? '').slice(0, 110)}`);
    const texto = j.choices?.[0]?.message?.content ?? '';
    exigir(respostaTem4(texto), `respondeu "${texto.slice(0, 40)}" em vez de 4`);
    return `modelo respondeu "${texto.trim().slice(0, 20)}"`;
  },
);

await sondar(
  {
    origem: 'motor',
    destino: 'Ollama local',
    protocolo: 'HTTP',
    credencial: 'OLLAMA_URL (sem chave)',
    operacao: 'listar modelos carregados',
  },
  true,
  async () => {
    const base = env('OLLAMA_URL') || 'http://127.0.0.1:11434';
    const r = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(4000) });
    exigir(r.ok, `HTTP ${r.status}`);
    const j = (await r.json()) as { models?: { name: string }[] };
    return `${j.models?.length ?? 0} modelo(s): ${(j.models ?? []).map((m) => m.name).join(', ').slice(0, 60)}`;
  },
);

// ---------------------------------------------------------------------------
// 2. Persistência — a operação é LER UMA TABELA, não abrir socket
// ---------------------------------------------------------------------------

await sondar(
  {
    origem: 'motor',
    destino: 'Supabase (service role)',
    protocolo: 'HTTPS/PostgREST',
    credencial: 'SUPABASE_SERVICE_ROLE_KEY',
    operacao: 'SELECT com limite em uma tabela real',
  },
  tem('SUPABASE_URL') && tem('SUPABASE_SERVICE_ROLE_KEY'),
  async () => {
    const chave = env('SUPABASE_SERVICE_ROLE_KEY');
    /* A tabela é descoberta pelo root do PostgREST — nada é presumido sobre o
       esquema, e a lista que volta É a evidência de que o banco respondeu como
       banco, e não como um 200 vazio de proxy. */
    const raiz = await fetch(`${env('SUPABASE_URL')}/rest/v1/`, {
      headers: { apikey: chave, authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15000),
    });
    exigir(raiz.ok, `HTTP ${raiz.status} no root do PostgREST`);
    const esquema = (await raiz.json()) as { paths?: Record<string, unknown> };
    const tabelas = Object.keys(esquema.paths ?? {})
      .filter((p) => p.startsWith('/') && p.length > 1)
      .map((p) => p.slice(1));
    exigir(tabelas.length > 0, 'o PostgREST respondeu sem nenhuma tabela exposta');

    const alvo = tabelas[0];
    const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/${alvo}?select=*&limit=1`, {
      headers: { apikey: chave, authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(15000),
    });
    exigir(r.ok, `HTTP ${r.status} ao ler "${alvo}"`);
    const linhas = (await r.json()) as unknown[];
    return `${tabelas.length} tabela(s) expostas; SELECT em "${alvo}" devolveu ${linhas.length} linha(s)`;
  },
);

await sondar(
  {
    origem: 'navegador',
    destino: 'Supabase Auth',
    protocolo: 'HTTPS',
    credencial: 'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    operacao: 'ler as configurações públicas do GoTrue',
  },
  tem('SUPABASE_URL') && tem('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  async () => {
    const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/settings`, {
      headers: { apikey: env('NEXT_PUBLIC_SUPABASE_ANON_KEY') },
      signal: AbortSignal.timeout(15000),
    });
    exigir(r.ok, `HTTP ${r.status}`);
    const j = (await r.json()) as { external?: Record<string, boolean>; disable_signup?: boolean };
    return `signup ${j.disable_signup ? 'desligado' : 'ligado'}; provedores: ${Object.entries(j.external ?? {}).filter(([, v]) => v).map(([k]) => k).join(', ') || 'só e-mail/senha'}`;
  },
);

// ---------------------------------------------------------------------------
// 3. Microsoft Graph — token E leitura da planilha que a operação usa
// ---------------------------------------------------------------------------

let tokenGraph = '';
await sondar(
  {
    origem: 'motor',
    destino: 'Microsoft identity (client credentials)',
    protocolo: 'HTTPS/OAuth2',
    credencial: 'MS_GRAPH_CLIENT_SECRET',
    operacao: 'trocar segredo por token de aplicativo',
  },
  tem('MS_GRAPH_CLIENT_ID') && tem('MS_GRAPH_TENANT_ID') && tem('MS_GRAPH_CLIENT_SECRET'),
  async () => {
    const corpo = new URLSearchParams({
      client_id: env('MS_GRAPH_CLIENT_ID'),
      client_secret: env('MS_GRAPH_CLIENT_SECRET'),
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const r = await fetch(
      `https://login.microsoftonline.com/${env('MS_GRAPH_TENANT_ID')}/oauth2/v2.0/token`,
      { method: 'POST', body: corpo, signal: AbortSignal.timeout(20000) },
    );
    const j = (await r.json()) as { access_token?: string; expires_in?: number; error_description?: string };
    exigir(r.ok && !!j.access_token, `HTTP ${r.status}: ${(j.error_description ?? '').slice(0, 80)}`);
    tokenGraph = j.access_token!;
    return `token emitido, expira em ${j.expires_in}s`;
  },
);

await sondar(
  {
    origem: 'motor',
    destino: 'Graph — planilha de OCIs',
    protocolo: 'HTTPS',
    credencial: 'MS_GRAPH_OCI_URL',
    operacao: 'baixar a pasta de trabalho e contar bytes',
  },
  tokenGraph.length > 0 && tem('MS_GRAPH_OCI_URL'),
  async () => {
    /* `MS_GRAPH_OCI_URL` é um LINK DE COMPARTILHAMENTO, não uma URL de API.
       O Graph só o entrega pela rota `/shares/{shareId}/driveItem/content`, com
       o id codificado em base64url com prefixo `u!` — é o que
       `ClientePlanilhaOcis` e o oráculo independente fazem. Buscar o link cru
       com Bearer devolve 401, e a primeira versão desta sonda reprovou a
       planilha por isso. */
    const shareId =
      'u!' + Buffer.from(env('MS_GRAPH_OCI_URL')).toString('base64').replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    const r = await fetch(`https://graph.microsoft.com/v1.0/shares/${shareId}/driveItem/content`, {
      headers: { authorization: `Bearer ${tokenGraph}` },
      signal: AbortSignal.timeout(120000),
    });
    exigir(r.ok, `HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    exigir(buf.byteLength > 10_000, `arquivo pequeno demais (${buf.byteLength} bytes)`);
    /* Assinatura de ZIP — todo .xlsx é um zip. Conferir o CONTEÚDO e não só o
       tamanho é o que separa "baixei alguma coisa" de "baixei a planilha". */
    const cabecalho = new Uint8Array(buf.slice(0, 2));
    exigir(cabecalho[0] === 0x50 && cabecalho[1] === 0x4b, 'o corpo não é um arquivo xlsx');
    return `${(buf.byteLength / 1024 / 1024).toFixed(2)} MB, assinatura xlsx confere`;
  },
);

await sondar(
  {
    origem: 'motor',
    destino: 'Graph — caixa de e-mail',
    protocolo: 'HTTPS',
    credencial: 'MS_GRAPH_CAIXA',
    operacao: 'listar 1 mensagem da caixa configurada',
  },
  tokenGraph.length > 0 && tem('MS_GRAPH_CAIXA'),
  async () => {
    const r = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env('MS_GRAPH_CAIXA'))}/messages?$top=1&$select=subject`,
      { headers: { authorization: `Bearer ${tokenGraph}` }, signal: AbortSignal.timeout(30000) },
    );
    const j = (await r.json()) as { value?: unknown[]; error?: { code?: string; message?: string } };
    exigir(r.ok, `HTTP ${r.status}: ${j.error?.code ?? ''} ${(j.error?.message ?? '').slice(0, 90)}`);
    return `a caixa respondeu com ${j.value?.length ?? 0} mensagem(ns) no topo`;
  },
);

// ---------------------------------------------------------------------------
// 4. Voz — a operação é sintetizar áudio de verdade
// ---------------------------------------------------------------------------

await sondar(
  {
    origem: 'motor',
    destino: 'Edge TTS (voz neural)',
    protocolo: 'WSS',
    credencial: 'nenhuma (serviço gratuito)',
    operacao: 'sintetizar uma frase e medir os bytes de áudio',
  },
  true,
  async () => {
    const { MsEdgeTTS, OUTPUT_FORMAT } = (await import('msedge-tts')) as unknown as {
      MsEdgeTTS: new () => {
        setMetadata: (voz: string, formato: unknown) => Promise<void>;
        toStream: (texto: string) => { audioStream: NodeJS.ReadableStream };
      };
      OUTPUT_FORMAT: Record<string, unknown>;
    };
    const tts = new MsEdgeTTS();
    await tts.setMetadata('pt-BR-FranciscaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream('Sonda de conexão.');
    let bytes = 0;
    await new Promise<void>((ok, falhar) => {
      const prazo = setTimeout(() => falhar(new Error('sem áudio em 20 s')), 20000);
      audioStream.on('data', (c: Buffer) => (bytes += c.length));
      audioStream.on('end', () => {
        clearTimeout(prazo);
        ok();
      });
      audioStream.on('error', (e: Error) => {
        clearTimeout(prazo);
        falhar(e);
      });
    });
    exigir(bytes > 1000, `só ${bytes} bytes de áudio`);
    return `${bytes} bytes de MP3 sintetizados`;
  },
);

// ---------------------------------------------------------------------------
// 5. WhatsApp e Google Calendar — declarados, não fingidos
// ---------------------------------------------------------------------------

await sondar(
  {
    origem: 'motor',
    destino: 'WhatsApp Cloud API',
    protocolo: 'HTTPS',
    credencial: 'WHATSAPP_TOKEN',
    operacao: 'ler o número configurado',
  },
  tem('WHATSAPP_TOKEN') && tem('WHATSAPP_PHONE_ID'),
  async () => {
    const r = await fetch(`https://graph.facebook.com/v20.0/${env('WHATSAPP_PHONE_ID')}`, {
      headers: { authorization: `Bearer ${env('WHATSAPP_TOKEN')}` },
      signal: AbortSignal.timeout(15000),
    });
    exigir(r.ok, `HTTP ${r.status}`);
    return 'número respondeu';
  },
);

await sondar(
  {
    origem: 'motor',
    destino: 'Google Calendar',
    protocolo: 'HTTPS',
    credencial: 'GOOGLE_CALENDAR_PRIVATE_KEY',
    operacao: 'listar próximos eventos',
  },
  tem('GOOGLE_CALENDAR_PRIVATE_KEY') && tem('GOOGLE_CALENDAR_ID'),
  async () => 'não implementado nesta sonda',
);

// ---------------------------------------------------------------------------

const largura = { o: 10, d: 34, p: 14, c: 30, op: 44, s: 15 };
console.log('\n| Origem | Destino | Protocolo | Credencial | Operação real | Status | Latência | Evidência |');
console.log('|---|---|---|---|---|---|---|---|');
for (const r of resultados) {
  console.log(
    `| ${r.origem} | ${r.destino} | ${r.protocolo} | ${r.credencial} | ${r.operacao} | **${r.status}** | ${r.ms ? `${r.ms} ms` : '—'} | ${r.evidencia} |`,
  );
}

const ok = resultados.filter((r) => r.status === 'OPERACAO_OK').length;
const falhou = resultados.filter((r) => r.status === 'FALHOU');
const sem = resultados.filter((r) => r.status === 'SEM_CREDENCIAL');
console.log(`\nOPERACAO_OK: ${ok}   FALHOU: ${falhou.length}   SEM_CREDENCIAL: ${sem.length}`);
if (falhou.length) console.log(`falharam: ${falhou.map((r) => r.destino).join(', ')}`);
if (sem.length) console.log(`sem credencial: ${sem.map((r) => r.destino).join(', ')}`);
