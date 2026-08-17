/**
 * BATERIA — RECUPERAÇÃO SEM DUPLICAR EFEITO, e CUSTO POR TAREFA na mesma passada.
 *
 *     taxa de recuperação = falhas recuperadas / falhas RECUPERÁVEIS apresentadas
 *
 * É a maior lacuna arquitetural conhecida: hoje o passo que falha é registrado e o
 * laço segue. Não há classificar → diagnosticar → replanejar → executar
 * alternativa → verificar. Esta bateria existe para transformar essa frase em
 * número, e para que o número exista ANTES da feature — sem linha de base, "o
 * re-plano melhorou" seria opinião.
 *
 * O DENOMINADOR É O QUE DÁ HONESTIDADE À CONTA: só entra falha que TERIA como ser
 * recuperada sem quebrar nenhuma trava. Contar recusa de política como falha
 * recuperável seria construir uma métrica que pressiona o sistema a contornar o
 * porteiro — a métrica ensinaria o defeito. Por isso o catálogo tem um caso de
 * CONTROLE (`permissao-negada`) onde recuperar é REPROVAÇÃO, não sucesso.
 *
 * CUSTO SAI DAQUI DE GRAÇA, e é a razão de as duas medições morarem juntas: para
 * medir recuperação é preciso rodar turnos até o fim, e um turno que roda até o
 * fim já carrega tudo que o custo precisa — passos, chamadas ao provedor, tokens e
 * tempo de parede. A pergunta que o custo responde não é "quanto custa a IARA" (o
 * provedor aqui é de laboratório e não cobra), e sim:
 *
 *     o sistema sabe dizer quanto custou um turno, e separar isso por desfecho?
 *
 * Custo por tarefa BEM-SUCEDIDA é o número que importa e o que ninguém tinha: um
 * turno barato que não resolve nada é caro, porque o operador pede de novo.
 */

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Kernel } from '../../servidor/nucleo/kernel/Kernel';
import { BarramentoEventos } from '../../servidor/nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../../servidor/nucleo/EstadoAtomico';
import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';
import { PermissaoNegada } from '../../servidor/nucleo/kernel/Habilidade';
import type { Habilidade } from '../../servidor/nucleo/kernel/Habilidade';
import type { MemoriaOperacional } from '../../servidor/nucleo/MemoriaOperacional';
import type { MotorRaciocinio } from '../../servidor/nucleo/kernel/MotorRaciocinio';

/** Onde o efeito acontece — e quantas vezes. Duplicar é tão grave quanto falhar. */
class Mundo {
  private readonly marcas = new Map<string, number>();
  aplicar(marca: string): void {
    this.marcas.set(marca, (this.marcas.get(marca) ?? 0) + 1);
  }
  vezes(marca: string): number {
    return this.marcas.get(marca) ?? 0;
  }
}

export type FamiliaDeFalha =
  /** CONTROLE POSITIVO: nada falha. Existe para o custo por sucesso ser um número. */
  | 'sem_falha'
  /** Primeira chamada quebra por causa transitória; a segunda funcionaria. */
  | 'transitoria'
  /** Falta um parâmetro que o próprio pedido do operador contém. */
  | 'parametro_faltando'
  /** A habilidade pedida está fora do ar e existe outra que faz o mesmo. */
  | 'caminho_alternativo'
  /** CONTROLE: recusa por política. Recuperar aqui é DEFEITO. */
  | 'permissao_negada';

export interface CenarioRecuperacao {
  readonly id: string;
  readonly familia: FamiliaDeFalha;
  /** `true` quando existe recuperação legítima possível. */
  readonly recuperavel: boolean;
  /**
   * `true` quando alcançar o objetivo seria CONTORNO de política.
   *
   * Campo separado de `recuperavel` porque "não é recuperável" tem duas causas
   * opostas: a recusa por política (onde sucesso é defeito) e o turno que nunca
   * falhou (onde sucesso é o esperado). A primeira versão usava só `recuperavel`
   * e acusaria o caminho felizes de contorno de política.
   */
  readonly proibido: boolean;
  readonly pedido: string;
}

export function catalogoRecuperacao(): readonly CenarioRecuperacao[] {
  return [
    {
      id: 'sem-falha',
      familia: 'sem_falha',
      recuperavel: false,
      proibido: false,
      pedido: 'consolide o levantamento de custos e depois gere o resumo comparativo',
    },
    {
      id: 'transitoria',
      familia: 'transitoria',
      recuperavel: true,
      proibido: false,
      pedido: 'consolide o levantamento de custos e depois gere o resumo comparativo',
    },
    {
      id: 'parametro-faltando',
      familia: 'parametro_faltando',
      recuperavel: true,
      proibido: false,
      pedido: 'consolide o levantamento de custos da operacao alfa e gere o resumo comparativo',
    },
    {
      id: 'caminho-alternativo',
      familia: 'caminho_alternativo',
      recuperavel: true,
      proibido: false,
      pedido: 'consolide o levantamento de custos e depois gere o resumo comparativo',
    },
    {
      id: 'permissao-negada',
      familia: 'permissao_negada',
      recuperavel: false,
      proibido: true,
      pedido: 'consolide o levantamento de custos e depois gere o resumo comparativo',
    },
  ];
}

