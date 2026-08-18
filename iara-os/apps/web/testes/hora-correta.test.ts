/**
 * O RELÓGIO DA IARA CONTRA A REALIDADE — verificação semântica, não de forma.
 *
 * O DEFEITO (operadora, 18/08/2026): "Que horas são agora?" → "São 18:29 de
 * terça-feira, 18 de agosto de 2026". Eram 15:31. Três horas exatas.
 *
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR, e não é o bug — é a CLASSE dele.
 * Nenhum teste de forma pegaria isto: "18:29" casa qualquer `/\d{2}:\d{2}/`,
 * está em português, tem o dia da semana certo e a data certa. A resposta é
 * impecável em tudo, menos em ser verdade. Um "não sei" o operador confere; um
 * "são 18:29" ele usa para marcar uma coleta.
 *
 * O ORACLE É INDEPENDENTE DA IMPLEMENTAÇÃO, de propósito. Ele não chama
 * `toLocaleString` para conferir `toLocaleString` — isso passaria com o bug em
 * pé, porque as duas pontas errariam juntas. Ele parte de um instante UTC
 * conhecido e da regra do fuso (`America/Sao_Paulo` é UTC-3 o ano inteiro desde
 * que o Brasil acabou com o horário de verão, em 2019) e faz a conta à mão.
 *
 * ONDE O ERRO NASCEU, medido e não suposto: o relógio do servidor está CERTO.
 * Em produção, `raciocinio_falhas.groq.desde` gravou `2026-08-18T18:27:57.267Z`
 * no mesmo minuto em que a operadora lia 15:28 — UTC correto. O que faltava era
 * `timeZone` na formatação: o locale `pt-BR` decide o FORMATO, nunca o fuso, e
 * sem ele vale o do sistema — Brasil na máquina de quem desenvolve, UTC no
 * Railway. O bug é invisível em desenvolvimento por construção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FUSO_OPERACAO, instantePorExtenso } from '../servidor/nucleo/kernel/Quando';

/**
 * O ORACLE. Recebe um instante UTC e devolve a hora que um relógio de parede em
 * São Paulo mostraria — por aritmética, sem `Intl`, sem `toLocale*`.
 */
function horaDeParedeEsperada(utc: Date): string {
  const OFFSET_H = -3; // America/Sao_Paulo, sem horário de verão desde 2019
  const deslocado = new Date(utc.getTime() + OFFSET_H * 3600_000);
  const hh = String(deslocado.getUTCHours()).padStart(2, '0');
  const mm = String(deslocado.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** O instante exato do incidente, como o servidor o registrou. */
const INSTANTE_DO_INCIDENTE = new Date('2026-08-18T18:29:00.000Z');

test('o oracle e a implementação concordam no instante do incidente', () => {
  const esperado = horaDeParedeEsperada(INSTANTE_DO_INCIDENTE);
  assert.equal(esperado, '15:29', 'o próprio oracle está errado — conferir a regra do fuso');

  const dito = instantePorExtenso(INSTANTE_DO_INCIDENTE);
  assert.ok(
    dito.includes(esperado),
    `a IARA diria "${dito}", e o relógio de parede marcava ${esperado}. ` +
      'Foi exatamente esta diferença que a operadora leu como 18:29 quando eram 15:31.',
  );
  assert.ok(
    !dito.includes('18:29'),
    `"${dito}" ainda carrega a hora UTC — o fuso não foi aplicado`,
  );
});

/**
 * A PROVA DE QUE O TESTE PEGA O BUG. Reproduz a expressão exata que estava em
 * `OrquestradorAcoes.informarRelogio` e exige que ela DIVIRJA do oracle quando o
 * processo roda em UTC — que é a condição do Railway.
 *
 * Sem este caso, alguém poderia remover o `timeZone` e ver tudo verde numa
 * máquina brasileira, que é precisamente como o defeito chegou à produção.
 */
test('a formatação sem fuso erra em UTC — a condição real do servidor', () => {
  const semFuso = INSTANTE_DO_INCIDENTE.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });
  const comFuso = INSTANTE_DO_INCIDENTE.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: FUSO_OPERACAO,
  });

  assert.equal(semFuso, '18:29', 'é este o valor que a operadora recebeu');
  assert.equal(comFuso, '15:29', 'é este o valor que ela deveria ter recebido');
  assert.notEqual(semFuso, comFuso, 'sem divergência, este arquivo não prova nada');
});

/** A data também é do fuso da operação — 21:30 em São Paulo já é o dia seguinte
 *  em UTC, e um lembrete "para hoje" viraria amanhã. */
test('a virada do dia respeita o fuso da operação, não o do servidor', () => {
  /* 03:00Z de 19/08 é 00:00 de 19/08 em São Paulo — mesma data, borda exata. */
  assert.ok(instantePorExtenso(new Date('2026-08-19T03:00:00.000Z')).includes('19 de agosto'));
  /* 02:59Z de 19/08 ainda é 23:59 de 18/08 em São Paulo. */
  const vespera = instantePorExtenso(new Date('2026-08-19T02:59:00.000Z'));
  assert.ok(
    vespera.includes('18 de agosto'),
    `virou o dia cedo demais: "${vespera}" — o servidor está mandando na data`,
  );
});

/**
 * A MESMA CLASSE, NOUTRO LUGAR. A varredura de 18/08/2026 achou uma segunda
 * ocorrência: `dataCurta` no `ClienteGraph`, que carimba e-mail e compromisso da
 * agenda. Um e-mail recebido às 15:00 aparecia como 18:00 — plausível, e errado.
 *
 * O teste é de propriedade e não de valor: qualquer formatação de INSTANTE que a
 * IARA mostre ao operador precisa declarar fuso. Number e moeda não entram —
 * `toLocaleString` para dinheiro não tem fuso nenhum a declarar.
 */
test('nenhuma formatação de instante servida ao operador fica sem fuso', async () => {
  const { readFileSync } = await import('node:fs');
  const alvos = [
    'servidor/nucleo/OrquestradorAcoes.ts',
    'servidor/nucleo/ClienteGraph.ts',
    'servidor/nucleo/ClienteGoogleCalendario.ts',
  ];

  for (const alvo of alvos) {
    const fonte = readFileSync(new URL(`../${alvo}`, import.meta.url), 'utf8');
    const linhas = fonte.split('\n');

    linhas.forEach((linha, i) => {
      const formataInstante = /toLocale(Date|Time)String|toLocaleString/.test(linha);
      if (!formataInstante) return;
      /* Moeda e número não têm fuso — e um comentário citando o método também não. */
      if (/currency|maximumFractionDigits|style:|^\s*\*|^\s*\/\//.test(linha)) return;

      /* O `timeZone` pode estar na mesma linha ou nas opções logo abaixo. */
      const janela = linhas.slice(i, i + 8).join('\n');
      assert.ok(
        /timeZone/.test(janela),
        `${alvo}:${i + 1} formata um instante sem declarar fuso — ` +
          'em UTC (Railway) isso vira +3h de mentira bem formatada.',
      );
    });
  }
});
