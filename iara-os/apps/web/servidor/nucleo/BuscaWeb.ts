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

export async function buscarNaWeb(consulta: string, limite = 3): Promise<ResultadoBusca[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(consulta)}`;
  const resposta = await fetch(url, {
    headers: { 'User-Agent': AGENTE, 'Accept-Language': 'pt-BR,pt;q=0.9' },
    signal: AbortSignal.timeout(6000),
  });
  if (!resposta.ok) throw new Error(`DuckDuckGo respondeu ${resposta.status}`);
  const html = await resposta.text();

  const titulos = [...html.matchAll(/class="result__a"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    limparHtml(m[1]),
  );
  const resumos = [...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].map((m) =>
    limparHtml(m[1]),
  );

  const saida: ResultadoBusca[] = [];
  for (let i = 0; i < titulos.length && saida.length < limite; i += 1) {
    if (!titulos[i]) continue;
    saida.push({ titulo: titulos[i], resumo: resumos[i] ?? '' });
  }
  return saida;
}
