/**
 * O ORÇAMENTO DO TURNO.
 *
 * Duas metades, e a segunda é a que importa: a primeira prova a contabilidade,
 * a segunda prova que o teto **bloqueia**. Um orçamento que conta certo e deixa
 * a ação passar é um relatório de prejuízo, não uma trava.
 *
 * A prova de bloqueio é feita contra o MUNDO, e não contra o log: um plano de
 * três escritas com teto de um passo tem de deixar UM efeito no mundo. Perguntar
 * ao Kernel quantos passos ele acha que rodou seria pedir ao acusado que
 * testemunhe — mesma regra da bateria de falsa conclusão.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  OrcamentoDoTurno,
  TETOS_PADRAO,
  tetosDoAmbiente,
  type TetosDoTurno,
} from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { CadeiaDeRaciocinio } from '../servidor/nucleo/CadeiaDeRaciocinio';
import { ProvedorIndisponivel, type ProvedorRaciocinio } from '../servidor/nucleo/ProvedorRaciocinio';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';

// ===========================================================================
// 1. A CONTABILIDADE
// ===========================================================================

const tetos = (parcial: Partial<TetosDoTurno> = {}): TetosDoTurno => ({
  ...TETOS_PADRAO,
  ...parcial,
});

test('A1. consome até o teto e recusa a partir dele', () => {
  const o = new OrcamentoDoTurno(tetos({ passos: 2 }));
  assert.equal(o.consumir('passo').permitido, true);
  assert.equal(o.consumir('passo').permitido, true);

  const terceiro = o.consumir('passo');
  assert.equal(terceiro.permitido, false);
  if (terceiro.permitido) return;
  assert.equal(terceiro.recurso, 'passo');
  assert.equal(terceiro.teto, 2);
  assert.match(terceiro.motivo, /teto de passos executados/);
});

test('A2. recurso RECUSADO não debita — senão a mensagem trocaria de recurso a cada tentativa', () => {
  const o = new OrcamentoDoTurno(tetos({ passos: 1 }));
  o.consumir('passo');
  o.consumir('passo');
  o.consumir('passo');
  assert.equal(o.gasto('passo'), 1);
});

test('A3. consumirVarios é tudo ou nada', () => {
  const o = new OrcamentoDoTurno(tetos({ passos: 5, efeitos_externos: 0 }));
  const v = o.consumirVarios([{ recurso: 'passo' }, { recurso: 'efeito_externo' }]);
  assert.equal(v.permitido, false);
  /* O passo não pode ter sido debitado por causa do efeito recusado: seriam dois
     passos gastos num turno que executou zero. */
  assert.equal(o.gasto('passo'), 0);
});

test('A4. tempo é conferido em TODA chamada, e estourado bloqueia recurso que ainda tem saldo', () => {
  let agora = 0;
  const o = new OrcamentoDoTurno(tetos({ tempo_ms: 100, passos: 99 }), () => agora);
  assert.equal(o.consumir('passo').permitido, true);

  agora = 101;
  const v = o.consumir('passo');
  assert.equal(v.permitido, false);
  if (v.permitido) return;
  assert.equal(v.recurso, 'tempo');
  assert.match(v.motivo, /tempo máximo/);
});

test('A5. token é contabilizado depois e age na chamada seguinte', () => {
  const o = new OrcamentoDoTurno(tetos({ tokens: 1000, chamadas_modelo: 9 }));
  assert.equal(o.consumir('chamada_modelo').permitido, true);

  /* Ninguém sabe o custo antes de pagar: a chamada aconteceu e gastou mais que o
     teto. O pior caso é um estouro do tamanho de uma chamada, e é declarado. */
  o.registrar('tokens', 1200);
  assert.equal(o.gasto('tokens'), 1200);
  assert.equal(o.consumir('tokens', 1).permitido, false);
});

test('A6. o estouro guardado é o PRIMEIRO — o turno herda um motivo, não o último', () => {
  const o = new OrcamentoDoTurno(tetos({ passos: 0, chamadas_modelo: 0 }));
  o.consumir('passo');
  o.consumir('chamada_modelo');
  assert.equal(o.estouro?.permitido, false);
  assert.equal(o.estouro && !o.estouro.permitido ? o.estouro.recurso : null, 'passo');
});

test('A7. o resumo nomeia o que foi gasto e sempre reporta tempo', () => {
  const o = new OrcamentoDoTurno(tetos(), () => 0);
  o.consumir('passo');
  o.registrar('tokens', 42);
  const r = o.resumo();
  assert.match(r, /passos executados 1\/6/);
  assert.match(r, /tokens 42\/120000/);
  assert.match(r, /tempo 0ms/);
  /* Recurso não gasto fica fora: um resumo com seis zeros é um resumo que
     ninguém lê, e o jornal existe para ser lido depois de um incidente. */
  assert.ok(!/efeitos no mundo/.test(r));
});

