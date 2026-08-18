/**
 * A IARA SÓ PODE PROMETER O QUE CHEGA A UMA RECEITA.
 *
 * O DEFEITO MEDIDO EM PRODUÇÃO (18/08/2026). Com a nuvem fora, a IARA dizia:
 * "continuo com o que é local: clima, hora, infraestrutura, histórico e busca".
 * A operadora pediu três dessas cinco e recebeu, nas três, a MESMA frase que
 * acabara de prometê-las.
 *
 * O diagnóstico não era o esperado. As receitas existiam — `RECEITAS` tem
 * `infraestrutura`, `busca` e `incidente`. O que faltava era a ÂNCORA: nenhuma
 * delas reconhecia a frase que a própria mensagem anunciava. "infraestrutura"
 * não era reconhecida pela palavra "infraestrutura" (a âncora só casava
 * "quantas centrais", "frota ativa"), e `busca` exigia o substantivo exato
 * "busca na internet" — a operadora escreveu "busque", e errou por uma letra.
 *
 * Por isso o portão é ponta a ponta, e não uma checagem de que a chave existe em
 * `RECEITAS`: essa checagem passava o tempo todo. O que ninguém verificava era o
 * caminho inteiro — frase de gente → âncora → receita. É o único formato de
 * teste que teria falhado antes da operadora falhar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import {
  CAPACIDADES_SEM_NUVEM,
  Planejador,
  capacidadesSemNuvemEmTexto,
} from '../servidor/nucleo/kernel/Planejador';

test('toda capacidade anunciada sem nuvem chega mesmo a uma receita determinística', () => {
  const percepcao = new MotorPercepcao();
  const planejador = new Planejador();

  for (const cap of CAPACIDADES_SEM_NUVEM) {
    const p = percepcao.perceber(cap.exemplo);

    assert.ok(
      p.ancoras.includes(cap.ancora),
      `"${cap.exemplo}" deveria produzir a âncora "${cap.ancora}", mas produziu [${p.ancoras.join(', ')}]. ` +
        `A IARA promete "${cap.rotulo}" ao operador — se a frase não vira âncora, a promessa é falsa.`,
    );

    assert.ok(
      planejador.temReceita(p),
      `"${cap.exemplo}" produziu âncora mas não achou receita: a promessa "${cap.rotulo}" iria para a nuvem.`,
    );
  }
});

/**
 * A REGRESSÃO LITERAL, com as frases que a operadora digitou de verdade. Ficam
 * separadas do laço acima de propósito: o laço prova o contrato, estas provam o
 * incidente. Se alguém reescrever `CAPACIDADES_SEM_NUVEM` e por acaso remover o
 * caso, o incidente continua vigiado aqui.
 */
test('as frases exatas que falharam em produção agora resolvem localmente', () => {
  const percepcao = new MotorPercepcao();
  const planejador = new Planejador();

  for (const frase of [
    'busque na internet o preco atual do diesel S10',
    'busca na internet o preco do diesel',
    'procure na web o preco do diesel',
    'pesquise o preco do diesel',
  ]) {
    const p = percepcao.perceber(frase);
    assert.ok(p.ancoras.includes('busca'), `"${frase}" não virou busca — âncoras: [${p.ancoras}]`);
    assert.ok(planejador.temReceita(p), `"${frase}" não achou receita`);
  }
});

/**
 * O verbo preso ao complemento. `busc\w*` solto capturaria "busca de emprego" e
 * "busca de um novo fornecedor" — a doença de palavra genérica que a âncora
 * `infraestrutura` já pagou caro com `frota`. Sem este caso, a correção de cima
 * é livre para virar aquele bug.
 */
test('"busca" sem complemento de internet não vira busca na web', () => {
  const percepcao = new MotorPercepcao();
  for (const frase of ['faca uma busca de emprego para mim', 'a busca por um fornecedor novo']) {
    const p = percepcao.perceber(frase);
    assert.ok(
      !p.ancoras.includes('busca'),
      `"${frase}" não deveria virar busca na internet — âncoras: [${p.ancoras}]`,
    );
  }
});

/** A frase que o operador lê é montada da lista, nunca escrita à mão. */
test('a frase de capacidades vem da lista e nomeia o que a receita realmente faz', () => {
  const frase = capacidadesSemNuvemEmTexto();

  for (const cap of CAPACIDADES_SEM_NUVEM) {
    assert.ok(frase.includes(cap.rotulo), `"${cap.rotulo}" sumiu da frase`);
  }

  /* "histórico" sozinho fez a operadora pedir o histórico da CONVERSA e não
     receber nada. O rótulo precisa dizer de que histórico se trata. */
  assert.ok(
    !/histórico\s*(,|$)/.test(frase),
    `"histórico" sem qualificar é ambíguo — deve dizer de QUE histórico se trata. Frase: "${frase}"`,
  );
});
