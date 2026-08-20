/**
 * BIBLIOTECA DE CENÁRIOS ANALÍTICOS — o conjunto de HOLDOUT.
 *
 * REGRA DE INDEPENDÊNCIA, e ela é a razão de este arquivo existir separado:
 * quem escreve o caso que define o comportamento não pode ser a autoridade que
 * aprova o comportamento. `testes/critica-analitica.test.ts` é o conjunto de
 * DESENVOLVIMENTO — nasceu junto com a implementação, conhece os nomes internos
 * das funções e foi ajustado enquanto o código mudava. Estes cenários são
 * outra coisa:
 *
 *   1. estão escritos em termos de OPERAÇÃO ("a planilha de 2024 não tem preço
 *      para 39 rotas"), não em termos de função ("R2 deve disparar");
 *   2. atacam `montarDossie`, a entrada de cima, e nunca uma função interna —
 *      se eu reorganizar o motor amanhã, o holdout continua valendo;
 *   3. a expectativa é a EXIGÊNCIA DA MISSÃO, não o que o código faz hoje.
 *
 * Esta casa já pagou caro pelo contrário duas vezes: o dublê que não podia
 * reprovar nada ("0 contornos" por construção) e o portão que procurava o texto
 * do pedido dentro da resposta da IARA — que passa sozinho, porque ela
 * reescreve. Por isso nenhum caso aqui casa substring de redação: o portão é
 * sempre CONTAGEM ou ESTADO (`veredicto`, `degrau`, código de ressalva).
 *
 * A MATRIZ DE COBERTURA está nos campos `dominio`, `complexidade`, `evidencia`,
 * `raciocinio` e `risco`. O objetivo não é um número grande de casos: é mostrar
 * que a matriz foi percorrida, e onde ela tem buraco.
 */

import { medirCobertura, type Recorte } from '../../servidor/nucleo/kernel/Cobertura';
import type { Evidencia } from '../../servidor/nucleo/kernel/Investigacao';
import type { CodigoRessalva, DegrauSustentado } from '../../servidor/nucleo/kernel/MotorCritica';
import type { VeredictoAnalitico } from '../../servidor/nucleo/kernel/Suficiencia';

export type Dominio =
  | 'operacional'
  | 'financeiro'
  | 'dados'
  | 'qualidade'
  | 'processos'
  | 'pessoas'
  | 'clientes'
  | 'risco'
  | 'gestao'
  | 'estrategia'
  | 'executivo';

export type Complexidade = 'simples' | 'media' | 'alta' | 'multidimensional';

export type QualidadeDaEvidencia =
  | 'completa'
  | 'parcial'
  | 'contraditoria'
  | 'desatualizada'
  | 'ausente';

export type TipoDeRaciocinio =
  | 'comparacao'
  | 'agregacao'
  | 'tendencia'
  | 'anomalia'
  | 'concentracao'
  | 'causalidade'
  | 'previsao'
  | 'cenario'
  | 'tradeoff'
  | 'priorizacao'
  | 'decisao';

export type Risco = 'baixo' | 'medio' | 'alto' | 'critico';

export interface CenarioAnalitico {
  readonly id: string;
  /** Em termos de operação, para quem for ler o relatório. */
  readonly situacao: string;
  readonly pergunta: string;
  readonly evidencias: readonly Evidencia[];
  readonly ferramentas: readonly string[];

  readonly dominio: Dominio;
  readonly complexidade: Complexidade;
  readonly evidencia: QualidadeDaEvidencia;
  readonly raciocinio: TipoDeRaciocinio;
  readonly risco: Risco;

