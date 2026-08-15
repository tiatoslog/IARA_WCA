/**
 * CONVITE DE PAREAMENTO — o QR na tela da IARA e o batismo na autorização.
 *
 * O que esta suíte protege, em duas frentes:
 *
 *  · os DOIS LINKS do mesmo código (`?convite=` para o computador novo,
 *    `?parear=` para o celular) não podem divergir de grafia — um hífen que
 *    sobra ou uma barra dupla é um QR que abre a página errada;
 *  · o BATISMO ("Notebook Daiane") entra pelo pacote, mas só o NOME — a
 *    identidade de quem autoriza continua vindo da sessão, e nome nenhum pode
 *    alargar o pacote além do teto que `renomear_dispositivo` já respeita.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { linkDoConvite, linkDoPareamento } from '../servidor/braco/pareamento';
import {
  ehCodigoPossivel,
  formatarCodigo,
  normalizarCodigo,
} from '../lib/codigoPareamento';
import {
  RegistroPareamento,
  type DispositivoPareado,
  type RepositorioDispositivos,
} from '../servidor/nucleo/Pareamento';
import { lerPacoteCliente } from '../lib/protocolo';

// ---------------------------------------------------------------------------
// UN-101 / UN-102 — os dois links do mesmo código
// ---------------------------------------------------------------------------

test('linkDoConvite: sem hífen, sem barra dupla, com o código inteiro', () => {
  assert.equal(
    linkDoConvite('https://iara.up.railway.app/', 'H7K2-9QP4'),
    'https://iara.up.railway.app/?convite=H7K29QP4',
  );
  // Barras acumuladas no fim não viram `//?convite=`.
  assert.equal(linkDoConvite('https://x.app///', 'AAAA-BBBB'), 'https://x.app/?convite=AAAABBBB');
});

test('linkDoPareamento: mesma grafia, rota do celular', () => {
  assert.equal(
    linkDoPareamento('https://iara.up.railway.app', 'H7K2-9QP4'),
    'https://iara.up.railway.app/?parear=H7K29QP4',
  );
});

// ---------------------------------------------------------------------------
// A grafia compartilhada (lib) — a mesma que o kernel reexporta
// ---------------------------------------------------------------------------

test('normalizar e formatar continuam inversos para códigos possíveis', () => {
  assert.equal(normalizarCodigo(' h7k2-9qp4 '), 'H7K29QP4');
  assert.equal(formatarCodigo('H7K29QP4'), 'H7K2-9QP4');
});

test('ehCodigoPossivel barra o que o sorteio nunca produz', () => {
  assert.equal(ehCodigoPossivel('H7K29QP4'), true);
  assert.equal(ehCodigoPossivel('H7K29QP'), false); // curto
  assert.equal(ehCodigoPossivel('H7K29QP40'), false); // longo
  assert.equal(ehCodigoPossivel('H7K29QP0'), false); // 0 fora do alfabeto
  assert.equal(ehCodigoPossivel('<SCRIPT>'), false); // a URL é entrada hostil
});

// ---------------------------------------------------------------------------
// UN-103..105 — o batismo na aprovação
// ---------------------------------------------------------------------------

interface Linha {
  id_credencial: string;
  id_usuario: string;
  nome: string;
  plataforma: string;
  hash_token: string;
}

class BancoDeMentira implements RepositorioDispositivos {
  readonly linhas: Linha[] = [];
  disponivel(): boolean {
    return true;
  }
  async gravar(d: Linha): Promise<void> {
    this.linhas.push({ ...d });
  }
  async porHash(): Promise<DispositivoPareado | null> {
    return null;
  }
  async marcarUso(): Promise<void> {}
  async listar(): Promise<DispositivoPareado[]> {
    return [];
  }
  async revogar(): Promise<boolean> {
    return false;
  }
  async renomear(): Promise<boolean> {
    return false;
  }
}

const ANA = { id_usuario: 'u-ana', nome: 'Ana', email: 'ana@atoslog.com' };
const MAQUINA = { nome: 'DESKTOP-7F2A', plataforma: 'win32 10.0.26200', versao: '1.1.0' };

test('aprovar com batismo grava o nome escolhido, e a resposta o confirma', async () => {
  const banco = new BancoDeMentira();
  const p = new RegistroPareamento(banco);
  const pedido = p.abrir(MAQUINA)!;

  const r = await p.aprovar(pedido.codigo, ANA, Date.now(), 'Notebook Daiane');
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.nome, 'Notebook Daiane');
  assert.equal(banco.linhas[0].nome, 'Notebook Daiane');
});

test('batismo vazio ou só espaços vale o hostname reportado — o comportamento de sempre', async () => {
  for (const vazio of [undefined, '', '   ']) {
    const banco = new BancoDeMentira();
    const p = new RegistroPareamento(banco);
    const pedido = p.abrir(MAQUINA)!;

    const r = await p.aprovar(pedido.codigo, ANA, Date.now(), vazio);
    assert.equal(r.ok, true);
    assert.equal(banco.linhas[0].nome, 'DESKTOP-7F2A');
  }
});

test('batismo comprido é aparado em 80 — o teto do banco, o mesmo do renomear', async () => {
  const banco = new BancoDeMentira();
  const p = new RegistroPareamento(banco);
  const pedido = p.abrir(MAQUINA)!;

  await p.aprovar(pedido.codigo, ANA, Date.now(), 'x'.repeat(200));
  assert.equal(banco.linhas[0].nome.length, 80);
});

// ---------------------------------------------------------------------------
// UN-106 — o parser do pacote
// ---------------------------------------------------------------------------

test('parear com nome: aparado; ausente/vazio/tipo errado = campo ausente', () => {
  const comNome = lerPacoteCliente(
    JSON.stringify({ tipo: 'parear', codigo: 'H7K2-9QP4', nome: '  PC de Casa  ' }),
  );
  assert.deepEqual(comNome, { tipo: 'parear', codigo: 'H7K2-9QP4', nome: 'PC de Casa' });

  const semNome = lerPacoteCliente(JSON.stringify({ tipo: 'parear', codigo: 'H7K2-9QP4' }));
  assert.deepEqual(semNome, { tipo: 'parear', codigo: 'H7K2-9QP4' });

  const nomeVazio = lerPacoteCliente(
    JSON.stringify({ tipo: 'parear', codigo: 'H7K2-9QP4', nome: '   ' }),
  );
  assert.deepEqual(nomeVazio, { tipo: 'parear', codigo: 'H7K2-9QP4' });

  const nomeLixo = lerPacoteCliente(
    JSON.stringify({ tipo: 'parear', codigo: 'H7K2-9QP4', nome: 42 }),
  );
  assert.deepEqual(nomeLixo, { tipo: 'parear', codigo: 'H7K2-9QP4' });

  const nomeComprido = lerPacoteCliente(
    JSON.stringify({ tipo: 'parear', codigo: 'H7K2-9QP4', nome: 'y'.repeat(200) }),
  ) as { nome?: string } | null;
  assert.equal(nomeComprido?.nome?.length, 80);
});
