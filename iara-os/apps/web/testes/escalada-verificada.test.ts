/**
 * A ESCALADA POR VERIFICAÇÃO — cada transição do diagrama, uma por teste.
 *
 * A pergunta experimental que esta fatia responde é uma só: *a IARA detecta uma
 * resposta errada durante o turno e gasta conscientemente uma segunda tentativa
 * com um modelo melhor, sem estourar orçamento e sem entrar em laço?*
 *
 * O teste que mais importa é o E7. Ele prova que o laço TERMINA: barato erra,
 * premium erra também, e não existe terceira chamada.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { decidirEscalada, textoDegradado } from '../servidor/nucleo/kernel/EscaladaDoTurno';
import { VerificadorDeterministico } from '../servidor/nucleo/kernel/VerificacaoRuntime';
import {
  conferirContagem,
  conferirHoraDeParede,
  conferirSemFonte,
  horaDeParede,
} from '../lib/verificacao/oraculos';
import type { ResultadoVerificacao } from '../lib/verificacao/contrato';

const VALIDO: ResultadoVerificacao = {
  status: 'valido',
  evidencia: { fonte: 'f', esperado: '11', obtido: '11', detalhe: 'd' },
};
const INCONCLUSIVO: ResultadoVerificacao = { status: 'inconclusivo', motivo: 'não sei conferir' };
const invalido = (escalavel: boolean): ResultadoVerificacao => ({
  status: 'invalido',
  motivo: 'a fala afirma 1234 e a fonte diz 1178',
  evidencia: { fonte: 'dados', esperado: '1178', obtido: '1234', detalhe: 'd' },
  escalavel,
});

const tudoLiberado = {
  ja_escalou: false,
  orcamento_permite: true,
  premium_saudavel: true,
};

// ---------------------------------------------------------------------------
// As transições
// ---------------------------------------------------------------------------

test('E1. VALID → entrega, sem gastar nada', () => {
  const d = decidirEscalada({ resultado: VALIDO, ...tudoLiberado });
  assert.equal(d.acao, 'entregar');
});

test('E2. INCONCLUSIVO → entrega, e NÃO escala', () => {
  /* A imensa maioria dos turnos cai aqui. Escalar em "não sei conferir" faria
     toda conversa custar dois modelos, e degradar faria a IARA se desculpar por
     ter respondido bem. */
  const d = decidirEscalada({ resultado: INCONCLUSIVO, ...tudoLiberado });
  assert.equal(d.acao, 'entregar');
});

test('E3. INVALID escalável, com orçamento e premium são → ESCALATE', () => {
  const d = decidirEscalada({ resultado: invalido(true), ...tudoLiberado });
  assert.equal(d.acao, 'escalar');
  assert.match(d.porque, /1234/);
});

test('E4. INVALID NÃO escalável → degrada direto, sem gastar orçamento', () => {
  /* Fonte desligada e hora errada não se consertam com cérebro melhor: escalar
     ali só produziria uma invenção mais bem escrita. */
  const d = decidirEscalada({ resultado: invalido(false), ...tudoLiberado });
  assert.equal(d.acao, 'degradar');
  assert.match(d.porque, /não consertaria/);
});

test('E5. orçamento nega → DENIED_BY_BUDGET vira degradação honesta', () => {
  const d = decidirEscalada({
    resultado: invalido(true),
    ...tudoLiberado,
    orcamento_permite: false,
  });
  assert.equal(d.acao, 'degradar');
  assert.match(d.porque, /sem orçamento/);
});

test('E6. sem pool premium saudável não há para onde escalar', () => {
  const d = decidirEscalada({
    resultado: invalido(true),
    ...tudoLiberado,
    premium_saudavel: false,
  });
  assert.equal(d.acao, 'degradar');
});

test('E7. o laço TERMINA: premium também errou e não existe terceira chamada', () => {
  /**
   * O teste fundamental desta fatia. Barato responde errado → escala; premium
   * responde errado também → degrada. Uma escalada por TURNO, não por provedor:
   * com teto por provedor, quatro elos produziriam quatro chamadas premium e
   * nenhuma prova de convergência.
   */
  const primeira = decidirEscalada({ resultado: invalido(true), ...tudoLiberado });
  assert.equal(primeira.acao, 'escalar');

  const segunda = decidirEscalada({
    resultado: invalido(true),
    ...tudoLiberado,
    ja_escalou: true,
  });
  assert.equal(segunda.acao, 'degradar');
  assert.match(segunda.porque, /já havia escalado/);
});

