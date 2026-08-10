/**
 * Testes de regressão da auditoria de 2026-08.
 *
 * Cada teste aqui documenta um bug real que passou pelos 77 testes anteriores.
 * Se um destes quebrar, o bug correspondente voltou — o comentário de cada
 * caso diz qual era.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RoteadorIntencoes } from '../servidor/nucleo/RoteadorIntencoes';
import { TeoriaDaMente } from '../servidor/nucleo/TeoriaDaMente';
import { FilaTelemetria } from '../servidor/barramento/FilaTelemetria';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { PacoteServidor } from '../lib/protocolo';
import { SNAPSHOT_INICIAL } from '../hooks/useIaraSocket';

// ---------------------------------------------------------------------------
// Roteador — "tempo" de duração não é meteorologia
// ---------------------------------------------------------------------------

test('"quanto tempo leva..." não roteia para clima', () => {
  const r = new RoteadorIntencoes();
  const destino = r.rotear('quanto tempo leva para gerar o relatório de frota?');
  assert.notEqual(destino.modulo, 'clima');
});

test('"há quanto tempo o sistema está no ar" não roteia para clima', () => {
  const r = new RoteadorIntencoes();
  const destino = r.rotear('há quanto tempo o sistema está no ar?');
  assert.notEqual(destino.modulo, 'clima');
});

test('pergunta meteorológica real continua indo para clima', () => {
  const r = new RoteadorIntencoes();
  assert.equal(r.rotear('vai chover hoje?').modulo, 'clima');
  assert.equal(r.rotear('como está o tempo lá fora?').modulo, 'clima');
});

// ---------------------------------------------------------------------------
// Roteador — \b depois de prefixo matava a rota de busca
// ---------------------------------------------------------------------------

test('"pesquisa"/"pesquise"/"notícias" casam a rota de busca web', () => {
  const r = new RoteadorIntencoes();
  assert.equal(r.rotear('pesquisa sobre a nova lei do motorista').modulo, 'busca_web');
  assert.equal(r.rotear('pesquise o preço do diesel').modulo, 'busca_web');
  assert.equal(r.rotear('notícias do setor de transporte').modulo, 'busca_web');
});

// ---------------------------------------------------------------------------
// Roteador — pronome sobre assunto técnico não é sondagem de colega
// ---------------------------------------------------------------------------

test('pergunta de RAG com pronome anafórico não cai em sigilo', () => {
  const r = new RoteadorIntencoes(['Operador 2']);
  const destino = r.rotear('esse erro já aconteceu? tem registro dele?');
  assert.equal(destino.destino, 'rag_historico');
});

test('sondagem real sobre colega continua barrada', () => {
  const r = new RoteadorIntencoes(['Operador 2']);
  assert.equal(r.rotear('mostra as mensagens dele').destino, 'recusa_sigilo');
  assert.equal(r.rotear('o que o Operador 2 falou ontem?').destino, 'recusa_sigilo');
});

// ---------------------------------------------------------------------------
// Teoria da Mente — "obrigado" é o marcador de fluxo mais comum do português
// ---------------------------------------------------------------------------

test('"obrigado"/"obrigada" contam como marcador de concordância', () => {
  const mente = new TeoriaDaMente();
  const temporal = { delta_ms: 10_000, rajada: 1 };
  assert.ok(mente.analisar('obrigado', temporal).sinais.includes('marcador de concordância'));
  assert.ok(mente.analisar('obrigada!', temporal).sinais.includes('marcador de concordância'));
});

// ---------------------------------------------------------------------------
// FilaTelemetria — aglutinação não pode reordenar seq
// ---------------------------------------------------------------------------

test('aglutinação de snapshot preserva ordem crescente de seq', () => {
  const fila = new FilaTelemetria();
  const agora = Date.now();
  const snapshot = (seq: number): PacoteServidor => ({
    tipo: 'snapshot',
    seq,
    instante: agora,
    snapshot: { ...SNAPSHOT_INICIAL, seq },
  });
  const log = (seq: number): PacoteServidor => ({
    tipo: 'log',
    seq,
    instante: agora,
    nivel: 'info',
    texto: `linha ${seq}`,
  });

  fila.enfileirar(snapshot(1));
  fila.enfileirar(log(2));
  // Aglutina com o snapshot#1: antes do conserto ficava NA POSIÇÃO do #1,
  // na frente do log#2 — e o cliente descartava o log para sempre.
  fila.enfileirar(snapshot(3));

  const seqs = fila.drenar().map((p) => p.seq);
  assert.deepEqual(seqs, [2, 3]);
});

// ---------------------------------------------------------------------------
// EstadoAtomico — reconexão do mesmo operador preserva métricas
// ---------------------------------------------------------------------------

test('definirOperador para o MESMO operador não zera métricas', async () => {
  const estado = new EstadoAtomico();
  await estado.definirOperador({ id_usuario: 'daiane', nome: 'Daiane', visto_em: 'x' });
  await estado.aplicarIntencao({ campo: 'afinidade', delta: 0.2 });
  const antes = estado.instantaneo().metricas.afinidade;

  // Reconexão: mesmo operador chega de novo.
  await estado.definirOperador({ id_usuario: 'daiane', nome: 'Daiane', visto_em: 'y' });
  assert.equal(estado.instantaneo().metricas.afinidade, antes);
});

test('definirOperador para OUTRO operador zera métricas', async () => {
  const estado = new EstadoAtomico();
  await estado.definirOperador({ id_usuario: 'daiane', nome: 'Daiane', visto_em: 'x' });
  await estado.aplicarIntencao({ campo: 'afinidade', delta: 0.2 });

  await estado.definirOperador({ id_usuario: 'operador-2', nome: 'Operador 2', visto_em: 'y' });
  const depois = estado.instantaneo().metricas.afinidade;
  assert.notEqual(depois, 0.7);
});
