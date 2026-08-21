/**
 * O LAÇO DO AGENTE — a bateria que prova que ele DÁ VOLTA.
 *
 * O QUE ESTA BATERIA TEM DE PROVAR, e não é "o laço compila":
 *
 *   resultado da ferramenta → entra no contexto de decisão → nova chamada ao
 *   modelo → o modelo pode escolher uma ferramenta ou um parâmetro DIFERENTE.
 *
 * Se essa causalidade não existe, não há agente iterativo — por mais que
 * existam `OrcamentoDoTurno`, `Planejador`, `GerenciadorHabilidades` e
 * `Verdade`. Era exatamente esse o diagnóstico de 19/08/2026: a IARA tinha
 * todas as peças e nenhuma volta.
 *
 * O TESTE DEFINITIVO É O MULTI-HOP (seção 1). A segunda consulta usa um valor
 * que só passou a existir DEPOIS de a primeira rodar. Num pipeline de plano
 * fixo esse teste é impossível de passar — não há onde o valor entrar.
 *
 * O dublê do planejador é LOOP-AWARE de propósito: ele lê o parâmetro
 * `observado` e decide em cima dele, que é o que um planejador real faz. Um
 * dublê que devolvesse sempre o mesmo plano mediria outra coisa — foi assim que
 * a primeira rodada desta implementação escondeu dois defeitos reais (a guarda
 * cega para passo barrado e a repetição de chamada bem-sucedida).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { TETOS_PADRAO, type TetosDoTurno } from '../servidor/nucleo/kernel/OrcamentoDoTurno';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import type { Plano } from '../servidor/nucleo/kernel/Evento';

/** Enunciado composto: força `plano_cognitivo`, que é a rota que dá volta. */
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

interface Chamada {
  readonly filtro: string;
  readonly agrupar_por?: string;
}

/**
 * A habilidade de laboratório. `dentre` no esquema é o que permite provar
 * recuperação de parâmetro inválido pelo caminho REAL de validação — o mesmo
 * `validarParametros` que a produção usa, sem atalho.
 */
function habilidadeDeLab(responder: (c: Chamada) => string | Error) {
  const chamadas: Chamada[] = [];
  const habilidade: Habilidade = {
    manifesto: {
      id: 'lab.consultar',
      nome: 'lab.consultar',
      descricao: 'consulta de laboratório com filtro e agrupamento',
      dominio: 'operacoes',
      capacidade: 'conhecimento',
      permissoes: ['banco'],
      timeout_ms: 30_000,
      custo: 'zero',
      risco: 'baixo',
      idempotencia: 'leitura',
      esquema: {
        filtro: { tipo: 'texto', obrigatorio: true },
        agrupar_por: { tipo: 'texto', dentre: ['motorista', 'central'] },
      },
    },
    async executar(ctx) {
      const c: Chamada = {
        filtro: String(ctx.parametros.filtro ?? ''),
        agrupar_por: ctx.parametros.agrupar_por as string | undefined,
      };
      chamadas.push(c);
      const r = responder(c);
      if (r instanceof Error) throw r;
      return { texto: r, detalhe: 'lab', resolveu: true };
    },
  };
  return { habilidade, chamadas };
}

const passo = (parametros: Record<string, unknown>): Plano => ({
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'consultar', habilidade: 'lab.consultar', parametros }],
});

const terminou: Plano = {
  objetivo: 'lab',
  origem: 'emergente' as const,
  passos: [{ indice: 0, descricao: 'responder', habilidade: null, parametros: {} }],
};

/**
 * Monta um Kernel real com um planejador que decide a partir do observado.
 * `decidir` recebe o texto das observações (ausente na volta 1).
 */
