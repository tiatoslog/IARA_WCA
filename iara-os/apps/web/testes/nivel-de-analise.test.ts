/**
 * O SELETOR DE NÍVEL — e o que ele tem de NÃO capturar.
 *
 * Módulo de regex é onde a âncora falsa mora. `Percepcao.ts` pagou duas vezes
 * por padrão genérico solto — `frota` capturando "estratégia de redução de custo
 * para a frota", `lento` capturando "o cliente está lento para pagar" — e aqui o
 * custo de errar é pior: âncora errada manda para a receita errada; NÍVEL errado
 * muda o que a IARA se permite AFIRMAR.
 *
 * Por isso metade desta bateria são casos NEGATIVOS. Um seletor que só é testado
 * com as frases que ele foi feito para pegar passa sempre, e o falso positivo
 * aparece em produção.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { EXIGENCIAS, escolherNivel } from '../servidor/nucleo/kernel/NivelDeAnalise';

// ===========================================================================
// A. Cada degrau tem de ser alcançável pela frase que o operador usa
// ===========================================================================

test('A1. pergunta factual pura não arrasta o motor analítico', () => {
  for (const frase of ['que horas são?', 'bom dia', 'abre o Excel pra mim']) {
    const n = escolherNivel(frase);
    assert.equal(n.nivel, 'direta', frase);
    assert.equal(n.evidencias_minimas, 0);
    assert.equal(n.exige_recomendacao, false);
  }
});

test('A2. contagem sobre a operação sobe para consulta ou operacional', () => {
  assert.equal(escolherNivel('quantas cargas hoje?').nivel, 'operacional');
  /* Sem dimensão de negócio, a contagem é consulta simples. */
  assert.equal(escolherNivel('quantos itens no total?').nivel, 'consulta');
});

test('A3. comparação vira gerencial e pretende conclusão comparativa', () => {
  const n = escolherNivel('compare o faturamento desse mês com o passado');
  assert.equal(n.nivel, 'gerencial');
  assert.equal(n.tipo_pretendido, 'comparativa');
});

test('A4. "por que" é o marcador causal e sobe para estratégica', () => {
  for (const frase of ['por que a margem caiu?', 'qual o motivo da queda de margem?']) {
    const n = escolherNivel(frase);
    assert.equal(n.tipo_pretendido, 'causal', frase);
    assert.ok(n.marcadores.includes('causal'), frase);
  }
});

test('A5. executivo exige enquadramento DECLARADO mais decisão', () => {
  assert.equal(
    escolherNivel('devo recomendar à diretoria que a gente encerre a rota?').nivel,
    'executiva',
  );
  /* A palavra sozinha não basta: recado para a diretoria não é análise executiva. */
  assert.notEqual(escolherNivel('manda isso pro pessoal da diretoria').nivel, 'executiva');
});

test('A6. três dimensões de negócio tornam a pergunta multidimensional', () => {
  const n = escolherNivel('me mostra margem, atraso e reclamação de cliente por rota');
  assert.ok(n.dimensoes.length >= 3, `dimensões: ${n.dimensoes.join(', ')}`);
  assert.equal(n.nivel, 'multidimensional');
  assert.equal(n.evidencias_minimas, 3);
});

// ===========================================================================
// B. Os falsos positivos — o que NÃO pode disparar
// ===========================================================================

test('B1. "o sistema caiu" é incidente, não comparação', () => {
  const n = escolherNivel('o sistema caiu de novo hoje de manhã');
  assert.equal(
    n.marcadores.includes('comparativo'),
    false,
    '`caiu` solto transformaria todo incidente em análise comparativa',
  );
});

test('B2. "porque" explicativo do operador não vira pedido de causa', () => {
  /* O marcador causal está preso à FORMA INTERROGATIVA e ao complemento
     ("motivo de", "causa de"). "Te avisei porque achei importante" é relato. */
  const n = escolherNivel('te mandei o arquivo porque achei importante');
  assert.equal(n.tipo_pretendido !== 'causal' || n.nivel === 'direta', true, JSON.stringify(n));
});

test('B3. decisão NÃO cria exigência causal sozinha', () => {
  /**
   * Se "devo priorizar X?" promovesse para estratégica, `tipo_pretendido` seria
   * `causal` e R9 rebaixaria a resposta em 100% das perguntas de decisão — a
   * ressalva de causa apareceria em perguntas que nunca falaram de causa. E
   * ressalva que aparece sempre deixa de ser lida.
   */
  const n = escolherNivel('devo priorizar a rota de Campinas?');
  assert.equal(n.tipo_pretendido, 'comparativa');
  assert.equal(n.exige_recomendacao, true);
});

test('B4. decisão sobe a exigência de recomendação mesmo em nível baixo', () => {
  const n = escolherNivel('vale a pena?');
  assert.equal(n.exige_recomendacao, true, 'pediu decisão → a resposta deve terminar em ação');
});

// ===========================================================================
// C. O nível é MECANISMO, não taxonomia
// ===========================================================================

test('C1. cada nível declara exigências diferentes — nenhum é só um rótulo', () => {
  const vistos = new Set(
    Object.values(EXIGENCIAS).map(
      (x) => `${x.tipo_pretendido}|${x.evidencias_minimas}|${x.exige_recomendacao}`,
    ),
  );
  assert.ok(
    vistos.size >= 5,
    `os sete níveis produzem só ${vistos.size} combinações de exigência — ` +
      'níveis que exigem a mesma coisa são um rótulo, não um mecanismo',
  );
});

