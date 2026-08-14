/**
 * Suíte de estabilização — 12/08/2026.
 *
 * Cada bloco aqui trava UM defeito estrutural encontrado na auditoria de
 * encerramento. Todos eram invisíveis para os 390 testes anteriores, e todos
 * pertencem à mesma família: **o sistema tinha o fato e não o usava**.
 *
 *   1. A cognição tinha o tempo verbal da pergunta e roteava pelo tema.
 *   2. A habilidade tinha o resultado da fonte e carimbava `resolveu: true`.
 *   3. O servidor sabia que a síntese falhara e deixava o cliente adivinhar
 *      com um timer de 6 s.
 *   4. A escuta sabia que o reconhecedor falhava em laço e nunca contava.
 *   5. A projeção sabia que a IARA estava audível e desligava a articulação.
 *
 * Se um destes quebrar, o defeito correspondente voltou.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador, extrairHorizonteClima } from '../servidor/nucleo/kernel/Planejador';
import { horizonteValido } from '../servidor/nucleo/OrquestradorAcoes';
import { consultarClima } from '../servidor/nucleo/kernel/habilidades/operacionais';
import { esquecerLocal, registrarLocal } from '../servidor/nucleo/LocalOperador';
import { visemaCorrente } from '../components/projecao/articulacao';
import { trilhaDeVisemas } from '../lib/visemas';
import type { Fala } from '../hooks/useIaraSocket';
import type { RelogioVoz } from '../hooks/useVoz';

const percepcao = new MotorPercepcao();
const planejador = new Planejador();

/** O plano determinístico que a IARA monta para uma frase. */
function planoDe(frase: string) {
  return planejador.planejar(percepcao.perceber(frase));
}

// ---------------------------------------------------------------------------
// 1. COGNIÇÃO — tema não é pergunta
//
// "Vai chover hoje?" era respondido com a condição corrente ("céu limpo, sem
// precipitação na última hora"). Dado verdadeiro, pergunta errada: quem
// perguntou sobre a tarde recebeu a medição do instante e concluiu que fora
// atendido. A âncora casava o TEMA e a receita chamava a única consulta que
// existia.
// ---------------------------------------------------------------------------

test('"vai chover hoje?" pede PREVISÃO, não a medição do instante', () => {
  assert.equal(extrairHorizonteClima('vai chover hoje?'), 'hoje');
  const plano = planoDe('vai chover hoje?');
  assert.equal(plano.passos[0].habilidade, 'consultar_clima');
  assert.equal(plano.passos[0].parametros.horizonte, 'hoje');
});

test('"está chovendo agora?" continua pedindo a medição corrente', () => {
  assert.equal(extrairHorizonteClima('está chovendo agora?'), 'agora');
  assert.equal(planoDe('está chovendo agora?').passos[0].parametros.horizonte, 'agora');
});

test('"vai chover amanhã?" lê o dia seguinte, e amanhã vence hoje', () => {
  assert.equal(extrairHorizonteClima('vai chover amanhã?'), 'amanha');
  // Quem pede "hoje e amanhã" quer o horizonte mais longo.
  assert.equal(extrairHorizonteClima('como fica o tempo hoje e amanhã?'), 'amanha');
});

test('futuro sem advérbio de dia ainda é previsão', () => {
  assert.equal(extrairHorizonteClima('qual a previsão do tempo?'), 'hoje');
  assert.equal(extrairHorizonteClima('vai fazer calor?'), 'hoje');
});

test('o passo do plano não promete radar — a fonte é modelo numérico', () => {
  for (const frase of ['vai chover hoje?', 'está chovendo?']) {
    const descricao = planoDe(frase).passos[0].descricao.toLowerCase();
    assert.ok(
      !descricao.includes('radar'),
      `"${frase}" ainda anuncia radar: "${descricao}". Open-Meteo é modelo, não radar.`,
    );
  }
});

