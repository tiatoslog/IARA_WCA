/**
 * CC-01 — cross-talk entre espelhos, medido NO NAVEGADOR.
 *
 * Por que este arquivo existe, e por que ele não é um teste de unidade:
 *
 * A suíte fechou 1150/1150 com o cross-talk vivo em produção. Ela não podia
 * vê-lo: o defeito só nasce quando DUAS telas reais disputam o MESMO kernel ao
 * vivo, e um teste que constrói o kernel na mão constrói também a serialização
 * que o mundo não tem. A campanha adversarial de 16/08 alcançou o defeito, mas
 * pelo barramento WebSocket — uma camada abaixo da pessoa.
 *
 * Aqui a régua é a tela: Chromium de verdade, duas abas, texto digitado no
 * campo, clique no botão, e a leitura do que ficou escrito nos balões. O
 * oráculo do efeito é o DISCO, observado de fora do processo que executou —
 * a palavra da IARA nunca é evidência de si mesma.
 *
 * Roda contra uma instância descartável (ver `executar-navegador.ps1`): porta
 * própria, `USERPROFILE` redirecionado para uma raiz temporária, sem Supabase.
 * Nada é escrito na máquina da operadora.
 *
 * Uso:
 *   IARA_URL=http://127.0.0.1:3077 IARA_RAIZ=<raiz> IARA_EVIDENCIA=<dir> \
 *   IARA_MARCA=v1 node testes/navegador/cross-talk-espelhos.mjs
 *
 * Sai 0 quando todos os checks passam, 1 quando qualquer um falha.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const URL_BASE = process.env.IARA_URL ?? 'http://127.0.0.1:3077';
const RAIZ = process.env.IARA_RAIZ ?? '';
const EVIDENCIA = process.env.IARA_EVIDENCIA ?? 'test-evidence/CC-01-navegador';
const MARCA = process.env.IARA_MARCA ?? 'v1';
const FASE = process.env.IARA_FASE ?? 'unica';


/**
 * A JANELA DO DEFEITO.
 *
 * O CC-01 só existe enquanto o turno de A está em voo. Criar pasta é rápido —
 * na primeira tentativa desta bateria, 120 ms de defasagem já foram suficientes
 * para o turno de A fechar sozinho, os dois efeitos acontecerem, e a bateria
 * declarar PASS sem ter medido concorrência nenhuma. Um verde desses é pior que
 * um vermelho: ele afirma o que não foi testado.
 *
 * Por isso os dois cliques são AGENDADOS para o mesmo instante do relógio da
 * página, e por isso existe o CT-00: se a corrida não aconteceu, o veredito é
 * INCONCLUSIVO, nunca PASS.
 */
const TENTATIVAS = Number(process.env.IARA_TENTATIVAS ?? 5);
/** Acima disto os dois pedidos não saíram juntos, e a rodada não vale. */
const TETO_DESALINHAMENTO_MS = Number(process.env.IARA_TETO_DESALINHAMENTO ?? 300);
const TETO_RESPOSTA_MS = 90_000;

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** O oráculo de disco. Fora do processo que executou, de propósito. */
function existeNoDisco(local, nome) {
  if (!RAIZ) return null;
  const candidatos =
    local === 'area_de_trabalho'
      ? [path.join(RAIZ, 'OneDrive', 'Área de Trabalho'), path.join(RAIZ, 'OneDrive', 'Desktop'), path.join(RAIZ, 'Desktop')]
      : [path.join(RAIZ, 'OneDrive', 'Documentos'), path.join(RAIZ, 'OneDrive', 'Documents'), path.join(RAIZ, 'Documents')];
  for (const base of candidatos) {
    if (existsSync(path.join(base, nome))) return path.join(base, nome);
  }
  return null;
}

/** A conversa como a pessoa a lê: papel e texto, na ordem da tela. */
async function lerConversa(page) {
  return page.$$eval('.balao', (nos) =>
    nos.map((n) => ({
      papel: n.classList.contains('operador') ? 'operador' : 'iara',
      texto: (n.textContent ?? '').trim(),
    })),
  );
}

/**
 * UM NAVEGADOR POR ESPELHO.
 *
 * Duas abas do mesmo Chromium não servem: só uma fica em primeiro plano, e o
 * renderizador da outra é suspenso — os dois envios saíam com 1,2 s de
 * distância em TODAS as rodadas, medido, e o defeito não cabe nessa janela.
 * Processos separados é o que o caso real é, aliás: o computador e o celular da
 * mesma pessoa. A identidade continua a mesma porque o modo local resolve o
 * operador pelo padrão do seletor, não por sessão de navegador.
 */
