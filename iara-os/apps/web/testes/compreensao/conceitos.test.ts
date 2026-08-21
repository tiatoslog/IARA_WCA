/**
 * RECUPERAÇÃO SEMÂNTICA DE CONCEITOS — palavras diferentes, mesmo conceito.
 *
 * ===========================================================================
 * A LACUNA, e por que ela é UMA e não quatro
 * ===========================================================================
 *
 * O arnês da Fase 2 mediu quatro sintomas que pareciam casos separados:
 *
 *     « estou livre amanhã? »        → morria em conversa
 *     « quantas coletas essa semana? » → referente "coleta" ≠ "carga"
 *     « me mostra a caixa »          → não alcançava `ler_emails`
 *     « quais arquivos nos documentos? » → não alcançava `listar_arquivos`
 *
 * Em todos, o ato estava certo, a operação estava certa e o período estava
 * certo. O que faltava era ligar a palavra do OPERADOR ao conceito do CATÁLOGO.
 *
 * O DESFECHO ERRADO — e é o que estes testes existem para impedir — seria
 * quatro correções: um `if` para "livre", outro para "coleta", outro para
 * "caixa". Três dias depois viriam "vago", "sem reunião", "posso marcar?", e o
 * ciclo que este projeto persegue estaria de volta com roupa nova.
 *
 * A correção é UMA: o manifesto declara os conceitos que atende, e o índice os
 * recupera. Nenhuma das seis frases do portão abaixo está escrita em lugar
 * nenhum do código.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compreender,
  operacaoDoManifesto as compreenderOperacao,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import type { ManifestoHabilidade } from '../../servidor/nucleo/kernel/Habilidade';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const conceitual = new IndiceConceitual(MANIFESTOS);
const habilidades = MANIFESTOS;
const AGORA = new Date('2026-08-19T10:00:00');

const ler = (bruto: string) =>
  compreender({ bruto, descoberta, conceitual, agora: AGORA, habilidades });

// ---------------------------------------------------------------------------
// 1. O PORTÃO — seis formulações, nenhuma ensinada individualmente
// ---------------------------------------------------------------------------

/**
 * ANTES desta fase, TODAS as seis produziam `objetivo: null` e rota
 * `raciocinio_direto` — a IARA tinha a habilidade de ler agenda e não a
 * alcançava por nenhuma delas.
 *
 * O que o catálogo ganhou foram DOIS conceitos declarados em
 * `ver_agenda_calendario` (`agenda` e `disponibilidade`) com nove termos entre
 * os dois. As seis frases abaixo não aparecem em manifesto, teste nem código.
 */
const PORTAO_DISPONIBILIDADE = [
  'estou livre amanhã?',
  'tenho horário amanhã?',
  'tenho algum compromisso amanhã?',
  'tem alguma reunião amanhã?',
  'como está minha agenda amanhã?',
  'amanhã estou ocupado?',
];

for (const frase of PORTAO_DISPONIBILIDADE) {
  test(`portão: « ${frase} » alcança a agenda`, () => {
    const c = ler(frase);
    assert.ok(c.conceitos.length > 0, 'nenhum conceito recuperado');
    assert.ok(
      ['agenda', 'disponibilidade'].includes(c.conceitos[0].conceito),
      `conceito recuperado foi "${c.conceitos[0].conceito}"`,
    );
    assert.equal(c.operacao, 'leitura', 'perguntar sobre a agenda é leitura');
    assert.equal(c.periodo, '2026-08-20..2026-08-20', 'amanhã');
    assert.equal(
      c.objetivo,
      'ver_agenda_calendario',
      `objetivo veio ${c.objetivo} — hipóteses: ${c.hipoteses.map((h) => h.objetivo).join(', ')}`,
    );
  });
}

