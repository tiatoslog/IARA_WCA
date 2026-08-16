/**
 * "ABRI A SESSÃO" PRECISA SER VERDADE.
 *
 * Estes testes prendem o julgamento de uma sessão de agente de código nas duas
 * armadilhas MEDIDAS com o binário real (Claude Code 2.1.233, 16/08/2026) — as
 * duas invisíveis para qualquer dublê:
 *
 * 1. `subtype` mente. A execução que falhou por falta de login devolveu, no
 *    MESMO objeto, `is_error: true`, `terminal_reason: "api_error"` e
 *    `subtype: "success"`.
 * 2. O transcript aparece no disco mesmo quando a execução falha. Ele prova
 *    identidade, nunca resultado.
 *
 * O envelope usado aqui é uma cópia literal do que o binário devolveu.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  caminhoDoTranscript,
  interpretarSaidaClaude,
  julgarSessao,
} from '../servidor/nucleo/SessoesAgenteCodigo';

const ID = '0dc0f0be-bbd7-48ec-a8a5-624d30f5d28d';

/** Cópia literal da saída real do binário não logado. */
const ENVELOPE_NAO_LOGADO = JSON.stringify({
  is_error: true,
  duration_api_ms: 0,
  num_turns: 1,
  stop_reason: 'stop_sequence',
  session_id: ID,
  total_cost_usd: 0,
  terminal_reason: 'api_error',
  subtype: 'success',
  api_error_status: null,
  result: 'Not logged in · Please run /login',
  type: 'result',
});

const ENVELOPE_OK = JSON.stringify({
  is_error: false,
  num_turns: 3,
  session_id: ID,
  total_cost_usd: 0.012,
  subtype: 'success',
  result: 'Auditei os botões e corrigi dois.',
  type: 'result',
});

const base = {
  codigoSaida: 0,
  saidaBruta: '',
  erroBruto: '',
  idEsperado: ID,
  transcriptExiste: true,
};

// ---------------------------------------------------------------------------
// Armadilha 1: subtype "success" numa execução que falhou
// ---------------------------------------------------------------------------

/**
 * O CASO EXATO DO BINÁRIO REAL. Se este teste algum dia passar a devolver
 * `concluida`, a IARA voltou a anunciar trabalho que não aconteceu.
 */
test('is_error=true com subtype="success" é FALHA — o campo bonito é o mentiroso', () => {
  const v = julgarSessao({ ...base, codigoSaida: 1, saidaBruta: ENVELOPE_NAO_LOGADO });
  assert.equal(v.estado, 'falhou');
  assert.match(v.evidencia, /is_error=true/);
  assert.ok(!/concl/i.test(v.estado));
});

test('nem mesmo com código de saída 0 o subtype resgata uma execução com is_error', () => {
  const v = julgarSessao({ ...base, codigoSaida: 0, saidaBruta: ENVELOPE_NAO_LOGADO });
  assert.equal(v.estado, 'falhou');
});

test('o motivo do agente chega ao operador em vez de virar "não sei"', () => {
  const v = julgarSessao({ ...base, codigoSaida: 1, saidaBruta: ENVELOPE_NAO_LOGADO });
  assert.match(String(v.evidencia), /Not logged in/);
});

// ---------------------------------------------------------------------------
// Armadilha 2: transcript no disco não é prova de sucesso
// ---------------------------------------------------------------------------

test('transcript presente NÃO promove uma execução falha a concluída', () => {
  const v = julgarSessao({
    ...base,
    codigoSaida: 1,
    saidaBruta: ENVELOPE_NAO_LOGADO,
    transcriptExiste: true,
  });
  assert.equal(v.estado, 'falhou');
});

test('transcript ausente não derruba um sucesso — mas some da evidência', () => {
  const com = julgarSessao({ ...base, saidaBruta: ENVELOPE_OK, transcriptExiste: true });
  const sem = julgarSessao({ ...base, saidaBruta: ENVELOPE_OK, transcriptExiste: false });
  assert.equal(com.estado, 'concluida');
  assert.equal(sem.estado, 'concluida');
  assert.match(com.evidencia, /confere no disco/);
  assert.match(sem.evidencia, /não foi encontrado no disco/);
});

