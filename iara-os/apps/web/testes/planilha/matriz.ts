/**
 * A MATRIZ EXECUTÁVEL — cada capacidade é medida, nunca opinada.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO: um estado só é atribuído por EXECUÇÃO.
 * `UNSUPPORTED` significa "eu chamei e não existe", nunca "não achei no
 * código"; `NOT_TESTED` é o estado honesto para o que não foi exercitado. A
 * distinção é o pedido explícito da operadora, e é a diferença entre um mapa e
 * uma opinião.
 *
 * O QUE ESTA MATRIZ MEDE: o MOTOR determinístico (`agregarCargas`,
 * `interpretarPeriodo`, o contrato de `CargaCompleta`) contra o oráculo.
 *
 * O QUE ELA NÃO MEDE, e nenhuma linha daqui deve ser lida como se medisse: se a
 * LLM escolhe a habilidade certa e passa os parâmetros certos. Motor correto com
 * roteamento errado continua entregando resposta errada ao operador — foi
 * exatamente o que aconteceu com `agrupar_por` em 18/08/2026. Esse caminho é
 * medido pelo gate de produto (`testes/gate/produto.mjs`), contra a interface
 * real, e as duas medições são necessárias.
 */

import {
  agregarCargas,
  type AgruparPor,
  type CargaCompleta,
} from '../../servidor/nucleo/ClientePlanilhaOcis';
import { interpretarPeriodo } from '../../servidor/nucleo/kernel/PeriodoOperacional';
import { CARGAS_2026, CARGAS_2026_COM_DUPLICATA, ESPERADO } from './oraculo';

/**
 * Os estados. `SUPPORTED_PARTIAL` existe para a capacidade que responde mas
 * responde menos do que a pergunta pedia — e é a mais perigosa de todas,
 * porque parece sucesso.
 */
export type EstadoCapacidade =
  | 'SUPPORTED_CORRECT'
  | 'SUPPORTED_PARTIAL'
  | 'WRONG_RESULT'
  | 'UNSUPPORTED'
  | 'UNSAFE_TO_ANSWER'
  | 'TOOL_ERROR'
  | 'TIMEOUT'
  | 'AMBIGUOUS'
  | 'NOT_APPLICABLE'
  | 'NOT_TESTED';

/**
 * ONDE A LACUNA MORA. Sem isto a matriz vira uma lista de queixas: saber que
 * "por cliente" não funciona é inútil se ninguém disser que o dado não existe —
 * implementar agrupamento não traria a coluna de volta.
 */
export type CausaTecnica =
  | 'dados' // a informação não está na fonte
  | 'executor' // o motor não sabe calcular
  | 'interpretador' // a expressão não é entendida
  | 'api' // o contrato entre camadas não expressa
  | 'modelo' // depende de a LLM acertar
  | 'nenhuma';

export interface CasoCapacidade {
  readonly id: string;
  readonly categoria: string;
  readonly pergunta: string;
  readonly operacao: string;
  /** Executa e devolve o valor medido, ou `null` quando não há caminho. */
  readonly medir: () => number | string | null;
  /** A resposta conhecida. `null` = a capacidade não deveria existir hoje. */
  readonly esperado: number | string | null;
  readonly causa: CausaTecnica;
  readonly nota?: string;
}

export interface ResultadoCaso extends Omit<CasoCapacidade, 'medir'> {
  readonly obtido: number | string | null;
  readonly estado: EstadoCapacidade;
  readonly ms: number;
}

const grupos = (cargas: readonly CargaCompleta[], por: AgruparPor) => agregarCargas(cargas, por);

const contarNoGrupo = (por: AgruparPor, chave: string): number | null => {
  const g = grupos(CARGAS_2026, por).find((x) => x.chave === chave);
  return g ? g.contagem : null;
};

const somarNoGrupo = (por: AgruparPor, chave: string): number | null => {
  const g = grupos(CARGAS_2026, por).find((x) => x.chave === chave);
  return g ? g.valor_total : null;
};

/**
 * O agrupamento existe de verdade? Chamar com uma dimensão inexistente NÃO
 * levanta — `chaveDoGrupo` cai num rótulo único e devolve UM grupo com tudo
 * dentro. É por isso que a prova de ausência é "colapsou em um grupo só", e não
 * "lançou exceção": a ausência aqui é silenciosa, que é o que a torna perigosa.
 */
const agrupamentoExiste = (por: string): boolean => {
  const gs = grupos(CARGAS_2026, por as AgruparPor);
  return gs.length > 1;
};

