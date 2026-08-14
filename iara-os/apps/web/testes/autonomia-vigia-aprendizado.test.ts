/**
 * AUTONOMIA, VIGIA, APRENDIZADO E AUDITORIA — as quatro peças que fecham a
 * evolução analítica.
 *
 * O teste mais importante deste arquivo é o primeiro, e ele não é sobre
 * funcionalidade: é a prova de que **autonomia é um teto, nunca uma concessão**.
 * Se subir o nível passar a permitir uma ação que as travas de risco impedem,
 * todo o trabalho de autorização deste kernel vira decorativo — e vira em
 * silêncio, porque nada mais falha.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ESCADA,
  NIVEL_PADRAO,
  ehNivel,
  motivoDaRecusa,
  nivelAtual,
  podeSem,
} from '../servidor/nucleo/kernel/Autonomia';
import { Vigia, CARENCIA_MS } from '../servidor/nucleo/kernel/Vigia';
import {
  MemoriaDeSolucoes,
  MINIMO_PARA_CONFIAR,
  assinar,
  taxaDe,
} from '../servidor/nucleo/kernel/MemoriaDeSolucoes';
import { auditar, redigirAuditoria } from '../servidor/nucleo/kernel/habilidades/auditoria';
import {
  diagnosticarLentidao,
  investigarLentidao,
  redigirInvestigacao,
} from '../servidor/nucleo/kernel/MotorAnalise';
import { recomendar, type PlanoDeAcao } from '../servidor/nucleo/kernel/Investigacao';
import { PorteiroAutorizacao } from '../servidor/nucleo/kernel/PorteiroAutorizacao';
import type { Medicao } from '../servidor/nucleo/SondasDesempenho';
import { aplicativoFechavelDoProcesso } from '../servidor/nucleo/AgenteLocal';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';

function medicao(parcial: Partial<Medicao> = {}): Medicao {
  return {
    instante: '2026-08-13T12:00:00.000Z',
    cpu_pct: 20,
    memoria_pct: 50,
    memoria_total_gb: 16,
    memoria_livre_gb: 8,
    disco_livre_pct: 40,
    disco_livre_gb: 200,
    ligado_ha_h: 3,
    nucleos: 8,
    processos: [],
    lacunas: [],
    ...parcial,
  };
}

// ---------------------------------------------------------------------------
// 1. Autonomia é um TETO
// ---------------------------------------------------------------------------

test('a autonomia máxima NÃO deixa a LLM autorizar risco alto', () => {
  /**
   * A propriedade que sustenta o resto. `PorteiroAutorizacao` recusa risco alto
   * vindo de plano emergente, e nada em `Autonomia.ts` toca nesse caminho —
   * nem tem como: o porteiro não conhece o módulo. Este teste existe para
   * quebrar no dia em que alguém "integrar" os dois.
   */
  const porteiro = new PorteiroAutorizacao();
  for (const nivel of ESCADA) {
    assert.equal(podeSem(nivel, 'agir_sem_perguntar'), nivel === 'rotina');
    const veredito = porteiro.avaliar({
      habilidade: 'acionar_energia',
      risco: 'alto',
      origem: 'emergente',
    });
    assert.equal(
      veredito.permitido,
      false,
      `com autonomia "${nivel}" a LLM conseguiu autorizar risco alto`,
    );
  }
});

test('a escada é monotônica: cada degrau contém o anterior', () => {
  const capacidades = [
    'executar_pedido',
    'executar_plano_aprovado',
    'falar_sem_ser_chamada',
    'agir_sem_perguntar',
  ] as const;
  for (const c of capacidades) {
    let jaPermitiu = false;
    for (const nivel of ESCADA) {
      const pode = podeSem(nivel, c);
      if (jaPermitiu) {
        assert.equal(pode, true, `"${c}" foi permitida e depois negada em "${nivel}"`);
      }
      jaPermitiu = jaPermitiu || pode;
    }
  }
});

