/**
 * Habilidade "consultar_cargas_luft" — fase 1 do Workbook Intelligence Layer
 * da operação LUFT (ver conversa de 14/08/2026). Responde SÓ o que dá para
 * calcular sem interpretação: "quantas cargas hoje/amanhã/essa semana", a
 * pergunta que o próprio Question Router resolveria no ramo IARA-calcula,
 * sem chamar o Claude.
 *
 * Perguntas analíticas (atrasadas, faturamento por rota, ranking de
 * motorista, anomalias, comparação entre semanas, relatório executivo) NÃO
 * estão aqui — pedem regra de negócio que ainda não foi definida (o que
 * conta como "atrasada"? qual a margem que dispara alerta?) e ficam para as
 * próximas fases, uma vez definidas.
 */

import type { Habilidade } from '../Habilidade';
import {
  ANO_VIVO,
  ANOS_LIDOS,
  agregarCargas,
  anoCitado,
  anoForaDoAlcance,
  cargasDoAno,
  type AnoLido,
  cargasNoPeriodo,
  contarCargas,
  contarDistintos,
  semMovimentoNaJanela,
  tabelaDeTrechos,
  suspeitasDeIdentidade,
  planilhaOcisDisponivel,
  todasAsCargas,
  valorDaDimensao,
  valorMedio,
  type AgruparPor,
  type CargaCompleta,
} from '../../ClientePlanilhaOcis';
import { deCoberturaDeJoin } from '../Cobertura';
import { interpretarPeriodo } from '../PeriodoOperacional';
import { calcularMargem, margemMediaDasRotas, margemPorDimensao } from '../../MargemOperacional';
import {
  comparar,
  compararPercentual,
  decompor,
  dizerVariacao,
  dizerVariacaoPercentual,
} from '../../ComparacaoDePeriodos';
import { DIMENSOES_SEM_COLUNA, LACUNAS_DE_COLUNA, SAIDA_DA_LACUNA } from '../ContratoFactual';

const formatarReal = (v: number): string =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const AGRUPAMENTOS: readonly AgruparPor[] = [
  'motorista',
  'rota',
  'origem',
  'destino',
  'status',
  'status_normalizado',
  'nenhum',
];

/**
 * COMO A OPERADORA E A LLM CHAMAM CADA AGRUPAMENTO.
 *
 * O DEFEITO (produção, 18/08/2026): "quantas cargas temos no total?" devolveu
 * *"Não executei isso. (…) `agrupar_por` fora dos valores aceitos"*. A pergunta
 * é a mais simples que existe neste domínio, e a resposta foi o nome de um
 * parâmetro interno. O modelo tinha dito "total" — que É a palavra certa em
 * português para "não agrupe nada" — e o enum só aceitava `nenhum`.
 *
 * Traduzir aqui e não afrouxar a validação: quem não estiver neste mapa
 * continua sendo recusado, agora com o enum na mensagem. Ver
 * `CampoEsquema.sinonimos`.
 */
const SINONIMOS_AGRUPAMENTO: Readonly<Record<string, AgruparPor>> = {
  /* "sem agrupar" dito de todas as formas em que já foi dito. */
  total: 'nenhum',
  totais: 'nenhum',
  nenhuma: 'nenhum',
  none: 'nenhum',
  null: 'nenhum',
  geral: 'nenhum',
  todos: 'nenhum',
  todas: 'nenhum',
  sem_agrupamento: 'nenhum',
  'sem agrupamento': 'nenhum',
  /* Plural e sinônimo de domínio — a operadora diz "por motoristas". */
  motoristas: 'motorista',
  condutor: 'motorista',
  condutores: 'motorista',
  rotas: 'rota',
  origens: 'origem',
  destinos: 'destino',
  /* O VOCABULÁRIO DA OPERAÇÃO (operadora, 19/08/2026): há um cliente só, a
     LUFT. A origem é o POSTO que despacha; o destino é a CENTRAL que recebe. É
     assim que a pergunta chega, e traduzir aqui é o que evita a operadora ter
     de traduzir na cabeça dela. */
  posto: 'origem',
  postos: 'origem',
  central: 'destino',
  centrais: 'destino',
  /* "cidade" sozinha é ambígua entre origem e destino: fica FORA do mapa de
     propósito, para virar recusa com o enum na mensagem em vez de um palpite
     que responde a pergunta errada. */
  status_normalizada: 'status_normalizado',
  situacao: 'status',
  situacoes: 'status',
};

/** Mesma disciplina para a métrica: a LLM diz "soma", o enum diz `valor_total`. */
const SINONIMOS_METRICA: Readonly<Record<string, Metrica>> = {
  soma: 'valor_total',
  total: 'valor_total',
  valor: 'valor_total',
  faturamento: 'valor_total',
  soma_valor: 'valor_total',
  media: 'valor_medio',
  medio: 'valor_medio',
  ticket_medio: 'valor_medio',
  'ticket medio': 'valor_medio',
  count: 'contagem',
  quantidade: 'contagem',
  numero: 'contagem',
  cargas: 'contagem',
  /* "quantos motoristas DIFERENTES" — a família que a LLM resolvia somando o
     rodapé de uma listagem truncada. Ver a métrica `distintos`. */
  distinto: 'distintos',
  diferentes: 'distintos',
  unicos: 'distintos',
  count_distinct: 'distintos',
  contagem_distinta: 'distintos',
  /* A família "quem parou" — ver a métrica `sem_movimento`. */
  parados: 'sem_movimento',
  inativos: 'sem_movimento',
  sem_carga: 'sem_movimento',
  sem_movimentacao: 'sem_movimento',
  /* A familia da margem — ver a metrica `margem`. */
  margem_bruta: 'margem',
  margens: 'margem',
  lucro: 'margem',
  resultado: 'margem',
  rentabilidade: 'margem',
};

/**
 * Uma linha, densa, para o console técnico — `ResultadoHabilidade.detalhe`
 * é contratualmente "uma linha, nunca payload cru" (ver `Habilidade.ts`).
 * A proveniência cabe aqui como pares `chave=valor`, não como objeto
 * aninhado: quem quiser mais que isso audita o jornal de operações, que é
 * onde payload de verdade mora.
 */
function proveniencia(campos: Readonly<Record<string, string | number | boolean>>): string {
  return Object.entries(campos)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
}
/**
 * COMO A DIMENSÃO SE CHAMA EM PORTUGUÊS — singular e plural, para a frase.
 *
 * O DEFEITO (auditoria em navegador real, 19/08/2026): a resposta saía
 * *"82 origems diferentes"* e *"3 status_normalizados diferentes — 2529 cargas
 * sem status_normalizado preenchido"*. O texto era montado com
 * `${agruparPor}` mais um "s" — quer dizer, com o NOME DO PARÂMETRO INTERNO
 * concatenado a um plural de brinquedo.
 *
 * É a mesma doença que esta folha já pagou em 18/08, quando a IARA respondeu
 * *"`agrupar_por` fora dos valores aceitos"* a quem perguntou quantas cargas
 * existem: vocabulário de dentro do código vazando para quem só queria o número.
 * Naquela vez entrou `SINONIMOS_AGRUPAMENTO` para traduzir o que ENTRA; faltava
 * traduzir o que SAI. A tradução tem que ter as duas direções, senão ela é meia.
 *
 * `status` não flexiona em português — e é por isso que o mapa guarda as duas
 * formas em vez de calcular o plural com um "s".
 */
const NOME_DA_DIMENSAO: Readonly<Record<AgruparPor, { um: string; varios: string }>> = {
  motorista: { um: 'motorista', varios: 'motoristas' },
  rota: { um: 'rota', varios: 'rotas' },
  /* POSTO e CENTRAL, não "origem" e "destino": são os nomes da coisa nesta
     operação, e a coluna é só onde eles moram. Dizer "82 origens" obriga quem
     lê a traduzir de volta; dizer "82 postos" já é a resposta. A procedência
     continua carimbando `dimensao=origem`, que é o que o auditor confere. */
  origem: { um: 'posto', varios: 'postos' },
  destino: { um: 'central', varios: 'centrais' },
  status: { um: 'status', varios: 'status' },
  status_normalizado: { um: 'status', varios: 'status' },
  nenhum: { um: 'registro', varios: 'registros' },
};

const METRICAS = ['contagem', 'valor_total', 'valor_medio', 'distintos', 'sem_movimento', 'margem'] as const;
type Metrica = (typeof METRICAS)[number];

