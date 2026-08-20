/**
 * A TRAVA DE AÇÃO PÓS-FECHAMENTO, NO KERNEL.
 *
 * `promessa-de-acao.test.ts` prova o DETECTOR. Este arquivo prova o SISTEMA, e
 * a diferença é a única que importa aqui:
 *
 *     ação detectada  ≠  ação executada
 *
 * O critério que fecha esta etapa não é "o modelo foi instruído e obedeceu". É:
 *
 *     MODELO TENTA A AÇÃO
 *            ↓
 *     DETECTOR DETERMINÍSTICO IDENTIFICA
 *            ↓
 *     SAÍDA REJEITADA
 *            ↓
 *     EXECUTOR NÃO RECEBE AÇÃO
 *            ↓
 *     REGENERAÇÃO, e se ela violar de novo, FAIL-CLOSED
 *
 * O provedor destes testes MENTE POR CONSTRUÇÃO — devolve exatamente as falas
 * que a produção devolveu em 19/08/2026 (`AUTORIDADE-DE-DADOS/cognitiva-3` e
 * `-4`). Um dublê obediente provaria que um modelo obediente obedece, que é o
 * que esta trava existe para não precisar assumir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { TETOS_PADRAO } from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import type { Plano } from '../servidor/nucleo/kernel/Evento';

const PEDIDO = 'analise o levantamento de custos e depois gere um resumo executivo comparativo';

function memoriaVazia(): MemoriaOperacional {
  return {
    registrar: async () => undefined,
    historico: async () => [],
    insightsPendentes: async () => [],
    consumirInsight: async () => undefined,
    gravarInsight: async () => undefined,
    consolidar: async () => undefined,
    carregarGlobal: async () => '',
  } as unknown as MemoriaOperacional;
}

/** Conta TODA execução real. É o oráculo de "o executor recebeu ação?". */
function habilidadeContada() {
  const chamadas: Record<string, unknown>[] = [];
  const habilidade: Habilidade = {
    manifesto: {
      id: 'lab.consultar',
      nome: 'lab.consultar',
      descricao: 'consulta de laboratório',
      dominio: 'operacoes',
      capacidade: 'conhecimento',
      permissoes: ['banco'],
      timeout_ms: 30_000,
      custo: 'zero',
      risco: 'baixo',
      idempotencia: 'leitura',
      esquema: { filtro: { tipo: 'texto', obrigatorio: true } },
    },
    async executar(ctx) {
      chamadas.push({ ...ctx.parametros });
      return { texto: '15 centrais ativas, 255 veículos', detalhe: 'lab', resolveu: true };
    },
  };
  return { habilidade, chamadas };
}

const passo = (filtro: string): Plano => ({
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'consultar', habilidade: 'lab.consultar', parametros: { filtro } }],
});
const terminou: Plano = {
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'responder', habilidade: null, parametros: {} }],
};

