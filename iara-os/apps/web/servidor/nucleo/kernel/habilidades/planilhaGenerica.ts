/**
 * Habilidades de planilha GENÉRICA — qualquer `.xlsx`/`.xls` em
 * `dados/documentos/`, ao contrário de `cargasLuft.ts` (que só conhece a
 * planilha fixa da operação LUFT).
 *
 * Três habilidades, cada uma ancorada numa frase real de operador diferente —
 * mesmo motivo de `cargasLuft.ts` usar quatro para um domínio só:
 * `MotorRaciocinio.planejar()` mostra à LLM só descrição+exemplos do
 * manifesto, nunca o cabeçalho real do arquivo. Ela não pode saber os nomes
 * de coluna no instante em que monta o plano de `consultar_planilha_generica`
 * — por isso a descrição (`descrever_planilha`) vem separada da consulta.
 *
 * `diagnosticar_qualidade_planilha` é a única das três que interpreta em vez
 * de só relatar — e por isso é a única em `dominio: 'cognicao'` /
 * `capacidade: 'raciocinio'`, e a única que devolve HIPÓTESE (com ressalva
 * estrutural, via `enunciarHipotese`) em vez de só fato.
 */

import type { Habilidade } from '../Habilidade';
import { lerPlanilhaGenerica } from '../../PlanilhaGenerica';
import {
  agregarTabela,
  localizarColuna,
  perfilarTabela,
  type MetricaGenerica,
  type ResultadoLocalizacaoColuna,
} from '../AnaliseTabular';
import { diagnosticarPlanilha } from '../DiagnosticoPlanilha';
import { enunciarHipotese } from '../Investigacao';
import { contar } from '../../texto';

const METRICAS_GENERICAS = ['contagem', 'soma', 'media', 'minimo', 'maximo'] as const;

