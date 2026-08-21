/**
 * Conferência de tela — "estou aqui" medido contra o POP em curso.
 *
 * O QUE ESTE ARQUIVO PROVA, e é uma coisa só dita de sete jeitos: a leitura de
 * uma imagem NÃO vira autoridade. Ela diz onde a pessoa parece estar; o
 * procedimento continua dizendo o que fazer, verbatim e com fonte; e conferir
 * não move ninguém de etapa.
 *
 * NADA AQUI CHAMA PROVEDOR DE VISÃO. `interpretar` é exercitado sobre respostas
 * cruas escritas à mão — inclusive as malformadas, que são o caso interessante:
 * o que a IARA faz quando o modelo devolve lixo é o que decide se ela afirma
 * sobre a tela de alguém sem ter lido nada.
 */

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test, { after, beforeEach } from 'node:test';

import { baseProcedimentos } from '../servidor/nucleo/BaseProcedimentos';
import { procedimentosEmCurso } from '../servidor/nucleo/ProcedimentosEmCurso';
import { interpretar } from '../servidor/nucleo/AnaliseVisual';
import {
  avisoDeRevisao,
  ilustracaoDaSituacao,
  redigirConferencia,
  registrarConferencia,
  situacaoDoOperador,
} from '../servidor/nucleo/ConferenciaDeTela';
import { acharPosicao, descreverParada, podeGuiar, posicoes } from '../lib/procedimento';
import { avancarProcedimento } from '../servidor/nucleo/kernel/habilidades/procedimentos';
import * as guardiao from '../servidor/nucleo/kernel/GuardiaoDoProcedimento';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-conferencia-teste';

async function limpar(): Promise<void> {
  await procedimentosEmCurso.encerrar(OPERADOR).catch(() => null);
  await rm(path.resolve(process.cwd(), 'dados', 'procedimentos-em-curso', `${OPERADOR}.json`), {
    force: true,
  });
}

beforeEach(limpar);
after(limpar);

/**
 * O POP de trabalho destes testes: conduzível e com mais de uma parada.
 *
 * `podeGuiar` no filtro não é zelo — um POP contraditório é recusado pelo
 * guardião antes de a evidência sequer ser olhada, e o teste do ciclo completo
 * passaria a provar a recusa em vez do avanço.
 */
function algumProcedimento() {
  const p = baseProcedimentos.catalogo().find((x) => posicoes(x).length > 1 && podeGuiar(x));
  assert.ok(p, 'base vazia ou sem procedimento conduzível: rode `npm run pops`');
  return p!;
}

async function comecar() {
  const p = algumProcedimento();
  const primeira = posicoes(p)[0];
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'guiar',
    etapa: primeira.etapa.numero,
    slide: primeira.slide.indice,
    hash_origem: p.hash_origem,
  });
  return { p, primeira };
}

/** A situação, exigindo que seja uma parada — estreita o tipo sem `as`. */
async function naParada() {
  const situacao = await situacaoDoOperador(OPERADOR);
  assert.equal(situacao.tipo, 'parada');
  if (situacao.tipo !== 'parada') throw new Error('inalcançável');
  return situacao;
}

// ---------------------------------------------------------------------------
// O que vai ao modelo de visão
// ---------------------------------------------------------------------------

test('a parada descrita leva o texto do POP VERBATIM, nunca um resumo', () => {
  const p = algumProcedimento();
  for (const pos of posicoes(p)) {
    const d = descreverParada(p, pos);
    assert.equal(d.instrucao, pos.slide.texto, 'a instrução foi reescrita no caminho');
    assert.equal(d.posicao, `${pos.indice} de ${pos.total}`);
    assert.deepEqual(d.marcas, pos.slide.passos.map((q) => q.rotulo));
  }
});

// ---------------------------------------------------------------------------
// A situação nunca é adivinhada
// ---------------------------------------------------------------------------