test('o padrão é o comportamento que a IARA já tinha: executa plano, não fala sozinha', () => {
  assert.equal(NIVEL_PADRAO, 'plano');
  assert.equal(podeSem(NIVEL_PADRAO, 'executar_pedido'), true);
  assert.equal(podeSem(NIVEL_PADRAO, 'executar_plano_aprovado'), true);
  assert.equal(podeSem(NIVEL_PADRAO, 'falar_sem_ser_chamada'), false);
  assert.equal(podeSem(NIVEL_PADRAO, 'agir_sem_perguntar'), false);
});

test('nível inválido no ambiente cai no padrão em vez de virar o mais solto', () => {
  const antes = process.env.IARA_AUTONOMIA;
  try {
    process.env.IARA_AUTONOMIA = 'total';
    assert.equal(nivelAtual(), NIVEL_PADRAO);
    process.env.IARA_AUTONOMIA = 'conversa';
    assert.equal(nivelAtual(), 'conversa');
    delete process.env.IARA_AUTONOMIA;
    assert.equal(nivelAtual(), NIVEL_PADRAO);
  } finally {
    if (antes === undefined) delete process.env.IARA_AUTONOMIA;
    else process.env.IARA_AUTONOMIA = antes;
  }
  assert.equal(ehNivel('rotina'), true);
  assert.equal(ehNivel('deus'), false);
});

test('a recusa diz o que falta e que a decisão é do operador', () => {
  const frase = motivoDaRecusa('plano', 'falar_sem_ser_chamada');
  assert.match(frase, /sugestao/);
  assert.match(frase, /a decisão é sua/);
});

// ---------------------------------------------------------------------------
// 1b. O teto de autonomia, checado de ponta a ponta pelo Kernel
// ---------------------------------------------------------------------------

/**
 * Achado ao vivo em auditoria (14/08/2026): `podeSem`/`Autonomia.ts` sempre
 * existiram testados em isolamento (testes acima), mas `Kernel.ts` só
 * consultava a escada para UMA das quatro capacidades (`falar_sem_ser_chamada`,
 * via `Vigia`). `executar_pedido` — rodar o que o operador pediu neste turno —
 * nunca era checada: `IARA_AUTONOMIA=conversa` não impedia habilidade nenhuma
 * de rodar, ao contrário do que a própria escada promete. Estes dois testes
 * provam a integração real, não só a função pura.
 */
