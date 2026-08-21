/**
 * Treinamento — a camada pedagógica, provada contra oráculo escrito à mão.
 *
 * O QUE ESTE ARQUIVO PROVA, e é uma coisa só dita de muitos jeitos: **ensinar
 * não é executar.** A instrutora explica, pergunta, diagnostica e avalia — e
 * nenhuma dessas coisas move a etapa de ninguém, conclui passo nenhum nem
 * fabrica evidência. A posição é conferida NO DISCO depois de cada modo, porque
 * conferir no texto da resposta seria conferir o relato contra o próprio relato.
 *
 * NENHUM TESTE AQUI AFIRMA FRASE EXATA de resposta. O que se afirma é
 * comportamento: o que foi gravado, o que não foi, e de onde veio cada
 * afirmação. Um teste preso à redação quebra quando alguém melhora o texto e
 * passa quando alguém quebra a regra.
 */

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

import { baseProcedimentos } from '../servidor/nucleo/BaseProcedimentos';
import { procedimentosEmCurso } from '../servidor/nucleo/ProcedimentosEmCurso';
import { progressosDeTreinamento } from '../servidor/nucleo/ProgressoDeTreinamento';
import { treinarProcedimento } from '../servidor/nucleo/kernel/habilidades/treinamento';
import { avancarProcedimento } from '../servidor/nucleo/kernel/habilidades/procedimentos';
import { classificarEvidencia } from '../servidor/nucleo/kernel/GuardiaoDoProcedimento';
import { podeGuiar, posicoes } from '../lib/procedimento';
import { redigirConferencia, situacaoDoOperador } from '../servidor/nucleo/ConferenciaDeTela';
import {
  DIFICULDADES_PARA_REFORCO,
  MAX_SOCRATICAS,
  chaveDaParada,
  escolhaDoOperador,
  esgotouSocratico,
  letraDaAlternativa,
  montarPergunta,
  nivelDe,
  precisamReforco,
  progressoInicial,
  transicionar,
  trechoDaParada,
  veredito,
  type EstadoPedagogico,
  type EventoPedagogico,
} from '../lib/treinamento';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-treinamento-teste';

async function limpar(): Promise<void> {
  await procedimentosEmCurso.encerrar(OPERADOR).catch(() => null);
  await progressosDeTreinamento.esquecer(OPERADOR).catch(() => null);
  for (const pasta of ['procedimentos-em-curso', 'progresso-treinamento']) {
    await rm(path.resolve(process.cwd(), 'dados', pasta, `${OPERADOR}.json`), { force: true });
  }
}

beforeEach(limpar);
after(limpar);

function ctx(parametros: Record<string, unknown>, enunciado = ''): ContextoHabilidade {
  return {
    sessao: 's-treino',
    id_usuario: OPERADOR,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

/** Um POP conduzível com mais de três paradas — precisa dar para montar questão. */
function popDeTrabalho() {
  const p = baseProcedimentos
    .catalogo()
    .find((x) => podeGuiar(x) && posicoes(x).length >= 4);
  assert.ok(p, 'base sem procedimento conduzível de 4+ paradas: rode `npm run pops`');
  return p!;
}

async function comecar(indice = 0) {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  const parada = todas[indice];
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: parada.etapa.numero,
    slide: parada.slide.indice,
    hash_origem: p.hash_origem,
  });
  return { p, todas, parada };
}

/** A posição como está NO DISCO. Nunca lida do texto da resposta. */
async function posicaoGravada() {
  const e = await procedimentosEmCurso.emCurso(OPERADOR);
  return e ? { etapa: e.etapa, slide: e.slide, evidencia: e.evidencia } : null;
}

// ---------------------------------------------------------------------------
// 1. A máquina de estados pedagógica — tabela contra oráculo
// ---------------------------------------------------------------------------

test('a transição pedagógica segue um oráculo escrito à mão, não o código', () => {
  const esperado: ReadonlyArray<[EstadoPedagogico, EventoPedagogico, EstadoPedagogico]> = [
    ['descobrindo', 'ensinou', 'aprendendo'],
    ['descobrindo', 'pediu_pratica', 'praticando'],
    ['descobrindo', 'pediu_avaliacao', 'avaliando'],
    ['descobrindo', 'errou', 'descobrindo'],
    ['aprendendo', 'pediu_pratica', 'praticando'],
    ['aprendendo', 'ensinou', 'aprendendo'],
    ['praticando', 'errou', 'aprendendo'],
    ['praticando', 'desistiu_da_pratica', 'aprendendo'],
    ['avaliando', 'concluiu_avaliacao', 'dominado'],
    ['avaliando', 'errou', 'aprendendo'],
    ['dominado', 'errou', 'aprendendo'],
    ['dominado', 'ensinou', 'dominado'],
  ];
  for (const [de, evento, para] of esperado) {
    assert.equal(transicionar(de, evento), para, `${de} --${evento}--> esperado ${para}`);
  }
});

