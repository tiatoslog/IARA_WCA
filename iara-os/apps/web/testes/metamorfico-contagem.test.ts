/**
 * TESTES METAMÓRFICOS E DE MUTAÇÃO — o que tem de continuar verdadeiro quando
 * os dados mudam.
 *
 * POR QUE ISTO EXISTE AO LADO DO ORÁCULO. `matriz-capacidades-planilha.test.ts`
 * compara o motor com `ESPERADO` — números escritos à mão a partir da fonte.
 * Isso pega o erro de HOJE e não pega o de amanhã: um `ESPERADO` só sabe falar
 * do dataset que alguém já olhou, e quem escreve o número esperado pode
 * escrevê-lo derivando do próprio código que está testando.
 *
 * Relação metamórfica não tem esse problema. Ela não afirma quanto é a
 * contagem; afirma como a contagem PRECISA reagir a uma alteração conhecida:
 *
 *   · repetir uma linha do mesmo motorista       → COUNT_DISTINCT não muda
 *   · acrescentar um motorista novo              → COUNT_DISTINCT sobe 1
 *   · acrescentar uma carga sem motorista        → COUNT_DISTINCT não muda
 *   · reordenar as linhas                        → nada muda
 *   · duplicar a base inteira                    → COUNT_DISTINCT não muda
 *
 * As cinco valem para QUALQUER base, inclusive a de amanhã. Uma implementação
 * que confundisse "contar grupos" com "contar entidades" — o defeito DIST-002,
 * que respondeu 75 em produção — quebra a terceira sem precisar que ninguém
 * saiba de antemão que a resposta certa é 53.
 *
 * A SEGUNDA METADE É MUTAÇÃO INVERSA: provar que os testes CONSEGUEM falhar.
 * Um detector que nunca dispara e um teste que nunca reprova são a mesma
 * doença, e esta é a lição de `iara-duble-nao-pode-ser-o-porteiro`: "0
 * contornos encontrados" pode ser vácuo por construção. Aqui, cada relação é
 * exercitada também contra uma implementação DEFEITUOSA, e o teste exige que
 * ela reprove.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agregarCargas,
  contarCargas,
  contarDistintos,
  identidadeDeMotorista,
  suspeitasDeIdentidade,
  valorDaDimensao,
  type CargaCompleta,
  type DimensaoContavel,
} from '../servidor/nucleo/ClientePlanilhaOcis';
import { CARGAS_2026, ESPERADO } from './planilha/oraculo';

/** Uma carga sintética, a partir de um molde da base congelada. */
function comMotorista(molde: CargaCompleta, motorista: string, oci: string): CargaCompleta {
  return { ...molde, motorista, oci };
}

const BASE = CARGAS_2026;
const MOLDE = CARGAS_2026[0];
const distintosDe = (c: readonly CargaCompleta[]) => contarDistintos(c, 'motorista').distintos;

/**
 * A BASE SEM NENHUMA AUSÊNCIA — e ela existe por causa de uma falha deste
 * próprio arquivo, achada pelo teste de mutação na primeira execução.
 *
 * M3 nasceu escrita sobre `BASE`, que já tem uma carga sem motorista. Nessa
 * base, acrescentar OUTRA carga sem motorista não cria grupo novo: o grupo
 * "(sem motorista)" já existe. Resultado — a relação passava tanto com o motor
 * certo quanto com `contaGrupos`, o defeito DIST-002 que respondeu 75 em
 * produção. Era uma relação verdadeira e sem poder de discriminação: exatamente
 * o "0 contornos encontrados" que é vácuo por construção.
 *
 * Partindo de zero ausências, a primeira carga órfã cria o grupo — e aí a
 * diferença entre contar grupos e contar entidades aparece.
 */
const BASE_SEM_AUSENCIA = BASE.filter((c) => c.motorista.trim() !== '');

// ---------------------------------------------------------------------------
// 1. As relações metamórficas
// ---------------------------------------------------------------------------