test('E8. premium acertando fecha o turno com a resposta boa', () => {
  const segunda = decidirEscalada({ resultado: VALIDO, ...tudoLiberado, ja_escalou: true });
  assert.equal(segunda.acao, 'entregar');
});

test('E9. a degradação NUNCA repete o valor contestado como se fosse resposta', () => {
  const t = textoDegradado(invalido(true));
  assert.doesNotMatch(t, /\b1234\b/, 'o número contestado voltaria como resposta');
  assert.match(t, /1178/, 'o valor da fonte pode e deve aparecer');
  assert.match(t, /não confirmei|não bateu/i);
});

// ---------------------------------------------------------------------------
// O adversarial: confiança declarada não é evidência
// ---------------------------------------------------------------------------

test('E10. "tenho certeza que são 1234" é tratado igual a "acho que são 1234"', () => {
  /**
   * O princípio inteiro em um teste: confiança do executor ≠ evidência de
   * correção. O verificador não recebe a confiança de propósito — nem do modelo,
   * nem da percepção — e as duas frases produzem o mesmo veredito.
   */
  const comCerteza = conferirContagem('Tenho absoluta certeza: são 1234 centrais.', /centrais?/, 1178, 'dados');
  const comDuvida = conferirContagem('Acho que são 1234 centrais, mas não sei.', /centrais?/, 1178, 'dados');

  assert.equal(comCerteza.status, 'invalido');
  assert.equal(comDuvida.status, 'invalido');
  assert.deepEqual(
    comCerteza.status === 'invalido' ? comCerteza.evidencia : null,
    comDuvida.status === 'invalido' ? comDuvida.evidencia : null,
  );
});

test('E11. a hora errada com toda a confiança do mundo continua errada', () => {
  /* O incidente de 18/08/2026: "São 18:29 de terça-feira" quando eram 15:29. A
     frase é impecável — português certo, dia certo, formato certo. */
  const incidente = new Date('2026-08-18T18:29:00.000Z').getTime();
  const r = conferirHoraDeParede(
    'São 18:29 de terça-feira, 18 de agosto de 2026.',
    incidente,
    incidente,
  );
  assert.equal(r.status, 'invalido');
  assert.equal(r.status === 'invalido' && r.evidencia.esperado, '15:29');
  assert.equal(r.status === 'invalido' && r.escalavel, false, 'a hora não vem do modelo');
});

// ---------------------------------------------------------------------------
// O núcleo compartilhado, conferido contra fato humano
// ---------------------------------------------------------------------------

test('E12. o núcleo é ancorado no incidente real, não em si mesmo', () => {
  /**
   * Runtime e campanha passam a usar o MESMO núcleo, então um defeito NO NÚCLEO
   * ficaria invisível para os dois. A âncora contra isso é um fato conferido por
   * gente: às 18:29 UTC de 18/08/2026, o relógio de parede em São Paulo marcava
   * 15:29. Se este teste cair, o núcleo está errado — não a IARA.
   */
  assert.equal(horaDeParede(new Date('2026-08-18T18:29:00.000Z')), '15:29');
});

test('E13. sem afirmar valor, o veredito é inconclusivo — nunca inválido', () => {
  /* Recusar honestamente é o comportamento certo quando a fonte está fora.
     Tratar isso como erro puniria a honestidade que o sistema tenta produzir. */
  const r = conferirSemFonte('Essa base está desligada por falta de credencial.', 'LUFT');
  assert.equal(r.status, 'inconclusivo');
});

test('E14. leitura frouxa não ACUSA: sem número colado, no máximo inconclusivo', () => {
  /* Acusar por leitura frouxa produziria escalada em resposta correta — gasto
     de cota criado pelo próprio verificador. */
  const r = conferirContagem('Foram 449 veículos em 11 unidades.', /centrais?/, 11, 'dados');
  assert.notEqual(r.status, 'invalido');
});

// ---------------------------------------------------------------------------
// O adaptador de runtime
// ---------------------------------------------------------------------------

