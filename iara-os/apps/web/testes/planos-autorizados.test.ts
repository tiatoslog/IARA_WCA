/**
 * O LAÇO FECHADO — propor, autorizar, executar, medir de novo, decidir.
 *
 * A Fase 1 terminava a investigação perguntando "posso executar o plano A?" e
 * não tinha onde receber a resposta. Estes testes protegem o que fecha esse
 * ciclo, e em especial as três coisas que é fácil quebrar sem perceber:
 *
 *  1. autorizar um plano NÃO é um atalho de execução — os passos continuam
 *     saindo como passos do Kernel, sujeitos ao porteiro e ao jornal;
 *  2. um passo que depende do operador (ou de um reinício) NÃO roda agora;
 *  3. a IARA para de propor depois de tentar o bastante sem resolver.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PlanosPropostos,
  planosPropostos,
  TETO_TENTATIVAS,
  VALIDADE_MS,
} from '../servidor/nucleo/kernel/PlanosPropostos';
import {
  ehExecutavelAgora,
  passosExecutaveis,
  type PlanoDeAcao,
} from '../servidor/nucleo/kernel/Investigacao';
import {
  diagnosticarLentidao,
  investigarLentidao,
  planosParaLentidao,
  redigirInvestigacao,
} from '../servidor/nucleo/kernel/MotorAnalise';
import type { Medicao } from '../servidor/nucleo/SondasDesempenho';
import { aplicativoFechavelDoProcesso } from '../servidor/nucleo/AgenteLocal';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador, extrairLetraDoPlano } from '../servidor/nucleo/kernel/Planejador';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

// ---------------------------------------------------------------------------

function medicao(parcial: Partial<Medicao> = {}): Medicao {
  return {
    instante: '2026-08-13T12:00:00.000Z',
    cpu_pct: 20,
    memoria_pct: 50,
    memoria_total_gb: 16,
    memoria_livre_gb: 8,
    disco_livre_pct: 40,
    disco_livre_gb: 200,
    ligado_ha_h: 3,
    nucleos: 8,
    processos: [],
    lacunas: [],
    ...parcial,
  };
}

/** Máquina com o Chrome dominando a CPU: o caso que gera plano executável. */
const CHROME_PESADO = medicao({
  cpu_pct: 95,
  processos: [{ nome: 'chrome', pid: 10, cpu_pct: 70, memoria_mb: 900 }],
});

/** Máquina com memória alta e tempo ligado: o caso que gera o plano de reinício. */
const MEMORIA_ALTA = medicao({ memoria_pct: 95, ligado_ha_h: 400 });

const planosDe = (m: Medicao) =>
  planosParaLentidao(m, diagnosticarLentidao(m), aplicativoFechavelDoProcesso);

// ---------------------------------------------------------------------------
// 1. Quando cada passo pode rodar
// ---------------------------------------------------------------------------

test('fechar aplicativo e medir de novo rodam no mesmo turno', () => {
  const plano = planosDe(CHROME_PESADO)[0];
  const agora = passosExecutaveis(plano);
  assert.deepEqual(
    agora.map((s) => s.habilidade),
    ['fechar_aplicativo', 'investigar_lentidao'],
  );
  assert.equal(ehExecutavelAgora(plano), true);
});

test('o passo de medir NÃO roda junto com o de reiniciar', () => {
  /**
   * O caso que deu origem ao campo `quando`: medir logo depois de PEDIR o
   * reinício mediria a máquina que ainda não reiniciou, e produziria um "não
   * resolveu" sobre uma ação que nem começou.
   */
  const reiniciar = planosDe(MEMORIA_ALTA).find((p) => /reiniciar/.test(p.rotulo));
  assert.ok(reiniciar);
  assert.deepEqual(
    passosExecutaveis(reiniciar).map((s) => s.habilidade),
    ['acionar_energia'],
  );
});

test('plano que depende do operador não executa nada agora', () => {
  const m = medicao({ cpu_pct: 95, processos: [{ nome: 'algum_erp', pid: 1, cpu_pct: 70, memoria_mb: 900 }] });
  const plano = planosDe(m)[0];
  assert.equal(ehExecutavelAgora(plano), false);
  assert.deepEqual(passosExecutaveis(plano), []);
});

