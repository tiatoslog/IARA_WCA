/**
 * ISOLAMENTO CRUZADO — a bateria `isolamento_cruzado` do registro.
 *
 * A pergunta: "memória, RAG, arquivo, token e log de um alcançam o outro?"
 * O que `testes/memoria-concorrente.test.ts` já prova: dois CANAIS do MESMO
 * operador não se apagam. O que faltava, e é o que esta suíte fecha: dois
 * OPERADORES DIFERENTES, escrevendo ao mesmo tempo — inclusive de dois
 * PROCESSOS reais, não só duas promessas no mesmo processo — nunca se
 * misturam, nem na memória (`MemoriaOperacional`) nem no jornal
 * (`RegistroOperacoes`).
 *
 * Escopo e o que fica de fora, com o porquê: ver
 * `docs/prd/test-plan-isolamento-cruzado.md`. Resumo: RAG (`RagHistorico`) é
 * deliberadamente global — não há isolamento de operador a violar ali, então
 * não entra aqui. O eixo SESSÃO já tem harness próprio
 * (`cross-talk-espelhos.test.ts`, `espelhos.test.ts`). O eixo MÁQUINA não é
 * automatizável nesta suíte e fica como gap declarado, não escondido.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { evidencia } from '../servidor/nucleo/kernel/Operacao';

const RAIZ = process.cwd();
const urlDe = (relativo: string) => pathToFileURL(path.join(RAIZ, relativo)).href;

// ===========================================================================
// 1. MEMÓRIA — dois operadores, mesmo processo
// ===========================================================================

test('OP-01. dois operadores escrevendo memória ao mesmo tempo não se misturam', async () => {
  const memoria = new MemoriaOperacional();
  const a = `isolcruzado-a-${Date.now()}`;
  const b = `isolcruzado-b-${Date.now()}`;
  try {
    const escritasA = Array.from({ length: 15 }, (_, i) => memoria.registrar(a, 'operador', `A-${i}`));
    const escritasB = Array.from({ length: 15 }, (_, i) => memoria.registrar(b, 'operador', `B-${i}`));
    await Promise.all([...escritasA, ...escritasB]);

    const [histA, histB] = await Promise.all([memoria.historico(a), memoria.historico(b)]);
    const textosA = histA.map((r) => r.texto);
    const textosB = histB.map((r) => r.texto);

    assert.ok(textosA.every((t) => t.startsWith('A-')), `shard de A contém texto alheio: ${textosA.join(',')}`);
    assert.ok(textosB.every((t) => t.startsWith('B-')), `shard de B contém texto alheio: ${textosB.join(',')}`);
    assert.equal(textosA.length, 15, `A perdeu registro: só ${textosA.length}/15`);
    assert.equal(textosB.length, 15, `B perdeu registro: só ${textosB.length}/15`);
  } finally {
    await Promise.all([
      rm(path.resolve('dados', 'memoria', `${a}.json`), { force: true }),
      rm(path.resolve('dados', 'memoria', `${b}.json`), { force: true }),
    ]);
  }
});

test('OP-03. não existe leitura de memória que alcance outro operador', async () => {
  const memoria = new MemoriaOperacional();
  const a = `isolcruzado-op03-a-${Date.now()}`;
  const b = `isolcruzado-op03-b-${Date.now()}`;
  try {
    await memoria.registrar(a, 'operador', 'segredo da Ana');
    await memoria.gravarPreferencias(a, {
      como_chamar: 'Ana',
      tratamento: 'senhora',
      funcao: 'Diretora',
      observacoes: 'confidencial',
    });

    // B nunca foi escrito. Toda leitura de B tem que devolver o shard PRÓPRIO
    // dele — vazio — nunca o de A.
    const histB = await memoria.historico(b);
    const prefB = await memoria.lerPreferencias(b);

    assert.equal(histB.length, 0, `historico(b) enxergou dado de outro operador: ${JSON.stringify(histB)}`);
    assert.notEqual(prefB.como_chamar, 'Ana', 'preferências de A vazaram para a leitura de B');
  } finally {
    await Promise.all([
      rm(path.resolve('dados', 'memoria', `${a}.json`), { force: true }),
      rm(path.resolve('dados', 'memoria', `${b}.json`), { force: true }),
    ]);
  }
});

// ===========================================================================
// 2. MEMÓRIA — dois operadores, dois PROCESSOS reais
// ===========================================================================

function escreverMemoriaEmProcessoReal(idUsuario: string, prefixo: string, quantidade: number): void {
  const raizTmp = mkdtempSync(path.join(tmpdir(), 'iara-isolcruzado-proc-'));
  const roteiro = `
    process.chdir(${JSON.stringify(RAIZ)});
    import { MemoriaOperacional } from ${JSON.stringify(urlDe('servidor/nucleo/MemoriaOperacional.ts'))};
    const m = new MemoriaOperacional();
    for (let i = 0; i < ${quantidade}; i++) {
      await m.registrar(${JSON.stringify(idUsuario)}, 'operador', ${JSON.stringify(prefixo)} + '-' + i);
    }
  `;
  const arquivo = path.join(raizTmp, `escritor-${idUsuario}.mts`);
  writeFileSync(arquivo, roteiro, 'utf8');
  execFileSync(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe', timeout: 30_000 });
}

test('OP-02. dois PROCESSOS reais gravando memória de operadores diferentes ao mesmo tempo não se misturam', async () => {
  const a = `isolcruzado-proc-a-${Date.now()}`;
  const b = `isolcruzado-proc-b-${Date.now()}`;
  try {
    // execFileSync é síncrono; para dois processos REALMENTE concorrentes,
    // dispara os dois `execFileSync` em threads de worker via Promise + setImmediate
    // não adianta (execFileSync bloqueia a thread) — a concorrência real vem de
    // rodar os dois filhos como processos do SO ao mesmo tempo, então usamos
    // `spawn`-like via child_process assíncrono aqui em vez de execFileSync.
    const { spawn } = await import('node:child_process');
    function rodar(idUsuario: string, prefixo: string): Promise<void> {
      return new Promise((resolve, reject) => {
        const raizTmp = mkdtempSync(path.join(tmpdir(), 'iara-isolcruzado-proc-'));
        const roteiro = `
          process.chdir(${JSON.stringify(RAIZ)});
          import { MemoriaOperacional } from ${JSON.stringify(urlDe('servidor/nucleo/MemoriaOperacional.ts'))};
          const m = new MemoriaOperacional();
          for (let i = 0; i < 15; i++) {
            await m.registrar(${JSON.stringify(idUsuario)}, 'operador', ${JSON.stringify(prefixo)} + '-' + i);
          }
        `;
        const arquivo = path.join(raizTmp, `escritor.mts`);
        writeFileSync(arquivo, roteiro, 'utf8');
        const filho = spawn(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe' });
        let erro = '';
        filho.stderr.on('data', (d) => (erro += String(d)));
        filho.on('exit', (codigo) => (codigo === 0 ? resolve() : reject(new Error(`processo ${idUsuario} saiu com ${codigo}: ${erro}`))));
        filho.on('error', reject);
      });
    }

    await Promise.all([rodar(a, 'PA'), rodar(b, 'PB')]);

    const dadosA = JSON.parse(await readFile(path.resolve('dados', 'memoria', `${a}.json`), 'utf8'));
    const dadosB = JSON.parse(await readFile(path.resolve('dados', 'memoria', `${b}.json`), 'utf8'));
    const textosA = dadosA.registros.map((r: { texto: string }) => r.texto);
    const textosB = dadosB.registros.map((r: { texto: string }) => r.texto);

    assert.ok(textosA.every((t: string) => t.startsWith('PA-')), `arquivo de A contém texto de outro processo/operador: ${textosA.join(',')}`);
    assert.ok(textosB.every((t: string) => t.startsWith('PB-')), `arquivo de B contém texto de outro processo/operador: ${textosB.join(',')}`);
    assert.equal(textosA.length, 15, `processo de A perdeu registro sob corrida real: ${textosA.length}/15`);
    assert.equal(textosB.length, 15, `processo de B perdeu registro sob corrida real: ${textosB.length}/15`);
  } finally {
    await Promise.all([
      rm(path.resolve('dados', 'memoria', `${a}.json`), { force: true }),
      rm(path.resolve('dados', 'memoria', `${b}.json`), { force: true }),
    ]);
  }
});

// ===========================================================================
// 3. JORNAL — dois operadores, mesmo processo
// ===========================================================================

function jornalTmp(): { registro: RegistroOperacoes; raiz: string } {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-isolcruzado-jornal-'));
  return { registro: new RegistroOperacoes(raiz), raiz };
}

async function ciclo(registro: RegistroOperacoes, idUsuario: string, origem: string): Promise<void> {
  const reserva = registro.reservar({
    id_usuario: idUsuario,
    sessao: `sessao-${idUsuario}`,
    habilidade: 'falsa.escrever',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    parametros: { nota: origem },
    origem_pedido: origem,
  });
  if (reserva.tipo !== 'nova') return;
  const id = reserva.operacao.id_operacao;
  await registro.marcar(id, 'autorizada', evidencia('operador', 'teste'));
  await registro.marcar(id, 'executando', evidencia('executor', 'teste'));
  await registro.marcar(id, 'verificada', evidencia('verificador', 'teste'));
}

test('JR-01. dois operadores gravando jornal ao mesmo tempo não se misturam', async () => {
  const { registro, raiz } = jornalTmp();
  const a = 'operadora';
  const b = 'operadorb';

  await Promise.all([
    ...Array.from({ length: 10 }, (_, i) => ciclo(registro, a, `op-a-${i}`)),
    ...Array.from({ length: 10 }, (_, i) => ciclo(registro, b, `op-b-${i}`)),
  ]);

  const jornalA = await registro.reidratar(a);
  const jornalB = await registro.reidratar(b);

  assert.ok(jornalA.every((o) => o.id_usuario === a), `jornal de A tem operação de outro dono`);
  assert.ok(jornalB.every((o) => o.id_usuario === b), `jornal de B tem operação de outro dono`);
  assert.equal(jornalA.length, 10, `jornal de A perdeu operação: ${jornalA.length}/10`);
  assert.equal(jornalB.length, 10, `jornal de B perdeu operação: ${jornalB.length}/10`);

  // A garantia final: no ARQUIVO em disco, não só no índice em memória.
  const linhasA = readFileSync(path.join(raiz, `${a}.jsonl`), 'utf8').split('\n').filter(Boolean);
  for (const linha of linhasA) {
    assert.equal(JSON.parse(linha).id_usuario, a, `linha de outro operador vazou para o arquivo de ${a}`);
  }
});

// ===========================================================================
// 4. JORNAL — dois operadores, dois PROCESSOS reais
// ===========================================================================

test('JR-02. dois PROCESSOS reais gravando jornal de operadores diferentes ao mesmo tempo não se misturam', async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-isolcruzado-jornal-proc-'));
  const { spawn } = await import('node:child_process');

  function rodar(idUsuario: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const raizScript = mkdtempSync(path.join(tmpdir(), 'iara-isolcruzado-jornal-script-'));
      const roteiro = `
        import { RegistroOperacoes } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/RegistroOperacoes.ts'))};
        import { evidencia } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/Operacao.ts'))};
        const r = new RegistroOperacoes(${JSON.stringify(raiz)});
        for (let i = 0; i < 10; i++) {
          const reserva = r.reservar({
            id_usuario: ${JSON.stringify(idUsuario)}, sessao: 's', habilidade: 'falsa.escrever',
            risco: 'medio', semantica: 'escrita_nao_idempotente', parametros: { i },
            origem_pedido: ${JSON.stringify(idUsuario)} + '-' + i,
          });
          if (reserva.tipo !== 'nova') continue;
          const id = reserva.operacao.id_operacao;
          await r.marcar(id, 'autorizada', evidencia('operador', 'teste'));
          await r.marcar(id, 'executando', evidencia('executor', 'teste'));
          await r.marcar(id, 'verificada', evidencia('verificador', 'teste'));
        }
      `;
      const arquivo = path.join(raizScript, 'escritor.mts');
      writeFileSync(arquivo, roteiro, 'utf8');
      const filho = spawn(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe' });
      let erro = '';
      filho.stderr.on('data', (d) => (erro += String(d)));
      filho.on('exit', (codigo) => (codigo === 0 ? resolve() : reject(new Error(`processo ${idUsuario} saiu com ${codigo}: ${erro}`))));
      filho.on('error', reject);
    });
  }

  await Promise.all([rodar('processoa'), rodar('processob')]);

  const leitor = new RegistroOperacoes(raiz);
  const jornalA = await leitor.reidratar('processoa');
  const jornalB = await leitor.reidratar('processob');

  assert.ok(jornalA.every((o) => o.id_usuario === 'processoa'), 'jornal de A (processo real) tem operação de outro dono');
  assert.ok(jornalB.every((o) => o.id_usuario === 'processob'), 'jornal de B (processo real) tem operação de outro dono');
  assert.equal(jornalA.length, 10, `processo A perdeu operação sob corrida real de SO: ${jornalA.length}/10`);
  assert.equal(jornalB.length, 10, `processo B perdeu operação sob corrida real de SO: ${jornalB.length}/10`);
});

// ===========================================================================
// 5. JORNAL — linha forjada dentro do arquivo do dono, alegando outro dono
// ===========================================================================

test('JR-03. linha do jornal com id_usuario divergente do arquivo é recusada, não herdada', async () => {
  const { registro, raiz } = jornalTmp();
  const dono = 'donolegitimo';

  // Uma operação real e legítima do dono.
  await ciclo(registro, dono, 'linha-legitima');

  // Planta, no MESMO arquivo, uma linha que se declara de outro operador —
  // o ataque que `lerLinhaDoJornal` (RegistroOperacoes.ts) existe para barrar.
  const linhaForjada = {
    id_operacao: 'op-forjada',
    chave_idempotencia: 'chave-forjada',
    id_usuario: 'outrapessoa',
    sessao: 's',
    habilidade: 'falsa.escrever',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    parametros: {},
    origem_pedido: 'forjado',
    estado: 'verificada',
    criada_em: new Date().toISOString(),
    atualizada_em: new Date().toISOString(),
    expira_em: Date.now() + 60_000,
    historico: [{ estado: 'verificada', fonte: 'verificador', descricao: 'forjado', quando: new Date().toISOString() }],
  };
  appendFileSync(path.join(raiz, `${dono}.jsonl`), `${JSON.stringify(linhaForjada)}\n`);

  const leitor = new RegistroOperacoes(raiz);
  const relidas = await leitor.reidratar(dono);

  assert.ok(
    relidas.every((o) => o.id_usuario === dono),
    'a linha forjada com outro id_usuario foi aceita como se fosse do dono do arquivo',
  );
  assert.ok(
    !relidas.some((o) => o.id_operacao === 'op-forjada'),
    'a operação forjada entrou no índice reidratado',
  );
  // A operação legítima continua lá — recusar a linha ruim não pode custar a boa.
  assert.equal(relidas.length, 1, `esperava só a operação legítima, achei ${relidas.length}`);
});
