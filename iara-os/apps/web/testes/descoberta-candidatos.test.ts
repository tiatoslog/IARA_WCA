/**
 * A DESCOBERTA PRESERVA O QUE ENCONTROU — candidatos, evidência e segundo lugar.
 *
 * O DEFEITO (auditoria arquitetural de 21/08/2026). `DescobertaCapacidades`
 * tinha um método público só, `pareceOperacional(): boolean`, e por trás dele
 * um índice de recuperação completo: frequência de documento, teto de stopword
 * calculado do catálogo real, índice separado de exemplos, acumulação por
 * habilidade. Tudo isso era computado e jogado fora no `return true`.
 *
 * O ponto exato onde a informação morria, no ramo da coincidência dupla:
 *
 *     const acertos = (acertosPorHabilidade.get(id) ?? 0) + 1;
 *     if (acertos >= 2) return true;          // sai antes de gravar
 *     acertosPorHabilidade.set(id, acertos);  // só grava quem perdeu
 *
 * O mapa que existia para acumular evidência nunca registrava o vencedor. Num
 * booleano isso não aparece — o `true` está certo. Numa arquitetura que precisa
 * comparar hipóteses, é o defeito inteiro: o sistema SABIA que havia casamento
 * e não sabia dizer com o quê.
 *
 * ESTES TESTES NÃO SÃO SOBRE ROTA. Nenhuma rota mudou nesta fase, de propósito
 * (`pareceOperacional` continua sendo `candidatos.length > 0`, pelas mesmas três
 * regras). O que eles travam é a única coisa que mudou: a descoberta virou
 * observável. Rota é o que a Fase 2 mede, com arnês próprio.
 *
 * POR QUE ELES DETECTAM O DEFEITO E NÃO SÓ A AUSÊNCIA DO MÉTODO. Um teste que
 * apenas chamasse `descobrirCandidatos` ficaria vermelho antes por não compilar
 * — o que não prova nada sobre comportamento. Cada teste aqui nomeia a
 * habilidade certa, a dimensão certa da evidência e o segundo colocado; a
 * mutação registrada no relatório da Fase 1 reintroduz o `return` prematuro
 * DENTRO da implementação nova e mostra qual deles fica vermelho.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DescobertaCapacidades,
  margemRelativa,
  type Candidato,
} from '../servidor/nucleo/kernel/DescobertaCapacidades';
import type { ManifestoHabilidade } from '../servidor/nucleo/kernel/Habilidade';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

const descoberta = new DescobertaCapacidades(CATALOGO.map((h) => h.manifesto));

const acharCandidato = (cs: readonly Candidato[], id: string): Candidato | undefined =>
  cs.find((c) => c.habilidade === id);

// ---------------------------------------------------------------------------
// 1. Identidade — a habilidade que casou tem NOME
// ---------------------------------------------------------------------------

test('token quase-exclusivo devolve a habilidade NOMEADA, não um sim', () => {
  /**
   * "whatsapp" está no manifesto de `enviar_whatsapp` e quase em mais nenhum.
   * O booleano antigo respondia `true` para esta frase — e era a resposta certa
   * para a pergunta errada. A pergunta que a camada seguinte precisa fazer é
   * "com o quê?", e essa não tinha resposta.
   */
  const c = descoberta.descobrirCandidatos('manda um whatsapp pro João avisando do atraso');

  const enviar = acharCandidato(c, 'enviar_whatsapp');
  assert.ok(enviar, 'a habilidade que o token quase-exclusivo alcançou tem que aparecer pelo id');
  assert.ok(
    enviar.motivos.includes('token_quase_exclusivo'),
    'e tem que dizer POR QUE apareceu — o motivo é a metade da evidência',
  );
  assert.ok(
    enviar.evidencias.includes('whatsapp'),
    `a evidência tem que citar o token que ligou a frase à habilidade (veio ${JSON.stringify(enviar.evidencias)})`,
  );
  assert.equal(c[0].habilidade, 'enviar_whatsapp', 'e tem que ser a mais forte das encontradas');
});

