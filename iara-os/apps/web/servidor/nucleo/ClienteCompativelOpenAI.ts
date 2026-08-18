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
  /**
   * `llama-3.3-70b-versatile` SAIU DO CATÁLOGO DA GROQ, e a IARA passou a 404 no
   * primeiro elo da cadeia — em produção, em todo turno.
   *
   * Descoberto em 18/08/2026 pela campanha CO, na primeira rodada que de fato
   * chegou à Groq: dez das treze missões voltaram com
   * `groq respondeu 404: The model llama-3.3-70b-versatile does not exist`.
   * Não era limitação do modelo, era ausência dele. Consultada, a API lista
   * hoje: `openai/gpt-oss-120b`, `openai/gpt-oss-20b`, `qwen/qwen3.6-27b`,
   * `groq/compound` — e nenhum llama.
   *
   * UM MODELO FIXADO NO CÓDIGO É UM PRAZO DE VALIDADE QUE NINGUÉM ANOTOU. A
   * cadeia mascara isto de propósito (o elo morto cede a vez ao próximo desde
   * 5c5ac94), então a IARA continua respondendo — pelo elo seguinte, sem o
   * gratuito, e ninguém percebe até alguém medir. `GROQ_MODELO` no ambiente
   * continua vencendo, que é a saída sem deploy quando isto acontecer de novo.
   *
   * `openai/gpt-oss-120b` E NÃO O `qwen`, e a escolha foi MEDIDA, não deduzida
   * do tamanho: o Qwen despeja o bloco `<think>` dentro de `content`, e este
   * cliente lê `delta.content` — o pensamento dele viraria fala da IARA. O
   * gpt-oss entrega `content: "OK"` com o raciocínio num campo `reasoning`
   * separado, que é justamente o que o leitor de stream ignora. 120B MoE,
   * ~0,7 s no teste, gratuito.
   *
   * ------------------------------------------------------------------------
   * O TETO DA GROQ GRATUITA NÃO CABE NA IARA, e isto vale mais que a escolha do
   * modelo acima. Medido em 18/08/2026, cabeçalhos `x-ratelimit` da própria API:
   *
   *     openai/gpt-oss-120b    TPM  8.000    RPM 1.000
   *     openai/gpt-oss-20b     TPM  8.000    RPM 1.000
   *     qwen/qwen3.6-27b       TPM  8.000    RPM 1.000
   *     groq/compound          TPM 70.000    RPM   250
   *
   * O prompt de sistema da IARA — persona, camada global e catálogo — custa
   * ~5.000 tokens de ENTRADA por chamada. Contra um teto de 8.000 por minuto,
   * isso é UMA chamada a cada ~40 s. Um turno de `plano_cognitivo` faz duas
   * (decompõe, depois responde), então a segunda 429 por construção. Medido:
   * cinco chamadas seguidas → 1 ok, 4 `429 … Limit 8000, Used 5036`.
   *
   * O limite é da ORGANIZAÇÃO e do minuto, não do modelo: trocar de modelo
   * dentro da Groq gratuita não resolve, porque os três de chat dividem o mesmo
   * teto. Groq gratuita é elo de RESERVA, não cérebro primário — e a cadeia já
   * a trata assim desde 5c5ac94, cedendo a vez ao próximo elo no 429.
   *
   * `groq/compound` TEM 8,75× MAIS TETO E MESMO ASSIM ESTÁ FORA. Sondado no
   * mesmo dia com "Qual o preço do diesel hoje?": ele foi SOZINHO à internet,
   * devolveu `executed_tools: [{type: "search", …}]` e citou a fonte. Alcançar o
   * mundo por fora do Porteiro, do jornal e do orçamento é exatamente o que o
   * invariante "quem raciocina não alcança o mundo" proíbe, e o resultado é uma
   * afirmação sem `Procedencia` que a IARA repassaria como se fosse dela. Teto
   * maior não compra essa troca.
   */
  modeloPadrao: 'openai/gpt-oss-120b',
};