const RESPOSTA_OK = (extra = '') =>
  `{"encontrou": true, "alvo_x": 0.5, "alvo_y": 0.4, "elemento": "botão Pesquisar", ` +
  `"explicacao": "está no topo"${extra}}`;

test('chamada NÃO situada nunca devolve situação — nem se o modelo mandar uma', () => {
  const r = interpretar(RESPOSTA_OK(', "situacao": "na_etapa"'), false);
  assert.equal(r.situacao, null, 'respondeu sobre uma parada que ninguém perguntou');
});

test('situação fora da lista vira `indefinido`, nunca a mais parecida', () => {
  for (const valor of ['NA ETAPA', 'talvez', 'sim', '', 'na_etapa_mesmo']) {
    const r = interpretar(RESPOSTA_OK(`, "situacao": "${valor}"`), true);
    assert.equal(r.situacao, 'indefinido', `"${valor}" foi promovido a resposta`);
  }
});

test('os dois valores válidos passam inteiros', () => {
  assert.equal(interpretar(RESPOSTA_OK(', "situacao": "na_etapa"'), true).situacao, 'na_etapa');
  assert.equal(interpretar(RESPOSTA_OK(', "situacao": "outra_tela"'), true).situacao, 'outra_tela');
});

/**
 * O CASO QUE MAIS IMPORTA: o modelo devolveu lixo. Não ter lido a tela não pode
 * virar "está na etapa certa" — seria a IARA confirmando uma posição que ela não
 * olhou, que é a única resposta pior que não responder.
 */
test('resposta ilegível numa chamada situada vira `indefinido`', () => {
  for (const lixo of ['', 'desculpe, não consigo ver imagens', '{quebrado', 'null']) {
    assert.equal(interpretar(lixo, true).situacao, 'indefinido');
  }
});

test('a situação sobrevive a `encontrou: false` — são dois fatos diferentes', () => {
  const r = interpretar(
    '{"encontrou": false, "explicacao": "não vi esse botão", "situacao": "outra_tela"}',
    true,
  );
  assert.equal(r.alvo, null);
  assert.equal(r.situacao, 'outra_tela', 'a conferência sumiu junto com o alvo');
});

// ---------------------------------------------------------------------------
// A hierarquia da verdade dentro de uma resposta só
// ---------------------------------------------------------------------------

test('a leitura sai como dedução e o procedimento sai como documento', async () => {
  const { p, primeira } = await comecar();
  const texto = redigirConferencia(await naParada(), {
    texto: 'a tela mostra a lista de contratos',
    situacao: 'na_etapa',
  });

  // O que eu VI, marcado como dedução.
  assert.match(texto, /Pelo que vejo na sua tela/);
  assert.match(texto, /dedução minha, não um dado observado/);

  // O que o DOCUMENTO manda, verbatim e com fonte.
  if (primeira.slide.texto) assert.ok(texto.includes(primeira.slide.texto));
  assert.match(texto, /conforme o documento interno/);
  assert.ok(texto.includes(p.codigo), 'a resposta não cita o POP de onde veio');

  // E nessa ordem: a leitura antes, o procedimento depois.
  assert.ok(
    texto.indexOf('Pelo que vejo') < texto.indexOf('conforme o documento interno'),
    'o documento apareceu antes da leitura — a hierarquia inverteu',
  );
});

test('`outra_tela` diz, com todas as letras, que a posição não foi mexida', async () => {
  await comecar();
  const texto = redigirConferencia(await naParada(), {
    texto: 'isto parece a tela de cadastro',
    situacao: 'outra_tela',
  });
  assert.match(texto, /Não mexi na sua posição/);
});

test('toda conferência avisa que conferir não avança', async () => {
  await comecar();
  const situacao = await naParada();
  for (const s of ['na_etapa', 'outra_tela', 'indefinido'] as const) {
    assert.match(redigirConferencia(situacao, { texto: 'algo', situacao: s }), /Conferir não avança/);
  }
});

// ---------------------------------------------------------------------------
// A trava central
// ---------------------------------------------------------------------------

