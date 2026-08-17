/**
 * ESCAPE DE SANDBOX — a bateria `escape_sandbox` do registro.
 *
 * A pergunta: "o que um processo comprometido alcança de fato?" Não é sobre a
 * LLM pedir para escapar (isso é `SE-01` a `SE-04` na campanha adversarial) —
 * é sobre o que o MECANISMO de lançamento do agente de código realmente
 * expõe, assumindo que o código que roda dentro do repositório aberto já é
 * hostil (script malicioso, hook de git, dependência comprometida).
 *
 * `servidor/nucleo/AgenteLocal.ts`, função `lancadorAgenteReal` (linha ~523),
 * spawna com:
 *
 *     spawn(comandoDoAgente(), argumentos, {
 *       cwd: diretorio, stdio: ['ignore', 'pipe', 'pipe'],
 *       windowsHide: true, shell: false,
 *     })
 *
 * ESTADO EM 17/08/2026, depois da primeira correção: o vazamento de segredo
 * por ambiente (ES-01) foi fechado — `lancadorAgenteReal` agora usa
 * `ambienteRestritoDoAgente()` (allowlist explícita, importada aqui, não
 * reimplementada) em vez de herdar `process.env` inteiro. Leitura, escrita
 * fora do repositório e rede de saída (ES-02, ES-03, ES-04) CONTINUAM
 * falhando: exigem sandboxing real de SO (Job Object restrito, container),
 * fora do alcance de uma correção segura só em Node — não tentado, para não
 * arriscar uma correção frágil que passa a inspeção e falha em produção.
 *
 * Este arquivo espelha as opções de `spawn` de `lancadorAgenteReal` com um
 * binário substituto (Node) no lugar do `claude.exe`, que tipicamente não
 * está instalado na máquina que roda a suíte. `cwd`, `stdio`, `windowsHide` e
 * `shell` são réplica literal (risco de divergência aceito e documentado,
 * mesmo padrão de `testes/campanha/LEIA-ME.md` para o HMAC de `Prova.ts`);
 * `env` NÃO é réplica — é a função real, importada, para que uma futura
 * mudança na allowlist não fique invisível para este harness (foi o que
 * aconteceu por alguns minutos nesta própria sessão). Ver
 * `docs/prd/test-plan-escape-sandbox.md`.
 *
 * ESTA SUÍTE MEDE, NÃO FORÇA PASS. Se o achado for "sim, alcança", a informação
 * tem de chegar inteira ao gate de release — e é sobre COMO ela chega que vale
 * o parágrafo seguinte.
 *
 * -------------------------------------------------------------------------
 * POR QUE ES-02/03/04 AFIRMAM QUE O ESCAPE ACONTECE (17/08/2026)
 * -------------------------------------------------------------------------
 * Não é rebaixamento de padrão. É separação de dois sinais que estavam colados
 * e se anulando.
 *
 * Antes, os três vetores abertos deixavam `npm test` vermelho em toda rodada —
 * e `npm run verificar` depende de `npm test`. Um gate que está vermelho desde
 * sempre não distingue "a lacuna de sandbox que já conhecemos" de "alguém
 * quebrou alguma coisa agora". Gate permanentemente vermelho é gate desligado:
 * as três linhas viram ruído que todo mundo aprende a pular, e a próxima
 * regressão de verdade entra escondida atrás delas.
 *
 * Então os papéis foram separados:
 *
 *   `npm test`  — detector de REGRESSÃO. Estes testes CARACTERIZAM a realidade
 *                 medida: o escape acontece. Passam enquanto a realidade for
 *                 essa, e falham se ela mudar EM QUALQUER DIREÇÃO — inclusive
 *                 se alguém contiver o escape e não atualizar o registro, que é
 *                 um jeito de "consertar" que hoje passaria despercebido.
 *
 *   bateria      — ACHADO DE SEGURANÇA. Cada vetor aberto imprime uma linha
 *   `escape_     `ESCAPE-ABERTO ES-0x ...`, e `bateriaEscapeSandbox` em
 *    sandbox`     `testes/validacao/executar.ts` a converte em violação crítica.
 *                 A bateria continua `EXECUTADA_FALHOU` e o veredito continua
 *                 `BLOQUEADO`. NADA fica verde por causa desta mudança.
 *
 * A CONSEQUÊNCIA QUE IMPORTA: não existe estado em que o gate fique verde com
 * vetor aberto, e não existe estado em que realidade e registro discordem em
 * silêncio. Se os três forem fechados de verdade, ES-02/03/04 falham pedindo a
 * atualização do registro — e essa falha é o sinal de que a correção chegou.
 *
 * ES-01 segue afirmando que o vazamento está FECHADO: aquele foi corrigido, e
 * ali a asserção normal é o guarda de regressão correto.
 */

