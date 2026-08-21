/**
 * ADERÊNCIA — o texto observado contra a `ParadaEsperada`.
 *
 * DOIS TESTES CARREGAM ESTE ARQUIVO, e os dois são sobre a mesma tentação:
 *
 *   `A9`  `resultado_observado` NÃO é `etapa_concluida`. A tela já é a da
 *         próxima parada, e a etapa continua sem ser dada por feita.
 *   `A10` a aderência NÃO vira `ConferenciaDaParada`. Se virasse, o guardião a
 *         aceitaria como evidência `anexada` e a observação passaria a andar com
 *         o procedimento sozinha.
 *
 * O resto prova que a comparação distingue o que promete distinguir — usando os
 * POPs REAIS, não texto que eu inventei para o teste passar.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { baseProcedimentos } from '../servidor/nucleo/BaseProcedimentos';
import { procedimentosEmCurso } from '../servidor/nucleo/ProcedimentosEmCurso';
import { progressosDeTreinamento } from '../servidor/nucleo/ProgressoDeTreinamento';
import { percepcaoDeTela, type EnvioAoBraco } from '../servidor/nucleo/PercepcaoDeTela';
import { treinarProcedimento } from '../servidor/nucleo/kernel/habilidades/treinamento';
import { avancarProcedimento } from '../servidor/nucleo/kernel/habilidades/procedimentos';
import {
  MARGEM_MINIMA,
  PROPORCAO_MINIMA,
  aderenciaAParada,
  compararComOPercurso,
  termosDaParada,
} from '../lib/aderencia';
import { descreverParada, podeGuiar, posicoes } from '../lib/procedimento';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-aderencia';
const RAIZ = path.resolve(process.cwd());

const envio: EnvioAoBraco = {
  dispositivoDe: () => ({ id_dispositivo: 'disp-teste', nome: 'maquina' }),
  enviar: () => true,
};

async function limpar(): Promise<void> {
  await procedimentosEmCurso.encerrar(OPERADOR).catch(() => null);
  await progressosDeTreinamento.esquecer(OPERADOR).catch(() => null);
  percepcaoDeTela.limpar();
  for (const pasta of ['procedimentos-em-curso', 'progresso-treinamento']) {
    await rm(path.resolve(RAIZ, 'dados', pasta, `${OPERADOR}.json`), { force: true });
  }
}

beforeEach(async () => {
  await limpar();
  percepcaoDeTela.configurarEnvio(envio);
});
afterEach(async () => {
  await limpar();
  percepcaoDeTela.configurarEnvio(null);
});

/** Um POP real, com paradas de texto suficiente para a comparação valer. */
function popDeTrabalho() {
  const p = baseProcedimentos
    .catalogo()
    .find(
      (x) =>
        podeGuiar(x) &&
        posicoes(x).filter((pos) => pos.slide.texto.trim().length > 60).length >= 3,
    );
  assert.ok(p, 'base sem POP com paradas de texto suficiente: rode `npm run pops`');
  return p!;
}

function paradasComTexto(p: ReturnType<typeof popDeTrabalho>) {
  return posicoes(p).filter((pos) => pos.slide.texto.trim().length > 60);
}

