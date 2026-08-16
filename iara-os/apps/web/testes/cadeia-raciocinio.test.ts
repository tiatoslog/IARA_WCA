/**
 * A CADEIA DE RACIOCÍNIO — o que impede a IARA de ficar muda quando um cérebro
 * para de responder.
 *
 * A pergunta desta suíte: **uma cota que acaba pode calar a IARA inteira?**
 *
 * Ela nasceu de um incidente real (15/08/2026): a conta da Anthropic zerou, a
 * chave continuou no ambiente, e todo turno morria com "tente de novo" — um
 * conselho impossível de seguir. Os casos abaixo são as formas conhecidas de
 * um encadeamento de provedores falhar:
 *
 *  · não trocar quando devia (a cota acaba e ninguém assume);
 *  · trocar quando NÃO devia (texto já entregue → fala duplicada; operador
 *    cancelou → gasta a cota do próximo à toa);
 *  · mascarar o erro final (todos falham e sobe uma mensagem genérica que não
 *    diz o que aconteceu);
 *  · mentir na telemetria (a tela diz "nuvem" enquanto responde o local).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { CadeiaDeRaciocinio, mereceOutroProvedor } from '../servidor/nucleo/CadeiaDeRaciocinio';
import { interpretarLinhaOpenAI } from '../servidor/nucleo/ClienteCompativelOpenAI';
import {
  ProvedorIndisponivel,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from '../servidor/nucleo/ProvedorRaciocinio';

// ---------------------------------------------------------------------------
// UN-201..204 — a leitura do stream (pura, sem rede)
// ---------------------------------------------------------------------------

test('linha SSE com conteúdo vira pedaço de texto', () => {
  const lida = interpretarLinhaOpenAI('data: {"choices":[{"delta":{"content":"oi"}}]}');
  assert.equal(lida?.pedaco, 'oi');
});

test('linha vazia, comentário de keep-alive, JSON inválido e [DONE] não matam o stream', () => {
  assert.equal(interpretarLinhaOpenAI(''), null);
  assert.equal(interpretarLinhaOpenAI('   '), null);
  assert.equal(interpretarLinhaOpenAI(': ping'), null);
  assert.equal(interpretarLinhaOpenAI('data: {isso não é json'), null);
  assert.equal(interpretarLinhaOpenAI('data: [DONE]')?.fim, true);
});

test('bloco usage vira contagem de tokens honesta', () => {
  const lida = interpretarLinhaOpenAI(
    'data: {"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":45}}',
  );
  assert.deepEqual(lida?.final, { tokens_entrada: 120, tokens_saida: 45 });
});

test('erro do provedor é extraído legível, nos dois formatos', () => {
  assert.equal(
    interpretarLinhaOpenAI('data: {"error":{"message":"rate limit reached"}}')?.erro,
    'rate limit reached',
  );
  assert.equal(interpretarLinhaOpenAI('data: {"error":"quota exceeded"}')?.erro, 'quota exceeded');
});

// ---------------------------------------------------------------------------
// UN-209/210 — quando trocar de cérebro
// ---------------------------------------------------------------------------

test('cota, crédito, limite de taxa, chave inválida e serviço fora merecem outro provedor', () => {
  const casos = [
    'Your credit balance is too low to access the Anthropic API',
    'rate_limit_error: too many requests',
    'HTTP 429',
    'invalid api key',
    '401 unauthorized',
    'quota exceeded for this project',
    'groq respondeu 503: service unavailable',
    'fetch failed',
    'connect ECONNREFUSED 127.0.0.1:11434',
  ];
  for (const caso of casos) {
    assert.equal(mereceOutroProvedor(new Error(caso)), true, `deveria trocar: ${caso}`);
  }
  assert.equal(mereceOutroProvedor(new ProvedorIndisponivel('sem chave')), true);
});

test('cancelamento do operador NUNCA vira troca de provedor', () => {
  const abortado = new AbortController();
  abortado.abort();
  assert.equal(mereceOutroProvedor(new Error('rate limit'), abortado.signal), false);

  const erroAbort = new Error('The operation was aborted');
  erroAbort.name = 'AbortError';
  assert.equal(mereceOutroProvedor(erroAbort), false);
});

test('erro de lógica (bug nosso) não vira troca — falha honesta, não roleta', () => {
  assert.equal(mereceOutroProvedor(new TypeError('x.map is not a function')), false);
});

// ---------------------------------------------------------------------------
// A cadeia
// ---------------------------------------------------------------------------

function pedido(sobre: Partial<PedidoRaciocinio> = {}): PedidoRaciocinio {
  return {
    mensagem: 'oi',
    historico: [],
    overridePersona: '',
    camadaGlobal: '',
    sinal: new AbortController().signal,
    aoReceberTexto: () => undefined,
    ...sobre,
  };
}

class EloFalso implements ProvedorRaciocinio {
  chamadas = 0;
  constructor(
    readonly origem: 'nuvem' | 'local',
    readonly modelo: string,
    readonly disponivel: boolean,
    private readonly comportamento: (p: PedidoRaciocinio) => Promise<RespostaRaciocinio>,
  ) {}
  raciocinar(p: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    this.chamadas += 1;
    return this.comportamento(p);
  }
}

const respostaDe = (texto: string): RespostaRaciocinio => ({
  texto,
  tokens_entrada: 1,
  tokens_saida: 1,
  cache_lido: 0,
  recusado: false,
});

test('cota acabou no primeiro: o segundo assume e o operador nem percebe', async () => {
  const morto = new EloFalso('nuvem', 'claude-opus-5', true, () =>
    Promise.reject(new Error('Your credit balance is too low')),
  );
  const vivo = new EloFalso('nuvem', 'llama-3.3-70b-versatile', true, () =>
    Promise.resolve(respostaDe('respondi eu')),
  );

  const cadeia = new CadeiaDeRaciocinio([morto, vivo]);
  const r = await cadeia.raciocinar(pedido());

  assert.equal(r.texto, 'respondi eu');
  assert.equal(morto.chamadas, 1);
  assert.equal(vivo.chamadas, 1);
  // A telemetria segue quem respondeu, não quem foi tentado primeiro.
  assert.equal(cadeia.modelo, 'llama-3.3-70b-versatile');
});

test('texto JÁ entregue fecha a porta da troca — nada de fala duplicada', async () => {
  const meioCaminho = new EloFalso('nuvem', 'a', true, async (p) => {
    p.aoReceberTexto('metade da frase');
    throw new Error('rate limit');
  });
  const reserva = new EloFalso('nuvem', 'b', true, () => Promise.resolve(respostaDe('frase inteira')));

  const cadeia = new CadeiaDeRaciocinio([meioCaminho, reserva]);
  const recebido: string[] = [];

  await assert.rejects(
    () => cadeia.raciocinar(pedido({ aoReceberTexto: (t) => recebido.push(t) })),
    /rate limit/,
  );
  assert.equal(reserva.chamadas, 0, 'o segundo elo NÃO pode ser chamado depois de texto entregue');
  assert.deepEqual(recebido, ['metade da frase']);
});

test('todos falharam: sobe o erro do ÚLTIMO, sem mascarar', async () => {
  const a = new EloFalso('nuvem', 'a', true, () => Promise.reject(new Error('429 na primeira')));
  const b = new EloFalso('nuvem', 'b', true, () =>
    Promise.reject(new ProvedorIndisponivel('gemini: quota diária esgotada')),
  );

  const cadeia = new CadeiaDeRaciocinio([a, b]);
  await assert.rejects(() => cadeia.raciocinar(pedido()), /quota diária esgotada/);
});

test('disponivel é verdadeiro se ALGUM elo está — um secundário sem chave não desliga a rota', () => {
  const semChave = new EloFalso('nuvem', 'a', false, () => Promise.resolve(respostaDe('')));
  const comChave = new EloFalso('nuvem', 'b', true, () => Promise.resolve(respostaDe('')));

  assert.equal(new CadeiaDeRaciocinio([semChave, comChave]).disponivel, true);
  assert.equal(new CadeiaDeRaciocinio([semChave]).disponivel, false);
});

test('elo indisponível é pulado antes de tentar', async () => {
  const semChave = new EloFalso('nuvem', 'a', false, () => Promise.reject(new Error('não deveria')));
  const bom = new EloFalso('local', 'llama3.2:3b', true, () => Promise.resolve(respostaDe('local aqui')));

  const cadeia = new CadeiaDeRaciocinio([semChave, bom]);
  const r = await cadeia.raciocinar(pedido());

  assert.equal(r.texto, 'local aqui');
  assert.equal(semChave.chamadas, 0);
  assert.equal(cadeia.origem, 'local', 'a origem tem de acompanhar quem respondeu');
});

test('cadeia vazia é erro de programação, não estado válido', () => {
  assert.throws(() => new CadeiaDeRaciocinio([]), /vazia/);
});