test('A8. o ambiente não configurado cai nos padrões, e valor sem sentido não vira teto zero', () => {
  const anterior = { ...process.env };
  try {
    delete process.env.IARA_ORCAMENTO_PASSOS;
    assert.deepEqual(tetosDoAmbiente(), TETOS_PADRAO);

    process.env.IARA_ORCAMENTO_PASSOS = '3';
    assert.equal(tetosDoAmbiente().passos, 3);

    /* Zero significaria "nenhuma ação permitida" — uma IARA que recusa tudo sem
       explicar. Ninguém configura isso de propósito, então é erro de digitação. */
    process.env.IARA_ORCAMENTO_PASSOS = '0';
    assert.equal(tetosDoAmbiente().passos, TETOS_PADRAO.passos);
  } finally {
    process.env = anterior;
  }
});

// ===========================================================================
// 2. O BLOQUEIO, medido no mundo
// ===========================================================================

class Mundo {
  readonly efeitos: string[] = [];
  aplicar(marca: string): void {
    this.efeitos.push(marca);
  }
}

const memoriaFalsa = (): MemoriaOperacional =>
  ({
    async registrar() {},
    async historico() {
      return [];
    },
    async carregarGlobal() {
      return '';
    },
    async lerPreferencias() {
      return {} as never;
    },
  }) as unknown as MemoriaOperacional;

function habilidadeQueEscreve(mundo: Mundo): Habilidade {
  return {
    manifesto: {
      id: 'laboratorio_orcamento',
      nome: 'laboratório do orçamento',
      descricao: 'habilidade de laboratório que aplica um efeito observável no mundo',
      dominio: 'automacao',
      capacidade: 'automacao',
      permissoes: ['escrita'],
      timeout_ms: 200,
      custo: 'zero',
      risco: 'medio',
      idempotencia: 'escrita_idempotente',
      esquema: { alvo: { tipo: 'texto' } },
    },
    async executar(ctx: { parametros: Record<string, unknown> }) {
      const alvo = String(ctx.parametros.alvo ?? '?');
      mundo.aplicar(alvo);
      return { texto: `apliquei ${alvo}`, detalhe: 'laboratório', resolveu: true };
    },
    async verificar(ctx: { parametros: Record<string, unknown> }) {
      const alvo = String(ctx.parametros.alvo ?? '?');
      return mundo.efeitos.includes(alvo)
        ? { confirmado: true, evidencia: `o mundo mostra ${alvo}` }
        : { confirmado: false, evidencia: 'o mundo não mostra', motivo: 'divergente' as const };
    },
  } as unknown as Habilidade;
}

