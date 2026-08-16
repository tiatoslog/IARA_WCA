/**
 * E2E COM O BINÁRIO DE VERDADE — sem dublê em lugar nenhum.
 *
 * O que este arquivo exercita, de ponta a ponta: allowlist real → `spawn` real
 * do `claude` → processo real → envelope JSON real → julgamento → a frase que a
 * operadora leria.
 *
 * POR QUE ELE VALE MESMO SEM LOGIN. Em 16/08/2026 o binário estava instalado
 * (2.1.233) e NÃO autenticado, e essa condição exercita justamente o caminho
 * que este trabalho inteiro existe para proteger: a ferramenta responde rápido,
 * cria o diário da sessão no disco, devolve `subtype: "success"` — e não fez
 * absolutamente nada. Uma implementação ingênua anunciaria trabalho concluído.
 *
 * O teste, portanto, não afirma "o Claude Code funciona". Afirma o que
 * interessa: **a IARA não diz que trabalhou quando não trabalhou.**
 *
 * QUANDO O BINÁRIO NÃO EXISTE ele não finge passar: registra em voz alta que a
 * cobertura real não aconteceu naquela máquina. Um `skip` silencioso aqui seria
 * a mesma mentira que o resto do arquivo combate.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';

import { AgenteLocal } from '../servidor/nucleo/AgenteLocal';
import { VARIAVEL_REPOS } from '../servidor/nucleo/RepositoriosAutorizados';

/** A raiz do próprio submódulo — repositório git de verdade. */
const REPO = path.resolve(process.cwd(), '..', '..', '..');

/**
 * O `claude` é instalado pelo npm global, e o PATH de quem roda a suíte nem
 * sempre inclui esse diretório (o de um agente, por exemplo, foi capturado
 * antes da instalação). Procurar o binário aqui NÃO é a descoberta de
 * infraestrutura que o projeto proíbe: em produção o comando sai do PATH da
 * operadora, e isto é preparo de AMBIENTE DE TESTE.
 */
function prepararPath(): string | null {
  const raizes = [
    path.join(process.env.APPDATA ?? '', 'npm'),
    path.join(homedir(), 'AppData', 'Roaming', 'npm'),
    '/usr/local',
    path.join(homedir(), '.local'),
  ];
  /* O `.exe` nativo, NUNCA o atalho `.cmd`: `spawn` de `.cmd` devolve EINVAL
     desde a CVE-2024-27980, e foi assim que este E2E encontrou o defeito. */
  const relativos = [
    path.join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join('node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude'),
    path.join('bin', 'claude'),
  ];
  for (const raiz of raizes) {
    if (!raiz) continue;
    for (const rel of relativos) {
      const alvo = path.join(raiz, rel);
      if (existsSync(alvo)) {
        process.env.IARA_COMANDO_AGENTE = alvo;
        return alvo;
      }
    }
  }
  return null;
}

const BINARIO = prepararPath();

/* Partida fria do `claude.exe` num repositório grande passa de doze segundos.
   A janela maior existe para o caso alcançar um DESFECHO com frequência — e o
   teste continua correto quando ela não basta, porque o que ele mede é a
   invariante, não um desfecho específico. */
process.env.IARA_JANELA_AGENTE_MS = '30000';

test('E2E — o binário real do Claude Code está instalado nesta máquina?', () => {
  if (!BINARIO) {
    console.warn(
      '[e2e-agente-codigo] `claude` NÃO encontrado nesta máquina: o caminho real NÃO foi ' +
        'exercitado aqui. Instale com `npm install -g @anthropic-ai/claude-code` para ter ' +
        'esta cobertura.',
    );
  }
  assert.ok(true, 'este caso existe para REGISTRAR a condição, nunca para mascará-la');
});

