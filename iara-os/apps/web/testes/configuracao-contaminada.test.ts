/**
 * O INCIDENTE DE 13/08/2026, virado teste permanente.
 *
 * O que aconteceu: alguém colou duas linhas de configuração no campo de valor
 * de UMA variável no painel do host. `ANTHROPIC_API_KEY` passou a carregar a
 * chave da nuvem E o `CRON_SECRET` no mesmo valor, separados por `\n`. O SDK
 * pôs isso no cabeçalho `x-api-key`, o `Headers` recusou — e a exceção subiu
 * com a credencial inteira dentro, virou fala da IARA e apareceu na tela do
 * celular da operadora.
 *
 * O que este arquivo protege, em três camadas independentes:
 *
 *  1. DETECÇÃO — configuração contaminada é reconhecida como tal.
 *  2. RECUSA — ela não vira `false` silencioso nem valor limpo; ela levanta.
 *  3. REDAÇÃO — mesmo que um segredo escape por um caminho não mapeado, ele
 *     não atravessa a fronteira do socket.
 *
 * NENHUM VALOR REAL AQUI. Todos os segredos deste arquivo são fabricados, e o
 * prefixo `sk-ant-` dos falsos existe justamente porque o detector precisa ser
 * exercitado com algo que tem a FORMA de uma chave. Se um dia alguém colar uma
 * chave real neste arquivo, a suíte inteira vira o vazamento que ela previne.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ConfiguracaoInvalida,
  conferirAmbiente,
  configUtilizavel,
  inspecionar,
  lerConfig,
  redigir,
} from '../servidor/nucleo/kernel/Configuracao';

// Fabricados. Comprimento suficiente para passar dos pisos e nada mais.
const CHAVE_FALSA = `sk-ant-api03-${'F'.repeat(48)}`;
const CRON_FALSO = 'cron-secreto-de-mentira-0000';

// ---------------------------------------------------------------------------
// 1. Detecção — a forma exata do incidente
// ---------------------------------------------------------------------------

test('a forma exata do incidente é recusada: duas configurações num campo só', () => {
  const contaminada = `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}`;

  const p = inspecionar('ANTHROPIC_API_KEY', contaminada);
  assert.ok(p, 'a contaminação que causou o incidente precisa ser detectada');
  assert.equal(p.gravidade, 'contaminada');

  // E o motivo não pode entregar o que ele está protegendo.
  assert.ok(!p.motivo.includes(CHAVE_FALSA), 'o motivo não pode conter a chave');
  assert.ok(!p.motivo.includes(CRON_FALSO), 'o motivo não pode conter o outro segredo');
});

test('o prefixo certo não salva um valor contaminado', () => {
  // Esta é a razão de a ordem das checagens importar. A chave do incidente
  // COMEÇAVA com `sk-ant-`; um validador que só olhasse formato a aprovaria.
  const contaminada = `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}`;
  assert.ok(contaminada.startsWith('sk-ant-'), 'premissa do teste');
  assert.equal(inspecionar('ANTHROPIC_API_KEY', contaminada)?.gravidade, 'contaminada');
});

test('CR, CRLF e NUL no meio do valor são recusados igualmente', () => {
  for (const separador of ['\r', '\r\n', '\n', '\u0000', '\u001f', '\u007f']) {
    const v = `${CHAVE_FALSA}${separador}mais-coisa`;
    const p = inspecionar('ANTHROPIC_API_KEY', v);
    assert.ok(p, `separador ${JSON.stringify(separador)} deveria ser recusado`);
    assert.equal(p.gravidade, 'contaminada');
  }
});

test('o nome de qualquer outra variável conhecida dentro do valor é contaminação', () => {
  // Não é uma regra sobre CRON_SECRET. É uma regra sobre a CLASSE.
  for (const outro of ['SUPABASE_SERVICE_ROLE_KEY', 'WHATSAPP_TOKEN', 'IARA_CHAVE_PROVA']) {
    const v = `${CHAVE_FALSA} ${outro}=qualquer-coisa`;
    const p = inspecionar('ANTHROPIC_API_KEY', v);
    assert.ok(p, `${outro} embutido deveria ser recusado`);
    assert.ok(p.motivo.includes(outro), 'o motivo deve nomear a variável invasora');
  }
});

test('espaço não é separador legal de header, e mesmo assim a colagem por espaço cai', () => {
  /**
   * Detalhe que quase custou o diagnóstico: espaço É um caractere válido em
   * valor de cabeçalho HTTP. Se as duas configurações tivessem sido coladas
   * com espaço, o `Headers` teria ACEITADO e a requisição sairia com a chave
   * errada — falha silenciosa, muito pior que a barulhenta. A regra (b)/(c) é
   * o que pega esse caso, e é por isso que ela não pode depender de `\n`.
   */
  const v = `${CHAVE_FALSA} CRON_SECRET=${CRON_FALSO}`;
  assert.doesNotThrow(() => new Headers({ 'x-api-key': v }), 'premissa: o runtime aceitaria');
  assert.equal(inspecionar('ANTHROPIC_API_KEY', v)?.gravidade, 'contaminada');
});

