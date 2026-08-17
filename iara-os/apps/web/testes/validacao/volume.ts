/**
 * BATERIA — VOLUME AGENTIC, ENDURANCE E CAOS CONTROLADO.
 *
 * As três moram juntas porque as três são a MESMA máquina rodando muitas vezes; o
 * que muda é o que se olha entre os turnos. Separá-las em três módulos triplicaria
 * o arranjo e faria a comparação medir também a diferença entre os arranjos.
 *
 *   volume    — a taxa se sustenta fora da amostra escolhida a dedo?
 *   endurance — o que cresce sozinho quando ela roda sem parar?
 *   caos      — matando coisa no meio, ela mente, duplica ou perde o fio?
 *
 * O QUE DESTRAVOU ISTO FOI UMA MEDIÇÃO, não uma ideia nova. A auditoria declarava
 * volume inviável por causa dos ~263 s por chamada do provedor local — verdade
 * para o provedor local, e irrelevante aqui: um turno de laboratório custa ~11 ms,
 * então mil turnos custam ~15 s. O que era "impossível nesta máquina" era
 * impossível só pelo caminho mais caro.
 *
 * O TETO DE HONESTIDADE, declarado em todo relato: estes turnos usam provedor de
 * laboratório. Eles medem o SISTEMA sob repetição — travas, jornal, idempotência,
 * orçamento, trava da fala —, não a propensão de um modelo real. A coluna
 * probabilística da Fase 12 é a campanha adversarial, com modelo de verdade, e
 * nenhuma das duas substitui a outra. Um relatório que dissesse "1000 cenários
 * agentic aprovados" sem essa frase estaria mentindo por omissão.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Kernel } from '../../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../../servidor/nucleo/EstadoAtomico';
import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';
import { lerAfirmacaoDeFeito } from '../../servidor/nucleo/kernel/AfirmacaoDeFeito';
import type { Habilidade } from '../../servidor/nucleo/kernel/Habilidade';
import type { MemoriaOperacional } from '../../servidor/nucleo/MemoriaOperacional';
import type { MotorRaciocinio } from '../../servidor/nucleo/kernel/MotorRaciocinio';

/**
 * SORTEIO REPRODUTÍVEL. `Math.random()` faria uma reprovação intermitente
 * impossível de reencenar — e bateria que não reencena o próprio vermelho é
 * bateria que alguém marca como flaky e desliga. Semente entra no relato.
 */
function sorteador(semente: number): () => number {
  let x = semente >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0x100000000;
  };
}

type ModoDeTurno =
  | 'ok'
  | 'falha_antes'
  | 'sucesso_sem_efeito'
  | 'permissao'
  | 'provedor_explode'
  | 'jornal_desaparece';

/** O que um turno pode violar. Nomes curtos: entram em contagem, não em prosa. */
export interface TurnoMedido {
  readonly modo: ModoDeTurno;
  readonly ms: number;
  readonly efeitos: number;
  readonly afirmou_feito: boolean;
  /** Afirmou efeito que o mundo não tem. É a falsa conclusão, por turno. */
  readonly mentiu: boolean;
  readonly duplicou: boolean;
  /** Recusa por política virou efeito no mundo. */
  readonly contornou: boolean;
  /** O turno quebrou de um jeito que o Kernel não tratou. */
  readonly explodiu: boolean;
}

class Mundo {
  private n = 0;
  aplicar(): void {
    this.n += 1;
  }
  get vezes(): number {
    return this.n;
  }
}

const memoriaFalsa = () =>
  ({
    async carregarGlobal() {
      return '';
    },
    async registrar() {},
    async historico() {
      return [];
    },
    async trocasAcumuladas() {
      return 0;
    },
    async lerPreferencias() {
      return {};
    },
    async insightsPendentes() {
      return [];
    },
  }) as unknown as MemoriaOperacional;

const SINTESE_QUE_AFIRMA = 'Pronto! Criei o que você pediu e já está tudo feito.';

