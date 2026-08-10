/**
 * Espelhos simultâneos do mesmo operador.
 *
 * Regressão do bug de 08/08/2026: o app desktop e uma aba do navegador do
 * mesmo operador se derrubavam em takeover mútuo — cada tela via
 * "reconectando…" para sempre enquanto roubava a sessão da outra. Hoje uma
 * tela nova ENTRA na sessão; o kernel continua um só.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { conectarOperador } from '../servidor/barramento/Porta';
import type { WebSocket } from 'ws';
import type { PacoteServidor } from '../lib/protocolo';

class SocketFalso extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  enviados: PacoteServidor[] = [];
  fechadoCom: number | null = null;

  send(dado: string): void {
    this.enviados.push(JSON.parse(dado) as PacoteServidor);
  }

  close(codigo?: number): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.fechadoCom = codigo ?? 1000;
    this.emit('close');
  }

  apresentar(id: string, nome: string): void {
    this.emit('message', Buffer.from(JSON.stringify({ tipo: 'ola', id_usuario: id, nome })));
  }

  recebeuSnapshot(): boolean {
    return this.enviados.some((p) => p.tipo === 'snapshot');
  }
}

const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

function conectar(id: string, nome: string): SocketFalso {
  const s = new SocketFalso();
  conectarOperador(s as unknown as WebSocket);
  s.apresentar(id, nome);
  return s;
}

test('segunda tela do mesmo operador NÃO derruba a primeira', async () => {
  const app = conectar('teste-espelho-a', 'Espelho');
  await espera(150);
  assert.equal(app.recebeuSnapshot(), true, 'primeira tela hidratou');

  const navegador = conectar('teste-espelho-a', 'Espelho');
  await espera(150);

  assert.equal(navegador.recebeuSnapshot(), true, 'segunda tela hidratou');
  // O comportamento antigo fechava a primeira com 4000 "substituida por
  // conexao nova". Se isto quebrar, o loop de reconexão mútua voltou.
  assert.equal(app.fechadoCom, null, 'primeira tela continua aberta');

  app.close();
  navegador.close();
});

test('fechar uma tela não desmonta a sessão da outra', async () => {
  const a = conectar('teste-espelho-b', 'Espelho');
  const b = conectar('teste-espelho-b', 'Espelho');
  await espera(150);

  a.close();
  await espera(50);

  // Uma terceira tela entra e a hidratação alcança a que ficou.
  const antes = b.enviados.filter((p) => p.tipo === 'snapshot').length;
  const c = conectar('teste-espelho-b', 'Espelho');
  await espera(150);
  const depois = b.enviados.filter((p) => p.tipo === 'snapshot').length;

  assert.equal(b.fechadoCom, null, 'a tela que ficou segue aberta');
  assert.ok(depois > antes, 'a tela que ficou continua recebendo snapshots');

  b.close();
  c.close();
});

test('o teto de espelhos recusa a tela NOVA, nunca derruba as estabelecidas', async () => {
  const telas = Array.from({ length: 5 }, () => conectar('teste-espelho-c', 'Espelho'));
  await espera(250);

  /**
   * Regressão do carrossel de quedas (V4): derrubar a mais antiga fazia cada
   * tela derrubada reconectar e derrubar a próxima — quatro telas viravam uma
   * rotação perpétua de "desconectada". Agora quem excede o teto é a tela que
   * CHEGOU: recusa limpa, com aviso, e as estabelecidas nem percebem. Zumbi
   * de reconexão morre pelo heartbeat de 30 s, não pelo sacrifício alheio.
   */
  assert.equal(telas[4].fechadoCom, 4000, 'a quinta tela foi recusada com código 4000');
  assert.ok(
    telas[4].enviados.some((p) => p.tipo === 'erro'),
    'a recusa chegou com aviso legível antes do fechamento',
  );
  for (const tela of telas.slice(0, 4)) {
    assert.equal(tela.fechadoCom, null, 'as telas estabelecidas continuam abertas');
  }

  for (const tela of telas) tela.close();
});
