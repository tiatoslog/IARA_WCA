/**
 * O PORTÃO DE SUPERFÍCIE, dentro da suíte.
 *
 * Ele mora aqui porque `npm test` é a única coisa que roda todo dia neste projeto:
 * um portão de regressão contínua que só roda quando alguém lembra é o mesmo
 * problema que ele existe para resolver.
 *
 * QUANDO ESTE TESTE FICAR VERMELHO, a leitura é: *"entrou (ou saiu) habilidade,
 * integração, bateria ou porta de saída, e nenhuma bateria sabia disso"*. A ordem
 * do conserto não é negociável:
 *
 *   1. rode as baterias afetadas pela mudança;
 *   2. só então `npm run superficie -- --aceitar`.
 *
 * Aceitar primeiro transforma o portão em carimbo.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compararSuperficie,
  superficieAtual,
  superficieDeclarada,
  violacoesDeSuperficie,
} from './validacao/superficie';

test('a superfície avaliável está declarada — nada entrou sem bateria saber', () => {
  const violacoes = violacoesDeSuperficie(compararSuperficie());
  assert.deepEqual(
    violacoes,
    [],
    `\n${violacoes.join('\n')}\n\nRode as baterias afetadas e depois: npm run superficie -- --aceitar\n`,
  );
});

test('a declaração não está vazia — portão sem referência não é portão', () => {
  /* Declaração ausente devolve superfície vazia, e superfície vazia compararia
     "tudo entrou" — que é reprovação, não verde. Este caso existe para o dia em
     que o arquivo for apagado por engano: o erro tem de ser sobre o arquivo, não
     sobre 63 habilidades imaginárias. */
  const d = superficieDeclarada();
  assert.ok(d.habilidades.length > 10, 'a declaração de superfície está vazia ou ilegível');
  assert.ok(d.portas_de_saida.length >= 3);
});

test('a leitura da superfície é estável — duas leituras seguidas são iguais', () => {
  /* Se a assinatura variar entre leituras (ordem de `Object.keys`, timestamp,
     caminho de arquivo), o portão acusa mudança que não houve — e um portão que
     acusa sozinho é desligado na segunda semana. */
  assert.deepEqual(superficieAtual(), superficieAtual());
});

test('o portão SABE acusar: superfície com item novo produz violação com instrução', () => {
  const atual = superficieAtual();
  const comIntruso = {
    ...atual,
    habilidades: [...atual.habilidades, 'habilidade_nova_sem_bateria|alto|escrita_nao_idempotente|verificador=false'],
  };
  const violacoes = violacoesDeSuperficie(compararSuperficie(comIntruso, atual));
  assert.equal(violacoes.length, 1);
  assert.match(violacoes[0], /habilidade_nova_sem_bateria/);
  assert.match(violacoes[0], /rode as baterias afetadas/i);
});

test('o portão acusa REMOÇÃO também — bateria que desaparece é regressão', () => {
  /* O caso perigoso e menos óbvio: alguém remove uma bateria do registro e o
     veredito passa a exigir menos prova. Sem este caso, o portão só olharia
     crescimento. */
  const atual = superficieAtual();
  const semUma = { ...atual, baterias: atual.baterias.slice(1) };
  const violacoes = violacoesDeSuperficie(compararSuperficie(semUma, atual));
  assert.equal(violacoes.length, 1);
  assert.match(violacoes[0], /saiu/);
});