function montar(
  habilidade: Habilidade,
  decidir: (observado: string | undefined, volta: number) => Plano | null,
  tetos?: Partial<TetosDoTurno>,
) {
  const barramento = new BarramentoEventos('s-laco');
  const concluidas: string[] = [];
  const falhas: Array<{ modulo: string; mensagem: string }> = [];
  const observados: Array<string | undefined> = [];

  barramento.assinar('TAREFA_CONCLUIDA', (e) => concluidas.push(e.texto));
  barramento.assinar('FALHA', (e) => falhas.push({ modulo: e.modulo, mensagem: e.mensagem }));

  let volta = 0;
  /**
   * O LIVRO DE DECISÕES. Cada linha registra o que a decisão N consumiu e o que
   * ela escolheu — e é isso que permite provar causalidade sem depender de
   * texto de log. `consumiu` vazio na volta 1 não é detalhe: é a asserção de
   * que a primeira decisão foi tomada SEM evidência, e as outras com ela.
   */
  const livro: Array<{
    volta: number;
    consumiu: string[];
    escolheu: string | null;
    parametros: Record<string, unknown>;
  }> = [];
  const kernel = new Kernel({
    sessao: 's-laco',
    idUsuario: 'u-laco',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento,
    habilidadesExtras: [habilidade],
    tetosOrcamento: { ...TETOS_PADRAO, ...tetos },
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar(
        _p: unknown,
        _cat: unknown,
        _sinal: unknown,
        _orc: unknown,
        observado?: string,
      ) {
        volta += 1;
        observados.push(observado);
        const escolha = decidir(observado, volta);
        const primeiro = escolha?.passos?.[0];
        livro.push({
          volta,
          /* Uma "observação consumida" por linha de cabeçalho do bloco. */
          consumiu: (observado?.match(/^volta \d+ \u00b7 [^\n]+$/gm) ?? []).map((l) => l.trim()),
          escolheu: primeiro?.habilidade ?? null,
          parametros: (primeiro?.parametros ?? {}) as Record<string, unknown>,
        });
        return escolha;
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  return { kernel, concluidas, falhas, observados, livro, planejamentos: () => volta };
}

// ===========================================================================
// 1. MULTI-HOP — o teste definitivo
// ===========================================================================

test('1.1 a segunda consulta usa um valor que só existia no resultado da primeira', async () => {
  /**
   * "Qual central teve mais cargas hoje, e quantas delas estão sem motorista?"
   *
   * Não existe consulta pré-planejada que responda: a segunda depende do NOME
   * da central, que só aparece depois de a primeira rodar. Num pipeline de
   * plano fixo o segundo passo teria de ser emitido com o nome já dentro — ou
   * seja, adivinhado.
   */
  const lab = habilidadeDeLab((c) =>
    c.filtro === 'todas' ? 'a central com mais cargas foi CAMPINAS' : `12 cargas em ${c.filtro}`,
  );

  const { kernel, concluidas, observados } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'todas' });
    const m = /CAMPINAS/.exec(observado);
    if (m) return passo({ filtro: 'CAMPINAS' });
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 2, 'a habilidade tem que ter rodado nas duas voltas');
  assert.equal(lab.chamadas[0].filtro, 'todas');
  assert.equal(
    lab.chamadas[1].filtro,
    'CAMPINAS',
    'ESTE é o laço: o parâmetro da 2ª chamada saiu do RESULTADO da 1ª',
  );
  assert.equal(observados[0], undefined, 'a volta 1 decide sem observação — não há nenhuma ainda');
  assert.match(String(observados[1]), /CAMPINAS/, 'a volta 2 recebeu o resultado da volta 1');
  assert.equal(concluidas.length, 1, 'um turno, uma resposta');
});

