/**
 * Percepção de tela — P0. O que se prova aqui, e o que deliberadamente não.
 *
 * O QUE SE PROVA: que a percepção OBSERVA e não decide. Que ela não captura sem
 * consentimento, não captura fora do escopo, não manda pixel pela rede, não
 * move ponteiro, não cria evidência e não cria conferência. Cada uma dessas é
 * uma asserção, não um comentário.
 *
 * O QUE NÃO SE PROVA AQUI: que a captura funciona no Windows. Isso é medido, não
 * afirmado — `scripts/diagnostico/calibrar-percepcao.ts` roda contra a tela de
 * verdade e imprime números. O teste marcado `[real]` abaixo é a exceção: ele
 * roda SÓ em win32 e falha se a captura em memória deixar de funcionar na
 * máquina de quem roda a suíte.
 *
 * O LAÇO É TESTADO COM TELA FALSA, e é isso que permite provar a lógica em
 * Linux: `PercepcaoLocal` recebe `janela`, `quadro`, `agora` e `emitir` por
 * parâmetro. A mesma classe que roda na máquina da operadora roda aqui, com o
 * mundo trocado por três funções.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  DISTANCIA_MINIMA_RELEVANTE,
  ESTABILIDADE_MS,
  LADO_MINIATURA,
  LINHAS_HASH,
  assinaturaDeTitulo,
  aplicarEvento,
  podeCapturar,
  dentroDoEscopo,
  distanciaDeHamming,
  hashDoQuadro,
  mudouDeJanela,
  type EventoVisual,
} from '../lib/percepcao';
import { lerEventoVisual, lerPacoteBraco, lerPacoteMotor } from '../lib/execucao';
import { PercepcaoLocal, type Consentimento } from '../servidor/braco/PercepcaoLocal';
import { CapturaDeQuadro, percepcaoIndisponivelPorque } from '../servidor/braco/CapturaDeQuadro';
import { PercepcaoDeTela } from '../servidor/nucleo/PercepcaoDeTela';

const RAIZ = path.resolve(process.cwd());
const ACEITE: Consentimento = { concedido: true, em: '2026-08-21T12:00:00.000Z', via: 'teste' };
const RECUSA: Consentimento = { concedido: false, em: '2026-08-21T12:00:00.000Z', via: 'teste' };

// ---------------------------------------------------------------------------
// Telas sintéticas — determinísticas, com distância conhecida
// ---------------------------------------------------------------------------

/** Gradiente crescente da esquerda para a direita: todo bit do dHash é 0. */
function telaCrescente(): number[] {
  const v: number[] = [];
  for (let y = 0; y < LADO_MINIATURA; y += 1) {
    for (let x = 0; x < LADO_MINIATURA; x += 1) v.push(Math.round((x / (LADO_MINIATURA - 1)) * 255));
  }
  return v;
}

/** O espelho: todo bit é 1. Distância 64 da anterior — troca de tela inteira. */
function telaDecrescente(): number[] {
  const v = telaCrescente();
  const saida: number[] = [];
  for (let y = 0; y < LADO_MINIATURA; y += 1) {
    const linha = v.slice(y * LADO_MINIATURA, (y + 1) * LADO_MINIATURA).reverse();
    saida.push(...linha);
  }
  return saida;
}

/** A mesma tela com ruído que não inverte ordem nenhuma: cursor, relógio. */
function comRuido(base: readonly number[], quanto = 1): number[] {
  return base.map((v, i) => (i % 97 === 0 ? Math.min(255, v + quanto) : v));
}

/**
 * A FAIXA DE CIMA invertida — 8 bits do dHash, abaixo do limiar de 16.
 *
 * São QUATRO linhas de origem, e não uma: o dHash reduz 32 linhas a 8 por média
 * de área, então inverter uma linha só não muda a média de bloco nenhum e a
 * distância dá zero. A primeira versão deste teste tinha uma linha, media 0, e
 * provava menos do que dizia — a granularidade real do sinal é o bloco, não o
 * pixel, e é isso que a faixa deixa explícito.
 */
function mudancaPequena(base: readonly number[]): number[] {
  const saida = [...base];
  const faixa = LADO_MINIATURA / LINHAS_HASH;
  for (let y = 0; y < faixa; y += 1) {
    const linha = saida.slice(y * LADO_MINIATURA, (y + 1) * LADO_MINIATURA).reverse();
    for (let x = 0; x < LADO_MINIATURA; x += 1) saida[y * LADO_MINIATURA + x] = linha[x];
  }
  return saida;
}

