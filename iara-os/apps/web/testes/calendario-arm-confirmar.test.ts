/**
 * `criar_evento_calendario` — o desenho R2 (arma pendência, exige "confirmo")
 * exercitado pelo Kernel REAL, mesmo padrão de `cerebro-escrita-integridade.test.ts`.
 *
 * O que esta suíte prova, e que os testes unitários do cliente HTTP
 * (`calendario-google.test.ts`) não alcançam: o DESPACHO em
 * `resolver_confirmacao` — o `if (tipo === 'calendario')` novo em
 * `habilidades/agenteLocal.ts` — realmente chama `AgenteLocal` e realmente
 * consome a pendência certa, através do catálogo real, do porteiro real e do
 * jornal real. Um mock no nível do `ClienteGoogleCalendarioEscrita` nunca
 * prova isso — só prova que o cliente HTTP está correto.
 *
 * O provedor (Google) é substituído injetando um `criadorEventoCalendario`
 * FALSO no singleton `agenteLocal` — a mesma técnica de `AgenteLocal.paraTeste`
 * (cast através de `readonly`, aceito porque é só o TIPO que promete
 * imutabilidade; o campo em si não é congelado em runtime). Restaurado no
 * `finally` de cada teste, porque `agenteLocal` é módulo-singleton
 * compartilhado com o resto da suíte.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Kernel } from '../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../servidor/nucleo/MemoriaOperacional';
import type { MotorRaciocinio } from '../servidor/nucleo/kernel/MotorRaciocinio';
import { RegistroOperacoes } from '../servidor/nucleo/kernel/RegistroOperacoes';
import { agenteLocal, type CriadorEventoCalendario } from '../servidor/nucleo/AgenteLocal';
import { criarEventoCalendario as criarEventoCalendarioHabilidade } from '../servidor/nucleo/kernel/habilidades/calendario';
import type { ContextoHabilidade } from '../servidor/nucleo/kernel/Habilidade';

const TIME = ['Marina Alves', 'João Silva'];

function memoriaFalsa(): MemoriaOperacional {
  return {
    async registrar() {},
    async historico() {
      return [];
    },
    async carregarGlobal() {
      return '';
    },
    async lerPreferencias() {
      return {} as never;
    },
  } as unknown as MemoriaOperacional;
}

function jornal(): { registro: RegistroOperacoes; raiz: string } {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-calendario-'));
  return { registro: new RegistroOperacoes(raiz), raiz };
}

const VARS_GOOGLE = ['GOOGLE_CALENDAR_CLIENT_EMAIL', 'GOOGLE_CALENDAR_PRIVATE_KEY', 'GOOGLE_CALENDAR_ID'] as const;

/**
 * `criar_evento_calendario.indisponivelPorque()` checa só PRESENÇA das três
 * variáveis (`googleCalendarDisponivel()`) — não abre rede nem valida a
 * chave. Como estes testes injetam `criadorEventoCalendario` e nunca chegam
 * a `ClienteGoogleCalendarioEscrita` de verdade, valores fictícios bastam.
 */
function comAmbienteCalendario(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const antes = Object.fromEntries(VARS_GOOGLE.map((v) => [v, process.env[v]]));
    process.env.GOOGLE_CALENDAR_CLIENT_EMAIL = 'iara-teste@projeto-teste.iam.gserviceaccount.com';
    process.env.GOOGLE_CALENDAR_PRIVATE_KEY = 'chave-de-teste';
    process.env.GOOGLE_CALENDAR_ID = 'operadora@gmail.com';
    try {
      await fn();
    } finally {
      for (const v of VARS_GOOGLE) {
        if (antes[v] === undefined) delete process.env[v];
        else process.env[v] = antes[v];
      }
    }
  };
}

/** Troca o provedor real do singleton por um dublê, e devolve como desfazer. */
function comProvedorFalso(criador: CriadorEventoCalendario): () => void {
  const alvo = agenteLocal as unknown as { criadorEventoCalendario: CriadorEventoCalendario };
  const original = alvo.criadorEventoCalendario;
  alvo.criadorEventoCalendario = criador;
  return () => {
    alvo.criadorEventoCalendario = original;
  };
}

