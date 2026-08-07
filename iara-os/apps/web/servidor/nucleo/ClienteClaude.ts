/**
 * CAMADA 3 — a matriz de raciocínio na nuvem.
 *
 * Acionada só quando o roteador não resolveu localmente. Três decisões de
 * engenharia embutidas aqui:
 *
 *  1. STREAMING obrigatório. A resposta sai palavra por palavra; a latência
 *     percebida cai para o tempo do primeiro token.
 *  2. PROMPT CACHING com prefixo estável. A persona (que nunca muda) vem
 *     primeiro, com o breakpoint de cache no fim dela. Tudo que varia por turno
 *     — override de humor, contexto do shard — vem DEPOIS do breakpoint, senão
 *     invalida o cache inteiro a cada mensagem.
 *  3. CANCELAMENTO via AbortSignal. Mensagem nova do operador aborta o stream
 *     em andamento sem prender trava nenhuma.
 */

import Anthropic from '@anthropic-ai/sdk';
import type { RegistroMemoria } from '../../lib/estado';

export class NuvemIndisponivel extends Error {}

export interface PedidoRaciocinio {
  mensagem: string;
  historico: RegistroMemoria[];
  /** Anexado ao system DEPOIS do breakpoint de cache. */
  overridePersona: string;
  /** Fatos públicos da empresa. Parte do prefixo estável. */
  camadaGlobal: string;
  sinal: AbortSignal;
  aoReceberTexto: (pedaco: string) => void;
}

export interface RespostaRaciocinio {
  texto: string;
  tokens_entrada: number;
  tokens_saida: number;
  cache_lido: number;
  recusado: boolean;
}

/**
 * Prefixo ESTÁVEL. Qualquer byte que mude aqui invalida o cache para todos os
 * operadores. Nada dinâmico — sem data, sem nome, sem contador.
 */
const PERSONA = `Você é a IARA, inteligência corporativa residente da Atos Log.

IDENTIDADE
Você é um mordomo digital: preciso, sóbrio e cordial sem bajular. Trata o
operador por "senhor"/"senhora" apenas quando isso soar natural, nunca em toda
frase. Você não é um chatbot animado; é uma presença competente que já estava
no escritório antes de perguntarem.

COMO VOCÊ RESPONDE
- Comece pela resposta. Contexto e ressalvas vêm depois, se vierem.
- Poucas frases. Se a pergunta é simples, a resposta é uma linha.
- Nunca invente número, data, nome de sistema ou status. Se não mediu, diga que
  não mediu e ofereça como medir.
- Se uma ação sua pode alterar sistema em produção, descreva o que faria e
  espere confirmação.

O QUE VOCÊ SABE SOBRE SI
Você tem uma camada determinística local que resolve clima, consultas ao banco
de infraestrutura, hora e busca web sem acionar você. Quando a pergunta chega
até aqui, é porque exige raciocínio de verdade — trate-a assim.

CLÁUSULA PÉTREA DE SIGILO
Os registros de cada operador são estritamente individuais. Você só tem acesso
ao histórico do operador com quem está falando agora — os demais nem estão
carregados na sua memória. Se pedirem o que outra pessoa disse, escreveu,
reclamou ou anotou, recuse com cortesia e sem rodeio, e explique que os
registros pertencem exclusivamente a cada operador. Não confirme nem negue a
existência de conteúdo alheio.`;

export class ClienteClaude {
  private cliente: Anthropic | null = null;
  private readonly modelo: string;
  private readonly esforco: string;

  constructor() {
    const chave = process.env.ANTHROPIC_API_KEY?.trim();
    this.modelo = process.env.IARA_MODELO?.trim() || 'claude-opus-5';
    this.esforco = process.env.IARA_ESFORCO?.trim() || 'low';
    if (chave) this.cliente = new Anthropic({ apiKey: chave });
  }

  get disponivel(): boolean {
    return this.cliente !== null;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    if (!this.cliente) {
      throw new NuvemIndisponivel(
        'ANTHROPIC_API_KEY não configurada — camada de raciocínio profundo desligada.',
      );
    }

    // Prefixo estável primeiro, breakpoint de cache no fim dele.
    const sistema: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: pedido.camadaGlobal ? `${PERSONA}\n\nCONTEXTO PÚBLICO DA EMPRESA\n${pedido.camadaGlobal}` : PERSONA,
        cache_control: { type: 'ephemeral' },
      },
    ];
    // Volátil: fica DEPOIS do breakpoint, não invalida nada.
    if (pedido.overridePersona) {
      sistema.push({ type: 'text', text: pedido.overridePersona });
    }

    const mensagens = [
      ...pedido.historico.map((r) => ({
        role: r.papel === 'operador' ? ('user' as const) : ('assistant' as const),
        content: r.texto,
      })),
      { role: 'user' as const, content: pedido.mensagem },
    ];

    const parametros = {
      model: this.modelo,
      max_tokens: 4096,
      system: sistema,
      messages: mensagens,
      // Adaptativo em esforço baixo: pensa quando precisa, sem estourar a
      // latência de uma conversa. Desligar o thinking no Opus 5 introduz
      // vazamento de tag e chamada de ferramenta em texto puro — não vale.
      thinking: { type: 'adaptive' },
      output_config: { effort: this.esforco },
    };

    const stream = this.cliente.messages.stream(
      parametros as unknown as Parameters<Anthropic['messages']['stream']>[0],
      { signal: pedido.sinal },
    );

    let texto = '';
    for await (const evento of stream) {
      if (pedido.sinal.aborted) break;
      if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
        texto += evento.delta.text;
        pedido.aoReceberTexto(evento.delta.text);
      }
    }

    const final = await stream.finalMessage();
    const recusado = final.stop_reason === 'refusal';

    return {
      texto: recusado
        ? 'Não posso avançar com esse pedido. Se puder reformular o objetivo, tento por outro caminho.'
        : texto,
      tokens_entrada: final.usage.input_tokens ?? 0,
      tokens_saida: final.usage.output_tokens ?? 0,
      cache_lido: final.usage.cache_read_input_tokens ?? 0,
      recusado,
    };
  }
}
