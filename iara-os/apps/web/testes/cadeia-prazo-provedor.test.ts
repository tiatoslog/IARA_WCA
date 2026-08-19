/**
 * O ABANDONO POR DEMORA, testado com elos de mentira e relógio de verdade.
 *
 * Os elos são dublês porque o que se testa é a REGRA da cadeia, não a rede. Mas
 * os prazos são curtos e reais (dezenas de milissegundos): o mecanismo é um
 * `setTimeout` contra uma promessa, e um relógio falso aqui testaria o relógio
 * falso. A suíte inteira paga menos de meio segundo por isto.
 *
 * O caso que importa mais é o T4: abandono e cancelamento chegam os dois como
 * `AbortError`, e têm consequências OPOSTAS — um adianta o turno, o outro o
 * encerra. Confundi-los foi o defeito que este arquivo existe para impedir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CadeiaDeRaciocinio,
  EloDemorouDemais,
  classificarFalhaProvedor,
  mereceOutroProvedor,
  prazoDoPrimeiroPedaco,
  PRAZO_PRIMEIRO_PEDACO_PADRAO_MS,
  registrarSucessoProvedor,
  estimarTokensDoPedido,
  latenciaObservada,
  limparLatenciasObservadas,
  ordenarPorLatencia,
  registrarLatenciaProvedor,
  registrarFalhaProvedor,
  limparFalhasObservadas,
  capacidadeObservada,
  limparCapacidadesObservadas,
  registrarCapacidadeProvedor,
} from '../servidor/nucleo/CadeiaDeRaciocinio';
import { ProvedorIndisponivel, type ProvedorRaciocinio } from '../servidor/nucleo/ProvedorRaciocinio';
import { GROQ } from '../servidor/nucleo/ClienteCompativelOpenAI';
import { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';

const RESPOSTA = { tokens_entrada: 1, tokens_saida: 1, cache_lido: 0, recusado: false };

/** Um elo que demora `esperaMs` antes do primeiro pedaço. */
function eloLento(apelido: string, esperaMs: number, texto = 'ok'): ProvedorRaciocinio {
  return {
    apelido,
    origem: 'nuvem',
    modelo: `m-${apelido}`,
    disponivel: true,
    async raciocinar(pedido) {
      await new Promise((r, rejeitar) => {
        const t = setTimeout(r, esperaMs);
        pedido.sinal.addEventListener('abort', () => {
          clearTimeout(t);
          const e = new Error('abortado');
          e.name = 'AbortError';
          rejeitar(e);
        });
      });
      pedido.aoReceberTexto(texto);
      return { texto, ...RESPOSTA };
    },
  };
}

/** Um elo que falha na hora, como a openrouter com cota estourada. */
function eloQueFalha(apelido: string, mensagem: string): ProvedorRaciocinio {
  return {
    apelido,
    origem: 'nuvem',
    modelo: `m-${apelido}`,
    disponivel: true,
    async raciocinar() {
      throw new Error(mensagem);
    },
  };
}

function pedido(sinal: AbortSignal, pedacos: string[] = []) {
  return {
    mensagem: 'oi',
    historico: [],
    overridePersona: '',
    camadaGlobal: '',
    sinal,
    aoReceberTexto: (p: string) => pedacos.push(p),
  };
}

test('C1. o elo que não começa no prazo é abandonado e o próximo responde', async () => {
  /* O caso do gemini: 503 depois de 43 s. A cadeia não pode pagar isso antes de
     chegar em quem funciona. */
  const pedacos: string[] = [];
  const cadeia = new CadeiaDeRaciocinio([
    eloLento('lerdo', 5_000),
    eloLento('rapido', 5, 'resposta boa'),
  ]);
  const t0 = Date.now();
  process.env.IARA_PRAZO_PROVEDOR_MS = '60';
  const r = await cadeia.raciocinar(pedido(new AbortController().signal, pedacos));
  delete process.env.IARA_PRAZO_PROVEDOR_MS;

  assert.equal(r.texto, 'resposta boa');
  assert.deepEqual(pedacos, ['resposta boa'], 'o elo abandonado não pode ter falado');
  assert.ok(Date.now() - t0 < 2_000, 'esperou o elo lerdo inteiro em vez de abandoná-lo');
});

