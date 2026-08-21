/**
 * A RÉGUA DA REGRESSÃO, TESTADA.
 *
 * Ela decide se um commit piorou — e uma peça dessas errada é pior que ausente:
 * ausente, alguém desconfia; errada, todo mundo confia. Os casos aqui são os que
 * a régua precisa acertar para significar alguma coisa, e cada um existe porque
 * o oposto dele seria um jeito plausível de deixar regressão passar.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  comparar,
  escolherBaseline,
  lerLimiares,
  maisSevera,
  type Limiares,
} from './validacao/Regressao';
import type { RegistroEvidencia } from './validacao/contrato';

const LIMIARES: Limiares = {
  queda_relativa_erro: 0.1,
  queda_relativa_aviso: 0.02,
  piora_de_latencia_erro: 0.5,
  dimensoes_criticas: ['falso_positivo', 'violacao_critica'],
};

let relogio = 0;
function reg(p: Partial<RegistroEvidencia> & { bateria: string; commit: string }): RegistroEvidencia {
  relogio += 1;
  return {
    bateria: p.bateria,
    execucao: `e${relogio}`,
    commit: p.commit,
    ambiente: 'teste',
    /* Instantes crescentes e determinísticos: `escolherBaseline` ordena por
       data, e um teste que dependesse do relógio real mediria a máquina. */
    instante: `2026-08-18T00:00:${String(relogio).padStart(2, '0')}.000Z`,
    status: p.status ?? 'EXECUTADA_PASSOU',
    cenarios: p.cenarios ?? 10,
    passou: p.passou ?? 10,
    falhou: p.falhou ?? 0,
    inconclusivo: 0,
    bloqueado: 0,
    artefato: null,
    metricas: p.metricas ?? {},
    versao_oraculo: '1',
    violacoes_criticas: p.violacoes_criticas ?? [],
  };
}

const comparaCom = (registros: RegistroEvidencia[], atual: string, base: string | null) =>
  comparar({ registros, commitAtual: atual, commitBaseline: base, limiares: LIMIARES });

test('R1. sem linha de base o resultado é AVISO, nunca PASSOU', () => {
  /* "Não sei se piorou" e "sei que não piorou" são afirmações diferentes, e só
     uma delas autoriza seguir tranquilo. É a mesma regra do ESTADO_DESCONHECIDO. */
  const c = comparaCom([reg({ bateria: 'a', commit: 'novo' })], 'novo', null);
  assert.equal(c.severidade, 'AVISO');
  assert.match(c.resumo, /sem linha de base/);
});

test('R2. mesma taxa nos dois commits não é regressão', () => {
  const c = comparaCom(
    [reg({ bateria: 'a', commit: 'velho' }), reg({ bateria: 'a', commit: 'novo' })],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'PASSOU');
  assert.equal(c.diferencas.length, 0);
});

test('R3. queda de 30% na taxa é ERRO', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', cenarios: 10, passou: 10 }),
      reg({ bateria: 'a', commit: 'novo', cenarios: 10, passou: 7, falhou: 3 }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'ERRO');
  assert.equal(c.diferencas[0].dimensao, 'taxa_aprovacao');
});

test('R4. queda de 5% é AVISO e não bloqueia', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', cenarios: 100, passou: 100 }),
      reg({ bateria: 'a', commit: 'novo', cenarios: 100, passou: 95, falhou: 5 }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'AVISO');
});

test('R5. ruído de 1% não vira alarme — um alarme que sempre toca é desligado', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', cenarios: 100, passou: 100 }),
      reg({ bateria: 'a', commit: 'novo', cenarios: 100, passou: 99, falhou: 1 }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'PASSOU');
});

test('R6. a PRIMEIRA mentira operacional nova é CRITICO, sem percentual', () => {
  /* Zero para um. Não existe fração aceitável de mentira, então não existe
     limiar relativo a aplicar aqui. */
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', metricas: { falso_positivo: 0 } }),
      reg({ bateria: 'a', commit: 'novo', metricas: { falso_positivo: 1 } }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'CRITICO');
  assert.equal(c.diferencas[0].dimensao, 'falso_positivo');
});