test('a parada é no primeiro passo adiado, não um filtro que salta o meio', () => {
  /**
   * Um plano é uma SEQUÊNCIA. Filtrar por `quando === 'agora'` deixaria passar
   * um passo final que vem depois de um adiado — executando o fim do plano antes
   * do meio, que é executar outro plano.
   */
  const forjado: PlanoDeAcao = {
    id: 'X',
    rotulo: 'forjado',
    objetivo: 'o',
    risco: 'baixo',
    esforco: 'baixo',
    beneficio: 'baixo',
    resultado_esperado: null,
    rollback: null,
    passos: [
      { ordem: 1, descricao: 'primeiro', habilidade: 'a', parametros: {}, reversivel: true, quando: 'agora' },
      { ordem: 2, descricao: 'espera', habilidade: null, parametros: {}, reversivel: true, quando: 'quando_o_operador_voltar' },
      { ordem: 3, descricao: 'nunca agora', habilidade: 'c', parametros: {}, reversivel: true, quando: 'agora' },
    ],
  };
  assert.deepEqual(
    passosExecutaveis(forjado).map((s) => s.habilidade),
    ['a'],
  );
});

// ---------------------------------------------------------------------------
// 2. O registro de propostas
// ---------------------------------------------------------------------------

function registro(relogio = { t: 1_000_000 }) {
  return { loja: new PlanosPropostos(() => relogio.t), relogio };
}

function propor(loja: PlanosPropostos, m = CHROME_PESADO) {
  const inv = investigarLentidao(m, null, aplicativoFechavelDoProcesso);
  loja.propor({
    id_usuario: 'ana',
    sessao: 's1',
    planos: inv.planos,
    recomendado: inv.recomendacao?.escolhido.id ?? null,
    medicao: m,
  });
  return inv;
}

test('sem letra, autorizar escolhe o plano RECOMENDADO', () => {
  const { loja } = registro();
  const inv = propor(loja);
  const escolhido = loja.escolher('ana', 's1');
  assert.equal(escolhido?.id, inv.recomendacao?.escolhido.id);
});

test('a proposta vence, e o motivo é dizível', () => {
  const { loja, relogio } = registro();
  propor(loja);
  assert.ok(loja.aberta('ana', 's1'));

  relogio.t += VALIDADE_MS + 1;
  assert.equal(loja.aberta('ana', 's1'), null);
  assert.equal(loja.porQueNaoHa('ana', 's1'), 'vencida');
  assert.equal(loja.escolher('ana', 's1'), null);
  assert.equal(loja.autorizar('ana', 's1', 'A'), false);
});

test('proposta de outra conversa não é autorizável aqui, e o motivo é dizível', () => {
  const { loja } = registro();
  propor(loja);
  assert.equal(loja.aberta('ana', 's2'), null);
  assert.equal(loja.porQueNaoHa('ana', 's2'), 'outra_conversa');
  assert.equal(loja.autorizar('ana', 's2', 'A'), false);
});

test('sem proposta nenhuma o motivo também é dizível', () => {
  const { loja } = registro();
  assert.equal(loja.porQueNaoHa('ninguem', 's1'), 'nenhuma');
});

test('autorizar plano inexistente é recusado', () => {
  const { loja } = registro();
  propor(loja);
  assert.equal(loja.autorizar('ana', 's1', 'Z'), false);
  assert.equal(loja.planoAutorizado('ana'), null);
});

test('a referência prefere a expectativa do plano AUTORIZADO — o débito da Fase 1', () => {
  const { loja } = registro();
  const inv = propor(loja, MEMORIA_ALTA);

  // Sem autorização: cai na expectativa do recomendado, declaradamente palpite.
  const semAutorizar = loja.referencia('ana');
  assert.equal(semAutorizar?.plano_tentado, null);
  assert.equal(
    semAutorizar?.esperado?.metrica,
    inv.recomendacao?.escolhido.resultado_esperado?.metrica,
  );

  // Com outro plano autorizado, a expectativa passa a ser a DELE.
  const outro = inv.planos.find((p) => p.id !== inv.recomendacao?.escolhido.id && p.resultado_esperado);
  assert.ok(outro, 'o cenário precisa de um segundo plano com expectativa');
  assert.equal(loja.autorizar('ana', 's1', outro.id), true);

  const comAutorizacao = loja.referencia('ana');
  assert.equal(comAutorizacao?.plano_tentado, outro.id);
  assert.equal(comAutorizacao?.rotulo_tentado, outro.rotulo);
  assert.deepEqual(comAutorizacao?.esperado, outro.resultado_esperado);
});

