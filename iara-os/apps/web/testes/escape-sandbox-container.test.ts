/**
 * ESCAPE DE SANDBOX — O MODO CONTAINER.
 *
 * `escape-sandbox-adversarial.test.ts` mede o mecanismo de HOJE, que não contém
 * o filho. Este arquivo mede o mecanismo NOVO, ligado por
 * `IARA_AGENTE_SANDBOX=container`, e usa `argumentosDeContainer` — a função
 * real, importada, nunca uma réplica: é a mesma lição que
 * `ambienteRestritoDoAgente` deixou em ES-01.
 *
 * A ARMADILHA QUE ESTE ARQUIVO EXISTE PARA NÃO CAIR. A sonda de rede do outro
 * arquivo busca `http://127.0.0.1:<porta>` num servidor do host. Dentro de um
 * container, `127.0.0.1` é o loopback DO CONTAINER, e o servidor do host fica
 * inalcançável por namespace — não por contenção. Medido em 18/08/2026: um
 * container na rede padrão do Docker alcança `https://api.anthropic.com` sem
 * controle nenhum E falha em `127.0.0.1` do host. Reaproveitar aquela sonda aqui
 * daria "ES-03 fechado" com a internet inteira aberta. Por isso o egresso é
 * medido contra destino EXTERNO real, e com controle positivo.
 *
 * SEM DOCKER, ESTE ARQUIVO NÃO PASSA — ele pula declarando o motivo e não afirma
 * nada. "Não consegui medir" jamais pode virar "está contido".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { argumentosDeContainer } from '../servidor/nucleo/AgenteLocal';

const IMAGEM = 'node:22-alpine';
const REDE_INTERNA = 'iara-agente-interna';

function temDocker(): boolean {
  const r = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  return r.status === 0 && Boolean(r.stdout?.trim());
}

const pular = temDocker() ? false : 'daemon do Docker fora do ar — nada foi medido';

/** Roda `docker` com os argumentos que a PRODUÇÃO montaria. */
function rodarNoContainer(
  argumentos: readonly string[],
  diretorio: string,
  extra: Record<string, string> = {},
): { codigo: number | null; saida: string; erro: string } {
  const antes = { ...process.env };
  Object.assign(process.env, { IARA_AGENTE_IMAGEM: IMAGEM, ...extra });
  try {
    const args = argumentosDeContainer(argumentos, diretorio);
    const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 120_000 });
    return { codigo: r.status, saida: r.stdout ?? '', erro: r.stderr ?? '' };
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in antes)) delete process.env[k];
    Object.assign(process.env, antes);
  }
}

function repoComSonda(nome: string, corpo: string): { raizPai: string; repo: string } {
  const raizPai = mkdtempSync(path.join(tmpdir(), 'iara-cont-'));
  const repo = path.join(raizPai, 'repo-autorizado');
  mkdirSync(repo, { recursive: true });
  writeFileSync(path.join(raizPai, 'canario-fora-do-repo.txt'), 'canario-do-host');
  /* A sonda mora DENTRO do repositório: é o único lugar que o container enxerga,
     e é exatamente o ponto — código hostil chega pelo repositório aberto. */
  writeFileSync(path.join(repo, nome), corpo);
  return { raizPai, repo };
}

test('CT-01. o container SÓ enxerga o repositório montado', { skip: pular }, () => {
  const { repo } = repoComSonda(
    'sonda-leitura.mjs',
    [
      "import { readFileSync, readdirSync } from 'node:fs';",
      'let relativo = null, raiz = null;',
      "try { relativo = readFileSync('../canario-fora-do-repo.txt', 'utf8'); } catch {}",
      "try { raiz = readdirSync('/trabalho').join(','); } catch {}",
      'console.log(JSON.stringify({ relativo, raiz }));',
    ].join('\n'),
  );

  const r = rodarNoContainer(['node', '/trabalho/sonda-leitura.mjs'], repo);
  assert.equal(r.codigo, 0, `container não rodou: ${r.erro}`);
  const relato = JSON.parse(r.saida.trim().split('\n').pop()!);

  /* CONTROLE POSITIVO: sem isto, um mount quebrado (pasta vazia) daria "não leu
     o canário" e passaria por contenção. Aconteceu nesta sessão — `cygpath`
     falhou em silêncio e o docker montou um volume anônimo vazio. */
  assert.match(relato.raiz ?? '', /sonda-leitura\.mjs/, 'o mount não pegou — a medição não vale');

  assert.equal(relato.relativo, null, 'ES-02 ainda aberto: leu fora do repositório montado');
});