test('M1. repetir uma linha do MESMO motorista não muda COUNT_DISTINCT', () => {
  const antes = distintosDe(BASE);
  const depois = distintosDe([...BASE, comMotorista(MOLDE, 'LINO', 'OCI-901')]);
  assert.equal(depois, antes, 'a mesma pessoa passou a contar duas vezes');
});

test('M2. acrescentar um motorista NOVO sobe COUNT_DISTINCT em exatamente 1', () => {
  const antes = distintosDe(BASE);
  const depois = distintosDe([...BASE, comMotorista(MOLDE, 'NOME QUE NAO EXISTE NA BASE', 'OCI-902')]);
  assert.equal(depois, antes + 1);
});

/**
 * M3 É O DEFEITO DO INCIDENTE, escrito como relação.
 *
 * `agregarCargas` devolve um grupo "(sem motorista)" porque uma LISTAGEM precisa
 * mostrar as cargas órfãs. Quem confunde grupo com entidade responde 75 onde
 * são 53 — e 75 é plausível o bastante para ninguém conferir.
 */
test('M3. acrescentar carga SEM motorista não muda COUNT_DISTINCT, e o declara', () => {
  const antes = contarDistintos(BASE_SEM_AUSENCIA, 'motorista');
  assert.equal(antes.ausentes, 0, 'a base de partida precisa começar sem ausência nenhuma');
  const depois = contarDistintos(
    [...BASE_SEM_AUSENCIA, comMotorista(MOLDE, '', 'OCI-903')],
    'motorista',
  );
  assert.equal(depois.distintos, antes.distintos, 'ausência virou pessoa');
  assert.equal(depois.ausentes, 1, 'a ausência sumiu em vez de ser declarada');
});

test('M3b. espaço em branco é ausência, não um nome', () => {
  const antes = contarDistintos(BASE, 'motorista');
  const depois = contarDistintos([...BASE, comMotorista(MOLDE, '   ', 'OCI-904')], 'motorista');
  assert.equal(depois.distintos, antes.distintos);
  assert.equal(depois.ausentes, antes.ausentes + 1);
});

test('M4. reordenar as linhas não muda nenhuma agregação', () => {
  const invertida = [...BASE].reverse();
  assert.equal(distintosDe(invertida), distintosDe(BASE));
  assert.equal(contarCargas(invertida).unicas, contarCargas(BASE).unicas);
  const soma = (c: readonly CargaCompleta[]) =>
    agregarCargas(c, 'nenhum').reduce((s, g) => s + g.valor_total, 0);
  assert.equal(soma(invertida), soma(BASE));
});

test('M5. duplicar a base inteira não muda COUNT_DISTINCT nem COUNT de OCIs únicas', () => {
  const dobrada = [...BASE, ...BASE];
  assert.equal(distintosDe(dobrada), distintosDe(BASE));
  assert.equal(contarCargas(dobrada).unicas, contarCargas(BASE).unicas);
  assert.equal(contarCargas(dobrada).repetidas, BASE.length, 'a repetição não foi declarada');
});

/**
 * M6. A MONOTONIA — a contagem distinta nunca passa do número de linhas com o
 * campo preenchido, e nunca é negativa. É a checagem que pega o erro de sinal e
 * o `grupos.length - 1` mal aplicado sem depender de nenhum valor esperado.
 */
test('M6. 0 ≤ COUNT_DISTINCT ≤ linhas com o campo preenchido', () => {
  for (const dimensao of ['motorista', 'origem', 'destino', 'status'] as const) {
    const d = contarDistintos(BASE, dimensao);
    const preenchidas = BASE.length - d.ausentes;
    assert.ok(d.distintos >= 0, `${dimensao}: contagem negativa`);
    assert.ok(d.distintos <= preenchidas, `${dimensao}: ${d.distintos} distintos em ${preenchidas} linhas`);
  }
});

/**
 * M7. A MESMA PESSOA EM VEÍCULOS DIFERENTES continua sendo uma pessoa — a
 * correção que a operadora pediu em 19/08/2026, escrita como relação. As cinco
 * grafias de `CARLOS ANEVTON` que existem na planilha real viram uma entidade.
 */