/**
 * CONFERIR NÃO MOVE NINGUÉM.
 *
 * Se um dia alguém fizer a visão avançar a etapa "porque a tela já é a
 * próxima", a LLM passa a escrever estado por um caminho que nem o guardião nem
 * o porteiro vigiam. Este teste é a porta.
 */
test('conferir a tela NÃO move a posição do operador', async () => {
  const { p, primeira } = await comecar();
  const antes = await procedimentosEmCurso.emCurso(OPERADOR);

  const situacao = await naParada();
  redigirConferencia(situacao, { texto: 'já fiz tudo isso', situacao: 'outra_tela' });
  ilustracaoDaSituacao(situacao);

  const depois = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(depois?.etapa, antes?.etapa);
  assert.equal(depois?.slide, antes?.slide);
  assert.equal(depois?.etapa, primeira.etapa.numero);
  assert.equal(depois?.codigo, p.codigo);
});

// ---------------------------------------------------------------------------
// POP revisado embaixo de quem estava no meio
// ---------------------------------------------------------------------------

test('POP revisado não vira parada — e a leitura da imagem continua valendo', async () => {
  const p = algumProcedimento();
  const primeira = posicoes(p)[0];
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'guiar',
    etapa: primeira.etapa.numero,
    slide: primeira.slide.indice,
    hash_origem: 'versao-que-nao-existe-mais',
  });

  const situacao = await situacaoDoOperador(OPERADOR);
  assert.equal(situacao.tipo, 'revisado');
  assert.equal(ilustracaoDaSituacao(situacao), null, 'ilustrou uma parada de versão revisada');
  assert.match(avisoDeRevisao(p.codigo), /não dá para dizer\s+em que etapa você está/);

  // E não encerrou nada: anexar um print é pergunta, não desistência.
  assert.ok(await procedimentosEmCurso.emCurso(OPERADOR), 'a conferência apagou a posição');
});

test('sem procedimento em curso, nada é situado e nada é ilustrado', async () => {
  const situacao = await situacaoDoOperador(OPERADOR);
  assert.equal(situacao.tipo, 'sem_procedimento');
  assert.equal(ilustracaoDaSituacao(situacao), null);
});

test('a ilustração da situação é a da parada em curso', async () => {
  const { p, primeira } = await comecar();
  const situacao = await situacaoDoOperador(OPERADOR);
  const ilustracao = ilustracaoDaSituacao(situacao);

  if (primeira.slide.capturas.length === 0) {
    assert.equal(ilustracao, null);
    return;
  }
  assert.ok(ilustracao);
  assert.deepEqual(
    ilustracao!.telas.map((t) => t.url),
    primeira.slide.capturas.map((c) => c.url),
  );
  assert.ok(ilustracao!.fonte.includes(p.codigo));
  assert.ok(acharPosicao(p, primeira.etapa.numero, primeira.slide.indice));
});

// ---------------------------------------------------------------------------
// O ciclo completo: conferir num turno, avançar no seguinte
// ---------------------------------------------------------------------------

/** Contexto mínimo — estas habilidades leem `parametros`, `id_usuario` e `enunciado`. */
function ctx(parametros: Record<string, unknown>, enunciado = ''): ContextoHabilidade {
  return {
    sessao: 's-conferencia',
    id_usuario: OPERADOR,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

async function conferir(situacao: 'na_etapa' | 'outra_tela' | 'indefinido') {
  await registrarConferencia(
    OPERADOR,
    await naParada(),
    { texto: 'leitura de teste', situacao },
    '/anexo/teste.png',
  );
}

/**
 * O CAMINHO QUE ESTAVA MORTO. `TipoDeEvidencia.anexada` existia declarado e
 * nenhum código chegava nele: o anexo era respondido pelo short-circuit de
 * visão e o turno acabava ali. Agora a conferência sobrevive ao turno, e é ela
 * — não o mero fato de um arquivo ter chegado — que sustenta o avanço.
 */
test('conferência `na_etapa` sustenta o avanço do turno seguinte como `anexada`', async () => {
  await comecar();
  await conferir('na_etapa');

  const r = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'próximo'));
  assert.equal(r.resolveu, true, r.texto);

  const depois = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(depois?.evidencia, 'anexada', 'o avanço não creditou a captura conferida');
  assert.match(r.texto, /conferida contra esta etapa/);
});

