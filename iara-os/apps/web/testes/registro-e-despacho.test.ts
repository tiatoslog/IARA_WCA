/**
 * O REGISTRO E O CLI TÊM DE CONCORDAR.
 *
 * Nasceu de um sumiço real, em 18/08/2026: três baterias (`volume_agentic`, `caos`,
 * `endurance`) tinham harness escrito, despacho no CLI funcionando — e o campo
 * `harness` do registro voltou a `null`. Duas sessões editaram o mesmo arquivo no
 * mesmo dia e a última escrita venceu; o meu próprio commit levou a versão sem o
 * ponteiro, sem ninguém notar.
 *
 * O efeito era pior que estético: `npm run veredito` lê o registro, então três
 * baterias que existem e passam apareciam como "não há harness desta bateria" —
 * o veredito subdeclarando a própria cobertura, que é a forma mais silenciosa de
 * um gate mentir.
 *
 * O portão de superfície não pega isto de propósito: ele assina id, obrigatória e
 * crítica, e deixa prosa e caminho de fora para não virar ruído a cada comentário
 * editado. Esta conferência é a que faltava — e ela compara DUAS FONTES que já
 * existem, sem inventar uma terceira lista para manter em dia.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { BATERIAS } from './validacao/registro';

/** Os ids que o CLI sabe executar, lidos do despacho real. */
function idsComDespacho(): Set<string> {
  const fonte = readFileSync(
    new URL('./validacao/executar.ts', import.meta.url),
    'utf8',
  );
  /**
   * A FATIA PARA NO FECHAMENTO DO OBJETO, e o dígito entra na classe.
   *
   * As duas coisas foram erro meu na primeira versão deste arquivo, e as duas
   * produziram o mesmo tipo de resultado errado: varrer até o fim do arquivo trouxe
   * os campos do registro de evidência (`status:`, `metricas:`, `artefato:`) como
   * se fossem baterias, e `[a-z_]+` não casa `e2e_navegador` — que tem um 2 no meio.
   * A bateria do navegador aparecia como "sem despacho" tendo despacho.
   *
   * Ler código com expressão regular é frágil por natureza; o que torna isto
   * aceitável é que os três casos abaixo falham alto quando a leitura erra, em vez
   * de silenciarem.
   */
  const inicio = fonte.indexOf('BATERIAS_EXECUTAVEIS');
  const fim = fonte.indexOf('\n};', inicio);
  const bloco = fonte.slice(inicio, fim > 0 ? fim : undefined);
  const ids = new Set<string>();
  for (const m of bloco.matchAll(/^  ([a-z0-9_]+):/gm)) ids.add(m[1]);
  return ids;
}

test('toda bateria com harness declarado tem despacho no CLI', () => {
  const despacho = idsComDespacho();
  const semDespacho = BATERIAS.filter((b) => b.harness !== null && !despacho.has(b.id));
  assert.deepEqual(
    semDespacho.map((b) => b.id),
    [],
    'registro promete harness que `npm run bateria` não sabe executar',
  );
});

test('toda bateria executável tem harness declarado no registro', () => {
  /* A direção que sumiu de verdade: o CLI executa, o registro diz `null`, e o
     veredito reporta lacuna onde existe medição. */
  const despacho = idsComDespacho();
  const mentindo = BATERIAS.filter((b) => b.harness === null && despacho.has(b.id));
  assert.deepEqual(
    mentindo.map((b) => b.id),
    [],
    'o CLI executa estas baterias e o registro declara que não há harness',
  );
});

test('a leitura do despacho encontra as baterias que sabemos existir', () => {
  /* Guarda contra o parser envelhecer em silêncio: se a expressão regular parar de
     casar, os outros dois casos ficariam verdes por lerem um conjunto vazio. */
  const despacho = idsComDespacho();
  assert.ok(despacho.size >= 20, `o despacho lido tem só ${despacho.size} entradas`);
  for (const id of ['suite', 'e2e_navegador', 'campanha_adversarial']) {
    assert.ok(despacho.has(id), `${id} sumiu da leitura do despacho`);
  }
});

test('o despacho não tem id fantasma — tudo que ele executa está no registro', () => {
  const conhecidas = new Set(BATERIAS.map((b) => b.id));
  const fantasmas = [...idsComDespacho()].filter((id) => !conhecidas.has(id));
  assert.deepEqual(fantasmas, [], 'o CLI executa bateria que o veredito nem conhece');
});