test('M7. anotação de veículo colada ao nome não cria motorista novo', () => {
  const antes = distintosDe(BASE);
  const grafias = [
    'LINO - GRO4761',
    'LINO - GRO4761 (SEM PARAR)',
    'LINO - QHI4C04 ( CONECT CAR )',
    'LINO - QHI4C04 (CONECTCAR)',
  ];
  const comVeiculos = [
    ...BASE,
    ...grafias.map((g, i) => comMotorista(MOLDE, g, `OCI-91${i}`)),
  ];
  assert.equal(distintosDe(comVeiculos), antes, 'a mesma pessoa virou várias por causa do veículo');
});

/**
 * M8. E O SIMÉTRICO, que é o que impede M7 de virar o defeito oposto. `LUIZ
 * ANTONIO` e `LUIZ PAULO` compartilham o primeiro nome e são pessoas
 * DIFERENTES. Sumir com uma pessoa real é pior que contá-la duas vezes.
 */
test('M8. primeiro nome em comum NÃO funde duas pessoas', () => {
  const antes = distintosDe(BASE);
  const depois = distintosDe([
    ...BASE,
    comMotorista(MOLDE, 'LUIZ ANTONIO', 'OCI-921'),
    comMotorista(MOLDE, 'LUIZ PAULO', 'OCI-922'),
  ]);
  assert.equal(depois, antes + 2, 'duas pessoas diferentes foram contadas como uma');
});

// ---------------------------------------------------------------------------
// 2. Mutação inversa — os testes conseguem falhar?
// ---------------------------------------------------------------------------

/**
 * OS DUBLÊS DEFEITUOSOS. Cada um é um defeito REAL que este repositório já
 * teve, ou que a auditoria apontou como possível:
 *
 *   contaGrupos      — o defeito DIST-002: contar grupos, e "(sem motorista)"
 *                      é um grupo. Foi ele que respondeu 75.
 *   contaGrafias     — sem `identidadeDeMotorista`: cada placa colada ao nome
 *                      vira uma pessoa. Foi o "76 motoristas" da operadora.
 *   contaLinhas      — sem `Set` nenhum: COUNT no lugar de COUNT DISTINCT.
 *   fundePorPrefixo  — o erro oposto: fundir por primeiro nome, que sumiria com
 *                      `LUIZ PAULO`.
 */
const MUTANTES: ReadonlyArray<{
  nome: string;
  contar: (c: readonly CargaCompleta[]) => number;
  /** As relações que este defeito TEM de quebrar. */
  quebra: readonly string[];
}> = [
  {
    nome: 'contaGrupos (DIST-002: ausência vira entidade)',
    contar: (c) => agregarCargas(c, 'motorista').length,
    quebra: ['M3'],
  },
  {
    nome: 'contaGrafias (sem identidade de motorista)',
    contar: (c) => new Set(c.filter((x) => x.motorista.trim() !== '').map((x) => x.motorista.trim())).size,
    quebra: ['M7'],
  },
  {
    nome: 'contaLinhas (COUNT no lugar de COUNT DISTINCT)',
    contar: (c) => c.filter((x) => x.motorista.trim() !== '').length,
    quebra: ['M1', 'M5'],
  },
  {
    nome: 'fundePorPrefixo (some com pessoa real)',
    contar: (c) =>
      new Set(
        c
          .filter((x) => x.motorista.trim() !== '')
          .map((x) => identidadeDeMotorista(x.motorista).split(' ')[0]),
      ).size,
    quebra: ['M8'],
  },
];