test('conferência `outra_tela` RECUSA o avanço, mesmo com o operador dizendo que fez', async () => {
  const { primeira } = await comecar();
  await conferir('outra_tela');

  const r = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'pronto, fiz'));

  const depois = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(depois?.slide, primeira.slide.indice, 'avançou contra a própria evidência');
  assert.equal(depois?.etapa, primeira.etapa.numero);
  assert.equal(
    depois?.desvios.at(-1)?.tipo,
    'evidencia_contraditoria',
    'a recusa não foi classificada',
  );
  assert.match(r.texto, /outra tela/i);
});

/**
 * NÃO TER LIDO NÃO CONFIRMA. `indefinido` não é evidência a favor nem contra: o
 * avanço volta a depender do que a PESSOA disse, que é o comportamento de antes
 * de esta camada existir.
 */
test('conferência `indefinido` não sustenta nem impede — vale a palavra do operador', async () => {
  await comecar();
  await conferir('indefinido');

  const semDizer = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'e agora?'));
  assert.equal(semDizer.resolveu, false, 'a captura ilegível virou confirmação');

  const dizendo = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'pronto, fiz'));
  assert.equal(dizendo.resolveu, true, dizendo.texto);
  const depois = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(depois?.evidencia, 'declarada');
});

/**
 * UMA CAPTURA, UM AVANÇO. Sem isto, um print conferido no começo sustentaria o
 * procedimento inteiro — a pessoa diria "próximo" oito vezes e a auditoria
 * registraria oito etapas anexadas com uma imagem só.
 */
test('a conferência morre ao mudar de parada — não sustenta o avanço seguinte', async () => {
  await comecar();
  await conferir('na_etapa');

  await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'próximo'));
  const noSegundo = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(noSegundo?.evidencia, 'anexada');
  assert.equal(noSegundo?.conferencia ?? null, null, 'a conferência sobreviveu à mudança de parada');

  await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'próximo'));
  const noTerceiro = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(noTerceiro?.evidencia, 'declarada', 'a mesma captura sustentou duas etapas');
});

test('conferência de outra parada não é gravada', async () => {
  const { p, primeira } = await comecar();
  await procedimentosEmCurso.registrarConferencia(OPERADOR, {
    situacao: 'na_etapa',
    codigo: p.codigo,
    etapa: primeira.etapa.numero,
    slide: primeira.slide.indice + 99,
    hash_origem: p.hash_origem,
    anexo: '/anexo/errado.png',
    instante: new Date().toISOString(),
  });
  const emCurso = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(emCurso?.conferencia ?? null, null, 'gravou a leitura de outra parada');
});

test('guardião: captura de outra tela recusa sem BLOQUEAR o acompanhamento', async () => {
  const { p, primeira } = await comecar();
  const veredito = guardiao.podeAvancar({
    procedimento: p,
    emCurso: {
      codigo: p.codigo,
      etapa: primeira.etapa.numero,
      slide: primeira.slide.indice,
      hash_origem: p.hash_origem,
    },
    evidencia: 'declarada',
    conferencia: {
      situacao: 'outra_tela',
      codigo: p.codigo,
      etapa: primeira.etapa.numero,
      slide: primeira.slide.indice,
      hash_origem: p.hash_origem,
      anexo: '/anexo/teste.png',
      instante: new Date().toISOString(),
    },
  });

  assert.equal(veredito.permitido, false);
  assert.equal(veredito.desvio?.tipo, 'evidencia_contraditoria');
  // A janela errada em primeiro plano não desfaz o procedimento de ninguém.
  assert.equal(veredito.estado, 'aguardando_evidencia');
});