test('coincidência dupla registra o VENCEDOR, não só quem perdeu', () => {
  /**
   * O TESTE DO DEFEITO EXATO. No código antigo, a habilidade que chegava a dois
   * acertos disparava `return true` ANTES do `set` — o mapa terminava com o
   * valor 1 para ela e com o valor certo só para as habilidades que nunca
   * fecharam o par.
   *
   * A ASSERÇÃO É A BICONDICIONAL, e ela custou uma rodada de mutação para
   * chegar nesta forma. A primeira versão pedia só "alguém fechou o par", e
   * passava verde com o defeito reintroduzido: numa frase rica o bastante
   * existe sempre alguma habilidade com TRÊS tokens, que fecha o par mesmo
   * gravando com um turno de atraso. O que o `return` prematuro quebra é
   * exatamente o caso de DOIS — e é ele que a bicondicional trava:
   *
   *   evidências ≥ 2  ⟺  motivo `coincidencia_dupla`
   *
   * Uma implementação que conte com atraso deixa a habilidade de dois tokens
   * com duas evidências e sem o motivo, e este teste fica vermelho.
   */
  const frases = [
    'quantas cargas foram coletadas essa semana?',
    'me lembra de ligar pro cliente',
    'quanto foi faturado?',
  ];

  let viuParDeDois = false;
  for (const f of frases) {
    for (const x of descoberta.descobrirCandidatos(f)) {
      const temDupla = x.motivos.includes('coincidencia_dupla');
      assert.equal(
        temDupla,
        x.evidencias.length >= 2,
        `« ${f} » → «${x.habilidade}» tem ${x.evidencias.length} evidência(s) ${JSON.stringify(x.evidencias)} e ${temDupla ? '' : 'NÃO '}foi marcada como coincidência dupla`,
      );
      if (temDupla && x.evidencias.length === 2) viuParDeDois = true;
    }
  }
  assert.ok(viuParDeDois, 'o corpus tem que exercitar o caso de exatamente dois tokens');

  const cargas = acharCandidato(
    descoberta.descobrirCandidatos('quantas cargas foram coletadas essa semana?'),
    'consultar_cargas_luft',
  );
  assert.ok(cargas, 'a habilidade de cargas da LUFT tem que estar entre os candidatos');
  assert.ok(cargas.evidencias.length >= 2, 'com as duas palavras que a alcançaram');
});

// ---------------------------------------------------------------------------
// 2. A evidência de EXEMPLO é uma dimensão própria, não uma parcela de média
// ---------------------------------------------------------------------------

test('token que só existe nos exemplos aparece na dimensão `exemplo`', () => {
  /**
   * "faturado" vive no exemplo « Qual o total faturado essa semana? » de
   * `consultar_estatisticas_cargas_luft`; a descrição fala em "faturamento",
   * que é outro token. Sem o índice de exemplos esta frase não alcançaria nada.
   *
   * A asserção que importa não é "achou": é que a evidência chegou DECOMPOSTA e
   * a parcela de exemplo é maior que zero. Se um dia alguém somar as duas
   * fontes num escore único, este teste fica vermelho — que é o ponto.
   */
  const c = descoberta.descobrirCandidatos('quanto foi faturado?');
  const stats = acharCandidato(c, 'consultar_estatisticas_cargas_luft');

  assert.ok(stats, 'a habilidade cujo EXEMPLO contém "faturado" tem que ser nomeada');
  assert.ok(
    stats.correspondencia.exemplo > 0,
    'a evidência de exemplo tem que aparecer na dimensão dela',
  );
  assert.ok(
    stats.motivos.includes('token_de_exemplo'),
    'e o motivo tem que dizer que veio de exemplo, não de prosa',
  );
});

test('as três dimensões sobrevivem separadas — nenhuma some dentro do escore', () => {
  const c = descoberta.descobrirCandidatos('quanto foi faturado?');
  const stats = acharCandidato(c, 'consultar_estatisticas_cargas_luft');
  assert.ok(stats);

  const { lexical, exemplo, contexto } = stats.correspondencia;
  assert.ok(lexical > 0, 'lexical tem que estar presente e medida');
  assert.ok(exemplo > 0, 'exemplo tem que estar presente e medida');

  /**
   * LACUNA DECLARADA, não sucesso. Nada do histórico ou da memória entra na
   * descoberta hoje — o construtor recebe manifestos e mais nada. O campo fica
   * zerado e VISÍVEL para que a ausência apareça em relatório, em vez de sumir.
   * Quando contexto entrar, é aqui que este teste tem de ser reescrito.
   */
  assert.equal(contexto, 0, 'contexto ainda não é medido — a lacuna é declarada, não escondida');

  assert.ok(
    stats.score > lexical,
    'o escore agrega as dimensões (exemplo pesa mais); se ele igualar a lexical, a de exemplo sumiu',
  );
});

// ---------------------------------------------------------------------------
// 3. Margem estreita — duas hipóteses continuam sendo duas
// ---------------------------------------------------------------------------

