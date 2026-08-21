/**
 * O FLUXO DE PRODUTO da percepção — a pergunta que este arquivo responde é uma
 * só: **a IARA consegue ligar a observação sem um script?**
 *
 * Antes desta fase a resposta era não. Existia captura, detecção, transporte e
 * estado — e o único caminho que ligava tudo era
 * `scripts/provas/percepcao-ponta-a-ponta.ts`. Script não é produto, e um teste
 * que exercite só as peças não distingue as duas coisas.
 *
 * Então aqui não se chama nada por dentro: entra FRASE DO OPERADOR, sai PLANO,
 * e o plano executa a habilidade de verdade. O que se afirma é o que muda no
 * registro da sessão e o que sai pelo socket — nunca a redação da resposta.
 *
 * O TRANSPORTE É DUBLÊ, e de propósito: o socket real já está provado em
 * `percepcao-ponte.test.ts`. O que falta provar é a DECISÃO — quem pode ligar,
 * quando, com que escopo, e quem consegue parar.
 */

import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { observarTela } from '../servidor/nucleo/kernel/habilidades/percepcao';
import { percepcaoDeTela, type EnvioAoBraco } from '../servidor/nucleo/PercepcaoDeTela';
import {
  TETO_DA_SESSAO_MS,
  VALIDADE_DA_SOLICITACAO_MS,
  podeCapturar,
  type EventoVisual,
} from '../lib/percepcao';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const OPERADOR = 'u-percepcao-produto';

/** O Braço de mentira: registra o que teria saído pelo socket. */
function bracoFalso(opcoes: { conectado?: boolean; escritaFalha?: boolean } = {}) {
  const enviados: Record<string, unknown>[] = [];
  const envio: EnvioAoBraco = {
    dispositivoDe: () =>
      opcoes.conectado === false ? null : { id_dispositivo: 'disp-teste', nome: 'maquina' },
    enviar: (_id, pacote) => {
      if (opcoes.escritaFalha) return false;
      enviados.push(pacote as unknown as Record<string, unknown>);
      return true;
    },
  };
  return { envio, enviados };
}

beforeEach(() => percepcaoDeTela.limpar());
afterEach(() => {
  percepcaoDeTela.limpar();
  percepcaoDeTela.configurarEnvio(null);
});

function ctx(enunciado: string, parametros: Record<string, unknown> = {}): ContextoHabilidade {
  return {
    sessao: 's-produto',
    id_usuario: OPERADOR,
    parametros,
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

function planoDe(frase: string) {
  return new Planejador().planejar(new MotorPercepcao().perceber(frase));
}

function evento(over: Partial<EventoVisual>, sessao: string): EventoVisual {
  return {
    tipo: 'mudanca_visual',
    sessao_percepcao: sessao,
    instante: new Date().toISOString(),
    janela: { processo: 'chrome', assinatura: 'gw - coleta', largura: 800, altura: 600 },
    hash: '0123456789abcdef',
    distancia: 30,
    origem: 'hash_de_quadro',
    motivo: '',
    texto: '',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. A frase do operador vira plano determinístico
// ---------------------------------------------------------------------------

test('P1. as frases de observação viram plano determinístico, sem passar pela LLM', () => {
  const casos: ReadonlyArray<[string, string]> = [
    ['me acompanha fazendo esse procedimento', 'solicitar'],
    ['fica vendo minha tela enquanto eu faço', 'solicitar'],
    ['olha minha tela', 'solicitar'],
    ['pode observar o chrome', 'autorizar'],
    ['para de observar', 'encerrar'],
    ['para de observar minha tela', 'encerrar'],
    ['você está vendo minha tela?', 'situacao'],
  ];
  for (const [frase, acao] of casos) {
    const plano = planoDe(frase);
    assert.equal(plano.origem, 'deterministico', `"${frase}" caiu no raciocínio livre`);
    assert.equal(plano.passos[0].habilidade, 'observar_tela', `"${frase}" foi para outra habilidade`);
    assert.equal(plano.passos[0].parametros.acao, acao, `"${frase}" virou ação errada`);
  }
});

test('P2. o programa citado vira ESCOPO, e a frase sem programa não inventa um', () => {
  assert.equal(planoDe('pode observar o chrome').passos[0].parametros.aplicativo, 'chrome');
  assert.equal(planoDe('pode acompanhar o notepad').passos[0].parametros.aplicativo, 'notepad');
  assert.equal(
    planoDe('pode observar').passos[0].parametros.aplicativo,
    undefined,
    'inventou um programa a partir de uma frase que não nomeia nenhum',
  );
  assert.equal(
    planoDe('pode observar a minha tela').passos[0].parametros.aplicativo,
    undefined,
    '"tela" virou nome de programa',
  );
});

test('P3. PARAR vence tudo — nenhuma frase de parada liga a observação', () => {
  for (const frase of [
    'para de observar minha tela',
    'pode parar de acompanhar',
    'não olha mais minha tela',
    'sai da minha tela',
    'para de me observar',
  ]) {
    const plano = planoDe(frase);
    assert.equal(
      plano.passos[0].parametros.acao,
      'encerrar',
      `"${frase}" NÃO foi lida como pedido de parar`,
    );
  }
});

test('P4. a âncora de percepção não rouba as frases das outras', () => {
  const alheias: ReadonlyArray<[string, string]> = [
    ['me acompanha no agendamento de coleta', 'consultar_procedimento'],
    ['como faço o agendamento de uma coleta', 'consultar_procedimento'],
    ['me testa sobre o encerramento do manifesto', 'treinar_procedimento'],
    ['continua meu treinamento de onde paramos', 'treinar_procedimento'],
  ];
  for (const [frase, esperada] of alheias) {
    assert.equal(planoDe(frase).passos[0].habilidade, esperada, `"${frase}" foi sequestrada`);
  }
});

// ---------------------------------------------------------------------------
// 2. O ciclo completo, pela habilidade
// ---------------------------------------------------------------------------

test('P5. IARA pede → operador autoriza → o Braço é acionado UMA vez', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);

  const pedido = await observarTela.executar(ctx('me acompanha fazendo esse procedimento'));
  assert.equal(pedido.resolveu, true);
  assert.equal(enviados.length, 0, 'o Braço foi acionado ANTES de alguém autorizar');
  assert.equal(percepcaoDeTela.pendenteDe(OPERADOR)?.estado, 'solicitada');
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR), null, 'já havia sessão observando');

  const aceite = await observarTela.executar(ctx('pode observar o chrome'));
  assert.equal(aceite.resolveu, true);
  assert.equal(enviados.length, 1, 'a autorização não acionou o Braço');
  assert.equal(enviados[0].tipo, 'percepcao_iniciar');
  assert.deepEqual(enviados[0].processos, ['chrome']);
  assert.ok(enviados[0].autorizado_em, 'o pacote não carrega a hora da autorização');
});

