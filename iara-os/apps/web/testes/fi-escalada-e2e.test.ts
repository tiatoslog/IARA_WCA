/**
 * FAULT INJECTION — a propriedade da Fatia 1, provada ponta a ponta.
 *
 * A PROPRIEDADE: uma resposta cognitiva incorreta é detectada antes de chegar ao
 * operador, consome orçamento, provoca EXATAMENTE UMA escalada permitida, é
 * substituída por um modelo de maior capacidade, e essa segunda resposta também
 * passa por verificação antes de ser liberada.
 *
 * O QUE É FALSO AQUI, declarado sem eufemismo — são DUAS coisas, não uma:
 *
 *  1. **O texto que o modelo devolve.** É o ponto do fault injection.
 *  2. **O roteamento pergunta→oráculo.** E esta merece explicação, porque a
 *     Regra 10 pede que só o provedor seja falso.
 *
 * A auditoria de 19/08/2026 mediu que NENHUMA pergunta de produção é, ao mesmo
 * tempo, de rota cognitiva e portadora de oráculo escalável:
 *
 *      "quantas centrais ativas existem?"  → plano_local, e a síntese
 *                                            sequer é chamada (medido)
 *      "quantas cargas existem na base?"   → plano_cognitivo, mas o veredito
 *                                            é `escalavel: false` — modelo
 *                                            melhor não inventa menos sem fonte
 *
 * Logo o ramo `invalido → escalar` é INALCANÇÁVEL em produção hoje, e nenhum
 * arranjo de perguntas reais o exercita. Fechar essa lacuna exige dar oráculo de
 * valor a uma pergunta cognitiva — o `contar_distintos` do Ciclo A, fora do
 * escopo desta fatia.
 *
 * Então o roteamento é suprido pelo teste. O que NÃO é suprido: os oráculos são
 * os de `lib/verificacao/oraculos` — código de produto, sem cópia — e todo o
 * resto do caminho é real: Kernel real, `CadeiaDeRaciocinio` real,
 * `EscaladaDoTurno` real, `OrcamentoDoTurno` real, `raciocinarNoPremium` real,
 * segunda verificação real, barramento real.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CadeiaDeRaciocinio } from '../servidor/nucleo/CadeiaDeRaciocinio';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import { conferirContagem } from '../lib/verificacao/oraculos';
import { NAO_SEI_CONFERIR } from '../lib/verificacao/contrato';
import type {
  ContextoDaTarefa,
  PortaVerificacaoRuntime,
  ResultadoVerificacao,
} from '../lib/verificacao/contrato';
import { ProvedorDeFalha, type RoteiroDoProvedor } from './apoio/ProvedorDeFalha';

/** A fonte determinística do experimento. 73, como manda o roteiro FI. */
const VERDADE = 73;

/** Pergunta de rota cognitiva. Não tem âncora determinística — medido. */
const PERGUNTA = 'me diga, analisando a operação inteira, quantas cargas nós temos';

const memoriaFalsa = () =>
  ({
    async registrar() {},
    async historico() {
      return [];
    },
    async carregarGlobal() {
      return '';
    },
    async lerPreferencias() {
      return {} as never;
    },
  }) as never;

/**
 * O verificador do experimento.
 *
 * O ORÁCULO É DE PRODUÇÃO — `conferirContagem`, importado de
 * `lib/verificacao/oraculos`, sem cópia e sem adaptação. O teste supre apenas
 * qual pergunta cai nele, pela razão medida no cabeçalho.
 */
function verificadorDoExperimento(): PortaVerificacaoRuntime & { vereditos: string[] } {
  const vereditos: string[] = [];
  return {
    vereditos,
    reconhece: (p: string) => /\bcargas?\b/i.test(p),
    verificar(resposta: string, ctx: ContextoDaTarefa): ResultadoVerificacao {
      if (!/\bcargas?\b/i.test(ctx.pergunta)) return NAO_SEI_CONFERIR('fora do escopo do teste');
      const r = conferirContagem(resposta, /cargas?/, VERDADE, 'fonte-do-experimento');
      vereditos.push(r.status);
      return r;
    },
  };
}

interface Observado {
  fala: string;
  /** Todo texto que a projeção mostraria, na ordem, com carimbo. */
  exposicoes: Array<{ t: number; texto: string }>;
  falhas: string[];
  /** `chamadas ao modelo N/M` lido da telemetria do turno. */
  chamadasAoModelo: number | null;
}

