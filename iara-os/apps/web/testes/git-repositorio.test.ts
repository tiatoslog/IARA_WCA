/**
 * ATUALIZAR REPOSITÓRIO — a suíte das RECUSAS.
 *
 * O caminho feliz deste verbo é de duas linhas: roda `git pull`, lê o hash. Ele
 * está aqui, mas não é por causa dele que este arquivo existe.
 *
 * O que precisa de prova é o que a ação se recusa a fazer. `git pull` é um
 * comando que, no estado errado, come trabalho de alguém — e o estado errado é
 * o comum, não o exótico: quase todo repositório em que alguém está mexendo tem
 * arquivo não salvo. Um teste que só exercita o repositório limpo prova a parte
 * que não dava trabalho.
 *
 * O EXECUTOR É ESPIÃO, não dublê ingênuo: cada teste afirma não só a frase de
 * saída, mas QUAIS comandos o git chegou a receber. É a diferença entre "ela
 * disse que não puxou" e "ela não puxou" — e a primeira é exatamente o tipo de
 * afirmação que este projeto não aceita como prova.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AgenteLocal, repositoriosAutorizados, type ExecutorGit } from '../servidor/nucleo/AgenteLocal';
import { extrairApelidoRepositorio } from '../servidor/nucleo/kernel/Planejador';

/** Um repositório declarado, só para os testes. Restaurado por `t.after`. */
function comAllowlist(t: { after: (f: () => void) => void }, valor: string): void {
  const antes = process.env.IARA_REPOSITORIOS;
  process.env.IARA_REPOSITORIOS = valor;
  t.after(() => {
    if (antes === undefined) delete process.env.IARA_REPOSITORIOS;
    else process.env.IARA_REPOSITORIOS = antes;
  });
}

/**
 * Git de mentira, controlável por comando. `respostas` mapeia o primeiro
 * argumento (`status`, `pull`, `rev-parse`) para o que aquele comando devolve;
 * `chamadas` guarda tudo que passou, para as asserções negativas.
 */
function gitFalso(respostas: Record<string, { codigo?: number; saida?: string }[]>) {
  const chamadas: string[][] = [];
  const contador: Record<string, number> = {};
  const executor: ExecutorGit = async (argumentos) => {
    chamadas.push([...argumentos]);
    const verbo = argumentos[0];
    const fila = respostas[verbo] ?? [];
    const i = contador[verbo] ?? 0;
    contador[verbo] = i + 1;
    const r = fila[Math.min(i, fila.length - 1)] ?? {};
    return { codigo: r.codigo ?? 0, saida: r.saida ?? '' };
  };
  return { executor, chamadas };
}

function agenteCom(executor: ExecutorGit): AgenteLocal {
  return new AgenteLocal(
    () => undefined,
    async () => 0,
    undefined,
    undefined,
    undefined,
    undefined,
    executor,
  );
}

// ---------------------------------------------------------------------------
// A allowlist
// ---------------------------------------------------------------------------

test('repositório fora da lista é recusado, e o git nem é chamado', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor, chamadas } = gitFalso({});
  const agente = agenteCom(executor);

  const r = await agente.atualizarRepositorio('daiane', 'contabilidade');

  assert.equal(r.ok, false);
  assert.match(r.texto, /não tenho esse repositório|não conheço/i);
  assert.deepEqual(chamadas, [], 'nenhum comando pode rodar para um alvo não autorizado');
});

test('sem allowlist declarada a capacidade simplesmente não existe', async (t) => {
  comAllowlist(t, '');
  const { executor, chamadas } = gitFalso({});
  const agente = agenteCom(executor);

  const r = await agente.atualizarRepositorio('daiane', 'iara_wca');

  assert.equal(r.ok, false);
  assert.deepEqual(chamadas, [], 'sem lista não há alvo, e sem alvo não há comando');
});

test('o apelido é reconhecido sem acento e sem caixa', async (t) => {
  comAllowlist(t, 'IARA_WCA=C:/dev/iara');
  const { executor } = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'aaaa1111' }],
    pull: [{ saida: 'Already up to date.' }],
  });

  const r = await agenteCom(executor).atualizarRepositorio('daiane', 'Iara_WCA');
  assert.equal(r.ok, true, 'quem fala não digita chave de configuração');
});

// ---------------------------------------------------------------------------
// A trava que existe para não comer trabalho
// ---------------------------------------------------------------------------

test('árvore suja: recusa ANTES de puxar, e diz o que está sujo', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor, chamadas } = gitFalso({
    status: [{ saida: ' M servidor/nucleo/Braco.ts\n?? rascunho.md' }],
  });

  const r = await agenteCom(executor).atualizarRepositorio('daiane', 'iara_wca');

  assert.equal(r.ok, false);
  assert.match(r.texto, /2 arquivos alterados/i, 'a recusa precisa dizer quanto, não só que não deu');
  assert.match(r.texto, /Braco\.ts/, 'e precisa dizer o quê — senão a pessoa vai olhar de qualquer jeito');
  assert.ok(
    !chamadas.some((c) => c[0] === 'pull'),
    'nenhum pull pode acontecer com trabalho não salvo na árvore',
  );
});