test('nenhum evento leva a `dominado` sem passar por uma avaliação concluída', () => {
  const estados: EstadoPedagogico[] = ['descobrindo', 'aprendendo', 'praticando', 'avaliando'];
  const eventos: EventoPedagogico[] = [
    'ensinou',
    'pediu_pratica',
    'pediu_avaliacao',
    'errou',
    'desistiu_da_pratica',
  ];
  for (const e of estados) {
    for (const v of eventos) {
      assert.notEqual(
        transicionar(e, v),
        'dominado',
        `${e} virou dominado por "${v}" — domínio sem avaliação`,
      );
    }
  }
  assert.equal(transicionar('avaliando', 'concluiu_avaliacao'), 'dominado');
});

// ---------------------------------------------------------------------------
// 2. Nível e reforço — derivados, nunca guardados
// ---------------------------------------------------------------------------

test('o nível é DERIVADO da parada, e dificuldade repetida vence tudo', () => {
  const base = progressoInicial(
    { id_usuario: OPERADOR, codigo: 'X', hash_origem: 'h', revisao: 'REV.:01' },
    '2026-08-21T10:00:00.000Z',
  );
  assert.equal(nivelDe(null, '1/1'), 'iniciante', 'sem progresso nenhum não é avançado');
  assert.equal(nivelDe({ ...base, paradas_ensinadas: ['1/1'] }, '1/1'), 'intermediario');
  assert.equal(nivelDe({ ...base, paradas_praticadas: ['1/1'] }, '1/1'), 'avancado');

  const tropecou = {
    ...base,
    paradas_praticadas: ['1/1'],
    dificuldades: Array.from({ length: DIFICULDADES_PARA_REFORCO }, (_, i) => ({
      tipo: 'duvida_de_localizacao' as const,
      parada: '1/1',
      assinatura: `duvida ${i}`,
      instante: '2026-08-21T10:00:00.000Z',
    })),
  };
  assert.equal(
    nivelDe(tropecou, '1/1'),
    'iniciante',
    'quem travou duas vezes continuou sendo tratado como avançado',
  );
  assert.equal(nivelDe(tropecou, '2/1'), 'iniciante', 'a dificuldade vazou para outra parada');
});

test('reforço é calculado, e uma avaliação errada já basta', () => {
  const base = progressoInicial(
    { id_usuario: OPERADOR, codigo: 'X', hash_origem: 'h', revisao: 'REV.:01' },
    '2026-08-21T10:00:00.000Z',
  );
  assert.deepEqual(precisamReforco(base), []);
  assert.deepEqual(
    precisamReforco({
      ...base,
      avaliacoes: [
        { parada: '3/2', resultado: 'incorreta', instante: '2026-08-21T10:00:00.000Z' },
      ],
    }),
    ['3/2'],
  );
  assert.deepEqual(
    precisamReforco({
      ...base,
      dificuldades: [
        {
          tipo: 'erro_de_sistema',
          parada: '2/1',
          assinatura: 'deu erro',
          instante: '2026-08-21T10:00:00.000Z',
        },
      ],
    }),
    [],
    'uma dificuldade só virou padrão',
  );
});

test('o teto socrático é por parada, e trocar de parada zera', () => {
  const base = progressoInicial(
    { id_usuario: OPERADOR, codigo: 'X', hash_origem: 'h', revisao: 'REV.:01' },
    '2026-08-21T10:00:00.000Z',
  );
  const cheio = { ...base, parada_socratica: '1/1', socraticas_na_parada: MAX_SOCRATICAS };
  assert.equal(esgotouSocratico(cheio, '1/1'), true);
  assert.equal(esgotouSocratico(cheio, '1/2'), false, 'o teto vazou para a parada seguinte');
});

// ---------------------------------------------------------------------------
// 3. A questão sai do POP — nenhuma alternativa é escrita pela IARA
// ---------------------------------------------------------------------------

test('toda alternativa de uma questão é trecho VERBATIM de uma parada real', () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  const trechosReais = new Set(todas.map((x) => trechoDaParada(x.slide, x.etapa)));

  for (let semente = 0; semente < 12; semente += 1) {
    const q = montarPergunta(p, todas, todas[0], semente);
    assert.ok(q, 'não montou questão num POP de 4+ paradas');
    for (const alt of q!.alternativas) {
      assert.ok(trechosReais.has(alt), `alternativa não é trecho de parada nenhuma: "${alt}"`);
    }
    assert.equal(new Set(q!.alternativas).size, q!.alternativas.length, 'alternativa repetida');
  }
});

