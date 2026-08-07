/**
 * Manifesto de Capacidades.
 *
 * A filosofia, em código: a IARA nunca "sabe fazer" algo. Ela sabe escolher a
 * capacidade correta para um objetivo. Este arquivo é o mapa dessas escolhas.
 *
 * Vive em `lib/` porque as DUAS pontas precisam dele: o Planejador, para saber
 * o que pode pedir; e a projeção, para mostrar qual família está acesa. É
 * contrato, não detalhe de implementação.
 *
 * Adicionar capacidade = registrar habilidade num domínio. O Kernel não muda.
 */

import type { CapacidadeAtiva } from './estado';

/**
 * As seis famílias. Cada uma agrupa habilidades que competem pelo mesmo tipo
 * de recurso cognitivo — e por isso acendem o mesmo objeto na sala.
 */
export type Dominio = 'memoria' | 'comunicacao' | 'pesquisa' | 'automacao' | 'operacoes' | 'cognicao';

export interface DescricaoDominio {
  readonly id: Dominio;
  readonly nome: string;
  readonly resumo: string;
  /** Que faculdade este domínio consome — e, portanto, que objeto acende. */
  readonly capacidade: CapacidadeAtiva;
}

export const DOMINIOS: Readonly<Record<Dominio, DescricaoDominio>> = {
  memoria: {
    id: 'memoria',
    nome: 'Memória',
    resumo: 'Documentos internos, histórico de incidentes e registros da operação.',
    capacidade: 'memoria',
  },
  comunicacao: {
    id: 'comunicacao',
    nome: 'Comunicação',
    resumo: 'E-mail, mensageria e agenda — tudo que fala com pessoas.',
    capacidade: 'automacao',
  },
  pesquisa: {
    id: 'pesquisa',
    nome: 'Pesquisa',
    resumo: 'Levantamento factual fora das fronteiras da empresa.',
    capacidade: 'conhecimento',
  },
  automacao: {
    id: 'automacao',
    nome: 'Automação',
    resumo: 'Consulta a banco, extração de documento e execução determinística.',
    capacidade: 'automacao',
  },
  operacoes: {
    id: 'operacoes',
    nome: 'Operações',
    resumo: 'Sistemas da casa: CT-e, rastreio, portal, fiscal.',
    capacidade: 'automacao',
  },
  cognicao: {
    id: 'cognicao',
    nome: 'Cognição',
    resumo: 'Planejamento, raciocínio e síntese. A camada mais cara.',
    capacidade: 'raciocinio',
  },
};

export const ORDEM_DOMINIOS: readonly Dominio[] = [
  'memoria',
  'pesquisa',
  'automacao',
  'operacoes',
  'comunicacao',
  'cognicao',
];

// ---------------------------------------------------------------------------
// Projeção do manifesto
// ---------------------------------------------------------------------------

/**
 * Uma capacidade, do ponto de vista de quem olha de fora. Sai no snapshot para
 * a projeção montar o painel — sem conhecer executor, esquema nem permissão.
 */
export interface CapacidadeProjetada {
  readonly id: string;
  readonly nome: string;
  readonly dominio: Dominio;
  /**
   * `false` quando a habilidade existe no catálogo mas falta credencial ou
   * dependência. Declarar o indisponível é mais honesto que esconder: o
   * operador vê o que a IARA poderia fazer e o que falta ligar.
   */
  readonly disponivel: boolean;
  readonly motivo_indisponivel?: string;
  readonly custo: 'zero' | 'tokens';
}

export interface ManifestoProjetado {
  readonly dominios: readonly {
    readonly dominio: DescricaoDominio;
    readonly capacidades: readonly CapacidadeProjetada[];
  }[];
  readonly total: number;
  readonly disponiveis: number;
}

/** Agrupa uma lista plana de capacidades na árvore de domínios. */
export function agruparPorDominio(capacidades: readonly CapacidadeProjetada[]): ManifestoProjetado {
  const dominios = ORDEM_DOMINIOS.map((id) => ({
    dominio: DOMINIOS[id],
    capacidades: capacidades.filter((c) => c.dominio === id),
  })).filter((g) => g.capacidades.length > 0);

  return {
    dominios,
    total: capacidades.length,
    disponiveis: capacidades.filter((c) => c.disponivel).length,
  };
}
