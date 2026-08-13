/**
 * A decisão de privacidade da localização, provada.
 *
 * "Usar e descartar" foi a escolha de 12/08/2026, e uma decisão dessas não
 * sobrevive como frase no README: sobrevive como teste que falha no dia em que
 * alguém acrescentar a gravação "só para melhorar a experiência".
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  esquecerLocal,
  localDe,
  quantosLocaisNaMemoria,
  registrarLocal,
} from '../servidor/nucleo/LocalOperador';
import { lerPacoteCliente } from '../lib/protocolo';

test('a posição registrada volta para o mesmo operador', () => {
  registrarLocal('op-a', -22.9707, -46.9958);
  const achado = localDe('op-a');
  assert.equal(achado?.latitude, -22.9707);
  assert.equal(achado?.longitude, -46.9958);
  esquecerLocal('op-a');
});

test('a posição de um operador NÃO vaza para outro', () => {
  registrarLocal('op-a', -22.9707, -46.9958);
  assert.equal(localDe('op-b'), null);
  esquecerLocal('op-a');
});

test('esquecer remove de verdade, não só marca', () => {
  registrarLocal('op-a', 1, 2);
  esquecerLocal('op-a');
  assert.equal(localDe('op-a'), null);
  assert.equal(quantosLocaisNaMemoria(), 0, 'a entrada continuou ocupando memória');
});

test('posição velha expira e some do mapa', () => {
  const relogio = Date.now;
  try {
    registrarLocal('op-a', 1, 2);
    // Nove horas depois: fora da validade de oito.
    Date.now = () => relogio() + 9 * 60 * 60 * 1000;
    assert.equal(localDe('op-a'), null, 'respondeu com a posição de ontem');
    assert.equal(quantosLocaisNaMemoria(), 0, 'expirou mas continuou no mapa');
  } finally {
    Date.now = relogio;
    esquecerLocal('op-a');
  }
});

/**
 * O TESTE QUE GUARDA A DECISÃO.
 *
 * Não mede comportamento: mede a AUSÊNCIA de dependência. Enquanto este módulo
 * não conhecer persistência nenhuma, não existe caminho — nem por engano, nem
 * por pressa — da localização de alguém para o disco ou para o banco. Uma flag
 * `naoPersistir` seria uma promessa; não ter o import é um fato.
 */
test('LocalOperador não tem caminho para persistência', () => {
  const fonte = readFileSync(
    fileURLToPath(new URL('../servidor/nucleo/LocalOperador.ts', import.meta.url)),
    'utf8',
  );
  const proibidos = [
    'MemoriaOperacional',
    'ClienteSupabase',
    'supabase',
    'node:fs',
    'writeFile',
    'RegistroOperacoes',
  ];
  for (const termo of proibidos) {
    assert.ok(
      !new RegExp(`^\s*import[^;]*${termo}`, 'm').test(fonte),
      `LocalOperador importou ${termo}: a localização ganhou caminho para fora da memória`,
    );
  }
});

// ---------------------------------------------------------------------------
// O pacote de fio
// ---------------------------------------------------------------------------

test('pacote de local aceita coordenada plausível', () => {
  const p = lerPacoteCliente(JSON.stringify({ tipo: 'local', latitude: -22.97, longitude: -46.99 }));
  assert.deepEqual(p, { tipo: 'local', latitude: -22.97, longitude: -46.99 });
});

test('coordenada impossível é descartada, não corrigida', () => {
  // Fora da faixa não é erro de digitação do cliente — é a única forma de
  // este pacote mentir. Descarta; não normaliza.
  for (const bruto of [
    { tipo: 'local', latitude: 900, longitude: 0 },
    { tipo: 'local', latitude: 0, longitude: 999 },
    { tipo: 'local', latitude: -91, longitude: 0 },
    { tipo: 'local', latitude: 'aqui', longitude: 0 },
    { tipo: 'local', latitude: NaN, longitude: 0 },
    { tipo: 'local' },
  ]) {
    assert.equal(lerPacoteCliente(JSON.stringify(bruto)), null, JSON.stringify(bruto));
  }
});

test('o pacote não carrega id de usuário nem nome de cidade', () => {
  // O dono é a sessão, como em toda escrita do sistema; e o nome do lugar seria
  // uma afirmação que este pacote não pode provar.
  const p = lerPacoteCliente(
    JSON.stringify({
      tipo: 'local',
      latitude: -22.97,
      longitude: -46.99,
      id_usuario: 'outro-operador',
      cidade: 'Valinhos',
    }),
  );
  assert.deepEqual(p, { tipo: 'local', latitude: -22.97, longitude: -46.99 });
});
