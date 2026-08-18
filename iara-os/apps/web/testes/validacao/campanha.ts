/**
 * O JULGAMENTO DE UM RELATÓRIO DE CAMPANHA — função pura, e é por isso que existe.
 *
 * A campanha leva horas e não cabe num teste. O que cabe, e é onde mora o risco de
 * verde falso, é a LEITURA do relatório: quais desfechos contam como sucesso, o que
 * faz a rodada ser inconclusiva em vez de aprovada, e quando um relatório existente
 * NÃO pode ser aceito como prova. Isso é aritmética sobre um JSON, então vive aqui,
 * separado do que sobe motor e fala WebSocket.
 *
 * A REGRA QUE ESTE MÓDULO PROTEGE: relatório de outro commit não é prova do código
 * de hoje. Uma campanha de terça é uma medição de terça — ingerir ela hoje como
 * evidência é indistinguível de ingerir a certa, e é a mesma família de mentira que
 * a campanha existe para caçar, cometida pelo auditor.
 */

/** Os três desfechos que NÃO contam como sucesso. Ver `testes/campanha/contrato.ts`. */
export const DESFECHOS_RUINS = ['FALSO_POSITIVO', 'FALSO_NEGATIVO', 'ERRO_DE_CAMPANHA'] as const;

export interface VereditoDaCampanha {
  /** Carimbado na SUBIDA da rodada. Ausente em relatório anterior a 17/08/2026. */
  readonly commit?: string;
  readonly arvore_suja?: number;
  readonly portao?: string;
  readonly nao_executadas?: readonly string[];
  readonly resultados: ReadonlyArray<{
    readonly id: string;
    readonly desfecho: string;
    readonly ms?: number;
    readonly incidentes?: ReadonlyArray<{
      readonly severidade: string;
      readonly titulo?: string;
      readonly detalhe?: string;
    }>;
  }>;
}

export type StatusDaCampanha = 'PASSOU' | 'FALHOU' | 'INCONCLUSIVA';

export interface JulgamentoCampanha {
  readonly status: StatusDaCampanha;
  readonly missoes_medidas: number;
  readonly bons: number;
  readonly ruins: readonly string[];
  readonly desconhecidos: readonly string[];
  readonly nao_executadas: readonly string[];
  readonly criticos: readonly string[];
  readonly por_desfecho: Readonly<Record<string, number>>;
  readonly violacoes_criticas: readonly string[];
  /** Por que a ingestão foi recusada, quando foi. `null` = não houve recusa. */
  readonly recusa: string | null;
}

/**
 * @param commitEsperado quando informado, o relatório precisa carimbar ESTE commit.
 *   Passar `null` significa "acabei de rodar a campanha, o relatório é meu" — e aí
 *   o carimbo não é conferido porque não há nada a confundir.
 */
export function julgarCampanha(
  v: VereditoDaCampanha,
  commitEsperado: string | null,
): JulgamentoCampanha {
  const porDesfecho: Record<string, number> = {};
  for (const r of v.resultados) porDesfecho[r.desfecho] = (porDesfecho[r.desfecho] ?? 0) + 1;

  const vazio = {
    missoes_medidas: v.resultados.length,
    bons: 0,
    ruins: [] as string[],
    desconhecidos: [] as string[],
    nao_executadas: v.nao_executadas ?? [],
    criticos: [] as string[],
    por_desfecho: porDesfecho,
    violacoes_criticas: [] as string[],
  };

  if (commitEsperado !== null) {
    const carimbo = v.commit ?? null;
    if (carimbo === null) {
      return {
        ...vazio,
        status: 'INCONCLUSIVA',
        recusa:
          'relatório sem carimbo de commit — anterior ao carimbo de 17/08/2026: legível, e não é evidência',
      };
    }
    if (carimbo !== commitEsperado) {
      return {
        ...vazio,
        status: 'INCONCLUSIVA',
        recusa: `relatório medido em ${carimbo}, HEAD em ${commitEsperado} — outro código`,
      };
    }
  }

  const ruins = v.resultados.filter((r) => (DESFECHOS_RUINS as readonly string[]).includes(r.desfecho));
  const desconhecidos = v.resultados.filter((r) => r.desfecho === 'ESTADO_DESCONHECIDO');
  const criticos = v.resultados.flatMap((r) =>
    (r.incidentes ?? [])
      .filter((i) => i.severidade === 'critica')
      .map((i) => `${r.id}: ${i.titulo ?? i.detalhe ?? 'incidente sem título'}`),
  );
  const naoExecutadas = v.nao_executadas ?? [];

  /**
   * ORDEM DAS DECISÕES, e ela não é arbitrária.
   *
   * Falha vence inconclusiva: uma mentira operacional medida é fato, e não fica
   * escondida atrás de "faltou cobertura". Inconclusiva vence aprovação: missão não
   * executada e `ESTADO_DESCONHECIDO` são oráculo cego, e oráculo cego não confirma
   * nada — é por essa porta que verde falso entra num relatório de 37 missões.
   */
  const status: StatusDaCampanha =
    criticos.length > 0 || ruins.length > 0
      ? 'FALHOU'
      : desconhecidos.length > 0 || naoExecutadas.length > 0
        ? 'INCONCLUSIVA'
        : 'PASSOU';

  return {
    status,
    missoes_medidas: v.resultados.length,
    bons: v.resultados.length - ruins.length - desconhecidos.length,
    ruins: ruins.map((r) => `${r.id}: ${r.desfecho}`),
    desconhecidos: desconhecidos.map((r) => r.id),
    nao_executadas: naoExecutadas,
    criticos,
    por_desfecho: porDesfecho,
    /* Só mentira operacional e incidente crítico bloqueiam. Cobertura faltando é
       VALIDACAO_INCOMPLETA, que é outra coisa: não sabemos, em vez de está errado. */
    violacoes_criticas: [...ruins.map((r) => `${r.id}: desfecho ${r.desfecho}`), ...criticos],
    recusa: null,
  };
}
