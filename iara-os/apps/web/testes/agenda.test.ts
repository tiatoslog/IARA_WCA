/**
 * Testes da agenda — lembretes.
 *
 * A pergunta que esta suíte responde: **a IARA avisa na hora certa, uma vez
 * só, e cala a boca quando não entendeu?**
 *
 * As três falhas que importam, e todas silenciosas:
 *
 *  1. HORA INVENTADA. Um lembrete que aceita "sexta que vem" e resolve para
 *     um instante qualquer toca na hora errada — e quem confia nele perde o
 *     compromisso E não desconfia do sistema.
 *  2. REPETIÇÃO. Um vencimento sem carimbo de entrega reaparece a cada tique
 *     de 15 segundos.
 *  3. CANCELAMENTO ERRADO. Apagar o lembrete que o operador não quis apagar só
 *     é descoberto na hora em que o certo não toca.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { interpretarQuando, extrairAssuntoLembrete } from '../servidor/nucleo/kernel/Quando';
import { Agenda } from '../servidor/nucleo/Agenda';
import { CicloAutonomo } from '../servidor/nucleo/CicloAutonomo';
import { MotorPercepcao } from '../servidor/nucleo/kernel/Percepcao';
import { Planejador } from '../servidor/nucleo/kernel/Planejador';
import { CATALOGO } from '../servidor/nucleo/kernel/habilidades';
import type { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';

/** Terça-feira, 12/08/2026, 10:00 local. Toda leitura de tempo parte daqui. */
const AGORA = new Date(2026, 7, 12, 10, 0, 0, 0);

// ===========================================================================
// 1. Quando — a hora nunca é adivinhada
// ===========================================================================

test('duração relativa vira instante, em número e por extenso', () => {
  const vinte = interpretarQuando('me lembre em 20 minutos de ligar', AGORA);
  assert.equal(vinte?.quando.getTime(), AGORA.getTime() + 20 * 60_000);
  assert.match(vinte!.rotulo, /20 minutos/);

  const duasHoras = interpretarQuando('me lembre daqui a 2 horas', AGORA);
  assert.equal(duasHoras?.quando.getHours(), 12);

  const meia = interpretarQuando('me lembre em meia hora', AGORA);
  assert.equal(meia?.quando.getTime(), AGORA.getTime() + 30 * 60_000);
});

test('relógio explícito, com e sem minutos', () => {
  assert.equal(interpretarQuando('me lembre às 15h', AGORA)?.quando.getHours(), 15);
  const comMinuto = interpretarQuando('me lembre às 15:30 da reunião', AGORA);
  assert.equal(comMinuto?.quando.getHours(), 15);
  assert.equal(comMinuto?.quando.getMinutes(), 30);
  assert.equal(interpretarQuando('me lembre ao meio-dia', AGORA)?.quando.getHours(), 12);
});

/**
 * O caso que faz o lembrete das oito da noite tocar às oito da manhã. Um
 * horário certo sobre o dia errado é indistinguível de mentira para quem confia.
 */
test('"às 8 da noite" é 20h, não 8h', () => {
  const noite = interpretarQuando('me lembre às 8 da noite', AGORA);
  assert.equal(noite?.quando.getHours(), 20);
  assert.equal(noite?.quando.getDate(), 12, 'ainda é hoje — 20h não passou às 10h');
});

test('hora já passada sem dia declarado rola para amanhã, e o rótulo avisa', () => {
  const passada = interpretarQuando('me lembre às 8h', AGORA);
  assert.equal(passada?.quando.getDate(), 13);
  assert.match(passada!.rotulo, /amanhã/, 'o operador precisa poder discordar da leitura');
});

/**
 * A assimetria deliberada: sem dia declarado, "às 8" quer dizer amanhã. Com o
 * dia DECLARADO, rolar seria contrariar o que foi dito — e aí o certo é
 * devolver nada e deixar a habilidade explicar.
 */
test('"hoje às 8h" com 8h já passada não vira amanhã: vira nada', () => {
  assert.equal(interpretarQuando('me lembre hoje às 8h', AGORA), null);
});

test('amanhã, depois de amanhã e período do dia', () => {
  assert.equal(interpretarQuando('me lembre amanhã às 9', AGORA)?.quando.getDate(), 13);
  assert.equal(interpretarQuando('me lembre depois de amanhã às 9', AGORA)?.quando.getDate(), 14);

  const manha = interpretarQuando('me lembre amanhã de manhã', AGORA);
  assert.equal(manha?.quando.getDate(), 13);
  assert.equal(manha?.quando.getHours(), 9);
});

