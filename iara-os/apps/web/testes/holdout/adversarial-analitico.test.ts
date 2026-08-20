/**
 * VARREDURA ADVERSARIAL — as tentativas de FURAR a camada analítica.
 *
 * Os outros arquivos perguntam "ela funciona?". Este pergunta "como eu passo por
 * cima dela?". A diferença importa porque um motor de crítica é uma trava, e
 * trava só vale o que o ataque contra ela provou — a lição de
 * `iara-duble-nao-pode-ser-o-porteiro`: "0 contornos" era vácuo por construção,
 * porque ninguém tinha tentado contornar.
 *
 * DOIS DESTES CASOS ACHARAM DEFEITO REAL na primeira execução (A1 e A2), e os
 * dois estão consertados. Ficam aqui como teste de mutação: se alguém amanhã
 * reintroduzir o buraco, o caso acusa.
 *
 * O ATACANTE AQUI É UMA HABILIDADE, não o operador. É o modelo de ameaça certo:
 * `Evidencia` é declarada por quem escreve a habilidade, e uma habilidade mal
 * escrita (ou escrita para agradar) é o vetor realista. O operador não alcança
 * este tipo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { medirCobertura } from '../../servidor/nucleo/kernel/Cobertura';
import { linhaDeAuditoria, montarDossie } from '../../servidor/nucleo/kernel/DossieAnalitico';
import { criticar } from '../../servidor/nucleo/kernel/MotorCritica';
import type { Evidencia } from '../../servidor/nucleo/kernel/Investigacao';

const AGORA = '2026-08-19T18:00:00.000Z';

const ev = (p: Partial<Evidencia> & { metrica: string }): Evidencia => ({
  fonte: 'planilha_luft',
  valor: 42,
  unidade: '',
  procedencia: 'fato',
  relevancia: 'direta',
  instante: '2026-08-19T17:50:00.000Z',
  ...p,
});

const analisar = (evidencias: readonly Evidencia[], pergunta = 'quantas cargas no total?') =>
  montarDossie({
    analise_id: 'adv',
    pergunta,
    evidencias,
    ferramentas: ['lab'],
    agora: AGORA,
  });

// ===========================================================================
// A. Escapes de rotulagem — a habilidade mente sobre o próprio dado
// ===========================================================================

test('A1. rotular tudo como `contextual` NÃO escapa da crítica', () => {
  /**
   * O ESCAPE, achado em varredura própria: oito das dez contestações olham só
   * para `relevancia: 'direta'`. Uma habilidade que declarasse tudo como
   * contexto passava com sete regras cegas e a conclusão saía no degrau pedido.
   */
  const d = analisar([
    ev({
      metrica: 'margem',
      valor: 31.4,
      relevancia: 'contextual',
      cobertura: medirCobertura({ elegiveis: 100, consideradas: 12 }),
    }),
  ]);
  assert.equal(d.degrau, 'nenhum', 'contexto não sustenta conclusão');
  assert.equal(d.suficiencia.veredicto, 'abster');
});

test('A2. NaN não atravessa como número — a única "invenção" que o resto não pega', () => {
  /* 0/0 em JS é NaN, e toda comparação com NaN é falsa: `divergem` não acusa,
     `zeroEhAusencia` não acusa. "A margem foi NaN%" sairia com procedência
     `fato`. */
  for (const valor of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const d = analisar([
      ev({ metrica: 'margem', valor, cobertura: medirCobertura({ elegiveis: 9, consideradas: 9 }) }),
    ]);
    assert.equal(d.degrau, 'nenhum', `${valor} passou`);
    assert.equal(d.suficiencia.veredicto, 'abster', `${valor} passou`);
  }
});

test('A3. declarar cobertura 100% sobre 3 de 200 registros é impossível por construção', () => {
  /* `medirCobertura` CALCULA o percentual. Não existe assinatura que aceite um
     percentual de fora — mesma disciplina de `criarHipotese`. */
  const c = medirCobertura({ elegiveis: 200, consideradas: 3 });
  assert.equal(c.percentual, 1.5);
  const d = analisar([ev({ metrica: 'x', cobertura: c })]);
  assert.ok(d.ressalvas.some((r) => r.codigo === 'cobertura_parcial'));
  assert.equal(d.degrau, 'descritiva');
});

