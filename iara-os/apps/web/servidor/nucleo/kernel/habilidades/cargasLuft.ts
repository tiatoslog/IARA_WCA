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
  agregarCargas,
  anoForaDoAlcance,
  cargasNoPeriodo,
  contarCargas,
  contarDistintos,
  suspeitasDeIdentidade,
  planilhaOcisDisponivel,
  todasAsCargas,
  valorMedio,
  type AgruparPor,
} from '../../ClientePlanilhaOcis';
import { interpretarPeriodo } from '../PeriodoOperacional';
import { DIMENSOES_SEM_COLUNA, LACUNAS_DE_COLUNA } from '../ContratoFactual';

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
  origem: { um: 'origem', varios: 'origens' },
  destino: { um: 'destino', varios: 'destinos' },
  status: { um: 'status', varios: 'status' },
  status_normalizado: { um: 'status', varios: 'status' },
  nenhum: { um: 'registro', varios: 'registros' },
};

const METRICAS = ['contagem', 'valor_total', 'valor_medio', 'distintos'] as const;
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
      'status_normalizado (agrupa FINALIZADO/finalizado/FINALIZADA juntos), nenhum. "metrica" é um de: ' +
      'contagem, valor_total, valor_medio, distintos. Use para "qual motorista fez mais cargas", ' +
      '"faturamento por rota", "quantas cargas por status", "valor total das cargas desta semana". ' +
      'Para "QUANTOS motoristas/rotas/destinos DIFERENTES existem", use metrica=distintos com o ' +
      'agrupar_por da dimensão — ela devolve a contagem única já descontando as cargas sem o campo ' +
      'preenchido. NUNCA some os grupos de uma listagem para chegar a esse número: a listagem é ' +
      'truncada e o rodapé "e mais N" não é somável.',
    exemplos: [
      'Qual motorista tem mais cargas?',
      'Quantos motoristas diferentes temos?',
      'Quantas rotas distintas existem?',
      'Motoristas disponíveis agora?',
      'Qual rota teve maior faturamento?',
      'Qual o total faturado essa semana?',
      'Quantas cargas estão finalizadas?',
    ],
    capacidades: [
      'ranking de motoristas',
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

    const r = await todasAsCargas();
    if (!r.ok) {
      return {
        texto: r.texto,
        detalhe: proveniencia({ fonte: 'planilha LUFT', resultado: 'indisponivel', cache_usado: String(r.fonte?.cache ?? false) }),
        resolveu: false,
      };
    }

    const cargas = periodo
      ? r.cargas.filter((c) => c.data_coleta !== null && c.data_coleta >= periodo.inicio && c.data_coleta <= periodo.fim)
      : r.cargas;
    /* O RÓTULO NOMEIA O ANO. "todas as cargas cadastradas" fez a IARA responder
       "2681 cargas no total" quando 2681 é o total de 2026 e a planilha tem
       10.777 — o ano estava na procedência e não na fala. Ver `ANO_VIVO`. */
    const rotuloPeriodo = periodo ? periodo.rotulo : `todas as cargas de ${ANO_VIVO}`;

    /** Comum às duas saídas (agregada e detalhada) — a mesma proveniência, os mesmos campos. */
    const baseProveniencia = {
      fonte: '2026',
      universo: 'todasAsCargas',
      registros_lidos: r.cargas.length,
      registros_usados: cargas.length,
      cache: r.fonte?.cache ?? false,
      idade_s: r.fonte?.idade_s ?? 0,
      deterministico: true,
    };

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
      texto:
        `Não tenho esse dado. ${motivo[0].toUpperCase()}${motivo.slice(1)}. ` +
        'Eu poderia agrupar por origem, destino, rota, motorista ou status. Se algum desses servir, é só dizer. ' +
        'Para agrupar por essa dimensão de verdade, a coluna precisa passar a existir na planilha.',
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

export const HABILIDADES_PLANILHA_OCIS: readonly Habilidade[] = [
  consultarCargasLuft,
  consultarEstatisticasCargasLuft,
  compararSemanasLuft,
  relatorioExecutivoLuft,
  declararLacunaDeDado,
];
