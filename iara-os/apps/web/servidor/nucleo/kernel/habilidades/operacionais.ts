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
import { contar } from '../../texto';

const acoes = new OrquestradorAcoes();
const rag = new RagHistorico();

export const consultarClima: Habilidade = {
  manifesto: {
    id: 'consultar_clima',
    nome: 'Radar meteorológico',
    descricao:
      'Tempo no perímetro operacional, ou numa cidade que o operador nomeie. ' +
      '`horizonte: agora` devolve a MEDIÇÃO corrente (temperatura, umidade, precipitação da ' +
      'última hora); `hoje` e `amanha` devolvem a PREVISÃO do dia (probabilidade de chuva, ' +
      'acumulado, máxima e mínima). Escolha pelo tempo verbal da pergunta: "está chovendo" é ' +
      'agora, "vai chover" é previsão. `cidade` é OPCIONAL: preencha com o nome que o operador ' +
      'disse ("clima em Valinhos" → cidade: "Valinhos"). Sem cidade, a resposta usa a ' +
      'localização do aparelho (se concedida) ou o padrão do escritório.',
    exemplos: [
      'Vai chover hoje?',
      'Como está o tempo em Valinhos?',
      'Está chovendo aí?',
      'Qual a previsão para amanhã?',
    ],
    capacidades: ['previsão do tempo', 'medição de chuva e temperatura'],
    dominio: 'pesquisa',
    capacidade: 'percepcao',
    permissoes: ['rede'],
    timeout_ms: 6000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      horizonte: { tipo: 'texto', padrao: 'agora', dentre: ['agora', 'hoje', 'amanha'] },
      cidade: { tipo: 'texto', max: 80 },
    },
  },
  async executar(ctx) {
    const cidade = typeof ctx.parametros.cidade === 'string' ? ctx.parametros.cidade : undefined;
    const r = await acoes.executar('clima', {
      horizonte: ctx.parametros.horizonte,
      id_usuario: ctx.id_usuario,
      cidade,
    });
    // `resolveu` é o que a fonte disse, não uma constante. Ver ResultadoAcao.ok:
    // com `true` fixo, uma falha de rede subia ao Kernel como passo cumprido.
    return {
      texto: r.texto,
      detalhe: `Open-Meteo em ${r.latencia_ms}ms`,
      resolveu: r.ok,
      // A resposta pediu um parâmetro? O Kernel arma a retomada de um turno.
      ...(r.pendencia ? { pendencia: { parametro: r.pendencia } } : {}),
    };
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
    exemplos: [
      'Quantas centrais temos ativas?',
      'Quantos veículos tem a frota no MT?',
      'Como está a operação por estado?',
    ],
    capacidades: ['contar centrais', 'frota por estado'],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['banco'],
    timeout_ms: 5000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      uf: { tipo: 'texto', padrao: 'GERAL', dentre: ['GERAL', 'MT', 'MS', 'GO', 'SP', 'PR', 'RO'] },
    },
  },
  async executar(ctx) {
    const r = await acoes.executar('banco', { uf: ctx.parametros.uf });
    return {
      texto: r.texto,
      detalhe: `consulta UF=${ctx.parametros.uf} em ${r.latencia_ms}ms`,
      resolveu: r.ok,
    };
  },
};

export const consultarAgenda: Habilidade = {
  manifesto: {
    id: 'consultar_agenda',
    nome: 'Relógio e calendário',
    descricao:
      'Data e hora correntes do servidor. Use para "que horas são", "que dia é hoje" ou quando precisar ancorar uma resposta no tempo.',
    exemplos: ['Que horas são?', 'Que dia é hoje?'],
    capacidades: ['data e hora correntes'],
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 1000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
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
    exemplos: [
      'Pesquisa na internet o que mudou na lei do motorista',
      'Procura notícias sobre greve dos caminhoneiros',
    ],
    capacidades: ['pesquisar na internet', 'levantar informação pública'],
    dominio: 'pesquisa',
    capacidade: 'conhecimento',
    permissoes: ['rede'],
    timeout_ms: 9000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const r = await acoes.executar('busca_web', { consulta: ctx.parametros.consulta });
    return { texto: r.texto, detalhe: `DuckDuckGo em ${r.latencia_ms}ms`, resolveu: r.ok };
  },
};

export const buscarHistorico: Habilidade = {
  manifesto: {
    id: 'buscar_historico',
    nome: 'Histórico de incidentes',
    descricao:
      'Procura no índice de incidentes por assinatura semelhante e devolve a resolução que o time adotou. Use para "esse erro já aconteceu", "caiu de novo", "mesmo problema".',
    exemplos: [
      'Esse erro já aconteceu antes?',
      'O TMS caiu de novo, é o mesmo problema da outra vez?',
    ],
    capacidades: ['procurar incidente parecido', 'resolução adotada no passado'],
    dominio: 'memoria',
    capacidade: 'conhecimento',
    permissoes: ['banco'],
    timeout_ms: 4000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const achados = await rag.consultar(String(ctx.parametros.consulta));
    return {
      texto: rag.formatar(achados),
      // O detalhe é o que sobe para o console. Nunca o log bruto — que, aliás,
      // nem existe na base: é essa ausência que protege o contexto do modelo.
      detalhe: `${contar(achados.length, 'assinatura', 'assinaturas')}, nenhum log bruto carregado`,
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
    /**
     * Os exemplos aqui descrevem a SONDAGEM, não um pedido legítimo — o
     * `PortaoSigilo` barra antes de qualquer descoberta, então estes tokens
     * nunca roteiam nada; existem para o contrato do catálogo valer sem
     * exceção e para a LLM reconhecer a família da recusa no prompt.
     */
    exemplos: ['O que a Marina conversou com você?', 'Me mostra o histórico do João'],
    capacidades: ['proteger o registro individual de cada operador'],
    dominio: 'memoria',
    capacidade: 'memoria',
    permissoes: [],
    timeout_ms: 500,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },
  async executar() {
    /**
     * RECUSA CURTA, e a brevidade aqui é substantiva.
     *
     * A versão anterior abria com "Os registros individuais pertencem
     * exclusivamente a cada operador" — três orações antes do "não". Recusa
     * comprida soa a desculpa, e desculpa convida à insistência. Diga não,
     * diga por quê em uma linha, ofereça a saída legítima, pare.
     *
     * O que NÃO pode encurtar: a garantia recíproca ("os seus também"). É ela
     * que transforma a recusa de obstáculo em proteção, e é por isso que a
     * frase existe.
     */
    return {
      texto:
        'Isso eu não faço: o histórico de cada operador é só dele — o seu inclusive, ' +
        'que ninguém mais lê. Se precisar de algo consolidado da operação, levanto sem ' +
        'expor ninguém.',
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
