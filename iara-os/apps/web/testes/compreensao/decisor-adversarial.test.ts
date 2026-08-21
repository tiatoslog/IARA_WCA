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
    contrato: { ato: 'perguntar', objetivo: 'ver_agenda_calendario' },
  },
  {
    bruto: 'e sobre aquilo de ontem',
    contrato: { ato: 'perguntar', objetivo: 'ver_agenda_calendario' },
  },
  {
    bruto: 'preciso saber disso',
    contrato: { ato: 'solicitar_acao', objetivo: 'listar_arquivos' },
  },
  {
    bruto: 'me atualiza',
    contrato: { ato: 'recapitular', objetivo: 'listar_lembretes' },
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
  });
  assert.notEqual(d.rota, 'plano_cognitivo', 'desabafo não paga planejamento');
});

/**
 * DEFEITO MEDIDO, AINDA NÃO CORRIGIDO — e o teste existe para não deixá-lo
 * virar folclore.
 *
 * O `DetectorAmbiguidade` é a ETAPA 2 de `decidir()`; o ato comunicativo entra
 * na 5. Com « esse relatório de cargas me destruiu hoje » a anáfora sem
 * antecedente dispara `esclarecer` — e a IARA pergunta "qual relatório?" para
 * um desabafo, tendo em mãos um contrato que diz `ato: conversar`.
 *
 * É exatamente o padrão que o Arnês C existe para achar: uma etapa anterior ao
 * contrato decide sem consultá-lo. NÃO ESTOU CORRIGINDO AGORA — a ordem desta
 * fase é medir antes de mexer no decisor, e a correção certa (ambiguidade só
 * importa quando alguém pediu alguma coisa) mexe na ordem das etapas, que é
 * mudança grande demais para entrar sem a tabela na mão.
 *
 * QUANDO FOR CORRIGIDO, ESTE TESTE MUDA: a asserção passa a ser
 * `raciocinio_direto`, e a linha de baixo sai.
 */
test('CARACTERIZAÇÃO: ambiguidade (etapa 2) vence o ato de conversa (etapa 5)', () => {
  const d = decidirCom('esse relatório de cargas me destruiu hoje', {
    ato: 'conversar',
    objetivo: null,
  });
  assert.equal(
    d.rota,
    'esclarecer',
    'se isto mudou, o decisor foi corrigido — atualize a asserção para raciocinio_direto',
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
  const com = decidirCom('qual o sentido da vida?', { ato: 'perguntar', objetivo: null });
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
  });
  assert.equal(d.rota, 'sigilo', 'sondagem de shard alheio não é negociável por compreensão');
});