test('A4. procedência `fato_verificado` mentirosa ainda esbarra na cobertura', () => {
  /**
   * Procedência é AUTODECLARADA — o cabeçalho de `ResultadoHabilidade` já avisa
   * que `resolveu: true` nunca é prova. Uma habilidade pode carimbar
   * `fato_verificado` num número ruim. O que ela NÃO consegue é forjar a
   * aritmética da cobertura, e é por isso que as duas travas são independentes.
   */
  const d = analisar([
    ev({
      metrica: 'margem',
      procedencia: 'fato_verificado',
      cobertura: medirCobertura({ elegiveis: 1000, consideradas: 210 }),
    }),
  ]);
  assert.equal(d.degrau, 'descritiva');
  assert.notEqual(d.suficiencia.confiabilidade.confianca, 'alta');
});

// ===========================================================================
// B. Escapes de escada — subir um degrau que a evidência não paga
// ===========================================================================

test('B1. uma evidência ótima não compensa uma péssima', () => {
  /**
   * ⚠️ Expectativa revista em 19/08/2026 — ver `critica-analitica.test.ts` B11
   * para a cadeia inteira. Em resumo: o teto de uma ressalva vale para o TURNO,
   * e derrubar o turno inteiro por uma métrica vazia jogava fora números 100%
   * apurados. O que este caso protege — a evidência boa não LEVANTA o teto —
   * continua valendo, agora com a ausência nomeada em vez de anônima.
   */
  const d = analisar([
    ev({ metrica: 'bom', cobertura: medirCobertura({ elegiveis: 5000, consideradas: 5000 }) }),
    ev({ metrica: 'ruim', valor: 0, cobertura: medirCobertura({ elegiveis: 40, consideradas: 0 }) }),
  ]);
  assert.equal(d.degrau, 'descritiva', 'a evidência boa não pode levantar o teto');
  assert.ok(d.ressalvas.some((r) => r.codigo === 'ausencia_como_zero'));
  assert.notEqual(d.suficiencia.veredicto, 'concluir', 'e o turno não sai limpo');

  /* Tudo vazio continua sendo abstenção — o chão não se moveu. */
  const nada = analisar([
    ev({ metrica: 'ruim', valor: 0, cobertura: medirCobertura({ elegiveis: 40, consideradas: 0 }) }),
  ]);
  assert.equal(nada.degrau, 'nenhum');
  assert.equal(nada.suficiencia.veredicto, 'abster');
});

test('B2. muitas ressalvas leves não viram uma impeditiva (nem o contrário)', () => {
  /* O simétrico do B1: acumular ressalva leve não pode DERRUBAR a resposta, ou
     a crítica vira recusa por volume. */
  const leves = Array.from({ length: 12 }, (_, i) =>
    ev({
      metrica: `m${i}`,
      fonte: `fonte_${i}`,
      cobertura: medirCobertura({ elegiveis: 100, consideradas: 97 }),
    }),
  );
  const d = analisar(leves);
  assert.notEqual(d.suficiencia.veredicto, 'abster');
  assert.ok(d.ressalvas.every((r) => r.gravidade !== 'impeditiva'));
});

test('B3. pergunta causal não consegue comprar o degrau com volume de evidência', () => {
  const muitas = Array.from({ length: 30 }, (_, i) =>
    ev({
      metrica: `m${i}`,
      fonte: `fonte_${i % 5}`,
      cobertura: medirCobertura({ elegiveis: 900, consideradas: 900 }),
    }),
  );
  const d = analisar(muitas, 'por que a margem caiu?');
  assert.ok(d.ressalvas.some((r) => r.codigo === 'causa_sem_lastro'));
  assert.equal(d.degrau, 'comparativa', '30 evidências perfeitas não fazem um experimento');
});

// ===========================================================================
// C. Entradas degeneradas — nada pode derrubar o turno
// ===========================================================================

