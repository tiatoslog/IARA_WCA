/**
 * O PROVEDOR DE NUVEM GRATUITA — um cliente, dois serviços.
 *
 * Groq e Google Gemini expõem o MESMO dialeto (o de `/chat/completions` da
 * OpenAI): mesma forma de pedido, mesmo SSE de resposta, mesmo bloco `usage`.
 * Escrever dois clientes quase iguais seria criar duas verdades para manter em
 * concordância — a doença que este repositório já pagou caro. O que muda entre
 * eles é DADO (endereço, chave, modelo), não código.
 *
 * POR QUE ELE EXISTE (15/08/2026): a cota da Anthropic acabou e a IARA ficou
 * muda. A operadora pediu uma opção sem custo; Groq e Gemini têm camada
 * gratuita de verdade, sem cartão. Este cliente é a porta para elas.
 *
 * INFRAESTRUTURA DECLARADA, NUNCA DESCOBERTA — a mesma regra do Ollama: sem
 * `GROQ_API_KEY` (ou `GEMINI_API_KEY`) no ambiente, o provedor não existe.
 *
 * O QUE NÃO MUDA: a autoridade. O texto que sai daqui passa pelo mesmo
 * `interpretarPlano`, pelo mesmo porteiro, pelas mesmas invariantes. Um modelo
 * gratuito tem exatamente a autoridade do modelo pago: nenhuma.
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

/** O que uma linha do SSE pode carregar. Função pura, testável sem rede. */
export interface LinhaOpenAI {
  /** Texto novo para o operador. */
  pedaco?: string;
  /** Só na linha com `usage` — contagens finais. */
  final?: { tokens_entrada: number; tokens_saida: number };
  /** O erro também chega como JSON no meio do stream. */
  erro?: string;
  /** `data: [DONE]` — fim do stream, sem conteúdo. */
  fim?: boolean;
}

/**
 * Interpreta UMA linha do corpo. Linha vazia, comentário SSE, `[DONE]` ou JSON
 * inválido não podem matar o stream — devolvem `null` ou `fim`.
 */
