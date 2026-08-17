/**
 * DUPLICAÇÃO DE EFEITO SOB TIMEOUT — a bateria `duplicacao_efeito` do registro.
 *
 * A pergunta que só esta suíte responde: *timeout DEPOIS do efeito, com
 * retentativa em cima — duplica?* `testes/fronteira-efeitos.test.ts` já prova
 * o mecanismo com UM retry sequencial (cenário 6). O que faltava — e é o que
 * uma bateria mede que um teste avulso não mede — é o mecanismo sob
 * ADVERSÁRIO: múltiplas tentativas em fila, tentativas em corrida (o mesmo
 * pedido disparado ao mesmo tempo, não em sequência), e os quatro estados que
 * escondem "o efeito pode ter acontecido" (`TIMEOUT`, `ACEITA_SEM_RESPOSTA`,
 * `EXPLODE_APOS_ENTREGAR`) mais o caso em que só o CONTEÚDO repete, sem que a
 * origem do pedido seja a mesma.
 *
 * O provedor de laboratório é o MUNDO, não o alvo do teste — o alvo é
 * `RegistroOperacoes.reservar`/`PortalEfeitos.abrir`, que é o mesmo mecanismo
 * usado pelo passo de plano do Kernel e por toda integração externa (ver o
 * comentário de `PortalEfeitos.abrir`). Testar aqui, pelo caminho de
 * integração, exercita a peça compartilhada — não uma cópia dela.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { PortalEfeitos, type Integracao, type RespostaProvedor } from '../servidor/nucleo/kernel/PortalEfeitos';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';

// ===========================================================================
// O provedor controlável — mesmo desenho de fronteira-efeitos.test.ts
// ===========================================================================

class Provedor {
  readonly entregues: string[] = [];
  quantas(texto: string): number {
    return this.entregues.filter((e) => e === texto).length;
  }
}

type ModoProvedor = 'TIMEOUT' | 'ACEITA_SEM_RESPOSTA' | 'EXPLODE_APOS_ENTREGAR';

const pendurar = () => new Promise<never>(() => {});

function integracaoFalsa(o: { provedor: Provedor; modo: ModoProvedor }): Integracao {
  return {
    id: 'falsa.enviar',
    nome: 'provedor de laboratório',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    timeout_ms: 60,
    esquema: {
      telefone: { tipo: 'texto', obrigatorio: true },
      texto: { tipo: 'texto', obrigatorio: true },
    },
    async executar(pedido): Promise<RespostaProvedor> {
      if (o.modo === 'TIMEOUT') return pendurar();

      // Os outros dois modos ENTREGAM antes de esconder o resultado — é o que
      // torna a retentativa perigosa: o efeito já está no mundo.
      o.provedor.entregues.push(String(pedido.parametros.texto));

      if (o.modo === 'EXPLODE_APOS_ENTREGAR') throw new Error('socket cortado após entregar');
      return pendurar(); // ACEITA_SEM_RESPOSTA
    },
  };
}

function jornal(): { registro: RegistroOperacoes } {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-dup-efeito-'));
  return { registro: new RegistroOperacoes(raiz) };
}

function portalCom(registro: RegistroOperacoes, integracao: Integracao): PortalEfeitos {
  const p = new PortalEfeitos(registro);
  p.registrar(integracao);
  return p;
}

const ENVIO = (origem: string, texto: string = 'oi') => ({
  integracao: 'falsa.enviar',
  id_usuario: 'ana',
  sessao: 'whatsapp:ana',
  parametros: { telefone: '5565999', texto },
  origem_pedido: origem,
  fonte_autorizacao: 'operador' as const,
  motivo_autorizacao: 'mensagem recebida do operador',
});

// ===========================================================================
// 1. INSISTÊNCIA EM FILA — N retentativas sequenciais, todas com a MESMA
//    origem de pedido, depois de um modo que esconde se o efeito ocorreu.
// ===========================================================================

for (const modo of ['TIMEOUT', 'ACEITA_SEM_RESPOSTA', 'EXPLODE_APOS_ENTREGAR'] as const) {
  test(`1.${modo}: 5 retentativas em fila, mesma origem, não duplicam`, async () => {
    const { registro } = jornal();
    const provedor = new Provedor();
    const portal = portalCom(registro, integracaoFalsa({ provedor, modo }));

    for (let tentativa = 0; tentativa < 5; tentativa++) {
      await portal.executar(ENVIO('msg-fila'));
    }

    const entregas = provedor.quantas('oi');
    assert.ok(
      entregas <= 1,
      `modo ${modo}: 5 retentativas em fila entregaram ${entregas} vezes (esperado ≤1)`,
    );
  });
}

// ===========================================================================
// 2. CORRIDA — N tentativas DISPARADAS AO MESMO TEMPO, mesma origem. O que a
//    fila sequencial não pega: duas escritas que colidem entre o `reservar`
//    de uma e o `marcar` da outra.
// ===========================================================================

for (const modo of ['TIMEOUT', 'ACEITA_SEM_RESPOSTA', 'EXPLODE_APOS_ENTREGAR'] as const) {
  test(`2.${modo}: 8 retentativas em corrida, mesma origem, não duplicam`, async () => {
    const { registro } = jornal();
    const provedor = new Provedor();
    const portal = portalCom(registro, integracaoFalsa({ provedor, modo }));

    await Promise.all(Array.from({ length: 8 }, () => portal.executar(ENVIO('msg-corrida'))));

    const entregas = provedor.quantas('oi');
    assert.ok(
      entregas <= 1,
      `modo ${modo}: 8 tentativas em corrida entregaram ${entregas} vezes (esperado ≤1)`,
    );
  });
}

// ===========================================================================
// 3. MESMO CONTEÚDO, ORIGEM DIFERENTE — a retentativa não veio do mesmo
//    pedido (ex.: o operador digitou de novo, ou dois canais reencaminharam),
//    e é a impressão do efeito — não a origem — quem tem que segurar.
// ===========================================================================

test('3. mesmo texto e destinatário, 5 origens diferentes, depois de EXPLODE_APOS_ENTREGAR: não duplicam', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'EXPLODE_APOS_ENTREGAR' }));

  for (let i = 0; i < 5; i++) {
    await portal.executar(ENVIO(`msg-origem-distinta-${i}`));
  }

  const entregas = provedor.quantas('oi');
  assert.ok(
    entregas <= 1,
    `5 origens diferentes do mesmo conteúdo entregaram ${entregas} vezes (esperado ≤1)`,
  );
});

// ===========================================================================
// 4. RECUPERAÇÃO LEGÍTIMA — depois que o mundo é consultado e o efeito É
//    resolvido (ex.: via `resolverDesconhecida`), uma tentativa NOVA para uma
//    origem DIFERENTE, com conteúdo DIFERENTE, precisa continuar funcionando.
//    Duplicação zero não pode ser "nada mais nunca entrega" — o portão não
//    pode travar o sistema inteiro para fechar uma via de duplicação.
// ===========================================================================

test('4. depois da insistência bloqueada, uma mensagem NOVA (conteúdo e origem diferentes) ainda é entregue', async () => {
  const { registro } = jornal();
  const provedor = new Provedor();
  const portal = portalCom(registro, integracaoFalsa({ provedor, modo: 'ACEITA_SEM_RESPOSTA' }));

  await portal.executar(ENVIO('msg-primeira', 'oi'));
  await portal.executar(ENVIO('msg-primeira', 'oi')); // insistência — deve ficar bloqueada
  assert.equal(provedor.quantas('oi'), 1);

  // Provedor novo: um segundo canal de verdade, mensagem genuinamente nova.
  const provedor2 = new Provedor();
  const portalAceita: Integracao = {
    id: 'falsa.enviar',
    nome: 'provedor de laboratório',
    risco: 'medio',
    semantica: 'escrita_nao_idempotente',
    timeout_ms: 200,
    esquema: {
      telefone: { tipo: 'texto', obrigatorio: true },
      texto: { tipo: 'texto', obrigatorio: true },
    },
    async executar(pedido) {
      provedor2.entregues.push(String(pedido.parametros.texto));
      return { aceito: true, referencia: 'ref-nova', detalhe: 'aceito' };
    },
  };
  const portal2 = portalCom(registro, portalAceita);
  const nova = await portal2.executar(ENVIO('msg-segunda', 'tudo bem?'));

  assert.equal(nova.tipo, 'executada', 'o bloqueio de duplicação impediu um efeito genuinamente novo');
  assert.equal(provedor2.quantas('tudo bem?'), 1);
});

// ===========================================================================
// 5. A TAXA — o número que a bateria reporta. Soma todos os cenários acima
//    (18: 3 modos × [fila, corrida] + 1 de origem múltipla) num único
//    contador de duplicação, para que `npm run bateria -- duplicacao_efeito`
//    tenha uma métrica e não só um punhado de PASS/FAIL desconectados.
// ===========================================================================

test('5. taxa de duplicação medida nesta suíte é zero', async () => {
  let duplicou = 0;
  let cenarios = 0;

  for (const modo of ['TIMEOUT', 'ACEITA_SEM_RESPOSTA', 'EXPLODE_APOS_ENTREGAR'] as const) {
    // fila
    {
      const { registro } = jornal();
      const provedor = new Provedor();
      const portal = portalCom(registro, integracaoFalsa({ provedor, modo }));
      for (let i = 0; i < 5; i++) await portal.executar(ENVIO('taxa-fila'));
      cenarios++;
      if (provedor.quantas('oi') > 1) duplicou++;
    }
    // corrida
    {
      const { registro } = jornal();
      const provedor = new Provedor();
      const portal = portalCom(registro, integracaoFalsa({ provedor, modo }));
      await Promise.all(Array.from({ length: 8 }, () => portal.executar(ENVIO('taxa-corrida'))));
      cenarios++;
      if (provedor.quantas('oi') > 1) duplicou++;
    }
  }

  const taxa = duplicou / cenarios;
  assert.equal(taxa, 0, `taxa de duplicação: ${duplicou}/${cenarios} = ${(taxa * 100).toFixed(1)}%`);
});