function baseDeTeste(centrais: Array<{ uf: string; ativa: boolean }>) {
  const dir = mkdtempSync(path.join(tmpdir(), 'verif-'));
  mkdirSync(path.join(dir, 'dados'), { recursive: true });
  writeFileSync(
    path.join(dir, 'dados', 'infraestrutura.json'),
    JSON.stringify({ centrais }),
    'utf8',
  );
  return dir;
}

test('E15. o verificador só opina sobre o que reconhece', () => {
  const raiz = baseDeTeste([{ uf: 'MT', ativa: true }]);
  try {
    const v = new VerificadorDeterministico({ raiz });
    const r = v.verificar('Claro, posso ajudar com isso.', {
      pergunta: 'me conta uma piada',
      inicio_ms: Date.now(),
      fim_ms: Date.now(),
    });
    assert.equal(r.status, 'inconclusivo');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('E16. contagem de centrais é conferida contra o JSON, por parser próprio', () => {
  const raiz = baseDeTeste([
    { uf: 'MT', ativa: true },
    { uf: 'MT', ativa: true },
    { uf: 'GO', ativa: true },
    { uf: 'SP', ativa: false },
  ]);
  try {
    const v = new VerificadorDeterministico({ raiz });
    const ctx = { pergunta: 'quantas centrais ativas existem?', inicio_ms: 0, fim_ms: 0 };

    assert.equal(v.verificar('São 3 centrais ativas.', ctx).status, 'valido');
    const errado = v.verificar('São 9 centrais ativas.', ctx);
    assert.equal(errado.status, 'invalido');
    assert.equal(errado.status === 'invalido' && errado.escalavel, true);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('E17. o recorte por UF sai da pergunta, não de palpite', () => {
  const raiz = baseDeTeste([
    { uf: 'MT', ativa: true },
    { uf: 'MT', ativa: true },
    { uf: 'GO', ativa: true },
  ]);
  try {
    const v = new VerificadorDeterministico({ raiz });
    const ctx = { pergunta: 'quantas centrais ativas em MT?', inicio_ms: 0, fim_ms: 0 };
    assert.equal(v.verificar('Duas: são 2 centrais ativas.', ctx).status, 'valido');
    assert.equal(v.verificar('São 3 centrais ativas.', ctx).status, 'invalido');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('E18. base ilegível deixa o verificador cego, e cego não acusa', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'verif-'));
  try {
    const v = new VerificadorDeterministico({ raiz: dir });
    const r = v.verificar('São 9 centrais ativas.', {
      pergunta: 'quantas centrais ativas existem?',
      inicio_ms: 0,
      fim_ms: 0,
    });
    assert.equal(r.status, 'inconclusivo', 'não conseguir olhar não é olhar e discordar');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('E19. fonte desligada: número afirmado é invenção, e não é escalável', () => {
  const raiz = baseDeTeste([]);
  try {
    const v = new VerificadorDeterministico({ raiz, fontesAusentes: () => ['LUFT'] });
    const r = v.verificar('Temos 1234 cargas cadastradas na LUFT.', {
      pergunta: 'quantas cargas existem na LUFT em 2026?',
      inicio_ms: 0,
      fim_ms: 0,
    });
    assert.equal(r.status, 'invalido');
    assert.equal(r.status === 'invalido' && r.escalavel, false);
    /* O ano do pedido ecoado na resposta não conta como alegação de dado. */
    const honesta = v.verificar('A base LUFT de 2026 está desligada por falta de credencial.', {
      pergunta: 'quantas cargas existem na LUFT em 2026?',
      inicio_ms: 0,
      fim_ms: 0,
    });
    assert.equal(honesta.status, 'inconclusivo');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('E20. o relógio é conferido pela janela do turno, não por instante', () => {
  const raiz = baseDeTeste([]);
  try {
    const v = new VerificadorDeterministico({ raiz });
    const t0 = new Date('2026-08-18T18:29:50.000Z').getTime();
    const t1 = new Date('2026-08-18T18:30:30.000Z').getTime();
    const ctx = { pergunta: 'que horas são agora?', inicio_ms: t0, fim_ms: t1 };
    assert.equal(v.verificar('São 15:29.', ctx).status, 'valido');
    assert.equal(v.verificar('São 15:30.', ctx).status, 'valido');
    assert.equal(v.verificar('São 18:30.', ctx).status, 'invalido');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
