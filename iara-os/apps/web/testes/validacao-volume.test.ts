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
  assert.equal(Object.keys(r.por_modo).length, 6, `modos sorteados: ${Object.keys(r.por_modo)}`);
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
  assert.deepEqual([...MODOS_DE_CAOS].sort(), ['jornal_desaparece', 'provedor_explode']);
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
  assert.ok(r.turnos > 50, `só ${r.turnos} turnos em 3 s — o motor está lento ou parado`);
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
