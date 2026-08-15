/**
 * Geocodificação de cidade dita em texto livre — `consultar_clima`.
 *
 * Achado ao vivo em produção (14/08/2026): "vai chover em Valinhos hoje?"
 * executava a habilidade de verdade (rota `plano_local`, evento publicado) e
 * devolvia a MESMA recusa genérica de "não sei sua localização" — o esquema
 * não tinha campo para cidade, e o executor só sabia ler geolocalização do
 * aparelho ou `IARA_LATITUDE`/`IARA_LONGITUDE`. Estes testes provam a METADE
 * de EXECUÇÃO da correção: dado um nome de cidade, a habilidade geocodifica e
 * responde para o lugar certo — ou falha honestamente, nunca em silêncio.
 *
 * `fetch` simulado, mesmo desenho de `testes/planilha-ocis.test.ts`: sob
 * teste é o CONTRATO da chamada (duas etapas — geocodificação, depois
 * previsão), não o serviço externo de verdade.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { OrquestradorAcoes } from '../servidor/nucleo/OrquestradorAcoes';
import { consultarClima } from '../servidor/nucleo/kernel/habilidades/operacionais';
import { esquecerLocal, registrarLocal, registrarCidade } from '../servidor/nucleo/LocalOperador';
import { extrairCidadeClima } from '../servidor/nucleo/kernel/Planejador';

const ID_USUARIO = 'teste-geocodificacao';

function mockFetch(respostas: Record<string, unknown>) {
  return (async (url: string) => {
    const chave = url.includes('geocoding-api.open-meteo.com')
      ? 'geocoding'
      : url.includes('api.open-meteo.com')
        ? 'forecast'
        : 'desconhecido';
    const corpo = respostas[chave];
    if (corpo === undefined) throw new Error(`URL inesperada no teste: ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => corpo,
    } as Response;
  }) as typeof fetch;
}

const GEOCODING_VALINHOS = {
  results: [{ name: 'Valinhos', latitude: -22.9707, longitude: -46.9937, admin1: 'São Paulo', country_code: 'BR' }],
};

const PREVISAO_OK = {
  current: { temperature_2m: 24.1, relative_humidity_2m: 55, precipitation: 0, weather_code: 1 },
  daily: {
    weather_code: [61, 3],
    temperature_2m_max: [27, 26],
    temperature_2m_min: [18, 17],
    precipitation_sum: [4.2, 0],
    precipitation_probability_max: [70, 20],
  },
};

test('cidade dita na frase geocodifica e responde para o lugar certo, não o padrão do escritório', async () => {
  const acoes = new OrquestradorAcoes();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = mockFetch({ geocoding: GEOCODING_VALINHOS, forecast: PREVISAO_OK });
  try {
    const r = await acoes.executar('clima', { horizonte: 'hoje', id_usuario: ID_USUARIO, cidade: 'Valinhos' });
    assert.equal(r.ok, true);
    assert.match(r.texto, /Valinhos/, 'a resposta tem que nomear o lugar geocodificado, não Cuiabá/escritório');
    assert.doesNotMatch(r.texto, /não sei de qual lugar/i, 'com cidade dita, nunca cai na recusa genérica de localização');
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal(ID_USUARIO);
  }
});

test('cidade que o serviço de geocodificação não reconhece → falha honesta, não fallback silencioso', async () => {
  const acoes = new OrquestradorAcoes();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = mockFetch({ geocoding: { results: [] }, forecast: PREVISAO_OK });
  try {
    const r = await acoes.executar('clima', {
      horizonte: 'hoje',
      id_usuario: ID_USUARIO,
      cidade: 'Xyzabcnaoexiste',
    });
    assert.equal(r.ok, false);
    assert.match(r.texto, /Xyzabcnaoexiste/, 'a falha tem que nomear o que não foi encontrado');
    assert.doesNotMatch(
      r.texto,
      /Cuiabá|perímetro operacional/i,
      'cidade não encontrada não pode silenciosamente cair para o padrão do escritório — o operador pediu um lugar específico',
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal(ID_USUARIO);
  }
});

test('sem cidade nenhuma, e sem aparelho/env, continua a recusa honesta de sempre (regressão)', async () => {
  const acoes = new OrquestradorAcoes();
  const fetchOriginal = globalThis.fetch;
  const antes = { lat: process.env.IARA_LATITUDE, lon: process.env.IARA_LONGITUDE };
  delete process.env.IARA_LATITUDE;
  delete process.env.IARA_LONGITUDE;
  globalThis.fetch = mockFetch({ geocoding: GEOCODING_VALINHOS, forecast: PREVISAO_OK });
  try {
    const r = await acoes.executar('clima', { horizonte: 'hoje', id_usuario: 'sem-nada-conhecido' });
    assert.equal(r.ok, false);
    assert.match(r.texto, /não sei de qual lugar/i);
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes.lat !== undefined) process.env.IARA_LATITUDE = antes.lat;
    if (antes.lon !== undefined) process.env.IARA_LONGITUDE = antes.lon;
    esquecerLocal('sem-nada-conhecido');
  }
});

test('mensagem com "em X" minúsculo não sobrescreve a localização do aparelho (achado em verificação independente)', async () => {
  // "Estou em reunião" não é lugar; extrairCidadeClima devolve undefined, e
  // o Planejador não envia "cidade" nenhuma — quem decide é o aparelho.
  assert.equal(extrairCidadeClima('Tem previsão de chuva? Estou em reunião até de tarde.'), undefined);

  const idUsuario = 'teste-aparelho-vence';
  registrarLocal(idUsuario, -22.9707, -46.9937);
  // Nome já memorizado — evita depender do mock de geocodificação reversa
  // (BigDataCloud), que é uma chamada diferente e fora do escopo deste teste.
  registrarCidade(idUsuario, -22.9707, 'Valinhos, SP');
  const acoes = new OrquestradorAcoes();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = mockFetch({ forecast: PREVISAO_OK });
  try {
    // Sem `cidade` no parâmetro — é assim que o Planejador chamaria depois
    // que extrairCidadeClima devolveu undefined para esta frase.
    const r = await acoes.executar('clima', { horizonte: 'hoje', id_usuario: idUsuario });
    assert.equal(r.ok, true, 'a localização do aparelho tinha que continuar respondendo');
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal(idUsuario);
  }
});

test('a habilidade consultar_clima aceita o parâmetro "cidade" no esquema', () => {
  assert.ok(
    'cidade' in consultarClima.manifesto.esquema,
    'o contrato precisa declarar o parâmetro para o plano poder preenchê-lo',
  );
  assert.equal(consultarClima.manifesto.esquema.cidade.obrigatorio ?? false, false, 'cidade é opcional — sem ela, cai para aparelho/escritório');
});