/**
 * OPENROUTER — o mesmo protocolo, outro catálogo.
 *
 * ENTRA COMO PERFIL E NÃO COMO CLIENTE NOVO porque a API dele é
 * `/chat/completions` com `Authorization: Bearer`, que é exatamente o que esta
 * classe já fala. Um segundo cliente para o mesmo protocolo seria uma segunda
 * cópia da mesma regra — e regra duplicada é a doença que o CLAUDE.md nomeia.
 *
 * O MODELO PADRÃO É `:free`, e o sufixo importa: sem ele o mesmo id vira a
 * variante paga e a conta chega sem ninguém ter decidido nada.
 *
 * POR QUE NEMOTRON 3 ULTRA entre os quinze gratuitos do catálogo: o `a55b` do id
 * são 55 bilhões de parâmetros ATIVOS, contra 12B do Nemotron Super, 8B do
 * Laguna e ~4B do Gemma 4. Parâmetro ativo é o que decide capacidade na
 * inferência, e nesse eixo ele não tem segundo colocado aqui. Some 1M de
 * contexto e uma descrição que é a função da IARA: orquestração de agente e
 * planejamento de múltiplas etapas.
 *
 * O QUE A IARA EXIGE DE FATO, e que descarta metade da lista: ela NÃO usa
 * function calling. `MotorRaciocinio.interpretarPlano` recorta do primeiro `{`
 * ao último `}` da resposta e joga fora todo passo fora do catálogo. O requisito
 * é planejar em múltiplos passos e emitir JSON bem formado em prosa — não
 * suportar a API de ferramentas. Por isso os modelos de CODIFICAÇÃO (Laguna,
 * North Mini Code) não sobem na lista por bom benchmark de SWE: a IARA não
 * escreve código, ela orquestra operação.
 *
 * POOLSIDE FICOU DE FORA POR ESCRITO, não por qualidade: a própria descrição do
 * Laguna diz que o uso gratuito autoriza treinar com suas entradas e saídas.
 * Numa IARA que carrega shard privado por operador, isso é decisão de quem
 * opera, e não default meu.
 *
 * O CUSTO QUE NÃO É EM DINHEIRO, e vale para TODO `:free`: o modelo é servido
 * por terceiro, e a política de dados da conta é que decide se o prompt vira
 * treino. Fica escrito aqui para ser decisão, e não descoberta.
 */
export const OPENROUTER: PerfilProvedorAberto = {
  apelido: 'openrouter',
  base: 'https://openrouter.ai/api/v1',
  variavelChave: 'OPENROUTER_API_KEY',
  variavelModelo: 'OPENROUTER_MODELO',
  modeloPadrao: 'nvidia/nemotron-3-ultra-550b-a55b:free',
};

export const GEMINI: PerfilProvedorAberto = {
  apelido: 'gemini',
  /* O endpoint COMPATÍVEL do Google — o nativo tem outro formato, e adotá-lo
     exigiria um segundo cliente para nada. */
  base: 'https://generativelanguage.googleapis.com/v1beta/openai',
  variavelChave: 'GEMINI_API_KEY',
  variavelModelo: 'GEMINI_MODELO',
  /**
   * O ALIAS, não a versão — e a lição é de 15/08/2026, com a chave real na
   * mão: o padrão era `gemini-3-flash`, nome que EU supus a partir do que se
   * lê por aí, e a API respondeu 404 (`is not found for API version`). O
   * catálogo real usa `gemini-2.5-flash`, `gemini-3.5-flash`… e o alias
   * `gemini-flash-latest`, que sempre aponta para o Flash corrente. Fixar uma
   * versão é assinar uma data de validade que ninguém vai lembrar de renovar;
   * `GEMINI_MODELO` continua existindo para quem precisar fixar de propósito.
   */
  modeloPadrao: 'gemini-flash-latest',
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

    const processar = (linha: string): void => {
      const lida = interpretarLinhaOpenAI(linha);
      if (!lida) return;
      if (lida.erro) throw new ProvedorIndisponivel(`${this.apelido}: ${lida.erro}`);
      if (lida.pedaco) {
        texto += lida.pedaco;
        pedido.aoReceberTexto(lida.pedaco);
      }
      if (lida.final) {
        entrada = lida.final.tokens_entrada;
        saida = lida.final.tokens_saida;
      }
    };

    try {
      for (;;) {
        const { done, value } = await leitor.read();
        if (done) {
          /**
           * O FIM DO STREAM TAMBÉM É UM SEPARADOR — defeito medido em produção
           * (18/08/2026).
           *
           * A operadora perguntou o que a IARA consegue fazer e recebeu
           * "...cargas, faturamento, motoristas, cent" — cortado no meio da
           * palavra, para sempre, sem erro nenhum: o provedor tinha respondido
           * com SUCESSO. `raciocinio_falhas` ficou vazio, o console limpo, o
           * jornal sem nada. Não era falha, era AUSÊNCIA.
           *
           * O laço abaixo devolve ao buffer a última parte de cada leitura,
           * porque ela pode estar cortada no meio de um pacote — isso está
           * certo. O que faltava era o fim: `if (done) break` saía com o buffer
           * cheio. Quando o servidor fecha sem `\n` depois do último `data:` —
           * conexão interrompida, proxy impaciente, resposta sem `[DONE]` — o
           * último pedaço de texto morria ali.
           *
           * `decode()` sem argumento esvazia o decodificador: um caractere
           * multibyte partido entre duas leituras fica pendente até completar, e
           * sem esta chamada o último acento some. Em português isso não é caso
           * de borda.
           *
           * É pior que um erro. Falha o operador vê e reporta; frase cortada no
           * meio ele lê como resposta.
           */
          restante += decodificador.decode();
          if (restante.trim()) processar(restante);
          restante = '';
          break;
        }
        restante += decodificador.decode(value, { stream: true });

        const linhas = restante.split('\n');
        /* A última pode estar cortada no meio — volta para o buffer. */
        restante = linhas.pop() ?? '';

        for (const linha of linhas) processar(linha);
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