test('as seis convergem no MESMO contrato semântico', () => {
  /**
   * Acertar cada uma isoladamente não bastaria: um sistema pode acertar seis
   * frases por seis motivos diferentes. O que interessa é elas produzirem a
   * mesma leitura — é isso que significa "entender", e é o que distingue esta
   * correção de seis remendos.
   */
  const contratos = PORTAO_DISPONIBILIDADE.map(ler);
  const [ref] = contratos;
  for (let i = 1; i < contratos.length; i += 1) {
    const c = contratos[i];
    assert.equal(c.operacao, ref.operacao, `« ${PORTAO_DISPONIBILIDADE[i]} » divergiu na operação`);
    assert.equal(c.periodo, ref.periodo, `« ${PORTAO_DISPONIBILIDADE[i]} » divergiu no período`);
    assert.equal(c.objetivo, ref.objetivo, `« ${PORTAO_DISPONIBILIDADE[i]} » divergiu no objetivo`);
  }
});

// ---------------------------------------------------------------------------
// 2. SIMILARIDADE NÃO É COMPATIBILIDADE — a regra da arquitetura
// ---------------------------------------------------------------------------

test('o conceito alcança ler E criar agenda; só a operação escolhe', () => {
  /**
   * O TESTE MAIS IMPORTANTE DESTA FASE.
   *
   * `disponibilidade` é declarado por DUAS habilidades: `ver_agenda_calendario`
   * e `criar_evento_calendario`. A recuperação semântica devolve as duas com o
   * mesmo escore, e está CERTA — as duas são sobre agenda.
   *
   * Se a similaridade decidisse, « estou livre amanhã? » poderia criar um
   * compromisso no calendário de quem só perguntou. O que impede isso não é o
   * escore ser baixo: é a operação `criacao` não casar com `leitura`.
   */
  const recuperados = conceitual.recuperar('estou livre amanhã?');
  const disponibilidade = recuperados.find((r) => r.conceito === 'disponibilidade');
  assert.ok(disponibilidade, 'o conceito tem que ser recuperado');
  assert.ok(
    disponibilidade.capacidades.includes('criar_evento_calendario') &&
      disponibilidade.capacidades.includes('ver_agenda_calendario'),
    'as DUAS habilidades declaram o conceito — é isso que torna o teste válido',
  );

  const c = ler('estou livre amanhã?');
  assert.equal(c.objetivo, 'ver_agenda_calendario');

  const criar = c.hipoteses.find((h) => h.objetivo === 'criar_evento_calendario');
  assert.ok(
    !criar || criar.compativel === false,
    'criar evento não pode ser hipótese compatível de uma pergunta',
  );

  const recusa = c.evidencias.find(
    (e) => e.fonte === 'compatibilidade' && e.trecho.includes('criar_evento_calendario'),
  );
  assert.ok(recusa, 'a recusa por incompatibilidade tem que ficar registrada, não silenciosa');
});

test('recuperador externo com escore máximo não vence a incompatibilidade', () => {
  /**
   * A COLEIRA DO EMBEDDING, exercitada com um recuperador hostil.
   *
   * Este objeto é o mundo, não um dublê do que está sob teste: é o que um
   * modelo de similaridade devolveria se estivesse convencido — escore 1,0 num
   * conceito que alcança uma habilidade de ESCRITA, para uma frase de leitura.
   *
   * `similaridade > X → executar` é exatamente o que não pode acontecer, e o
   * teste falha se um dia acontecer.
   */
  const c = compreender({
    bruto: 'lista os arquivos',
    descoberta,
    conceitual,
    agora: AGORA,
    habilidades,
    conceitosRecuperados: [{ conceito: 'agenda', literal: 'arquivos', score: 1 }],
  });

  const criarEvento = c.hipoteses.find((h) => h.objetivo === 'criar_evento_calendario');
  assert.ok(
    !criarEvento,
    'conceito externo com escore 1,0 não pode admitir habilidade de operação incompatível',
  );
  assert.equal(c.operacao, 'leitura');
  assert.equal(c.objetivo, 'listar_arquivos', 'a leitura correta continua ganhando');
});

