/**
 * O MOTOR DE VEREDITO TESTADO POR DENTRO.
 *
 * Mesma razão que existe `campanha-contrato.test.ts`: um módulo que decide se o
 * sistema pode ser chamado de pronto precisa, ele mesmo, ser conferido — senão
 * ele vira a autoridade que ninguém audita, que é o papel que este módulo existe
 * para TIRAR do auditor humano.
 *
 * A tabela de verdade abaixo é a resposta executável ao defeito de 17/08/2026,
 * quando um relatório desta casa escreveu READY com cinco baterias sem rodar.
 * Enquanto o veredito era prosa, a única defesa era reler o texto com atenção.
 * Agora existe um caso de teste com nome, e ele falha se alguém afrouxar a regra.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  conferirRegistro,
  maisSevero,
  podeChamarDePronto,
  ROTULO_INTERNACIONAL,
  type Bateria,
  type RegistroEvidencia,
  type Veredito,
} from './validacao/contrato';
import { apurar, resumo } from './validacao/MotorVeredito';
import { BATERIAS, CRITICAS, OBRIGATORIAS, POR_ID } from './validacao/registro';
import { ler, registrar } from './validacao/Diario';

const COMMIT = 'c077bc0aa11bb22cc33dd44ee55ff6607788990a';
const OUTRO_COMMIT = '4d65ca1d1025e614d4c2402bcff57acb94db37bd';

const bateria = (id: string, obrigatoria: boolean, critica: boolean): Bateria => ({
  id,
  nome: `bateria ${id}`,
  pergunta: 'pergunta de teste',
  obrigatoria,
  critica,
  harness: 'harness de teste',
});

/** Um registro VÁLIDO de sucesso: é o que `conferirRegistro` exige por inteiro. */
const passou = (id: string, extra: Partial<RegistroEvidencia> = {}): RegistroEvidencia => ({
  bateria: id,
  execucao: `run-${id}`,
  commit: COMMIT,
  ambiente: 'teste',
  instante: '2026-08-17T12:00:00.000Z',
  status: 'EXECUTADA_PASSOU',
  cenarios: 3,
  passou: 3,
  falhou: 0,
  inconclusivo: 0,
  bloqueado: 0,
  artefato: 'test-evidence/validacao/x.log',
  metricas: {},
  versao_oraculo: 'v1',
  violacoes_criticas: [],
  ...extra,
});

const falhou = (id: string, extra: Partial<RegistroEvidencia> = {}): RegistroEvidencia =>
  passou(id, { status: 'EXECUTADA_FALHOU', passou: 2, falhou: 1, ...extra });

// ---------------------------------------------------------------------------
// A. O registro de baterias
// ---------------------------------------------------------------------------

test('A1. nenhum id de bateria se repete', () => {
  assert.equal(POR_ID.size, BATERIAS.length);
});

test('A2. toda bateria crítica é também obrigatória', () => {
  /* Crítica-e-opcional seria contraditório: a falha dela bloqueia, mas a
     AUSÊNCIA dela não incomoda ninguém — bastaria não rodar para nunca
     bloquear, que é o buraco exato que este módulo fecha. */
  const incoerentes = CRITICAS.filter((b) => !b.obrigatoria).map((b) => b.id);
  assert.deepEqual(incoerentes, []);
});

test('A3. toda bateria declara pergunta própria e o harness diz se existe', () => {
  for (const b of BATERIAS) {
    assert.ok(b.pergunta.trim().length > 10, `${b.id} sem pergunta`);
    assert.ok(b.harness === null || b.harness.trim().length > 0, `${b.id} com harness vazio`);
    /* `harness` é binário. "parcial" ali produzia a linha "harness existe e
       ninguém o chamou" para bateria que não tem o que chamar — mentira pequena,
       no módulo que existe para não deixar passar mentira pequena. Cobertura
       parcial tem campo próprio. */
    assert.ok(
      !/parcial/i.test(b.harness ?? ''),
      `${b.id}: cobertura parcial não é harness — use cobertura_parcial`,
    );
  }
  // A lista de perguntas não pode ter repetida: bateria que responde o que
  // outra já responde é sobra, e sobra dilui o sinal do veredito.
  assert.equal(new Set(BATERIAS.map((b) => b.pergunta)).size, BATERIAS.length);
});

