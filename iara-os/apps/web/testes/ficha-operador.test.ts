/**
 * Testes da ficha do operador.
 *
 * O bug que originou o recurso: a persona mandava tratar por "senhor"/"senhora"
 * sem dizer de onde tirar qual, e o modelo deduziu do nome — errado. O que se
 * testa aqui, então, não é "o formulário salva": é que NENHUM caminho do
 * sistema produz tratamento com gênero sem alguém ter declarado.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  fichaVazia,
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  LIMITES_PREFERENCIAS,
} from '../lib/perfil';
import { lerPacoteCliente } from '../lib/protocolo';
import { TeoriaDaMente } from '../servidor/nucleo/TeoriaDaMente';

// ---------------------------------------------------------------------------
// A regra que não pode quebrar: nada de gênero sem declaração
// ---------------------------------------------------------------------------

test('ficha em branco NUNCA autoriza "senhor" nem "senhora"', () => {
  const bloco = TeoriaDaMente.overrideDePreferencias(PREFERENCIAS_PADRAO, 'Daiane');
  assert.match(bloco, /NENHUM/);
  assert.match(bloco, /Não use "senhor" nem "senhora"/);
  // O nome existe no bloco como forma de chamar — não como fonte de gênero.
  assert.match(bloco, /Chame-o de "Daiane"/);
});

test('nome feminino sem declaração continua sem tratamento', () => {
  // A regressão exata: "Daiane" não pode virar "senhora" em lugar nenhum do
  // caminho. Só a declaração explícita produz isso.
  for (const nome of ['Daiane', 'Carlos', 'Alex', 'Ana Paula']) {
    const bloco = TeoriaDaMente.overrideDePreferencias(PREFERENCIAS_PADRAO, nome);
    assert.doesNotMatch(bloco, /Tratamento declarado: SENHOR/);
    assert.doesNotMatch(bloco, /flexione no (feminino|masculino)/);
  }
});

test('tratamento declarado é aplicado, e só ele', () => {
  const senhora = TeoriaDaMente.overrideDePreferencias(
    { ...PREFERENCIAS_PADRAO, tratamento: 'senhora' },
    'Daiane',
  );
  assert.match(senhora, /Tratamento declarado: SENHORA/);
  assert.match(senhora, /flexione no feminino/);

  const senhor = TeoriaDaMente.overrideDePreferencias(
    { ...PREFERENCIAS_PADRAO, tratamento: 'senhor' },
    'Daiane',
  );
  assert.match(senhor, /Tratamento declarado: SENHOR/);
  assert.match(senhor, /flexione no masculino/);
});

test('ficha totalmente vazia e sem nome não gasta token nenhum', () => {
  assert.equal(TeoriaDaMente.overrideDePreferencias(PREFERENCIAS_PADRAO, ''), '');
  assert.ok(fichaVazia(PREFERENCIAS_PADRAO));
});

/**
 * Achado ao vivo em auditoria (14/08/2026): o nome da credencial vem cru do
 * e-mail de login ("daiane", derivado de daiane@atoslog.com.br) e ia direto
 * pro prompt em minúscula — a IARA escrevia "..., daiane" no meio de frases.
 * A mesma correção já existia do lado do cliente (`PainelConversa.tsx`, para
 * a saudação do cabeçalho); faltava aqui.
 */
test('nome cru da credencial (minúsculo, do e-mail de login) sai capitalizado', () => {
  const bloco = TeoriaDaMente.overrideDePreferencias(PREFERENCIAS_PADRAO, 'daiane');
  assert.match(bloco, /Chame-o de "Daiane"/);
  assert.doesNotMatch(bloco, /Chame-o de "daiane"/);
});

test('"como chamar" vence o nome da credencial', () => {
  const bloco = TeoriaDaMente.overrideDePreferencias(
    { ...PREFERENCIAS_PADRAO, como_chamar: 'Dai' },
    'Daiane Cristina dos Santos',
  );
  assert.match(bloco, /Chame-o de "Dai"/);
  assert.doesNotMatch(bloco, /Cristina/);
});

test('observações do operador entram sem revogar a persona', () => {
  const bloco = TeoriaDaMente.overrideDePreferencias(
    { ...PREFERENCIAS_PADRAO, funcao: 'TI', observacoes: 'vá direto ao ponto' },
    'Daiane',
  );
  assert.match(bloco, /Função na empresa: TI/);
  assert.match(bloco, /vá direto ao ponto/);
  // O texto do operador é tratado como preferência de atendimento, não como
  // instrução de sistema — senão a ficha vira um canal de injeção de prompt.
  assert.match(bloco, /não revoga/);
});

// ---------------------------------------------------------------------------
// Saneamento — a mesma função nos dois lados da fronteira
// ---------------------------------------------------------------------------

test('normalização recusa tratamento inventado e cai no padrão', () => {
  const p = normalizarPreferencias({ tratamento: 'majestade' });
  assert.equal(p.tratamento, 'nome');
});

test('normalização é total: qualquer lixo vira ficha em branco', () => {
  for (const lixo of [null, undefined, 42, 'texto', [], true]) {
    assert.deepEqual(normalizarPreferencias(lixo), PREFERENCIAS_PADRAO);
  }
});

test('campos longos são truncados, não recusados', () => {
  const p = normalizarPreferencias({
    como_chamar: 'x'.repeat(500),
    observacoes: 'y'.repeat(5000),
  });
  assert.equal(p.como_chamar.length, LIMITES_PREFERENCIAS.curto);
  assert.equal(p.observacoes.length, LIMITES_PREFERENCIAS.longo);
});

// ---------------------------------------------------------------------------
// Fronteira do socket
// ---------------------------------------------------------------------------

test('o pacote de preferências não aceita id_usuario — o shard vem da sessão', () => {
  const pacote = lerPacoteCliente(
    JSON.stringify({
      tipo: 'preferencias',
      id_usuario: 'operador-3',
      preferencias: { como_chamar: 'Dai', tratamento: 'senhora' },
    }),
  );
  assert.ok(pacote);
  assert.equal(pacote.tipo, 'preferencias');
  // O id veio no JSON e foi simplesmente ignorado: não existe campo para ele
  // no pacote, então não há como uma ficha ser gravada no shard de outro.
  assert.equal('id_usuario' in pacote, false);
});

test('pacote de preferências malformado vira ficha em branco, não null', () => {
  const pacote = lerPacoteCliente(JSON.stringify({ tipo: 'preferencias' }));
  assert.ok(pacote);
  assert.equal(pacote.tipo, 'preferencias');
  assert.deepEqual(
    pacote.tipo === 'preferencias' ? pacote.preferencias : null,
    PREFERENCIAS_PADRAO,
  );
});