test('recuperador externo não sobrepõe conceito declarado no manifesto', () => {
  const c = compreender({
    bruto: 'quantas coletas essa semana?',
    descoberta,
    conceitual,
    agora: AGORA,
    habilidades,
    conceitosRecuperados: [{ conceito: 'carga', literal: 'coletas', score: 1 }],
  });
  const carga = c.conceitos.find((x) => x.conceito === 'carga');
  assert.ok(carga);
  assert.equal(
    carga.origem,
    'termo_declarado',
    'o manifesto é a fonte de verdade; a proposta do modelo não sobrescreve o declarado',
  );
});

// ---------------------------------------------------------------------------
// 3. NORMALIZAÇÃO DO REFERENTE — sem perder o que o operador escreveu
// ---------------------------------------------------------------------------

test('« coletas » e « cargas » têm o mesmo referente, com literais diferentes', () => {
  const comColeta = ler('quantas coletas essa semana?');
  const comCarga = ler('quantas cargas essa semana?');

  assert.equal(comColeta.referente.conceito, comCarga.referente.conceito, 'o conceito é o mesmo');
  assert.equal(comColeta.referente.conceito, 'carga');

  assert.equal(comColeta.referente.literal, 'coleta', 'o que o operador escreveu não se perde');
  assert.equal(comCarga.referente.literal, 'carga');

  assert.equal(comColeta.referente.alias_semantico, true, 'houve tradução — a auditoria precisa ver');
  assert.equal(comCarga.referente.alias_semantico, false, 'aqui não houve');
});

test('a normalização declara de onde veio e com que confiança', () => {
  const c = ler('me mostra a caixa de entrada');
  assert.equal(c.referente.conceito, 'email');
  assert.equal(c.referente.literal, 'caixa');
  assert.equal(c.referente.origem, 'termo_declarado');
  assert.ok(c.referente.score > 0 && c.referente.score <= 1);
  assert.equal(c.objetivo, 'ler_emails');
});

test('sem conceito declarado, literal e conceito coincidem — nada é inventado', () => {
  const c = ler('tira um print da tela');
  assert.equal(c.referente.alias_semantico, false);
  assert.equal(c.referente.conceito, c.referente.literal);
});

// ---------------------------------------------------------------------------
// 4. ABERTO/FECHADO — conceito novo não toca código
// ---------------------------------------------------------------------------

test('conceito de um domínio inventado funciona sem editar nada', () => {
  /**
   * A prova de que a correção é estrutural. "lacre" e "vistoria" não existem
   * neste produto; a habilidade falsa declara os próprios conceitos e passa a
   * ser recuperável por palavras que não estão em módulo nenhum.
   */
  const novo: ManifestoHabilidade = {
    id: 'listar_lacres',
    nome: 'Lacres do pátio',
    descricao: 'Lista os lacres emitidos no pátio.',
    exemplos: ['Quais lacres foram emitidos?'],
    capacidades: [],
    conceitos: [{ nome: 'lacre', termos: ['selo', 'vistoria', 'inspecao'] }],
    esquema: {},
    risco: 'baixo',
  } as unknown as ManifestoHabilidade;

  const catalogo = [...MANIFESTOS, novo];
  const c = compreender({
    bruto: 'me mostra as vistorias',
    descoberta: new DescobertaCapacidades(catalogo),
    conceitual: new IndiceConceitual(catalogo),
    agora: AGORA,
    habilidades: catalogo,
  });

  assert.equal(c.conceitos[0]?.conceito, 'lacre', 'a palavra nova recupera o conceito declarado');
  assert.equal(c.objetivo, 'listar_lacres');
  assert.equal(c.referente.conceito, 'lacre');
  assert.equal(c.referente.literal, 'vistoria');
  assert.equal(c.referente.alias_semantico, true);
});

// ---------------------------------------------------------------------------
// 5. CONTRATO DO CATÁLOGO — a lacuna é declarada, não escondida
// ---------------------------------------------------------------------------

