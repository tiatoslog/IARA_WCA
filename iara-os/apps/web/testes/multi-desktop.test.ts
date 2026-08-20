/**
 * GATE MD-01 — CONTROLE MULTI-DESKTOP REAL.
 *
 * A pergunta da operadora, em 20/08/2026, e ela é de produto e não de código:
 *
 *     "Consigo conectar o braço em vários computadores e escolher em qual eu
 *      quero trabalhar? Se não, é inútil."
 *
 * A primeira versão deste arquivo documentava a resposta NEGATIVA — o destino
 * era `lista[lista.length - 1]`, o último que conectou, e não havia alvo em
 * lugar nenhum da cadeia. Aquela versão terminava dizendo: *"o dia em que a
 * seleção existir, estes testes falham e são reescritos como especificação"*.
 * É o que este arquivo é agora.
 *
 * ================= AS TRÊS REGRAS =================
 *
 *   1. SEM ESCOLHA, o comportamento antigo continua: o último que conectou é
 *      quem atende. Quem tem uma máquina só nunca precisa escolher nada.
 *
 *   2. COM ESCOLHA, a ordem vai para a máquina escolhida ou NÃO VAI. Nunca
 *      para outra. É a regra inteira do gate, e ela é sobre o que NÃO acontece.
 *
 *   3. ESCOLHIDA E OFFLINE é uma RECUSA QUE NOMEIA A MÁQUINA. Nunca uma
 *      migração silenciosa, nunca um sucesso noutro computador — nem para o
 *      motor que hospeda o processo.
 *
 * A regra 3 é o item 8 da lista da operadora e era o defeito mais perigoso do
 * estado anterior: uma ação FÍSICA acontecia num computador que ninguém
 * escolheu, e a IARA relatava sucesso.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Braco, type PonteDeOrdens } from '../servidor/nucleo/Braco';
import { EscolhaDeMaquina } from '../servidor/nucleo/EscolhaDeMaquina';
import {
  PonteDispositivos,
  type DispositivoConectado,
} from '../servidor/barramento/PonteDispositivos';
import type { OrdemExecucao, PacoteMotor, RelatoExecucao } from '../lib/execucao';

const OPERADOR = 'daiane';

/** Um braço de mentira que anota o que recebeu e relata sucesso. */
function bracoFalso(id: string, nome: string) {
  const recebidas: OrdemExecucao[] = [];
  let publicar: ((d: DispositivoConectado, p: never) => void) | null = null;

  const dispositivo = {
    id_dispositivo: id,
    id_usuario: OPERADOR,
    nome,
    plataforma: 'teste',
    versao: '0',
    conectado_em: 0,
    visto_em: 0,
    atualizando: null,
    ultimoErroAtualizacao: null,
    enviar: (pacote: PacoteMotor) => {
      if (pacote.tipo !== 'executar') return true;
      recebidas.push(pacote.ordem);
      setTimeout(() => {
        const relato: RelatoExecucao = {
          execucao_id: pacote.ordem.execucao_id,
          estado: 'sucesso',
          texto: `feito em ${nome}`,
          prova: { confirmado: true, evidencia: `dublê ${nome}` },
          codigo_erro: null,
          duracao_ms: 1,
          dispositivo: id,
          onde: 'dispositivo',
        };
        publicar?.(dispositivo as unknown as DispositivoConectado, {
          tipo: 'concluida',
          relato,
        } as never);
      }, 5);
      return true;
    },
    fechar: () => undefined,
  } as unknown as DispositivoConectado;

  return {
    dispositivo,
    recebidas,
    ligarEm: (ouvinte: (d: DispositivoConectado, p: never) => void) => (publicar = ouvinte),
  };
}

/**
 * Uma ponte com N braços LIGADOS, que respeita o alvo exatamente como
 * `PonteDispositivos.destinoDe` passa a respeitar.
 *
 * A ponte do teste reimplementa a regra em vez de importar a de produção pelo
 * mesmo motivo que os oráculos da campanha reimplementam o HMAC: se as duas
 * divergirem um dia, quero que o teste acuse em vez de concordar.
 */
function ponteCom(ligados: () => ReturnType<typeof bracoFalso>[]): PonteDeOrdens {
  return {
    destinoDe: (_id, alvo) => {
      const lista = ligados();
      if (alvo) return lista.find((b) => b.dispositivo.id_dispositivo === alvo)?.dispositivo ?? null;
      return lista[lista.length - 1]?.dispositivo ?? null;
    },
    aoPacote: (ouvinte) => {
      for (const b of ligados()) b.ligarEm(ouvinte as never);
      return () => undefined;
    },
  };
}

const pedido = (aplicativo: string) => ({
  acao: 'abrir_aplicativo' as const,
  parametros: { aplicativo },
  id_usuario: OPERADOR,
  sessao: 's-md',
});