/** Turno pelo Kernel real, com N passos de escrita e tetos apertados. */
async function turno(o: {
  quantosPassos: number;
  tetosOrcamento: TetosDoTurno;
  comRaciocinio?: boolean;
}): Promise<{ mundo: Mundo; falas: string[]; chamadasAoModelo: number }> {
  const mundo = new Mundo();
  const sessao = `orcamento-${o.quantosPassos}-${o.tetosOrcamento.passos}-${o.tetosOrcamento.chamadas_modelo}`;
  const barramento = new BarramentoEventos(sessao);
  const falas: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') falas.push(e.texto);
  });

  let chamadasAoModelo = 0;
  const passos = Array.from({ length: o.quantosPassos }, (_, i) => ({
    indice: i,
    descricao: `escrever alvo-${i}`,
    habilidade: 'laboratorio_orcamento',
    parametros: { alvo: `alvo-${i}` },
  }));

  const kernel = new Kernel({
    sessao,
    idUsuario: 'operador-de-orcamento',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    registroOperacoes: new RegistroOperacoes(mkdtempSync(path.join(tmpdir(), 'iara-orc-'))),
    habilidadesExtras: [habilidadeQueEscreve(mundo)],
    tetosOrcamento: o.tetosOrcamento,
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar() {
        chamadasAoModelo++;
        return {
          objetivo: 'exercitar o orçamento',
          origem: 'deterministico' as const,
          passos: o.comRaciocinio
            ? [...passos, { indice: passos.length, descricao: 'resumir', habilidade: 'raciocinio', parametros: {} }]
            : passos,
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        chamadasAoModelo++;
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 10, tokens_saida: 5, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  await kernel.processar(
    'analise o levantamento de custos e depois gere um resumo executivo comparativo',
  );
  return { mundo, falas, chamadasAoModelo };
}

test('B1. teto de passos BLOQUEIA: plano de três escritas com teto 1 deixa UM efeito no mundo', async () => {
  const { mundo, falas } = await turno({
    quantosPassos: 3,
    tetosOrcamento: tetos({ passos: 1 }),
  });

  assert.deepEqual(mundo.efeitos, ['alvo-0']);
  /* E o operador é informado dos dois que não aconteceram. Bloquear em silêncio
     trocaria a mentira "fiz" pela mentira "nada havia para fazer". */
  assert.match(falas.at(-1) ?? '', /teto de passos executados/);
});

test('B2. teto de efeito no mundo BLOQUEIA a escrita e o mundo fica vazio', async () => {
  const { mundo, falas } = await turno({
    quantosPassos: 2,
    tetosOrcamento: tetos({ efeitos_externos: 0 }),
  });

  assert.deepEqual(mundo.efeitos, []);
  assert.match(falas.at(-1) ?? '', /teto de efeitos no mundo/);
});

test('B3. teto de chamada ao modelo corta a síntese, e a resposta sai do que já existia', async () => {
  /* Uma chamada só: o planejamento a consome, a síntese é recusada. O turno não
     morre — entrega o que produziu e declara o que deixou de redigir. */
  const { mundo, falas, chamadasAoModelo } = await turno({
    quantosPassos: 1,
    tetosOrcamento: tetos({ chamadas_modelo: 1 }),
    comRaciocinio: true,
  });

  assert.deepEqual(mundo.efeitos, ['alvo-0']);
  assert.equal(chamadasAoModelo, 1, 'a síntese não podia ter sido chamada');
  const fala = falas.at(-1) ?? '';
  assert.match(fala, /teto de chamadas ao modelo/);
  assert.ok(!fala.includes('[sintese]'));
});

test('B4. dois turnos do mesmo kernel não dividem teto', async () => {
  /* O orçamento vive na pilha do turno. Se fosse campo da classe, o segundo
     pedido do operador nasceria sem saldo por causa do primeiro — e a fila
     serializando turnos faria isso aparecer só com duas telas conversando. */
  const mundo = new Mundo();
  const barramento = new BarramentoEventos('orcamento-dois-turnos');
  const kernel = new Kernel({
    sessao: 'orcamento-dois-turnos',
    idUsuario: 'operador-de-orcamento',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    registroOperacoes: new RegistroOperacoes(mkdtempSync(path.join(tmpdir(), 'iara-orc-'))),
    habilidadesExtras: [habilidadeQueEscreve(mundo)],
    tetosOrcamento: tetos({ passos: 1 }),
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar() {
        return {
          objetivo: 'um passo por turno',
          origem: 'deterministico' as const,
          passos: [
            {
              indice: 0,
              descricao: 'escrever',
              habilidade: 'laboratorio_orcamento',
              parametros: { alvo: `alvo-${mundo.efeitos.length}` },
            },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  const pedido = 'analise o levantamento de custos e depois gere um resumo executivo comparativo';
  await kernel.processar(pedido);
  await kernel.processar(pedido);

  assert.deepEqual(mundo.efeitos, ['alvo-0', 'alvo-1']);
});

// ===========================================================================
// 3. A CADEIA PERGUNTA ANTES DE TENTAR OUTRO ELO
// ===========================================================================

function eloQueFalha(apelido: string, contador: { n: number }): ProvedorRaciocinio {
  return {
    apelido,
    disponivel: true,
    modelo: apelido,
    origem: 'nuvem',
    async raciocinar() {
      contador.n++;
      throw new Error('503 provedor fora do ar');
    },
  } as unknown as ProvedorRaciocinio;
}

test('C1. o teto de tentativas para a cadeia antes de percorrer a fila inteira', async () => {
  const contador = { n: 0 };
  const cadeia = new CadeiaDeRaciocinio([
    eloQueFalha('elo-a', contador),
    eloQueFalha('elo-b', contador),
    eloQueFalha('elo-c', contador),
    eloQueFalha('elo-d', contador),
  ]);

  let permitidas = 2;
  await assert.rejects(
    cadeia.raciocinar({
      mensagem: 'oi',
      historico: [],
      overridePersona: '',
      camadaGlobal: '',
      sinal: new AbortController().signal,
      aoTentarProvedor: () => permitidas-- > 0,
      aoReceberTexto: () => {},
    }),
    (erro: unknown) =>
      erro instanceof ProvedorIndisponivel && /orçamento de tentativas/.test((erro as Error).message),
  );

  assert.equal(contador.n, 2, 'a cadeia tentou mais elos do que o turno podia pagar');
});

test('C2. sem orçamento declarado a cadeia se comporta como antes', async () => {
  /* Quem chama o provedor fora de um turno — sonda, diagnóstico — não tem teto
     para consultar, e a ausência não pode virar recusa. */
  const contador = { n: 0 };
  const cadeia = new CadeiaDeRaciocinio([
    eloQueFalha('elo-a', contador),
    eloQueFalha('elo-b', contador),
  ]);

  await assert.rejects(
    cadeia.raciocinar({
      mensagem: 'oi',
      historico: [],
      overridePersona: '',
      camadaGlobal: '',
      sinal: new AbortController().signal,
      aoReceberTexto: () => {},
    }),
  );
  assert.equal(contador.n, 2);
});
