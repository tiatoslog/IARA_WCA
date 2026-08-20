/**
 * FASE 1 — INVENTÁRIO TOTAL, extraído do SISTEMA e não de uma lista.
 *
 * Importa os mesmos objetos que o Kernel oferece à LLM e que o portal oferece
 * ao mundo. Nada aqui é digitado à mão: se uma habilidade sumir do catálogo,
 * ela some daqui junto.
 */
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades/index';
import { INTEGRACOES } from '../../servidor/nucleo/kernel/integracoes';
import { ACOES_DESKTOP } from '../../lib/execucao';
import { renovarTokenGraph } from '../../servidor/nucleo/ClienteGraph';

/**
 * O MOTOR TROCA CREDENCIAL DE APP POR TOKEN NA SUBIDA, e sem repetir esse passo
 * a sonda mede o ambiente ERRADO: `indisponivelPorque()` procura
 * `MS_GRAPH_TOKEN`, que só existe depois da renovação. A primeira versão deste
 * arquivo reportou onze habilidades indisponíveis que estão perfeitamente
 * disponíveis no processo do motor.
 */
const graph = await renovarTokenGraph().catch(() => ({ ok: false as const, motivo: 'sonda falhou' }));
console.error(`[sonda] Graph: ${graph.ok ? 'token renovado' : `sem token (${(graph as { motivo?: string }).motivo})`}`);

const linhas: Record<string, unknown>[] = [];

for (const h of CATALOGO) {
  const m = h.manifesto;
  linhas.push({
    tipo: 'habilidade',
    id: m.id,
    dominio: m.dominio,
    capacidade: m.capacidade,
    risco: m.risco,
    idempotencia: m.idempotencia,
    custo: m.custo,
    permissoes: (m.permissoes ?? []).join('|'),
    planejavel: m.planejavel_pela_llm !== false,
    confirmacao_previa: m.confirmacao_previa === true,
    verificacao_obrigatoria: m.verificacao_obrigatoria === true,
    tem_verificador: typeof h.verificar === 'function',
    tem_indisponivel: typeof h.indisponivelPorque === 'function',
    indisponivel_agora: typeof h.indisponivelPorque === 'function' ? h.indisponivelPorque() : null,
    parametros: Object.keys(m.esquema ?? {}).join('|'),
  });
}

for (const i of INTEGRACOES) {
  linhas.push({
    tipo: 'integracao',
    id: i.id,
    dominio: '—',
    capacidade: '—',
    risco: i.risco,
    idempotencia: i.semantica,
    custo: '—',
    permissoes: '—',
    planejavel: false,
    tem_verificador: typeof i.verificar === 'function',
    tem_indisponivel: typeof i.indisponivelPorque === 'function',
    indisponivel_agora: typeof i.indisponivelPorque === 'function' ? i.indisponivelPorque() : null,
    parametros: Object.keys(i.esquema ?? {}).join('|'),
  });
}

for (const a of ACOES_DESKTOP) {
  linhas.push({ tipo: 'acao_desktop', id: a, dominio: 'braco', capacidade: 'automacao' });
}

console.log(JSON.stringify(linhas, null, 1));