// ---------------------------------------------------------------------------
// Identidade antes de resultado
// ---------------------------------------------------------------------------

/**
 * A lição do `execucao_id` reaproveitado, que fez a IARA responder "Pronto.
 * Abri o Bloco de Notas" a uma pergunta sobre memória: relato de OUTRA execução
 * não é evidência sobre esta, nem quando diz que deu tudo certo.
 */
test('envelope de OUTRA sessão nunca vira sucesso desta', () => {
  const outro = JSON.stringify({ is_error: false, session_id: 'outra-sessao', result: 'pronto' });
  const v = julgarSessao({ ...base, saidaBruta: outro });
  assert.equal(v.estado, 'desconhecida');
  assert.match(v.evidencia, /outra-sessao/);
});

// ---------------------------------------------------------------------------
// Ausência de desfecho nunca é desfecho
// ---------------------------------------------------------------------------

test('processo ainda rodando é "trabalhando" — nem sucesso, nem falha', () => {
  const v = julgarSessao({ ...base, codigoSaida: null, saidaBruta: '' });
  assert.equal(v.estado, 'trabalhando');
  assert.equal(v.resultado, null);
});

test('saiu com 0 e sem JSON: desconhecida, jamais concluída', () => {
  const v = julgarSessao({ ...base, codigoSaida: 0, saidaBruta: 'texto solto' });
  assert.equal(v.estado, 'desconhecida');
});

test('saiu com erro e sem JSON: falhou, com a pista que houver', () => {
  const v = julgarSessao({ ...base, codigoSaida: 127, saidaBruta: '', erroBruto: 'command not found' });
  assert.equal(v.estado, 'falhou');
  assert.match(v.evidencia, /command not found/);
});

test('is_error ausente não é is_error=false', () => {
  const semCampo = JSON.stringify({ session_id: ID, result: 'talvez', subtype: 'success' });
  const v = julgarSessao({ ...base, saidaBruta: semCampo });
  assert.equal(v.estado, 'desconhecida');
  assert.match(v.evidencia, /não declarou is_error/);
});

test('sucesso declarado sem texto de resultado é desconhecido', () => {
  const vazio = JSON.stringify({ is_error: false, session_id: ID });
  assert.equal(julgarSessao({ ...base, saidaBruta: vazio }).estado, 'desconhecida');
});

// ---------------------------------------------------------------------------
// O caminho feliz, e a leitura do envelope
// ---------------------------------------------------------------------------

test('execução boa vira concluída, com o texto do agente', () => {
  const v = julgarSessao({ ...base, saidaBruta: ENVELOPE_OK });
  assert.equal(v.estado, 'concluida');
  assert.equal(v.resultado, 'Auditei os botões e corrigi dois.');
  assert.match(v.evidencia, /3 turno/);
});

test('ruído antes do JSON não custa o resultado', () => {
  const v = julgarSessao({ ...base, saidaBruta: `aviso da ferramenta\n${ENVELOPE_OK}` });
  assert.equal(v.estado, 'concluida');
});

test('saída sem JSON nenhum devolve null em vez de lançar', () => {
  assert.equal(interpretarSaidaClaude(''), null);
  assert.equal(interpretarSaidaClaude('só texto'), null);
  assert.equal(interpretarSaidaClaude('[1,2,3]'), null);
});

// ---------------------------------------------------------------------------
// O caminho do diário — medido, não deduzido
// ---------------------------------------------------------------------------

/**
 * Conferido contra o disco real: a sessão de teste rodada no scratchpad deixou
 * o arquivo em `~/.claude/projects/C--Users-daian-AppData-...-scratchpad/<id>.jsonl`.
 */
test('o caminho do diário troca ":" e separadores por "-"', () => {
  const caminho = caminhoDoTranscript('/casa', 'C:\\Users\\daian\\Desktop\\IARA', ID);
  assert.match(caminho, /C--Users-daian-Desktop-IARA/);
  assert.equal(path.basename(caminho), `${ID}.jsonl`);
  assert.match(caminho, /\.claude/);
});