test('C2. elo que JÁ começou a falar nunca é cortado', async () => {
  /* Cortar no meio jogaria fora resposta que já estava chegando, e duplicaria a
     fala se o próximo respondesse. É a mesma regra do `comecouAFalar`. */
  const pedacos: string[] = [];
  const demorado: ProvedorRaciocinio = {
    apelido: 'streamer',
    origem: 'nuvem',
    modelo: 'm',
    disponivel: true,
    async raciocinar(p) {
      p.aoReceberTexto('come');
      await new Promise((r) => setTimeout(r, 200));
      p.aoReceberTexto('çou');
      return { texto: 'começou', ...RESPOSTA };
    },
  };
  process.env.IARA_PRAZO_PROVEDOR_MS = '50';
  const cadeia = new CadeiaDeRaciocinio([demorado, eloLento('reserva', 1, 'outro')]);
  const r = await cadeia.raciocinar(pedido(new AbortController().signal, pedacos));
  delete process.env.IARA_PRAZO_PROVEDOR_MS;

  assert.equal(r.texto, 'começou');
  assert.deepEqual(pedacos, ['come', 'çou']);
});

test('C3. abandono merece outro cérebro; cancelamento do operador não', async () => {
  assert.equal(mereceOutroProvedor(new EloDemorouDemais('gemini', 10_000)), true);
  const cancel = new Error('abortado');
  cancel.name = 'AbortError';
  assert.equal(mereceOutroProvedor(cancel), false);
});

test('C4. o operador cancelando encerra o turno — a cadeia não tenta o próximo', async () => {
  /**
   * O DEFEITO QUE ESTE TESTE IMPEDE: abandono e cancelamento chegam os dois como
   * `AbortError`. Se a cadeia tratasse todo abort como abandono, mandar parar
   * gastaria a cota do elo seguinte para produzir uma resposta que ninguém está
   * mais esperando.
   */
  const controle = new AbortController();
  const tentados: string[] = [];
  const espiao = (apelido: string): ProvedorRaciocinio => ({
    apelido,
    origem: 'nuvem',
    modelo: 'm',
    disponivel: true,
    async raciocinar(p) {
      tentados.push(apelido);
      await new Promise((r, rej) => {
        p.sinal.addEventListener('abort', () => {
          const e = new Error('abortado');
          e.name = 'AbortError';
          rej(e);
        });
        setTimeout(r, 5_000);
      });
      return { texto: 'x', ...RESPOSTA };
    },
  });
  process.env.IARA_PRAZO_PROVEDOR_MS = '5000';
  const cadeia = new CadeiaDeRaciocinio([espiao('a'), espiao('b')]);
  const promessa = cadeia.raciocinar(pedido(controle.signal));
  setTimeout(() => controle.abort(), 30);
  await assert.rejects(promessa);
  delete process.env.IARA_PRAZO_PROVEDOR_MS;

  assert.deepEqual(tentados, ['a'], 'o cancelamento do operador não pode escalar a cadeia');
});

test('C5. o abandono vira carência de serviço_fora, não de cancelamento', () => {
  /* `cancelado` tem carência zero: o elo seria tentado de novo no turno
     seguinte, e a cadeia pagaria os 43 s outra vez. */
  assert.equal(classificarFalhaProvedor(new EloDemorouDemais('gemini', 10_000)), 'servico_fora');
});

test('C6. a classificação do abandono é por TIPO, não por texto do prazo', () => {
  /* Com prazo de 15000 ms a mensagem contém "500" no meio do número, e o
     `/5\d{2}/` de `servico_fora` casaria por acidente. O acerto tem de vir do
     tipo, senão ele some no dia em que alguém mexer no prazo. */
  const comCincoAcidental = new EloDemorouDemais('x', 15_000);
  assert.match(comCincoAcidental.message, /500/, 'o acidente precisa existir para o teste valer');
  assert.equal(classificarFalhaProvedor(comCincoAcidental), 'servico_fora');
  assert.equal(classificarFalhaProvedor(new EloDemorouDemais('x', 10_000)), 'servico_fora');
});

