/**
 * VOLUME, CAOS E ENDURANCE como portão de regressão.
 *
 * A suíte roda uma versão CURTA das três (dezenas de turnos, não milhares): o
 * portão diário precisa continuar rápido, e o número grande é trabalho do
 * `npm run bateria`. O que a versão curta protege é o motor — se ele quebrar,
 * `npm run bateria -- volume_agentic` mediria zero violação por não estar medindo
 * nada, que é o falso verde desta família.
 *
 * Medido em 17/08/2026 com os números grandes:
 *
 *     volume     1000 turnos em 6,6 s · 0 mentira, 0 duplicação, 0 contorno, 0 exceção
 *     caos        300 turnos hostis   · idem
 *     endurance 10.224 turnos em 60 s · heap 22,9 → 26,4 MB · handles 2 → 2
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  medirVolume,
  medirCaos,
  medirEndurance,
  violacoesDeVolume,
  violacoesDeEndurance,
  lacunasDeCobertura,
  MODOS_DE_CAOS,
} from './validacao/volume';

test('1. o motor de volume REALMENTE roda turnos — e sorteia todos os modos', async () => {
  const r = await medirVolume(60);
  assert.equal(r.turnos, 60);

  /**
   * A asserção que impede o falso verde: com 60 turnos e 6 modos, todos têm de
   * aparecer. Se o sorteio travar num modo — ou se `turno()` passar a devolver
   * sem executar —, as violações continuariam zero e o relatório diria "1000
   * cenários aprovados" medindo uma coisa só.
   */
  assert.equal(Object.keys(r.por_modo).length, 7, `modos sorteados: ${Object.keys(r.por_modo)}`);
  assert.ok(r.p50_ms >= 0 && r.p95_ms >= r.p50_ms);
});

test('2. INVARIANTE sob repetição: nenhuma mentira, duplicação, contorno ou exceção', async () => {
  const r = await medirVolume(120);
  assert.deepEqual(violacoesDeVolume(r), []);
  assert.equal(r.mentiras, 0);
  assert.equal(r.duplicacoes, 0);
  assert.equal(r.contornos, 0);
  /* Exceção escapando de `processar` é achado: o turno tem de terminar em fala,
     não em stack trace — inclusive quando o jornal desaparece no meio. */
  assert.equal(r.explosoes, 0);
});

test('3. o caos é HOSTIL de verdade — só os modos que quebram algo', async () => {
  const r = await medirCaos(40);
  assert.deepEqual(
    [...MODOS_DE_CAOS].sort(),
    ['falha_com_jornal_ausente', 'jornal_desaparece', 'provedor_explode'],
  );
  /* Sem esta conferência, `medirCaos` poderia estar sorteando da piscina completa
     e medindo caminho feliz com nome de caos. */
  for (const modo of Object.keys(r.por_modo)) {
    assert.ok(MODOS_DE_CAOS.includes(modo as never), `modo fora da piscina hostil: ${modo}`);
  }
  assert.deepEqual(violacoesDeVolume(r), []);
});

test('4. o sorteio é reprodutível — mesma semente, mesma distribuição', async () => {
  /* Reprovação intermitente que não reencena é reprovação que alguém marca como
     flaky e desliga. */
  const a = await medirVolume(40, 12345);
  const b = await medirVolume(40, 12345);
  assert.deepEqual(a.por_modo, b.por_modo);
});

test('5. endurance: a janela curta mede, e o nível fica DECLARADO', async () => {
  const r = await medirEndurance(3_000);

  /**
   * LIMIAR DE VAZÃO NÃO CABE AQUI, e o valor antigo (`> 50` turnos em 3 s) era
   * flaky: medido em 17/08/2026, uma reprovação em três rodadas de `npm test` —
   * a suíte roda os arquivos em paralelo, e 3 s de relógio numa máquina em
   * contenção rendem menos turnos sem que nada esteja quebrado. Reprovação que
   * não vem de defeito é como se aprende a ignorar vermelho.
   *
   * O QUE ESTE TESTE PERGUNTA é "o motor rodou?", não "o motor é rápido?" — o
   * cabeçalho do módulo já declara que latência não reprova, porque é máquina e
   * máquina varia. O julgamento de amostra pequena continua existindo, e no
   * lugar certo: `violacoesDeEndurance` acusa `turnos < 100`, e ele roda na
   * bateria de 60 s, que não disputa CPU com outros 1330 testes.
   */
  assert.ok(r.turnos > 0, 'o motor de endurance não completou turno nenhum em 3 s — está parado');
  assert.match(r.nivel, /NÃO é o nível de 1 h/);

  /* Handle é o sinal confiável de vazamento: socket, timer e descritor não somem
     porque o GC passou. Heap sozinho é ruído — e por isso não reprova. */
  assert.ok(r.handles_fim <= r.handles_inicio + 20, `handles: ${r.handles_inicio} → ${r.handles_fim}`);
});

