/**
 * PERCEPÇÃO × TREINAMENTO — a junção, e o que ela continua NÃO podendo fazer.
 *
 * A pergunta deste arquivo: a instrutora usa o que a percepção viu **sem ganhar
 * nenhuma autoridade nova**? Observar muda o que a IARA DIZ. Não muda onde o
 * operador está, não vira evidência, não vira conferência, não avança etapa.
 *
 * Os dois testes que importam são `X3` e `X4`: uma sessão de percepção
 * perfeitamente ativa, com a tela mudando, e o ponteiro parado no mesmo lugar.
 */

import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { baseProcedimentos } from '../servidor/nucleo/BaseProcedimentos';
import { procedimentosEmCurso } from '../servidor/nucleo/ProcedimentosEmCurso';
import { progressosDeTreinamento } from '../servidor/nucleo/ProgressoDeTreinamento';
import { percepcaoDeTela, type EnvioAoBraco } from '../servidor/nucleo/PercepcaoDeTela';
import { treinarProcedimento } from '../servidor/nucleo/kernel/habilidades/treinamento';
import { podeGuiar, posicoes } from '../lib/procedimento';
import type { EventoVisual } from '../lib/percepcao';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-percepcao-treino';
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

function ctx(parametros: Record<string, unknown>, enunciado = ''): ContextoHabilidade {
  return {
    sessao: 's-px',
    id_usuario: OPERADOR,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

function popDeTrabalho() {
  const p = baseProcedimentos.catalogo().find((x) => podeGuiar(x) && posicoes(x).length >= 4);
  assert.ok(p, 'base sem procedimento conduzível: rode `npm run pops`');
  return p!;
}

async function comecarProcedimento() {
  const p = popDeTrabalho();
  const parada = posicoes(p)[1];
  await procedimentosEmCurso.iniciar({
    id_usuario: OPERADOR,
    codigo: p.codigo,
    modo: 'treinar',
    etapa: parada.etapa.numero,
    slide: parada.slide.indice,
    hash_origem: p.hash_origem,
  });
  return p;
}

/** Liga uma sessão de percepção de verdade, pelo caminho de sempre. */
function ligarPercepcao(mensagens: readonly string[] = []): string {
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
    janela: { processo: 'gw', assinatura: 'consulta', largura: 800, altura: 600 },
    origem: 'hash_de_quadro' as const,
    motivo: '',
    texto: '',
  };
  percepcaoDeTela.registrar(fonte, {
    ...base,
    tipo: 'sessao_iniciada',
    hash: null,
    distancia: null,
  } as never);
  if (mensagens.length > 0) {
    percepcaoDeTela.registrar(fonte, {
      ...base,
      tipo: 'mensagem_detectada',
      hash: null,
      distancia: null,
      origem: 'ocr',
      texto: mensagens.join('\n'),
    } as never);
  }
  return sessao;
}

async function posicaoGravada() {
  const e = await procedimentosEmCurso.emCurso(OPERADOR);
  return e ? `${e.etapa}/${e.slide}|${e.evidencia}` : null;
}

// ---------------------------------------------------------------------------

test('X1. sem percepção, a IARA continua pedindo print', async () => {
  await comecarProcedimento();
  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.texto, /print/i, 'sem percepção, o print continua sendo o caminho');
  assert.doesNotMatch(r.texto, /Estou acompanhando/i);
});

test('X2. com percepção ativa, ela PARA de pedir print e diz o que vê e o que não vê', async () => {
  await comecarProcedimento();
  ligarPercepcao();

  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.texto, /Estou acompanhando/i, 'não avisou que está observando');
  assert.match(r.texto, /gw/);
  assert.doesNotMatch(r.texto, /me mande um print/i, 'continuou pedindo print a quem já autorizou');
  /* A SEGUNDA METADE DA FRASE é a que impede a promessa de virar mentira. */
  assert.match(r.texto, /não vejo que você cumpriu a etapa/i);
  assert.match(r.detalhe, /percepcao=ativa/);
});

