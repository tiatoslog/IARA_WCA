/**
 * Testes do gestor de erros cognitivos.
 *
 * A pergunta: **quando a IARA erra, o sistema consegue impedir que o mesmo
 * erro volte?**
 *
 * O mecanismo tem três exigências, e falhar em qualquer uma o reduz a um log:
 *   1. o defeito precisa ter identidade estável (assinatura por FORMA)
 *   2. repetições precisam colidir, não acumular linhas
 *   3. cada defeito distinto precisa render um caso de teste
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { RegistroErros, assinaturaDe } from '../servidor/nucleo/kernel/RegistroErros';

const agora = '2026-08-11T12:00:00.000Z';

function erro(classe: Parameters<typeof assinaturaDe>[0], entrada: string) {
  return {
    classe,
    entrada,
    observado: 'observado',
    esperado: 'esperado',
    instante: agora,
  };
}

test('a assinatura é da FORMA do pedido, não do conteúdo', () => {
  // Mesmo defeito, alvos diferentes: tem que colidir.
  assert.equal(
    assinaturaDe('ambiguidade_ignorada', 'manda pro João'),
    assinaturaDe('ambiguidade_ignorada', 'manda pro Pedro'),
  );
  // Números não diferenciam defeito.
  assert.equal(
    assinaturaDe('roteamento_incorreto', 'relatório de 2025'),
    assinaturaDe('roteamento_incorreto', 'relatório de 2026'),
  );
});

test('classes diferentes nunca compartilham assinatura', () => {
  assert.notEqual(
    assinaturaDe('habilidade_ausente', 'crie uma pasta'),
    assinaturaDe('falha_de_execucao', 'crie uma pasta'),
  );
});

test('repetição do mesmo defeito conta ocorrências em vez de duplicar', () => {
  const r = new RegistroErros();
  r.registrar(erro('ambiguidade_ignorada', 'manda pro João'));
  r.registrar(erro('ambiguidade_ignorada', 'manda pro Pedro'));
  const terceiro = r.registrar(erro('ambiguidade_ignorada', 'manda pro Carlos'));

  assert.equal(terceiro.ocorrencias, 3);
  assert.equal(r.inventario.length, 1, 'um defeito, não três linhas');
});

test('defeitos distintos coexistem, ordenados por frequência', () => {
  const r = new RegistroErros();
  r.registrar(erro('habilidade_ausente', 'crie uma pasta chamada X'));
  r.registrar(erro('roteamento_incorreto', 'quanto tempo leva o relatório'));
  r.registrar(erro('roteamento_incorreto', 'quanto tempo leva a carga'));

  assert.equal(r.inventario.length, 2);
  assert.equal(r.inventario[0].classe, 'roteamento_incorreto', 'mais frequente primeiro');
  assert.equal(r.inventario[0].ocorrencias, 2);
});

test('cada defeito rende um caso de teste com a entrada que o reproduz', () => {
  const r = new RegistroErros();
  const reg = r.registrar({
    classe: 'roteamento_incorreto',
    entrada: 'quanto tempo leva para gerar o relatório?',
    observado: 'âncora clima; respondeu previsão do tempo',
    esperado: 'não deve casar âncora de clima',
    instante: agora,
  });

  const caso = r.casoDeRegressao(reg);

  assert.match(caso, /^test\(/m, 'é um teste executável, não uma anotação');
  assert.match(caso, /quanto tempo leva para gerar o relat/, 'carrega a entrada que reproduz');
  assert.match(caso, /Observado: âncora clima/);
  assert.match(caso, /Esperado:\s+não deve casar/);
  assert.match(caso, /TODO/, 'a asserção é humana, de propósito');
});

/**
 * A geração é mecânica de propósito: uma asserção inventada por máquina
 * passaria a proteger o que a máquina supôs ser o problema, e um teste que
 * protege a coisa errada é pior que teste nenhum — ele dá confiança falsa.
 */
test('o caso gerado não inventa a asserção', () => {
  const r = new RegistroErros();
  const caso = r.casoDeRegressao(r.registrar(erro('afirmacao_sem_fonte', 'quantos contratos?')));
  assert.doesNotMatch(caso, /assert\.(equal|match|deepEqual)\(/, 'só assert.ok de placeholder');
});
