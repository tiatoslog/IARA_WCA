/**
 * PROVA EXECUTÁVEL DAS PROPRIEDADES CRÍTICAS.
 *
 * As outras suítes perguntam "a IARA faz o que promete?". Esta pergunta outra
 * coisa, e é a pergunta do gate:
 *
 *   existe alguma saída da camada de raciocínio capaz de produzir uma destas
 *   oito consequências?
 *
 * A resposta só vale se a barreira exercitada for a REAL. Por isso nenhum teste
 * daqui substitui `transicionar`, `validar`, o sandbox de papel ou o porteiro
 * por uma versão de laboratório: um teste de propriedade que mocka a barreira
 * mede a própria fixture. As integrações de laboratório existem — mas do lado
 * do PROVEDOR, que é justamente a parte que não é barreira.
 *
 * O QUE ESTE ARQUIVO ACRESCENTA ÀS SUÍTES QUE JÁ EXISTIAM: a amarração. Cada
 * verificação declara qual propriedade e qual PONTO DE IMPOSIÇÃO ela exercitou,
 * e o último teste falha se sobrar propriedade declarada sem prova executada,
 * ou ponto de imposição citado no registro que sumiu do código. Uma propriedade
 * sem prova executada é `NOT PROVEN` — e `NOT PROVEN` nunca é `PASS`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROPRIEDADES_CRITICAS,
  propriedade,
  type IdPropriedade,
} from '../servidor/nucleo/kernel/Invariantes';
import {
  criarOperacao,
  evidencia,
  transicionar,
  transicaoPermitida,
  EvidenciaInsuficiente,
  TransicaoInvalida,
  type EstadoOperacao,
} from '../servidor/nucleo/kernel/Operacao';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { PortalEfeitos, type Integracao } from '../servidor/nucleo/kernel/PortalEfeitos';
import { PorteiroAutorizacao } from '../servidor/nucleo/kernel/PorteiroAutorizacao';
import { PoliticaRisco } from '../servidor/nucleo/kernel/PoliticaRisco';
import { PoliticaPadrao, SandboxPorPolitica } from '../servidor/nucleo/kernel/Seguranca';
import { exigirIdCanonico, IdentidadeInvalida } from '../servidor/nucleo/kernel/Identidade';
import { validar, ParametroInvalido, type Esquema } from '../servidor/nucleo/kernel/Habilidade';
import {
  conferirRegistro,
  emitirProva,
  ProvaRecusada,
  type Invariante,
} from '../servidor/nucleo/kernel/Prova';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

// ===========================================================================
// O livro-caixa da cobertura
// ===========================================================================

const exercidos = new Map<IdPropriedade, Set<string>>();

/**
 * Registra que um ponto de imposição foi de fato exercitado por código que
 * acabou de rodar. Recusa símbolo que a propriedade não declara — senão a
 * cobertura vira autoelogio: bastaria escrever o nome certo.
 */
function exercido(id: IdPropriedade, simbolo: string): void {
  const p = propriedade(id);
  assert.ok(
    p.imposta_por.some((x) => x.simbolo === simbolo),
    `${id} não declara "${simbolo}" como ponto de imposição`,
  );
  const jaVistos = exercidos.get(id) ?? new Set<string>();
  jaVistos.add(simbolo);
  exercidos.set(id, jaVistos);
}

const RAIZ_WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function jornal() {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-prop-'));
  return { raiz, registro: new RegistroOperacoes(raiz) };
}

const PEDIDO_BASE = {
  id_usuario: 'ana',
  sessao: 's1',
  habilidade: 'criar_pasta',
  risco: 'medio' as const,
  semantica: 'escrita_idempotente' as const,
  parametros: { nome: 'Contratos' },
  origem_pedido: 'traco-1',
};

const TODAS_INVARIANTES: readonly Invariante[] = [
  'ISOLAMENTO_SHARD',
  'PARAMETROS_VALIDADOS',
  'SEMANTICA_DECLARADA',
  'AUTORIZACAO_TIPADA',
  'ORIGEM_RASTREAVEL',
];

// ===========================================================================
// P1 — ação não autorizada nunca executa
// ===========================================================================

