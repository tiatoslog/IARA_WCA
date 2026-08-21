/**
 * A PONTE DE EXECUÇÃO — a suíte que cobre o caminho entre a intenção e as mãos.
 *
 * A pergunta desta suíte é uma só, feita de dez maneiras: **a IARA consegue
 * dizer "pronto" quando nada aconteceu?**
 *
 * Os casos felizes estão aqui por completude. O que justifica o arquivo são os
 * outros: o computador desligado, a ordem que some na rede, o relato que chega
 * tarde demais, o pacote repetido, o braço que responde sucesso com uma prova
 * que se contradiz. Cada um desses já foi, em algum sistema, a origem de um
 * "feito!" sobre o nada.
 *
 * DOIS DEFEITOS REAIS moram aqui como testes de regressão, os dois encontrados
 * executando de verdade nesta máquina e não lendo código:
 *
 *  - `execucao_id` que se repetia entre vidas do motor, fazendo o cache do braço
 *    responder o relato de OUTRA ação (a IARA disse "Abri o Bloco de Notas" para
 *    uma pergunta sobre memória);
 *  - a evidência de `abrir_aplicativo` afirmando "ausente antes do pedido" com
 *    quinze processos do Chrome já rodando.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { Braco, type PonteDeOrdens } from '../servidor/nucleo/Braco';
import { AgenteLocal, resolverAplicativo, validarUrlAbertura } from '../servidor/nucleo/AgenteLocal';
import { extrairSiteAbertura } from '../servidor/nucleo/kernel/Planejador';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { novaExecucaoId, type OrdemExecucao, type RelatoExecucao } from '../../web/lib/execucao';
import type { DispositivoConectado } from '../servidor/barramento/PonteDispositivos';

// ---------------------------------------------------------------------------
// Dublês
// ---------------------------------------------------------------------------

/**
 * Um braço de mentira, com o comportamento declarado na construção.
 *
 * `responder` decide o que este braço faz com a ordem: executar e relatar,
 * calar-se (o caso do timeout), ou recusar a escrita (o caso do socket morto).
 */
function dispositivoFalso(opcoes: {
  id?: string;
  usuario?: string;
  escritaFalha?: boolean;
  responder?: (ordem: OrdemExecucao, relatar: (r: Partial<RelatoExecucao>) => void) => void;
}) {
  const recebidas: OrdemExecucao[] = [];
  let publicar: ((d: DispositivoConectado, p: never) => void) | null = null;

  const dispositivo: DispositivoConectado = {
    id_dispositivo: opcoes.id ?? 'disp-teste',
    id_usuario: opcoes.usuario ?? 'daiane',
    nome: 'maquina-de-teste',
    plataforma: 'teste',
    versao: '0',
    conectado_em: 0,
    visto_em: 0,
    atualizando: null,
    ultimoErroAtualizacao: null,
    enviar: (pacote) => {
      if (opcoes.escritaFalha) return false;
      if (pacote.tipo !== 'executar') return true;
      recebidas.push(pacote.ordem);
      const relatar = (r: Partial<RelatoExecucao>) => {
        const relato: RelatoExecucao = {
          execucao_id: pacote.ordem.execucao_id,
          estado: 'sucesso',
          texto: 'feito',
          prova: { confirmado: true, evidencia: 'dublê' },
          codigo_erro: null,
          duracao_ms: 1,
          dispositivo: dispositivo.id_dispositivo,
          onde: 'dispositivo',
          ...r,
        };
        publicar?.(dispositivo, { tipo: 'concluida', relato } as never);
      };
      // Assíncrono de propósito: um braço nunca responde dentro do `send`.
      setTimeout(() => {
        if (opcoes.responder) opcoes.responder(pacote.ordem, relatar);
        else relatar({});
      }, 5);
      return true;
    },
    fechar: () => undefined,
  };

  const ponte: PonteDeOrdens = {
    destinoDe: () => dispositivo,
    aoPacote: (ouvinte) => {
      publicar = ouvinte as never;
      return () => (publicar = null);
    },
  };

  return { dispositivo, ponte, recebidas };
}

/** Uma ponte sem nenhum braço pendurado. */
const ponteVazia: PonteDeOrdens = { destinoDe: () => null, aoPacote: () => () => undefined };

