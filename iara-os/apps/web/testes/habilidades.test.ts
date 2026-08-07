/**
 * Testes das habilidades, do gerenciador e do barramento de telemetria.
 *
 * Cobrem as quatro portas que o `GerenciadorHabilidades` promete: existência,
 * permissão, esquema e timeout. Se qualquer uma puder ser pulada, o contrato
 * de segurança das skills é ficção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { GerenciadorHabilidades } from '../servidor/nucleo/kernel/GerenciadorHabilidades';
import {
  ParametroInvalido,
  PermissaoNegada,
  HabilidadeExpirou,
  validar,
  type Habilidade,
} from '../servidor/nucleo/kernel/Habilidade';
import { PoliticaPadrao, SandboxPorPolitica, LimiteVazao } from '../servidor/nucleo/kernel/Seguranca';
import { FilaTelemetria } from '../servidor/barramento/FilaTelemetria';
import { HABILIDADES_OPERACIONAIS } from '../servidor/nucleo/kernel/habilidades/operacionais';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { DOMINIOS } from '../lib/capacidades';

// ---------------------------------------------------------------------------
// Validação de esquema
// ---------------------------------------------------------------------------

test('esquema rejeita parâmetro não declarado', () => {
  assert.throws(
    () => validar({ uf: { tipo: 'texto' } }, { uf: 'MT', comando: 'rm -rf /' }),
    ParametroInvalido,
  );
});

test('esquema rejeita tipo errado e aplica padrão', () => {
  assert.throws(() => validar({ n: { tipo: 'numero' } }, { n: 'dez' }), ParametroInvalido);
  assert.deepEqual(validar({ uf: { tipo: 'texto', padrao: 'GERAL' } }, {}), { uf: 'GERAL' });
});

test('esquema exige campo obrigatório e respeita lista fechada', () => {
  assert.throws(() => validar({ c: { tipo: 'texto', obrigatorio: true } }, {}), ParametroInvalido);
  assert.throws(
    () => validar({ uf: { tipo: 'texto', dentre: ['MT', 'GO'] } }, { uf: 'RJ' }),
    ParametroInvalido,
  );
});

// ---------------------------------------------------------------------------
// Gerenciador — as quatro portas
// ---------------------------------------------------------------------------

const habilidadeFalsa = (
  id: string,
  permissoes: Habilidade['manifesto']['permissoes'],
  corpo: () => Promise<{ texto: string; detalhe: string; resolveu: boolean }>,
  timeout_ms = 1000,
): Habilidade => ({
  manifesto: {
    id,
    nome: id,
    descricao: 'teste',
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes,
    timeout_ms,
    custo: 'zero',
    esquema: {},
  },
  executar: corpo,
});

function montar() {
  const b = new BarramentoEventos('s1');
  return { b, g: new GerenciadorHabilidades(b) };
}

const pedidoBase = {
  parametros: {},
  enunciado: 'teste',
  id_usuario: 'u1',
  sessao: 's1',
  sinal: new AbortController().signal,
};

test('porta 1: habilidade desconhecida é recusada', async () => {
  const { g } = montar();
  await assert.rejects(() => g.executar({ ...pedidoBase, id: 'fantasma', concedidas: [] }));
});

test('porta 2: permissão faltante bloqueia a execução', async () => {
  const { g } = montar();
  let rodou = false;
  g.registrar(
    habilidadeFalsa('rede_x', ['rede'], async () => {
      rodou = true;
      return { texto: '', detalhe: '', resolveu: true };
    }),
  );

  await assert.rejects(
    () => g.executar({ ...pedidoBase, id: 'rede_x', concedidas: ['banco'] }),
    PermissaoNegada,
  );
  assert.equal(rodou, false, 'o executor não pode ter rodado');
});

test('porta 3: parâmetro fora do esquema não chega ao executor', async () => {
  const { g } = montar();
  g.registrar(habilidadeFalsa('sem_param', [], async () => ({ texto: '', detalhe: '', resolveu: true })));

  await assert.rejects(
    () => g.executar({ ...pedidoBase, id: 'sem_param', parametros: { x: 1 }, concedidas: [] }),
    ParametroInvalido,
  );
});

test('porta 4: timeout interrompe habilidade travada', async () => {
  const { g } = montar();
  g.registrar(
    habilidadeFalsa(
      'lenta',
      [],
      () => new Promise((r) => setTimeout(() => r({ texto: '', detalhe: '', resolveu: true }), 5000)),
      60,
    ),
  );

  await assert.rejects(
    () => g.executar({ ...pedidoBase, id: 'lenta', concedidas: [] }),
    HabilidadeExpirou,
  );
});

test('execução bem-sucedida publica início e fim no barramento', async () => {
  const { b, g } = montar();
  const vistos: string[] = [];
  b.assinarTudo((e) => vistos.push(e.tipo));

  g.registrar(
    habilidadeFalsa('ok', [], async () => ({ texto: 'pronto', detalhe: 'ok', resolveu: true })),
  );
  const r = await g.executar({ ...pedidoBase, id: 'ok', concedidas: [] });

  assert.equal(r.texto, 'pronto');
  assert.deepEqual(vistos, ['HABILIDADE_INICIADA', 'HABILIDADE_CONCLUIDA']);
});

test('habilidade duplicada é recusada no registro', () => {
  const { g } = montar();
  const h = habilidadeFalsa('dup', [], async () => ({ texto: '', detalhe: '', resolveu: true }));
  g.registrar(h);
  assert.throws(() => g.registrar(h));
});

// ---------------------------------------------------------------------------
// Catálogo real
// ---------------------------------------------------------------------------

test('toda habilidade operacional declara manifesto coerente', () => {
  for (const h of HABILIDADES_OPERACIONAIS) {
    const m = h.manifesto;
    assert.ok(m.id.length > 0, `${m.id}: id vazio`);
    assert.ok(m.timeout_ms > 0 && m.timeout_ms <= 15000, `${m.id}: timeout fora da faixa`);
    assert.ok(m.descricao.length > 10, `${m.id}: descrição curta demais para a LLM planejar`);
    // Nenhuma habilidade operacional pode custar token — é o ponto delas.
    assert.equal(m.custo, 'zero', `${m.id}: habilidade operacional não pode custar tokens`);
  }
});

/**
 * Este teste existe porque a ausência dele deixou passar uma quebra real: as
 * habilidades foram renomeadas e as receitas do Planejador continuaram
 * apontando para os ids antigos. O passo era pulado em silêncio e a resposta
 * saía vazia — o pior modo de falha possível, porque não gera erro nenhum.
 */