test('toda habilidade do catálogo tem operação legível no `id`', () => {
  /**
   * A TRAVA QUE NÃO PODE FALTAR, e ela custou um defeito para ser escrita.
   *
   * `operacaoDaHabilidade('ver_agenda_calendario')` devolvia `null` porque o
   * verbo "ver" não estava no léxico — e a trava de compatibilidade RECUSAVA a
   * única habilidade de leitura de agenda do catálogo. Uma trava que não sabe
   * classificar barra o inocente, e o sintoma aparece longe da causa.
   *
   * As exceções são declaradas e cada uma tem motivo: são ids que não começam
   * por verbo. Habilidade nova que não seja legível fica vermelha aqui, e a
   * correção é o `id` ou o léxico — nunca um caso especial silencioso.
   */
  const mudas = MANIFESTOS.filter((m) => compreenderOperacao(m) === null).map((m) => m.id);

  assert.deepEqual(
    mudas,
    [],
    `habilidades cuja operação a camada não consegue ler: ${mudas.join(', ')}.
` +
      `    A trava de compatibilidade recusa o que não classifica — habilidade ilegível vira ` +
      `habilidade inalcançável, e o sintoma aparece longe da causa. A correção é declarar ` +
      `\`operacao_semantica\` no manifesto, nunca abrir exceção aqui.`,
  );
});

// ---------------------------------------------------------------------------
// 6. NORMALIZAÇÃO DE RUÍDO — o recurso existe e é conservador
// ---------------------------------------------------------------------------

test('erro de digitação em substantivo declarado ainda alcança a habilidade', () => {
  /**
   * O Arnês C mediu 8 falhas de cadeia causadas por typo. `corrigirTypos` já
   * existia em `texto.ts` e nunca era chamada pela descoberta — e o vocabulário
   * dela é escrito à mão, sem conhecer o catálogo.
   *
   * « me lista os lembrets » tem "lista", que É token do catálogo: a frase não
   * está muda, só não encontra nada. Por isso o recurso acontece no nível do
   * RESULTADO, não no do token.
   */
  assert.equal(
    descoberta.descobrirCandidatos('me lista os lembrets')[0]?.habilidade,
    'listar_lembretes',
  );
});

test('a correção NÃO age sobre palavra legítima do português', () => {
  /**
   * A METADE QUE IMPEDE O CORRETOR DE INVENTAR, e ela custou quatro guardas
   * medidas. « preciso saber disso » não tem conteúdo de domínio; corrigido
   * contra o catálogo virava « precisa sabe disso » e passava a "encontrar"
   * habilidades. "preciso", "saber" e "mais" são português correto.
   *
   * A régua final: só se confia na correção quando ela cai sobre um substantivo
   * que o catálogo DECLAROU (`entidades`, `conceitos`) — aí não é palpite sobre
   * a língua, é reconhecimento de vocabulário próprio.
   */
  /**
   * A FRASE MUDOU QUANDO O CATÁLOGO CRESCEU, e o motivo importa mais que a
   * troca.
   *
   * A versão anterior usava « preciso saber disso » como exemplo de frase SEM
   * conteúdo de domínio. Ela deixou de ser: `treinar_procedimento` entrou no
   * catálogo com o exemplo « Não entendi por que PRECISO fazer essa etapa », e
   * daí em diante "preciso" virou vocabulário legítimo da operação. A frase
   * alcançar a habilidade de treinamento passou a ser CERTO — quem diz isso
   * está pedindo para aprender.
   *
   * O fixture é que envelheceu, não a regra. « saber disso agora » não toca
   * manifesto nenhum e volta a exercitar o que o teste sempre quis provar: o
   * corretor não pode fabricar capacidade a partir de português comum.
   */
  assert.equal(descoberta.descobrirCandidatos('saber disso agora').length, 0);
  assert.ok(
    descoberta.normalizarConsulta('qual motorosta tem mais cargas?').includes(' mais '),
    '"mais" e portugues correto e fica a uma letra de "mail" — nao pode ser corrigida',
  );
});