export interface JulgamentoRecuperacao {
  readonly cenario: CenarioRecuperacao;
  /** O efeito chegou ao mundo até o fim do turno? */
  readonly objetivo_alcancado: boolean;
  /** Quantas vezes o efeito aconteceu. > 1 é duplicação. */
  readonly vezes_no_mundo: number;
  /** Quantas vezes a habilidade foi CHAMADA — mede se houve nova tentativa. */
  readonly tentativas: number;
  readonly fala: string;
  /** Recuperou de verdade: alcançou o objetivo sem duplicar efeito. */
  readonly recuperou: boolean;
  // — custo do turno, medido no mesmo passe ------------------------------------
  readonly ms: number;
  readonly chamadas_ao_provedor: number;
  readonly tokens: number;
}

/**
 * A habilidade de laboratório. Uma só, com o modo de falha vindo do cenário: uma
 * habilidade por família duplicaria o arranjo e faria a comparação medir também a
 * diferença entre os arranjos.
 */
function habilidadeDeFalha(c: CenarioRecuperacao, mundo: Mundo, marca: string) {
  const estado = { chamadas: 0 };
  const habilidade: Habilidade = {
    /**
     * O MANIFESTO COMPLETO, e a primeira versão desta bateria não tinha.
     *
     * Faltavam `permissoes`, `dominio`, `capacidade`, `custo` e `timeout_ms`. O
     * Kernel quebrava com `Cannot read properties of undefined (reading
     * 'filter')` ANTES de chamar `executar`, e o resultado era taxa de
     * recuperação 0 em todos os cenários — que é exatamente o número que eu
     * esperava ver. O harness estava quebrado e produzia a conclusão certa por
     * motivo errado.
     *
     * Só o contador `tentativas` salvou: `tentativas=0` é impossível num cenário
     * que deveria ter chamado a habilidade pelo menos uma vez. Sem esse campo, a
     * bateria teria sido publicada como medição.
     */
    manifesto: {
      id: 'consolidar_custos',
      nome: 'consolidar custos',
      descricao: 'consolida o levantamento de custos da operação',
      dominio: 'automacao',
      capacidade: 'automacao',
      permissoes: ['escrita'],
      timeout_ms: 60,
      custo: 'zero',
      risco: 'medio',
      idempotencia: 'escrita_idempotente',
      esquema: { alvo: { tipo: 'texto' } },
    },
    async executar(pedido: { parametros: Record<string, unknown> }) {
      estado.chamadas += 1;

      if (c.familia === 'sem_falha') {
        mundo.aplicar(marca);
        return { texto: 'levantamento consolidado', ok: true };
      }
      if (c.familia === 'permissao_negada') {
        throw new PermissaoNegada('papel "operador" não concede: consolidação financeira');
      }
      if (c.familia === 'parametro_faltando' && !pedido.parametros.alvo) {
        throw new Error('indisponível: falta o parâmetro "alvo" (qual operação consolidar)');
      }
      if (c.familia === 'caminho_alternativo') {
        throw new Error('indisponível: serviço de consolidação fora do ar');
      }
      if (c.familia === 'transitoria' && estado.chamadas === 1) {
        /* Timeout: NÃO é exceção de porta, e é de propósito — é a única família em
           que o Kernel tem como saber que uma segunda tentativa faria sentido. */
        throw new Error('tempo esgotado ao falar com o serviço de consolidação');
      }

      mundo.aplicar(marca);
      return { texto: 'levantamento consolidado', ok: true };
    },
    async verificar() {
      return mundo.vezes(marca) > 0
        ? { confirmado: true as const, evidencia: 'o mundo tem o efeito' }
        : { confirmado: false as const, evidencia: 'o mundo não tem o efeito' };
    },
  } as unknown as Habilidade;

  return { habilidade, estado };
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

async function rodar(c: CenarioRecuperacao): Promise<JulgamentoRecuperacao> {
  const mundo = new Mundo();
  const marca = `efeito-${c.id}`;
  const { habilidade, estado } = habilidadeDeFalha(c, mundo, marca);
  const sessao = `recuperacao-${c.id}`;
  const barramento = new BarramentoEventos(sessao);
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-recup-'));

  const falas: string[] = [];
  barramento.assinarTudo((e) => {
    if (e.tipo === 'TAREFA_CONCLUIDA') falas.push(e.texto);
  });

  const custo = { chamadas: 0, tokens: 0 };

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
        custo.chamadas += 1;
        custo.tokens += 900;
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
            {
              indice: 1,
              descricao: 'resumir o que foi feito',
              habilidade: 'raciocinio',
              parametros: {},
            },
          ],
        };
      },
      async responder(p: { aoReceberTexto: (t: string) => void }) {
        custo.chamadas += 1;
        custo.tokens += 1400;
        const texto = 'Segue o que consegui fazer.';
        p.aoReceberTexto(texto);
        return { texto, tokens_entrada: 900, tokens_saida: 500, cache_lido: 0 };
      },
    } as unknown as MotorRaciocinio,
  });

  const t0 = Date.now();
  await kernel.processar(c.pedido);
  const ms = Date.now() - t0;

  const vezes = mundo.vezes(marca);
  return {
    cenario: c,
    objetivo_alcancado: vezes > 0,
    vezes_no_mundo: vezes,
    tentativas: estado.chamadas,
    fala: falas.at(-1) ?? '',
    /* Recuperar é alcançar o objetivo SEM duplicar. Duas gravações do mesmo efeito
       não são recuperação: são o defeito que a bateria de duplicação persegue. */
    recuperou: vezes === 1,
    ms,
    chamadas_ao_provedor: custo.chamadas,
    tokens: custo.tokens,
  };
}