interface Registro {
  eventos: EventoVisual[];
  janelas: number;
  quadros: number;
  indicacoes: { ativa: boolean; suspensa: boolean }[];
}

function montarLaco(inicial: {
  processo: string;
  titulo?: string;
  tela: number[];
}): {
  laco: PercepcaoLocal;
  reg: Registro;
  mundo: { processo: string; titulo: string; tela: number[]; agora: number };
} {
  const mundo = {
    processo: inicial.processo,
    titulo: inicial.titulo ?? 'janela de teste',
    tela: inicial.tela,
    agora: 1_000_000,
  };
  const reg: Registro = { eventos: [], janelas: 0, quadros: 0, indicacoes: [] };

  const laco = new PercepcaoLocal({
    janela: async () => {
      reg.janelas += 1;
      return {
        handle: '0x1',
        titulo: mundo.titulo,
        processo: mundo.processo,
        largura: 800,
        altura: 600,
      };
    },
    quadro: async () => {
      reg.quadros += 1;
      return { cinza: mundo.tela, ms: 40 };
    },
    agora: () => mundo.agora,
    emitir: (e) => reg.eventos.push(e),
    indicar: (i) => reg.indicacoes.push({ ativa: i.ativa, suspensa: i.suspensa }),
  });

  return { laco, reg, mundo };
}

/** Avança o relógio e roda um tique. O laço não usa `setInterval` no teste. */
async function passar(
  laco: PercepcaoLocal,
  mundo: { agora: number },
  ms = 1_000,
): Promise<void> {
  mundo.agora += ms;
  await laco.tique();
}

// ---------------------------------------------------------------------------
// 1. Hash — perceptual, não criptográfico
// ---------------------------------------------------------------------------

test('H1. o mesmo quadro produz o mesmo hash', () => {
  const t = telaCrescente();
  assert.equal(hashDoQuadro(t), hashDoQuadro([...t]));
  assert.equal(hashDoQuadro(t).length, 16, 'o dHash de 64 bits tem 16 dígitos hex');
});

test('H2. quadro visualmente oposto produz hash distante', () => {
  const d = distanciaDeHamming(hashDoQuadro(telaCrescente()), hashDoQuadro(telaDecrescente()));
  assert.equal(d, 64, 'a inversão total deveria trocar todos os 64 bits');
  assert.ok(d >= DISTANCIA_MINIMA_RELEVANTE);
});

test('H3. ruído que não inverte ordem NÃO muda o hash', () => {
  const base = telaCrescente();
  assert.equal(
    distanciaDeHamming(hashDoQuadro(base), hashDoQuadro(comRuido(base))),
    0,
    'um hash criptográfico mudaria aqui — este não pode',
  );
});

test('H4. mudança pequena fica ABAIXO do limiar medido', () => {
  const base = telaCrescente();
  const d = distanciaDeHamming(hashDoQuadro(base), hashDoQuadro(mudancaPequena(base)));
  assert.ok(d > 0, 'a mudança pequena não foi percebida de jeito nenhum');
  assert.ok(
    d < DISTANCIA_MINIMA_RELEVANTE,
    `mudança pequena (${d}) passou do limiar (${DISTANCIA_MINIMA_RELEVANTE}) e viraria evento`,
  );
});

test('H5. hash de tamanho diferente não é comparável — e não devolve 0', () => {
  assert.ok(distanciaDeHamming('abc', 'abcd') > 64, 'comparação inválida virou "igual"');
});

// ---------------------------------------------------------------------------
// 2. Consentimento — sem "sim", não observa
// ---------------------------------------------------------------------------

test('C1. SEM consentimento o laço não liga e NÃO chama a captura', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  assert.equal(laco.iniciar('s1', { processos: ['gw'] }, RECUSA), false);
  await passar(laco, mundo);
  assert.equal(reg.janelas, 0, 'leu metadado de janela sem consentimento');
  assert.equal(reg.quadros, 0, 'CAPTUROU A TELA sem consentimento');
  assert.equal(reg.eventos.length, 0);
});

test('C2. escopo vazio não liga, mesmo com consentimento', async () => {
  const { laco, reg } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  assert.equal(laco.iniciar('s1', { processos: [] }, ACEITE), false);
  assert.equal(reg.quadros, 0);
});

