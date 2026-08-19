/**
 * A RESPOSTA CERTA PARA A PERGUNTA ERRADA.
 *
 * O DEFEITO (medido em produção, 18/08/2026). Perguntada quantas cargas
 * existem, a IARA respondeu "2681 cargas no total". São 2681 **em 2026**. A
 * planilha tem 10.777: as abas "2025" (4031 linhas) e "2024" (4065) estão no
 * MESMO arquivo e não são lidas — `ClientePlanilhaOcis.ABA_VIVA` é só '2026'.
 *
 * O número estava certo e a frase era falsa. E a procedência interna já
 * carimbava `fonte: '2026'`: o sistema sabia o ano e não contava a quem
 * perguntou. É o mesmo padrão do relógio que dizia 18:29 — plausível, bem
 * formatado, com o rótulo errado.
 *
 * POR QUE A RECUSA E NÃO A LEITURA. Trocar de aba não é ligar uma flag: 2026
 * tem outro mapa de colunas (VALOR na 17; nas antigas, na 25, com um bloco
 * AGENDAMENTO no meio). Ler as antigas com o mapa desta produziria lixo
 * silencioso — pior que a recusa. Enquanto o mapa não existir, a resposta
 * honesta é dizer o que se alcança e o que não.
 *
 * A FRASE CRUA É O QUE VALE. O caso perigoso não é o operador dizer
 * `periodo: '2025'` — esse já morria em "não entendi o período". É a LLM largar
 * o ano pelo caminho: "quantas cargas em 2025?" vira uma chamada SEM período, o
 * universo inteiro de 2026 responde, e o número sai rotulado como de 2025.
 * Por isso a porta lê `ctx.enunciado`.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { ANO_VIVO, anoForaDoAlcance } from '../servidor/nucleo/ClientePlanilhaOcis';

test('cita ano que a leitura não alcança → devolve o ano citado', () => {
  assert.equal(anoForaDoAlcance('quantas cargas em 2025?'), '2025');
  assert.equal(anoForaDoAlcance('compare 2024 com 2026'), '2024');
  assert.equal(anoForaDoAlcance('qual motorista fez mais cargas em 2024?'), '2024');
});

test('o ano vivo e as perguntas sem ano passam', () => {
  assert.equal(anoForaDoAlcance(`quantas cargas em ${ANO_VIVO}?`), null);
  assert.equal(anoForaDoAlcance('qual motorista tem mais cargas?'), null);
  assert.equal(anoForaDoAlcance('quantas cargas essa semana?'), null);
});

/**
 * Um número de OCI tem seis dígitos e carrega "2015" no miolo — "191597" não.
 * Mas "1920155" carregaria, e um `\d{4}` sem fronteira transformaria consulta de
 * OCI em recusa. A fronteira de palavra é o que impede a porta de virar um
 * estorvo em cima do uso normal.
 */
test('número de OCI não é confundido com ano', () => {
  assert.equal(anoForaDoAlcance('me mostra a OCI 191597'), null);
  assert.equal(anoForaDoAlcance('a carga 2020156 chegou?'), null);
  assert.equal(anoForaDoAlcance('OCI 190949 e 192852'), null);
});

/** Ano de quatro dígitos fora da faixa de operação não é ano de operação. */
test('ano implausível não arma a recusa', () => {
  assert.equal(anoForaDoAlcance('o contrato de 1998'), null);
  assert.equal(anoForaDoAlcance('meta para 2045'), null);
});

/**
 * O PORTÃO DE REGRESSÃO, e é ele que fecha o defeito de 18/08: nenhuma das
 * quatro habilidades de carga pode chegar a uma conta sem passar pela porta.
 * Uma habilidade nova que esqueça a chamada volta a responder 2026 com rótulo
 * de 2025 — e esse teste é o que avisa.
 */
test('as quatro habilidades de carga consultam o alcance antes de contar', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/habilidades/cargasLuft.ts', import.meta.url),
    'utf8',
  );

  const executares = fonte.split('async executar(ctx)').slice(1);
  assert.equal(executares.length, 4, 'mudou o número de habilidades desta folha — reveja o portão');

  for (const [i, corpo] of executares.entries()) {
    /* A porta tem de vir no COMEÇO: depois da primeira leitura da planilha já é
       tarde, porque a conta que ela deveria impedir já aconteceu. */
    const antesDaConta = corpo.slice(0, corpo.indexOf('todasAsCargas') + 1 || 400);
    assert.ok(
      /recusaPorAno\(ctx\.enunciado\)/.test(antesDaConta),
      `a habilidade #${i + 1} conta sem consultar o alcance do ano primeiro`,
    );
  }
});

/**
 * O ANO VIVO NÃO PODE VIRAR FILTRO DE PERÍODO.
 *
 * Medido em produção logo depois da porta de ano entrar: "qual o valor total
 * faturado nas cargas de 2026?" devolveu *"Não entendi '2026' como período"*. A
 * LLM fez o certo repassando o ano, o ano ERA o que o sistema lê, e mesmo assim
 * a resposta foi recusa. A aba inteira já é 2026 — citar o ano não filtra nada.
 */
test('o ano vivo some da expressão de período em vez de virar filtro', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/habilidades/cargasLuft.ts', import.meta.url),
    'utf8',
  );
  assert.ok(
    /tirarOAnoVivo\(String\(ctx\.parametros\.periodo/.test(fonte),
    'a expressão de período chega ao interpretador com o ano vivo dentro — ' +
      'e ele não entende ano, então recusa uma pergunta que sabia responder',
  );

  /* A função em si: "de 2026" vira universo inteiro; mês sobrevive para o
     interpretador decidir (e recusar com honestidade, que é o certo hoje). */
  const mod = await import('../servidor/nucleo/kernel/habilidades/cargasLuft');
  const tirar = (mod as unknown as { _tirarOAnoVivoParaTeste?: (s: string) => string })
    ._tirarOAnoVivoParaTeste;
  if (tirar) {
    assert.equal(tirar('2026'), '');
    assert.equal(tirar('de 2026'), '');
    assert.equal(tirar('em 2026'), '');
    assert.equal(tirar('janeiro de 2026'), 'janeiro');
  }
});

/** O rótulo que o operador lê precisa dizer o ano — foi a sua ausência que
 *  transformou "2681 de 2026" em "2681 no total". */
test('o rótulo do universo sem período nomeia o ano', async () => {
  const { readFileSync } = await import('node:fs');
  const fonte = readFileSync(
    new URL('../servidor/nucleo/kernel/habilidades/cargasLuft.ts', import.meta.url),
    'utf8',
  );
  assert.ok(
    !/'todas as cargas cadastradas'/.test(fonte),
    'o rótulo voltou a omitir o ano — é a frase que fez a IARA chamar 2681 de "total"',
  );
  assert.ok(/todas as cargas de \$\{ANO_VIVO\}/.test(fonte), 'o rótulo precisa nomear o ano');
});