test('P6. autorizar SEM programa é recusado — a IARA não escolhe a janela', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx('me acompanha fazendo esse procedimento'));

  const r = await observarTela.executar(ctx('pode observar', { acao: 'autorizar' }));
  assert.equal(r.resolveu, false);
  assert.equal(enviados.length, 0, 'ligou a observação sem saber qual janela');
  assert.match(r.texto, /qual programa/i);
});

test('P7. sem Braço conectado a IARA recusa em vez de prometer', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso({ conectado: false }).envio);
  const r = await observarTela.executar(ctx('fica vendo minha tela enquanto eu faço'));
  assert.equal(r.resolveu, false);
  assert.match(r.texto, /conectado|programa da IARA/i);
  assert.equal(percepcaoDeTela.pendenteDe(OPERADOR), null);
});

test('P8. autorizar sem pedido aberto não liga nada', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  const r = await observarTela.executar(ctx('pode observar o chrome'));
  assert.equal(r.resolveu, false);
  assert.equal(enviados.length, 0, 'ligou a observação sem nenhum pedido ter sido feito');
});

test('P9. escrita falha no socket NÃO deixa a sessão parecendo ligada', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso({ escritaFalha: true }).envio);
  await observarTela.executar(ctx('olha minha tela'));
  const r = await observarTela.executar(ctx('pode observar o chrome'));
  assert.equal(r.resolveu, false);
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR), null);
});

// ---------------------------------------------------------------------------
// 3. Kill switch
// ---------------------------------------------------------------------------

test('P10. "para de observar" encerra, manda parar e ZERA os eventos aceitos', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx('olha minha tela'));
  await observarTela.executar(ctx('pode observar o chrome'));
  const sessao = percepcaoDeTela.vivaDe(OPERADOR)!.sessao_percepcao;

  const fonte = { id_dispositivo: 'disp-teste', id_usuario: OPERADOR };
  percepcaoDeTela.registrar(fonte, evento({ tipo: 'sessao_iniciada', hash: null, distancia: null }, sessao));
  percepcaoDeTela.registrar(fonte, evento({}, sessao));
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR)?.mudancas, 1);

  const parada = await observarTela.executar(ctx('para de observar'));
  assert.equal(parada.resolveu, true);
  assert.equal(enviados.at(-1)!.tipo, 'percepcao_encerrar', 'não mandou o Braço parar');
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR), null, 'a sessão continuou observando');

  /* O EVENTO EM VOO. Um quadro que já tinha saído quando a pessoa apertou parar
     NÃO pode reabrir a observação — é a metade do kill switch que mora do lado
     do motor. */
  const depois = percepcaoDeTela.registrar(fonte, evento({}, sessao));
  assert.equal(depois.estado, 'encerrada', 'um evento tardio ressuscitou a sessão');
  assert.equal(depois.mudancas, 1, 'o evento tardio foi contado');
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR), null);
});

