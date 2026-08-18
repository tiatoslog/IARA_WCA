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
import {
  ProvedorIndisponivel,
  normalizarHistorico,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from './ProvedorRaciocinio';
import { MODELO_NUVEM_PADRAO, lerConfig } from './kernel/Configuracao';
import { PERSONA } from './Persona';

export class NuvemIndisponivel extends ProvedorIndisponivel {}

export type { PedidoRaciocinio, RespostaRaciocinio } from './ProvedorRaciocinio';

export class ClienteClaude implements ProvedorRaciocinio {
  readonly apelido = 'anthropic' as const;
  readonly origem = 'nuvem' as const;
  private cliente: Anthropic | null = null;
  readonly modelo: string;
  private readonly esforco: string;

  /**
   * `lerConfig` no lugar de `process.env.X?.trim()`, e a diferença não é
   * estilo. `.trim()` limpa as PONTAS; o incidente de 13/08 tinha um `\n` e um
   * segundo segredo no MEIO do valor. A chave passava por aqui inteira, ia
   * para o cabeçalho `x-api-key` e o `Headers` derrubava a requisição — uma
   * vez por mensagem, para sempre, com a credencial na exceção.
   *
   * Agora contaminação LEVANTA aqui. Quem sobe o motor nunca vê esta exceção,
   * porque `conferirAmbiente()` recusa a subida antes; ela existe para o
   * processo que instancia isto por outro caminho — teste, script, worker.
   */
  constructor() {
    const chave = lerConfig('ANTHROPIC_API_KEY');
    this.modelo = lerConfig('IARA_MODELO') ?? MODELO_NUVEM_PADRAO;
    this.esforco = lerConfig('IARA_ESFORCO') ?? 'low';
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

    /**
     * Prefixo estável primeiro, breakpoint de cache no fim dele.
     *
     * O CATÁLOGO ENTRA AQUI DENTRO, e a escolha é deliberada apesar de custar
     * tokens no prefixo. Ele muda quando o processo sobe — uma credencial nova
     * liga uma habilidade, um deploy acrescenta outra — e não entre um turno e
     * o seguinte. Pôr depois do breakpoint não economizaria nada e tiraria do
     * lugar cacheado justamente o bloco mais repetido de todos.
     */
    const prefixo = [
      PERSONA,
      pedido.capacidades ? `O QUE VOCÊ SABE FAZER\n${pedido.capacidades}` : '',
      pedido.camadaGlobal ? `CONTEXTO PÚBLICO DA EMPRESA\n${pedido.camadaGlobal}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    const sistema: Array<Record<string, unknown>> = [
      {
        type: 'text',
        text: prefixo,
        cache_control: { type: 'ephemeral' },
      },
    ];
    // Volátil: fica DEPOIS do breakpoint, não invalida nada.
    if (pedido.overridePersona) {
      sistema.push({ type: 'text', text: pedido.overridePersona });
    }

    const mensagens = normalizarHistorico(pedido.historico, pedido.mensagem);

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

    const { texto, final } = await this.transmitirComRetentativa(parametros, pedido);
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

  /**
   * RETENTATIVA SÓ ANTES DO PRIMEIRO TOKEN. Achado em auditoria (14/08/2026):
   * `overloaded_error` da Anthropic derrubava o turno inteiro na primeira
   * sobrecarga, sem nenhuma nova tentativa — o operador via a falha crua
   * (consertada em `Kernel.mensagemHumanaDeFalha`) mesmo quando um segundo
   * disparo, um instante depois, teria funcionado.
   *
   * A retentativa só é segura enquanto NENHUM pedaço de texto chegou ainda ao
   * operador (`algumTextoChegou`): repetir depois de texto parcial duplicaria
   * ou misturaria a fala na tela, o que é pior que a falha original. Por isso
   * o corte é rígido — um único `content_block_delta` já fecha a porta da
   * retentativa, e o erro sobe puro para quem chamou.
   */
  private async transmitirComRetentativa(
    parametros: Record<string, unknown>,
    pedido: PedidoRaciocinio,
  ): Promise<{ texto: string; final: Anthropic.Message }> {
    const MAX_TENTATIVAS = 3;
    const RECUO_BASE_MS = 1000;

    for (let tentativa = 1; tentativa <= MAX_TENTATIVAS; tentativa += 1) {
      let texto = '';
      let algumTextoChegou = false;
      try {
        const stream = this.cliente!.messages.stream(
          parametros as unknown as Parameters<Anthropic['messages']['stream']>[0],
          { signal: pedido.sinal },
        );
        for await (const evento of stream) {
          if (pedido.sinal.aborted) break;
          if (evento.type === 'content_block_delta' && evento.delta.type === 'text_delta') {
            texto += evento.delta.text;
            algumTextoChegou = true;
            pedido.aoReceberTexto(evento.delta.text);
          }
        }
        const final = await stream.finalMessage();
        return { texto, final };
      } catch (erro) {
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
    // Inatingível: o laço acima sempre retorna ou lança antes de terminar as
    // tentativas — mas o TypeScript não sabe disso sem um retorno explícito.
    throw new Error('retentativa esgotada sem lançar o erro original');
  }

  /** 429 (limite de taxa) e 529/`overloaded_error` (sobrecarga) são o par que
   *  realmente se resolve tentando de novo alguns segundos depois; o resto —
   *  400 de payload malformado, 401 de credencial errada — tentar de novo só
   *  repete o mesmo erro mais devagar. */
  private ehErroTransitorio(erro: unknown): boolean {
    const status = (erro as { status?: number } | null)?.status;
    if (status === 429 || status === 500 || status === 502 || status === 503 || status === 529) {
      return true;
    }
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    return /overloaded_error|rate_limit_error/i.test(mensagem);
  }
}