test('C3. com consentimento liga, anuncia e captura', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  assert.equal(laco.iniciar('s1', { processos: ['gw'] }, ACEITE), true);
  assert.equal(reg.eventos[0].tipo, 'sessao_iniciada');
  await passar(laco, mundo);
  assert.equal(reg.quadros, 1);
  laco.encerrar('fim do teste');
  assert.equal(reg.eventos.at(-1)!.tipo, 'sessao_encerrada');
});

test('C4. sessão encerrada PARA de capturar', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  const antes = reg.quadros;
  laco.encerrar('operador pediu');
  await passar(laco, mundo);
  await passar(laco, mundo);
  assert.equal(reg.quadros, antes, 'continuou capturando depois de encerrada');
});

// ---------------------------------------------------------------------------
// 3. Escopo por janela — o requisito bloqueante
// ---------------------------------------------------------------------------

test('E1. escopo é fechado por padrão: lista vazia recusa tudo', () => {
  assert.equal(dentroDoEscopo('gw', { processos: [] }), false);
  assert.equal(dentroDoEscopo('gw', { processos: ['gw'] }), true);
  assert.equal(dentroDoEscopo('GW', { processos: ['gw'] }), true);
  assert.equal(dentroDoEscopo('chrome', { processos: ['gw'] }), false);
});

test('E2. janela fora do escopo SUSPENDE e nunca lê pixel dela', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  const quadrosAutorizados = reg.quadros;

  mundo.processo = 'whatsapp';
  await passar(laco, mundo);

  assert.equal(
    reg.quadros,
    quadrosAutorizados,
    'CAPTUROU A TELA de uma aplicação fora do escopo autorizado',
  );
  assert.equal(reg.eventos.at(-1)!.tipo, 'percepcao_suspensa');
  assert.match(reg.eventos.at(-1)!.motivo, /fora do escopo/i);
  assert.equal(reg.eventos.at(-1)!.janela, null, 'o evento de suspensão nomeou a janela alheia');
});

test('E3. voltar à janela autorizada RETOMA', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  mundo.processo = 'chrome';
  await passar(laco, mundo);
  mundo.processo = 'gw';
  await passar(laco, mundo);

  const tipos = reg.eventos.map((e) => e.tipo);
  assert.deepEqual(tipos.slice(-2), ['percepcao_suspensa', 'percepcao_retomada']);
});

test('E4. suspensão repetida não vira enxurrada de eventos', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  mundo.processo = 'chrome';
  for (let i = 0; i < 10; i += 1) await passar(laco, mundo);
  const suspensoes = reg.eventos.filter((e) => e.tipo === 'percepcao_suspensa');
  assert.equal(suspensoes.length, 1, 'dez tiques fora do escopo produziram dez avisos');
});

// ---------------------------------------------------------------------------
// 4. Detecção de mudança — estabilidade antes de anunciar
// ---------------------------------------------------------------------------

test('M1. tela parada NÃO produz evento nenhum', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  for (let i = 0; i < 10; i += 1) {
    mundo.tela = comRuido(telaCrescente(), (i % 3) + 1);
    await passar(laco, mundo);
  }
  assert.equal(
    reg.eventos.filter((e) => e.tipo === 'mudanca_visual').length,
    0,
    'ruído virou mudança — a IARA falaria sozinha',
  );
});

test('M2. mudança relevante SÓ vira evento depois de estabilizar', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  mundo.tela = telaDecrescente();
  await passar(laco, mundo);
  assert.equal(
    reg.eventos.filter((e) => e.tipo === 'mudanca_visual').length,
    0,
    'anunciou no primeiro quadro da transição, sem esperar estabilizar',
  );

  await passar(laco, mundo, ESTABILIDADE_MS);
  const mudancas = reg.eventos.filter((e) => e.tipo === 'mudanca_visual');
  assert.equal(mudancas.length, 1);
  assert.equal(mudancas[0].hash, hashDoQuadro(telaDecrescente()));
  assert.equal(mudancas[0].distancia, 64);
  assert.equal(mudancas[0].origem, 'hash_de_quadro');
});