test('C7. todos os elos abandonados: o erro que sobe nomeia a demora', async () => {
  process.env.IARA_PRAZO_PROVEDOR_MS = '40';
  const cadeia = new CadeiaDeRaciocinio([eloLento('a', 3_000), eloLento('b', 3_000)]);
  await assert.rejects(cadeia.raciocinar(pedido(new AbortController().signal)), (e: Error) => {
    assert.ok(e instanceof EloDemorouDemais);
    assert.match(e.message, /primeiro pedaço/);
    return true;
  });
  delete process.env.IARA_PRAZO_PROVEDOR_MS;
});

test('C8. elo que falha rápido continua sendo trocado como sempre foi', async () => {
  /* O abandono não pode ter mudado o caminho que já funcionava: cota estourada
     segue trocando de elo sem esperar prazo nenhum. */
  const cadeia = new CadeiaDeRaciocinio([
    eloQueFalha('openrouter', 'openrouter respondeu 429: rate limit exceeded'),
    eloLento('anthropic', 1, 'veio da anthropic'),
  ]);
  const r = await cadeia.raciocinar(pedido(new AbortController().signal));
  assert.equal(r.texto, 'veio da anthropic');
  registrarSucessoProvedor('openrouter');
});

test('C9. o padrão tem folga sobre o elo saudável mais lento medido', () => {
  /* Medido em 18/08/2026: anthropic entregou o primeiro pedaço em 1,4–1,9 s com
     prompt de 10.226 tokens. Um prazo apertado abandonaria provedor bom em dia
     ruim — trocar lentidão por burrice. */
  assert.ok(PRAZO_PRIMEIRO_PEDACO_PADRAO_MS >= 5 * 1_900);
  /* E corta o pior caso medido, que foi o 503 do gemini em 43,6 s. */
  assert.ok(PRAZO_PRIMEIRO_PEDACO_PADRAO_MS < 43_600);
});

test('C10. prazo sem sentido cai no padrão; prazo contaminado LEVANTA', () => {
  /**
   * Duas portas, e a diferença é da casa (ver `lerConfig` e `OrcamentoDoTurno`):
   *
   *  · `0` passa pelo registro (`^\d+$`) e significa "desligue o abandono".
   *    Desligar em silêncio é indistinguível de "nunca demorou": vale o padrão.
   *  · `-5`, `abc` e `1.5` nem chegam aqui — o registro os recusa na leitura.
   *    Valor colado errado no painel do host não vira comportamento nenhum sem
   *    ninguém saber; ele derruba a subida dizendo qual variável está errada.
   */
  for (const valor of ['0']) {
    process.env.IARA_PRAZO_PROVEDOR_MS = valor;
    assert.equal(prazoDoPrimeiroPedaco(), PRAZO_PRIMEIRO_PEDACO_PADRAO_MS, `valor ${valor}`);
  }
  for (const valor of ['-5', 'abc', '1.5']) {
    process.env.IARA_PRAZO_PROVEDOR_MS = valor;
    assert.throws(() => prazoDoPrimeiroPedaco(), /número inteiro/, `valor ${valor}`);
  }
  delete process.env.IARA_PRAZO_PROVEDOR_MS;
  assert.equal(prazoDoPrimeiroPedaco(), PRAZO_PRIMEIRO_PEDACO_PADRAO_MS);
});

test('C11. cadeia de um elo só não ganha abandono que a deixe sem cérebro', async () => {
  /* Abandonar o único elo trocaria lentidão por morte — o mesmo argumento que
     faz `ordenarPorSaude` reordenar em vez de remover. O elo é abandonado, sim,
     mas o erro que sobe diz o que houve em vez de virar silêncio. */
  process.env.IARA_PRAZO_PROVEDOR_MS = '40';
  const cadeia = new CadeiaDeRaciocinio([eloLento('unico', 2_000)]);
  await assert.rejects(cadeia.raciocinar(pedido(new AbortController().signal)), EloDemorouDemais);
  delete process.env.IARA_PRAZO_PROVEDOR_MS;
});

test('C12. ProvedorIndisponivel continua valendo troca', () => {
  assert.equal(mereceOutroProvedor(new ProvedorIndisponivel('sem chave')), true);
});

