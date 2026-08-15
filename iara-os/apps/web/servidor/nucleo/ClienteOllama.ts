/**
 * O provedor de raciocínio LOCAL — um servidor Ollama na própria máquina ou
 * em outra máquina da rede privada do operador.
 *
 * Três decisões de engenharia, espelhando as do `ClienteClaude`:
 *
 *  1. STREAMING obrigatório. `/api/chat` com `stream: true` devolve JSON por
 *     linha; cada pedaço vai ao operador na hora, como na nuvem.
 *  2. INFRAESTRUTURA DECLARADA, nunca descoberta. Este módulo só existe se
 *     `OLLAMA_URL` (ou `IARA_PROVEDOR=ollama`) estiver no ambiente — um motor
 *     não muda de cérebro porque um processo alheio abriu a porta 11434.
 *  3. SONDA COM CACHE. `disponivel` precisa ser síncrono (o roteador decide
 *     rota sem await); a sonda ativa roda por fora, com TTL, e o getter nunca
 *     bloqueia. Erro de conexão em voo zera o cache na hora — o turno seguinte
 *     roteia honesto sem esperar o TTL vencer.
 *
 * O que NÃO muda em relação à nuvem: a autoridade. O texto que sai daqui passa
 * pelo mesmo `interpretarPlano`, pelo mesmo porteiro, pelas mesmas invariantes.
 * Um modelo rodando no computador do operador tem exatamente a autoridade do
 * modelo da Anthropic: nenhuma.
 */

