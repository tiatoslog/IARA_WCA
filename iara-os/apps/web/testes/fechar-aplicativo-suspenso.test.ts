/**
 * FECHAR APLICATIVO SUSPENSO — a capacidade que a IARA anunciava e não entregava.
 *
 * O DEFEITO, medido ao vivo na auditoria de 15/08/2026: pedi para abrir o Bloco
 * de Notas (abriu, verificado por contagem de processo) e em seguida para
 * fechar. A IARA respondeu, honestamente:
 *
 *     "Não executei isso. Fechar o aplicativo pedido: notepad.exe ainda
 *      presente (2 processo(s)) depois do pedido de fechamento."
 *
 * Honesto e inútil. O operador pediu para fechar e o aplicativo continuou
 * aberto — uma capacidade que existe, é anunciada, é tentada e não entrega.
 *
 * A CAUSA não era trabalho não salvo (o bloco de notas estava vazio): app da
 * Store fica SUSPENSO fora de foco e não processa o pedido educado de
 * fechamento. O conserto é a ordem, não a força — acordar a janela
 * (`ShowWindow` + `SetForegroundWindow`) devolve o processo à fila de mensagens,
 * e aí o mesmo pedido educado é atendido.
 *
 * O QUE ESTES TESTES PROTEGEM, e é o mais importante: que a solução NUNCA vire
 * um `taskkill /F`. Nenhum caminho aqui pode matar processo — se algum dia
 * alguém "consertar" a resistência com força bruta, `FEC-06` derruba a suíte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { AgenteLocal } from '../servidor/nucleo/AgenteLocal';

const USUARIO = 'operador-teste';

/**
 * Monta um agente com o mundo inteiro fingido. `sondas` é a fila de respostas
 * da tabela de processos, consumida em ordem: a primeira é o "antes", as
 * seguintes são cada re-sonda. É o que permite descrever "estava aberto, o
 * pedido educado não resolveu, o acordar resolveu" sem abrir nada.
 */
function montar(opcoes: {
  sondas: Array<number[] | null>;
  acordar?: (processo: string) => Promise<number | null>;
}) {
  const comandos: string[][] = [];
  const acordados: string[] = [];
  const fila = [...opcoes.sondas];
  const agente = new AgenteLocal(
    () => undefined,
    async (cmd, args) => {
      comandos.push([cmd, ...args]);
      return 0;
    },
    undefined,
    async () => (fila.length > 1 ? (fila.shift() ?? null) : (fila[0] ?? null)),
    undefined,
    undefined,
    undefined,
    undefined,
    async (processo) => {
      acordados.push(processo);
      return opcoes.acordar ? opcoes.acordar(processo) : 1;
    },
  );
  return { agente, comandos, acordados };
}

