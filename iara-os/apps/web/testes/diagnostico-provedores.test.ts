/**
 * QUANTOS CÉREBROS A IARA TEM — e a diferença entre saber e supor.
 *
 * O INCIDENTE (16/08/2026). Com a cota da Anthropic esgotada, a operadora
 * perguntou pelo celular: "mas você tem outras api do gemini e do grok". A IARA
 * repetiu, palavra por palavra, a mesma frase sobre o crédito da Anthropic.
 *
 * A leitura fácil era "o fallback não funciona". Não era: a `CadeiaDeRaciocinio`
 * existe e troca de elo por cota. Receber a mensagem da Anthropic como palavra
 * FINAL prova o contrário — que ela era o único elo daquele motor.
 *
 * O defeito real era não existir, em lugar nenhum do sistema, um lugar capaz de
 * responder "quais cérebros eu tenho, e o que se sabe de cada um". Um motor com
 * quatro provedores e um motor com um produziam a MESMA linha de diagnóstico.
 *
 * Estes testes prendem as propriedades que impedem esse painel de mentir nas
 * duas direções: afirmar cérebro que não existe, e esconder cérebro que existe.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fichasDeProvedores,
  resumirProvedores,
  utilizavel,
  type FichaProvedor,
} from '../servidor/nucleo/DiagnosticoProvedores';
import {
  classificarFalhaProvedor,
  mereceOutroProvedor,
  registrarFalhaProvedor,
  registrarSucessoProvedor,
  falhasObservadas,
  limparFalhasObservadas,
} from '../servidor/nucleo/CadeiaDeRaciocinio';
import { ProvedorIndisponivel } from '../servidor/nucleo/ProvedorRaciocinio';

/** Chave com forma plausível — `configUtilizavel` recusa lixo, e com razão. */
const CHAVE = 'sk-ant-api03-'.padEnd(64, 'x');

const de = (fichas: FichaProvedor[], apelido: string): FichaProvedor => {
  const f = fichas.find((x) => x.apelido === apelido);
  assert.ok(f, `ficha de ${apelido} ausente`);
  return f;
};

// ---------------------------------------------------------------------------
// 1. A escala única de classificação
// ---------------------------------------------------------------------------

test('a classificação nomeia a falha, e `mereceOutroProvedor` deriva dela', () => {
  assert.equal(classificarFalhaProvedor(new Error('credit balance is too low')), 'quota');
  assert.equal(classificarFalhaProvedor(new Error('HTTP 429 too many requests')), 'rate_limit');
  assert.equal(classificarFalhaProvedor(new Error('401 invalid api key')), 'autenticacao');
  assert.equal(classificarFalhaProvedor(new Error('fetch failed ECONNREFUSED')), 'servico_fora');
  assert.equal(classificarFalhaProvedor(new ProvedorIndisponivel('sem chave')), 'servico_fora');
  assert.equal(classificarFalhaProvedor(new Error('algo que ninguém previu')), 'outra');
});

/**
 * A ORDEM NÃO É DECORATIVA. A recusa por cota do Google chega como 429 E fala em
 * cota: "cota esgotada" é o diagnóstico acionável, "tente mais devagar" é o
 * inútil. Se a regra de rate limit viesse antes, o painel mandaria a operadora
 * esperar em vez de recarregar.
 */
test('cota vence limite de taxa quando a mensagem traz os dois', () => {
  const erro = new Error('429 Too Many Requests: quota exceeded for this project');
  assert.equal(classificarFalhaProvedor(erro), 'quota');
});

test('desistência do operador não é falha do provedor', () => {
  const abortado = new AbortController();
  abortado.abort();
  assert.equal(classificarFalhaProvedor(new Error('qualquer'), abortado.signal), 'cancelado');
  assert.equal(mereceOutroProvedor(new Error('credit balance'), abortado.signal), false);

  const erroAbort = new Error('cancelado');
  erroAbort.name = 'AbortError';
  assert.equal(classificarFalhaProvedor(erroAbort), 'cancelado');
});

/** O comportamento de troca não pode ter mudado com a refatoração da escala. */
test('a troca de cérebro continua valendo exatamente para o que valia antes', () => {
  assert.equal(mereceOutroProvedor(new Error('credit balance is too low')), true);
  assert.equal(mereceOutroProvedor(new Error('rate_limit_error')), true);
  assert.equal(mereceOutroProvedor(new Error('401 unauthorized')), true);
  assert.equal(mereceOutroProvedor(new Error('503 overloaded')), true);
  assert.equal(mereceOutroProvedor(new ProvedorIndisponivel('sem chave declarada')), true);
  assert.equal(mereceOutroProvedor(new Error('erro sem assinatura conhecida')), false);
});

// ---------------------------------------------------------------------------
// 2. O registro do que foi observado em uso real
// ---------------------------------------------------------------------------

test('o registro guarda a classe da falha, e o sucesso a apaga', () => {
  limparFalhasObservadas();
  registrarFalhaProvedor('anthropic', new Error('credit balance is too low'));
  assert.equal(falhasObservadas().get('anthropic')?.classe, 'quota');

  registrarSucessoProvedor('anthropic');
  assert.equal(falhasObservadas().get('anthropic'), undefined);
  limparFalhasObservadas();
});

test('cancelamento não entra no registro — não pinta de vermelho um cérebro são', () => {
  limparFalhasObservadas();
  const abortado = new AbortController();
  abortado.abort();
  registrarFalhaProvedor('gemini', new Error('interrompido'), abortado.signal);
  assert.equal(falhasObservadas().size, 0);
});

