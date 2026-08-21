/**
 * A REIDRATAÇÃO PRECISA ACONTECER EM PRODUÇÃO, NÃO SÓ EXISTIR.
 *
 * `RegistroOperacoes.reidratar` estava escrita, testada e comentada como se
 * rodasse: `PortalEfeitos` diz "a operação fica em `executando`, e a
 * reidratação a recupera"; `agenteLocal.ts` diz "se o processo morrer no
 * `shutdown`, a reidratação...". Uma varredura por chamadores em 20/08/2026
 * encontrou ZERO fora de `testes/` — o singleton `registroOperacoes` nasce com
 * os mapas vazios e ninguém lê o jornal de volta.
 *
 * O que isso custa, e é o cenário §14+§15 da auditoria:
 *
 *     efeito não idempotente executa  →  processo morre antes de confirmar
 *          →  processo sobe  →  operador repete o pedido
 *          →  `reservar` não encontra nada  →  O EFEITO ACONTECE DUAS VEZES
 *
 * As duas barreiras que existiriam para impedir isso — a chave de idempotência
 * e a impressão do efeito — leem `this.porChave` e `this.operacoes`, os dois em
 * MEMÓRIA. Depois do restart, as duas estão cegas.
 *
 * Este arquivo mede o CAMINHO DE PRODUÇÃO: um `Kernel` como o que a `Porta`
 * constrói, sobre um jornal que já tem uma operação pendurada, tentando o mesmo
 * efeito. O executor não pode ser chamado.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { PortalEfeitos } from '../servidor/nucleo/kernel/PortalEfeitos';
import { evidencia } from '../servidor/nucleo/kernel/Operacao';
import { TETOS_PADRAO } from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import type { Plano } from '../servidor/nucleo/kernel/Evento';

const ID_USUARIO = 'operadora-reidrat';
const ACAO = 'lab.enviar_aviso';
const PARAMETROS = { destino: '5551999', texto: 'sua carga saiu' } as const;

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

/** Efeito NÃO IDEMPOTENTE. Toda execução real é contada. */
function habilidadeDeEfeito() {
  const chamadas: Record<string, unknown>[] = [];
  const habilidade: Habilidade = {
    manifesto: {
      id: ACAO,
      nome: ACAO,
      descricao: 'envia um aviso ao motorista',
      dominio: 'operacoes',
      capacidade: 'automacao',
      permissoes: ['rede'],
      timeout_ms: 5_000,
      custo: 'zero',
      risco: 'medio',
      idempotencia: 'escrita_nao_idempotente',
      esquema: {
        destino: { tipo: 'texto', obrigatorio: true },
        texto: { tipo: 'texto', obrigatorio: true },
      },
    },
    async executar(ctx) {
      chamadas.push({ ...ctx.parametros });
      return { texto: 'aviso enviado', detalhe: 'provedor aceitou', resolveu: true };
    },
  };
  return { habilidade, chamadas };
}

const planoDoEfeito: Plano = {
  objetivo: 'avisar o motorista',
  origem: 'emergente' as const,
  passos: [
    { indice: 0, descricao: 'enviar o aviso', habilidade: ACAO, parametros: { ...PARAMETROS } },
  ],
};
const planoFinal: Plano = {
  objetivo: 'avisar o motorista',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'responder', habilidade: null, parametros: {} }],
};

/**
 * O JORNAL DE ANTES DA QUEDA — escrito por um processo que não existe mais.
 *
 * A operação fica em `executando`: o efeito saiu e ninguém soube o desfecho. É
 * exatamente o estado que `reidratar` traduz para `desconhecida`, e é
 * `desconhecida` que a barreira do retry recusa repetir.
 */
async function jornalComEfeitoEmVoo(raiz: string): Promise<string> {
  const antes = new RegistroOperacoes(raiz);
  const reserva = antes.reservar({
    id_usuario: ID_USUARIO,
    sessao: 'sessao-morta',
    habilidade: ACAO,
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    parametros: { ...PARAMETROS },
    origem_pedido: 'op:turno-anterior',
  });
  assert.equal(reserva.tipo, 'nova');
  if (reserva.tipo !== 'nova') throw new Error('não reservou');
  const id = reserva.operacao.id_operacao;
  await antes.marcar(id, 'autorizada', evidencia('porteiro', 'risco médio liberado'));
  await antes.marcar(id, 'executando', evidencia('executor', 'saiu para o provedor'));
  return id;
}

