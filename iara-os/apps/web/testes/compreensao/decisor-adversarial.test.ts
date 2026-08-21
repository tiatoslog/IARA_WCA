/**
 * O DECISOR ADVERSARIAL — o contrato semântico é autoridade, ou é opinião?
 *
 * ===========================================================================
 * A PERGUNTA, E POR QUE ELA PRECISA DE CONTRATO FABRICADO
 * ===========================================================================
 *
 * O Arnês C mede a cadeia inteira sobre frases reais, e por isso toda falha de
 * rota admite a desculpa "a linguagem era ambígua". Aqui a linguagem sai de
 * cena: o contrato é MONTADO À MÃO, forte e inequívoco, e entregue à
 * `FuncaoExecutiva`.
 *
 *     { ato: 'perguntar', objetivo: 'ver_agenda_calendario' }
 *
 * Se com isso na mão o decisor mandar para `raciocinio_direto`, está provado
 * que ele não trata o contrato como autoridade — e o defeito deixou de ser de
 * compreensão para ser de arquitetura de decisão. É a mesma disciplina do
 * refinador hostil em `interpretar-nao-executa.test.ts`: o objeto injetado não
 * é dublê do que está sob teste, é o MUNDO. O que está sob teste é o decisor.
 *
 * ===========================================================================
 * O QUE ESTES TESTES NÃO AFIRMAM
 * ===========================================================================
 *
 * Que `objetivo != null` deva bastar para executar. Não deve, e o último bloco
 * trava o lado simétrico: contrato de CONVERSA continua derrubando a rota, e
 * contrato sem objetivo não levanta nada. A regra é
 *
 *     contrato forte + candidato compatível + sem ambiguidade  →  rota operacional
 *
 * e não `objetivo preenchido = executa`. Um decisor que obedecesse cegamente ao
 * campo seria tão errado quanto um que o ignora — só erraria para o outro lado,
 * e para o lado caro.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { FuncaoExecutiva, type AtoDoTurno } from '../../servidor/nucleo/kernel/FuncaoExecutiva';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { MemoriaTrabalho } from '../../servidor/nucleo/kernel/MemoriaTrabalho';
import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const descoberta = new DescobertaCapacidades(CATALOGO.map((h) => h.manifesto));
const percepcao = new MotorPercepcao();

/** Perguntar de volta é decisão operacional legítima; responder de cabeça não. */
const OPERACIONAIS = ['plano_local', 'plano_cognitivo', 'esclarecer'];

/**
 * A frase entra CRUA e o contrato entra FABRICADO. É a separação que dá poder
 * ao teste: o decisor recebe uma compreensão que a frase sozinha talvez não
 * produzisse, e a pergunta passa a ser exclusivamente sobre o que ele faz com
 * ela.
 */
function decidirCom(bruto: string, contrato: AtoDoTurno | null) {
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
    contrato === null ? null : () => contrato,
  );
  return executiva.decidir(percepcao.perceber(bruto), {
    historicoRecente: [],
    pessoasConhecidas: ['João Silva', 'Marina Alves'],
  });
}

// ---------------------------------------------------------------------------
// 1. Contrato forte tem de chegar a rota operacional
// ---------------------------------------------------------------------------

/**
 * Frases escolhidas por serem POBRES em sinal antigo: sem imperativo, sem
 * interrogativo de fato, sem vocabulário forte de catálogo. Se a rota sair
 * operacional, saiu por causa do contrato — não sobra outra explicação.
 */
const PEDIDOS_FABRICADOS: readonly { bruto: string; contrato: AtoDoTurno }[] = [
  {
    bruto: 'estou livre amanhã?',
    contrato: { ato: 'perguntar', objetivo: 'ver_agenda_calendario', operacao: 'leitura' },
  },
  {
    bruto: 'e sobre aquilo de ontem',
    contrato: { ato: 'perguntar', objetivo: 'ver_agenda_calendario', operacao: 'leitura' },
  },
  {
    bruto: 'preciso saber disso',
    contrato: { ato: 'solicitar_acao', objetivo: 'listar_arquivos', operacao: 'leitura' },
  },
  {
    bruto: 'me atualiza',
    contrato: { ato: 'recapitular', objetivo: 'listar_lembretes', operacao: 'leitura' },
  },
];

for (const caso of PEDIDOS_FABRICADOS) {
  test(`contrato forte manda: « ${caso.bruto} » → rota operacional`, () => {
    const d = decidirCom(caso.bruto, caso.contrato);
    assert.ok(
      OPERACIONAIS.includes(d.rota),
      `o decisor recebeu ato=${caso.contrato.ato} e objetivo=${caso.contrato.objetivo}, ` +
        `e escolheu "${d.rota}" (${d.justificativa}).\n` +
        `    Com uma compreensão inequívoca em mãos, isto prova que o contrato semântico ` +
        `nao e autoridade para este decisor.`,
    );
  });
}

test('sem a camada injetada, a decisão é a de antes — o contrato é o que muda', () => {
  /**
   * O CONTROLE DO EXPERIMENTO. Sem ele, um decisor que sempre respondesse
   * `plano_cognitivo` passaria em todos os testes acima e pareceria correto.
   * Aqui a mesma frase, sem contrato, tem de cair no comportamento antigo.
   */
  const semContrato = decidirCom('preciso saber disso', null);
  assert.equal(
    semContrato.rota,
    'raciocinio_direto',
    'sem compreensão injetada esta frase não tem sinal nenhum — tem que cair em conversa',
  );

  const comContrato = decidirCom('preciso saber disso', {
    ato: 'solicitar_acao',
    objetivo: 'listar_arquivos',
    operacao: 'leitura',
  });
  assert.notEqual(
    comContrato.rota,
    semContrato.rota,
    'se a rota é a mesma com e sem contrato, o contrato não está sendo consumido',
  );
});