test('X3. a percepção NÃO move o ponteiro, por mais que a tela mude', async () => {
  await comecarProcedimento();
  const antes = await posicaoGravada();
  const sessao = ligarPercepcao();

  const fonte = { id_dispositivo: 'disp-teste', id_usuario: OPERADOR };
  for (let i = 0; i < 5; i += 1) {
    percepcaoDeTela.registrar(fonte, {
      tipo: 'mudanca_visual',
      sessao_percepcao: sessao,
      instante: new Date().toISOString(),
      janela: { processo: 'gw', assinatura: 'consulta', largura: 800, altura: 600 },
      hash: `000000000000000${i}`,
      distancia: 30,
      origem: 'hash_de_quadro',
      motivo: '',
      texto: '',
    } as never);
  }
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR)?.mudancas, 5);

  await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.equal(await posicaoGravada(), antes, 'a percepção moveu o procedimento');
});

test('X4. a percepção NÃO vira evidência nem conferência', async () => {
  await comecarProcedimento();
  ligarPercepcao();
  await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));

  const emCurso = await procedimentosEmCurso.emCurso(OPERADOR);
  assert.equal(emCurso?.evidencia, 'nenhuma', 'a observação virou evidência');
  assert.ok(!emCurso?.conferencia, 'a observação virou conferência');
});

test('X5. mensagem observada substitui "qual foi a mensagem?" — com a procedência colada', async () => {
  await comecarProcedimento();
  ligarPercepcao(['Erro 1145 ao transmitir o CT-e']);

  const r = await treinarProcedimento.executar(ctx({ modo: 'diagnostico' }, 'deu erro'));
  assert.match(r.texto, /Erro 1145/, 'não usou a mensagem que já tinha lido');
  assert.doesNotMatch(r.texto, /qual foi a \*\*mensagem exata\*\*/i, 'pediu o que já sabia');
  assert.match(r.texto, /dedução minha|leitura de tela/i, 'citou OCR como se fosse fato');
  assert.match(r.detalhe, /mensagens=1/);
});

test('X6. sem mensagem observada, o diagnóstico continua perguntando', async () => {
  await comecarProcedimento();
  ligarPercepcao();
  const r = await treinarProcedimento.executar(ctx({ modo: 'diagnostico' }, 'deu erro'));
  assert.match(r.texto, /mensagem exata/i, 'deixou de perguntar sem ter o que citar');
});

test('X7. o diagnóstico com percepção continua NÃO avançando', async () => {
  const p = await comecarProcedimento();
  const antes = await posicaoGravada();
  ligarPercepcao(['Erro 1145 ao transmitir']);

  const r = await treinarProcedimento.executar(ctx({ modo: 'diagnostico' }, 'deu erro'));
  assert.equal(await posicaoGravada(), antes);
  assert.match(r.detalhe, /avanco=nao/);
  assert.match(r.texto, new RegExp(p.codigo), 'a resposta perdeu a fonte do procedimento');
});

test('X8. percepção suspensa é dita como suspensa, não como ativa', async () => {
  await comecarProcedimento();
  const sessao = ligarPercepcao();
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-teste', id_usuario: OPERADOR },
    {
      tipo: 'percepcao_suspensa',
      sessao_percepcao: sessao,
      instante: new Date().toISOString(),
      janela: null,
      hash: null,
      distancia: null,
      origem: 'metadado_de_janela',
      motivo: 'janela fora do escopo autorizado (whatsapp)',
      texto: '',
    } as never,
  );

  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.texto, /pausada/i, 'disse que estava observando enquanto estava suspensa');
});

test('X9. encerrada a percepção, a IARA volta a pedir print', async () => {
  await comecarProcedimento();
  ligarPercepcao();
  percepcaoDeTela.encerrar(OPERADOR, 'operador pediu');

  const r = await treinarProcedimento.executar(ctx({ modo: 'ensino' }, 'me ensina'));
  assert.match(r.texto, /print/i, 'continuou prometendo acompanhamento depois de encerrado');
  assert.match(r.detalhe, /percepcao=inativa/);
});

/* `EventoVisual` é importado só para o `as never` acima ficar honesto sobre o
   que está sendo montado à mão. */
void (null as unknown as EventoVisual);
