/**
 * O `distDir` precisa ser o MESMO no build e no runtime.
 *
 * Este teste nasceu de um defeito real, em 12/08/2026, e o defeito custou uma
 * tarde de deploy. A guarda original olhava `VERCEL` e `CI` para decidir se
 * estava "em nuvem" — e num container em produção nenhuma das duas existe. O
 * resultado:
 *
 *   · o build do Docker roda SEM `PORT`        → escreve `.next`
 *   · o container sobe com `PORT=8080` do host → procura `.next-8080`
 *
 *   Error: Could not find a production build in the '.next-8080' directory.
 *
 * O sintoma é healthcheck falhando com o build ali, íntegro, no diretório de
 * sempre — e a mensagem culpa quem esqueceu de compilar, que é exatamente
 * quem não errou.
 *
 * O que estes testes travam não é uma string: é a PROPRIEDADE de que o
 * diretório não depende de nada que o host controle em produção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Importa `next.config.mjs` com um ambiente montado na hora.
 *
 * O sufixo de consulta na URL existe porque o cache de módulos ESM é por
 * especificador: sem ele, a segunda importação devolveria a config resolvida
 * com o ambiente da primeira, e os testes passariam sem testar nada.
 */
async function distDirCom(ambiente: Record<string, string | undefined>): Promise<string> {
  const antes: Record<string, string | undefined> = {};
  for (const [chave, valor] of Object.entries(ambiente)) {
    antes[chave] = process.env[chave];
    if (valor === undefined) delete process.env[chave];
    else process.env[chave] = valor;
  }
  try {
    const url = new URL('../next.config.mjs', import.meta.url);
    url.search = `?t=${Math.random()}`;
    const modulo = (await import(url.href)) as { default: { distDir?: string } };
    return modulo.default.distDir ?? '.next';
  } finally {
    for (const [chave, valor] of Object.entries(antes)) {
      if (valor === undefined) delete process.env[chave];
      else process.env[chave] = valor;
    }
  }
}

const SEM_PORTA = { PORT: undefined, IARA_PORTA: undefined };

test('build de produção ignora PORT — é o que o Docker faz', async () => {
  const dir = await distDirCom({ NODE_ENV: 'production', ...SEM_PORTA });
  assert.equal(dir, '.next');
});

test('runtime de produção com PORT do host acha o MESMO diretório do build', async () => {
  // O caso exato do Railway: build sem PORT, container com PORT=8080.
  const build = await distDirCom({ NODE_ENV: 'production', ...SEM_PORTA });
  const runtime = await distDirCom({ NODE_ENV: 'production', PORT: '8080' });
  assert.equal(runtime, build, 'build e runtime divergiram — o Next não vai achar o build');
  assert.equal(runtime, '.next');
});

test('nenhuma porta de host muda o diretório em produção', async () => {
  // Hosts diferentes injetam portas diferentes, e nenhuma delas pode
  // renomear a pasta onde o build já está.
  for (const porta of ['3000', '8080', '10000', '56061']) {
    const dir = await distDirCom({ NODE_ENV: 'production', PORT: porta });
    assert.equal(dir, '.next', `PORT=${porta} nao podia mudar o distDir`);
  }
  // IARA_PORTA é override local e vale menos ainda em produção.
  const dir = await distDirCom({ NODE_ENV: 'production', PORT: undefined, IARA_PORTA: '4000' });
  assert.equal(dir, '.next');
});

test('em desenvolvimento o diretório por porta continua existindo', async () => {
  // A razão original da regra segue valendo: duas instâncias na mesma cópia do
  // repositório apagam e reescrevem os mesmos arquivos, e a que perde a corrida
  // morre com um ENOENT que não tem nada a ver com o código.
  assert.equal(await distDirCom({ NODE_ENV: 'development', PORT: '3001' }), '.next-3001');
  assert.equal(await distDirCom({ NODE_ENV: 'development', IARA_PORTA: '3002', PORT: undefined }), '.next-3002');
  // A porta padrão mantém `.next` puro, para não quebrar cache nem instrução.
  assert.equal(await distDirCom({ NODE_ENV: 'development', ...SEM_PORTA }), '.next');
});
