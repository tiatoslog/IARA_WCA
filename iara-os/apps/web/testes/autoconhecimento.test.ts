/**
 * AUTOCONHECIMENTO — a IARA sabe dizer o que ela sabe fazer.
 *
 * O prompt trazia uma frase fixa: "você tem uma camada determinística local que
 * resolve clima, consultas ao banco de infraestrutura, hora e busca web". Eram
 * QUATRO capacidades num catálogo de VINTE E OITO, e a frase datava de quando o
 * catálogo tinha quatro. Perguntada "o que você sabe fazer?", a IARA respondia
 * a partir dela — ou completava o resto por conta própria, prometendo o que não
 * existe e escondendo o que existe.
 *
 * O QUE ESTES TESTES TRAVAM não é a redação: é a IMPOSSIBILIDADE de a lista
 * envelhecer. Habilidade nova entra no catálogo e aparece no prompt no mesmo
 * commit, sem ninguém lembrar de nada — e se alguém trocar a geração por uma
 * lista escrita à mão, a primeira asserção cai.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { CATALOGO } from '../servidor/nucleo/kernel/habilidades/index';
import { GerenciadorHabilidades } from '../servidor/nucleo/kernel/GerenciadorHabilidades';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { PERSONA } from '../servidor/nucleo/ClienteClaude';

function catalogoRedigido(): string {
  const g = new GerenciadorHabilidades(new BarramentoEventos('autoconhecimento'));
  g.registrarTodas(CATALOGO);
  return g.descricaoParaPrompt();
}

test('A1. TODA habilidade do catálogo aparece no que a IARA sabe de si', () => {
  const texto = catalogoRedigido();
  const faltando = CATALOGO.map((h) => h.manifesto.id).filter((id) => !texto.includes(id));

  assert.deepEqual(
    faltando,
    [],
    `a IARA não sabe que tem estas capacidades: ${faltando.join(', ')}`,
  );

  // A recíproca: a contagem de linhas de habilidade bate com o catálogo. Sem
  // isto, um gerador que repetisse a mesma habilidade 28 vezes passaria acima.
  assert.equal(
    (texto.match(/^ {2}•/gm) ?? []).length,
    CATALOGO.length,
    'a lista redigida não tem uma linha por habilidade',
  );
});

test('A2. o que está DESLIGADO é declarado, com o motivo — nunca omitido', () => {
  const texto = catalogoRedigido();
  const desligadas = CATALOGO.filter((h) => h.indisponivelPorque?.() != null);

  /**
   * Este teste só significa alguma coisa se houver alguma desligada no ambiente
   * em que ele roda. Com todas as credenciais presentes, ele não tem o que
   * provar — e dizer isso é melhor que passar em silêncio.
   */
  if (desligadas.length === 0) {
    assert.doesNotMatch(texto, /DESLIGADA/, 'marcou como desligada uma capacidade disponível');
    return;
  }

  for (const h of desligadas) {
    const linha = texto.split('\n').find((l) => l.includes(`(${h.manifesto.id})`));
    assert.ok(linha, `${h.manifesto.id} sumiu da lista por estar desligada`);
    assert.match(
      linha!,
      /DESLIGADA:/,
      `${h.manifesto.id} está sem credencial e aparece como se funcionasse`,
    );
    assert.ok(
      linha!.includes(h.indisponivelPorque!()!),
      `${h.manifesto.id} não diz o que falta ligar`,
    );
  }
});

test('A3. risco alto vem marcado como algo que exige confirmação', () => {
  const texto = catalogoRedigido();

  for (const h of CATALOGO.filter((x) => x.manifesto.risco === 'alto')) {
    // Desligada já carrega o próprio selo; o que não pode é uma habilidade de
    // risco alto DISPONÍVEL parecer trivial na descrição.
    if (h.indisponivelPorque?.()) continue;
    const linha = texto.split('\n').find((l) => l.includes(`(${h.manifesto.id})`));
    assert.ok(linha, `${h.manifesto.id} ausente da lista`);
    assert.match(
      linha!,
      /confirmação explícita/,
      `${h.manifesto.id} é irreversível e a IARA não sabe que precisa confirmar`,
    );
  }
});

test('A4. a persona não carrega mais uma lista de capacidades escrita à mão', () => {
  /**
   * A frase antiga, literal. Ela não pode voltar: uma lista no prompt é uma
   * segunda fonte de verdade sobre o catálogo, e a segunda fonte é sempre a que
   * fica desatualizada.
   */
  assert.doesNotMatch(
    PERSONA,
    /resolve clima, consultas ao banco de infraestrutura, hora e busca web/,
    'a lista fixa de quatro capacidades voltou para o prompt',
  );

  // E a persona precisa dizer de onde vem a verdade sobre isso.
  assert.match(PERSONA, /O QUE VOCÊ SABE FAZER/);
  assert.match(PERSONA, /não ofereça o que não está lá/i);
});

test('A5. a camada que fala com a nuvem não importa o catálogo — ela o RECEBE', () => {
  /**
   * A razão de `capacidades` ser parâmetro e não import. `habilidades/` alcança
   * o `AgenteLocal`; um import aqui faria a camada de conversa alcançar o mundo
   * por transitividade, e `fronteira-interna.test.ts` derrubaria a suíte com um
   * caminho que ninguém entenderia vindo deste arquivo. Esta asserção é local e
   * explica o porquê no lugar onde a tentação aparece.
   */
  const fonte = readFileSync(
    path.join(process.cwd(), 'servidor/nucleo/ClienteClaude.ts'),
    'utf8',
  );
  assert.doesNotMatch(
    fonte,
    /from\s+['"].*habilidades/,
    'ClienteClaude passou a importar o catálogo',
  );
  assert.match(fonte, /capacidades\?: string/, 'o catálogo deixou de chegar por injeção');
});
