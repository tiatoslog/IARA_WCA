/**
 * DescobertaCapacidades — o assunto do catálogo decide se vale planejar.
 *
 * Nasceu do achado E2E de 14/08/2026: "Motoristas disponíveis agora?" não tem
 * interrogativo de fato nem verbo de comando, e morria em conversa mesmo com
 * o catálogo inteiro falando de motoristas e cargas. O índice é construído
 * dos MANIFESTOS REAIS (`CATALOGO`) de propósito: se uma habilidade nova
 * chegar com descrição vazia ou genérica demais, estes testes é que acusam.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DescobertaCapacidades } from '../servidor/nucleo/kernel/DescobertaCapacidades';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { FuncaoExecutiva } from '../servidor/nucleo/kernel/FuncaoExecutiva';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';

const descoberta = new DescobertaCapacidades(CATALOGO.map((h) => h.manifesto));
const percepcao = new MotorPercepcao();

function decidirComDescoberta(frase: string) {
  const executiva = new FuncaoExecutiva(
    new Planejador(),
    new MemoriaTrabalho(),
    ['João Silva', 'Marina Alves'],
    () => true,
    descoberta,
  );
  return executiva.decidir(percepcao.perceber(frase), {
    historicoRecente: [],
    pessoasConhecidas: ['João Silva', 'Marina Alves'],
  });
}

// ---------------------------------------------------------------------------
// O índice em si
// ---------------------------------------------------------------------------

test('frase sobre motoristas compartilha assunto com o catálogo', () => {
  assert.equal(descoberta.pareceOperacional('Motoristas disponíveis agora?'), true);
  assert.equal(descoberta.pareceOperacional('Quero saber quem fez mais viagens de carga'), true);
});

test('frases de operação sem forma de pergunta também são reconhecidas', () => {
  assert.equal(descoberta.pareceOperacional('Me mostra o faturamento das cargas'), true);
  assert.equal(descoberta.pareceOperacional('cargas coletadas na operação'), true);
});

test('conversa social não vira assunto operacional', () => {
  assert.equal(descoberta.pareceOperacional('hoje foi um dia cansativo'), false);
  assert.equal(descoberta.pareceOperacional('conte uma curiosidade'), false);
  assert.equal(descoberta.pareceOperacional('obrigada, até amanhã'), false);
});

// ---------------------------------------------------------------------------
// O portão de rota com o índice injetado
// ---------------------------------------------------------------------------

test('"Motoristas disponíveis agora?" chega ao plano cognitivo — era o buraco do E2E', () => {
  const d = decidirComDescoberta('Motoristas disponíveis agora?');
  assert.equal(d.rota, 'plano_cognitivo', 'assunto do catálogo tem que valer uma chamada de planejamento');
});

test('conversa continua em raciocínio direto mesmo com o índice presente', () => {
  const d = decidirComDescoberta('hoje foi um dia cansativo');
  assert.equal(d.rota, 'raciocinio_direto');
});

test('âncora determinística continua vencendo a descoberta', () => {
  const d = decidirComDescoberta('vai chover hoje?');
  assert.equal(d.rota, 'plano_local', 'o caminho de custo zero não pode regredir para o planejador');
});

// ---------------------------------------------------------------------------
// Manifesto rico — FASE A: exemplos e capacidades entram no índice
// ---------------------------------------------------------------------------

test('token que só existe nos exemplos alcança a habilidade (sinal forte)', () => {
  /**
   * "faturado" está no exemplo "Qual o total faturado essa semana?" de
   * consultar_estatisticas_cargas_luft — a descrição fala em "faturamento",
   * cujo radical ("faturamento") NÃO é o mesmo token de "faturado". Sem o
   * índice de exemplos, esta frase dependeria de coincidência dupla.
   */
  assert.equal(descoberta.pareceOperacional('quanto foi faturado?'), true);
  // "finalizadas" vem do exemplo "Quantas cargas estão finalizadas?".
  assert.equal(descoberta.pareceOperacional('quantas estão finalizadas?'), true);
});

test('frase de exemplo de habilidade sem âncora vai ao plano cognitivo', () => {
  // Frases literais dos exemplos novos — nenhuma tem âncora determinística.
  assert.equal(decidirComDescoberta('Qual o total faturado essa semana?').rota, 'plano_cognitivo');
  assert.equal(decidirComDescoberta('Chegou algum email da LUFT hoje?').rota, 'plano_cognitivo');
});

test('exemplos não abrem falso positivo para conversa social', () => {
  assert.equal(descoberta.pareceOperacional('hoje foi um dia cansativo'), false);
  assert.equal(descoberta.pareceOperacional('conte uma curiosidade'), false);
  assert.equal(descoberta.pareceOperacional('qual é o sentido da vida?'), false);
});