function montarKernel(registro: RegistroOperacoes, habilidade: Habilidade) {
  const barramento = new BarramentoEventos('s-reidrat');
  const concluidas: string[] = [];
  barramento.assinar('TAREFA_CONCLUIDA', (e) => concluidas.push(e.texto));

  const kernel = new Kernel({
    sessao: 's-reidrat',
    idUsuario: ID_USUARIO,
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento,
    habilidadesExtras: [habilidade],
    registroOperacoes: registro,
    tetosOrcamento: { ...TETOS_PADRAO },
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar(_p: unknown, _c: unknown, _s: unknown, _o: unknown, observado?: string) {
        return observado ? planoFinal : planoDoEfeito;
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        const texto = 'pronto';
        p.aoReceberTexto(texto);
        return { texto, tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  return { kernel, concluidas };
}

test('RD-01. depois do restart, o mesmo efeito não idempotente NÃO executa de novo', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'reidrat-prod-'));
  try {
    await jornalComEfeitoEmVoo(raiz);

    /* O processo novo. Mapas vazios, jornal no disco — é o estado real de
       produção depois de um deploy, de um crash ou de um `npm run dev`. */
    const depois = new RegistroOperacoes(raiz);
    const { habilidade, chamadas } = habilidadeDeEfeito();
    const { kernel } = montarKernel(depois, habilidade);

    await kernel.processar('manda o aviso pro motorista de novo');

    assert.equal(
      chamadas.length,
      0,
      'o efeito foi executado DE NOVO depois do restart — o jornal do disco não foi lido de volta',
    );
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('RD-02. a barreira volta a enxergar a operação que ficou sem desfecho', async () => {
  const raiz = await mkdtemp(path.join(tmpdir(), 'reidrat-barreira-'));
  try {
    const idDeAntes = await jornalComEfeitoEmVoo(raiz);

    const depois = new RegistroOperacoes(raiz);
    const { habilidade } = habilidadeDeEfeito();
    const { kernel } = montarKernel(depois, habilidade);
    await kernel.processar('manda o aviso pro motorista de novo');

    /* A operação DE ANTES DA QUEDA — pelo id, nunca por contagem.
       A primeira redação deste teste conferia `todas().length === 1` e passava
       com o defeito em pé: o turno novo cria uma operação própria, e ela também
       termina em `desconhecida`. Um teste que conta em vez de identificar mede
       o teste, não o sistema. */
    const anterior = depois.ler(idDeAntes);
    assert.ok(anterior, 'a operação anterior não entrou no índice do processo novo');
    assert.equal(anterior.estado, 'desconhecida');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});

test('RD-03. o PORTAL recusa o efeito repetido mesmo sem kernel nenhum', async () => {
  /**
   * O VÃO QUE A VERIFICAÇÃO INDEPENDENTE ACHOU na primeira versão desta
   * correção: ela punha a garantia em `Kernel.executarLaco`, e
   * `servidor/canais/PortaWhatsapp.ts` monta o próprio `PortalEfeitos` sobre o
   * singleton do processo para o caminho do NÚMERO NÃO CADASTRADO — que existe,
   * pelo comentário do próprio arquivo, "antes de haver kernel algum".
   *
   * Medido naquela versão: a reentrega do mesmo `wamid` depois de um restart
   * devolvia `nova` por aquele caminho e `duplicada` pelo do Kernel. Mesma
   * trava, dois resultados, porque a garantia estava no chamador.
   *
   * Este teste NÃO constrói kernel. Ele fala com o portal do jeito que um canal
   * fala, que é a única forma de provar que a garantia mudou de lugar.
   */
  const raiz = await mkdtemp(path.join(tmpdir(), 'reidrat-portal-'));
  try {
    const idDeAntes = await jornalComEfeitoEmVoo(raiz);

    const depois = new RegistroOperacoes(raiz);
    const portal = new PortalEfeitos(depois);

    const abertura = await portal.abrir({
      id_usuario: ID_USUARIO,
      sessao: 'canal-sem-kernel',
      acao: ACAO,
      risco: 'medio',
      semantica: 'escrita_nao_idempotente',
      parametros: { ...PARAMETROS },
      origem_pedido: 'op:reentrega',
      fonte_autorizacao: 'operador',
      motivo_autorizacao: 'resposta à mensagem recebida do próprio operador',
      invariantes_conferidas: ['PARAMETROS_VALIDADOS'],
    });

    assert.equal(
      abertura.ok,
      false,
      'o portal abriu um efeito idêntico ao que ficou sem desfecho antes da queda',
    );
    assert.ok(depois.ler(idDeAntes), 'a operação de antes precisa estar no índice deste processo');
  } finally {
    await rm(raiz, { recursive: true, force: true });
  }
});