export function interpretarLinhaOpenAI(linha: string): LinhaOpenAI | null {
  const limpa = linha.trim();
  if (!limpa) return null;
  /* Comentário de keep-alive do SSE (`: ping`) — presente na Groq. */
  if (limpa.startsWith(':')) return null;

  const corpo = limpa.startsWith('data:') ? limpa.slice(5).trim() : limpa;
  if (!corpo) return null;
  if (corpo === '[DONE]') return { fim: true };

  let dado: unknown;
  try {
    dado = JSON.parse(corpo);
  } catch {
    return null;
  }
  if (typeof dado !== 'object' || dado === null) return null;

  const obj = dado as {
    choices?: Array<{ delta?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
    error?: { message?: unknown } | string;
  };

  const resultado: LinhaOpenAI = {};

  if (typeof obj.error === 'string' && obj.error) {
    resultado.erro = obj.error;
  } else if (obj.error && typeof obj.error === 'object' && typeof obj.error.message === 'string') {
    resultado.erro = obj.error.message;
  }

  const conteudo = obj.choices?.[0]?.delta?.content;
  if (typeof conteudo === 'string' && conteudo) resultado.pedaco = conteudo;

  if (obj.usage) {
    resultado.final = {
      tokens_entrada: typeof obj.usage.prompt_tokens === 'number' ? obj.usage.prompt_tokens : 0,
      tokens_saida:
        typeof obj.usage.completion_tokens === 'number' ? obj.usage.completion_tokens : 0,
    };
  }

  return resultado.pedaco || resultado.final || resultado.erro ? resultado : null;
}

/** A identidade de cada serviço. É a ÚNICA diferença entre eles. */
export interface PerfilProvedorAberto {
  /** Nome curto para telemetria e mensagem de erro. */
  readonly apelido: string;
  readonly base: string;
  readonly variavelChave: string;
  readonly variavelModelo: string;
  readonly modeloPadrao: string;
}

export const GROQ: PerfilProvedorAberto = {
  apelido: 'groq',
  base: 'https://api.groq.com/openai/v1',
  variavelChave: 'GROQ_API_KEY',
  variavelModelo: 'GROQ_MODELO',
  /* 70B na camada gratuita: a maior qualidade disponível sem custo, e ordens
     de grandeza acima de um 3B local. */
  modeloPadrao: 'llama-3.3-70b-versatile',
};

export const GEMINI: PerfilProvedorAberto = {
  apelido: 'gemini',
  /* O endpoint COMPATÍVEL do Google — o nativo tem outro formato, e adotá-lo
     exigiria um segundo cliente para nada. */
  base: 'https://generativelanguage.googleapis.com/v1beta/openai',
  variavelChave: 'GEMINI_API_KEY',
  variavelModelo: 'GEMINI_MODELO',
  modeloPadrao: 'gemini-3-flash',
};

export class ClienteCompativelOpenAI implements ProvedorRaciocinio {
  readonly origem = 'nuvem' as const;
  readonly modelo: string;
  readonly apelido: string;
  private readonly base: string;
  private readonly chave: string | null;

  constructor(perfil: PerfilProvedorAberto) {
    this.apelido = perfil.apelido;
    this.base = perfil.base.replace(/\/+$/, '');
    this.chave = lerConfig(perfil.variavelChave);
    this.modelo = lerConfig(perfil.variavelModelo) ?? perfil.modeloPadrao;
  }

  /** Chave presente = disponível. Mesma postura do `ClienteClaude`: não se
   *  sonda serviço de terceiro na subida para descobrir o óbvio. */
  get disponivel(): boolean {
    return this.chave !== null;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    if (!this.chave) {
      throw new ProvedorIndisponivel(
        `${this.apelido} sem chave declarada — camada de raciocínio indisponível.`,
      );
    }

    /* O MESMO prefixo dos outros provedores. Sem prompt caching aqui, então
       uma única mensagem `system` é a forma correta — como no Ollama. */
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

    return this.transmitir(mensagens, pedido);
  }

  private async transmitir(
    mensagens: Array<{ role: string; content: string }>,
    pedido: PedidoRaciocinio,
  ): Promise<RespostaRaciocinio> {
    const resposta = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.chave}`,
      },
      body: JSON.stringify({
        model: this.modelo,
        messages: mensagens,
        stream: true,
        /* Sem isto o bloco `usage` não vem no stream e a telemetria mentiria
           zero para sempre. O Gemini ignora a opção sem reclamar. */
        stream_options: { include_usage: true },
      }),
      signal: pedido.sinal,
    });

    if (!resposta.ok || !resposta.body) {
      const corpo = await resposta.text().catch(() => '');
      throw new ProvedorIndisponivel(
        `${this.apelido} respondeu ${resposta.status}: ${corpo.slice(0, 300)}`,
      );
    }

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let restante = '';
    let texto = '';
    let entrada = 0;
    let saida = 0;

    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) break;
        restante += decodificador.decode(value, { stream: true });

        const linhas = restante.split('\n');
        /* A última pode estar cortada no meio — volta para o buffer. */
        restante = linhas.pop() ?? '';

        for (const linha of linhas) {
          const lida = interpretarLinhaOpenAI(linha);
          if (!lida) continue;
          if (lida.erro) throw new ProvedorIndisponivel(`${this.apelido}: ${lida.erro}`);
          if (lida.pedaco) {
            texto += lida.pedaco;
            pedido.aoReceberTexto(lida.pedaco);
          }
          if (lida.final) {
            entrada = lida.final.tokens_entrada;
            saida = lida.final.tokens_saida;
          }
        }
      }
    } finally {
      void leitor.cancel().catch(() => undefined);
    }

    return {
      texto,
      tokens_entrada: entrada,
      tokens_saida: saida,
      /* Nenhum dos dois expõe cache de prompt: 0 é o número honesto. */
      cache_lido: 0,
      recusado: false,
    };
  }
}