test('M3. transição contínua produz UM evento, não cinco', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  /* Cada quadro da transição é diferente do anterior: é o que acontece
     enquanto uma tela carrega. Nenhum deles pode virar evento. */
  for (let i = 0; i < 4; i += 1) {
    const t = telaCrescente();
    for (let k = 0; k < (i + 1) * 200; k += 1) t[k] = 255 - t[k];
    mundo.tela = t;
    await passar(laco, mundo);
  }
  mundo.tela = telaDecrescente();
  await passar(laco, mundo);
  await passar(laco, mundo, ESTABILIDADE_MS);

  assert.equal(
    reg.eventos.filter((e) => e.tipo === 'mudanca_visual').length,
    1,
    'uma navegação produziu mais de um evento',
  );
});

test('M4. mudança pequena e persistente continua NÃO sendo evento', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  mundo.tela = mudancaPequena(telaCrescente());
  for (let i = 0; i < 6; i += 1) await passar(laco, mundo, ESTABILIDADE_MS);
  assert.equal(reg.eventos.filter((e) => e.tipo === 'mudanca_visual').length, 0);
});

test('M5. troca de janela é sinal SEM limiar — mesmo com tela parecida', async () => {
  const { laco, reg, mundo } = montarLaco({
    processo: 'gw',
    titulo: 'consulta de coleta',
    tela: telaCrescente(),
  });
  laco.iniciar('s1', { processos: ['gw', 'gw2'] }, ACEITE);
  await passar(laco, mundo);

  /* Mesma imagem, outro título: a distância de Hamming é 0 e mesmo assim houve
     navegação. É o caso que o segundo sinal existe para pegar. */
  mundo.titulo = 'emissao de ct-e';
  await passar(laco, mundo);
  await passar(laco, mundo, ESTABILIDADE_MS);

  const mudancas = reg.eventos.filter((e) => e.tipo === 'mudanca_visual');
  assert.equal(mudancas.length, 1, 'a troca de janela não foi percebida');
  assert.equal(mudancas[0].distancia, 0, 'a distância deveria ser 0: a imagem é a mesma');
});

test('M6. o primeiro quadro da sessão é referência, não mudança', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  assert.equal(reg.eventos.filter((e) => e.tipo === 'mudanca_visual').length, 0);
});

// ---------------------------------------------------------------------------
// 5. Máscara e indicador
// ---------------------------------------------------------------------------

test('P1. o título da janela é MASCARADO antes de virar evento', async () => {
  const { laco, reg, mundo } = montarLaco({
    processo: 'gw',
    titulo: 'CT-e 35240912345678000199 - motorista JOSÉ - daiane@atoslog.com.br',
    tela: telaCrescente(),
  });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  mundo.tela = telaDecrescente();
  await passar(laco, mundo);
  await passar(laco, mundo, ESTABILIDADE_MS);

  const evento = reg.eventos.find((e) => e.tipo === 'mudanca_visual')!;
  const assinatura = evento.janela!.assinatura;
  assert.doesNotMatch(assinatura, /\d{6,}/, 'número longo sobreviveu à máscara');
  assert.doesNotMatch(assinatura, /@/, 'e-mail sobreviveu à máscara');
  assert.ok(assinatura.length <= 60, 'a assinatura passou do teto');
});

test('P2. a máscara não é chamada por engano no título cru', () => {
  assert.equal(assinaturaDeTitulo('CT-e 12345 - José'), 'ct-e n - jose');
  assert.equal(assinaturaDeTitulo('a@b.com'), 'n');
});

test('P3. o indicador é obrigatório e acompanha cada transição', async () => {
  const { laco, reg, mundo } = montarLaco({ processo: 'gw', tela: telaCrescente() });
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  assert.deepEqual(reg.indicacoes[0], { ativa: true, suspensa: false });
  mundo.processo = 'chrome';
  await passar(laco, mundo);
  assert.deepEqual(reg.indicacoes.at(-1), { ativa: true, suspensa: true });
  laco.encerrar('fim');
  assert.deepEqual(reg.indicacoes.at(-1), { ativa: false, suspensa: false });
});

// ---------------------------------------------------------------------------
// 6. Protocolo — enum fechado e recusa de quadro
// ---------------------------------------------------------------------------

const EVENTO_VALIDO: EventoVisual = {
  tipo: 'mudanca_visual',
  sessao_percepcao: 'sp-1',
  instante: '2026-08-21T12:00:00.000Z',
  janela: { processo: 'gw', assinatura: 'consulta de coleta', largura: 800, altura: 600 },
  hash: '0123456789abcdef',
  distancia: 20,
  origem: 'hash_de_quadro',
  motivo: '',
  texto: '',
};

