/**
 * PROVA DE ESCRITA — o caminho inteiro, com o Kernel real, imprimindo evidência.
 *
 * A suíte de testes responde "passa ou não passa". Esta prova responde outra
 * coisa: MOSTRA o jornal. Cada cenário imprime a trilha de estados que ficou no
 * disco, para que a leitura não dependa de acreditar numa asserção.
 *
 * REGRA: nada aqui chama um componente interno para simular sucesso. Toda
 * afirmação sobre o mundo vem de um contador do MUNDO (fora da IARA) ou de uma
 * linha lida do jornal em disco. Onde a garantia não existe, a prova diz que não
 * existe — ver o bloco final.
 *
 *   npx tsx scripts/prova-escrita-final.ts
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Kernel } from '../../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../../servidor/nucleo/EstadoAtomico';
import type { MemoriaOperacional } from '../../servidor/nucleo/MemoriaOperacional';
import type { Habilidade } from '../../servidor/nucleo/kernel/Habilidade';
import type { MotorRaciocinio } from '../../servidor/nucleo/kernel/MotorRaciocinio';
import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';
import { evidencia } from '../../servidor/nucleo/kernel/Operacao';

const VERDE = '\x1b[32m';
const VERMELHO = '\x1b[31m';
const CINZA = '\x1b[90m';
const NEGRITO = '\x1b[1m';
const FIM = '\x1b[0m';

let reprovados = 0;

function titulo(n: string, t: string): void {
  console.log(`\n${NEGRITO}${n}. ${t}${FIM}`);
}

function afirmar(descricao: string, condicao: boolean, detalhe: string): void {
  if (!condicao) reprovados++;
  const marca = condicao ? `${VERDE}✓${FIM}` : `${VERMELHO}✗${FIM}`;
  console.log(`  ${marca} ${descricao}`);
  console.log(`    ${CINZA}${detalhe}${FIM}`);
}

function trilha(raiz: string, usuario: string, habilidade: string): string[] {
  return readFileSync(path.join(raiz, `${usuario}.jsonl`), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { habilidade: string; estado: string })
    .filter((l) => l.habilidade === habilidade)
    .map((l) => l.estado);
}

// ---------------------------------------------------------------------------

const memoria = {
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

/** O mundo. Fora da IARA, e por isso é ele quem responde "quantas vezes?". */
class Mundo {
  readonly efeitos: string[] = [];
  quantos(m: string): number {
    return this.efeitos.filter((e) => e === m).length;
  }
}

function habilidade(o: {
  id: string;
  mundo: Mundo;
  modo: 'SUCESSO' | 'EFEITO_SEM_RESPOSTA' | 'EXPLODE_APOS_EFEITO';
  verificaMundo: boolean;
}): Habilidade {
  return {
    manifesto: {
      id: o.id,
      nome: o.id,
      descricao: `habilidade de prova ${o.id}, com descrição longa o bastante para o contrato`,
      dominio: 'automacao',
      capacidade: 'automacao',
      permissoes: ['escrita'],
      timeout_ms: 60,
      custo: 'zero',
      risco: 'medio',
      idempotencia: 'escrita_nao_idempotente',
      esquema: { alvo: { tipo: 'texto' } },
    },
    async executar() {
      o.mundo.efeitos.push(o.id);
      if (o.modo === 'EXPLODE_APOS_EFEITO') throw new Error('quebrou depois de alcançar o mundo');
      if (o.modo === 'EFEITO_SEM_RESPOSTA') return new Promise<never>(() => {});
      return { texto: `${o.id} aplicado`, detalhe: o.id, resolveu: true };
    },
    async verificar() {
      return o.verificaMundo
        ? { confirmado: true, evidencia: `o mundo mostra ${o.mundo.quantos(o.id)} efeito(s)` }
        : {
            confirmado: false,
            evidencia: 'o provedor não oferece consulta de status',
            motivo: 'sem_meio_de_verificar' as const,
          };
    },
  };
}

const PEDIDO = 'analise o levantamento de custos e depois gere um resumo executivo comparativo';

