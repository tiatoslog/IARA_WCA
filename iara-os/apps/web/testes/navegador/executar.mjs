/**
 * Sobe uma IARA DESCARTÁVEL e roda a bateria de navegador contra ela.
 *
 * Três isolamentos, e nenhum deles é decoração:
 *
 *  1. PORTA PRÓPRIA — `next.config.mjs` já dá um `.next-<porta>` por instância,
 *     então esta subida não briga com o `npm run dev` de ninguém.
 *  2. CASA PRÓPRIA — `USERPROFILE` aponta para uma raiz temporária, e é ela que
 *     `AgenteLocal.resolverRaiz` enxerga como Área de Trabalho e Documentos.
 *     A bateria cria pastas de verdade, com o `mkdir` de verdade, e não encosta
 *     na máquina da operadora.
 *  3. AMBIENTE PRÓPRIO — o processo roda com `cwd` num ESPELHO do app, montado
 *     com junções do Windows. É o que permite um `.env.local` só desta bateria:
 *     tanto o `dotenv` do motor quanto o carregador do Next leem o arquivo do
 *     diretório corrente, e os dois tratam variável já definida no ambiente de
 *     maneiras diferentes — o Next considera string vazia como ausente e a
 *     sobrescreve de volta. Espelhar o diretório é o único jeito de a bateria
 *     rodar sem login sem mexer no `.env.local` de quem está trabalhando ao
 *     lado.
 *
 * Sem Supabase, sem chave de raciocínio: "criar pasta" é rota determinística, e
 * é ela que o CC-01 exercita. Turno de raciocínio aberto fica declarado como
 * lacuna no test-plan, não escondido atrás de um teste que não o mede.
 *
 *   node testes/navegador/executar.mjs [--porta 3077] [--manter]
 */

import { spawn, execFileSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, rmdirSync, writeFileSync } from 'node:fs';
import { symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(AQUI, '..', '..');

const arg = (nome, padrao) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : padrao;
};
const PORTA = arg('--porta', '3077');
const MANTER = process.argv.includes('--manter');
const MARCA = arg('--marca', `n${Date.now().toString(36).slice(-5)}`);
const FASE = arg('--fase', 'unica');
const EVIDENCIA = path.resolve(arg('--evidencia', path.join(APP, 'test-evidence', 'CC-01-2026-08-16')));

/**
 * Pesado e imutável durante a bateria: junção do Windows, nada é copiado.
 * `node_modules` sobretudo — resolver dependência por junção é o caso que todo
 * empacotador já trata (é o que um `npm link` faz).
 */
const JUNTAR = ['node_modules', 'public', 'dados', 'ativos'];
/**
 * O CÓDIGO é copiado, e são só ~2 MB. Duas razões, nesta ordem: o webpack do
 * Next resolve junção pelo caminho real e passaria a compilar módulos de fora
 * da raiz do projeto; e uma cópia congela a árvore durante a medição, de modo
 * que uma sessão editando ao lado não muda o que está sendo medido no meio.
 */
const COPIAR_DIR = ['app', 'components', 'hooks', 'lib', 'servidor', 'scripts'];
/** Arquivos de configuração: cópia, porque o espelho precisa poder divergir. */
const COPIAR = ['package.json', 'next.config.mjs', 'tsconfig.json', 'next-env.d.ts'];

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