test('CT-02. escrita fora do repositório não alcança o disco do host', { skip: pular }, () => {
  const { raizPai, repo } = repoComSonda(
    'sonda-escrita.mjs',
    [
      "import { writeFileSync } from 'node:fs';",
      'let dentro = false, fora = false;',
      "try { writeFileSync('/trabalho/prova-dentro.txt', 'ok'); dentro = true; } catch {}",
      "try { writeFileSync('../plantado-fora-do-repo.txt', 'plantado'); fora = true; } catch {}",
      'console.log(JSON.stringify({ dentro, fora }));',
    ].join('\n'),
  );

  const r = rodarNoContainer(['node', '/trabalho/sonda-escrita.mjs'], repo);
  assert.equal(r.codigo, 0, `container não rodou: ${r.erro}`);
  const relato = JSON.parse(r.saida.trim().split('\n').pop()!);

  /* CONTROLE POSITIVO de novo: o agente PRECISA escrever no repositório. Um
     container que não escreve em lugar nenhum "conteria" tudo e não serviria. */
  assert.equal(relato.dentro, true, 'o container não escreveu nem no repositório — inútil');
  assert.equal(
    existsSync(path.join(repo, 'prova-dentro.txt')),
    true,
    'a escrita no repositório não chegou ao host — o mount é de mentira',
  );

  /* O QUE VALE É O DISCO DO HOST, não a palavra do filho: escrever em `../` de
     dentro do container "funciona" e morre na camada efêmera. */
  assert.equal(
    existsSync(path.join(raizPai, 'plantado-fora-do-repo.txt')),
    false,
    'ES-04 ainda aberto: a escrita chegou à pasta-mãe no host',
  );
});

test('CT-03. na rede interna o egresso morre — com controle positivo', { skip: pular }, () => {
  const redes = spawnSync('docker', ['network', 'ls', '--format', '{{.Name}}'], {
    encoding: 'utf8',
  });
  if (!redes.stdout?.includes(REDE_INTERNA)) {
    assert.fail(
      `a rede ${REDE_INTERNA} não existe — crie com: ` +
        `docker network create --internal ${REDE_INTERNA}`,
    );
  }

  const sonda = [
    "const alvo = 'https://example.com/';",
    'try {',
    '  const r = await fetch(alvo, { signal: AbortSignal.timeout(8000) });',
    '  console.log(JSON.stringify({ alcancou: true, status: r.status }));',
    '} catch (e) {',
    '  console.log(JSON.stringify({ alcancou: false, erro: String(e).slice(0, 120) }));',
    '}',
  ].join('\n');

  /**
   * CONTROLE POSITIVO na rede padrão. Sem ele, "não alcançou" na rede interna
   * poderia ser falta de internet na máquina, e a bateria estaria medindo o
   * roteador do prédio em vez da contenção.
   */
  const { repo: repoControle } = repoComSonda('sonda-rede.mjs', sonda);
  const controle = rodarNoContainer(['node', '/trabalho/sonda-rede.mjs'], repoControle, {
    IARA_AGENTE_REDE: 'bridge',
  });
  const relatoControle = JSON.parse(controle.saida.trim().split('\n').pop() ?? '{}');
  if (relatoControle.alcancou !== true) {
    assert.fail(
      'controle falhou: nem na rede padrão o container alcançou a internet. Sem ' +
        'egresso funcionando não há como afirmar contenção — máquina offline?',
    );
  }

  const { repo } = repoComSonda('sonda-rede.mjs', sonda);
  const contido = rodarNoContainer(['node', '/trabalho/sonda-rede.mjs'], repo, {
    IARA_AGENTE_REDE: REDE_INTERNA,
  });
  const relato = JSON.parse(contido.saida.trim().split('\n').pop() ?? '{}');

  assert.equal(
    relato.alcancou,
    false,
    'ES-03 ainda aberto: o container alcançou destino externo arbitrário na rede interna',
  );
});