test('1.2 a observação chega ao decisor com procedência e volta declaradas', async () => {
  const lab = habilidadeDeLab(() => '53 motoristas distintos');
  const { kernel, observados } = montar(lab.habilidade, (o) =>
    o ? terminou : passo({ filtro: 'todas' }),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  const obs = String(observados[1]);
  assert.match(obs, /OBSERVADO NESTE TURNO/);
  assert.match(obs, /volta 1/, 'a volta em que o fato foi observado');
  assert.match(obs, /lab\.consultar/, 'quem produziu');
  /**
   * A procedência é a que o KERNEL apurou, não uma que o laço escolheu.
   * Consulta de risco baixo sai `fato_verificado` porque, no vocabulário de
   * `Verdade.ts`, a resposta É o resultado — não há mundo separado a conferir.
   * O que esta bateria trava é que o valor vem do vocabulário e que o laço
   * NUNCA o promove sozinho (ver 1.3).
   */
  assert.match(obs, /fato_verificado|resultado_ferramenta/);
  assert.match(obs, /53 motoristas distintos/, 'o conteúdo observado');
});

test('1.3 o laço NÃO promove procedência: passo que falhou não vira fato', async () => {
  const lab = habilidadeDeLab((c) =>
    c.filtro === 'quebrado' ? new Error('fonte fora do ar') : 'ok',
  );
  const vistos: Array<string | undefined> = [];
  const { kernel } = montar(lab.habilidade, (observado) => {
    vistos.push(observado);
    return observado ? terminou : passo({ filtro: 'quebrado' });
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  const obs = String(vistos[1]);
  assert.match(obs, /resultado_ferramenta/, 'relato de executor que falhou não é fato verificado');
  assert.ok(
    !/fato_verificado/.test(obs),
    'promover o que não aconteceu a fato verificado é a mentira operacional que a IARA combate',
  );
  assert.match(obs, /fonte fora do ar/, 'e o motivo chega inteiro ao decisor');
});

// ===========================================================================
// 2. RECUPERAÇÃO — falha é observação, não fim de turno
// ===========================================================================

test('2.1 parâmetro inválido: o erro volta ao decisor e ele corrige', async () => {
  /**
   * O incidente de produção de 18/08/2026 em uma volta: `agrupar_por` fora do
   * enum matava o turno inteiro e o nome de um parâmetro interno ia para a tela
   * de quem só queria um número. Com laço, o erro é insumo.
   */
  const lab = habilidadeDeLab((c) => `agrupado por ${c.agrupar_por}`);
  const { kernel, concluidas } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'todas', agrupar_por: 'motoristaXYZ' });
    if (/fora dos valores aceitos|agrupar_por/.test(observado)) {
      return passo({ filtro: 'todas', agrupar_por: 'motorista' });
    }
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(
    lab.chamadas.length,
    1,
    'a chamada inválida é barrada pelo esquema ANTES do executor — ela não conta',
  );
  assert.equal(lab.chamadas[0].agrupar_por, 'motorista', 'a segunda volta corrigiu o parâmetro');
  assert.equal(concluidas.length, 1);
});

test('2.2 resultado vazio faz o decisor tentar outro caminho', async () => {
  const lab = habilidadeDeLab((c) => (c.filtro === 'hoje' ? '' : '12 cargas na semana'));
  const { kernel } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'hoje' });
    if (!/12 cargas/.test(observado)) return passo({ filtro: 'semana' });
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 2);
  assert.equal(
    lab.chamadas[1].filtro,
    'semana',
    'vazio não é "não existe" — é motivo para tentar outro filtro',
  );
});

test('2.3 habilidade que explode vira observação, não turno morto', async () => {
  const lab = habilidadeDeLab((c) =>
    c.filtro === 'quebrado' ? new Error('fonte indisponível') : 'dados ok',
  );
  const { kernel, concluidas } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'quebrado' });
    if (/indisponível/.test(observado)) return passo({ filtro: 'alternativa' });
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 2, 'a exceção não pode encerrar o turno');
  assert.equal(lab.chamadas[1].filtro, 'alternativa');
  assert.equal(concluidas.length, 1, 'e a resposta sai mesmo assim');
});

// ===========================================================================
// 3. TERMINAÇÃO — quatro saídas, nenhuma confiando no modelo
// ===========================================================================

test('3.1 plano sem habilidade encerra o laço — é como o modelo diz "terminei"', async () => {
  const lab = habilidadeDeLab(() => 'ok');
  const { kernel, planejamentos } = montar(lab.habilidade, (o) =>
    o ? terminou : passo({ filtro: 'todas' }),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 1);
  assert.equal(planejamentos(), 2, 'uma decisão inicial e uma que declarou o fim');
});

test('3.2 decisor que NUNCA termina esbarra no teto de voltas e responde assim mesmo', async () => {
  /* O modelo pede uma consulta nova a cada volta, para sempre. É o cenário que
     transforma laço em conta de API aberta — e o que tem de parar sem silêncio. */
  let n = 0;
  const lab = habilidadeDeLab(() => `resultado ${(n += 1)}`);
  const { kernel, concluidas, falhas, planejamentos } = montar(
    lab.habilidade,
    (_o, volta) => passo({ filtro: `tentativa-${volta}` }),
    { voltas: 4 },
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 4, `o teto de 4 voltas tem que morder (${lab.chamadas.length})`);
  assert.ok(planejamentos() <= 5, 'nenhuma decisão além do teto');
  assert.equal(concluidas.length, 1, 'o teto NUNCA devolve silêncio');
  assert.ok(
    falhas.some((f) => f.modulo === 'guarda_do_laco' || f.modulo === 'orcamento'),
    'e o motivo de ter parado é dito, não engolido',
  );
});