function pedido(acao: OrdemExecucao['acao'], parametros: Record<string, unknown> = {}) {
  return { acao, parametros, id_usuario: 'daiane', sessao: 's-teste' };
}

// ===========================================================================
// 1. Desconectado é um estado real
// ===========================================================================

test('A1. sem braço e sem mãos, a IARA RECUSA — não simula, não executa em lugar nenhum', async () => {
  let executou = false;
  const braco = new Braco(
    ponteVazia,
    async () => {
      executou = true;
      throw new Error('não deveria executar');
    },
    () => false,
  );

  const r = await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'bloco de notas' }));

  assert.equal(r.estado, 'dispositivo_ausente');
  assert.equal(r.codigo_erro, 'DESKTOP_OFFLINE');
  assert.equal(r.onde, 'nenhum');
  assert.equal(r.prova.confirmado, false);
  assert.equal(executou, false, 'nada pode ter sido executado sem mãos');
  // A frase precisa nomear a causa. "Não consegui" sem motivo é o que faz o
  // operador tentar de novo cinco vezes antes de descobrir que o PC está fora.
  assert.match(r.texto, /computador não está conectado/i);
});

test('A2. com mãos locais e sem braço, o motor executa ELE MESMO', async () => {
  const braco = new Braco(
    ponteVazia,
    async (ordem) => ({
      execucao_id: ordem.execucao_id,
      estado: 'sucesso',
      texto: 'feito no motor',
      prova: { confirmado: true, evidencia: 'dublê do executor' },
      codigo_erro: null,
      duracao_ms: 1,
      dispositivo: null,
      onde: 'motor',
    }),
    () => true,
  );

  const r = await braco.executar(pedido('criar_pasta', { nome: 'X', local: 'documentos' }));
  assert.equal(r.estado, 'sucesso');
  assert.equal(r.onde, 'motor');
});

test('A3. havendo braço, ele GANHA do motor com mãos — o computador do operador é o dele', async () => {
  const { ponte, recebidas } = dispositivoFalso({});
  let noMotor = false;
  const braco = new Braco(
    ponte,
    async (ordem) => {
      noMotor = true;
      return {
        execucao_id: ordem.execucao_id,
        estado: 'sucesso' as const,
        texto: '',
        prova: { confirmado: true, evidencia: '' },
        codigo_erro: null,
        duracao_ms: 0,
        dispositivo: null,
        onde: 'motor' as const,
      };
    },
    () => true, // o motor TAMBÉM tem mãos, e mesmo assim não é ele quem executa
  );

  const r = await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' }));
  assert.equal(r.onde, 'dispositivo');
  assert.equal(recebidas.length, 1);
  assert.equal(noMotor, false, 'com braço conectado, o motor não pode executar por conta própria');
});

// ===========================================================================
// 2. Prazo — e a diferença entre "não deu" e "não sei"
// ===========================================================================

test('B1. braço mudo vira EXPIROU, e a frase admite ignorância em vez de negar o fato', async () => {
  const { ponte } = dispositivoFalso({ responder: () => undefined }); // nunca relata
  const braco = new Braco(ponte, undefined, () => false);

  const r = await braco.executar({
    ...pedido('criar_pasta', { nome: 'Y', local: 'documentos' }),
  });

  assert.equal(r.estado, 'expirou');
  assert.equal(r.codigo_erro, 'EXPIROU');
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
  /**
   * O CORAÇÃO DESTE TESTE. Um timeout NÃO é prova de que nada aconteceu — o
   * braço pode ter aberto o programa e morrido antes de contar. Dizer "não
   * consegui" ali é afirmar um fato negativo que ninguém apurou, e é tão
   * desonesto quanto o "pronto!" que esta camada existe para impedir.
   */
  assert.match(r.texto, /não recebi confirmação/i);
  assert.doesNotMatch(r.texto, /não consegui|não foi executado|nada aconteceu/i);
});

test('B2. relato que chega DEPOIS do prazo não ressuscita a execução nem fala de novo', async () => {
  let relatarTarde: (() => void) | null = null;
  const { ponte } = dispositivoFalso({
    responder: (_ordem, relatar) => {
      relatarTarde = () => relatar({ texto: 'cheguei tarde' });
    },
  });
  const braco = new Braco(ponte, undefined, () => false);

  const r = await braco.executar(pedido('criar_pasta', { nome: 'Z', local: 'documentos' }));
  assert.equal(r.estado, 'expirou');

  // O braço acorda depois. Não pode explodir, e não pode virar uma segunda
  // resposta ao operador — que já foi informado.
  assert.doesNotThrow(() => relatarTarde?.());
  assert.equal(braco.relatoDe(r.execucao_id)?.estado, 'expirou');
});