test('C13. chamador sem `sinal` não derruba a cadeia', async () => {
  /**
   * `sinal` é obrigatório no contrato e há chamador que não o passa — a bateria
   * de roteamento é um deles. A primeira versão do abandono montava
   * `AbortSignal.any([pedido.sinal, ...])` e levantava `ERR_INVALID_ARG_TYPE`
   * com `undefined` na lista: seis cenários daquela bateria caíram de uma vez.
   *
   * Uma cadeia que explode por falta de sinal é pior que a demora que ela veio
   * consertar.
   */
  const cadeia = new CadeiaDeRaciocinio([eloLento('unico', 1, 'respondeu')]);
  const semSinal = {
    mensagem: 'oi',
    historico: [],
    overridePersona: '',
    camadaGlobal: '',
    aoReceberTexto: () => {},
  } as unknown as Parameters<typeof cadeia.raciocinar>[0];
  const r = await cadeia.raciocinar(semSinal);
  assert.equal(r.texto, 'respondeu');
});

// ===========================================================================
// ROTEAMENTO POR MODELO — degrau 1: o elo que não cabe não é tentado
// ===========================================================================

test('C14. elo pequeno demais é PULADO, e quem cabe responde', async () => {
  /**
   * Medido em 18/08/2026: a Groq gratuita tem teto de 8.000 tokens por minuto e
   * o prompt de sistema da IARA custa ~5.000. Cinco chamadas seguidas deram 1 ok
   * e 4 `429 … Limit 8000, Used 5036`; um pedido maior deu `413 Request too
   * large … Requested 10226`. Tentar assim mesmo é ida à rede cuja resposta já
   * se sabe — e ela era a PRIMEIRA da fila.
   */
  const pequeno = eloLento('pequeno', 1, 'não deveria responder');
  const grande = eloLento('grande', 1, 'coube aqui');
  const cadeia = new CadeiaDeRaciocinio([
    { ...pequeno, limite_entrada_tokens: 100 } as ProvedorRaciocinio,
    grande,
  ]);
  /* ~500 caracteres → ~125 tokens estimados: não cabe em 100, cabe no sem teto. */
  const p = pedido(new AbortController().signal);
  const gordo = { ...p, overridePersona: 'x'.repeat(500) };
  const r = await cadeia.raciocinar(gordo);
  assert.equal(r.texto, 'coube aqui');
});

test('C15. sem limite declarado o elo é tentado — não medir não é recusar', async () => {
  const cadeia = new CadeiaDeRaciocinio([eloLento('sem-teto', 1, 'fui tentado')]);
  const p = pedido(new AbortController().signal);
  const r = await cadeia.raciocinar({ ...p, overridePersona: 'x'.repeat(100_000) });
  assert.equal(r.texto, 'fui tentado');
});

test('C16. se NENHUM elo cabe, a fila volta inteira — recusa provável não vira certa', async () => {
  /* "Todos os elos são pequenos demais" não pode virar "a IARA não tem cérebro
     nenhum". Mesmo argumento de `ordenarPorSaude` reordenar em vez de remover. */
  const cadeia = new CadeiaDeRaciocinio([
    { ...eloLento('a', 1, 'tentei mesmo assim'), limite_entrada_tokens: 10 } as ProvedorRaciocinio,
    { ...eloLento('b', 1, 'eu também'), limite_entrada_tokens: 10 } as ProvedorRaciocinio,
  ]);
  const p = pedido(new AbortController().signal);
  const r = await cadeia.raciocinar({ ...p, overridePersona: 'x'.repeat(4_000) });
  assert.equal(r.texto, 'tentei mesmo assim');
});

test('C17. a estimativa conta o histórico, não só a mensagem do turno', async () => {
  /* Estimar só a mensagem acertaria o turno 1 e erraria todos os seguintes —
     e é justamente ao longo da conversa que o pedido cresce até estourar. */
  const base = pedido(new AbortController().signal);
  const semHistorico = estimarTokensDoPedido(base);
  const comHistorico = estimarTokensDoPedido({
    ...base,
    historico: [{ papel: 'operador', texto: 'y'.repeat(4_000) }] as never,
  });
  assert.ok(comHistorico > semHistorico + 900, 'o histórico não entrou na conta');
});