function formatarNumero(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

/** Nunca adivinha: coluna não achada ou ambígua sempre lista o que existe de verdade. */
function mensagemColunaNaoAchada(
  loc: Extract<ResultadoLocalizacaoColuna, { ok: false }>,
  cabecalho: readonly string[],
): string {
  if (loc.candidatas.length > 0) {
    return `${loc.motivo}: ${loc.candidatas.join(', ')}. Diga qual das duas.`;
  }
  return `${loc.motivo}. Colunas disponíveis: ${cabecalho.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// 1. descrever_planilha — leitura pura
// ---------------------------------------------------------------------------

export const descreverPlanilha: Habilidade = {
  manifesto: {
    id: 'descrever_planilha',
    nome: 'Descrever planilha',
    descricao:
      'Lê uma planilha (.xlsx ou .xls) de dados/documentos/ e devolve as abas disponíveis, as colunas ' +
      'do cabeçalho com o tipo predominante de cada uma e quantas linhas de dado tem — sem calcular nada ' +
      'sobre o conteúdo. "arquivo" é o nome do arquivo como está em dados/documentos/; "aba" é opcional ' +
      '(vazio = primeira aba com dado). Use para "o que tem essa planilha", "quais colunas tem o arquivo ' +
      'X.xlsx", "quantas linhas tem essa planilha".',
    exemplos: [
      'O que tem na planilha vendas.xlsx?',
      'Quais colunas tem o arquivo relatorio.xlsx?',
      'Quantas linhas tem essa planilha?',
      'Lê a planilha estoque.xlsx e me diz o que ela contém',
    ],
    capacidades: ['descrever estrutura de planilha', 'listar colunas e abas'],
    dominio: 'automacao',
    capacidade: 'percepcao',
    permissoes: ['banco'],
    timeout_ms: 12000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      arquivo: { tipo: 'texto', obrigatorio: true },
      aba: { tipo: 'texto', padrao: '' },
    },
  },
  async executar(ctx) {
    const arquivo = String(ctx.parametros.arquivo ?? '').trim();
    const aba = String(ctx.parametros.aba ?? '').trim() || undefined;
    const r = await lerPlanilhaGenerica(arquivo, aba);
    if (!r.ok) {
      return { texto: r.motivo, detalhe: `descrever_planilha: ${r.motivo}`, resolveu: false };
    }

    const t = r.tabela;
    const perfis = perfilarTabela(t);
    const linhasColunas = perfis.map((p) => {
      const nulo = p.taxa_nulo > 0 ? `, ${(p.taxa_nulo * 100).toFixed(0)}% vazio` : '';
      return `  • ${p.nome} (${p.tipo_dominante}${nulo})`;
    });
    const outrasAbas = t.abas_disponiveis.filter((a) => a !== t.aba);
    const abasTxt = outrasAbas.length > 0 ? `\nOutras abas neste arquivo: ${outrasAbas.join(', ')}.` : '';
    const truncadaTxt = t.truncada
      ? `\n(mostrando o perfil das primeiras ${t.linhas.length} de ${t.total_linhas} linhas — arquivo grande)`
      : '';

    const texto =
      `"${t.arquivo}" — aba "${t.aba}", ${contar(t.total_linhas, 'linha', 'linhas')} de dado, ` +
      `${contar(t.cabecalho.length, 'coluna', 'colunas')}:\n${linhasColunas.join('\n')}${abasTxt}${truncadaTxt}`;

    return {
      texto,
      detalhe: `arquivo=${t.arquivo} aba=${t.aba} linhas=${t.total_linhas} colunas=${t.cabecalho.length} truncada=${t.truncada}`,
      resolveu: true,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. consultar_planilha_generica — agregação parametrizada
// ---------------------------------------------------------------------------

export const consultarPlanilhaGenerica: Habilidade = {
  manifesto: {
    id: 'consultar_planilha_generica',
    nome: 'Consulta a planilha genérica',
    descricao:
      'Conta, soma, tira média, mínimo ou máximo de uma planilha genérica de dados/documentos/, ' +
      'agrupando por qualquer coluna do cabeçalho REAL do arquivo — não uma lista fixa. "agrupar_por" e ' +
      '"coluna_metrica" recebem o NOME DA COLUNA como foi dito ("por região", "a coluna valor") — a ' +
      'habilidade casa isso com o cabeçalho de verdade; se não achar, ela diz quais colunas existem em ' +
      'vez de adivinhar. "metrica" é um de: contagem, soma, media, minimo, maximo (exige "coluna_metrica" ' +
      'quando não é contagem). "filtro_coluna"/"filtro_valor" filtram por igualdade antes de agregar, ' +
      'ambos opcionais. Use para "quanto vendemos por região", "qual cliente comprou mais", "soma da ' +
      'coluna valor por status".',
    exemplos: [
      'Quanto vendemos por região na planilha vendas.xlsx?',
      'Qual cliente tem mais pedidos no arquivo pedidos.xlsx?',
      'Soma a coluna valor agrupado por status',
      'Quantas linhas tem por categoria?',
    ],
    capacidades: ['agregação genérica de planilha', 'agrupar e somar por coluna qualquer'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['banco'],
    timeout_ms: 15000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      arquivo: { tipo: 'texto', obrigatorio: true },
      aba: { tipo: 'texto', padrao: '' },
      agrupar_por: { tipo: 'texto', padrao: '' },
      metrica: { tipo: 'texto', padrao: 'contagem', dentre: METRICAS_GENERICAS },
      coluna_metrica: { tipo: 'texto', padrao: '' },
      filtro_coluna: { tipo: 'texto', padrao: '' },
      filtro_valor: { tipo: 'texto', padrao: '' },
    },
  },
  async executar(ctx) {
    const arquivo = String(ctx.parametros.arquivo ?? '').trim();
    const aba = String(ctx.parametros.aba ?? '').trim() || undefined;
    const r = await lerPlanilhaGenerica(arquivo, aba);
    if (!r.ok) {
      return { texto: r.motivo, detalhe: `consultar_planilha_generica: ${r.motivo}`, resolveu: false };
    }
    const t = r.tabela;

    const agruparPorTxt = String(ctx.parametros.agrupar_por ?? '').trim();
    const colunaMetricaTxt = String(ctx.parametros.coluna_metrica ?? '').trim();
    const filtroColunaTxt = String(ctx.parametros.filtro_coluna ?? '').trim();
    const filtroValorTxt = String(ctx.parametros.filtro_valor ?? '').trim();
    const metrica = String(ctx.parametros.metrica ?? 'contagem') as MetricaGenerica;

    let indiceAgrupar: number | null = null;
    if (agruparPorTxt) {
      const loc = localizarColuna(t.cabecalho, agruparPorTxt);
      if (!loc.ok) {
        return {
          texto: mensagemColunaNaoAchada(loc, t.cabecalho),
          detalhe: `agrupar_por não resolvido: ${loc.motivo}`,
          resolveu: false,
        };
      }
      indiceAgrupar = loc.indice;
    }

    let indiceMetrica: number | null = null;
    if (metrica !== 'contagem') {
      if (!colunaMetricaTxt) {
        return {
          texto: `Para calcular ${metrica}, preciso saber de qual coluna — diga "coluna_metrica".`,
          detalhe: 'coluna_metrica ausente para métrica numérica',
          resolveu: false,
        };
      }
      const loc = localizarColuna(t.cabecalho, colunaMetricaTxt);
      if (!loc.ok) {
        return {
          texto: mensagemColunaNaoAchada(loc, t.cabecalho),
          detalhe: `coluna_metrica não resolvida: ${loc.motivo}`,
          resolveu: false,
        };
      }
      indiceMetrica = loc.indice;
    }

    let filtro: { indiceColuna: number; valor: string } | undefined;
    if (filtroColunaTxt) {
      if (!filtroValorTxt) {
        return {
          texto: 'Você informou a coluna do filtro mas não o valor — diga "filtro_valor".',
          detalhe: 'filtro_valor ausente com filtro_coluna informado',
          resolveu: false,
        };
      }
      const loc = localizarColuna(t.cabecalho, filtroColunaTxt);
      if (!loc.ok) {
        return {
          texto: mensagemColunaNaoAchada(loc, t.cabecalho),
          detalhe: `filtro_coluna não resolvida: ${loc.motivo}`,
          resolveu: false,
        };
      }
      filtro = { indiceColuna: loc.indice, valor: filtroValorTxt };
    }

    const grupos = [...agregarTabela(t, indiceAgrupar, metrica, indiceMetrica, filtro)].sort((a, b) =>
      metrica === 'contagem' ? b.contagem - a.contagem : (b.valor ?? 0) - (a.valor ?? 0),
    );

    if (grupos.length === 0) {
      return {
        texto: 'Nenhuma linha encontrada com esses critérios.',
        detalhe: `arquivo=${t.arquivo} grupos=0`,
        resolveu: true,
      };
    }

    const TOPO = 15;
    const linhas = grupos.slice(0, TOPO).map((g, i) => {
      const cauda =
        metrica === 'contagem'
          ? `${g.contagem} linha${g.contagem === 1 ? '' : 's'}`
          : `${formatarNumero(g.valor ?? 0)} (${g.contagem} linha${g.contagem === 1 ? '' : 's'})`;
      return indiceAgrupar === null ? cauda : `${i + 1}. ${g.chave} — ${cauda}`;
    });
    const resto = grupos.length > TOPO ? `\n… e mais ${grupos.length - TOPO} grupo(s).` : '';

    return {
      texto: linhas.join('\n') + resto,
      detalhe:
        `arquivo=${t.arquivo} aba=${t.aba} agrupar_por=${indiceAgrupar !== null ? t.cabecalho[indiceAgrupar] : 'nenhum'} ` +
        `metrica=${metrica} grupos=${grupos.length}`,
      resolveu: true,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. diagnosticar_qualidade_planilha — camada de hipótese
// ---------------------------------------------------------------------------

export const diagnosticarQualidadePlanilha: Habilidade = {
  manifesto: {
    id: 'diagnosticar_qualidade_planilha',
    nome: 'Diagnóstico de qualidade de planilha',
    descricao:
      'Analisa a qualidade dos dados de uma planilha de dados/documentos/: valores numéricos fora do ' +
      'padrão estatístico (outlier pela cerca de Tukey), colunas com taxa de vazio anormal, colunas ' +
      'dominadas por um único valor e linhas duplicadas — todas por convenção estatística padrão, nunca ' +
      'por regra de negócio do domínio representado na planilha. Levanta hipóteses sobre ONDE o dado é ' +
      'suspeito, com o grau de confiança que as evidências sustentam; nunca afirma a causa de negócio ' +
      '(atraso, erro de operação etc.). Use para "tem algo estranho nesses dados", "analisa a qualidade ' +
      'da planilha X", "essa planilha tem erro?".',
    exemplos: [
      'Essa planilha tem algum problema?',
      'Analisa a qualidade dos dados de vendas.xlsx',
      'Tem algo estranho nesses dados?',
      'Encontra anomalias na planilha estoque.xlsx',
    ],
    capacidades: ['diagnóstico de qualidade de dado', 'detectar outlier e duplicata em planilha'],
    dominio: 'cognicao',
    capacidade: 'raciocinio',
    permissoes: ['banco'],
    timeout_ms: 20000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      arquivo: { tipo: 'texto', obrigatorio: true },
      aba: { tipo: 'texto', padrao: '' },
    },
  },
  async executar(ctx) {
    const arquivo = String(ctx.parametros.arquivo ?? '').trim();
    const aba = String(ctx.parametros.aba ?? '').trim() || undefined;
    const r = await lerPlanilhaGenerica(arquivo, aba);
    if (!r.ok) {
      return { texto: r.motivo, detalhe: `diagnosticar_qualidade_planilha: ${r.motivo}`, resolveu: false };
    }

    const t = r.tabela;
    const diagnostico = diagnosticarPlanilha(t);
    const truncadaTxt = t.truncada
      ? `\n(analisei só as primeiras ${t.linhas.length} de ${t.total_linhas} linhas)`
      : '';

    if (diagnostico.anomalias.length === 0) {
      return {
        texto: `Não encontrei nada fora do padrão estatístico em "${t.arquivo}" (aba "${t.aba}").${truncadaTxt}`,
        detalhe: `arquivo=${t.arquivo} anomalias=0`,
        resolveu: true,
      };
    }

    const linhasAnomalias = diagnostico.anomalias.map((a) => `  • ${a.descricao} (${a.severidade})`);
    const linhasHipoteses = diagnostico.hipoteses.map((h) => `  • ${enunciarHipotese(h)}.`);
    const lacunasTxt =
      diagnostico.lacunas.length > 0
        ? `\n\nO que não pude analisar:\n${diagnostico.lacunas.map((l) => `  • ${l}`).join('\n')}`
        : '';

    const texto =
      `Em "${t.arquivo}" (aba "${t.aba}"), o que está fora do padrão:\n${linhasAnomalias.join('\n')}\n\n` +
      `O que eu acho que isso indica:\n${linhasHipoteses.join('\n')}${lacunasTxt}${truncadaTxt}`;

    return {
      texto,
      detalhe: `arquivo=${t.arquivo} anomalias=${diagnostico.anomalias.length} hipoteses=${diagnostico.hipoteses.length}`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_PLANILHA_GENERICA: readonly Habilidade[] = [
  descreverPlanilha,
  consultarPlanilhaGenerica,
  diagnosticarQualidadePlanilha,
];