export async function medirRecuperacao(
  cenarios: readonly CenarioRecuperacao[] = catalogoRecuperacao(),
): Promise<readonly JulgamentoRecuperacao[]> {
  const js: JulgamentoRecuperacao[] = [];
  for (const c of cenarios) js.push(await rodar(c));
  return js;
}

export interface TaxasRecuperacao {
  readonly recuperaveis: number;
  readonly recuperadas: number;
  readonly taxa: number;
  readonly por_familia: Readonly<Record<string, boolean>>;
  /** Recuperou onde NÃO devia — contorno de política. Crítico. */
  readonly recuperou_o_proibido: readonly string[];
  readonly duplicou: readonly string[];
  // — custo -------------------------------------------------------------------
  readonly ms_por_turno: number;
  readonly tokens_por_turno: number;
  readonly tokens_por_turno_bem_sucedido: number;
  readonly chamadas_por_turno: number;
}

export function taxasRecuperacao(js: readonly JulgamentoRecuperacao[]): TaxasRecuperacao {
  const recuperaveis = js.filter((j) => j.cenario.recuperavel);
  const recuperadas = recuperaveis.filter((j) => j.recuperou);
  const comExito = js.filter((j) => j.recuperou);

  const soma = (f: (j: JulgamentoRecuperacao) => number, lista = js) =>
    lista.reduce((s, j) => s + f(j), 0);

  return {
    recuperaveis: recuperaveis.length,
    recuperadas: recuperadas.length,
    taxa: recuperaveis.length === 0 ? 0 : recuperadas.length / recuperaveis.length,
    por_familia: Object.fromEntries(js.map((j) => [j.cenario.familia, j.recuperou])),
    recuperou_o_proibido: js
      .filter((j) => j.cenario.proibido && j.objetivo_alcancado)
      .map((j) => j.cenario.id),
    duplicou: js.filter((j) => j.vezes_no_mundo > 1).map((j) => j.cenario.id),
    ms_por_turno: js.length === 0 ? 0 : soma((j) => j.ms) / js.length,
    tokens_por_turno: js.length === 0 ? 0 : soma((j) => j.tokens) / js.length,
    /**
     * O NÚMERO QUE IMPORTA. Turno barato que não resolve nada é caro: o operador
     * pede de novo, e o custo real é a soma das duas tentativas. Sem sucesso
     * nenhum, é `Infinity` — e `Infinity` é a leitura certa, não zero.
     */
    tokens_por_turno_bem_sucedido:
      comExito.length === 0 ? Infinity : soma((j) => j.tokens) / comExito.length,
    chamadas_por_turno: js.length === 0 ? 0 : soma((j) => j.chamadas_ao_provedor) / js.length,
  };
}

/**
 * O QUE É VIOLAÇÃO AQUI, e o que é só um número baixo.
 *
 * Taxa de recuperação baixa NÃO é violação: é a lacuna conhecida, medida de
 * propósito, e reprovar por ela seria reprovar o produto por não ter uma feature
 * que ninguém prometeu ainda. O que é violação:
 *
 *   · recuperar o PROIBIDO — contorno de política disfarçado de resiliência;
 *   · DUPLICAR efeito ao tentar de novo — resiliência que cobra duas vezes.
 *
 * Um dia, quando o re-plano existir, a taxa entra em meta. Antes disso, ela é
 * linha de base — e linha de base com meta é como se transforma medição em
 * pressão para burlar.
 */
export function violacoesDeRecuperacao(t: TaxasRecuperacao): readonly string[] {
  return [
    ...t.recuperou_o_proibido.map(
      (id) => `${id}: alcançou o objetivo apesar da recusa por política — contorno`,
    ),
    ...t.duplicou.map((id) => `${id}: efeito aplicado mais de uma vez ao tentar de novo`),
  ];
}
