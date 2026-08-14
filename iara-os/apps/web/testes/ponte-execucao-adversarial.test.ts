/**
 * A PONTE DE EXECUÇÃO, ATACADA — a suíte que nasceu de cinco defeitos reais.
 *
 * `ponte-execucao.test.ts` prova que a ponte se comporta bem quando o outro
 * lado se comporta bem: o computador desligado, a ordem perdida, o relato
 * atrasado. Este arquivo assume o contrário — que o braço é HOSTIL, ou apenas
 * de uma versão com defeito — e que o operador clica duas vezes.
 *
 * Os cinco defeitos abaixo foram encontrados executando, com a suíte anterior
 * inteira em verde (641 testes, 0 falhas). Nenhum deles era visível lendo o
 * código: cada um mora na diferença entre o que um comentário afirmava e o que
 * a condição ao lado dele testava.
 *
 *  B1  duplo clique CONCORRENTE executava duas vezes. `porChave` só era escrito
 *      em `fechar` — depois do desfecho —, então dois pedidos idênticos no mesmo
 *      tique passavam os dois por `repeticaoDe` com o mapa vazio. A fila por
 *      operador não salvava: ela serializa, não deduplica.
 *  B2  `sucesso` com prova NEGADA atravessava o portão de coerência. Ele só
 *      rebaixava quando o motivo era `divergente`; `nao_encontrado` e a prova
 *      sem motivo nenhum passavam intactas para `estado: 'sucesso'`.
 *  B3  a chave de idempotência de transporte usava `=`/`&`/`|` como separadores
 *      — caracteres que um valor de parâmetro pode conter. Duas ordens
 *      diferentes podiam colidir na mesma chave.
 *  B4  `lerPacoteBraco` conferia quatro campos e repassava o objeto inteiro com
 *      um `as RelatoExecucao`. Texto de qualquer tamanho, `estado` fora do
 *      vocabulário, `evidencia` que não é texto e `codigo_erro` inventado
 *      entravam tipados por confiança.
 *  B5  `validarNomePasta` aceitava `CON`, `NUL`, `COM1` — nomes de dispositivo
 *      do Windows. O `mkdir` falhava com `EINVAL` e o operador recebia "erro
 *      interno" no lugar da recusa que explica o que fazer.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Braco, type PonteDeOrdens } from '../servidor/nucleo/Braco';
import { validarNomePasta } from '../servidor/nucleo/AgenteLocal';
import { lerPacoteBraco, type OrdemExecucao, type RelatoExecucao } from '../lib/execucao';
import type { DispositivoConectado } from '../servidor/barramento/PonteDispositivos';

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------

const ponteVazia: PonteDeOrdens = { destinoDe: () => null, aoPacote: () => () => undefined };

/** Um motor com mãos que CONTA quantas vezes foi chamado e com quê. */
function motorEspiao(atrasoMs = 30) {
  const chamadas: OrdemExecucao[] = [];
  const executar = async (ordem: OrdemExecucao): Promise<RelatoExecucao> => {
    chamadas.push(ordem);
    await new Promise((r) => setTimeout(r, atrasoMs));
    return {
      execucao_id: ordem.execucao_id,
      estado: 'sucesso',
      texto: `executei ${ordem.acao}`,
      prova: { confirmado: true, evidencia: 'espião' },
      codigo_erro: null,
      duracao_ms: 1,
      dispositivo: null,
      onde: 'motor',
    };
  };
  return { chamadas, executar };
}