function ctx(parametros: Record<string, unknown>, enunciado = ''): ContextoHabilidade {
  return {
    sessao: 's-ad',
    id_usuario: OPERADOR,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

/** Liga percepção com um texto observado já definido. */
function observando(texto: string): void {
  const pedido = percepcaoDeTela.solicitar({
    id_usuario: OPERADOR,
    escopo: { processos: ['gw'] },
    motivo: 'teste',
    procedimento: null,
  });
  assert.ok(pedido.ok);
  percepcaoDeTela.autorizar(OPERADOR);
  const sessao = percepcaoDeTela.vivaDe(OPERADOR)!.sessao_percepcao;
  const fonte = { id_dispositivo: 'disp-teste', id_usuario: OPERADOR };
  const base = {
    sessao_percepcao: sessao,
    instante: new Date().toISOString(),
    janela: { processo: 'gw', assinatura: 'tela', largura: 800, altura: 600 },
    motivo: '',
  };
  percepcaoDeTela.registrar(fonte, {
    ...base,
    tipo: 'sessao_iniciada',
    hash: null,
    distancia: null,
    origem: 'metadado_de_janela',
    texto: '',
  } as never);
  percepcaoDeTela.registrar(fonte, {
    ...base,
    tipo: 'mudanca_visual',
    hash: '0123456789abcdef',
    distancia: 20,
    origem: 'ocr',
    texto,
  } as never);
}

async function posicaoGravada() {
  const e = await procedimentosEmCurso.emCurso(OPERADOR);
  return e ? `${e.etapa}/${e.slide}|${e.evidencia}` : null;
}

// ---------------------------------------------------------------------------
// 1. Os termos e a medida, sobre POPs reais
// ---------------------------------------------------------------------------

test('A1. os termos de uma parada saem das MARCAS e do texto, sem ligação nem número', () => {
  const p = popDeTrabalho();
  for (const pos of paradasComTexto(p).slice(0, 5)) {
    const termos = termosDaParada(descreverParada(p, pos));
    assert.ok(termos.length > 0, 'parada com texto não produziu termo nenhum');
    for (const t of termos) {
      assert.ok(!/^\d+$/.test(t), `"${t}" é só número e virou termo identificador`);
      assert.ok(t.length >= 2);
    }
    assert.equal(new Set(termos).size, termos.length, 'termo repetido na lista');
  }
});

test('A2. a parada reconhece o PRÓPRIO texto e não o de outro procedimento', () => {
  const p = popDeTrabalho();
  const outro = baseProcedimentos.catalogo().find((x) => x.codigo !== p.codigo && podeGuiar(x))!;
  const paradas = paradasComTexto(p);
  const doOutro = paradasComTexto(outro);
  assert.ok(doOutro.length > 0, 'o segundo POP não tem parada com texto');

  let melhorQueAlheia = 0;
  for (const pos of paradas.slice(0, 8)) {
    const parada = descreverParada(p, pos);
    const propria = aderenciaAParada(parada, pos.slide.texto).proporcao;
    const alheia = aderenciaAParada(parada, doOutro[0].slide.texto).proporcao;
    if (propria > alheia) melhorQueAlheia += 1;
  }
  assert.ok(
    melhorQueAlheia >= Math.ceil(Math.min(8, paradas.length) * 0.8),
    'a aderência não distinguiu o próprio texto do texto de outro POP',
  );
});

test('A3. a proporção é uma MEDIDA contável, não uma confiança', () => {
  const p = popDeTrabalho();
  const parada = descreverParada(p, paradasComTexto(p)[0]);
  const a = aderenciaAParada(parada, parada.instrucao);
  assert.equal(a.proporcao, a.vistos.length / a.esperados.length, 'a proporção não é a conta');
  assert.ok(a.vistos.every((t) => a.esperados.includes(t)), 'apareceu termo que não era esperado');
});

// ---------------------------------------------------------------------------
// 2. A leitura do percurso
// ---------------------------------------------------------------------------

test('A4. texto curto NÃO decide nada', () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  const c = compararComOPercurso(
    descreverParada(p, paradas[0]),
    descreverParada(p, paradas[1]),
    'ok',
  );
  assert.equal(c.leitura, 'indefinida', 'decidiu sobre três letras');
  assert.equal(c.situacao, 'indefinido');
});

test('A5. o texto da própria parada é lido como `na_etapa`', () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  const c = compararComOPercurso(
    descreverParada(p, paradas[0]),
    descreverParada(p, paradas[1]),
    paradas[0].slide.texto,
  );
  assert.equal(c.leitura, 'na_etapa');
  assert.equal(c.situacao, 'na_etapa');
  assert.ok(c.atual.proporcao >= PROPORCAO_MINIMA);
});

test('A6. o texto da PRÓXIMA parada vira `resultado_observado`, e a situação é `outra_tela`', () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  const c = compararComOPercurso(
    descreverParada(p, paradas[0]),
    descreverParada(p, paradas[1]),
    paradas[1].slide.texto,
  );
  assert.equal(c.leitura, 'resultado_observado');
  /* A tradução para o vocabulário do SOS diz onde a pessoa NÃO está. Dizer
     `na_etapa` aqui faria a situação afirmar que ela está onde não está. */
  assert.equal(c.situacao, 'outra_tela');
});

test('A7. texto de outro procedimento vira `fora_do_percurso` — o DESVIO', () => {
  const p = popDeTrabalho();
  const outro = baseProcedimentos.catalogo().find((x) => x.codigo !== p.codigo && podeGuiar(x))!;
  const paradas = paradasComTexto(p);
  const c = compararComOPercurso(
    descreverParada(p, paradas[0]),
    descreverParada(p, paradas[1]),
    paradasComTexto(outro)[0].slide.texto,
  );
  assert.ok(
    c.leitura === 'fora_do_percurso' || c.leitura === 'indefinida',
    `texto alheio virou "${c.leitura}"`,
  );
  assert.notEqual(c.leitura, 'na_etapa', 'a IARA afirmaria estar na etapa vendo outro POP');
});

test('A8. empate entre atual e próxima vira `indefinida`', () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  const atual = descreverParada(p, paradas[0]);
  /* A mesma parada nos dois lados: proporções idênticas, margem zero. */
  const c = compararComOPercurso(atual, atual, atual.instrucao);
  assert.equal(c.leitura, 'indefinida', 'escolheu um lado num empate perfeito');
  assert.ok(Math.abs(c.atual.proporcao - c.proxima!.proporcao) < MARGEM_MINIMA);
});

// ---------------------------------------------------------------------------
// 3. As duas travas
// ---------------------------------------------------------------------------