test('a alternativa correta é a PRÓXIMA parada, e a letra não muda entre turnos', () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  const atual = todas[0];
  const proxima = todas[1];

  const q = montarPergunta(p, todas, atual, 5)!;
  assert.equal(q.paradas[q.correta], chaveDaParada(proxima.etapa.numero, proxima.slide.indice));

  /* A MESMA SEMENTE PRODUZ A MESMA ORDEM. Sem isto, a alternativa correta
     mudaria de letra entre perguntar e corrigir, e a pessoa seria reprovada por
     ter acertado. */
  const outra = montarPergunta(p, todas, atual, 5)!;
  assert.deepEqual(outra.alternativas, q.alternativas);
  assert.equal(outra.correta, q.correta);
});

test('a questão é impossível quando o POP não sustenta alternativas distintas', () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  assert.equal(
    montarPergunta(p, todas.slice(0, 2), todas[0], 1),
    null,
    'montou questão com menos distratores do que alternativas',
  );
  assert.equal(
    montarPergunta(p, todas, todas[todas.length - 1], 1),
    null,
    'montou questão sobre a próxima ação na ÚLTIMA parada',
  );
});

test('"não consegui ler sua resposta" NUNCA é o mesmo que "você errou"', () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  const q = montarPergunta(p, todas, todas[0], 3)!;

  assert.equal(escolhaDoOperador(q, 'sei lá, acho que é por ali'), null);
  assert.equal(veredito(q, null), 'nao_coberta');

  const certa = letraDaAlternativa(q.correta);
  assert.equal(escolhaDoOperador(q, certa), q.correta);
  assert.equal(escolhaDoOperador(q, `letra ${certa}`), q.correta);
  assert.equal(escolhaDoOperador(q, `${certa})`), q.correta);
  assert.equal(veredito(q, q.correta), 'correta');
});

