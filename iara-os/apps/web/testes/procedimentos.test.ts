/**
 * Ingestão de POP — contrato e achados de qualidade de dado.
 *
 * SOBRE FIXTURE CONGELADA, NUNCA SOBRE `arquivos/procedimentos/`. O checklist de
 * `docs/prd/padrao-habilidade-analitica.md` (item 3) proíbe travar teste em fonte
 * viva: no dia em que a operação revisar um POP, o número muda — e isso é o
 * comportamento certo, não regressão. Aqui o universo está fechado porque os
 * `.pptx` de `testes/fixtures/` são cópias capturadas uma vez.
 *
 * As três fixtures não são aleatórias:
 *   001 — a mais rica: 3 etapas, exceções reais, setas com geometria conferida
 *   006 — o único que traz DUAS revisões no mesmo arquivo
 *   010 — o que tem erro de digitação no cabeçalho, e exceção no meio do slide
 *
 * Cada teste abaixo corresponde a um defeito que ESTEVE presente e foi corrigido,
 * ou a um defeito do documento que precisa continuar aparecendo. É o item 8 do
 * checklist: achado de qualidade vira teste, nunca só comentário.
 */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

import { ingerir } from '../scripts/geracao/ingerir-pops';
import { citar, ilustrarParada, podeOrientar, posicoes } from '../lib/procedimento';

const FIXTURES = path.resolve('testes/fixtures');
const TEMPORARIO = mkdtempSync(path.join(tmpdir(), 'iara-pops-'));
const INSTANTE = '2026-08-19T12:00:00.000Z';

after(() => rmSync(TEMPORARIO, { recursive: true, force: true }));

const ler = (nome: string) =>
  ingerir(path.join(FIXTURES, nome), INSTANTE, TEMPORARIO);

const POP_001 = 'pop-001-agendamento.pptx';
const POP_006 = 'pop-006-transmitir-cte.pptx';
const POP_010 = 'pop-010-manifesto-manual.pptx';

// ---------------------------------------------------------------------------
// Determinismo
// ---------------------------------------------------------------------------

test('a mesma fixture produz exatamente o mesmo resultado', () => {
  const a = ler(POP_001);
  const b = ler(POP_001);
  assert.equal(a.hash_origem, b.hash_origem);
  assert.deepEqual(a, b);
});

test('o hash identifica a VERSÃO, e POPs diferentes não colidem', () => {
  assert.notEqual(ler(POP_001).hash_origem, ler(POP_006).hash_origem);
  assert.equal(ler(POP_001).hash_origem.length, 16);
});

// ---------------------------------------------------------------------------
// Geometria das setas — o método inteiro depende disto
// ---------------------------------------------------------------------------

test('a seta ancora DENTRO da captura, em coordenada normalizada', () => {
  const p = ler(POP_001);
  const ancoradas = p.etapas
    .flatMap((e) => e.slides)
    .flatMap((s) => s.passos)
    .filter((q) => q.ancora !== null);

  assert.ok(ancoradas.length >= 10, `esperava dezenas de âncoras, achei ${ancoradas.length}`);
  for (const q of ancoradas) {
    assert.ok(q.ancora!.x >= 0 && q.ancora!.x <= 1, `x fora de 0..1: ${q.ancora!.x}`);
    assert.ok(q.ancora!.y >= 0 && q.ancora!.y <= 1, `y fora de 0..1: ${q.ancora!.y}`);
    assert.ok(q.ancora!.captura.startsWith('/procedimentos/'), 'âncora sem URL servível');
  }
});

test('seta cuja ponta não cai em captura nenhuma fica SEM âncora', () => {
  const p = ler(POP_001);
  const passos = p.etapas.flatMap((e) => e.slides).flatMap((s) => s.passos);
  const semAncora = passos.filter((q) => q.ancora === null);

  // O POP 001 tem setas que apontam para fora de qualquer print (texto solto).
  // Elas PRECISAM continuar sem âncora: escolher "a captura mais próxima"
  // produziria uma marcação que parece precisa e aponta para o lugar errado.
  assert.ok(semAncora.length > 0, 'nenhum passo sem âncora — o fallback voltou?');
  for (const q of semAncora) assert.equal(q.ancora, null);
});

test('a âncora aponta para uma captura que existe no mesmo slide', () => {
  const p = ler(POP_001);
  for (const s of p.etapas.flatMap((e) => e.slides)) {
    const urls = new Set(s.capturas.map((c) => c.url));
    for (const q of s.passos) {
      if (q.ancora) assert.ok(urls.has(q.ancora.captura), 'âncora aponta para outro slide');
    }
  }
});

