/**
 * AS ROTAS COGNITIVAS — cada família de turno tem entrada, contrato, rota e
 * saída coerentes entre si.
 *
 * ===========================================================================
 * A PERGUNTA
 * ===========================================================================
 *
 * Os outros testes desta pasta perguntam se a IARA entende. Este pergunta outra
 * coisa: entendendo, ela toma a DECISÃO do tipo certo? Conversa é respondida,
 * pergunta de fato é executada, pedido incompleto é esclarecido, e nada disso
 * se confunde.
 *
 * `acao` e `rota` são campos separados no `Decisao` de propósito, e este arquivo
 * é o que usa a separação: `rota` é o mecanismo interno (que planejador roda),
 * `acao` é a decisão no vocabulário do domínio. Medir "quantas vezes a IARA
 * perguntou em vez de adivinhar" precisa de `acao`; medir custo precisa de
 * `rota`. Um teste que só olhasse uma das duas deixaria a outra livre.
 *
 * ===========================================================================
 * ATÉ ONDE ESTE TESTE VAI
 * ===========================================================================
 *
 * Até a DECISÃO, e — quando a rota é determinística — até o plano montado.
 * `plano_cognitivo` depende de uma chamada de LLM que não existe aqui: o que se
 * verifica dela é o que é verificável offline, que é a decisão de OFERECER o
 * catálogo. Nenhum efeito acontece; nada toca disco, rede ou agenda.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { compreender } from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { FuncaoExecutiva } from '../../servidor/nucleo/kernel/FuncaoExecutiva';
import { Planejador } from '../../servidor/nucleo/kernel/Planejador';
import { MemoriaTrabalho } from '../../servidor/nucleo/kernel/MemoriaTrabalho';
import { MotorPercepcao } from '../../servidor/nucleo/kernel/Percepcao';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const descoberta = new DescobertaCapacidades(MANIFESTOS);
const conceitual = new IndiceConceitual(MANIFESTOS);
const percepcao = new MotorPercepcao();
const AGORA = new Date('2026-08-19T10:00:00');

function turno(mensagem: string) {
  const contrato = compreender({
    bruto: mensagem,
    descoberta,
    conceitual,
    agora: AGORA,
    habilidades: MANIFESTOS,
  });
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
    () => ({ ato: contrato.ato, objetivo: contrato.objetivo, operacao: contrato.operacao }),
  );
  const p = percepcao.perceber(mensagem);
  return { contrato, decisao: executiva.decidir(p, { historicoRecente: [], pessoasConhecidas: [] }), p };
}

interface Rota {
  readonly nome: string;
  readonly mensagem: string;
  /** O ato que um humano diz que a frase é. */
  readonly ato: string;
  /** A ação no vocabulário do domínio — o que a IARA vai FAZER. */
  readonly acao: string;
  /** `custo_estimado`: conversa e receita local não pagam tokens de plano. */
  readonly rotas: readonly string[];
}

/**
 * AS OITO FAMÍLIAS. Cada linha foi MEDIDA antes de ser escrita — escrever a
 * expectativa antes de olhar produziria um gabarito sobre o meu gosto, e a
 * primeira versão do Arnês C já reprovou 8 de 13 casos exatamente assim.
 *
 * O que está travado é a COERÊNCIA entre ato, ação e rota, não o número: se a
 * IARA passar a mandar conversa para o planejador, ou a executar um pedido
 * incompleto sem perguntar, alguma destas linhas fica vermelha.
 */