/** As relações, aplicadas a uma função de contagem qualquer. */
const RELACOES: Readonly<Record<string, (contar: (c: readonly CargaCompleta[]) => number) => void>> = {
  M1: (contar) =>
    assert.equal(contar([...BASE, comMotorista(MOLDE, 'LINO', 'OCI-901')]), contar(BASE)),
  M3: (contar) =>
    assert.equal(
      contar([...BASE_SEM_AUSENCIA, comMotorista(MOLDE, '', 'OCI-903')]),
      contar(BASE_SEM_AUSENCIA),
    ),
  M5: (contar) => assert.equal(contar([...BASE, ...BASE]), contar(BASE)),
  M7: (contar) =>
    assert.equal(
      contar([
        ...BASE,
        comMotorista(MOLDE, 'LINO - GRO4761', 'OCI-910'),
        comMotorista(MOLDE, 'LINO - GRO4761 (SEM PARAR)', 'OCI-911'),
      ]),
      contar(BASE),
    ),
  M8: (contar) =>
    assert.equal(
      contar([
        ...BASE,
        comMotorista(MOLDE, 'LUIZ ANTONIO', 'OCI-921'),
        comMotorista(MOLDE, 'LUIZ PAULO', 'OCI-922'),
      ]),
      contar(BASE) + 2,
    ),
};

test('as relações passam com a implementação de produção', () => {
  for (const [nome, checar] of Object.entries(RELACOES)) {
    assert.doesNotThrow(() => checar(distintosDe), `${nome} falhou com o motor real`);
  }
});

/**
 * O TESTE QUE PROVA QUE OS OUTROS TESTES SERVEM PARA ALGUMA COISA.
 *
 * Sem ele, uma relação escrita errada — comparando algo consigo mesmo, por
 * exemplo — passaria para sempre e daria a sensação de cobertura sem cobrir
 * nada. Aqui cada defeito conhecido é obrigado a ser PEGO pela relação
 * correspondente.
 */
test('cada implementação defeituosa é reprovada pela relação que a denuncia', () => {
  for (const m of MUTANTES) {
    for (const rel of m.quebra) {
      assert.throws(
        () => RELACOES[rel](m.contar),
        (erro: unknown) => erro instanceof assert.AssertionError,
        `a relação ${rel} NÃO pegou o defeito "${m.nome}" — ela não consegue falhar`,
      );
    }
  }
});

// ---------------------------------------------------------------------------
// 3. O detector de grafia — ACUSA, e nunca funde
// ---------------------------------------------------------------------------

/**
 * O DETECTOR AINDA NÃO APARECEU EM PRODUÇÃO porque hoje ele encontra zero casos
 * na planilha real — a regra da operadora entrou depois de o mapa declarado já
 * ter absorvido os casos conhecidos. Um detector que nunca foi visto disparar é
 * um detector que ninguém sabe se funciona; então os casos vêm sintéticos, com
 * as grafias que a operadora citou.
 *
 * O TESTE VALE PELAS DUAS METADES, e a segunda é a que protege: o detector
 * ACUSA e não decide. `COUNT_DISTINCT` não pode se mexer por causa de uma
 * suspeita — se mexesse, uma heurística estaria sumindo com uma pessoa real
 * sem ninguém confirmar.
 */
const SINTETICO: readonly CargaCompleta[] = [
  comMotorista(MOLDE, 'CARLOS ANEVTON', 'OCI-801'),
  comMotorista(MOLDE, 'CARLOS ANEVTON', 'OCI-802'),
  comMotorista(MOLDE, 'CARLOS ANEVTON - GRO4761', 'OCI-803'),
  comMotorista(MOLDE, 'CARLOS ANEVTON - GRO4761 (SEM PARAR)', 'OCI-804'),
  comMotorista(MOLDE, 'CARLOS ANEVTON DE SOUZA', 'OCI-805'),
  comMotorista(MOLDE, 'LUIZ ANTONIO', 'OCI-806'),
  comMotorista(MOLDE, 'LUIZ PAULO', 'OCI-807'),
];

test('D1. o sufixo estrutural une sozinho — placa e tag não são pessoas', () => {
  assert.equal(identidadeDeMotorista('CARLOS ANEVTON - GRO4761'), 'CARLOS ANEVTON');
  assert.equal(identidadeDeMotorista('CARLOS ANEVTON - GRO4761 (SEM PARAR)'), 'CARLOS ANEVTON');
  assert.equal(identidadeDeMotorista('CARLOS ANEVTON - QHI4C04 ( CONECT CAR )'), 'CARLOS ANEVTON');
});

