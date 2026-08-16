/**
 * Cadeia cognitiva projetada — FASE A (Capability Intelligence).
 *
 * O painel técnico mostra INTENÇÃO → CAPACIDADE → PLANO → EXECUÇÃO →
 * VERIFICAÇÃO → RESPOSTA do último turno, e a única fonte disso é o
 * `CompiladorSnapshot` absorvendo os eventos que o barramento JÁ publicava.
 * Estes testes provam as duas propriedades que impedem o painel de mentir:
 *
 *   1. Cada elo vem do SEU evento — elo sem evento não aparece.
 *   2. Turno novo zera a cadeia — nunca se misturam dois turnos.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../servidor/nucleo/kernel/CompiladorSnapshot';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import type { Plano } from '../servidor/nucleo/kernel/Evento';

function montar() {
  const barramento = new BarramentoEventos('s-cadeia');
  const compilador = new CompiladorSnapshot(barramento, new MemoriaTrabalho());
  const estado = new EstadoAtomico();
  return { barramento, compilador, estado };
}

const percepcao = new MotorPercepcao();

test('antes do primeiro turno, a cadeia é null — não uma cadeia vazia com cara de turno', () => {
  const { compilador, estado } = montar();
  const s = compilador.compilar(estado.instantaneo(), 's-cadeia', 0);
  assert.equal(s.cadeia, null);
});

test('um turno completo projeta todos os elos, cada um vindo do seu evento', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();

  const plano: Plano = {
    objetivo: 'contar as cargas de hoje',
    origem: 'emergente',
    passos: [
      {
        indice: 0,
        descricao: 'consultar a planilha da LUFT',
        habilidade: 'consultar_cargas_luft',
        parametros: { periodo: 'hoje' },
      },
    ],
  };

  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'Quantas cargas hoje?', id_mensagem: 'op:teste' });
  barramento.publicar({
    tipo: 'PERCEPCAO_CONCLUIDA',
    percepcao: percepcao.perceber('Quantas cargas foram coletadas hoje?'),
  });
  barramento.publicar({
    tipo: 'DECISAO_TOMADA',
    rota: 'plano_cognitivo',
    justificativa: 'pergunta de fato sobre a operação',
    custo_estimado: 'tokens',
  });
  barramento.publicar({ tipo: 'PLANO_CRIADO', plano });
  barramento.publicar({ tipo: 'PASSO_INICIADO', passo: plano.passos[0], total: 1 });
  barramento.publicar({
    tipo: 'PASSO_CONCLUIDO',
    passo: plano.passos[0],
    resumo: 'planilha LUFT, período hoje (4 cargas)',
    ms: 120,
  });
  barramento.publicar({
    tipo: 'HABILIDADE_VERIFICADA',
    habilidade: 'consultar_cargas_luft',
    confirmado: true,
    evidencia: 'a planilha da operação LUFT respondeu à consulta',
  });
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'm1',
    texto: 'Hoje: 4 cargas.',
    rota: 'plano_cognitivo',
    ms: 900,
  });

  const cadeia = compilador.compilar(estado.instantaneo(), 's-cadeia', 0).cadeia;
  assert.ok(cadeia, 'o turno aconteceu — a cadeia tem que existir');

  assert.equal(cadeia.intencao?.tipo, 'texto');
  assert.ok((cadeia.intencao?.confianca ?? -1) >= 0);

  assert.equal(cadeia.decisao?.rota, 'plano_cognitivo');
  assert.equal(cadeia.decisao?.custo, 'tokens');

  assert.equal(cadeia.plano?.origem, 'emergente');
  assert.equal(cadeia.plano?.total_passos, 1);

  assert.equal(cadeia.execucao.length, 1);
  assert.equal(cadeia.execucao[0].habilidade, 'consultar_cargas_luft');
  assert.match(cadeia.execucao[0].resumo, /planilha LUFT/);
  assert.equal(cadeia.execucao[0].ms, 120);

  assert.equal(cadeia.verificacao.length, 1);
  assert.equal(cadeia.verificacao[0].confirmado, true);

  assert.equal(cadeia.resposta?.rota, 'plano_cognitivo');
  assert.equal(cadeia.resposta?.latencia_ms, 900);
});

test('turno de conversa mostra só os elos que teve — sem plano e sem execução inventados', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();

  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'bom dia', id_mensagem: 'op:teste' });
  barramento.publicar({ tipo: 'PERCEPCAO_CONCLUIDA', percepcao: percepcao.perceber('bom dia') });
  barramento.publicar({
    tipo: 'DECISAO_TOMADA',
    rota: 'raciocinio_direto',
    justificativa: 'conversa',
    custo_estimado: 'tokens',
  });
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'm2',
    texto: 'Bom dia!',
    rota: 'raciocinio_direto',
    ms: 300,
  });

  const cadeia = compilador.compilar(estado.instantaneo(), 's-cadeia', 0).cadeia;
  assert.ok(cadeia);
  assert.ok(cadeia.intencao);
  assert.equal(cadeia.decisao?.rota, 'raciocinio_direto');
  assert.equal(cadeia.plano, null, 'não houve PLANO_CRIADO simples assim');
  assert.equal(cadeia.execucao.length, 0);
  assert.equal(cadeia.verificacao.length, 0);
  assert.ok(cadeia.resposta);
});

test('recado autônomo (lembrete/vigia) não sobrescreve a resposta de um turno fechado', () => {
  /**
   * Achado da auditoria adversarial de 14/08: lembrete vencido e vigia
   * publicam TAREFA_CONCLUIDA direto no barramento, sem MENSAGEM_RECEBIDA. O
   * último-que-escreve trocava a resposta de um turno já concluído por
   * "via sistema_local (0 ms)" — a cadeia mostrava a pergunta de um turno com
   * a resposta de recado nenhum.
   */
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();

  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'que horas são?', id_mensagem: 'op:teste' });
  barramento.publicar({ tipo: 'PERCEPCAO_CONCLUIDA', percepcao: percepcao.perceber('que horas são?') });
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'm-turno',
    texto: 'São 10:55.',
    rota: 'plano_local',
    ms: 40,
  });

  // O recado chega DEPOIS, sem turno novo — exatamente como Porta.ts publica.
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'lembrete-1',
    texto: 'Lembrete: reunião.',
    rota: 'sistema_local',
    ms: 0,
  });

  const cadeia = compilador.compilar(estado.instantaneo(), 's-cadeia', 0).cadeia;
  assert.equal(cadeia?.resposta?.rota, 'plano_local', 'o turno fecha a própria cadeia uma vez');
  assert.equal(cadeia?.resposta?.latencia_ms, 40);
});

