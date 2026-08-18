/**
 * PRODUCT FUNCTIONALITY GATE — "uma pessoa consegue conversar com a IARA agora?"
 *
 * POR QUE ISTO EXISTE, e a frase é da operadora (18/08/2026): "nenhum teste
 * verde de código pode ser interpretado como prova de que a IARA funciona".
 *
 * Ela estava certa, e o caso é documentado. Em 18/08/2026 a suíte fechou
 * 1436/1436 enquanto a operadora, na produção, recebia erro em todo pedido: a
 * Groq respondia 404 (modelo descomissionado), a cadeia desistia no primeiro elo
 * e a mensagem de degradação prometia cinco capacidades e entregava duas. Nada
 * disso era mensurável de dentro do processo, porque tudo que os testes tocavam
 * era dublê: provedor falso, âncora chamada direto, resposta nunca renderizada.
 *
 * O QUE ESTE GATE NÃO PODE FAZER, e é a regra inteira: mockar. Sem provedor
 * falso, sem runtime falso, sem resposta injetada. Ele abre um NAVEGADOR DE
 * VERDADE contra a MESMA infraestrutura que a operadora usa, autentica como
 * ela, digita como ela e só considera um turno respondido quando o texto
 * APARECEU NA TELA. HTTP 200 não é prova. JSON de API não é prova. "o provedor
 * respondeu" não é prova. A prova é a pessoa ter visto.
 *
 * A ESCALA DE UM TURNO — três estados, nunca dois:
 *
 *   REAL       respondeu com conteúdo de verdade;
 *   DEGRADADO  recusou HONESTAMENTE (a nuvem caiu e ela disse isso);
 *   FALHA      nada apareceu, estourou o prazo, ou vazou erro técnico ao usuário.
 *
 * DEGRADADO não é FALHA, e a distinção é o coração do gate. Uma IARA sem
 * crédito que diz "estou sem crédito, mas faço isto aqui" está FUNCIONANDO —
 * desde que o "isto aqui" seja verdade. Por isso todo turno declarado
 * `exige_real` é uma capacidade que a mensagem de degradação PROMETE: se ela
 * promete e não entrega, o gate reprova, e foi exatamente esse o defeito que
 * nenhuma das 1436 pegou.
 *
 * CREDENCIAL VEM DO AMBIENTE, nunca do arquivo e nunca de argumento — argumento
 * fica no histórico do shell e na lista de processos.
 *
 *   IARA_GATE_EMAIL=...  IARA_GATE_SENHA=...  \
 *     node testes/gate/produto.mjs [--url https://iara.up.railway.app] [--turnos 3]
 *
 * Requer Chromium do Playwright: `npx playwright install chromium`.
 * Sai com código 1 quando reprova — é gate de release, não relatório.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..', '..');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};

const URL_BASE = arg('--url', process.env.IARA_GATE_URL ?? 'https://iara.up.railway.app');
const EMAIL = process.env.IARA_GATE_EMAIL;
const SENHA = process.env.IARA_GATE_SENHA;
const MOSTRAR = process.argv.includes('--mostrar');

/** Prazo de um turno. Acima disto o operador já desistiu — medido, não achado:
 *  a busca na internet em produção levou 18 s no pior caso observado. */
const PRAZO_MS = Number(arg('--prazo', '45000'));

/**
 * O ROTEIRO. A ordem não é decorativa: a saudação vem primeiro porque é o
 * primeiro contato de qualquer pessoa, e as capacidades prometidas vêm em
 * seguida porque é nelas que a promessa é cobrada.
 *
 * `exige_real: true` significa "a IARA anuncia isto na mensagem de degradação".
 * Manter esta lista em pé com `CAPACIDADES_SEM_NUVEM` é o ponto: se alguém
 * acrescentar uma capacidade à frase sem receita que a atenda, este arquivo é
 * onde a mentira aparece.
 */
/**
 * OS ORACLES — "respondeu" não é "funcionou".
 *
 * O CASO QUE OS CRIOU (operadora, 18/08/2026): perguntada a hora, a IARA
 * respondeu "São 18:29 de terça-feira, 18 de agosto de 2026" quando eram 15:31.
 * A versão anterior deste gate teria carimbado REAL e seguido em frente — veio
 * texto, em português, com data e dia da semana corretos, sem erro técnico. Tudo
 * certo, menos ser verdade.
 *
 * Um oracle é uma FONTE INDEPENDENTE da IARA. Ele não pergunta ao sistema se o
 * sistema está certo: ele sabe a resposta por outro caminho e confere. Onde não
 * existir fonte independente, não existe oracle — e o turno vale pelo que é,
 * "apareceu na tela", sem fingir que foi verificado.
 *
 * Devolve `null` quando aprova, ou a razão da reprovação.
 */