/**
 * O ANO VIVO NÃO É UM PERÍODO — É A ABA INTEIRA.
 *
 * O DEFEITO (produção, 18/08/2026, na mesma sessão que fechou o ano fora de
 * alcance): "qual o valor total faturado nas cargas de 2026?" devolveu *"Não
 * entendi '2026' como período"*. A LLM tinha feito o certo — repassou o ano que
 * o operador disse —, o ano ERA o que o sistema lê, e mesmo assim a resposta foi
 * recusa. `interpretarPeriodo` entende "hoje", "essa semana" e datas; ano não
 * está no vocabulário dele, e não deveria estar: para esta leitura, o ano vivo
 * não filtra nada, porque a aba inteira já é aquele ano.
 *
 * Então some daqui em vez de virar filtro. "de 2026" fica vazio (universo
 * inteiro, que é a resposta certa); "janeiro de 2026" continua devolvendo
 * "janeiro", que o interpretador ainda não entende e recusa com honestidade —
 * uma lacuna declarada é melhor que um filtro inventado.
 *
 * Só o ano VIVO: qualquer outro já foi barrado por `recusaPorAno` antes daqui.
 */
function tirarOAnoVivo(frase: string): string {
  return frase
    .replace(new RegExp(`\\b${ANO_VIVO}\\b`, 'g'), ' ')
    .replace(/\b(em|de|do|da|no|na|ano|o|a)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Só para o portão de regressão — ver `testes/ano-fora-de-alcance.test.ts`. */
export const _tirarOAnoVivoParaTeste = tirarOAnoVivo;

/**
 * ANO FORA DO ALCANCE — a recusa vem ANTES de qualquer conta, nas QUATRO
 * habilidades desta folha.
 *
 * O DEFEITO (18/08/2026). Perguntada quantas cargas existem, a IARA respondeu
 * "2681 cargas no total". São 2681 em 2026; a planilha tem 10.777, porque as
 * abas "2025" (4031) e "2024" (4065) estão no mesmo arquivo e não são lidas. A
 * procedência já carimbava `fonte: '2026'` — o sistema sabia o ano e não
 * contava a quem perguntou.
 *
 * Sem esta porta, "quantas cargas em 2025?" faz o universo inteiro de 2026
 * responder e o número sai rotulado como se fosse de 2025. É a resposta certa
 * para a pergunta errada, a mais cara de todas: está bem formatada, tem
 * procedência, e ninguém a confere.
 *
 * Uma função e não quatro cópias: a regra é a mesma nas quatro, e regra
 * duplicada diverge — é a doença que este repositório já pagou duas vezes.
 *
 * `null` = a pergunta cabe no alcance; siga.
 */
function recusaPorAno(
  enunciado: string,
): { texto: string; detalhe: string; resolveu: false } | null {
  const anoFora = anoForaDoAlcance(enunciado);
  if (!anoFora) return null;
  return {
    texto:
      `Não consigo responder sobre ${anoFora}: eu leio só a aba "${ANO_VIVO}" da planilha. ` +
      `A aba "${anoFora}" existe no mesmo arquivo, mas está fora do meu alcance nesta versão. ` +
      `Ela tem outro desenho de colunas, e lê-la com o mapa de ${ANO_VIVO} me faria devolver ` +
      'número errado em vez de nenhum. ' +
      `Se a pergunta valer para ${ANO_VIVO}, é só me dizer.`,
    detalhe: proveniencia({
      fonte: 'planilha LUFT',
      resultado: 'fora_de_alcance',
      ano_pedido: anoFora,
      ano_lido: ANO_VIVO,
    }),
    resolveu: false,
  };
}

export const consultarCargasLuft: Habilidade = {
  manifesto: {
    id: 'consultar_cargas_luft',
    nome: 'Cargas da operação LUFT',
    descricao:
      'Conta e lista as cargas (OCIs) com coleta marcada num período, lendo a planilha oficial da ' +
      'operação LUFT. O parâmetro "periodo" recebe a EXPRESSÃO como foi dita ("hoje", "amanhã", ' +
      '"essa semana", "17/08") — não calcule a data, quem interpreta é o motor. Use para "quantas ' +
      'cargas vamos coletar hoje/amanhã", "o que temos essa semana", "cargas do dia 17/08".',
    exemplos: [
      'Quantas cargas foram coletadas hoje?',
      'Quantas coletas temos amanhã na LUFT?',
      'O que temos de carga essa semana?',
      'Me mostra as cargas do dia 17/08',
    ],
    capacidades: ['contar cargas por período', 'listar coletas marcadas'],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    /**
     * SETENTA E CINCO SEGUNDOS, e o número é aritmética, não generosidade.
     *
     * MEDIDO EM PRODUÇÃO (19/08/2026). "Quantos motoristas temos?" devolveu
     * "consultar_estatisticas_cargas_luft passou de 15000ms". O roteamento
     * estava certo e a habilidade era a certa — ela morria antes de terminar.
     *
     * DOIS TETOS PARA A MESMA OPERAÇÃO, e só um tinha sido levantado. A leitura
     * em massa da planilha (~2700 linhas × 29 colunas pelo `range`, ou o arquivo
     * inteiro pelo caminho de `/content`) ganhou 60 s em
     * `TEMPO_LIMITE_LEITURA_MS`; a habilidade que a chama continuou com 15. O
     * `GerenciadorHabilidades` a matava aos 15 s, e o operador via um timeout
     * sem saber que a leitura ainda estava a caminho.
     *
     * O TETO DE FORA PRECISA SER MAIOR QUE O DE DENTRO, sempre. Senão o interno
     * nunca chega a valer e quem lê o código acredita num prazo que o sistema
     * não pratica — 60 s de rede mais margem para desserializar e agregar.
     *
     * Só pesa no cache frio: com os 5 min de cache quente a resposta é imediata.
     * As quatro habilidades desta folha compartilham o número porque compartilham
     * a leitura.
     */
    timeout_ms: 75000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      periodo: { tipo: 'texto', obrigatorio: true },
    },
  },
  indisponivelPorque() {
    return planilhaOcisDisponivel() ? null : 'falta MS_GRAPH_TOKEN ou MS_GRAPH_OCI_URL no ambiente';
  },
  async executar(ctx) {
    const foraDeAlcance = recusaPorAno(ctx.enunciado);
    if (foraDeAlcance) return foraDeAlcance;

    const frase = String(ctx.parametros.periodo ?? '');
    const periodo = interpretarPeriodo(frase);

    if (!periodo) {
      return {
        texto:
          `Não entendi "${frase}" como período, então não consultei nada. ` +
          'Entendo "hoje", "amanhã", "depois de amanhã", "ontem", "essa semana", "semana que vem" ' +
          'ou uma data como "17/08".',
        detalhe: `expressão de período não interpretada: "${frase.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    const r = await cargasNoPeriodo(periodo.inicio, periodo.fim);
    return {
      texto: r.ok ? `${periodo.rotulo}: ${r.texto}` : r.texto,
      detalhe: `planilha LUFT, período ${periodo.inicio}..${periodo.fim} (${r.cargas.length} carga(s))`,
      resolveu: r.ok,
    };
  },
  /** Leitura verifica lendo de novo — mesmo contrato de `lerEmails`/`buscarDocumentoSharepoint`. */
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'a planilha da operação LUFT respondeu à consulta' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

/**
 * Habilidade "consultar_estatisticas_cargas_luft" — fase 2. Generaliza a
 * fase 1 além de "contar por data": conta, soma valor e agrupa por
 * motorista/rota/origem/destino/status — uma única habilidade composável em
 * vez de uma por pergunta, no mesmo espírito do "Analytics Engine"
 * discutido em 14/08/2026. Cobre a maior parte das perguntas de contagem,
 * ranking e faturamento das "100 perguntas" sem precisar do Claude.
 *
 * O QUE FICA DE FORA DE PROPÓSITO: atraso (precisa de uma regra — quantos
 * dias sem coleta é "atrasada"?), anomalia (precisa de um limiar), e
 * qualquer pergunta que exija interpretação em vez de conta. Essas ficam
 * para quando a regra de negócio for definida, ou para o Claude, quando a
 * pergunta pedir raciocínio de verdade — nunca para esta habilidade decidir
 * um limiar sozinha.
 */
export const consultarEstatisticasCargasLuft: Habilidade = {
  manifesto: {
    id: 'consultar_estatisticas_cargas_luft',
    nome: 'Estatísticas da operação LUFT',
    descricao:
      'Conta, soma valor ou agrupa as cargas da operação LUFT — motorista com mais cargas, faturamento ' +
      'por rota, cargas por status, valor total ou médio. "periodo" é opcional (vazio = todas as cargas ' +
      'cadastradas) e recebe a EXPRESSÃO como foi dita ("essa semana", "17/08"), nunca uma data já ' +
      'calculada. "agrupar_por" é um de: motorista, rota, origem, destino, status (texto exato da célula), ' +
      'status_normalizado (agrupa FINALIZADO/finalizado/FINALIZADA juntos), nenhum. NESTA OPERAÇÃO a ' +
      'origem é o POSTO que despacha e o destino é a CENTRAL que recebe: "por posto" = origem, ' +
      '"por central" = destino. Há um cliente só (LUFT), então não existe agrupamento por cliente. ' +
      '"metrica" é um de: contagem, valor_total, valor_medio, distintos, sem_movimento. ' +
      'Use sem_movimento com um "periodo" para "quais centrais/postos/motoristas NÃO tiveram carga ' +
      'nos últimos 30 dias" — ela lista quem a planilha do ano conhece e não apareceu na janela, e ' +
      'EXIGE período (sem janela não existe "parou"). Use para "qual motorista fez mais cargas", ' +
      '"faturamento por rota", "quantas cargas por status", "valor total das cargas desta semana". ' +
      'Para "QUANTOS motoristas/rotas/destinos DIFERENTES existem", use metrica=distintos com o ' +
      'agrupar_por da dimensão — ela devolve a contagem única já descontando as cargas sem o campo ' +
      'preenchido. NUNCA some os grupos de uma listagem para chegar a esse número: a listagem é ' +
      'truncada e o rodapé "e mais N" não é somável.',
    exemplos: [
      'Qual motorista tem mais cargas?',
      'Quantos motoristas diferentes temos?',
      'Quantas cargas por posto?',
      'Qual central recebeu mais cargas?',
      'Quais centrais não tiveram cargas nos últimos 30 dias?',
      'Quais postos ficaram sem carga essa semana?',
      'Quantas rotas distintas existem?',
      'Motoristas disponíveis agora?',
      'Qual rota teve maior faturamento?',
      'Qual o total faturado essa semana?',
      'Quantas cargas estão finalizadas?',
    ],
    capacidades: [
      'ranking de motoristas',
      'cargas por posto e por central',
      'quem parou de movimentar num período',
      'faturamento por rota',
      'valor total e médio das cargas',
      'cargas por status',
    ],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    timeout_ms: 75000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      periodo: { tipo: 'texto', padrao: '' },
      agrupar_por: {
        tipo: 'texto',
        padrao: 'nenhum',
        dentre: AGRUPAMENTOS,
        sinonimos: SINONIMOS_AGRUPAMENTO,
      },
      metrica: { tipo: 'texto', padrao: 'contagem', dentre: METRICAS, sinonimos: SINONIMOS_METRICA },
      /**
       * QUAL ABA LER. Vazio = a aba viva, que é o universo padrão e continua
       * sendo declarado na resposta. Um ano fora da lista é recusado pelo
       * esquema antes de qualquer conta — e `recusaPorAno` continua barrando o
       * que a frase citar sem passar por aqui.
       */
      ano: { tipo: 'texto', padrao: '', dentre: ['', ...ANOS_LIDOS] },
    },
  },
  indisponivelPorque() {
    return planilhaOcisDisponivel() ? null : 'falta MS_GRAPH_TOKEN ou MS_GRAPH_OCI_URL no ambiente';
  },
  async executar(ctx) {
    /* "de 2026" some: a aba inteira já é 2026. Ver `tirarOAnoVivo`. */
    const frasePeriodo = tirarOAnoVivo(String(ctx.parametros.periodo ?? '').trim());
    const agruparPor = String(ctx.parametros.agrupar_por ?? 'nenhum') as AgruparPor;
    const metrica = String(ctx.parametros.metrica ?? 'contagem') as Metrica;

    /* Lê a frase CRUA, não o parâmetro: o caso perigoso é a LLM largar o ano
       pelo caminho e a pergunta chegar aqui sem período nenhum. */
    const foraDeAlcance = recusaPorAno(ctx.enunciado);
    if (foraDeAlcance) return foraDeAlcance;

    const periodo = frasePeriodo ? interpretarPeriodo(frasePeriodo) : null;
    if (frasePeriodo && !periodo) {
      return {
        texto:
          `Não entendi "${frasePeriodo}" como período, então não calculei nada. ` +
          'Entendo "hoje", "amanhã", "essa semana", "semana que vem" ou uma data como "17/08" — ou deixe ' +
          'vazio para considerar todas as cargas cadastradas.',
        detalhe: `expressão de período não interpretada: "${frasePeriodo.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    /**
     * QUAL ABA RESPONDE — e a frase crua vale mais que o parâmetro.
     *
     * O ano vem do `ano` quando a LLM o passou, e da FRASE quando ela o largou
     * pelo caminho. A precedência é essa porque o caso perigoso sempre foi o
     * segundo: "quantas cargas em 2025?" chegando sem nada, o universo do ano
     * vivo respondendo, e o número saindo rotulado como se fosse de 2025.
     *
     * Sem ano em lugar nenhum, o universo continua sendo a aba viva — e a
     * resposta continua DIZENDO isso. Mudar o padrão para "os três anos juntos"
     * trocaria o significado de toda resposta já verificada sem ninguém pedir.
     */
    const anoPedido =
      (String(ctx.parametros.ano ?? '').trim() as AnoLido | '') || anoCitado(ctx.enunciado) || ANO_VIVO;

    const r = await cargasDoAno(anoPedido);
    if (!r.ok) {
      return {
        texto: r.texto,
        detalhe: proveniencia({ fonte: 'planilha LUFT', aba: anoPedido, resultado: 'indisponivel', cache_usado: String(r.fonte?.cache ?? false) }),
        resolveu: false,
      };
    }

    const cargas = periodo
      ? r.cargas.filter((c) => c.data_coleta !== null && c.data_coleta >= periodo.inicio && c.data_coleta <= periodo.fim)
      : r.cargas;
    /* O RÓTULO NOMEIA O ANO. "todas as cargas cadastradas" fez a IARA responder
       "2681 cargas no total" quando 2681 é o total de 2026 e a planilha tem
       10.777 — o ano estava na procedência e não na fala. Ver `ANO_VIVO`. */
    const rotuloPeriodo = periodo
      ? `${periodo.rotulo}${anoPedido === ANO_VIVO ? '' : ` de ${anoPedido}`}`
      : `todas as cargas de ${anoPedido}`;

    /** Comum às duas saídas (agregada e detalhada) — a mesma proveniência, os mesmos campos. */
    const baseProveniencia = {
      /* A ABA QUE RESPONDEU, e não a constante. Carimbar '2026' numa resposta
         de 2025 seria o mesmo defeito de 18/08 com o sinal trocado. */
      fonte: anoPedido,
      universo: `cargasDoAno(${anoPedido})`,
      registros_lidos: r.cargas.length,
      registros_usados: cargas.length,
      cache: r.fonte?.cache ?? false,
      idade_s: r.fonte?.idade_s ?? 0,
      deterministico: true,
    };

    /**
     * MARGEM — a única métrica que CRUZA duas fontes, e por isso a única que
     * carrega cobertura na resposta.
     *
     * A receita vem da CARGA (`valor`, o que foi faturado) e o custo vem da
     * `TABELA` (`VALOR MOT`, o que se paga a quem dirige). O cruzamento é por
     * `origem → destino`, medido em 19/08/2026 antes de escrever isto:
     *
     *   trechos únicos 117 · chaves ambíguas 0 · fórmula confere 117/117
     *   cobertura por CARGA — 2026: 100%   2025: 94,4%   2024: 88,1%
     *
     * A COBERTURA SAI JUNTO COM O NÚMERO, sempre que não for total. "A margem da
     * operação é 32%" dita sobre 88% das cargas é uma afirmação sobre um
     * universo que quem lê acha que é outro — e é o tipo de erro que ninguém
     * confere, porque o número está certo para o que ele mediu.
     *
     * O PERCENTUAL É AGREGADO, e não a média das margens das rotas. `(Σreceita −
     * Σcusto) / Σreceita` pondera cada carga pelo que ela faturou; a média
     * simples trata uma rota de 1 carga igual a uma de 437. As duas contas são
     * verdadeiras e respondem perguntas diferentes — ver `margemMediaDasRotas`.
     */
    if (metrica === 'margem') {
      const t = await tabelaDeTrechos();
      if (!t.ok) {
        return {
          texto:
            `Não consigo calcular margem agora: ${t.texto} ` +
            'A margem depende do tabelário de trechos (a aba TABELA), que é de onde vem o custo. ' +
            'Sem ele eu teria só a receita, e receita sozinha não é margem.',
          detalhe: proveniencia({ ...baseProveniencia, operacao: 'MARGEM', resultado: 'tabelario_indisponivel' }),
          resolveu: false,
        };
      }

      const dizerCobertura = (c: { cargas: number; com_preco: number; sem_preco: number; ambiguas: number; sem_valor: number; percentual: number | null; rotas_sem_preco: readonly { rota: string; cargas: number }[] }): string => {
        if (c.sem_preco === 0 && c.ambiguas === 0 && c.sem_valor === 0) return '';
        const partes: string[] = [];
        if (c.sem_preco > 0) {
          const topo = c.rotas_sem_preco.slice(0, 3).map((r) => `${r.rota} (${r.cargas})`).join(', ');
          partes.push(
            `${c.sem_preco} carga${c.sem_preco === 1 ? '' : 's'} sem preço de trecho na tabela${topo ? `, as maiores em ${topo}` : ''}`,
          );
        }
        if (c.ambiguas > 0) partes.push(`${c.ambiguas} em trecho com dois preços diferentes, que eu não escolho por conta própria`);
        if (c.sem_valor > 0) partes.push(`${c.sem_valor} sem valor lançado`);
        /**
         * ARREDONDA PARA BAIXO, e não é preciosismo. 2687 de 2688 cargas dá
         * 99,96%, e `toFixed(1)` transforma isso em "100.0%" — a frase passaria
         * a dizer que cobre tudo logo antes de listar o que ficou de fora.
         * Cobertura é o número que autoriza confiar no resto da resposta; ele
         * nunca pode arredondar na direção otimista.
         */
        const cobre = Math.floor((c.percentual ?? 0) * 10) / 10;
        return `\n\nA conta cobre ${cobre.toFixed(1)}% das cargas do recorte: ${partes.join('; ')}.`;
      };

      if (agruparPor === 'nenhum') {
        const m = calcularMargem(cargas, t.tabela);
        if (m.percentual_bruto === null) {
          return {
            texto: `${rotuloPeriodo}: nenhuma carga com receita lançada e preço de trecho, então não há margem a calcular.${dizerCobertura(m.cobertura)}`,
            detalhe: proveniencia({ ...baseProveniencia, operacao: 'MARGEM', resultado: 'sem_base' }),
            resolveu: true,
          };
        }
        const media = margemMediaDasRotas(cargas, t.tabela);
        /**
         * O MESMO FATO, DUAS VEZES — e de propósito.
         *
         * `dizerCobertura` acima escreve a cobertura para o operador ler;
         * `evidencias` a entrega TIPADA para o kernel contestar. Parece
         * duplicação e não é: a frase é redação, e redação não pode ser
         * consultada por código. Enquanto a cobertura existia só como string,
         * o kernel não tinha como saber que ela era 88% e portanto não tinha
         * como recusar uma afirmação sobre a operação inteira, calcular
         * confiança ou se abster. Ver `MotorCritica`.
         *
         * A procedência é `fato` e não `fato_verificado`: a planilha é base
         * determinística da casa (`Verdade.ts`), mas ninguém conferiu este
         * número contra o mundo depois de calculá-lo.
         */
        /**
         * O RECORTE CARIMBA A ABA QUE RESPONDEU (`anoPedido`), NUNCA `ANO_VIVO`.
         *
         * A primeira versão desta linha usava a constante, e ela nasceu certa e
         * ficou errada no mesmo dia: a leitura por ano chegou depois, e desde
         * então uma consulta a 2024 saía com o recorte dizendo 2026. O estrago
         * não é cosmético — `Cobertura.saoComparaveis` decide se dois lados de
         * uma comparação batem OLHANDO O RECORTE, e dois anos diferentes com o
         * mesmo rótulo passariam como comparáveis. A ressalva de denominador
         * móvel ficaria cega exatamente no caso que ela existe para pegar
         * (2026 a 100% contra 2024 a 88%).
         *
         * Mesma lição da procedência logo acima, e a mesma do `fonte: '2026'`
         * que virou `fonte: anoPedido`: rótulo carimbado por constante mente no
         * dia em que a fonte deixa de ser única.
         */
        const recorteDaMargem = [
          {
            dimensao: 'periodo',
            valor: periodo ? `${periodo.inicio}..${periodo.fim}` : `ano ${anoPedido}`,
          },
        ];
        const coberturaDaMargem = deCoberturaDeJoin(m.cobertura, recorteDaMargem);
        const instanteDaMargem = new Date().toISOString();
        const evidenciaBase = {
          fonte: 'planilha_luft+tabela_trechos',
          procedencia: 'fato' as const,
          relevancia: 'direta' as const,
          instante: instanteDaMargem,
          cobertura: coberturaDaMargem,
        };
        return {
          evidencias: [
            { ...evidenciaBase, metrica: 'margem_bruta_pct', valor: m.percentual_bruto, unidade: '%' },
            { ...evidenciaBase, metrica: 'receita', valor: Math.round(m.receita), unidade: 'R$' },
            { ...evidenciaBase, metrica: 'custo', valor: Math.round(m.custo), unidade: 'R$' },
          ],
          texto:
            `${rotuloPeriodo}: margem bruta de ${formatarReal(m.resultado_bruto)}, ` +
            `que é ${m.percentual_bruto.toFixed(1)}% sobre ${formatarReal(m.receita)} faturados. ` +
            `Descontando o pedágio de ida, sobram ${formatarReal(m.resultado_com_pedagio)} ` +
            `(${(m.percentual_com_pedagio ?? 0).toFixed(1)}%).` +
            (media === null
              ? ''
              : `\n\nEssa é a margem do VOLUME, ponderada pelo que cada carga faturou. A margem da rota típica é outra conta e dá ${media.toFixed(1)}% — as duas estão certas e respondem coisas diferentes.`) +
            dizerCobertura(m.cobertura),
          detalhe: proveniencia({
            ...baseProveniencia,
            operacao: 'MARGEM',
            receita: Math.round(m.receita),
            custo: Math.round(m.custo),
            resultado: Math.round(m.resultado_bruto),
            percentual: m.percentual_bruto.toFixed(2),
            cobertura_pct: (m.cobertura.percentual ?? 0).toFixed(1),
          }),
          resolveu: true,
        };
      }

      const rotuloM = NOME_DA_DIMENSAO[agruparPor];
      const grupos = margemPorDimensao(cargas, t.tabela, agruparPor);
      if (grupos.length === 0) {
        return {
          texto: `${rotuloPeriodo}: nenhum ${rotuloM.um} com margem calculável.`,
          detalhe: proveniencia({ ...baseProveniencia, operacao: 'MARGEM', dimensao: agruparPor, grupos: 0 }),
          resolveu: true,
        };
      }
      const TOPO_MARGEM = 15;
      const linhasM = grupos
        .slice(0, TOPO_MARGEM)
        .map(
          (g, i) =>
            `${i + 1}. ${g.chave}: ${formatarReal(g.margem.resultado_bruto)} de margem` +
            (g.margem.percentual_bruto === null ? '' : ` (${g.margem.percentual_bruto.toFixed(1)}%)`) +
            `, sobre ${g.margem.cobertura.com_preco} carga${g.margem.cobertura.com_preco === 1 ? '' : 's'}`,
        );
      const geral = calcularMargem(cargas, t.tabela);
      const cortados = grupos.length - linhasM.length;
      return {
        texto:
          `${rotuloPeriodo}, margem por ${rotuloM.um} (do maior resultado para o menor):\n${linhasM.join('\n')}` +
          (cortados > 0 ? `\n\nA lista para no ${TOPO_MARGEM}º. Ficaram outros ${cortados} de fora.` : '') +
          `\n\nOrdenei pelo RESULTADO, não pelo percentual: ${rotuloM.um} com margem alta sobre pouco volume rende menos que ${rotuloM.um} com margem menor sobre muito. Se quiser a lista por percentual, é só pedir.` +
          dizerCobertura(geral.cobertura),
        detalhe: proveniencia({
          ...baseProveniencia,
          operacao: 'MARGEM',
          dimensao: agruparPor,
          grupos: grupos.length,
          cobertura_pct: (geral.cobertura.percentual ?? 0).toFixed(1),
        }),
        resolveu: true,
      };
    }

    if (agruparPor === 'nenhum') {
      /**
       * "QUANTOS DIFERENTES" SEM DIZER DE QUÊ não tem resposta — e antes tinha.
       *
       * Achado na mesma varredura que pegou a rota (19/08/2026): com
       * `metrica=distintos` e `agrupar_por=nenhum`, este ramo caía no `else` e
       * devolvia a CONTAGEM DE CARGAS. Quem perguntasse "quantos diferentes
       * temos?" receberia 2687 — o total de cargas apresentado como se fosse um
       * número de entidades distintas. A pergunta está incompleta; a resposta
       * certa é dizer isso, não escolher uma dimensão no lugar de quem perguntou.
       */
      if (metrica === 'distintos') {
        return {
          texto:
            'Para contar quantos DIFERENTES existem eu preciso saber de quê: motorista, rota, ' +
            'origem, destino ou status. Sem a dimensão não há o que contar como distinto — e o ' +
            'total de cargas seria outra resposta, para outra pergunta.',
          detalhe: proveniencia({
            ...baseProveniencia,
            operacao: 'COUNT_DISTINCT',
            resultado: 'dimensao_ausente',
          }),
          resolveu: false,
        };
      }
      const [tudo] = agregarCargas(cargas, 'nenhum');
      const contagem = cargas.length;
      const valorTotal = tudo?.valor_total ?? 0;
      /**
       * A CONTAGEM DIZ QUANTAS CARGAS, NÃO QUANTAS LINHAS — defeito DIST-001.
       *
       * A identidade de uma carga é a OCI, provada nos dados. Hoje não há
       * repetição na planilha real, então os dois números coincidem; no dia em
       * que alguém colar uma linha duas vezes, é a diferença que precisa
       * aparecer, e não o total inflado em silêncio.
       */
      const cargasContadas = contarCargas(cargas);
      const avisoRepetidas =
        cargasContadas.repetidas > 0
          ? ` (${cargasContadas.repetidas} linha${cargasContadas.repetidas === 1 ? '' : 's'} repetida${cargasContadas.repetidas === 1 ? '' : 's'}, não contada${cargasContadas.repetidas === 1 ? '' : 's'} duas vezes)`
          : '';
      const n = cargasContadas.unicas;
      const plural = n === 1 ? '' : 's';

      /**
       * A MÉDIA DIVIDE PELO QUE TEM VALOR — ver `valorMedio`. Carga sem valor
       * lançado não vale zero: ela ainda não tem valor, e contá-la no divisor
       * misturaria "vale pouco" com "não sabemos".
       */
      const media = tudo ? valorMedio(tudo) : null;
      const semValor = tudo ? tudo.contagem - tudo.com_valor : 0;
      const ressalvaMedia =
        semValor > 0
          ? `. ${semValor} carga${semValor === 1 ? ' ficou' : 's ficaram'} de fora por não ter valor lançado`
          : '';

      const texto =
        metrica === 'valor_total'
          ? `${rotuloPeriodo}: ${formatarReal(valorTotal)} (${n} carga${plural})${avisoRepetidas}.`
          : metrica === 'valor_medio'
            ? media === null
              ? `${rotuloPeriodo}: nenhuma das ${n} carga${plural} tem valor lançado, então não há média a calcular.`
              : `${rotuloPeriodo}: ${formatarReal(media)} por carga${ressalvaMedia}.`
            : `${rotuloPeriodo}: ${n} carga${plural}${avisoRepetidas}.`;
      return {
        texto,
        detalhe: proveniencia({ ...baseProveniencia, operacao: metrica.toUpperCase(), agrupamento: 'nenhum' }),
        resolveu: true,
      };
    }

    /**
     * QUANTOS X DIFERENTES — a métrica que faltava, e a falta custava caro.
     *
     * MEDIDO EM PRODUÇÃO (18/08/2026), depois de o motor já estar correto:
     * perguntada "quantos motoristas diferentes temos?", a IARA respondeu
     * *"15 na lista principal mais 60 outros grupos — o que dá 75"*. São 73.
     *
     * Ela somou o RODAPÉ de uma listagem truncada em 15 itens. Não havia nada
     * errado no motor: `contarDistintos` já devolvia 73. O que não existia era
     * uma capacidade DECLARADA para a pergunta, então a LLM improvisou
     * aritmética sobre texto — e aritmética sobre texto sempre vai parecer uma
     * resposta.
     *
     * A lição, que vale para o resto do catálogo: capacidade que existe no
     * motor e não existe no manifesto é capacidade que não existe. Motor certo
     * com roteamento improvisado entrega número errado com a mesma cara de
     * número certo.
     */
    /**
     * QUEM PAROU — a família que pergunta pelo que NÃO está nos dados.
     *
     * A PERGUNTA (operadora, 19/08/2026): *"quais centrais não tiveram cargas
     * nos últimos 30 dias?"*. Todas as outras métricas contam o que está lá;
     * esta procura o que sumiu. Uma central que parou de receber não aparece em
     * listagem nenhuma — ela some, e sumir em silêncio é justamente o que
     * precisa ser visto.
     *
     * EXIGE PERÍODO, e a exigência é a definição: sem janela não existe "parou".
     * Sobre o universo inteiro a resposta seria sempre vazia, e vazia parece
     * "está tudo bem" — o pior jeito de errar aqui.
     *
     * A FRONTEIRA VAI JUNTO COM A RESPOSTA. O universo é a aba do ano: uma
     * central que nunca apareceu em 2026 está fora do alcance desta conta.
     * Medido em 19/08/2026: o cadastro de centrais do Supabase tem 12 nomes, a
     * planilha tem 24 destinos, e só DOIS coincidem (RIO VERDE, SORRISO).
     * Cruzar as duas fontes produziria uma lista errada nas duas pontas —
     * nomeando central que a operação não usa e escondendo central que ela usa.
     * Então esta resposta fala pela planilha, e diz que fala.
     */
    if (metrica === 'sem_movimento') {
      if (!periodo) {
        return {
          texto:
            'Para eu dizer quem parou, preciso de um prazo. "Parou" só existe contra uma janela: ' +
            'me diga "nos últimos 30 dias", "essa semana" ou uma data, e eu comparo com o que a ' +
            'operação movimentou no ano.',
          detalhe: proveniencia({
            ...baseProveniencia,
            operacao: 'SEM_MOVIMENTO',
            resultado: 'periodo_ausente',
          }),
          resolveu: false,
        };
      }
      const rotuloDim = NOME_DA_DIMENSAO[agruparPor];
      const m = semMovimentoNaJanela(r.cargas, cargas, agruparPor);
      const alcance =
        `\n\nIsso vale para ${rotuloDim.varios} que a planilha de ${ANO_VIVO} conhece. ` +
        'Se alguma nunca apareceu no ano, ela não está nesta conta, porque não tenho de onde saber que existe.';

      if (m.parados.length === 0) {
        return {
          texto:
            `Nenhuma das ${m.conhecidos} ${rotuloDim.varios} ficou sem carga em ${periodo.rotulo}: ` +
            `${m.ativos} movimentaram no prazo.${alcance}`,
          detalhe: proveniencia({
            ...baseProveniencia,
            operacao: 'SEM_MOVIMENTO',
            dimensao: agruparPor,
            conhecidos: m.conhecidos,
            ativos: m.ativos,
            parados: 0,
          }),
          resolveu: true,
        };
      }

      const TOPO_PARADOS = 20;
      const linhasParadas = m.parados
        .slice(0, TOPO_PARADOS)
        .map(
          (x, i) =>
            `${i + 1}. ${x.chave}: ${x.cargas_no_universo} carga${x.cargas_no_universo === 1 ? '' : 's'} no ano, nenhuma no prazo`,
        );
      const cortadas = m.parados.length - linhasParadas.length;
      return {
        texto:
          `${periodo.rotulo}: ${m.parados.length} de ${m.conhecidos} ${rotuloDim.varios} ficaram sem carga. ` +
          `As que mais movimentavam vêm primeiro:\n${linhasParadas.join('\n')}` +
          (cortadas > 0 ? `\n\nA lista para no ${TOPO_PARADOS}º. Ficaram outras ${cortadas} de fora.` : '') +
          alcance,
        detalhe: proveniencia({
          ...baseProveniencia,
          operacao: 'SEM_MOVIMENTO',
          dimensao: agruparPor,
          conhecidos: m.conhecidos,
          ativos: m.ativos,
          parados: m.parados.length,
        }),
        resolveu: true,
      };
    }

    if (metrica === 'distintos') {
      /**
       * SEM CAST. O `as Parameters<typeof contarDistintos>[1]` que estava aqui
       * desligava a única checagem capaz de acusar `rota` — dimensão DERIVADA,
       * que `contarDistintos` não sabia calcular e que respondeu "0 rotas
       * diferentes" com procedência completa em produção (19/08/2026). Agora os
       * dois lados falam `DimensaoContavel`, e o compilador PROVA que `nenhum`
       * não chega aqui — o ramo sem agrupamento já retornou acima.
       */
      const d = contarDistintos(cargas, agruparPor);
      const rotulo = NOME_DA_DIMENSAO[agruparPor];
      const ressalva =
        d.ausentes > 0
          ? `. Fora dessa conta ${d.ausentes === 1 ? 'ficou 1 carga' : `ficaram ${d.ausentes} cargas`} sem ${rotulo.um} preenchido`
          : '';
      /**
       * A SUSPEITA SAI JUNTO COM O NÚMERO — regra da operadora, 19/08/2026.
       *
       * O detector ACUSA e não decide: grafias sem marca estrutural que podem
       * ser a mesma pessoa viram pergunta, nunca fusão. Dizer isto aqui, colado
       * à contagem, é o que dá à operadora a chance de confirmar — um detector
       * que só grava no log é um detector que ninguém lê.
       *
       * Só para `motorista`: é a dimensão onde a mesma entidade aparece com
       * grafias diferentes. Rota e destino vêm de célula padronizada.
       */
      const suspeitas = agruparPor === 'motorista' ? suspeitasDeIdentidade(cargas) : [];
      const aviso =
        suspeitas.length === 0
          ? ''
          : `\n\nPode haver repetição de pessoa nessa contagem. ${
              suspeitas.length === 1 ? 'Tem 1 caso' : `Tem ${suspeitas.length} casos`
            } a conferir:\n` +
            suspeitas
              .slice(0, 5)
              .map((s) => `· ${s.provavel} e ${s.variantes.join(', ')}, somando ${s.cargas} cargas`)
              .join('\n') +
            '\nSe forem a mesma pessoa, me diga e eu passo a contar como uma.';

      return {
        texto: `${rotuloPeriodo}: ${d.distintos} ${d.distintos === 1 ? rotulo.um : rotulo.varios} diferente${d.distintos === 1 ? '' : 's'}${ressalva}.${aviso}`,
        detalhe: proveniencia({
          ...baseProveniencia,
          operacao: 'COUNT_DISTINCT',
          dimensao: agruparPor,
          distintos: d.distintos,
          ausentes: d.ausentes,
        }),
        resolveu: true,
      };
    }

    const TOPO = 15;
    const grupos = [...agregarCargas(cargas, agruparPor)].sort((a, b) =>
      metrica === 'contagem' ? b.contagem - a.contagem : b.valor_total - a.valor_total,
    );
    if (grupos.length === 0) {
      return {
        texto: `${rotuloPeriodo}: nenhuma carga encontrada.`,
        detalhe: proveniencia({ ...baseProveniencia, operacao: 'GROUP_BY', agrupamento: agruparPor, grupos: 0 }),
        resolveu: true,
      };
    }
    const linhas = grupos.slice(0, TOPO).map((g, i) => {
      const valorMedio = g.contagem > 0 ? g.valor_total / g.contagem : 0;
      const cauda =
        metrica === 'valor_total'
          ? `${formatarReal(g.valor_total)} (${g.contagem} carga${g.contagem === 1 ? '' : 's'})`
          : metrica === 'valor_medio'
            ? `${formatarReal(valorMedio)} por carga (${g.contagem} carga${g.contagem === 1 ? '' : 's'})`
            : `${g.contagem} carga${g.contagem === 1 ? '' : 's'}`;
      return `${i + 1}. ${g.chave}: ${cauda}`;
    });
    /**
     * O RODAPÉ DIZ QUE A LISTA FOI CORTADA, e diz de um jeito que ninguém some.
     *
     * Este rodapé tem história: em 18/08/2026 ele dizia "e mais 60 grupo(s)", a
     * LLM somou 15 + 60 e a IARA respondeu "75 motoristas". Aritmética sobre
     * texto truncado, e o resultado tinha toda a cara de um número apurado.
     *
     * O "grupo(s)" com o plural entre parênteses era o pior dos dois mundos:
     * soava a formulário e ainda convidava à soma. Agora a frase diz que a lista
     * está cortada e manda perguntar — quem quiser o número exato tem a métrica
     * `distintos`, que conta de verdade.
     */
    const cortados = grupos.length - TOPO;
    const resto =
      cortados > 0
        ? `\n\nA lista para no ${TOPO}º. ${
            cortados === 1 ? 'Ficou mais 1 de fora' : `Ficaram outros ${cortados} de fora`
          }, e somar este rodapé não dá o total certo. Se quiser a contagem exata, é só me pedir quantos existem.`
        : '';

    return {
      texto: `${rotuloPeriodo}, por ${NOME_DA_DIMENSAO[agruparPor].um}:\n${linhas.join('\n')}${resto}`,
      detalhe: proveniencia({ ...baseProveniencia, operacao: 'GROUP_BY', agrupamento: agruparPor, grupos: grupos.length }),
      resolveu: true,
    };
  },
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'a planilha da operação LUFT respondeu à consulta' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

/**
 * DECLARAR A LACUNA — a resposta certa para a pergunta que a fonte não pode
 * responder.
 *
 * O DEFEITO DE CLASSE (auditoria de 19/08/2026): "quantas cargas por cliente?"
 * é uma pergunta bem-formada sobre uma coluna que NÃO EXISTE em
 * `CargaCompleta`. Sem esta habilidade ela chega à LLM, que tem duas saídas —
 * admitir a lacuna, ou associar destino/rota a "cliente" e responder com cara
 * de certeza. A segunda é gratuita para ela e cara para a operação, e nenhuma
 * trava a jusante a pega: o número seria uma agregação real, só que da coluna
 * errada.
 *
 * É habilidade e não caso especial no orquestrador pelo mesmo motivo de
 * `recusar_por_sigilo`: assim a recusa entra na trilha de eventos como qualquer
 * outra ação e fica auditável junto com o resto.
 *
 * O PARÂMETRO É UM ENUM FECHADO, e é isso que impede a habilidade de virar uma
 * porta de invenção. Ela recebe só o NOME da dimensão ausente; o texto do
 * motivo mora em `LACUNAS_DE_COLUNA` e não atravessa o plano. Uma habilidade
 * que aceitasse o motivo como texto livre deixaria a LLM redigir a própria
 * justificativa — exatamente o tipo de afirmação sem lastro que esta auditoria
 * existe para fechar.
 */
export const declararLacunaDeDado: Habilidade = {
  manifesto: {
    id: 'declarar_lacuna_de_dado',
    nome: 'Dimensão ausente na planilha da operação',
    descricao:
      'Declara, com o motivo, que a planilha da operação LUFT não tem a coluna que a pergunta pede. ' +
      'Use quando o operador pedir agregação por CLIENTE ou por VEÍCULO/PLACA: esses campos não existem ' +
      'na fonte, e qualquer número apresentado como se existissem viria da coluna errada. ' +
      '"dimensao" é um de: ' +
      DIMENSOES_SEM_COLUNA.join(', ') +
      '.',
    exemplos: [
      'Quantas cargas por cliente?',
      'Qual cliente teve mais cargas?',
      'Quantas cargas por veículo?',
      'Faturamento por placa',
    ],
    capacidades: ['declarar dimensão ausente na planilha da operação'],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 500,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      dimensao: { tipo: 'texto', obrigatorio: true, dentre: DIMENSOES_SEM_COLUNA },
    },
  },
  async executar(ctx) {
    const dimensao = String(ctx.parametros.dimensao ?? '') as keyof typeof LACUNAS_DE_COLUNA;
    const motivo = LACUNAS_DE_COLUNA[dimensao];
    return {
      texto: `${motivo[0].toUpperCase()}${motivo.slice(1)}. ${SAIDA_DA_LACUNA[dimensao]}`,
      detalhe: proveniencia({
        fonte: 'planilha LUFT',
        resultado: 'dado_indisponivel',
        dimensao_pedida: dimensao,
        deterministico: true,
      }),
      /**
       * `resolveu: true` — e a escolha é substantiva. O turno RESOLVEU: a
       * pergunta foi respondida com a verdade disponível. `false` marcaria
       * falha operacional e convidaria a escalada a gastar um modelo melhor
       * para "tentar de novo" — e um modelo melhor não faz nascer uma coluna.
       */
      resolveu: true,
    };
  },
  async verificar(resultado) {
    return {
      confirmado: resultado.resolveu,
      evidencia: 'a ausência da coluna é lida do esquema da planilha, não da conversa',
    };
  },
};

// ---------------------------------------------------------------------------
// Fase 3 — comparação entre semanas e relatório executivo. Só o que compõe
// dado já calculado por `todasAsCargas`/`agregarCargas`; nada aqui inventa
// limiar de atraso ou anomalia (ver cabeçalho do arquivo — isso pede regra de
// negócio ainda não definida e fica fora de propósito).
// ---------------------------------------------------------------------------

function formatarDelta(atual: number, anterior: number): string {
  if (anterior === 0) return atual === 0 ? 'sem variação (as duas semanas em zero)' : 'sem base de comparação (semana anterior em zero)';
  const pct = ((atual - anterior) / anterior) * 100;
  const sinal = pct >= 0 ? '+' : '';
  return `${sinal}${pct.toFixed(1)}%`;
}

export const compararSemanasLuft: Habilidade = {
  manifesto: {
    id: 'comparar_semanas_luft',
    nome: 'Comparação entre semanas — operação LUFT',
    descricao:
      'Compara contagem e valor total de cargas entre duas semanas da operação LUFT. Os parâmetros ' +
      '"periodo_atual" e "periodo_anterior" recebem a EXPRESSÃO como foi dita ("essa semana", "semana ' +
      'passada", "17/08") — não calcule a data. Use para "como essa semana está em relação à passada", ' +
      '"comparar com a semana anterior", "crescemos ou caímos essa semana".',
    exemplos: [
      'Como essa semana está em relação à passada?',
      'Comparar essa semana com a semana anterior',
      'Crescemos ou caímos em relação à semana passada?',
      'Faturamento dessa semana comparado com a semana anterior',
    ],
    capacidades: ['comparar contagem entre semanas', 'comparar faturamento entre semanas'],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    timeout_ms: 75000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      periodo_atual: { tipo: 'texto', padrao: 'essa semana' },
      periodo_anterior: { tipo: 'texto', padrao: 'semana passada' },
    },
  },
  indisponivelPorque() {
    return planilhaOcisDisponivel() ? null : 'falta MS_GRAPH_TOKEN ou MS_GRAPH_OCI_URL no ambiente';
  },
  async executar(ctx) {
    const foraDeAlcance = recusaPorAno(ctx.enunciado);
    if (foraDeAlcance) return foraDeAlcance;

    const fraseAtual = String(ctx.parametros.periodo_atual ?? 'essa semana');
    const fraseAnterior = String(ctx.parametros.periodo_anterior ?? 'semana passada');
    const periodoAtual = interpretarPeriodo(fraseAtual);
    const periodoAnterior = interpretarPeriodo(fraseAnterior);

    if (!periodoAtual || !periodoAnterior) {
      const qual = !periodoAtual ? fraseAtual : fraseAnterior;
      return {
        texto:
          `Não entendi "${qual}" como período, então não comparei nada. ` +
          'Entendo "essa semana", "semana passada", "semana que vem" ou uma data como "17/08".',
        detalhe: `expressão de período não interpretada: "${qual.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    const r = await todasAsCargas();
    if (!r.ok) {
      return {
        texto: r.texto,
        detalhe: proveniencia({ fonte: 'planilha LUFT', resultado: 'indisponivel', cache_usado: String(r.fonte?.cache ?? false) }),
        resolveu: false,
      };
    }

    const naFaixa = (inicio: string, fim: string) =>
      r.cargas.filter((c) => c.data_coleta !== null && c.data_coleta >= inicio && c.data_coleta <= fim);

    const cargasAtual = naFaixa(periodoAtual.inicio, periodoAtual.fim);
    const cargasAnterior = naFaixa(periodoAnterior.inicio, periodoAnterior.fim);

    const contagemAtual = cargasAtual.length;
    const contagemAnterior = cargasAnterior.length;
    const valorAtual = cargasAtual.reduce((soma, c) => soma + (c.valor ?? 0), 0);
    const valorAnterior = cargasAnterior.reduce((soma, c) => soma + (c.valor ?? 0), 0);

    const texto =
      `${periodoAtual.rotulo}: ${contagemAtual} carga${contagemAtual === 1 ? '' : 's'}, ${formatarReal(valorAtual)}.\n` +
      `${periodoAnterior.rotulo}: ${contagemAnterior} carga${contagemAnterior === 1 ? '' : 's'}, ${formatarReal(valorAnterior)}.\n` +
      `Variação em contagem: ${formatarDelta(contagemAtual, contagemAnterior)}. ` +
      `Variação em valor: ${formatarDelta(valorAtual, valorAnterior)}.`;

    return {
      texto,
      detalhe: proveniencia({
        fonte: 'planilha LUFT',
        periodo_atual: `${periodoAtual.inicio}..${periodoAtual.fim}`,
        periodo_anterior: `${periodoAnterior.inicio}..${periodoAnterior.fim}`,
        contagem_atual: contagemAtual,
        contagem_anterior: contagemAnterior,
      }),
      resolveu: true,
    };
  },
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'a planilha da operação LUFT respondeu às duas consultas de período' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

export const relatorioExecutivoLuft: Habilidade = {
  manifesto: {
    id: 'relatorio_executivo_luft',
    nome: 'Relatório executivo — operação LUFT',
    descricao:
      'Consolida num único relatório: total de cargas cadastradas, contagem e faturamento do período ' +
      'pedido, os motoristas com mais cargas no período e a distribuição por status. "periodo" recebe a ' +
      'EXPRESSÃO como foi dita ("essa semana", "hoje") e é opcional (vazio = essa semana). Use para ' +
      '"me dá um relatório da operação", "resumo executivo da semana", "como está a operação hoje".',
    exemplos: [
      'Me dá um relatório da operação essa semana',
      'Resumo executivo da LUFT',
      'Como está a operação hoje?',
      'Relatório da semana passada',
    ],
    capacidades: ['relatório executivo', 'resumo de operação por período'],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    timeout_ms: 75000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      periodo: { tipo: 'texto', padrao: 'essa semana' },
    },
  },
  indisponivelPorque() {
    return planilhaOcisDisponivel() ? null : 'falta MS_GRAPH_TOKEN ou MS_GRAPH_OCI_URL no ambiente';
  },
  async executar(ctx) {
    const foraDeAlcance = recusaPorAno(ctx.enunciado);
    if (foraDeAlcance) return foraDeAlcance;

    const frase = String(ctx.parametros.periodo ?? 'essa semana');
    const periodo = interpretarPeriodo(frase);
    if (!periodo) {
      return {
        texto:
          `Não entendi "${frase}" como período, então não montei o relatório. ` +
          'Entendo "essa semana", "hoje", "semana passada" ou uma data como "17/08".',
        detalhe: `expressão de período não interpretada: "${frase.slice(0, 60)}"`,
        resolveu: false,
      };
    }

    const r = await todasAsCargas();
    if (!r.ok) {
      return {
        texto: r.texto,
        detalhe: proveniencia({ fonte: 'planilha LUFT', resultado: 'indisponivel', cache_usado: String(r.fonte?.cache ?? false) }),
        resolveu: false,
      };
    }

    const cargasPeriodo = r.cargas.filter(
      (c) => c.data_coleta !== null && c.data_coleta >= periodo.inicio && c.data_coleta <= periodo.fim,
    );
    const contagem = cargasPeriodo.length;
    const valorTotal = cargasPeriodo.reduce((soma, c) => soma + (c.valor ?? 0), 0);

    const TOPO_MOTORISTAS = 3;
    const porMotorista = [...agregarCargas(cargasPeriodo, 'motorista')].sort((a, b) => b.contagem - a.contagem);
    const linhasMotoristas =
      porMotorista.length > 0
        ? porMotorista.slice(0, TOPO_MOTORISTAS).map((g, i) => `  ${i + 1}. ${g.chave}: ${g.contagem} carga${g.contagem === 1 ? '' : 's'}`)
        : ['  (nenhuma carga no período)'];

    const porStatus = [...agregarCargas(cargasPeriodo, 'status_normalizado')].sort((a, b) => b.contagem - a.contagem);
    const linhasStatus =
      porStatus.length > 0
        ? porStatus.map((g) => `  ${g.chave}: ${g.contagem}`)
        : ['  (nenhuma carga no período)'];

    const texto =
      `Relatório executivo, ${periodo.rotulo}\n\n` +
      `Total cadastrado (todas as datas): ${r.cargas.length} carga${r.cargas.length === 1 ? '' : 's'}.\n` +
      `No período: ${contagem} carga${contagem === 1 ? '' : 's'}, ${formatarReal(valorTotal)}.\n\n` +
      `Top motoristas no período:\n${linhasMotoristas.join('\n')}\n\n` +
      `Por status:\n${linhasStatus.join('\n')}`;

    return {
      texto,
      detalhe: proveniencia({
        fonte: 'planilha LUFT',
        periodo: `${periodo.inicio}..${periodo.fim}`,
        registros_totais: r.cargas.length,
        registros_periodo: contagem,
        cache: r.fonte?.cache ?? false,
      }),
      resolveu: true,
    };
  },
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'a planilha da operação LUFT respondeu com dado para compor o relatório' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

/**
 * COMPARAR DOIS ANOS — a capacidade que a leitura das abas antigas destravou.
 *
 * Enquanto só 2026 era lida, "compare 2025 com 2026" não era uma capacidade
 * faltando: era uma fonte que não existia. Agora existe, e a conta tem três
 * armadilhas que a operadora nomeou junto com o pedido — todas tratadas em
 * `ComparacaoDePeriodos`, não aqui:
 *
 *   base zero          → variação percentual é `null`, nunca infinito
 *   ponto percentual   → margem que vai de 30% a 33% subiu 3 PONTOS, não 3%
 *   contribuição >100% → é verdade quando há movimento em direções opostas,
 *                        e a frase precisa dizer que há
 *
 * POR QUE HABILIDADE PRÓPRIA e não um parâmetro da de estatísticas: aquela lê
 * UM recorte. Esta lê dois e os confronta — o resultado não é uma linha a mais
 * na mesma tabela, é outra forma de resposta. Enfiar as duas na mesma
 * habilidade faria `periodo` significar coisas diferentes conforme o parâmetro
 * vizinho, que é como um esquema começa a mentir.
 */
export const compararAnosLuft: Habilidade = {
  manifesto: {
    id: 'comparar_anos_luft',
    nome: 'Comparação entre anos — operação LUFT',
    descricao:
      'Compara DOIS ANOS da operação LUFT: volume de cargas, faturamento, motoristas distintos ou ' +
      'margem. "ano_atual" e "ano_anterior" são um de: ' +
      ANOS_LIDOS.join(', ') +
      '. "metrica" é um de: contagem, valor_total, distintos, margem. "agrupar_por" é opcional e, ' +
      'quando informado (motorista, rota, origem/posto, destino/central), DECOMPÕE a diferença ' +
      'mostrando quem explica o movimento. Use para "compare 2025 com 2026", "qual ano teve mais ' +
      'cargas", "a margem melhorou", "qual central caiu mais", "quanto crescemos".',
    exemplos: [
      'Compare 2025 com 2026',
      'A margem melhorou de 2025 para 2026?',
      'Qual ano teve mais cargas?',
      'Qual central mais caiu de 2025 para 2026?',
      'Quanto o faturamento cresceu em relação ao ano passado?',
    ],
    capacidades: [
      'comparar volume, faturamento e margem entre anos',
      'decompor a diferença por posto, central, rota ou motorista',
    ],
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    timeout_ms: 75000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      ano_atual: { tipo: 'texto', padrao: ANO_VIVO, dentre: ANOS_LIDOS },
      ano_anterior: { tipo: 'texto', obrigatorio: true, dentre: ANOS_LIDOS },
      metrica: {
        tipo: 'texto',
        padrao: 'contagem',
        dentre: ['contagem', 'valor_total', 'distintos', 'margem'],
        sinonimos: {
          cargas: 'contagem',
          volume: 'contagem',
          faturamento: 'valor_total',
          receita: 'valor_total',
          valor: 'valor_total',
          motoristas: 'distintos',
          lucro: 'margem',
          rentabilidade: 'margem',
        },
      },
      agrupar_por: { tipo: 'texto', padrao: 'nenhum', dentre: AGRUPAMENTOS, sinonimos: SINONIMOS_AGRUPAMENTO },
    },
  },
  indisponivelPorque() {
    return planilhaOcisDisponivel() ? null : 'falta MS_GRAPH_TOKEN ou MS_GRAPH_OCI_URL no ambiente';
  },
  async executar(ctx) {
    const foraDeAlcance = recusaPorAno(ctx.enunciado);
    if (foraDeAlcance) return foraDeAlcance;

    const anoAtual = String(ctx.parametros.ano_atual ?? ANO_VIVO) as AnoLido;
    const anoAnterior = String(ctx.parametros.ano_anterior ?? '') as AnoLido;
    const metrica = String(ctx.parametros.metrica ?? 'contagem');
    const agruparPor = String(ctx.parametros.agrupar_por ?? 'nenhum') as AgruparPor;

    if (anoAtual === anoAnterior) {
      return {
        texto: `Os dois anos são o mesmo (${anoAtual}) — não há o que comparar. Me diga os dois anos que você quer confrontar.`,
        detalhe: proveniencia({ fonte: 'planilha LUFT', operacao: 'COMPARACAO', resultado: 'anos_iguais' }),
        resolveu: false,
      };
    }

    const [a, b] = await Promise.all([cargasDoAno(anoAnterior), cargasDoAno(anoAtual)]);
    if (!a.ok || !b.ok) {
      return {
        texto: !a.ok ? a.texto : b.texto,
        detalhe: proveniencia({ fonte: 'planilha LUFT', operacao: 'COMPARACAO', resultado: 'indisponivel' }),
        resolveu: false,
      };
    }

    const base = {
      fonte: `${anoAnterior}->${anoAtual}`,
      operacao: 'COMPARACAO',
      metrica,
      registros_anterior: a.cargas.length,
      registros_atual: b.cargas.length,
      deterministico: true,
    };

    /* ---- MARGEM: percentual, então a variação é em PONTOS ---- */
    if (metrica === 'margem') {
      const t = await tabelaDeTrechos();
      if (!t.ok) {
        return {
          texto: `Não consigo comparar margem agora: ${t.texto}`,
          detalhe: proveniencia({ ...base, resultado: 'tabelario_indisponivel' }),
          resolveu: false,
        };
      }
      const mA = calcularMargem(a.cargas, t.tabela);
      const mB = calcularMargem(b.cargas, t.tabela);
      const pct = compararPercentual(mA.percentual_bruto, mB.percentual_bruto);
      const resultado = comparar(mA.resultado_bruto, mB.resultado_bruto);
      const cobertura =
        `\n\nA conta cobre ${(Math.floor((mA.cobertura.percentual ?? 0) * 10) / 10).toFixed(1)}% das cargas de ${anoAnterior} ` +
        `e ${(Math.floor((mB.cobertura.percentual ?? 0) * 10) / 10).toFixed(1)}% das de ${anoAtual}. ` +
        'Onde a cobertura difere, parte da diferença pode ser de rota sem preço na tabela, não de operação.';
      return {
        texto:
          `Margem de ${anoAnterior} para ${anoAtual}: ${dizerVariacaoPercentual(pct)}.\n\n` +
          `Em dinheiro, o resultado bruto ${dizerVariacao(resultado)}: ${formatarReal(mA.resultado_bruto)} em ${anoAnterior} ` +
          `contra ${formatarReal(mB.resultado_bruto)} em ${anoAtual}.` +
          cobertura,
        detalhe: proveniencia({
          ...base,
          pct_anterior: (mA.percentual_bruto ?? 0).toFixed(2),
          pct_atual: (mB.percentual_bruto ?? 0).toFixed(2),
          delta_pp: (pct.delta_pp ?? 0).toFixed(2),
        }),
        resolveu: true,
      };
    }

    /* ---- As métricas de VOLUME ---- */
    const medir = (cargas: readonly CargaCompleta[]): number => {
      if (metrica === 'valor_total') return cargas.reduce((s, c) => s + (c.valor ?? 0), 0);
      if (metrica === 'distintos') return contarDistintos(cargas, agruparPor === 'nenhum' ? 'motorista' : agruparPor).distintos;
      return contarCargas(cargas).unicas;
    };
    const comoTexto = (v: number): string => (metrica === 'valor_total' ? formatarReal(v) : String(v));
    const nomeDaMetrica =
      metrica === 'valor_total'
        ? 'faturamento'
        : metrica === 'distintos'
          ? `${NOME_DA_DIMENSAO[agruparPor === 'nenhum' ? 'motorista' : agruparPor].varios} diferentes`
          : 'cargas';

    const c = comparar(medir(a.cargas), medir(b.cargas));

    if (agruparPor === 'nenhum' || metrica === 'distintos') {
      return {
        texto:
          `${nomeDaMetrica[0].toUpperCase()}${nomeDaMetrica.slice(1)}: ${comoTexto(c.anterior)} em ${anoAnterior} ` +
          `contra ${comoTexto(c.atual)} em ${anoAtual} — ${dizerVariacao(c)}` +
          (c.sem_base ? '.' : ` (diferença de ${comoTexto(Math.abs(c.delta))}).`),
        detalhe: proveniencia({ ...base, anterior: c.anterior, atual: c.atual, delta: c.delta }),
        resolveu: true,
      };
    }

    /* ---- DECOMPOSIÇÃO: quem explica o movimento ---- */
    const porGrupo = (cargas: readonly CargaCompleta[]): Map<string, number> => {
      const m = new Map<string, number>();
      for (const carga of cargas) {
        const v = valorDaDimensao(carga, agruparPor);
        if (v === null) continue;
        const soma = metrica === 'valor_total' ? (carga.valor ?? 0) : 1;
        m.set(v, (m.get(v) ?? 0) + soma);
      }
      return m;
    };
    const d = decompor(porGrupo(a.cargas), porGrupo(b.cargas));
    const rotulo = NOME_DA_DIMENSAO[agruparPor];
    const TOPO_COMP = 10;
    const linhas = d.grupos
      .slice(0, TOPO_COMP)
      .filter((g) => g.delta !== 0)
      .map((g, i) => {
        const seta = g.delta > 0 ? '+' : '';
        const parte =
          g.contribuicao_pct === null
            ? ''
            : ` — ${g.contribuicao_pct.toFixed(0)}% do movimento total`;
        return `${i + 1}. ${g.chave}: ${comoTexto(g.anterior)} → ${comoTexto(g.atual)} (${seta}${comoTexto(g.delta)})${parte}`;
      });

    const ressalvas: string[] = [];
    if (d.tem_direcao_oposta) {
      ressalvas.push(
        `Há ${rotulo.varios} andando na direção contrária à do total, então as porcentagens de contribuição podem passar de 100% — isso é o movimento se cancelando, não erro de conta.`,
      );
    }
    if (d.so_no_anterior.length > 0) {
      ressalvas.push(`${d.so_no_anterior.length} ${rotulo.varios} apareciam em ${anoAnterior} e sumiram em ${anoAtual}.`);
    }
    if (d.so_no_atual.length > 0) {
      ressalvas.push(`${d.so_no_atual.length} ${rotulo.varios} só aparecem em ${anoAtual}.`);
    }

    return {
      texto:
        `${nomeDaMetrica[0].toUpperCase()}${nomeDaMetrica.slice(1)} de ${anoAnterior} para ${anoAtual}: ` +
        `${comoTexto(c.anterior)} → ${comoTexto(c.atual)}, ${dizerVariacao(c)}.\n\n` +
        `Quem mais mexeu o ponteiro, por ${rotulo.um}:\n${linhas.join('\n')}` +
        (ressalvas.length > 0 ? `\n\n${ressalvas.join(' ')}` : ''),
      detalhe: proveniencia({
        ...base,
        dimensao: agruparPor,
        anterior: c.anterior,
        atual: c.atual,
        delta: c.delta,
        grupos: d.grupos.length,
        direcao_oposta: d.tem_direcao_oposta,
      }),
      resolveu: true,
    };
  },
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'as duas abas da planilha responderam e a diferença foi calculada' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

export const HABILIDADES_PLANILHA_OCIS: readonly Habilidade[] = [
  consultarCargasLuft,
  consultarEstatisticasCargasLuft,
  compararSemanasLuft,
  relatorioExecutivoLuft,
  declararLacunaDeDado,
  compararAnosLuft,
];