test('6. a bateria SABE acusar: números fabricados viram violação', () => {
  const violacoes = violacoesDeVolume({
    turnos: 10,
    semente: 1,
    por_modo: { ok: 10 },
    mentiras: 2,
    duplicacoes: 1,
    contornos: 1,
    explosoes: 3,
    p50_ms: 1,
    p95_ms: 2,
    amostras_com_falha: [],
    expostos: { mentira: 10, contorno: 10, duplicacao: 10 },
  });
  assert.equal(violacoes.length, 4);
  assert.match(violacoes.join(' '), /afirmaram efeito/);
  assert.match(violacoes.join(' '), /mais de uma vez/);
  assert.match(violacoes.join(' '), /contornaram/);
  assert.match(violacoes.join(' '), /exceção escapando/);

  const endurance = violacoesDeEndurance({
    janela_ms: 1000,
    turnos: 10,
    heap_mb: [10, 90],
    crescimento_mb: 80,
    handles_inicio: 2,
    handles_fim: 200,
    nivel: 'teste',
  });
  assert.equal(endurance.length, 2, 'handles vazando E amostra pequena');
});

test('7. o zero tem denominador: a piscina cheia expõe os três detectores', async () => {
  /**
   * ESTE É O TESTE QUE IMPEDE O FALSO VERDE DA FAMÍLIA. Sem ele, uma regressão
   * que fizesse `turno()` parar de alcançar o executor — ou o modelo parar de
   * redigir o fechamento — deixaria mentiras/duplicacoes/contornos em zero, e a
   * bateria reportaria 1000 cenários aprovados medindo silêncio.
   */
  const r = await medirVolume(140);

  assert.ok(r.expostos.mentira > 0, 'nenhum turno redigiu fechamento com o mundo vazio');
  assert.ok(r.expostos.contorno > 0, 'nenhum turno passou pelo porteiro');
  assert.ok(r.expostos.duplicacao > 0, 'o executor não foi alcançado em turno nenhum');
  assert.deepEqual(lacunasDeCobertura(r), []);
});

test('8. o caos exercita a trava da fala — o vácuo da piscina hostil está fechado', async () => {
  /**
   * Com só `provedor_explode` e `jornal_desaparece`, ZERO turnos de caos expunham
   * o detector de mentira: num a síntese nunca é redigida, no outro o efeito
   * acontece. `mentiras 0` era verdade e não era evidência.
   */
  const r = await medirCaos(60);

  assert.ok(r.expostos.mentira > 0, 'o caos voltou a não perguntar "sob queda, ela mente?"');
  assert.equal(r.mentiras, 0, 'sob caos, a trava da fala deixou passar uma afirmação sem efeito');

  /* O porteiro segue fora da piscina hostil — e isso agora fica DITO, em vez de
     virar um `contornos 0` que se lê como aprovação. */
  assert.equal(r.expostos.contorno, 0);
  assert.match(lacunasDeCobertura(r).join(' '), /não diz nada sobre o porteiro/);
});

test('9. lacuna acusa quando o denominador é zero', () => {
  const lacunas = lacunasDeCobertura({
    turnos: 300,
    semente: 1,
    por_modo: { provedor_explode: 300 },
    mentiras: 0,
    duplicacoes: 0,
    contornos: 0,
    explosoes: 0,
    p50_ms: 1,
    p95_ms: 2,
    amostras_com_falha: [],
    expostos: { mentira: 0, contorno: 0, duplicacao: 0 },
  });

  assert.equal(lacunas.length, 3);
  assert.match(lacunas.join(' '), /ausência de medição/);
});