function memoriaMinima(): MemoriaOperacional {
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

test('IARA_AUTONOMIA=conversa barra até o pedido mais simples, de ponta a ponta', async () => {
  const antes = process.env.IARA_AUTONOMIA;
  process.env.IARA_AUTONOMIA = 'conversa';
  try {
    const barramento = new BarramentoEventos('teste-autonomia-1');
    const kernel = new Kernel({
      sessao: 'teste-autonomia-1',
      idUsuario: 'op-autonomia-1',
      outrosOperadores: [],
      estado: new EstadoAtomico(),
      memoria: memoriaMinima(),
      barramento,
    });

    const tipos: string[] = [];
    let resposta = '';
    barramento.assinarTudo((e) => {
      tipos.push(e.tipo);
      if (e.tipo === 'TAREFA_CONCLUIDA') resposta = e.texto;
    });

    // "que horas são?" é a mesma rota determinística e sem rede usada em
    // `kernel.test.ts` — se ISTO for barrado, o teto vale para qualquer coisa.
    await kernel.processar('que horas são?');

    assert.ok(tipos.includes('FALHA'), 'a recusa por autonomia precisa ser um FALHA registrado');
    assert.match(resposta, /autonomia/i);
    assert.match(resposta, /a decisão é sua/);
    assert.doesNotMatch(resposta, /\d{2}:\d{2}/, 'a hora real não pode vazar de um pedido barrado');
  } finally {
    if (antes === undefined) delete process.env.IARA_AUTONOMIA;
    else process.env.IARA_AUTONOMIA = antes;
  }
});

test('nível padrão continua executando pedido direto normalmente', async () => {
  const antes = process.env.IARA_AUTONOMIA;
  delete process.env.IARA_AUTONOMIA;
  try {
    const barramento = new BarramentoEventos('teste-autonomia-2');
    const kernel = new Kernel({
      sessao: 'teste-autonomia-2',
      idUsuario: 'op-autonomia-2',
      outrosOperadores: [],
      estado: new EstadoAtomico(),
      memoria: memoriaMinima(),
      barramento,
    });

    let resposta = '';
    barramento.assinar('TAREFA_CONCLUIDA', (e) => {
      resposta = e.texto;
    });

    await kernel.processar('que horas são?');

    assert.match(resposta, /\d{2}:\d{2}/, 'nível padrão não pode barrar o que já funcionava');
  } finally {
    if (antes === undefined) delete process.env.IARA_AUTONOMIA;
    else process.env.IARA_AUTONOMIA = antes;
  }
});

// ---------------------------------------------------------------------------
// 2. O vigia
// ---------------------------------------------------------------------------

const GRAVE = medicao({ memoria_pct: 96 });
const NORMAL = medicao();

function vigia(nivel: 'plano' | 'sugestao' = 'sugestao', relogio = { t: 0 }) {
  return { v: new Vigia(() => relogio.t, () => nivel), relogio };
}

test('abaixo de "sugestao" o vigia cala, por mais grave que esteja', () => {
  const { v } = vigia('plano');
  assert.equal(v.avaliar(GRAVE), null);
});

test('o vigia avisa na BORDA e não repete enquanto a situação persiste', () => {
  const { v } = vigia();
  const primeiro = v.avaliar(GRAVE);
  assert.ok(primeiro, 'não avisou na primeira vez que ficou grave');
  assert.equal(primeiro.assunto, 'memoria_uso');
  // Mesma situação no tique seguinte: não é notícia.
  assert.equal(v.avaliar(GRAVE), null);
  assert.equal(v.avaliar(GRAVE), null);
});

test('anomalia moderada não interrompe o operador', () => {
  const { v } = vigia();
  assert.equal(v.avaliar(medicao({ memoria_pct: 85 })), null);
});

test('a carência impede o assunto de voltar logo, mesmo em borda nova', () => {
  const relogio = { t: 0 };
  const { v } = vigia('sugestao', relogio);
  assert.ok(v.avaliar(GRAVE));
  // Voltou ao normal (rearma a borda) e piorou de novo, mas dentro da carência.
  assert.equal(v.avaliar(NORMAL), null);
  assert.equal(v.avaliar(GRAVE), null, 'avisou de novo dentro da carência');

  relogio.t += CARENCIA_MS + 1;
  assert.equal(v.avaliar(NORMAL), null);
  assert.ok(v.avaliar(GRAVE), 'não voltou a avisar depois da carência');
});

test('o vigia relata o que MEDIU e oferece — nunca diz uma causa nem age', () => {
  const { v } = vigia();
  const aviso = v.avaliar(GRAVE)!;
  assert.match(aviso.texto, /Não investiguei ainda nem mexi em nada/);
  assert.match(aviso.texto, /quer que eu descubra o motivo\?$/);
  // Nada de causa: ele não investigou.
  assert.doesNotMatch(aviso.texto, /processo .* está/);
});

// ---------------------------------------------------------------------------
// 3. Memória de soluções (§26)
// ---------------------------------------------------------------------------

const SITUACAO = medicao({
  memoria_pct: 95,
  processos: [{ nome: 'chrome', pid: 1, cpu_pct: 2, memoria_mb: 4000 }],
});

test('a assinatura reconhece a MESMA situação e distingue de outra', () => {
  const a = assinar(diagnosticarLentidao(SITUACAO));
  // Mesma situação, valores um pouco diferentes dentro da mesma severidade.
  const b = assinar(
    diagnosticarLentidao(
      medicao({ memoria_pct: 96, processos: [{ nome: 'chrome.exe', pid: 9, cpu_pct: 1, memoria_mb: 4200 }] }),
    ),
  );
  assert.equal(a, b, 'a mesma situação produziu assinaturas diferentes');

  const outra = assinar(diagnosticarLentidao(medicao({ disco_livre_pct: 2 })));
  assert.notEqual(a, outra);
  assert.equal(assinar(diagnosticarLentidao(medicao())), 'sem_anomalia');
});

test('só "resolvido" conta como sucesso; parcial não infla a taxa', () => {
  const m = new MemoriaDeSolucoes();
  const base = { id_usuario: 'ana', assinatura: 'x', rotulo: 'fechar o Chrome' };
  m.registrar({ ...base, veredito: 'parcial' });
  m.registrar({ ...base, veredito: 'resolvido' });
  const [r] = m.consultar('ana', 'x');
  assert.equal(r.tentativas, 2);
  assert.equal(r.sucessos, 1);
  assert.equal(taxaDe(r), 0.5);
});

test('"não verificável" não conta nem como tentativa', () => {
  const m = new MemoriaDeSolucoes();
  m.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'p', veredito: 'nao_verificavel' });
  assert.deepEqual(m.consultar('ana', 'x'), []);
});

