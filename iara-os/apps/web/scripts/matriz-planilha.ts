/**
 * Roda a matriz de capacidades e escreve `docs/spreadsheet-capability-matrix.md`.
 *
 * O documento é GERADO, nunca escrito à mão: uma matriz mantida a dedo vira
 * ficção no primeiro dia em que alguém conserta algo e esquece de atualizá-la.
 *
 *   node --import tsx scripts/matriz-planilha.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rodarMatriz, type EstadoCapacidade } from '../testes/planilha/matriz';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..');

const CAUSA_LEGIVEL: Record<string, string> = {
  dados: 'dados — a informação não está na fonte',
  executor: 'executor — o motor não sabe calcular',
  interpretador: 'interpretador — a expressão não é entendida',
  api: 'api — o contrato entre camadas não expressa',
  modelo: 'modelo — depende de a LLM acertar',
  nenhuma: '—',
};

const resultados = rodarMatriz();

const contagem = resultados.reduce<Record<string, number>>((acc, r) => {
  acc[r.estado] = (acc[r.estado] ?? 0) + 1;
  return acc;
}, {});

const ORDEM: EstadoCapacidade[] = [
  'SUPPORTED_CORRECT',
  'SUPPORTED_PARTIAL',
  'WRONG_RESULT',
  'UNSUPPORTED',
  'UNSAFE_TO_ANSWER',
  'TOOL_ERROR',
  'TIMEOUT',
  'AMBIGUOUS',
  'NOT_APPLICABLE',
  'NOT_TESTED',
];

const fmt = (v: number | string | null): string =>
  v === null ? '—' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : v;

const linhas = resultados
  .map(
    (r) =>
      `| ${r.id} | ${r.categoria} | ${r.pergunta} | \`${r.operacao}\` | ${fmt(r.esperado)} | ${fmt(r.obtido)} | **${r.estado}** | ${CAUSA_LEGIVEL[r.causa]} |`,
  )
  .join('\n');

const porCausa = resultados
  .filter((r) => r.estado === 'UNSUPPORTED' || r.estado === 'SUPPORTED_PARTIAL')
  .reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.causa] ??= []).push(`${r.id} — ${r.pergunta}${r.nota ? ` *(${r.nota})*` : ''}`);
    return acc;
  }, {});

const doc = `# IARA — matriz de capacidades de análise de planilha

> **GERADO POR EXECUÇÃO.** Não editar à mão: rode
> \`node --import tsx scripts/matriz-planilha.ts\`. Uma matriz mantida a dedo vira
> ficção no primeiro conserto que ninguém anotar.

Cada linha foi **medida** contra o oráculo de \`testes/planilha/oraculo.ts\` — vinte
cargas cujas respostas foram contadas à mão, nunca derivadas do código sob teste.

## O que esta matriz mede — e o que não mede

Mede o **motor determinístico**: \`agregarCargas\`, \`interpretarPeriodo\` e o
contrato de \`CargaCompleta\`.

**Não mede** se a LLM escolhe a habilidade certa e passa os parâmetros certos.
Motor correto com roteamento errado continua entregando resposta errada ao
operador — foi exatamente o que aconteceu com \`agrupar_por\` em 18/08/2026. Esse
caminho é medido pelo gate de produto (\`testes/gate/produto.mjs\`), contra a
interface real. As duas medições são necessárias e nenhuma substitui a outra.

## Resumo

| Estado | Quantidade |
| --- | ---: |
${ORDEM.filter((e) => contagem[e]).map((e) => `| ${e} | ${contagem[e]} |`).join('\n')}
| **Total** | **${resultados.length}** |

## A matriz

| ID | Categoria | Pergunta | Operação | Esperado | Obtido | Estado | Causa |
| --- | --- | --- | --- | --- | --- | --- | --- |
${linhas}

## Lacunas por causa técnica

${Object.entries(porCausa)
  .map(([causa, itens]) => `### ${CAUSA_LEGIVEL[causa]}\n\n${itens.map((i) => `- ${i}`).join('\n')}`)
  .join('\n\n')}

## Vocabulário real

**Entidades que existem** em \`CargaCompleta\`: \`oci\`, \`origem\`, \`uf_origem\`,
\`destino\`, \`uf_destino\`, \`motorista\`, \`data_rec_oci\`, \`data_coleta\`,
\`data_descarga\`, \`status\`, \`status_normalizado\`, \`valor\`.

**Entidade que NÃO existe:** \`cliente\`. Não há coluna de cliente na planilha —
toda a família "por cliente" é lacuna de **dados**, não de código, e implementar
agrupamento não a resolveria.

**Operações que existem:** \`COUNT\`, \`SUM\`, \`GROUP_BY\` (seis dimensões),
\`FILTER\` por período, \`SORT\` (na habilidade, não no motor).

**Operações NÃO IMPLEMENTADAS:** \`AVG\` nativa (hoje derivada de total/contagem),
\`MIN\`, \`MAX\`, \`DISTINCT\`, \`COMPARE\` entre anos, \`PERCENTAGE\`, detecção de
duplicidade, agrupamento por mês/ano/UF.
`;

mkdirSync(path.join(APP, 'docs'), { recursive: true });
const destino = path.join(APP, 'docs', 'spreadsheet-capability-matrix.md');
writeFileSync(destino, doc);

console.log(`matriz escrita em ${destino}`);
for (const e of ORDEM) if (contagem[e]) console.log(`  ${e.padEnd(20)} ${contagem[e]}`);