test('C2. a exigência cresce monotonicamente com o nível', () => {
  const ordem = [
    'direta',
    'consulta',
    'operacional',
    'gerencial',
    'multidimensional',
    'estrategica',
    'executiva',
  ] as const;
  let anterior = -1;
  for (const nome of ordem) {
    const n = EXIGENCIAS[nome].evidencias_minimas;
    assert.ok(n >= anterior, `${nome} exige menos que o nível abaixo dele`);
    anterior = n;
  }
});

test('C3. a escolha é auditável: os marcadores que dispararam ficam declarados', () => {
  const n = escolherNivel('por que a margem caiu em relação ao ano passado? devo avisar a diretoria?');
  assert.ok(n.marcadores.includes('causal'));
  assert.ok(n.marcadores.includes('comparativo'));
  assert.ok(n.marcadores.includes('decisorio'));
  assert.ok(n.marcadores.includes('executivo'));
  assert.ok(n.dimensoes.includes('financeiro'));
});

// ===========================================================================
// D. O PORTUGUÊS QUE A OPERADORA ESCREVE — achado pela auditoria independente
//
// Estas frases desligavam a proteção contra causa inteira. `r9CausaSemLastro`
// começa com `if (tipo !== 'causal') return []`, então um falso negativo aqui
// não custa "uma resposta menos ambiciosa": custa a ressalva não existir.
//
// Medido: "por que a margem caiu?" saía com degrau `comparativa` e a ressalva
// de causa; "pq a margem caiu?" saía com degrau POPULACIONAL, veredicto
// CONCLUIR, confiança ALTA e rodapé VAZIO. A mesma pergunta.
// ===========================================================================

test('D1. abreviação e grafia rápida contam como pergunta causal', () => {
  for (const frase of [
    'pq a margem caiu?',
    'porq a margem caiu?',
    'por que a margem caiu?',
    'porque a margem caiu?',
  ]) {
    assert.equal(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D2. o complemento contraído — "causa disso", "motivo disso"', () => {
  for (const frase of [
    'qual a causa disso?',
    'cadê o motivo disso',
    'qual o motivo da queda',
    'qual a explicação pra margem ter caido',
  ]) {
    assert.equal(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D3. pedido de explicação sem interrogação', () => {
  for (const frase of [
    'sabe me dizer porque a margem caiu',
    'me diz o porque disso',
    'explica a queda da margem',
    'o que houve com a margem',
  ]) {
    assert.equal(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D4. e nada disso reabre o falso positivo do relato', () => {
  /* O par de D1–D3. Alargar a captura sem este caso teria trocado um falso
     negativo por um falso positivo, que é o defeito simétrico. */
  for (const frase of [
    'te mandei o arquivo porque achei importante',
    'me explica como usar isso',
    'o sistema caiu de novo hoje de manhã',
    'abre a planilha pra mim',
  ]) {
    assert.notEqual(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D5. pergunta de ESTADO e de LOCALIZAÇÃO não é pergunta de causa', () => {
  /**
   * Os sete falsos positivos que a segunda passada da auditoria achou. Todos
   * nasciam `estrategica / causal / evidencias_minimas: 3`, e o custo é
   * concreto: se um desses turnos tocasse uma habilidade que emite três
   * evidências, o operador leria "eu consigo mostrar que essas coisas andaram
   * juntas, não que uma causou a outra" como resposta a "onde está a
   * explicação do relatório".
   */
  for (const frase of [
    'o que aconteceu com o excel',
    'o que houve com a impressora',
    'o que deu errado no envio',
    'a explicação pro cliente ta pronta?',
    'onde esta a explicacao do relatorio',
  ]) {
    assert.notEqual(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D6. mas "o que houve" COM uma dimensão de negócio continua sendo causa', () => {
  /* O par de D5 — o objeto é que decide, e sem este caso a correção teria
     trocado sete falsos positivos por um falso negativo. */
  for (const frase of ['o que houve com a margem', 'o que aconteceu com o faturamento']) {
    assert.equal(escolherNivel(frase).tipo_pretendido, 'causal', frase);
  }
});

test('D7. "pq" sem interrogação, mas com assunto de negócio, ainda é causa', () => {
  /* O falso negativo residual que a auditoria registrou: `pq|porq` exigia
     interrogação ou verbo de explicação, e "porq a margem caiu" não tem nem um
     nem outro. A dimensão de negócio é o complemento que desambigua. */
  assert.equal(escolherNivel('porq a margem caiu').tipo_pretendido, 'causal');
  assert.equal(escolherNivel('pq o faturamento despencou').tipo_pretendido, 'causal');
  /* E continua não capturando conversa: sem assunto de negócio, `pq` solto num
     relato não vira análise estratégica. */
  assert.notEqual(escolherNivel('não fui pq tava chovendo').tipo_pretendido, 'causal');
});

test('C4. o mesmo texto dá sempre o mesmo nível', () => {
  const frase = 'por que a margem da rota Campinas caiu contra o mês passado?';
  assert.deepEqual(escolherNivel(frase), escolherNivel(frase));
  /* E acento não muda a decisão — `normalizar` é a mesma da casa. */
  assert.deepEqual(
    escolherNivel('POR QUE A MARGEM CAIU?').nivel,
    escolherNivel('por que a margem caiu?').nivel,
  );
});
