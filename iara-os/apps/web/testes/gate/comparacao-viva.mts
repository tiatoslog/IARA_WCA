/**
 * A COMPARAÇÃO ENTRE ANOS CONTRA A PLANILHA VIVA — a habilidade real, os dados
 * reais, e a recusa onde tem que haver recusa.
 *
 * Este arquivo CHAMA a implementação. Ele não é o oráculo: quem confere o
 * número é `oraculo-comparacao-anos.mjs`, que refaz a conta do zero. Aqui só se
 * mede o que a IARA de fato responderia.
 *
 *   npx tsx --env-file=.env.local testes/gate/comparacao-viva.mts
 */

import { compararAnosLuft, consultarEstatisticasCargasLuft } from '../../servidor/nucleo/kernel/habilidades/cargasLuft.ts';
import type { ContextoHabilidade } from '../../servidor/nucleo/kernel/Habilidade.ts';
 import { renovarTokenGraph } from '../../servidor/nucleo/ClienteGraph.ts';

/* O token vive em process.env e quem o coloca lá é a renovação automática, que
   só o servidor liga. Fora do servidor, pedimos um uma vez. */
const tok = await renovarTokenGraph();
if (!tok.ok) { console.error('sem token do Graph: ' + tok.motivo); process.exit(1); }

const ctx = (enunciado: string, parametros: Record<string, unknown>): ContextoHabilidade =>
  ({
    sessao: 'gate',
    id_usuario: 'gate',
    parametros,
    sinal: AbortSignal.timeout(240000),
    enunciado,
    registro: null,
    operacao: null,
    defeitos: [],
  }) as unknown as ContextoHabilidade;

const casos: readonly { rotulo: string; hab: typeof compararAnosLuft; enunciado: string; p: Record<string, unknown> }[] = [
  {
    rotulo: 'CARGAS 2025 -> 2026 (tem que sair)',
    hab: compararAnosLuft,
    enunciado: 'compare 2025 com 2026',
    p: { ano_anterior: '2025', ano_atual: '2026', metrica: 'contagem' },
  },
  {
    rotulo: 'CARGAS por central, decomposto (tem que sair)',
    hab: compararAnosLuft,
    enunciado: 'qual central mais caiu de 2025 para 2026',
    p: { ano_anterior: '2025', ano_atual: '2026', metrica: 'contagem', agrupar_por: 'destino' },
  },
  {
    rotulo: 'MOTORISTAS 2024 -> 2026 (tem que sair)',
    hab: compararAnosLuft,
    enunciado: 'tínhamos mais motoristas em 2024?',
    p: { ano_anterior: '2024', ano_atual: '2026', metrica: 'distintos' },
  },
  {
    rotulo: 'FATURAMENTO 2025 -> 2026 (tem que RECUSAR)',
    hab: compararAnosLuft,
    enunciado: 'quanto o faturamento cresceu de 2025 para 2026',
    p: { ano_anterior: '2025', ano_atual: '2026', metrica: 'valor_total' },
  },
  {
    rotulo: 'MARGEM 2025 -> 2026 (tem que RECUSAR)',
    hab: compararAnosLuft,
    enunciado: 'a margem melhorou de 2025 para 2026?',
    p: { ano_anterior: '2025', ano_atual: '2026', metrica: 'margem' },
  },
  {
    rotulo: 'FATURAMENTO de 2025 sozinho (tem que RECUSAR)',
    hab: consultarEstatisticasCargasLuft,
    enunciado: 'qual foi o faturamento de 2025',
    p: { ano: '2025', metrica: 'valor_total' },
  },
  {
    rotulo: 'MARGEM de 2025 sozinha (tem que RECUSAR)',
    hab: consultarEstatisticasCargasLuft,
    enunciado: 'qual a margem de 2025',
    p: { ano: '2025', metrica: 'margem' },
  },
  {
    rotulo: 'CARGAS de 2025 sozinho (tem que SAIR — contar não depende de valor)',
    hab: consultarEstatisticasCargasLuft,
    enunciado: 'quantas cargas em 2025',
    p: { ano: '2025', metrica: 'contagem' },
  },
  {
    rotulo: 'FATURAMENTO de 2026 (tem que SAIR — 99,96% de cobertura)',
    hab: consultarEstatisticasCargasLuft,
    enunciado: 'qual foi o faturamento de 2026',
    p: { ano: '2026', metrica: 'valor_total' },
  },
  {
    rotulo: 'MARGEM de 2026 (tem que SAIR)',
    hab: consultarEstatisticasCargasLuft,
    enunciado: 'qual a margem de 2026',
    p: { ano: '2026', metrica: 'margem' },
  },
];

for (const c of casos) {
  const t0 = Date.now();
  const r = await c.hab.executar(ctx(c.enunciado, c.p));
  console.log(`\n${'='.repeat(78)}\n${c.rotulo}   [resolveu=${r.resolveu}  ${Date.now() - t0}ms]\n${'='.repeat(78)}`);
  console.log(r.texto);
  console.log(`  -- procedência: ${typeof r.detalhe === 'string' ? r.detalhe : JSON.stringify(r.detalhe)}`);
}
