/**
 * PAREAMENTO — a cadeia que deixa uma operadora ligar o próprio computador à
 * IARA sem depender de um programador.
 *
 * A pergunta desta suíte, feita de várias maneiras: **um código curto pode virar
 * poder de execução na máquina de outra pessoa?**
 *
 * Os casos felizes estão aqui por completude. O que justifica o arquivo são os
 * outros — e cada um deles é uma forma conhecida de um fluxo de pareamento
 * vazar:
 *
 *  · o código adivinhado (por isso a chave é um segundo segredo, e por isso a
 *    cota de erro existe);
 *  · o código reaproveitado (uso único, um pedido morre ao ser resgatado);
 *  · o pedido eterno (validade curta, varrido a cada entrada pública);
 *  · a credencial de outro operador revogada por engano ou de propósito (o
 *    `id_usuario` entra na CONDIÇÃO da escrita, não numa checagem anterior a
 *    ela);
 *  · a credencial revogada que continua conectando (a ponte pergunta ao
 *    repositório a cada apresentação, nunca a uma memória local).
 *
 * O repositório é FALSO e isso é o ponto: sem ele, o único jeito de exercitar
 * este ciclo seria contra um projeto Supabase real — e o que não se testa em
 * suíte é o que volta quebrado depois. O que está sob teste é o
 * `RegistroPareamento`; o repositório é o banco, e o banco precisa ser
 * controlável para que "linha revogada" e "escrita que falha" possam existir.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';

import {
  formatarCodigo,
  normalizarCodigo,
  PREFIXO_TOKEN,
  RegistroPareamento,
  type DispositivoPareado,
  type RepositorioDispositivos,
} from '../servidor/nucleo/Pareamento';
import { inventarioDeMaquinas, PonteDispositivos } from '../servidor/barramento/PonteDispositivos';
import { lerPacoteCliente } from '../lib/protocolo';

// ===========================================================================
// O BANCO CONTROLÁVEL
// ===========================================================================

interface Linha {
  id_credencial: string;
  id_usuario: string;
  nome: string;
  plataforma: string;
  hash_token: string;
  pareado_em: number;
  ultimo_uso_em: number | null;
  revogado_em: number | null;
}

class BancoDeMentira implements RepositorioDispositivos {
  readonly linhas: Linha[] = [];
  ligado = true;
  /** Quantas vezes `porHash` foi consultado — prova que a ponte não confia em
   *  memória local para decidir se uma credencial ainda vale. */
  consultas = 0;

  disponivel(): boolean {
    return this.ligado;
  }

  async gravar(d: {
    id_credencial: string;
    id_usuario: string;
    nome: string;
    plataforma: string;
    hash_token: string;
  }): Promise<void> {
    this.linhas.push({ ...d, pareado_em: Date.now(), ultimo_uso_em: null, revogado_em: null });
  }

  async porHash(hash: string): Promise<DispositivoPareado | null> {
    this.consultas += 1;
    const l = this.linhas.find((x) => x.hash_token === hash && x.revogado_em === null);
    return l ? this.descrever(l) : null;
  }

  async marcarUso(id: string): Promise<void> {
    const l = this.linhas.find((x) => x.id_credencial === id);
    if (l) l.ultimo_uso_em = Date.now();
  }

  async listar(idUsuario: string): Promise<DispositivoPareado[]> {
    return this.linhas
      .filter((l) => l.id_usuario === idUsuario && l.revogado_em === null)
      .map((l) => this.descrever(l));
  }

  async revogar(idUsuario: string, idCredencial: string): Promise<boolean> {
    const l = this.linhas.find(
      (x) => x.id_credencial === idCredencial && x.id_usuario === idUsuario && x.revogado_em === null,
    );
    if (!l) return false;
    l.revogado_em = Date.now();
    return true;
  }

  private descrever(l: Linha): DispositivoPareado {
    return {
      id_credencial: l.id_credencial,
      id_usuario: l.id_usuario,
      nome: l.nome,
      plataforma: l.plataforma,
      pareado_em: l.pareado_em,
      ultimo_uso_em: l.ultimo_uso_em,
    };
  }
}

