/**
 * Lacunas de capacidade — FASE A (Capability Intelligence).
 *
 * O caso semente é real: "Motoristas disponíveis agora?" aconteceu 3× ao vivo
 * em 14/08/2026 sem deixar rastro estruturado. Estes testes provam as
 * propriedades do registro:
 *
 *   1. PRIVACIDADE — assinatura normalizada com números e e-mails mascarados;
 *      nada além dela é guardado, e cada lacuna pertence AO OPERADOR que a
 *      pediu (partição — achado da auditoria adversarial de 14/08).
 *   2. AGRUPAMENTO — a mesma forma conta, formas diferentes não colidem.
 *   3. CICLO REAL — o Kernel registra quando (e SÓ quando) a rota cognitiva
 *      devolve plano só-raciocínio para um PEDIDO que parecia operacional; e
 *      a auditoria expõe a fila do próprio operador.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LacunasCapacidade,
  assinaturaDeLacuna,
  lacunasCapacidade,
} from '../servidor/nucleo/kernel/LacunasCapacidade';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import type { Plano } from '../servidor/nucleo/kernel/Evento';
import { auditarSistema } from '../servidor/nucleo/kernel/habilidades/auditoria';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

// ---------------------------------------------------------------------------
// 1. O registro em si
// ---------------------------------------------------------------------------

test('a mesma forma de frase agrupa numa lacuna só, com contagem', () => {
  const r = new LacunasCapacidade();
  r.registrar('Cargas do dia 17/08 sem motorista?', 'u1', '2026-08-14T10:00:00Z');
  r.registrar('Cargas do dia 18/08 sem motorista?', 'u1', '2026-08-14T11:00:00Z');
  r.registrar('cargas do dia 19/08 sem motorista?', 'u1', '2026-08-14T12:00:00Z');

  const minhas = r.inventarioDe('u1');
  assert.equal(minhas.length, 1, 'variação de número não pode virar lacuna nova');
  assert.equal(minhas[0].contagem, 3);
  assert.equal(minhas[0].primeira_ocorrencia, '2026-08-14T10:00:00Z');
  assert.equal(minhas[0].ultima_ocorrencia, '2026-08-14T12:00:00Z');
});

test('a assinatura mascara números e e-mails, normaliza e tem teto', () => {
  const assinatura = assinaturaDeLacuna(
    'Qual o VALOR da carga 4812 que o joao.pereira@atoslog.com.br cobrou?',
  );
  assert.doesNotMatch(assinatura, /\d/, 'nenhum dígito sobrevive');
  assert.doesNotMatch(assinatura, /@/, 'e-mail não sobrevive');
  assert.equal(assinatura, assinatura.toLowerCase());
  assert.ok(assinaturaDeLacuna('x'.repeat(500)).length <= 80, 'parágrafo colado não entra inteiro');
});

test('a lacuna de um operador NUNCA aparece no inventário de outro', () => {
  const r = new LacunasCapacidade();
  r.registrar('Motoristas disponíveis agora?', 'operadora-a');
  assert.equal(r.inventarioDe('operadora-a').length, 1);
  assert.equal(r.inventarioDe('operadora-b').length, 0, 'a fila é particionada por operador');
});

test('formas diferentes são lacunas diferentes; inventário sai por contagem', () => {
  const r = new LacunasCapacidade();
  r.registrar('uma vez só', 'u1');
  r.registrar('três vezes seguidas', 'u1');
  r.registrar('três vezes seguidas', 'u1');
  r.registrar('três vezes seguidas', 'u1');
  const l = r.inventarioDe('u1');
  assert.equal(l.length, 2);
  assert.equal(l[0].contagem, 3);
  assert.equal(l[1].contagem, 1);
});

// ---------------------------------------------------------------------------
// 2. O gancho do Kernel — ciclo real
// ---------------------------------------------------------------------------

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

/** Dublê da camada de raciocínio — mesmo padrão de cerebro-integridade. */
function raciocinioQueEmite(plano: Plano | null): MotorRaciocinio {
  return {
    disponivel: true,
    modelo: 'teste',
    async planejar() {
      return plano;
    },
    async responder(p: { aoReceberTexto: (t: string) => void }) {
      p.aoReceberTexto('[sintese]');
      return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
    },
  } as unknown as MotorRaciocinio;
}

const SO_RACIOCINIO: Plano = {
  objetivo: 'responder com o que sei',
  origem: 'emergente',
  passos: [{ indice: 0, descricao: 'responder', habilidade: 'raciocinio', parametros: {} }],
};

function kernelCom(raciocinio: MotorRaciocinio, sessao: string): Kernel {
  return new Kernel({
    sessao,
    idUsuario: 'u-lacunas',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento: new BarramentoEventos(sessao),
    raciocinio,
  });
}