test('P11. parar sem sessão não explode nem inventa que parou algo', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  const r = await observarTela.executar(ctx('para de observar'));
  assert.equal(r.resolveu, true);
  assert.match(r.texto, /não estou acompanhando/i);
});

// ---------------------------------------------------------------------------
// 4. Timeout — sessão não fica eterna
// ---------------------------------------------------------------------------

test('P12. a sessão morre sozinha no teto, mesmo sem ninguém encerrar', () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  const t0 = Date.parse('2026-08-21T10:00:00.000Z');

  const pedido = percepcaoDeTela.solicitar({
    id_usuario: OPERADOR,
    escopo: { processos: ['chrome'] },
    motivo: 'teste',
    procedimento: null,
    agora: t0,
  });
  assert.ok(pedido.ok);
  percepcaoDeTela.autorizar(OPERADOR, { agora: t0 });
  const sessao = percepcaoDeTela.vivaDe(OPERADOR)!.sessao_percepcao;
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-teste', id_usuario: OPERADOR },
    {
      ...evento({ tipo: 'sessao_iniciada', hash: null, distancia: null }, sessao),
      instante: new Date(t0).toISOString(),
    },
  );
  assert.ok(podeCapturar(percepcaoDeTela.ativaDe(OPERADOR)!.estado));

  assert.deepEqual(percepcaoDeTela.varrer(t0 + TETO_DA_SESSAO_MS - 1_000), [], 'matou cedo demais');

  const mortas = percepcaoDeTela.varrer(t0 + TETO_DA_SESSAO_MS + 1_000);
  assert.equal(mortas.length, 1, 'a sessão passou do teto e continuou viva');
  assert.equal(percepcaoDeTela.ativaDe(OPERADOR), null);
  assert.equal(enviados.at(-1)!.tipo, 'percepcao_encerrar', 'não mandou o Braço parar no teto');
});

test('P13. o PEDIDO não autorizado também vence', () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  const t0 = Date.parse('2026-08-21T10:00:00.000Z');
  percepcaoDeTela.solicitar({
    id_usuario: OPERADOR,
    escopo: { processos: ['chrome'] },
    motivo: 'teste',
    procedimento: null,
    agora: t0,
  });
  percepcaoDeTela.varrer(t0 + VALIDADE_DA_SOLICITACAO_MS + 1_000);
  assert.equal(percepcaoDeTela.pendenteDe(OPERADOR), null, 'o pedido vencido continuou de pé');

  const r = percepcaoDeTela.autorizar(OPERADOR, { agora: t0 + VALIDADE_DA_SOLICITACAO_MS + 2_000 });
  assert.equal(r.ok, false);
});

// ---------------------------------------------------------------------------
// 5. Estados impossíveis
// ---------------------------------------------------------------------------

test('P14. sessão encerrada NUNCA autoriza captura', () => {
  assert.equal(podeCapturar('encerrada'), false);
  assert.equal(podeCapturar('inativa'), false);
  assert.equal(podeCapturar('solicitada'), false, 'um pedido pendente autorizaria captura');
  assert.equal(podeCapturar('ativa'), true);
  assert.equal(podeCapturar('suspensa'), true);
});

test('P15. dois pedidos seguidos não deixam duas autorizações ambíguas', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx('olha minha tela'));
  await observarTela.executar(ctx('olha minha tela'));
  assert.equal(percepcaoDeTela.de(OPERADOR).filter((e) => e.estado === 'solicitada').length, 1);

  await observarTela.executar(ctx('pode observar o chrome'));
  assert.equal(enviados.length, 1, 'uma autorização acionou o Braço mais de uma vez');
});

test('P16. o operador consegue perguntar se está sendo observado, e a resposta é honesta', async () => {
  const { envio } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);

  const antes = await observarTela.executar(ctx('você está vendo minha tela?'));
  assert.match(antes.texto, /^Não\./);

  await observarTela.executar(ctx('olha minha tela'));
  await observarTela.executar(ctx('pode observar o chrome'));
  const sessao = percepcaoDeTela.vivaDe(OPERADOR)!.sessao_percepcao;
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-teste', id_usuario: OPERADOR },
    evento({ tipo: 'sessao_iniciada', hash: null, distancia: null }, sessao),
  );

  const durante = await observarTela.executar(ctx('você está vendo minha tela?'));
  assert.match(durante.texto, /^Sim/);
  assert.match(durante.texto, /chrome/);
});

// ---------------------------------------------------------------------------
// 6. A percepção continua sem alcançar o procedimento
// ---------------------------------------------------------------------------

test('P17. o verificador NUNCA afirma que a tela está sendo capturada', async () => {
  const { envio } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx('olha minha tela'));
  const r = await observarTela.executar(ctx('pode observar o chrome'));
  const v = await observarTela.verificar!(r, ctx(''));
  assert.equal(v.confirmado, true);
  assert.match(v.evidencia, /relatada por ele|aguardando|nenhuma sessão/i);
  assert.doesNotMatch(v.evidencia, /capturando agora|tela sendo lida/i);
});
