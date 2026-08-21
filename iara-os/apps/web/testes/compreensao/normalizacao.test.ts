/**
 * NORMALIZAÇÃO DE RUÍDO — corrigir o typo sem estragar o português.
 *
 * ===========================================================================
 * A VIOLAÇÃO DE SEGURANÇA SEMÂNTICA QUE ISTO FECHA
 * ===========================================================================
 *
 * O Arnês C mediu 8 falhas de cadeia causadas por erro de digitação, e a
 * correção óbvia — distância de edição contra o vocabulário do catálogo —
 * introduziu um defeito PIOR que o original:
 *
 *     « preciso saber disso »              →  « precisa sabe disso »
 *     « qual motorosta tem MAIS cargas? »  →  « tem MAIL cargas »
 *
 * Nenhuma dessas três é erro de digitação. São palavras legítimas do português
 * que por acaso ficam a uma letra de um termo do domínio. Trocar uma pela outra
 * muda o que a frase diz — e um sistema que reescreve silenciosamente o que o
 * operador escreveu é pior que um que não entende, porque ele entende ERRADO
 * com confiança.
 *
 * ===========================================================================
 * A REGRA: DISTÂNCIA É O ÚLTIMO SINAL, NUNCA O PRIMEIRO
 * ===========================================================================
 *
 * Quatro sinais, três de veto e um positivo (ver `normalizarTermo`):
 *
 *   VETO      palavra funcional — tem papel gramatical próprio
 *   VETO      token já conhecido pelo índice — não há o que consertar
 *   VETO      candidato ambíguo — duas correções possíveis não são correção
 *   POSITIVO  o candidato tem de ser substantivo DECLARADO (`entidades`,
 *             `conceitos`) — a evidência de maior prioridade que existe aqui
 *
 * É o quarto que separa « lembrets » de « preciso ». `lembrete` foi declarado
 * por `listar_lembretes`; `precisa` não foi declarado por ninguém.
 *
 * NA DÚVIDA, NÃO CORRIGE: `provável` não vira `confirmado`, e o token original
 * sobrevive.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import type { ManifestoHabilidade } from '../../servidor/nucleo/kernel/Habilidade';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const descoberta = new DescobertaCapacidades(CATALOGO.map((h) => h.manifesto));
const norm = (f: string) => descoberta.normalizarConsulta(f);

// ---------------------------------------------------------------------------
// POSITIVO — typo em substantivo declarado é corrigido
// ---------------------------------------------------------------------------

test('positivo: typo em substantivo DECLARADO é corrigido', () => {
  /** `lembrete` é `entidades` de `listar_lembretes`; `motorista` é da LUFT. */
  assert.match(norm('me lista os lembrets'), /lembrete/);
  assert.match(norm('qual motorosta tem mais cargas?'), /motorista/);
});

test('positivo: a correção alcança a habilidade que o typo escondia', () => {
  /**
   * Corrigir o texto não basta — o que interessa é a frase voltar a encontrar
   * capacidade. « me lista os lembrets » tem "lista", que É token do catálogo:
   * a frase não estava muda, só não achava nada. Por isso o recurso acontece no
   * nível do RESULTADO, não no do token.
   */
  assert.equal(
    descoberta.descobrirCandidatos('me lista os lembrets')[0]?.habilidade,
    'listar_lembretes',
  );
});

// ---------------------------------------------------------------------------
// NEGATIVO — português legítimo sai intacto
// ---------------------------------------------------------------------------

/**
 * OS TRÊS CASOS MEDIDOS, um por mecanismo de veto:
 *
 *   mais → mail      barrado por ser palavra funcional
 *   saber → sabe     barrado porque `sabe` não é substantivo declarado
 *   preciso → precisa idem
 */
const NAO_PODEM_MUDAR: readonly (readonly [string, string])[] = [
  ['mais', 'mail'],
  ['preciso', 'precisa'],
  ['saber', 'sabe'],
];

for (const [legitima, invasora] of NAO_PODEM_MUDAR) {
  test(`negativo: « ${legitima} » não pode virar « ${invasora} »`, () => {
    const saida = norm(legitima);
    assert.equal(
      saida,
      legitima,
      `"${legitima}" é português correto e virou "${saida}" — o normalizador reescreveu o significado`,
    );
    /**
     * A comparação é por TOKEN, não por substring — e a diferença derrubou a
     * primeira versão deste teste: `'saber'.includes('sabe')` é verdadeiro, e o
     * teste acusava dano onde não havia nenhum. Um detector que confunde
     * prefixo com substituição não mede o que promete.
     */
    assert.ok(
      !saida.split(/[^a-z0-9]+/).includes(invasora),
      `"${invasora}" apareceu como token em « ${saida} »`,
    );
  });
}