test('errar dentro da mesma etapa é `parcial`; de outra etapa é `incorreta`', () => {
  const p = popDeTrabalho();
  const todas = posicoes(p);
  for (let semente = 0; semente < 20; semente += 1) {
    const q = montarPergunta(p, todas, todas[0], semente);
    if (!q) continue;
    for (let i = 0; i < q.alternativas.length; i += 1) {
      if (i === q.correta) continue;
      const mesmaEtapa: boolean =
        q.paradas[i].split('/')[0] === q.paradas[q.correta].split('/')[0];
      assert.equal(
        veredito(q, i),
        mesmaEtapa ? 'parcial' : 'incorreta',
        `veredito errado para alternativa ${i} (${q.paradas[i]})`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 4. Hesitação — "acho que fiz" não é "fiz"
// ---------------------------------------------------------------------------

test('hesitação NÃO é declaração de conclusão — nem com dado informado junto', () => {
  for (const frase of [
    'acho que fiz',
    'não sei se fiz certo',
    'acho que deu certo',
    'será que está certo',
    'me confirma se eu fiz certo',
  ]) {
    assert.equal(classificarEvidencia(frase), 'nenhuma', `"${frase}" virou evidência`);
  }
  assert.equal(
    classificarEvidencia('acho que fiz, coloquei 12345', { dadoInformado: '12345' }),
    'nenhuma',
    'o dado informado promoveu uma frase em que a pessoa não afirma nada',
  );
  // E a declaração de verdade continua contando.
  assert.equal(classificarEvidencia('pronto, fiz'), 'declarada');
  assert.equal(classificarEvidencia('próximo'), 'declarada');
});

test('a hesitação NÃO avança a etapa — e o disco prova', async () => {
  await comecar();
  const antes = await posicaoGravada();
  const r = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'acho que fiz'));
  assert.equal(r.resolveu, false);
  assert.deepEqual(await posicaoGravada(), antes, 'a posição andou com uma hesitação');
});

// ---------------------------------------------------------------------------
// 5. A instrutora não move nada — o invariante da camada
// ---------------------------------------------------------------------------

test('NENHUM modo da instrutora move a posição gravada', async () => {
  for (const modo of ['ensino', 'duvida', 'diagnostico', 'pratica', 'avaliacao', 'retomada']) {
    await limpar();
    await comecar(1);
    const antes = await posicaoGravada();
    await treinarProcedimento.executar(ctx({ modo }, 'me ajuda aqui'));
    assert.deepEqual(await posicaoGravada(), antes, `o modo "${modo}" mexeu na posição`);
  }
});

test('a instrutora não CRIA procedimento em curso quando não há nenhum', async () => {
  const r = await treinarProcedimento.executar(
    ctx({ modo: 'ensino' }, 'me ensina a emitir CT-e no GW'),
  );
  assert.ok(r.texto.length > 0);
  assert.equal(
    await procedimentosEmCurso.emCurso(OPERADOR),
    null,
    'a camada pedagógica criou posição pela porta dos fundos',
  );
});

// ---------------------------------------------------------------------------
// 6. Progresso — chaveado por revisão, e nunca duplica o ponteiro
// ---------------------------------------------------------------------------

test('progresso de outra revisão do MESMO POP não é tratado como equivalente', async () => {
  const p = popDeTrabalho();
  const alvoAntigo = { codigo: p.codigo, hash_origem: 'hash-antigo', revisao: 'REV.:01' };
  await progressosDeTreinamento.marcarEnsinada(OPERADOR, alvoAntigo, 1, 1);

  const vigente = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.equal(vigente, null, 'o progresso da revisão antiga apareceu como sendo da vigente');

  const outras = await progressosDeTreinamento.deOutrasRevisoes(
    OPERADOR,
    p.codigo,
    p.hash_origem,
  );
  assert.equal(outras.length, 1, 'a revisão anterior sumiu em vez de ficar visível');
  assert.equal(outras[0].revisao, 'REV.:01');
});

test('o progresso NÃO guarda etapa, slide, evidência nem conferência', async () => {
  const { p } = await comecar();
  const alvo = { codigo: p.codigo, hash_origem: p.hash_origem, revisao: p.revisao };
  const progresso = await progressosDeTreinamento.marcarEnsinada(OPERADOR, alvo, 1, 1);

  for (const proibido of ['etapa', 'slide', 'evidencia', 'conferencia', 'estado_da_execucao']) {
    assert.ok(
      !(proibido in progresso),
      `o progresso pedagógico duplicou "${proibido}", que é do ponteiro`,
    );
  }
});

test('ensinar zera o socrático da parada — o teto não vale para sempre', async () => {
  const { p } = await comecar();
  const alvo = { codigo: p.codigo, hash_origem: p.hash_origem, revisao: p.revisao };
  for (let i = 0; i < MAX_SOCRATICAS; i += 1) {
    await progressosDeTreinamento.contarSocratica(OPERADOR, alvo, 1, 1);
  }
  assert.equal(
    esgotouSocratico(await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem), '1/1'),
    true,
  );
  await progressosDeTreinamento.marcarEnsinada(OPERADOR, alvo, 1, 1);
  assert.equal(
    esgotouSocratico(await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem), '1/1'),
    false,
    'depois de ensinar, a IARA continuou proibida de perguntar',
  );
});

// ---------------------------------------------------------------------------
// 7. Avaliação — exercício, nunca habilitação
// ---------------------------------------------------------------------------

test('a avaliação guarda a questão, corrige no turno seguinte e não habilita ninguém', async () => {
  const { p } = await comecar();
  const alvo = { codigo: p.codigo, hash_origem: p.hash_origem, revisao: p.revisao };

  const pergunta = await treinarProcedimento.executar(ctx({ modo: 'avaliacao' }, 'me testa'));
  assert.equal(pergunta.resolveu, true);

  const guardado = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.ok(guardado?.pergunta_pendente, 'a questão não sobreviveu ao turno');
  assert.equal(guardado!.estado, 'avaliando');

  const certa = letraDaAlternativa(guardado!.pergunta_pendente!.correta);
  const correcao = await treinarProcedimento.executar(
    ctx({ modo: 'avaliacao', resposta: certa }, certa),
  );

  const depois = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.equal(depois?.pergunta_pendente, null, 'a questão ficou pendente depois de corrigida');
  assert.equal(depois?.avaliacoes.at(-1)?.resultado, 'correta');
  assert.match(
    correcao.texto,
    /não autoriza|não habilita|supervis/i,
    'a resposta de acerto não separa exercício de habilitação',
  );
  // Acertar muda o estado PEDAGÓGICO e nada mais.
  assert.equal(depois?.estado, 'dominado');
  assert.equal((await posicaoGravada())?.etapa, 1, 'acertar o exercício andou o procedimento');
  void alvo;
});

test('resposta ilegível deixa a questão pendente e NÃO vira erro registrado', async () => {
  const { p } = await comecar();
  await treinarProcedimento.executar(ctx({ modo: 'avaliacao' }, 'me testa'));
  await treinarProcedimento.executar(
    ctx({ modo: 'avaliacao', resposta: 'sei lá' }, 'sei lá'),
  );
  const depois = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.ok(depois?.pergunta_pendente, 'a questão sumiu sem ter sido respondida');
  assert.equal(depois!.avaliacoes.length, 0, 'registrou como avaliação algo que não foi lido');
});

// ---------------------------------------------------------------------------
// 8. Prática — perguntar antes de responder, com teto
// ---------------------------------------------------------------------------

test('a prática pergunta primeiro, e depois do teto passa a ensinar', async () => {
  const { p } = await comecar();

  const primeira = await treinarProcedimento.executar(
    ctx({ modo: 'pratica' }, 'me deixa tentar'),
  );
  assert.match(primeira.texto, /\?/, 'a prática não fez pergunta nenhuma');

  await treinarProcedimento.executar(ctx({ modo: 'pratica' }, 'me deixa tentar'));
  const terceira = await treinarProcedimento.executar(
    ctx({ modo: 'pratica' }, 'me deixa tentar'),
  );

  /* Depois do teto a IARA ENSINA: a marca é o texto verbatim do POP com a
     citação de fonte, que a pergunta socrática nunca traz. */
  assert.match(terceira.texto, new RegExp(p.codigo), 'esgotado o socrático, não ensinou');
  const progresso = await progressosDeTreinamento.ler(OPERADOR, p.codigo, p.hash_origem);
  assert.equal(progresso?.estado, 'aprendendo');
});

// ---------------------------------------------------------------------------
// 9. Retomada — diz o que sabe e nada além
// ---------------------------------------------------------------------------

test('a retomada informa POP, revisão, posição e dificuldade — e não avança', async () => {
  const { p, todas } = await comecar(2);
  const alvo = { codigo: p.codigo, hash_origem: p.hash_origem, revisao: p.revisao };
  await progressosDeTreinamento.registrarDificuldade(OPERADOR, alvo, {
    tipo: 'elemento_nao_encontrado',
    parada: chaveDaParada(todas[2].etapa.numero, todas[2].slide.indice),
    assinatura: 'nao aparece o botao',
  });

  const antes = await posicaoGravada();
  const r = await treinarProcedimento.executar(
    ctx({ modo: 'retomada' }, 'continua meu treinamento de onde paramos'),
  );

  assert.match(r.texto, new RegExp(p.codigo));
  assert.match(r.texto, new RegExp(p.revisao.replace(/[.:]/g, '\\$&')));
  assert.match(r.texto, /nao aparece o botao/);
  assert.deepEqual(await posicaoGravada(), antes, 'retomar andou o procedimento');
});

test('sem progresso e sem procedimento, a retomada admite que não sabe', async () => {
  const r = await treinarProcedimento.executar(ctx({ modo: 'retomada' }, 'onde eu parei?'));
  assert.match(r.texto, /não tenho treinamento seu registrado/i);
  assert.equal(await procedimentosEmCurso.emCurso(OPERADOR), null);
});

// ---------------------------------------------------------------------------
// 10. A costura dos dois turnos — print + "pronto, fiz"
// ---------------------------------------------------------------------------

/**
 * O CASO DO DOCUMENTO NORMATIVO, §10: o turno de visão é short-circuit e
 * RETORNA, então a declaração que veio junto do print só avança no turno
 * seguinte. Isso continua certo — o que se prova aqui é que o turno 1 RECONHECE
 * a declaração em vez de responder como se ninguém tivesse dito nada.
 */
test('o print acompanhado de "pronto, fiz" reconhece a declaração — e não avança', async () => {
  await comecar();
  const situacao = await situacaoDoOperador(OPERADOR);
  assert.equal(situacao.tipo, 'parada');
  if (situacao.tipo !== 'parada') throw new Error('inalcançável');

  const antes = await posicaoGravada();
  const leitura = { texto: 'tela do GW', situacao: 'na_etapa' as const };

  const comDeclaracao = redigirConferencia(situacao, leitura, 'pronto, fiz');
  assert.match(comDeclaracao, /li que você concluiu/i, 'ignorou a declaração que veio junto');
  assert.match(comDeclaracao, /pr[óo]ximo/i, 'não disse o que falta para avançar');

  const comHesitacao = redigirConferencia(situacao, leitura, 'acho que fiz');
  assert.match(comHesitacao, /ACHA que fez/i, 'tratou hesitação como declaração');

  const semTexto = redigirConferencia(situacao, leitura, '');
  assert.match(semTexto, /Conferir não avança/i);

  assert.deepEqual(await posicaoGravada(), antes, 'redigir a conferência moveu a posição');
});