test('D2. a grafia SEM marca estrutural vira suspeita, com evidência', () => {
  const suspeitas = suspeitasDeIdentidade(SINTETICO);
  const carlos = suspeitas.find((s) => s.provavel === 'CARLOS ANEVTON');
  assert.ok(carlos, 'o detector não acusou "CARLOS ANEVTON" contra "CARLOS ANEVTON DE SOUZA"');
  assert.deepEqual(carlos.variantes, ['CARLOS ANEVTON DE SOUZA']);
  /* A evidência é quantas cargas estão em jogo — é o que faz a operadora saber
     se vale olhar. 4 grafias de CARLOS (2 + 2 unidas pelo sufixo) + 1 variante. */
  assert.equal(carlos.cargas, 5);
});

test('D3. o detector NÃO funde: a contagem distinta continua a mesma com e sem suspeita', () => {
  const suspeitas = suspeitasDeIdentidade(SINTETICO);
  assert.ok(suspeitas.length > 0, 'sem suspeita, este teste não prova nada');
  /* CARLOS ANEVTON, CARLOS ANEVTON DE SOUZA, LUIZ ANTONIO, LUIZ PAULO = 4.
     Se o detector fundisse, seriam 3 — e uma pessoa teria sumido por palpite. */
  assert.equal(contarDistintos(SINTETICO, 'motorista').distintos, 4);
});

test('D4. primeiro nome em comum não vira suspeita — LUIZ ANTONIO ≠ LUIZ PAULO', () => {
  const suspeitas = suspeitasDeIdentidade(SINTETICO);
  for (const s of suspeitas) {
    const envolvidos = [s.provavel, ...s.variantes];
    assert.ok(
      !(envolvidos.includes('LUIZ ANTONIO') && envolvidos.includes('LUIZ PAULO')),
      'o detector acusou duas pessoas diferentes de serem a mesma',
    );
  }
});

test('D5. base sem ambiguidade não produz suspeita nenhuma', () => {
  assert.deepEqual(suspeitasDeIdentidade(BASE), [], 'suspeita inventada onde não há ambiguidade');
});

// ---------------------------------------------------------------------------
// 4. A ponte com o oráculo — as relações não substituem o valor
// ---------------------------------------------------------------------------

/**
 * As relações provam COMPORTAMENTO; o oráculo prova VALOR. Uma implementação
 * que devolvesse sempre zero passaria em M1, M3, M4, M5 e M7 sem esforço. Esta
 * âncora existe para que este arquivo nunca seja lido como cobertura completa.
 */
test('e o valor continua batendo com o oráculo independente', () => {
  assert.equal(distintosDe(BASE), ESPERADO.motoristas_distintos_2026);
  assert.equal(
    contarDistintos(BASE, 'motorista').ausentes,
    ESPERADO.cargas_sem_motorista_2026,
  );
});

// ---------------------------------------------------------------------------
// 5. REL-0002 e REL-0003 — achados pelo auditor em navegador real, 19/08/2026
// ---------------------------------------------------------------------------

/**
 * REL-0002. "QUANTAS ROTAS DIFERENTES TEMOS?" RESPONDEU ZERO.
 *
 * A resposta na tela, com procedência completa:
 *
 *   "todas as cargas de 2026: 0 rotas diferentes — 2687 cargas sem rota
 *    preenchido, fora dessa conta."
 *
 * `rota` é dimensão DERIVADA (`origem → destino`), não uma coluna. `c['rota']`
 * era `undefined`, toda linha caía em `dimensaoAusente`, e o total inteiro ia
 * para `ausentes`. Zero com fonte, com ano e com contagem de ausência — a
 * resposta mais confiável de se ler, e errada.
 *
 * A causa não era a rota: `contarDistintos` falava um vocabulário mais estreito
 * que `AgruparPor`, e a habilidade unia os dois com um cast que desligava
 * exatamente a checagem capaz de acusar isso na compilação.
 */