test('FEC-01. app comum fecha no pedido educado, sem incomodar a tela de ninguém', async () => {
  // Antes: 1 processo. Depois do taskkill: nenhum. Não há segundo degrau.
  const { agente, comandos, acordados } = montar({ sondas: [[100], []] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o paint');

  assert.equal(r.ok, true);
  assert.equal(r.prova.confirmado, true);
  assert.deepEqual(acordados, [], 'não deve roubar o foco quando o educado bastou');
  assert.match(r.texto, /Pronto\. Fechei/);
  assert.ok(!/janela para a frente/.test(r.texto));
});

test('FEC-02. app suspenso: resiste ao educado, acorda, e fecha — o defeito medido', async () => {
  /* A sequência exata do E2E: antes tem processo, depois do taskkill CONTINUA
     (a suspensão engoliu o pedido), e só depois de acordar some. */
  const { agente, comandos, acordados } = montar({ sondas: [[100, 101], [100, 101], []] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.ok, true, 'a capacidade tem de ENTREGAR, não só relatar bonito');
  assert.equal(r.prova.confirmado, true);
  assert.deepEqual(acordados, ['notepad.exe']);
  /* A frase diz o FATO OBSERVADO ("ignorou o primeiro pedido"), não a classe
     inferida ("é da Store, estava suspenso"). A classe é afirmável quando está
     declarada na allowlist — e para o Bloco de Notas ela não está, porque no
     Windows 10 ele não é da Store. Ver a nota na entrada da allowlist. */
  assert.match(r.texto, /ignorou o primeiro pedido/);
  assert.match(r.texto, /trouxe a janela para a frente/);
  assert.match(r.prova.evidencia, /sumiu da tabela de processos/);
  // E continua sem forçar.
  assert.ok(
    comandos.every((c) => !c.includes('/F')),
    'nenhum comando pode carregar /F',
  );
});

/**
 * ESTE CASO JÁ ESTEVE ERRADO, e o registro vale mais que o caso.
 *
 * A primeira versão dele exigia que a frase afirmasse a causa: "o aplicativo
 * está segurando o fechamento, normalmente esperando você responder se quer
 * salvar". Parecia uma melhoria — a suspensão tinha sido eliminada como
 * explicação, então o que sobrava seria trabalho pendente. Não sobrava: sobrava
 * o que NÃO foi medido. `fechar-aplicativo-honesto.test.ts` ficou vermelho e
 * estava certo, e a prosa foi corrigida em vez do teste.
 *
 * O que a frase pode afirmar é a SEQUÊNCIA observada. Hipótese continua
 * marcada como hipótese.
 */
test('FEC-03. acordou, pediu, e o app segurou: relata a sequência e não crava causa', async () => {
  // Nunca some da tabela, nem depois de acordado.
  const { agente } = montar({ sondas: [[100], [100], [100]] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.ok, false);
  assert.equal(r.prova.confirmado, false);
  assert.equal(r.codigo_erro, 'FALHA_NA_EXECUCAO');
  // A sequência — medida, e por isso afirmável.
  assert.match(r.texto, /Trouxe a janela para a frente/);
  assert.match(r.texto, /continuou aberta/);
  assert.match(r.prova.evidencia, /janela\(s\) acordada\(s\)/);
  // A hipótese — marcada como tal, nunca como o que aconteceu.
  assert.match(r.texto, /pode ser/i);
  assert.doesNotMatch(
    r.texto,
    /normalmente (acontece|espera)/i,
    'voltou a afirmar uma causa que não mediu',
  );
  assert.match(r.texto, /Forçar eu não forço/);
});

test('FEC-04. sem janela para acordar: não promete o que não tentou', async () => {
  // `acordar` devolve 0: há processo, mas nenhum com janela.
  const { agente } = montar({ sondas: [[100], [100]], acordar: async () => 0 });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.ok, false);
  assert.match(r.texto, /não tem janela aberta/);
  assert.ok(!/está aí na sua tela/.test(r.texto), 'não pode mandar olhar uma janela que não existe');
});

/**
 * A ASSERÇÃO SOBRE `acordados` AQUI NÃO É ZELO — é o que separa este caso de um
 * teste que passa por acidente. Sem ela, o caso continuava VERDE com a escalada
 * inteira desligada, porque "não tentei" e "tentei e não deu" produzem a mesma
 * frase. Descoberto quebrando a implementação de propósito: 6 dos 9 casos
 * continuavam passando, e este era um deles.
 */
test('FEC-05. não dá para acordar (outra plataforma, PowerShell fora): diz isso', async () => {
  const { agente, acordados } = montar({ sondas: [[100], [100]], acordar: async () => null });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.ok, false);
  assert.deepEqual(acordados, ['notepad.exe'], 'a tentativa TEM de ter acontecido');
  assert.match(r.texto, /não consegui nem trazer a janela/i);
  assert.ok(
    !/janela\(s\) acordada\(s\)/.test(r.prova.evidencia),
    'não pode contar janela acordada quando não houve tentativa possível',
  );
});

/**
 * A TRAVA QUE IMPORTA MAIS QUE A CAPACIDADE.
 *
 * O caminho fácil para "fazer a IARA conseguir fechar" é `taskkill /F`, e ele
 * custa o trabalho não salvo de quem estiver na frente do computador. Este caso
 * existe para que essa tentação seja um teste vermelho, em qualquer um dos
 * cenários — inclusive o de resistência total, que é justamente onde a pressão
 * para forçar aparece.
 */
test('FEC-06. NENHUM cenário de fechamento emite /F, /T ou taskkill forçado', async () => {
  const cenarios: Array<Array<number[] | null>> = [
    [[100], []],
    [[100, 101], [100, 101], []],
    [[100], [100], [100]],
    [[100], null],
  ];
  for (const sondas of cenarios) {
    const { agente, comandos } = montar({ sondas });
    await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');
    for (const c of comandos) {
      assert.ok(!c.includes('/F'), `comando com /F: ${c.join(' ')}`);
      assert.ok(!c.includes('/f'), `comando com /f: ${c.join(' ')}`);
      assert.ok(
        !c.some((a) => /Stop-Process|taskkill.*\/F/i.test(a)),
        `comando de morte forçada: ${c.join(' ')}`,
      );
    }
  }
});

test('FEC-07. app já fechado continua sendo caminho de custo zero', async () => {
  const { agente, comandos, acordados } = montar({ sondas: [[]] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.ok, true);
  assert.match(r.texto, /já não estava aberto/);
  assert.deepEqual(comandos, [], 'não se manda taskkill no que não está aberto');
  assert.deepEqual(acordados, []);
});

test('FEC-08. o que não é fechável continua intocado, e não ganha degrau novo', async () => {
  const { agente, comandos, acordados } = montar({ sondas: [[100], [100]] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o explorador de arquivos');

  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'PERMISSAO_NEGADA');
  assert.deepEqual(comandos, []);
  assert.deepEqual(acordados, [], 'shell do Windows não pode nem ser acordado para fechar');
});

test('FEC-09. sem sonda não se inventa vitória — e não se acorda no escuro', async () => {
  const { agente, acordados } = montar({ sondas: [null] });

  const r = await agente.fecharAplicativo(USUARIO, 'fechar o bloco de notas');

  assert.equal(r.prova.confirmado, false);
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
  assert.deepEqual(acordados, [], 'sem saber se há processo, não se rouba o foco de ninguém');
});
