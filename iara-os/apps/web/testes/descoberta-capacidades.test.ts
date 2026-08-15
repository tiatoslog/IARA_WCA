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

test('planejar() mostra os exemplos das habilidades à LLM', async () => {
  const { MotorRaciocinio } = await import('../servidor/nucleo/kernel/MotorRaciocinio');
  let mensagemVista = '';
  const claudeFalso = {
    disponivel: true,
    async raciocinar(p: { mensagem: string }) {
      mensagemVista = p.mensagem;
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
  assert.match(
    mensagemVista,
    /exemplos: "Qual motorista tem mais cargas\?"/,
    'a lista de habilidades do prompt tem que trazer os exemplos do manifesto',
  );
});
