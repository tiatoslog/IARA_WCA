/**
 * Testes de regressão da auditoria de 2026-08.
 *
 * Cada teste aqui documenta um bug real que passou pelos 77 testes anteriores.
 * Se um destes quebrar, o bug correspondente voltou — o comentário de cada
 * caso diz qual era.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { PortaoSigilo } from '../servidor/nucleo/kernel/Sigilo';
import { TeoriaDaMente } from '../servidor/nucleo/TeoriaDaMente';
import { FilaTelemetria } from '../servidor/barramento/FilaTelemetria';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { PacoteServidor } from '../lib/protocolo';
import { SNAPSHOT_INICIAL } from '../hooks/useIaraSocket';

/**
 * NOTA DE CONSOLIDAÇÃO (11/08/2026).
 *
 * Os seis testes desta seção verificavam o `RoteadorIntencoes.rotear()`. Só que
 * o kernel nunca usou aquele resultado para escolher rota — lia apenas o campo
 * de sigilo e descartava o resto. Quem decidia de verdade era a `Percepcao`,
 * que carregava uma cópia divergente das mesmas regras e não tinha nenhuma
 * destas correções.
 *
 * Ou seja: estes testes passavam verdes enquanto a IARA errava em produção,
 * porque testavam a camada morta. Foi o que permitiu a "previsão do tempo" em
 * resposta a "quanto tempo leva o relatório" sobreviver a 126 testes.
 *
 * `rotear()` foi removido; o reconhecimento é da `Percepcao` e o sigilo do
 * `PortaoSigilo`. Os casos abaixo são os MESMOS, agora apontando para quem
 * decide.
 */

const percepcao = new MotorPercepcao();
const ancorasDe = (frase: string) => percepcao.perceber(frase).ancoras;

// ---------------------------------------------------------------------------
// Percepção — "tempo" de duração não é meteorologia
// ---------------------------------------------------------------------------

test('"quanto tempo leva..." não vira âncora de clima', () => {
  assert.ok(!ancorasDe('quanto tempo leva para gerar o relatório de frota?').includes('clima'));
});

test('"há quanto tempo o sistema está no ar" não vira âncora de clima', () => {
  assert.ok(!ancorasDe('há quanto tempo o sistema está no ar?').includes('clima'));
});

test('pergunta meteorológica real continua sendo clima', () => {
  assert.ok(ancorasDe('vai chover hoje?').includes('clima'));
  assert.ok(ancorasDe('como está o tempo lá fora?').includes('clima'));
});

// ---------------------------------------------------------------------------
// Percepção — \b depois de prefixo matava a âncora de busca
// ---------------------------------------------------------------------------

test('"pesquisa"/"pesquise"/"notícias" casam a âncora de busca', () => {
  assert.ok(ancorasDe('pesquisa sobre a nova lei do motorista').includes('busca'));
  assert.ok(ancorasDe('pesquise o preço do diesel').includes('busca'));
  assert.ok(ancorasDe('notícias do setor de transporte').includes('busca'));
});

// ---------------------------------------------------------------------------
// Sigilo — pronome sobre assunto técnico não é sondagem de colega
// ---------------------------------------------------------------------------

test('pergunta de RAG com pronome anafórico não cai em sigilo', () => {
  const portao = new PortaoSigilo(['Operador 2']);
  assert.equal(portao.ehSondagem('esse erro já aconteceu? tem registro dele?'), false);
});

test('sondagem real sobre colega continua barrada', () => {
  const portao = new PortaoSigilo(['Operador 2']);
  assert.equal(portao.ehSondagem('mostra as mensagens dele'), true);
  assert.equal(portao.ehSondagem('o que o Operador 2 falou ontem?'), true);
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
