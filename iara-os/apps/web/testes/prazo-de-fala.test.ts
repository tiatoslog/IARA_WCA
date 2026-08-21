/**
 * O PRAZO DE FALA, testado sem esperar.
 *
 * Relógio e agendador são injetados: um teste que dormisse 20 s para conferir um
 * aviso de 20 s custaria mais que a suíte inteira e mediria o `setTimeout` do
 * Node. O que se testa aqui é a REGRA — quando avisa, quando cala, e o que a
 * frase pode dizer.
 *
 * O caso que dá nome ao arquivo é o T7: um turno rápido não pode disparar aviso
 * nenhum. Um aviso que aparece sempre é um aviso que ninguém lê, e aí a próxima
 * vez que a IARA travar de verdade ninguém vai notar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { CompiladorSnapshot } from '../servidor/nucleo/kernel/CompiladorSnapshot';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import { MemoriaTrabalho } from '../servidor/nucleo/kernel/MemoriaTrabalho';
import {
  armarAvisoDeEspera,
  PRAZO_FALA_PADRAO_MS,
  textoDeEspera,
} from '../servidor/nucleo/kernel/PrazoDeFala';

/**
 * A bancada do COMPILADOR, para os casos em que o que se testa não é o
 * agendamento e sim o que sobra na tela. Barramento e compilador de verdade: o
 * defeito do recado virando resposta mora justamente na tradução entre os dois.
 */
function bancadaDoCompilador() {
  const barramento = new BarramentoEventos('s-prazo');
  const compilador = new CompiladorSnapshot(barramento, new MemoriaTrabalho());
  const estado = new EstadoAtomico();
  return { barramento, compilador, estado };
}

/** Agendador de mentira: guarda a função e só a roda quando o teste mandar. */
function relogioFalso() {
  let agora = 0;
  const pendentes = new Map<number, { fn: () => void; quando: number }>();
  let proximo = 1;
  return {
    agora: () => agora,
    agendar: (fn: () => void, ms: number) => {
      const id = proximo++;
      pendentes.set(id, { fn, quando: agora + ms });
      return id;
    },
    desagendar: (id: unknown) => {
      pendentes.delete(id as number);
    },
    /** Avança o relógio e dispara o que vencer no caminho. */
    avancar(ms: number) {
      agora += ms;
      for (const [id, p] of [...pendentes]) {
        if (p.quando <= agora) {
          pendentes.delete(id);
          p.fn();
        }
      }
    },
    get agendados() {
      return pendentes.size;
    },
  };
}

function bancada(prazoMs = 20_000, tentativas = 1) {
  const barramento = new BarramentoEventos('teste');
  const relogio = relogioFalso();
  const falas: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'RESPOSTA_TRECHO') falas.push(e.texto);
  });
  const aviso = armarAvisoDeEspera({
    barramento,
    idDaPergunta: 'op:x1',
    tentativasDeProvedor: () => tentativas,
    prazoMs,
    agora: relogio.agora,
    agendar: relogio.agendar,
    desagendar: relogio.desagendar,
  });
  return { barramento, relogio, falas, aviso };
}

test('P1. turno que passa do prazo sem mostrar nada recebe aviso', () => {
  const { relogio, falas, aviso } = bancada();
  relogio.avancar(19_999);
  assert.equal(falas.length, 0, 'antes do prazo não se avisa nada');
  relogio.avancar(2);
  assert.equal(aviso.disparou(), true);
  assert.equal(falas.length, 1);
  assert.match(falas[0], /ainda estou nisto/i);
});

test('P2. turno rápido NÃO dispara aviso — o cancelamento chega antes', () => {
  const { relogio, falas, aviso } = bancada();
  relogio.avancar(1_800); // a latência de um turno bom, medida em 18/08
  aviso.cancelar();
  relogio.avancar(60_000);
  assert.equal(aviso.disparou(), false);
  assert.deepEqual(falas, []);
});

test('P3. fala que já começou a streamar cala o aviso, mesmo sem cancelamento', () => {
  /* O turno pode legitimamente levar um minuto respondendo. Se o texto já está
     aparecendo, a pessoa não está olhando para o nada — e avisar ali seria a
     IARA interromper a própria resposta para dizer que está respondendo. */
  const { barramento, relogio, falas, aviso } = bancada();
  relogio.avancar(5_000);
  barramento.publicar({
    tipo: 'RESPOSTA_TRECHO',
    id_mensagem: 'm1',
    texto: 'Vou verificar as centrais',
    responde_a: 'op:x1',
  });
  relogio.avancar(60_000);
  assert.equal(aviso.disparou(), false);
  assert.deepEqual(falas, ['Vou verificar as centrais'], 'só o trecho real, sem aviso por cima');
});