// ---------------------------------------------------------------------------
// O prompt do planejador carrega os exemplos
// ---------------------------------------------------------------------------

/**
 * A versão anterior deste teste lia só `p.mensagem` — e por isso ficou vermelha
 * numa mudança que não alterou nada do que a LLM vê: o catálogo saiu de
 * `mensagem` e foi para `capacidades`, que é o campo que os três clientes põem
 * no prefixo cacheado (19/08/2026, ~5.400 tokens que pagavam escrita cheia em
 * todo turno).
 *
 * Um teste que trava a POSIÇÃO de um bloco no pedido testa a forma do código,
 * não o comportamento. O contrato real tem duas metades, e agora as duas estão
 * escritas: o que a LLM enxerga, e onde isso viaja.
 */
test('planejar() mostra os exemplos das habilidades à LLM', async () => {
  const { MotorRaciocinio } = await import('../servidor/nucleo/kernel/MotorRaciocinio');
  let pedidoVisto: { mensagem?: string; capacidades?: string } = {};
  const claudeFalso = {
    disponivel: true,
    async raciocinar(p: { mensagem: string; capacidades?: string }) {
      pedidoVisto = p;
      return {
        texto: '{"objetivo":"t","passos":[{"descricao":"responder","habilidade":null,"parametros":{}}]}',
        tokens_entrada: 0,
        tokens_saida: 0,
        cache_lido: 0,
      };
    },
  };
  const motor = new MotorRaciocinio(
    claudeFalso as unknown as ConstructorParameters<typeof MotorRaciocinio>[0],
  );
  const plano = await motor.planejar(
    percepcao.perceber('Motoristas disponíveis agora?'),
    CATALOGO.map((h) => h.manifesto),
    new AbortController().signal,
  );
  assert.ok(plano, 'o plano do dublê tem que ser aceito');

  const tudoQueALlmVe = `${pedidoVisto.capacidades ?? ''}\n${pedidoVisto.mensagem ?? ''}`;
  assert.match(
    tudoQueALlmVe,
    /exemplos: "Qual motorista tem mais cargas\?"/,
    'a lista de habilidades do prompt tem que trazer os exemplos do manifesto',
  );
});

test('o catálogo do planejador viaja no prefixo cacheado, não na mensagem', async () => {
  /**
   * A METADE CARA DO CONTRATO. `mensagem` é, por construção, a última coisa do
   * pedido: fica depois do breakpoint de cache que `ClienteClaude`,
   * `ClienteCompativelOpenAI` e `ClienteOllama` montam. Catálogo ali é o bloco
   * mais repetido do sistema pagando escrita cheia em todo turno — e, quando o
   * laço existir, em toda volta.
   *
   * Invariante, não retrato: não trava o texto do catálogo nem o tamanho dele.
   * Trava a única coisa que importa — de que lado do breakpoint ele viaja.
   */
  const { MotorRaciocinio } = await import('../servidor/nucleo/kernel/MotorRaciocinio');
  let pedidoVisto: { mensagem?: string; capacidades?: string } = {};
  const claudeFalso = {
    disponivel: true,
    async raciocinar(p: { mensagem: string; capacidades?: string }) {
      pedidoVisto = p;
      return {
        texto: '{"objetivo":"t","passos":[{"descricao":"responder","habilidade":null,"parametros":{}}]}',
        tokens_entrada: 0,
        tokens_saida: 0,
        cache_lido: 0,
      };
    },
  };
  const motor = new MotorRaciocinio(
    claudeFalso as unknown as ConstructorParameters<typeof MotorRaciocinio>[0],
  );
  await motor.planejar(
    percepcao.perceber('Motoristas disponíveis agora?'),
    CATALOGO.map((h) => h.manifesto),
    new AbortController().signal,
  );

  const catalogo = pedidoVisto.capacidades ?? '';
  const mensagem = pedidoVisto.mensagem ?? '';

  assert.match(catalogo, /HABILIDADES DISPONÍVEIS/, 'o catálogo tem que estar em `capacidades`');
  assert.ok(
    catalogo.includes('consultar_estatisticas_cargas_luft'),
    'o catálogo em `capacidades` tem que listar as habilidades de verdade',
  );
  assert.ok(
    !mensagem.includes('consultar_estatisticas_cargas_luft'),
    'nenhum id de habilidade pode voltar para `mensagem` — é lá que o cache não alcança',
  );
  assert.ok(
    catalogo.length > mensagem.length,
    `o bloco caro tem que ser o cacheado (catálogo ${catalogo.length}, mensagem ${mensagem.length})`,
  );
});