// ---------------------------------------------------------------------------
// B. A tabela de verdade
// ---------------------------------------------------------------------------

test('B1. diário vazio é VALIDACAO_INCOMPLETA, nunca PRONTO', () => {
  const a = apurar({ commit: COMMIT, baterias: BATERIAS, registros: [] });
  assert.equal(a.veredito, 'VALIDACAO_INCOMPLETA');
  assert.equal(a.pode_chamar_de_pronto, false);
  assert.ok(a.motivos.length >= OBRIGATORIAS.length);
});

test('B2. o registro real de hoje, sem evidência nenhuma, não autoriza a palavra "pronto"', () => {
  /* O caso concreto do defeito: é ESTE o estado em que o relatório de 17/08
     escreveu READY WITH KNOWN RISKS. */
  const a = apurar({ commit: COMMIT, baterias: BATERIAS, registros: [] });
  assert.equal(ROTULO_INTERNACIONAL[a.veredito], 'VALIDATION_INCOMPLETE');
});

test('B3. todas as baterias passando dá PRONTO', () => {
  const baterias = [bateria('a', true, true), bateria('b', true, false), bateria('c', false, false)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: baterias.map((b) => passou(b.id)),
  });
  assert.equal(a.veredito, 'PRONTO');
  assert.equal(a.pode_chamar_de_pronto, true);
});

test('B4. obrigatórias passando e opcional sem medir dá PRONTO_COM_RISCOS', () => {
  const baterias = [bateria('a', true, true), bateria('c', false, false)];
  const a = apurar({ commit: COMMIT, baterias, registros: [passou('a')] });
  assert.equal(a.veredito, 'PRONTO_COM_RISCOS');
  assert.equal(a.pode_chamar_de_pronto, true);
  // A ressalva é NOMINAL: quem lê sabe de que risco se fala.
  assert.ok(a.motivos.some((m) => m.includes('bateria c')));
});

test('B5. obrigatória não crítica que falha dá FALHOU', () => {
  const baterias = [bateria('a', true, true), bateria('b', true, false)];
  const a = apurar({ commit: COMMIT, baterias, registros: [passou('a'), falhou('b')] });
  assert.equal(a.veredito, 'FALHOU');
  assert.equal(a.pode_chamar_de_pronto, false);
});

test('B6. bateria crítica que falha dá BLOQUEADO, com todo o resto passando', () => {
  const baterias = [bateria('a', true, true), bateria('b', true, false)];
  const a = apurar({ commit: COMMIT, baterias, registros: [falhou('a'), passou('b')] });
  assert.equal(a.veredito, 'BLOQUEADO');
});

test('B7. violação crítica em bateria OPCIONAL bloqueia igual', () => {
  /* Segurança não é opcional porque a bateria é. Se a violação só contasse
     vinda de bateria obrigatória, bastaria classificar a bateria como opcional
     para o achado perder força — e a classificação é escolha nossa. */
  const baterias = [bateria('a', true, true), bateria('c', false, false)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: [
      passou('a'),
      falhou('c', { violacoes_criticas: ['leu o shard de outro operador'] }),
    ],
  });
  assert.equal(a.veredito, 'BLOQUEADO');
  assert.ok(a.motivos[0].includes('outro operador'));
});

// ---------------------------------------------------------------------------
// C. As três regras de apuração
// ---------------------------------------------------------------------------

test('C1. evidência de outro commit não conta — e é reportada como obsoleta', () => {
  /* É assim que uma bateria "sempre verde" nasce: alguém rodou uma vez, o
     código andou, e o verde ficou. */
  const baterias = [bateria('a', true, true)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: [passou('a', { commit: OUTRO_COMMIT })],
  });
  assert.equal(a.veredito, 'VALIDACAO_INCOMPLETA');
  assert.equal(a.linhas[0].status, 'NAO_EXECUTADA');
  assert.match(a.linhas[0].observacao, /obsoleta/);
  assert.equal(a.linhas[0].obsoletos.length, 1);
});