test('P1: papel sem a permissão não aciona a habilidade, e a recusa é anterior ao efeito', () => {
  const sandbox = new SandboxPorPolitica(new PoliticaPadrao());

  // `externo` não é concedido nem ao operador: envio a terceiro exige o papel
  // administrador. É a permissão que separa "mexe na máquina dela" de "fala com
  // o mundo em nome dela".
  assert.throws(() => sandbox.verificar('enviar_whatsapp', ['externo'], 'operador'), /externo/);
  assert.throws(() => sandbox.verificar('criar_pasta', ['escrita'], 'somente_leitura'));
  assert.doesNotThrow(() => sandbox.verificar('consultar_clima', ['banco'], 'somente_leitura'));
  exercido('P1_ACAO_NAO_AUTORIZADA_NUNCA_EXECUTA', 'SandboxPorPolitica');

  // A concessão de papel não sobrepõe o porteiro: administrador continua sem
  // conseguir executar risco alto por plano da LLM.
  const porteiro = new PorteiroAutorizacao();
  assert.equal(
    porteiro.avaliar({ habilidade: 'acionar_energia', risco: 'alto', origem: 'emergente' })
      .permitido,
    false,
  );
  exercido('P1_ACAO_NAO_AUTORIZADA_NUNCA_EXECUTA', 'PorteiroAutorizacao');
});

// ===========================================================================
// P2 — ferramenta que falhou nunca vira sucesso
// ===========================================================================

function integracaoQueExplode(entregues: string[]): Integracao {
  return {
    id: 'lab.enviar',
    nome: 'provedor de laboratório',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    timeout_ms: 200,
    esquema: {
      telefone: { tipo: 'texto', obrigatorio: true },
      texto: { tipo: 'texto', obrigatorio: true },
    },
    async executar() {
      throw new Error('provedor devolveu HTTP 500');
    },
  };
}

test('P2: provedor que explode não vira sucesso, e o executor não promove a verificada', async () => {
  const entregues: string[] = [];
  const { registro } = jornal();
  const portal = new PortalEfeitos(registro);
  portal.registrar(integracaoQueExplode(entregues));

  const r = await portal.executar({
    integracao: 'lab.enviar',
    id_usuario: 'ana',
    sessao: 'whatsapp:ana',
    parametros: { telefone: '5565999998888', texto: 'oi' },
    origem_pedido: 'msg-1',
    fonte_autorizacao: 'operador',
    motivo_autorizacao: 'mensagem do operador',
  });
  assert.notEqual(r.tipo, 'entregue');
  assert.equal(entregues.length, 0);
  exercido('P2_FERRAMENTA_QUE_FALHOU_NUNCA_VIRA_SUCESSO', 'executar');

  /**
   * A segunda barreira, e é a que sobrevive a um caminho de execução novo: mesmo
   * que alguém escreva um executor que se declare satisfeito, `verificada` só
   * nasce de `verificador`. `executor` é a fonte de quem RELATOU — nunca de quem
   * conferiu.
   */
  const op = criarOperacao(PEDIDO_BASE);
  const autorizada = transicionar(op, 'autorizada', evidencia('operador', 'pedido direto'));
  const executando = transicionar(autorizada, 'executando', evidencia('executor', 'saiu'));
  assert.throws(
    () => transicionar(executando, 'verificada', evidencia('executor', 'deu certo, juro')),
    EvidenciaInsuficiente,
  );
  assert.doesNotThrow(() =>
    transicionar(executando, 'verificada', evidencia('verificador', 'a pasta está lá')),
  );
  exercido('P2_FERRAMENTA_QUE_FALHOU_NUNCA_VIRA_SUCESSO', 'EvidenciaInsuficiente');
});

// ===========================================================================
// P3 — ação cancelada nunca executa
// ===========================================================================