test('a regressão de "quanto tempo" continua fechada', () => {
  // A âncora de clima não pode voltar a capturar duração — ver regressoes.test.ts.
  assert.ok(
    !percepcao.perceber('quanto tempo leva para gerar o relatório?').ancoras.includes('clima'),
  );
});

test('horizonte inválido vindo de um plano da LLM cai no padrão seguro', () => {
  // `agora` é o padrão porque é a única leitura que a IARA MEDE em vez de estimar.
  assert.equal(horizonteValido('semana que vem'), 'agora');
  assert.equal(horizonteValido(undefined), 'agora');
  assert.equal(horizonteValido(42), 'agora');
  assert.equal(horizonteValido('amanha'), 'amanha');
});

// ---------------------------------------------------------------------------
// 2. VERDADE — `resolveu` era uma constante, não uma medição
//
// `consultar_clima` devolvia `resolveu: true` INCLUSIVE no ramo em que a fonte
// externa não respondeu. A camada inteira de `Verdade.ts` — que existe para
// separar "fiz" de "provei que fiz" — estava sendo alimentada com um booleano
// que ninguém mediu.
// ---------------------------------------------------------------------------

/**
 * O clima só responde com coordenadas declaradas — sem elas a habilidade recusa
 * em vez de cair num lugar que ninguém escolheu (ver `consultarClima` em
 * `OrquestradorAcoes.ts`). Os testes daqui para baixo declaram onde estão, pela
 * mesma razão que produção precisa declarar: a previsão é DE algum lugar.
 *
 * O teste logo abaixo remove e restaura por conta própria, porque a ausência é
 * justamente o que ele mede.
 */
process.env.IARA_LATITUDE = '-22.9707';
process.env.IARA_LONGITUDE = '-46.9958';