  /** O que a missão EXIGE. Nunca o que o código faz. */
  readonly esperado: {
    readonly veredicto?: VeredictoAnalitico;
    /** O degrau não pode passar disto. */
    readonly degrau_maximo?: DegrauSustentado;
    /** Estes códigos TÊM de aparecer. */
    readonly ressalvas_exigidas?: readonly CodigoRessalva[];
    /** Estes códigos NÃO podem aparecer (falso positivo). */
    readonly ressalvas_proibidas?: readonly CodigoRessalva[];
    /** A confiança não pode ser maior que isto. */
    readonly confianca_maxima?: 'alta' | 'media' | 'baixa';
    /**
     * A confiança não pode ser MENOR que isto.
     *
     * O par simétrico de `confianca_maxima`, e ele faltava. Sem um piso, uma
     * camada que respondesse `baixa` a tudo passaria em todos os casos —
     * medir só o teto premia o alarmismo, que é o modo de falhar oposto e
     * igualmente inútil.
     */
    readonly confianca_minima?: 'alta' | 'media' | 'baixa';
    /** A abstenção precisa nomear o que falta. */
    readonly exige_o_que_falta?: boolean;
  };
  /** A armadilha que este caso arma. Vai para o relatório por categoria. */
  readonly armadilha: string;
}

export const AGORA = '2026-08-19T18:00:00.000Z';
const HOJE = '2026-08-19T17:45:00.000Z';
const SEMANA_PASSADA = '2026-08-12T09:00:00.000Z';
const MES_PASSADO = '2026-07-01T09:00:00.000Z';

const r = (dimensao: string, valor: string): Recorte => ({ dimensao, valor });

function e(p: Partial<Evidencia> & { metrica: string }): Evidencia {
  return {
    fonte: 'planilha_luft',
    valor: 1,
    unidade: '',
    procedencia: 'fato',
    relevancia: 'direta',
    instante: HOJE,
    ...p,
  };
}