const ANA = { id_usuario: 'u-ana', nome: 'Ana', email: 'ana@atoslog.com' };
const BRUNO = { id_usuario: 'u-bruno', nome: 'Bruno', email: 'bruno@atoslog.com' };
const MAQUINA = { nome: 'DESKTOP-ANA', plataforma: 'win32 10.0.26200', versao: '1.1.0' };

function registro(): { p: RegistroPareamento; banco: BancoDeMentira } {
  const banco = new BancoDeMentira();
  return { p: new RegistroPareamento(banco), banco };
}

// ===========================================================================
// 1. O CICLO QUE PRECISA FUNCIONAR
// ===========================================================================

test('P1. pedir → aprovar → resgatar entrega a credencial ao computador certo', async () => {
  const { p, banco } = registro();

  const pedido = p.abrir(MAQUINA);
  assert.ok(pedido, 'o pedido precisa abrir');

  // Antes da aprovação não há nada a levar — e "aguardando" não é erro.
  assert.deepEqual(p.resgatar(pedido!.chave), { estado: 'aguardando' });

  const r = await p.aprovar(formatarCodigo(pedido!.codigo), ANA);
  assert.equal(r.ok, true, r.ok ? '' : r.motivo);
  assert.equal(r.ok && r.nome, 'DESKTOP-ANA', 'a tela precisa dizer QUAL máquina foi autorizada');

  const entrega = p.resgatar(pedido!.chave);
  assert.equal(entrega.estado, 'aprovado');
  assert.ok(entrega.credencial?.token.startsWith(PREFIXO_TOKEN), 'o token precisa se identificar');
  assert.equal(entrega.credencial?.id_usuario, ANA.id_usuario);

  // E o que ficou no banco é o HASH, nunca o token.
  assert.equal(banco.linhas.length, 1);
  assert.notEqual(banco.linhas[0].hash_token, entrega.credencial!.token);
  assert.ok(
    !JSON.stringify(banco.linhas).includes(entrega.credencial!.token),
    'o token puro apareceu na tabela — quem tiver o banco se passa por este computador',
  );
});

test('P2. a credencial emitida identifica o dispositivo, e a revogada não identifica mais', async () => {
  const { p } = registro();
  const pedido = p.abrir(MAQUINA)!;
  await p.aprovar(pedido.codigo, ANA);
  const token = p.resgatar(pedido.chave).credencial!.token;

  const antes = await p.verificar(token);
  assert.equal(antes?.id_usuario, ANA.id_usuario);

  assert.equal(await p.revogar(ANA.id_usuario, antes!.id_credencial), true);
  assert.equal(
    await p.verificar(token),
    null,
    'uma credencial revogada continuou valendo — o botão "desconectar" seria decoração',
  );
});

test('P3. a lista do operador só traz as máquinas DELE', async () => {
  const { p } = registro();
  for (const [quem, nome] of [
    [ANA, 'ANA-1'],
    [ANA, 'ANA-2'],
    [BRUNO, 'BRUNO-1'],
  ] as const) {
    const pedido = p.abrir({ ...MAQUINA, nome })!;
    await p.aprovar(pedido.codigo, quem);
    p.resgatar(pedido.chave);
  }

  assert.deepEqual(
    (await p.listar(ANA.id_usuario)).map((d) => d.nome).sort(),
    ['ANA-1', 'ANA-2'],
  );
  assert.deepEqual((await p.listar(BRUNO.id_usuario)).map((d) => d.nome), ['BRUNO-1']);
});

// ===========================================================================
// 2. ADVERSARIAL — as formas conhecidas de um pareamento vazar
// ===========================================================================

test('P4. saber o CÓDIGO não basta: a credencial sai pela chave', async () => {
  /**
   * A separação dos dois segredos é o que torna oito caracteres suficientes.
   * Quem lê o código por cima do ombro consegue, no máximo, aprovar um
   * pareamento em nome de si mesmo — e para isso já precisa estar logado.
   * A credencial só sai para quem prova conhecer a chave, que nunca aparece
   * em tela nenhuma.
   */
  const { p } = registro();
  const pedido = p.abrir(MAQUINA)!;
  await p.aprovar(pedido.codigo, ANA);

  assert.deepEqual(
    p.resgatar(pedido.codigo),
    { estado: 'desconhecido' },
    'o código curto funcionou como chave de resgate',
  );
  assert.deepEqual(p.resgatar('chave-inventada-qualquer'), { estado: 'desconhecido' });
  // E o pedido de verdade continua intacto para o dono da chave.
  assert.equal(p.resgatar(pedido.chave).estado, 'aprovado');
});