/**
 * O CONTRATO CENTRAL DESTE MÓDULO. Cada `null` aqui é uma pergunta que a IARA
 * vai fazer ao operador em vez de um lembrete que tocaria na hora errada.
 */
test('o que não dá para saber devolve nada — nunca um palpite', () => {
  assert.equal(interpretarQuando('me lembre na sexta', AGORA), null, 'dia da semana é ambíguo');
  assert.equal(interpretarQuando('me lembre depois', AGORA), null);
  assert.equal(interpretarQuando('me lembre de ligar para o cliente', AGORA), null);
  assert.equal(interpretarQuando('me lembre em 9000 dias', AGORA), null, 'teto de um ano');
  assert.equal(interpretarQuando('me lembre às 99h', AGORA), null);
  // "de manhã" solto pode ser hoje (já passou) ou amanhã. Adivinhar é a decisão
  // que este módulo não toma.
  assert.equal(interpretarQuando('me lembre de manhã', AGORA), null);
});

/**
 * O assunto é o parâmetro que a IARA vai LER DE VOLTA em voz alta. Duas formas
 * de errar aqui, e as duas passam por cima da recusa que o módulo promete:
 *
 *  - sobra de horário no assunto ("às", "amanhã da reunião") vira um lembrete
 *    que anuncia a hora como se fosse o compromisso;
 *  - conectivo órfão ("de ligar") é o rastro de um recorte feito na ordem
 *    errada — cosmético na leitura, mas é o mesmo defeito que produz o item
 *    acima quando o acento entra.
 *
 * A tabela cobre a FAMÍLIA inteira: acento no ruído, acento no assunto, ruído
 * antes e depois do assunto, e o caso sem assunto nenhum.
 */
test('o assunto sai limpo do ruído temporal, com acento preservado', () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    ['me lembre em 20 minutos de ligar para o Índio', 'ligar para o Índio'],
    ['me lembre amanhã às 9 da reunião de pauta', 'reunião de pauta'],
    ['me lembre daqui a 2 horas do relatório', 'relatório'],
    ['me lembre às 15h de ligar para o cliente', 'ligar para o cliente'],
    ['me lembre de ligar para o cliente às 14h', 'ligar para o cliente'],
    ['me lembre hoje de mandar o e-mail', 'mandar o e-mail'],
    ['lembre-me em 30 minutos de tomar remédio', 'tomar remédio'],
    ['me lembra às 9h da consulta', 'consulta'],
    ['me lembre amanhã de manhã de ligar para o contador', 'ligar para o contador'],
    ['me lembre às 8 da noite de fechar o caixa', 'fechar o caixa'],
    ['me lembre em 1 hora que preciso assinar o contrato', 'preciso assinar o contrato'],
  ];
  for (const [frase, esperado] of casos) {
    assert.equal(extrairAssuntoLembrete(frase), esperado, frase);
  }

  // Hora sem assunto: vazio, para a habilidade perguntar em vez de marcar um
  // lembrete mudo. O "às" sozinho tem 2 caracteres — passaria pelo piso de
  // comprimento e viraria o assunto do lembrete.
  assert.equal(extrairAssuntoLembrete('me lembre às 15h'), '');
  assert.equal(extrairAssuntoLembrete('me lembre em 20 minutos'), '');
  assert.equal(extrairAssuntoLembrete('me lembre amanhã de manhã'), '');
});

/**
 * A propriedade, e não mais o caso: nenhum assunto pode CONTER a marca de hora
 * que o operador usou. Se contiver, o lembrete lido de volta descreve o relógio
 * em vez do compromisso — e essa foi a família de defeitos que a tabela acima
 * fechou um a um.
 */
test('nenhum assunto extraído carrega marca temporal residual', () => {
  const gerados = [
    'em 20 minutos',
    'daqui a 2 horas',
    'às 15h',
    'às 8 da noite',
    'amanhã às 9',
    'hoje às 15h30',
    'depois de amanhã',
    'amanhã de manhã',
    'ao meio-dia',
  ].flatMap((quando) => [
    `me lembre ${quando} de ligar para o Índio`,
    `me lembre de ligar para o Índio ${quando}`,
  ]);

  for (const frase of gerados) {
    const assunto = extrairAssuntoLembrete(frase);
    assert.ok(assunto.length > 0, `assunto sumiu inteiro em "${frase}"`);
    const plano = assunto.normalize('NFD').replace(/[^a-zA-Z0-9 -]/g, '').toLowerCase();
    assert.equal(/[0-9]|amanh|hoje|meio|(^| )as( |$)/.test(plano), false, `"${frase}" → "${assunto}"`);
    assert.match(assunto, /Índio/, `acento perdido em "${frase}" → "${assunto}"`);
  }
});

