/**
 * OCR local e MÁSCARA — a pergunta é uma: **dado sensível sai da máquina?**
 *
 * O teste central deste arquivo é `M9`: ele monta uma tela com CPF, CNPJ,
 * placa, telefone, e-mail, valor e chave fiscal, roda o laço de percepção
 * inteiro e afirma que NENHUM deles aparece no evento que sairia pelo socket.
 * Não afirma que a máscara foi chamada — afirma que o dado não está lá, que é a
 * única forma de a afirmação valer alguma coisa.
 *
 * O OCR AQUI É DUBLÊ. O motor de verdade (`Windows.Media.Ocr`) foi sondado na
 * máquina e está medido em `docs/relatorios/percepcao-p0-medicao.md`; o que
 * este arquivo prova é o que o Braço FAZ com o que o OCR devolveu — e isso
 * precisa rodar em qualquer sistema operacional.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FORMA_DE_MENSAGEM,
  MAX_LINHA,
  MAX_LINHAS,
  linhasDeMensagem,
  mascarar,
  prepararTextoDaTela,
  rotulo,
  temSensivel,
} from '../lib/mascara';
import { lerEventoVisual } from '../lib/execucao';
import {
  INTERVALO_OCR_MS,
  LADO_MINIATURA,
  MIN_LINHAS_MUDADAS,
  hashDeTexto,
  linhasMudadas,
  type EventoVisual,
} from '../lib/percepcao';
import { PercepcaoLocal, type Consentimento } from '../servidor/braco/PercepcaoLocal';

const ACEITE: Consentimento = { concedido: true, em: '2026-08-21T12:00:00.000Z', via: 'teste' };

/** Uma tela sintética estável. O conteúdo do quadro não importa neste arquivo. */
function tela(): number[] {
  const v: number[] = [];
  for (let y = 0; y < LADO_MINIATURA; y += 1) {
    for (let x = 0; x < LADO_MINIATURA; x += 1) v.push(Math.round((x / (LADO_MINIATURA - 1)) * 255));
  }
  return v;
}

// ---------------------------------------------------------------------------
// 1. A máscara, forma por forma
// ---------------------------------------------------------------------------

test('M1. cada forma sensível é escondida e NOMEADA', () => {
  const casos: ReadonlyArray<[string, string]> = [
    ['CPF 123.456.789-09', 'cpf'],
    ['CPF 12345678909', 'cpf'],
    ['CNPJ 12.345.678/0001-95', 'cnpj'],
    ['placa ABC1D23', 'placa'],
    ['placa ABC-1234', 'placa'],
    ['CEP 13010-100', 'cep'],
    ['fone (19) 99999-8888', 'telefone'],
    ['daiane@atoslog.com.br', 'email'],
    ['total R$ 1.234,56', 'valor'],
    ['numero 987654321', 'numero'],
  ];
  for (const [bruto, tipo] of casos) {
    const m = mascarar(bruto);
    assert.ok(m.encontrados.includes(tipo as never), `"${bruto}" não foi reconhecido como ${tipo}`);
    assert.ok(m.texto.includes(rotulo(tipo as never)), `"${bruto}" não recebeu o rótulo`);
  }
});

test('M2. a chave fiscal de 44 dígitos não escapa como "vários números"', () => {
  const chave = '3524'.padEnd(44, '1');
  const m = mascarar(`chave ${chave}`);
  assert.ok(m.encontrados.includes('chave_fiscal'), 'a chave de acesso passou');
  assert.ok(!m.texto.includes(chave));
});

test('M3. CÓDIGO DE ERRO SOBREVIVE — é ele que a IARA usa para achar o POP', () => {
  const m = mascarar('Erro 1145 ao transmitir');
  assert.ok(m.texto.includes('1145'), 'o código do erro foi mascarado e a pista se perdeu');
  assert.equal(m.encontrados.length, 0);
});

test('M4. a máscara não deixa resíduo do dado original', () => {
  const bruto =
    'Motorista CPF 987.654.321-00, placa XYZ9A88, fone (11) 98888-7777, ' +
    'email jose@transportes.com.br, frete R$ 12.345,67, CNPJ 98.765.432/0001-10';
  const m = mascarar(bruto);
  for (const pedaco of [
    '987.654.321-00',
    '987654321',
    'XYZ9A88',
    '98888-7777',
    'jose@transportes.com.br',
    '12.345,67',
    '98.765.432/0001-10',
  ]) {
    assert.ok(!m.texto.includes(pedaco), `"${pedaco}" sobreviveu à máscara: ${m.texto}`);
  }
});