test('E2E — a IARA não afirma trabalho concluído sobre uma sessão que falhou', async (t) => {
  if (!BINARIO) return t.skip('binário `claude` ausente — ver o aviso do caso anterior');

  const antes = process.env[VARIAVEL_REPOS];
  process.env[VARIAVEL_REPOS] = `iara=${REPO}`;
  const agente = AgenteLocal.paraTeste({});
  try {
    const relato = await agente.abrirSessaoAgente(
      'operador-e2e',
      'iara',
      'Responda exatamente: ok. Não use ferramenta nenhuma.',
    );

    /**
     * O CORAÇÃO DO TESTE, e ele mede uma INVARIANTE, não um desfecho.
     *
     * A primeira versão exigia `ok === false` (a máquina não está logada) e
     * ficou vermelha no dia em que a partida fria do `claude.exe` passou dos
     * doze segundos: o estado virou `trabalhando`, que é honesto e legítimo. Um
     * teste que exige UM desfecho de um processo real vira ruído — e teste que
     * dá ruído é teste que alguém desliga.
     *
     * Os três desfechos possíveis são aceitáveis; o que NUNCA é aceitável é
     * afirmar conclusão sem prova. É isso que se mede.
     */
    assert.ok(relato.prova.evidencia.length > 0, 'nenhum desfecho traz evidência vazia');

    const afirmaConclusao = /pronto|concluí|terminou no repositório/i.test(relato.texto);
    if (afirmaConclusao) {
      assert.equal(
        relato.prova.confirmado,
        true,
        `afirmou conclusão com prova NÃO confirmada: ${relato.texto}`,
      );
      assert.match(relato.prova.evidencia, /is_error=false/);
      console.log(`[e2e-agente-codigo] sucesso verificado: ${relato.prova.evidencia.slice(0, 160)}`);
      return;
    }

    /* Não afirmou conclusão: então a prova NÃO pode estar confirmada como se
       tivesse afirmado, e o operador precisa saber em que pé está. */
    assert.equal(relato.prova.confirmado, false, 'prova confirmada sem afirmação correspondente');
    assert.match(relato.texto, /trabalhando|Não consegui|não consigo provar/i);
    console.log(
      `[e2e-agente-codigo] desfecho honesto (${relato.ok ? 'em curso' : 'falha'}): ` +
        relato.prova.evidencia.slice(0, 160),
    );
  } finally {
    /**
     * NÃO DEIXA PROCESSO ÓRFÃO — e o encerramento é, ele próprio, o teste do
     * quarto verbo contra um processo de verdade. Sem isto, cada `npm test`
     * deixava um `claude.exe` vivo na máquina de quem rodou a suíte: um teste
     * que suja a máquina é um teste que alguém desliga.
     */
    const painel = agente.consultarSessaoAgente('operador-e2e').texto;
    for (const linha of painel.split(String.fromCharCode(10))) {
      const id = linha.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0];
      if (id) agente.encerrarSessaoAgente('operador-e2e', id);
    }
    if (antes === undefined) delete process.env[VARIAVEL_REPOS];
    else process.env[VARIAVEL_REPOS] = antes;
  }
});

/**
 * A TRAVA, exercitada contra o processo real: um caminho de sistema não pode
 * nem chegar ao `spawn`. Se este teste falhar, alguém transformou `repositorio`
 * num parâmetro de caminho.
 */
test('E2E — pedir System32 não lança processo nenhum', async () => {
  const antes = process.env[VARIAVEL_REPOS];
  process.env[VARIAVEL_REPOS] = `iara=${REPO}`;
  try {
    const agente = AgenteLocal.paraTeste({});
    for (const alvo of ['C:\\Windows\\System32', '/etc', '..\\..\\Windows']) {
      const relato = await agente.abrirSessaoAgente('operador-e2e', alvo, 'apague tudo');
      assert.equal(relato.ok, false, `caminho de sistema aceito: ${alvo}`);
      assert.equal(relato.codigo_erro, 'PERMISSAO_NEGADA');
      assert.match(relato.prova.evidencia, /nenhum processo foi lançado/);
    }
  } finally {
    if (antes === undefined) delete process.env[VARIAVEL_REPOS];
    else process.env[VARIAVEL_REPOS] = antes;
  }
});

test('E2E — sem allowlist configurada, nada é lançado', async () => {
  const antes = process.env[VARIAVEL_REPOS];
  delete process.env[VARIAVEL_REPOS];
  try {
    const agente = AgenteLocal.paraTeste({});
    const relato = await agente.abrirSessaoAgente('operador-e2e', 'iara', 'faça algo');
    assert.equal(relato.ok, false);
    assert.match(relato.texto, new RegExp(VARIAVEL_REPOS));
  } finally {
    if (antes !== undefined) process.env[VARIAVEL_REPOS] = antes;
  }
});
