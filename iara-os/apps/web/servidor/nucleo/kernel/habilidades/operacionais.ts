/**
 * Habilidades operacionais — as de custo zero.
 *
 * Todas compartilham os mesmos adaptadores (`OrquestradorAcoes`,
 * `RagHistorico`), por isso vivem no mesmo arquivo. Uma habilidade nova que
 * fale com outro sistema ganha arquivo próprio: o que a torna plugável é o
 * contrato `Habilidade`, não a fronteira de arquivo.
 *
 * Nenhuma delas conhece o barramento, o planejador ou a sala. Recebem
 * parâmetros validados, devolvem texto. É o que as torna testáveis sem subir
 * o kernel inteiro.
 */

import type { Habilidade } from '../Habilidade';
import { OrquestradorAcoes } from '../../OrquestradorAcoes';
import { RagHistorico } from '../../RagHistorico';

const acoes = new OrquestradorAcoes();
const rag = new RagHistorico();

export const habilidadeClima: Habilidade = {
  manifesto: {
    id: 'clima',
    nome: 'Radar meteorológico',
    descricao: 'Condição atual do perímetro operacional via Open-Meteo.',
    capacidade: 'percepcao',
    permissoes: ['rede'],
    timeout_ms: 6000,
    custo: 'zero',
    esquema: {},
  },
  async executar() {
    const r = await acoes.executar('clima', {});
    return { texto: r.texto, detalhe: `Open-Meteo em ${r.latencia_ms}ms`, resolveu: true };
  },
};

export const habilidadeInfraestrutura: Habilidade = {
  manifesto: {
    id: 'infraestrutura',
    nome: 'Base de centrais',
    descricao: 'Contagem de centrais ativas e frota vinculada, por UF.',
    capacidade: 'automacao',
    permissoes: ['banco'],
    timeout_ms: 4000,
    custo: 'zero',
    esquema: {
      uf: { tipo: 'texto', padrao: 'GERAL', dentre: ['GERAL', 'MT', 'MS', 'GO', 'SP', 'PR', 'RO'] },
    },
  },
  async executar(ctx) {
    const r = await acoes.executar('banco', { uf: ctx.parametros.uf });
    return {
      texto: r.texto,
      detalhe: `consulta UF=${ctx.parametros.uf} em ${r.latencia_ms}ms`,
      resolveu: true,
    };
  },
};

export const habilidadeRelogio: Habilidade = {
  manifesto: {
    id: 'relogio',
    nome: 'Relógio',
    descricao: 'Data e hora do servidor.',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 1000,
    custo: 'zero',
    esquema: {},
  },
  async executar() {
    const r = await acoes.executar('agenda', {});
    return { texto: r.texto, detalhe: 'relógio local', resolveu: true };
  },
};

export const habilidadeBusca: Habilidade = {
  manifesto: {
    id: 'busca',
    nome: 'Busca web',
    descricao: 'Levantamento factual por HTTP puro, sem navegador headless.',
    capacidade: 'conhecimento',
    permissoes: ['rede'],
    timeout_ms: 9000,
    custo: 'zero',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const r = await acoes.executar('busca_web', { consulta: ctx.parametros.consulta });
    return { texto: r.texto, detalhe: `DuckDuckGo em ${r.latencia_ms}ms`, resolveu: true };
  },
};

export const habilidadeIncidente: Habilidade = {
  manifesto: {
    id: 'incidente',
    nome: 'Histórico de incidentes',
    descricao: 'Busca assinatura sintática no índice local. Nunca devolve log bruto.',
    capacidade: 'conhecimento',
    permissoes: ['banco'],
    timeout_ms: 4000,
    custo: 'zero',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const achados = await rag.consultar(String(ctx.parametros.consulta));
    return {
      texto: rag.formatar(achados),
      detalhe: `${achados.length} assinatura(s), nenhum log bruto carregado`,
      resolveu: achados.length > 0,
    };
  },
};

/**
 * Recusa por sigilo. É habilidade, não caso especial no orquestrador: assim a
 * recusa aparece na trilha de eventos como qualquer outra ação, e fica
 * auditável.
 */
export const habilidadeSigilo: Habilidade = {
  manifesto: {
    id: 'sigilo',
    nome: 'Cláusula de sigilo',
    descricao: 'Recusa cortês a pedido sobre registro de outro operador.',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 500,
    custo: 'zero',
    esquema: {},
  },
  async executar() {
    return {
      texto:
        'Os registros individuais pertencem exclusivamente a cada operador — inclusive os seus, ' +
        'que ninguém mais acessa. Não tenho como comentar o conteúdo de outra pessoa. Se precisar ' +
        'de algo consolidado da operação, posso levantar sem expor ninguém.',
      detalhe: 'sondagem cruzada barrada antes do raciocínio',
      resolveu: true,
    };
  },
};

/** Carrega o índice do RAG uma vez, na subida do kernel. */
export async function prepararOperacionais(): Promise<void> {
  await rag.carregar();
}

export const HABILIDADES_OPERACIONAIS: readonly Habilidade[] = [
  habilidadeClima,
  habilidadeInfraestrutura,
  habilidadeRelogio,
  habilidadeBusca,
  habilidadeIncidente,
  habilidadeSigilo,
];
