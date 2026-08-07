/**
 * Planejador hierárquico: objetivo -> plano -> passos -> habilidades.
 *
 * DECISÃO QUE MERECE EXPLICAÇÃO: o planejamento é híbrido, não determinístico
 * puro.
 *
 * Um planejador de regras só consegue executar planos que alguém já escreveu.
 * "Analise este contrato e me faça um resumo" tem sete passos que ninguém
 * cadastrou antes — decompor isso É raciocínio. Um planejador só de regras
 * troca "a LLM faz tudo" por "a IARA não faz nada que não foi previsto".
 *
 * Então: intenção reconhecida vira plano determinístico (custo zero, ~5ms);
 * objetivo novo vira um plano de um passo que delega a decomposição ao
 * raciocínio. A Função Executiva é quem escolhe, e ela escolhe pelo grau de
 * confiança da percepção.
 */

import type { Percepcao, Passo, Plano } from './Evento';

function passo(
  indice: number,
  descricao: string,
  habilidade: string | null,
  parametros: Record<string, unknown> = {},
): Passo {
  return { indice, descricao, habilidade, parametros };
}

/** Planos conhecidos, indexados pela âncora que a percepção encontrou. */
const RECEITAS: Record<string, (p: Percepcao) => Plano> = {
  clima: () => ({
    objetivo: 'Informar a condição externa do perímetro operacional',
    origem: 'deterministico',
    passos: [passo(0, 'Consultar radar meteorológico', 'clima')],
  }),

  infraestrutura: (p) => ({
    objetivo: 'Responder sobre o estado da infraestrutura',
    origem: 'deterministico',
    passos: [passo(0, 'Consultar base de centrais', 'infraestrutura', { uf: extrairUf(p.bruto) })],
  }),

  incidente: (p) => ({
    objetivo: 'Recuperar histórico de incidente equivalente',
    origem: 'deterministico',
    passos: [passo(0, 'Buscar assinatura no índice histórico', 'incidente', { consulta: p.bruto })],
  }),

  relogio: () => ({
    objetivo: 'Informar referência temporal',
    origem: 'deterministico',
    passos: [passo(0, 'Ler relógio do servidor', 'relogio')],
  }),

  busca: (p) => ({
    objetivo: 'Levantar informação factual externa',
    origem: 'deterministico',
    passos: [passo(0, 'Buscar na web', 'busca', { consulta: p.bruto })],
  }),
};

const UFS: Record<string, string> = {
  'mato grosso do sul': 'MS',
  'mato grosso': 'MT',
  goias: 'GO',
  'sao paulo': 'SP',
  parana: 'PR',
  rondonia: 'RO',
};

function extrairUf(bruto: string): string {
  const t = bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const [nome, sigla] of Object.entries(UFS)) {
    if (t.includes(nome)) return sigla;
  }
  const m = t.match(/\b(?:em|no|na|de|do|da)\s+(mt|ms|go|sp|pr|ro)\b/);
  return m ? m[1].toUpperCase() : 'GERAL';
}

export class Planejador {
  /** Existe receita determinística para esta percepção? */
  temReceita(p: Percepcao): boolean {
    return p.ancoras.some((a) => a in RECEITAS);
  }

  /**
   * A primeira âncora reconhecida vence. Ordem importa: "esse erro de banco já
   * aconteceu?" casa `incidente` e `infraestrutura`; a intenção real é o
   * histórico, e `incidente` vem antes na lista de âncoras da percepção.
   */
  planejar(p: Percepcao): Plano {
    for (const ancora of p.ancoras) {
      const receita = RECEITAS[ancora];
      if (receita) return receita(p);
    }
    return this.planoDeRaciocinio(p);
  }

  /**
   * Plano de um passo só: delega a decomposição ao raciocínio. É a saída
   * honesta para objetivo novo — melhor um passo que admite que precisa pensar
   * do que sete passos inventados que não levam a lugar nenhum.
   */
  planoDeRaciocinio(p: Percepcao): Plano {
    return {
      objetivo: p.objetivo_provavel === 'indeterminado' ? 'Atender o pedido do operador' : p.objetivo_provavel,
      origem: 'emergente',
      passos: [passo(0, 'Raciocinar sobre o pedido', 'raciocinio', {})],
    };
  }

  planoDeRecusa(motivo: string): Plano {
    return {
      objetivo: 'Recusar acesso a registro de terceiro',
      origem: 'deterministico',
      passos: [passo(0, motivo, 'sigilo', {})],
    };
  }
}