test('C18. a estimativa erra para o lado barato: subestima', () => {
  /* Português corrido fica perto de 3 chars/token; dividir por 4 subestima de
     propósito. Subestimar custa uma ida à rede de ~150 ms; superestimar custaria
     perder um provedor gratuito que teria funcionado. */
  const p = pedido(new AbortController().signal);
  const texto = 'a'.repeat(1200);
  assert.equal(estimarTokensDoPedido({ ...p, overridePersona: texto }), Math.ceil((1200 + p.mensagem.length) / 4));
});

test('C19. o teto medido da Groq está declarado no perfil', () => {
  /* Se alguém apagar o número, a cadeia volta a tentar um elo que não cabe e
     ninguém vai notar até medir de novo. */
  assert.equal(GROQ.limite_entrada_tokens, 8000);
});

test('C20. pedido incompleto não derruba a estimativa', async () => {
  /**
   * `historico`, `overridePersona` e `camadaGlobal` são obrigatórios no contrato
   * e há chamador que não os passa. A primeira versão do estimador derrubou seis
   * cenários da bateria de roteamento com `Cannot read properties of undefined`
   * — o mesmo defeito que o `AbortSignal.any([undefined])` cometeu no abandono
   * por demora, no mesmo arquivo, dois dias antes.
   *
   * Estimativa que explode é pior que estimativa que erra baixo.
   */
  const cru = { mensagem: 'oi' } as never;
  assert.equal(estimarTokensDoPedido(cru), 1);

  const cadeia = new CadeiaDeRaciocinio([eloLento('unico', 1, 'respondeu')]);
  const r = await cadeia.raciocinar({
    mensagem: 'oi',
    aoReceberTexto: () => {},
  } as never);
  assert.equal(r.texto, 'respondeu');
});

// ===========================================================================
// ROTEAMENTO POR MODELO — degrau 2: latência MEDIDA, dentro da camada
// ===========================================================================

test('C21. a latência é medida no PRIMEIRO PEDAÇO, não no fim da resposta', async () => {
  /* É o primeiro pedaço que tira a tela do vazio. Uma resposta longa que começa
     em 1 s é melhor, para quem espera, que uma curta que começa em 10. */
  limparLatenciasObservadas();
  const demorado: ProvedorRaciocinio = {
    apelido: 'streamer',
    origem: 'nuvem',
    modelo: 'm',
    disponivel: true,
    async raciocinar(p) {
      await new Promise((r) => setTimeout(r, 40));
      p.aoReceberTexto('come');
      await new Promise((r) => setTimeout(r, 300));
      return { texto: 'começou', ...RESPOSTA };
    },
  };
  await new CadeiaDeRaciocinio([demorado]).raciocinar(pedido(new AbortController().signal));
  const m = latenciaObservada('streamer');
  assert.ok(m !== null && m < 200, `mediu ${m}ms — pegou o fim em vez do primeiro pedaço`);
});

test('C22. falha rápida NÃO conta como latência baixa', async () => {
  /**
   * Medido em 18/08/2026: o OpenRouter devolvia `429` em 46 ms. Contar falha
   * como latência faria o elo com a cota esgotada parecer o mais rápido da casa
   * e ganhar a frente da fila para sempre.
   */
  limparLatenciasObservadas();
  const cadeia = new CadeiaDeRaciocinio([
    eloQueFalha('cotaEstourada', 'openrouter respondeu 429: rate limit exceeded'),
    eloLento('bom', 30, 'respondi'),
  ]);
  await cadeia.raciocinar(pedido(new AbortController().signal));
  assert.equal(latenciaObservada('cotaEstourada'), null, 'a falha virou medição');
  assert.ok(latenciaObservada('bom') !== null);
  registrarSucessoProvedor('cotaEstourada');
});

test('C23. entre saudáveis do mesmo grupo, o mais rápido vai na frente', () => {
  limparLatenciasObservadas();
  /* A CARÊNCIA TAMBÉM: `emCarencia` agora entra no agrupamento, e o C7 deixa
     elos chamados `a` e `b` em carência de `servico_fora` por dois minutos.
     Registro de processo sem reset faz um teste medir o resíduo do anterior. */
  limparFalhasObservadas();
  registrarLatenciaProvedor('lento', 8_000);
  registrarLatenciaProvedor('rapido', 900);
  const ordem = ordenarPorLatencia([
    { apelido: 'lento' },
    { apelido: 'rapido' },
  ]).map((e) => e.apelido);
  assert.deepEqual(ordem, ['rapido', 'lento']);
});

