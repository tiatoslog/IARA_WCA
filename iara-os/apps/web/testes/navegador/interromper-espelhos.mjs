/**
 * CT-04 e CT-05 — submit repetido e "parar", medidos NO NAVEGADOR.
 *
 * As duas linhas do contrato que a primeira entrega do CC-01 declarou como
 * lacuna. Elas não são detalhe: são justamente os casos em que a correção da
 * fila poderia ter destruído comportamento bom.
 *
 *   CT-04 — a mesma tela manda de novo antes da resposta. Isto TEM de continuar
 *           preemptando: a pessoa se corrigiu, e a resposta velha não interessa.
 *   CT-05 — duas telas, e uma aperta "parar". O "parar" tem de valer só para o
 *           que é de quem apertou.
 *
 * O CT-05 aqui não precisa de um turno demorado, e isso é o achado que o tornou
 * determinístico: a FILA é a janela. Com A em voo e B esperando a vez, B aperta
 * "parar" — e o que se observa é se o turno de A sobreviveu (era ele que o
 * `cancelar()` global derrubava) e se o pedido de B saiu da fila sem virar
 * efeito no disco.
 *
 * Mesma disciplina da outra bateria: cada caso tem um portão que prova que a
 * situação sob teste ACONTECEU. Sem isso o veredito é INCONCLUSIVO, nunca PASS.
 */

import { chromium } from 'playwright';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const URL_BASE = process.env.IARA_URL ?? 'http://127.0.0.1:3077';
const RAIZ = process.env.IARA_RAIZ ?? '';
const EVIDENCIA = process.env.IARA_EVIDENCIA ?? 'test-evidence/CT-05-2026-08-16';
const MARCA = process.env.IARA_MARCA ?? 'v1';
const FASE = process.env.IARA_FASE ?? 'unica';
const TENTATIVAS = Number(process.env.IARA_TENTATIVAS ?? 4);

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const contem = (t, a) => t.toLowerCase().includes(a.toLowerCase());

/**
 * Mesmas raízes que `AgenteLocal.resolverRaiz` procura, na mesma ordem, e
 * IDÊNTICAS às da outra bateria. Duas listas diferentes para a mesma medida —
 * era o caso até a auditoria apontar — são duas réguas que um dia divergem, e
 * a que divergir vai declarar "ausente" um efeito que existe.
 */
function existeNoDisco(local, nome) {
  if (!RAIZ) return null;
  const bases =
    local === 'area_de_trabalho'
      ? [
          path.join(RAIZ, 'OneDrive', 'Área de Trabalho'),
          path.join(RAIZ, 'OneDrive', 'Desktop'),
          path.join(RAIZ, 'Desktop'),
        ]
      : [
          path.join(RAIZ, 'OneDrive', 'Documentos'),
          path.join(RAIZ, 'OneDrive', 'Documents'),
          path.join(RAIZ, 'Documents'),
        ];
  for (const b of bases) if (existsSync(path.join(b, nome))) return path.join(b, nome);
  return null;
}

const lerConversa = (page) =>
  page.$$eval('.balao', (nos) =>
    nos.map((n) => ({
      papel: n.classList.contains('operador') ? 'operador' : 'iara',
      texto: (n.textContent ?? '').trim(),
    })),
  );

async function abrirEspelho(navegador, rotulo, coletor) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await contexto.newPage();
  coletor.console[rotulo] = [];
  coletor.estagios[rotulo] = [];
  page.on('console', (m) => coletor.console[rotulo].push(`[${m.type()}] ${m.text()}`));
  /* A LINHA DO TEMPO DO ESTÁGIO, como ela chega nesta tela. É o que decide se
     o botão "parar" está disponível — e a única forma de saber se ele ficou
     indisponível por decisão da interface ou por o estado nunca ter chegado. */
  page.on('websocket', (ws) =>
    ws.on('framereceived', (f) => {
      try {
        const p = JSON.parse(typeof f.payload === 'string' ? f.payload : f.payload.toString());
        if (p.tipo === 'snapshot') coletor.estagios[rotulo].push({ em: Date.now(), estagio: p.snapshot.estagio });
      } catch {
        /* quadro que não é JSON */
      }
    }),
  );
  page.on('pageerror', (e) => coletor.console[rotulo].push(`[pageerror] ${e.message}`));
  page.setDefaultNavigationTimeout(180_000);
  page.setDefaultTimeout(120_000);
  await page.goto(URL_BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.campo-conversa');
  await page.waitForSelector('.conversa-enlace.ligado');
  return page;
}

