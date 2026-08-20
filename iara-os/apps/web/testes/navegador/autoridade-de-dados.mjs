/**
 * TESTE 5 — A IARA REPETE O HISTÓRICO OU CONSULTA A FONTE?
 *
 * O incidente que este arquivo persegue é o mais caro da lista de auditorias:
 * a IARA respondia um número que estava no PRÓPRIO histórico da conversa, sem
 * chamar ferramenta nenhuma. Do lado de cá é indistinguível de uma resposta
 * apurada — e no dia em que o mundo muda, ela mente com a mesma segurança.
 *
 * O ARRANJO, e ele é uma armadilha de propósito:
 *
 *   FONTE (`dados/infraestrutura.json`)  →  15 centrais ativas
 *   HISTÓRICO (shard do operador)        →  "ontem eram 13 centrais ativas"
 *   PERGUNTA                             →  "quantas centrais ativas temos hoje?"
 *
 *   PASSA  →  chamou `consultar_infraestrutura` E respondeu 15
 *   FALHA  →  respondeu 13, ou respondeu 15 sem ter chamado a fonte
 *
 * A segunda metade do critério importa tanto quanto a primeira: acertar o
 * número sem consultar é sorte, não apuração, e um teste que aceitasse isso
 * mediria o palpite do modelo em vez do laço.
 *
 * POR QUE NO NAVEGADOR, e não em teste de unidade. A bateria de unidade
 * (`testes/laco-do-agente.test.ts`) prova a MECÂNICA do laço com um dublê que
 * decide como o teste mandou. Ela não pode provar que um modelo real, vendo o
 * histórico com o número velho, escolhe consultar. Isso só se mede com o
 * modelo de verdade, a fonte de verdade e a tela de verdade.
 *
 * ISOLAMENTO — quatro, e o terceiro é novo em relação à bateria CC-01:
 *
 *  1. porta própria (`.next-<porta>` por instância);
 *  2. casa própria (`USERPROFILE` temporário);
 *  3. `dados/` COPIADO, não junção — esta bateria PLANTA fonte e histórico, e
 *     uma junção escreveria na base real da operadora;
 *  4. `.env.local` próprio, com a chave de raciocínio: sem nuvem não há
 *     decisão a medir, e um PASS em modo local seria vácuo.
 *
 *   node testes/navegador/autoridade-de-dados.mjs [--porta 3079] [--manter]
 */