async function abrirEspelho(navegador, rotulo, coletor) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();
  coletor.console[rotulo] = [];
  coletor.snapshots[rotulo] = [];
  page.on('console', (m) => coletor.console[rotulo].push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => coletor.console[rotulo].push(`[pageerror] ${e.message}`));
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      try {
        const p = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        /* O instante de CHEGADA é carimbado aqui, e é ele que sustenta o
           CT-00: sem relógio não há como provar que houve corrida. */
        if (p.tipo === 'snapshot') coletor.snapshots[rotulo].push({ em: Date.now(), ...p.snapshot });
      } catch {
        /* quadro que não é JSON não interessa a este teste */
      }
    });
  });

  /**
   * Teto largo de propósito: a PRIMEIRA página de um Next em dev é compilada
   * na hora do primeiro pedido, e nesta máquina isso passa dos 30 s padrão do
   * Playwright. Um teto curto aqui não mede a IARA — mede o compilador.
   */
  page.setDefaultNavigationTimeout(180_000);
  page.setDefaultTimeout(120_000);
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.campo-conversa', { timeout: 60_000 });
  await page.waitForSelector('.conversa-enlace.ligado', { timeout: 60_000 });
  return page;
}

/** Digita, sem enviar. Separado do disparo para que os dois espelhos possam
 *  estar prontos ANTES de qualquer um deles falar. */
async function preparar(page, texto) {
  await page.fill('.campo-conversa', texto);
}

/**
 * Dispara o envio e devolve o instante em que ele saiu.
 *
 * Sem `setTimeout` DE PROPÓSITO, e isto custou uma rodada inteira para
 * aparecer: das duas abas, só uma está em primeiro plano, e o Chromium
 * estrangula o temporizador da outra num piso de 1 segundo. Agendar os dois
 * cliques para o mesmo instante produzia justamente o que a bateria não quer —
 * um segundo de distância entre eles, turnos sequenciais, e um PASS que não
 * mediu concorrência nenhuma. Os dois cliques saem juntos por `Promise.all`, e
 * o desalinhamento observado é registrado na evidência.
 */
function disparar(page) {
  /* `evaluate`, não `click`: o `click` do Playwright faz verificação de
     estabilidade, que espera quadros de animação — e a aba de trás não produz
     quadros. Os dois envios saíam com mais de um segundo de distância, e o
     defeito não cabe nessa janela. */
  return page.evaluate(() => {
    document.querySelector('.cb-enviar')?.click();
    return Date.now();
  });
}

/** Espera a sessão assentar: nenhuma fala nova por `quieto` ms seguidos. */
async function esperarAssentar(paginas, quieto = 4000, teto = TETO_RESPOSTA_MS) {
  const inicio = Date.now();
  let assinatura = '';
  let desde = Date.now();
  while (Date.now() - inicio < teto) {
    const atual = JSON.stringify(await Promise.all(paginas.map(lerConversa)));
    if (atual !== assinatura) {
      assinatura = atual;
      desde = Date.now();
    } else if (Date.now() - desde >= quieto) {
      return;
    }
    await dorme(500);
  }
}

const contem = (txt, agulha) => txt.toLowerCase().includes(agulha.toLowerCase());
/** As frases com que a IARA AFIRMA um efeito. Mesmo vocabulário da campanha. */
const AFIRMA_EFEITO = ['criei', 'pronto', 'está criada', 'foi criada'];
const afirmaEfeito = (t) => AFIRMA_EFEITO.some((a) => contem(t, a));

