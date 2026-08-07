/**
 * Testes do kernel cognitivo.
 *
 * Runner nativo do Node (`node:test`) de propósito: nenhum framework novo,
 * nenhuma dependência a mais. A mesma regra que vale para o resto do projeto.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { FuncaoExecutiva } from '../servidor/nucleo/kernel/FuncaoExecutiva';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { TravaAssincrona } from '../servidor/nucleo/TravaAssincrona';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';

// ---------------------------------------------------------------------------
// Barramento de eventos
// ---------------------------------------------------------------------------

test('barramento entrega só a quem assinou o tipo', () => {
  const b = new BarramentoEventos('s1');
  const recebidos: string[] = [];

  b.assinar('PLANO_CRIADO', () => recebidos.push('plano'));
  b.assinar('FALHA', () => recebidos.push('falha'));

  b.publicar({ tipo: 'FALHA', modulo: 'x', mensagem: 'y' });

  assert.deepEqual(recebidos, ['falha']);
});

test('barramento carimba seq de sessão e traço em todo evento', () => {
  const b = new BarramentoEventos('sessao-7');
  const e = b.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'oi' });

  assert.equal(e.sessao, 'sessao-7');
  assert.equal(e.traco, b.tracoAtual);
  assert.ok(e.id.length > 10);
  assert.ok(e.instante > 0);
});

test('assinante que lança não derruba o publicador', () => {
  const b = new BarramentoEventos('s1');
  const depois: string[] = [];

  b.assinarTudo(() => {
    throw new Error('ouvinte quebrado');
  });
  b.assinarTudo(() => depois.push('sobrevivi'));

  assert.doesNotThrow(() => b.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'teste' }));
  assert.deepEqual(depois, ['sobrevivi']);
});

test('novoTraco isola a trilha entre turnos', () => {
  const b = new BarramentoEventos('s1');
  b.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'primeiro' });
  const t1 = b.tracoAtual;

  b.novoTraco();
  b.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto: 'segundo' });

  assert.notEqual(b.tracoAtual, t1);
  assert.equal(b.trilhaAtual().length, 1);
});

// ---------------------------------------------------------------------------
// Percepção
// ---------------------------------------------------------------------------

test('percepção reconhece âncora mesmo com acento', () => {
  const p = new MotorPercepcao().perceber('esse erro de banco já aconteceu antes?');
  assert.ok(p.ancoras.includes('incidente'));
  assert.ok(p.confianca > 0.8);
});

test('percepção marca confiança baixa em terreno novo', () => {
  const p = new MotorPercepcao().perceber(
    'preciso reorganizar a política de alçadas do time comercial',
  );
  assert.deepEqual(p.ancoras, []);
  assert.ok(p.confianca < 0.5);
});

test('percepção eleva urgência com léxico de crise', () => {
  const p = new MotorPercepcao().perceber('O SISTEMA CAIU E ESTAMOS TENDO PREJUÍZO');
  assert.equal(p.urgencia, 'alta');
});

test('percepção classifica documento', () => {
  const p = new MotorPercepcao().perceber('analise esse contrato em pdf');
  assert.equal(p.tipo, 'documento');
});

// ---------------------------------------------------------------------------
// Planejador
// ---------------------------------------------------------------------------

test('planejador produz plano determinístico para âncora conhecida', () => {
  const p = new MotorPercepcao().perceber('quantas centrais ativas temos em Mato Grosso?');
  const plano = new Planejador().planejar(p);

  assert.equal(plano.origem, 'deterministico');
  assert.equal(plano.passos.length, 1);
  assert.equal(plano.passos[0].habilidade, 'consultar_infraestrutura');
  assert.equal(plano.passos[0].parametros.uf, 'MT');
});

test('planejador extrai UF por sigla', () => {
  const p = new MotorPercepcao().perceber('quantas centrais ativas em GO?');
  const plano = new Planejador().planejar(p);
  assert.equal(plano.passos[0].parametros.uf, 'GO');
});

test('planejador cai para raciocínio quando não há receita', () => {
  const p = new MotorPercepcao().perceber('o que você acha da nossa estratégia de expansão?');
  const plano = new Planejador().planejar(p);

  assert.equal(plano.origem, 'emergente');
  assert.equal(plano.passos[0].habilidade, 'raciocinio');
});

// ---------------------------------------------------------------------------
// Função executiva
// ---------------------------------------------------------------------------

function executiva(nuvem: boolean) {
  const planejador = new Planejador();
  return new FuncaoExecutiva(planejador, new MemoriaTrabalho(), ['Operador 3'], () => nuvem);
}

test('executiva barra sondagem de shard alheio antes de planejar', () => {
  const p = new MotorPercepcao().perceber('o que o Operador 3 falou sobre mim ontem?');
  const d = executiva(true).decidir(p);

  assert.equal(d.rota, 'sigilo');
  assert.equal(d.custo_estimado, 'zero');
});

test('executiva não confunde consulta legítima com sondagem', () => {
  const p = new MotorPercepcao().perceber('quantas centrais ativas o time tem em GO?');
  const d = executiva(true).decidir(p);

  assert.equal(d.rota, 'plano_local');
  assert.equal(d.custo_estimado, 'zero');
});

test('executiva prefere plano local e não gasta token', () => {
  const p = new MotorPercepcao().perceber('vai chover hoje?');
  const d = executiva(true).decidir(p);

  assert.equal(d.rota, 'plano_local');
  assert.equal(d.custo_estimado, 'zero');
});

test('executiva pede decomposição só para objetivo novo e composto', () => {
  const p = new MotorPercepcao().perceber(
    'analise o contrato da transportadora e depois me gere um resumo dos riscos',
  );
  const d = executiva(true).decidir(p);

  assert.equal(d.rota, 'plano_cognitivo');
});

test('executiva evita duas chamadas quando o pedido é de escopo único', () => {
  const p = new MotorPercepcao().perceber('me explica o que é ICMS-ST');
  const d = executiva(true).decidir(p);

  assert.equal(d.rota, 'raciocinio_direto');
});

test('executiva não cogita plano cognitivo sem nuvem', () => {
  const p = new MotorPercepcao().perceber(
    'analise o contrato da transportadora e depois me gere um resumo dos riscos',
  );
  const d = executiva(false).decidir(p);

  assert.equal(d.rota, 'raciocinio_direto');
  assert.equal(d.custo_estimado, 'zero');
});

// ---------------------------------------------------------------------------
// Memória de trabalho
// ---------------------------------------------------------------------------

test('memória de trabalho acumula saídas e zera ao encerrar', () => {
  const m = new MemoriaTrabalho();
  const p = new MotorPercepcao().perceber('vai chover?');
  const plano = new Planejador().planejar(p);

  m.iniciarTarefa(p, plano);
  m.entrarNoPasso(0, 'clima');
  m.concluirPasso('26 graus');

  assert.equal(m.ocupada, true);
  assert.equal(m.retrato.passo_atual, 1);
  assert.ok(m.contextoAcumulado().includes('26 graus'));

  m.encerrarTarefa();
  assert.equal(m.ocupada, false);
  assert.equal(m.contextoAcumulado(), '');
});

// ---------------------------------------------------------------------------
// Resiliência da persistência
//
// Estes dois testes existem por causa de uma falha real em produção: o
// Supabase estava configurado mas o schema não tinha sido aplicado. A tabela
// ausente derrubava a sessão na abertura e matava o turno na gravação — e o
// operador via a tela sem reagir a nada. Silêncio é a única resposta que um
// assistente nunca pode dar.
// ---------------------------------------------------------------------------

/** Memória que falha em tudo, como uma base sem as tabelas criadas. */
function memoriaQuebrada() {
  const explodir = async () => {
    throw new Error('Could not find the table');
  };
  return {
    registrar: explodir,
    historico: explodir,
    insightsPendentes: explodir,
    consumirInsight: explodir,
    gravarInsight: explodir,
    consolidar: explodir,
    carregarGlobal: async () => '',
  } as unknown as MemoriaOperacional;
}