// ===========================================================================
// 3. Idempotência — de transporte, não de efeito
// ===========================================================================

test('C1. pacote repetido na janela devolve o relato original e NÃO executa de novo', async () => {
  const { ponte, recebidas } = dispositivoFalso({});
  const braco = new Braco(ponte, undefined, () => false);

  const primeiro = await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' }));
  const segundo = await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' }));

  assert.equal(recebidas.length, 1, 'o efeito não pode sair duas vezes');
  assert.equal(segundo.estado, 'duplicada');
  assert.equal(segundo.execucao_id, primeiro.execucao_id, 'a repetição herda a identidade original');
});

test('C2. pedido DIFERENTE não é confundido com repetição', async () => {
  const { ponte, recebidas } = dispositivoFalso({});
  const braco = new Braco(ponte, undefined, () => false);

  await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' }));
  await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'bloco de notas' }));

  assert.equal(recebidas.length, 2);
});

test('C3. REGRESSÃO: o execucao_id carrega a marca do processo e não se repete entre vidas', () => {
  /**
   * O DEFEITO, encontrado executando de verdade: o motor reiniciou, o contador
   * voltou a 1, e o cache do braço — que guarda relatos por cinco minutos para
   * responder a reentregas — encontrou o id novo com o relato ANTIGO. A IARA
   * respondeu "Pronto. Abri o Bloco de Notas no computador." para uma pergunta
   * sobre uso de memória. Nada foi executado; o sucesso era de outra ação.
   *
   * O formato é a correção, e é isto que este teste tranca: entre a data e o
   * contador existe uma marca gerada uma vez por processo.
   */
  const id = novaExecucaoId(new Date(2026, 7, 13));
  assert.match(id, /^IARA-20260813-[0-9a-f]{4}-\d{6}$/, `formato inesperado: ${id}`);

  const outro = novaExecucaoId(new Date(2026, 7, 13));
  assert.notEqual(id, outro, 'dois ids do mesmo processo não podem colidir');
  // A marca é do processo: igual entre as duas chamadas, e é justamente ela que
  // difere de um processo para o outro.
  assert.equal(id.split('-')[2], outro.split('-')[2]);
});

// ===========================================================================
// 4. Rede quebrando no pior momento
// ===========================================================================

test('D1. socket que recusa a escrita não vira sucesso nem timeout — vira ausência imediata', async () => {
  const { ponte } = dispositivoFalso({ escritaFalha: true });
  const braco = new Braco(ponte, undefined, () => false);

  const r = await braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' }));

  assert.equal(r.estado, 'dispositivo_ausente');
  assert.equal(r.codigo_erro, 'ERRO_DE_REDE');
  // NADA foi executado, e é a única situação em que a IARA pode afirmar isso
  // com segurança: a ordem não chegou a sair do processo.
  assert.match(r.texto, /Nada foi executado/i);
});

test('D2. relato incoerente do braço é REBAIXADO — sucesso com prova divergente não é sucesso', async () => {
  /**
   * O braço é confiável e mesmo assim é conferido. Um relato dizendo `sucesso`
   * com uma prova que aponta divergência é exatamente o falso positivo que esta
   * camada existe para impedir — e ele chegaria pela porta de quem tem toda a
   * legitimidade para falar. Confiar não é o mesmo que não verificar.
   */
  const { ponte } = dispositivoFalso({
    responder: (_o, relatar) =>
      relatar({
        estado: 'sucesso',
        prova: { confirmado: false, evidencia: 'a pasta não existe', motivo: 'divergente' },
      }),
  });
  const braco = new Braco(ponte, undefined, () => false);

  const r = await braco.executar(pedido('criar_pasta', { nome: 'W', local: 'documentos' }));
  assert.equal(r.estado, 'falhou');
});

// ===========================================================================
// 5. Concorrência
// ===========================================================================