/**
 * Digita SEM passar pela verificação de acionabilidade do Playwright.
 *
 * `page.fill` espera o elemento ficar "estável", e esta página tem um Canvas 3D
 * animando o tempo inteiro: dois envios seguidos chegaram a sair com SEIS
 * SEGUNDOS de distância, o que destruiu o CT-04 — não havia preempção nenhuma
 * para medir. O valor entra pelo setter nativo e o evento `input` é disparado
 * na mão, porque o campo é controlado pelo React e atribuir `.value` direto não
 * atualiza o estado do componente.
 */
const preparar = (page, texto) =>
  page.evaluate((t) => {
    const campo = document.querySelector('.campo-conversa');
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      'value',
    )?.set;
    setter?.call(campo, t);
    campo?.dispatchEvent(new Event('input', { bubbles: true }));
  }, texto);
const disparar = (page) =>
  page.evaluate(() => {
    document.querySelector('.cb-enviar')?.click();
    return Date.now();
  });
/**
 * O botão "parar" da barra de ações — mesmo alvo que o dedo da pessoa.
 *
 * ESPERA ELE HABILITAR antes de clicar, e isto não é conveniência de teste: o
 * botão é `disabled` enquanto a tela não recebeu o snapshot de sessão ocupada,
 * e uma pessoa não consegue apertar um botão desabilitado. Sem a espera, as
 * quatro primeiras rodadas desta bateria clicaram no vazio e o resultado saiu
 * INCONCLUSIVO — o clique acontecia antes de o servidor ter dito que havia o
 * que parar. Devolve o instante do clique, ou `null` se ele nunca habilitou.
 */
async function parar(page, teto = 3000) {
  const inicio = Date.now();
  const observado = [];
  while (Date.now() - inicio < teto) {
    const r = await page.evaluate(() => {
      const b = document.querySelector('[aria-label="Interromper a IARA"]');
      const estagio = document.querySelector('.conversa-estagio')?.textContent?.trim() ?? '(sem estagio)';
      if (!b) return { clicou: null, estado: 'ausente', estagio };
      if (b.disabled) return { clicou: null, estado: 'desabilitado', estagio };
      b.click();
      return { clicou: Date.now(), estado: 'clicado', estagio };
    });
    observado.push(`${r.estado}/${r.estagio}`);
    if (r.clicou) return { em: r.clicou, observado };
    await dorme(25);
  }
  return { em: null, observado: [...new Set(observado)] };
}

async function esperarAssentar(paginas, quieto = 4000, teto = 60_000) {
  const inicio = Date.now();
  let assinatura = '';
  let desde = Date.now();
  while (Date.now() - inicio < teto) {
    const atual = JSON.stringify(await Promise.all(paginas.map(lerConversa)));
    if (atual !== assinatura) {
      assinatura = atual;
      desde = Date.now();
    } else if (Date.now() - desde >= quieto) return;
    await dorme(500);
  }
}

