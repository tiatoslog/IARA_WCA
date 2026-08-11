/**
 * ENCERRAMENTO ABSOLUTO — o que faltava provar exaustivamente.
 *
 * As suítes anteriores provaram os caminhos que importam. Esta prova os que
 * ninguém escreveu de propósito:
 *
 *  1. a MATRIZ COMPLETA de transições — todos os 11×11 pares, não os que
 *     alguém lembrou de testar. Uma tabela auditada por amostragem é uma tabela
 *     onde a aresta perigosa é justamente a que ninguém amostrou;
 *  2. CRASH em cada posição observável do ciclo, com `SIGKILL` real;
 *  3. MUTAÇÃO DA CHAVE de idempotência — a chave certa é a que colide quando
 *     deve e só quando deve, e isso se prova variando cada componente dela.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  criarOperacao,
  derivarChaveIdempotencia,
  evidencia,
  transicaoPermitida,
  transicionar,
  EvidenciaInsuficiente,
  TransicaoInvalida,
  type EstadoOperacao,
  type FonteEvidencia,
} from '../servidor/nucleo/kernel/Operacao';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';

const RAIZ = process.cwd();
const urlDe = (r: string) => pathToFileURL(path.join(RAIZ, r)).href;

const TODOS_ESTADOS: EstadoOperacao[] = [
  'planejada',
  'aguardando_autorizacao',
  'autorizada',
  'executando',
  'executada_nao_verificada',
  'aceita_pelo_provedor',
  'verificada',
  'falhou',
  'desconhecida',
  'cancelada',
  'expirada',
];

const TODAS_FONTES: FonteEvidencia[] = [
  'verificador',
  'executor',
  'porteiro',
  'relogio',
  'operador',
  'reidratacao',
  'provedor',
];

function opEm(estado: EstadoOperacao, risco: 'baixo' | 'medio' | 'alto' = 'medio') {
  return {
    ...criarOperacao({
      id_usuario: 'u',
      sessao: 's',
      habilidade: 'x',
      risco,
      semantica: 'escrita_nao_idempotente',
      parametros: {},
      origem_pedido: 't',
    }),
    estado,
  };
}

// ===========================================================================
// 1. A MATRIZ COMPLETA — 11 × 11
// ===========================================================================

/**
 * A tabela ESPERADA, escrita à mão e independente da implementação.
 *
 * Escrita à mão de propósito: derivá-la de `TRANSICOES` provaria apenas que a
 * tabela é igual a si mesma. Ela é a segunda opinião, e uma divergência entre as
 * duas é exatamente o que este teste existe para encontrar.
 */
const ESPERADO: Record<EstadoOperacao, EstadoOperacao[]> = {
  planejada: ['aguardando_autorizacao', 'autorizada', 'cancelada', 'expirada', 'falhou'],
  aguardando_autorizacao: ['autorizada', 'cancelada', 'expirada'],
  autorizada: ['executando', 'cancelada', 'expirada'],
  executando: ['executada_nao_verificada', 'aceita_pelo_provedor', 'verificada', 'falhou', 'desconhecida'],
  executada_nao_verificada: ['verificada', 'falhou', 'desconhecida'],
  aceita_pelo_provedor: ['verificada', 'falhou', 'desconhecida'],
  desconhecida: ['verificada', 'falhou'],
  verificada: [],
  falhou: [],
  cancelada: [],
  expirada: [],
};

test('M1. a matriz 11×11 inteira bate com a tabela esperada', () => {
  const divergencias: string[] = [];
  for (const de of TODOS_ESTADOS) {
    for (const para of TODOS_ESTADOS) {
      const real = transicaoPermitida(de, para);
      const esperado = ESPERADO[de].includes(para);
      if (real !== esperado) {
        divergencias.push(`${de} → ${para}: código=${real}, esperado=${esperado}`);
      }
    }
  }
  assert.deepEqual(divergencias, [], `divergências na máquina de estados:\n  ${divergencias.join('\n  ')}`);
});

test('M2. TODA transição ilegal LANÇA — as 121 combinações, uma a uma', () => {
  const passaram: string[] = [];
  for (const de of TODOS_ESTADOS) {
    for (const para of TODOS_ESTADOS) {
      if (ESPERADO[de].includes(para)) continue;
      try {
        transicionar(opEm(de), para, evidencia('verificador', 'tentativa'));
        passaram.push(`${de} → ${para}`);
      } catch (e) {
        if (!(e instanceof TransicaoInvalida) && !(e instanceof EvidenciaInsuficiente)) {
          passaram.push(`${de} → ${para} (erro inesperado: ${(e as Error).name})`);
        }
      }
    }
  }
  assert.deepEqual(passaram, [], `transições ilegais que passaram: ${passaram.join(', ')}`);
});