const ORACULOS = {
  /**
   * O relógio de parede de quem roda o gate. Independente de verdade: não vem do
   * servidor da IARA nem da mesma função que ela usa para formatar.
   *
   * Tolerância de 2 minutos absorve a latência do turno e a virada de minuto —
   * não absorve fuso, que é o defeito que este oracle existe para pegar (3 h).
   */
  hora: (texto) => {
    const m = texto.match(/(\d{1,2}):(\d{2})/);
    if (!m) return 'a resposta não traz hora nenhuma';

    const dito = Number(m[1]) * 60 + Number(m[2]);
    const agora = new Date();
    const ref = agora.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Sao_Paulo',
      hour12: false,
    });
    const [rh, rm] = ref.split(':').map(Number);
    const esperado = rh * 60 + rm;

    /* Distância circular: 23:59 e 00:01 distam 2 min, não 1438. */
    const bruta = Math.abs(dito - esperado);
    const dif = Math.min(bruta, 1440 - bruta);
    if (dif <= 2) return null;
    return (
      `disse ${m[0]} e o relógio de referência marca ${ref} — ` +
      `${dif} min de diferença${dif >= 170 && dif <= 190 ? ' (isto é fuso: UTC em vez de America/Sao_Paulo)' : ''}`
    );
  },

  /** A data do dia, pelo mesmo relógio independente. */
  data: (texto) => {
    const hoje = new Date()
      .toLocaleDateString('pt-BR', {
        day: 'numeric',
        month: 'long',
        timeZone: 'America/Sao_Paulo',
      })
      .toLowerCase();
    const [dia, , mes] = hoje.split(' ');
    return new RegExp(`${dia}\\s+de\\s+${mes}`, 'i').test(texto)
      ? null
      : `a resposta não menciona a data de hoje (${hoje})`;
  },

  /** Busca na web que não traz número não trouxe preço nenhum. */
  temNumero: (texto) =>
    /\d/.test(texto) ? null : 'a resposta não traz nenhum número — não houve dado, só prosa',
};

const ROTEIRO = [
  { texto: 'Olá, IARA.', exige_real: false, nota: 'primeiro contato' },
  {
    texto: 'busque na internet o preço atual do diesel S10',
    exige_real: true,
    nota: 'prometida: busca na internet',
    oraculos: ['temNumero'],
  },
  {
    texto: 'quantas centrais ativas temos em MT?',
    exige_real: true,
    nota: 'prometida: contagem da frota e das centrais',
  },
  {
    texto: 'que horas são agora?',
    exige_real: true,
    nota: 'prometida: hora e data',
    /* O turno que reprovaria o 18:29 de 18/08/2026. */
    oraculos: ['hora', 'data'],
  },
  { texto: 'vai chover hoje?', exige_real: true, nota: 'prometida: clima' },
  {
    texto: 'quanto faturamos no mês passado?',
    exige_real: false,
    nota: 'pergunta de negócio — exige raciocínio',
  },
];

/**
 * COMO SE RECONHECE UMA RECUSA HONESTA. É a única heurística de texto do gate, e
 * ela é conservadora de propósito: o que não casar aqui e vier curto demais cai
 * em FALHA, nunca em DEGRADADO. Errar para o lado severo é o comportamento certo
 * num gate de release.
 */
const RECUSA_HONESTA =
  /cota da nuvem|não é defeito, é crédito|camada de raciocínio|sobrecarregada|não está conectado|não consigo fazer isso agora/i;