test('R7. dimensão crítica que MELHORA não vira diferença', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', metricas: { falso_positivo: 3 } }),
      reg({ bateria: 'a', commit: 'novo', metricas: { falso_positivo: 0 } }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'PASSOU');
});

test('R8. deixar de rodar uma bateria é ERRO — melhora os números e piora o que se sabe', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho' }),
      reg({ bateria: 'seguranca', commit: 'velho' }),
      reg({ bateria: 'a', commit: 'novo' }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'ERRO');
  assert.deepEqual(c.cobertura_perdida, ['seguranca']);
});

test('R9. passar para falhar é CRITICO mesmo sem queda de taxa medida', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', cenarios: 0, passou: 0, status: 'EXECUTADA_PASSOU' }),
      reg({ bateria: 'a', commit: 'novo', cenarios: 0, passou: 0, status: 'EXECUTADA_FALHOU' }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'CRITICO');
});

test('R10. dobrar a latência é ERRO — quem espera não distingue lentidão de defeito', () => {
  const c = comparaCom(
    [
      reg({ bateria: 'a', commit: 'velho', metricas: { latencia_ms: 1000 } }),
      reg({ bateria: 'a', commit: 'novo', metricas: { latencia_ms: 2500 } }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'ERRO');
  assert.equal(c.diferencas[0].dimensao, 'latencia');
});

test('R11. comparação é POR DIMENSÃO: melhorar uma não compensa quebrar outra', () => {
  /* O caso que a régua existe para pegar. Se as dimensões fossem somadas, este
     commit sairia empatado ou melhor. */
  const c = comparaCom(
    [
      reg({ bateria: 'conversa', commit: 'velho', cenarios: 10, passou: 5 }),
      reg({ bateria: 'execucao', commit: 'velho', cenarios: 10, passou: 10 }),
      reg({ bateria: 'conversa', commit: 'novo', cenarios: 10, passou: 10 }),
      reg({ bateria: 'execucao', commit: 'novo', cenarios: 10, passou: 5, falhou: 5 }),
    ],
    'novo',
    'velho',
  );
  assert.equal(c.severidade, 'ERRO');
  assert.deepEqual(
    c.diferencas.map((d) => d.bateria),
    ['execucao'],
    'a melhora em conversa não pode apagar a queda em execução',
  );
});

test('R12. a linha de base pula commit inutilizável', () => {
  const registros = [
    reg({ bateria: 'a', commit: 'bom' }),
    reg({ bateria: 'a', commit: 'quebrado' }),
    reg({ bateria: 'a', commit: 'atual' }),
  ];
  const escolhido = escolherBaseline(registros, 'atual', (c) => c === 'bom');
  assert.equal(escolhido, 'bom', 'comparar com commit quebrado faria o quebrado parecer estável');
});

test('R13. sem função de utilizável, a base é o commit distinto mais recente', () => {
  const registros = [
    reg({ bateria: 'a', commit: 'antigo' }),
    reg({ bateria: 'a', commit: 'recente' }),
    reg({ bateria: 'a', commit: 'atual' }),
  ];
  assert.equal(escolherBaseline(registros, 'atual'), 'recente');
});

test('R14. limiar ausente derruba a leitura em vez de virar padrão inventado', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'limiar-'));
  const arquivo = path.join(dir, 'l.json');
  try {
    writeFileSync(arquivo, JSON.stringify({ queda_relativa_erro: 0.1 }), 'utf8');
    assert.throws(() => lerLimiares(arquivo), /queda_relativa_aviso/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R15. o arquivo de limiares versionado é válido', () => {
  /* Impede que alguém edite o JSON e só descubra o erro numa madrugada de
     campanha, quando a régua se recusa a medir. */
  const l = lerLimiares();
  assert.ok(l.queda_relativa_erro > l.queda_relativa_aviso, 'erro tem de ser mais severo que aviso');
  assert.ok(l.dimensoes_criticas.includes('falso_positivo'));
});

test('R16. a escala de severidade não deixa uma pior ser rebaixada', () => {
  assert.equal(maisSevera('AVISO', 'CRITICO'), 'CRITICO');
  assert.equal(maisSevera('ERRO', 'AVISO'), 'ERRO');
  assert.equal(maisSevera('PASSOU', 'PASSOU'), 'PASSOU');
});