test('T1. evento válido atravessa a fronteira inteiro', () => {
  const p = lerPacoteBraco(JSON.stringify({ tipo: 'percepcao', evento: EVENTO_VALIDO }));
  assert.ok(p && p.tipo === 'percepcao');
  assert.deepEqual(p.evento, EVENTO_VALIDO);
});

test('T2. tipo de evento fora do enum é RECUSADO', () => {
  for (const tipo of ['screenshot', 'frame', 'mudanca', '', 'MUDANCA_VISUAL']) {
    assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, tipo }), null, `"${tipo}" passou`);
  }
});

test('T3. QUADRO NO EVENTO É RECUSADO — em qualquer nome de campo', () => {
  const contrabandos = [
    { png: 'iVBORw0KGgo=' },
    { base64: 'AAAA' },
    { imagem: 'data:image/png;base64,AAAA' },
    { screenshot: [1, 2, 3] },
    { buffer: { type: 'Buffer', data: [1, 2, 3] } },
    { cinza: [0, 1, 2] },
    { quadro: 'AAAA' },
  ];
  for (const extra of contrabandos) {
    const bruto = { ...EVENTO_VALIDO, ...extra };
    assert.equal(
      lerEventoVisual(bruto),
      null,
      `campo ${Object.keys(extra)[0]} atravessou a fronteira`,
    );
    assert.equal(
      lerPacoteBraco(JSON.stringify({ tipo: 'percepcao', evento: bruto })),
      null,
      `pacote com ${Object.keys(extra)[0]} foi aceito`,
    );
  }
});

test('T4. payload inválido é recusado campo a campo', () => {
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, hash: 'nao-e-hex' }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, hash: 'abc' }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, distancia: 999 }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, distancia: -1 }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, origem: 'llm' }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, sessao_percepcao: '' }), null);
  assert.equal(lerEventoVisual({ ...EVENTO_VALIDO, janela: { processo: 'gw' } }), null);
  assert.equal(
    lerEventoVisual({ ...EVENTO_VALIDO, janela: { ...EVENTO_VALIDO.janela, extra: 1 } }),
    null,
  );
});

test('T5. evento de ciclo de vida NÃO pode carregar hash', () => {
  assert.equal(
    lerEventoVisual({ ...EVENTO_VALIDO, tipo: 'sessao_encerrada' }),
    null,
    'um encerramento carregando hash da tela foi aceito',
  );
  assert.ok(
    lerEventoVisual({
      ...EVENTO_VALIDO,
      tipo: 'sessao_encerrada',
      hash: null,
      distancia: null,
      janela: null,
      motivo: 'operador encerrou',
    }),
  );
});

test('T6. o pedido do motor tem escopo fechado e recusa curinga', () => {
  assert.ok(
    lerPacoteMotor(
      JSON.stringify({ tipo: 'percepcao_iniciar', sessao_percepcao: 'sp-1', processos: ['gw'] }),
    ),
  );
  for (const processos of [[], ['*'], ['c:\\gw.exe'], ['a b'], new Array(9).fill('gw')]) {
    assert.equal(
      lerPacoteMotor(JSON.stringify({ tipo: 'percepcao_iniciar', sessao_percepcao: 's', processos })),
      null,
      `escopo ${JSON.stringify(processos)} foi aceito`,
    );
  }
});

// ---------------------------------------------------------------------------
// 7. Estado visual — redutor puro
// ---------------------------------------------------------------------------

test('V1. o estado é derivado da sequência de eventos, e conta mudanças', () => {
  const id = { id_dispositivo: 'd1', id_usuario: 'daiane' };
  let estado = aplicarEvento(null, { ...EVENTO_VALIDO, tipo: 'sessao_iniciada', hash: null, distancia: null, janela: null, motivo: 'aceite' }, id);
  assert.equal(estado.estado, 'ativa');
  assert.equal(estado.mudancas, 0);

  estado = aplicarEvento(estado, EVENTO_VALIDO, id);
  assert.equal(estado.mudancas, 1);
  assert.equal(estado.hash, EVENTO_VALIDO.hash);

  estado = aplicarEvento(estado, { ...EVENTO_VALIDO, tipo: 'percepcao_suspensa', hash: null, distancia: null, janela: null, motivo: 'fora do escopo' }, id);
  assert.equal(estado.estado, 'suspensa');
  assert.ok(podeCapturar(estado.estado), 'suspensa deixou de poder capturar');

  estado = aplicarEvento(estado, { ...EVENTO_VALIDO, tipo: 'sessao_encerrada', hash: null, distancia: null, janela: null, motivo: 'fim' }, id);
  assert.equal(estado.estado, 'encerrada');
});

