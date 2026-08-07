/**
 * Memória de Trabalho.
 *
 * O nível mais volátil dos quatro. Guarda o que a IARA precisa para terminar
 * a tarefa que está fazendo AGORA — e nada além disso.
 *
 *   Memória de Trabalho  ← aqui. Morre quando a tarefa acaba.
 *   Memória de Sessão    ← dura enquanto o socket vive (EstadoAtomico).
 *   Memória Persistente  ← shard privado no disco/Supabase.
 *   Base de Conhecimento ← RAG e camada global.
 *
 * Misturar os quatro é como se cria um sistema que "lembra" de um documento
 * que o operador fechou há três dias.
 */

import type { Percepcao, Plano } from './Evento';

export interface RetratoMemoriaTrabalho {
  readonly objetivo: string | null;
  readonly plano: Plano | null;
  readonly passo_atual: number;
  readonly total_passos: number;
  readonly ferramenta_ativa: string | null;
  readonly erros: number;
  readonly iniciado_em: number | null;
  readonly dependencias: readonly string[];
  /** Saídas dos passos já concluídos. Insumo do passo seguinte. */
  readonly resultados: readonly string[];
}

const VAZIA: RetratoMemoriaTrabalho = {
  objetivo: null,
  plano: null,
  passo_atual: 0,
  total_passos: 0,
  ferramenta_ativa: null,
  erros: 0,
  iniciado_em: null,
  dependencias: [],
  resultados: [],
};

export class MemoriaTrabalho {
  private estado: RetratoMemoriaTrabalho = VAZIA;
  private percepcao: Percepcao | null = null;

  iniciarTarefa(percepcao: Percepcao, plano: Plano): void {
    this.percepcao = percepcao;
    this.estado = {
      objetivo: plano.objetivo,
      plano,
      passo_atual: 0,
      total_passos: plano.passos.length,
      ferramenta_ativa: null,
      erros: 0,
      iniciado_em: Date.now(),
      dependencias: [...new Set(plano.passos.map((p) => p.habilidade).filter(Boolean))] as string[],
      resultados: [],
    };
  }

  entrarNoPasso(indice: number, ferramenta: string | null): void {
    this.estado = { ...this.estado, passo_atual: indice + 1, ferramenta_ativa: ferramenta };
  }

  concluirPasso(saida: string): void {
    this.estado = {
      ...this.estado,
      ferramenta_ativa: null,
      resultados: [...this.estado.resultados, saida],
    };
  }

  registrarErro(): void {
    this.estado = { ...this.estado, erros: this.estado.erros + 1 };
  }

  encerrarTarefa(): void {
    this.estado = VAZIA;
    this.percepcao = null;
  }

  get retrato(): RetratoMemoriaTrabalho {
    return this.estado;
  }

  get percepcaoAtual(): Percepcao | null {
    return this.percepcao;
  }

  get ocupada(): boolean {
    return this.estado.plano !== null;
  }

  /**
   * Contexto acumulado para o passo seguinte. Só as saídas — nunca o plano
   * inteiro, nunca objeto interno. O que sai daqui pode ir para um prompt.
   */
  contextoAcumulado(): string {
    if (this.estado.resultados.length === 0) return '';
    return this.estado.resultados
      .map((r, i) => `[passo ${i + 1}] ${r}`)
      .join('\n')
      .slice(0, 4000);
  }
}