// ===========================================================================
// 2. Agenda — gravar, listar, cancelar
// ===========================================================================

/** Agenda em memória: a suíte não pode sujar `dados/agenda/` do repositório. */
function agendaLimpa(): Agenda {
  const a = new Agenda();
  // O caminho de arquivo só é tocado no `gravar`; sobrescrevê-lo mantém tudo no
  // cache em memória, que é exatamente o que estes testes precisam exercitar.
  (a as unknown as { gravar: () => Promise<void> }).gravar = async () => undefined;
  return a;
}

test('lembrete gravado aparece nos pendentes, ordenado pelo vencimento', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'reunião de pauta', new Date(AGORA.getTime() + 3_600_000));
  await a.agendar('daiane', 'ligar para o cliente', new Date(AGORA.getTime() + 600_000));

  const pendentes = await a.pendentes('daiane');
  assert.equal(pendentes.length, 2);
  assert.equal(pendentes[0].assunto, 'ligar para o cliente', 'o mais próximo vem primeiro');
});

test('a agenda de um operador nunca aparece na do outro', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'coisa dela', new Date(AGORA.getTime() + 600_000));
  assert.deepEqual(await a.pendentes('outro-operador'), []);
});

/**
 * O carimbo de entrega. Sem ele o ciclo autônomo reencontra o mesmo vencimento
 * a cada 15 segundos e a IARA repete o recado até alguém matar o processo.
 */
test('vencido some dos pendentes depois de entregue', async () => {
  const a = agendaLimpa();
  const l = await a.agendar('daiane', 'ligar', new Date(AGORA.getTime() - 1000));

  const antes = await a.vencidos('daiane', AGORA);
  assert.equal(antes.length, 1);

  await a.marcarEntregue('daiane', l!.id);
  assert.deepEqual(await a.vencidos('daiane', AGORA), []);
  assert.deepEqual(await a.pendentes('daiane'), []);
});

test('lembrete futuro não vence antes da hora', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'depois', new Date(AGORA.getTime() + 600_000));
  assert.deepEqual(await a.vencidos('daiane', AGORA), []);
});

test('cancelar por termo remove o certo', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'reunião de pauta', new Date(AGORA.getTime() + 600_000));
  await a.agendar('daiane', 'ligar para o cliente', new Date(AGORA.getTime() + 900_000));

  const removido = await a.cancelar('daiane', 'reunião');
  assert.equal(removido?.assunto, 'reunião de pauta');

  const restantes = await a.pendentes('daiane');
  assert.equal(restantes.length, 1);
  assert.equal(restantes[0].assunto, 'ligar para o cliente');
});

/**
 * AMBIGUIDADE NÃO CANCELA. Apagar o lembrete errado é a falha mais silenciosa
 * desta habilidade — só se descobre na hora em que o certo não toca.
 */
test('termo ambíguo não apaga nada; termo vazio com um só pendente apaga', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'ligar para o cliente', new Date(AGORA.getTime() + 600_000));
  await a.agendar('daiane', 'ligar para o contador', new Date(AGORA.getTime() + 900_000));

  assert.equal(await a.cancelar('daiane', 'ligar'), null, 'dois candidatos: não escolhe');
  assert.equal(await a.cancelar('daiane', ''), null, 'sem termo e com dois: não escolhe');
  assert.equal((await a.pendentes('daiane')).length, 2, 'nada foi removido');

  await a.cancelar('daiane', 'contador');
  const unico = await a.cancelar('daiane', '');
  assert.equal(unico?.assunto, 'ligar para o cliente', 'com um só pendente, vazio resolve');
});

test('cancelar aceita o termo com acento contra assunto sem, e vice-versa', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'reuniao de pauta', new Date(AGORA.getTime() + 600_000));
  assert.ok(await a.cancelar('daiane', 'reunião'));
});

// ===========================================================================
// 3. Ciclo autônomo — entrega uma vez
// ===========================================================================

test('o ciclo anuncia o vencido e o carimba, e não repete no tique seguinte', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'ligar para o cliente', new Date(AGORA.getTime() - 1000));

  const ditos: string[] = [];
  const ciclo = new CicloAutonomo(
    'daiane',
    {} as EstadoAtomico,
    {} as MemoriaOperacional,
    () => undefined,
    (l) => ditos.push(l.assunto),
    a,
  );

  // `entregarVencidos` é privado de propósito — o tique é quem o chama. Aqui a
  // suíte o exercita direto para não depender de um timer de 15 segundos.
  const entregar = (
    ciclo as unknown as { entregarVencidos: (s: AbortSignal) => Promise<void> }
  ).entregarVencidos.bind(ciclo);

  const sinal = new AbortController().signal;
  await entregar(sinal);
  await entregar(sinal);

  assert.deepEqual(ditos, ['ligar para o cliente'], 'o recado sai UMA vez');
});