test('V2. o estado NÃO afirma qual tela é — o P0 não identifica nada', () => {
  const id = { id_dispositivo: 'd1', id_usuario: 'daiane' };
  const estado = aplicarEvento(null, EVENTO_VALIDO, id);
  for (const proibido of ['tela', 'tela_identificada', 'elementos', 'campos', 'confianca']) {
    assert.ok(!(proibido in estado), `EstadoVisual declarou "${proibido}" sem ter como preencher`);
  }
});

test('V3. a identidade vem da FONTE, nunca do pacote', () => {
  const p = new PercepcaoDeTela();
  const estado = p.registrar({ id_dispositivo: 'd1', id_usuario: 'daiane' }, EVENTO_VALIDO);
  assert.equal(estado.id_usuario, 'daiane');
  p.registrar({ id_dispositivo: 'd2', id_usuario: 'outro' }, EVENTO_VALIDO);
  assert.equal(p.de('daiane').length, 1, 'o evento de um operador apareceu no outro');
  assert.equal(p.de('outro').length, 1);
});

test('V4. `mudouDeJanela` só fala quando há referência anterior', () => {
  const j = { processo: 'gw', assinatura: 'a', largura: 1, altura: 1 };
  assert.equal(mudouDeJanela(null, j), false, 'inventou mudança no primeiro quadro');
  assert.equal(mudouDeJanela(j, { ...j, assinatura: 'b' }), true);
  assert.equal(mudouDeJanela(j, { ...j, largura: 999 }), false, 'redimensionar não é navegar');
});

// ---------------------------------------------------------------------------
// 8. Segurança — a percepção não alcança o procedimento
// ---------------------------------------------------------------------------

const MODULOS_DE_PERCEPCAO = [
  path.join(RAIZ, 'lib', 'percepcao.ts'),
  path.join(RAIZ, 'servidor', 'braco', 'CapturaDeQuadro.ts'),
  path.join(RAIZ, 'servidor', 'braco', 'PercepcaoLocal.ts'),
  path.join(RAIZ, 'servidor', 'nucleo', 'PercepcaoDeTela.ts'),
];

test('S1. a percepção NÃO importa procedimento, guardião nem conferência', () => {
  const proibidos = [
    'ProcedimentosEmCurso',
    'GuardiaoDoProcedimento',
    'ConferenciaDeTela',
    'AnaliseVisual',
    'AgenteLocal',
    'habilidades/',
  ];
  for (const arquivo of MODULOS_DE_PERCEPCAO) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const alvo of proibidos) {
      assert.ok(
        !new RegExp(`from\\s+['"][^'"]*${alvo.replace('/', '\\/')}`).test(fonte),
        `${path.basename(arquivo)} importa ${alvo} — a percepção alcançou a camada operacional`,
      );
    }
  }
});

test('S2. a percepção NÃO chama nada que mova o procedimento', () => {
  const proibidos = [
    'procedimentosEmCurso.',
    'avancar_procedimento',
    'registrarConferencia',
    'classificarEvidencia',
    'podeAvancar',
  ];
  for (const arquivo of MODULOS_DE_PERCEPCAO) {
    const fonte = readFileSync(arquivo, 'utf8');
    for (const alvo of proibidos) {
      assert.ok(!fonte.includes(`${alvo}(`), `${path.basename(arquivo)} chama ${alvo}`);
    }
  }
});

