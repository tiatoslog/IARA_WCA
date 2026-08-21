/**
 * O INTERPRETADOR NÃO ALCANÇA O MUNDO — verificado no código, não prometido.
 *
 * A REGRA (ordem de 21/08/2026, §5). A camada de compreensão produz "acho que o
 * operador quis dizer X" e nada mais. Ela não chama ferramenta, não executa
 * habilidade, não escreve arquivo, não agenda, não envia mensagem, não toca
 * memória operacional, não liga nem desliga máquina.
 *
 * POR QUE ISSO PRECISA DE UM TESTE DE ARQUITETURA e não de disciplina. A camada
 * nova é a PRIMEIRA a ver a mensagem, antes do porteiro, antes do jornal, antes
 * do esquema. Se um dia ela ganhar um atalho para "já que eu entendi, eu
 * executo", esse atalho passa por fora de todas as portas que este repositório
 * construiu — e o pior é que ele pareceria uma otimização razoável no dia em que
 * fosse escrito.
 *
 * É o mesmo mecanismo de `fronteira-efeitos.test.ts` (que confina `execFile` ao
 * `AgenteLocal`) e de `fronteira-interna.test.ts`: ler o fonte e falhar por
 * import, não por comportamento observado. Pega a violação que ainda não existe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  aplicarRefinamento,
  compreender,
  REFERENTE_DESCONHECIDO,
  type ContratoSemantico,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const ARQUIVO = path.join(process.cwd(), 'servidor/nucleo/kernel/CompreensaoSemantica.ts');

/**
 * COMENTÁRIO FORA — a varredura é de CÓDIGO.
 *
 * A primeira versão deste teste ficou vermelha por causa do próprio cabeçalho
 * do módulo, que cita `execFile` ao explicar de qual outro teste esta disciplina
 * veio. Um detector que dispara na prosa não está medindo o que o módulo FAZ;
 * está medindo o que ele MENCIONA — e o efeito prático seria ensinar quem
 * escreve a não documentar a regra, que é o oposto do que se quer.
 */