test('M3. estados TERMINAIS não saem — nenhuma fonte, nenhum destino', () => {
  for (const terminal of ['verificada', 'falhou', 'cancelada', 'expirada'] as EstadoOperacao[]) {
    for (const destino of TODOS_ESTADOS) {
      for (const fonte of TODAS_FONTES) {
        assert.throws(
          () => transicionar(opEm(terminal), destino, evidencia(fonte, 'x')),
          `${terminal} → ${destino} passou com fonte "${fonte}"`,
        );
      }
    }
  }
});

test('M4. QUEM pode executar cada transição — a matriz de autoridade', () => {
  /**
   * A tabela que responde a segunda coluna da Fase 7. Duas regras, e as duas
   * são a razão de `FonteEvidencia` existir:
   *
   *   `verificada`  ← só `verificador`. Execução não é verificação.
   *   `autorizada`  ← só `operador` quando o risco é alto; `porteiro` serve para
   *                   o resto. A LLM não aparece em lugar nenhum da lista.
   */
  for (const fonte of TODAS_FONTES) {
    const promove = fonte === 'verificador';
    const chegada = () => transicionar(opEm('executando'), 'verificada', evidencia(fonte, 'x'));
    if (promove) assert.equal(chegada().estado, 'verificada');
    else assert.throws(chegada, EvidenciaInsuficiente, `"${fonte}" promoveu a verificada`);
  }

  for (const fonte of TODAS_FONTES) {
    const autorizaAlto = fonte === 'operador';
    const alto = () => transicionar(opEm('planejada', 'alto'), 'autorizada', evidencia(fonte, 'x'));
    if (autorizaAlto) assert.equal(alto().estado, 'autorizada');
    else assert.throws(alto, EvidenciaInsuficiente, `"${fonte}" autorizou risco alto`);

    const autorizaMedio = fonte === 'operador' || fonte === 'porteiro';
    const medio = () => transicionar(opEm('planejada', 'medio'), 'autorizada', evidencia(fonte, 'x'));
    if (autorizaMedio) assert.equal(medio().estado, 'autorizada');
    else assert.throws(medio, EvidenciaInsuficiente, `"${fonte}" autorizou risco médio`);
  }
});

test('M5. transicionar NUNCA muta a operação de entrada', () => {
  /**
   * O registro é imutável, e é isso que faz o jornal ser um jornal. Uma mutação
   * in-place aqui deixaria o histórico reescrevendo o próprio passado.
   */
  const original = opEm('executando');
  const antes = JSON.stringify(original);
  transicionar(original, 'verificada', evidencia('verificador', 'conferi'));
  assert.equal(JSON.stringify(original), antes, 'a operação de entrada foi mutada');
});

// ===========================================================================
// 2. CHAVE DE IDEMPOTÊNCIA — mutação de cada componente
// ===========================================================================

const BASE = {
  id_usuario: 'ana',
  habilidade: 'enviar_whatsapp',
  parametros: { destinatario: 'joao', mensagem: 'chegamos' },
  origem_pedido: 'turno-1',
};

test('C1. cada componente da chave a MUDA — nenhum é decorativo', () => {
  const original = derivarChaveIdempotencia(BASE);

  const variantes: [string, typeof BASE][] = [
    ['id_usuario', { ...BASE, id_usuario: 'bruno' }],
    ['habilidade', { ...BASE, habilidade: 'enviar_email' }],
    ['parâmetro (destinatário)', { ...BASE, parametros: { ...BASE.parametros, destinatario: 'maria' } }],
    ['parâmetro (mensagem)', { ...BASE, parametros: { ...BASE.parametros, mensagem: 'saímos' } }],
    ['origem_pedido', { ...BASE, origem_pedido: 'turno-2' }],
  ];

  for (const [nome, variante] of variantes) {
    assert.notEqual(
      derivarChaveIdempotencia(variante),
      original,
      `mudar "${nome}" não mudou a chave — operações diferentes colidem`,
    );
  }
});

test('C2. a chave é ESTÁVEL para a mesma operação — ordem de chave não conta', () => {
  assert.equal(
    derivarChaveIdempotencia(BASE),
    derivarChaveIdempotencia({
      ...BASE,
      parametros: { mensagem: 'chegamos', destinatario: 'joao' },
    }),
    'a mesma operação produziu duas chaves conforme a ordem do objeto',
  );
});