test('caso semente: "Motoristas disponíveis agora?" com plano só-raciocínio vira lacuna do operador', async () => {
  lacunasCapacidade.zerar();
  const kernel = kernelCom(raciocinioQueEmite(SO_RACIOCINIO), 's-lacuna-1');

  await kernel.processar('Motoristas disponíveis agora?');

  const minhas = lacunasCapacidade.inventarioDe('u-lacunas');
  assert.equal(minhas.length, 1, 'a rota cognitiva de mãos vazias tem que registrar a lacuna');
  assert.match(minhas[0].assinatura, /motoristas disponiveis agora/);
  assert.equal(
    lacunasCapacidade.inventarioDe('outro-operador').length,
    0,
    'a lacuna pertence a quem pediu',
  );
  lacunasCapacidade.zerar();
});

test('quando a LLM ESCOLHE uma habilidade, não há lacuna nenhuma', async () => {
  lacunasCapacidade.zerar();
  const comHabilidade: Plano = {
    objetivo: 'consultar estatísticas',
    origem: 'emergente',
    passos: [
      {
        indice: 0,
        descricao: 'agrupar cargas por motorista',
        habilidade: 'consultar_estatisticas_cargas_luft',
        parametros: { agrupar_por: 'motorista' },
      },
    ],
  };
  const kernel = kernelCom(raciocinioQueEmite(comHabilidade), 's-lacuna-2');

  await kernel.processar('Motoristas disponíveis agora?');

  assert.equal(
    lacunasCapacidade.inventarioDe('u-lacunas').length,
    0,
    'registrar o que ela SABE fazer transformaria a fila de evolução em ruído',
  );
  lacunasCapacidade.zerar();
});

test('conversa que pagou planejamento pela FORMA (sem assunto de catálogo) não vira lacuna', async () => {
  lacunasCapacidade.zerar();
  const kernel = kernelCom(raciocinioQueEmite(SO_RACIOCINIO), 's-lacuna-3');

  // "Qual o propósito disso tudo?" tem interrogativo de fato (rota cognitiva),
  // mas nenhum token do catálogo — filosofia não é lacuna de capacidade.
  await kernel.processar('Qual o propósito disso tudo?');

  assert.equal(lacunasCapacidade.inventarioDe('u-lacunas').length, 0);
  lacunasCapacidade.zerar();
});

test('desabafo com vocabulário de trabalho NÃO vira lacuna — pedido exige forma de pedido', async () => {
  lacunasCapacidade.zerar();
  const kernel = kernelCom(raciocinioQueEmite(SO_RACIOCINIO), 's-lacuna-4');

  /**
   * Achado da auditoria adversarial de 14/08: os exemplos alargaram o índice
   * de assunto e "esse relatório me destruiu" passou a parecer operacional.
   * Sem o filtro de forma (comando ou "?"), o desabafo entraria na fila de
   * evolução — e a fila viraria log de conversa com outro nome.
   */
  await kernel.processar('estou cansada, esse relatório me destruiu hoje');

  assert.equal(
    lacunasCapacidade.inventarioDe('u-lacunas').length,
    0,
    'desabafo não é pedido — não pode entrar na fila de evolução',
  );
  lacunasCapacidade.zerar();
});

// ---------------------------------------------------------------------------
// 3. A auditoria expõe a fila — do próprio operador
// ---------------------------------------------------------------------------

function ctxAuditoria(idUsuario: string): ContextoHabilidade {
  return {
    sessao: 's-aud',
    id_usuario: idUsuario,
    parametros: {},
    sinal: new AbortController().signal,
    enunciado: 'faça uma auditoria',
    operacao: null,
  } as unknown as ContextoHabilidade;
}

test('auditar_sistema mostra "o que me pediram e eu não sei fazer" com contagem', async () => {
  lacunasCapacidade.zerar();
  lacunasCapacidade.registrar('Motoristas disponíveis agora?', 'u-aud');
  lacunasCapacidade.registrar('Motoristas disponíveis agora?', 'u-aud');
  lacunasCapacidade.registrar('Motoristas disponíveis agora?', 'u-aud');

  const r = await auditarSistema.executar(ctxAuditoria('u-aud'));
  assert.match(r.texto, /O que me pediram e eu não sei fazer/);
  assert.match(r.texto, /motoristas disponiveis agora/);
  assert.match(r.texto, /3 vezes/);
  lacunasCapacidade.zerar();
});

test('a auditoria de um operador não mostra a lacuna de outro', async () => {
  lacunasCapacidade.zerar();
  lacunasCapacidade.registrar('Quantas horas extras os motoristas fizeram?', 'operadora-a');

  const r = await auditarSistema.executar(ctxAuditoria('operadora-b'));
  assert.doesNotMatch(
    r.texto,
    /horas extras/,
    'a frase de um operador não pode aparecer na auditoria de outro',
  );
  lacunasCapacidade.zerar();
});

test('sem lacunas, a auditoria não inventa a seção', async () => {
  lacunasCapacidade.zerar();
  const r = await auditarSistema.executar(ctxAuditoria('u-aud'));
  assert.doesNotMatch(r.texto, /não sei fazer/);
});