test('toda receita determinística aponta para habilidade que existe no catálogo', () => {
  const ids = new Set(CATALOGO.map((h) => h.manifesto.id));
  const planejador = new Planejador();
  const percepcao = new MotorPercepcao();

  const frases = [
    'vai chover hoje?',
    'quantas centrais ativas temos em MT?',
    'esse erro de banco já aconteceu antes?',
    'que horas são?',
    'pesquisa o que é conhecimento de transporte eletrônico',
  ];

  for (const frase of frases) {
    const plano = planejador.planejar(percepcao.perceber(frase));
    for (const p of plano.passos) {
      if (!p.habilidade || p.habilidade === 'raciocinio') continue;
      assert.ok(ids.has(p.habilidade), `"${frase}" → habilidade inexistente "${p.habilidade}"`);
    }
  }

  // A recusa por sigilo também é um plano, e também pode apodrecer.
  const recusa = planejador.planoDeRecusa('teste');
  assert.ok(ids.has(recusa.passos[0].habilidade!), 'plano de recusa aponta para id inexistente');
});

test('receita determinística nunca depende de habilidade opcional', () => {
  // Uma receita que aponte para habilidade indisponível sem credencial faz o
  // modo local parecer quebrado. Toda receita tem que funcionar sempre.
  const planejador = new Planejador();
  const percepcao = new MotorPercepcao();
  const porId = new Map(CATALOGO.map((h) => [h.manifesto.id, h]));

  for (const frase of ['quantas centrais ativas temos em MT?', 'que horas são?', 'vai chover?']) {
    const plano = planejador.planejar(percepcao.perceber(frase));
    for (const p of plano.passos) {
      if (!p.habilidade || p.habilidade === 'raciocinio') continue;
      const h = porId.get(p.habilidade)!;
      assert.equal(
        h.indisponivelPorque?.() ?? null,
        null,
        `receita para "${frase}" usa "${p.habilidade}", que pode estar indisponível`,
      );
    }
  }
});