const semMotor = async (): Promise<RelatoExecucao> => {
  throw new Error('não deveria cair no motor');
};

// ===========================================================================
// Regra 1 — sem escolha, nada muda
// ===========================================================================

test('MD-01. sem escolha, a ordem vai para o último que conectou (comportamento de sempre)', async () => {
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const notebook = bracoFalso('d-notebook', 'Notebook');
  const braco = new Braco(
    ponteCom(() => [escritorio, notebook]),
    semMotor,
    () => false,
    new EscolhaDeMaquina(),
  );

  const r = await braco.executar(pedido('bloco de notas'));

  assert.equal(r.estado, 'sucesso');
  assert.equal(r.dispositivo, 'd-notebook');
  assert.equal(escritorio.recebidas.length, 0);
});

// ===========================================================================
// Regra 2 — com escolha, vai para a escolhida e para mais nenhuma
// ===========================================================================

test('MD-02. escolhida a máquina, a ordem vai para ELA mesmo com outra conectada depois', async () => {
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const notebook = bracoFalso('d-notebook', 'Notebook');
  const escolha = new EscolhaDeMaquina();
  escolha.escolher(OPERADOR, 'd-escritorio', 'Escritório');

  const braco = new Braco(
    ponteCom(() => [escritorio, notebook]),
    semMotor,
    () => false,
    escolha,
  );

  const r = await braco.executar(pedido('bloco de notas'));

  assert.equal(r.dispositivo, 'd-escritorio', 'a ordem foi para a máquina escolhida');
  assert.equal(escritorio.recebidas.length, 1);
  assert.equal(notebook.recebidas.length, 0, 'o último a conectar NÃO recebeu nada');
});

test('MD-03. a ordem carrega o alvo, para o jornal e para o braço saberem', async () => {
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const escolha = new EscolhaDeMaquina();
  escolha.escolher(OPERADOR, 'd-escritorio', 'Escritório');
  const braco = new Braco(
    ponteCom(() => [escritorio]),
    semMotor,
    () => false,
    escolha,
  );

  await braco.executar(pedido('bloco de notas'));

  assert.equal(escritorio.recebidas[0].id_dispositivo_alvo, 'd-escritorio');
});

test('MD-04. trocar a escolha troca a máquina, sem reconectar nada', async () => {
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const notebook = bracoFalso('d-notebook', 'Notebook');
  const escolha = new EscolhaDeMaquina();
  const braco = new Braco(
    ponteCom(() => [escritorio, notebook]),
    semMotor,
    () => false,
    escolha,
  );

  escolha.escolher(OPERADOR, 'd-escritorio', 'Escritório');
  await braco.executar(pedido('bloco de notas'));
  escolha.escolher(OPERADOR, 'd-notebook', 'Notebook');
  await braco.executar(pedido('calculadora'));

  assert.deepEqual(
    escritorio.recebidas.map((o) => o.parametros.aplicativo),
    ['bloco de notas'],
  );
  assert.deepEqual(
    notebook.recebidas.map((o) => o.parametros.aplicativo),
    ['calculadora'],
  );
});

// ===========================================================================
// Regra 3 — escolhida e offline RECUSA, nomeando a máquina
// ===========================================================================

test('MD-05. a máquina escolhida caiu: RECUSA nomeando-a, sem migrar para a outra', async () => {
  /**
   * O item 8 da operadora, e o defeito que este gate existe para fechar. Antes:
   * o notebook caía, a ordem ia para o escritório e voltava "sucesso" sem uma
   * palavra sobre a troca — ação física num computador que ninguém escolheu.
   */
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const notebook = bracoFalso('d-notebook', 'Notebook');
  let ligados = [escritorio, notebook];
  const escolha = new EscolhaDeMaquina();
  escolha.escolher(OPERADOR, 'd-notebook', 'Notebook');
  const braco = new Braco(
    ponteCom(() => ligados),
    semMotor,
    () => false,
    escolha,
  );

  const primeiro = await braco.executar(pedido('bloco de notas'));
  assert.equal(primeiro.dispositivo, 'd-notebook');

  // O notebook fecha a tampa. O escritório continua ligado.
  ligados = [escritorio];

  const segundo = await braco.executar(pedido('calculadora'));

  assert.equal(segundo.estado, 'dispositivo_ausente');
  assert.equal(segundo.codigo_erro, 'DESKTOP_OFFLINE');
  assert.equal(segundo.onde, 'nenhum');
  assert.equal(escritorio.recebidas.length, 0, 'a ação NÃO pode ter migrado');
  assert.match(
    segundo.texto,
    /Notebook/,
    'a recusa precisa NOMEAR a máquina escolhida — "não consegui" sem dizer qual é o que faz o operador tentar de novo às cegas',
  );
});