test('a proposta vencida ainda serve de referência para comparar', () => {
  /**
   * Autorizar um plano velho é inseguro; comparar com uma medição velha é útil.
   * São perguntas diferentes, e o registro responde as duas.
   */
  const { loja, relogio } = registro();
  propor(loja);
  relogio.t += VALIDADE_MS + 1;
  assert.equal(loja.aberta('ana', 's1'), null);
  assert.ok(loja.referencia('ana'));
});

test('a contagem de tentativas sobrevive à proposta nova e respeita o teto', () => {
  const { loja } = registro();
  for (let i = 0; i < TETO_TENTATIVAS; i += 1) {
    assert.equal(loja.esgotou('ana'), false, `esgotou cedo demais na tentativa ${i}`);
    const inv = investigarLentidao(CHROME_PESADO, null, aplicativoFechavelDoProcesso);
    loja.propor({
      id_usuario: 'ana',
      sessao: 's1',
      planos: inv.planos,
      recomendado: inv.recomendacao?.escolhido.id ?? null,
      medicao: CHROME_PESADO,
      tentativa_falhou: true,
    });
  }
  assert.equal(loja.esgotou('ana'), true);
});

test('esquecer zera a linha de investigação', () => {
  const { loja } = registro();
  propor(loja);
  loja.esquecer('ana');
  assert.equal(loja.referencia('ana'), null);
  assert.equal(loja.esgotou('ana'), false);
});

// ---------------------------------------------------------------------------
// 3. O veredito nomeia o plano tentado, e o laço tem fim
// ---------------------------------------------------------------------------

test('o relatório diz QUAL plano não resolveu, não apenas que não melhorou', () => {
  const texto = redigirInvestigacao(
    investigarLentidao(
      medicao({ cpu_pct: 95 }),
      {
        medicao: medicao({ cpu_pct: 95 }),
        esperado: { metrica: 'cpu_total', comparador: '<', valor: 70, unidade: '%' },
        plano_tentado: 'A',
        rotulo_tentado: 'encerrar o Google Chrome',
      },
      aplicativoFechavelDoProcesso,
    ),
  );
  assert.match(texto, /O plano A \(encerrar o Google Chrome\)/);
  assert.match(texto, /não resolveu — o número não mudou/);
  /**
   * E NÃO afirma que a ação aconteceu. Este plano é de instrução: quem age é o
   * operador, e a medição prova o número, nunca a execução. A frase anterior
   * dizia "a ação rodou" e foi pega numa prova contra a máquina real, sem que
   * ninguém tivesse feito nada.
   */
  assert.doesNotMatch(texto, /a ação rodou/);
});

test('"melhorou mas não chegou" não é dito como fracasso nem como sucesso', () => {
  const texto = redigirInvestigacao(
    investigarLentidao(
      medicao({ cpu_pct: 88 }),
      {
        medicao: medicao({ cpu_pct: 95 }),
        esperado: { metrica: 'cpu_total', comparador: '<', valor: 70, unidade: '%' },
        plano_tentado: 'A',
        rotulo_tentado: 'encerrar o Google Chrome',
      },
      aplicativoFechavelDoProcesso,
    ),
  );
  assert.match(texto, /melhorou, mas ainda não está dentro do que eu esperava/);
  assert.match(texto, /foi de 95 para 88%/);
});

test('depois do teto de tentativas a IARA para de propor e devolve a palavra', () => {
  const inv = investigarLentidao(
    CHROME_PESADO,
    {
      medicao: medicao({ cpu_pct: 95 }),
      esperado: { metrica: 'cpu_total', comparador: '<', valor: 70, unidade: '%' },
      plano_tentado: 'A',
      rotulo_tentado: 'encerrar o Google Chrome',
      tentativas_sem_sucesso: TETO_TENTATIVAS,
    },
    aplicativoFechavelDoProcesso,
  );
  assert.equal(inv.esgotado, true);
  assert.equal(inv.recomendacao, null, 'esgotada a linha, não se recomenda mais nada');

  const texto = redigirInvestigacao(inv);
  assert.match(texto, new RegExp(`Já tentamos ${TETO_TENTATIVAS} caminhos`));
  assert.doesNotMatch(texto, /Posso executar/);
  assert.match(texto, /Me conte o que exatamente fica lento/);
});

test('abaixo do teto, a IARA continua propondo', () => {
  const inv = investigarLentidao(
    CHROME_PESADO,
    {
      medicao: medicao({ cpu_pct: 95 }),
      esperado: { metrica: 'cpu_total', comparador: '<', valor: 70, unidade: '%' },
      tentativas_sem_sucesso: TETO_TENTATIVAS - 1,
    },
    aplicativoFechavelDoProcesso,
  );
  assert.equal(inv.esgotado, false);
  assert.ok(inv.recomendacao);
});

