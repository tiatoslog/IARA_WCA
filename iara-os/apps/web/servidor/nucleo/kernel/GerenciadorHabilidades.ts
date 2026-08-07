/**
 * Gerenciador de Habilidades.
 *
 * Quatro portas, nesta ordem, antes de qualquer executor rodar:
 *   1. a habilidade existe?
 *   2. o operador tem as permissões que ela exige?
 *   3. os parâmetros batem com o esquema declarado?
 *   4. o timeout está armado e o cancelamento propaga?
 *
 * Nenhuma pode ser pulada, e é por isso que o executor não é público: ninguém
 * consegue chamar uma habilidade por fora.
 */

import type { BarramentoEventos } from './BarramentoEventos';
import {
  HabilidadeExpirou,
  PermissaoNegada,
  validar,
  type ContextoHabilidade,
  type Habilidade,
  type ManifestoHabilidade,
  type Permissao,
  type ResultadoHabilidade,
} from './Habilidade';

export interface PedidoHabilidade {
  id: string;
  parametros: Record<string, unknown>;
  enunciado: string;
  id_usuario: string;
  sessao: string;
  sinal: AbortSignal;
  /** Permissões concedidas ao operador desta sessão. */
  concedidas: readonly Permissao[];
}

export class GerenciadorHabilidades {
  private readonly registro = new Map<string, Habilidade>();

  constructor(private readonly barramento: BarramentoEventos) {}

  registrar(habilidade: Habilidade): void {
    const id = habilidade.manifesto.id;
    if (this.registro.has(id)) {
      throw new Error(`habilidade duplicada: ${id}`);
    }
    this.registro.set(id, habilidade);
  }

  registrarTodas(habilidades: readonly Habilidade[]): void {
    for (const h of habilidades) this.registrar(h);
  }

  tem(id: string): boolean {
    return this.registro.has(id);
  }

  manifesto(id: string): ManifestoHabilidade | null {
    return this.registro.get(id)?.manifesto ?? null;
  }

  /** Catálogo para o planejador — e, futuramente, para a LLM planejar com ele. */
  catalogo(): readonly ManifestoHabilidade[] {
    return [...this.registro.values()].map((h) => h.manifesto);
  }

  async executar(pedido: PedidoHabilidade): Promise<ResultadoHabilidade> {
    const habilidade = this.registro.get(pedido.id);
    if (!habilidade) {
      throw new Error(`habilidade desconhecida: ${pedido.id}`);
    }
    const m = habilidade.manifesto;

    // Porta 2 — permissões.
    const faltando = m.permissoes.filter((p) => !pedido.concedidas.includes(p));
    if (faltando.length > 0) {
      throw new PermissaoNegada(`${m.id} exige ${faltando.join(', ')}`);
    }

    // Porta 3 — esquema.
    const parametros = validar(m.esquema, pedido.parametros);

    this.barramento.publicar({
      tipo: 'HABILIDADE_INICIADA',
      habilidade: m.id,
      capacidade: m.capacidade,
    });

    const inicio = Date.now();
    const ctx: ContextoHabilidade = {
      sessao: pedido.sessao,
      id_usuario: pedido.id_usuario,
      parametros,
      sinal: pedido.sinal,
      enunciado: pedido.enunciado,
    };

    try {
      const resultado = await this.comTimeout(habilidade, ctx, m.timeout_ms);
      this.barramento.publicar({
        tipo: 'HABILIDADE_CONCLUIDA',
        habilidade: m.id,
        ok: resultado.resolveu,
        ms: Date.now() - inicio,
        detalhe: resultado.detalhe,
      });
      return resultado;
    } catch (erro) {
      this.barramento.publicar({
        tipo: 'HABILIDADE_CONCLUIDA',
        habilidade: m.id,
        ok: false,
        ms: Date.now() - inicio,
        detalhe: (erro as Error).message,
      });
      throw erro;
    }
  }

  /**
   * Timeout que não deixa promessa pendurada. O `finally` limpa o relógio
   * inclusive quando a habilidade resolve antes — senão o processo segura um
   * timer por chamada e vaza sob carga.
   */
  private async comTimeout(
    habilidade: Habilidade,
    ctx: ContextoHabilidade,
    ms: number,
  ): Promise<ResultadoHabilidade> {
    let relogio: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        habilidade.executar(ctx),
        new Promise<never>((_, rejeitar) => {
          relogio = setTimeout(
            () => rejeitar(new HabilidadeExpirou(`${habilidade.manifesto.id} passou de ${ms}ms`)),
            ms,
          );
        }),
      ]);
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }
}