test('E1. ordens do mesmo operador correm EM SÉRIE e na ordem pedida', async () => {
  /**
   * Não é preciosismo com concorrência. A prova de `abrir_aplicativo` é a
   * diferença entre a tabela de processos antes e depois; em paralelo, o
   * "antes" de uma execução enxerga o "depois" da outra e a prova passa a
   * atestar o aplicativo errado. Serializar é o que mantém a verificação
   * verdadeira — e preserva a ordem de graça.
   */
  const ordemDeChegada: string[] = [];
  let simultaneas = 0;
  let pico = 0;

  const { ponte } = dispositivoFalso({
    responder: (ordem, relatar) => {
      simultaneas += 1;
      pico = Math.max(pico, simultaneas);
      ordemDeChegada.push(String(ordem.parametros.aplicativo));
      setTimeout(() => {
        simultaneas -= 1;
        relatar({});
      }, 20);
    },
  });
  const braco = new Braco(ponte, undefined, () => false);

  await Promise.all([
    braco.executar(pedido('abrir_aplicativo', { aplicativo: 'bloco de notas' })),
    braco.executar(pedido('abrir_aplicativo', { aplicativo: 'calculadora' })),
    braco.executar(pedido('abrir_aplicativo', { aplicativo: 'paint' })),
  ]);

  assert.equal(pico, 1, 'duas execuções ao mesmo tempo corrompem a prova de processo');
  assert.deepEqual(ordemDeChegada, ['bloco de notas', 'calculadora', 'paint']);
});

// ===========================================================================
// 6. O executor — onde o falso positivo morava
// ===========================================================================

test('F1. REGRESSÃO: lançamento que falha vira RECUSA, nunca "aberto" — e não derruba o processo', async () => {
  /**
   * O defeito original tinha duas caras na mesma linha. `this.executor(...)`
   * seguido de `return "${rotulo} aberto."` afirmava sucesso antes de existir
   * informação; e o `spawn` por baixo não tinha ouvinte de `error`, então o
   * ENOENT assíncrono virava exceção não capturada e derrubava o motor inteiro
   * — levando junto a sessão de todos os outros operadores.
   *
   * Reproduzido antes de corrigir com `spawn('programa-que-nao-existe.exe')`:
   * o processo terminava com `uncaughtException: spawn ... ENOENT`.
   */
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: false, motivo: 'ENOENT' }),
    async () => [],
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');

  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'APP_NAO_ENCONTRADO');
  assert.equal(r.prova.confirmado, false);
  assert.doesNotMatch(r.texto, /\baberto\b|\bpronto\b/i, 'a frase não pode afirmar abertura');
});

test('F2. processo que não aparece na tabela é DIVERGENTE — o lançador sair limpo não basta', async () => {
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: true, motivo: 'saiu limpo' }),
    async () => [], // lançou, e nada apareceu
  );

  const r = await agente.abrirAplicativo('daiane', 'abra a calculadora');
  assert.equal(r.ok, false);
  assert.equal(r.prova.motivo, 'divergente');
  assert.equal(r.codigo_erro, 'APP_NAO_ENCONTRADO');
});

/**
 * O AGENTE COM AS TRÊS SONDAS QUE IMPORTAM aqui, por nome em vez de posição.
 *
 * `sondaJanelas` é o 12º parâmetro do construtor — ela entrou no fim
 * justamente para não mexer nos testes que já existiam. Escrever oito
 * `undefined` em cada caso esconderia o que cada teste está de fato variando.
 */