// ---------------------------------------------------------------------------
// 3. As fichas — configurado NÃO é o mesmo que disponível
// ---------------------------------------------------------------------------

test('sem sonda, chave presente vale `nao_sondado` — nunca `disponivel`', async () => {
  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE },
    sondar: false,
  });
  const anthropic = de(fichas, 'anthropic');
  assert.equal(anthropic.configurado, true);
  assert.equal(
    anthropic.estado,
    'nao_sondado',
    'chave no ambiente virou disponibilidade sem nada ter sido confirmado',
  );
});

/**
 * O CORAÇÃO DO INCIDENTE. Um ambiente só com Anthropic precisa DIZER que Groq,
 * Gemini e Ollama não estão lá — é a informação que teria evitado a conversa do
 * celular inteira.
 */
test('provedor ausente aparece na lista, nomeando a variável que falta', async () => {
  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE },
    sondar: false,
  });
  assert.equal(fichas.length, 4, 'o painel precisa conhecer os quatro cérebros');

  for (const apelido of ['groq', 'gemini', 'ollama']) {
    const f = de(fichas, apelido);
    assert.equal(f.estado, 'nao_configurado');
    assert.equal(f.configurado, false);
  }
  assert.match(de(fichas, 'groq').detalhe, /GROQ_API_KEY/);
  assert.match(de(fichas, 'gemini').detalhe, /GEMINI_API_KEY/);
  assert.match(de(fichas, 'ollama').detalhe, /OLLAMA_URL/);
});

test('provedor não configurado nunca conta como utilizável', async () => {
  const fichas = await fichasDeProvedores({ ambiente: {}, sondar: false });
  assert.equal(fichas.filter(utilizavel).length, 0);
});

/**
 * O USO REAL MANDA SOBRE A SONDA, e é a única precedência possível: nenhuma
 * sonda barata enxerga saldo. O endpoint que lista modelos responde 200 com a
 * conta zerada, porque listar não gasta crédito.
 */
test('cota observada em uso real vence a sonda — mesmo com a chave aceita', async () => {
  limparFalhasObservadas();
  registrarFalhaProvedor('anthropic', new Error('credit balance is too low'));

  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE, GEMINI_API_KEY: 'AIza'.padEnd(39, 'y') },
    observado: falhasObservadas(),
    sondar: false,
  });

  /* Sem sonda a Anthropic seria `nao_sondado`; o uso real a rebaixa. */
  const anthropic = de(fichas, 'anthropic');
  assert.equal(anthropic.estado, 'quota_esgotada');
  assert.match(anthropic.detalhe, /uso real/);
  assert.equal(utilizavel(anthropic), false);

  /* E o Gemini, que nada sofreu, continua de pé — é o ponto todo do fallback. */
  assert.equal(utilizavel(de(fichas, 'gemini')), true);
  limparFalhasObservadas();
});

// ---------------------------------------------------------------------------
// 4. A frase que a IARA diz quando perguntam das limitações dela
// ---------------------------------------------------------------------------

/**
 * A REPRODUÇÃO EXATA DA IMAGEM. Anthropic sem cota, Gemini de pé: a resposta NÃO
 * pode ser a frase fixa sobre o crédito da Anthropic, e precisa nomear o cérebro
 * que sobrou.
 */
test('com a Anthropic sem cota e o Gemini de pé, a resposta nomeia o Gemini', async () => {
  limparFalhasObservadas();
  registrarFalhaProvedor('anthropic', new Error('credit balance is too low'));

  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE, GEMINI_API_KEY: 'AIza'.padEnd(39, 'y') },
    observado: falhasObservadas(),
    sondar: false,
  });
  const frase = resumirProvedores(fichas, 'gemini');

  assert.match(frase, /gemini/i);
  assert.match(frase, /cota esgotada/i);
  assert.ok(
    !/A cota da nuvem desta instalação acabou/i.test(frase),
    'voltou a frase fixa que ignorava os outros provedores',
  );
  assert.ok(
    !/console\.anthropic\.com/i.test(frase),
    'mandou recarregar a Anthropic tendo outro cérebro disponível',
  );
  limparFalhasObservadas();
});

test('sem nenhum provedor configurado, a IARA diz isso — e nomeia as quatro variáveis', async () => {
  const fichas = await fichasDeProvedores({ ambiente: {}, sondar: false });
  const frase = resumirProvedores(fichas, null);
  for (const v of ['ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'OLLAMA_URL']) {
    assert.match(frase, new RegExp(v));
  }
});

test('configurados mas todos derrubados: a frase não promete raciocínio', async () => {
  limparFalhasObservadas();
  registrarFalhaProvedor('anthropic', new Error('credit balance is too low'));
  registrarFalhaProvedor('gemini', new Error('429 quota exceeded'));

  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE, GEMINI_API_KEY: 'AIza'.padEnd(39, 'y') },
    observado: falhasObservadas(),
    sondar: false,
  });
  const frase = resumirProvedores(fichas, null);
  assert.match(frase, /Nenhum deles está utilizável/i);
  limparFalhasObservadas();
});

/**
 * A RESSALVA DO SALDO É PERMANENTE, e não é excesso de zelo: sem ela, uma linha
 * verde de sonda é lida como "tem crédito" — que é precisamente o que a sonda
 * não tem como saber.
 */
test('o painel nunca promete saldo a partir da sonda', async () => {
  const fichas = await fichasDeProvedores({
    ambiente: { ANTHROPIC_API_KEY: CHAVE },
    sondar: false,
  });
  const disponiveis = fichas.filter((f) => f.estado === 'disponivel');
  for (const f of disponiveis) {
    assert.match(f.detalhe, /saldo não é sondável/);
  }
});
