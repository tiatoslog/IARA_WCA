/**
 * MD-STATUS — pareado ≠ conectado ≠ selecionado ≠ versão conhecida.
 *
 * A auditoria de 20/08/2026 nomeou o erro conceitual melhor do que o código o
 * tinha nomeado:
 *
 *     versao == null  →  DESCONHECIDA
 *     e NÃO
 *     versao == null  →  desatualizada=false  →  a tela lê "atual"
 *
 * E apontou um segundo, do mesmo tipo: **"offline" sem escopo é afirmação sobre
 * a máquina quando o que se sabe é sobre ESTE servidor.** Um braço conectado ao
 * `iara.up.railway.app` aparece "desligado" numa tela apontada para o
 * localhost, e a pessoa não distingue entre:
 *
 *     o computador está desligado · o braço caiu · o backend caiu ·
 *     o braço está noutro ambiente · o heartbeat expirou
 *
 * ================= O QUE ESTE MÓDULO NÃO FAZ =================
 *
 * Ele NÃO inventa `connected_to_backend_id`. O `ultimo_uso_em` é carimbado na
 * APRESENTAÇÃO, não em heartbeat (ver `inventarioDeMaquinas`), então esta
 * instalação não tem como saber se a máquina está atendendo outra IARA agora.
 * Afirmar isso exigiria um dado que ninguém mede — que é exatamente o defeito
 * que este arquivo existe para fechar.
 *
 * O que dá para fazer sem inventar: **escopar a frase**. "não está conectado a
 * esta IARA" é verdade sempre; "desligado" é um palpite sobre o mundo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { lerStatusDaMaquina, type MaquinaDoOperador } from '../lib/execucao';

const maquina = (p: Partial<MaquinaDoOperador>): MaquinaDoOperador =>
  ({
    id: p.id ?? 'c1',
    nome: p.nome ?? 'Homeoffice',
    plataforma: 'win32',
    versao: p.versao ?? null,
    conectada: p.conectada ?? false,
    pareada: p.pareada ?? true,
    pareada_em: 0,
    vista_em: p.vista_em ?? null,
    desatualizada: p.desatualizada ?? false,
    atualizando: p.atualizando ?? null,
    erroAtualizacao: null,
  }) as MaquinaDoOperador;

test('ST-01. versão ausente é DESCONHECIDA, nunca "atual"', () => {
  const s = lerStatusDaMaquina(maquina({ conectada: false, versao: null }), null);
  assert.equal(s.versao.tipo, 'desconhecida');
  assert.equal(s.desatualizada, false, 'não se acusa de antiga uma versão que ninguém leu');
  /* A propriedade que fecha o defeito: `desatualizada: false` NÃO autoriza
     ninguém a concluir "atual". Quem quer dizer "atual" pergunta pela versão. */
  assert.notEqual(s.versao.tipo, 'conhecida');
});

test('ST-02. versão só é conhecida quando a máquina reportou', () => {
  const s = lerStatusDaMaquina(maquina({ conectada: true, versao: '1.3.0' }), null);
  assert.equal(s.versao.tipo, 'conhecida');
  if (s.versao.tipo === 'conhecida') assert.equal(s.versao.valor, '1.3.0');
});

test('ST-03. a conexão é ESCOPADA a este servidor', () => {
  const desligada = lerStatusDaMaquina(maquina({ conectada: false, vista_em: 1000 }), null);
  assert.equal(desligada.conexao, 'nao_conectada_aqui');
  /* A frase não pode afirmar sobre o mundo o que se sabe sobre este processo. */
  assert.ok(
    !/desligad/i.test(desligada.frase),
    `"${desligada.frase}" afirma sobre a máquina o que só se sabe sobre este servidor`,
  );
  assert.match(desligada.frase, /esta IARA|aqui/i);
});

test('ST-04. atendendo agora é o único estado que autoriza "conectada"', () => {
  const s = lerStatusDaMaquina(maquina({ conectada: true, versao: '1.3.0' }), null);
  assert.equal(s.conexao, 'atendendo');
  assert.match(s.frase, /atendendo/i);
});

test('ST-05. nunca vista é diferente de vista e desconectada', () => {
  const nunca = lerStatusDaMaquina(maquina({ conectada: false, vista_em: null }), null);
  assert.equal(nunca.conexao, 'nunca_vista');
  const vista = lerStatusDaMaquina(maquina({ conectada: false, vista_em: 1000 }), null);
  assert.equal(vista.conexao, 'nao_conectada_aqui');
  assert.notEqual(nunca.frase, vista.frase);
});

test('ST-06. selecionada é ortogonal a conectada', () => {
  /**
   * O ponto do teste: as duas dimensões não se misturam. Uma máquina pode ser
   * a escolhida E estar fora do ar — é justamente o caso em que a IARA recusa
   * nomeando-a, e a tela precisa mostrar as duas coisas ao mesmo tempo.
   */
  const escolhidaEFora = lerStatusDaMaquina(maquina({ id: 'c1', conectada: false }), 'c1');
  assert.equal(escolhidaEFora.selecionada, true);
  assert.equal(escolhidaEFora.conexao, 'nunca_vista');

  const ligadaENaoEscolhida = lerStatusDaMaquina(maquina({ id: 'c2', conectada: true }), 'c1');
  assert.equal(ligadaENaoEscolhida.selecionada, false);
  assert.equal(ligadaENaoEscolhida.conexao, 'atendendo');
});

test('ST-07. desatualizada exige versão conhecida', () => {
  /* Um `desatualizada: true` chegando com versão nula é contradição do
     contrato; o status não a propaga. */
  const s = lerStatusDaMaquina(maquina({ conectada: false, versao: null, desatualizada: true }), null);
  assert.equal(s.desatualizada, false, 'não se acusa de antiga uma versão que ninguém leu');
});

test('ST-08. atualizando é estado próprio e vence a frase de conexão', () => {
  const s = lerStatusDaMaquina(maquina({ conectada: true, versao: '1.0.0', atualizando: 42 }), null);
  assert.equal(s.conexao, 'atendendo');
  assert.equal(s.atualizando, 42);
});
