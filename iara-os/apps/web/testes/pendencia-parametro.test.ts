/**
 * Retomada de intenção pendente — o multiturno que faltava.
 *
 * O caso real (produção, 14/08/2026): "vai chover hoje?" → IARA pede a
 * cidade → operadora responde "Valinhos" → a resposta era tratada como
 * mensagem nova, não casava âncora nenhuma e morria em conversa. Este teste
 * atravessa o Kernel DE VERDADE, dois turnos na mesma sessão, com o mundo
 * (Open-Meteo) simulado no `fetch` — o que está sob teste é o protocolo de
 * diálogo, não o serviço meteorológico.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import { esquecerLocal } from '../servidor/nucleo/LocalOperador';

function memoriaVazia(): MemoriaOperacional {
  return {
    registrar: async () => undefined,
    historico: async () => [],
    insightsPendentes: async () => [],
    consumirInsight: async () => undefined,
    gravarInsight: async () => undefined,
    consolidar: async () => undefined,
    carregarGlobal: async () => '',
  } as unknown as MemoriaOperacional;
}

const GEOCODING = {
  results: [{ name: 'Valinhos', latitude: -22.9707, longitude: -46.9937, admin1: 'São Paulo', country_code: 'BR' }],
};
const PREVISAO = {
  current: { temperature_2m: 24.1, relative_humidity_2m: 55, precipitation: 0, weather_code: 1 },
  daily: {
    weather_code: [61, 3],
    temperature_2m_max: [27, 26],
    temperature_2m_min: [18, 17],
    precipitation_sum: [4.2, 0],
    precipitation_probability_max: [70, 20],
  },
};

test('"vai chover hoje?" sem localização pede a cidade, e "Valinhos" no turno seguinte executa', async () => {
  const idUsuario = 'u-pendencia';
  const salvo = {
    lat: process.env.IARA_LATITUDE,
    lon: process.env.IARA_LONGITUDE,
    cid: process.env.IARA_CIDADE,
  };
  delete process.env.IARA_LATITUDE;
  delete process.env.IARA_LONGITUDE;
  delete process.env.IARA_CIDADE;
  esquecerLocal(idUsuario);

  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const corpo = String(url).includes('geocoding-api.open-meteo.com')
      ? GEOCODING
      : String(url).includes('api.open-meteo.com')
        ? PREVISAO
        : null;
    if (!corpo) throw new Error(`URL inesperada no teste: ${url}`);
    return { ok: true, status: 200, json: async () => corpo } as Response;
  }) as typeof fetch;

  try {
    const barramento = new BarramentoEventos('s-pendencia');
    const kernel = new Kernel({
      sessao: 's-pendencia',
      idUsuario,
      outrosOperadores: [],
      estado: new EstadoAtomico(),
      memoria: memoriaVazia(),
      barramento,
    });

    const falas: Array<{ texto: string; rota: string }> = [];
    barramento.assinar('TAREFA_CONCLUIDA', (e) => falas.push({ texto: e.texto, rota: e.rota }));

    // Turno 1: sem aparelho e sem env, a habilidade EXECUTA e pede a cidade.
    await kernel.processar('vai chover hoje?');
    assert.equal(falas.length, 1);
    assert.match(falas[0].texto, /cidade/i, 'a resposta precisa pedir a cidade, não só recusar');

    // Turno 2: a resposta curta preenche o parâmetro e a MESMA habilidade roda.
    await kernel.processar('Valinhos');
    assert.equal(falas.length, 2);
    assert.match(
      falas[1].texto,
      /Valinhos/,
      'o segundo turno tem que devolver a previsão de Valinhos, não cair em conversa',
    );
    assert.doesNotMatch(falas[1].texto, /não sei de qual lugar/i, 'a pendência preenchida não pode repetir a pergunta');
    assert.equal(falas[1].rota, 'plano_local', 'a retomada é determinística — custo zero');
  } finally {
    globalThis.fetch = fetchOriginal;
    if (salvo.lat !== undefined) process.env.IARA_LATITUDE = salvo.lat;
    if (salvo.lon !== undefined) process.env.IARA_LONGITUDE = salvo.lon;
    if (salvo.cid !== undefined) process.env.IARA_CIDADE = salvo.cid;
    esquecerLocal(idUsuario);
  }
});

test('pendência morre em silêncio quando o operador muda de assunto', async () => {
  const idUsuario = 'u-pendencia-2';
  const salvo = { lat: process.env.IARA_LATITUDE, lon: process.env.IARA_LONGITUDE, cid: process.env.IARA_CIDADE };
  delete process.env.IARA_LATITUDE;
  delete process.env.IARA_LONGITUDE;
  delete process.env.IARA_CIDADE;
  esquecerLocal(idUsuario);

  try {
    const barramento = new BarramentoEventos('s-pendencia-2');
    const kernel = new Kernel({
      sessao: 's-pendencia-2',
      idUsuario,
      outrosOperadores: [],
      estado: new EstadoAtomico(),
      memoria: memoriaVazia(),
      barramento,
    });

    const falas: Array<{ texto: string; rota: string }> = [];
    barramento.assinar('TAREFA_CONCLUIDA', (e) => falas.push({ texto: e.texto, rota: e.rota }));

    await kernel.processar('vai chover hoje?'); // arma a pendência
    await kernel.processar('que horas são?'); // âncora nova → pendência descartada

    assert.equal(falas.length, 2);
    assert.match(falas[1].texto, /\d{2}:\d{2}/, 'o pedido novo tem que ser atendido normalmente');
    assert.doesNotMatch(falas[1].texto, /Valinhos|previsão/i, 'nada da pendência pode vazar no assunto novo');
  } finally {
    if (salvo.lat !== undefined) process.env.IARA_LATITUDE = salvo.lat;
    if (salvo.lon !== undefined) process.env.IARA_LONGITUDE = salvo.lon;
    if (salvo.cid !== undefined) process.env.IARA_CIDADE = salvo.cid;
    esquecerLocal(idUsuario);
  }
});
