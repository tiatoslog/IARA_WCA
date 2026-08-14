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
import { cargasNoPeriodo } from '../../ClientePlanilhaOcis';
import { planilhaOcisDisponivel } from '../../ClientePlanilhaOcis';
import { interpretarPeriodo } from '../PeriodoOperacional';

export const consultarCargasLuft: Habilidade = {
  manifesto: {
    id: 'consultar_cargas_luft',
    nome: 'Cargas da operação LUFT',
    descricao:
      'Conta e lista as cargas (OCIs) com coleta marcada num período, lendo a planilha oficial da ' +
      'operação LUFT. O parâmetro "periodo" recebe a EXPRESSÃO como foi dita ("hoje", "amanhã", ' +
      '"essa semana", "17/08") — não calcule a data, quem interpreta é o motor. Use para "quantas ' +
      'cargas vamos coletar hoje/amanhã", "o que temos essa semana", "cargas do dia 17/08".',
    dominio: 'operacoes',
    capacidade: 'automacao',
    permissoes: ['rede', 'banco'],
    timeout_ms: 15000,
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

export const HABILIDADES_PLANILHA_OCIS: readonly Habilidade[] = [consultarCargasLuft];