/** Um braço que responde o relato que se mandar — inclusive um impossível. */
function bracoMentiroso(mentira: Partial<RelatoExecucao>) {
  let publicar: ((d: DispositivoConectado, p: never) => void) | null = null;
  const dispositivo: DispositivoConectado = {
    id_dispositivo: 'disp-mentiroso',
    id_usuario: 'ana',
    nome: 'maquina',
    plataforma: 'teste',
    versao: '0',
    conectado_em: 0,
    visto_em: 0,
    atualizando: null,
    ultimoErroAtualizacao: null,
    enviar: (pacote) => {
      if (pacote.tipo !== 'executar') return true;
      setTimeout(() => {
        publicar?.(dispositivo, {
          tipo: 'concluida',
          relato: {
            execucao_id: pacote.ordem.execucao_id,
            estado: 'sucesso',
            texto: 'feito',
            prova: { confirmado: true, evidencia: 'dublê' },
            codigo_erro: null,
            duracao_ms: 1,
            dispositivo: 'disp-mentiroso',
            onde: 'dispositivo',
            ...mentira,
          },
        } as never);
      }, 5);
      return true;
    },
    fechar: () => undefined,
  };
  return {
    destinoDe: () => dispositivo,
    aoPacote: (o: (d: DispositivoConectado, p: never) => void) => {
      publicar = o;
      return () => (publicar = null);
    },
  } as PonteDeOrdens;
}

const semMaos = async (): Promise<RelatoExecucao> => {
  throw new Error('o motor não deveria executar neste teste');
};

// ===========================================================================
// B1. O duplo clique — a repetição que chega ANTES do desfecho
// ===========================================================================

test('B1. dois pedidos idênticos SIMULTÂNEOS produzem UMA execução', async () => {
  const espiao = motorEspiao();
  const braco = new Braco(ponteVazia, espiao.executar, () => true);

  const pedido = {
    acao: 'abrir_aplicativo' as const,
    parametros: { aplicativo: 'bloco de notas' },
    id_usuario: 'ana',
    sessao: 's1',
  };
  const [primeiro, segundo] = await Promise.all([braco.executar(pedido), braco.executar(pedido)]);

  assert.equal(espiao.chamadas.length, 1, 'o efeito não pode acontecer duas vezes');
  const estados = [primeiro.estado, segundo.estado].sort();
  assert.deepEqual(estados, ['duplicada', 'sucesso']);
  // A repetição devolve o desfecho do ORIGINAL, não um relato inventado.
  assert.equal(primeiro.execucao_id, segundo.execucao_id);
});

test('B1b. dez pedidos idênticos em rajada produzem UMA execução', async () => {
  const espiao = motorEspiao(15);
  const braco = new Braco(ponteVazia, espiao.executar, () => true);
  const pedido = {
    acao: 'criar_pasta' as const,
    parametros: { nome: 'relatorios', local: 'documentos' },
    id_usuario: 'ana',
    sessao: 's1',
  };

  const relatos = await Promise.all(Array.from({ length: 10 }, () => braco.executar(pedido)));

  assert.equal(espiao.chamadas.length, 1);
  assert.equal(relatos.filter((r) => r.estado === 'sucesso').length, 1);
  assert.equal(relatos.filter((r) => r.estado === 'duplicada').length, 9);
});

test('B1c. a deduplicação é POR PEDIDO, não uma trava geral', async () => {
  const espiao = motorEspiao(15);
  const braco = new Braco(ponteVazia, espiao.executar, () => true);

  await Promise.all([
    braco.executar({ acao: 'criar_pasta', parametros: { nome: 'a' }, id_usuario: 'ana', sessao: 's' }),
    braco.executar({ acao: 'criar_pasta', parametros: { nome: 'b' }, id_usuario: 'ana', sessao: 's' }),
    braco.executar({ acao: 'criar_pasta', parametros: { nome: 'a' }, id_usuario: 'bruno', sessao: 's' }),
  ]);

  assert.equal(espiao.chamadas.length, 3, 'pedidos diferentes são pedidos diferentes');
});

// ===========================================================================
// B2. Estado impossível: `sucesso` com prova que nega o sucesso
// ===========================================================================

for (const [rotulo, prova] of [
  ['motivo nao_encontrado', { confirmado: false, evidencia: 'nada lá', motivo: 'nao_encontrado' as const }],
  ['motivo divergente', { confirmado: false, evidencia: 'diverge', motivo: 'divergente' as const }],
  ['sem motivo nenhum', { confirmado: false, evidencia: 'silêncio' }],
] as const) {
  test(`B2. braço relatando "sucesso" com prova negada (${rotulo}) vira "falhou"`, async () => {
    const braco = new Braco(bracoMentiroso({ prova }), semMaos, () => false);
    const r = await braco.executar({
      acao: 'criar_pasta',
      parametros: { nome: 'p' },
      id_usuario: 'ana',
      sessao: 's',
    });
    assert.equal(r.estado, 'falhou', 'nenhum "sucesso" sobrevive a uma prova que o nega');
  });
}

