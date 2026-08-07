/**
 * Consultas nomeadas — a alternativa segura a "a LLM escreve SQL".
 *
 * POR QUE NÃO ACEITAR SQL DO MODELO
 *
 * Uma habilidade `executar_consulta_sql(consulta: string)` entrega ao modelo a
 * capacidade de escrever qualquer comando contra o banco operacional.
 * Parametrizar os VALORES não resolve nada, porque o problema é o TEXTO da
 * query. E o modelo não é uma fonte confiável: basta um PDF com instrução
 * embutida, um e-mail encaminhado ou um campo de banco com texto hostil para
 * que a "intenção" que chega ao planejador não seja a do operador.
 *
 * Aqui o SQL mora no código e é revisado como código. A LLM escolhe qual
 * consulta pelo NOME e passa parâmetros tipados, validados contra esquema. Ela
 * mantém a capacidade — perde só a de inventar comando.
 *
 * Adicionar uma consulta é adicionar uma entrada aqui. É de propósito que isso
 * exija um commit: toda porta nova para o banco passa por revisão humana.
 */

import type { Esquema } from '../Habilidade';

export interface ConsultaNomeada {
  readonly nome: string;
  /** Escrita para a LLM decidir se é esta que ela quer. */
  readonly descricao: string;
  readonly esquema: Esquema;
  readonly tabela: string;
  /**
   * Monta a consulta no cliente do Supabase. Recebe parâmetros JÁ validados.
   * Nenhuma concatenação de string entra em cláusula — só operadores tipados.
   */
  readonly montar: (
    consulta: SeletorSupabase,
    parametros: Record<string, unknown>,
  ) => SeletorSupabase;
  /** Transforma as linhas em frase. O modelo nunca vê linha crua. */
  readonly redigir: (linhas: readonly Record<string, unknown>[], p: Record<string, unknown>) => string;
}

/**
 * Superfície mínima do query builder que usamos. Tipar só o necessário evita
 * arrastar os genéricos do SDK para dentro do kernel.
 */
export interface SeletorSupabase {
  select(colunas: string): SeletorSupabase;
  eq(coluna: string, valor: unknown): SeletorSupabase;
  gte(coluna: string, valor: unknown): SeletorSupabase;
  order(coluna: string, opcoes: { ascending: boolean }): SeletorSupabase;
  limit(n: number): SeletorSupabase;
}

const UFS = ['GERAL', 'MT', 'MS', 'GO', 'SP', 'PR', 'RO'] as const;

export const CONSULTAS: Readonly<Record<string, ConsultaNomeada>> = {
  centrais_por_uf: {
    nome: 'centrais_por_uf',
    descricao:
      'Centrais ativas e frota vinculada, opcionalmente filtradas por UF. Use para "quantas centrais", "quantos veículos", "status da operação".',
    esquema: { uf: { tipo: 'texto', padrao: 'GERAL', dentre: UFS } },
    tabela: 'centrais',
    montar: (q, p) => {
      const base = q.select('nome, uf, ativa, veiculos');
      return p.uf === 'GERAL' ? base : base.eq('uf', p.uf);
    },
    redigir: (linhas, p) => {
      if (linhas.length === 0) return `Não há central registrada para ${p.uf}.`;
      const ativas = linhas.filter((l) => l.ativa === true);
      const veiculos = ativas.reduce((s, l) => s + Number(l.veiculos ?? 0), 0);
      const escopo = p.uf === 'GERAL' ? 'em toda a operação' : `no território de ${p.uf}`;
      const inativas = linhas.length - ativas.length;
      const nota = inativas > 0 ? ` ${inativas} está(ão) fora de operação.` : '';
      return (
        `${ativas.length} central(is) ativa(s) ${escopo}, somando ${veiculos} veículos ` +
        `vinculados.${nota}`
      );
    },
  },

  incidentes_por_sistema: {
    nome: 'incidentes_por_sistema',
    descricao:
      'Assinaturas de erro registradas para um sistema específico (api-ctes, baixa-ctes, portal-web, api-rastreio, integracao-fiscal, infra-docker).',
    esquema: { sistema: { tipo: 'texto', obrigatorio: true } },
    tabela: 'erros_assinaturas',
    montar: (q, p) =>
      q
        .select('assinatura, sistema, ocorrencias, ultima_ocorrencia, resolucao')
        .eq('sistema', p.sistema)
        .order('ocorrencias', { ascending: false })
        .limit(5),
    redigir: (linhas, p) => {
      if (linhas.length === 0) return `Nenhum incidente registrado para "${p.sistema}".`;
      const itens = linhas
        .map((l) => `• ${l.assinatura} — ${l.ocorrencias}x, última em ${l.ultima_ocorrencia}`)
        .join('\n');
      return `Incidentes registrados em ${p.sistema}:\n${itens}`;
    },
  },

  centrais_inativas: {
    nome: 'centrais_inativas',
    descricao: 'Lista as centrais fora de operação. Use para "o que está parado", "centrais inativas".',
    esquema: {},
    tabela: 'centrais',
    montar: (q) => q.select('nome, uf, veiculos').eq('ativa', false),
    redigir: (linhas) => {
      if (linhas.length === 0) return 'Nenhuma central fora de operação no momento.';
      return `Fora de operação: ${linhas.map((l) => `${l.nome} (${l.uf})`).join(', ')}.`;
    },
  },
};

/** Catálogo para a descrição da habilidade — a LLM escolhe pelo nome. */
export function listarConsultas(): string {
  return Object.values(CONSULTAS)
    .map((c) => `${c.nome} (${Object.keys(c.esquema).join(', ') || 'sem parâmetro'}): ${c.descricao}`)
    .join(' | ');
}
