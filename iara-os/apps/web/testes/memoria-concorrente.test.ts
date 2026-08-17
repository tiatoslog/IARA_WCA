/**
 * A MEMÓRIA DO OPERADOR SOBREVIVE A DOIS CANAIS FALANDO AO MESMO TEMPO.
 *
 * O DEFEITO, reproduzido em 17/08/2026 antes da correção:
 *
 *   `Porta.ts` (tela) e `canais/PortaWhatsapp.ts` construíam cada uma a sua
 *   `MemoriaOperacional`. Cada instância lia o shard uma única vez, guardava o
 *   objeto em cache e, a cada mensagem, gravava o objeto CACHEADO inteiro por
 *   cima do arquivo. Nenhuma das duas voltava ao disco depois da primeira
 *   leitura — então toda escrita apagava o que o outro canal tinha escrito.
 *
 *   Medido, nesta ordem exata: web grava MSG-WEB-1, WhatsApp grava
 *   MSG-WHATS-1, web grava MSG-WEB-2. No disco sobravam só as duas da web.
 *   E a ficha que o operador salvou pela tela (`como_chamar`) voltava a
 *   `null` na mensagem seguinte do WhatsApp.
 *
 * O TESTE É DE SISTEMA DE ARQUIVOS DE VERDADE, e tem de ser: o defeito morava
 * na interação entre cache, escrita e disco. Um dublê de `fs` teria passado
 * verde nas duas versões, que é exatamente como este defeito sobreviveu a 1164
 * testes.
 *
 * Ver `MemoriaOperacional.sobTrava` e `memoriaOperacional`.
 */

import { strict as assert } from 'node:assert';
import test from 'node:test';
import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import {
  MemoriaOperacional,
  memoriaOperacional,
} from '../servidor/nucleo/MemoriaOperacional';

const ID = 'testeconcorrencia';
const ARQUIVO = path.resolve(process.cwd(), 'dados', 'memoria', `${ID}.json`);

async function limpar(): Promise<void> {
  await rm(ARQUIVO, { force: true });
}

async function noDisco(): Promise<{
  registros: { texto: string }[];
  preferencias?: { como_chamar?: string };
}> {
  return JSON.parse(await readFile(ARQUIVO, 'utf8'));
}

test('duas instâncias (tela e WhatsApp) não apagam a mensagem uma da outra', async () => {
  await limpar();
  try {
    const web = new MemoriaOperacional();
    const whatsapp = new MemoriaOperacional();

    await web.registrar(ID, 'operador', 'MSG-WEB-1');
    await whatsapp.registrar(ID, 'operador', 'MSG-WHATS-1');
    await web.registrar(ID, 'operador', 'MSG-WEB-2');

    const textos = (await noDisco()).registros.map((r) => r.texto);
    for (const esperada of ['MSG-WEB-1', 'MSG-WHATS-1', 'MSG-WEB-2']) {
      assert.ok(
        textos.includes(esperada),
        `"${esperada}" sumiu do shard. No disco: ${JSON.stringify(textos)}`,
      );
    }
  } finally {
    await limpar();
  }
});

test('a ficha salva pela tela sobrevive à mensagem seguinte do outro canal', async () => {
  await limpar();
  try {
    const web = new MemoriaOperacional();
    const whatsapp = new MemoriaOperacional();

    await web.registrar(ID, 'operador', 'oi');
    await whatsapp.registrar(ID, 'operador', 'oi de novo');
    await web.gravarPreferencias(ID, {
      como_chamar: 'Ana',
      tratamento: 'senhora',
      funcao: 'Coordenadora de operações',
      observacoes: '',
    });
    await whatsapp.registrar(ID, 'operador', 'mais uma');

    const { preferencias } = await noDisco();
    assert.equal(
      preferencias?.como_chamar,
      'Ana',
      'a ficha que o operador salvou foi revertida por uma escrita do outro canal',
    );
  } finally {
    await limpar();
  }
});