test('3.3 orçamento de chamadas esgotado para o laço antes do teto de voltas', async () => {
  let n = 0;
  const lab = habilidadeDeLab(() => `resultado ${(n += 1)}`);
  const { kernel, concluidas, falhas } = montar(
    lab.habilidade,
    (_o, volta) => passo({ filtro: `tentativa-${volta}` }),
    { voltas: 8, chamadas_modelo: 3 },
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.ok(lab.chamadas.length < 8, 'o orçamento tem que cortar antes do teto de voltas');
  assert.equal(concluidas.length, 1);
  assert.ok(falhas.some((f) => f.modulo === 'orcamento'));
});

test('3.4 decisor que devolve null para o laço com o que já tem', async () => {
  const lab = habilidadeDeLab(() => 'parcial');
  const { kernel, concluidas } = montar(lab.habilidade, (o) =>
    o ? null : passo({ filtro: 'todas' }),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 1);
  assert.equal(concluidas.length, 1, 'provedor fora no meio do laço não pode matar a resposta');
});

// ===========================================================================
// 4. A GUARDA DENTRO DO LAÇO
// ===========================================================================

test('4.1 decisor que repete a MESMA chamada é barrado e o laço para', async () => {
  /* O modo de falha mais barato de produzir e mais caro de deixar passar. */
  const lab = habilidadeDeLab(() => 'sempre o mesmo');
  const { kernel, concluidas } = montar(lab.habilidade, () => passo({ filtro: 'igual' }), {
    voltas: 8,
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(
    lab.chamadas.length,
    1,
    `chamada idêntica não pode rodar duas vezes no mesmo turno (rodou ${lab.chamadas.length}×)`,
  );
  assert.equal(concluidas.length, 1);
});

test('4.2 o motivo da guarda chega ao decisor como observação', async () => {
  const lab = habilidadeDeLab(() => 'x');
  const vistos: Array<string | undefined> = [];
  const { kernel } = montar(
    lab.habilidade,
    (observado) => {
      vistos.push(observado);
      return passo({ filtro: 'igual' });
    },
    { voltas: 8 },
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  const ultima = vistos.filter(Boolean).pop();
  assert.ok(ultima, 'tem que ter havido pelo menos um replanejamento');
  assert.match(
    String(ultima),
    /lab\.consultar/,
    'a observação nomeia a habilidade que já rodou — barrar é falar',
  );
});

// ===========================================================================
// 5. O QUE NÃO PODE TER MUDADO
// ===========================================================================

test('5.1 teto de UMA volta reproduz o pipeline anterior ao laço', async () => {
  /**
   * A saída de emergência sem código morto: `IARA_ORCAMENTO_VOLTAS=1` não
   * desliga um caminho — declara um teto. O comportamento resultante é o de
   * antes de 19/08/2026, e é isto que o torna verificável.
   */
  const lab = habilidadeDeLab(() => 'resultado único');
  const { kernel, concluidas, planejamentos } = montar(
    lab.habilidade,
    (o) => (o ? passo({ filtro: 'outro' }) : passo({ filtro: 'todas' })),
    { voltas: 1 },
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(planejamentos(), 1, 'uma decisão só — nenhum replanejamento');
  assert.equal(lab.chamadas.length, 1);
  assert.equal(concluidas.length, 1);
});

test('5.2 o laço não inventa volta quando a primeira decisão já termina', async () => {
  const lab = habilidadeDeLab(() => 'x');
  const { kernel, planejamentos } = montar(lab.habilidade, () => terminou);

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(planejamentos(), 1);
  assert.equal(lab.chamadas.length, 0, 'nenhuma habilidade rodou — nenhuma foi pedida');
});

test('5.3 o teto de voltas do orçamento e o da guarda são o mesmo número', () => {
  /* Invariante, não retrato: são duas travas independentes sobre o mesmo laço,
     e uma importando a outra as tornaria uma só. Divergir faria uma delas nunca
     disparar — código morto disfarçado de defesa em profundidade. */
  assert.equal(TETOS_PADRAO.voltas, 8);
});


// ===========================================================================
// 6. AS CINCO PROPRIEDADES — o que separa "chamou o modelo N vezes" de agência
// ===========================================================================

test('L-01 recorrência: existe decisão DEPOIS da execução de uma habilidade', async () => {
  const lab = habilidadeDeLab(() => 'resultado A');
  const { kernel, livro } = montar(lab.habilidade, (o) =>
    o ? terminou : passo({ filtro: 'primeira' }),
  );

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.ok(livro.length >= 2, 'tem que haver decisão depois da execução');
  assert.deepEqual(livro[0].consumiu, [], 'a 1ª decide sem evidência — não há nenhuma ainda');
  assert.equal(livro[1].consumiu.length, 1, 'a 2ª consumiu exatamente a observação da 1ª');
});

test('L-02 CAUSALIDADE: mesma função de decisão, observação diferente, decisão diferente', async () => {
  /**
   * O TESTE DECISIVO, e o único que elimina o falso positivo "há várias
   * chamadas ao modelo, logo há um agente".
   *
   * As duas execuções usam a MESMA função de decisão, byte a byte. A única
   * coisa que muda é o que a ferramenta devolve. Se a segunda decisão diverge,
   * a observação é entrada CAUSAL da decisão — não há outra explicação, porque
   * não há outra variável.
   *
   *     resultado_1 != resultado_2  =>  decisao_2A != decisao_2B
   *
   * Um laço "visualmente correto mas semanticamente cego" passa em 1.1 e falha
   * aqui.
   */
  const decisor = (observado: string | undefined) => {
    if (!observado) return passo({ filtro: 'sonda' });
    if (/PERFIL=X/.test(observado)) return passo({ filtro: 'caminho-X' });
    if (/PERFIL=Y/.test(observado)) return passo({ filtro: 'caminho-Y' });
    return terminou;
  };

  const rodar = async (perfil: 'X' | 'Y') => {
    const lab = habilidadeDeLab((c) => (c.filtro === 'sonda' ? `PERFIL=${perfil}` : 'feito'));
    const { kernel, livro } = montar(lab.habilidade, decisor);
    await kernel.processar(PEDIDO, 'm1', 'espelho-A');
    return { livro, chamadas: lab.chamadas };
  };

  const a = await rodar('X');
  const b = await rodar('Y');

  assert.equal(a.livro[0].parametros.filtro, b.livro[0].parametros.filtro, 'a 1ª decisão é igual');
  assert.equal(a.livro[1].parametros.filtro, 'caminho-X');
  assert.equal(b.livro[1].parametros.filtro, 'caminho-Y');
  assert.notEqual(
    a.livro[1].parametros.filtro,
    b.livro[1].parametros.filtro,
    'a 2ª decisão TEM que divergir — é a prova de que a observação entrou nela',
  );
  assert.equal(a.chamadas[1].filtro, 'caminho-X', 'e a divergência chegou ao mundo');
  assert.equal(b.chamadas[1].filtro, 'caminho-Y');
});

test('L-03 adaptação: vazio produz um caminho que não estava na decisão original', async () => {
  const lab = habilidadeDeLab((c) => (c.filtro === 'hoje' ? '' : '12 cargas'));
  const { kernel, livro } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'hoje' });
    if (!/12 cargas/.test(observado)) return passo({ filtro: 'semana' });
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(livro[0].parametros.filtro, 'hoje');
  assert.equal(livro[1].parametros.filtro, 'semana');
  assert.notEqual(
    livro[0].parametros.filtro,
    livro[1].parametros.filtro,
    'vazio não é "não existe" — é motivo para tentar outro caminho',
  );
});

test('L-04 erro recuperável: erro → observação → decisão nova, não retry mecânico', async () => {
  const lab = habilidadeDeLab(() => 'agrupado');
  const { kernel, livro } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'todas', agrupar_por: 'motoristaXYZ' });
    if (/agrupar_por/.test(observado)) return passo({ filtro: 'todas', agrupar_por: 'central' });
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(livro[0].parametros.agrupar_por, 'motoristaXYZ');
  assert.equal(livro[1].parametros.agrupar_por, 'central');
  assert.notEqual(
    livro[0].parametros.agrupar_por,
    livro[1].parametros.agrupar_por,
    'retry mecânico repetiria o MESMO parâmetro; recuperação muda ele',
  );
  assert.equal(lab.chamadas.length, 1, 'a inválida morreu no esquema, antes do executor');
});

test('L-05 sucesso NÃO significa fim: evidência nova pode provocar ação nova', async () => {
  /* O detector `ja_executado` não pode ler "deu certo" como "acabou". Ele barra
     a REPETIÇÃO idêntica, nunca uma ação diferente motivada pelo resultado. */
  const lab = habilidadeDeLab((c) =>
    c.filtro === 'localizar' ? 'o item está em CAMPINAS' : 'detalhe de CAMPINAS',
  );
  const { kernel, livro } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'localizar' });
    if (/CAMPINAS/.test(observado) && !/detalhe/.test(observado)) {
      return passo({ filtro: 'CAMPINAS' });
    }
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(lab.chamadas.length, 2, 'as duas rodaram — sucesso não encerrou o laço');
  assert.equal(livro.length, 3, 'decidir, decidir de novo, e declarar o fim');
  assert.equal(livro[2].escolheu, null, 'a terceira decisão é o FINAL');
});