test('P3: de `cancelada` não sai transição nenhuma, e "confirmo" atrasado não ressuscita', async () => {
  const TODOS: readonly EstadoOperacao[] = [
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
  for (const destino of TODOS) {
    assert.equal(
      transicaoPermitida('cancelada', destino),
      false,
      `cancelada → ${destino} não pode existir`,
    );
  }

  const cancelada = transicionar(
    criarOperacao({ ...PEDIDO_BASE, risco: 'alto', habilidade: 'acionar_energia' }),
    'cancelada',
    evidencia('operador', 'desisti'),
  );
  assert.throws(
    () => transicionar(cancelada, 'autorizada', evidencia('operador', 'confirmo')),
    TransicaoInvalida,
  );
  exercido('P3_ACAO_CANCELADA_NUNCA_EXECUTA', 'TRANSICOES');

  // E o caminho vivo — o que o operador realmente atravessa quando diz
  // "confirmo" depois de ter desistido.
  const { registro } = jornal();
  const reserva = registro.reservar({ ...PEDIDO_BASE, risco: 'alto' });
  assert.equal(reserva.tipo, 'nova');
  const op = reserva.tipo === 'nova' ? reserva.operacao : null;
  assert.ok(op);
  await registro.marcar(op.id_operacao, 'cancelada', evidencia('operador', 'desisti'));

  const tardio = await registro.autorizar({
    id_operacao: op.id_operacao,
    nonce: op.nonce,
    id_usuario: 'ana',
    sessao: 's1',
    fala: 'confirmo',
  });
  assert.equal(tardio.ok, false);
  assert.match(tardio.ok === false ? tardio.motivo : '', /cancelad/);
  exercido('P3_ACAO_CANCELADA_NUNCA_EXECUTA', 'autorizar');
});

// ===========================================================================
// P4 — shard alheio nunca é alcançado
// ===========================================================================

test('P4: linha de outro dono é recusada, e identificador não canônico não é consertado', async () => {
  const { raiz, registro } = jornal();
  const reserva = registro.reservar(PEDIDO_BASE);
  assert.equal(reserva.tipo, 'nova');
  const op = reserva.tipo === 'nova' ? reserva.operacao : null;
  assert.ok(op);
  await registro.marcar(op.id_operacao, 'autorizada', evidencia('operador', 'pedido direto'));

  const arquivo = path.join(raiz, 'ana.jsonl');
  const linha = JSON.parse(readFileSync(arquivo, 'utf8').trim().split('\n')[0]);
  appendFileSync(
    arquivo,
    `${JSON.stringify({ ...linha, id_operacao: 'forjada', id_usuario: 'bruno' })}\n`,
    'utf8',
  );

  const depois = new RegistroOperacoes(raiz);
  const recuperadas = await depois.reidratar('ana');
  assert.equal(
    recuperadas.some((o) => o.id_operacao === 'forjada'),
    false,
  );
  assert.match(depois.linhasRecusadas[0].motivo, /dono divergente/);
  exercido('P4_SHARD_ALHEIO_NUNCA_E_ALCANCADO', 'lerLinhaDoJornal');

  // A travessia de diretório e a identidade "quase igual" morrem antes: o nome
  // do arquivo é derivado do id, e id não canônico é recusado — nunca saneado
  // para algo que colidiria com o jornal de outra pessoa.
  for (const hostil of ['../bruno', 'ana/../bruno', 'ana bruno', 'Ana', '']) {
    assert.throws(() => exigirIdCanonico(hostil, 'teste'), IdentidadeInvalida, `aceitou "${hostil}"`);
  }
  exercido('P4_SHARD_ALHEIO_NUNCA_E_ALCANCADO', 'exigirIdCanonico');
});

// ===========================================================================
// P5 — o dono do efeito nunca vem do pedido
// ===========================================================================

test('P5: parâmetro que se disfarça de identidade não muda o dono nem chega à habilidade', () => {
  /**
   * O ataque é banal e por isso perigoso: a LLM emite um passo cujos parâmetros
   * contêm `id_usuario: "bruno"`. Se algum caminho lesse identidade dos
   * parâmetros, o efeito nasceria no shard do bruno com a sessão da ana.
   */
  const op = criarOperacao({
    ...PEDIDO_BASE,
    parametros: { nome: 'Contratos', id_usuario: 'bruno', shard: 'bruno', dono: 'bruno' },
  });
  assert.equal(op.id_usuario, 'ana', 'o dono é o da sessão, nunca um campo do pedido');
  exercido('P5_DONO_DO_EFEITO_NUNCA_VEM_DO_PEDIDO', 'criarOperacao');

  // E o parâmetro nem sobrevive ao contrato: chave não declarada derruba a
  // chamada inteira, em vez de ser silenciosamente ignorada.
  const esquema: Esquema = { nome: { tipo: 'texto', obrigatorio: true } };
  assert.throws(() => validar(esquema, { nome: 'Contratos', id_usuario: 'bruno' }), ParametroInvalido);
  assert.deepEqual(validar(esquema, { nome: 'Contratos' }), { nome: 'Contratos' });
  exercido('P5_DONO_DO_EFEITO_NUNCA_VEM_DO_PEDIDO', 'validar');
});

// ===========================================================================
// P6 — fato desconhecido nunca vira verificado
// ===========================================================================

test('P6: sem verificador, sem invariante e sem chave, o veredito é "não sei" — nunca "conferido"', () => {
  const op = criarOperacao(PEDIDO_BASE);
  const executando = transicionar(
    transicionar(op, 'autorizada', evidencia('operador', 'pedido')),
    'executando',
    evidencia('executor', 'saiu'),
  );
  for (const fonte of ['executor', 'porteiro', 'relogio', 'operador', 'reidratacao'] as const) {
    assert.throws(
      () => transicionar(executando, 'verificada', evidencia(fonte, 'acho que deu')),
      EvidenciaInsuficiente,
      `fonte "${fonte}" não pode promover a verificada`,
    );
  }
  exercido('P6_FATO_DESCONHECIDO_NUNCA_VIRA_VERIFICADO', 'transicionar');

  // A prova recusa NASCER incompleta: é o que torna
  // `Status != VERIFIED_PROOF => ABORT` uma consequência do caminho, e não um
  // `if` que alguém precisa lembrar de escrever no caminho novo.
  const base = {
    id_acao: 'op-1',
    enunciado: 'crie a pasta Contratos',
    parametros: { nome: 'Contratos' },
    reivindicacoes: { id_usuario: 'ana', sessao: 's1', papel: 'operador', escopo: ['escrita'] },
    avaliacao: {
      permitido: true,
      politica: 'risco_medio/operador',
      risco: 'medio',
      fonte_autorizacao: 'operador',
    },
    invariantes: TODAS_INVARIANTES,
  };
  for (const faltante of TODAS_INVARIANTES) {
    assert.throws(
      () => emitirProva({ ...base, invariantes: TODAS_INVARIANTES.filter((i) => i !== faltante) }),
      ProvaRecusada,
      `prova nasceu sem ${faltante}`,
    );
  }
  assert.doesNotThrow(() => emitirProva(base));
  exercido('P6_FATO_DESCONHECIDO_NUNCA_VIRA_VERIFICADO', 'emitirProva');

  /**
   * E a ausência de chave é dita como ausência. `sem_chave` existe para que
   * ninguém leia "não pude conferir" como "confere" — a diferença entre as duas
   * é a diferença entre uma trilha de auditoria e um arquivo de texto.
   */
  const antes = process.env.IARA_CHAVE_PROVA;
  delete process.env.IARA_CHAVE_PROVA;
  try {
    const selavel = {
      id_operacao: op.id_operacao,
      chave_idempotencia: op.chave_idempotencia,
      id_usuario: op.id_usuario,
      sessao: op.sessao,
      habilidade: op.habilidade,
      risco: op.risco,
      semantica: op.semantica,
      parametros: op.parametros,
      estado: op.estado,
      nonce: op.nonce,
      autorizada_em: op.autorizada_em,
      criada_em: op.criada_em,
      atualizada_em: op.atualizada_em,
      historico: op.historico,
    };
    assert.equal(conferirRegistro(selavel, 'selo-inventado'), 'sem_chave');
    assert.notEqual(conferirRegistro(selavel, 'selo-inventado'), 'valido');
  } finally {
    if (antes === undefined) delete process.env.IARA_CHAVE_PROVA;
    else process.env.IARA_CHAVE_PROVA = antes;
  }
  exercido('P6_FATO_DESCONHECIDO_NUNCA_VIRA_VERIFICADO', 'conferirRegistro');
});

// ===========================================================================
// P7 — plano emergente nunca executa risco alto
// ===========================================================================

test('P7: risco alto não é planejável, e o catálogo oferecido à LLM não o contém', () => {
  const porteiro = new PorteiroAutorizacao();
  assert.equal(porteiro.planejavel('alto'), false);
  assert.equal(porteiro.planejavel('medio'), true);

  const oferecidas = CATALOGO.map((h) => h.manifesto).filter(
    (m) => m.custo === 'zero' && porteiro.planejavel(m.risco),
  );
  assert.equal(
    oferecidas.some((m) => m.risco === 'alto'),
    false,
    'nenhum manifesto de risco alto pode entrar no catálogo oferecido à LLM',
  );
  exercido('P7_PLANO_EMERGENTE_NUNCA_EXECUTA_RISCO_ALTO', 'planejavel');
});

// ===========================================================================
// P8 — ação irreversível exige fala humana
// ===========================================================================

test('P8: risco alto só chega a autorizada por evidência de operador', () => {
  assert.equal(new PoliticaRisco().exigenciaDe('alto').confirmacaoPrevia, true);
  assert.equal(new PoliticaRisco().exigenciaDe('medio').confirmacaoPrevia, false);
  exercido('P8_ACAO_IRREVERSIVEL_EXIGE_FALA_HUMANA', 'exigenciaDe');

  const alto = criarOperacao({ ...PEDIDO_BASE, risco: 'alto', habilidade: 'acionar_energia' });
  for (const fonte of ['porteiro', 'executor', 'relogio', 'reidratacao', 'verificador'] as const) {
    assert.throws(
      () => transicionar(alto, 'autorizada', evidencia(fonte, 'liberado')),
      EvidenciaInsuficiente,
      `fonte "${fonte}" autorizou risco alto`,
    );
  }
  assert.doesNotThrow(() =>
    transicionar(alto, 'autorizada', evidencia('operador', 'confirmo, pode desligar')),
  );

  // Risco médio dispensa fala humana, mas não dispensa autorização registrada:
  // executor não se autoriza.
  const medio = criarOperacao(PEDIDO_BASE);
  assert.doesNotThrow(() => transicionar(medio, 'autorizada', evidencia('porteiro', 'risco médio')));
  assert.throws(
    () => transicionar(medio, 'autorizada', evidencia('executor', 'me autorizo')),
    EvidenciaInsuficiente,
  );
  exercido('P8_ACAO_IRREVERSIVEL_EXIGE_FALA_HUMANA', 'transicionar');
});

// ===========================================================================
// O fecho: propriedade sem prova executada é NOT PROVEN, e NOT PROVEN não é PASS
// ===========================================================================

test('COBERTURA: toda propriedade declarada foi exercitada em cada ponto de imposição', () => {
  const faltando: string[] = [];
  for (const p of PROPRIEDADES_CRITICAS) {
    const vistos = exercidos.get(p.id) ?? new Set<string>();
    for (const ponto of p.imposta_por) {
      if (!vistos.has(ponto.simbolo)) faltando.push(`${p.id} → ${ponto.simbolo}`);
    }
  }
  assert.deepEqual(
    faltando,
    [],
    `propriedade declarada sem prova executada (NOT PROVEN):\n  ${faltando.join('\n  ')}`,
  );
});

test('COBERTURA: todo ponto de imposição citado ainda existe no código', () => {
  const sumidos: string[] = [];
  for (const p of PROPRIEDADES_CRITICAS) {
    for (const ponto of p.imposta_por) {
      const caminho = path.join(RAIZ_WEB, ponto.arquivo);
      if (!existsSync(caminho)) {
        sumidos.push(`${p.id}: arquivo ausente ${ponto.arquivo}`);
        continue;
      }
      if (!readFileSync(caminho, 'utf8').includes(ponto.simbolo)) {
        sumidos.push(`${p.id}: "${ponto.simbolo}" não está mais em ${ponto.arquivo}`);
      }
    }
  }
  assert.deepEqual(sumidos, [], `registro de propriedades desatualizado:\n  ${sumidos.join('\n  ')}`);
});

test('COBERTURA: as oito propriedades do briefing estão declaradas, sem duplicata', () => {
  assert.equal(PROPRIEDADES_CRITICAS.length, 8);
  const ids = PROPRIEDADES_CRITICAS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, 'id repetido no registro');
  for (const p of PROPRIEDADES_CRITICAS) {
    assert.ok(p.briefing.includes('NEVER') || p.briefing.includes('WITHOUT'), p.id);
    assert.ok(p.violacao_permitiria.length > 20, `${p.id} não diz o que a violação permitiria`);
  }
});