test('a fronteira latin-1 do validador é a MESMA do runtime, nos dois sentidos', () => {
  /**
   * Medido, não suposto — e a primeira versão deste teste errou justamente por
   * supor. `ç` parece "caractere estrangeiro" e é U+00E7: cabe em latin-1, o
   * `Headers` aceita, e recusá-lo aqui criaria um falso positivo que derruba
   * deploy correto. O que o runtime recusa é código de ponto acima de 0xFF.
   *
   * As duas metades importam. Um validador mais FROUXO que o runtime deixa
   * passar o que vai explodir depois; um mais ESTRITO recusa configuração
   * legítima. Este teste prende as duas bordas.
   */
  const dentro = `${CHAVE_FALSA}ç`; // U+00E7
  assert.doesNotThrow(() => new Headers({ 'x-api-key': dentro }));
  assert.equal(inspecionar('ANTHROPIC_API_KEY', dentro), null);

  const fora = `${CHAVE_FALSA}→`; // U+2192
  assert.throws(() => new Headers({ 'x-api-key': fora }), /ByteString/i);
  assert.equal(inspecionar('ANTHROPIC_API_KEY', fora)?.gravidade, 'contaminada');
});

// ---------------------------------------------------------------------------
// 2. Ausência de falso positivo — a metade que impede a trava virar estorvo
// ---------------------------------------------------------------------------

test('valor legítimo passa, inclusive com sujeira de colagem nas pontas', () => {
  assert.equal(inspecionar('ANTHROPIC_API_KEY', CHAVE_FALSA), null);
  // Painel de host adiciona `\n` no fim o tempo todo. Isso é UM valor com
  // artefato de colagem, não DOIS valores — e recusar aqui derrubaria deploys
  // corretos, que é como uma trava de segurança acaba desligada por alguém.
  assert.equal(inspecionar('ANTHROPIC_API_KEY', `  ${CHAVE_FALSA}\r\n`), null);
  // BOM de `.env` salvo em UTF-8 com assinatura no Windows.
  assert.equal(inspecionar('ANTHROPIC_API_KEY', `﻿${CHAVE_FALSA}`), null);
});

test('lista de origens com query string não é confundida com contaminação', () => {
  // A regra (c) é restrita a segredos exatamente por isto: um valor de
  // configuração comum pode legitimamente conter `X=`.
  assert.equal(inspecionar('IARA_ORIGENS', 'https://a.com,https://b.com/x?TOKEN=1'), null);
});

test('ausente e vazio não são problema — são estados legítimos deste sistema', () => {
  assert.equal(inspecionar('ANTHROPIC_API_KEY', undefined), null);
  assert.equal(inspecionar('ANTHROPIC_API_KEY', ''), null);
  assert.equal(inspecionar('ANTHROPIC_API_KEY', '   '), null);
});

test('formato errado é malformada, não contaminada — são consertos diferentes', () => {
  const p = inspecionar('ANTHROPIC_API_KEY', `sk-proj-${'F'.repeat(48)}`);
  assert.equal(p?.gravidade, 'malformada');
  const curta = inspecionar('ANTHROPIC_API_KEY', 'sk-ant-x');
  assert.equal(curta?.gravidade, 'malformada');
});

