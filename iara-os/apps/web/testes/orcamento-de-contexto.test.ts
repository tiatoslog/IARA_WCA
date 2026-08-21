/**
 * O ORÇAMENTO DE CONTEXTO E O RECUO DA CARÊNCIA — os dois últimos buracos da
 * Fase 2 do router.
 *
 * O histórico era limitado por CONTAGEM, nunca por tamanho: bastava alguém colar
 * um trecho de planilha para todo turno seguinte daquela conversa nascer maior
 * que a janela inteira da camada gratuita. E a carência tratava a terceira queda
 * do mesmo provedor como se fosse a primeira.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  apararHistorico,
  tetoDeContexto,
  TETO_CONTEXTO_PADRAO_TOKENS,
} from '../servidor/nucleo/kernel/OrcamentoDeContexto';
import {
  carenciaEfetiva,
  emCarencia,
  limparFalhasObservadas,
  registrarFalhaProvedor,
  registrarSucessoProvedor,
  falhasObservadas,
} from '../servidor/nucleo/CadeiaDeRaciocinio';

const reg = (texto: string, i: number) =>
  ({
    id: `r${i}`,
    id_usuario: 'u',
    instante: new Date(2026, 7, 19, 9, i).toISOString(),
    papel: (i % 2 === 0 ? 'operador' : 'iara') as 'operador' | 'iara',
    texto,
  }) as never;

// ---------------------------------------------------------------------------
// Orçamento de contexto
// ---------------------------------------------------------------------------

test('X1. histórico curto passa inteiro', () => {
  const h = [reg('oi', 0), reg('olá', 1)];
  const r = apararHistorico(h, 1000);
  assert.equal(r.mantidos.length, 2);
  assert.equal(r.descartados, 0);
});

test('X2. o que não cabe é cortado pelo COMEÇO — a última troca é a que importa', () => {
  /* Cortar o meio produziria conversa que salta; cortar o fim responderia à
     pergunta anterior. */
  const h = [reg('a'.repeat(4000), 0), reg('b'.repeat(4000), 1), reg('recente', 2)];
  const r = apararHistorico(h, 1200);
  assert.equal(r.mantidos.at(-1)?.texto, 'recente');
  assert.ok(r.descartados > 0);
  assert.ok(!r.mantidos.some((m) => m.texto.startsWith('a')), 'o mais antigo sobreviveu');
});

test('X3. contagem não é tamanho — vinte mensagens grandes estouram', () => {
  /**
   * O defeito que este módulo fecha. Vinte registros era o teto ANTES; vinte de
   * quatro mil caracteres são ~20 mil tokens, mais que a janela inteira da
   * camada gratuita da Groq (8.000, medido).
   */
  const h = Array.from({ length: 20 }, (_, i) => reg('x'.repeat(4000), i));
  const r = apararHistorico(h, TETO_CONTEXTO_PADRAO_TOKENS);
  assert.ok(r.tokens <= TETO_CONTEXTO_PADRAO_TOKENS + 1000, `ficaram ${r.tokens} tokens`);
  assert.ok(r.descartados >= 18);
});

test('X4. um registro sozinho maior que o teto AINDA entra', () => {
  /**
   * É quase sempre a última fala do operador — o próprio pedido que ele acabou
   * de colar. Descartá-lo por tamanho faria a IARA responder à conversa sem
   * responder à pergunta.
   */
  const h = [reg('gigante'.repeat(5000), 0)];
  const r = apararHistorico(h, 10);
  assert.equal(r.mantidos.length, 1);
  assert.equal(r.descartados, 0);
});

test('X5. histórico ausente ou vazio não derruba nada', () => {
  /* Quarta vez que uma peça nova encontraria campo obrigatório ausente. */
  assert.deepEqual(apararHistorico(undefined as never, 100).mantidos, []);
  assert.deepEqual(apararHistorico([], 100).mantidos, []);
});

test('X6. teto inválido no ambiente cai no padrão em vez de zerar a memória', () => {
  /* Zero desligaria a memória inteira em silêncio, e "a IARA não lembra de
     nada" é indistinguível de "a IARA está com defeito". */
  for (const valor of ['0', '']) {
    assert.equal(
      tetoDeContexto({ IARA_ORCAMENTO_CONTEXTO_TOKENS: valor } as never),
      TETO_CONTEXTO_PADRAO_TOKENS,
    );
  }
  assert.equal(tetoDeContexto({ IARA_ORCAMENTO_CONTEXTO_TOKENS: '5000' } as never), 5000);
});

// ---------------------------------------------------------------------------
// Recuo da carência
// ---------------------------------------------------------------------------

test('X7. falha repetida da MESMA classe dobra a carência', () => {
  /**
   * Medido em 18 e 19/08/2026: o Gemini devolveu `503` três vezes seguidas,
   * levando 5,2 s, 21,9 s e 43,6 s para dizer que estava fora. Entre elas a
   * carência de dois minutos expirava e ele voltava para a frente da fila —
   * para cair de novo, pelo mesmo motivo, cobrando a mesma espera.
   */
  limparFalhasObservadas();
  const erro = new Error('gemini respondeu 503: high demand');
  registrarFalhaProvedor('gemini', erro);
  const uma = carenciaEfetiva(falhasObservadas().get('gemini')!);
  registrarFalhaProvedor('gemini', erro);
  const duas = carenciaEfetiva(falhasObservadas().get('gemini')!);
  registrarFalhaProvedor('gemini', erro);
  const tres = carenciaEfetiva(falhasObservadas().get('gemini')!);

  assert.equal(duas, uma * 2);
  assert.equal(tres, uma * 4);
  limparFalhasObservadas();
});

test('X8. classe DIFERENTE não herda o recuo anterior', () => {
  /* Um 503 depois de um rate_limit é outro problema; herdar o recuo puniria o
     elo por um defeito que não é o dele. */
  limparFalhasObservadas();
  registrarFalhaProvedor('x', new Error('429 rate limit'));
  registrarFalhaProvedor('x', new Error('429 rate limit'));
  registrarFalhaProvedor('x', new Error('503 unavailable'));
  assert.equal(falhasObservadas().get('x')?.seguidas, 1);
  limparFalhasObservadas();
});

test('X9. sucesso zera a reincidência', () => {
  limparFalhasObservadas();
  const erro = new Error('503 unavailable');
  registrarFalhaProvedor('y', erro);
  registrarFalhaProvedor('y', erro);
  registrarSucessoProvedor('y');
  assert.equal(emCarencia('y'), false);
  registrarFalhaProvedor('y', erro);
  assert.equal(falhasObservadas().get('y')?.seguidas, 1, 'o recuo sobreviveu ao sucesso');
  limparFalhasObservadas();
});

test('X10. o recuo tem TETO — provedor fora do ar não some por semanas', () => {
  /**
   * Sem teto, um provedor fora do ar por um dia sairia da fila por semanas — e
   * voltar a tentá-lo é justamente como o sistema descobre que ele voltou.
   * Mesma razão de `ordenarPorSaude` reordenar em vez de remover.
   */
  limparFalhasObservadas();
  const erro = new Error('503 unavailable');
  for (let i = 0; i < 12; i += 1) registrarFalhaProvedor('z', erro);
  const falha = falhasObservadas().get('z')!;
  registrarFalhaProvedor('z2', erro);
  const base = carenciaEfetiva(falhasObservadas().get('z2')!);
  assert.equal(carenciaEfetiva(falha), base * 8);
  limparFalhasObservadas();
});