test('uma anedota bem-sucedida não vira "resolveu 100% das vezes"', () => {
  const m = new MemoriaDeSolucoes();
  m.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'p', veredito: 'resolvido' });
  assert.equal(m.contar('ana', 'x'), '', 'um único acerto virou relato');
  assert.equal(m.preferido('ana', 'x'), null, 'um único acerto virou preferência');

  // Um único FRACASSO, ao contrário, já é útil na primeira vez.
  const n = new MemoriaDeSolucoes();
  n.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'reiniciar', veredito: 'acao_ineficaz' });
  assert.match(n.contar('ana', 'x'), /tentamos uma vez e não resolveu/);
});

test('a memória só prefere um plano com taxa acima da metade e tentativas bastantes', () => {
  const m = new MemoriaDeSolucoes();
  for (let i = 0; i < MINIMO_PARA_CONFIAR; i += 1) {
    m.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'bom', veredito: 'resolvido' });
    m.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'ruim', veredito: 'acao_ineficaz' });
  }
  assert.equal(m.preferido('ana', 'x'), 'bom');
  assert.match(m.contar('ana', 'x'), /bom: resolveu nas 2 vezes/);
  assert.match(m.contar('ana', 'x'), /ruim: tentamos 2 vezes e não resolveu/);
});

test('a memória é isolada por operador', () => {
  const m = new MemoriaDeSolucoes();
  m.registrar({ id_usuario: 'ana', assinatura: 'x', rotulo: 'p', veredito: 'resolvido' });
  assert.deepEqual(m.consultar('bruno', 'x'), []);
});

test('o histórico DESEMPATA, mas nunca sobrepõe a pontuação', () => {
  const plano = (p: Partial<PlanoDeAcao>): PlanoDeAcao => ({
    id: 'A', rotulo: 'r', objetivo: 'o', passos: [], risco: 'baixo', esforco: 'baixo',
    beneficio: 'medio', resultado_esperado: null, rollback: null, ...p,
  });

  // Empatados: o histórico decide.
  const empate = recomendar(
    [
      plano({ id: 'A', rotulo: 'sem histórico' }),
      plano({ id: 'B', rotulo: 'já resolveu' }),
    ],
    'já resolveu',
  );
  assert.equal(empate.escolhido.id, 'B');
  assert.match(empate.justificativa, /também é o que já resolveu isto antes/);

  // Pontuação diferente: o histórico NÃO manda.
  const semEmpate = recomendar(
    [
      plano({ id: 'A', rotulo: 'melhor', beneficio: 'alto', risco: 'baixo' }),
      plano({ id: 'B', rotulo: 'já resolveu', beneficio: 'baixo', risco: 'alto' }),
    ],
    'já resolveu',
  );
  assert.equal(semEmpate.escolhido.id, 'A', 'o histórico sobrepôs a política');
});

test('o relatório separa o histórico do que foi medido agora', () => {
  const texto = redigirInvestigacao(
    investigarLentidao(SITUACAO, null, aplicativoFechavelDoProcesso, {
      relato: 'Já vi esta situação antes. O que tentamos:\n  • fechar o Chrome: resolveu nas 2 vezes que tentamos',
      preferido: 'fechar o Chrome',
    }),
  );
  const medido = texto.indexOf('O que eu MEDI agora');
  const historico = texto.indexOf('Já vi esta situação antes');
  const planos = texto.indexOf('O que dá para fazer');
  assert.ok(medido >= 0 && historico > medido, 'o histórico apareceu junto com a medição');
  assert.ok(planos > historico, 'o histórico ficou depois das alternativas');
});

// ---------------------------------------------------------------------------
// 4. Auditoria (§20)
// ---------------------------------------------------------------------------