test('turno novo substitui a cadeia — nada do turno anterior vaza', () => {
  const { barramento, compilador, estado } = montar();
  barramento.novoTraco();

  const plano: Plano = {
    objetivo: 'primeiro turno',
    origem: 'deterministico',
    passos: [{ indice: 0, descricao: 'ler o relógio', habilidade: 'consultar_agenda', parametros: {} }],
  };
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'que horas são?', id_mensagem: 'op:teste' });
  barramento.publicar({ tipo: 'PLANO_CRIADO', plano });
  barramento.publicar({ tipo: 'PASSO_CONCLUIDO', passo: plano.passos[0], resumo: 'relógio local', ms: 2 });
  compilador.compilar(estado.instantaneo(), 's-cadeia', 0);

  barramento.novoTraco();
  barramento.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'bom dia', id_mensagem: 'op:teste' });
  barramento.publicar({ tipo: 'PERCEPCAO_CONCLUIDA', percepcao: percepcao.perceber('bom dia') });

  const cadeia = compilador.compilar(estado.instantaneo(), 's-cadeia', 0).cadeia;
  assert.ok(cadeia);
  assert.equal(cadeia.plano, null, 'o plano era do turno ANTERIOR');
  assert.equal(cadeia.execucao.length, 0, 'a execução era do turno ANTERIOR');
  assert.ok(cadeia.intencao, 'a intenção é a do turno novo');
});