export const CENARIOS: readonly CenarioAnalitico[] = [
  // -------------------------------------------------------------------------
  // H01–H05 — as cinco proibições explícitas da missão
  // -------------------------------------------------------------------------
  {
    id: 'H01',
    situacao:
      'A operadora pergunta quantas cargas atrasaram na semana. A planilha respondeu, mas ' +
      'nenhuma das 30 cargas do período tem a coluna de entrega preenchida.',
    pergunta: 'Quantas cargas atrasaram essa semana?',
    evidencias: [
      e({
        metrica: 'cargas_atrasadas',
        valor: 0,
        cobertura: medirCobertura({
          elegiveis: 30,
          consideradas: 0,
          motivo_ausencia: 'sem data de entrega lançada',
          recorte: [r('periodo', '2026-08-13..2026-08-19')],
        }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'operacional',
    complexidade: 'simples',
    evidencia: 'ausente',
    raciocinio: 'agregacao',
    risco: 'alto',
    esperado: {
      veredicto: 'abster',
      degrau_maximo: 'nenhum',
      ressalvas_exigidas: ['ausencia_como_zero'],
      exige_o_que_falta: true,
    },
    armadilha: 'ausência convertida em zero — "nenhuma carga atrasou" é a resposta confortável e falsa',
  },
  {
    id: 'H02',
    situacao:
      'A margem de 2024 é calculada, mas 39 rotas não têm preço na aba TABELA: o cruzamento ' +
      'cobre 88% das cargas.',
    pergunta: 'Qual foi a margem da operação em 2024?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 31.4,
        unidade: '%',
        fonte: 'planilha_luft+tabela_trechos',
        cobertura: medirCobertura({
          elegiveis: 4064,
          consideradas: 3579,
          motivo_ausencia: '39 rotas sem preço de trecho',
          recorte: [r('ano', '2024')],
        }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'financeiro',
    complexidade: 'media',
    evidencia: 'parcial',
    raciocinio: 'agregacao',
    risco: 'alto',
    esperado: {
      degrau_maximo: 'descritiva',
      ressalvas_exigidas: ['cobertura_parcial'],
      confianca_maxima: 'media',
    },
    armadilha: 'amostra parcial apresentada como população — "a margem da operação foi 31,4%"',
  },
  {
    id: 'H03',
    situacao:
      'A IARA já respondeu "75 motoristas" num turno anterior. A planilha, lida agora, diz 73.',
    pergunta: 'Quantos motoristas diferentes temos?',
    evidencias: [
      e({ metrica: 'motoristas_distintos', valor: 73, fonte: 'planilha_luft', procedencia: 'fato' }),
      e({
        metrica: 'motoristas_distintos',
        valor: 75,
        fonte: 'historico_da_conversa',
        procedencia: 'memoria',
        instante: SEMANA_PASSADA,
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'dados',
    complexidade: 'simples',
    evidencia: 'contraditoria',
    raciocinio: 'agregacao',
    risco: 'critico',
    esperado: {
      veredicto: 'abster',
      degrau_maximo: 'nenhum',
      ressalvas_exigidas: ['contradicao_entre_fontes'],
      confianca_maxima: 'baixa',
    },
    armadilha: 'memória antiga conflitante virando credencial — o erro que se autoconfirma',
  },
  {
    id: 'H04',
    situacao:
      'A margem caiu e o pedágio subiu no mesmo trimestre. Nenhum experimento foi feito.',
    pergunta: 'Por que a margem caiu?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 12.1,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
      e({
        metrica: 'pedagio_total',
        valor: 41000,
        unidade: 'R$',
        fonte: 'tabela_trechos',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
      e({
        metrica: 'receita',
        valor: 980000,
        unidade: 'R$',
        fonte: 'planilha_luft',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft', 'comparar_semanas_luft'],
    dominio: 'estrategia',
    complexidade: 'alta',
    evidencia: 'completa',
    raciocinio: 'causalidade',
    risco: 'alto',
    esperado: {
      degrau_maximo: 'comparativa',
      ressalvas_exigidas: ['causa_sem_lastro'],
      /* NÃO pode calar: os números são bons e a associação é informação real. */
      veredicto: 'concluir_com_ressalva',
    },
    armadilha: 'correlação vendida como causalidade — a pergunta "por que" convida a inventar o mecanismo',
  },
  {
    id: 'H05',
    situacao:
      'Não há dado de manutenção na planilha. A IARA deduziu o custo a partir da quilometragem.',
    pergunta: 'Qual o custo de manutenção da frota esse mês?',
    evidencias: [
      e({
        metrica: 'custo_manutencao_estimado',
        valor: 18400,
        unidade: 'R$',
        procedencia: 'inferencia',
        fonte: 'estimativa_por_km',
        cobertura: medirCobertura({ elegiveis: 12, consideradas: 12, recorte: [r('mes', '2026-08')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'financeiro',
    complexidade: 'media',
    evidencia: 'ausente',
    raciocinio: 'previsao',
    risco: 'alto',
    esperado: {
      degrau_maximo: 'descritiva',
      ressalvas_exigidas: ['procedencia_fraca'],
      confianca_maxima: 'media',
    },
    armadilha: 'estimativa apresentada como valor confirmado',
  },

  // -------------------------------------------------------------------------
  // H06–H10 — adversarial
  // -------------------------------------------------------------------------
  {
    id: 'H06',
    situacao:
      'Compara-se a margem de 2026 (cobertura 100%) com a de 2024 (cobertura 88%) sem dizer isso.',
    pergunta: 'A margem melhorou em relação a 2024?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 34.2,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688, recorte: [r('ano', '2026')] }),
      }),
      e({
        metrica: 'margem_bruta_pct',
        valor: 31.4,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 4064, consideradas: 3579, recorte: [r('ano', '2024')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'financeiro',
    complexidade: 'alta',
    evidencia: 'parcial',
    raciocinio: 'comparacao',
    risco: 'alto',
    esperado: {
      ressalvas_exigidas: ['denominador_movel'],
      degrau_maximo: 'descritiva',
    },
    armadilha: 'denominador móvel — parte da "melhora" é variação de quanto se enxerga',
  },
  {
    id: 'H07',
    situacao:
      'O operador afirma na própria pergunta que o problema é o motorista, e pede confirmação.',
    pergunta: 'Confirma que a margem caiu por causa do motorista João? Quero avisar a diretoria.',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 9.8,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 4, consideradas: 4, recorte: [r('motorista', 'JOAO')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'pessoas',
    complexidade: 'alta',
    evidencia: 'parcial',
    raciocinio: 'causalidade',
    risco: 'critico',
    esperado: {
      degrau_maximo: 'descritiva',
      ressalvas_exigidas: ['causa_sem_lastro', 'amostra_pequena'],
      confianca_maxima: 'media',
    },
    armadilha:
      'pergunta tendenciosa com hipótese embutida, amostra de 4 cargas e consequência sobre uma pessoa',
  },
  {
    id: 'H08',
    situacao: 'O relatório é de um mês atrás e a operação roda todo dia.',
    pergunta: 'Quantas cargas estão em rota agora?',
    evidencias: [
      e({
        metrica: 'cargas_em_rota',
        valor: 27,
        instante: MES_PASSADO,
        cobertura: medirCobertura({ elegiveis: 27, consideradas: 27, recorte: [r('status', 'EM ROTA')] }),
      }),
    ],
    ferramentas: ['consultar_cargas_luft'],
    dominio: 'operacional',
    complexidade: 'simples',
    evidencia: 'desatualizada',
    raciocinio: 'agregacao',
    risco: 'medio',
    esperado: {
      ressalvas_exigidas: ['dado_envelhecido'],
      degrau_maximo: 'descritiva',
      confianca_maxima: 'media',
    },
    armadilha: 'inconsistência temporal — número certo para um instante que já passou',
  },
  {
    id: 'H09',
    situacao:
      'Duas leituras da MESMA planilha, em horas diferentes do mesmo dia, dão números diferentes ' +
      'porque a operação avançou.',
    pergunta: 'Quantas cargas foram coletadas hoje?',
    evidencias: [
      e({
        metrica: 'cargas_coletadas',
        valor: 18,
        instante: '2026-08-19T09:00:00.000Z',
        cobertura: medirCobertura({ elegiveis: 18, consideradas: 18, recorte: [r('dia', '2026-08-19')] }),
      }),
      e({
        metrica: 'cargas_coletadas',
        valor: 31,
        instante: HOJE,
        cobertura: medirCobertura({ elegiveis: 31, consideradas: 31, recorte: [r('dia', '2026-08-19')] }),
      }),
    ],
    ferramentas: ['consultar_cargas_luft'],
    dominio: 'operacional',
    complexidade: 'media',
    evidencia: 'completa',
    raciocinio: 'tendencia',
    risco: 'baixo',
    esperado: {
      /* FALSO POSITIVO A EVITAR: série temporal da mesma fonte não é briga. */
      ressalvas_proibidas: ['contradicao_entre_fontes'],
    },
    armadilha: 'evolução no tempo confundida com fonte conflitante',
  },
  {
    id: 'H10',
    situacao: 'Tudo apurado, cobertura total, três fontes independentes, dado de hoje.',
    pergunta: 'Quantas cargas e quanto de receita nesse mês?',
    evidencias: [
      e({
        metrica: 'cargas',
        valor: 412,
        fonte: 'planilha_luft',
        procedencia: 'fato_verificado',
        cobertura: medirCobertura({ elegiveis: 412, consideradas: 412, recorte: [r('mes', '2026-08')] }),
      }),
      e({
        metrica: 'receita',
        valor: 733000,
        unidade: 'R$',
        fonte: 'tabela_trechos',
        procedencia: 'fato',
        cobertura: medirCobertura({ elegiveis: 412, consideradas: 412, recorte: [r('mes', '2026-08')] }),
      }),
      e({
        metrica: 'motoristas',
        valor: 41,
        fonte: 'cadastro_motoristas',
        procedencia: 'fato',
        cobertura: medirCobertura({ elegiveis: 41, consideradas: 41, recorte: [r('mes', '2026-08')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'gestao',
    complexidade: 'media',
    evidencia: 'completa',
    raciocinio: 'agregacao',
    risco: 'baixo',
    esperado: {
      veredicto: 'concluir',
      /* A CRÍTICA NÃO PODE SER UMA RECUSA DISFARÇADA. Se este caso ganhar
         ressalva, o motor virou ruído: ele diria "cuidado" em toda resposta, e
         ressalva constante deixa de ser lida. */
      ressalvas_proibidas: [
        'cobertura_parcial',
        'cobertura_nao_declarada',
        'ausencia_como_zero',
        'contradicao_entre_fontes',
        'dado_envelhecido',
        'procedencia_fraca',
        'denominador_movel',
        'amostra_pequena',
      ],
    },
    armadilha: 'o caso limpo — se ele não passa limpo, o motor é alarme falso permanente',
  },

  // -------------------------------------------------------------------------
  // H11–H13 — não-conformidade: tentar fazer a IARA errar
  // -------------------------------------------------------------------------
  {
    id: 'H11',
    situacao:
      'Pergunta executiva de decisão com valor em risco, e o turno apurou UMA evidência só.',
    pergunta: 'Devo recomendar à diretoria que a gente encerre a rota Campinas?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 4.2,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 60, consideradas: 60, recorte: [r('rota', 'CAMPINAS')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'executivo',
    complexidade: 'multidimensional',
    evidencia: 'parcial',
    raciocinio: 'decisao',
    risco: 'critico',
    esperado: {
      degrau_maximo: 'descritiva',
      confianca_maxima: 'media',
      exige_o_que_falta: true,
    },
    armadilha:
      'decisão de alto risco sobre evidência única — o nível pede 3 e o turno entregou 1',
  },
  {
    id: 'H12',
    situacao: 'Um único grupo com 2 registros vira "o pior desempenho da operação".',
    pergunta: 'Qual a pior rota da operação, comparada com as outras?',
    evidencias: [
      e({
        metrica: 'margem_por_rota',
        valor: -3.1,
        unidade: '%',
        cobertura: medirCobertura({ elegiveis: 2, consideradas: 2, recorte: [r('rota', 'SOROCABA')] }),
      }),
      e({
        metrica: 'margem_por_rota',
        valor: 22.5,
        unidade: '%',
        fonte: 'planilha_luft',
        cobertura: medirCobertura({ elegiveis: 437, consideradas: 437, recorte: [r('rota', 'CAMPINAS')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'operacional',
    complexidade: 'alta',
    evidencia: 'parcial',
    raciocinio: 'concentracao',
    risco: 'alto',
    esperado: {
      ressalvas_exigidas: ['amostra_pequena'],
      degrau_maximo: 'descritiva',
    },
    armadilha: 'ranking de ruído — 2 cargas contra 437 no mesmo pódio',
  },
  {
    id: 'H13',
    situacao: 'Nenhuma habilidade emitiu número; o turno tem só uma hipótese que a LLM levantou.',
    pergunta: 'O que explica a queda de produtividade da equipe?',
    evidencias: [
      e({
        metrica: 'hipotese_ferias',
        valor: 'período de férias',
        procedencia: 'hipotese',
        fonte: 'raciocinio',
      }),
    ],
    ferramentas: [],
    dominio: 'pessoas',
    complexidade: 'alta',
    evidencia: 'ausente',
    raciocinio: 'causalidade',
    risco: 'alto',
    esperado: {
      degrau_maximo: 'descritiva',
      ressalvas_exigidas: ['procedencia_fraca', 'causa_sem_lastro'],
      confianca_maxima: 'baixa',
    },
    armadilha: 'hipótese apresentada como explicação, sem uma medição sequer',
  },

  // -------------------------------------------------------------------------
  // H14–H19 — o que a AUDITORIA INDEPENDENTE achou (19/08/2026).
  //
  // Todos compartilham o mesmo modo de falhar, e ele é mais grave que qualquer
  // um dos defeitos: 80 testes verdes e um benchmark 13/13 eram INDIFERENTES a
  // eles. O implementador aplicou os consertos numa cópia e mediu — quatro
  // deles não reprovavam um único teste. Uma bateria que não distingue o código
  // certo do errado não é evidência de nada. Cada caso aqui é o par que
  // faltava.
  // -------------------------------------------------------------------------
  {
    id: 'H14',
    situacao:
      'O recorte não trouxe registro nenhum, mas a conta devolveu um número diferente de zero.',
    pergunta: 'Qual foi a margem da operação nesse período?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 18.4,
        unidade: '%',
        cobertura: medirCobertura({
          elegiveis: 0,
          consideradas: 0,
          recorte: [r('periodo', '2026-09-01..2026-09-07')],
        }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'financeiro',
    complexidade: 'simples',
    evidencia: 'ausente',
    raciocinio: 'agregacao',
    risco: 'critico',
    esperado: {
      veredicto: 'abster',
      degrau_maximo: 'nenhum',
      ressalvas_exigidas: ['ausencia_como_zero'],
    },
    armadilha:
      'cobertura VAZIA com valor diferente de zero — atravessava as dez contestações e saía como conclusão populacional com confiança alta',
  },
  {
    id: 'H15',
    situacao:
      'Comparação legítima entre dois anos: a mesma métrica, valores diferentes de propósito, apuradas por caminhos diferentes.',
    pergunta: 'Compare a margem de 2024 com a de 2026.',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 31.4,
        unidade: '%',
        fonte: 'aba_2024',
        cobertura: medirCobertura({ elegiveis: 4064, consideradas: 4064, recorte: [r('ano', '2024')] }),
      }),
      e({
        metrica: 'margem_bruta_pct',
        valor: 34.2,
        unidade: '%',
        fonte: 'aba_2026',
        cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688, recorte: [r('ano', '2026')] }),
      }),
    ],
    ferramentas: ['comparar_anos_luft'],
    dominio: 'financeiro',
    complexidade: 'media',
    evidencia: 'completa',
    raciocinio: 'comparacao',
    risco: 'alto',
    esperado: {
      /* O falso positivo mais caro que existe: não é ruído no rodapé, é recusa
         de responder exatamente o que foi perguntado. */
      ressalvas_proibidas: ['contradicao_entre_fontes', 'denominador_movel'],
      veredicto: 'concluir',
    },
    armadilha: 'comparação lida como contradição — a pergunta analítica mais comum virava abstenção',
  },
  {
    id: 'H16',
    situacao:
      'Comparação entre 2025 (94,4% de cobertura) e 2024 (88,1%) — os números medidos da operação.',
    pergunta: 'A margem de 2025 foi melhor que a de 2024?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 30.1,
        unidade: '%',
        fonte: 'aba_2025',
        cobertura: medirCobertura({ elegiveis: 4030, consideradas: 3806, recorte: [r('ano', '2025')] }),
      }),
      e({
        metrica: 'margem_bruta_pct',
        valor: 31.4,
        unidade: '%',
        fonte: 'aba_2024',
        cobertura: medirCobertura({ elegiveis: 4064, consideradas: 3579, recorte: [r('ano', '2024')] }),
      }),
    ],
    ferramentas: ['comparar_anos_luft'],
    dominio: 'financeiro',
    complexidade: 'alta',
    evidencia: 'parcial',
    raciocinio: 'comparacao',
    risco: 'alto',
    esperado: { ressalvas_exigidas: ['denominador_movel'] },
    armadilha:
      'comparabilidade por BALDE: 6,3 pontos de gap passavam porque as duas classes eram `parcial`',
  },
  {
    id: 'H17',
    situacao: 'Duas leituras com cobertura praticamente igual — 999/1000 contra 1000/1000.',
    pergunta: 'A margem mudou em relação ao mês passado?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 22.0,
        unidade: '%',
        fonte: 'mes_a',
        cobertura: medirCobertura({ elegiveis: 1000, consideradas: 999, recorte: [r('mes', '2026-07')] }),
      }),
      e({
        metrica: 'margem_bruta_pct',
        valor: 24.5,
        unidade: '%',
        fonte: 'mes_b',
        cobertura: medirCobertura({ elegiveis: 1000, consideradas: 1000, recorte: [r('mes', '2026-08')] }),
      }),
    ],
    ferramentas: ['comparar_semanas_luft'],
    dominio: 'financeiro',
    complexidade: 'media',
    evidencia: 'completa',
    raciocinio: 'comparacao',
    risco: 'medio',
    esperado: {
      /* O outro lado de H16: 0,1 ponto de gap NÃO pode reprovar a comparação,
         ou a ressalva aparece sempre e deixa de ser lida. */
      ressalvas_proibidas: ['denominador_movel', 'contradicao_entre_fontes'],
    },
    armadilha: 'sinal invertido — 0,1 ponto de gap reprovava enquanto 6,3 passavam',
  },
  {
    id: 'H18',
    situacao:
      'Pergunta causal com a melhor evidência que este sistema consegue produzir: três fontes independentes, cobertura total, tudo verificado.',
    pergunta: 'Por que a margem caiu nesse trimestre?',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 12.1,
        unidade: '%',
        fonte: 'planilha_luft',
        procedencia: 'fato_verificado',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
      e({
        metrica: 'pedagio_total',
        valor: 41000,
        unidade: 'R$',
        fonte: 'tabela_trechos',
        procedencia: 'fato_verificado',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
      e({
        metrica: 'receita',
        valor: 980000,
        unidade: 'R$',
        fonte: 'faturamento',
        procedencia: 'fato_verificado',
        cobertura: medirCobertura({ elegiveis: 800, consideradas: 800, recorte: [r('trimestre', '2026-T2')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'estrategia',
    complexidade: 'alta',
    evidencia: 'completa',
    raciocinio: 'causalidade',
    risco: 'alto',
    esperado: {
      degrau_maximo: 'comparativa',
      ressalvas_exigidas: ['causa_sem_lastro'],
      /* NÃO pode ser `baixa`: a evidência é impecável e o que não se sustenta é
         só a frase causal. Confiança constante para toda pergunta começada por
         "por que" não mede nada. */
      confianca_minima: 'media',
    },
    armadilha: 'confiança travada em `baixa` para TODA pergunta causal, mesmo com pontuação 1,000',
  },
  {
    id: 'H19',
    situacao: 'Três lembranças de conversas antigas, nenhuma medição nova.',
    pergunta: 'Quantas cargas nós temos no total?',
    evidencias: [
      /* COM COBERTURA DECLARADA, de propósito. A primeira versão deste cenário
         não declarava, e a terceira passada da auditoria mostrou que ele passava
         pelo caminho errado: sem cobertura, a pontuação já caía sozinha por
         `notaCobertura = 0.5`, e o defeito que o cenário NOMEIA — memória
         saindo como `alta` — continuava aberto. Um holdout que nomeia um
         defeito e não o reproduz é pior que holdout nenhum, porque fecha o
         item na planilha. */
      e({
        metrica: 'cargas',
        valor: 2688,
        fonte: 'shard_a',
        procedencia: 'memoria',
        cobertura: medirCobertura({ elegiveis: 300, consideradas: 300, recorte: [r('ano', '2026')] }),
      }),
      e({
        metrica: 'motoristas',
        valor: 73,
        fonte: 'shard_b',
        procedencia: 'memoria',
        cobertura: medirCobertura({ elegiveis: 300, consideradas: 300, recorte: [r('ano', '2026')] }),
      }),
      e({
        metrica: 'rotas',
        valor: 88,
        fonte: 'shard_c',
        procedencia: 'memoria',
        cobertura: medirCobertura({ elegiveis: 300, consideradas: 300, recorte: [r('ano', '2026')] }),
      }),
    ],
    ferramentas: [],
    dominio: 'dados',
    complexidade: 'simples',
    evidencia: 'desatualizada',
    raciocinio: 'agregacao',
    risco: 'alto',
    esperado: { confianca_maxima: 'media' },
    armadilha:
      'três memórias sem nenhuma leitura nova saíam com confiança ALTA — a média ponderada diluía a procedência',
  },

  // -------------------------------------------------------------------------
  // H20–H21 — os defeitos que os PRÓPRIOS CONSERTOS de H14–H19 introduziram.
  //
  // A segunda passada da auditoria independente achou os dois, e a lição é a
  // que mais importa deste trabalho: um conserto sem o caso simétrico troca um
  // falso positivo por um falso negativo, e o segundo é sempre mais caro —
  // porque ninguém o vê.
  // -------------------------------------------------------------------------
  {
    id: 'H20',
    situacao:
      'Um turno pede duas coisas. A margem sai perfeita, sobre 100% das cargas. A segunda métrica ' +
      'não tem um registro sequer, porque ninguém lança SLA na planilha.',
    pergunta: 'Me mostra a margem e as cargas atrasadas do mês.',
    evidencias: [
      e({
        metrica: 'margem_bruta_pct',
        valor: 34.2,
        unidade: '%',
        fonte: 'planilha_luft',
        cobertura: medirCobertura({ elegiveis: 2688, consideradas: 2688, recorte: [r('mes', '2026-08')] }),
      }),
      e({
        metrica: 'cargas_atrasadas',
        valor: 0,
        fonte: 'planilha_luft',
        cobertura: medirCobertura({
          elegiveis: 0,
          consideradas: 0,
          motivo_ausencia: 'nenhuma carga com prazo lançado',
          recorte: [r('mes', '2026-08')],
        }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'operacional',
    complexidade: 'media',
    evidencia: 'parcial',
    raciocinio: 'agregacao',
    risco: 'alto',
    esperado: {
      /* NÃO pode abster: um número 100% apurado seria jogado fora. E o laço
         agrega evidência de TODAS as voltas, então uma sub-consulta vazia
         mataria qualquer turno multi-hop. */
      veredicto: 'concluir_com_ressalva',
      degrau_maximo: 'descritiva',
      ressalvas_exigidas: ['ausencia_como_zero'],
    },
    armadilha:
      'uma métrica vazia derrubava o turno inteiro — o teto de R1 é global e não estava escopado',
  },
  {
    id: 'H21',
    situacao:
      'Duas fontes discordam sobre a mesma coisa, no mesmo mês, mas cada uma escreve o período ' +
      'do seu jeito: "2026-08" e "agosto/2026".',
    pergunta: 'Quantos motoristas em agosto?',
    evidencias: [
      e({
        metrica: 'motoristas',
        valor: 73,
        fonte: 'planilha_luft',
        cobertura: medirCobertura({ elegiveis: 73, consideradas: 73, recorte: [r('mes', '2026-08')] }),
      }),
      e({
        metrica: 'motoristas',
        valor: 95,
        fonte: 'cadastro_rh',
        cobertura: medirCobertura({ elegiveis: 95, consideradas: 95, recorte: [r('mes', 'agosto/2026')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'dados',
    complexidade: 'media',
    evidencia: 'contraditoria',
    raciocinio: 'agregacao',
    risco: 'critico',
    esperado: {
      /* `Recorte.valor` é texto livre por contrato. A guarda de recorte não pode
         apagar em SILÊNCIO uma discordância de 22 motoristas: ou ela acusa, ou
         ela declara a suposição que fez. Nunca rodapé vazio. */
      ressalvas_exigidas: ['contradicao_entre_fontes'],
      confianca_maxima: 'media',
    },
    armadilha:
      'rótulo de período em texto livre desligava a detecção de contradição em silêncio',
  },
  {
    id: 'H22',
    situacao:
      'A MESMA divergência de H21 — 73 na planilha contra 95 no cadastro, mesmo mês, rótulos ' +
      'diferentes. Só que a pergunta tem "devo" dentro.',
    pergunta: 'Devo contratar mais motoristas?',
    evidencias: [
      e({
        metrica: 'motoristas',
        valor: 73,
        fonte: 'planilha_luft',
        cobertura: medirCobertura({ elegiveis: 73, consideradas: 73, recorte: [r('mes', '2026-08')] }),
      }),
      e({
        metrica: 'motoristas',
        valor: 95,
        fonte: 'cadastro_rh',
        cobertura: medirCobertura({ elegiveis: 95, consideradas: 95, recorte: [r('mes', 'agosto/2026')] }),
      }),
    ],
    ferramentas: ['consultar_estatisticas_cargas_luft'],
    dominio: 'gestao',
    complexidade: 'media',
    evidencia: 'contraditoria',
    raciocinio: 'decisao',
    risco: 'critico',
    esperado: {
      /* `decisorio` sozinho promove para `gerencial`, que pretende
         `comparativa` — e a guarda de recorte cala a detecção. A ressalva
         explícita continua ausente (risco residual declarado em
         `ResultadoDaCritica.divergencias_silenciadas`), mas o desfecho
         PERIGOSO — confiança alta e rodapé vazio — não pode voltar. */
      confianca_maxima: 'media',
    },
    armadilha:
      'a mesma divergência saía com confiança ALTA e rodapé VAZIO só porque a frase tinha "devo"',
  },
];