test('B2b. `sem_meio_de_verificar` CONTINUA compatível com sucesso', async () => {
  /**
   * O contra-teste que impede a correção de virar excesso de zelo. É o caso
   * legítimo do aplicativo que já estava aberto e não cria processo novo: a
   * IARA agiu, não tem como provar, e diz isso. Rebaixar aqui transformaria
   * toda abertura de Chrome numa falha relatada.
   */
  const braco = new Braco(
    bracoMentiroso({ prova: { confirmado: false, evidencia: 'já estava aberto', motivo: 'sem_meio_de_verificar' } }),
    semMaos,
    () => false,
  );
  const r = await braco.executar({
    acao: 'abrir_aplicativo',
    parametros: { aplicativo: 'chrome' },
    id_usuario: 'ana',
    sessao: 's',
  });
  assert.equal(r.estado, 'sucesso');
  assert.equal(r.prova.confirmado, false);
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
});

// ===========================================================================
// B3. A chave de idempotência não se deixa forjar por conteúdo
// ===========================================================================

test('B3. valor de parâmetro com separadores não colide com outro pedido', async () => {
  const espiao = motorEspiao(1);
  const braco = new Braco(ponteVazia, espiao.executar, () => true);

  /**
   * Na forma antiga (`k=v` unidos por `&`, chaves ordenadas) estes dois viravam
   * a MESMA string `local=documentos&nome=x` — e o segundo pedido, legítimo,
   * recebia como resposta o relato do primeiro sem nada ter sido executado.
   */
  await braco.executar({
    acao: 'criar_pasta',
    parametros: { local: 'documentos&nome=x' },
    id_usuario: 'ana',
    sessao: 's',
  });
  const segundo = await braco.executar({
    acao: 'criar_pasta',
    parametros: { local: 'documentos', nome: 'x' },
    id_usuario: 'ana',
    sessao: 's',
  });

  assert.equal(espiao.chamadas.length, 2);
  assert.notEqual(segundo.estado, 'duplicada');
});

test('B3b. o operador não escapa da própria chave pelo id nem pela ação', async () => {
  const espiao = motorEspiao(1);
  const braco = new Braco(ponteVazia, espiao.executar, () => true);

  await braco.executar({
    acao: 'listar_arquivos',
    parametros: {},
    id_usuario: 'ana',
    sessao: 's',
  });
  const outro = await braco.executar({
    acao: 'listar_arquivos',
    parametros: {},
    id_usuario: 'ana listar_arquivos',
    sessao: 's',
  });

  assert.equal(espiao.chamadas.length, 2);
  assert.notEqual(outro.estado, 'duplicada');
});

test('B3c. ordem das chaves do objeto não muda a identidade do pedido', async () => {
  const espiao = motorEspiao(1);
  const braco = new Braco(ponteVazia, espiao.executar, () => true);

  await braco.executar({
    acao: 'criar_pasta',
    parametros: { nome: 'x', local: 'documentos' },
    id_usuario: 'ana',
    sessao: 's',
  });
  const repetido = await braco.executar({
    acao: 'criar_pasta',
    parametros: { local: 'documentos', nome: 'x' },
    id_usuario: 'ana',
    sessao: 's',
  });

  assert.equal(espiao.chamadas.length, 1);
  assert.equal(repetido.estado, 'duplicada');
});

// ===========================================================================
// B4. A fronteira lê o relato campo a campo — nada entra por asserção de tipo
// ===========================================================================

function pacoteConcluida(relato: Record<string, unknown>): string {
  return JSON.stringify({
    tipo: 'concluida',
    relato: {
      execucao_id: 'IARA-20260813-aaaa-000001',
      estado: 'sucesso',
      texto: 'ok',
      prova: { confirmado: true, evidencia: 'x' },
      codigo_erro: null,
      duracao_ms: 1,
      dispositivo: 'disp-1',
      onde: 'dispositivo',
      ...relato,
    },
  });
}

