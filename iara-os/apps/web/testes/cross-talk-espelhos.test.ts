/**
 * CC-01 — cross-talk entre espelhos. A reprodução automatizada.
 *
 * O DEFEITO, medido no navegador em 16/08/2026 com duas abas e 42 ms de
 * desalinhamento (`docs/prd/test-plan-cross-talk-espelhos.md`):
 *
 *   espelho A → "Crie uma pasta chamada Alfa na área de trabalho"
 *   espelho B → "Crie uma pasta chamada Beta nos Documentos"
 *
 *   disco:  as DUAS pastas existem
 *   tela A: "Pronto, criei a pasta «Beta» em Documentos."
 *
 * O efeito de A acontecia; era a RESPOSTA dele que morria. `Kernel.processar`
 * abria cancelando o turno anterior sem perguntar de qual tela vinha a mensagem
 * nova, e a fala do turno vencedor ia para a sessão inteira — a tela que perdeu
 * a corrida colava a confirmação alheia embaixo do próprio balão.
 *
 * 1150 testes verdes não viam isto, e não é acidente: um teste que constrói o
 * kernel na mão constrói junto a serialização que o mundo não tem. O que faltava
 * era um teste que segurasse um turno EM VOO e fizesse outra tela falar por cima
 * — que é o que este arquivo faz, com um portão sob controle do teste.
 *
 * A bateria de navegador (`testes/navegador/`) mede o mesmo defeito pela tela;
 * este arquivo mede pelo kernel, e roda em toda suíte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';

/** Enunciado composto: força `plano_cognitivo`, que consulta `planejar`. */
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

/**
 * Uma habilidade que SEGURA o turno até o teste mandar soltar.
 *
 * É a peça que faltava para provar concorrência sem depender de relógio: o
 * catálogo real é bem-comportado e devolve rápido demais para que uma segunda
 * mensagem chegue no meio. Nenhuma guarda é contornada — porteiro, sandbox,
 * esquema e verificador continuam no caminho; a habilidade só demora.
 */
function habilidadeComPortao() {
  let soltar: () => void = () => undefined;
  const portao = new Promise<void>((r) => {
    soltar = r;
  });
  let iniciou = 0;

  const habilidade: Habilidade = {
    manifesto: {
      id: 'laboratorio.demorar',
      nome: 'laboratorio.demorar',
      descricao: 'habilidade de laboratório que segura o turno até o teste soltar o portão',
      dominio: 'automacao',
      capacidade: 'automacao',
      /* `banco` é a permissão mais barata que o papel `operador` concede — o
         que está sob teste é a fila, não o porteiro, e ele continua no caminho. */
      permissoes: ['banco'],
      timeout_ms: 30_000,
      custo: 'zero',
      risco: 'baixo',
      idempotencia: 'leitura',
      esquema: { alvo: { tipo: 'texto' } },
    },
    async executar(ctx) {
      iniciou += 1;
      await portao;
      return {
        texto: `pronto para ${String(ctx.parametros.alvo)}`,
        detalhe: 'laboratório',
        resolveu: true,
      };
    },
  };

  return {
    habilidade,
    soltar: () => soltar(),
    get iniciou() {
      return iniciou;
    },
  };
}

