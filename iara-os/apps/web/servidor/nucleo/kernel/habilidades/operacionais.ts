/**
 * Habilidades operacionais — as de custo zero, sempre disponíveis.
 *
 * Nomenclatura: verbo + objeto, em português. `consultar_clima`, não `clima`.
 * O id é lido pela LLM quando ela planeja; um substantivo solto não diz o que
 * a habilidade FAZ, e plano ruim começa em catálogo mal nomeado.
 *
 * Nenhuma conhece o barramento, o planejador ou a sala. Recebem parâmetros
 * validados, devolvem texto. É o que as torna testáveis sem subir o kernel.
 */

import type { Habilidade } from '../Habilidade';
import { OrquestradorAcoes } from '../../OrquestradorAcoes';
import { RagHistorico } from '../../RagHistorico';

const acoes = new OrquestradorAcoes();
const rag = new RagHistorico();

export const consultarClima: Habilidade = {
  manifesto: {
    id: 'consultar_clima',
    nome: 'Radar meteorológico',
    descricao:
      'Condição meteorológica atual do perímetro operacional (temperatura, umidade, precipitação). Use para perguntas sobre tempo, chuva, calor ou frio.',
    dominio: 'pesquisa',
    capacidade: 'percepcao',
    permissoes: ['rede'],
    timeout_ms: 6000,
    custo: 'zero',
    risco: 'baixo',
    esquema: {},
  },
  async executar() {
    const r = await acoes.executar('clima', {});
    return { texto: r.texto, detalhe: `Open-Meteo em ${r.latencia_ms}ms`, resolveu: true };
  },
};

/**
 * Consulta de infraestrutura com fallback.
 *
 * Convive com `executar_consulta_sql` de propósito: esta SEMPRE funciona,
 * porque cai para `dados/infraestrutura.json` quando o Supabase não está
 * configurado. A de SQL é mais poderosa e só existe com banco ligado.
 *
 * Sem esta, o modo local perderia a pergunta mais frequente da operação —
 * "quantas centrais temos?" — e o sistema pareceria quebrado quando na verdade
 * estaria apenas sem credencial.
 */
export const consultarInfraestrutura: Habilidade = {
  manifesto: {
    id: 'consultar_infraestrutura',
    nome: 'Base de centrais',
    descricao:
      'Centrais ativas e frota vinculada, por UF. Use para "quantas centrais", "quantos veículos", "status da operação". Funciona com ou sem banco configurado.',
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['banco'],
    timeout_ms: 5000,
    custo: 'zero',
    risco: 'baixo',
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

export const consultarAgenda: Habilidade = {
  manifesto: {
    id: 'consultar_agenda',
    nome: 'Relógio e calendário',
    descricao:
      'Data e hora correntes do servidor. Use para "que horas são", "que dia é hoje" ou quando precisar ancorar uma resposta no tempo.',
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 1000,
    custo: 'zero',
    risco: 'baixo',
    esquema: {},
  },
  async executar() {
    const r = await acoes.executar('agenda', {});
    return { texto: r.texto, detalhe: 'relógio local', resolveu: true };
  },
};

export const pesquisarWeb: Habilidade = {
  manifesto: {
    id: 'pesquisar_web',
    nome: 'Pesquisa web',
    descricao:
      'Levantamento factual na internet por HTTP puro. Use para informação pública que não está nos sistemas da casa: legislação, notícia, definição de termo.',
    dominio: 'pesquisa',
    capacidade: 'conhecimento',
    permissoes: ['rede'],
    timeout_ms: 9000,
    custo: 'zero',
    risco: 'baixo',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const r = await acoes.executar('busca_web', { consulta: ctx.parametros.consulta });
    return { texto: r.texto, detalhe: `DuckDuckGo em ${r.latencia_ms}ms`, resolveu: true };
  },
};

export const buscarHistorico: Habilidade = {
  manifesto: {
    id: 'buscar_historico',
    nome: 'Histórico de incidentes',
    descricao:
      'Procura no índice de incidentes por assinatura semelhante e devolve a resolução que o time adotou. Use para "esse erro já aconteceu", "caiu de novo", "mesmo problema".',
    dominio: 'memoria',
    capacidade: 'conhecimento',
    permissoes: ['banco'],
    timeout_ms: 4000,
    custo: 'zero',
    risco: 'baixo',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const achados = await rag.consultar(String(ctx.parametros.consulta));
    return {
      texto: rag.formatar(achados),
      // O detalhe é o que sobe para o console. Nunca o log bruto — que, aliás,
      // nem existe na base: é essa ausência que protege o contexto do modelo.
      detalhe: `${achados.length} assinatura(s), nenhum log bruto carregado`,
      resolveu: achados.length > 0,
    };
  },
};

/**
 * Recusa por sigilo. É habilidade, não caso especial no orquestrador: assim a
 * recusa aparece na trilha de eventos como qualquer outra ação, e fica
 * auditável junto com o resto.
 */
export const recusarPorSigilo: Habilidade = {
  manifesto: {
    id: 'recusar_por_sigilo',
    nome: 'Cláusula de sigilo',
    descricao: 'Recusa cortês a pedido sobre registro de outro operador.',
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 500,
    custo: 'zero',
    risco: 'baixo',
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
  consultarClima,
  consultarInfraestrutura,
  consultarAgenda,
  pesquisarWeb,
  buscarHistorico,
  recusarPorSigilo,
];