test('robustez: a frase inteira com palavra legítima sobrevive', () => {
  /**
   * Testar a palavra isolada não basta: o dano real acontece no meio de uma
   * frase, onde ninguém olha. Estas três passaram a valer como regressão porque
   * as três foram observadas quebradas.
   */
  for (const f of [
    'preciso saber disso',
    'qual motorosta tem mais cargas?',
    'preciso de mais informação sobre isso',
  ]) {
    const saida = norm(f);
    for (const [legitima] of NAO_PODEM_MUDAR) {
      if (!f.includes(legitima)) continue;
      assert.ok(
        saida.includes(legitima),
        `« ${f} » perdeu "${legitima}" na normalização: « ${saida} »`,
      );
    }
  }
});

test('negativo: frase sem conteúdo de domínio não ganha capacidade por correção', () => {
  /**
   * O teste que fecha o círculo. Corrigir « preciso saber disso » fazia a frase
   * "encontrar" habilidades que ela nunca mencionou — conversa virava
   * planejamento por causa de duas letras.
   */
  assert.equal(descoberta.descobrirCandidatos('preciso saber disso').length, 0);
});

// ---------------------------------------------------------------------------
// AMBIGUIDADE E LIMITE DECLARADO
// ---------------------------------------------------------------------------

test('na dúvida não corrige: candidato ambíguo deixa o token como está', () => {
  /**
   * Duas correções possíveis não são correção nenhuma — corrigir errado é pior
   * que não reconhecer.
   *
   * O CENÁRIO É CONTROLADO de propósito. A primeira versão usou « xarga » e
   * falhou com razão: `carga` é o ÚNICO alvo declarado a uma letra dali, então
   * corrigir é o comportamento certo. Ambiguidade real precisa de dois alvos, e
   * o catálogo de produção não tem um par assim — construir o par é a única
   * forma honesta de exercitar a trava.
   */
  const gemeas: readonly ManifestoHabilidade[] = [
    {
      id: 'listar_paletes',
      nome: 'Paletes',
      descricao: 'Lista paletes.',
      exemplos: ['Quais paletes?'],
      conceitos: [{ nome: 'palete', termos: [] }],
      esquema: {},
      risco: 'baixo',
    } as unknown as ManifestoHabilidade,
    {
      id: 'listar_palotes',
      nome: 'Palotes',
      descricao: 'Lista palotes.',
      exemplos: ['Quais palotes?'],
      conceitos: [{ nome: 'palote', termos: [] }],
      esquema: {},
      risco: 'baixo',
    } as unknown as ManifestoHabilidade,
  ];
  const ambigua = new DescobertaCapacidades(gemeas);

  /** `palute` está a uma letra de `palete` E de `palote`. */
  assert.equal(ambigua.normalizarConsulta('palute'), 'palute');
  /** E o controle: alvo único continua sendo corrigido. */
  assert.equal(new DescobertaCapacidades([gemeas[0]]).normalizarConsulta('palute'), 'palete');
});

test('LIMITE DECLARADO: substantivo não declarado não ganha tolerância', () => {
  /**
   * A REGRA, exercitada em cenário controlado. Uma habilidade cujo substantivo
   * vive só na PROSA da descrição não ganha tolerância a erro de digitação: só
   * `entidades` e `conceitos` são declaração, e só declaração é confiável o
   * bastante para autorizar uma troca de palavra.
   *
   * A primeira versão deste teste usava « vai chove hoje » e o clima real. Ela
   * ficou vermelha no instante em que `consultar_clima` declarou os próprios
   * conceitos — exatamente como a docstring dela previa. Um teste que depende de
   * quais habilidades por acaso declararam mede o catálogo de hoje, não a regra;
   * o cenário sintético mede a regra.
   *
   * É também o incentivo, dito em código: declare os seus substantivos e ganhe
   * tolerância de graça, sem ninguém editar uma linha de lógica.
   */
  const soProsa = new DescobertaCapacidades([
    {
      id: 'consultar_borracharia',
      nome: 'Borracharia',
      descricao: 'Estado dos pneus e do rodizio da frota.',
      exemplos: ['Como estão os pneus?'],
      esquema: {},
      risco: 'baixo',
    } as unknown as ManifestoHabilidade,
  ]);
  /** "pneu" está na descrição e em nenhum campo declarado. */
  assert.equal(soProsa.normalizarConsulta('pneue'), 'pneue');

  /** O controle: a MESMA palavra, agora declarada, passa a ser corrigível. */
  const declarado = new DescobertaCapacidades([
    {
      id: 'consultar_borracharia',
      nome: 'Borracharia',
      descricao: 'Estado dos pneus e do rodizio da frota.',
      exemplos: ['Como estão os pneus?'],
      entidades: ['pneu'],
      esquema: {},
      risco: 'baixo',
    } as unknown as ManifestoHabilidade,
  ]);
  assert.equal(declarado.normalizarConsulta('pneue'), 'pneu');
});