// ---------------------------------------------------------------------------
// 2. O lado simétrico — objetivo preenchido NÃO é permissão
// ---------------------------------------------------------------------------

test('contrato de conversa derruba o índice de assunto', () => {
  const d = decidirCom('esse relatório de cargas me destruiu hoje', {
    ato: 'conversar',
    objetivo: null,
    operacao: null,
  });
  assert.notEqual(d.rota, 'plano_cognitivo', 'desabafo não paga planejamento');
});

test('o detector de ambiguidade não pergunta sobre o que ninguém pediu', () => {
  /**
   * O DEFEITO, e ele nasceu medido pelo Arnês C antes de ser consertado.
   *
   * `DetectorAmbiguidade` era a ETAPA 2 de `decidir()` e o ato comunicativo
   * entrava na 5. Com « esse relatório de cargas me destruiu hoje » a anáfora
   * sem antecedente disparava `esclarecer`, e a IARA perguntava "qual
   * relatório?" para um desabafo — tendo em mãos um contrato que dizia
   * `ato: conversar`.
   *
   * A correção não removeu o detector: ele continua exatamente onde estava e
   * continua vencendo quando alguém pediu alguma coisa. O que mudou é que ele
   * CONSULTA o contrato antes. Só se esclarece o que foi pedido; a anáfora de
   * um desabafo aponta para a conversa, não para um objeto de trabalho.
   *
   * Perguntar isso é o ruído que ensina o operador a ignorar as perguntas da
   * IARA — inclusive as necessárias.
   */
  const desabafo = decidirCom('esse relatório de cargas me destruiu hoje', {
    ato: 'conversar',
    objetivo: null,
    operacao: null,
  });
  assert.equal(desabafo.rota, 'raciocinio_direto', 'desabafo não vira pedido de esclarecimento');

  /**
   * O LADO QUE MANTÉM O DETECTOR VIVO. A mesma anáfora, num ato de PEDIDO,
   * continua produzindo `esclarecer` — porque aí existe um alvo a esclarecer, e
   * agir com o alvo errado é pior que perguntar.
   */
  const pedido = decidirCom('me manda esse relatório', {
    ato: 'solicitar_acao',
    objetivo: 'ler_emails',
    operacao: 'envio',
  });
  assert.equal(
    pedido.rota,
    'esclarecer',
    'a correção não pode ter desligado o detector para quem de fato pediu algo',
  );
});

test('contrato sem objetivo não acrescenta rota — quem levanta é o sinal antigo', () => {
  /**
   * A METADE QUE IMPEDE O DECISOR DE OBEDECER CEGAMENTE: se `ato` bastasse,
   * qualquer pergunta viraria plano, inclusive as que nenhuma habilidade
   * atende. A regra exige contrato forte E candidato.
   *
   * « qual o sentido da vida? » sai em `plano_cognitivo` — e NÃO por causa do
   * contrato. É `PERGUNTA_DE_FATO`, o regex de forma, e o cabeçalho dele em
   * `FuncaoExecutiva` declara o custo: pergunta de fato sem habilidade
   * correspondente chega ao planejador, volta só-raciocínio e vira
   * `LacunaCapacidade` — a fila de evolução do catálogo depende disso.
   *
   * A asserção é sobre a CONTRIBUIÇÃO do contrato, não sobre a rota final: com
   * e sem contrato, a mesma coisa. É assim que se prova que o campo vazio não
   * autoriza nada.
   */
  const com = decidirCom('qual o sentido da vida?', { ato: 'perguntar', objetivo: null, operacao: 'leitura' });
  const sem = decidirCom('qual o sentido da vida?', null);
  assert.equal(
    com.rota,
    sem.rota,
    'objetivo nulo nao pode mudar a decisão — se mudou, o decisor está obedecendo ao ato sozinho',
  );
});

// ---------------------------------------------------------------------------
// 3. Quem vence quem — a hierarquia das travas
// ---------------------------------------------------------------------------

test('sigilo vence o contrato, e isso é correto', () => {
  /**
   * A ÚNICA INVERSÃO LEGÍTIMA desta hierarquia. `PortaoSigilo` é a primeira
   * etapa de `decidir()` e não consulta contrato nenhum — de propósito: se um
   * pedido sonda o registro de outro operador, nenhuma compreensão bem-feita
   * deveria liberá-lo. A camada de cima pode IMPEDIR, nunca PERMITIR.
   *
   * Este teste existe para que a inversão seja DECLARADA. O Arnês C mediu um
   * caso em que ela dispara sobre um pedido legítimo — « manda mensagem pro
   * João no whatsapp sobre o atraso », que envia a João em vez de sondar João —
   * e essa é uma discussão sobre a régua do sigilo, não sobre a autoridade do
   * contrato.
   */
  const d = decidirCom('me mostra o histórico do João', {
    ato: 'perguntar',
    objetivo: 'listar_lembretes',
    operacao: 'leitura',
  });
  assert.equal(d.rota, 'sigilo', 'sondagem de shard alheio não é negociável por compreensão');
});