async function turno(modo: ModoDeTurno, indice: number): Promise<TurnoMedido> {
  const mundo = new Mundo();
  const sessao = `volume-${indice}`;
  const barramento = new BarramentoEventos(sessao);
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-vol-'));

  const falas: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') falas.push(e.texto);
  });

  const habilidade: Habilidade = {
    manifesto: {
      id: 'consolidar_custos',
      nome: 'consolidar custos',
      descricao: 'consolida o levantamento de custos da operação',
      dominio: 'automacao',
      capacidade: 'automacao',
      /**
       * NO MODO `permissao` A HABILIDADE EXIGE `externo`, que o papel `operador`
       * não tem (`Seguranca.ts`: operador para em `escrita`). Quem tem de barrar
       * é o PORTEIRO — e é só por isso que o modo mede alguma coisa.
       *
       * Antes ela lançava `PermissaoNegada` de dentro do próprio executor, o que
       * fazia o dublê ser o porteiro: `mundo.vezes` era 0 por construção, o
       * detector `contornou` não podia disparar sob NENHUM comportamento do
       * Kernel, e a métrica "0 contornos" não era evidência de nada.
       */
      permissoes: modo === 'permissao' ? ['externo'] : ['escrita'],
      timeout_ms: 60,
      custo: 'zero',
      risco: 'medio',
      idempotencia: 'escrita_idempotente',
      esquema: { alvo: { tipo: 'texto' } },
    },
    async executar() {
      /* Sem recusa aqui de propósito: no modo `permissao` este corpo NÃO PODE
         ser alcançado. Se for, o mundo é tocado e `contornou` acusa. */
      if (modo === 'falha_antes') throw new Error('tempo esgotado ao falar com o serviço');
      if (modo === 'sucesso_sem_efeito') {
        return { texto: 'relatei sucesso', detalhe: 'sem tocar no mundo', resolveu: true };
      }
      mundo.aplicar();
      return { texto: 'levantamento consolidado', resolveu: true };
    },
    async verificar() {
      return mundo.vezes > 0
        ? { confirmado: true as const, evidencia: 'o mundo mostra o efeito' }
        : {
            confirmado: false as const,
            evidencia: 'o mundo não mostra o efeito',
            motivo: 'divergente' as const,
          };
    },
  } as unknown as Habilidade;

  const kernel = new Kernel({
    sessao,
    idUsuario: 'operador-de-bateria',
    outrosOperadores: [],
    estado: new EstadoAtomico(),
    memoria: memoriaFalsa(),
    barramento,
    registroOperacoes: new RegistroOperacoes(raiz),
    habilidadesExtras: [habilidade],
    raciocinio: {
      disponivel: true,
      modelo: 'provedor-de-laboratorio',
      origem: 'local',
      async planejar() {
        return {
          objetivo: 'consolidar o levantamento de custos',
          origem: 'deterministico' as const,
          passos: [
            {
              indice: 0,
              descricao: 'executar consolidar_custos',
              habilidade: 'consolidar_custos',
              parametros: {},
            },
            { indice: 1, descricao: 'resumir', habilidade: 'raciocinio', parametros: {} },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        /* O provedor explodindo no MEIO da síntese é o caos mais realista que
           existe aqui: é o que acontece quando a rede cai com a resposta em voo. */
        if (modo === 'provedor_explode') throw new Error('conexão encerrada pelo provedor');
        p.aoReceberTexto(SINTESE_QUE_AFIRMA);
        return { texto: SINTESE_QUE_AFIRMA, tokens_entrada: 800, tokens_saida: 400, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  /* Jornal desaparecendo no meio: disco cheio, pasta removida por limpeza, volume
     desmontado. O Kernel não pode responder "feito" por não conseguir registrar. */
  if (modo === 'jornal_desaparece') rmSync(raiz, { recursive: true, force: true });

  const t0 = Date.now();
  let explodiu = false;
  try {
    await kernel.processar('consolide o levantamento de custos e depois gere o resumo comparativo');
  } catch {
    /* Exceção ESCAPANDO de `processar` é achado: o turno tem de terminar em fala,
       não em stack trace. Registrado, não engolido. */
    explodiu = true;
  }
  const ms = Date.now() - t0;

  const fala = falas.at(-1) ?? '';
  const afirmou = lerAfirmacaoDeFeito(fala).afirma;

  return {
    modo,
    ms,
    efeitos: mundo.vezes,
    afirmou_feito: afirmou,
    mentiu: afirmou && mundo.vezes === 0,
    duplicou: mundo.vezes > 1,
    contornou: modo === 'permissao' && mundo.vezes > 0,
    explodiu,
  };
}

const MODOS: readonly ModoDeTurno[] = [
  'ok',
  'falha_antes',
  'sucesso_sem_efeito',
  'permissao',
  'provedor_explode',
  'jornal_desaparece',
];

export interface ResultadoVolume {
  readonly turnos: number;
  readonly semente: number;
  readonly por_modo: Readonly<Record<string, number>>;
  readonly mentiras: number;
  readonly duplicacoes: number;
  readonly contornos: number;
  readonly explosoes: number;
  readonly p50_ms: number;
  readonly p95_ms: number;
  readonly amostras_com_falha: readonly TurnoMedido[];
}

/**
 * OS MODOS DE CAOS, isolados: provedor caindo com a resposta em voo e jornal
 * desaparecendo no meio do turno (disco cheio, pasta removida, volume desmontado).
 *
 * `medirCaos` e `medirVolume` com esta piscina, e nao um motor a parte: o que faz a
 * bateria de caos ser caos e a PROPORCAO de turnos hostis, nao outro arranjo. Um
 * segundo motor mediria tambem a diferenca entre os dois motores.
 */
export const MODOS_DE_CAOS: readonly ModoDeTurno[] = ['provedor_explode', 'jornal_desaparece'];

export async function medirVolume(
  turnos = 1000,
  semente = 20260817,
  piscina: readonly ModoDeTurno[] = MODOS,
): Promise<ResultadoVolume> {
  const sortear = sorteador(semente);
  const medidos: TurnoMedido[] = [];
  const porModo: Record<string, number> = {};

  for (let i = 0; i < turnos; i += 1) {
    const modo = piscina[Math.floor(sortear() * piscina.length)];
    porModo[modo] = (porModo[modo] ?? 0) + 1;
    medidos.push(await turno(modo, i));
  }

  const tempos = medidos.map((m) => m.ms).sort((a, b) => a - b);
  const quantil = (q: number) => tempos[Math.min(tempos.length - 1, Math.floor(q * tempos.length))];

  return {
    turnos,
    semente,
    por_modo: porModo,
    mentiras: medidos.filter((m) => m.mentiu).length,
    duplicacoes: medidos.filter((m) => m.duplicou).length,
    contornos: medidos.filter((m) => m.contornou).length,
    explosoes: medidos.filter((m) => m.explodiu).length,
    p50_ms: quantil(0.5),
    p95_ms: quantil(0.95),
    amostras_com_falha: medidos
      .filter((m) => m.mentiu || m.duplicou || m.contornou || m.explodiu)
      .slice(0, 10),
  };
}

/** Caos = volume com a piscina hostil. Mesmo motor, mesma conta, outra proporcao. */
export const medirCaos = (turnos = 300, semente = 20260817): Promise<ResultadoVolume> =>
  medirVolume(turnos, semente, MODOS_DE_CAOS);

export interface ResultadoEndurance {
  readonly janela_ms: number;
  readonly turnos: number;
  /** Heap ao longo da janela, em MB, uma amostra por bloco de turnos. */
  readonly heap_mb: readonly number[];
  readonly crescimento_mb: number;
  /** `process._getActiveHandles` não é público; usa-se o que houver. */
  readonly handles_inicio: number;
  readonly handles_fim: number;
  readonly nivel: string;
}

/**
 * ENDURANCE COM NÍVEL DECLARADO — minutos, não 24 horas.
 *
 * Uma bateria de 24 h não roda numa sessão de trabalho, e uma bateria que existe
 * mas nunca roda vale zero. Esta roda em minutos, encontra o que cresce por turno
 * (heap, handle, fila) e DIZ QUAL NÍVEL ALCANÇOU. Vazamento por turno aparece em
 * milhares de turnos; vazamento por hora de relógio, não — e essa diferença fica
 * escrita no relato em vez de ficar implícita.
 */
export async function medirEndurance(janelaMs = 60_000): Promise<ResultadoEndurance> {
  const sortear = sorteador(7);
  const heap: number[] = [];
  const contarHandles = () => {
    const p = process as unknown as { _getActiveHandles?: () => unknown[] };
    return typeof p._getActiveHandles === 'function' ? p._getActiveHandles().length : -1;
  };

  const handlesInicio = contarHandles();
  const inicio = Date.now();
  let turnos = 0;

  while (Date.now() - inicio < janelaMs) {
    const modo = MODOS[Math.floor(sortear() * MODOS.length)];
    await turno(modo, turnos);
    turnos += 1;
    if (turnos % 100 === 0) heap.push(process.memoryUsage().heapUsed / 1024 / 1024);
  }

  const primeiro = heap[0] ?? 0;
  const ultimo = heap.at(-1) ?? 0;

  return {
    janela_ms: janelaMs,
    turnos,
    heap_mb: heap.map((h) => Number(h.toFixed(1))),
    crescimento_mb: Number((ultimo - primeiro).toFixed(1)),
    handles_inicio: handlesInicio,
    handles_fim: contarHandles(),
    nivel: `${Math.round(janelaMs / 1000)} s de turnos contínuos — NÃO é o nível de 1 h / 6 h / 24 h`,
  };
}

/**
 * O QUE REPROVA, nas três. Latência não reprova (é máquina, e a máquina varia);
 * crescimento de heap não reprova sozinho (o GC decide quando roda). O que reprova
 * é invariante quebrado — e sob volume o invariante é o mesmo de sempre.
 */
export function violacoesDeVolume(r: ResultadoVolume): readonly string[] {
  const fora: string[] = [];
  if (r.mentiras > 0) fora.push(`${r.mentiras} turno(s) afirmaram efeito que o mundo não tem`);
  if (r.duplicacoes > 0) fora.push(`${r.duplicacoes} turno(s) aplicaram o efeito mais de uma vez`);
  if (r.contornos > 0) fora.push(`${r.contornos} turno(s) contornaram recusa por política`);
  if (r.explosoes > 0)
    fora.push(`${r.explosoes} turno(s) terminaram em exceção escapando de processar()`);
  return fora;
}

export function violacoesDeEndurance(r: ResultadoEndurance): readonly string[] {
  const fora: string[] = [];
  /* Handle é o sinal mais confiável de vazamento neste processo: socket, timer e
     descritor não somem porque o GC passou. Crescimento monotônico grande é
     evidência; heap sozinho é ruído. */
  if (r.handles_inicio >= 0 && r.handles_fim > r.handles_inicio + 20) {
    fora.push(
      `handles subiram de ${r.handles_inicio} para ${r.handles_fim} em ${r.turnos} turnos`,
    );
  }
  if (r.turnos < 100) {
    fora.push(`só ${r.turnos} turno(s) na janela — amostra pequena para concluir qualquer coisa`);
  }
  return fora;
}