function agenteDeJanela(o: {
  lancador?: (comando: string, argumentos: string[]) => Promise<{ subiu: boolean; motivo: string }>;
  processos?: () => Promise<number[] | null>;
  janelas?: (imagem: string, ignorar?: readonly number[], esperarMs?: number) => Promise<number[] | null>;
  foco?: (imagem: string) => Promise<'em_foco' | 'atras' | null>;
}): AgenteLocal {
  return new AgenteLocal(
    () => undefined,
    async () => 0,
    o.lancador ?? (async () => ({ subiu: true, motivo: '' })),
    o.processos ?? (async () => [4321]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    o.janelas,
    o.foco ?? (async () => 'em_foco'),
  );
}

test('F3. JANELA nova é a prova — processo novo, sozinho, deixou de bastar', async () => {
  /**
   * Este teste afirmava o contrário até 21/08/2026: "processo novo na tabela e
   * PROVA". A operadora provou que não é. Ela pediu o Bloco de Notas, o
   * processo nasceu (pid 25908, filho do runtime, na sessão interativa), a IARA
   * disse "Pronto. Abri o Bloco de Notas" e a tela ficou vazia.
   *
   * Processo criado é uma condição INTERMEDIÁRIA; janela na tela é o efeito que
   * a frase promete. O oráculo passou a medir o segundo.
   */
  let vez = 0;
  const agente = agenteDeJanela({
    processos: async () => [4321],
    janelas: async () => (vez++ === 0 ? [] : [0xa1]),
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.ok, true);
  assert.equal(r.prova.confirmado, true);
  assert.match(r.prova.evidencia, /janela/i, 'a evidência precisa falar de janela, não de processo');
});

test('F4. PROCESSO SUBIU E NENHUMA JANELA APARECEU: falha declarada, jamais "Pronto"', async () => {
  /**
   * O TESTE QUE FALTAVA, e o único motivo de ele existir é o campo:
   *
   *   11:36:58  a operadora pede o Bloco de Notas
   *   11:36:58  notepad 25908 nasce, pai 6168, sessão 1
   *   11:36:58  IARA: "Pronto. Abri o Bloco de Notas no computador."
   *   11:44:59  EnumWindows na sessão 1: nenhuma janela desse PID
   *
   * Ela pediu de novo e ouviu a mesma frase. Duas afirmações de feito, zero
   * janelas. Nenhum dos 2196 testes verdes cobria este caso, porque todos
   * mediam a mesma coisa que o código media.
   *
   * Repare que isto NÃO é `sem_meio_de_verificar`: a sonda funcionou, olhou e
   * não achou. Ausência de evidência seria a ressalva; isto é evidência de
   * ausência, e vira falha.
   */
  const agente = agenteDeJanela({
    processos: async () => [25908],
    janelas: async () => [], // olhei; não há janela
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');

  assert.equal(r.ok, false, 'processo sem janela não pode ser sucesso');
  assert.equal(r.prova.confirmado, false);
  assert.equal(r.prova.motivo, 'divergente');
  assert.equal(r.codigo_erro, 'APP_SEM_JANELA');
  assert.doesNotMatch(r.texto, /\bpronto\b|\babri\b/i, 'a frase afirmou abertura sem janela');
  assert.match(r.texto, /nenhuma janela/i, 'a frase precisa dizer o que faltou');
});

test('F4b. janela nova que ficou ATRÁS: a frase diz isso, e não "Pronto"', async () => {
  /**
   * O terceiro relato de campo do mesmo pedido, 21/08/2026 12:26 — e o mais
   * sutil dos três, porque desta vez a IARA estava dizendo a verdade.
   *
   *     Notepad pid 6168 — janela visível, normal, ATRÁS
   *     em foco: chrome (a própria IARA, em tela cheia)
   *
   * O oráculo de janela já estava correto e afirmou "Pronto. Abri". A janela
   * existia mesmo. A operadora continuou sem ver nada além do piscar na barra
   * de tarefas, e escreveu: "o bloco de notas nasce apenas na barra de tarefa".
   *
   * Abrir sem trazer para a frente não é abrir, do ponto de vista de quem
   * pediu. Então há um segundo efeito a verificar — o foco — e ele tem a mesma
   * regra do primeiro: conferido, nunca presumido. `SetForegroundWindow` falha
   * em silêncio para quem não detém o primeiro plano.
   */
  let vez = 0;
  const agente = agenteDeJanela({
    processos: async () => [6168],
    janelas: async () => (vez++ === 0 ? [] : [0xe5]),
    foco: async () => 'atras', // o Windows recusou o foco
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');

  assert.equal(r.ok, true, 'a janela nasceu — isto não é falha');
  assert.equal(r.prova.confirmado, true, 'o efeito principal foi observado');
  assert.doesNotMatch(r.texto, /^Pronto\./, 'a frase não pode soar como se ele tivesse aparecido na frente');
  assert.match(r.texto, /barra de tarefas/i, 'a pessoa precisa saber onde procurar');
  assert.match(r.prova.evidencia, /foco/i, 'a evidência precisa registrar o desfecho do foco');
});

test('F4c. janela nova E foco obtido: aí sim "Pronto"', async () => {
  let vez = 0;
  const agente = agenteDeJanela({
    processos: async () => [6168],
    janelas: async () => (vez++ === 0 ? [] : [0xe6]),
    foco: async () => 'em_foco',
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.prova.confirmado, true);
  assert.match(r.texto, /^Pronto\. Abri/);
  assert.doesNotMatch(r.texto, /barra de tarefas/i);
});

test('F5. já havia janela e nenhuma nova: ressalva honesta, nem sucesso nem falha', async () => {
  /**
   * O caso legítimo do programa que traz a janela existente para a frente.
   * Chamar de sucesso seria afirmar uma janela que ninguém viu nascer; chamar
   * de falha seria negar um lançamento que deu certo sobre um programa que
   * está na tela.
   */
  const agente = agenteDeJanela({
    processos: async () => [77],
    janelas: async () => [0xb2], // a MESMA janela antes e depois
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome');
  assert.equal(r.ok, true);
  assert.equal(r.prova.confirmado, false);
  /**
   * `ja_estava_aberto` e NAO `sem_meio_de_verificar`. Os dois chegam por
   * caminhos opostos: o segundo e ignorancia — agi e nao tenho como olhar; o
   * primeiro e conhecimento — olhei, contei as janelas antes e depois, e o
   * efeito ja estava no mundo. Dizer "nao consigo provar" sobre algo
   * perfeitamente observavel ensina o operador a ignorar as ressalvas que sao
   * verdadeiras.
   */
  assert.equal(r.prova.motivo, 'ja_estava_aberto');
  assert.match(r.texto, /já estava aberto/i);
});

test('F6. sem sonda de janelas, a resposta declara a limitação em vez de afirmar', async () => {
  const agente = agenteDeJanela({
    processos: async () => [4321],
    janelas: async () => null, // outra plataforma, ou a enumeração falhou
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.ok, true);
  assert.equal(r.prova.confirmado, false);
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
  assert.match(r.texto, /não tenho como te garantir/i);
});

test('F6b. a janela pode ser de OUTRO processo — app empacotado não invalida a prova', async () => {
  /**
   * Medido no Windows real: `notepad.exe` (stub, pid 10616) ativa o
   * `Notepad.exe` do WindowsApps (pid 26328), e a janela pertence ao SEGUNDO.
   * Um oráculo que casasse pelo PID lançado diria "sem janela" com a janela na
   * tela — trocando um falso positivo por um falso negativo.
   *
   * Por isso a sonda casa por NOME DE IMAGEM. Aqui o processo lançado nem
   * aparece na lista, e a prova continua valendo.
   */
  let vez = 0;
  const agente = agenteDeJanela({
    processos: async () => [26328], // o pid do app empacotado, não o do stub
    janelas: async () => (vez++ === 0 ? [] : [0xc3]),
  });

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.prova.confirmado, true);
});

test('F6c. o processo nem apareceu: continua sendo APP_NAO_ENCONTRADO, não APP_SEM_JANELA', async () => {
  /**
   * As duas causas são diferentes e as duas frases também. "Não está
   * instalado" sobre um programa instalado é um diagnóstico que manda a pessoa
   * procurar no lugar errado.
   */
  const agente = agenteDeJanela({
    processos: async () => [],
    janelas: async () => [],
  });

  const r = await agente.abrirAplicativo('daiane', 'abra a calculadora');
  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'APP_NAO_ENCONTRADO');
});

test('F7. fechar NUNCA força: aplicativo que resiste é relatado como resistente', async () => {
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0, // taskkill "deu certo"…
    async () => ({ subiu: true, motivo: '' }),
    async () => [55], // …e o processo continua lá
  );

  const r = await agente.fecharAplicativo('daiane', 'feche o bloco de notas');
  assert.equal(r.ok, false);
  assert.equal(r.prova.motivo, 'divergente');

  /**
   * A ASSERÇÃO MUDOU DE ALVO em 13/08/2026, e a mudança é o ponto.
   *
   * Ela exigia a frase "continua aberto" e a explicação "não salvo" como CAUSA.
   * Duas coisas erradas, descobertas medindo a máquina em vez de ler o código:
   *
   *  1. o que o agente observa é a TABELA DE PROCESSOS, não a janela. Um app da
   *     Store fecha a janela e deixa o processo suspenso — "continua aberto"
   *     seria falso justamente no caso mais comum.
   *  2. "há algo não salvo" era AFIRMADO. Com a Calculadora — que não tem o que
   *     salvar — a IARA dizia isso mesmo assim. Causa plausível, não medida, e
   *     impossível de o operador conferir.
   *
   * O que se cobra agora é o que o sistema de fato sabe: o processo continua na
   * máquina (fato), e a explicação vem marcada como hipótese. Ver
   * `fechar-aplicativo-honesto.test.ts`.
   */
  assert.match(r.texto, /processo continua/i, 'a frase precisa dizer o fato observado');
  assert.match(r.texto, /pode ser/i, 'a causa provável precisa estar marcada como hipótese');
  assert.match(r.texto, /não salvo/i, 'a hipótese razoável continua sendo oferecida');
  assert.doesNotMatch(
    r.texto,
    /normalmente acontece quando há algo não salvo/i,
    'voltou a afirmar como causa o que é hipótese',
  );
});

test('F8. o Explorador de Arquivos não é fechável — derrubá-lo apaga a área de trabalho', async () => {
  const agente = new AgenteLocal();
  const r = await agente.fecharAplicativo('daiane', 'feche o explorador');
  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'PERMISSAO_NEGADA');
});

// ===========================================================================
// 7. A allowlist e o reconhecedor precisam CONCORDAR
// ===========================================================================

test('G1. todo aplicativo da allowlist é reconhecível pela âncora de abertura', () => {
  /**
   * O DEFEITO que este teste tranca: `chrome` estava na allowlist do
   * `AgenteLocal` e AUSENTE da lista de substantivos da `Percepcao`. "Abra o
   * Chrome no computador" — a frase que abre o caderno de testes — não casava
   * âncora nenhuma, caía no plano de raciocínio com confiança 0,35 e dependia
   * da LLM adivinhar a habilidade. Sem chave da nuvem, não abria nada.
   *
   * São duas listas que precisam concordar, e nada as obrigava a isso. Agora
   * uma entrada nova na allowlist quebra a suíte até ser reconhecível.
   */
  const p = new MotorPercepcao();
  const chaves = ['bloco de notas', 'calculadora', 'paint', 'explorador', 'chrome', 'edge', 'navegador'];

  for (const chave of chaves) {
    assert.ok(resolverAplicativo(`abra o ${chave}`), `${chave} deveria estar na allowlist`);
    assert.ok(
      p.perceber(`abra o ${chave} no computador`).ancoras.includes('abrir_app'),
      `a percepção não reconhece "abra o ${chave}" como pedido de abertura`,
    );
  }
});

test('G2. as âncoras novas não roubam frases umas das outras', () => {
  const p = new MotorPercepcao();

  const abrir = p.perceber('abra o chrome no computador').ancoras;
  assert.ok(abrir.includes('abrir_app'));
  assert.ok(!abrir.includes('fechar_app'));

  const fechar = p.perceber('feche o chrome').ancoras;
  assert.ok(fechar.includes('fechar_app'));
  assert.ok(!fechar.includes('abrir_app'));

  assert.ok(p.perceber('liste os arquivos da area de trabalho').ancoras.includes('listar_arquivos'));
  assert.ok(p.perceber('quanto de memoria meu computador esta usando').ancoras.includes('sistema'));
  assert.ok(p.perceber('faca um diagnostico').ancoras.includes('diagnostico'));

  /**
   * As armadilhas da família de `frota` e `tempo`: palavra reconhecida não é
   * pedido. Nenhuma destas pode acionar nada.
   */
  assert.ok(!p.perceber('nao tenho memoria de ter pedido isso').ancoras.includes('sistema'));
  assert.ok(!p.perceber('me manda os arquivos que o cliente enviou').ancoras.includes('listar_arquivos'));
  assert.ok(
    !p.perceber('nao abra o chrome').ancoras.includes('abrir_app'),
    '"não abra" é o oposto de um pedido de abertura',
  );
});

// ===========================================================================
// 8. Abrir aplicativo COM SITE — a IARA passa a navegar, não só abrir vazio
// ===========================================================================

test('H1. validarUrlAbertura aceita http/https limpo e recusa o resto', () => {
  assert.equal(validarUrlAbertura('https://youtube.com'), null);
  assert.equal(validarUrlAbertura('http://intranet.atoslog.com.br/painel'), null);

  assert.ok(validarUrlAbertura(''), 'vazio precisa ser recusado');
  assert.ok(validarUrlAbertura('youtube.com'), 'sem esquema precisa ser recusado');
  assert.ok(validarUrlAbertura('javascript:alert(1)'), 'esquema perigoso precisa ser recusado');
  assert.ok(validarUrlAbertura('file:///C:/segredos.txt'), 'file: precisa ser recusado');
  assert.ok(validarUrlAbertura('chrome://settings'), 'esquema interno do navegador precisa ser recusado');
  assert.ok(
    validarUrlAbertura('http://x.com --headless'),
    'espaço (candidato a injeção de flag) precisa ser recusado',
  );
  assert.ok(validarUrlAbertura('http://x.com"'), 'aspas precisam ser recusadas');
});

test('H2. Bloco de Notas recusa URL sem lançar processo nenhum', async () => {
  let lancadorChamado = false;
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => {
      lancadorChamado = true;
      return { subiu: true, motivo: '' };
    },
    async () => [1],
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas', 'https://youtube.com');
  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'PARAMETRO_INVALIDO');
  assert.equal(lancadorChamado, false, 'app que não aceita URL não pode nem chegar a lançar processo');
});

test('H3. URL inválida é recusada ANTES do spawn — nenhum processo é lançado', async () => {
  let lancadorChamado = false;
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => {
      lancadorChamado = true;
      return { subiu: true, motivo: '' };
    },
    async () => [1],
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome', 'javascript:alert(1)');
  assert.equal(r.ok, false);
  assert.equal(r.codigo_erro, 'PARAMETRO_INVALIDO');
  assert.equal(lancadorChamado, false, 'URL recusada não pode chegar ao spawn');
});

test('H4. URL válida chega ao spawn como argumento próprio, e a resposta cita o endereço', async () => {
  /**
   * A sonda de JANELAS entra injetada aqui de proposito. Sem ela, este teste
   * passaria a rodar o PowerShell de verdade e a medir o Chrome da maquina de
   * quem roda a suite — e um teste que depende de o Chrome estar aberto na sua
   * mesa nao esta testando o produto, esta testando a sua mesa.
   */
  let argumentosRecebidos: string[] = [];
  let vez = 0;
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async (_comando, argumentos) => {
      argumentosRecebidos = argumentos;
      return { subiu: true, motivo: '' };
    },
    async () => (vez++ === 0 ? [] : [4321]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => (vez > 1 ? [0xd4] : []),
    async () => 'em_foco',
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome', 'https://youtube.com');
  assert.equal(r.ok, true);
  assert.deepEqual(
    argumentosRecebidos,
    ['/c', 'start', '', 'chrome', 'https://youtube.com'],
    'a URL precisa chegar como um argumento próprio do array, nunca concatenada a outro',
  );
  assert.match(r.texto, /youtube\.com/);
});

test('H5. sem URL, o comportamento de sempre continua idêntico (argv sem site nenhum)', async () => {
  /**
   * A sonda de JANELAS entra injetada aqui de proposito. Sem ela, este teste
   * passaria a rodar o PowerShell de verdade e a medir o Chrome da maquina de
   * quem roda a suite — e um teste que depende de o Chrome estar aberto na sua
   * mesa nao esta testando o produto, esta testando a sua mesa.
   */
  let argumentosRecebidos: string[] = [];
  let vez = 0;
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async (_comando, argumentos) => {
      argumentosRecebidos = argumentos;
      return { subiu: true, motivo: '' };
    },
    async () => (vez++ === 0 ? [] : [4321]),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => (vez > 1 ? [0xd4] : []),
    async () => 'em_foco',
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome');
  assert.equal(r.ok, true);
  assert.deepEqual(argumentosRecebidos, ['/c', 'start', '', 'chrome']);
  assert.doesNotMatch(r.texto, /https?:\/\//);
});

test('H6. extrairSiteAbertura só reconhece endereço explícito ou domínio com TLD — nunca adivinha', () => {
  assert.equal(extrairSiteAbertura('abra o chrome no youtube.com'), 'https://youtube.com');
  assert.equal(
    extrairSiteAbertura('abre o navegador em https://iara.up.railway.app/painel'),
    'https://iara.up.railway.app/painel',
  );
  assert.equal(extrairSiteAbertura('abra o chrome'), undefined);
  assert.equal(
    extrairSiteAbertura('abra o chrome'),
    undefined,
    'sem ponto+TLD não há o que extrair — nunca inventa domínio a partir de palavra solta',
  );
});
