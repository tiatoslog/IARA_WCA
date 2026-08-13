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
import { AgenteLocal, resolverAplicativo } from '../servidor/nucleo/AgenteLocal';
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

test('F3. processo novo na tabela é PROVA — e a evidência não exagera o que apurou', async () => {
  // Nada antes, um processo depois: a diferença entre as duas fotos É a prova.
  let vez = 0;
  const semNada = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: true, motivo: '' }),
    async () => (vez++ === 0 ? [] : [4321]),
  );
  const r = await semNada.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.ok, true);
  assert.equal(r.prova.confirmado, true);
  assert.match(r.prova.evidencia, /4321/);
  assert.match(r.prova.evidencia, /ausente antes/);
});

test('F4. REGRESSÃO: com processos já rodando, a evidência diz os DOIS números', async () => {
  /**
   * Pego na primeira bateria real. Abrir o Chrome com quinze processos dele já
   * ativos criou um processo novo — prova legítima — acompanhada da frase
   * "ausente antes do pedido", que era falsa sobre o estado anterior da
   * máquina. Uma prova que exagera o que apurou está estragada mesmo quando a
   * conclusão está certa: a próxima pessoa confia na frase, não refaz a medição.
   */
  let vez = 0;
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: true, motivo: '' }),
    async () => (vez++ === 0 ? [1, 2, 3] : [1, 2, 3, 9]),
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome');
  assert.equal(r.prova.confirmado, true);
  assert.doesNotMatch(r.prova.evidencia, /ausente antes/, 'não estava ausente: havia 3 processos');
  assert.match(r.prova.evidencia, /3 para 4/);
});

test('F5. aplicativo já aberto NÃO é sucesso provado nem falha — é a ressalva honesta', async () => {
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: true, motivo: '' }),
    async () => [77], // a mesma contagem antes e depois
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o chrome');
  assert.equal(r.ok, true, 'o lançamento deu certo');
  assert.equal(r.prova.confirmado, false);
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
  assert.match(r.texto, /já estava aberto/i);
});

test('F6. sem sonda de processos, a resposta declara a limitação em vez de afirmar', async () => {
  const agente = new AgenteLocal(
    () => undefined,
    async () => 0,
    async () => ({ subiu: true, motivo: '' }),
    async () => null, // plataforma sem `tasklist`
  );

  const r = await agente.abrirAplicativo('daiane', 'abra o bloco de notas');
  assert.equal(r.ok, true);
  assert.equal(r.prova.motivo, 'sem_meio_de_verificar');
  assert.match(r.texto, /não tenho como te garantir/i);
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
  assert.match(r.texto, /continua aberto/i);
  assert.match(r.texto, /não salvo/i, 'a frase precisa explicar a causa provável');
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