test('C24. latência NÃO promove o premium — ela não revoga a decisão de custo', () => {
  /**
   * A ordem da cadeia carrega uma decisão de custo documentada em 18/08/2026:
   * gratuitas primeiro, Anthropic (única paga) por último. E a Anthropic é a
   * MAIS RÁPIDA — 1,4–1,9 s contra 5–44 s do Gemini naquele dia. Ordenar por
   * latência sem olhar a camada poria a paga na frente e reverteria em silêncio
   * uma decisão que alguém tomou de propósito.
   */
  limparLatenciasObservadas();
  /* A CARÊNCIA TAMBÉM: `emCarencia` agora entra no agrupamento, e o C7 deixa
     elos chamados `a` e `b` em carência de `servico_fora` por dois minutos.
     Registro de processo sem reset faz um teste medir o resíduo do anterior. */
  limparFalhasObservadas();
  registrarLatenciaProvedor('gratuito', 14_000);
  registrarLatenciaProvedor('pago', 1_500);
  const ordem = ordenarPorLatencia([
    { apelido: 'gratuito', camada: 'padrao' as const },
    { apelido: 'pago', camada: 'premium' as const },
  ]).map((e) => e.apelido);
  assert.deepEqual(ordem, ['gratuito', 'pago'], 'a latência promoveu o provedor pago');
});

test('C25. sem medição, sem opinião: o elo novo fica onde a configuração o pôs', () => {
  /* Nem promovido por otimismo, nem rebaixado por desconhecimento. */
  limparLatenciasObservadas();
  /* A CARÊNCIA TAMBÉM: `emCarencia` agora entra no agrupamento, e o C7 deixa
     elos chamados `a` e `b` em carência de `servico_fora` por dois minutos.
     Registro de processo sem reset faz um teste medir o resíduo do anterior. */
  limparFalhasObservadas();
  registrarLatenciaProvedor('medido', 5_000);
  const ordem = ordenarPorLatencia([
    { apelido: 'novo' },
    { apelido: 'medido' },
  ]).map((e) => e.apelido);
  assert.deepEqual(ordem, ['novo', 'medido']);
});

test('C26. a ordenação é DETERMINÍSTICA com medidos e não medidos misturados', () => {
  /**
   * Um comparador que devolve zero para alguns pares e não para outros deixa de
   * ser ordem total: com A sem medição, B=10 e C=5, `A vs B` e `A vs C` empatam
   * mas `B vs C` não, e o resultado passa a depender da ORDEM EM QUE o `sort`
   * compara. Fila de provedor não pode variar por detalhe do motor de JS.
   */
  limparLatenciasObservadas();
  /* A CARÊNCIA TAMBÉM: `emCarencia` agora entra no agrupamento, e o C7 deixa
     elos chamados `a` e `b` em carência de `servico_fora` por dois minutos.
     Registro de processo sem reset faz um teste medir o resíduo do anterior. */
  limparFalhasObservadas();
  registrarLatenciaProvedor('b', 10_000);
  registrarLatenciaProvedor('c', 5_000);
  const entrada = [{ apelido: 'a' }, { apelido: 'b' }, { apelido: 'c' }];
  const primeira = ordenarPorLatencia(entrada).map((e) => e.apelido);
  for (let i = 0; i < 20; i += 1) {
    assert.deepEqual(ordenarPorLatencia(entrada).map((e) => e.apelido), primeira);
  }
  /* `a` não se move; `b` e `c` trocam entre si nas posições que já ocupavam. */
  assert.deepEqual(primeira, ['a', 'c', 'b']);
});

test('C27. a mediana absorve uma ida ruim isolada', () => {
  /* Uma volta ruim não deve rebaixar um elo bom, nem uma boa promover um ruim. */
  limparLatenciasObservadas();
  limparFalhasObservadas();
  for (const ms of [900, 950, 40_000, 1_000, 980]) registrarLatenciaProvedor('oscilante', ms);
  const m = latenciaObservada('oscilante');
  assert.ok(m !== null && m < 2_000, `mediana ${m}ms — o pico dominou`);
});