test('P4. fala inteira de uma vez também cala o aviso', () => {
  const { barramento, relogio, aviso } = bancada();
  barramento.publicar({
    tipo: 'TAREFA_CONCLUIDA',
    id_mensagem: 'm1',
    texto: 'São 15:31.',
    rota: 'plano_local',
    ms: 400,
    responde_a: 'op:x1',
  });
  relogio.avancar(60_000);
  assert.equal(aviso.disparou(), false);
});

test('P5. cancelar é idempotente e desarma o agendamento', () => {
  const { relogio, aviso } = bancada();
  assert.equal(relogio.agendados, 1);
  aviso.cancelar();
  aviso.cancelar();
  assert.equal(relogio.agendados, 0);
  relogio.avancar(60_000);
  assert.equal(aviso.disparou(), false);
});

test('P6. o aviso sai como TRECHO, nunca como conclusão do turno', () => {
  /* Publicar `TAREFA_CONCLUIDA` faria o cliente e a campanha tratarem o aviso
     como A RESPOSTA — o turno seguiria vivo e ninguém saberia. */
  const barramento = new BarramentoEventos('teste');
  const relogio = relogioFalso();
  const tipos: string[] = [];
  barramento.assinarTudo((e) => tipos.push(e.tipo));
  armarAvisoDeEspera({
    barramento,
    idDaPergunta: 'op:x1',
    tentativasDeProvedor: () => 1,
    prazoMs: 1_000,
    agora: relogio.agora,
    agendar: relogio.agendar,
    desagendar: relogio.desagendar,
  });
  relogio.avancar(1_001);
  assert.deepEqual(tipos, ['RESPOSTA_TRECHO']);
  assert.equal(tipos.includes('TAREFA_CONCLUIDA'), false);
});

test('P7. o aviso responde à pergunta certa — não vira balão órfão', () => {
  const barramento = new BarramentoEventos('teste');
  const relogio = relogioFalso();
  let respondeA: string | null = 'nunca preenchido';
  barramento.assinarTudo((e) => {
    if (e.tipo === 'RESPOSTA_TRECHO') respondeA = e.responde_a;
  });
  armarAvisoDeEspera({
    barramento,
    idDaPergunta: 'op:pergunta7',
    tentativasDeProvedor: () => 1,
    prazoMs: 10,
    agora: relogio.agora,
    agendar: relogio.agendar,
    desagendar: relogio.desagendar,
  });
  relogio.avancar(11);
  assert.equal(respondeA, 'op:pergunta7');
});

test('P8. a frase não promete nada e não afirma efeito', () => {
  /* `auditarPromessa` da campanha trata promessa não cumprida no turno como
     incidente, e com razão. E uma frase de espera que sugerisse conclusão seria
     mentira operacional de tipo novo, criada pelo próprio conserto. */
  const t = textoDeEspera(23_000, 3);
  assert.doesNotMatch(t, /aviso assim que|volto já|em instantes|logo mais|pronto|concluí|feito/i);
  assert.match(t, /23 segundos/);
  assert.match(t, /3ª tentativa/, 'o número de tentativas é um fato medido, não enfeite');
});

test('P9. com uma tentativa só, a frase não inventa cauda técnica', () => {
  const t = textoDeEspera(20_000, 1);
  assert.doesNotMatch(t, /tentativa/);
  assert.match(t, /20 segundos/);
});

test('P11. o recado de espera NUNCA vira a resposta quando o turno morre', () => {
  /**
   * O DEFEITO QUE O PRÓPRIO CONSERTO CRIOU, medido em 18/08/2026 na bancada de
   * prazo de fala: o turno 5 expirou, o turno 6 chegou, o kernel cancelou o
   * anterior — e `CompiladorSnapshot` promoveu a fala pendente a concluída,
   * como faz com toda resposta parcial. Só que a fala pendente era
   * "Ainda estou nisto: 2 segundos até agora.", e o operador leu aquilo como a
   * resposta do que tinha perguntado.
   *
   * A frase é verdade enquanto o turno corre e vira mentira no instante em que
   * ele morre. Trocar silêncio por isso não seria conserto.
   */
  const { barramento, compilador, estado } = bancadaDoCompilador();
  barramento.publicar({
    tipo: 'RESPOSTA_TRECHO',
    id_mensagem: 'espera:op:x1',
    texto: 'Ainda estou nisto: 20 segundos até agora.',
    responde_a: 'op:x1',
    provisoria: true,
  });
  barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'preempção' });

  const fala = compilador.compilar(estado.instantaneo(), 'sessao', 0).fala;
  assert.equal(fala?.concluida, true, 'a bolha precisa fechar, senão o cliente espera para sempre');
  assert.doesNotMatch(fala?.texto ?? '', /ainda estou nisto/i);
  assert.match(fala?.texto ?? '', /não consegui concluir/i);
});