test('C2. commit curto casa com commit longo, nos dois sentidos', () => {
  const baterias = [bateria('a', true, true)];
  const curto = apurar({
    commit: COMMIT.slice(0, 7),
    baterias,
    registros: [passou('a', { commit: COMMIT })],
  });
  const longo = apurar({
    commit: COMMIT,
    baterias,
    registros: [passou('a', { commit: COMMIT.slice(0, 7) })],
  });
  assert.equal(curto.veredito, 'PRONTO');
  assert.equal(longo.veredito, 'PRONTO');
});

test('C3. duas rodadas do mesmo commit que discordam valem a PIOR', () => {
  /* Intermitente nunca foi aprovação: um defeito observado uma vez é um
     defeito, e a rodada seguinte que passou não o desfaz. */
  const baterias = [bateria('a', true, false)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: [
      falhou('a', { instante: '2026-08-17T10:00:00.000Z' }),
      passou('a', { instante: '2026-08-17T23:00:00.000Z' }),
    ],
  });
  assert.equal(a.veredito, 'FALHOU');
  assert.match(a.linhas[0].observacao, /discordam/);
});

test('C4. PASSOU sem artefato é rebaixado a inconclusiva, não aceito', () => {
  const baterias = [bateria('a', true, false)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: [passou('a', { artefato: null })],
  });
  assert.equal(a.linhas[0].status, 'EXECUTADA_INCONCLUSIVA');
  assert.equal(a.veredito, 'VALIDACAO_INCOMPLETA');
  assert.match(a.linhas[0].observacao, /sem evidência válida/);
});

test('C5. registro malformado que já dizia FALHOU continua falhando', () => {
  /* Rebaixar este esconderia defeito real atrás de erro de preenchimento. Só a
     alegação de SUCESSO perde força quando o registro não fecha. */
  const baterias = [bateria('a', true, true)];
  const a = apurar({
    commit: COMMIT,
    baterias,
    registros: [falhou('a', { cenarios: 99 })], // soma não fecha
  });
  assert.equal(a.linhas[0].status, 'EXECUTADA_FALHOU');
  assert.equal(a.veredito, 'BLOQUEADO');
  assert.ok(a.linhas[0].problemas.length > 0);
});

test('C6. o veredito não depende da ordem de leitura do disco', () => {
  const baterias = [
    bateria('a', true, true),
    bateria('b', true, false),
    bateria('c', false, false),
  ];
  const registros = [passou('a'), falhou('b'), passou('c')];
  const direto = apurar({ commit: COMMIT, baterias, registros });
  const invertido = apurar({
    commit: COMMIT,
    baterias: [...baterias].reverse(),
    registros: [...registros].reverse(),
  });
  assert.equal(direto.veredito, invertido.veredito);
});

// ---------------------------------------------------------------------------
// D. O validador de evidência — a Fase 6 em código
// ---------------------------------------------------------------------------

test('D1. PASSOU precisa de artefato, cenário e contagem que fecha', () => {
  assert.deepEqual(conferirRegistro(passou('a')), []);
  assert.ok(conferirRegistro(passou('a', { artefato: null })).length > 0);
  assert.ok(conferirRegistro(passou('a', { cenarios: 0, passou: 0 })).length > 0);
  assert.ok(conferirRegistro(passou('a', { falhou: 1 })).length > 0);
  assert.ok(conferirRegistro(passou('a', { inconclusivo: 1 })).length > 0);
});

test('D2. PASSOU com violação crítica é contradição registrada', () => {
  const p = conferirRegistro(passou('a', { violacoes_criticas: ['vazou segredo'] }));
  assert.ok(p.some((x) => x.campo === 'violacoes_criticas'));
});

test('D3. NAO_EXECUTADA com cenário contado ou artefato é incoerente', () => {
  const base = passou('a', {
    status: 'NAO_EXECUTADA',
    cenarios: 0,
    passou: 0,
    artefato: null,
  });
  assert.deepEqual(conferirRegistro(base), []);
  assert.ok(conferirRegistro({ ...base, cenarios: 5 }).length > 0);
  assert.ok(conferirRegistro({ ...base, artefato: 'x.log' }).length > 0);
});