function montar(habilidade: Habilidade) {
  const barramento = new BarramentoEventos('s-crosstalk');
  const concluidas: Array<{ texto: string; responde_a: string | null }> = [];
  const canceladas: string[] = [];
  const falhas: Array<{ modulo: string; mensagem: string }> = [];

  barramento.assinar('TAREFA_CONCLUIDA', (e) =>
    concluidas.push({ texto: e.texto, responde_a: e.responde_a }),
  );
  barramento.assinar('TAREFA_CANCELADA', (e) => canceladas.push(e.motivo));
  barramento.assinar('FALHA', (e) => falhas.push({ modulo: e.modulo, mensagem: e.mensagem }));

  const filas: Array<readonly { id_mensagem: string; texto: string }[]> = [];
  barramento.assinar('FILA_ATUALIZADA', (e) => filas.push(e.pedidos));

  const kernel = new Kernel({
    sessao: 's-crosstalk',
    idUsuario: 'u-crosstalk',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaVazia(),
    barramento,
    habilidadesExtras: [habilidade],
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      origem: 'local',
      async planejar() {
        return {
          objetivo: 'exercitar a concorrência entre espelhos',
          origem: 'deterministico' as const,
          passos: [
            {
              indice: 0,
              descricao: 'passo que demora',
              habilidade: 'laboratorio.demorar',
              parametros: { alvo: 'x' },
            },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        p.aoReceberTexto('[sintese]');
        return { texto: '[sintese]', tokens_entrada: 0, tokens_saida: 0, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  return { kernel, concluidas, canceladas, falhas, filas };
}

/** Espera a habilidade do turno em voo ter começado de fato. */
async function esperarOTurnoEntrar(quantos: () => number, alvo: number): Promise<void> {
  for (let i = 0; i < 200 && quantos() < alvo; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(quantos() >= alvo, 'o turno não chegou a entrar na habilidade — teste inconclusivo');
}

// ===========================================================================

test('CC-01: mensagem de OUTRO espelho não cancela o turno em voo — ela espera a vez', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  // A outra tela fala com o turno de A ainda em voo. Antes, isto matava A.
  const turnoB = kernel.processar(PEDIDO, 'b1', 'espelho-B');
  await turnoB;

  assert.equal(canceladas.length, 0, 'nenhum turno pode ter sido cancelado por outra tela');
  assert.equal(kernel.pedidosNaFila, 1, 'o pedido do outro espelho tem de estar na fila');
  assert.equal(concluidas.length, 0, 'ninguém responde antes de o portão abrir');

  lab.soltar();
  await turnoA;

  assert.equal(concluidas.length, 2, 'os DOIS pedidos precisam ter recebido resposta');
  assert.equal(kernel.pedidosNaFila, 0);
  assert.equal(lab.iniciou, 2, 'o pedido enfileirado precisa ter EXECUTADO, não só respondido');
});

test('CC-01: cada fala declara a pergunta que responde — nenhuma tela herda a resposta da outra', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  lab.soltar();
  await turnoA;

  const enderecos = concluidas.map((c) => c.responde_a);
  assert.deepEqual(
    enderecos,
    ['op:a1', 'op:b1'],
    'a resposta de cada turno tem de apontar para a pergunta daquele turno, na ordem em que foram atendidos',
  );
});

test('CC-01: a MESMA tela reescrevendo continua preemptando — a correção não matou a interrupção legítima', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  // Mesma tela, pedido novo: a pessoa se corrigiu. O turno velho morre.
  const turnoA2 = kernel.processar(PEDIDO, 'a2', 'espelho-A');
  lab.soltar();
  await Promise.all([turnoA, turnoA2]);

  assert.equal(canceladas.length, 1, 'a preempção da própria tela precisa continuar acontecendo');
  assert.equal(kernel.pedidosNaFila, 0, 'a própria tela nunca entra na fila');
  assert.equal(concluidas.length, 1, 'o turno preemptado não fala — quem fala é o turno novo');
  assert.equal(concluidas[0].responde_a, 'op:a2');
});

test('CC-01: fila cheia RECUSA em voz alta — nada é descartado em silêncio', async () => {
  const lab = habilidadeComPortao();
  const { kernel, falhas, concluidas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  // Quatro telas diferentes esperando: a fila enche.
  for (const tela of ['t1', 't2', 't3', 't4']) {
    await kernel.processar(PEDIDO, tela, `espelho-${tela}`);
  }
  assert.equal(kernel.pedidosNaFila, 4);
  assert.equal(falhas.length, 0, 'até o teto, ninguém é recusado');

  // A quinta não cabe.
  await kernel.processar(PEDIDO, 't5', 'espelho-t5');
  assert.equal(kernel.pedidosNaFila, 4, 'a fila não pode passar do teto');
  assert.equal(falhas.length, 1, 'a recusa precisa ser dita');
  assert.equal(falhas[0].modulo, 'fila_de_espelhos');
  assert.match(
    falhas[0].mensagem,
    /não entrou na fila/i,
    'a recusa precisa dizer que o pedido NÃO foi aceito — "nada foi feito com ele"',
  );

  lab.soltar();
  await turnoA;
  assert.equal(concluidas.length, 5, 'os cinco que ENTRARAM (1 em voo + 4 na fila) respondem');
});

// ===========================================================================
// CT-10 — a espera existe no contrato, não só no código
// ===========================================================================

/**
 * A lacuna que a auditoria deixou explícita: a serialização de turnos criou um
 * estado novo — "seu pedido está esperando a vez" — e não havia nada no
 * contrato que o dissesse. A pessoa via a própria bolha, via a IARA
 * trabalhando, e não tinha como saber se o trabalho era o pedido dela.
 */
test('CT-10: o pedido que espera a vez é PUBLICADO, com o id que a tela reconhece', async () => {
  const lab = habilidadeComPortao();
  const { kernel, filas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  assert.equal(filas.length, 0, 'sem ninguém esperando, não se publica fila');

  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  assert.equal(filas.length, 1, 'entrar na fila é um fato e precisa ser publicado');
  assert.deepEqual(
    filas[0].map((p) => p.id_mensagem),
    ['op:b1'],
    'o id publicado é o MESMO `op:` que a tela deu à própria bolha — é assim que ela se reconhece',
  );

  lab.soltar();
  await turnoA;

  const ultima = filas[filas.length - 1];
  assert.deepEqual(ultima, [], 'ao sair da fila, a fila publicada fica vazia');
});

test('CT-10: o id do pedido na fila é o MESMO que a resposta dele vai endereçar', async () => {
  const lab = habilidadeComPortao();
  const { kernel, filas, concluidas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  const idNaFila = filas[0][0].id_mensagem;

  lab.soltar();
  await turnoA;

  /* Se o id mudasse entre a fila e o turno, a tela veria o pedido "sair da
     fila" e uma resposta chegar endereçada a outra coisa — dois pedidos onde
     só houve um. */
  assert.equal(concluidas[1].responde_a, idNaFila);
});

test('CT-10: desistir da fila publica a fila sem o pedido', async () => {
  const lab = habilidadeComPortao();
  const { kernel, filas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  kernel.interromper('espelho-B');

  assert.deepEqual(filas[filas.length - 1], [], 'quem desistiu some da fila publicada');

  lab.soltar();
  await turnoA;
});

// ===========================================================================
// CT-05 — o "interromper" também era global à sessão
// ===========================================================================

test('CT-05: o interromper de uma tela NÃO derruba o turno da outra', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  // O turno em voo é do espelho B.
  const turnoB = kernel.processar(PEDIDO, 'b1', 'espelho-B');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  // O espelho A aperta "interromper". Ele não tem nada em andamento.
  kernel.interromper('espelho-A');

  assert.equal(
    canceladas.length,
    0,
    'a tela A não pode cancelar um turno que não é dela — era o que `Porta.ts` fazia ao chamar `cancelar()` sem origem',
  );

  lab.soltar();
  await turnoB;

  assert.equal(concluidas.length, 1, 'o turno de B precisa ter chegado ao fim');
  assert.equal(concluidas[0].responde_a, 'op:b1');
});

test('CT-05: o interromper da PRÓPRIA tela continua cancelando', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  kernel.interromper('espelho-A');
  lab.soltar();
  await turnoA;

  assert.equal(canceladas.length, 1, 'interromper o próprio turno tem de continuar funcionando');
  assert.equal(concluidas.length, 0, 'turno cancelado não fala');
});

test('CT-05: interromper com o próprio pedido NA FILA tira o pedido da fila, E CONTA', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  assert.equal(kernel.pedidosNaFila, 1);

  // B desistiu antes de chegar a vez dele.
  kernel.interromper('espelho-B');
  assert.equal(kernel.pedidosNaFila, 0, 'desistir na fila tem de tirar o pedido da fila');
  /* Achado da auditoria de garantia: o `splice` era MUDO. Pedido que some sem
     uma linha sequer deixa a bolha na tela sem resposta e sem aviso — a mesma
     família do CC-01. */
  assert.equal(canceladas.length, 1, 'retirar da fila precisa publicar o cancelamento');
  assert.match(canceladas[0], /desistiu/i);

  lab.soltar();
  await turnoA;

  assert.equal(concluidas.length, 1, 'só o turno de A fala; o de B foi retirado antes de existir');
  assert.equal(concluidas[0].responde_a, 'op:a1');
});

test('CT-05: o cancelamento GLOBAL continua existindo — é o do desligamento', async () => {
  const lab = habilidadeComPortao();
  const { kernel, canceladas } = montar(lab.habilidade);

  const turnoB = kernel.processar(PEDIDO, 'b1', 'espelho-B');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  // `cancelar()` sem origem é a porta do desligamento e do fim da sessão —
  // essa PRECISA derrubar tudo, e é por isso que ela não sumiu.
  kernel.cancelar('todas as telas encerradas');
  lab.soltar();
  await turnoB;

  assert.equal(canceladas.length, 1);
  assert.equal(canceladas[0], 'todas as telas encerradas');
});

/**
 * O caso que a FILA criou, e que não existia antes dela: com o turno em voo
 * cancelado por "não sobrou tela nenhuma", os pedidos enfileirados continuavam
 * valendo e seriam executados contra uma sessão sem ninguém olhando. Achado na
 * auditoria de garantia, depois da entrega do CC-01.
 */
test('CT-05: fim de sessão esvazia a fila — pedido enfileirado não sobrevive ao fechamento de todas as telas', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  assert.equal(kernel.pedidosNaFila, 1);

  kernel.pararTudo('todas as telas encerradas');
  assert.equal(kernel.pedidosNaFila, 0, 'fim de sessão precisa esvaziar a fila');

  lab.soltar();
  await turnoA;

  assert.equal(lab.iniciou, 1, 'o pedido da fila NÃO pode ter executado depois do fim da sessão');
  assert.equal(concluidas.length, 0, 'e ninguém fala numa sessão que acabou');
});

/**
 * Os três casos abaixo saíram da auditoria de garantia (QA independente,
 * 16/08/2026). Nenhum deles existia antes da fila — todos nasceram com ela.
 */

test('CT-05: tela fechada devolve a vaga dela na fila — e não derruba o turno em voo', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  assert.equal(kernel.pedidosNaFila, 1);

  // A tela B foi fechada (F5, aba fechada, rede caiu) antes de chegar a vez.
  kernel.esquecerEspelho('espelho-B');
  assert.equal(kernel.pedidosNaFila, 0, 'espelho que não existe mais não pode segurar vaga');
  assert.equal(canceladas.length, 1, 'e o pedido retirado precisa ser contado');
  assert.match(canceladas[0], /fechada/i);

  lab.soltar();
  await turnoA;
  assert.equal(concluidas.length, 1, 'o turno em voo de OUTRA tela não pode ter sido tocado');
  assert.equal(concluidas[0].responde_a, 'op:a1');
});

test('CT-05: fechar a tela NÃO cancela o turno que ela mesma já tinha começado', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas, canceladas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  kernel.esquecerEspelho('espelho-A');
  lab.soltar();
  await turnoA;

  assert.equal(canceladas.length, 0, 'o efeito já pode estar a caminho do mundo — não se cancela por fechar aba');
  assert.equal(concluidas.length, 1, 'e a resposta continua indo para as outras telas do operador');
});

test('CT-05: turno SEM TELA (WhatsApp, ciclo autônomo) pode ser parado por qualquer tela', async () => {
  const lab = habilidadeComPortao();
  const { kernel, canceladas } = montar(lab.habilidade);

  // Sem origem: é como o canal WhatsApp e o ciclo autônomo entram.
  const turnoCanal = kernel.processar(PEDIDO, 'w1');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  /* Antes de a origem existir isto funcionava por acidente, porque o
     `interromper` derrubava tudo. Casar só por igualdade tiraria da operadora
     a única forma de parar um turno que ela vê acontecendo e que tela nenhuma
     dela começou. */
  kernel.interromper('espelho-A');
  lab.soltar();
  await turnoCanal;

  assert.equal(canceladas.length, 1, 'a operadora precisa conseguir parar um turno que nenhuma tela dela iniciou');
});

test('CT-05: preempção da própria tela NÃO esvazia a fila das outras', async () => {
  const lab = habilidadeComPortao();
  const { kernel } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);
  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  assert.equal(kernel.pedidosNaFila, 1);

  // A reescreve. Isto cancela o turno DELE — e não pode encostar na fila.
  const turnoA2 = kernel.processar(PEDIDO, 'a2', 'espelho-A');
  assert.equal(
    kernel.pedidosNaFila,
    1,
    'quem reescreve a própria frase não pode apagar o pedido da outra tela — seria o CC-01 de volta por outra porta',
  );

  lab.soltar();
  await Promise.all([turnoA, turnoA2]);
});

test('CC-01: a mesma tela que já espera não ocupa duas vagas — o segundo pedido substitui o primeiro', async () => {
  const lab = habilidadeComPortao();
  const { kernel, concluidas } = montar(lab.habilidade);

  const turnoA = kernel.processar(PEDIDO, 'a1', 'espelho-A');
  await esperarOTurnoEntrar(() => lab.iniciou, 1);

  await kernel.processar(PEDIDO, 'b1', 'espelho-B');
  await kernel.processar(PEDIDO, 'b2', 'espelho-B');
  assert.equal(kernel.pedidosNaFila, 1, 'uma vaga por espelho');

  lab.soltar();
  await turnoA;

  assert.equal(concluidas.length, 2);
  assert.equal(
    concluidas[1].responde_a,
    'op:b2',
    'o que vale é o ÚLTIMO pedido daquela tela, não o primeiro',
  );
});