async function turno(o: {
  barato: RoteiroDoProvedor;
  premium?: RoteiroDoProvedor;
  tetos?: Partial<{ chamadas_modelo: number; tentativas_provedor: number }>;
  cancelarAposMs?: number;
  verificacao?: PortaVerificacaoRuntime | null;
  pergunta?: string;
}) {
  const elos = [new ProvedorDeFalha(o.barato)];
  const premium = o.premium ? new ProvedorDeFalha(o.premium) : null;
  if (premium) elos.push(premium);

  /* CADEIA REAL. É ela que implementa `premiumSaudavel` e `raciocinarNoPremium`
     — as duas peças que a escalada usa. Um dublê aqui não provaria nada. */
  const cadeia = new CadeiaDeRaciocinio(elos);
  const barramento = new BarramentoEventos('s-fi');
  const verificacao = o.verificacao === undefined ? verificadorDoExperimento() : o.verificacao;

  const kernel = new Kernel({
    sessao: 's-fi',
    idUsuario: 'u-fi',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    raciocinio: new MotorRaciocinio(cadeia),
    verificacao,
    tetosOrcamento: {
      passos: 6,
      chamadas_modelo: o.tetos?.chamadas_modelo ?? 9,
      tentativas_provedor: o.tetos?.tentativas_provedor ?? 20,
      efeitos_externos: 4,
      tokens: 120_000,
      tempo_ms: 900_000,
    },
  });

  const obs: Observado = { fala: '', exposicoes: [], falhas: [], chamadasAoModelo: null };
  barramento.assinarTudo((e) => {
    /* EXPOSIÇÃO É O QUE A PROJEÇÃO MOSTRARIA. `RESPOSTA_TRECHO` e
       `TAREFA_CONCLUIDA` são exatamente os dois eventos que a `PonteProjecao`
       trata como fala — ver o `if` dela. Log interno não conta, e é por isso
       que `FALHA` é colhido em separado. */
    if (e.tipo === 'RESPOSTA_TRECHO' || e.tipo === 'TAREFA_CONCLUIDA') {
      obs.exposicoes.push({ t: Date.now(), texto: e.texto });
    }
    if (e.tipo === 'TAREFA_CONCLUIDA') obs.fala = e.texto;
    if (e.tipo === 'FALHA') obs.falhas.push(`${e.modulo}: ${e.mensagem}`);
  });

  if (o.cancelarAposMs !== undefined) {
    setTimeout(() => kernel.cancelar('o operador desistiu'), o.cancelarAposMs);
  }
  await kernel.processar(o.pergunta ?? PERGUNTA);

  /**
   * O CONSUMO É CONTADO NOS PRÓPRIOS PROVEDORES, e não no texto nem numa
   * telemetria que eu teria de inventar. Cada `raciocinar` que aconteceu deixou
   * um carimbo em `chamadas` — é ida à rede de verdade, o recurso que o
   * orçamento existe para racionar.
   *
   * Não há `sleep`: `processar` só resolve depois do `finally` do turno, então a
   * própria resolução da promessa é a condição observável de término.
   */
  obs.chamadasAoModelo = elos.reduce((n, e) => n + e.chamadas.length, 0);

  return {
    ...obs,
    baratoChamadas: elos[0].chamadas.length,
    premiumChamadas: premium?.chamadas.length ?? 0,
    premiumEm: premium?.chamadas[0]?.instante ?? null,
    vereditos: (verificacao as { vereditos?: string[] } | null)?.vereditos ?? [],
  };
}

/** Todo número exposto em qualquer instante — a prova de não vazamento. */
const numerosExpostos = (exposicoes: Array<{ texto: string }>): number[] => [
  ...new Set(
    exposicoes.flatMap((e) => [...e.texto.matchAll(/\b\d+\b/g)].map((m) => Number(m[0]))),
  ),
];

const respondeu = (valor: string): RoteiroDoProvedor => ({
  apelido: 'barato',
  texto: () => valor,
});
const premiumQue = (valor: string, extra: Partial<RoteiroDoProvedor> = {}): RoteiroDoProvedor => ({
  apelido: 'premium',
  camada: 'premium',
  texto: () => valor,
  ...extra,
});

