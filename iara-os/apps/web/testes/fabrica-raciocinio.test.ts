/**
 * FabricaRaciocinio — a matriz de seleção do provedor.
 *
 * A propriedade central: infraestrutura é DECLARADA, nunca descoberta. Sem
 * `OLLAMA_URL` no ambiente, nenhum caminho leva ao provedor local — nem numa
 * máquina que tenha um Ollama rodando na porta padrão. É o que mantém estes
 * testes determinísticos em qualquer computador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { criarProvedorRaciocinio } from '../servidor/nucleo/FabricaRaciocinio';
import { ClienteClaude } from '../servidor/nucleo/ClienteClaude';
import { ClienteOllama } from '../servidor/nucleo/ClienteOllama';
import { ConfiguracaoInvalida } from '../servidor/nucleo/kernel/Configuracao';

const CHAVE_VALIDA = `sk-ant-${'a'.repeat(40)}`;

async function comProcessEnv<T>(
  vars: Record<string, string | undefined>,
  corpo: () => T,
): Promise<T> {
  const anteriores = new Map<string, string | undefined>();
  for (const [nome, valor] of Object.entries(vars)) {
    anteriores.set(nome, process.env[nome]);
    if (valor === undefined) delete process.env[nome];
    else process.env[nome] = valor;
  }
  try {
    return corpo();
  } finally {
    for (const [nome, valor] of anteriores) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  }
}

test('UN-030. chave Anthropic utilizável em auto: ClienteClaude', () => {
  const provedor = criarProvedorRaciocinio({ ANTHROPIC_API_KEY: CHAVE_VALIDA });
  assert.ok(provedor instanceof ClienteClaude);
  assert.equal(provedor.origem, 'nuvem');
});

test('UN-031. sem chave, com OLLAMA_URL declarada: ClienteOllama', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined }, () => {
    const provedor = criarProvedorRaciocinio({ OLLAMA_URL: 'http://127.0.0.1:11434' });
    assert.ok(provedor instanceof ClienteOllama);
    assert.equal(provedor.origem, 'local');
  });
});

test('UN-032. sem nada: ClienteClaude indisponível — o modo honesto de sempre', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined, OLLAMA_URL: undefined }, () => {
    const provedor = criarProvedorRaciocinio({});
    assert.ok(provedor instanceof ClienteClaude);
    assert.equal(provedor.disponivel, false);
  });
});

test('UN-033. IARA_PROVEDOR forçado vence o auto, nos dois sentidos', async () => {
  await comProcessEnv({ ANTHROPIC_API_KEY: undefined }, () => {
    const forcadoOllama = criarProvedorRaciocinio({
      IARA_PROVEDOR: 'ollama',
      ANTHROPIC_API_KEY: CHAVE_VALIDA, // chave presente e mesmo assim: Ollama
    });
    assert.ok(forcadoOllama instanceof ClienteOllama);

    const forcadoAnthropic = criarProvedorRaciocinio({
      IARA_PROVEDOR: 'anthropic',
      OLLAMA_URL: 'http://127.0.0.1:11434', // URL presente e mesmo assim: nuvem
    });
    assert.ok(forcadoAnthropic instanceof ClienteClaude);
  });
});

test('UN-034. IARA_PROVEDOR=ollama sem OLLAMA_URL usa o padrão local e o modelo padrão', async () => {
  await comProcessEnv({ OLLAMA_URL: undefined, OLLAMA_MODELO: undefined }, () => {
    const provedor = criarProvedorRaciocinio({ IARA_PROVEDOR: 'ollama' });
    assert.ok(provedor instanceof ClienteOllama);
    assert.equal(provedor.modelo, 'llama3.1');
  });
});

test('valor desconhecido de IARA_PROVEDOR é tratado como auto, não como erro', () => {
  const provedor = criarProvedorRaciocinio({
    IARA_PROVEDOR: 'gpt5', // não existe — ausência de valor válido é ausência
    ANTHROPIC_API_KEY: CHAVE_VALIDA,
  });
  assert.ok(provedor instanceof ClienteClaude);
});

test('chave contaminada sem Ollama declarado continua LEVANTANDO — a fábrica não engole', async () => {
  /**
   * O incidente de 13/08 em miniatura: um `\n` e um segundo segredo no meio do
   * valor. `configUtilizavel` responde false, o auto cai para o ClienteClaude
   * padrão, e o construtor DELE levanta `ConfiguracaoInvalida` — exatamente o
   * comportamento de antes da fábrica existir. Um provedor local não pode
   * virar tapete para varrer credencial quebrada para baixo.
   */
  await comProcessEnv(
    {
      ANTHROPIC_API_KEY: `${CHAVE_VALIDA}\nOUTRA_COISA=vazada`,
      OLLAMA_URL: undefined,
      IARA_PROVEDOR: undefined,
    },
    () => {
      assert.throws(() => criarProvedorRaciocinio(), ConfiguracaoInvalida);
    },
  );
});
