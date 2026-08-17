/**
 * O CÉREBRO QUE ACABOU DE FALHAR NÃO É O PRIMEIRO A SER TENTADO DE NOVO.
 *
 * O DEFEITO, medido em 17/08/2026: a cadeia sabia trocar de provedor quando a
 * cota da Anthropic acabou, e continuava tentando a Anthropic PRIMEIRO em todo
 * turno seguinte. `observacoes` registrava "cota esgotada" e nada no caminho de
 * execução lia esse registro — `raciocinar` filtrava por `disponivel`, que só
 * diz que a chave está no ambiente.
 *
 * O custo era por turno: uma ida à rede que já se sabia perdida, até o timeout,
 * antes do pedido que ia de fato responder.
 *
 * Ver `CadeiaDeRaciocinio.ordenarPorSaude` e `CARENCIA_MS`.
 */

import { strict as assert } from 'node:assert';
import test, { beforeEach } from 'node:test';
import {
  CARENCIA_MS,
  CadeiaDeRaciocinio,
  emCarencia,
  limparFalhasObservadas,
  ordenarPorSaude,
  registrarFalhaProvedor,
  registrarSucessoProvedor,
} from '../servidor/nucleo/CadeiaDeRaciocinio';
import {
  ProvedorIndisponivel,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from '../servidor/nucleo/ProvedorRaciocinio';

beforeEach(() => limparFalhasObservadas());

/** Um elo de mentira que conta quantas vezes foi chamado. */
function elo(
  apelido: string,
  comportamento: 'responde' | 'quota' | 'fora',
): ProvedorRaciocinio & { chamadas: number } {
  const p = {
    apelido,
    origem: 'nuvem' as const,
    modelo: `modelo-${apelido}`,
    disponivel: true,
    chamadas: 0,
    async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
      p.chamadas += 1;
      if (comportamento === 'quota') {
        throw new Error('Your credit balance is too low to access the Anthropic API');
      }
      if (comportamento === 'fora') throw new ProvedorIndisponivel('serviço fora');
      pedido.aoReceberTexto('ok');
      return {
        texto: 'ok',
        tokens_entrada: 0,
        tokens_saida: 0,
        cache_lido: 0,
        recusado: false,
      } satisfies RespostaRaciocinio;
    },
  };
  return p;
}

function pedido(): PedidoRaciocinio {
  return {
    sistema: 's',
    mensagens: [{ papel: 'operador', conteudo: 'oi' }],
    aoReceberTexto: () => undefined,
    sinal: new AbortController().signal,
  } as unknown as PedidoRaciocinio;
}

test('a cota esgotada põe o provedor em carência', () => {
  registrarFalhaProvedor('anthropic', new Error('credit balance is too low'));
  assert.equal(emCarencia('anthropic'), true);
  // E ela expira: a conta pode ter sido recarregada.
  const depois = Date.now() + CARENCIA_MS.quota + 1;
  assert.equal(emCarencia('anthropic', depois), false);
});

test('o limite de taxa expira MUITO antes da cota', () => {
  assert.ok(
    CARENCIA_MS.rate_limit < CARENCIA_MS.quota,
    'um 429 dura segundos; crédito zerado depende de alguém agir fora do sistema',
  );
});

test('sucesso devolve o provedor à frente da fila imediatamente', () => {
  registrarFalhaProvedor('anthropic', new Error('quota'));
  assert.equal(emCarencia('anthropic'), true);
  registrarSucessoProvedor('anthropic');
  assert.equal(emCarencia('anthropic'), false);
});

test('ordenarPorSaude reordena e NUNCA remove', () => {
  registrarFalhaProvedor('anthropic', new Error('credit balance too low'));
  const fila = ordenarPorSaude([{ apelido: 'anthropic' }, { apelido: 'groq' }]);
  assert.deepEqual(
    fila.map((e) => e.apelido),
    ['groq', 'anthropic'],
    'o que falhou vai para o fim — mas continua na fila',
  );
});

test('com TODOS em carência a ordem original volta inteira', () => {
  // Trocar lentidão por morte seria pior que o defeito. Pior caso = o de antes.
  registrarFalhaProvedor('anthropic', new Error('quota'));
  registrarFalhaProvedor('groq', new Error('quota'));
  const fila = ordenarPorSaude([{ apelido: 'anthropic' }, { apelido: 'groq' }]);
  assert.deepEqual(fila.map((e) => e.apelido), ['anthropic', 'groq']);
});

test('a preferência declarada continua mandando entre os saudáveis', () => {
  registrarFalhaProvedor('groq', new Error('quota'));
  const fila = ordenarPorSaude([
    { apelido: 'anthropic' },
    { apelido: 'groq' },
    { apelido: 'gemini' },
  ]);
  assert.deepEqual(
    fila.map((e) => e.apelido),
    ['anthropic', 'gemini', 'groq'],
    'a carência decide o grupo, não a hierarquia dentro dele',
  );
});

test('INTEGRAÇÃO: o provedor sem crédito deixa de ser tentado no turno seguinte', async () => {
  const morto = elo('anthropic', 'quota');
  const vivo = elo('groq', 'responde');
  const cadeia = new CadeiaDeRaciocinio([morto, vivo]);

  await cadeia.raciocinar(pedido());
  assert.equal(morto.chamadas, 1, 'o primeiro turno paga a descoberta — não há como saber antes');
  assert.equal(vivo.chamadas, 1);

  // O turno seguinte é o que importa: antes da correção, `morto` era tentado
  // de novo, e de novo, em toda mensagem.
  await cadeia.raciocinar(pedido());
  await cadeia.raciocinar(pedido());

  assert.equal(
    morto.chamadas,
    1,
    `o provedor sem crédito foi tentado ${morto.chamadas}× — a carência não segurou`,
  );
  assert.equal(vivo.chamadas, 3, 'e quem responde continua respondendo em todos os turnos');
  assert.equal(cadeia.apelido, 'groq');
});

test('INTEGRAÇÃO: quando o crédito volta, o provedor preferido volta com ele', async () => {
  const anthropic = elo('anthropic', 'quota');
  const groq = elo('groq', 'responde');
  const cadeia = new CadeiaDeRaciocinio([anthropic, groq]);

  await cadeia.raciocinar(pedido());
  assert.equal(cadeia.apelido, 'groq');

  // A operadora recarrega a conta. Ninguém avisa o sistema — é o que acontece
  // de verdade. A carência expira sozinha e o preferido é tentado de novo.
  limparFalhasObservadas();
  await cadeia.raciocinar(pedido());
  assert.equal(anthropic.chamadas, 2, 'o preferido voltou a ser o primeiro da fila');
});