test('C1. instante inválido não quebra e não vira "dado fresco"', () => {
  const d = analisar([ev({ metrica: 'x', instante: 'não é uma data' })]);
  assert.ok(d.degrau !== undefined, 'não pode lançar');
  /* Data ilegível não pode virar ressalva de idade falsa nem silêncio: ela
     simplesmente não sustenta afirmação de recência. */
  assert.equal(d.ressalvas.some((r) => r.codigo === 'dado_envelhecido'), false);
});

test('C2. cobertura com números absurdos é normalizada, não explode', () => {
  const c = medirCobertura({ elegiveis: -5, consideradas: -99 });
  assert.equal(c.elegiveis, 0);
  assert.equal(c.consideradas, 0);
  assert.equal(c.percentual, null);
  assert.doesNotThrow(() => analisar([ev({ metrica: 'x', cobertura: c })]));
});

test('C3. métrica com nome vazio ou gigante não quebra a redação', () => {
  const d = analisar([
    ev({ metrica: '' }),
    ev({ metrica: 'x'.repeat(5000), fonte: 'outra' }),
  ]);
  assert.equal(typeof d.suficiencia.texto, 'string');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(d)));
});

test('C4. a crítica é pura: mesma entrada, mesma saída, sem tocar relógio', () => {
  const evidencias = [ev({ metrica: 'x', cobertura: medirCobertura({ elegiveis: 8, consideradas: 6 }) })];
  const a = criticar({ evidencias, tipo_pretendido: 'populacional', agora: AGORA });
  const b = criticar({ evidencias, tipo_pretendido: 'populacional', agora: AGORA });
  assert.deepEqual(a, b);
});

// ===========================================================================
// D. Não-conformidade — o que a missão proíbe, tentado de frente
// ===========================================================================

test('D1. a IARA não pode dizer "confiança alta" com uma ressalva séria na mesa', () => {
  const d = analisar([
    ev({
      metrica: 'margem',
      procedencia: 'fato_verificado',
      cobertura: medirCobertura({ elegiveis: 4064, consideradas: 3579 }),
    }),
  ]);
  assert.ok(d.ressalvas.some((r) => r.gravidade === 'seria'));
  assert.notEqual(d.suficiencia.confiabilidade.confianca, 'alta');
});

test('D2. abster sempre nomeia o que destravaria — nunca só "não sei"', () => {
  const casos: readonly Evidencia[][] = [
    [ev({ metrica: 'a', valor: 0, cobertura: medirCobertura({ elegiveis: 10, consideradas: 0 }) })],
    [ev({ metrica: 'b', valor: 1, fonte: 'f1' }), ev({ metrica: 'b', valor: 2, fonte: 'f2' })],
    [ev({ metrica: 'c', valor: Number.NaN })],
  ];
  for (const evidencias of casos) {
    const d = analisar(evidencias);
    assert.equal(d.suficiencia.veredicto, 'abster', JSON.stringify(evidencias[0]));
    assert.ok(
      d.suficiencia.o_que_falta.length > 0,
      `abstenção sem saída declarada: ${d.suficiencia.texto}`,
    );
  }
});

test('D3. a linha de auditoria reconstrói a decisão sem depender de texto livre', () => {
  const d = analisar([
    ev({ metrica: 'margem', cobertura: medirCobertura({ elegiveis: 100, consideradas: 71 }) }),
  ]);
  /* O que um auditor precisa: qual nível, qual degrau, qual veredicto, sobre
     quantos registros, e quais ressalvas. Nada de raciocínio. */
  const linha = JSON.parse(linhaDeAuditoria(d));
  assert.equal(linha.degrau_sustentado, 'descritiva');
  assert.equal(linha.evidencias[0].consideradas, 71);
  assert.equal(linha.evidencias[0].elegiveis, 100);
  assert.ok(Array.isArray(linha.ressalvas));
  assert.equal(
    JSON.stringify(linha).includes('raciocinio_do_modelo'),
    false,
    'o dossiê não guarda cadeia de pensamento',
  );
});