test('MD-06. com escolha ativa, a ação NÃO cai para o motor que hospeda o processo', async () => {
  /**
   * O segundo degrau do mesmo buraco: sem braço conectado, `Braco.executar`
   * cai em `viaMotor` quando o processo tem mãos. Numa instalação local do
   * motor em Windows isso é verdade — e a ação aconteceria na máquina do
   * servidor, que não é a que o operador escolheu.
   */
  let executouNoMotor = false;
  const escolha = new EscolhaDeMaquina();
  escolha.escolher(OPERADOR, 'd-notebook', 'Notebook');
  const braco = new Braco(
    ponteCom(() => []),
    async () => {
      executouNoMotor = true;
      throw new Error('não deveria');
    },
    () => true, // o motor TEM mãos
    escolha,
  );

  const r = await braco.executar(pedido('bloco de notas'));

  assert.equal(executouNoMotor, false, 'a escolha do operador foi ignorada e o motor executou');
  assert.equal(r.estado, 'dispositivo_ausente');
  assert.equal(r.onde, 'nenhum');
});

test('MD-07. esquecer a escolha devolve o comportamento de antes', async () => {
  const escritorio = bracoFalso('d-escritorio', 'Escritório');
  const notebook = bracoFalso('d-notebook', 'Notebook');
  const escolha = new EscolhaDeMaquina();
  escolha.escolher(OPERADOR, 'd-escritorio', 'Escritório');
  escolha.esquecer(OPERADOR);
  const braco = new Braco(
    ponteCom(() => [escritorio, notebook]),
    semMotor,
    () => false,
    escolha,
  );

  const r = await braco.executar(pedido('bloco de notas'));
  assert.equal(r.dispositivo, 'd-notebook');
});

test('MD-08. a escolha é POR OPERADOR — a de uma pessoa não alcança a outra', () => {
  const escolha = new EscolhaDeMaquina();
  escolha.escolher('ana', 'd-escritorio', 'Escritório');
  assert.equal(escolha.escolhida('ana'), 'd-escritorio');
  assert.equal(escolha.escolhida('daiane'), null);
});

// ===========================================================================
// O DEFEITO QUE SÓ O CAMPO ACHOU — 20/08/2026, no navegador, com braço real
// ===========================================================================

test('MD-09. o alvo casa pelo id_credencial, que é o que a TELA manda', () => {
  /**
   * OS OITO TESTES ACIMA PASSAVAM E O PRODUTO NÃO FUNCIONAVA.
   *
   * Medido no navegador, com a operadora logada e um braço de verdade
   * conectado: escolhi "Homeoffice", que estava **atendendo agora**, pedi uma
   * pasta, e o motor respondeu
   *
   *     alvo 6c25ca6ab681f88a15f8f134ea2fb342 escolhido e não conectado
   *
   * sobre a máquina que estava ligada na minha frente.
   *
   * A causa: `MaquinaDoOperador.id` — o id que a tela mostra e devolve — é o
   * `id_credencial` (ver `inventarioDeMaquinas`: `id: p.id_credencial`). O
   * `destinoDe` comparava com `d.id_dispositivo`, que é o id do SOCKET
   * (`disp-1`, `disp-2`, novo a cada conexão). Para uma máquina pareada os
   * dois nunca são iguais.
   *
   * Os dublês da suíte usavam o mesmo valor para as duas coisas, então oito
   * testes verdes não tinham como ver a diferença. É a definição de por que
   * este gate exige prova de campo.
   */
  const ponte = new PonteDispositivos();
  const socket = {
    id_dispositivo: 'disp-1',
    id_credencial: 'cred-abc',
    id_usuario: OPERADOR,
    nome: 'Homeoffice',
    plataforma: 'win32',
    versao: '1.3.0',
    conectado_em: 0,
    visto_em: 0,
    atualizando: null,
    ultimoErroAtualizacao: null,
    enviar: () => true,
    fechar: () => undefined,
  } as unknown as DispositivoConectado;
  (ponte as unknown as { porOperador: Map<string, DispositivoConectado[]> }).porOperador.set(
    OPERADOR,
    [socket],
  );

  assert.equal(
    ponte.destinoDe(OPERADOR, 'cred-abc')?.id_dispositivo,
    'disp-1',
    'o alvo vindo da tela (id_credencial) precisa achar o socket vivo',
  );
  assert.equal(
    ponte.destinoDe(OPERADOR, 'disp-1')?.id_dispositivo,
    'disp-1',
    'o id do socket também continua valendo — braço sem credencial durável',
  );
  assert.equal(
    ponte.destinoDe(OPERADOR, 'cred-de-outra-maquina'),
    null,
    'um alvo que não é nenhum dos dois continua sendo recusa',
  );
});