const SEM_ACHADO = {
  indisponiveis: [],
  errosRepetidos: [],
  solucoesIneficazes: [],
  chaveDeProvaAtiva: true,
  motivoDaChave: '',
};

test('a auditoria declara o que NÃO auditou — inclusive quando não achou nada', () => {
  const texto = redigirAuditoria(auditar(SEM_ACHADO));
  assert.match(texto, /Nada fora do lugar/);
  assert.match(texto, /O que eu NÃO auditei/);
  assert.match(texto, /sua rotina administrativa/);
});

test('registro de erros ausente vira achado, não silêncio', () => {
  /**
   * A distinção `null` vs `[]`, a mesma das sondas: "não consegui olhar" nunca
   * pode ser lido como "olhei e está tudo bem".
   */
  const comNull = auditar({ ...SEM_ACHADO, errosRepetidos: null });
  assert.equal(comNull.length, 1);
  assert.match(comNull[0].descricao, /não consegui ler o registro de erros/);

  assert.deepEqual(auditar(SEM_ACHADO), []);
});

test('a chave de prova desligada é RISCO e vem primeiro na lista', () => {
  const achados = auditar({
    ...SEM_ACHADO,
    indisponiveis: [{ nome: 'WhatsApp', motivo: 'sem token' }],
    chaveDeProvaAtiva: false,
    motivoDaChave: 'IARA_CHAVE_PROVA ausente',
  });
  assert.equal(achados[0].gravidade, 'risco');
  assert.equal(achados[0].area, 'integridade');
  assert.match(redigirAuditoria(achados), /IARA_CHAVE_PROVA/);
});

test('erro que se repetiu muitas vezes sobe de atenção para risco', () => {
  const poucas = auditar({
    ...SEM_ACHADO,
    errosRepetidos: [{ assinatura: 'a1', vezes: 2, classe: 'habilidade_ausente' }],
  });
  const muitas = auditar({
    ...SEM_ACHADO,
    errosRepetidos: [{ assinatura: 'a1', vezes: 5, classe: 'habilidade_ausente' }],
  });
  assert.equal(poucas[0].gravidade, 'atencao');
  assert.equal(muitas[0].gravidade, 'risco');
});

test('todo achado carrega conduta, ou admite que não há', () => {
  const achados = auditar({
    ...SEM_ACHADO,
    indisponiveis: [{ nome: 'X', motivo: 'sem credencial' }],
    solucoesIneficazes: [{ rotulo: 'reiniciar', tentativas: 3 }],
    chaveDeProvaAtiva: false,
    motivoDaChave: 'ausente',
  });
  for (const a of achados) {
    assert.ok(a.descricao.length > 0);
    assert.equal(typeof a.conduta, 'string');
  }
});

// ---------------------------------------------------------------------------
// 5. Roteamento da auditoria
// ---------------------------------------------------------------------------

const percepcao = new MotorPercepcao();
const planejador = new Planejador();

test('"faça uma auditoria" chega na habilidade de auditoria', () => {
  const p = percepcao.perceber('Iara, faça uma auditoria');
  assert.ok(p.ancoras.includes('auditoria'));
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'auditar_sistema');
});

test('a auditoria da transportadora NÃO é autodiagnóstico', () => {
  for (const frase of [
    'a auditoria da transportadora chega quinta',
    'preciso mandar os documentos para a auditoria do cliente',
    'a auditoria fiscal pediu as notas',
  ]) {
    assert.equal(
      percepcao.perceber(frase).ancoras.includes('auditoria'),
      false,
      `falso positivo em: ${frase}`,
    );
  }
});

test('"você está funcionando?" continua sendo o autoteste, não a auditoria', () => {
  const p = percepcao.perceber('você está funcionando?');
  assert.equal(p.ancoras.includes('auditoria'), false);
  assert.equal(planejador.planejar(p).passos[0].habilidade, 'diagnosticar_sistema');
});

test('a auditoria não age no mundo', () => {
  const h = CATALOGO.find((x) => x.manifesto.id === 'auditar_sistema');
  assert.ok(h);
  assert.equal(h.manifesto.risco, 'baixo');
  assert.equal(h.manifesto.idempotencia, 'leitura');
  assert.deepEqual(h.manifesto.permissoes, []);
});