const ROTAS: readonly Rota[] = [
  {
    nome: 'conversa',
    mensagem: 'como você está?',
    ato: 'conversar',
    acao: 'responder',
    rotas: ['raciocinio_direto'],
  },
  {
    nome: 'pergunta factual',
    mensagem: 'quantas cargas foram coletadas essa semana?',
    ato: 'perguntar',
    acao: 'responder',
    /** Receita determinística: a contagem da LUFT tem caminho de custo zero. */
    rotas: ['plano_local'],
  },
  {
    nome: 'análise',
    mensagem: 'analisa as cargas dessa semana',
    ato: 'solicitar_acao',
    acao: 'criar_plano',
    rotas: ['plano_cognitivo'],
  },
  {
    nome: 'comparação',
    mensagem: 'compara 2025 com 2026',
    ato: 'solicitar_acao',
    acao: 'criar_plano',
    rotas: ['plano_cognitivo'],
  },
  {
    nome: 'recapitulação',
    mensagem: 'o que eu marquei com você?',
    ato: 'recapitular',
    acao: 'criar_plano',
    rotas: ['plano_cognitivo', 'plano_local'],
  },
  {
    nome: 'esclarecimento',
    mensagem: 'me manda esse relatório',
    ato: 'solicitar_acao',
    acao: 'perguntar',
    rotas: ['esclarecer'],
  },
  {
    nome: 'planejamento',
    mensagem: 'abre o bloco de notas e tira um print',
    ato: 'solicitar_acao',
    acao: 'executar',
    rotas: ['plano_local'],
  },
  {
    nome: 'raciocínio',
    mensagem: 'qual o sentido da vida?',
    ato: 'perguntar',
    acao: 'criar_plano',
    /**
     * Pergunta de FORMA factual sem habilidade correspondente paga uma chamada
     * de planejamento e volta só-raciocínio — e vira `LacunaCapacidade`. É custo
     * declarado no cabeçalho de `PERGUNTA_DE_FATO`: a fila de evolução do
     * catálogo depende de a frase chegar lá para ser registrada.
     */
    rotas: ['plano_cognitivo'],
  },
];

for (const r of ROTAS) {
  test(`rota cognitiva ${r.nome}: « ${r.mensagem} »`, () => {
    const { contrato, decisao } = turno(r.mensagem);
    assert.equal(contrato.ato, r.ato, `ato`);
    assert.equal(decisao.acao, r.acao, `ação (rota veio "${decisao.rota}")`);
    assert.ok(
      r.rotas.includes(decisao.rota),
      `rota "${decisao.rota}" fora de ${JSON.stringify(r.rotas)} — ${decisao.justificativa}`,
    );
  });
}

test('as oito rotas não colapsam entre si', () => {
  /**
   * O LADO SIMÉTRICO. Oito famílias que produzissem todas a mesma decisão
   * passariam nos testes acima se as expectativas fossem frouxas. Aqui se exige
   * que o conjunto tenha DIVERSIDADE real: se a IARA passar a responder tudo do
   * mesmo jeito, isto fica vermelho.
   */
  const acoes = new Set(ROTAS.map((r) => turno(r.mensagem).decisao.acao));
  const rotas = new Set(ROTAS.map((r) => turno(r.mensagem).decisao.rota));
  assert.ok(acoes.size >= 4, `só ${acoes.size} ações distintas em 8 famílias: ${[...acoes]}`);
  assert.ok(rotas.size >= 3, `só ${rotas.size} rotas distintas em 8 famílias: ${[...rotas]}`);
});

test('rota determinística entrega plano com passos; conversa não entrega plano', () => {
  /**
   * A SAÍDA DA ROTA, que é o elo que o Arnês C chama de D. Decidir `plano_local`
   * e entregar zero passos é uma cadeia que termina em nada, e nenhum teste de
   * decisão acusa isso.
   */
  const local = turno('abre o bloco de notas e tira um print');
  assert.equal(local.decisao.rota, 'plano_local');
  assert.ok(
    new Planejador().planejar(local.p).passos.length > 0,
    'a receita determinística tem que produzir passos',
  );

  const conversa = turno('como você está?');
  assert.equal(conversa.decisao.rota, 'raciocinio_direto', 'conversa não tem o que planejar');
});

test('esclarecer sempre traz a pergunta literal', () => {
  /**
   * Perguntar sem pergunta é a rota mais inútil que existe: o operador vê a IARA
   * parar e não sabe o que ela quer. `pergunta` é campo obrigatório desta rota
   * na prática, e este teste é o que torna isso verdade.
   */
  const { decisao } = turno('me manda esse relatório');
  assert.equal(decisao.rota, 'esclarecer');
  assert.ok(decisao.pergunta && decisao.pergunta.length > 0, 'esclarecer sem pergunta');
  assert.ok(decisao.ambiguidade, 'e sem dizer o que estava indeterminado');
});