// ---------------------------------------------------------------------------
// Ordem dos slides — o rodapé "Página: N/M" mente
// ---------------------------------------------------------------------------

test('os índices de slide são únicos e sequenciais', () => {
  for (const nome of [POP_001, POP_006, POP_010]) {
    const indices = ler(nome)
      .etapas.flatMap((e) => e.slides)
      .map((s) => s.indice)
      .sort((a, b) => a - b);
    assert.deepEqual(
      indices,
      [...new Set(indices)],
      `${nome}: índice repetido — o rodapé em cache voltou a ser usado como ordem`,
    );
  }
});

test('a imagem repetida entre slides vira DUAS capturas, não uma', () => {
  const p = ler(POP_001);
  const slides = p.etapas.flatMap((e) => e.slides);
  const porUrl = new Map<string, number>();
  for (const s of slides) for (const c of s.capturas) {
    porUrl.set(c.url, (porUrl.get(c.url) ?? 0) + 1);
  }
  // O endereçamento por conteúdo faz a mesma imagem ter uma URL só; a distinção
  // entre "no slide 3" e "no slide 8" vive na entrada de `Captura`, não na URL.
  assert.ok(
    [...porUrl.values()].some((n) => n > 1),
    'nenhuma imagem reaproveitada — a chave voltou a ser o nome do arquivo?',
  );
});

// ---------------------------------------------------------------------------
// Procedência: o que o documento NÃO diz
// ---------------------------------------------------------------------------

test('aprovador ausente é `null` — nunca o texto da caixa ao lado', () => {
  for (const nome of [POP_001, POP_006, POP_010]) {
    const p = ler(nome);
    assert.equal(
      p.aprovado_por,
      null,
      `${nome}: aprovador fabricado ("${p.aprovado_por}") — o \\s* atravessou a quebra de linha`,
    );
    assert.equal(p.vigente_desde, null);
  }
});

test('a citação diz que o aprovador não foi informado, em vez de omitir', () => {
  const p = ler(POP_001);
  const etapa = p.etapas[0];
  const linha = citar(p, etapa, etapa.slides[0]);
  assert.match(linha, /IT-ADMLUFT-001/);
  assert.match(linha, /aprovador não informado no documento/);
});

test('aprovador e vigência ausentes saem como lacuna declarada', () => {
  const lacunas = ler(POP_001).lacunas.join(' | ');
  assert.match(lacunas, /não informa quem aprovou/);
  assert.match(lacunas, /não informa data de vigência/);
  assert.match(lacunas, /não cataloga mensagens de erro/);
});

// ---------------------------------------------------------------------------
// Defeitos do documento — precisam continuar visíveis
// ---------------------------------------------------------------------------

test('POP 006: as duas revisões do mesmo arquivo são preservadas', () => {
  const p = ler(POP_006);
  assert.match(p.revisao, /REV\.:01/);
  assert.match(p.revisao, /REV\.:02/);
  assert.match(p.lacunas.join(' | '), /mais de uma revisão/);
});

test('POP 010: o erro de digitação do cabeçalho é denunciado, não engolido', () => {
  const p = ler(POP_010);
  // O cabeçalho diz `IT-ADMLUF-010` (sem o T). O código vale pelo nome do
  // arquivo, e a divergência aparece — afrouxar o regex esconderia as duas.
  assert.equal(p.codigo, 'IT-ADMLUFT-010');
  assert.match(p.lacunas.join(' | '), /IT-ADMLUF-010/);
});

test('as exceções do POP 001 saem verbatim, fora dos passos', () => {
  const p = ler(POP_001);
  const texto = p.particularidades.join(' | ');
  assert.match(texto, /Adicer/);
  assert.match(texto, /Sorriso/);
  // Número solto não é exceção — "2" não avisa ninguém de nada.
  for (const linha of p.particularidades) assert.doesNotMatch(linha, /^\d{1,2}$/);
});

test('POP 010: exceção no MEIO do slide é capturada', () => {
  const p = ler(POP_010);
  assert.ok(p.particularidades.length > 0, 'a particularidade do 010 sumiu');
  assert.match(p.particularidades.join(' '), /autom[áa]tico/i);
});

// ---------------------------------------------------------------------------
// Hierarquia da verdade
// ---------------------------------------------------------------------------

test('o sistema é DECLARADO, e é filtro de primeira classe', () => {
  for (const nome of [POP_001, POP_006, POP_010]) {
    assert.equal(ler(nome).sistema, 'GW');
  }
});

test('só `oficial` orienta', () => {
  assert.equal(podeOrientar('oficial'), true);
  assert.equal(podeOrientar('em_revisao'), false);
  assert.equal(podeOrientar('sugestao'), false);
  assert.equal(podeOrientar('desativado'), false);
});