// ===========================================================================
// FI-001 — número incorreto → INVALID → ESCALATE → premium correto → VALID
// ===========================================================================
test('FI-001. número errado é interceptado, escala uma vez e o premium corrige', async () => {
  const r = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('Temos 73 cargas.'),
  });

  assert.equal(r.premiumChamadas, 1, 'o premium precisa ter sido REALMENTE chamado');
  assert.deepEqual(r.vereditos, ['invalido', 'valido'], 'as duas verificações têm de acontecer');
  assert.match(r.fala, /73/);
  assert.ok(
    !numerosExpostos(r.exposicoes).includes(1234),
    'o número inventado chegou à superfície do operador',
  );
});

// ===========================================================================
// FI-002 — sem oráculo aplicável → INCONCLUSIVO, nunca INVALID
// ===========================================================================
test('FI-002. entidade sem oráculo é INCONCLUSIVO — não vira INVALID nem escalada', async () => {
  /* "João Silva possui 237 cargas" tem um NOME inventado, e não existe oráculo
     de entidade. A Regra 17 é clara: não inventar conhecimento. O número 237
     ainda é conferível contra a fonte, então este caso mede a fronteira: o que
     tem oráculo é julgado, o que não tem fica de fora. */
  const semOraculoDeEntidade: PortaVerificacaoRuntime & { vereditos: string[] } = {
    vereditos: [],
    reconhece: () => true,
    verificar(_r, _c) {
      const v = NAO_SEI_CONFERIR('não há oráculo de entidade para "motorista"');
      this.vereditos.push(v.status);
      return v;
    },
  };
  const r = await turno({
    barato: respondeu('João Silva possui 237 cargas.'),
    premium: premiumQue('outro'),
    verificacao: semOraculoDeEntidade,
    pergunta: 'qual motorista possui mais cargas?',
  });

  assert.deepEqual(r.vereditos, ['inconclusivo']);
  assert.equal(r.premiumChamadas, 0, 'inconclusivo não pode escalar');
  assert.match(r.fala, /João Silva/, 'inconclusivo entrega a resposta como está');
});

// ===========================================================================
// FI-003 — resposta correta → VALID → não escala
// ===========================================================================
test('FI-003. resposta correta não escala e não gasta premium', async () => {
  const r = await turno({
    barato: respondeu('Temos 73 cargas.'),
    premium: premiumQue('nunca deveria ser chamado'),
  });

  assert.deepEqual(r.vereditos, ['valido']);
  assert.equal(r.premiumChamadas, 0);
  assert.match(r.fala, /73/);
});

// ===========================================================================
// FI-004 — premium também erra → degradação honesta, sem terceira chamada
// ===========================================================================
test('FI-004. premium também erra: degrada, e NÃO existe terceira tentativa', async () => {
  const r = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('Temos 9999 cargas.'),
    /* Orçamento folgado DE PROPÓSITO: com teto apertado seria ele a impedir a
       segunda escalada, e o teste passaria mesmo com a trava `ja_escalou`
       removida. Defesa em profundidade não pode mascarar qual defesa agiu. */
    tetos: { chamadas_modelo: 9, tentativas_provedor: 20 },
  });

  assert.equal(r.premiumChamadas, 1, 'houve mais de uma chamada premium — o laço não convergiu');
  assert.deepEqual(r.vereditos, ['invalido', 'invalido']);
  const expostos = numerosExpostos(r.exposicoes);
  assert.ok(!expostos.includes(1234), '1234 vazou');
  assert.ok(!expostos.includes(9999), '9999 vazou');
  assert.match(r.fala, /não vou te dar esse número|não confirmei|não bateu/i);
});

// ===========================================================================
// FI-005 — orçamento esgotado → não chama premium, degrada honestamente
// ===========================================================================
test('FI-005. sem orçamento, a escalada é negada e o premium não é chamado', async () => {
  const r = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('Temos 73 cargas.'),
    /* Teto igual ao consumo da própria síntese: sobra zero para escalar. */
    tetos: { chamadas_modelo: 1 },
  });

  assert.equal(r.premiumChamadas, 0, 'escalou sem orçamento');
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
});

