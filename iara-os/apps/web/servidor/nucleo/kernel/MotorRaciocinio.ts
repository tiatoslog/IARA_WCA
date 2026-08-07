/**
 * Motor de Raciocínio.
 *
 * Claude tem exatamente três responsabilidades aqui, e nenhuma delas é
 * "executar":
 *
 *   1. PLANEJAMENTO COGNITIVO — decompõe objetivo novo em passos que o kernel
 *      vai executar. Devolve estrutura, não prosa.
 *   2. RACIOCÍNIO PROFUNDO — responde o que exige abstração.
 *   3. SÍNTESE — junta as saídas de vários passos numa resposta única.
 *
 * A LLM nunca chama habilidade. Ela nomeia a habilidade que quer; o
 * `GerenciadorHabilidades` valida permissão, esquema e timeout antes de
 * qualquer executor rodar. Um plano que peça habilidade inexistente é
 * descartado, não improvisado.
 */

import type { Plano, Passo, Percepcao } from './Evento';
import type { ManifestoHabilidade } from './Habilidade';
import { ClienteClaude, NuvemIndisponivel } from '../ClienteClaude';
import type { RegistroMemoria } from '../../../lib/estado';

export interface PedidoSintese {
  enunciado: string;
  historico: RegistroMemoria[];
  overridePersona: string;
  camadaGlobal: string;
  /** Saídas dos passos já executados. Vazio numa resposta de passo único. */
  contexto: string;
  sinal: AbortSignal;
  aoReceberTexto: (pedaco: string) => void;
}

export interface RespostaRaciocinio {
  texto: string;
  tokens_entrada: number;
  tokens_saida: number;
  cache_lido: number;
}

/** Limite duro de passos. Plano longo demais é alucinação, não planejamento. */
const MAX_PASSOS = 6;

export class MotorRaciocinio {
  constructor(private readonly claude = new ClienteClaude()) {}

  get disponivel(): boolean {
    return this.claude.disponivel;
  }

  get modelo(): string {
    return process.env.IARA_MODELO?.trim() || 'claude-opus-5';
  }

  // -------------------------------------------------------------------------
  // 1. Planejamento cognitivo
  // -------------------------------------------------------------------------

  /**
   * Pede à LLM um plano ESTRUTURADO. Devolve `null` — nunca lança — quando a
   * nuvem está fora, o plano é inválido ou cita habilidade desconhecida. O
   * chamador cai para o plano de passo único, que sempre funciona.
   */
  async planejar(
    percepcao: Percepcao,
    catalogo: readonly ManifestoHabilidade[],
    sinal: AbortSignal,
  ): Promise<Plano | null> {
    if (!this.claude.disponivel) return null;

    const disponiveis = catalogo.filter((m) => m.custo === 'zero' && m.id !== 'sigilo');
    const lista = disponiveis
      .map((m) => `- ${m.id}: ${m.descricao} | parâmetros: ${Object.keys(m.esquema).join(', ') || 'nenhum'}`)
      .join('\n');

    const instrucao =
      `Decomponha o pedido do operador em no máximo ${MAX_PASSOS} passos executáveis.\n\n` +
      `HABILIDADES DISPONÍVEIS (só estas existem):\n${lista}\n\n` +
      `Responda APENAS com JSON, sem cerca de código, neste formato:\n` +
      `{"objetivo":"...","passos":[{"descricao":"...","habilidade":"id ou null","parametros":{}}]}\n\n` +
      `Use "habilidade": null quando o passo for raciocínio puro seu.\n` +
      `Se o pedido se resolve em um único raciocínio, devolva um passo só.\n\n` +
      `PEDIDO: ${percepcao.bruto}`;

    let bruto = '';
    try {
      const r = await this.claude.raciocinar({
        mensagem: instrucao,
        historico: [],
        overridePersona:
          'MODO PLANEJADOR: responda somente com o JSON pedido. Sem saudação, sem explicação, sem markdown.',
        camadaGlobal: '',
        sinal,
        aoReceberTexto: (p) => {
          bruto += p;
        },
      });
      bruto = r.texto || bruto;
    } catch (erro) {
      if (erro instanceof NuvemIndisponivel) return null;
      if (sinal.aborted) return null;
      return null;
    }

    return this.interpretarPlano(bruto, disponiveis);
  }

  /**
   * Converte o JSON da LLM em `Plano`, descartando tudo que não bate com o
   * catálogo. Este é o ponto onde um plano alucinado morre — nunca depois,
   * dentro de um executor.
   */
  private interpretarPlano(bruto: string, catalogo: readonly ManifestoHabilidade[]): Plano | null {
    const inicio = bruto.indexOf('{');
    const fim = bruto.lastIndexOf('}');
    if (inicio < 0 || fim <= inicio) return null;

    let dado: unknown;
    try {
      dado = JSON.parse(bruto.slice(inicio, fim + 1));
    } catch {
      return null;
    }

    const obj = dado as { objetivo?: unknown; passos?: unknown };
    if (!Array.isArray(obj.passos) || obj.passos.length === 0) return null;

    const conhecidas = new Set(catalogo.map((m) => m.id));
    const passos: Passo[] = [];

    for (const cru of obj.passos.slice(0, MAX_PASSOS)) {
      if (typeof cru !== 'object' || cru === null) continue;
      const p = cru as { descricao?: unknown; habilidade?: unknown; parametros?: unknown };

      const descricao = typeof p.descricao === 'string' ? p.descricao.slice(0, 160) : '';
      if (!descricao) continue;

      let habilidade: string | null = null;
      if (typeof p.habilidade === 'string' && p.habilidade !== 'null') {
        // Habilidade inventada invalida o plano inteiro: executar metade de um
        // plano é pior que não executar nenhum.
        if (!conhecidas.has(p.habilidade)) return null;
        habilidade = p.habilidade;
      }

      passos.push({
        indice: passos.length,
        descricao,
        habilidade: habilidade ?? 'raciocinio',
        parametros:
          typeof p.parametros === 'object' && p.parametros !== null
            ? (p.parametros as Record<string, unknown>)
            : {},
      });
    }

    if (passos.length === 0) return null;

    return {
      objetivo: typeof obj.objetivo === 'string' ? obj.objetivo.slice(0, 160) : 'Atender o pedido',
      origem: 'emergente',
      passos,
    };
  }

  // -------------------------------------------------------------------------
  // 2 e 3. Raciocínio profundo e síntese
  // -------------------------------------------------------------------------

  async responder(pedido: PedidoSintese): Promise<RespostaRaciocinio> {
    const mensagem = pedido.contexto
      ? `${pedido.enunciado}\n\n--- resultados já obtidos pelo sistema ---\n${pedido.contexto}\n` +
        `Responda ao operador usando esses resultados. Não repita o que já foi dito literalmente.`
      : pedido.enunciado;

    const r = await this.claude.raciocinar({
      mensagem,
      historico: pedido.historico,
      overridePersona: pedido.overridePersona,
      camadaGlobal: pedido.camadaGlobal,
      sinal: pedido.sinal,
      aoReceberTexto: pedido.aoReceberTexto,
    });

    return {
      texto: r.texto,
      tokens_entrada: r.tokens_entrada,
      tokens_saida: r.tokens_saida,
      cache_lido: r.cache_lido,
    };
  }
}