function montarEspelho(espelho) {
  mkdirSync(espelho, { recursive: true });
  for (const d of JUNTAR) {
    const alvo = path.join(APP, d);
    const ponto = path.join(espelho, d);
    if (existsSync(alvo) && !existsSync(ponto)) symlinkSync(alvo, ponto, 'junction');
  }
  // Código é recopiado a cada rodada: é o que faz a bateria medir a árvore de
  // AGORA, e não a de quando o espelho nasceu.
  for (const d of COPIAR_DIR) rmSync(path.join(espelho, d), { recursive: true, force: true });
  for (const d of COPIAR_DIR) {
    const alvo = path.join(APP, d);
    if (existsSync(alvo)) cpSync(alvo, path.join(espelho, d), { recursive: true });
  }
  for (const f of COPIAR) {
    const alvo = path.join(APP, f);
    if (existsSync(alvo)) cpSync(alvo, path.join(espelho, f));
  }
  /**
   * `--referencia <commit>` — a FASE "ANTES", medida contra código commitado.
   *
   * Sem isto, provar "estava quebrado" exigia desfazer a correção na árvore de
   * trabalho, com outra sessão possivelmente editando ao lado. Aqui o espelho
   * recebe a cópia da árvore de agora e, por cima, a versão daquele commit
   * APENAS dos arquivos que divergem — a árvore de trabalho não é tocada em
   * nenhum momento. É o que torna o par antes/depois comparável: mesmo harness,
   * mesma máquina, mesma casa, só o código do produto muda.
   */
  const referencia = arg('--referencia', '');
  if (referencia) {
    const git = (args) => execFileSync('git', args, { cwd: APP, encoding: 'utf8' });
    const divergentes = git(['diff', '--name-only', referencia, '--', '.'])
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    let trocados = 0;
    for (const rel of divergentes) {
      // `rel` vem relativo à raiz do repositório; só interessa o que foi copiado.
      const dentro = rel.replace(/^.*?apps\/web\//, '');
      if (!COPIAR_DIR.some((d) => dentro.startsWith(`${d}/`))) continue;
      const conteudo = git(['show', `${referencia}:${rel}`]);
      writeFileSync(path.join(espelho, dentro), conteudo);
      trocados += 1;
    }
    console.log(`[cc-01] espelho revertido para ${referencia}: ${trocados} arquivo(s)`);
  }

  writeFileSync(
    path.join(espelho, '.env.local'),
    [
      '# Ambiente DESCARTÁVEL da bateria de navegador. Sem banco, sem nuvem.',
      '# A ausência das variáveis do Supabase é o que faz a página abrir no',
      '# seletor local em vez da Portaria — ver app/page.tsx.',
      'NEXT_PUBLIC_IARA_MODO_LOCAL=1',
      'NEXT_PUBLIC_IARA_WS=',
      'IARA_ORIGENS=',
      'IARA_LATITUDE=-15.6014',
      'IARA_LONGITUDE=-56.0979',
      'IARA_CIDADE=Cuiabá',
      '',
    ].join('\n'),
  );
  return espelho;
}

/** Desmonta sem seguir junção: `rmdir` numa junção apaga o atalho, não o alvo. */
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
    /* sobra de .next-<porta> em uso — o diretório-base some junto no fim */
  }
}

async function esperarSaude(url, teto = 180_000) {
  const inicio = Date.now();
  while (Date.now() - inicio < teto) {
    try {
      const r = await fetch(`${url}/saude`);
      if (r.ok) return true;
    } catch {
      /* ainda subindo */
    }
    await dorme(1000);
  }
  return false;
}

function rodar(comando, args, opcoes) {
  return new Promise((resolve) => {
    const p = spawn(comando, args, { stdio: 'inherit', ...opcoes });
    p.on('close', (codigo) => resolve(codigo ?? 1));
  });
}

