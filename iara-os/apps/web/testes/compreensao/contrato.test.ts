/**
 * O CONTRATO SEMÂNTICO — a IARA representa o significado antes de escolher rota?
 *
 * ESTES TESTES NÃO OLHAM TEXTO DE RESPOSTA. Nenhuma asserção procura substring
 * no que a IARA escreveria — o falso verde clássico deste repositório, porque
 * ela reescreve o pedido na própria frase. Aqui só entra ESTRUTURA: ato,
 * operação, objeto, referente, hipóteses.
 *
 * O GABARITO É EXTERNO (`gabarito.ts`), escrito à mão a partir do português, sem
 * consultar a implementação. Ver o cabeçalho de lá.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compreender,
  REFERENTE_DESCONHECIDO,
  type ContratoSemantico,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';
import { DISTINTOS, EQUIVALENTES, NAO_COLAPSAM, type CasoDeCompreensao } from './gabarito';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const habilidades = MANIFESTOS.map((m) => m.id);
const conceitual = new IndiceConceitual(MANIFESTOS);
/** Relógio congelado: « amanhã » não pode significar coisas diferentes por dia. */
const AGORA = new Date('2026-08-19T10:00:00');

const ler = (frase: string): ContratoSemantico =>
  compreender({ bruto: frase, descoberta, conceitual, agora: AGORA, habilidades });

function conferir(caso: CasoDeCompreensao): void {
  const c = ler(caso.frase);
  const dizer = (d: string, esperado: unknown, obtido: unknown) =>
    `« ${caso.frase} » → ${d}: esperado ${JSON.stringify(esperado)}, veio ${JSON.stringify(obtido)}\n    ${caso.porque}`;

  if (caso.ato !== undefined) assert.equal(c.ato, caso.ato, dizer('ato', caso.ato, c.ato));
  if (caso.operacao !== undefined) {
    assert.equal(c.operacao, caso.operacao, dizer('operacao', caso.operacao, c.operacao));
  }
  if (caso.objeto !== undefined) assert.equal(c.objeto, caso.objeto, dizer('objeto', caso.objeto, c.objeto));
  if (caso.referente !== undefined) {
    assert.equal(
      c.referente.conceito,
      caso.referente,
      dizer('referente', caso.referente, c.referente.conceito),
    );
  }
  if (caso.objetivo !== undefined) {
    assert.equal(c.objetivo, caso.objetivo, dizer('objetivo', caso.objetivo, c.objetivo));
  }
}

// ---------------------------------------------------------------------------
// 1. Os casos mínimos da ordem — distinção
// ---------------------------------------------------------------------------

for (const caso of DISTINTOS) {
  test(`contrato: « ${caso.frase} »`, () => conferir(caso));
}

// ---------------------------------------------------------------------------
// 2. Equivalência — a forma muda, a operação semântica sobrevive
// ---------------------------------------------------------------------------