test('M5. a regex global não perde o começo do segundo texto', () => {
  /* O defeito clássico de `RegExp` com `g` compartilhada: `lastIndex` herdado da
     chamada anterior faz o segundo texto ser varrido do meio para a frente. Aqui
     isso significaria um CPF não mascarado. */
  assert.ok(temSensivel('CPF 111.222.333-44'));
  assert.ok(temSensivel('CPF 111.222.333-44'), 'a segunda chamada não achou o mesmo dado');
  assert.equal(mascarar('CPF 111.222.333-44').texto, `CPF ${rotulo('cpf')}`);
});

test('M6. o texto da tela é cortado depois de mascarado, nunca antes', () => {
  const linhas = [
    `preambulo ${'x'.repeat(MAX_LINHA)} CPF 123.456.789-09`,
    ...Array.from({ length: MAX_LINHAS + 5 }, (_, i) => `linha ${i}`),
  ];
  const p = prepararTextoDaTela(linhas);
  assert.ok(p.encontrados.includes('cpf'), 'o CPF do fim da linha longa escapou do corte');
  assert.ok(!p.texto.includes('123.456.789-09'));
  assert.ok(p.texto.split('\n').length <= MAX_LINHAS, 'passou do teto de linhas');
  for (const l of p.texto.split('\n')) assert.ok(l.length <= MAX_LINHA, 'linha passou do teto');
});

test('M7. mensagem de sistema é reconhecida pela FORMA, não pelo significado', () => {
  assert.ok(FORMA_DE_MENSAGEM.test('Erro ao transmitir'));
  assert.ok(FORMA_DE_MENSAGEM.test('Não foi possível salvar'));
  assert.ok(FORMA_DE_MENSAGEM.test('Campo obrigatório'));
  assert.ok(!FORMA_DE_MENSAGEM.test('Consulta de coletas'));
  assert.deepEqual(linhasDeMensagem(['ok', 'Erro 1145', 'fim']), ['Erro 1145']);
});

test('M8. o hash de texto é estável e a contagem de linhas é simétrica', () => {
  assert.equal(hashDeTexto('abc'), hashDeTexto('abc'));
  assert.notEqual(hashDeTexto('abc'), hashDeTexto('abd'));
  assert.equal(linhasMudadas('a\nb', 'a\nb'), 0);
  assert.equal(linhasMudadas('a\nb', 'a\nc'), 2, 'uma linha trocada é uma que sai e uma que entra');
  assert.equal(linhasMudadas('a', 'a\nb'), 1);
  assert.equal(linhasMudadas('a\nb', 'a'), 1, 'linha que SUMIU não foi contada');
});

// ---------------------------------------------------------------------------
// 2. O laço com OCR — o teste que importa
// ---------------------------------------------------------------------------

function montar(linhasIniciais: readonly string[]) {
  const mundo = {
    processo: 'gw',
    titulo: 'consulta',
    tela: tela(),
    agora: 1_000_000,
    linhas: [...linhasIniciais],
    leituras: 0,
  };
  const eventos: EventoVisual[] = [];

  const laco = new PercepcaoLocal({
    janela: async () => ({
      handle: '0x1',
      titulo: mundo.titulo,
      processo: mundo.processo,
      largura: 800,
      altura: 600,
    }),
    quadro: async () => ({ cinza: mundo.tela, ms: 40 }),
    texto: async () => {
      mundo.leituras += 1;
      return { linhas: mundo.linhas, ms: 90 };
    },
    agora: () => mundo.agora,
    emitir: (e) => eventos.push(e),
    indicar: () => {},
  });

  return { laco, mundo, eventos };
}

async function passar(laco: PercepcaoLocal, mundo: { agora: number }, ms = INTERVALO_OCR_MS) {
  mundo.agora += ms;
  await laco.tique();
}