// ---------------------------------------------------------------------------
// 4. Roteamento e tradução para plano do Kernel
// ---------------------------------------------------------------------------

const percepcao = new MotorPercepcao();
const planejador = new Planejador();

test('a letra do plano é extraída da frase, e só de A a E', () => {
  assert.equal(extrairLetraDoPlano('executa o plano B'), 'B');
  assert.equal(extrairLetraDoPlano('pode executar o Plano c'), 'C');
  assert.equal(extrairLetraDoPlano('pode executar'), undefined);
  assert.equal(extrairLetraDoPlano('execute o plano Z'), undefined);
});

test('"execute o plano A" vira autorização, não confirmação de energia', () => {
  const p = percepcao.perceber('pode executar o plano A');
  assert.ok(p.ancoras.includes('executar_plano'));
  // `executar_plano` vem ANTES de `confirmacao` na lista: é ela que planeja.
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'assumir_plano');
});

test('"confirmo" continua resolvendo a pendência de energia, não um plano', () => {
  const p = percepcao.perceber('confirmo');
  assert.equal(p.ancoras.includes('executar_plano'), false);
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'resolver_confirmacao');
});

test('"faça um plano para organizar meu dia" NÃO é autorização de plano', () => {
  for (const frase of [
    'faça um plano para organizar meu dia',
    'preciso de um plano de ação para a frota',
    'qual é o plano da empresa para o ano que vem',
  ]) {
    assert.equal(
      percepcao.perceber(frase).ancoras.includes('executar_plano'),
      false,
      `falso positivo em: ${frase}`,
    );
  }
});

test('"não execute o plano B" não autoriza nada', () => {
  assert.equal(percepcao.perceber('não execute o plano B').ancoras.includes('executar_plano'), false);
});

test('"como eu executo o plano?" pergunta sobre a autorização; não a concede', () => {
  assert.equal(
    percepcao.perceber('como eu executo o plano?').ancoras.includes('executar_plano'),
    false,
  );
});

test('sem contexto de quem fala, o plano é só o passo honesto de assumir', () => {
  /**
   * O `Planejador` não pode adivinhar qual proposta está aberta. Sem contexto,
   * ele emite `assumir_plano` sozinho — que responde "não tenho plano aberto" em
   * vez de executar no escuro.
   */
  const plano = planejador.planejar(percepcao.perceber('executar o plano A'));
  assert.equal(plano.passos.length, 1);
  assert.equal(plano.passos[0].habilidade, 'assumir_plano');
  assert.equal(plano.origem, 'deterministico');
});

test('o plano autorizado sai como passos DO KERNEL, não como execução por dentro', () => {
  /**
   * A invariante da Fase 2. Autorizar não cria caminho de execução novo: cada
   * passo do plano vira um passo do Kernel, e portanto atravessa o porteiro, o
   * jornal, o esquema e o verificador — um a um.
   */
  const inv = investigarLentidao(CHROME_PESADO, null, aplicativoFechavelDoProcesso);
  planosPropostos.propor({
    id_usuario: 'bruno',
    sessao: 'sx',
    planos: inv.planos,
    recomendado: inv.recomendacao?.escolhido.id ?? null,
    medicao: CHROME_PESADO,
  });

  const plano = planejador.planejar(percepcao.perceber('pode executar o plano A'), {
    id_usuario: 'bruno',
    sessao: 'sx',
  });

  assert.deepEqual(
    plano.passos.map((s) => s.habilidade),
    ['assumir_plano', 'fechar_aplicativo', 'investigar_lentidao'],
  );
  assert.equal(plano.origem, 'deterministico');

  const ids = new Set(CATALOGO.map((h) => h.manifesto.id));
  for (const s of plano.passos) {
    assert.ok(s.habilidade && ids.has(s.habilidade), `fora do catálogo: ${s.habilidade}`);
  }
  planosPropostos.esquecer('bruno');
});

test('a habilidade que assume o plano não age no mundo', () => {
  const h = CATALOGO.find((x) => x.manifesto.id === 'assumir_plano');
  assert.ok(h);
  assert.equal(h.manifesto.risco, 'baixo');
  assert.deepEqual(h.manifesto.permissoes, []);
  // Ela altera o registro de propostas: declarar `leitura` seria mentira, e
  // tiraria a autorização do jornal.
  assert.equal(h.manifesto.idempotencia, 'escrita_idempotente');
});