for (const grupo of EQUIVALENTES) {
  test(`equivalência: « ${grupo[0].frase} » e as ${grupo.length - 1} paráfrases`, () => {
    for (const caso of grupo) conferir(caso);

    /**
     * A ASSERÇÃO QUE IMPORTA não é cada caso passar contra o gabarito — é as
     * leituras CONVERGIREM entre si. Um sistema poderia acertar as quatro
     * isoladamente e mesmo assim tratá-las como coisas diferentes, se o
     * gabarito fosse frouxo. Aqui elas são comparadas umas com as outras.
     */
    const referencia = ler(grupo[0].frase);
    for (const caso of grupo.slice(1)) {
      const c = ler(caso.frase);
      assert.equal(
        c.operacao,
        referencia.operacao,
        `« ${caso.frase} » divergiu de « ${grupo[0].frase} » na operação (${c.operacao} ≠ ${referencia.operacao})`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// 3. Distinção — o que não pode colapsar
// ---------------------------------------------------------------------------

for (const par of NAO_COLAPSAM) {
  test(`distinção [${par.dimensao}]: « ${par.a} » ≠ « ${par.b} »`, () => {
    const a = ler(par.a);
    const b = ler(par.b);
    assert.notEqual(
      a[par.dimensao],
      b[par.dimensao],
      `as duas frases deram ${par.dimensao} = "${a[par.dimensao]}" — ${par.porque}`,
    );
  });
}

// ---------------------------------------------------------------------------
// 4. A incerteza sobrevive
// ---------------------------------------------------------------------------

test('hipóteses são preservadas, não reduzidas à vencedora', () => {
  /**
   * O contrato guarda TODAS as leituras que se sustentam. É o que permite a
   * camada seguinte responder "não sei entre A e B" em vez de escolher A
   * errado — e é a informação que o `return true` da descoberta destruía.
   */
  const c = ler('cria um arquivo na área de trabalho');
  assert.ok(c.hipoteses.length >= 2, 'mais de uma habilidade fala de arquivo — as outras têm que sobreviver');
  assert.equal(c.hipoteses[0].objetivo, 'criar_arquivo');

  const rebaixada = c.hipoteses.find((h) => h.objetivo === 'listar_arquivos');
  assert.ok(rebaixada, 'a habilidade de leitura tem que continuar na lista, rebaixada — nunca apagada');
  assert.equal(rebaixada.compativel, false, 'e tem que dizer POR QUE foi rebaixada');
  assert.ok(
    rebaixada.score < c.hipoteses[0].score,
    'incompatível na operação vale menos, mas continua sendo uma hipótese',
  );
});

test('cada hipótese carrega escore e evidência próprios', () => {
  const c = ler('quantas cargas foram coletadas essa semana?');
  assert.ok(c.hipoteses.length > 0);
  for (const h of c.hipoteses) {
    assert.ok(typeof h.score === 'number' && h.score > 0, `${h.objetivo} sem escore`);
    assert.ok(h.evidencias.length > 0, `${h.objetivo} sem evidência — "por que apareceu?" ficaria sem resposta`);
  }
});

test('a evidência do contrato diz de onde cada conclusão veio', () => {
  const c = ler('lista os arquivos da área de trabalho');
  const fontes = c.evidencias.map((e) => e.fonte);
  assert.ok(fontes.includes('verbo'), `a operação tem que ter fonte declarada (veio ${JSON.stringify(fontes)})`);
  assert.ok(fontes.includes('substantivo'), 'o objeto também');
});

// ---------------------------------------------------------------------------
// 5. Não inventar contexto
// ---------------------------------------------------------------------------

test('referente ausente é `desconhecido`, nunca um palpite', () => {
  /**
   * A distinção que impede a invenção de contexto: `null` = a frase não fala de
   * referente nenhum; `desconhecido` = ela DEPENDE de um e ele não está aqui.
   * Confundir os dois é como um sistema passa a afirmar o que não sabe.
   */
  for (const f of ['e aquele segundo?', 'faz a mesma coisa pro outro', 'não, cancela isso']) {
    assert.equal(ler(f).referente.conceito, REFERENTE_DESCONHECIDO, `« ${f} » depende de um antecedente que não está na frase`);
  }
  assert.equal(ler('como você está?').objeto, null, 'conversa não tem objeto de domínio');
});

test('sem âncora própria, a camada não declara objetivo', () => {
  /**
   * « e aquele segundo? » alcançava `informacoes_sistema` por empate de ruído.
   * Nomear vencedor nesse estado é transformar ausência de contexto em certeza
   * — e as hipóteses continuam na lista para quem TIVER o histórico resolver.
   */
  const c = ler('e aquele segundo?');
  assert.equal(c.objetivo, null, 'objetivo não pode ser declarado sem âncora na própria frase');
  assert.equal(c.referente.conceito, REFERENTE_DESCONHECIDO);
});

test('período só existe quando a frase nomeia tempo', () => {
  assert.equal(ler('estou livre amanhã?').periodo, '2026-08-20..2026-08-20');
  assert.equal(ler('como você está?').periodo, null, 'conversa sem tempo não pode ganhar um período');
});

// ---------------------------------------------------------------------------
// 6. Determinismo e pureza
// ---------------------------------------------------------------------------

test('a mesma frase produz o mesmo contrato, sempre', () => {
  for (const caso of DISTINTOS) {
    assert.deepEqual(
      ler(caso.frase),
      ler(caso.frase),
      `« ${caso.frase} » não é determinística — qualquer medida em cima dela seria ruído`,
    );
  }
});

test('o relógio entra por parâmetro — a compreensão não muda com o dia', () => {
  const cedo = compreender({ bruto: 'o que eu tenho amanhã?', descoberta, agora: AGORA, habilidades });
  const tarde = compreender({
    conceitual,
    bruto: 'o que eu tenho amanhã?',
    descoberta,
    agora: new Date('2026-12-31T23:00:00'),
    habilidades,
  });
  assert.equal(cedo.ato, tarde.ato, 'o ato não pode depender da data');
  assert.equal(cedo.operacao, tarde.operacao, 'a operação também não');
  assert.notEqual(cedo.periodo, tarde.periodo, 'só o período muda — e muda porque é dele que o tempo é assunto');
});
