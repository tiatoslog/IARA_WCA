/**
 * A LISTAGEM TRUNCADA NÃO É FONTE DE VERDADE.
 *
 * O DEFEITO (produção, 18/08/2026), e ele apareceu DEPOIS de o motor já estar
 * correto. Perguntada "quantos motoristas diferentes temos?", a IARA respondeu:
 *
 *   "eram 15 motoristas na lista principal mais 60 outros grupos — o que dá
 *    75 motoristas diferentes ao todo (incluindo o grupo 'sem motorista')."
 *
 * São 73. `contarDistintos` já devolvia 73. O que não existia era uma
 * capacidade DECLARADA para a pergunta — então a LLM somou o RODAPÉ de uma
 * listagem truncada em 15 itens e apresentou o resultado como contagem.
 *
 * A LIÇÃO, que vale para o catálogo inteiro: capacidade que existe no motor e
 * não existe no manifesto é capacidade que não existe. Motor certo com
 * roteamento improvisado entrega número errado com a mesma cara de número
 * certo — e "15 + 60 = 75" é aritmética impecável sobre a premissa errada.
 *
 * O CASO CENTRAL DESTE ARQUIVO reproduz a armadilha: um conjunto grande o
 * bastante para a listagem truncar, com o rodapé "e mais N" presente, e a
 * exigência de que a contagem NÃO seja derivável dele.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  agregarCargas,
  contarCargas,
  contarDistintos,
  dimensaoAusente,
  normalizarStatus,
  type CargaCompleta,
} from '../servidor/nucleo/ClientePlanilhaOcis';

const carga = (oci: string, motorista: string, valor: number | null = 100): CargaCompleta => ({
  ano: '2026',
  oci,
  origem: 'SP',
  uf_origem: 'SP',
  destino: 'MT',
  uf_destino: 'MT',
  motorista,
  data_rec_oci: '2026-01-05',
  data_coleta: '2026-01-05',
  data_descarga: '2026-01-05',
  status: 'FINALIZADO',
  status_normalizado: normalizarStatus('FINALIZADO'),
  valor,
});

/**
 * O CASO OBRIGATÓRIO — 73 motoristas reais, 130 cargas órfãs, listagem que
 * trunca em 15. É a forma exata do incidente de produção.
 */
test('REGRESSÃO · 73 distintos, mesmo com a listagem truncando em 15 e rodapé somável', () => {
  const cargas: CargaCompleta[] = [];
  for (let i = 1; i <= 73; i++) cargas.push(carga(`OCI-${i}`, `MOTORISTA ${i}`));
  for (let i = 1; i <= 130; i++) cargas.push(carga(`OCI-ORF-${i}`, ''));

  const d = contarDistintos(cargas, 'motorista');
  assert.equal(d.distintos, 73, 'a contagem determinística é 73');
  assert.equal(d.ausentes, 130, 'e as 130 órfãs saem declaradas, nunca somadas');

  /* A listagem que enganou a LLM: 74 grupos (73 + o dos ausentes), truncada em
     15, com rodapé "e mais 59". Somar 15 + 59 dá 74; somar como ela somou dá
     75. Nenhum dos dois é a resposta — e é por isso que o número não pode sair
     daqui. */
  const grupos = agregarCargas(cargas, 'motorista');
  assert.equal(grupos.length, 74, 'a listagem tem 74 grupos, incluindo o dos ausentes');
  const TOPO = 15;
  const rodape = grupos.length - TOPO;
  assert.equal(TOPO + rodape, 74, 'a aritmética do rodapé chega a 74, não a 73');
  assert.notEqual(
    TOPO + rodape,
    d.distintos,
    'se a soma da listagem coincidir com a contagem, este teste para de provar algo',
  );
});

test('zero ausentes · a contagem não muda de regra quando não há órfã', () => {
  const cargas = [carga('A', 'LINO'), carga('B', 'LAUDIR'), carga('C', 'LINO')];
  const d = contarDistintos(cargas, 'motorista');
  assert.equal(d.distintos, 2);
  assert.equal(d.ausentes, 0);
  /* O atalho `grupos.length - 1` daria 1 aqui — errado. É o motivo de a
     correção não ter sido feita assim. */
  assert.equal(agregarCargas(cargas, 'motorista').length - 1, 1, 'o atalho erraria');
});

test('todos ausentes · zero distintos, e a ausência é dita', () => {
  const cargas = [carga('A', ''), carga('B', '   '), carga('C', '')];
  const d = contarDistintos(cargas, 'motorista');
  assert.equal(d.distintos, 0, 'nenhum motorista — e zero aqui é medição, não recusa');
  assert.equal(d.ausentes, 3);
});

test('duplicidade · o mesmo motorista em muitas cargas conta uma vez', () => {
  const cargas = Array.from({ length: 40 }, (_, i) => carga(`OCI-${i}`, 'LINO'));
  assert.equal(contarDistintos(cargas, 'motorista').distintos, 1);
  assert.equal(contarCargas(cargas).unicas, 40, 'e as 40 cargas continuam sendo 40');
});

test('conjunto vazio · zero distintos e zero ausentes, sem exceção', () => {
  const d = contarDistintos([], 'motorista');
  assert.equal(d.distintos, 0);
  assert.equal(d.ausentes, 0);
});

/**
 * A AUSÊNCIA REAL DA FONTE é a célula vazia — que chega como `None` do Excel e
 * vira string vazia em `CargaCompleta`. Medido: 129 casos em 2681 linhas, zero
 * sentinelas textuais.
 */
test('ausência real · vazio e espaços contam como ausência; texto não', () => {
  assert.equal(dimensaoAusente(''), true);
  assert.equal(dimensaoAusente('   '), true);
  assert.equal(dimensaoAusente(null), true);
  assert.equal(dimensaoAusente(undefined), true);
  assert.equal(dimensaoAusente('N/A'), false);
  assert.equal(dimensaoAusente('SEM MOTORISTA'), false);
});

/** Caixa e acento não criam motorista novo. */
test('normalização · "lino" e "LINO" são a mesma pessoa', () => {
  const cargas = [carga('A', 'lino'), carga('B', 'LINO'), carga('C', ' Lino ')];
  assert.equal(contarDistintos(cargas, 'motorista').distintos, 1);
});

/** A métrica vale para outras dimensões, não só motorista. */
test('a contagem distinta serve a qualquer dimensão declarada', () => {
  const cargas = [
    { ...carga('A', 'LINO'), destino: 'MT', uf_destino: 'MT' },
    { ...carga('B', 'LAUDIR'), destino: 'GO', uf_destino: 'GO' },
    { ...carga('C', 'MOLINA'), destino: 'MT', uf_destino: 'MT' },
  ];
  assert.equal(contarDistintos(cargas, 'destino').distintos, 2);
  assert.equal(contarDistintos(cargas, 'uf_destino').distintos, 2);
});