export const CASOS: readonly CasoCapacidade[] = [
  // ═══ NÍVEL 1 — CONTAGEM ═══
  {
    id: 'COUNT-001',
    categoria: 'contagem',
    pergunta: 'Quantas cargas temos?',
    operacao: 'COUNT',
    medir: () => grupos(CARGAS_2026, 'nenhum')[0].contagem,
    esperado: ESPERADO.linhas_2026,
    causa: 'nenhuma',
  },
  {
    id: 'COUNT-002',
    categoria: 'contagem',
    pergunta: 'Quantas cargas o LINO fez?',
    operacao: 'COUNT + FILTER(motorista)',
    medir: () => contarNoGrupo('motorista', 'LINO'),
    esperado: ESPERADO.cargas_lino_2026,
    causa: 'nenhuma',
  },
  {
    id: 'COUNT-003',
    categoria: 'contagem',
    pergunta: 'Quantas cargas foram finalizadas?',
    operacao: 'COUNT + FILTER(status)',
    medir: () => contarNoGrupo('status_normalizado', 'FINALIZADO'),
    esperado: ESPERADO.finalizado_2026,
    causa: 'nenhuma',
  },
  {
    id: 'COUNT-004',
    categoria: 'contagem',
    pergunta: 'Quantas cargas foram canceladas?',
    operacao: 'COUNT + FILTER(status=CANCELADA)',
    /* "CANCELADA" não é um estado que o normalizador conhece: cai em
       DESCONHECIDO junto com qualquer outra palavra não mapeada. Contar
       DESCONHECIDO como cancelada seria responder outra pergunta. */
    medir: () => contarNoGrupo('status_normalizado', 'CANCELADA'),
    esperado: null,
    causa: 'executor',
    nota: 'CANCELADA cai em DESCONHECIDO; não há estado de cancelamento no normalizador',
  },
  {
    id: 'COUNT-005',
    categoria: 'contagem',
    pergunta: 'Quantas cargas foram feitas em janeiro?',
    operacao: 'COUNT + GROUP_BY(mês)',
    medir: () => (agrupamentoExiste('mes') ? contarNoGrupo('mes' as AgruparPor, '2026-01') : null),
    esperado: null,
    causa: 'executor',
    nota: 'data_coleta existe em toda carga; o agrupamento por mês nunca foi escrito',
  },
  {
    id: 'COUNT-006',
    categoria: 'contagem',
    pergunta: 'Quantas cargas o cliente X fez?',
    operacao: 'COUNT + FILTER(cliente)',
    medir: () => (agrupamentoExiste('cliente') ? 0 : null),
    esperado: null,
    causa: 'dados',
    nota: 'não há coluna de cliente na planilha nem campo em CargaCompleta',
  },

  // ═══ NÍVEL 2 — AGREGAÇÃO ═══
  {
    id: 'SUM-001',
    categoria: 'agregação',
    pergunta: 'Qual o faturamento total?',
    operacao: 'SUM(valor)',
    medir: () => grupos(CARGAS_2026, 'nenhum')[0].valor_total,
    esperado: ESPERADO.soma_valores_2026,
    causa: 'nenhuma',
  },
  {
    id: 'SUM-002',
    categoria: 'agregação',
    pergunta: 'Quanto o LAUDIR faturou?',
    operacao: 'SUM + FILTER(motorista)',
    medir: () => somarNoGrupo('motorista', 'LAUDIR'),
    esperado: ESPERADO.soma_laudir_2026,
    causa: 'nenhuma',
  },
  {
    id: 'AVG-001',
    categoria: 'agregação',
    pergunta: 'Qual o valor médio por carga?',
    operacao: 'AVG(valor)',
    /* Derivada, não nativa: total/contagem. Trata valor AUSENTE como zero, que
       puxa a média para baixo — ver `SUPPORTED_PARTIAL`. */
    medir: () => {
      const g = grupos(CARGAS_2026, 'nenhum')[0];
      return g.valor_total / g.contagem;
    },
    esperado: 15000 / 12,
    causa: 'executor',
    nota: 'derivada de total/contagem; a carga sem valor entra no divisor como zero',
  },
  {
    id: 'MAX-001',
    categoria: 'agregação',
    pergunta: 'Qual foi a maior carga?',
    operacao: 'MAX(valor)',
    medir: () => {
      const [g] = grupos(CARGAS_2026, 'nenhum');
      return 'valor_maximo' in g ? (g as Record<string, number>).valor_maximo : null;
    },
    esperado: null,
    causa: 'executor',
    nota: 'GrupoAgregado carrega apenas contagem e valor_total',
  },
  {
    id: 'MIN-001',
    categoria: 'agregação',
    pergunta: 'Qual foi a menor carga?',
    operacao: 'MIN(valor)',
    medir: () => {
      const [g] = grupos(CARGAS_2026, 'nenhum');
      return 'valor_minimo' in g ? (g as Record<string, number>).valor_minimo : null;
    },
    esperado: null,
    causa: 'executor',
  },

  // ═══ NÍVEL 3 — AGRUPAMENTO ═══
  {
    id: 'GROUP-001',
    categoria: 'agrupamento',
    pergunta: 'Quantas cargas por motorista?',
    operacao: 'GROUP_BY(motorista)',
    medir: () => grupos(CARGAS_2026, 'motorista').length,
    esperado: 4, // LINO, LAUDIR, MOLINA e o grupo do motorista ausente
    causa: 'nenhuma',
  },
  {
    id: 'GROUP-002',
    categoria: 'agrupamento',
    pergunta: 'Quantas cargas por rota?',
    operacao: 'GROUP_BY(rota)',
    /* A chave inclui os espaços em volta da seta: `${origem} → ${destino}`.
       Escrever "SP→MT" aqui fez o caso reprovar como UNSUPPORTED na primeira
       rodada — a matriz pegando um erro do próprio medidor, que é exatamente o
       que se espera dela. */
    medir: () => contarNoGrupo('rota', 'SP → MT'),
    esperado: ESPERADO.rota_sp_mt_2026,
    causa: 'nenhuma',
  },
  {
    id: 'GROUP-003',
    categoria: 'agrupamento',
    pergunta: 'Quantas cargas por mês?',
    operacao: 'GROUP_BY(mês)',
    medir: () => (agrupamentoExiste('mes') ? grupos(CARGAS_2026, 'mes' as AgruparPor).length : null),
    esperado: null,
    causa: 'executor',
  },
  {
    id: 'GROUP-004',
    categoria: 'agrupamento',
    pergunta: 'Quantas cargas por estado de destino?',
    operacao: 'GROUP_BY(uf_destino)',
    medir: () =>
      agrupamentoExiste('uf_destino') ? grupos(CARGAS_2026, 'uf_destino' as AgruparPor).length : null,
    esperado: null,
    causa: 'api',
    nota: 'uf_destino existe em CargaCompleta e não está entre os agrupamentos aceitos',
  },

  // ═══ NÍVEL 4 — DISTINCT / DUPLICIDADE ═══
  {
    id: 'DIST-001',
    categoria: 'distinct',
    pergunta: 'Quantas cargas únicas existem?',
    operacao: 'COUNT(DISTINCT oci)',
    /* A duplicata entra no conjunto: 13 linhas, 12 OCIs. O motor conta LINHAS. */
    medir: () => grupos(CARGAS_2026_COM_DUPLICATA, 'nenhum')[0].contagem,
    esperado: ESPERADO.ocis_unicas_2026_com_duplicata,
    causa: 'executor',
    nota: 'o motor conta linhas; não há COUNT DISTINCT — linha repetida vira carga a mais',
  },
  {
    id: 'DIST-002',
    categoria: 'distinct',
    pergunta: 'Quantos motoristas diferentes temos?',
    operacao: 'COUNT(DISTINCT motorista)',
    /* Derivável do número de grupos — menos o grupo do motorista ausente, que
       não é um motorista. Essa subtração é o que ninguém faz hoje. */
    medir: () => grupos(CARGAS_2026, 'motorista').length,
    esperado: ESPERADO.motoristas_distintos_2026,
    causa: 'executor',
    nota: 'o grupo do motorista ausente entra na contagem de motoristas distintos',
  },

  // ═══ NÍVEL 5 — TEMPO ═══
  {
    id: 'DATE-001',
    categoria: 'datas',
    pergunta: '…hoje',
    operacao: 'DATE_RANGE',
    medir: () => (interpretarPeriodo('hoje') ? 'entende' : null),
    esperado: 'entende',
    causa: 'nenhuma',
  },
  {
    id: 'DATE-002',
    categoria: 'datas',
    pergunta: '…essa semana',
    operacao: 'DATE_RANGE',
    medir: () => (interpretarPeriodo('essa semana') ? 'entende' : null),
    esperado: 'entende',
    causa: 'nenhuma',
  },
  {
    id: 'DATE-003',
    categoria: 'datas',
    pergunta: '…em janeiro',
    operacao: 'DATE_RANGE(mês nomeado)',
    medir: () => (interpretarPeriodo('janeiro') ? 'entende' : null),
    esperado: null,
    causa: 'interpretador',
  },
  {
    id: 'DATE-004',
    categoria: 'datas',
    pergunta: '…no primeiro trimestre',
    operacao: 'DATE_RANGE(trimestre)',
    medir: () => (interpretarPeriodo('primeiro trimestre') ? 'entende' : null),
    esperado: null,
    causa: 'interpretador',
  },
  {
    id: 'DATE-005',
    categoria: 'datas',
    pergunta: '…nos últimos 30 dias',
    operacao: 'DATE_RANGE(janela móvel)',
    medir: () => (interpretarPeriodo('últimos 30 dias') ? 'entende' : null),
    esperado: null,
    causa: 'interpretador',
  },
  {
    id: 'DATE-006',
    categoria: 'datas',
    pergunta: '…entre 01/01 e 31/03',
    operacao: 'DATE_RANGE(intervalo explícito)',
    medir: () => (interpretarPeriodo('entre 01/01 e 31/03') ? 'entende' : null),
    esperado: null,
    causa: 'interpretador',
  },
  {
    id: 'DATE-007',
    categoria: 'datas',
    pergunta: '…ano passado',
    operacao: 'DATE_RANGE(ano relativo)',
    medir: () => (interpretarPeriodo('ano passado') ? 'entende' : null),
    esperado: null,
    causa: 'interpretador',
    nota: 'e mesmo que entendesse, 2025 está fora do alcance da leitura — ver ANO_VIVO',
  },

  // ═══ NÍVEL 6 — COMPARAÇÃO ═══
  {
    id: 'CMP-001',
    categoria: 'comparação',
    pergunta: 'Tivemos mais cargas em 2025 ou 2026?',
    operacao: 'COMPARE(ano)',
    medir: () => null,
    esperado: null,
    causa: 'dados',
    nota: 'a leitura alcança só a aba 2026; comparar anos exige o mapa de colunas das antigas',
  },
  {
    id: 'CMP-002',
    categoria: 'comparação',
    pergunta: 'Qual o crescimento percentual?',
    operacao: 'PERCENTAGE / GROWTH',
    medir: () => null,
    esperado: null,
    causa: 'executor',
  },
  {
    id: 'PCT-001',
    categoria: 'participação',
    pergunta: 'Quanto o LINO representa do total?',
    operacao: 'SHARE',
    /* Derivável: contagem do grupo sobre o total. Ninguém a expõe como métrica,
       mas os dois números existem — é a lacuna mais barata da matriz. */
    medir: () => {
      const total = grupos(CARGAS_2026, 'nenhum')[0].contagem;
      const lino = contarNoGrupo('motorista', 'LINO');
      return lino === null ? null : Math.round((lino / total) * 10000) / 100;
    },
    esperado: Math.round((5 / 12) * 10000) / 100,
    causa: 'executor',
    nota: 'derivável de dois números que já existem; não há métrica de participação',
  },

  // ═══ NÍVEL 7 — QUALIDADE DOS DADOS ═══
  {
    id: 'QUAL-001',
    categoria: 'qualidade',
    pergunta: 'Existem cargas sem motorista?',
    operacao: 'COUNT(campo vazio)',
    medir: () => {
      const g = grupos(CARGAS_2026, 'motorista').find((x) => x.chave === '' || /sem|desconhec/i.test(x.chave));
      return g ? g.contagem : null;
    },
    esperado: ESPERADO.cargas_sem_motorista_2026,
    causa: 'nenhuma',
    nota: 'aparece como grupo próprio na listagem — visível, não silencioso',
  },
  {
    id: 'QUAL-002',
    categoria: 'qualidade',
    pergunta: 'Existem cargas sem valor?',
    operacao: 'COUNT(valor nulo)',
    medir: () => null,
    esperado: null,
    causa: 'executor',
    nota: 'valor nulo soma como zero e não é contado em lugar nenhum',
  },
  {
    id: 'QUAL-003',
    categoria: 'qualidade',
    pergunta: 'Existem cargas duplicadas?',
    operacao: 'DUPLICATE_DETECTION',
    medir: () => null,
    esperado: null,
    causa: 'executor',
  },
];

export function rodarMatriz(casos: readonly CasoCapacidade[] = CASOS): ResultadoCaso[] {
  return casos.map((caso) => {
    const t0 = Date.now();
    let obtido: number | string | null = null;
    let estado: EstadoCapacidade;

    try {
      obtido = caso.medir();
      if (caso.esperado === null) {
        /* A capacidade não deveria existir. Se veio número, ela passou a
           existir — e a matriz é que está velha. */
        estado = obtido === null ? 'UNSUPPORTED' : 'SUPPORTED_PARTIAL';
      } else if (obtido === null) {
        estado = 'UNSUPPORTED';
      } else if (obtido === caso.esperado) {
        estado = caso.causa === 'nenhuma' ? 'SUPPORTED_CORRECT' : 'SUPPORTED_PARTIAL';
      } else {
        estado = 'WRONG_RESULT';
      }
    } catch {
      estado = 'TOOL_ERROR';
    }

    return { ...caso, medir: undefined as never, obtido, estado, ms: Date.now() - t0 };
  });
}