test('o texto do slide vai verbatim — nunca reescrito', () => {
  const p = ler(POP_001);
  const tudo = p.etapas.flatMap((e) => e.slides).map((s) => s.texto).join('\n');
  // Frase real do slide 2, com a grafia do documento.
  assert.match(tudo, /planilha/i);
  assert.ok(tudo.length > 500, `esperava o texto do POP, achei ${tudo.length} chars`);
});

// ---------------------------------------------------------------------------
// Ilustração — a geometria do POP virando o que a operadora vê marcado
// ---------------------------------------------------------------------------

test('a ilustração leva TODAS as capturas da parada, nunca uma eleita', () => {
  const p = ler(POP_001);
  let comVarias = 0;
  for (const pos of posicoes(p)) {
    const ilustracao = ilustrarParada(p, pos);
    if (pos.slide.capturas.length === 0) continue;
    assert.ok(ilustracao, `parada ${pos.indice} tem captura e não ilustrou`);
    assert.deepEqual(
      ilustracao!.telas.map((t) => t.url),
      pos.slide.capturas.map((c) => c.url),
      'a ordem e o conjunto das telas têm que ser os do slide',
    );
    if (pos.slide.capturas.length > 1) comVarias += 1;
  }
  assert.ok(comVarias > 0, 'a fixture perdeu os slides de captura múltipla — o teste ficou cego');
});

test('parada sem captura não ilustra nada — e não inventa uma', () => {
  const p = ler(POP_001);
  for (const pos of posicoes(p)) {
    if (pos.slide.capturas.length === 0) assert.equal(ilustrarParada(p, pos), null);
  }
});

test('cada ponto vai para a tela que a âncora nomeia, em 0..1', () => {
  const p = ler(POP_001);
  for (const pos of posicoes(p)) {
    const ilustracao = ilustrarParada(p, pos);
    if (!ilustracao) continue;
    for (const tela of ilustracao.telas) {
      const esperados = pos.slide.passos.filter((q) => q.ancora?.captura === tela.url);
      assert.equal(tela.pontos.length, esperados.length);
      for (const ponto of tela.pontos) {
        assert.ok(ponto.x >= 0 && ponto.x <= 1, `x fora de 0..1: ${ponto.x}`);
        assert.ok(ponto.y >= 0 && ponto.y <= 1, `y fora de 0..1: ${ponto.y}`);
      }
    }
  }
});

/**
 * O TESTE QUE PROTEGE A PROMESSA: nada se perde entre o POP e a tela.
 *
 * Ou o passo vira ponto desenhado, ou vira rótulo declarado em `nao_marcados`.
 * A terceira possibilidade — sumir — é a que faz três círculos num slide de
 * cinco passos parecerem cinco.
 */
test('todo passo do slide ou é desenhado ou é declarado como não marcado', () => {
  const p = ler(POP_001);
  let declarados = 0;
  for (const pos of posicoes(p)) {
    const ilustracao = ilustrarParada(p, pos);
    if (!ilustracao) continue;
    const desenhados = ilustracao.telas.reduce((n, t) => n + t.pontos.length, 0);
    assert.equal(
      desenhados + ilustracao.nao_marcados.length,
      pos.slide.passos.length,
      `parada ${pos.indice}: passo sumiu entre o POP e a tela`,
    );
    declarados += ilustracao.nao_marcados.length;
  }
  assert.ok(declarados > 0, 'o POP 001 tem setas sem âncora — nenhuma foi declarada');
});

/**
 * "A IARA NUNCA GERA MÍDIA NOVA" deixa de ser parágrafo e vira máquina.
 *
 * Toda URL que sai daqui é um arquivo que o ingestor extraiu do `.pptx` e serviu
 * de `/procedimentos/`. No dia em que alguém puser aqui uma imagem desenhada, a
 * operadora vai olhar para uma tela do GW que não existe — e não tem como saber.
 */
test('toda tela ilustrada é recorte de documento servido de /procedimentos/', () => {
  for (const nome of [POP_001, POP_006, POP_010]) {
    const p = ler(nome);
    for (const pos of posicoes(p)) {
      for (const tela of ilustrarParada(p, pos)?.telas ?? []) {
        assert.ok(tela.url.startsWith('/procedimentos/'), `URL de outra origem: ${tela.url}`);
      }
    }
  }
});

test('a fonte da ilustração é a MESMA citação que o texto usa', () => {
  const p = ler(POP_001);
  for (const pos of posicoes(p)) {
    const ilustracao = ilustrarParada(p, pos);
    if (ilustracao) assert.equal(ilustracao.fonte, citar(p, pos.etapa, pos.slide));
  }
});