test('L-06 NÃO-ANTECIPAÇÃO: a ação da volta 2 não existia no plano da volta 1', async () => {
  /**
   * A propriedade que impede o retorno silencioso ao defeito original. Se o
   * primeiro plano já pudesse conter a segunda ação, o laço seria decoração em
   * cima de planejamento antecipado.
   *
   * Duas provas no mesmo teste:
   *  · a decisão da volta 1, registrada no livro, não menciona `caminho-B`;
   *  · um replanejo que devolve DOIS passos executa UM — o corte é do parser,
   *    não um pedido no prompt que o modelo possa ignorar.
   */
  const lab = habilidadeDeLab(() => 'a resposta exige o caminho-B');
  const { kernel, livro } = montar(lab.habilidade, (observado) => {
    if (!observado) return passo({ filtro: 'caminho-A' });
    if (/caminho-B/.test(observado)) {
      return {
        objetivo: 'lab',
        origem: 'emergente' as const,
        passos: [
          {
            indice: 0,
            descricao: 'b',
            habilidade: 'lab.consultar',
            parametros: { filtro: 'caminho-B' },
          },
          {
            indice: 1,
            descricao: 'c',
            habilidade: 'lab.consultar',
            parametros: { filtro: 'caminho-C' },
          },
        ],
      };
    }
    return terminou;
  });

  await kernel.processar(PEDIDO, 'm1', 'espelho-A');

  assert.equal(livro[0].parametros.filtro, 'caminho-A');
  assert.ok(
    !JSON.stringify(livro[0]).includes('caminho-B'),
    'a ação da volta 2 NÃO pode aparecer na decisão da volta 1',
  );
  assert.equal(lab.chamadas[1].filtro, 'caminho-B');
  assert.ok(
    !lab.chamadas.some((c) => c.filtro === 'caminho-C'),
    'o 2º passo de um replanejo é cortado pelo parser — nada de plano oculto',
  );
});

test('L-07 terminabilidade: todo caminho chega a FINAL, teto ou bloqueio', async () => {
  /* Três decisores patológicos; nenhum pode girar para sempre nem terminar em
     silêncio. */
  const cenarios: Array<[string, (o: string | undefined, v: number) => Plano | null]> = [
    ['nunca termina', (_o, v) => passo({ filtro: `t-${v}` })],
    ['repete igual', () => passo({ filtro: 'igual' })],
    ['sempre falha diferente', (_o, v) => passo({ filtro: `x-${v}`, agrupar_por: `inv-${v}` })],
  ];

  for (const [nome, decisor] of cenarios) {
    const lab = habilidadeDeLab(() => 'ok');
    const { kernel, concluidas } = montar(lab.habilidade, decisor, { voltas: 8 });
    await kernel.processar(PEDIDO, 'm1', 'espelho-A');
    assert.equal(concluidas.length, 1, `"${nome}" tem que terminar com UMA resposta`);
    assert.ok(lab.chamadas.length <= 8, `"${nome}" não pode passar do teto de voltas`);
  }
});
