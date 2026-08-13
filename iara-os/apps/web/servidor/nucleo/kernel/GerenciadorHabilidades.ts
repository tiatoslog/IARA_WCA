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
  ParametroInvalido,
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
import type { Operacao } from './Operacao';
import { RegistroOperacoes } from './RegistroOperacoes';
import type { RegistroErros } from './RegistroErros';

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
  /**
   * O jornal e a identidade deste passo. Ver `ContextoHabilidade`.
   *
   * OPCIONAIS AQUI e obrigatórios no contexto, de propósito. O Kernel sempre os
   * passa — é o caminho vivo, e há teste travando isso. Um teste que exercita o
   * Gerenciador isoladamente está provando as quatro portas desta classe, não o
   * ciclo de vida da operação, e obrigá-lo a fabricar um jornal só para chamar
   * `executar` transformaria cada teste de permissão num teste de persistência.
   */
  registro?: RegistroOperacoes;
  operacao?: Operacao | null;
  /** Os defeitos cognitivos da sessão. Só a auditoria usa — ver `ContextoHabilidade`. */
  erros?: RegistroErros;
}

export class GerenciadorHabilidades {
  private readonly registro = new Map<string, Habilidade>();
  /** Jornal de recurso para chamadas que não vêm do Kernel. Nunca recebe
   *  transição: quem transiciona é o Kernel, com o jornal real da sessão. */
  private readonly jornalPadrao = new RegistroOperacoes();

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
   * Valida os parâmetros contra o esquema declarado e devolve a forma
   * NORMALIZADA — chave desconhecida derruba, tipo errado derruba, valor fora
   * de `dentre` derruba.
   *
   * Existe como método público por um motivo de ORDEM, não de conveniência: o
   * Kernel abria a operação no jornal ANTES de qualquer validação, e por isso
   * a chave de idempotência e a linha de auditoria nasciam de parâmetros que
   * ninguém tinha olhado. Um plano da LLM com `{"local":"downloads","extra":1}`
   * ganhava identidade persistida e só morria depois. Validar primeiro faz o
   * jornal registrar a ação REAL, e é o que permite ao portal carimbar
   * `PARAMETROS_VALIDADOS` na prova sem mentir.
   *
   * `validar` é a mesma função que o executor chama — não uma segunda cópia da
   * regra. Rodar duas vezes é barato e idempotente; ter duas regras não seria.
   */
  validarParametros(id: string, parametros: Record<string, unknown>): Record<string, unknown> {
    const h = this.registro.get(id);
    if (!h) throw new ParametroInvalido(`habilidade desconhecida: ${id}`);
    return validar(h.manifesto.esquema, parametros);
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
      registro: pedido.registro ?? this.jornalPadrao,
      erros: pedido.erros,
      operacao: pedido.operacao ?? null,
    };

    const verificacao = await this.conferirMundo(habilidade, resultado, ctx, pedido.id);

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

  /**
   * PERGUNTA AO MUNDO depois de o executor ter EXPLODIDO.
   *
   * O caso que esta porta cobre, e que nenhuma outra cobria: `executar` lança —
   * timeout, exceção, cancelamento — e o kernel conclui "falhou, nada mudou".
   * Para um executor que já tinha alcançado o disco (ou o provedor) antes de
   * estourar o relógio, essa conclusão é FALSA, e é a mentira operacional pelo
   * avesso: negar um efeito que existe.
   *
   * Quando a habilidade sabe se verificar, a exceção não precisa virar palpite.
   * Pergunta-se ao disco. `null` quando não há verificador — aí sim o que se
   * sabe é nada, e quem chama tem que dizer isso em vez de escolher um lado.
   */
  async apurar(
    id: string,
    pedido: Omit<PedidoHabilidade, 'id'>,
    relato: ResultadoHabilidade,
  ): Promise<Verificacao | null> {
    const habilidade = this.registro.get(id);
    if (!habilidade?.verificar) return null;

    let parametros: Record<string, unknown>;
    try {
      parametros = validar(habilidade.manifesto.esquema, pedido.parametros);
    } catch {
      // Parâmetro que nem passa no esquema não chegou a executor nenhum.
      return null;
    }

    return this.conferirMundo(
      habilidade,
      relato,
      {
        sessao: pedido.sessao,
        id_usuario: pedido.id_usuario,
        parametros,
        sinal: pedido.sinal,
        enunciado: pedido.enunciado,
        registro: pedido.registro ?? this.jornalPadrao,
      erros: pedido.erros,
        operacao: pedido.operacao ?? null,
      },
      id,
    );
  }

  /**
   * Roda o verificador e publica o que ele apurou. Um só lugar, porque a regra
   * "verificador que quebra vira DESCONHECIDO, nunca sucesso nem falha" precisa
   * valer igual no caminho feliz e no caminho de exceção.
   */
  private async conferirMundo(
    habilidade: Habilidade,
    resultado: ResultadoHabilidade,
    ctx: ContextoHabilidade,
    id: string,
  ): Promise<Verificacao> {
    let verificacao: Verificacao;
    try {
      verificacao = await this.comRelogio(
        habilidade.verificar!(resultado, ctx),
        habilidade.manifesto.timeout_ms,
        `verificação de ${id}`,
      );
    } catch (erro) {
      // Verificador que quebra (ou que pendura) não pode virar sucesso nem
      // falha: vira desconhecido, que é literalmente o que se sabe nesse ponto.
      verificacao = {
        confirmado: false,
        evidencia: `a verificação falhou: ${(erro as Error).message}`,
        motivo: 'sem_meio_de_verificar',
      };
    }

    this.barramento.publicar({
      tipo: 'HABILIDADE_VERIFICADA',
      habilidade: id,
      confirmado: verificacao.confirmado,
      evidencia: verificacao.evidencia,
    });

    return verificacao;
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
      registro: pedido.registro ?? this.jornalPadrao,
      erros: pedido.erros,
      operacao: pedido.operacao ?? null,
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

  private comTimeout(
    habilidade: Habilidade,
    ctx: ContextoHabilidade,
    ms: number,
  ): Promise<ResultadoHabilidade> {
    return this.comRelogio(habilidade.executar(ctx), ms, habilidade.manifesto.id);
  }

  /**
   * Relógio que não deixa promessa pendurada. O `finally` limpa o timer
   * inclusive quando a promessa resolve antes — senão o processo segura um
   * timer por chamada e vaza sob carga.
   *
   * Vale para o EXECUTOR e para o VERIFICADOR. O verificador rodava sem relógio
   * nenhum: um `verificar` que pendurasse (um `fetch` sem timeout, um provedor
   * que não responde) travava o turno inteiro para sempre — o operador ficava
   * olhando uma tela que nunca conclui, e nenhum `AbortSignal` salvava, porque
   * respeitar o sinal é escolha de quem escreve a habilidade. Uma trava não
   * pode depender da boa vontade do código que ela existe para conter.
   */
  private async comRelogio<T>(promessa: Promise<T>, ms: number, quem: string): Promise<T> {
    let relogio: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promessa,
        new Promise<never>((_, rejeitar) => {
          relogio = setTimeout(() => rejeitar(new HabilidadeExpirou(`${quem} passou de ${ms}ms`)), ms);
        }),
      ]);
    } finally {
      if (relogio) clearTimeout(relogio);
    }
  }
}