/**
 * CENÁRIO CONTROLADO. Duas habilidades desenhadas para empatar, num catálogo
 * sintético — sem depender do texto dos manifestos reais, que outras sessões
 * editam legitimamente.
 *
 * O TAMANHO DO CATÁLOGO É PARTE DO CENÁRIO, e custou a primeira versão deste
 * teste. Com quatro manifestos o teto de stopword é `ceil(4/3) = 2`, e todo
 * token que as gêmeas compartilham tem frequência de documento 2 — ou seja, é
 * podado ANTES de poder empatar, e a lista sai vazia. O empate só é observável
 * num catálogo grande o bastante para o teto passar de 2: com nove, o teto é 3
 * e um token de duas habilidades sobrevive.
 */
const habilidadeFalsa = (
  id: string,
  descricao: string,
  exemplo: string,
  capacidades: readonly string[] = [],
): ManifestoHabilidade =>
  ({
    id,
    nome: id.replace(/_/g, ' '),
    descricao,
    exemplos: [exemplo],
    capacidades,
    esquema: {},
    risco: 'baixo',
  }) as unknown as ManifestoHabilidade;

const CATALOGO_CONTROLADO: readonly ManifestoHabilidade[] = [
  // As gêmeas: mesmo vocabulário, terminais diferentes.
  habilidadeFalsa(
    'contar_paletes_norte',
    'Conta paletes embarcados no terminal norte.',
    'Quantos paletes embarcados?',
    ['contagem de paletes'],
  ),
  habilidadeFalsa(
    'contar_paletes_sul',
    'Conta paletes embarcados no terminal sul.',
    'Quantos paletes embarcados?',
    ['contagem de paletes'],
  ),
  // Enchimento com vocabulário disjunto: existe só para o teto de frequência
  // de documento ser calculado sobre um catálogo de tamanho realista.
  habilidadeFalsa('consultar_borracharia', 'Estado dos pneus da frota.', 'Como estão os pneus?'),
  habilidadeFalsa('consultar_refeitorio', 'Cardápio do refeitório.', 'Qual o cardápio?'),
  habilidadeFalsa('emitir_cracha', 'Emissão de crachá para visitante.', 'Emite um crachá'),
  habilidadeFalsa('conferir_balanca', 'Pesagem na balança rodoviária.', 'Quanto pesou?'),
  habilidadeFalsa('agendar_manutencao', 'Manutenção preventiva da frota.', 'Agenda a revisão'),
  habilidadeFalsa('listar_docas', 'Ocupação das docas do armazém.', 'Quais docas livres?'),
  habilidadeFalsa('consultar_estoque', 'Saldo de estoque por item.', 'Qual o saldo do item?'),
];

test('empate devolve A e B — o segundo candidato não é descartado', () => {
  const controlada = new DescobertaCapacidades(CATALOGO_CONTROLADO);
  const c = controlada.descobrirCandidatos('quantos paletes embarcados?');

  const ids = c.map((x) => x.habilidade);
  assert.ok(
    ids.includes('contar_paletes_norte') && ids.includes('contar_paletes_sul'),
    `as duas hipóteses plausíveis têm que sobreviver (veio ${JSON.stringify(ids)})`,
  );
  assert.equal(c[0].score, c[1].score, 'o cenário foi construído para empatar');
  assert.equal(
    margemRelativa(c),
    0,
    'margem zero é o sinal de que escolher o primeiro seria desempate numérico, não evidência',
  );
});

test('vantagem clara também é medida — a margem não é sempre zero', () => {
  /**
   * O LADO SIMÉTRICO. Sem ele, `margemRelativa` poderia devolver 0 constante e
   * o teste acima passaria — o mesmo falso verde que uma função que sempre diz
   * "ambíguo" produziria.
   */
  const controlada = new DescobertaCapacidades(CATALOGO_CONTROLADO);
  const c = controlada.descobrirCandidatos('como estão os pneus da frota?');

  assert.equal(c[0].habilidade, 'consultar_borracharia');
  assert.ok(
    margemRelativa(c) > 0.5,
    `vantagem clara tem que produzir margem alta (veio ${margemRelativa(c).toFixed(2)})`,
  );
});

test('margem no catálogo real separa vencedor claro de disputa', () => {
  const clara = descoberta.descobrirCandidatos('tira um print da tela');
  assert.equal(clara[0].habilidade, 'capturar_tela');
  assert.ok(margemRelativa(clara) > 0.5, 'print de tela não disputa com nada');

  /**
   * « e por central? » é elíptica: sem o turno anterior ela não decide entre as
   * habilidades que sabem agrupar por central. A descoberta não esconde isso
   * escolhendo uma — devolve as duas empatadas, e a margem denuncia.
   */
  const disputada = descoberta.descobrirCandidatos('e por central?');
  assert.ok(disputada.length >= 2, 'a frase elíptica alcança mais de uma habilidade');
  assert.ok(
    margemRelativa(disputada) < 0.2,
    `disputa real tem que sair com margem baixa (veio ${margemRelativa(disputada).toFixed(2)})`,
  );
});