test('P5. USO ÚNICO: um pedido resgatado deixa de existir', async () => {
  const { p, banco } = registro();
  const pedido = p.abrir(MAQUINA)!;
  await p.aprovar(pedido.codigo, ANA);

  assert.equal(p.resgatar(pedido.chave).estado, 'aprovado');
  assert.deepEqual(
    p.resgatar(pedido.chave),
    { estado: 'desconhecido' },
    'a mesma chave entregou a credencial duas vezes',
  );
  assert.equal(p.abertos, 0, 'o pedido resgatado ficou vivo no mapa');
  assert.equal(banco.linhas.length, 1, 'o segundo resgate emitiu uma segunda credencial');
});

test('P6. aprovar DUAS vezes o mesmo código não cria duas credenciais', async () => {
  /**
   * Duplo clique é o caso comum, não a exceção. Sem esta guarda, o segundo
   * "autorizar" gravaria uma credencial órfã — viva no banco para sempre,
   * atribuída a uma máquina que nunca a recebeu, e visível na lista da
   * operadora como um computador fantasma que ela não consegue explicar.
   */
  const { p, banco } = registro();
  const pedido = p.abrir(MAQUINA)!;

  assert.equal((await p.aprovar(pedido.codigo, ANA)).ok, true);
  assert.equal((await p.aprovar(pedido.codigo, ANA)).ok, true);
  assert.equal(banco.linhas.length, 1, 'o duplo clique deixou uma credencial órfã no banco');
});

test('P7. o pedido EXPIRA, e expirado não aprova', async () => {
  const { p } = registro();
  const t0 = 1_000_000;
  const pedido = p.abrir(MAQUINA, t0)!;

  const seisMinutos = t0 + 6 * 60_000;
  const r = await p.aprovar(pedido.codigo, ANA, seisMinutos);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.motivo, /não confere ou já expirou/);
  assert.equal(p.abertos, 0, 'o pedido vencido continuou ocupando lugar');
});

test('P8. tentativa errada é RACIONADA, e o acerto nunca paga por ela', async () => {
  /**
   * A cota é o que decide o tamanho do código: são 30^8 combinações, e dez
   * tentativas por minuto por operador tornam a busca inviável muito antes de
   * os cinco minutos de validade acabarem.
   *
   * Cobrar do ACERTO seria pior que não ter cota: uma operadora ligando três
   * computadores seguidos seria barrada por usar o produto exatamente como
   * ele foi desenhado. Este teste prova as duas metades.
   */
  const { p } = registro();
  const agora = 5_000_000;
  const bom = p.abrir(MAQUINA, agora)!;

  let ultimo = '';
  for (let i = 0; i < 12; i += 1) {
    const r = await p.aprovar('ZZZZZZZZ', ANA, agora);
    ultimo = r.ok ? '' : r.motivo;
  }
  assert.match(ultimo, /Tentativas demais/, 'a força bruta não foi racionada');

  // Outro operador não paga pela cota deste.
  const deBruno = p.abrir(MAQUINA, agora)!;
  const r = await p.aprovar('ZZZZZZZZ', BRUNO, agora);
  assert.match(r.ok ? '' : r.motivo, /não confere/, 'a cota de um operador respingou no outro');

  // E o código CERTO ainda passa, mesmo depois de doze erros.
  assert.equal((await p.aprovar(bom.codigo, ANA, agora)).ok, true, 'o acerto pagou pelos erros');
  assert.equal((await p.aprovar(deBruno.codigo, BRUNO, agora)).ok, true);
});

test('P9. ninguém revoga a credencial de outro operador', async () => {
  const { p } = registro();
  const pedido = p.abrir(MAQUINA)!;
  await p.aprovar(pedido.codigo, ANA);
  const token = p.resgatar(pedido.chave).credencial!.token;
  const dela = (await p.verificar(token))!;

  assert.equal(
    await p.revogar(BRUNO.id_usuario, dela.id_credencial),
    false,
    'Bruno desconectou o computador de Ana',
  );
  assert.ok(await p.verificar(token), 'a credencial de Ana caiu por ordem de Bruno');
});