test('C3. FALSO POSITIVO: parâmetros que só se parecem não colidem', () => {
  /**
   * Concatenação ingênua (`a + b + c`) faz `{x:"ab", y:"c"}` e `{x:"a", y:"bc"}`
   * produzirem a mesma entrada de hash. Aqui a serialização é JSON com chaves
   * ordenadas, e os delimitadores impedem a fusão.
   */
  const a = derivarChaveIdempotencia({ ...BASE, parametros: { destinatario: 'joaosilva', mensagem: 'ok' } });
  const b = derivarChaveIdempotencia({ ...BASE, parametros: { destinatario: 'joao', mensagem: 'silvaok' } });
  assert.notEqual(a, b, 'dois envios diferentes colapsaram na mesma chave');
});

test('C4. FALSO NEGATIVO: a MESMA operação atravessa restart com a mesma chave', async () => {
  /**
   * Se a chave dependesse de qualquer coisa volátil — um contador, um relógio,
   * o pid — a reentrega pós-restart geraria chave nova e o efeito sairia duas
   * vezes. A chave é função pura dos quatro componentes, e este teste é a prova
   * pelo caminho vivo: mesmo jornal, registro novo, mesma reserva.
   */
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-chave-'));
  const antes = new RegistroOperacoes(raiz);
  const pedido = {
    id_usuario: 'ana',
    sessao: 's',
    habilidade: 'enviar',
    risco: 'medio' as const,
    semantica: 'escrita_nao_idempotente' as const,
    parametros: { texto: 'oi' },
    origem_pedido: 'wamid-fixo',
  };
  const r = antes.reservar(pedido);
  assert.equal(r.tipo, 'nova');
  await antes.marcar(
    r.tipo === 'nova' ? r.operacao.id_operacao : '',
    'autorizada',
    evidencia('porteiro', 'risco médio'),
  );

  const depois = new RegistroOperacoes(raiz);
  await depois.reidratar('ana');
  assert.equal(
    depois.reservar(pedido).tipo,
    'duplicada',
    'a mesma operação gerou chave diferente depois do restart',
  );
});

// ===========================================================================
// 3. CRASH REAL EM CADA POSIÇÃO OBSERVÁVEL
// ===========================================================================

/**
 * As oito posições da Fase 8 colapsam em QUATRO estados observáveis no jornal, e
 * essa é a informação, não uma simplificação:
 *
 *   antes de reservar        → nada no jornal
 *   depois da reserva        → nada no jornal (a reserva é em memória, e é seguro:
 *                              nada executou ainda)
 *   depois de `executando`   ┐
 *   antes do efeito          │ os quatro são INDISTINGUÍVEIS do disco — e é
 *   durante o efeito         │ exatamente por isso que o estado se chama
 *   depois do efeito         ┘ `desconhecida`
 *   depois do aceite         ┐ `aceita_pelo_provedor`
 *   antes da verificação     ┘
 *
 * Não dá para distinguir "morreu antes de mandar" de "morreu depois de mandar"
 * olhando o jornal — e um sistema que fingisse distinguir estaria inventando.
 */
type Parada = 'antes_de_reservar' | 'apos_reserva' | 'apos_executando' | 'apos_aceite';