test('ciclo sem anunciante não carimba entrega — o lembrete espera', async () => {
  const a = agendaLimpa();
  await a.agendar('daiane', 'ligar', new Date(AGORA.getTime() - 1000));

  const ciclo = new CicloAutonomo(
    'daiane',
    {} as EstadoAtomico,
    {} as MemoriaOperacional,
    () => undefined,
    null,
    a,
  );
  await (
    ciclo as unknown as { entregarVencidos: (s: AbortSignal) => Promise<void> }
  ).entregarVencidos.bind(ciclo)(new AbortController().signal);

  assert.equal(
    (await a.vencidos('daiane')).length,
    1,
    'sem canal de entrega o lembrete continua devendo — nunca é dado por dito',
  );
});

// ===========================================================================
// 4. Percepção e plano
// ===========================================================================

const IDS = new Set(CATALOGO.map((h) => h.manifesto.id));

function habilidadeDe(frase: string): string | null {
  const plano = new Planejador().planejar(new MotorPercepcao().perceber(frase));
  return plano.passos[0]?.habilidade ?? null;
}

test('a mesma âncora escolhe entre marcar, listar e cancelar', () => {
  assert.equal(habilidadeDe('me lembre às 15h de ligar para o cliente'), 'agendar_lembrete');
  assert.equal(habilidadeDe('quais lembretes eu tenho?'), 'listar_lembretes');
  assert.equal(habilidadeDe('meus lembretes'), 'listar_lembretes');
  assert.equal(habilidadeDe('cancela o lembrete da reunião'), 'cancelar_lembrete');
});

/**
 * A armadilha do verbo: "me lembre de CANCELAR a reunião" cria um lembrete cujo
 * assunto contém "cancelar". Sem a amarra que exige a palavra `lembrete` logo
 * depois do verbo, a IARA apagaria justamente o recado que estava criando.
 */
test('"me lembre de cancelar a reunião" MARCA, não cancela', () => {
  assert.equal(habilidadeDe('me lembre de cancelar a reunião às 14h'), 'agendar_lembrete');
});

/**
 * Achado ao vivo em auditoria (14/08/2026): uma pergunta de RECAPITULAÇÃO
 * ("o que você já marcou?") não é um pedido de marcar nada, mas caía no
 * `return` padrão de `lembrete()` — a mesma classe de defeito do roteador de
 * clima, "tema não é pergunta", só que para agenda: mencionar "lembrete" não
 * é pedir para criar um.
 */
test('recapitular o que já foi marcado LISTA, não tenta marcar de novo', () => {
  assert.equal(habilidadeDe('o que você já marcou de lembrete?'), 'listar_lembretes');
  assert.equal(habilidadeDe('confirma o que a gente marcou de lembrete'), 'listar_lembretes');
  // Sem a palavra "lembrete"/"agenda" no texto não há âncora determinística —
  // e é correto cair no raciocínio emergente, que decide com o contexto da
  // conversa. Este caso NÃO é o defeito: é o comportamento pretendido.
  assert.equal(habilidadeDe('o que eu marquei mesmo?'), 'raciocinio');
});

test('as três habilidades de agenda estão no catálogo', () => {
  for (const id of ['agendar_lembrete', 'listar_lembretes', 'cancelar_lembrete']) {
    assert.ok(IDS.has(id), `habilidade ausente do catálogo: ${id}`);
  }
});

test('a receita de lembrete nunca aponta para habilidade opcional', () => {
  const porId = new Map(CATALOGO.map((h) => [h.manifesto.id, h]));
  for (const frase of [
    'me lembre às 15h de ligar',
    'quais lembretes eu tenho?',
    'cancela o lembrete da reunião',
    'tira um print da tela',
  ]) {
    const id = habilidadeDe(frase);
    assert.ok(id && porId.has(id), `"${frase}" → habilidade inexistente "${id}"`);
    assert.equal(
      porId.get(id)!.indisponivelPorque?.() ?? null,
      null,
      `receita para "${frase}" usa "${id}", que pode sumir do planejador`,
    );
  }
});

test('"me lembro" e "isso me lembra o incidente" não marcam nada', () => {
  const p = new MotorPercepcao();
  assert.ok(!p.perceber('não me lembro de ter pedido isso').ancoras.includes('lembrete'));
  assert.ok(!p.perceber('isso me lembra o incidente de março').ancoras.includes('lembrete'));
  assert.ok(p.perceber('me lembre de ligar amanhã').ancoras.includes('lembrete'));
});