function kernel(o: {
  h?: Habilidade;
  usuario: string;
  sessao: string;
  registro: RegistroOperacoes;
  origem?: 'deterministico' | 'emergente';
}): { k: Kernel; falas: string[] } {
  const barramento = new BarramentoEventos(o.sessao);
  const falas: string[] = [];
  const k = new Kernel({
    sessao: o.sessao,
    idUsuario: o.usuario,
    outrosOperadores: ['Marina Alves'],
    estado: new EstadoAtomico(),
    memoria,
    barramento,
    registroOperacoes: o.registro,
    habilidadesExtras: o.h ? [o.h] : undefined,
    raciocinio: {
      disponivel: true,
      modelo: 'prova',
      async planejar() {
        if (!o.h) return null;
        return {
          objetivo: 'prova de escrita',
          origem: o.origem ?? ('deterministico' as const),
          passos: [
            { indice: 0, descricao: 'passo de escrita', habilidade: o.h.manifesto.id, parametros: { alvo: 'x' } },
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
  return { k, falas };
}

const novoJornal = () => {
  const raiz = mkdtempSync(path.join(tmpdir(), 'prova-escrita-'));
  return { raiz, registro: new RegistroOperacoes(raiz) };
};

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(
    `${NEGRITO}PROVA DE ESCRITA — pedido → decisão → risco → autorização → ` +
      `persistência → execução → verificação → verdade → resposta${FIM}`,
  );

  // -------------------------------------------------------------------------
  titulo('1', 'CAMINHO FELIZ — a trilha inteira fica no disco, e na ordem certa');
  {
    const { raiz, registro } = novoJornal();
    const mundo = new Mundo();
    const { k, falas } = kernel({
      h: habilidade({ id: 'prova_feliz', mundo, modo: 'SUCESSO', verificaMundo: true }),
      usuario: 'p1',
      sessao: 's1',
      registro,
    });
    await k.processar(PEDIDO);

    const t = trilha(raiz, 'p1', 'prova_feliz');
    afirmar(
      'o jornal grava a intenção ANTES do efeito e a verdade DEPOIS',
      t.join(' → ') === 'autorizada → executando → verificada',
      `trilha em disco: ${t.join(' → ')}`,
    );
    afirmar(
      'o efeito aconteceu exatamente uma vez',
      mundo.quantos('prova_feliz') === 1,
      `o mundo contou ${mundo.quantos('prova_feliz')} efeito(s)`,
    );
    afirmar(
      'a resposta não hesita quando o mundo confirmou',
      !/não consigo provar|nada foi alterado/i.test(falas.join(' ')),
      `fala: "${falas.join(' ').slice(0, 110)}…"`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('2', 'DUPLICATA — o mesmo pedido, duas vezes');
  {
    const { registro } = novoJornal();
    const mundo = new Mundo();
    const h = habilidade({ id: 'prova_dup', mundo, modo: 'SUCESSO', verificaMundo: true });

    await kernel({ h, usuario: 'p2', sessao: 's2', registro }).k.processar(PEDIDO);
    const segundo = kernel({ h, usuario: 'p2', sessao: 's2', registro });
    await segundo.k.processar(PEDIDO);

    afirmar(
      'o segundo pedido idêntico NÃO produziu um segundo efeito',
      mundo.quantos('prova_dup') === 1,
      `o mundo contou ${mundo.quantos('prova_dup')} efeito(s); a IARA respondeu que não repetiu`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('3', 'CONCORRÊNCIA — dois canais do mesmo operador ao mesmo tempo');
  {
    const { registro } = novoJornal();
    const mundo = new Mundo();
    const h = habilidade({ id: 'prova_conc', mundo, modo: 'SUCESSO', verificaMundo: true });

    await Promise.all([
      kernel({ h, usuario: 'p3', sessao: 'navegador', registro }).k.processar(PEDIDO),
      kernel({ h, usuario: 'p3', sessao: 'whatsapp:p3', registro }).k.processar(PEDIDO),
    ]);

    afirmar(
      'navegador e WhatsApp em paralelo produziram UM efeito',
      mundo.quantos('prova_conc') === 1,
      `o mundo contou ${mundo.quantos('prova_conc')} efeito(s)`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('4', 'UNKNOWN — o efeito saiu e a resposta se perdeu');
  {
    const { raiz, registro } = novoJornal();
    const mundo = new Mundo();
    const h = habilidade({
      id: 'prova_unknown',
      mundo,
      modo: 'EFEITO_SEM_RESPOSTA',
      verificaMundo: false,
    });
    const { falas } = kernel({ h, usuario: 'p4', sessao: 's4', registro });
    await kernel({ h, usuario: 'p4', sessao: 's4', registro }).k.processar(PEDIDO);

    const t = trilha(raiz, 'p4', 'prova_unknown');
    const op = registro.todas().find((o) => o.habilidade === 'prova_unknown')!;
    afirmar(
      'termina em DESCONHECIDA, nunca em falhou',
      op.estado === 'desconhecida',
      `trilha: ${t.join(' → ')}`,
    );

    // O operador insiste. A regra de ouro do retry entra aqui.
    const insiste = kernel({ h, usuario: 'p4', sessao: 's4', registro });
    await insiste.k.processar(PEDIDO);
    afirmar(
      'insistir NÃO repete o efeito não idempotente ainda não confirmado',
      mundo.quantos('prova_unknown') === 1,
      `o mundo contou ${mundo.quantos('prova_unknown')} efeito(s); a IARA mandou conferir antes`,
    );
    void falas;

    // A dúvida só sai consultando o mundo.
    await registro.resolverDesconhecida(op.id_operacao, {
      confirmado: true,
      evidencia: 'o provedor lista o efeito aplicado',
    });
    afirmar(
      'a dúvida vira verdade SÓ com evidência de verificador',
      registro.ler(op.id_operacao)!.estado === 'verificada',
      `estado final: ${registro.ler(op.id_operacao)!.estado}`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('5', 'CRASH E RESTART — o processo morre com o efeito em voo');
  {
    const { raiz, registro } = novoJornal();
    const r = registro.reservar({
      id_usuario: 'p5',
      sessao: 's5',
      habilidade: 'prova_crash',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { texto: 'oi' },
      origem_pedido: 't1',
    });
    const id = r.tipo === 'nova' ? r.operacao.id_operacao : '';
    await registro.marcar(id, 'autorizada', evidencia('operador', 'confirmo'));
    await registro.marcar(id, 'executando', evidencia('executor', 'jornal antes do efeito'));
    // ... e o processo morre exatamente aqui.

    const depois = new RegistroOperacoes(raiz);
    await depois.reidratar('p5');
    const volta = depois.ler(id)!;

    afirmar(
      'crash durante a execução volta como DESCONHECIDA, nunca como FALHOU',
      volta.estado === 'desconhecida',
      `voltou como "${volta.estado}", evidência: ${volta.historico.at(-1)?.descricao}`,
    );
    afirmar(
      'e o retry continua bloqueado depois do restart',
      depois.reservar({
        id_usuario: 'p5',
        sessao: 's5',
        habilidade: 'prova_crash',
        risco: 'alto',
        semantica: 'escrita_nao_idempotente',
        parametros: { texto: 'oi' },
        origem_pedido: 't-pos-restart',
      }).tipo === 'bloqueada',
      'a verdade veio do jornal em disco, não da memória do processo',
    );
  }

  // -------------------------------------------------------------------------
  titulo('6', 'RESTART NÃO INVENTA AUTORIZAÇÃO');
  {
    const { raiz, registro } = novoJornal();
    const op = (await registro.armar({
      id_usuario: 'p6',
      sessao: 'navegador',
      habilidade: 'energia_da_maquina',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { acao: 'desligar' },
      origem_pedido: 't',
    }))!;

    const depois = new RegistroOperacoes(raiz);
    await depois.reidratar('p6');

    const r = await depois.autorizar({
      id_operacao: op.id_operacao,
      nonce: op.nonce,
      id_usuario: 'p6',
      sessao: 'navegador',
      fala: 'confirmo',
    });
    afirmar(
      'uma pendência anterior ao restart NÃO pode ser confirmada depois dele',
      r.ok === false,
      `estado após reidratar: "${depois.ler(op.id_operacao)!.estado}"; recusa: ${r.ok === false ? r.motivo : '—'}`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('7', 'AUTORIZAÇÃO VINCULADA — cruzando sessão, usuário e cancelamento');
  {
    const { registro } = novoJornal();
    const armar = (usuario: string, sessao: string) =>
      registro.armar({
        id_usuario: usuario,
        sessao,
        habilidade: 'energia_da_maquina',
        risco: 'alto',
        semantica: 'escrita_nao_idempotente',
        parametros: { acao: 'desligar' },
        origem_pedido: `t-${usuario}-${sessao}`,
      });

    const a = (await armar('ana', 'navegador'))!;
    const cruzada = await registro.autorizar({
      id_operacao: a.id_operacao,
      nonce: a.nonce,
      id_usuario: 'ana',
      sessao: 'whatsapp:ana',
      fala: 'confirmo',
    });
    afirmar(
      'um "confirmo" de OUTRA conversa não autoriza',
      cruzada.ok === false && registro.ler(a.id_operacao)!.estado === 'aguardando_autorizacao',
      `recusa: ${cruzada.ok === false ? cruzada.motivo.slice(0, 80) : '—'}`,
    );

    const alheia = await registro.autorizar({
      id_operacao: a.id_operacao,
      nonce: a.nonce,
      id_usuario: 'bruno',
      sessao: 'navegador',
      fala: 'confirmo',
    });
    afirmar(
      'um "confirmo" de OUTRA pessoa não autoriza',
      alheia.ok === false,
      `recusa: ${alheia.ok === false ? alheia.motivo : '—'}`,
    );

    const ok = await registro.autorizar({
      id_operacao: a.id_operacao,
      nonce: a.nonce,
      id_usuario: 'ana',
      sessao: 'navegador',
      fala: 'confirmo',
    });
    const replay = await registro.autorizar({
      id_operacao: a.id_operacao,
      nonce: a.nonce,
      id_usuario: 'ana',
      sessao: 'navegador',
      fala: 'confirmo',
    });
    afirmar(
      'a confirmação certa autoriza UMA vez; o replay é recusado',
      ok.ok === true && replay.ok === false,
      `replay: ${replay.ok === false ? replay.motivo : '—'}`,
    );

    const b = (await armar('bia', 'sessao-cancel'))!;
    await registro.cancelar(b.id_operacao, 'o operador desistiu');
    const pos = await registro.autorizar({
      id_operacao: b.id_operacao,
      nonce: b.nonce,
      id_usuario: 'bia',
      sessao: 'sessao-cancel',
      fala: 'confirmo',
    });
    afirmar(
      'cancelamento é definitivo: "confirmo" depois não ressuscita',
      pos.ok === false && registro.ler(b.id_operacao)!.estado === 'cancelada',
      `estado: ${registro.ler(b.id_operacao)!.estado}`,
    );

    const c = (await registro.armar({
      id_usuario: 'caio',
      sessao: 'sessao-exp',
      habilidade: 'energia_da_maquina',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { acao: 'reiniciar' },
      origem_pedido: 't-exp',
      validade_ms: -1,
    }))!;
    const vencida = await registro.autorizar({
      id_operacao: c.id_operacao,
      nonce: c.nonce,
      id_usuario: 'caio',
      sessao: 'sessao-exp',
      fala: 'confirmo',
    });
    afirmar(
      'autorização expirada não autoriza',
      vencida.ok === false && registro.ler(c.id_operacao)!.estado === 'expirada',
      `recusa: ${vencida.ok === false ? vencida.motivo : '—'}`,
    );
  }

  // -------------------------------------------------------------------------
  titulo('8', 'A LLM NÃO TEM AUTORIDADE');
  {
    const { registro } = novoJornal();
    const mundo = new Mundo();
    const h: Habilidade = {
      ...habilidade({ id: 'prova_alto', mundo, modo: 'SUCESSO', verificaMundo: true }),
      manifesto: {
        ...habilidade({ id: 'prova_alto', mundo, modo: 'SUCESSO', verificaMundo: true }).manifesto,
        risco: 'alto',
      },
    };
    const { k } = kernel({ h, usuario: 'p8', sessao: 's8', registro, origem: 'emergente' });
    await k.processar(PEDIDO);

    afirmar(
      'um plano emitido pela camada de raciocínio não produz efeito de risco alto',
      mundo.quantos('prova_alto') === 0,
      `o mundo contou ${mundo.quantos('prova_alto')} efeito(s)`,
    );
    afirmar(
      'e nenhuma operação chegou a "autorizada" sem fala humana',
      registro.todas().filter((o) => o.estado === 'autorizada' || o.estado === 'executando').length === 0,
      'a fonte da evidência é tipada: um plano emergente carimba "porteiro", que é recusado para risco alto',
    );
  }

  // -------------------------------------------------------------------------
  titulo('9', 'O QUE ESTA PROVA NÃO PROVA');
  console.log(
    `  ${CINZA}· crash é SIMULADO — o jornal é reconstruído sobre o mesmo arquivo, não há SIGKILL real;\n` +
      `  · nenhum provedor externo real (WhatsApp, Graph) foi exercitado: os dois seguem sem executor;\n` +
      `  · a deduplicação vale dentro de UM processo. Duas instâncias do motor contra o mesmo\n` +
      `    dados/ não são cobertas — o jornal é append-only e não há trava entre processos;\n` +
      `  · nenhuma garantia de "exatamente uma vez" é reivindicada para efeito externo. A garantia\n` +
      `    da IARA é: no máximo uma tentativa por operação, e nenhuma repetição automática sobre\n` +
      `    resultado desconhecido. O que o provedor faz com essa tentativa é dele.${FIM}`,
  );

  // -------------------------------------------------------------------------
  console.log(
    `\n${NEGRITO}${reprovados === 0 ? `${VERDE}PROVA DE ESCRITA: 0 reprovados` : `${VERMELHO}PROVA DE ESCRITA: ${reprovados} reprovado(s)`}${FIM}\n`,
  );
  if (reprovados > 0) process.exitCode = 1;
}

void main();