/** `falas` é consumida em ordem: a 1ª é a síntese, a 2ª é a regeneração. */
function montar(habilidade: Habilidade, falas: readonly string[]) {
  const barramento = new BarramentoEventos('s-trava');
  const concluidas: string[] = [];
  const falhas: Array<{ modulo: string; mensagem: string }> = [];
  const trechos: string[] = [];
  barramento.assinar('TAREFA_CONCLUIDA', (e) => concluidas.push(e.texto));
  barramento.assinar('FALHA', (e) => falhas.push({ modulo: e.modulo, mensagem: e.mensagem }));
  barramento.assinar('RESPOSTA_TRECHO', (e) => trechos.push(e.texto));

  let n = 0;
  const kernel = new Kernel({
    sessao: 's-trava',
    idUsuario: 'u-trava',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento,
    habilidadesExtras: [habilidade],
    tetosOrcamento: { ...TETOS_PADRAO },
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar(_p: unknown, _c: unknown, _s: unknown, _o: unknown, observado?: string) {
        return observado ? terminou : passo('todas');
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        const texto = falas[Math.min(n, falas.length - 1)] ?? '';
        n += 1;
        p.aoReceberTexto(texto);
        return { texto, tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  return { kernel, concluidas, falhas, trechos, sinteses: () => n };
}

/* As duas falas MEDIDAS em produção. */
const FALA_COM_MARCADOR =
  'Vou puxar o número atual na base. [Chamando consultar_infraestrutura] ' +
  'Antes de te dar o número: aquele bloco não trazia nada útil.';
const FALA_COM_PROMESSA = 'Vou consultar a base agora, direito, e já te digo o número.';
const FALA_HONESTA =
  'A consulta trouxe 15 centrais ativas, 255 veículos vinculados, e 2 fora de operação. ' +
  'Não bate com o número anterior (13).';

// ===========================================================================
// 1. A PROPRIEDADE DECISIVA — detectar não é executar
// ===========================================================================

test('1.1 a violação NÃO chega ao operador, e o executor não recebe ação nova', async () => {
  const lab = habilidadeContada();
  const { kernel, concluidas, trechos } = montar(lab.habilidade, [
    FALA_COM_MARCADOR,
    FALA_HONESTA,
  ]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  const entregue = concluidas.join('\n');
  assert.ok(!/\[Chamando/i.test(entregue), 'a chamada em prosa não pode chegar ao operador');
  assert.ok(
    !trechos.some((t) => /\[Chamando/i.test(t)),
    'nem sequer piscar na tela: a fala fica retida até ser validada',
  );
  assert.equal(
    lab.chamadas.length,
    1,
    'a habilidade rodou UMA vez, no laço. A prosa não virou execução',
  );
});

test('1.2 a regeneração honesta é a que o operador lê', async () => {
  const lab = habilidadeContada();
  const { kernel, concluidas, sinteses } = montar(lab.habilidade, [
    FALA_COM_PROMESSA,
    FALA_HONESTA,
  ]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 2, 'houve exatamente UMA regeneração');
  assert.match(concluidas.join('\n'), /15 centrais ativas/);
  assert.ok(!/vou consultar/i.test(concluidas.join('\n')));
});

// ===========================================================================
// 2. FAIL-CLOSED — a segunda tentativa também violando
// ===========================================================================

test('2.1 duas violações seguidas: o Kernel responde, e diz que descartou', async () => {
  const lab = habilidadeContada();
  const { kernel, concluidas, falhas, sinteses } = montar(lab.habilidade, [
    FALA_COM_PROMESSA,
    FALA_COM_MARCADOR,
  ]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 2, 'UMA regeneração, e só uma — regenerar até passar seria outro laço');
  const entregue = concluidas.join('\n');
  assert.ok(!/vou consultar|\[Chamando/i.test(entregue), 'nenhuma das duas violações passa');
  assert.match(
    entregue,
    /15 centrais ativas/,
    'o fail-closed responde com o que foi OBSERVADO — o dado existe e chega',
  );
  assert.ok(
    falhas.some((f) => f.modulo === 'verdade' && /não vai acontecer/i.test(f.mensagem)),
    'o descarte é DITO; trava que corrige em silêncio ensina que a IARA muda de assunto sozinha',
  );
  assert.equal(lab.chamadas.length, 1, 'e nada rodou de novo por causa da prosa');
});

test('2.2 o teto de regeneração é UM, mesmo com o provedor mentindo sempre', async () => {
  const lab = habilidadeContada();
  const { kernel, sinteses } = montar(lab.habilidade, [FALA_COM_PROMESSA]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 2, 'uma síntese e uma regeneração — nunca um laço de regeneração');
});

// ===========================================================================
// 3. O QUE NÃO PODE SER BARRADO
// ===========================================================================

test('3.1 a fala honesta passa inteira, sem regeneração', async () => {
  const lab = habilidadeContada();
  const { kernel, concluidas, falhas, sinteses } = montar(lab.habilidade, [FALA_HONESTA]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 1, 'nenhuma regeneração numa fala que não viola');
  assert.match(concluidas.join('\n'), /15 centrais ativas/);
  assert.ok(
    !falhas.some((f) => /não vai acontecer/i.test(f.mensagem)),
    'nenhum descarte anunciado',
  );
});

test('3.2 perguntar ao operador não é promessa e não dispara nada', async () => {
  const lab = habilidadeContada();
  const { kernel, concluidas, sinteses } = montar(lab.habilidade, [
    'Achei 15 centrais ativas. Quer que eu consulte também por UF?',
  ]);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(sinteses(), 1);
  assert.match(concluidas.join('\n'), /Quer que eu consulte/);
});