// ===========================================================================
// REGRA 12 — prova aritmética do orçamento
// ===========================================================================
test('FI-006. a escalada consome orçamento; AVALIAR a escalada não consome', async () => {
  /**
   * A prova é a diferença entre dois turnos idênticos em tudo menos no veredito:
   *
   *   escalou     → chamadas ao modelo = N + 1
   *   não escalou → chamadas ao modelo = N
   *
   * Se avaliar consumisse, o turno VÁLIDO (que avalia e não escala) também
   * gastaria a chamada extra, e a diferença sumiria.
   */
  const valido = await turno({
    barato: respondeu('Temos 73 cargas.'),
    premium: premiumQue('irrelevante'),
  });
  const escalado = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('Temos 73 cargas.'),
  });

  assert.notEqual(valido.chamadasAoModelo, null, 'sem telemetria não há prova de orçamento');
  assert.equal(
    escalado.chamadasAoModelo,
    (valido.chamadasAoModelo ?? 0) + 1,
    'a escalada tem de custar exatamente uma chamada a mais',
  );
});

// ===========================================================================
// REGRA 14 — ordem temporal
// ===========================================================================
test('FI-007. nada é exposto antes de o premium ter respondido', async () => {
  /* A propriedade crítica: entre "resposta gerada" e "verificação concluída"
     não pode haver exposição. Como a exposição só é permitida depois do
     veredito, toda exposição tem de vir DEPOIS da chamada premium. */
  const r = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('Temos 73 cargas.'),
  });

  assert.ok(r.premiumEm !== null);
  assert.ok(r.exposicoes.length > 0, 'o turno não expôs nada — não há o que ordenar');
  for (const e of r.exposicoes) {
    assert.ok(
      e.t >= (r.premiumEm ?? 0),
      `exposição em ${e.t} veio antes da chamada premium em ${r.premiumEm}: "${e.texto.slice(0, 60)}"`,
    );
  }
});

// ===========================================================================
// REGRA 15 — streaming
// ===========================================================================
test('FI-008. resposta em vários pedaços não vaza nenhum deles', async () => {
  const r = await turno({
    barato: { apelido: 'barato', texto: () => 'Temos 1234 cargas confirmadas.', pedacos: 6 },
    premium: premiumQue('Temos 73 cargas.'),
  });

  assert.equal(r.premiumChamadas, 1);
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234), 'um pedaço com 1234 chegou à tela');
});

test('FI-009. stream lento não cria exposição parcial', async () => {
  const r = await turno({
    barato: {
      apelido: 'barato',
      texto: () => 'Temos 1234 cargas.',
      pedacos: 4,
      atrasoPorPedacoMs: 15,
    },
    premium: premiumQue('Temos 73 cargas.'),
  });
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
});

test('FI-010. stream interrompido no meio não expõe o pedaço nem escala às cegas', async () => {
  const r = await turno({
    barato: { apelido: 'barato', texto: () => 'Temos 1234 cargas.', pedacos: 4, interromperApos: 2 },
    premium: premiumQue('Temos 73 cargas.'),
  });
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
});

// ===========================================================================
// REGRA 16 — cancelamento
// ===========================================================================
test('FI-011. cancelamento do operador não vira falha de provedor nem escalada', async () => {
  const r = await turno({
    barato: {
      apelido: 'barato',
      texto: () => 'Temos 1234 cargas.',
      pedacos: 8,
      atrasoPorPedacoMs: 40,
    },
    premium: premiumQue('Temos 73 cargas.'),
    cancelarAposMs: 30,
  });

  assert.equal(r.premiumChamadas, 0, 'cancelar gastou a cota do próximo modelo');
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
});

// ===========================================================================
// REGRA 22 — falha de provedor não vira valor
// ===========================================================================
test('FI-012. premium fora do ar degrada; não devolve o número contestado', async () => {
  const r = await turno({
    barato: respondeu('Temos 1234 cargas.'),
    premium: premiumQue('irrelevante', { explode: true }),
  });

  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
  assert.ok(r.falhas.some((f) => /escalada/.test(f)));
});

// ===========================================================================
// Sem pool premium declarado
// ===========================================================================
test('FI-013. sem elo premium na cadeia, contesta e degrada sem tentar ninguém', async () => {
  const r = await turno({ barato: respondeu('Temos 1234 cargas.') });
  assert.equal(r.premiumChamadas, 0);
  assert.ok(!numerosExpostos(r.exposicoes).includes(1234));
  assert.match(r.fala, /não vou te dar esse número|não confirmei|não bateu/i);
});
