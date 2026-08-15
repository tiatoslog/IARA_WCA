/**
 * ClienteOllama — parser puro, sonda e o caminho de wire contra um servidor
 * HTTP REAL em socket local.
 *
 * O stub aqui não é mock de função: é um `node:http` de verdade servindo o
 * contrato documentado do Ollama (`/api/tags`, `/api/chat` com JSON por
 * linha). O que ele NÃO prova é o binário Ollama real — essa lacuna está
 * declarada no test plan (E2E-004) e no relatório de evidência, nunca
 * escondida atrás destes verdes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { ClienteOllama, interpretarLinhaOllama } from '../servidor/nucleo/ClienteOllama';
import { ProvedorIndisponivel, type PedidoRaciocinio } from '../servidor/nucleo/ProvedorRaciocinio';

// ---------------------------------------------------------------------------
// Infra: ambiente e stub
// ---------------------------------------------------------------------------

async function comAmbiente<T>(
  vars: Record<string, string | undefined>,
  corpo: () => Promise<T>,
): Promise<T> {
  const anteriores = new Map<string, string | undefined>();
  for (const [nome, valor] of Object.entries(vars)) {
    anteriores.set(nome, process.env[nome]);
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  try {
    return await corpo();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
}

interface Stub {
  url: string;
  contagemChat: () => number;
  fechar: () => Promise<void>;
}

function stubOllama(
  aoChat: (res: http.ServerResponse, chamada: number) => void,
): Promise<Stub> {
  let chamadas = 0;
  const servidor = http.createServer((req, res) => {
    if (req.url === '/api/tags') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ models: [{ name: 'modelo-teste' }] }));
      return;
    }
    if (req.url === '/api/chat') {
      chamadas += 1;
      aoChat(res, chamadas);
      return;
    }
    res.writeHead(404).end();
  });
  return new Promise((resolver) => {
    servidor.listen(0, '127.0.0.1', () => {
      const porta = (servidor.address() as AddressInfo).port;
      resolver({
        url: `http://127.0.0.1:${porta}`,
        contagemChat: () => chamadas,
        fechar: () =>
          new Promise<void>((r) => {
            servidor.closeAllConnections?.();
            servidor.close(() => r());
          }),
      });
    });
  });
}

function pedido(
  aoReceberTexto: (p: string) => void = () => {},
  sinal: AbortSignal = new AbortController().signal,
): PedidoRaciocinio {
  return {
    mensagem: 'olá',
    historico: [],
    overridePersona: '',
    camadaGlobal: '',
    sinal,
    aoReceberTexto,
  };
}

const linhaConteudo = (texto: string) => `${JSON.stringify({ message: { content: texto }, done: false })}\n`;
const linhaFinal = (entrada: number, saida: number) =>
  `${JSON.stringify({ message: { content: '' }, done: true, prompt_eval_count: entrada, eval_count: saida })}\n`;

// ---------------------------------------------------------------------------
// Parser puro
// ---------------------------------------------------------------------------

test('UN-010. linha de conteúdo vira pedaço, sem final', () => {
  const r = interpretarLinhaOllama('{"message":{"content":"abc"},"done":false}');
  assert.equal(r?.pedaco, 'abc');
  assert.equal(r?.final, undefined);
});

test('UN-011. linha done:true carrega as contagens; ausentes viram 0', () => {
  const r = interpretarLinhaOllama(
    '{"message":{"content":""},"done":true,"prompt_eval_count":12,"eval_count":7}',
  );
  assert.deepEqual(r?.final, { tokens_entrada: 12, tokens_saida: 7 });

  const semContagem = interpretarLinhaOllama('{"done":true}');
  assert.deepEqual(semContagem?.final, { tokens_entrada: 0, tokens_saida: 0 });
});

test('UN-012. linha vazia, malformada ou sem nada útil devolve null — nunca lança', () => {
  assert.equal(interpretarLinhaOllama(''), null);
  assert.equal(interpretarLinhaOllama('   '), null);
  assert.equal(interpretarLinhaOllama('{corta'), null);
  assert.equal(interpretarLinhaOllama('"só uma string"'), null);
  assert.equal(interpretarLinhaOllama('{"done":false}'), null);
});

test('linha de erro do stream é reconhecida', () => {
  const r = interpretarLinhaOllama('{"error":"model não encontrado"}');
  assert.equal(r?.erro, 'model não encontrado');
});

// ---------------------------------------------------------------------------
// Sonda
// ---------------------------------------------------------------------------

test('UN-020. sonda contra porta fechada responde false em menos de 2 s', async () => {
  const stub = await stubOllama(() => {});
  const url = stub.url;
  await stub.fechar();

  await comAmbiente({ OLLAMA_URL: url, OLLAMA_MODELO: undefined }, async () => {
    const cliente = new ClienteOllama();
    const inicio = Date.now();
    const alcancou = await cliente.sondar();
    const duracao = Date.now() - inicio;
    assert.equal(alcancou, false);
    assert.ok(duracao < 2000, `sonda demorou ${duracao}ms — a subida do motor ficaria presa`);
    assert.equal(cliente.disponivel, false);
  });
});

test('UN-021. raciocinar sem sonda bem-sucedida lança ProvedorIndisponivel', async () => {
  await comAmbiente({ OLLAMA_URL: 'http://127.0.0.1:9', OLLAMA_MODELO: undefined }, async () => {
    const cliente = new ClienteOllama();
    await assert.rejects(cliente.raciocinar(pedido()), ProvedorIndisponivel);
  });
});

// ---------------------------------------------------------------------------
// Retentativa: taxonomia
// ---------------------------------------------------------------------------

test('UN-022. 404 (modelo não baixado) NÃO retenta — uma única requisição', async () => {
  const stub = await stubOllama((res) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'model "inexistente" not found' }));
  });
  try {
    await comAmbiente({ OLLAMA_URL: stub.url, OLLAMA_MODELO: 'inexistente' }, async () => {
      const cliente = new ClienteOllama();
      assert.equal(await cliente.sondar(), true);
      await assert.rejects(cliente.raciocinar(pedido()), /404/);
      assert.equal(stub.contagemChat(), 1, 'retentou um erro que só se repete');
    });
  } finally {
    await stub.fechar();
  }
});

test('UN-023. 500 na primeira tentativa retenta e conclui na segunda', async () => {
  const stub = await stubOllama((res, chamada) => {
    if (chamada === 1) {
      res.writeHead(500).end('erro interno');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(linhaConteudo('recuperado'));
    res.end(linhaFinal(3, 1));
  });
  try {
    await comAmbiente({ OLLAMA_URL: stub.url, OLLAMA_MODELO: undefined }, async () => {
      const cliente = new ClienteOllama();
      assert.equal(await cliente.sondar(), true);
      const resposta = await cliente.raciocinar(pedido());
      assert.equal(resposta.texto, 'recuperado');
      assert.equal(stub.contagemChat(), 2);
    });
  } finally {
    await stub.fechar();
  }
});

// ---------------------------------------------------------------------------
// Wire completo, socket real
// ---------------------------------------------------------------------------

test('IT-001. stream completo: pedaços na ordem, texto agregado, contagens honestas', async () => {
  const stub = await stubOllama((res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(linhaConteudo('Olá'));
    res.write(linhaConteudo(', '));
    res.write(linhaConteudo('mundo'));
    res.end(linhaFinal(12, 7));
  });
  try {
    await comAmbiente({ OLLAMA_URL: stub.url, OLLAMA_MODELO: undefined }, async () => {
      const cliente = new ClienteOllama();
      assert.equal(await cliente.sondar(), true);

      const pedacos: string[] = [];
      const resposta = await cliente.raciocinar(pedido((p) => pedacos.push(p)));

      assert.deepEqual(pedacos, ['Olá', ', ', 'mundo']);
      assert.equal(resposta.texto, 'Olá, mundo');
      assert.equal(resposta.tokens_entrada, 12);
      assert.equal(resposta.tokens_saida, 7);
      assert.equal(resposta.cache_lido, 0);
      assert.equal(resposta.recusado, false);
      assert.equal(stub.contagemChat(), 1);
    });
  } finally {
    await stub.fechar();
  }
});

test('IT-002. aborto no meio do stream: nenhum pedaço depois, sem retentativa', async () => {
  // Holder em vez de variável solta: o TypeScript não enxerga atribuição
  // feita dentro do callback e estreitaria o tipo para `null`.
  const pendente: { res: http.ServerResponse | null } = { res: null };
  const stub = await stubOllama((res) => {
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    res.write(linhaConteudo('primeiro'));
    res.write(linhaConteudo('segundo'));
    pendente.res = res; // fica aberto — o cliente é quem corta
  });
  try {
    await comAmbiente({ OLLAMA_URL: stub.url, OLLAMA_MODELO: undefined }, async () => {
      const cliente = new ClienteOllama();
      assert.equal(await cliente.sondar(), true);

      const controlador = new AbortController();
      const pedacos: string[] = [];
      const promessa = cliente.raciocinar(
        pedido((p) => {
          pedacos.push(p);
          if (pedacos.length === 2) controlador.abort(new Error('mensagem nova'));
        }, controlador.signal),
      );

      // Aborto com texto parcial entregue: o erro sobe (retentativa proibida),
      // ou o laço fecha limpo com o que chegou — os dois são aceitáveis; o que
      // não pode acontecer é pedaço novo depois do aborto ou segunda requisição.
      await promessa.catch(() => {});
      assert.deepEqual(pedacos, ['primeiro', 'segundo']);
      assert.equal(stub.contagemChat(), 1, 'retentou depois de texto parcial');
    });
  } finally {
    pendente.res?.end();
    await stub.fechar();
  }
});

test('IT-003. servidor morre entre a sonda e a chamada: erro tratado e cache zerado', async () => {
  const stub = await stubOllama(() => {});
  await comAmbiente({ OLLAMA_URL: stub.url, OLLAMA_MODELO: undefined }, async () => {
    const cliente = new ClienteOllama();
    assert.equal(await cliente.sondar(), true);

    await stub.fechar(); // o Ollama "morreu" com a sonda ainda válida no TTL

    await assert.rejects(cliente.raciocinar(pedido()));
    assert.equal(
      cliente.disponivel,
      false,
      'o cache de alcançabilidade sobreviveu ao ECONNREFUSED — 30 s de mentira',
    );
  });
});