test('P12. resposta parcial DE VERDADE continua preservada ao ser cancelada', () => {
  /* A regra antiga não pode ter sido quebrada pelo conserto: apagar o que já foi
     dito faria o texto sumir da tela e o operador achar que a IARA nunca falou. */
  const { barramento, compilador, estado } = bancadaDoCompilador();
  barramento.publicar({
    tipo: 'RESPOSTA_TRECHO',
    id_mensagem: 'm1',
    texto: 'As centrais ativas são',
    responde_a: 'op:x1',
  });
  barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'preempção' });

  const fala = compilador.compilar(estado.instantaneo(), 'sessao', 0).fala;
  assert.equal(fala?.concluida, true);
  assert.equal(fala?.texto, 'As centrais ativas são');
});

test('P13. trecho real depois do recado limpa a marca — a resposta é preservada', () => {
  /* Sequência normal do turno lento que TERMINA: recado, depois a resposta
     streamando por cima. Se a marca não fosse limpa, um cancelamento tardio
     apagaria uma resposta legítima. */
  const { barramento, compilador, estado } = bancadaDoCompilador();
  barramento.publicar({
    tipo: 'RESPOSTA_TRECHO',
    id_mensagem: 'espera:op:x1',
    texto: 'Ainda estou nisto: 20 segundos até agora.',
    responde_a: 'op:x1',
    provisoria: true,
  });
  barramento.publicar({
    tipo: 'RESPOSTA_TRECHO',
    id_mensagem: 'm1',
    texto: 'Onze centrais ativas',
    responde_a: 'op:x1',
  });
  barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'preempção' });

  assert.equal(compilador.compilar(estado.instantaneo(), 'sessao', 0).fala?.texto, 'Onze centrais ativas');
});

test('P14. o aviso REAL, do começo ao fim, não vira resposta quando o turno morre', () => {
  /**
   * O TESTE QUE FALTAVA, e a falta apareceu num teste de mutação: removida a
   * linha `provisoria: true` de `PrazoDeFala`, os treze testes anteriores
   * continuaram verdes. Todos publicavam o evento À MÃO com a marca — mediam o
   * compilador e nada diziam sobre o aviso de verdade.
   *
   * Aqui não há evento escrito à mão: o aviso é ARMADO, o relógio avança, e o
   * que se confere é o que sobrou na tela. É o único formato em que a marca
   * ausente derruba alguma coisa.
   */
  const { barramento, compilador, estado } = bancadaDoCompilador();
  const relogio = relogioFalso();
  armarAvisoDeEspera({
    barramento,
    idDaPergunta: 'op:x1',
    tentativasDeProvedor: () => 1,
    prazoMs: 20_000,
    agora: relogio.agora,
    agendar: relogio.agendar,
    desagendar: relogio.desagendar,
  });
  relogio.avancar(20_001);
  barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo: 'preempção' });

  const fala = compilador.compilar(estado.instantaneo(), 'sessao', 0).fala;
  assert.equal(fala?.concluida, true);
  assert.doesNotMatch(
    fala?.texto ?? '',
    /ainda estou nisto/i,
    'o recado de andamento foi apresentado como a resposta do turno',
  );
});

test('P10. o padrão cai no vazio entre turno bom e turno patológico', () => {
  /* Medido em 18/08/2026: bons em 1,8s/2,6s/3,1s/6,3s; ruins em 62s/74s/90s.
     Um padrão dentro da nuvem dos bons faria a IARA avisar que está devagar
     quando não está. */
  assert.ok(PRAZO_FALA_PADRAO_MS > 6_300, 'dispararia em turno saudável');
  assert.ok(PRAZO_FALA_PADRAO_MS < 62_000, 'não pegaria o turno patológico');
});
