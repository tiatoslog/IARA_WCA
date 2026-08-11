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
  agruparPorDominio,
  type CapacidadeProjetada,
  type ManifestoProjetado,
} from '../../../lib/capacidades';
import {
  HabilidadeExpirou,
  PermissaoNegada,
  disponivel,
  validar,
  type ContextoHabilidade,
  type Habilidade,
  type ManifestoHabilidade,
  type Permissao,
  type ResultadoHabilidade,
  type Verificacao,
} from './Habilidade';
import type { EstadoExecucao } from './Verdade';

/**
 * O que o executor relatou E o que a verificação apurou, lado a lado.
 *
 * Os dois campos existem separados de propósito: `resultado` é o relato da
 * habilidade, `verificacao` é o mundo. Fundir os dois num booleano é
 * exatamente como "solicitei a execução" vira "pronto".
 */
export interface ResultadoVerificado {
  readonly resultado: ResultadoHabilidade;
  /** `null` quando a habilidade não declara verificação (risco baixo). */
  readonly verificacao: Verificacao | null;
  readonly estado: EstadoExecucao;
}

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

  /**
   * Catálogo que o Planejador pode oferecer à LLM.
   *
   * Só o que está PRONTO PARA USO. Uma habilidade sem credencial no catálogo
   * de planejamento produz plano que falha no meio — e plano que falha no meio
   * é pior que plano que não existe, porque já consumiu tokens e já mostrou
   * passos ao operador.
   */
  catalogo(): readonly ManifestoHabilidade[] {
    return [...this.registro.values()].filter(disponivel).map((h) => h.manifesto);
  }

  /**
   * Manifesto COMPLETO, incluindo o que está desligado e por quê. Vai para o
   * snapshot: o operador vê o que a IARA poderia fazer e o que falta ligar.
   */
  manifestoProjetado(): ManifestoProjetado {
    const capacidades: CapacidadeProjetada[] = [...this.registro.values()].map((h) => {
      const motivo = h.indisponivelPorque?.() ?? null;
      return {
        id: h.manifesto.id,
        nome: h.manifesto.nome,
        dominio: h.manifesto.dominio,
        disponivel: motivo === null,
        motivo_indisponivel: motivo ?? undefined,
        custo: h.manifesto.custo,
      };
    });
    return agruparPorDominio(capacidades);
  }

  /**
   * Executa e, quando a habilidade sabe se verificar, CONFERE O MUNDO.
   *
   * A quinta porta. As quatro anteriores decidem se a ação pode acontecer;
   * esta decide se ela aconteceu. Uma habilidade de risco médio ou alto que
   * não declara `verificar` termina em `desconhecido`, nunca em sucesso — e o
   * teste de contrato impede que ela chegue ao catálogo assim.
   */
  async executarVerificando(pedido: PedidoHabilidade): Promise<ResultadoVerificado> {
    const resultado = await this.executar(pedido);
    const habilidade = this.registro.get(pedido.id)!;
    const risco = habilidade.manifesto.risco;

    if (!habilidade.verificar) {
      // Risco baixo é leitura: a resposta É o resultado, não há mundo separado
      // para conferir. Qualquer outro risco sem verificador é honestamente
      // desconhecido.
      return {
        resultado,
        verificacao: null,
        estado: risco === 'baixo' ? 'verificado' : 'desconhecido',
      };
    }

    const ctx: ContextoHabilidade = {
      sessao: pedido.sessao,
      id_usuario: pedido.id_usuario,
      parametros: validar(habilidade.manifesto.esquema, pedido.parametros),
      sinal: pedido.sinal,
      enunciado: pedido.enunciado,
    };

    let verificacao: Verificacao;
    try {
      verificacao = await habilidade.verificar(resultado, ctx);
    } catch (erro) {
      // Verificador que quebra não pode virar sucesso nem falha: vira
      // desconhecido, que é literalmente o que se sabe nesse ponto.
      verificacao = {
        confirmado: false,
        evidencia: `a verificação falhou: ${(erro as Error).message}`,
        motivo: 'sem_meio_de_verificar',
      };
    }

    this.barramento.publicar({
      tipo: 'HABILIDADE_VERIFICADA',
      habilidade: pedido.id,
      confirmado: verificacao.confirmado,
      evidencia: verificacao.evidencia,
    });

    return {
      resultado,
      verificacao,
      estado: verificacao.confirmado
        ? 'verificado'
        : verificacao.motivo === 'sem_meio_de_verificar'
          ? 'desconhecido'
          : 'falhou',
    };
  }

  async executar(pedido: PedidoHabilidade): Promise<ResultadoHabilidade> {
    const habilidade = this.registro.get(pedido.id);
    if (!habilidade) {
      throw new Error(`habilidade desconhecida: ${pedido.id}`);
    }
    // Porta 1b — disponibilidade. Um plano antigo, ou uma credencial que caiu
    // entre o planejamento e a execução, não pode alcançar o executor.
    const motivo = habilidade.indisponivelPorque?.();
    if (motivo) {
      throw new Error(`${pedido.id} indisponível: ${motivo}`);
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