/** Erro técnico que JAMAIS pode chegar ao operador — foi o que chegou em 18/08. */
const VAZAMENTO_TECNICO =
  /\{"error"|invalid_request_error|model_not_found|respondeu 4\d\d|respondeu 5\d\d|stack|undefined is not|TypeError/i;

const agora = () => new Date().toISOString();

async function principal() {
  if (!EMAIL || !SENHA) {
    console.error(
      'FALTA CREDENCIAL. Este gate autentica como a operadora, e a credencial vem do\n' +
        'ambiente para não parar no histórico do shell:\n\n' +
        '  IARA_GATE_EMAIL=... IARA_GATE_SENHA=... node testes/gate/produto.mjs\n',
    );
    process.exit(2);
  }

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error(
      'Playwright ausente. Este gate exige navegador de verdade — sem ele não há\n' +
        'prova de que a resposta chegou à TELA, que é a única prova que vale.\n\n' +
        '  npm i -D playwright && npx playwright install chromium\n',
    );
    process.exit(2);
  }

  const marca = agora().replace(/[:.]/g, '-').slice(0, 19);
  const EVIDENCIA = path.join(APP, 'test-evidence', `GATE-PRODUTO-${marca}`);
  mkdirSync(EVIDENCIA, { recursive: true });

  const navegador = await chromium.launch({ headless: !MOSTRAR });
  const contexto = await navegador.newContext({ viewport: { width: 1440, height: 900 } });
  const pagina = await contexto.newPage();

  /* O que o operador veria no console e na rede — o gate reprova por erro que
     chega ao usuário, mas registrar o resto é o que torna a falha diagnosticável
     sem reproduzir à mão. */
  const consoleErros = [];
  pagina.on('console', (m) => m.type() === 'error' && consoleErros.push(m.text().slice(0, 300)));
  pagina.on('pageerror', (e) => consoleErros.push(`pageerror: ${String(e).slice(0, 300)}`));

  const relatorio = {
    gate: 'PRODUCT FUNCTIONALITY',
    url: URL_BASE,
    inicio: agora(),
    saude_antes: null,
    saude_depois: null,
    turnos: [],
    console_erros: consoleErros,
  };

  const lerSaude = async () => {
    try {
      return await pagina.evaluate(async (u) => await fetch(`${u}/saude`).then((r) => r.json()), URL_BASE);
    } catch (e) {
      return { erro: String(e).slice(0, 200) };
    }
  };

  try {
    // ---- AUTENTICAÇÃO REAL -------------------------------------------------
    await pagina.goto(URL_BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    relatorio.saude_antes = await lerSaude();

    await pagina.fill('input[type=email]', EMAIL);
    await pagina.fill('input[type=password]', SENHA);
    await pagina.click('button[type=submit]');

    /* A sala abrir É o critério de autenticação: um 200 no POST de login não
       prova que a pessoa entrou. O campo de conversa só existe do lado de
       dentro. */
    await pagina.waitForSelector('textarea', { timeout: 60000 });
    relatorio.autenticou = true;

    // ---- OS TURNOS ---------------------------------------------------------
    for (const [i, passo] of ROTEIRO.entries()) {
      const campo = pagina.locator('textarea').first();
      await campo.click();
      await campo.fill(passo.texto);

      const bolhasAntes = await pagina.evaluate(
        () => document.querySelector('main')?.innerText.length ?? 0,
      );
      const t0 = Date.now();
      await campo.press('Enter');

      /* ESPERA PELO QUE APARECEU NA TELA, não por rede. É a diferença entre
         "o backend respondeu" e "a pessoa viu". */
      let apareceu = false;
      let texto = '';
      while (Date.now() - t0 < PRAZO_MS) {
        await pagina.waitForTimeout(500);
        const atual = await pagina.evaluate(() => document.querySelector('main')?.innerText ?? '');
        /* Cresceu além do eco da própria pergunta? Então veio resposta. */
        if (atual.length > bolhasAntes + passo.texto.length + 8) {
          const depoisDoPedido = atual.slice(atual.lastIndexOf(passo.texto) + passo.texto.length);
          if (depoisDoPedido.trim().length > 12 && !/raciocinando/i.test(depoisDoPedido.trim())) {
            apareceu = true;
            texto = depoisDoPedido.trim();
            break;
          }
        }
      }
      const ms = Date.now() - t0;

      let estado;
      if (!apareceu) estado = 'FALHA';
      else if (VAZAMENTO_TECNICO.test(texto)) estado = 'FALHA';
      else if (RECUSA_HONESTA.test(texto)) estado = 'DEGRADADO';
      else estado = 'REAL';

      /**
       * VERIFICAÇÃO SEMÂNTICA — só depois de REAL, e é o que separa "respondeu"
       * de "funcionou". Uma resposta que chegou à tela, em português, sem erro
       * técnico, e MENTINDO, é FALHA. Foi assim que "18:29" passaria por REAL.
       *
       * Não se cobra oracle de DEGRADADO: uma recusa honesta não afirma nada
       * sobre o mundo, então não há o que conferir contra o mundo.
       */
      const reprovas = [];
      if (estado === 'REAL') {
        for (const nome of passo.oraculos ?? []) {
          const motivo = ORACULOS[nome](texto);
          if (motivo) reprovas.push(`${nome}: ${motivo}`);
        }
        if (reprovas.length > 0) estado = 'FALHA';
      }

      /* A promessa cobrada: capacidade anunciada que degrada é promessa falsa. */
      const quebrouPromessa = passo.exige_real && estado !== 'REAL';

      await pagina.screenshot({ path: path.join(EVIDENCIA, `turno-${i + 1}.png`) });

      relatorio.turnos.push({
        n: i + 1,
        pedido: passo.texto,
        nota: passo.nota,
        exige_real: passo.exige_real,
        estado,
        quebrou_promessa: quebrouPromessa,
        oraculos_reprovados: reprovas,
        ms,
        dentro_do_prazo: ms <= PRAZO_MS,
        resposta: texto.slice(0, 500),
      });

      console.log(
        `  ${i + 1}. [${estado}${quebrouPromessa ? ' · PROMESSA QUEBRADA' : ''}] ${ms} ms — ${passo.texto}`,
      );
      for (const r of reprovas) console.log(`       ↳ oracle reprovou — ${r}`);
    }

    relatorio.saude_depois = await lerSaude();
  } catch (erro) {
    relatorio.erro_fatal = String(erro).slice(0, 500);
    try {
      await pagina.screenshot({ path: path.join(EVIDENCIA, 'erro-fatal.png') });
    } catch {}
  } finally {
    await navegador.close();
  }

  // ---- VEREDITO ------------------------------------------------------------
  const t = relatorio.turnos;
  const reais = t.filter((x) => x.estado === 'REAL').length;
  const degradados = t.filter((x) => x.estado === 'DEGRADADO').length;
  const falhas = t.filter((x) => x.estado === 'FALHA').length;
  const promessasQuebradas = t.filter((x) => x.quebrou_promessa).length;

  /* Conversation Success Rate: turnos que chegaram à tela sem erro técnico,
     sobre turnos tentados. DEGRADADO conta como sucesso — recusar com honestidade
     é comportamento correto, não falha de produto. */
  const taxa = t.length > 0 ? (reais + degradados) / t.length : 0;

  /**
   * REPROVA POR TRÊS MOTIVOS, e só por estes:
   *  · qualquer turno FALHA (nada na tela, prazo estourado, erro técnico vazado);
   *  · qualquer promessa quebrada (anunciou a capacidade e não entregou);
   *  · a conversa não completar 3 turnos consecutivos.
   */
  const consecutivos = (() => {
    let melhor = 0;
    let corrente = 0;
    for (const x of t) {
      if (x.estado === 'FALHA') corrente = 0;
      else melhor = Math.max(melhor, ++corrente);
    }
    return melhor;
  })();

  const aprovado =
    !relatorio.erro_fatal && falhas === 0 && promessasQuebradas === 0 && consecutivos >= 3;

  relatorio.veredito = {
    aprovado,
    reais,
    degradados,
    falhas,
    promessas_quebradas: promessasQuebradas,
    turnos_consecutivos_sem_falha: consecutivos,
    conversation_success_rate: Number(taxa.toFixed(3)),
  };
  relatorio.fim = agora();

  writeFileSync(path.join(EVIDENCIA, 'gate.json'), JSON.stringify(relatorio, null, 2));

  console.log('\n' + '='.repeat(62));
  console.log(`  REAL_USER_FUNCTIONALITY = ${aprovado ? 'PASS' : 'FAIL'}`);
  console.log('='.repeat(62));
  console.log(`  reais ${reais} · degradados ${degradados} · falhas ${falhas}`);
  console.log(`  promessas quebradas: ${promessasQuebradas}`);
  console.log(`  turnos consecutivos sem falha: ${consecutivos}`);
  console.log(`  conversation success rate: ${(taxa * 100).toFixed(1)}%`);
  if (relatorio.saude_depois?.raciocinio_falhas) {
    const f = relatorio.saude_depois.raciocinio_falhas;
    const nomes = Object.keys(f);
    console.log(
      `  cérebros com falha observada: ${nomes.length === 0 ? 'nenhum' : nomes.map((n) => `${n} (${f[n].motivo})`).join(', ')}`,
    );
  }
  console.log(`  evidência: ${EVIDENCIA}`);

  process.exit(aprovado ? 0 : 1);
}

principal().catch((e) => {
  console.error('gate quebrou antes de medir:', e);
  process.exit(2);
});