test('REL-0002. rota é dimensão derivada e conta como as outras', () => {
  const d = contarDistintos(BASE, 'rota');
  const grupos = agregarCargas(BASE, 'rota').length;
  assert.equal(d.distintos, grupos, 'a contagem distinta de rota divergiu do agrupamento');
  assert.ok(d.distintos > 0, 'voltou a zero — o defeito REL-0002 renasceu');
  assert.equal(d.ausentes, 0, 'linha com origem e destino preenchidos não é rota ausente');
});

test('REL-0002b. rota exige AS DUAS pontas — meia rota é rota desconhecida', () => {
  const semDestino = { ...MOLDE, origem: 'SP', destino: '' };
  const semOrigem = { ...MOLDE, origem: '', destino: 'MT' };
  assert.equal(valorDaDimensao(semDestino, 'rota'), null);
  assert.equal(valorDaDimensao(semOrigem, 'rota'), null);
  const d = contarDistintos([...BASE, semDestino, semOrigem], 'rota');
  assert.equal(d.distintos, contarDistintos(BASE, 'rota').distintos, 'meia rota criou entidade');
  assert.equal(d.ausentes, 2, 'a rota desconhecida sumiu em vez de ser declarada');
});

/**
 * REL-0003. `SEM_STATUS` ERA CONTADO COMO UM STATUS.
 *
 * Mais sutil que o REL-0002 e da mesma família do incidente: o campo EXISTE em
 * `CargaCompleta`, então nada explodia — a contagem só somava um a mais.
 * `SEM_STATUS` é o nome que o normalizador dá à célula vazia; é ausência com
 * outro rótulo, e ausência nunca é entidade.
 *
 * O portão compara com a contagem sobre o texto CRU da célula, que já tratava
 * vazio como ausência: as duas leituras da mesma coluna têm de concordar.
 */
test('REL-0003. SEM_STATUS é ausência, não um status', () => {
  const norm = contarDistintos(BASE, 'status_normalizado');
  const cru = contarDistintos(BASE, 'status');
  assert.equal(norm.ausentes, cru.ausentes, 'as duas leituras da coluna discordam sobre a ausência');
  assert.equal(norm.distintos, 3, 'FINALIZADO, PAGO e DESCONHECIDO — SEM_STATUS não é um deles');
  for (const c of BASE) {
    if (c.status_normalizado === 'SEM_STATUS') {
      assert.equal(valorDaDimensao(c, 'status_normalizado'), null);
    }
  }
});

/**
 * O PORTÃO QUE IMPEDE O PRÓXIMO REL-0002.
 *
 * Os dois defeitos nasceram do mesmo lugar: uma dimensão que `agregarCargas`
 * sabia tratar e `contarDistintos` não. Enquanto existirem duas funções lendo
 * dimensão, este teste cobra que elas cubram o MESMO conjunto — e não com um
 * `as`, que foi justamente o que escondeu o buraco por três meses.
 *
 * `nenhum` fica de fora dos dois lados: agrupar por nada é o universo inteiro,
 * contar "nenhum" distintos não é pergunta. O tipo `DimensaoContavel` já exclui.
 */
test('toda dimensão agrupável (exceto `nenhum`) é contável, e nenhuma devolve zero por acidente', () => {
  const dimensoes: readonly DimensaoContavel[] = [
    'motorista',
    'rota',
    'origem',
    'destino',
    'status',
    'status_normalizado',
    'uf_origem',
    'uf_destino',
  ];
  for (const d of dimensoes) {
    const r = contarDistintos(BASE, d);
    assert.ok(
      r.distintos + r.ausentes > 0,
      `${d}: nem distintos nem ausentes — a dimensão não foi lida de jeito nenhum`,
    );
    assert.equal(
      r.distintos + (r.ausentes > 0 ? 1 : 0) >= 1,
      true,
      `${d}: contagem vazia sobre base não vazia`,
    );
    /* O sinal exato do REL-0002: TUDO ausente sobre uma base que tem o dado. */
    assert.ok(
      !(r.distintos === 0 && r.ausentes === BASE.length),
      `${d}: toda linha virou ausente — é a assinatura do REL-0002`,
    );
  }
});