test('escritas concorrentes na mesma instância não perdem registro', async () => {
  await limpar();
  try {
    const memoria = new MemoriaOperacional();
    // Sem trava, `ler → await → escrever` se cruza e a última escrita ganha:
    // um punhado de mensagens some sem erro nenhum.
    const esperadas = Array.from({ length: 40 }, (_, i) => `CONCORRENTE-${i}`);
    await Promise.all(esperadas.map((t) => memoria.registrar(ID, 'operador', t)));

    const textos = (await noDisco()).registros.map((r) => r.texto);
    const perdidas = esperadas.filter((t) => !textos.includes(t));
    assert.equal(perdidas.length, 0, `perdeu ${perdidas.length} de 40: ${perdidas.join(', ')}`);
  } finally {
    await limpar();
  }
});

test('o shard nunca é lido pela metade: a gravação é atômica', async () => {
  await limpar();
  try {
    const memoria = new MemoriaOperacional();
    // Uma carga grande o bastante para que um `writeFile` direto levasse mais
    // de um tique — é nessa janela que outro leitor pegava JSON truncado, caía
    // no `catch` e tratava o shard como VAZIO, apagando a memória de vez.
    const grande = 'x'.repeat(20_000);
    const escritas = Array.from({ length: 12 }, (_, i) =>
      memoria.registrar(ID, 'operador', `${grande}-${i}`),
    );

    // Lê o arquivo enquanto as escritas acontecem. Toda leitura que enxergar o
    // arquivo tem de enxergá-lo íntegro.
    const leituras: Promise<void>[] = [];
    for (let i = 0; i < 30; i += 1) {
      leituras.push(
        readFile(ARQUIVO, 'utf8')
          .then((bruto) => {
            JSON.parse(bruto); // lança se estiver truncado
          })
          .catch((erro: NodeJS.ErrnoException) => {
            /**
             * O INVARIANTE É "NUNCA VER JSON PELA METADE", não "toda leitura
             * consegue abrir o arquivo".
             *
             * `ENOENT` — a primeira gravação ainda não aconteceu.
             * `EPERM`/`EBUSY`/`EACCES` — o Windows recusa abrir o alvo no
             *   instante exato do `rename`. A leitura não viu nada, que é
             *   justamente o comportamento seguro: o que não pode acontecer é
             *   ela ver METADE.
             *
             * Um `SyntaxError` do `JSON.parse` continua subindo, e é ele que
             * este teste existe para pegar.
             */
            if (['ENOENT', 'EPERM', 'EBUSY', 'EACCES'].includes(erro.code ?? '')) return;
            throw erro;
          }),
      );
    }

    await Promise.all([...escritas, ...leituras]);
  } finally {
    await limpar();
  }
});

test('a Porta e o canal WhatsApp compartilham a MESMA memória', async () => {
  // A trava e o cache moram na instância. Duas instâncias no mesmo processo são
  // duas travas que não se conhecem — por isso os dois canais importam o
  // singleton em vez de construir a própria.
  const { default: fsSync } = await import('node:fs');
  const raiz = path.resolve(process.cwd(), 'servidor');
  const porta = fsSync.readFileSync(path.join(raiz, 'barramento', 'Porta.ts'), 'utf8');
  const whatsapp = fsSync.readFileSync(path.join(raiz, 'canais', 'PortaWhatsapp.ts'), 'utf8');

  for (const [nome, fonte] of [
    ['Porta.ts', porta],
    ['PortaWhatsapp.ts', whatsapp],
  ] as const) {
    assert.ok(
      !/new\s+MemoriaOperacional\s*\(/.test(fonte),
      `${nome} constrói a própria MemoriaOperacional — as duas escritas se apagam`,
    );
    assert.ok(
      /memoriaOperacional/.test(fonte),
      `${nome} não usa o singleton memoriaOperacional`,
    );
  }

  assert.ok(memoriaOperacional instanceof MemoriaOperacional);
});