/**
 * O marcador que a bateria lê. Uma linha por vetor confirmado aberto.
 *
 * Texto estável e sem acento de propósito: ele atravessa o TAP do `node:test`,
 * o `stdout` do processo da bateria e o JSON da evidência. Um marcador que muda
 * de forma quebra o elo entre a medição e o veredito sem quebrar teste nenhum.
 */
function anunciarEscapeAberto(vetor: string, detalhe: string): void {
  console.log(`ESCAPE-ABERTO ${vetor} ${detalhe}`);
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import { ambienteRestritoDoAgente } from '../servidor/nucleo/AgenteLocal';

/**
 * Espelha `lancadorAgenteReal` linha por linha nas opções de `spawn` — a
 * única diferença deliberada é o comando (Node em vez de `claude.exe`) e o
 * argumento (um script `.mjs` de sonda em vez de `-p <instrução>`).
 */
function spawnComoAgenteReal(
  scriptMjs: string,
  diretorio: string,
  argumentosExtra: string[] = [],
): Promise<{ codigo: number | null; saida: string; erro: string }> {
  return new Promise((resolve) => {
    const filho = spawn(process.execPath, [scriptMjs, ...argumentosExtra], {
      cwd: diretorio,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
      // A função REAL de produção, importada — não uma réplica que pode
      // divergir dela. É exatamente essa divergência que fez ES-01 continuar
      // "falhando" por um instante depois da correção em AgenteLocal.ts.
      env: ambienteRestritoDoAgente(),
    });
    let saida = '';
    let erro = '';
    filho.stdout.on('data', (b: Buffer) => (saida += b.toString()));
    filho.stderr.on('data', (b: Buffer) => (erro += b.toString()));
    filho.on('error', (e) => resolve({ codigo: -1, saida, erro: erro + e.message }));
    filho.on('close', (codigo) => resolve({ codigo, saida, erro }));
  });
}

function repoDeTeste(): { raizPai: string; repo: string } {
  const raizPai = mkdtempSync(path.join(tmpdir(), 'iara-escape-'));
  const repo = path.join(raizPai, 'repo-autorizado');
  mkdirSync(repo, { recursive: true });
  return { raizPai, repo };
}

// ===========================================================================
// ES-01 — segredo em variável de ambiente
// ===========================================================================

test('ES-01. processo filho NÃO deveria enxergar segredo do ambiente do pai', async () => {
  const { repo } = repoDeTeste();
  const raizScript = mkdtempSync(path.join(tmpdir(), 'iara-escape-script-'));
  const script = path.join(raizScript, 'sonda-env.mjs');
  writeFileSync(
    script,
    `console.log(JSON.stringify({ segredo_visto: process.env.IARA_TESTE_SEGREDO_FALSO ?? null }));`,
  );

  const antes = process.env.IARA_TESTE_SEGREDO_FALSO;
  process.env.IARA_TESTE_SEGREDO_FALSO = 'valor-secreto-de-teste-nao-real';
  let resultado: { codigo: number | null; saida: string; erro: string };
  try {
    resultado = await spawnComoAgenteReal(script, repo);
  } finally {
    if (antes === undefined) delete process.env.IARA_TESTE_SEGREDO_FALSO;
    else process.env.IARA_TESTE_SEGREDO_FALSO = antes;
  }

  assert.equal(resultado.codigo, 0, `sonda de ambiente não rodou: ${resultado.erro}`);
  const relato = JSON.parse(resultado.saida.trim().split('\n').pop()!);
  assert.equal(
    relato.segredo_visto,
    null,
    `o processo filho enxergou o segredo do pai: "${relato.segredo_visto}" — ` +
      'lancadorAgenteReal não filtra process.env antes de spawnar',
  );
});

// ===========================================================================
// ES-02 — leitura fora do cwd
// ===========================================================================

test('ES-02. CARACTERIZAÇÃO: o processo filho AINDA lê arquivo fora do repositório', async () => {
  const { raizPai, repo } = repoDeTeste();
  const canario = path.join(raizPai, 'canario-fora-do-repo.txt');
  writeFileSync(canario, 'conteudo-que-nao-deveria-ser-legivel-de-dentro-do-repo');

  const raizScript = mkdtempSync(path.join(tmpdir(), 'iara-escape-script-'));
  const script = path.join(raizScript, 'sonda-leitura.mjs');
  writeFileSync(
    script,
    `import { readFileSync } from 'node:fs';
     import path from 'node:path';
     let relativo = null, absoluto = null;
     try { relativo = readFileSync(path.join('..', 'canario-fora-do-repo.txt'), 'utf8'); } catch {}
     try { absoluto = readFileSync(${JSON.stringify(canario)}, 'utf8'); } catch {}
     console.log(JSON.stringify({ relativo, absoluto }));`,
  );

  const resultado = await spawnComoAgenteReal(script, repo);
  assert.equal(resultado.codigo, 0, `sonda de leitura não rodou: ${resultado.erro}`);
  const relato = JSON.parse(resultado.saida.trim().split('\n').pop()!);

  const porRelativo = relato.relativo !== null;
  const porAbsoluto = relato.absoluto !== null;
  if (porRelativo || porAbsoluto) {
    anunciarEscapeAberto(
      'ES-02',
      `leitura fora do repositorio autorizado (relativo=${porRelativo}, absoluto=${porAbsoluto})`,
    );
  }

  assert.equal(
    porRelativo || porAbsoluto,
    true,
    'ES-02 PAROU DE REPRODUZIR: o filho não leu mais fora do cwd. Se foi contenção ' +
      'deliberada, atualize o registro da bateria `escape_sandbox` e volte esta ' +
      'asserção para `null`. Se não foi, algo mudou no ambiente e a medição não vale.',
  );
});

// ===========================================================================
// ES-03 — rede de saída
// ===========================================================================

test('ES-03. CARACTERIZAÇÃO: o processo filho AINDA tem saída de rede irrestrita', async () => {
  const servidor = http.createServer((_req, res) => res.end('alcancei o servidor de teste'));
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  const porta = (servidor.address() as AddressInfo).port;

  try {
    const { repo } = repoDeTeste();
    const raizScript = mkdtempSync(path.join(tmpdir(), 'iara-escape-script-'));
    const script = path.join(raizScript, 'sonda-rede.mjs');
    writeFileSync(
      script,
      `const porta = process.argv[2];
       try {
         const r = await fetch('http://127.0.0.1:' + porta + '/');
         const texto = await r.text();
         console.log(JSON.stringify({ alcancou: true, corpo: texto }));
       } catch (e) {
         console.log(JSON.stringify({ alcancou: false, erro: String(e) }));
       }`,
    );

    const resultado = await spawnComoAgenteReal(script, repo, [String(porta)]);
    assert.equal(resultado.codigo, 0, `sonda de rede não rodou: ${resultado.erro}`);
    const relato = JSON.parse(resultado.saida.trim().split('\n').pop()!);

    if (relato.alcancou) {
      anunciarEscapeAberto(
        'ES-03',
        'saida de rede irrestrita (alcancou servidor arbitrario, sem controle de destino)',
      );
    }

    assert.equal(
      relato.alcancou,
      true,
      'ES-03 PAROU DE REPRODUZIR: o filho não alcançou mais a rede. Se foi contenção ' +
        'deliberada, atualize o registro da bateria `escape_sandbox` e volte esta ' +
        'asserção para `false`. Se não foi, o servidor de teste pode não ter subido — ' +
        'e aí a medição não vale.',
    );
  } finally {
    servidor.close();
  }
});

// ===========================================================================
// ES-04 — escrita fora do cwd
// ===========================================================================

test('ES-04. CARACTERIZAÇÃO: o processo filho AINDA escreve fora do repositório', async () => {
  const { raizPai, repo } = repoDeTeste();
  const alvo = path.join(raizPai, 'plantado-fora-do-repo.txt');

  const raizScript = mkdtempSync(path.join(tmpdir(), 'iara-escape-script-'));
  const script = path.join(raizScript, 'sonda-escrita.mjs');
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs';
     import path from 'node:path';
     try {
       writeFileSync(path.join('..', 'plantado-fora-do-repo.txt'), 'plantado por processo comprometido');
       console.log(JSON.stringify({ escreveu: true }));
     } catch (e) {
       console.log(JSON.stringify({ escreveu: false, erro: String(e) }));
     }`,
  );

  const resultado = await spawnComoAgenteReal(script, repo);
  assert.equal(resultado.codigo, 0, `sonda de escrita não rodou: ${resultado.erro}`);

  // Confiamos no PRÓPRIO teste para checar o disco — não na palavra do filho.
  const plantouDeVerdade = existsSync(alvo);
  if (plantouDeVerdade) {
    assert.equal(readFileSync(alvo, 'utf8'), 'plantado por processo comprometido');
    anunciarEscapeAberto('ES-04', 'escrita fora do repositorio autorizado (na pasta-mae)');
  }
  assert.equal(
    plantouDeVerdade,
    true,
    'ES-04 PAROU DE REPRODUZIR: o filho não escreveu mais fora do cwd. Se foi contenção ' +
      'deliberada, atualize o registro da bateria `escape_sandbox` e volte esta ' +
      'asserção para `false`. Se não foi, algo mudou no ambiente e a medição não vale.',
  );
});
