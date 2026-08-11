/**
 * Testes do Verifier — a quinta porta.
 *
 * A pergunta que esta suíte responde: **quando a IARA diz que fez, ela
 * consegue provar?**
 *
 * O caso central não é o feliz. É o caso em que o executor devolve sucesso e o
 * mundo discorda — porque é exatamente ali que um sistema de agente vira
 * mentiroso sem ninguém notar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { GerenciadorHabilidades } from '../servidor/nucleo/kernel/GerenciadorHabilidades';
import type { Habilidade, Verificacao } from '../servidor/nucleo/kernel/Habilidade';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { criarPasta } from '../servidor/nucleo/kernel/habilidades/agenteLocal';
import {
  confirmaAcontecimento,
  maisForte,
  podeAfirmarSemRessalva,
  VERBO_DO_ESTADO,
  type Afirmacao,
} from '../servidor/nucleo/kernel/Verdade';

const CONCEDIDAS = ['rede', 'banco', 'memoria', 'llm', 'escrita', 'externo'] as const;

function pedido(id: string, parametros: Record<string, unknown> = {}) {
  return {
    id,
    parametros,
    enunciado: 'teste',
    id_usuario: 'operador_teste',
    sessao: 's1',
    sinal: new AbortController().signal,
    concedidas: [...CONCEDIDAS],
  };
}

function dubl(
  id: string,
  risco: 'baixo' | 'medio' | 'alto',
  verificacao?: Verificacao | (() => never),
): Habilidade {
  return {
    manifesto: {
      id,
      nome: id,
      descricao: 'habilidade de teste com descrição suficientemente longa para o contrato',
      dominio: 'automacao',
      capacidade: 'automacao',
      permissoes: [],
      timeout_ms: 1000,
      custo: 'zero',
      risco,
      esquema: {},
    },
    async executar() {
      // O executor SEMPRE relata sucesso. É o ponto do teste.
      return { texto: 'feito', detalhe: 'executor devolveu ok', resolveu: true };
    },
    ...(verificacao
      ? {
          async verificar() {
            if (typeof verificacao === 'function') verificacao();
            return verificacao as Verificacao;
          },
        }
      : {}),
  };
}

// ---------------------------------------------------------------------------
// 1. Execução não é verdade
// ---------------------------------------------------------------------------

test('executor diz sucesso e o mundo discorda → estado falhou, nunca verificado', async () => {
  const g = new GerenciadorHabilidades(new BarramentoEventos('sessao-teste'));
  g.registrar(
    dubl('mente', 'medio', {
      confirmado: false,
      evidencia: 'o arquivo não existe depois da execução',
      motivo: 'divergente',
    }),
  );

  const v = await g.executarVerificando(pedido('mente'));

  assert.equal(v.resultado.resolveu, true, 'o executor relatou sucesso');
  assert.equal(v.verificacao?.confirmado, false, 'mas o mundo não confirmou');
  assert.equal(v.estado, 'falhou');
  assert.equal(confirmaAcontecimento(v.estado), false, 'não pode dizer que aconteceu');
});

test('sem meio de verificar → desconhecido, não sucesso e não falha', async () => {
  const g = new GerenciadorHabilidades(new BarramentoEventos('sessao-teste'));
  g.registrar(
    dubl('opaca', 'medio', {
      confirmado: false,
      evidencia: 'processo desanexado; não observável',
      motivo: 'sem_meio_de_verificar',
    }),
  );

  const v = await g.executarVerificando(pedido('opaca'));
  assert.equal(v.estado, 'desconhecido');
  assert.equal(confirmaAcontecimento(v.estado), false);
  assert.match(VERBO_DO_ESTADO[v.estado], /não consigo provar/);
});

test('habilidade de risco médio SEM verificador termina em desconhecido', async () => {
  const g = new GerenciadorHabilidades(new BarramentoEventos('sessao-teste'));
  g.registrar(dubl('descuidada', 'medio'));

  const v = await g.executarVerificando(pedido('descuidada'));
  assert.equal(v.estado, 'desconhecido', 'ausência de verificação nunca vira sucesso');
  assert.equal(v.verificacao, null);
});

test('verificador que lança vira desconhecido, não derruba o turno', async () => {
  const g = new GerenciadorHabilidades(new BarramentoEventos('sessao-teste'));
  g.registrar(
    dubl('quebrada', 'medio', () => {
      throw new Error('disco fora do ar');
    }),
  );

  const v = await g.executarVerificando(pedido('quebrada'));
  assert.equal(v.estado, 'desconhecido');
  assert.match(v.verificacao!.evidencia, /disco fora do ar/);
});

test('risco baixo sem verificador é verificado — a resposta é o resultado', async () => {
  const g = new GerenciadorHabilidades(new BarramentoEventos('sessao-teste'));
  g.registrar(dubl('leitura', 'baixo'));

  const v = await g.executarVerificando(pedido('leitura'));
  assert.equal(v.estado, 'verificado');
});

test('o barramento registra a apuração separada do relato', async () => {
  const barramento = new BarramentoEventos('sessao-teste');
  const vistos: string[] = [];
  barramento.assinarTudo((e) => vistos.push(e.tipo));

  const g = new GerenciadorHabilidades(barramento);
  g.registrar(dubl('auditada', 'medio', { confirmado: true, evidencia: 'confere' }));
  await g.executarVerificando(pedido('auditada'));

  assert.ok(vistos.includes('HABILIDADE_CONCLUIDA'), 'relato do executor');
  assert.ok(vistos.includes('HABILIDADE_VERIFICADA'), 'apuração do mundo');
});

// ---------------------------------------------------------------------------
// 2. Verificação real contra o disco
// ---------------------------------------------------------------------------

test('criar_pasta confirma contra o disco e detecta ausência', async (t) => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-verif-'));
  t.after(() => rmSync(raiz, { recursive: true, force: true }));

  const ctx = {
    sessao: 's1',
    id_usuario: 'operador_teste',
    parametros: { nome: 'Relatorios', local: 'downloads' },
    sinal: new AbortController().signal,
    enunciado: 'crie uma pasta chamada Relatorios',
  };
  const relato = { texto: 'Pasta criada', detalhe: '', resolveu: true };

  // A verificação consulta a raiz REAL da máquina. Se Downloads não existe
  // aqui, o próprio verificador diz isso — que já é o comportamento correto.
  const v = await criarPasta.verificar!(relato, ctx);

  if (v.confirmado) {
    assert.match(v.evidencia, /diret[óo]rio existe/);
  } else {
    assert.ok(
      v.motivo === 'divergente' || v.motivo === 'nao_encontrado',
      `motivo inesperado: ${v.motivo}`,
    );
    // O ponto: relato de sucesso + pasta ausente NUNCA vira confirmação.
    assert.equal(v.confirmado, false);
  }
});

test('criar_pasta com nome inválido não confirma nada', async () => {
  const v = await criarPasta.verificar!(
    { texto: 'x', detalhe: '', resolveu: false },
    {
      sessao: 's1',
      id_usuario: 'operador_teste',
      parametros: { nome: '../escapando', local: 'downloads' },
      sinal: new AbortController().signal,
      enunciado: 'x',
    },
  );
  assert.equal(v.confirmado, false);
  assert.equal(v.motivo, 'nao_encontrado');
});

// ---------------------------------------------------------------------------
// 3. Contrato do catálogo: quem mexe no mundo tem que saber se conferir
// ---------------------------------------------------------------------------

test('toda habilidade de risco médio ou alto declara verificação', () => {
  const faltando = CATALOGO.filter((h) => h.manifesto.risco !== 'baixo' && !h.verificar).map(
    (h) => `${h.manifesto.id} (${h.manifesto.risco})`,
  );
  assert.deepEqual(
    faltando,
    [],
    `habilidades que alteram o mundo sem saber se verificar:\n${faltando.join('\n')}`,
  );
});

test('toda habilidade que pede escrita ou externo tem risco acima de baixo', () => {
  const frouxas = CATALOGO.filter(
    (h) =>
      (h.manifesto.permissoes.includes('escrita') || h.manifesto.permissoes.includes('externo')) &&
      h.manifesto.risco === 'baixo',
  ).map((h) => h.manifesto.id);
  assert.deepEqual(frouxas, []);
});

// ---------------------------------------------------------------------------
// 4. Camada de verdade
// ---------------------------------------------------------------------------

test('procedência forte vence recência — memória nova não derruba fato verificado', () => {
  const fato: Afirmacao = {
    conteudo: 'o relatório sai às 16h',
    procedencia: 'fato_verificado',
    origem: 'consultar_agenda',
    instante: '2026-08-10T10:00:00.000Z',
  };
  const memoriaNova: Afirmacao = {
    conteudo: 'o relatório sai às 17h',
    procedencia: 'memoria',
    origem: 'shard',
    instante: '2026-08-11T10:00:00.000Z',
  };
  assert.equal(maisForte(fato, memoriaNova).conteudo, 'o relatório sai às 16h');
});

test('dentro da MESMA procedência, a mais recente vence', () => {
  const antiga: Afirmacao = {
    conteudo: '16h',
    procedencia: 'memoria',
    origem: 'shard',
    instante: '2026-08-01T10:00:00.000Z',
  };
  const nova: Afirmacao = {
    conteudo: '17h',
    procedencia: 'memoria',
    origem: 'shard',
    instante: '2026-08-11T10:00:00.000Z',
  };
  assert.equal(maisForte(antiga, nova).conteudo, '17h');
});

test('resultado de ferramenta não sustenta afirmação sem ressalva', () => {
  assert.equal(podeAfirmarSemRessalva('resultado_ferramenta'), false);
  assert.equal(podeAfirmarSemRessalva('memoria'), false);
  assert.equal(podeAfirmarSemRessalva('inferencia'), false);
  assert.equal(podeAfirmarSemRessalva('fato_verificado'), true);
  assert.equal(podeAfirmarSemRessalva('fato'), true);
});

test('o verbo de "executado" nunca afirma conclusão', () => {
  assert.doesNotMatch(VERBO_DO_ESTADO.executado, /\bfeito\b|\bpronto\b|conclu/i);
  assert.match(VERBO_DO_ESTADO.executado, /não consegui confirmar/);
  assert.match(VERBO_DO_ESTADO.verificado, /confirmado/);
});