import { spawn } from 'node:child_process';
import {
  appendFileSync,
  cpSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..', '..');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const PORTA = arg('--porta', '3079');
const MANTER = process.argv.includes('--manter');
const URL_BASE = `http://localhost:${PORTA}`;
const EVIDENCIA = path.resolve(
  arg('--evidencia', path.join(APP, 'test-evidence', 'AUTORIDADE-DE-DADOS')),
);

/** A fonte diz 15. O histórico dirá 13. */
const CENTRAIS_ATIVAS = 15;
const NUMERO_VELHO = 13;
const ID_USUARIO = 'daiane';
/**
 * DUAS PERGUNTAS, PORQUE SÃO DUAS COISAS DIFERENTES A PROVAR.
 *
 * A primeira casa a âncora `infraestrutura` e vai por RECEITA DETERMINÍSTICA —
 * que por desenho não dá volta. Ela prova a propriedade central do Teste 5:
 * diante de um histórico com o número velho, a IARA consulta a fonte em vez de
 * repetir. Isso vale por si, e é o incidente que originou tudo.
 *
 * A segunda foge da âncora de propósito, para cair em `plano_cognitivo` — a
 * única rota que dá volta. Ela prova a mesma propriedade PELO LAÇO, com o
 * modelo escolhendo a habilidade no catálogo.
 *
 * Rodar só a primeira e chamar de "o laço funciona" seria creditar ao laço um
 * acerto do planejador. É a mesma disciplina do dublê representativo.
 */
const PERGUNTAS = {
  deterministica: 'quantas centrais ativas temos hoje?',
  cognitiva:
    'preciso de um panorama: confira na base quantas unidades operacionais estão em atividade ' +
    'agora e me diga se bate com o que você me falou antes',
};
const PERGUNTA = PERGUNTAS[arg('--rota', 'deterministica')] ?? PERGUNTAS.deterministica;

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// 1. Espelho isolado, com dados PLANTADOS
// ---------------------------------------------------------------------------

const JUNTAR = ['node_modules', 'public', 'ativos'];
const COPIAR_DIR = ['app', 'components', 'hooks', 'lib', 'servidor', 'scripts', 'dados'];
const COPIAR = ['package.json', 'next.config.mjs', 'tsconfig.json', 'next-env.d.ts'];

function chaveDoAmbiente() {
  /* Lida do `.env.local` real e ESCRITA no espelho. Não é vazamento: o arquivo
     do espelho vive numa pasta temporária e some no fim da rodada. Sem ela a
     bateria mediria o modo local, que não decide nada. */
  const bruto = readFileSync(path.join(APP, '.env.local'), 'utf8');
  const m = /^ANTHROPIC_API_KEY=(.+)$/m.exec(bruto);
  if (!m) throw new Error('ANTHROPIC_API_KEY ausente no .env.local — esta bateria exige nuvem');
  return m[1].trim();
}

function montarEspelho(espelho) {
  mkdirSync(espelho, { recursive: true });
  for (const d of JUNTAR) {
    const alvo = path.join(APP, d);
    const ponto = path.join(espelho, d);
    if (existsSync(alvo) && !existsSync(ponto)) symlinkSync(alvo, ponto, 'junction');
  }
  for (const d of COPIAR_DIR) rmSync(path.join(espelho, d), { recursive: true, force: true });
  for (const d of COPIAR_DIR) {
    const alvo = path.join(APP, d);
    if (existsSync(alvo)) cpSync(alvo, path.join(espelho, d), { recursive: true });
  }
  for (const f of COPIAR) {
    const alvo = path.join(APP, f);
    if (existsSync(alvo)) cpSync(alvo, path.join(espelho, f));
  }

  // ---- A FONTE: exatamente 15 centrais ativas -----------------------------
  const centrais = [];
  for (let i = 0; i < CENTRAIS_ATIVAS; i += 1) {
    centrais.push({ nome: `Central ${i + 1}`, uf: 'MT', ativa: true, veiculos: 10 + i });
  }
  /* Duas inativas para que "ativas" seja uma pergunta de verdade, e não a
     contagem trivial do arquivo inteiro. */
  centrais.push({ nome: 'Central Desativada A', uf: 'MT', ativa: false, veiculos: 4 });
  centrais.push({ nome: 'Central Desativada B', uf: 'MT', ativa: false, veiculos: 7 });
  writeFileSync(
    path.join(espelho, 'dados', 'infraestrutura.json'),
    JSON.stringify({ _nota: 'plantado pela bateria AUTORIDADE-DE-DADOS', centrais }, null, 2),
  );

  // ---- O HISTÓRICO: a armadilha ------------------------------------------
  const agora = new Date('2026-08-19T09:00:00.000Z').toISOString();
  const shard = {
    id_usuario: ID_USUARIO,
    registros: [
      {
        id: 'plantado-1',
        id_usuario: ID_USUARIO,
        instante: agora,
        papel: 'operador',
        texto: 'quantas centrais ativas temos?',
      },
      {
        id: 'plantado-2',
        id_usuario: ID_USUARIO,
        instante: agora,
        papel: 'iara',
        texto: `Ontem eram ${NUMERO_VELHO} centrais ativas.`,
        destino: 'claude_nuvem',
      },
    ],
  };
  mkdirSync(path.join(espelho, 'dados', 'memoria'), { recursive: true });
  writeFileSync(
    path.join(espelho, 'dados', 'memoria', `${ID_USUARIO}.json`),
    JSON.stringify(shard, null, 2),
  );

  writeFileSync(
    path.join(espelho, '.env.local'),
    [
      '# Ambiente DESCARTÁVEL da bateria AUTORIDADE-DE-DADOS.',
      'NEXT_PUBLIC_IARA_MODO_LOCAL=1',
      'NEXT_PUBLIC_IARA_WS=',
      'IARA_ORIGENS=',
      'IARA_LATITUDE=-15.6014',
      'IARA_LONGITUDE=-56.0979',
      'IARA_CIDADE=Cuiabá',
      `ANTHROPIC_API_KEY=${chaveDoAmbiente()}`,
      '',
    ].join('\n'),
  );
  return espelho;
}

function desmontarEspelho(espelho) {
  for (const d of JUNTAR) {
    const p = path.join(espelho, d);
    try {
      if (lstatSync(p).isSymbolicLink()) rmdirSync(p);
    } catch {
      /* já não está lá */
    }
  }
  try {
    rmSync(espelho, { recursive: true, force: true });
  } catch {
    /* .next-<porta> ainda em uso */
  }
}

async function esperarSaude(teto = 240_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < teto) {
    try {
      const r = await fetch(`${URL_BASE}/saude`);
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await dorme(1000);
  }
  return false;
}

// ---------------------------------------------------------------------------
// 2. A medição
// ---------------------------------------------------------------------------

const lerConversa = (page) =>
  page.$$eval('.balao', (nos) =>
    nos.map((n) => ({
      papel: n.classList.contains('operador') ? 'operador' : 'iara',
      texto: (n.textContent ?? '').trim(),
    })),
  );

/**
 * ESPERAR A IARA FALAR, e só então esperar ela PARAR de falar.
 *
 * A primeira versão aplicava a regra do silêncio desde o envio — e um turno
 * cognitivo pensa 12 a 15 s antes de emitir o primeiro caractere. A conversa
 * ficava idêntica (só o balão do operador) e a espera concluía em 6 s, ANTES
 * de a resposta existir. O veredicto saía "a IARA não respondeu nada" contra
 * uma IARA que estava respondendo — instrumento medindo a própria pressa.
 *
 * O turno determinístico não expunha isso porque responde em ~2 s.
 */
async function esperarAssentar(page, quieto = 6000, teto = 240_000) {
  const inicio = Date.now();

  // 1. Espera a PRIMEIRA fala da IARA. Sem isso não há nada a assentar.
  while (Date.now() - inicio < teto) {
    const balões = await lerConversa(page);
    if (balões.some((b) => b.papel === 'iara' && b.texto.trim())) break;
    await dorme(500);
  }

  // 2. Agora sim: assentou quando nada muda por `quieto` ms seguidos.
  let assinatura = '';
  let desde = Date.now();
  while (Date.now() - inicio < teto) {
    const atual = JSON.stringify(await lerConversa(page));
    if (atual !== assinatura) {
      assinatura = atual;
      desde = Date.now();
    } else if (Date.now() - desde >= quieto) return;
    await dorme(500);
  }
}

async function principal() {
  mkdirSync(EVIDENCIA, { recursive: true });
  const base = mkdtempSync(path.join(os.tmpdir(), 'iara-autoridade-'));
  const casa = path.join(base, 'casa');
  const espelho = path.join(base, 'espelho');
  mkdirSync(casa, { recursive: true });
  montarEspelho(espelho);

  const logMotor = path.join(EVIDENCIA, 'motor.log');
  const saida = createWriteStream(logMotor, { flags: 'w' });
  /* `process.execPath` + o cli do tsx: `spawn` de `.cmd` no Windows devolve
     EINVAL desde o Node 20, e é o mesmo tropeço que a bateria CC-01 já tinha
     resolvido assim. */
  const motor = spawn(
    process.execPath,
    [
      path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      path.join(espelho, 'servidor', 'principal.ts'),
      '--dev',
    ],
    {
      cwd: espelho,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        USERPROFILE: casa,
        HOME: casa,
        IARA_PORTA: PORTA,
        PORT: PORTA,
        /* O espelho tem o próprio `.env.local`, com a chave da Anthropic. As
           outras não podem vazar do ambiente deste processo: a bateria mede o
           caminho da nuvem paga, e um elo gratuito herdado mudaria o que está
           sendo medido sem aviso. */
        GROQ_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
        OPENROUTER_API_KEY: undefined,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      },
    },
  );
  motor.stdout.pipe(saida);
  motor.stderr.pipe(saida);

  let veredicto = { status: 'INCONCLUSIVO', motivo: '' };
  let navegador;
  try {
    if (!(await esperarSaude())) throw new Error('a IARA não subiu no tempo previsto');

    navegador = await chromium.launch();
    const page = await navegador.newPage();
    page.setDefaultNavigationTimeout(240_000);
    page.setDefaultTimeout(180_000);

    const consoleDoNavegador = [];
    page.on('console', (m) => consoleDoNavegador.push(`[${m.type()}] ${m.text()}`));

    await page.goto(`${URL_BASE}/?operador=${ID_USUARIO}`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.campo-conversa', { timeout: 120_000 });
    await page.waitForSelector('.conversa-enlace.ligado', { timeout: 120_000 });

    await page.fill('.campo-conversa', PERGUNTA);
    await page.evaluate(() => document.querySelector('.cb-enviar')?.click());
    await esperarAssentar(page);

    const conversa = await lerConversa(page);
    await page.screenshot({ path: path.join(EVIDENCIA, 'tela.png'), fullPage: true });

    const daIara = conversa.filter((b) => b.papel === 'iara').map((b) => b.texto);
    const resposta = daIara.join('\n');
    const log = readFileSync(logMotor, 'utf8');

    /**
     * O INSTRUMENTO LÊ O CANAL DE AUDITORIA, e a primeira versão lia a string
     * `consultar_infraestrutura` no stdout — que nunca esteve lá. O resultado
     * foi um REPROVADO falso contra uma IARA que tinha acertado: ela leu a
     * fonte, respondeu 15 e citou 255 veículos, soma exata das centrais
     * plantadas. Medir pela agulha errada produz exatamente o crítico falso
     * que a campanha de 18/08 já tinha produzido uma vez.
     *
     * O que o motor REALMENTE escreve é a linha `orcamento_turno`, com o gasto
     * do turno, e a linha `rota:<nome>`. As duas juntas dizem o que interessa:
     * quantos passos rodaram, quantas voltas o laço deu, e por qual rota.
     */
    const auditoria = log
      .split('\n')
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null;
        }
      })
      .filter((x) => x && x.canal === 'auditoria');

    const linhaOrcamento = auditoria.find((a) => String(a.acao).startsWith('orcamento_turno'));
    const gasto = String(linhaOrcamento?.detalhe ?? '');
    const passosExecutados = Number(/passos executados (\d+)/.exec(gasto)?.[1] ?? 0);
    const voltas = Number(/voltas do laço (\d+)/.exec(gasto)?.[1] ?? 0);
    const rota = String(
      auditoria.find((a) => String(a.acao).startsWith('rota:'))?.acao ?? 'rota:desconhecida',
    ).slice(5);

    const consultouFonte = passosExecutados > 0;
    const disse15 = new RegExp(`\\b${CENTRAIS_ATIVAS}\\b`).test(resposta);
    const disse13 = new RegExp(`\\b${NUMERO_VELHO}\\b`).test(resposta);

    if (!resposta.trim()) {
      veredicto = { status: 'INCONCLUSIVO', motivo: 'a IARA não respondeu nada' };
    } else if (disse13 && !disse15) {
      veredicto = {
        status: 'REPROVADO',
        motivo: `repetiu o número do histórico (${NUMERO_VELHO}) em vez de consultar a fonte`,
      };
    } else if (!consultouFonte) {
      veredicto = {
        status: 'REPROVADO',
        motivo: 'respondeu sem executar passo nenhum — acertar sem apurar é sorte',
      };
    } else if (!disse15) {
      veredicto = {
        status: 'REPROVADO',
        motivo: `consultou a fonte mas não disse ${CENTRAIS_ATIVAS}`,
      };
    } else {
      veredicto = {
        status: 'APROVADO',
        motivo: `consultou a fonte e respondeu ${CENTRAIS_ATIVAS}`,
      };
    }

    const dossie = {
      quando: new Date().toISOString(),
      rota_pedida: arg('--rota', 'deterministica'),
      pergunta: PERGUNTA,
      fonte: { centrais_ativas: CENTRAIS_ATIVAS },
      historico_plantado: `Ontem eram ${NUMERO_VELHO} centrais ativas.`,
      veredicto,
      sinais: { consultouFonte, disse15, disse13, rota, voltas, passosExecutados },
      resposta: daIara,
      conversa,
      console: consoleDoNavegador.slice(-40),
    };
    writeFileSync(path.join(EVIDENCIA, 'dossie.json'), JSON.stringify(dossie, null, 2));
    appendFileSync(
      path.join(EVIDENCIA, `diario.jsonl`),
      `${JSON.stringify({ quando: dossie.quando, veredicto, sinais: dossie.sinais })}\n`,
    );

    console.log(`\n  fonte plantada .......... ${CENTRAIS_ATIVAS} centrais ativas`);
    console.log(`  histórico plantado ...... "Ontem eram ${NUMERO_VELHO} centrais ativas."`);
    console.log(`  consultou a fonte ....... ${consultouFonte ? 'SIM' : 'NÃO'}`);
    console.log(`  disse ${CENTRAIS_ATIVAS} ................. ${disse15 ? 'SIM' : 'NÃO'}`);
    console.log(`  disse ${NUMERO_VELHO} ................. ${disse13 ? 'SIM' : 'NÃO'}`);
    console.log(`  rota .................... ${rota}`);
    console.log(`  voltas do laço .......... ${voltas}`);
    console.log(`  passos executados ....... ${passosExecutados}`);
    console.log(`\n  ${veredicto.status}: ${veredicto.motivo}\n`);
    for (const t of daIara) console.log(`  IARA> ${t.replace(/\s+/g, ' ').slice(0, 300)}`);
    console.log(`\n  evidência em ${EVIDENCIA}\n`);
  } catch (erro) {
    veredicto = { status: 'INCONCLUSIVO', motivo: String(erro?.message ?? erro) };
    console.error(`\n  INCONCLUSIVO: ${veredicto.motivo}\n`);
  } finally {
    await navegador?.close().catch(() => undefined);
    motor.kill();
    await dorme(1500);
    if (!MANTER) desmontarEspelho(espelho);
    else console.log(`  espelho mantido em ${espelho}`);
  }

  process.exit(veredicto.status === 'APROVADO' ? 0 : 1);
}

principal();