test('P10. sem banco não há pareamento — e a recusa é explicada', async () => {
  /**
   * Falha-fechada, no mesmo espírito das duas do `principal.ts`: uma instalação
   * sem persistência não pode emitir uma credencial que ela não tem onde
   * guardar. O que a tornaria perigosa não é o erro — é o pareamento que
   * "funciona" e some no próximo restart, deixando a operadora com um
   * computador que conectou ontem e não conecta hoje.
   */
  const { p, banco } = registro();
  banco.ligado = false;
  const pedido = p.abrir(MAQUINA)!;

  const r = await p.aprovar(pedido.codigo, ANA);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.motivo, /sem banco/);
  assert.equal(banco.linhas.length, 0);
});

test('P11. token sem o prefixo nunca vai ao banco', async () => {
  /* Não é otimização: um access token do Supabase caindo aqui viraria uma
     consulta inútil por reconexão de braço, ou seja, por oscilação de Wi-Fi. */
  const { p, banco } = registro();
  assert.equal(await p.verificar('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb'), null);
  assert.equal(await p.verificar(undefined), null);
  assert.equal(await p.verificar(''), null);
  assert.equal(banco.consultas, 0, 'o token de outra autoridade foi consultado na tabela errada');
});

// ===========================================================================
// 3. O CÓDIGO QUE A PESSOA DIGITA
// ===========================================================================

test('P12. o código tolera hífen, espaço e caixa — e nada além disso', async () => {
  const { p } = registro();
  const pedido = p.abrir(MAQUINA)!;
  const bonito = formatarCodigo(pedido.codigo);

  assert.equal(normalizarCodigo(` ${bonito.toLowerCase()} `), pedido.codigo);
  assert.equal(normalizarCodigo(bonito.replace('-', ' ')), pedido.codigo);
  assert.equal((await p.aprovar(` ${bonito.toLowerCase()} `, ANA)).ok, true);
});

test('P13. caractere fora do alfabeto NÃO é descartado em silêncio', () => {
  /**
   * A tentação era traduzir `O` em `0` e `I` em `1`. Ela foi recusada: o
   * gerador nunca produz esses caracteres, então um `O` digitado é erro de
   * LEITURA, e removê-lo encurtaria a string — podendo transformar um código
   * errado noutro de comprimento válido, que é como uma tentativa perdida vira
   * uma tentativa em código alheio.
   */
  assert.equal(normalizarCodigo('H7K2-9QPO'), 'H7K29QPO');
  assert.equal(normalizarCodigo('H7K2-9QPO').length, 8);
});

test('P14. o alfabeto não produz caracteres ambíguos', () => {
  /* Lidos numa tela e digitados noutra, `0/O` e `1/I/L` são a forma mais comum
     de queimar a cota de tentativas sem ninguém ter feito nada errado. */
  const { p } = registro();
  /* Três segundos entre pedidos: a janela de vazão é de 30 por minuto, e um
     laço apertado seria barrado por ela na 31ª volta — provando o limite em vez
     do alfabeto. */
  for (let i = 0; i < 200; i += 1) {
    const pedido = p.abrir(MAQUINA, 1_000_000 + i * 3_000);
    assert.ok(pedido, `a vazão barrou o pedido ${i}`);
    assert.doesNotMatch(pedido!.codigo, /[0O1IL U]/, `código ambíguo: ${pedido!.codigo}`);
    assert.equal(pedido!.codigo.length, 8);
  }
});

// ===========================================================================
// 4. O CONTRATO DO BARRAMENTO
// ===========================================================================

test('P15. os pacotes novos do cliente passam pelo parser — e o lixo não', () => {
  assert.deepEqual(lerPacoteCliente(JSON.stringify({ tipo: 'dispositivos' })), {
    tipo: 'dispositivos',
  });
  assert.deepEqual(lerPacoteCliente(JSON.stringify({ tipo: 'parear', codigo: ' h7k2-9qp4 ' })), {
    tipo: 'parear',
    codigo: 'h7k2-9qp4',
  });
  assert.deepEqual(
    lerPacoteCliente(JSON.stringify({ tipo: 'esquecer_dispositivo', id: 'abc123' })),
    { tipo: 'esquecer_dispositivo', id: 'abc123' },
  );

  assert.equal(lerPacoteCliente(JSON.stringify({ tipo: 'parear' })), null);
  assert.equal(lerPacoteCliente(JSON.stringify({ tipo: 'parear', codigo: '   ' })), null);
  assert.equal(lerPacoteCliente(JSON.stringify({ tipo: 'parear', codigo: 42 })), null);
  assert.equal(lerPacoteCliente(JSON.stringify({ tipo: 'esquecer_dispositivo', id: '' })), null);

  /* Teto de tamanho: o que chega maior que uma linha digitada não é um código
     com separadores, é sondagem de parser. */
  const enorme = lerPacoteCliente(JSON.stringify({ tipo: 'parear', codigo: 'A'.repeat(5000) }));
  assert.equal(enorme?.tipo === 'parear' && enorme.codigo.length, 40);
});