test('B4. o relato bem formado continua passando', () => {
  const p = lerPacoteBraco(pacoteConcluida({}));
  assert.ok(p && p.tipo === 'concluida');
  assert.equal(p.relato.estado, 'sucesso');
});

for (const [rotulo, desvio] of [
  ['texto sem teto (2 MB)', { texto: 'A'.repeat(2_000_000) }],
  ['estado fora do vocabulário', { estado: 'sucesso!!' }],
  ['estado que não é texto', { estado: 42 }],
  ['evidência que não é texto', { prova: { confirmado: true, evidencia: { a: 1 } } }],
  ['evidência gigante', { prova: { confirmado: true, evidencia: 'E'.repeat(50_000) } }],
  ['motivo inventado', { prova: { confirmado: false, evidencia: 'x', motivo: 'porque_sim' } }],
  ['código de erro inventado', { codigo_erro: 'GRANT_ADMIN' }],
  ['onde arbitrário', { onde: 'nuvem' }],
  ['dados que não são objeto', { dados: 'tudo' }],
  ['prova ausente', { prova: undefined }],
  ['execucao_id vazio', { execucao_id: '' }],
] as const) {
  test(`B4. relato recusado na fronteira: ${rotulo}`, () => {
    assert.equal(lerPacoteBraco(pacoteConcluida(desvio as Record<string, unknown>)), null);
  });
}

test('B4b. o relato aceito é uma CÓPIA — campo a mais não atravessa', () => {
  const p = lerPacoteBraco(pacoteConcluida({ papel: 'administrador', id_usuario: 'bruno' }));
  assert.ok(p && p.tipo === 'concluida');
  assert.equal((p.relato as unknown as Record<string, unknown>).papel, undefined);
  assert.equal((p.relato as unknown as Record<string, unknown>).id_usuario, undefined);
});

test('B4c. lixo no socket nunca vira pacote', () => {
  const corpus = [
    '', 'null', '[]', '"texto"', '{', '{"tipo":"concluida"}',
    '{"tipo":"concluida","relato":null}', '{"tipo":"concluida","relato":[]}',
    '{"tipo":"__proto__"}', '{"tipo":"apresentacao"}',
    JSON.stringify({ tipo: 'apresentacao', id_usuario: 'a'.repeat(500), nome: 'n', plataforma: 'p', versao: 'v' }),
    JSON.stringify({ tipo: 'recebida', execucao_id: 'x'.repeat(500) }),
  ];
  for (const bruto of corpus) {
    assert.equal(lerPacoteBraco(bruto), null, `deveria recusar: ${bruto.slice(0, 40)}`);
  }
});

test('B4d. `__proto__` no relato não polui o protótipo de Object', () => {
  lerPacoteBraco(
    '{"tipo":"concluida","relato":{"execucao_id":"IARA-1","estado":"sucesso","texto":"ok",' +
      '"prova":{"confirmado":true,"evidencia":"x"},"__proto__":{"invadido":true}}}',
  );
  assert.equal(({} as Record<string, unknown>).invadido, undefined);
});

// ===========================================================================
// B5. Nome de pasta: a recusa explica em vez de estourar
// ===========================================================================

test('B5. nomes de dispositivo do Windows são recusados pela regra', () => {
  for (const nome of ['CON', 'con', 'PRN', 'AUX', 'NUL', 'nul', 'COM1', 'lpt9', 'CON.txt', 'nul.backup']) {
    assert.equal(validarNomePasta(nome), null, `"${nome}" deveria ser recusado`);
  }
});

test('B5b. a recusa não engoliu nome legítimo que só COMEÇA parecido', () => {
  for (const nome of ['Contratos', 'Console', 'Auxiliar', 'Nulo', 'Com1a', 'Prensa']) {
    assert.equal(validarNomePasta(nome), nome, `"${nome}" é legítimo`);
  }
});

test('B5c. travessia e separadores continuam recusados', () => {
  for (const nome of ['..', '../x', 'a/b', 'a\\b', 'C:x', 'a:b', '\\\\servidor\\share', '.', 'a..b', 'x y']) {
    assert.equal(validarNomePasta(nome), null, `"${nome}" deveria ser recusado`);
  }
});