test('a decisão sobre o trabalho sujo é da pessoa: a IARA não commita nem descarta', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor, chamadas } = gitFalso({
    status: [{ saida: ' M app/page.tsx' }],
  });

  await agenteCom(executor).atualizarRepositorio('daiane', 'iara_wca');

  const verbos = chamadas.map((c) => c[0]);
  for (const proibido of ['commit', 'stash', 'checkout', 'reset', 'clean']) {
    assert.ok(
      !verbos.includes(proibido),
      `"${proibido}" resolveria a árvore suja por conta própria — e essa escolha não é da IARA`,
    );
  }
});

// ---------------------------------------------------------------------------
// O que nunca acontece
// ---------------------------------------------------------------------------

test('nunca merge, nunca rebase, nunca force, nunca push', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor, chamadas } = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'bbbb2222' }],
    pull: [{ saida: 'Updating aaaa111..bbbb222' }],
  });

  await agenteCom(executor).atualizarRepositorio('daiane', 'iara_wca');

  const tudo = chamadas.flat();
  for (const proibido of ['push', 'merge', 'rebase', '--force', '-f', 'commit']) {
    assert.ok(
      !tudo.includes(proibido),
      `"${proibido}" alcança gente de fora ou reescreve história — não cabe num verbo de risco médio`,
    );
  }
  const pull = chamadas.find((c) => c[0] === 'pull');
  assert.deepEqual(pull, ['pull', '--ff-only'], 'o pull tem que ser fast-forward e nada mais');
});

// ---------------------------------------------------------------------------
// A prova: o hash sabe o que aconteceu
// ---------------------------------------------------------------------------

test('HEAD mudou → "atualizei"; HEAD igual → "já estava atualizado"', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');

  const avancou = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'bbbb2222' }],
    pull: [{ saida: 'Updating' }],
  });
  const r1 = await agenteCom(avancou.executor).atualizarRepositorio('daiane', 'iara_wca');
  assert.equal(r1.ok, true);
  assert.match(r1.texto, /atualizei/i);
  assert.equal(r1.prova.confirmado, true);
  assert.match(r1.prova.evidencia, /aaaa1111.*bbbb2222/);

  const jaEmDia = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'aaaa1111' }],
    pull: [{ saida: 'Already up to date.' }],
  });
  const r2 = await agenteCom(jaEmDia.executor).atualizarRepositorio('daiane', 'iara_wca');
  assert.equal(r2.ok, true);
  assert.match(r2.texto, /já estava atualizad/i);
  assert.doesNotMatch(
    r2.texto,
    /^Pronto, atualizei/i,
    '"já estava em dia" não é uma versão modesta de "atualizei" — é outro fato',
  );
});

test('branch divergente vira recusa que EXPLICA, não erro genérico', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor } = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'aaaa1111' }],
    pull: [{ codigo: 128, saida: 'fatal: Not possible to fast-forward, aborting.' }],
  });

  const r = await agenteCom(executor).atualizarRepositorio('daiane', 'iara_wca');

  assert.equal(r.ok, false);
  assert.match(r.texto, /commits que o servidor não tem/i);
  assert.match(r.texto, /não resolvo conflito sozinha/i);
  assert.equal(r.prova.confirmado, true, 'o HEAD não mudou, e isso é um fato apurado');
});

test('rede caída não vira "divergiu" — são causas diferentes e frases diferentes', async (t) => {
  comAllowlist(t, 'iara_wca=C:/dev/iara');
  const { executor } = gitFalso({
    status: [{ saida: '' }],
    'rev-parse': [{ saida: 'aaaa1111' }, { saida: 'aaaa1111' }],
    pull: [{ codigo: 128, saida: 'fatal: unable to access ... Could not resolve host' }],
  });

  const r = await agenteCom(executor).atualizarRepositorio('daiane', 'iara_wca');

  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'ERRO_DE_REDE');
  assert.doesNotMatch(r.texto, /commits que o servidor não tem/i);
});

// ---------------------------------------------------------------------------
// A leitura da frase
// ---------------------------------------------------------------------------

test('o apelido sai da frase sem carregar artigo nem preposição', () => {
  const casos: Array<[string, string]> = [
    ['atualize o repositório IARA_WCA', 'IARA_WCA'],
    ['puxa as novidades do repo iara-wca', 'iara-wca'],
    ['atualiza o projeto atoshub por favor', 'atoshub'],
    ['faz git pull no repositório IARA_WCA', 'IARA_WCA'],
    // Sem nome: resposta legítima, resolvida por quem conhece a lista.
    ['atualize o repositório', ''],
    ['atualiza o meu repositório', ''],
  ];
  for (const [frase, esperado] of casos) {
    assert.equal(extrairApelidoRepositorio(frase), esperado, `"${frase}"`);
  }
});

test('a allowlist lê pares e ignora lixo, sem derrubar a capacidade inteira', (t) => {
  comAllowlist(t, ' IARA_WCA = C:/dev/iara , lixo , =semapelido, outro=D:/x ');
  const mapa = repositoriosAutorizados();
  assert.equal(mapa.get('iara_wca'), 'C:/dev/iara');
  assert.equal(mapa.get('outro'), 'D:/x');
  assert.equal(mapa.size, 2, 'entrada malformada some sozinha; ela não invalida as boas');
});