// ===========================================================================
// 5. A PONTE — o token de dispositivo abre a porta que executa, e só ela
// ===========================================================================

class SocketDeBraco extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  enviados: Record<string, unknown>[] = [];
  fechadoCom: number | null = null;

  send(dado: string): void {
    this.enviados.push(JSON.parse(dado) as Record<string, unknown>);
  }

  close(codigo?: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fechadoCom = codigo ?? 1000;
    this.emit('close');
  }

  apresentar(token: string | undefined, nome = 'DESKTOP-ANA'): void {
    this.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          tipo: 'apresentacao',
          id_usuario: 'mentira-do-cliente',
          nome,
          plataforma: 'win32 10.0.26200',
          versao: '1.1.0',
          ...(token ? { token } : {}),
        }),
      ),
    );
  }

  get ultimo(): Record<string, unknown> | undefined {
    return this.enviados.at(-1);
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Um par pronto: máquina aprovada por `quem`, token na mão. */
async function parear(
  p: RegistroPareamento,
  quem: typeof ANA,
  nome = 'DESKTOP-ANA',
): Promise<string> {
  const pedido = p.abrir({ ...MAQUINA, nome })!;
  await p.aprovar(pedido.codigo, quem);
  return p.resgatar(pedido.chave).credencial!.token;
}

test('P16. o braço pareado entra como dono da CREDENCIAL, não do que ele digitou', async () => {
  /**
   * O invariante da porta que executa, atravessado pela autoridade nova: o
   * `id_usuario` do pacote é decoração. Aqui ele chega mentindo de propósito
   * (`mentira-do-cliente`), e o braço tem que acabar registrado sob o operador
   * da credencial — nunca sob o id que ele mesmo escolheu.
   */
  const { p } = registro();
  const token = await parear(p, ANA);

  const ponte = new PonteDispositivos(p);
  const socket = new SocketDeBraco();
  ponte.conectar(socket as unknown as WebSocket);
  socket.apresentar(token);
  await espera(40);

  assert.equal(socket.ultimo?.tipo, 'bem_vindo', `a porta recusou um par válido: ${JSON.stringify(socket.ultimo)}`);
  assert.deepEqual(ponte.listar('mentira-do-cliente'), [], 'o braço entrou sob o id que ELE mandou');

  const lista = ponte.listar(ANA.id_usuario);
  assert.equal(lista.length, 1);
  assert.equal(lista[0].nome, 'DESKTOP-ANA');
  assert.ok(lista[0].id_credencial, 'a ponte perdeu o vínculo com a credencial');
});

test('P17. REVOGADA: o braço não volta depois que a operadora desconecta', async () => {
  /**
   * O ciclo inteiro do botão "desconectar", que é o que dá sentido à aba: o
   * braço está conectado, a credencial é revogada, o socket cai — e a
   * reconexão, que acontece em segundos por conta do recuo exponencial do
   * braço, encontra a porta fechada.
   *
   * Sem a última metade o botão seria teatro: a máquina sumiria da lista e
   * voltaria sozinha no minuto seguinte.
   */
  const { p } = registro();
  const token = await parear(p, ANA);
  const ponte = new PonteDispositivos(p);

  const primeiro = new SocketDeBraco();
  ponte.conectar(primeiro as unknown as WebSocket);
  primeiro.apresentar(token);
  await espera(40);
  const credencial = ponte.listar(ANA.id_usuario)[0].id_credencial!;

  assert.equal(await p.revogar(ANA.id_usuario, credencial), true);
  assert.equal(
    ponte.derrubarPorCredencial(ANA.id_usuario, credencial),
    1,
    'o socket vivo da credencial revogada não caiu',
  );
  assert.equal(primeiro.fechadoCom, 4000);
  assert.deepEqual(ponte.listar(ANA.id_usuario), []);

  const segundo = new SocketDeBraco();
  ponte.conectar(segundo as unknown as WebSocket);
  segundo.apresentar(token);
  await espera(40);

  assert.equal(segundo.ultimo?.tipo, 'recusado', 'a credencial revogada reconectou');
  assert.equal(segundo.fechadoCom, 4401);
  assert.deepEqual(ponte.listar(ANA.id_usuario), []);
});

test('P18. sem credencial nenhuma, a porta RECUSA e a frase diz o que fazer', async () => {
  /**
   * O caso da máquina nova antes de ser autorizada. A recusa não pode ser um
   * código de erro: quem a lê é a pessoa que acabou de abrir o programa, e a
   * frase precisa apontar para a aba onde ela resolve isso.
   */
  const { p } = registro();
  const ponte = new PonteDispositivos(p);
  const socket = new SocketDeBraco();

  ponte.conectar(socket as unknown as WebSocket);
  socket.apresentar(`${PREFIXO_TOKEN}token-que-nunca-existiu`);
  await espera(40);

  assert.equal(socket.ultimo?.tipo, 'recusado', 'a porta aceitou um token de dispositivo inventado');
  assert.match(String(socket.ultimo?.motivo), /Dispositivos/, 'a recusa não diz o que fazer');
  assert.equal(socket.fechadoCom, 4401);
  assert.deepEqual(ponte.listar(ANA.id_usuario), []);
});

test('P19. um par de OUTRO operador não vira mãos deste', async () => {
  /* O mesmo isolamento que o shard privado defende, na porta que executa: um
     token válido é válido para o dono dele, e para mais ninguém. */
  const { p } = registro();
  const doBruno = await parear(p, BRUNO, 'DESKTOP-BRUNO');

  const ponte = new PonteDispositivos(p);
  const socket = new SocketDeBraco();
  ponte.conectar(socket as unknown as WebSocket);
  socket.apresentar(doBruno);
  await espera(40);

  assert.deepEqual(ponte.listar(ANA.id_usuario), [], 'o braço de Bruno entrou na lista de Ana');
  assert.equal(ponte.listar(BRUNO.id_usuario).length, 1);
  assert.equal(ponte.destinoDe(ANA.id_usuario), null, 'Ana teria mandado ordens ao PC de Bruno');
});

// ===========================================================================
// 6. O INVENTÁRIO — o que a aba Dispositivos mostra
// ===========================================================================

test('P20. o inventário FUNDE socket vivo e linha do banco pela credencial', async () => {
  /**
   * A regra que decide se dois registros são a mesma máquina é a CREDENCIAL, e
   * não o nome — dois computadores podem se chamar `DESKTOP-PC`, e a mesma
   * máquina troca de nome quando alguém renomeia o Windows. Sem a fusão certa,
   * a operadora veria a mesma máquina duas vezes: uma "conectada" e outra
   * "desligada", e desconectar uma não faria nada com a outra.
   */
  const { p } = registro();
  const ligada = await parear(p, ANA, 'DESKTOP-PC');
  await parear(p, ANA, 'DESKTOP-PC'); // mesmo NOME, outra credencial, desligada

  const ponte = new PonteDispositivos(p);
  const socket = new SocketDeBraco();
  ponte.conectar(socket as unknown as WebSocket);
  socket.apresentar(ligada, 'DESKTOP-PC');
  await espera(40);

  const maquinas = await inventarioDeMaquinas(ANA.id_usuario, ponte, p);
  assert.equal(maquinas.length, 2, 'a máquina conectada apareceu duplicada');
  assert.equal(maquinas[0].conectada, true, 'a conectada precisa vir primeiro');
  assert.equal(maquinas[1].conectada, false);
  assert.ok(maquinas.every((m) => m.pareada && m.pareada_em), 'perdeu a data de pareamento');
  assert.equal(new Set(maquinas.map((m) => m.id)).size, 2, 'duas máquinas com o mesmo id');
});

test('P21. um braço SEM credencial durável aparece, e sem prometer o que não cumpre', async () => {
  /**
   * O braço de desenvolvimento (token colado, modo local) tem as mãos e executa
   * de verdade. Escondê-lo da lista seria pior que mostrá-lo — é assim que um
   * computador esquecido ligado vira um mistério. Mas ele não é `pareada`, e é
   * isso que faz a tela não oferecer um "desconectar" que não teria o que
   * revogar.
   */
  const { p } = registro();
  const ponte = new PonteDispositivos({
    async verificar() {
      return null; // nenhum token de dispositivo é reconhecido aqui
    },
  });
  const socket = new SocketDeBraco();
  ponte.conectar(socket as unknown as WebSocket);
  /* Sem token: em modo local (a suíte roda sem Supabase) a identidade vem do
     próprio pacote — é o caminho de desenvolvimento documentado no braço. */
  socket.apresentar(undefined, 'MAQUINA-DE-DEV');
  await espera(40);

  const dono = ponte.listar('mentira-do-cliente');
  assert.equal(dono.length, 1, 'o braço local não entrou');
  assert.equal(dono[0].id_credencial, null);

  const maquinas = await inventarioDeMaquinas('mentira-do-cliente', ponte, p);
  assert.equal(maquinas.length, 1);
  assert.equal(maquinas[0].conectada, true);
  assert.equal(maquinas[0].pareada, false, 'a tela ofereceria um "desconectar" que não revoga nada');
});

// ===========================================================================
// REGRESSÃO — o código aprovado não responde para quem não é o dono
//
// Encontrado na auditoria adversarial de 13/08/2026, reproduzido antes de ser
// consertado. Ana aprovava o pareamento do computador dela; Bruno mandava o
// MESMO código e recebia `ok: true` com o nome da máquina da Ana.
//
// Nenhuma credencial vazava — o token só sai para quem apresenta a chave, e a
// chave o Bruno não tem. O dano era outro, e de duas naturezas:
//
//  · FALSO SUCESSO. A tela do Bruno dizia "PC-DA-ANA conectado" enquanto a
//    lista de dispositivos dele continuava vazia. É a mentira com selo de
//    sucesso que este kernel inteiro existe para impedir.
//  · ORÁCULO ENTRE OPERADORES. Ele confirmava que aquele código existia e
//    aprendia o nome do computador de outra pessoa — e sem pagar cota, porque
//    a janela de erro só é consumida quando o código NÃO é encontrado.
// ===========================================================================

test('código já aprovado por outro operador é indistinguível de código errado', async () => {
  const { p, banco } = registro();
  const pedido = p.abrir({ nome: 'PC-DA-ANA', plataforma: 'win32', versao: '1.0.0' })!;

  const daAna = await p.aprovar(pedido.codigo, ANA);
  assert.equal(daAna.ok, true, 'a dona precisa conseguir aprovar');

  const doBruno = await p.aprovar(pedido.codigo, BRUNO);
  assert.equal(doBruno.ok, false, 'aprovar máquina de outro operador não pode dar certo');
  assert.ok(
    !JSON.stringify(doBruno).includes('PC-DA-ANA'),
    'a resposta ao intruso não pode carregar o nome do computador alheio',
  );
  assert.match(
    (doBruno as { motivo: string }).motivo,
    /não confere ou já expirou/i,
    'a frase tem que ser a mesma do código inexistente — senão vira oráculo',
  );

  // E o efeito no mundo continua sendo só o da dona.
  assert.deepEqual(
    (await p.listar('u-bruno')).length,
    0,
    'o intruso não pode ganhar dispositivo nenhum',
  );
  assert.equal((await p.listar('u-ana')).length, 1);
  assert.equal(banco.linhas.length, 1, 'nenhuma segunda credencial pode nascer da tentativa');
});

test('a dona ainda pode clicar duas vezes sem emitir duas credenciais', async () => {
  const { p, banco } = registro();
  const pedido = p.abrir({ nome: 'PC-DA-ANA', plataforma: 'win32', versao: '1.0.0' })!;

  const primeira = await p.aprovar(pedido.codigo, ANA);
  const segunda = await p.aprovar(pedido.codigo, ANA);

  assert.equal(primeira.ok, true);
  assert.equal(segunda.ok, true, 'duplo clique é o caso comum e não pode virar erro');
  assert.equal(banco.linhas.length, 1, 'o segundo clique não pode deixar credencial órfã no banco');
});
