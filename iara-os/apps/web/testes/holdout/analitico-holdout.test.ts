/**
 * O PORTÃO DO HOLDOUT — os cenários de `cenarios.ts` contra `montarDossie`.
 *
 * Este arquivo NÃO tem asserção própria sobre o desenho interno. Ele lê a
 * expectativa declarada no cenário e confere. É de propósito: assim, escrever
 * um caso novo não exige tocar em código de teste, e ninguém consegue "ajustar
 * o portão" mexendo numa asserção — só mexendo na exigência, que é visível na
 * revisão.
 *
 * NENHUM CASO CASA SUBSTRING DE REDAÇÃO. O portão é sempre veredicto, degrau,
 * código de ressalva ou contagem — a lição de `iara-falso-verde-por-ancora-de-texto`:
 * teste que procura frase na resposta passa sozinho, porque a redação muda.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { montarDossie } from '../../servidor/nucleo/kernel/DossieAnalitico';
import { AGORA, CENARIOS } from './cenarios';

const ORDEM = ['nenhum', 'descritiva', 'populacional', 'comparativa', 'causal'] as const;
const altura = (d: string): number => ORDEM.indexOf(d as (typeof ORDEM)[number]);

const FORCA_CONFIANCA = { baixa: 1, media: 2, alta: 3 } as const;

test('holdout: a biblioteca cobre a matriz cognitiva declarada', () => {
  /* Um holdout de 13 casos todos do mesmo domínio provaria pouco. O portão aqui
     é a VARIEDADE, não o tamanho — e ele falha se alguém encolher a matriz. */
  const dominios = new Set(CENARIOS.map((c) => c.dominio));
  const evidencias = new Set(CENARIOS.map((c) => c.evidencia));
  const raciocinios = new Set(CENARIOS.map((c) => c.raciocinio));
  const riscos = new Set(CENARIOS.map((c) => c.risco));

  assert.ok(dominios.size >= 7, `domínios cobertos: ${dominios.size}`);
  assert.equal(evidencias.size, 5, 'as cinco qualidades de evidência têm de aparecer');
  assert.ok(raciocinios.size >= 6, `tipos de raciocínio: ${raciocinios.size}`);
  assert.equal(riscos.size, 4, 'os quatro níveis de risco têm de aparecer');
  assert.ok(new Set(CENARIOS.map((c) => c.id)).size === CENARIOS.length, 'ids duplicados');
});

for (const cenario of CENARIOS) {
  test(`holdout ${cenario.id} — ${cenario.armadilha}`, () => {
    const d = montarDossie({
      analise_id: `holdout-${cenario.id}`,
      pergunta: cenario.pergunta,
      evidencias: cenario.evidencias,
      ferramentas: cenario.ferramentas,
      agora: AGORA,
    });

    const codigos = d.ressalvas.map((x) => x.codigo);
    const contexto =
      `\n  pergunta: ${cenario.pergunta}` +
      `\n  nível: ${d.nivel.nivel} (pretende ${d.nivel.tipo_pretendido})` +
      `\n  degrau: ${d.degrau} · veredicto: ${d.suficiencia.veredicto}` +
      `\n  ressalvas: ${codigos.join(', ') || '(nenhuma)'}`;

    if (cenario.esperado.veredicto) {
      assert.equal(
        d.suficiencia.veredicto,
        cenario.esperado.veredicto,
        `veredicto${contexto}`,
      );
    }

    if (cenario.esperado.degrau_maximo) {
      assert.ok(
        altura(d.degrau) <= altura(cenario.esperado.degrau_maximo),
        `degrau passou do teto de ${cenario.esperado.degrau_maximo}${contexto}`,
      );
    }

    for (const exigida of cenario.esperado.ressalvas_exigidas ?? []) {
      assert.ok(codigos.includes(exigida), `faltou a ressalva ${exigida}${contexto}`);
    }

    for (const proibida of cenario.esperado.ressalvas_proibidas ?? []) {
      assert.ok(!codigos.includes(proibida), `ressalva indevida ${proibida}${contexto}`);
    }

    if (cenario.esperado.confianca_maxima) {
      assert.ok(
        FORCA_CONFIANCA[d.suficiencia.confiabilidade.confianca] <=
          FORCA_CONFIANCA[cenario.esperado.confianca_maxima],
        `confiança ${d.suficiencia.confiabilidade.confianca} acima do teto ` +
          `${cenario.esperado.confianca_maxima}${contexto}`,
      );
    }

    if (cenario.esperado.confianca_minima) {
      assert.ok(
        FORCA_CONFIANCA[d.suficiencia.confiabilidade.confianca] >=
          FORCA_CONFIANCA[cenario.esperado.confianca_minima],
        `confiança ${d.suficiencia.confiabilidade.confianca} abaixo do piso ` +
          `${cenario.esperado.confianca_minima} (pontuação ` +
          `${d.suficiencia.confiabilidade.pontuacao.toFixed(3)})${contexto}`,
      );
    }

    if (cenario.esperado.exige_o_que_falta) {
      assert.ok(
        d.suficiencia.o_que_falta.length > 0,
        `não disse o que destravaria${contexto}`,
      );
    }

    /* INVARIANTE QUE VALE PARA TODO CENÁRIO, e não está em nenhum deles: o
       dossiê tem de ser auditável por terceiro. Uma linha de auditoria que não
       parseia é uma trilha que ninguém vai conseguir ler no dia do incidente. */
    assert.equal(typeof d.analise_id, 'string');
    assert.ok(d.instante === AGORA, 'o dossiê não pode ler o relógio por conta própria');
  });
}

test('holdout: o mesmo cenário duas vezes dá exatamente o mesmo dossiê', () => {
  /* ESTABILIDADE SOB REPETIÇÃO. Uma camada analítica que varia entre execuções
     com a mesma entrada não é auditável — e a variância estrutural já custou
     caro nesta casa (os 75/75/timeout/53). Aqui ela é impossível por
     construção: nenhum módulo da camada lê relógio, rede ou aleatório. Este
     teste é o que impede alguém de introduzir um `Date.now()` amanhã. */
  for (const cenario of CENARIOS) {
    const entrada = {
      analise_id: `rep-${cenario.id}`,
      pergunta: cenario.pergunta,
      evidencias: cenario.evidencias,
      ferramentas: cenario.ferramentas,
      agora: AGORA,
    };
    const a = montarDossie(entrada);
    const b = montarDossie(entrada);
    assert.deepEqual(a, b, `${cenario.id} não é determinístico`);
  }
});