async function principal() {
  mkdirSync(EVIDENCIA, { recursive: true });
  const coletor = { console: {}, estagios: {} };
  const checks = [];
  const registrar = (id, ok, detalhe) => checks.push({ id, ok, detalhe });

  const ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
  ];
  const navA = await chromium.launch({ args: ARGS });
  const navB = await chromium.launch({ args: ARGS });

  try {
    const a = await abrirEspelho(navA, 'A', coletor);
    const b = await abrirEspelho(navB, 'B', coletor);

    // -----------------------------------------------------------------------
    // CT-04 — submit repetido na MESMA tela
    // -----------------------------------------------------------------------
    let ct04 = null;
    const rodadasCt04 = [];
    for (let n = 1; n <= TENTATIVAS && !ct04; n += 1) {
      /**
       * NOMES QUE SOBREVIVEM AO PLANEJADOR.
       *
       * A primeira versão deste caso usava "Um X" e "Dois X" — e "Um" é artigo:
       * `extrairNomePasta` corta ligação inicial, a IARA respondeu "criei a
       * pasta X", o `contem(fala, "Um X")` deu zero e o portão concluiu
       * preempção onde os DOIS turnos tinham rodado até o fim. Falso verde
       * apanhado pela auditoria independente. Agora os nomes não têm palavra
       * que o planejador possa comer — e, principalmente, o portão não olha
       * mais o texto da fala.
       */
      const cortado = `Pri${MARCA}c4r${n}`;
      const vencedor = `Seg${MARCA}c4r${n}`;
      const antes = (await lerConversa(a)).length;

      await preparar(a, `Crie uma pasta chamada ${cortado} na área de trabalho`);
      await disparar(a);
      await preparar(a, `Crie uma pasta chamada ${vencedor} nos Documentos`);
      await disparar(a);
      await esperarAssentar([a]);

      const conversa = (await lerConversa(a)).slice(antes);
      const perguntas = conversa.filter((f) => f.papel === 'operador').length;
      const respostas = conversa.filter((f) => f.papel === 'iara').length;
      /**
       * O PORTÃO: duas perguntas, UMA resposta. Contagem, não substring — o
       * nome da pasta que a IARA devolve é escolha dela, e amarrar a prova ao
       * texto dela é deixar a coisa medida decidir a medida.
       */
      const houvePreempcao = perguntas === 2 && respostas === 1;
      rodadasCt04.push({ n, perguntas, respostas });
      console.log(`[ct-04 rodada ${n}] ${perguntas} pergunta(s), ${respostas} resposta(s) — preempção=${houvePreempcao}`);
      if (houvePreempcao) ct04 = { n, cortado, vencedor, perguntas, respostas };
    }
    if (ct04) {
      registrar(
        'CT-04',
        true,
        `rodada ${ct04.n}: duas perguntas e UMA resposta — o segundo pedido preemptou o primeiro`,
      );
    } else {
      registrar(
        'CT-04',
        null,
        `NÃO EXECUTADO em ${TENTATIVAS} rodadas: o primeiro turno sempre fechou antes de o segundo chegar ` +
          `(${rodadasCt04.map((r) => `${r.perguntas}p/${r.respostas}r`).join(', ')}). ` +
          `A preempção da mesma tela está provada em testes/cross-talk-espelhos.test.ts.`,
      );
    }

    // -----------------------------------------------------------------------
    // CT-05 — "parar" numa tela, com pedido da outra em voo
    // -----------------------------------------------------------------------
    let ct05 = null;
    /** Quanto tempo a tela B passou mostrando "executando" em cada rodada. */
    const janelasMedidas = [];
    for (let n = 1; n <= TENTATIVAS && !ct05; n += 1) {
      const beta = `Beta ${MARCA}c5r${n}`;
      const corteEstagio = coletor.estagios.B.length;
      /**
       * A JANELA. O turno de A precisa durar o bastante para B apertar "parar"
       * com o pedido dele ainda na fila. Criar pasta fecha em ~300 ms — rápido
       * demais. A previsão do tempo faz duas idas à rede e é o turno local mais
       * demorado que esta instância tem, sem depender de chave nenhuma.
       */
      await preparar(a, 'vai chover hoje?');
      await preparar(b, `Crie uma pasta chamada ${beta} nos Documentos`);
      const [envioA, envioB] = await Promise.all([disparar(a), disparar(b)]);
      // B desiste: o pedido dele está na fila, atrás do de A.
      const tentativaParar = await parar(b);
      const cliqueParar = tentativaParar.em;
      await esperarAssentar([a, b]);

      const conversaA = await lerConversa(a);
      const discoBeta = existeNoDisco('documentos', beta);
      const respondeuA = conversaA.some(
        (f) => f.papel === 'iara' && (contem(f.texto, 'chuva') || contem(f.texto, 'chover') || contem(f.texto, '°')),
      );

      const juntos = Math.abs(envioB - envioA) <= 300;
      /* A situação sob teste é "B apertou parar com o pedido dele ESPERANDO".
         Se Beta existe, o turno de B já tinha começado e o parar chegou tarde:
         rodada inconclusiva, tenta de novo. */
      const bEsperava = juntos && Boolean(cliqueParar) && !discoBeta;
      const doTurno = coletor.estagios.B.slice(corteEstagio);
      const linhaDoTempo = doTurno.map((e) => `+${e.em - envioB}:${e.estagio}`).join(' ');
      /* A JANELA DO BOTÃO: do primeiro "executando" que chega à tela até o
         "ocioso" seguinte. É exatamente o intervalo em que o "parar" existe
         para quem está olhando. */
      const primeiro = doTurno.find((e) => e.estagio !== 'ocioso');
      const volta = primeiro && doTurno.find((e) => e.em > primeiro.em && e.estagio === 'ocioso');
      if (primeiro && volta) janelasMedidas.push(volta.em - primeiro.em);
      console.log(`[ct-05 rodada ${n}] estágio na tela B: ${linhaDoTempo || '(nenhum snapshot)'}`);
      console.log(
        `[ct-05 rodada ${n}] desalinhamento ${Math.abs(envioB - envioA)} ms · ` +
          `parar=${cliqueParar ? `+${cliqueParar - envioB} ms` : `NÃO CLICOU [${tentativaParar.observado.join(' ')}]`} · ` +
          `Beta=${discoBeta ? 'existe' : 'ausente'} · respondeu A=${respondeuA}`,
      );
      if (bEsperava) ct05 = { n, beta, discoBeta, respondeuA, atraso_parar_ms: cliqueParar - envioB };
    }

    /**
     * NÃO EXECUTADO ≠ FALHOU, e colapsar os dois é o mesmo pecado que esta
     * bateria inteira combate pelo outro lado. Quando a janela do "parar" não
     * é alcançada, o que se sabe é que o caso NÃO FOI EXERCITADO — nada foi
     * observado sobre a correção. A medição da janela vai junto, porque é ela
     * que explica por que não foi, e é um achado por si só.
     */
    if (ct05) {
      registrar('CT-05a', true, `rodada ${ct05.n}: o "parar" de B chegou com o pedido dele ainda esperando a vez`);
      registrar(
        'CT-05b',
        Boolean(ct05.respondeuA),
        `o turno de A sobreviveu ao "parar" da outra tela: resposta de A na tela=${ct05.respondeuA}`,
      );
      registrar('CT-05c', !ct05.discoBeta, `quem desistiu não produziu efeito: ${ct05.beta}=${ct05.discoBeta ?? 'ausente'}`);
    } else {
      const janelas = janelasMedidas.length
        ? `${janelasMedidas.join(', ')} ms`
        : 'nenhuma janela de "executando" chegou à tela';
      registrar(
        'CT-05',
        null,
        `NÃO EXECUTADO em ${TENTATIVAS} rodadas. O clique CHEGOU a acontecer em parte delas — o que não deu ` +
          `foi chegar enquanto o pedido de B ainda esperava: assim que o turno de A fecha, o da fila entra ` +
          `em milissegundos, e o snapshot não distingue "trabalhando no pedido de A" de "trabalhando no ` +
          `pedido de B" (não existe estado de fila no contrato — lacuna declarada nº 3). Quem está na tela ` +
          `B não tem como saber se ainda dá tempo de desistir. Janelas de "executando" medidas: ${janelas}. ` +
          `A invariante está provada em testes/cross-talk-espelhos.test.ts; o caminho pela interface, não.`,
      );
    }

    await a.screenshot({ path: path.join(EVIDENCIA, `interromper-A-${FASE}.png`), fullPage: true });
    await b.screenshot({ path: path.join(EVIDENCIA, `interromper-B-${FASE}.png`), fullPage: true });

    const resultado = {
      fase: FASE,
      url: URL_BASE,
      raiz: RAIZ,
      ct04,
      ct05,
      conversa: { A: await lerConversa(a), B: await lerConversa(b) },
      janelas_do_botao_parar_ms: janelasMedidas,
      estagios: coletor.estagios,
      checks,
      /* Três desfechos, não dois. `null` num check é "não exercitado", e um
         relatório que o esconda dentro de FAIL ou de PASS mente das duas
         formas possíveis. */
      veredito: checks.some((c) => c.ok === false)
        ? 'FAIL'
        : checks.some((c) => c.ok === null)
          ? 'INCOMPLETO'
          : 'PASS',
    };
    /* Nome com o PREFIXO DA BATERIA. Sem ele, duas baterias na mesma pasta de
       evidência com a mesma `--fase` se sobrescrevem em silêncio — aconteceu
       com o auditor independente. Infra de evidência que apaga evidência calada
       é pior que não ter infra nenhuma. */
    writeFileSync(path.join(EVIDENCIA, `interromper-resultado-${FASE}.json`), JSON.stringify(resultado, null, 2));
    writeFileSync(
      path.join(EVIDENCIA, `interromper-console-${FASE}.log`),
      ['=== A ===', ...coletor.console.A, '', '=== B ===', ...coletor.console.B].join('\n'),
    );

    for (const c of checks) {
      const rotulo = c.ok === true ? 'PASS' : c.ok === false ? 'FAIL' : 'NÃO EXECUTADO';
      console.log(`${rotulo} ${c.id} — ${c.detalhe}`);
    }
    console.log(`\nveredito ${FASE}: ${resultado.veredito}`);
    /* 0 aprovado · 1 reprovado · 3 incompleto — quem chama distingue "provei
       que está errado" de "não consegui provar nada". */
    process.exitCode = resultado.veredito === 'PASS' ? 0 : resultado.veredito === 'FAIL' ? 1 : 3;
  } finally {
    await navA.close();
    await navB.close();
  }
}

principal().catch((e) => {
  console.error('harness quebrou:', e);
  process.exitCode = 2;
});