// ---------------------------------------------------------------------------
// 4. Tokenização — sigla curta deixou de ser invisível
// ---------------------------------------------------------------------------

test('sigla do catálogo sobrevive ao corte de tamanho', () => {
  /**
   * O corte era `t.length >= 4`, e apagava os sinais mais operacionais que
   * existem: « só de MT » ficava sem token nenhum, « olha o CT-e » ficava só
   * com "olha". A régua nova é tipográfica e nasce do manifesto — caixa alta
   * candidata, frequência de documento decide.
   */
  const mt = descoberta.descobrirCandidatos('só de MT');
  assert.ok(mt.length > 0, '« só de MT » não pode sair vazia — MT está no exemplo da infraestrutura');
  assert.equal(mt[0].habilidade, 'consultar_infraestrutura');

  const cte = descoberta.descobrirCandidatos('olha o CT-e');
  assert.ok(cte.length > 0, '« olha o CT-e » não pode sair vazia');

  /** `OCIs` é escrita no plural no manifesto; quem digita `OCI` tem de casar. */
  const oci = descoberta.descobrirCandidatos('quantas OCI?');
  assert.ok(oci.length > 0, 'o plural da sigla no manifesto tem que alcançar o singular da frase');
});

test('a sigla não vem de lista escrita à mão — o que o catálogo não declara, não existe', () => {
  /**
   * A METADE QUE MANTÉM A REGRA HONESTA. `MT` está no exemplo de
   * `consultar_infraestrutura`; `MG` não está em manifesto nenhum. Se um dia
   * este teste ficar vermelho porque alguém escreveu `['MG', 'CT-e', 'OCI']`
   * dentro do módulo, a arquitetura regrediu exatamente como o cabeçalho do
   * arquivo proíbe — e a correção é declarar MG num manifesto, não aqui.
   */
  assert.equal(
    descoberta.descobrirCandidatos('só de MG').length,
    0,
    'sigla que o catálogo não declara não pode aparecer por lista interna',
  );
});

test('token curto genérico continua fora — a caixa alta candidata, a estatística decide', () => {
  /**
   * `de` e `da` ENTRAM na candidatura por "A EXPRESSÃO DE TEMPO" estar em caixa
   * alta no manifesto de `agendar_lembrete`, e saem podados pela frequência de
   * documento. Se a poda deixar de rodar sobre siglas, esta frase de conversa
   * passa a alcançar meio catálogo.
   */
  assert.equal(descoberta.descobrirCandidatos('de tudo um pouco, e da forma que der').length, 0);
});

// ---------------------------------------------------------------------------
// 5. O contrato antigo é o novo, escrito de outro jeito
// ---------------------------------------------------------------------------

const CORPUS_DE_EQUIVALENCIA = [
  'Motoristas disponíveis agora?',
  'Quero saber quem fez mais viagens de carga',
  'Me mostra o faturamento das cargas',
  'cargas coletadas na operação',
  'quanto foi faturado?',
  'quantas estão finalizadas?',
  'hoje foi um dia cansativo',
  'conte uma curiosidade',
  'obrigada, até amanhã',
  'qual é o sentido da vida?',
  'tira um print',
  'e por central?',
];

test('`pareceOperacional` é exatamente "existe candidato"', () => {
  for (const f of CORPUS_DE_EQUIVALENCIA) {
    assert.equal(
      descoberta.pareceOperacional(f),
      descoberta.descobrirCandidatos(f).length > 0,
      `o booleano e a lista discordaram em « ${f} » — o portão de rota deixou de ver o que a descoberta vê`,
    );
  }
});

test('a ordem é determinística — a mesma frase, duas vezes, dá a mesma lista', () => {
  /**
   * Iteração de `Map` é estável em JS, mas o desempate por escore não é: duas
   * habilidades empatadas sairiam na ordem de inserção, que depende da ordem do
   * catálogo. O desempate por id torna a saída uma função da frase, e é isso
   * que permite ao arnês da Fase 2 comparar duas paráfrases sem medir ruído.
   */
  for (const f of CORPUS_DE_EQUIVALENCIA) {
    assert.deepEqual(
      descoberta.descobrirCandidatos(f),
      descoberta.descobrirCandidatos(f),
      `« ${f} » não é determinística`,
    );
  }
});