test('D4. commit que não é SHA é recusado', () => {
  assert.ok(conferirRegistro(passou('a', { commit: 'main' })).length > 0);
  assert.ok(conferirRegistro(passou('a', { commit: 'ZZZZZZZ' })).length > 0);
});

test('D5. FALHOU sem cenário falhado nem violação nomeada não descreve nada', () => {
  const p = conferirRegistro(
    passou('a', { status: 'EXECUTADA_FALHOU', passou: 3, falhou: 0 }),
  );
  assert.ok(p.some((x) => x.campo === 'falhou'));
});

// ---------------------------------------------------------------------------
// E. Severidade e permissão
// ---------------------------------------------------------------------------

test('E1. só PRONTO e PRONTO_COM_RISCOS autorizam a palavra', () => {
  const todos: Veredito[] = [
    'PRONTO',
    'PRONTO_COM_RISCOS',
    'VALIDACAO_INCOMPLETA',
    'FALHOU',
    'BLOQUEADO',
  ];
  assert.deepEqual(
    todos.filter(podeChamarDePronto),
    ['PRONTO', 'PRONTO_COM_RISCOS'],
  );
});

test('E2. maisSevero é comutativo e BLOQUEADO vence tudo', () => {
  const todos: Veredito[] = [
    'PRONTO',
    'PRONTO_COM_RISCOS',
    'VALIDACAO_INCOMPLETA',
    'FALHOU',
    'BLOQUEADO',
  ];
  for (const a of todos) {
    for (const b of todos) assert.equal(maisSevero(a, b), maisSevero(b, a));
    assert.equal(maisSevero(a, 'BLOQUEADO'), 'BLOQUEADO');
  }
});

test('E3. o resumo nomeia o veredito e diz se pode chamar de pronto', () => {
  const a = apurar({ commit: COMMIT, baterias: [bateria('a', true, true)], registros: [] });
  const texto = resumo(a);
  assert.match(texto, /VEREDITO: VALIDACAO_INCOMPLETA/);
  assert.match(texto, /pode chamar de pronto: NÃO/);
});

// ---------------------------------------------------------------------------
// F. O diário em disco
// ---------------------------------------------------------------------------

test('F1. linha ilegível é reportada, nunca engolida', () => {
  /* Um leitor que engole JSON quebrado transforma corrupção de disco em "essa
     bateria nunca rodou" — e o veredito sai plausível e errado. */
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-validacao-'));
  const caminho = path.join(raiz, 'diario.jsonl');
  try {
    registrar(passou('a'), caminho);
    writeFileSync(caminho, `${JSON.stringify(passou('a'))}\n{ isto não é json\n`, 'utf8');
    registrar(passou('b'), caminho);

    const leitura = ler(caminho);
    assert.equal(leitura.registros.length, 2);
    assert.equal(leitura.ilegiveis.length, 1);
    assert.match(leitura.ilegiveis[0], /linha 2/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('F2. registro com campo faltando não é completado por padrão', () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-validacao-'));
  const caminho = path.join(raiz, 'diario.jsonl');
  try {
    const semArtefato: Record<string, unknown> = { ...passou('a') };
    delete semArtefato.artefato;
    const semOraculo: Record<string, unknown> = { ...passou('b') };
    delete semOraculo.versao_oraculo;
    writeFileSync(
      caminho,
      `${JSON.stringify(semArtefato)}\n${JSON.stringify(semOraculo)}\n`,
      'utf8',
    );

    const leitura = ler(caminho);
    // `artefato` aceita valor nulo e não aceita chave ausente: as duas formas
    // dizem a mesma coisa ao motor, e completar por padrão seria inventar
    // declaração que ninguém escreveu.
    assert.equal(leitura.registros.length, 0);
    assert.equal(leitura.ilegiveis.length, 2);
    assert.match(leitura.ilegiveis[0], /artefato/);
    assert.match(leitura.ilegiveis[1], /versao_oraculo/);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('F3. diário inexistente significa nenhuma execução, não erro', () => {
  const leitura = ler(path.join(tmpdir(), 'iara-diario-que-nao-existe-1234.jsonl'));
  assert.deepEqual(leitura.registros, []);
  assert.deepEqual(leitura.ilegiveis, []);
});