function matarEm(parada: Parada): { raiz: string; morreu: boolean } {
  const raiz = mkdtempSync(path.join(tmpdir(), `iara-kill-${parada}-`));
  const passos: Record<Parada, string> = {
    antes_de_reservar: '',
    apos_reserva: '',
    apos_executando: `
      await r.marcar(id, 'autorizada', evidencia('operador', 'pediu'));
      await r.marcar(id, 'executando', evidencia('executor', 'antes do efeito'));`,
    apos_aceite: `
      await r.marcar(id, 'autorizada', evidencia('operador', 'pediu'));
      await r.marcar(id, 'executando', evidencia('executor', 'antes do efeito'));
      await r.marcar(id, 'aceita_pelo_provedor', evidencia('provedor', 'a Meta aceitou'));`,
  };

  const reserva =
    parada === 'antes_de_reservar'
      ? 'const id = null;'
      : `const reserva = r.reservar({
           id_usuario: 'ana', sessao: 's', habilidade: 'lab.enviar', risco: 'medio',
           semantica: 'escrita_nao_idempotente', parametros: { texto: 'oi' },
           origem_pedido: 'crash-${parada}',
         });
         const id = reserva.operacao.id_operacao;`;

  const roteiro = `
    import { RegistroOperacoes } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/RegistroOperacoes.ts'))};
    import { evidencia } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/Operacao.ts'))};
    const r = new RegistroOperacoes(${JSON.stringify(raiz)});
    ${reserva}
    ${passos[parada]}
    process.kill(process.pid, 'SIGKILL');
  `;
  const arquivo = path.join(raiz, 'suicida.mts');
  writeFileSync(arquivo, roteiro, 'utf8');

  let morreu = false;
  try {
    execFileSync(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe', timeout: 60_000 });
  } catch {
    morreu = true;
  }
  return { raiz, morreu };
}

const ESPERADO_POS_CRASH: Record<Parada, EstadoOperacao | null> = {
  antes_de_reservar: null, // nada no jornal
  apos_reserva: null, // reserva é em memória; nada executou
  apos_executando: 'desconhecida',
  apos_aceite: 'aceita_pelo_provedor',
};

for (const parada of Object.keys(ESPERADO_POS_CRASH) as Parada[]) {
  test(`K. SIGKILL real em "${parada}" → ${ESPERADO_POS_CRASH[parada] ?? 'nada no jornal'}`, async () => {
    const { raiz, morreu } = matarEm(parada);
    assert.ok(morreu, 'o processo filho deveria ter sido morto por SIGKILL');

    const registro = new RegistroOperacoes(raiz);
    const recuperadas = await registro.reidratar('ana');
    const esperado = ESPERADO_POS_CRASH[parada];

    if (esperado === null) {
      assert.equal(
        recuperadas.length,
        0,
        `crash antes do efeito deixou ${recuperadas.length} operação(ões) no jornal`,
      );
      assert.equal(existsSync(path.join(raiz, 'ana.jsonl')), false);
      return;
    }

    assert.equal(recuperadas.length, 1, `esperava 1 operação, veio ${recuperadas.length}`);
    assert.equal(recuperadas[0].estado, esperado, `voltou como "${recuperadas[0].estado}"`);

    // E, nos dois casos em que o efeito pode existir, o retry fica bloqueado.
    assert.equal(
      registro.reservar({
        id_usuario: 'ana',
        sessao: 's',
        habilidade: 'lab.enviar',
        risco: 'medio',
        semantica: 'escrita_nao_idempotente',
        parametros: { texto: 'oi' },
        origem_pedido: 'depois-do-crash',
      }).tipo,
      'bloqueada',
      'depois do crash a IARA repetiria um efeito que pode existir',
    );
  });
}

test('K5. crash NUNCA ressuscita autorização — nem em `autorizada`, nem em `aguardando`', async () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-kill-auth-'));
  const roteiro = `
    import { RegistroOperacoes } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/RegistroOperacoes.ts'))};
    import { evidencia } from ${JSON.stringify(urlDe('servidor/nucleo/kernel/Operacao.ts'))};
    const r = new RegistroOperacoes(${JSON.stringify(raiz)});
    const a = r.reservar({ id_usuario:'ana', sessao:'s', habilidade:'energia_da_maquina', risco:'alto',
      semantica:'escrita_nao_idempotente', parametros:{acao:'desligar'}, origem_pedido:'k5a' });
    await r.marcar(a.operacao.id_operacao, 'aguardando_autorizacao', evidencia('porteiro', 'exige confirmação'));
    const b = r.reservar({ id_usuario:'ana', sessao:'s', habilidade:'enviar', risco:'alto',
      semantica:'escrita_nao_idempotente', parametros:{texto:'x'}, origem_pedido:'k5b' });
    await r.marcar(b.operacao.id_operacao, 'autorizada', evidencia('operador', 'confirmo'));
    process.kill(process.pid, 'SIGKILL');
  `;
  const arquivo = path.join(raiz, 'suicida.mts');
  writeFileSync(arquivo, roteiro, 'utf8');
  try {
    execFileSync(process.execPath, ['--import', 'tsx', arquivo], { stdio: 'pipe', timeout: 60_000 });
  } catch {
    /* esperado */
  }

  const registro = new RegistroOperacoes(raiz);
  const recuperadas = await registro.reidratar('ana');
  assert.equal(recuperadas.length, 2);
  for (const op of recuperadas) {
    assert.equal(
      op.estado,
      'expirada',
      `${op.habilidade} sobreviveu ao crash como "${op.estado}" em vez de expirar`,
    );
  }
  assert.equal(registro.pendenteDe('ana', 's'), null, 'restart deixou pendência confirmável');
});

test('K6. o jornal de um processo morto é legível por outro — sem lock preso', () => {
  /**
   * `SIGKILL` não roda `finally`. Se o jornal dependesse de um handle liberado
   * no encerramento — um lockfile, um descritor exclusivo — o processo seguinte
   * encontraria o arquivo travado e a recuperação viraria outro modo de falha.
   */
  const { raiz } = matarEm('apos_executando');
  const conteudo = readFileSync(path.join(raiz, 'ana.jsonl'), 'utf8');
  assert.ok(conteudo.length > 0, 'o jornal do processo morto está vazio');
  assert.equal(conteudo.split('\n').filter(Boolean).length, 2, 'esperava autorizada + executando');
});