import { lerConfig } from './kernel/Configuracao';
import { PERSONA } from './Persona';
import {
  ProvedorIndisponivel,
  normalizarHistorico,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from './ProvedorRaciocinio';

/** O que uma linha do stream do Ollama pode carregar. Função pura, testável sem servidor. */
export interface LinhaOllama {
  /** Texto novo para o operador. */
  pedaco?: string;
  /** Presente na linha `done: true` — contagens finais. */
  final?: { tokens_entrada: number; tokens_saida: number };
  /** O Ollama também relata erro como linha JSON no meio do stream. */
  erro?: string;
}

/**
 * Interpreta UMA linha do corpo de `/api/chat`. Linha vazia, malformada ou
 * JSON inválido devolve `null` — uma linha ruim não pode matar o stream.
 */
export function interpretarLinhaOllama(linha: string): LinhaOllama | null {
  const limpa = linha.trim();
  if (!limpa) return null;

  let dado: unknown;
  try {
    dado = JSON.parse(limpa);
  } catch {
    return null;
  }
  if (typeof dado !== 'object' || dado === null) return null;

  const obj = dado as {
    message?: { content?: unknown };
    done?: unknown;
    error?: unknown;
    prompt_eval_count?: unknown;
    eval_count?: unknown;
  };

  const resultado: LinhaOllama = {};
  if (typeof obj.error === 'string' && obj.error) resultado.erro = obj.error;
  if (typeof obj.message?.content === 'string' && obj.message.content) {
    resultado.pedaco = obj.message.content;
  }
  if (obj.done === true) {
    resultado.final = {
      tokens_entrada: typeof obj.prompt_eval_count === 'number' ? obj.prompt_eval_count : 0,
      tokens_saida: typeof obj.eval_count === 'number' ? obj.eval_count : 0,
    };
  }
  return resultado.pedaco || resultado.final || resultado.erro ? resultado : null;
}

/** Sonda: quanto tempo o resultado vale antes de sondar de novo. */
const TTL_SONDA_MS = 30_000;
/** Sonda: teto de espera — a subida do motor nunca fica presa nisto. */
const PRAZO_SONDA_MS = 1_500;

/**
 * Janela de contexto PEDIDA ao servidor. O binário real usa 4096 por padrão —
 * e trunca o prompt EM SILÊNCIO quando ele não cabe. Descoberto no E2E-004 de
 * 15/08/2026, com o Ollama de verdade: a PERSONA sozinha tem ~3,7k tokens, e o
 * modelo respondia sem jamais ter visto o começo dela. O stub dos testes nunca
 * poderia revelar isso — é exatamente a classe de defeito "doc ≠ binário" que
 * a lacuna E2E-004 existia para caçar. 8192 comporta PERSONA + catálogo +
 * conversa curta; quem precisa de mais declara `OLLAMA_CONTEXTO`, pagando o
 * custo de RAM sabendo que está pagando.
 */
const CONTEXTO_PADRAO = 8192;

export class ClienteOllama implements ProvedorRaciocinio {
  readonly origem = 'local' as const;
  readonly modelo: string;
  private readonly url: string;
  private readonly contexto: number;
  private alcancavel = false;
  private instanteSonda = 0;
  /** Chamadas de `/api/chat` em andamento — ver `sondar()`. */
  private emVoo = 0;

  constructor() {
    // Sem sonda aqui: a fábrica (e os testes) instanciam isto sem tocar rede.
    // A primeira sonda real acontece via `Porta` → `prepararRaciocinio()`.
    this.modelo = lerConfig('OLLAMA_MODELO') ?? 'llama3.1';
    this.url = (lerConfig('OLLAMA_URL') ?? 'http://127.0.0.1:11434').replace(/\/+$/, '');
    const declarado = Number(lerConfig('OLLAMA_CONTEXTO'));
    this.contexto = Number.isFinite(declarado) && declarado > 0 ? declarado : CONTEXTO_PADRAO;
  }

  /**
   * NUNCA bloqueia. Devolve o último resultado de sonda; se ele venceu,
   * dispara uma sonda em segundo plano e responde com o valor antigo — o
   * turno atual usa o que se sabe, o próximo usa o que se descobriu.
   */
  get disponivel(): boolean {
    if (Date.now() - this.instanteSonda > TTL_SONDA_MS) {
      void this.sondar();
    }
    return this.alcancavel;
  }

  /**
   * `GET /api/tags` com prazo curto. Nunca lança — indisponível é resposta,
   * não erro.
   *
   * COM STREAM EM VOO, A SONDA NÃO DERRUBA O CACHE. Descoberto no E2E-004 com
   * o binário real em CPU saturada: uma geração longa deixa a máquina a 100%,
   * o `/api/tags` passa a demorar mais que o prazo da sonda, e a sonda de
   * fundo marcava o servidor como morto ENQUANTO ele respondia o turno — o
   * check de síntese do Kernel via `disponivel:false` e trocava uma resposta
   * real pelo fallback honesto. Uma chamada ativa é evidência melhor que a
   * sonda; a queda real continua coberta pelo `ehErroDeConexao` em voo, que
   * zera o cache na hora.
   */
  async sondar(): Promise<boolean> {
    this.instanteSonda = Date.now();
    if (this.emVoo > 0) return this.alcancavel;
    try {
      const resposta = await fetch(`${this.url}/api/tags`, {
        signal: AbortSignal.timeout(PRAZO_SONDA_MS),
      });
      this.alcancavel = resposta.ok;
    } catch {
      if (this.emVoo === 0) this.alcancavel = false;
    }
    return this.alcancavel;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    if (!this.alcancavel) {
      throw new ProvedorIndisponivel(
        `Ollama não alcançável em ${this.url} — camada de raciocínio local desligada.`,
      );
    }

    /**
     * O MESMO prefixo do `ClienteClaude` (`PERSONA` + capacidades + camada
     * global), com o override volátil concatenado no fim. O Ollama não tem
     * prompt caching, então não há breakpoint a preservar — uma única mensagem
     * `system` é a forma correta aqui.
     */
    const prefixo = [
      PERSONA,
      pedido.capacidades ? `O QUE VOCÊ SABE FAZER\n${pedido.capacidades}` : '',
      pedido.camadaGlobal ? `CONTEXTO PÚBLICO DA EMPRESA\n${pedido.camadaGlobal}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const sistema = pedido.overridePersona ? `${prefixo}\n\n${pedido.overridePersona}` : prefixo;

    const mensagens = [
      { role: 'system' as const, content: sistema },
      ...normalizarHistorico(pedido.historico, pedido.mensagem),
    ];

    return this.transmitirComRetentativa(mensagens, pedido);
  }

  /**
   * A MESMA política do `ClienteClaude`: 3 tentativas, recuo 1s·2^(n-1), e o
   * corte rígido — um único pedaço entregue ao operador fecha a porta da
   * retentativa, porque repetir depois de texto parcial duplicaria a fala.
   *
   * A taxonomia de erro é DESTE provedor, e por isso o laço é duplicado em vez
   * de extraído: transitório aqui é rede (Ollama reiniciando, ECONNRESET) e
   * 500/503; 404 é "modelo não baixado" — repetir só repete, e a mensagem
   * certa é dizer qual modelo falta.
   */
  private async transmitirComRetentativa(
    mensagens: Array<{ role: string; content: string }>,
    pedido: PedidoRaciocinio,
  ): Promise<RespostaRaciocinio> {
    const MAX_TENTATIVAS = 3;
    const RECUO_BASE_MS = 1000;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      let algumTextoChegou = false;
      try {
        return await this.transmitir(mensagens, pedido, () => {
          algumTextoChegou = true;
        });
      } catch (erro) {
        if (this.ehErroDeConexao(erro)) {
          // O servidor sumiu entre a sonda e a chamada: o cache está mentindo.
          this.alcancavel = false;
        }
        const podeTentarDeNovo =
          !pedido.sinal.aborted &&
          !algumTextoChegou &&
          this.ehErroTransitorio(erro) &&
          tentativa < MAX_TENTATIVAS;
        if (!podeTentarDeNovo) throw erro;
        const espera = RECUO_BASE_MS * 2 ** (tentativa - 1);
        await new Promise((resolver) => setTimeout(resolver, espera));
      }
    }
    // Inatingível — o laço sempre retorna ou lança. O TypeScript não sabe.
    throw new Error('retentativa esgotada sem lançar o erro original');
  }

  private async transmitir(
    mensagens: Array<{ role: string; content: string }>,
    pedido: PedidoRaciocinio,
    marcarTextoEntregue: () => void,
  ): Promise<RespostaRaciocinio> {
    this.emVoo += 1;
    try {
      return await this.transmitirDeVerdade(mensagens, pedido, marcarTextoEntregue);
    } finally {
      this.emVoo -= 1;
    }
  }

  private async transmitirDeVerdade(
    mensagens: Array<{ role: string; content: string }>,
    pedido: PedidoRaciocinio,
    marcarTextoEntregue: () => void,
  ): Promise<RespostaRaciocinio> {
    const resposta = await fetch(`${this.url}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.modelo,
        messages: mensagens,
        stream: true,
        // Sempre declarado — ver `CONTEXTO_PADRAO`: o padrão do binário trunca.
        options: { num_ctx: this.contexto },
      }),
      signal: pedido.sinal,
    });

    if (!resposta.ok) {
      const corpo = await resposta.text().catch(() => '');
      const detalhe = corpo.slice(0, 200) || resposta.statusText;
      const erro = new Error(`Ollama respondeu ${resposta.status}: ${detalhe}`);
      (erro as Error & { status?: number }).status = resposta.status;
      throw erro;
    }
    if (!resposta.body) throw new Error('Ollama respondeu sem corpo de stream');

    let texto = '';
    let tokens_entrada = 0;
    let tokens_saida = 0;

    const decodificador = new TextDecoder();
    let sobra = '';
    const consumirLinha = (linha: string): void => {
      const interpretada = interpretarLinhaOllama(linha);
      if (!interpretada) return;
      if (interpretada.erro) throw new Error(`Ollama relatou erro no stream: ${interpretada.erro}`);
      if (interpretada.pedaco) {
        texto += interpretada.pedaco;
        marcarTextoEntregue();
        pedido.aoReceberTexto(interpretada.pedaco);
      }
      if (interpretada.final) {
        tokens_entrada = interpretada.final.tokens_entrada;
        tokens_saida = interpretada.final.tokens_saida;
      }
    };

    for await (const bloco of resposta.body as unknown as AsyncIterable<Uint8Array>) {
      if (pedido.sinal.aborted) break;
      sobra += decodificador.decode(bloco, { stream: true });
      let quebra = sobra.indexOf('\n');
      while (quebra >= 0) {
        consumirLinha(sobra.slice(0, quebra));
        sobra = sobra.slice(quebra + 1);
        quebra = sobra.indexOf('\n');
      }
    }
    if (sobra) consumirLinha(sobra);

    // Stream completo é a prova de alcançabilidade mais barata que existe —
    // renova o cache para que uma sonda estourada durante a geração não deixe
    // um `false` velho valendo depois que a resposta inteira já atravessou.
    this.alcancavel = true;
    this.instanteSonda = Date.now();

    return { texto, tokens_entrada, tokens_saida, cache_lido: 0, recusado: false };
  }

  /** Rede caiu OU nunca esteve lá: o par de erros que também invalida a sonda. */
  private ehErroDeConexao(erro: unknown): boolean {
    const causa = (erro as { cause?: { code?: string } } | null)?.cause;
    if (causa?.code && /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH/.test(causa.code)) {
      return true;
    }
    // `fetch` do Node embrulha falha de rede em TypeError("fetch failed").
    return erro instanceof TypeError;
  }

  /** Transitório = o servidor existe e tropeçou. 404 (modelo não baixado) e
   *  400 (payload) não são: repetir só repete o mesmo erro mais devagar. */
  private ehErroTransitorio(erro: unknown): boolean {
    if (this.ehErroDeConexao(erro)) return true;
    const status = (erro as { status?: number } | null)?.status;
    return status === 500 || status === 503;
  }
}