/**
 * `Kernel.processar()` devolve `Promise<void>` — a fala da IARA sai pelo
 * barramento de eventos (`TAREFA_CONCLUIDA`), não pelo retorno da chamada.
 * Mesmo padrão de `kernelDeEscrita` em `cerebro-escrita-integridade.test.ts`.
 */
function kernelParaCalendario(o: {
  usuario: string;
  sessao: string;
  registro: RegistroOperacoes;
  parametros: Record<string, unknown>;
}): { kernel: Kernel; falas: string[] } {
  const barramento = new BarramentoEventos(o.sessao);
  const falas: string[] = [];
  const kernel = new Kernel({
    sessao: o.sessao,
    idUsuario: o.usuario,
    outrosOperadores: TIME,
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    registroOperacoes: o.registro,
    // `criar_evento_calendario` pede `externo`, concedida só a `administrador`
    // — mesma regra de `enviar_whatsapp` (ver Seguranca.ts). Sem isto o
    // sandbox recusa antes mesmo de chegar ao passo.
    papel: 'administrador',
    raciocinio: {
      disponivel: true,
      modelo: 'teste',
      async planejar() {
        /**
         * `deterministico`, de propósito — mesma isolação de `kernelDeEscrita`
         * em `cerebro-escrita-integridade.test.ts`. `criar_evento_calendario`
         * é risco alto e NÃO tem âncora determinística em `Planejador.ts`
         * (achado ao escrever este teste: um plano `origem: 'emergente'` é
         * rejeitado pelo `PorteiroAutorizacao` antes de armar — mesmo
         * comportamento de `enviar_whatsapp`, que tem a mesma lacuna e é
         * classificado como "só emergente" na auditoria de 14/08/2026). Essa
         * regra tem suíte própria (`PorteiroAutorizacao` é testado à parte,
         * genérico para qualquer habilidade de risco alto) e o caminho real
         * para chegar aqui de conversa é propor um plano e o operador
         * autorizá-lo (`assumir_plano`/`executar_plano`, que RE-emite os
         * passos com origem determinística) — não uma frase solta. O que
         * esta suíte testa é o que acontece DEPOIS de armar: o despacho novo
         * em `resolver_confirmacao`.
         */
        return {
          objetivo: 'marcar evento no calendário',
          origem: 'deterministico' as const,
          passos: [
            {
              indice: 0,
              descricao: 'criar evento de calendário',
              habilidade: 'criar_evento_calendario',
              parametros: o.parametros,
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

  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') falas.push(e.texto);
  });

  return { kernel, falas };
}

const PARAMETROS_PADRAO = {
  assunto: 'Reunião com o financeiro',
  quando: 'amanhã às 14h',
  duracao_minutos: 60,
  local: 'Sala 2',
};

test('arma pendência, e "confirmo" cria de verdade — o dispatch novo em resolver_confirmacao funciona', comAmbienteCalendario(async () => {
  const { registro } = jornal();
  const chamadas: Array<[string, string, string, string]> = [];
  const desfazer = comProvedorFalso(async (assunto, inicio, fim, local) => {
    chamadas.push([assunto, inicio, fim, local]);
    return { ok: true, texto: `Evento criado: "${assunto}" — https://calendar.google.com/evt` };
  });

  try {
    const { kernel, falas } = kernelParaCalendario({
      usuario: 'daiane',
      sessao: 's-cal-1',
      registro,
      parametros: PARAMETROS_PADRAO,
    });

    await kernel.processar('marca uma reunião com o financeiro amanhã às 14h');
    assert.match(falas.at(-1)!, /Reunião com o financeiro/);
    assert.match(falas.at(-1)!, /confirmo/i);
    assert.equal(chamadas.length, 0, 'não deveria ter criado nada só de pedir');
    assert.ok(agenteLocal.temPendencia('daiane', 's-cal-1'), 'pré-condição: pendência armada');

    await kernel.processar('confirmo');
    assert.equal(chamadas.length, 1, 'o provedor deveria ter sido chamado exatamente uma vez');
    assert.equal(chamadas[0][0], 'Reunião com o financeiro');
    assert.ok(chamadas[0][3] === 'Sala 2');
    assert.match(falas.at(-1)!, /Evento criado/);

    const op = registro.todas().find((o) => o.habilidade === 'criar_evento_calendario');
    assert.ok(op, 'a operação deveria estar no jornal');
    /**
     * `aceita_pelo_provedor` é o estado que `resolver_confirmacao.executar`
     * grava; `resolverConfirmacao.verificar` roda em seguida e, como o
     * provedor respondeu SÍNCRONO com sucesso, promove para `verificada` —
     * mesma disciplina de `enviar_whatsapp`. Chegar em `verificada` é o
     * resultado CORRETO, não um estado intermediário perdido.
     */
    assert.equal(op!.estado, 'verificada');
  } finally {
    desfazer();
    agenteLocal.cancelar('daiane', 's-cal-1');
  }
}));

test('provedor recusa → a recusa chega ao operador, nada finge sucesso', comAmbienteCalendario(async () => {
  const { registro } = jornal();
  const desfazer = comProvedorFalso(async () => ({
    ok: false,
    texto: 'Sem permissão para criar evento neste calendário.',
  }));

  try {
    const { kernel, falas } = kernelParaCalendario({
      usuario: 'daiane',
      sessao: 's-cal-2',
      registro,
      parametros: PARAMETROS_PADRAO,
    });

    await kernel.processar('marca uma reunião amanhã às 14h');
    await kernel.processar('confirmo');

    assert.match(falas.at(-1)!, /[Ss]em permissão/);
    const op = registro.todas().find((o) => o.habilidade === 'criar_evento_calendario');
    /**
     * `executar()` grava `falhou` primeiro (ver `historico`), mas o Google
     * respondeu de verdade dentro da mesma chamada — a recusa É um fato
     * conhecido, não uma dúvida. `resolverConfirmacao.verificar` promove os
     * dois desfechos (sucesso OU falha) a `verificada`, porque o que se
     * verifica é "sei o que aconteceu", não "deu certo" (mesmo comentário do
     * código-fonte para `enviar_whatsapp`). O sinal de que FALHOU está na
     * fala e no histórico, não no estado terminal.
     */
    assert.equal(op!.estado, 'verificada');
  } finally {
    desfazer();
    agenteLocal.cancelar('daiane', 's-cal-2');
  }
}));

test('pedir o mesmo evento duas vezes converge numa pendência só — não duplica no jornal', comAmbienteCalendario(async () => {
  const { registro } = jornal();
  const chamadas: string[] = [];
  const desfazer = comProvedorFalso(async (assunto) => {
    chamadas.push(assunto);
    return { ok: true, texto: 'Evento criado.' };
  });

  try {
    const { kernel } = kernelParaCalendario({
      usuario: 'daiane',
      sessao: 's-cal-3',
      registro,
      parametros: PARAMETROS_PADRAO,
    });

    await kernel.processar('marca uma reunião amanhã às 14h');
    await kernel.processar('marca uma reunião amanhã às 14h');

    /**
     * DUAS camadas de operação nascem de UM pedido bem-sucedido, e é esperado:
     * (1) a operação que o `Kernel` abre para o PASSO `criar_evento_calendario`
     * em si (fecha `verificada` assim que a pendência é armada — é o que
     * `criarEventoCalendario.verificar()` promete); (2) a pendência interna
     * que `ctx.registro.armar()` cria dentro de `executar()`, no MESMO desenho
     * de `enviar_whatsapp` — essa é a que "confirmo" de fato resolve. O
     * segundo pedido idêntico é barrado pela PRIMEIRA camada antes de chegar a
     * `executar()` de novo (log: "operacao_barrada:criar_evento_calendario") —
     * mais forte que deduplicar só dentro da habilidade.
     */
    const pendentes = registro.todas().filter((o) => o.estado === 'aguardando_autorizacao');
    assert.equal(pendentes.length, 1, 'duas pedidas do mesmo evento deixaram mais de uma pendência viva');

    await kernel.processar('confirmo');
    assert.equal(chamadas.length, 1, 'o segundo pedido idêntico deveria ter sido deduplicado');
  } finally {
    desfazer();
    agenteLocal.cancelar('daiane', 's-cal-3');
  }
}));

test('"cancela" descarta a pendência sem chamar o provedor', comAmbienteCalendario(async () => {
  const { registro } = jornal();
  let chamado = false;
  const desfazer = comProvedorFalso(async () => {
    chamado = true;
    return { ok: true, texto: 'não deveria ter sido chamado' };
  });

  try {
    const { kernel } = kernelParaCalendario({
      usuario: 'daiane',
      sessao: 's-cal-4',
      registro,
      parametros: PARAMETROS_PADRAO,
    });

    await kernel.processar('marca uma reunião amanhã às 14h');
    await kernel.processar('não confirmo, cancela');

    assert.equal(chamado, false, 'cancelar não deveria chamar o Google');
    assert.equal(agenteLocal.temPendencia('daiane', 's-cal-4'), false);
    // A pendência INTERNA (com `inicio`/`fim` já resolvidos) é a que
    // "confirmo"/"cancela" resolve — distinta da operação-passo do Kernel
    // (ver o comentário no teste de dedup, acima).
    const op = registro.todas().find((o) => o.habilidade === 'criar_evento_calendario' && 'inicio' in o.parametros);
    assert.equal(op!.estado, 'cancelada');
  } finally {
    desfazer();
    agenteLocal.cancelar('daiane', 's-cal-4');
  }
}));

// ===========================================================================
// A camada de esquema — direto na habilidade, sem precisar do Kernel inteiro
// ===========================================================================

function ctxDireto(o: {
  registro: RegistroOperacoes;
  usuario: string;
  sessao: string;
  parametros: Record<string, unknown>;
}): ContextoHabilidade {
  return {
    sessao: o.sessao,
    id_usuario: o.usuario,
    parametros: o.parametros,
    sinal: new AbortController().signal,
    enunciado: 'teste direto',
    registro: o.registro,
    operacao: null,
  };
}

test('assunto vazio não arma nada e não bate na rede', async () => {
  const { registro } = jornal();
  let bateuNaRede = false;
  const desfazer = comProvedorFalso(async () => {
    bateuNaRede = true;
    return { ok: true, texto: 'não deveria ter sido chamado' };
  });
  try {
    const r = await criarEventoCalendarioHabilidade.executar(
      ctxDireto({ registro, usuario: 'daiane', sessao: 's-cal-5', parametros: { assunto: '', quando: 'amanhã às 14h' } }),
    );
    assert.equal(r.resolveu, false);
    assert.equal(bateuNaRede, false);
    assert.equal(agenteLocal.temPendencia('daiane', 's-cal-5'), false);
  } finally {
    desfazer();
  }
});

test('"quando" que o motor não entende não arma nada e pede esclarecimento', async () => {
  const { registro } = jornal();
  const r = await criarEventoCalendarioHabilidade.executar(
    ctxDireto({
      registro,
      usuario: 'daiane',
      sessao: 's-cal-6',
      parametros: { assunto: 'Reunião', quando: 'lorem ipsum sem hora nenhuma' },
    }),
  );
  assert.equal(r.resolveu, false);
  assert.match(r.texto, /Não consegui entender/);
  assert.equal(agenteLocal.temPendencia('daiane', 's-cal-6'), false);
});

test('duração fora da faixa é ajustada ao piso/teto, não recusada nem ilimitada', async () => {
  const { registro } = jornal();
  const desfazer = comProvedorFalso(async () => ({ ok: true, texto: 'ok' }));
  try {
    const r = await criarEventoCalendarioHabilidade.executar(
      ctxDireto({
        registro,
        usuario: 'daiane',
        sessao: 's-cal-7',
        parametros: { assunto: 'Reunião', quando: 'amanhã às 14h', duracao_minutos: -50 },
      }),
    );
    assert.equal(r.resolveu, true, 'duração inválida deveria cair no piso, não recusar o evento inteiro');
    const op = registro.pendenteDe('daiane', 's-cal-7');
    assert.ok(op);
    const inicio = new Date((op!.parametros as { inicio: string }).inicio);
    const fim = new Date((op!.parametros as { fim: string }).fim);
    const minutos = (fim.getTime() - inicio.getTime()) / 60_000;
    assert.equal(minutos, 5, 'piso de duração deveria ser 5 minutos');
  } finally {
    desfazer();
    agenteLocal.cancelar('daiane', 's-cal-7');
  }
});
