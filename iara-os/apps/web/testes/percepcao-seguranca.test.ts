/**
 * SEGURANÇA DA PERCEPÇÃO — a lista do §28, cada item uma asserção.
 *
 * O que estes testes protegem não é o sistema: é a pessoa cuja tela está sendo
 * observada. Cada falha aqui tem a mesma forma — alguém consegue ver, ou
 * continuar vendo, algo que não foi autorizado a ver.
 *
 * NENHUM deles afirma redação. Todos afirmam ESTADO: o que foi gravado, o que
 * foi enviado, o que foi recusado.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test, { afterEach, beforeEach } from 'node:test';

import { percepcaoDeTela, type EnvioAoBraco } from '../servidor/nucleo/PercepcaoDeTela';
import { observarTela } from '../servidor/nucleo/kernel/habilidades/percepcao';
import { ACOES_DESKTOP, lerPacoteBraco, lerPacoteMotor } from '../lib/execucao';
import { TETO_DA_SESSAO_MS, podeCapturar, type EventoVisual } from '../lib/percepcao';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const ANA = 'u-seg-ana';
const BRUNO = 'u-seg-bruno';
const RAIZ = path.resolve(process.cwd());

function bracoFalso() {
  const enviados: Record<string, unknown>[] = [];
  const envio: EnvioAoBraco = {
    dispositivoDe: () => ({ id_dispositivo: 'disp-ana', nome: 'maquina-ana' }),
    enviar: (_id, pacote) => {
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

function ctx(quem: string, enunciado: string): ContextoHabilidade {
  return {
    sessao: 's-seg',
    id_usuario: quem,
    parametros: {},
    sinal: new AbortController().signal,
    enunciado,
    registro: null,
    operacao: null,
  } as unknown as ContextoHabilidade;
}

function evento(over: Partial<EventoVisual>): EventoVisual {
  return {
    tipo: 'mudanca_visual',
    sessao_percepcao: 'sp-x',
    instante: new Date().toISOString(),
    janela: { processo: 'gw', assinatura: 'consulta', largura: 800, altura: 600 },
    hash: '0123456789abcdef',
    distancia: 30,
    origem: 'hash_de_quadro',
    motivo: '',
    texto: '',
    ...over,
  };
}

/** Abre uma sessão viva para ANA, pelo caminho normal. */
async function sessaoDeAna(): Promise<string> {
  await observarTela.executar(ctx(ANA, 'olha minha tela'));
  await observarTela.executar(ctx(ANA, 'pode observar o gw'));
  const viva = percepcaoDeTela.vivaDe(ANA);
  assert.ok(viva, 'a sessão de Ana não abriu');
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-ana', id_usuario: ANA },
    evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, sessao_percepcao: viva!.sessao_percepcao }),
  );
  return viva!.sessao_percepcao;
}

// ---------------------------------------------------------------------------

test('G1. sem autorização, nenhum pacote sai para o Braço', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx(ANA, 'me acompanha fazendo esse procedimento'));
  await observarTela.executar(ctx(ANA, 'você está vendo minha tela?'));
  assert.equal(enviados.length, 0, 'o Braço foi acionado sem autorização');
  assert.equal(percepcaoDeTela.ativaDe(ANA), null);
});

test('G2. o evento de OUTRO dispositivo não entra na sessão desta pessoa', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  const sessao = await sessaoDeAna();
  const antes = percepcaoDeTela.ativaDe(ANA)!.mudancas;

  /* A identidade vem da FONTE autenticada pela ponte. Um braço de outra pessoa
     mandando o id de sessão da Ana escreve no registro DELE, nunca no dela. */
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-bruno', id_usuario: BRUNO },
    evento({ sessao_percepcao: sessao }),
  );

  assert.equal(percepcaoDeTela.ativaDe(ANA)!.mudancas, antes, 'o evento alheio contou para Ana');
  assert.equal(percepcaoDeTela.de(BRUNO).length, 1, 'o evento não foi para o dono do socket');
  assert.equal(percepcaoDeTela.de(BRUNO)[0].id_dispositivo, 'disp-bruno');
});

test('G3. evento de OUTRA sessão não move a sessão viva', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  const sessao = await sessaoDeAna();
  const antes = percepcaoDeTela.ativaDe(ANA)!.mudancas;

  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-ana', id_usuario: ANA },
    evento({ sessao_percepcao: 'sp-inventada' }),
  );

  const daSessao = percepcaoDeTela.de(ANA).find((e) => e.sessao_percepcao === sessao)!;
  assert.equal(daSessao.mudancas, antes, 'um id de sessão inventado mexeu na sessão real');
});

test('G4. sessão encerrada não volta a capturar por evento nenhum', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  const sessao = await sessaoDeAna();
  percepcaoDeTela.encerrar(ANA, 'teste');

  for (const tipo of ['sessao_iniciada', 'percepcao_retomada', 'mudanca_visual'] as const) {
    percepcaoDeTela.registrar(
      { id_dispositivo: 'disp-ana', id_usuario: ANA },
      evento({
        tipo,
        sessao_percepcao: sessao,
        ...(tipo === 'mudanca_visual' ? {} : { hash: null, distancia: null }),
      }),
    );
    assert.equal(percepcaoDeTela.ativaDe(ANA), null, `"${tipo}" ressuscitou a sessão`);
  }
});