async function principal() {
  mkdirSync(EVIDENCIA, { recursive: true });
  const coletor = { console: {}, snapshots: {} };
  const ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  const navA = await chromium.launch({ args: ARGS });
  const navB = await chromium.launch({ args: ARGS });

  const checks = [];
  const registrar = (id, ok, detalhe) => checks.push({ id, ok, detalhe });

  try {
    const a = await abrirEspelho(navA, 'A', coletor);
    const b = await abrirEspelho(navB, 'B', coletor);

    const t0 = Date.now();
    /**
     * A corrida é PROCURADA, não presumida. Cada rodada usa nomes próprios, de
     * modo que a pasta de uma rodada nunca serve de prova para outra.
     */
    const rodadas = [];
    let corrida = null;
    for (let n = 1; n <= TENTATIVAS && !corrida; n += 1) {
      const marca = `${MARCA}r${n}`;
      const alfa = `Alfa ${marca}`;
      const beta = `Beta ${marca}`;
      const corte = coletor.snapshots.A.length;

      await preparar(a, `Crie uma pasta chamada ${alfa} na área de trabalho`);
      await preparar(b, `Crie uma pasta chamada ${beta} nos Documentos`);
      const [envioA, envioB] = await Promise.all([disparar(a), disparar(b)]);
      await esperarAssentar([a, b]);

      /**
       * HOUVE CORRIDA? O pedido de B saiu ANTES de a resposta sobre a pasta de
       * A ficar concluída na tela de A. Se a resposta de A já tinha fechado, os
       * dois turnos foram sequenciais e esta rodada não mediu concorrência.
       * Turno de A cancelado (a marca do defeito) não produz fala nenhuma sobre
       * a pasta de A — e isso também é corrida.
       */
      const depois = coletor.snapshots.A.slice(corte);
      const falaDeA = depois.find((s) => s.fala?.concluida && contem(s.fala.texto, alfa));
      /**
       * Corrida VÁLIDA exige as duas coisas: os pedidos saíram juntos, e o
       * segundo chegou antes de o primeiro ter respondido. Sem o teto de
       * desalinhamento, uma rodada em que a máquina engasgou por um segundo
       * inteiro passaria por concorrência só porque o turno também demorou —
       * e a evidência viraria coincidência.
       */
      const juntos = Math.abs(envioB - envioA) <= TETO_DESALINHAMENTO_MS;
      const houveCorrida = juntos && (!falaDeA || envioB < falaDeA.em);
      const rodada = {
        n,
        marca,
        envio_a: envioA,
        envio_b: envioB,
        desalinhamento_ms: Math.abs(envioB - envioA),
        fala_de_a_concluida_em: falaDeA?.em ?? null,
        houve_corrida: houveCorrida,
      };
      rodadas.push(rodada);
      console.log(
        `[rodada ${n}] desalinhamento ${rodada.desalinhamento_ms} ms · corrida=${houveCorrida}`,
      );
      if (houveCorrida) corrida = { ...rodada, alfa, beta };
    }
    const decorrido = Date.now() - t0;

    const ALFA_M = corrida?.alfa ?? `Alfa ${MARCA}r${TENTATIVAS}`;
    const BETA_M = corrida?.beta ?? `Beta ${MARCA}r${TENTATIVAS}`;

    const conversaA = await lerConversa(a);
    const conversaB = await lerConversa(b);
    await a.screenshot({ path: path.join(EVIDENCIA, `espelho-A-${FASE}.png`), fullPage: true });
    await b.screenshot({ path: path.join(EVIDENCIA, `espelho-B-${FASE}.png`), fullPage: true });

    const discoAlfa = existeNoDisco('area_de_trabalho', ALFA_M);
    const discoBeta = existeNoDisco('documentos', BETA_M);

    /**
     * CT-00 — PORTÃO. Sem corrida observada, nenhum dos outros checks fala
     * sobre concorrência, e declarar PASS seria afirmar o que não foi medido.
     */
    registrar(
      'CT-00',
      Boolean(corrida),
      corrida
        ? `corrida observada na rodada ${corrida.n} (desalinhamento ${corrida.desalinhamento_ms} ms)`
        : `nenhuma das ${TENTATIVAS} rodadas sobrepôs os turnos dentro de ${TETO_DESALINHAMENTO_MS} ms — ` +
          `resultado INCONCLUSIVO sobre concorrência: ${rodadas.map((r) => `${r.desalinhamento_ms}ms`).join(', ')}`,
    );

    const falasIaraA = conversaA.filter((f) => f.papel === 'iara');
    const ultimaIaraA = falasIaraA[falasIaraA.length - 1]?.texto ?? '';
    const respostaSobreAlfa = falasIaraA.some((f) => contem(f.texto, ALFA_M));
    const perguntaDeAVisivel = conversaA.some((f) => f.papel === 'operador' && contem(f.texto, ALFA_M));

    /**
     * CT-01. O espelho A não pode terminar mostrando, como última palavra da
     * IARA, a confirmação do pedido do OUTRO enquanto o seu próprio pedido não
     * recebeu resposta nenhuma. É exatamente a cena relatada pela campanha.
     */
    const crossTalk = !respostaSobreAlfa && afirmaEfeito(ultimaIaraA) && contem(ultimaIaraA, BETA_M);
    registrar(
      'CT-01',
      !crossTalk,
      crossTalk
        ? `o espelho A pediu "${ALFA_M}", não recebeu resposta sobre ele, e a última fala da IARA na tela dele é "${ultimaIaraA}"`
        : `o espelho A ${respostaSobreAlfa ? 'recebeu resposta sobre o próprio pedido' : 'não recebeu confirmação alheia como última fala'}`,
    );

    /** CT-02. A frase que a pessoa digitou não some da tela dela. */
    registrar(
      'CT-02',
      perguntaDeAVisivel,
      perguntaDeAVisivel
        ? 'a pergunta do espelho A continua visível na tela do espelho A'
        : 'a pergunta do espelho A desapareceu da própria tela',
    );

    /** CT-03. Nenhum pedido morre calado — o oráculo é o disco. */
    const doisEfeitos = Boolean(discoAlfa) && Boolean(discoBeta);
    registrar(
      'CT-03',
      doisEfeitos,
      `disco: ${ALFA_M}=${discoAlfa ?? 'AUSENTE'} | ${BETA_M}=${discoBeta ?? 'AUSENTE'}`,
    );

    /**
     * CT-07. O contrato: toda fala concluída da IARA declara a qual pergunta
     * responde, e esse id é de uma pergunta que a sessão viu.
     */
    const todos = [...coletor.snapshots.A, ...coletor.snapshots.B];
    const perguntasVistas = new Set(todos.map((s) => s.pergunta?.id).filter(Boolean));
    const falasConcluidas = todos.filter((s) => s.fala?.concluida).map((s) => s.fala);
    /* Endereçada: aponta para uma pergunta que a sessão viu passar. */
    const enderecadas = falasConcluidas.filter((f) => f.responde_a && perguntasVistas.has(f.responde_a));
    /* Endereço para pergunta que ninguém viu é PIOR que endereço nenhum: é uma
       afirmação que não fecha. `responde_a: null` é legítimo — recado que a
       IARA dá por conta própria não responde a pergunta alguma. */
    const enderecoOrfao = falasConcluidas.filter((f) => f.responde_a && !perguntasVistas.has(f.responde_a));
    registrar(
      'CT-07',
      enderecadas.length > 0 && enderecoOrfao.length === 0,
      falasConcluidas.length === 0
        ? 'nenhuma fala concluída chegou ao cliente — nada a verificar, e isso já é um defeito'
        : `${falasConcluidas.length} fala(s) concluída(s): ${enderecadas.length} endereçada(s), ` +
          `${enderecoOrfao.length} com endereço órfão, ` +
          `${falasConcluidas.length - enderecadas.length - enderecoOrfao.length} sem campo "responde_a"`,
    );

    const resultado = {
      fase: FASE,
      url: URL_BASE,
      raiz: RAIZ,
      marca: MARCA,
      decorrido_ms: decorrido,
      rodadas,
      corrida,
      pastas: { alfa: ALFA_M, beta: BETA_M },
      conversa: { A: conversaA, B: conversaB },
      disco: { alfa: discoAlfa, beta: discoBeta },
      snapshots_recebidos: { A: coletor.snapshots.A.length, B: coletor.snapshots.B.length },
      checks,
      veredito: checks.every((c) => c.ok) ? 'PASS' : 'FAIL',
    };

    writeFileSync(path.join(EVIDENCIA, `resultado-${FASE}.json`), JSON.stringify(resultado, null, 2));
    writeFileSync(
      path.join(EVIDENCIA, `console-${FASE}.log`),
      ['=== espelho A ===', ...coletor.console.A, '', '=== espelho B ===', ...coletor.console.B].join('\n'),
    );
    writeFileSync(
      path.join(EVIDENCIA, `snapshots-${FASE}.json`),
      JSON.stringify({ A: coletor.snapshots.A, B: coletor.snapshots.B }, null, 2),
    );

    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'} ${c.id} — ${c.detalhe}`);
    console.log(`\nveredito ${FASE}: ${resultado.veredito} (${decorrido} ms)`);
    console.log(`evidência: ${path.resolve(EVIDENCIA)}`);

    process.exitCode = resultado.veredito === 'PASS' ? 0 : 1;
  } finally {
    await navA.close();
    await navB.close();
  }
}

principal().catch((e) => {
  console.error('harness quebrou:', e);
  process.exitCode = 2;
});