async function principal() {
  /**
   * A CASA é nova a cada rodada — o oráculo de disco precisa começar vazio.
   * O ESPELHO é estável entre rodadas, e isso não é economia de disco: dentro
   * dele mora o `.next-<porta>`, e um Next que compila do zero leva minutos
   * nesta máquina. Foi o que fez a primeira tentativa desta bateria estourar o
   * teto de espera esperando o compilador, não a IARA.
   */
  const base = mkdtempSync(path.join(os.tmpdir(), 'iara-cc01-'));
  const casa = path.join(base, 'casa');
  for (const d of ['Desktop', 'Documents', 'Downloads']) mkdirSync(path.join(casa, d), { recursive: true });
  const espelho = path.join(os.tmpdir(), 'iara-cc01-espelho');
  montarEspelho(espelho);
  const url = `http://127.0.0.1:${PORTA}`;

  console.log(`[cc-01] casa descartável: ${casa}`);
  console.log(`[cc-01] espelho do app:   ${espelho}`);
  console.log(`[cc-01] instância:        ${url}`);

  const motor = spawn(
    process.execPath,
    [path.join(APP, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(espelho, 'servidor', 'principal.ts'), '--dev'],
    {
      cwd: espelho,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PORT: PORTA,
        IARA_PORTA: PORTA,
        USERPROFILE: casa,
        HOME: casa,
        // O espelho tem o próprio `.env.local`; o do repositório não pode vazar
        // para cá pelo ambiente herdado deste processo.
        ANTHROPIC_API_KEY: undefined,
        GROQ_API_KEY: undefined,
        GEMINI_API_KEY: undefined,
        SUPABASE_URL: undefined,
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        NEXT_PUBLIC_SUPABASE_URL: undefined,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined,
      },
    },
  );

  /**
   * A saída do motor é guardada E ecoada. Guardada porque vira evidência;
   * ecoada porque a primeira vez que esta bateria quebrou, quebrou com "500" na
   * tela e o motivo estava exatamente aqui, num buffer que só seria escrito no
   * fim — e o modo de inspeção não tem fim.
   */
  const saida = [];
  const absorver = (d) => {
    const t = d.toString();
    saida.push(t);
    process.stderr.write(t);
  };
  motor.stdout.on('data', absorver);
  motor.stderr.on('data', absorver);

  let codigo = 2;
  try {
    if (!(await esperarSaude(url))) {
      console.error('[cc-01] a instância não respondeu em /saude:\n' + saida.join(''));
      return 2;
    }
    /**
     * PRÉ-AQUECIMENTO. `/saude` responde antes de o Next ter compilado uma
     * única página — a interface só nasce no primeiro GET, e em dev esse GET
     * pode levar minutos. Pagar isso aqui, fora do relógio do navegador,
     * é o que impede a bateria de reprovar o compilador achando que reprovou
     * a IARA.
     */
    const t = Date.now();
    const r = await fetch(url, { signal: AbortSignal.timeout(600_000) });
    console.log(`[cc-01] primeira página: ${r.status} em ${Date.now() - t} ms`);

    console.log('[cc-01] instância no ar — abrindo o navegador');

    /**
     * Modo de inspeção: sobe e segura. Existe para quando a bateria falha em
     * abrir a tela e a pergunta passa a ser "o que a página está mostrando?" —
     * que é uma pergunta para o olho, não para um seletor.
     */
    if (process.argv.includes('--somente-subir')) {
      console.log(`[cc-01] segurando a instância em ${url} — Ctrl+C encerra`);
      console.log(`[cc-01] casa: ${casa}`);
      await new Promise(() => {});
    }

    mkdirSync(EVIDENCIA, { recursive: true });
    /** Qual bateria rodar contra a instância. Uma instância, várias baterias. */
    const bateria = arg('--bateria', 'cross-talk-espelhos.mjs');
    codigo = await rodar(process.execPath, [path.join(AQUI, bateria)], {
      cwd: APP,
      env: {
        ...process.env,
        IARA_URL: url,
        IARA_RAIZ: casa,
        IARA_EVIDENCIA: EVIDENCIA,
        IARA_MARCA: MARCA,
        IARA_FASE: FASE,
      },
    });
    writeFileSync(path.join(EVIDENCIA, `motor-${FASE}.log`), saida.join(''));
  } finally {
    motor.kill();
    await dorme(1500);
    /* O espelho SOBREVIVE (ver `principal`); a casa, não — ela é a evidência
       consumida, e uma casa reaproveitada faria o oráculo de disco encontrar a
       pasta da rodada anterior e chamar isso de sucesso. */
    if (process.argv.includes('--limpar-espelho')) desmontarEspelho(espelho);
    if (!MANTER) {
      try {
        rmSync(base, { recursive: true, force: true });
      } catch {
        console.warn(`[cc-01] não removi ${base} — apague à mão se incomodar`);
      }
    } else {
      console.log(`[cc-01] casa mantida em ${base}`);
    }
  }
  return codigo;
}

principal().then((c) => {
  process.exitCode = c;
});