test('a IARA NOMEIA a cidade resolvida da coordenada do aparelho', async () => {
  registrarLocal('op-nomeado', -22.9707, -46.9958);
  const fetchOriginal = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = (async (u: string) => {
    urls.push(String(u));
    if (String(u).includes('bigdatacloud')) {
      return new Response(
        JSON.stringify({ city: 'Valinhos', principalSubdivisionCode: 'BR-SP' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return new Response(
      JSON.stringify({
        current: { temperature_2m: 24, relative_humidity_2m: 60, precipitation: 0, weather_code: 0 },
        daily: {
          weather_code: [0, 0],
          temperature_2m_max: [30, 31],
          temperature_2m_min: [18, 19],
          precipitation_sum: [0, 0],
          precipitation_probability_max: [2, 3],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  const ctx = {
    parametros: { horizonte: 'hoje' },
    enunciado: 'vai chover?',
    id_usuario: 'op-nomeado',
    sessao: 'teste',
    sinal: new AbortController().signal,
    concedidas: ['rede'],
  } as unknown as Parameters<typeof consultarClima.executar>[0];
  try {
    const r = await consultarClima.executar(ctx);
    assert.ok(/Valinhos, SP/.test(r.texto), `esperava o nome da cidade; veio "${r.texto}"`);

    // O nome fica MEMORIZADO por posição: a segunda pergunta não paga outra
    // geocodificação. Sem isso, cada "vai chover?" seria uma consulta a mais
    // sobre onde a pessoa está.
    const antes = urls.filter((u) => u.includes('bigdatacloud')).length;
    await consultarClima.executar(ctx);
    const depois = urls.filter((u) => u.includes('bigdatacloud')).length;
    assert.equal(antes, 1, 'geocodificou mais de uma vez na primeira pergunta');
    assert.equal(depois, 1, 'geocodificou de novo numa posição já resolvida');
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal('op-nomeado');
  }
});

test('geocodificação fora NÃO impede a previsão nem inventa nome', async () => {
  registrarLocal('op-sem-nome', -22.9707, -46.9958);
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async (u: string) => {
    if (String(u).includes('bigdatacloud')) throw new Error('serviço de nomes fora');
    return new Response(
      JSON.stringify({
        current: { temperature_2m: 24, relative_humidity_2m: 60, precipitation: 0, weather_code: 0 },
        daily: {
          weather_code: [0, 0],
          temperature_2m_max: [30, 31],
          temperature_2m_min: [18, 19],
          precipitation_sum: [0, 0],
          precipitation_probability_max: [2, 3],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  try {
    const r = await consultarClima.executar({
      parametros: { horizonte: 'hoje' },
      enunciado: 'vai chover?',
      id_usuario: 'op-sem-nome',
      sessao: 'teste',
      sinal: new AbortController().signal,
      concedidas: ['rede'],
    } as unknown as Parameters<typeof consultarClima.executar>[0]);

    // A previsão vem da COORDENADA; o nome é rótulo. Perder o rótulo não pode
    // custar a resposta — nem virar um nome chutado.
    assert.equal(r.resolveu, true, 'perdeu a previsão por causa do nome do lugar');
    assert.ok(/onde voc[êe] est[áa]/i.test(r.texto), `inventou um nome: "${r.texto}"`);
    assert.ok(!/Valinhos|Cuiab/i.test(r.texto), `carimbou uma cidade: "${r.texto}"`);
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal('op-sem-nome');
  }
});

test('a posição do aparelho VENCE a coordenada configurada', async () => {
  // O escritório está declarado em Valinhos; a pessoa está longe dali. A
  // previsão tem de sair de onde ela está — é o caso de uso inteiro da
  // permissão de localização.
  registrarLocal('op-viajando', -23.5505, -46.6333); // São Paulo
  const fetchOriginal = globalThis.fetch;
  let urlConsultada = '';
  globalThis.fetch = (async (u: string) => {
    urlConsultada = String(u);
    return new Response(
      JSON.stringify({
        current: { temperature_2m: 19, relative_humidity_2m: 70, precipitation: 0, weather_code: 0 },
        daily: {
          weather_code: [0, 0],
          temperature_2m_max: [25, 26],
          temperature_2m_min: [15, 16],
          precipitation_sum: [0, 0],
          precipitation_probability_max: [3, 4],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as unknown as typeof fetch;
  try {
    const r = await consultarClima.executar({
      parametros: { horizonte: 'hoje' },
      enunciado: 'vai chover?',
      id_usuario: 'op-viajando',
      sessao: 'teste',
      sinal: new AbortController().signal,
      concedidas: ['rede'],
    } as unknown as Parameters<typeof consultarClima.executar>[0]);

    assert.ok(
      urlConsultada.includes('latitude=-23.5505'),
      `consultou o lugar errado: ${urlConsultada}`,
    );
    assert.ok(!urlConsultada.includes('-22.9707'), 'usou a coordenada do escritório');
    // E o rótulo acompanha: nomear "Valinhos" sobre a coordenada de São Paulo
    // repetiria, ao contrário, o defeito que essa correção existe para matar.
    assert.ok(
      /onde voc[êe] est[áa]/i.test(r.texto),
      `a resposta carimbou um nome de cidade: "${r.texto}"`,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    esquecerLocal('op-viajando');
  }
});

test('clima sem coordenadas declaradas RECUSA, em vez de chutar a cidade', async () => {
  const antes = { lat: process.env.IARA_LATITUDE, lon: process.env.IARA_LONGITUDE };
  delete process.env.IARA_LATITUDE;
  delete process.env.IARA_LONGITUDE;
  const fetchOriginal = globalThis.fetch;
  let bateuNaRede = false;
  globalThis.fetch = (async () => {
    bateuNaRede = true;
    throw new Error('não devia ter consultado nada');
  }) as typeof fetch;
  try {
    const r = await consultarClima.executar({
      parametros: { horizonte: 'hoje' },
      enunciado: 'vai chover?',
      id_usuario: 'teste',
      sessao: 'teste',
      sinal: new AbortController().signal,
      concedidas: ['rede'],
    } as unknown as Parameters<typeof consultarClima.executar>[0]);

    assert.equal(r.resolveu, false, 'sem lugar declarado não há previsão a declarar');
    assert.equal(bateuNaRede, false, 'consultou a previsão de um lugar que ninguém escolheu');
    // A recusa precisa dizer O QUE falta — quem lê isso é quem pode configurar.
    assert.ok(
      /IARA_LATITUDE/.test(r.texto),
      `a recusa devia nomear a variável ausente; veio "${r.texto}"`,
    );
  } finally {
    globalThis.fetch = fetchOriginal;
    if (antes.lat !== undefined) process.env.IARA_LATITUDE = antes.lat;
    if (antes.lon !== undefined) process.env.IARA_LONGITUDE = antes.lon;
  }
});

test('clima com a fonte externa fora NÃO se declara resolvido', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error('rede fora (simulado)');
  }) as typeof fetch;
  try {
    const r = await consultarClima.executar({
      parametros: { horizonte: 'agora' },
      enunciado: 'está chovendo?',
      id_usuario: 'teste',
      sessao: 'teste',
      sinal: new AbortController().signal,
      concedidas: ['rede'],
    } as unknown as Parameters<typeof consultarClima.executar>[0]);

    assert.equal(r.resolveu, false, 'falha de rede subiu ao Kernel como passo cumprido');
    assert.ok(
      !/consultei os radares/i.test(r.texto),
      'a IARA não pode afirmar ter consultado radar nenhum',
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('clima respondendo devolve a previsão do dia pedido, declarada como previsão', async () => {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        current: { temperature_2m: 21.2, relative_humidity_2m: 82, precipitation: 0, weather_code: 0 },
        daily: {
          weather_code: [61, 0],
          temperature_2m_max: [30, 33],
          temperature_2m_min: [21, 22],
          precipitation_sum: [12.4, 0],
          precipitation_probability_max: [88, 5],
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
  try {
    const ctx = (horizonte: string) =>
      ({
        parametros: { horizonte },
        enunciado: 'x',
        id_usuario: 'teste',
        sessao: 'teste',
        sinal: new AbortController().signal,
        concedidas: ['rede'],
      }) as unknown as Parameters<typeof consultarClima.executar>[0];

    const hoje = await consultarClima.executar(ctx('hoje'));
    assert.equal(hoje.resolveu, true);
    // 88% de probabilidade: a resposta começa pelo veredito, não pelos números.
    assert.ok(/^sim/i.test(hoje.texto), `esperava um veredito; veio "${hoje.texto}"`);
    assert.ok(/88%/.test(hoje.texto));
    assert.ok(/previs[ãa]o/i.test(hoje.texto), 'previsão precisa se declarar previsão');

    const amanha = await consultarClima.executar(ctx('amanha'));
    // 5% no dia seguinte: leu o índice 1, não o 0.
    assert.ok(/n[ãa]o chove/i.test(amanha.texto), `leu o dia errado: "${amanha.texto}"`);

    const agora = await consultarClima.executar(ctx('agora'));
    assert.ok(/21\.2/.test(agora.texto), 'a medição corrente continua saindo do bloco `current`');
    assert.ok(!/previs[ãa]o de modelo/i.test(agora.texto), 'medição não é previsão');
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ---------------------------------------------------------------------------
// 3. VOZ — o fato substitui o timer cego
//
// `voz_prevista` era `vozDisponivel()`: uma leitura da CONFIGURAÇÃO do
// servidor ("tenho voz ligada"), que o cliente lia como um fato sobre o turno
// ("o áudio desta resposta vem aí"). Quando a síntese falhava, o servidor
// sabia e não tinha como dizer — o cliente esperava 6 s cegos antes de deixar
// o navegador falar. Era metade dos ~7 s até a IARA abrir a boca.
// ---------------------------------------------------------------------------

test('o cliente não tem mais timer cego esperando o áudio do servidor', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../hooks/useVoz.ts', import.meta.url), 'utf8');
  const corpo = fonte.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(
    !/setTimeout\([^)]*6000|6000\s*\)/.test(corpo),
    'voltou uma espera fixa em useVoz: o servidor publica o fato, o cliente não adivinha',
  );
  assert.ok(
    !/esperaAudio/.test(corpo),
    'o caminho antigo do fallback agendado voltou — dois caminhos para a mesma decisão',
  );
});

test('a ponte publica a falha da síntese com a mesma pressa que o sucesso', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../servidor/barramento/PonteProjecao.ts', import.meta.url), 'utf8');
  // `if (ok && ...) this.emitir()` deixava o cliente esperando um áudio que
  // nunca vinha — o defeito que o timer de 6 s remendava do outro lado.
  assert.ok(
    !/if\s*\(\s*ok\s*&&/.test(fonte),
    'a reemissão voltou a depender do sucesso da síntese',
  );
  assert.ok(
    /vozEmVoo/.test(fonte),
    '`voz_prevista` precisa nascer do conjunto de falas em síntese, não de vozDisponivel()',
  );
});

// ---------------------------------------------------------------------------
// 4. ESCUTA — falha que se repete sem parar é silêncio disfarçado de saúde
//
// `onerror` com `network` religava a cada 2 s, para sempre, sem contador, sem
// teto e sem uma palavra ao operador. Em WebView2 e em Chromium sem a chave do
// serviço de fala isso é o estado permanente: `start()` funciona, `onstart`
// dispara, a faixa escreve "diga ei IARA", e nada nunca é reconhecido.
// ---------------------------------------------------------------------------

test('a escuta tem orçamento de falha e desiste falando', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../hooks/useEscuta.ts', import.meta.url), 'utf8');

  assert.ok(/TETO_FALHAS_SEGUIDAS/.test(fonte), 'sem teto, o religamento é infinito');
  assert.ok(
    /falhasSeguidas\.current\s*=\s*0/.test(fonte),
    'o orçamento precisa zerar num reconhecimento bem-sucedido',
  );
  // A desistência não pode ser muda: precisa escrever um motivo.
  const trechoErro = fonte.slice(fonte.indexOf('r.onerror'), fonte.indexOf('r.onend'));
  assert.ok(
    /setMotivo\(/.test(trechoErro),
    'estourar o orçamento sem `setMotivo` é a volta do laço mudo',
  );
  assert.ok(
    /setEstado\('indisponivel'\)/.test(trechoErro),
    'estourar o orçamento precisa parar a escuta, não só logar',
  );
  assert.ok(/religar/.test(fonte), 'sem nova tentativa, a desistência vira beco sem saída');
});

test('abrir a ligação publica o estado — a faixa parava de mentir', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../hooks/useEscuta.ts', import.meta.url), 'utf8');
  const alternar = fonte.slice(fonte.indexOf('const alternar'), fonte.indexOf('const alternarVigilia'));
  assert.ok(
    /if \(nova\) setEstado\('ouvindo'\)/.test(alternar),
    'com a vigília ligada o efeito não remonta: sem esta linha o estado fica preso em "vigiando" ' +
      'e a tela segue pedindo "diga ei IARA" depois de a ligação ter sido aberta pelo botão',
  );
});

// ---------------------------------------------------------------------------
// ESCUTA — dois achados da auditoria de 14/08/2026, relatados por operadora
// real: "a vigia nunca funciona, mesmo chamando 'ei iara' ela não responde
// mostrando que está escutando, e mesmo dando um comando depois, nada
// acontece". Sem harness de DOM/render neste projeto (suíte Node pura), a
// prova é de CÓDIGO — no mesmo formato dos dois testes acima.
// ---------------------------------------------------------------------------

test('religamento silencioso deixava de tocar `estado` — a faixa congelava em "vigiando"', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../hooks/useEscuta.ts', import.meta.url), 'utf8');

  // O ramo de retry (ANTES de estourar o orçamento) precisa publicar um
  // estado transitório — sem isso, a faixa "vigília ligada — diga 'ei IARA'"
  // fica na tela, palavra por palavra igual ao caso em que o microfone está
  // de fato ouvindo, durante até ~14 s de tentativas silenciosas.
  const trechoRetry = fonte.slice(
    fonte.indexOf("falhasSeguidas.current < TETO_FALHAS_SEGUIDAS"),
    fonte.indexOf('// Orçamento estourado'),
  );
  assert.ok(
    /setEstado\('reconectando'\)/.test(trechoRetry),
    'religar em silêncio sem publicar `reconectando` é a UI mentindo que está ouvindo',
  );

  // O tipo precisa admitir o novo estado, e a UI precisa poder distingui-lo
  // de `indisponivel` (que oferece "Tentar de novo") e de `vigiando`
  // (que diz "estou ouvindo de verdade").
  assert.ok(
    /'reconectando'/.test(fonte.slice(0, fonte.indexOf('export function useEscuta'))),
    'EstadoEscuta precisa declarar "reconectando" no tipo exportado',
  );
});

test('comando reconhecido que falha ao enviar não pode travar a escuta em silêncio', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../hooks/useEscuta.ts', import.meta.url), 'utf8');

  const enviarAcumulado = fonte.slice(
    fonte.indexOf('const enviarAcumulado'),
    fonte.indexOf('const rearmarSilencio'),
  );
  assert.ok(
    /cbConcluir\.current\(texto\)/.test(enviarAcumulado),
    'o resultado do envio precisa ser capturado, não descartado',
  );
  assert.ok(
    /===\s*false/.test(enviarAcumulado) && /setEstado\(ativaRef\.current \? 'ouvindo' : 'vigiando'\)/.test(enviarAcumulado),
    'envio que falha (socket fechado) precisa devolver a escuta para "ouvindo"/"vigiando" — ' +
      'sem isto, `estado` fica preso em "processando" para sempre e "nada acontece" depois do comando',
  );

  // O contrato só funciona se quem fornece `aoConcluirFala` de fato propagar
  // um booleano — `PainelConversa.tsx` encaminha o retorno de `onEnviar`
  // (que já é `boolean`), em vez de descartá-lo como antes.
  const painel = await readFile(new URL('../components/PainelConversa.tsx', import.meta.url), 'utf8');
  assert.ok(
    /aoConcluirFala:\s*\(texto\)\s*=>\s*onEnviar\(texto\)/.test(painel),
    'aoConcluirFala precisa devolver o resultado de onEnviar, não só chamá-lo',
  );
});

// ---------------------------------------------------------------------------
// 5. PRESENÇA — a articulação morria no fim do TEXTO, não no fim da FALA
//
// `progresso()` devolve `null` durante toda a síntese do navegador (ela não
// tem linha do tempo). As duas projeções liam esse `null` como "não há voz" e
// paravam de articular no instante da conclusão — a boca fechava no meio da
// frase e a entidade voltava à cor de repouso enquanto a IARA falava.
// ---------------------------------------------------------------------------

const falaDeTeste = (concluida: boolean): Fala => ({
  id: 'f1',
  papel: 'iara',
  texto: 'Provavelmente não chove hoje em Cuiabá, com doze por cento de probabilidade.',
  concluida,
  iniciada_em: 0,
});

/** Síntese do navegador: audível, mas sem linha do tempo — `progresso()` null. */
const vozNavegador = (audivel: boolean, desde = 0): RelogioVoz => ({
  progresso: () => null,
  audivel: () => audivel,
  audivelDesde: () => (audivel ? desde : null),
});

test('a IARA articula durante a síntese do navegador, com o texto já concluído', () => {
  const fala = falaDeTeste(true);
  const trilha = trilhaDeVisemas(fala.texto);
  const visema = visemaCorrente(trilha, fala, vozNavegador(true), 400);
  assert.notEqual(
    visema,
    null,
    'sem isto a entidade fica em repouso e a boca fechada durante a resposta inteira',
  );
});

test('texto concluído E silêncio: aí sim a articulação para', () => {
  const fala = falaDeTeste(true);
  const trilha = trilhaDeVisemas(fala.texto);
  assert.equal(visemaCorrente(trilha, fala, vozNavegador(false), 400), null);
});

test('texto ainda chegando articula mesmo antes de sair som', () => {
  const fala = falaDeTeste(false);
  const trilha = trilhaDeVisemas(fala.texto);
  assert.notEqual(visemaCorrente(trilha, fala, vozNavegador(false), 200), null);
});

test('a cadência de leitura ancora no início da VOZ, não na abertura do turno', () => {
  const fala = falaDeTeste(true);
  const trilha = trilhaDeVisemas(fala.texto);
  // A voz começou em t=3000; em t=3050 a fala mal começou. Ancorado na abertura
  // do turno (iniciada_em = 0), 3050 ms já teria passado da trilha inteira e a
  // articulação estaria parada no fim.
  const inicio = visemaCorrente(trilha, fala, vozNavegador(true, 3000), 3050);
  const meio = visemaCorrente(trilha, fala, vozNavegador(true, 3000), 3050 + 1500);
  assert.notEqual(inicio, null);
  assert.notEqual(meio, null);
  assert.notEqual(inicio, meio, 'a articulação não avançou — a âncora voltou a ser a do turno');
});

test('o áudio do servidor continua sendo o relógio verdadeiro quando existe', () => {
  const fala = falaDeTeste(true);
  const trilha = trilhaDeVisemas(fala.texto);
  const comAudio: RelogioVoz = {
    progresso: () => 0.5,
    audivel: () => true,
    audivelDesde: () => 0,
  };
  // Metade do áudio deve cair no meio da trilha, não no fim.
  const meio = visemaCorrente(trilha, fala, comAudio, 999_999);
  assert.notEqual(meio, null);
  assert.equal(meio, trilha[Math.floor(trilha.length * 0.5)]);
});

test('fala do operador nunca articula o rosto da IARA', () => {
  const fala: Fala = { ...falaDeTeste(true), papel: 'operador' };
  const trilha = trilhaDeVisemas(fala.texto);
  assert.equal(visemaCorrente(trilha, fala, vozNavegador(true), 100), null);
});

// ---------------------------------------------------------------------------
// ARQUITETURA — uma responsabilidade, um dono
// ---------------------------------------------------------------------------

test('a decisão de articulação existe em UM lugar só', async () => {
  const { readFile } = await import('node:fs/promises');
  for (const arquivo of ['../components/projecao/ControladorFacial.ts', '../components/projecao/mapaAurora.ts']) {
    const fonte = await readFile(new URL(arquivo, import.meta.url), 'utf8');
    assert.ok(
      /visemaCorrente/.test(fonte),
      `${arquivo} precisa usar a decisão compartilhada de articulacao.ts`,
    );
    assert.ok(
      !/visemaNoProgresso/.test(fonte),
      `${arquivo} voltou a ter cópia própria da regra — foi assim que o mesmo defeito viveu em dois lugares`,
    );
  }
});

test('a síntese do servidor reusa a conexão em vez de abrir uma por fala', async () => {
  const { readFile } = await import('node:fs/promises');
  const fonte = await readFile(new URL('../servidor/nucleo/Voz.ts', import.meta.url), 'utf8');
  // Medido em 12/08: conexão nova custa 2515–3343 ms; reusada, 499–746 ms.
  assert.ok(/conexaoViva/.test(fonte), 'o pool de conexão de síntese sumiu');
  assert.ok(
    /descartarConexao\(\)/.test(fonte),
    'socket em estado desconhecido precisa ser descartado, nunca reusado',
  );
  const buscarEdge = fonte.slice(fonte.indexOf('async function buscarEdge'));
  assert.ok(
    !/new MsEdgeTTS\(\)/.test(buscarEdge),
    'voltou a abrir uma conexão por fala — ~2,4 s de latência por resposta',
  );
});
