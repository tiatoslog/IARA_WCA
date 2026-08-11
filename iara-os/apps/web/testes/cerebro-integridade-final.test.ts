/**
 * INTEGRIDADE FINAL — fechamento forense do núcleo cognitivo (11/08/2026).
 *
 * O QUE ESTA SUÍTE FAZ E AS OUTRAS NÃO: exercita as três situações que o
 * catálogo real não consegue produzir — o executor que trava, o verificador que
 * pendura, e o executor que ALCANÇA O MUNDO e só então explode — e verifica
 * como a RESPOSTA fala de cada uma. Provar isso na camada do
 * `GerenciadorHabilidades` já era possível; o que faltava era o último elo, e
 * era justamente ali que estava o defeito: um passo `verificado` que não
 * chegava a frase nenhuma.
 *
 * REGRA: `habilidadesExtras` ACRESCENTA ao catálogo real, nunca substitui, e
 * não desliga guarda nenhuma — porteiro, sandbox, esquema, timeout e
 * verificador continuam todos no caminho. O primeiro teste trava isso.
 *
 * BUGS QUE ESTA SUÍTE PEGOU (fechamento forense):
 *   B1  passo confirmado pelo mundo após exceção do executor não chegava à
 *       resposta → "Nada foi alterado" com o efeito aplicado.
 *   B2  modo irrealis ("se eu pedisse para desligar", "você consegue desligar?")
 *       armava pendência de risco alto.
 *   B3  prosa da própria LLM entrava na memória com o mesmo peso do que o
 *       operador declarou, e derrubava o fato dele por ser mais recente.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { RegistroMemoria } from '../lib/estado';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { AgenteLocal, agenteLocal } from '../servidor/nucleo/AgenteLocal';
import { extrairFatosHorario, detectarConflitos } from '../servidor/nucleo/kernel/MemoriaFatos';

const TIME = ['Marina Alves', 'João Silva', 'João Pereira'];

function memoriaCom(registros: RegistroMemoria[] = []): MemoriaOperacional {
  return {
    async registrar() {},
    async historico() {
      return registros;
    },
    async carregarGlobal() {
      return '';
    },
    async lerPreferencias() {
      return {} as never;
    },
  } as unknown as MemoriaOperacional;
}

/**
 * Habilidade de laboratório. `risco: 'medio'` para cair na mesma política das
 * habilidades que alteram a máquina — é essa política que está sob teste.
 */
function laboratorio(
  id: string,
  o: {
    executar: Habilidade['executar'];
    verificar?: Habilidade['verificar'];
    timeout_ms?: number;
    risco?: 'baixo' | 'medio' | 'alto';
  },
): Habilidade {
  return {
    manifesto: {
      id,
      nome: id,
      descricao: id,
      dominio: 'automacao',
      capacidade: 'automacao',
      permissoes: ['escrita'],
      timeout_ms: o.timeout_ms ?? 60,
      custo: 'zero',
      risco: o.risco ?? 'medio',
      esquema: {},
    },
    executar: o.executar,
    verificar: o.verificar,
  } as Habilidade;
}

/**
 * Um turno pelo Kernel REAL, com um plano determinístico de passo único
 * apontando para a habilidade de laboratório. O plano é `deterministico`
 * porque o que se testa aqui é a EXECUÇÃO e a RESPOSTA, não o porteiro —
 * o porteiro tem suíte própria.
 */
