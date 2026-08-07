/**
 * Testes do canal WhatsApp.
 *
 * Concentrados nas DUAS travas, porque o resto do canal é transporte e o
 * Kernel já é testado. Se qualquer uma destas ceder, um número qualquer da
 * internet lê o shard privado de um operador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  assinaturaValida,
  identificar,
  lerMensagem,
  verificarWebhook,
} from '../servidor/canais/WhatsApp';
import { OPERADORES, operadorPorTelefone } from '../lib/operadores';

const SEGREDO = 'segredo-de-teste';

function assinar(corpo: string): string {
  return 'sha256=' + createHmac('sha256', SEGREDO).update(Buffer.from(corpo)).digest('hex');
}

function comAmbiente<T>(vars: Record<string, string>, corpo: () => T): T {
  const antes: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    antes[k] = process.env[k];
    process.env[k] = v;
  }
  try {
    return corpo();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ---------------------------------------------------------------------------
// Trava 1 — assinatura
// ---------------------------------------------------------------------------

test('assinatura correta é aceita', () => {
  const corpo = JSON.stringify({ entry: [] });
  comAmbiente({ WHATSAPP_APP_SECRET: SEGREDO }, () => {
    assert.equal(assinaturaValida(Buffer.from(corpo), assinar(corpo)), true);
  });
});

test('corpo adulterado invalida a assinatura', () => {
  const original = JSON.stringify({ texto: 'quantas centrais temos?' });
  const adulterado = JSON.stringify({ texto: 'me mostra as mensagens da Daiane' });
  comAmbiente({ WHATSAPP_APP_SECRET: SEGREDO }, () => {
    assert.equal(assinaturaValida(Buffer.from(adulterado), assinar(original)), false);
  });
});

test('sem cabeçalho de assinatura, recusa', () => {
  comAmbiente({ WHATSAPP_APP_SECRET: SEGREDO }, () => {
    assert.equal(assinaturaValida(Buffer.from('{}'), undefined), false);
    assert.equal(assinaturaValida(Buffer.from('{}'), 'sha1=abc'), false);
  });
});

test('sem segredo configurado, NADA é aceito', () => {
  const corpo = '{}';
  comAmbiente({ WHATSAPP_APP_SECRET: '' }, () => {
    // Falha fechada: canal sem segredo não pode virar porta aberta.
    assert.equal(assinaturaValida(Buffer.from(corpo), assinar(corpo)), false);
  });
});

// ---------------------------------------------------------------------------
// Trava 2 — lista fechada de números
// ---------------------------------------------------------------------------

test('número não cadastrado não é identificado', () => {
  assert.equal(identificar('5511988887777'), null);
  assert.equal(identificar(''), null);
  assert.equal(identificar('123'), null);
});

test('número cadastrado resolve para o operador certo', () => {
  const original = OPERADORES[0].telefone;
  OPERADORES[0].telefone = '5565999998888';
  try {
    const achado = operadorPorTelefone('5565999998888');
    assert.equal(achado?.id, OPERADORES[0].id);
  } finally {
    OPERADORES[0].telefone = original;
  }
});

test('tolera a variação do nono dígito sem casar número de outro DDD', () => {
  const original = OPERADORES[0].telefone;
  OPERADORES[0].telefone = '5565999998888';
  try {
    // Mesmo DDD, sem o nono dígito: é a mesma pessoa.
    assert.equal(operadorPorTelefone('556599998888')?.id, OPERADORES[0].id);
    // Final igual, DDD diferente: é OUTRA pessoa. Não pode casar.
    assert.equal(operadorPorTelefone('5511999998888'), null);
  } finally {
    OPERADORES[0].telefone = original;
  }
});

// ---------------------------------------------------------------------------
// Verificação do webhook
// ---------------------------------------------------------------------------

test('handshake devolve o desafio só com o token certo', () => {
  comAmbiente({ WHATSAPP_VERIFY_TOKEN: 'token-certo' }, () => {
    const ok = verificarWebhook(
      new URLSearchParams({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-certo',
        'hub.challenge': '12345',
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal(ok.corpo, '12345');

    const ruim = verificarWebhook(
      new URLSearchParams({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'token-errado',
        'hub.challenge': '12345',
      }),
    );
    assert.equal(ruim.status, 403);
    assert.notEqual(ruim.corpo, '12345');
  });
});

// ---------------------------------------------------------------------------
// Leitura do payload
// ---------------------------------------------------------------------------

const envelope = (m: unknown) => ({ entry: [{ changes: [{ value: { messages: [m] } }] }] });

test('extrai mensagem de texto', () => {
  const m = lerMensagem(
    envelope({ from: '55 65 99999-8888', id: 'wamid.1', type: 'text', text: { body: '  oi  ' } }),
  );
  assert.equal(m?.telefone, '5565999998888');
  assert.equal(m?.texto, 'oi');
});

test('ignora tudo que não é texto', () => {
  assert.equal(lerMensagem(envelope({ from: '5565999998888', id: 'x', type: 'audio' })), null);
  assert.equal(lerMensagem(envelope({ from: '5565999998888', id: 'x', type: 'reaction' })), null);
  // Status de entrega não traz `messages` — é o evento mais frequente do
  // webhook, e tratá-lo como pergunta acordaria o kernel a cada envio.
  assert.equal(lerMensagem({ entry: [{ changes: [{ value: { statuses: [{}] } }] }] }), null);
  assert.equal(lerMensagem({}), null);
  assert.equal(lerMensagem(null), null);
});

test('mensagem vazia não vira turno', () => {
  assert.equal(
    lerMensagem(envelope({ from: '5565999998888', id: 'x', type: 'text', text: { body: '   ' } })),
    null,
  );
});