const FONTE = readFileSync(ARQUIVO, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
// 1. Teste de arquitetura — o que a camada pode importar
// ---------------------------------------------------------------------------

/**
 * A LISTA BRANCA, e ela é curta porque precisa ser. Qualquer import fora daqui
 * é um caminho novo para o mundo e tem de ser discutido, não introduzido de
 * passagem. `DescobertaCapacidades` entra só como `import type` mais a classe
 * de leitura do índice — ela própria é pura.
 */
const IMPORTS_PERMITIDOS = [
  '../texto',
  './PeriodoOperacional',
  './DescobertaCapacidades',
  './IndiceConceitual',
  /**
   * `Habilidade` é o CONTRATO do catálogo: tipos e nada mais — nenhum executor,
   * nenhuma porta para o mundo. Entrou quando a operação de uma habilidade
   * deixou de ser inferida do `id` e passou a ser lida do manifesto, que é a
   * direção certa da dependência (o catálogo declara, a política lê).
   *
   * A régua desta lista continua sendo a mesma: só módulo PURO. Um dia em que
   * alguém quiser acrescentar aqui algo que alcança o mundo, a discussão é
   * arquitetural — não se resolve editando esta linha.
   */
  './Habilidade',
];

test('a camada de compreensão só importa módulos puros', () => {
  const imports = [...FONTE.matchAll(/^import[^;]*?from '([^']+)';/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0, 'o teste tem que estar lendo os imports de verdade');
  for (const i of imports) {
    assert.ok(
      IMPORTS_PERMITIDOS.includes(i),
      `import não autorizado na camada de interpretação: "${i}".\n` +
        `    Interpretar não executa. Se este módulo é mesmo necessário, a discussão é ` +
        `arquitetural — não se resolve acrescentando ele à lista branca.`,
    );
  }
});

test('nenhum verbo de efeito aparece no fonte da camada', () => {
  /**
   * A busca é por CAPACIDADE, não por nome de função da casa: `fs`, `child_process`,
   * `fetch` e `execFile` são as portas para o mundo em Node, e nenhuma delas tem
   * o que fazer num módulo que só lê uma string e devolve estrutura.
   */
  const proibidos = [
    /\bfrom 'node:fs'/,
    /\bfrom 'node:child_process'/,
    /\bfrom 'node:https?'/,
    /\bfetch\s*\(/,
    /\bexecFile\b/,
    /\bspawn\b/,
    /\bwriteFileSync\b/,
    /\bprocess\.env\b/,
  ];
  for (const re of proibidos) {
    assert.ok(!re.test(FONTE), `a camada de interpretação não pode conter ${re} — ela interpreta, não age`);
  }
});

test('a camada não lê o relógio por conta própria', () => {
  /**
   * `Date.now()` ou `new Date()` sem argumento fariam a mesma frase produzir
   * contratos diferentes conforme a hora — e toda a medição de invariância
   * viraria ruído. O `agora` entra por parâmetro, e é isso que torna o módulo
   * testável cem vezes seguidas.
   */
  assert.ok(!/\bDate\.now\(\)/.test(FONTE), 'relógio próprio quebra o determinismo da compreensão');
  assert.ok(!/new Date\(\s*\)/.test(FONTE), 'relógio próprio quebra o determinismo da compreensão');
});

// ---------------------------------------------------------------------------
// 2. Teste de comportamento — o refinador não pode alargar
// ---------------------------------------------------------------------------

const descoberta = new DescobertaCapacidades(CATALOGO.map((h) => h.manifesto));
const habilidades = CATALOGO.map((h) => h.manifesto);
const AGORA = new Date('2026-08-19T10:00:00');
const ler = (bruto: string) => compreender({ bruto, descoberta, agora: AGORA, habilidades });

/**
 * O REFINADOR HOSTIL. Não é um mock do que está sob teste — o que está sob teste
 * é `aplicarRefinamento`, e este objeto é o mundo: uma etapa cognitiva que
 * devolve exatamente o que uma LLM confusa (ou uma página maliciosa que ela
 * leu) devolveria se pudesse escolher.
 */
function proporTudo(base: ContratoSemantico): ContratoSemantico {
  return {
    ...base,
    objetivo: 'acionar_energia',
    periodo: '1999-01-01..1999-01-01',
    referente: { literal: 'computador', conceito: 'o computador da Marina', origem: 'literal' as const, score: 1, alias_semantico: true, pendente: false },
    ato: 'solicitar_acao',
  };
}

test('refinamento não pode inventar objetivo fora das hipóteses', () => {
  const base = ler('quantas cargas essa semana?');
  const { contrato, recusas } = aplicarRefinamento(base, proporTudo(base));

  assert.notEqual(contrato.objetivo, 'acionar_energia', 'desligar a máquina não estava entre as hipóteses');
  assert.equal(contrato.objetivo, base.objetivo, 'o objetivo determinístico fica de pé');
  assert.ok(
    recusas.some((r) => r.includes('acionar_energia')),
    `a recusa tem que ser registrada, não silenciosa (veio ${JSON.stringify(recusas)})`,
  );
});

test('refinamento não pode fabricar período', () => {
  const base = ler('quantas cargas essa semana?');
  const { contrato, recusas } = aplicarRefinamento(base, proporTudo(base));
  assert.equal(contrato.periodo, base.periodo, 'data é aritmética de calendário, não opinião de modelo');
  assert.ok(recusas.some((r) => r.includes('período')));
});

test('refinamento não resolve referente desconhecido sem contexto', () => {
  const base = ler('e aquele segundo?');
  assert.equal(base.referente.conceito, REFERENTE_DESCONHECIDO);
  const { contrato, recusas } = aplicarRefinamento(base, proporTudo(base));
  assert.equal(
    contrato.referente.conceito,
    REFERENTE_DESCONHECIDO,
    'resolver anáfora exige o turno anterior, que não passa por esta camada',
  );
  assert.ok(recusas.some((r) => r.includes('referente')));
});

test('refinamento PODE estreitar — marcar ambígua é sempre permitido', () => {
  /**
   * A assimetria é o contrato inteiro, e é a mesma de `Autonomia.ts`: a camada
   * de cima pode IMPEDIR, nunca PERMITIR o que as travas de baixo não
   * permitiriam. Sem este teste, "o refinador não faz nada" passaria pelos três
   * anteriores e a costura seria decorativa.
   */
  const base = ler('lista os arquivos');
  const { contrato } = aplicarRefinamento(base, { ...base, ato: 'ambigua' });
  assert.equal(contrato.ato, 'ambigua', 'reconhecer que não sabe é sempre autorizado');
});

test('sem refinador, o contrato determinístico passa intacto', () => {
  const base = ler('lista os arquivos');
  const { contrato, recusas } = aplicarRefinamento(base, null);
  assert.deepEqual(contrato, base);
  assert.equal(recusas.length, 0);
});