test('C28. saúde vence latência: rápido e quebrado continua quebrado', async () => {
  /* "Funcionou da última vez" é sobre EXISTIR resposta; "responde rápido" é
     sobre quanto custa esperar. A segunda não pode revogar a primeira. */
  limparLatenciasObservadas();
  limparFalhasObservadas();
  registrarLatenciaProvedor('rapidoDoente', 100);
  registrarLatenciaProvedor('lentoSao', 3_000);
  registrarFalhaProvedor('rapidoDoente', new Error('quota esgotada'));

  const cadeia = new CadeiaDeRaciocinio([
    eloLento('rapidoDoente', 1, 'nao deveria'),
    eloLento('lentoSao', 1, 'eu respondo'),
  ]);
  const r = await cadeia.raciocinar(pedido(new AbortController().signal));
  assert.equal(r.texto, 'eu respondo');
  limparFalhasObservadas();
});

// ===========================================================================
// ROTEAMENTO POR MODELO — degrau 3: capacidade OBSERVADA por tarefa
// ===========================================================================

test('C29. quem já falhou em produzir plano desce na fila DE PLANO', () => {
  limparLatenciasObservadas();
  limparFalhasObservadas();
  limparCapacidadesObservadas();
  registrarCapacidadeProvedor('naoPlaneja', 'plano', false);
  registrarCapacidadeProvedor('planeja', 'plano', true);

  const fila = [{ apelido: 'naoPlaneja' }, { apelido: 'planeja' }];
  assert.deepEqual(
    ordenarPorLatencia(fila, 'plano').map((e) => e.apelido),
    ['planeja', 'naoPlaneja'],
  );
});

test('C30. a incapacidade é POR TAREFA — não contamina a outra', () => {
  /* Um elo que não devolve JSON parseável pode redigir português muito bem. */
  limparLatenciasObservadas();
  limparFalhasObservadas();
  limparCapacidadesObservadas();
  registrarCapacidadeProvedor('naoPlaneja', 'plano', false);

  const fila = [{ apelido: 'naoPlaneja' }, { apelido: 'outro' }];
  assert.deepEqual(
    ordenarPorLatencia(fila, 'resposta').map((e) => e.apelido),
    ['naoPlaneja', 'outro'],
    'a falha em planejar rebaixou o elo na fila de resposta',
  );
});

test('C31. capacidade vence latência: rápido e inútil continua inútil', () => {
  /* Um elo que não devolve JSON parseável não fica melhor por devolvê-lo
     depressa — a chamada inteira vira token gasto do mesmo jeito. */
  limparLatenciasObservadas();
  limparFalhasObservadas();
  limparCapacidadesObservadas();
  registrarLatenciaProvedor('rapidoInutil', 200);
  registrarLatenciaProvedor('lentoUtil', 4_000);
  registrarCapacidadeProvedor('rapidoInutil', 'plano', false);
  registrarCapacidadeProvedor('lentoUtil', 'plano', true);

  assert.deepEqual(
    ordenarPorLatencia([{ apelido: 'rapidoInutil' }, { apelido: 'lentoUtil' }], 'plano').map(
      (e) => e.apelido,
    ),
    ['lentoUtil', 'rapidoInutil'],
  );
});

test('C32. uma falha isolada não condena: rebaixa, nunca remove', () => {
  /* Falha de formato pode ser sorteio de temperatura. Excluir por uma amostra
     seria sobreajuste — mesma disciplina de `ordenarPorSaude`. */
  limparCapacidadesObservadas();
  registrarCapacidadeProvedor('oscilante', 'plano', false);
  assert.equal(capacidadeObservada('oscilante', 'plano'), false);
  registrarCapacidadeProvedor('oscilante', 'plano', true);
  assert.equal(capacidadeObservada('oscilante', 'plano'), true, 'não voltou ao normal ao acertar');

  const fila = [{ apelido: 'oscilante' }, { apelido: 'outro' }];
  assert.equal(ordenarPorLatencia(fila, 'plano')[0].apelido, 'oscilante', 'foi removido da fila');
});