test('M9. NENHUM dado sensível aparece no evento que sairia pelo socket', async () => {
  const { laco, mundo, eventos } = montar([
    'Cliente ACME LTDA',
    'CNPJ 12.345.678/0001-95',
    'Motorista CPF 123.456.789-09',
    'Placa ABC1D23',
    'Fone (19) 99999-8888',
    'daiane@atoslog.com.br',
    'Frete R$ 1.234,56',
  ]);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  /* Texto novo o bastante para virar mudança: é assim que ele chega ao evento. */
  mundo.linhas = [...mundo.linhas, 'CT-e 351234567890123', 'Erro 1145 ao transmitir'];
  await passar(laco, mundo);

  const comTexto = eventos.filter((e) => e.texto);
  assert.ok(comTexto.length > 0, 'nenhum evento carregou texto — o OCR não foi usado');

  const tudo = comTexto.map((e) => e.texto).join('\n');
  for (const sensivel of [
    '12.345.678/0001-95',
    '123.456.789-09',
    'ABC1D23',
    '99999-8888',
    'daiane@atoslog.com.br',
    '1.234,56',
    '351234567890123',
  ]) {
    assert.ok(!tudo.includes(sensivel), `"${sensivel}" ATRAVESSOU no evento:\n${tudo}`);
  }
  assert.ok(tudo.includes('ACME LTDA'), 'a máscara comeu o que não era sensível');
  assert.ok(tudo.includes('1145'), 'o código do erro foi perdido');
});

test('M10. digitar dentro da janela vira evento — o buraco que o P0 tinha', async () => {
  const { laco, mundo, eventos } = montar(['Consulta de coletas', 'Campo vazio']);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);
  assert.equal(eventos.filter((e) => e.tipo === 'mudanca_visual').length, 0);

  /* O QUADRO NÃO MUDA — `mundo.tela` é o mesmo. Só o texto muda, que é
     exatamente o caso que a prova de 21/08/2026 mostrou não ser detectado. */
  mundo.linhas = ['Consulta de coletas', 'Coleta 0001', 'Coleta 0002'];
  await passar(laco, mundo);

  const mudancas = eventos.filter((e) => e.tipo === 'mudanca_visual');
  assert.equal(mudancas.length, 1, 'a digitação dentro da janela continuou invisível');
  assert.equal(mudancas[0].origem, 'ocr', 'o evento não declarou que veio do texto');
  assert.equal(mudancas[0].distancia, 0, 'a imagem não mudou: a distância tinha de ser 0');
});

test('M11. uma linha que só APARECE não vira evento', async () => {
  const { laco, mundo, eventos } = montar(['Consulta de coletas', 'Total 10']);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  /**
   * A PRIMEIRA VERSÃO DESTE TESTE ESTAVA ERRADA, e a medição é quem disse.
   *
   * Ele simulava o OCR trocando "coletas" por "coIetas" e exigia silêncio. Duas
   * coisas: a contagem é simétrica, então uma linha SUBSTITUÍDA soma 2 e passa
   * do limiar; e `calibrar-percepcao.ts 25 --texto`, rodado numa janela parada
   * de verdade, mediu ruído **zero** — o OCR do Windows não faz essa troca
   * sozinho. O teste protegia contra um fantasma e, ao fazê-lo, exigiria um
   * limiar alto o bastante para cegar a detecção de campo preenchido.
   *
   * O ruído real que resta é outro: uma linha de borda que o OCR pega numa
   * leitura e não na seguinte. Isso soma 1, e é isso que precisa ficar quieto.
   */
  mundo.linhas = ['Consulta de coletas', 'Total 10', 'v2.1.4'];
  await passar(laco, mundo);
  assert.equal(
    eventos.filter((e) => e.tipo === 'mudanca_visual').length,
    0,
    `uma linha a mais (${MIN_LINHAS_MUDADAS - 1} de churn) virou evento`,
  );
});

test('M11b. um campo PREENCHIDO vira evento — é o caso que importa no GW', async () => {
  const { laco, mundo, eventos } = montar(['Coleta', 'Motorista: (vazio)']);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  /* Uma linha cujo conteúdo muda soma 2 na contagem simétrica — e dispara. É
     exatamente o que se quer: um campo preenchido é uma linha reescrita. */
  mundo.linhas = ['Coleta', 'Motorista: JOAO'];
  await passar(laco, mundo);
  assert.equal(
    eventos.filter((e) => e.tipo === 'mudanca_visual').length,
    1,
    'preencher um campo continuou invisível',
  );
});