test('todo domínio declarado no manifesto existe', () => {
  for (const h of CATALOGO) {
    assert.ok(DOMINIOS[h.manifesto.dominio], `${h.manifesto.id}: domínio inválido`);
  }
});

test('id de habilidade segue verbo_objeto em minúsculas', () => {
  for (const h of CATALOGO) {
    assert.match(h.manifesto.id, /^[a-z]+(_[a-z]+)+$/, `${h.manifesto.id} fora da convenção`);
  }
});

test('nenhuma habilidade operacional pede permissão de escrita', () => {
  for (const h of HABILIDADES_OPERACIONAIS) {
    assert.ok(
      !h.manifesto.permissoes.includes('escrita'),
      `${h.manifesto.id} pede escrita sem necessidade`,
    );
  }
});

// ---------------------------------------------------------------------------
// Segurança
// ---------------------------------------------------------------------------

test('sandbox barra papel somente-leitura em habilidade de rede', () => {
  const s = new SandboxPorPolitica(new PoliticaPadrao());
  assert.throws(() => s.verificar('busca', ['rede'], 'somente_leitura'));
  assert.doesNotThrow(() => s.verificar('busca', ['rede'], 'operador'));
});

test('operador comum não recebe permissão de escrita', () => {
  const p = new PoliticaPadrao();
  assert.ok(!p.permissoesDe('operador').includes('escrita'));
  assert.ok(p.permissoesDe('administrador').includes('escrita'));
});

test('limite de vazão fecha a janela e reabre depois', () => {
  const l = new LimiteVazao(3, 1000);
  const t = 1_000_000;

  assert.equal(l.permitir(t), true);
  assert.equal(l.permitir(t), true);
  assert.equal(l.permitir(t), true);
  assert.equal(l.permitir(t), false, 'quarto pedido na mesma janela deve ser barrado');
  assert.equal(l.permitir(t + 1500), true, 'após a janela deve liberar');
});

// ---------------------------------------------------------------------------
// Fila de telemetria
// ---------------------------------------------------------------------------

const snapshotFalso = (seq: number, instante: number) =>
  ({ tipo: 'snapshot', seq, instante, snapshot: { seq } }) as never;

test('fila aglutina snapshots: só o mais recente sobrevive', () => {
  const f = new FilaTelemetria();
  f.enfileirar(snapshotFalso(1, Date.now()));
  f.enfileirar(snapshotFalso(2, Date.now()));
  f.enfileirar(snapshotFalso(3, Date.now()));

  const saida = f.drenar();
  assert.equal(saida.length, 1);
  assert.equal(saida[0].seq, 3);
});

test('fila descarta log velho e nunca cresce sem teto', () => {
  const f = new FilaTelemetria();
  const antigo = Date.now() - 30_000;

  for (let i = 0; i < 500; i += 1) {
    f.enfileirar({ tipo: 'log', seq: i, instante: antigo, nivel: 'traco', texto: `l${i}` });
  }
  assert.ok(f.tamanho <= 100, 'a fila estourou o teto');

  // Tudo vencido: some na drenagem em vez de virar enxurrada na reconexão.
  assert.equal(f.drenar().length, 0);
  assert.ok(f.totalDescartado > 0);
});

test('fila preserva snapshot sob pressão de logs', () => {
  const f = new FilaTelemetria();
  const agora = Date.now();
  f.enfileirar(snapshotFalso(1, agora));
  for (let i = 0; i < 300; i += 1) {
    f.enfileirar({ tipo: 'log', seq: 100 + i, instante: agora, nivel: 'traco', texto: 'ruido' });
  }

  const saida = f.drenar(agora);
  assert.ok(
    saida.some((p) => p.tipo === 'snapshot'),
    'o snapshot não pode ser descartado por pressão de log',
  );
});