test('A9. `resultado_observado` NÃO conclui etapa nem move o ponteiro', async () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: paradas[0].etapa.numero,
    slide: paradas[0].slide.indice,
    hash_origem: p.hash_origem,
  });
  const antes = await posicaoGravada();

  /* A tela JÁ É a da próxima parada — o caso mais tentador de todos. */
  observando(paradas[1].slide.texto);

  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.detalhe, /percurso=resultado_observado/, 'não leu a tela como progresso');
  assert.match(r.texto, /não conclui a etapa/i, 'não disse que ver não é concluir');
  assert.equal(await posicaoGravada(), antes, 'a leitura da tela moveu o procedimento');

  const emCurso = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(emCurso?.evidencia, 'nenhuma', 'a leitura virou evidência');
  assert.ok(!emCurso?.conferencia, 'a leitura virou conferência');
});

/**
 * Tira comentários da fonte antes de procurar uso de código.
 *
 * A primeira versão de `A10` proibia a MENÇÃO, e falhou contra o comentário de
 * `aderencia.ts` que explica, em três parágrafos, por que aderência não é
 * conferência. Um teste que proíbe explicar a regra empurra o próximo autor a
 * apagar a explicação para a suíte passar — que é o oposto do que ele quer.
 *
 * A remoção é ingênua: uma string contendo `//` viraria comentário aos olhos
 * dela. Para um teste de varredura de fonte isso é aceitável, e o falso
 * NEGATIVO que ele produziria (esconder uso real dentro de string) não é um
 * caminho plausível para alguém montar uma conferência por engano.
 */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

test('A10. nenhum caminho de código monta ConferenciaDaParada a partir da aderência', () => {
  for (const arquivo of [
    path.join(RAIZ, 'lib', 'aderencia.ts'),
    path.join(RAIZ, 'servidor', 'nucleo', 'PercepcaoDeTela.ts'),
    path.join(RAIZ, 'servidor', 'braco', 'PercepcaoLocal.ts'),
  ]) {
    const codigo = semComentarios(readFileSync(arquivo, 'utf8'));
    for (const proibido of ['ConferenciaDaParada', 'registrarConferencia', 'conferenciaVale']) {
      assert.ok(
        !codigo.includes(proibido),
        `${path.basename(arquivo)} USA ${proibido} — a aderência está virando conferência`,
      );
    }
  }

  /* E a menção em COMENTÁRIO tem de continuar existindo em `aderencia.ts`: é ela
     que diz ao próximo leitor por que a tentação foi recusada. */
  assert.match(
    readFileSync(path.join(RAIZ, 'lib', 'aderencia.ts'), 'utf8'),
    /ConferenciaDaParada/,
    'a explicação de por que aderência não é conferência sumiu do arquivo',
  );
});

test('A11. a aderência NÃO muda o veredito do guardião', async () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: paradas[0].etapa.numero,
    slide: paradas[0].slide.indice,
    hash_origem: p.hash_origem,
  });

  /* Tela perfeitamente reconhecida como a da própria etapa — e mesmo assim
     "próximo" sem declaração nenhuma continua sendo recusado. Ver não autoriza. */
  observando(paradas[0].slide.texto);
  const antes = await posicaoGravada();
  const semDeclaracao = await avancarProcedimento.executar(ctx({ direcao: 'proximo' }, 'hmm'));
  assert.equal(semDeclaracao.resolveu, false, 'a leitura da tela autorizou um avanço');
  assert.equal(await posicaoGravada(), antes);

  /* E o inverso: tela que a aderência lê como desvio NÃO bloqueia quem declarou.
     Bloquear daria à leitura poder sobre o procedimento, e ela não tem. */
  await limpar();
  percepcaoDeTela.configurarEnvio(envio);
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: paradas[0].etapa.numero,
    slide: paradas[0].slide.indice,
    hash_origem: p.hash_origem,
  });
  observando('menu arquivo editar exibir favoritos ferramentas ajuda usuario logado sair');
  const comDeclaracao = await avancarProcedimento.executar(
    ctx({ direcao: 'proximo' }, 'pronto, fiz'),
  );
  assert.equal(comDeclaracao.resolveu, true, 'a leitura da tela bloqueou uma declaração válida');
});

test('A12. sem percepção ativa, nada disso aparece na resposta', async () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: paradas[0].etapa.numero,
    slide: paradas[0].slide.indice,
    hash_origem: p.hash_origem,
  });
  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.detalhe, /percurso=sem_leitura/);
  assert.doesNotMatch(r.texto, /Pelo que leio na sua tela/i);
});

test('A13. leitura indefinida produz SILÊNCIO, não um aviso inútil', async () => {
  const p = popDeTrabalho();
  const paradas = paradasComTexto(p);
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: paradas[0].etapa.numero,
    slide: paradas[0].slide.indice,
    hash_origem: p.hash_origem,
  });
  observando('ok');

  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.detalhe, /percurso=indefinida/);
  assert.doesNotMatch(r.texto, /Pelo que leio|não corresponde|próxima parada/i);
});