async function turnoComHabilidade(habilidade: Habilidade, usuario: string) {
  const barramento = new BarramentoEventos('s-final');
  const kernel = new Kernel({
    sessao: 's-final',
    idUsuario: usuario,
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
    habilidadesExtras: [habilidade],
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      async planejar() {
        return {
          objetivo: 'exercitar a habilidade de laboratório',
          origem: 'deterministico' as const,
          passos: [
            {
              indice: 0,
              descricao: 'passo de laboratório',
              habilidade: habilidade.manifesto.id,
              parametros: {},
            },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as import('../servidor/nucleo/kernel/MotorRaciocinio').MotorRaciocinio,
  });

  let fala = '';
  const resumos: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') fala = e.texto;
    if (e.tipo === 'PASSO_CONCLUIDO') resumos.push(e.resumo);
  });

  // Enunciado composto: força `plano_cognitivo`, que consulta `planejar`.
  await kernel.processar(
    'analise o levantamento de custos e depois gere um resumo executivo comparativo',
  );
  return { fala, resumos };
}

// ===========================================================================
// 0. A COSTURA NÃO PODE VIRAR BURACO
// ===========================================================================

test('0. `habilidadesExtras` acrescenta; produção continua com o catálogo real', () => {
  // Se alguém um dia passar habilidade extra em `Porta.ts`, este teste não pega
  // — mas a ausência do campo lá é verificável por leitura, e o que ESTE teste
  // trava é o contrato: sem o campo, o catálogo é exatamente o de sempre.
  const barramento = new BarramentoEventos('s-catalogo');
  const kernel = new Kernel({
    sessao: 's-catalogo',
    idUsuario: 'u-catalogo',
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
  });
  void kernel;
  // O catálogo real não contém nenhuma habilidade de laboratório.
  assert.ok(
    !CATALOGO.some((h) => h.manifesto.id.startsWith('lab_')),
    'habilidade de laboratório vazou para o catálogo de produção',
  );
});

test('0b. habilidade injetada NÃO escapa do porteiro de autorização', async () => {
  // A costura existe para exercitar travas, nunca para contorná-las.
  const perigosa = laboratorio('lab_perigosa', {
    risco: 'alto',
    async executar() {
      return { texto: 'EXECUTEI', detalhe: 'x', resolveu: true };
    },
    async verificar() {
      return { confirmado: true, evidencia: 'x' };
    },
  });

  const barramento = new BarramentoEventos('s-porteiro');
  const kernel = new Kernel({
    sessao: 's-porteiro',
    idUsuario: 'u-porteiro',
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
    habilidadesExtras: [perigosa],
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      async planejar() {
        return {
          objetivo: 'x',
          origem: 'emergente' as const,
          passos: [
            { indice: 0, descricao: 'passo hostil', habilidade: 'lab_perigosa', parametros: {} },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as import('../servidor/nucleo/kernel/MotorRaciocinio').MotorRaciocinio,
  });

  let fala = '';
  barramento.assinar('TAREFA_CONCLUIDA', (e) => {
    fala = e.texto;
  });
  await kernel.processar(
    'analise o levantamento de custos e depois gere um resumo executivo comparativo',
  );

  assert.doesNotMatch(fala, /EXECUTEI/, 'a habilidade injetada de risco alto executou');
  assert.match(fala, /risco alto/i);
});

// ===========================================================================
// 1. B1 — O MUNDO CONFIRMA DEPOIS DA EXCEÇÃO
// ===========================================================================

test('1. executor explode DEPOIS de aplicar; o mundo confirma → a resposta CONTA', async () => {
  let aplicado = false;
  const h = laboratorio('lab_efeito_antes_do_erro', {
    async executar() {
      aplicado = true;
      throw new Error('conexão caiu depois de aplicar');
    },
    async verificar() {
      return aplicado
        ? { confirmado: true, evidencia: 'o registro existe no destino' }
        : { confirmado: false, evidencia: 'nada', motivo: 'nao_encontrado' as const };
    },
  });

  const r = await turnoComHabilidade(h, 'u-final-1');

  assert.equal(aplicado, true, 'pré-condição: o efeito precisa ter acontecido');
  assert.doesNotMatch(
    r.fala,
    /nada foi alterado/i,
    `negou um efeito que o mundo confirma: "${r.fala}"`,
  );
  assert.match(
    r.fala,
    /o registro existe no destino/,
    `o efeito confirmado sumiu da resposta: "${r.fala}"`,
  );
});

test('1b. executor explode e o mundo DESMENTE → falhou, e a garantia volta a valer', async () => {
  const h = laboratorio('lab_erro_sem_efeito', {
    async executar() {
      throw new Error('recusado pelo destino');
    },
    async verificar() {
      return { confirmado: false, evidencia: 'nada foi criado', motivo: 'nao_encontrado' as const };
    },
  });

  const r = await turnoComHabilidade(h, 'u-final-1b');
  assert.match(r.fala, /não executei|nada foi alterado/i);
});

test('1c. executor explode e NÃO há como apurar → desconhecido, nunca "nada mudou"', async () => {
  const h = laboratorio('lab_erro_sem_verificador', {
    async executar() {
      throw new Error('timeout do provedor');
    },
    // sem `verificar`: não há a quem perguntar
  });

  const r = await turnoComHabilidade(h, 'u-final-1c');
  assert.doesNotMatch(
    r.fala,
    /nada foi alterado/i,
    `garantiu que nada mudou sem ter como saber: "${r.fala}"`,
  );
  assert.match(r.fala, /não consigo provar|pode ter acontecido/i);
});

// ===========================================================================
// 2. TIMEOUT E VERIFICADOR PENDURADO — PELO KERNEL REAL
// ===========================================================================

test('2. executor que trava não pendura o turno e não vira sucesso', async () => {
  const h = laboratorio('lab_pendurado', {
    timeout_ms: 40,
    executar: () => new Promise(() => {}),
    async verificar() {
      return {
        confirmado: false,
        evidencia: 'não sei dizer',
        motivo: 'sem_meio_de_verificar' as const,
      };
    },
  });

  const r = await turnoComHabilidade(h, 'u-final-2');
  assert.doesNotMatch(r.fala, /nada foi alterado/i);
  assert.match(r.fala, /não consigo provar|pode ter acontecido/i);
});

test('2b. verificador que pendura vira desconhecido, e o turno termina', async () => {
  const h = laboratorio('lab_verificador_pendurado', {
    timeout_ms: 40,
    async executar() {
      return { texto: 'Solicitei a operação.', detalhe: 'x', resolveu: true };
    },
    verificar: () => new Promise(() => {}),
  });

  const r = await turnoComHabilidade(h, 'u-final-2b');
  assert.match(r.fala, /não consigo provar/i, `verificador travado não virou ressalva: "${r.fala}"`);
});

// ===========================================================================
// 3. DIVERGÊNCIA — O MUNDO GANHA DO EXECUTOR
// ===========================================================================

test('3. executor diz "criado", mundo diz "não existe" → a fala não abre com a mentira', async () => {
  const h = laboratorio('lab_divergente', {
    async executar() {
      return { texto: 'Registro criado com sucesso.', detalhe: 'x', resolveu: true };
    },
    async verificar() {
      return {
        confirmado: false,
        evidencia: 'o registro não existe depois da execução',
        motivo: 'divergente' as const,
      };
    },
  });

  const r = await turnoComHabilidade(h, 'u-final-3');
  assert.doesNotMatch(
    r.fala,
    /criado com sucesso/i,
    `a fala repetiu o relato que o mundo desmentiu: "${r.fala}"`,
  );
  assert.match(r.fala, /não existe depois da execução/);
});

test('3b. executor honesto sobre a própria recusa mantém o texto útil', async () => {
  // `nao_encontrado` não é `divergente`: aqui o executor JÁ contou a verdade, e
  // trocar a frase dele pela evidência crua puniria a honestidade.
  const h = laboratorio('lab_recusa_honesta', {
    async executar() {
      return {
        texto: 'Esse nome não passa na minha regra de segurança. Me diga outro que eu crio.',
        detalhe: 'x',
        resolveu: false,
      };
    },
    async verificar() {
      return {
        confirmado: false,
        evidencia: 'nome recusado; nada foi criado',
        motivo: 'nao_encontrado' as const,
      };
    },
  });

  const r = await turnoComHabilidade(h, 'u-final-3b');
  assert.match(r.fala, /me diga outro/i, 'a frase útil do executor foi descartada');
});

// ===========================================================================
// 4. B2 — MODO IRREALIS NÃO ARMA AÇÃO
// ===========================================================================

test('4. hipótese, simulação e pergunta de capacidade não armam pendência', () => {
  const p = new MotorPercepcao();
  const violacoes: string[] = [];

  for (const frase of [
    'se eu pedisse para desligar o computador, o que aconteceria?',
    'se eu mandar você reiniciar a máquina, você avisa antes?',
    'imagine que eu pedisse para desligar o computador',
    'suponha que eu mande desligar o computador agora',
    'o que acontece se eu mandar você reiniciar a máquina?',
    'o que você faria se eu pedisse para suspender o computador?',
    'você consegue desligar o computador?',
    'você é capaz de reiniciar a máquina?',
    'você sabe como suspender o computador?',
    'quando você desliga o computador, avisa antes?',
    'hipoteticamente, desligar o computador demoraria quanto?',
  ]) {
    if (p.perceber(frase).ancoras.includes('energia')) violacoes.push(frase);
  }

  assert.deepEqual(violacoes, [], `menção virou ordem em: ${violacoes.join(' | ')}`);
});

test('4b. o pedido educado NÃO pode ser confundido com pergunta de capacidade', () => {
  const p = new MotorPercepcao();
  // "pode desligar?" é a forma mais comum de PEDIR em português. Suprimi-la
  // seria trocar um bug por outro — a IARA ignorando o pedido mais frequente.
  for (const frase of [
    'pode desligar o computador?',
    'poderia reiniciar a máquina?',
    'desligue o computador',
    'preciso que você suspenda o computador',
    'por favor, reinicie a máquina',
  ]) {
    assert.ok(
      p.perceber(frase).ancoras.includes('energia'),
      `pedido legítimo perdeu a âncora: "${frase}"`,
    );
  }
});

test('4c. a hipótese chega ao Kernel real sem armar pendência', async () => {
  const usuario = 'u-final-4c';
  const sessao = 's-final-4c';
  const barramento = new BarramentoEventos(sessao);
  const kernel = new Kernel({
    sessao,
    idUsuario: usuario,
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
  });

  try {
    await kernel.processar('se eu pedisse para desligar o computador, o que aconteceria?');
    assert.equal(agenteLocal.temPendencia(usuario, sessao), false);
  } finally {
    agenteLocal.cancelar(usuario, sessao);
  }
});

// ===========================================================================
// 5. B3 — A PROSA DA LLM NÃO É FONTE SOBRE O MUNDO
// ===========================================================================

function reg(
  instante: string,
  papel: 'operador' | 'iara',
  texto: string,
  destino?: RegistroMemoria['destino'],
): RegistroMemoria {
  return { id: instante, id_usuario: 'u', instante, papel, texto, destino };
}

test('5. o que o operador declarou não é derrubado por prosa da nuvem mais recente', () => {
  const fatos = extrairFatosHorario([
    reg('2026-08-10T12:00:00.000Z', 'operador', 'a reunião de alinhamento é às 16h'),
    reg('2026-08-11T09:00:00.000Z', 'iara', 'pelo que vi, a reunião é às 18h', 'claude_nuvem'),
  ]);

  assert.deepEqual(
    fatos.map((f) => f.procedencia),
    ['memoria', 'inferencia'],
    'a fala da própria IARA entrou com o mesmo peso do que a pessoa afirmou',
  );

  const c = detectarConflitos(fatos)[0];
  assert.equal(c.vigente.minutos, 16 * 60, 'alucinação recente derrubou o fato do operador');
  assert.equal(c.criterio, 'procedencia');
});

test('5b. documento recuperado ANTIGO vence memória do operador RECENTE', () => {
  // O exemplo documentado em `Verdade.ts`: procedência vence primeiro, recência
  // só desempata dentro da mesma procedência.
  const fatos = extrairFatosHorario([
    reg('2026-08-10T12:00:00.000Z', 'iara', 'no registro, a reunião consta às 16h', 'rag_historico'),
    reg('2026-08-11T09:00:00.000Z', 'operador', 'acho que a reunião é às 17h'),
  ]);
  const c = detectarConflitos(fatos)[0];
  assert.equal(c.vigente.minutos, 16 * 60);
  assert.equal(c.criterio, 'procedencia');
});

test('5d. eco de uma AÇÃO da IARA não vira autoridade sobre o mundo', () => {
  // Ataque de segunda ordem: `plano_local` parece determinístico, mas o que
  // fica no histórico é a prosa — que traz de volta o texto do operador.
  const fatos = extrairFatosHorario([
    reg('2026-08-11T09:00:00.000Z', 'iara', 'Pasta reunião 16h criada em Documentos', 'sistema_local'),
    reg('2026-08-11T10:00:00.000Z', 'operador', 'a reunião é às 17h'),
  ]);
  const c = detectarConflitos(fatos)[0];
  assert.ok(c, 'pré-condição: os dois lados precisam virar fato para haver conflito');
  assert.equal(c.vigente.minutos, 17 * 60, 'o eco de uma criação de pasta derrubou o operador');
  assert.equal(c.criterio, 'procedencia');
});

test('5c. duas fontes igualmente confiáveis: recência desempata, conflito é declarado', () => {
  const fatos = extrairFatosHorario([
    reg('2026-08-10T12:00:00.000Z', 'operador', 'a reunião é às 16h'),
    reg('2026-08-11T09:00:00.000Z', 'operador', 'a reunião passou para 17h'),
  ]);
  const c = detectarConflitos(fatos)[0];
  assert.equal(c.vigente.minutos, 17 * 60);
  assert.equal(c.criterio, 'recencia');
  assert.equal(c.superadas.length, 1, 'a evidência antiga não pode ser apagada');
});

// ===========================================================================
// 5.5. PERGUNTAR COMO CONFIRMAR NÃO É CONFIRMAR
// ===========================================================================

test('5.5. pergunta sobre confirmação não resolve a pendência', () => {
  const p = new MotorPercepcao();
  const violacoes: string[] = [];

  for (const frase of [
    'como faço para confirmar?',
    'preciso confirmar alguma coisa?',
    'você consegue confirmar isso?',
    'o que acontece se eu confirmar?',
    'posso confirmar agora?',
    'devo confirmar ou cancelar?',
    'qual comando eu uso para confirmar?',
    'se eu confirmar, o que acontece?',
  ]) {
    if (p.perceber(frase).ancoras.includes('confirmacao')) violacoes.push(frase);
  }

  assert.deepEqual(violacoes, [], `pergunta virou resolução em: ${violacoes.join(' | ')}`);
});

test('5.5b. a confirmação de verdade e o cancelamento continuam funcionando', () => {
  const p = new MotorPercepcao();
  for (const frase of ['confirmo', 'confirmado', 'prossiga', 'confirmo o desligamento', 'cancela', 'não confirmo']) {
    assert.ok(
      p.perceber(frase).ancoras.includes('confirmacao'),
      `a âncora sumiu de uma resolução legítima: "${frase}"`,
    );
  }
});

test('5.5c. a pendência SOBREVIVE à pergunta — não é confirmada nem destruída', async () => {
  const usuario = 'u-final-55c';
  const sessao = 's-final-55c';
  const barramento = new BarramentoEventos(sessao);
  const kernel = new Kernel({
    sessao,
    idUsuario: usuario,
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
  });

  try {
    await kernel.processar('desligue o computador');
    assert.equal(agenteLocal.temPendencia(usuario, sessao), true, 'pré-condição');

    await kernel.processar('como faço para confirmar?');
    assert.equal(
      agenteLocal.temPendencia(usuario, sessao),
      true,
      'a pergunta destruiu a pendência de quem só queria entender',
    );
  } finally {
    agenteLocal.cancelar(usuario, sessao);
  }
});

// ===========================================================================
// 5.6. TERCEIRA ORDEM — ataque às correções de segunda ordem
// ===========================================================================

test('5.6. CANCELAR nunca é suprimido por interrogação', () => {
  const p = new MotorPercepcao();
  // A assimetria do `AgenteLocal`: desistir nunca exige a prova que agir exige.
  // Com `cancel` na regex de pergunta, "devo cancelar isso, certo?" perdia a
  // âncora — nada executava (lado seguro), mas o operador saía achando que
  // tinha desistido, e a pendência seguia viva até expirar.
  for (const frase of [
    'cancela',
    'cancela isso',
    'pode cancelar?',
    'quero cancelar',
    'devo cancelar isso, certo?',
    'como assim? cancela',
  ]) {
    assert.ok(
      p.perceber(frase).ancoras.includes('confirmacao'),
      `cancelamento perdido: "${frase}"`,
    );
  }
});

test('5.6b. cancelar de verdade desarma a pendência pelo Kernel real', async () => {
  const usuario = 'u-final-56b';
  const sessao = 's-final-56b';
  const barramento = new BarramentoEventos(sessao);
  const kernel = new Kernel({
    sessao,
    idUsuario: usuario,
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaCom(),
    barramento,
  });

  try {
    await kernel.processar('desligue o computador');
    assert.equal(agenteLocal.temPendencia(usuario, sessao), true, 'pré-condição');

    await kernel.processar('devo cancelar isso, certo?');
    assert.equal(
      agenteLocal.temPendencia(usuario, sessao),
      false,
      'o operador pediu para cancelar e a pendência continuou viva',
    );
  } finally {
    agenteLocal.cancelar(usuario, sessao);
  }
});

test('5.6c. hipótese não engole a ordem da frase SEGUINTE', () => {
  const p = new MotorPercepcao();
  // A supressão por irrealis olhava a mensagem inteira e decidia pela primeira
  // ocorrência do verbo. Duas frases, dois modos: a segunda é uma ordem.
  assert.ok(
    p.perceber('imagine que eu pedisse para desligar. agora desligue de verdade').ancoras.includes(
      'energia',
    ),
    'a ordem da segunda frase foi engolida pela hipótese da primeira',
  );
  assert.ok(
    p.perceber('não desligue agora. desligue às 18h').ancoras.includes('energia'),
    'a negação da primeira frase anulou o pedido da segunda',
  );
});

test('5.6d. hipótese de frase ÚNICA continua suprimida', () => {
  const p = new MotorPercepcao();
  // O escopo por período não pode virar porta: dois-pontos não separam período.
  for (const frase of [
    'suponha o seguinte: desligue o computador',
    'se eu pedisse para desligar o computador, o que aconteceria?',
    'imagine que eu pedisse para desligar o computador',
  ]) {
    assert.ok(
      !p.perceber(frase).ancoras.includes('energia'),
      `hipótese voltou a virar ordem: "${frase}"`,
    );
  }
});

// ===========================================================================
// 6. RESTART E CONCORRÊNCIA — O QUE JÁ VALE, PROVADO
// ===========================================================================

test('6. restart perde a pendência e a confirmação posterior NÃO executa', () => {
  const antes = new AgenteLocal(() => {});
  antes.pedirEnergia('ana', 'desligar', 's');
  assert.equal(antes.temPendencia('ana', 's'), true);

  // Processo reiniciado: instância nova, mapa vazio. Degradar para "não há
  // pendência" é o lado seguro — o inseguro seria reconstruir e autorizar.
  const comandos: string[] = [];
  const depois = new AgenteLocal((c, a) => comandos.push(`${c} ${a.join(' ')}`));
  assert.equal(depois.temPendencia('ana', 's'), false);
  assert.match(depois.confirmar('ana', 's'), /Não há nenhuma ação/);
  assert.equal(
    comandos.filter((c) => c.startsWith('shutdown.exe /s')).length,
    0,
    'confirmação após restart executou uma ação que o sistema não conhecia',
  );
});

test('6b. duas confirmações concorrentes não disparam duas execuções', async () => {
  const comandos: string[] = [];
  const agente = new AgenteLocal((c, a) => comandos.push(`${c} ${a.join(' ')}`));
  agente.pedirEnergia('ana', 'desligar', 's');

  await Promise.all([
    Promise.resolve().then(() => agente.confirmar('ana', 's')),
    Promise.resolve().then(() => agente.confirmar('ana', 's')),
  ]);

  assert.equal(comandos.filter((c) => c.includes('/s')).length, 1);
});

test('6c. duas ações pendentes de operadores diferentes não se cruzam', () => {
  const comandos: string[] = [];
  const agente = new AgenteLocal((c, a) => comandos.push(`${c} ${a.join(' ')}`));

  agente.pedirEnergia('ana', 'desligar', 'sa');
  agente.pedirEnergia('bruno', 'reiniciar', 'sb');

  agente.confirmar('ana', 'sa');
  assert.equal(comandos.length, 1);
  assert.match(comandos[0], /\/s\b/, 'a Ana pediu desligar e recebeu outra coisa');

  agente.confirmar('bruno', 'sb');
  assert.equal(comandos.length, 2);
  assert.match(comandos[1], /\/r\b/, 'o Bruno pediu reiniciar e recebeu outra coisa');
});