// ---------------------------------------------------------------------------
// 3. Recusa — presença deixou de valer como validade
// ---------------------------------------------------------------------------

test('PRESENÇA NÃO É VALIDADE: chave contaminada não conta como nuvem ligada', () => {
  /**
   * A regressão mais importante do arquivo. `Boolean(env.X?.trim())` respondia
   * `true` para o valor do incidente — e era isso que fazia o motor anunciar
   * "raciocínio ONLINE" enquanto falhava em toda mensagem.
   */
  const ambiente = { ANTHROPIC_API_KEY: `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}` };

  assert.equal(Boolean(ambiente.ANTHROPIC_API_KEY.trim()), true, 'premissa: o teste velho passava');
  assert.equal(configUtilizavel('ANTHROPIC_API_KEY', ambiente), false);
});

test('lerConfig levanta em vez de limpar — e a exceção não carrega o segredo', () => {
  const ambiente = { ANTHROPIC_API_KEY: `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}` };

  assert.throws(
    () => lerConfig('ANTHROPIC_API_KEY', ambiente),
    (e: unknown) => {
      assert.ok(e instanceof ConfiguracaoInvalida);
      // Se esta asserção cair, o incidente voltou inteiro: uma exceção com a
      // credencial dentro, subindo por trinta caminhos até a tela de alguém.
      assert.ok(!e.message.includes(CHAVE_FALSA), 'a exceção não pode conter a chave');
      assert.ok(!e.message.includes(CRON_FALSO), 'a exceção não pode conter o outro segredo');
      return true;
    },
  );
});

test('lerConfig NÃO sanitiza: não existe caminho que devolva o valor "consertado"', () => {
  const ambiente = { ANTHROPIC_API_KEY: `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}` };
  let devolvido: string | null = null;
  try {
    devolvido = lerConfig('ANTHROPIC_API_KEY', ambiente);
  } catch {
    /* esperado */
  }
  // `split('\n')[0]` teria devolvido a chave — e transformado uma configuração
  // errada numa aparentemente certa, que é a correção proibida.
  assert.equal(devolvido, null);
});

test('conferirAmbiente encontra o problema e nomeia só a variável', () => {
  const problemas = conferirAmbiente({
    ANTHROPIC_API_KEY: `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}`,
    IARA_PORTA: '3000',
  });
  assert.equal(problemas.length, 1);
  assert.equal(problemas[0].variavel, 'ANTHROPIC_API_KEY');
  const tudo = JSON.stringify(problemas);
  assert.ok(!tudo.includes(CHAVE_FALSA) && !tudo.includes(CRON_FALSO));
});

test('ambiente limpo não produz problema nenhum', () => {
  assert.deepEqual(conferirAmbiente({ ANTHROPIC_API_KEY: CHAVE_FALSA, IARA_PORTA: '8787' }), []);
});

// ---------------------------------------------------------------------------
// 4. A prova da necessidade — por que detectar antes do `Headers`
// ---------------------------------------------------------------------------

test('o valor contaminado REALMENTE derruba o Headers — e nunca chega até ele', () => {
  /**
   * Este teste existe para que ninguém remova o detector achando que é
   * paranoia. A primeira metade reproduz o defeito no runtime de verdade; a
   * segunda mostra que o valor não sobrevive ao `lerConfig` para chegar lá.
   */
  const contaminada = `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}`;

  assert.throws(
    () => new Headers({ 'x-api-key': contaminada }),
    /invalid header value|Invalid header/i,
    'a premissa do incidente: o runtime recusa este valor',
  );

  assert.throws(() => lerConfig('ANTHROPIC_API_KEY', { ANTHROPIC_API_KEY: contaminada }));
});

// ---------------------------------------------------------------------------
// 5. Redação — a segunda porta
// ---------------------------------------------------------------------------

test('redigir tira do texto os segredos que ESTE processo carrega', () => {
  const ambiente = { ANTHROPIC_API_KEY: CHAVE_FALSA, CRON_SECRET: CRON_FALSO };
  const vazado = `Falhou em: Headers.append: "${CHAVE_FALSA}" e ${CRON_FALSO} é inválido`;

  const limpo = redigir(vazado, ambiente);

  assert.ok(!limpo.includes(CHAVE_FALSA));
  assert.ok(!limpo.includes(CRON_FALSO));
  assert.ok(limpo.includes('[REDIGIDO:ANTHROPIC_API_KEY]'));
  assert.ok(limpo.includes('[REDIGIDO:CRON_SECRET]'));
  // O resto da frase sobrevive: uma mensagem redigida ainda precisa ser útil
  // para quem está investigando.
  assert.ok(limpo.includes('Headers.append'));
});

