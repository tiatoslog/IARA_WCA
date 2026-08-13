/**
 * Busca web por HTTP puro.
 *
 * Proibido navegador headless (Puppeteer/Playwright): um Chromium por consulta
 * esgota a RAM do servidor e some com a vantagem de latência da camada local.
 * Aqui é um GET no endpoint HTML do DuckDuckGo + extração de texto.
 */

const AGENTE =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

export interface ResultadoBusca {
  titulo: string;
  resumo: string;
}

function limparHtml(bruto: string): string {
  return bruto
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Teto do corpo lido, em bytes.
 *
 * O destino é fixo e de terceiro, então não há SSRF a barrar aqui — o que há é
 * uma resposta de tamanho que este processo não controla. `resposta.text()`
 * sem teto materializa o que vier na heap do motor, e uma página de resultados
 * cabe folgadamente em 2 MB. Cortar é preferível a confiar no bom
 * comportamento de quem está do outro lado.
 */
const MAX_CORPO = 2 * 1024 * 1024;

async function lerComTeto(resposta: Response): Promise<string> {
  const corpo = resposta.body;
  if (!corpo) return '';
  const leitor = corpo.getReader();
  const decodificador = new TextDecoder();
  let saida = '';
  let lidos = 0;
  try {
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      lidos += value.byteLength;
      saida += decodificador.decode(value, { stream: true });
      if (lidos >= MAX_CORPO) break;
    }
  } finally {
    await leitor.cancel().catch(() => undefined);
  }
  return saida;
}

export async function buscarNaWeb(consulta: string, limite = 3): Promise<ResultadoBusca[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`;
  const resposta = await fetch(url, {
    headers: { 'User-Agent': AGENTE, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(6000),
  });
  if (!resposta.ok) throw new Error(`DuckDuckGo respondeu ${resposta.status}`);
  const html = await lerComTeto(resposta);

  /**
   * Extração POR BLOCO de resultado, nunca em duas listas paralelas: um
   * resultado sem snippet deslocaria todos os pares seguintes e o título A
   * sairia com o resumo do resultado B.
   */
  const blocos = [...html.matchAll(/class="result__body"[\s\S]*?(?=class="result__body"|<div id=|$)/g)];
  const saida: ResultadoBusca[] = [];
  for (const bloco of blocos) {
    if (saida.length >= limite) break;
    const titulo = bloco[0].match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    if (!titulo) continue;
    const resumo = bloco[0].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const t = limparHtml(titulo[1]);
    if (!t) continue;
    saida.push({ titulo: t, resumo: resumo ? limparHtml(resumo[1]) : '' });
  }
  return saida;
}