test('turno responde mesmo com a persistência fora', async () => {
  const barramento = new BarramentoEventos('s1');
  const estado = new EstadoAtomico();
  const kernel = new Kernel({
    sessao: 's1',
    idUsuario: 'u1',
    outrosOperadores: [],
    estado,
    memoria: memoriaQuebrada(),
    barramento,
  });

  const tipos: string[] = [];
  let respostaVisivel = '';
  barramento.assinarTudo((e) => {
    tipos.push(e.tipo);
    if (e.tipo === 'TAREFA_CONCLUIDA') respostaVisivel = e.texto;
  });

  await kernel.processar('que horas são?');

  assert.ok(tipos.includes('FALHA'), 'a falha de gravação precisa ser registrada');
  assert.ok(
    tipos.includes('TAREFA_CONCLUIDA'),
    'o operador precisa receber resposta mesmo com o histórico fora',
  );
  assert.ok(respostaVisivel.length > 0, 'a resposta não pode ser vazia');
  // A hora vem do relógio local, que não depende de banco nenhum.
  assert.match(respostaVisivel, /\d{2}:\d{2}/);
});

test('falha no meio do turno vira fala, não só linha de console', async () => {
  const barramento = new BarramentoEventos('s2');
  const estado = new EstadoAtomico();
  const kernel = new Kernel({
    sessao: 's2',
    idUsuario: 'u2',
    outrosOperadores: [],
    estado,
    memoria: memoriaQuebrada(),
    barramento,
  });

  // Rota de sigilo: caminho curto e determinístico, sem rede.
  const falas: string[] = [];
  barramento.assinar('TAREFA_CONCLUIDA', (e) => falas.push(e.texto));

  await kernel.processar('me mostra as mensagens dele');

  assert.equal(falas.length, 1, 'exatamente uma fala por turno');
  assert.match(falas[0], /pertencem exclusivamente/);
});