test('S3. nenhum módulo de percepção grava arquivo', () => {
  /* `CapturaDeQuadro` abre `node:child_process` — é o helper. O que ele não
     pode é abrir `node:fs`: a captura em memória existe justamente para não
     produzir arquivo, e um `import` de fs aqui seria o primeiro passo de volta
     ao PNG em Documentos. */
  for (const arquivo of MODULOS_DE_PERCEPCAO) {
    const fonte = readFileSync(arquivo, 'utf8');
    assert.ok(
      !/from\s+['"]node:fs/.test(fonte),
      `${path.basename(arquivo)} abriu node:fs — percepção não grava arquivo`,
    );
    for (const escrita of ['writeFile', 'writeFileSync', 'createWriteStream', 'appendFile']) {
      assert.ok(!fonte.includes(escrita), `${path.basename(arquivo)} usa ${escrita}`);
    }
  }
});

test('S4. o helper de captura não salva imagem EM ARQUIVO', () => {
  const fonte = readFileSync(path.join(RAIZ, 'servidor', 'braco', 'CapturaDeQuadro.ts'), 'utf8');

  /**
   * A ASSERÇÃO MUDOU quando o OCR entrou, e a mudança merece registro.
   *
   * A versão anterior proibia `.Save(` e `ImageFormat` — o que funcionava
   * enquanto o helper só reduzia quadros. O OCR precisa serializar o bitmap
   * para um `MemoryStream` antes de entregá-lo ao motor do Windows, e a
   * proibição por nome de método teria forçado ou a burlar o teste ou a
   * abandonar o OCR local.
   *
   * O que importa nunca foi o método: é o DESTINO. Salvar em memória e
   * descartar não é gravar; gravar é ter um caminho. Então a proibição passou a
   * ser de caminho — literal ou por API de arquivo —, que é a coisa que este
   * teste sempre quis dizer.
   */
  assert.ok(
    !/\.Save\(\s*['"]/.test(fonte),
    'o helper salva imagem num caminho literal — isso é gravar arquivo',
  );
  for (const proibido of [
    '[System.IO.File]',
    'Out-File',
    'Set-Content',
    'Add-Content',
    'New-Item',
    'System.IO.FileStream',
  ]) {
    assert.ok(!fonte.includes(proibido), `o helper usa ${proibido} — caminho para o disco`);
  }
  assert.ok(
    fonte.includes('System.IO.MemoryStream'),
    'o helper deixou de serializar em memória: confira para onde o bitmap está indo',
  );
  assert.ok(
    fonte.includes('LADO_MINIATURA'),
    'o helper deixou de reduzir o quadro antes de devolvê-lo',
  );
});

// ---------------------------------------------------------------------------
// 9. [real] captura de verdade — só em Windows
// ---------------------------------------------------------------------------

test('R1. [real] a captura em memória funciona nesta máquina', async (t) => {
  const indisponivel = percepcaoIndisponivelPorque();
  if (indisponivel) {
    t.skip(`sem tela do Windows: ${indisponivel}`);
    return;
  }

  const captura = new CapturaDeQuadro();
  try {
    captura.iniciar();

    /**
     * TENTA ALGUMAS VEZES, e a razão é o próprio mecanismo sendo provado.
     *
     * `quadro()` recusa quando o foco mudou entre o metadado e a captura — é a
     * trava de escopo do lado do helper. Rodando a suíte inteira, o Windows
     * troca a janela em foco sozinho (processos do runner subindo), e a recusa
     * acontece de verdade. A primeira versão deste teste falhava aí e culpava a
     * captura por uma trava que estava funcionando.
     */
    let quadro = null as Awaited<ReturnType<CapturaDeQuadro['quadro']>>;
    let handle = '';
    for (let tentativa = 0; tentativa < 5 && !quadro; tentativa += 1) {
      const janela = await captura.janela();
      assert.ok(janela, 'nenhuma janela em foco');
      assert.ok(janela!.processo.length > 0, 'janela em foco sem processo');
      handle = janela!.handle;
      quadro = await captura.quadro(handle);
    }

    if (!quadro) {
      /* Cinco tentativas e o foco mudou nas cinco. Não é defeito da captura — é
         a área de trabalho se mexendo. Dizer isso é mais honesto que falhar
         acusando o módulo errado, e mais honesto que passar em silêncio. */
      t.skip('o foco mudou nas 5 tentativas: a trava recusou capturar, sem quadro para conferir');
      return;
    }

    assert.equal(
      quadro.cinza.length,
      LADO_MINIATURA * LADO_MINIATURA,
      'a matriz não tem o tamanho declarado',
    );
    assert.ok(quadro.cinza.every((v) => v >= 0 && v <= 255));
    assert.equal(hashDoQuadro(quadro.cinza).length, 16);

    /* HANDLE ERRADO NÃO CAPTURA. É a trava de escopo do lado do helper: pedir o
       quadro de uma janela que não está em foco não lê pixel nenhum. */
    assert.equal(await captura.quadro('0xdeadbeef'), null);
  } finally {
    captura.encerrar();
  }
});