test('G5. sessão expirada para de capturar mesmo sem ninguém encerrar', () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  const t0 = Date.parse('2026-08-21T10:00:00.000Z');
  percepcaoDeTela.solicitar({
    id_usuario: ANA,
    escopo: { processos: ['gw'] },
    motivo: 'teste',
    procedimento: null,
    agora: t0,
  });
  percepcaoDeTela.autorizar(ANA, { agora: t0 });
  const sessao = percepcaoDeTela.vivaDe(ANA)!.sessao_percepcao;
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-ana', id_usuario: ANA },
    {
      ...evento({ tipo: 'sessao_iniciada', hash: null, distancia: null, sessao_percepcao: sessao }),
      instante: new Date(t0).toISOString(),
    },
  );

  percepcaoDeTela.varrer(t0 + TETO_DA_SESSAO_MS + 1);
  assert.equal(percepcaoDeTela.ativaDe(ANA), null);
  assert.equal(enviados.at(-1)!.tipo, 'percepcao_encerrar');

  /* E o Braço mandando evento depois disso não reabre. */
  percepcaoDeTela.registrar(
    { id_dispositivo: 'disp-ana', id_usuario: ANA },
    evento({ sessao_percepcao: sessao }),
  );
  assert.equal(percepcaoDeTela.ativaDe(ANA), null);
});

test('G6. pacote manipulado NÃO inicia percepção', () => {
  const manipulados = [
    { tipo: 'percepcao_iniciar' },
    { tipo: 'percepcao_iniciar', sessao_percepcao: 's', processos: '*' },
    { tipo: 'percepcao_iniciar', sessao_percepcao: 's', processos: ['../../etc'] },
    { tipo: 'percepcao_iniciar', sessao_percepcao: '', processos: ['gw'] },
    { tipo: 'percepcao_iniciar', sessao_percepcao: 's', processos: ['gw'], autorizado_em: 123 },
    { tipo: 'percepcao_INICIAR', sessao_percepcao: 's', processos: ['gw'] },
  ];
  for (const p of manipulados) {
    assert.equal(lerPacoteMotor(JSON.stringify(p)), null, `${JSON.stringify(p)} foi aceito`);
  }
});

test('G7. a percepção NÃO é um canal para executar comando', () => {
  /* Um evento visual não tem campo de ação, e a fronteira recusa chave
     desconhecida — então não há como enfiar `abrir_aplicativo` num evento. */
  for (const acao of ACOES_DESKTOP) {
    assert.equal(
      lerPacoteBraco(JSON.stringify({ tipo: 'percepcao', evento: { ...evento({}), acao } })),
      null,
      `o evento aceitou o campo de ação "${acao}"`,
    );
  }
  /* E o pacote do motor para percepção não carrega ordem nenhuma. */
  const p = lerPacoteMotor(
    JSON.stringify({
      tipo: 'percepcao_iniciar',
      sessao_percepcao: 'sp-1',
      processos: ['gw'],
      ordem: { acao: 'abrir_aplicativo' },
    }),
  );
  assert.ok(p && p.tipo === 'percepcao_iniciar');
  assert.ok(!('ordem' in p), 'a ordem embarcada atravessou junto do pedido de percepção');
});

test('G8. o operador de uma sessão não consegue encerrar a de outro', async () => {
  percepcaoDeTela.configurarEnvio(bracoFalso().envio);
  await sessaoDeAna();
  const r = percepcaoDeTela.encerrar(BRUNO, 'tentativa');
  assert.equal(r.ok, false, 'Bruno encerrou a observação de Ana');
  assert.ok(percepcaoDeTela.ativaDe(ANA), 'a sessão de Ana morreu por ordem alheia');
});

test('G9. autorizar em nome de outro não liga a câmera de ninguém', async () => {
  const { envio, enviados } = bracoFalso();
  percepcaoDeTela.configurarEnvio(envio);
  await observarTela.executar(ctx(ANA, 'olha minha tela'));

  /* Bruno diz "pode observar" — e não há pedido dele. Nada sai. */
  const r = await observarTela.executar(ctx(BRUNO, 'pode observar o gw'));
  assert.equal(r.resolveu, false);
  assert.equal(enviados.length, 0, 'a autorização de um terceiro ligou a observação');
  assert.equal(percepcaoDeTela.ativaDe(ANA), null);
});

test('G10. nenhum estado permite capturar depois de encerrado', () => {
  assert.equal(podeCapturar('encerrada'), false);
  assert.equal(podeCapturar('inativa'), false);
  assert.equal(podeCapturar('solicitada'), false);
});

test('G11. o módulo de percepção do motor não alcança execução nem procedimento', () => {
  const fonte = readFileSync(path.join(RAIZ, 'servidor', 'nucleo', 'PercepcaoDeTela.ts'), 'utf8');
  for (const proibido of [
    'ProcedimentosEmCurso',
    'GuardiaoDoProcedimento',
    'ConferenciaDeTela',
    'ExecutorDesktop',
    'AgenteLocal',
    'Braco',
  ]) {
    assert.ok(
      !new RegExp(`from\\s+['"][^'"]*${proibido}`).test(fonte),
      `PercepcaoDeTela importa ${proibido}`,
    );
  }
});

test('G12. a habilidade de percepção não move procedimento nem executa ordem', () => {
  const fonte = readFileSync(
    path.join(RAIZ, 'servidor', 'nucleo', 'kernel', 'habilidades', 'percepcao.ts'),
    'utf8',
  );
  for (const proibido of [
    'procedimentosEmCurso.mover',
    'procedimentosEmCurso.iniciar',
    'procedimentosEmCurso.registrarConferencia',
    'braco.executar',
    'classificarEvidencia',
  ]) {
    assert.ok(!fonte.includes(`${proibido}(`), `observar_tela chama ${proibido}()`);
  }
});