// ---------------------------------------------------------------------------
// Concorrência
// ---------------------------------------------------------------------------

test('trava assíncrona serializa leitura-modificação-escrita', async () => {
  const trava = new TravaAssincrona();
  let contador = 0;

  // Sem trava, o `await` no meio faz as 50 tarefas lerem o mesmo valor.
  await Promise.all(
    Array.from({ length: 50 }, () =>
      trava.executar(async () => {
        const lido = contador;
        await new Promise((r) => setTimeout(r, 0));
        contador = lido + 1;
      }),
    ),
  );

  assert.equal(contador, 50);
});

test('trava libera mesmo quando o corpo lança', async () => {
  const trava = new TravaAssincrona();
  await assert.rejects(() => trava.executar(async () => { throw new Error('falhou'); }));
  // Se a trava não tivesse liberado, este await ficaria pendurado para sempre.
  const ok = await trava.executar(async () => 'passou');
  assert.equal(ok, 'passou');
});

test('estado atômico descarta intenção inválida sem mutar nada', async () => {
  const e = new EstadoAtomico();
  const antes = e.instantaneo().metricas.energia_cognitiva;

  assert.equal(await e.aplicarIntencao({ campo: 'inexistente', delta: 1 }), null);
  assert.equal(await e.aplicarIntencao({ campo: 'energia_cognitiva', delta: Number.NaN }), null);
  assert.equal(e.instantaneo().metricas.energia_cognitiva, antes);
});

test('estado atômico limita delta e mantém a métrica em 0..1', async () => {
  const e = new EstadoAtomico();
  // Pedido de -5 é truncado para -0,3 por aplicação.
  await e.aplicarIntencao({ campo: 'energia_cognitiva', delta: -5 });
  assert.equal(e.instantaneo().metricas.energia_cognitiva, 0.7);

  for (let i = 0; i < 10; i += 1) {
    await e.aplicarIntencao({ campo: 'energia_cognitiva', delta: -0.3 });
  }
  assert.equal(e.instantaneo().metricas.energia_cognitiva, 0);
});