test('redigir pega o valor CONTAMINADO inteiro, não só a parte normalizada', () => {
  const contaminada = `${CHAVE_FALSA}\nCRON_SECRET=${CRON_FALSO}`;
  const limpo = redigir(`erro: ${contaminada}`, { ANTHROPIC_API_KEY: contaminada });
  assert.ok(!limpo.includes(CHAVE_FALSA));
  assert.ok(!limpo.includes(CRON_FALSO));
});

test('redigir pega segredo de formato conhecido que este processo nunca teve', () => {
  // Chave de terceiro que apareceu num payload, num documento colado, num log
  // de ferramenta. O processo não a tem no ambiente e mesmo assim ela não passa.
  const alheia = `sk-ant-api03-${'Z'.repeat(40)}`;
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${'a'.repeat(20)}.${'b'.repeat(20)}`;

  const limpo = redigir(`vi isto: ${alheia} e ${jwt}`, {});
  assert.ok(!limpo.includes(alheia));
  assert.ok(!limpo.includes(jwt));
});

test('redigir não estraga texto comum nem persegue valor curto demais', () => {
  const ambiente = { CRON_SECRET: 'abc' }; // curto: abaixo do piso de 8
  const texto = 'a resposta tem abc dentro e isso não é um segredo';
  assert.equal(redigir(texto, ambiente), texto);
});

// ---------------------------------------------------------------------------
// 6. O estrangulamento — a garantia no lugar onde ela pode ser dada
// ---------------------------------------------------------------------------

test('NENHUM segredo atravessa o socket, qualquer que seja o pacote', async () => {
  /**
   * O teste que reproduz o incidente ponta a ponta. `Kernel.ts` publicava
   * `(erro as Error).message` como fala, e a mensagem daquela exceção era o
   * `Headers.append: "<a chave inteira>" is an invalid header value`.
   *
   * Corrigir aquele `catch` teria fechado UM dos trinta caminhos que fazem a
   * mesma coisa. A asserção aqui é sobre o CANAL: o que quer que um deles
   * publique, a credencial não sai. É por isso que a redação mora no
   * `SessaoOperador.enviar` e não em cada `catch`.
   */
  const CHAVE = process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY = CHAVE_FALSA;
  try {
    const { SessaoOperador } = await import('../servidor/barramento/SessaoOperador');

    const enviados: string[] = [];
    const socketFalso = {
      readyState: 1,
      bufferedAmount: 0,
      send: (dado: string) => enviados.push(dado),
    };
    const sessao = new SessaoOperador(socketFalso as never);

    // A mensagem exata da exceção do incidente, com a chave falsa no lugar.
    sessao.emitirErro(
      `Headers.append: "${CHAVE_FALSA}" is an invalid header value.`,
    );
    sessao.emitirLog('alerta', `falha ao autenticar com ${CHAVE_FALSA}`);

    // Os dois caminhos de drenagem, de propósito: `emitirErro` drena na hora,
    // `emitirLog` passa pela janela de aglutinação de 40 ms. A redação tem que
    // valer nos dois, e é justamente o segundo que o console técnico usa.
    await new Promise((r) => setTimeout(r, 120));

    assert.ok(enviados.length >= 2, `os dois pacotes precisam ter saído (saíram ${enviados.length})`);
    const tudo = enviados.join('\n');
    assert.ok(!tudo.includes(CHAVE_FALSA), 'a chave NÃO pode atravessar o socket');
    assert.ok(tudo.includes('[REDIGIDO:ANTHROPIC_API_KEY]'), 'e a marca deve aparecer no lugar');
    // O texto ao redor sobrevive: redigido continua sendo diagnosticável.
    assert.ok(tudo.includes('Headers.append'));
  } finally {
    if (CHAVE === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = CHAVE;
  }
});