test('C33. sem observação, sem opinião — nem para plano nem para resposta', () => {
  limparLatenciasObservadas();
  limparFalhasObservadas();
  limparCapacidadesObservadas();
  assert.equal(capacidadeObservada('desconhecido', 'plano'), null);
  const fila = [{ apelido: 'primeiro' }, { apelido: 'segundo' }];
  assert.deepEqual(
    ordenarPorLatencia(fila, 'plano').map((e) => e.apelido),
    ['primeiro', 'segundo'],
  );
});

test('C34. falha de PROVEDOR não vira incapacidade de planejar', async () => {
  /**
   * A DISTINÇÃO QUE SUSTENTA ESTA FATIA INTEIRA, e ela veio de medição:
   * 19/08/2026, os elos gratuitos falharam em planejar em 109–425 ms — rápido
   * demais para terem chegado ao modelo. Eram cota e 503, não formato. Contar
   * isso como "não sabe planejar" condenaria elos bons por problema de conta, e
   * o rebaixamento duraria o processo inteiro.
   *
   * Chegar ao registro exige que o modelo tenha RESPONDIDO algo.
   */
  limparCapacidadesObservadas();

  const queExplode = {
    apelido: 'caiu',
    origem: 'nuvem' as const,
    modelo: 'm',
    disponivel: true,
    async raciocinar() {
      throw new Error('groq respondeu 429: rate limit exceeded');
    },
  };
  const plano = await new MotorRaciocinio(queExplode).planejar(
    { bruto: 'faça duas coisas', tipo: 'comando', confianca: 0.3, ancoras: [] } as never,
    [] as never,
    new AbortController().signal,
  );
  assert.equal(plano, null);
  assert.equal(
    capacidadeObservada('caiu', 'plano'),
    null,
    'a queda do provedor foi registrada como incapacidade de formato',
  );
});

test('C35. texto que NÃO vira plano é registrado como incapacidade', async () => {
  /* O simétrico: aqui o modelo respondeu, e o que ele respondeu não serve. */
  limparCapacidadesObservadas();

  const prosa = {
    apelido: 'prosista',
    origem: 'nuvem' as const,
    modelo: 'm',
    disponivel: true,
    async raciocinar(p: { aoReceberTexto: (t: string) => void }) {
      p.aoReceberTexto('Claro! Vou te ajudar com isso, sem problema nenhum.');
      return {
        texto: 'Claro! Vou te ajudar com isso, sem problema nenhum.',
        tokens_entrada: 1,
        tokens_saida: 1,
        cache_lido: 0,
        recusado: false,
      };
    },
  };
  const plano = await new MotorRaciocinio(prosa as never).planejar(
    { bruto: 'faça duas coisas', tipo: 'comando', confianca: 0.3, ancoras: [] } as never,
    [] as never,
    new AbortController().signal,
  );
  assert.equal(plano, null);
  assert.equal(capacidadeObservada('prosista', 'plano'), false);
});

test('C36. resposta VAZIA não é incapacidade — sem texto não houve tentativa de formato', async () => {
  /**
   * O caso que a guarda `bruto.trim().length > 0` protege, e que o C34 não
   * alcança: o provedor não lança, ele devolve nada. Acontece com filtro de
   * conteúdo e com truncamento. `interpretarPlano('')` devolve `null` como
   * devolveria para prosa, e sem a guarda os dois virariam a mesma observação —
   * "não sabe planejar" — sendo que num deles o modelo não chegou a tentar.
   */
  limparCapacidadesObservadas();

  const mudo = {
    apelido: 'mudo',
    origem: 'nuvem' as const,
    modelo: 'm',
    disponivel: true,
    async raciocinar() {
      return { texto: '', tokens_entrada: 1, tokens_saida: 0, cache_lido: 0, recusado: false };
    },
  };
  const plano = await new MotorRaciocinio(mudo as never).planejar(
    { bruto: 'faça duas coisas', tipo: 'comando', confianca: 0.3, ancoras: [] } as never,
    [] as never,
    new AbortController().signal,
  );
  assert.equal(plano, null);
  assert.equal(
    capacidadeObservada('mudo', 'plano'),
    null,
    'silêncio do modelo foi contado como incapacidade de formato',
  );
});