test('M12. mensagem nova vira `mensagem_detectada`, e a repetida não', async () => {
  const { laco, mundo, eventos } = montar(['Consulta de coletas']);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  await passar(laco, mundo);

  mundo.linhas = ['Consulta de coletas', 'Erro 1145 ao transmitir', 'Tente novamente'];
  await passar(laco, mundo);
  const mensagens = eventos.filter((e) => e.tipo === 'mensagem_detectada');
  assert.equal(mensagens.length, 1, 'a mensagem nova não foi anunciada');
  assert.match(mensagens[0].texto, /Erro 1145/);
  assert.equal(mensagens[0].hash, null, 'evento de mensagem carregou hash de quadro');

  await passar(laco, mundo);
  assert.equal(
    eventos.filter((e) => e.tipo === 'mensagem_detectada').length,
    1,
    'a mesma mensagem foi anunciada duas vezes',
  );
});

test('M13. o OCR NÃO roda a cada quadro', async () => {
  const { laco, mundo } = montar(['a', 'b']);
  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  for (let i = 0; i < 6; i += 1) await passar(laco, mundo, 1_000);
  assert.ok(
    mundo.leituras <= 2,
    `o OCR rodou ${mundo.leituras} vezes em 6 segundos — o intervalo não está sendo respeitado`,
  );
});

test('M14. sem OCR na máquina, a percepção continua detectando mudança de quadro', async () => {
  const mundo = { tela: tela(), agora: 1_000_000 };
  const eventos: EventoVisual[] = [];
  const laco = new PercepcaoLocal({
    janela: async () => ({
      handle: '0x1',
      titulo: 'consulta',
      processo: 'gw',
      largura: 800,
      altura: 600,
    }),
    quadro: async () => ({ cinza: mundo.tela, ms: 40 }),
    /* `texto` AUSENTE: é a máquina sem pacote de idioma do Windows. */
    agora: () => mundo.agora,
    emitir: (e) => eventos.push(e),
    indicar: () => {},
  });

  laco.iniciar('s1', { processos: ['gw'] }, ACEITE);
  mundo.agora += 1_000;
  await laco.tique();
  assert.ok(eventos.length > 0, 'sem OCR o laço parou de funcionar');
  assert.equal(eventos.every((e) => e.texto === ''), true, 'inventou texto sem OCR');
});

// ---------------------------------------------------------------------------
// 3. A fronteira e o texto
// ---------------------------------------------------------------------------

const BASE: EventoVisual = {
  tipo: 'mudanca_visual',
  sessao_percepcao: 'sp-1',
  instante: '2026-08-21T12:00:00.000Z',
  janela: { processo: 'gw', assinatura: 'consulta', largura: 800, altura: 600 },
  hash: '0123456789abcdef',
  distancia: 20,
  origem: 'ocr',
  motivo: '',
  texto: 'Consulta de coletas',
};

test('M15. evento de ciclo de vida NÃO pode carregar o texto da tela', () => {
  assert.ok(lerEventoVisual(BASE));
  assert.ok(
    lerEventoVisual({ ...BASE, tipo: 'mensagem_detectada', hash: null, distancia: null }),
    'mensagem_detectada deveria poder carregar texto',
  );
  for (const tipo of ['sessao_iniciada', 'sessao_encerrada', 'percepcao_suspensa']) {
    assert.equal(
      lerEventoVisual({ ...BASE, tipo, hash: null, distancia: null }),
      null,
      `${tipo} atravessou carregando o conteúdo da tela`,
    );
  }
});

test('M16. texto grande demais é recusado na fronteira', () => {
  assert.equal(lerEventoVisual({ ...BASE, texto: 'x'.repeat(2_001) }), null);
  assert.ok(lerEventoVisual({ ...BASE, texto: 'x'.repeat(1_999) }));
});

test('M17. `ocr` é origem válida; qualquer outra continua recusada', () => {
  assert.ok(lerEventoVisual({ ...BASE, origem: 'ocr' }));
  assert.ok(lerEventoVisual({ ...BASE, origem: 'hash_de_quadro' }));
  assert.equal(lerEventoVisual({ ...BASE, origem: 'llm' }), null);
  assert.equal(lerEventoVisual({ ...BASE, origem: 'modelo_de_visao' }), null);
});
