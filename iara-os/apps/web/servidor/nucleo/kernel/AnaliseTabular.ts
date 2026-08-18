/**
 * ANÁLISE TABULAR — a aritmética pura sobre uma `TabelaGenerica`.
 *
 * Generaliza o que `agregarCargas` (`habilidades/cargasLuft.ts`) já faz para a
 * planilha da LUFT — contar, somar, agrupar — trocando o `switch` fixo de
 * coluna por um ÍNDICE resolvido em runtime contra o cabeçalho real do
 * arquivo. Mesmo espírito de `Investigacao.ts`: vocabulário e cálculo puros,
 * sem I/O, sem rede, sem conhecer `Habilidade` nem o kernel.
 *
 * `localizarColuna` NUNCA adivinha: nome que não bate com nenhuma coluna ou
 * que bate com mais de uma (duas colunas cujo nome colide só depois de
 * normalizar acento/caixa) volta como erro explícito, com a lista real do
 * cabeçalho — a mesma disciplina de "não entendi o período" em
 * `consultarCargasLuft`.
 */

import type { CelulaValor, TabelaGenerica } from '../PlanilhaGenerica';
import { normalizar } from '../texto';

// ---------------------------------------------------------------------------
// 1. Perfil de coluna
// ---------------------------------------------------------------------------

export type TipoColuna = 'numero' | 'texto' | 'data' | 'booleano' | 'vazio' | 'misto';

export interface PerfilColuna {
  readonly nome: string;
  readonly indice: number;
  readonly tipo_dominante: TipoColuna;
  /** Linhas consideradas no perfil (== `TabelaGenerica.linhas.length`, pode ser menor que `total_linhas` se truncada). */
  readonly total: number;
  readonly nulos: number;
  readonly taxa_nulo: number;
  readonly valores_distintos: number;
  readonly valor_mais_frequente: { readonly valor: string; readonly contagem: number } | null;
}

/**
 * A partir de que fração de valores não vazios um tipo é "dominante" em vez de
 * a coluna ser `misto`. Nomeado e exportado — mesmo espírito de `FAIXAS` em
 * `MotorAnalise.ts`: convenção declarada, não número solto no meio do código.
 */
export const DOMINANCIA_TIPO = 0.9;

/**
 * Só reconhece data em CÉLULA DE TEXTO com formato explícito (`dd/mm/aaaa`,
 * `aaaa-mm-dd`). Célula numérica que É um serial de data do Excel (como em
 * `ClientePlanilhaOcis.ts`) fica classificada como `numero` — distinguir serial
 * de data de número comum exigiria ler o formato de célula do XLSX (`cell.z`),
 * que `sheet_to_json({header:1})` não preserva. Limitação conhecida, não erro.
 */
const PADRAO_DATA = /^\d{1,2}\/\d{1,2}\/\d{2,4}$|^\d{4}-\d{1,2}-\d{1,2}$/;

function classificarCelula(v: CelulaValor): Exclude<TipoColuna, 'vazio' | 'misto'> | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return 'booleano';
  if (typeof v === 'number') return 'numero';
  const t = v.trim();
  if (t === '') return null;
  if (PADRAO_DATA.test(t)) return 'data';
  return 'texto';
}

function celulaParaChave(v: CelulaValor): string {
  return v === null ? '' : String(v);
}

export function perfilarTabela(t: TabelaGenerica): readonly PerfilColuna[] {
  return t.cabecalho.map((nome, indice) => {
    const coluna = t.linhas.map((linha) => linha[indice] ?? null);
    const classificadas = coluna.map(classificarCelula);
    const naoVazias = classificadas.filter((c): c is Exclude<TipoColuna, 'vazio' | 'misto'> => c !== null);
    const nulos = coluna.length - naoVazias.length;

    const contagemPorTipo = new Map<string, number>();
    for (const c of naoVazias) contagemPorTipo.set(c, (contagemPorTipo.get(c) ?? 0) + 1);
    let tipoDominante: TipoColuna = 'vazio';
    if (naoVazias.length > 0) {
      const [tipoMaisComum, qtd] = [...contagemPorTipo.entries()].sort((a, b) => b[1] - a[1])[0];
      tipoDominante = qtd / naoVazias.length >= DOMINANCIA_TIPO ? (tipoMaisComum as TipoColuna) : 'misto';
    }

    const contagemPorValor = new Map<string, number>();
    for (const v of coluna) {
      if (v === null) continue;
      const chave = celulaParaChave(v);
      if (chave.trim() === '') continue;
      contagemPorValor.set(chave, (contagemPorValor.get(chave) ?? 0) + 1);
    }
    const maisFrequente = [...contagemPorValor.entries()].sort((a, b) => b[1] - a[1])[0];

    return {
      nome,
      indice,
      tipo_dominante: tipoDominante,
      total: coluna.length,
      nulos,
      taxa_nulo: coluna.length > 0 ? nulos / coluna.length : 0,
      valores_distintos: contagemPorValor.size,
      valor_mais_frequente: maisFrequente ? { valor: maisFrequente[0], contagem: maisFrequente[1] } : null,
    };
  });
}

// ---------------------------------------------------------------------------
// 2. Localizar coluna pelo nome dito pelo operador
// ---------------------------------------------------------------------------

export type ResultadoLocalizacaoColuna =
  | { readonly ok: true; readonly indice: number; readonly nome: string }
  | { readonly ok: false; readonly motivo: string; readonly candidatas: readonly string[] };

/** Casa o nome DITO pelo operador com o cabeçalho REAL, via `normalizar()` — reuso, não reinvenção. */
export function localizarColuna(cabecalho: readonly string[], pedido: string): ResultadoLocalizacaoColuna {
  const alvo = normalizar(pedido.trim());
  const casos = cabecalho
    .map((nome, indice) => ({ nome, indice }))
    .filter((c) => normalizar(c.nome) === alvo);

  if (casos.length === 1) return { ok: true, indice: casos[0].indice, nome: casos[0].nome };
  if (casos.length === 0) {
    return { ok: false, motivo: `nenhuma coluna chamada "${pedido}"`, candidatas: [] };
  }
  return {
    ok: false,
    motivo: `"${pedido}" é ambíguo — mais de uma coluna do cabeçalho tem esse nome`,
    candidatas: casos.map((c) => c.nome),
  };
}

// ---------------------------------------------------------------------------
// 3. Agregação — a mesma conta de `agregarCargas`, generalizada por índice
// ---------------------------------------------------------------------------

export type MetricaGenerica = 'contagem' | 'soma' | 'media' | 'minimo' | 'maximo';

export interface GrupoAgregadoGenerico {
  readonly chave: string;
  readonly contagem: number;
  /** Ausente quando `metrica === 'contagem'`. */
  readonly valor?: number;
}

export function agregarTabela(
  t: TabelaGenerica,
  indiceAgrupar: number | null,
  metrica: MetricaGenerica,
  indiceMetrica: number | null,
  filtro?: { readonly indiceColuna: number; readonly valor: string },
): readonly GrupoAgregadoGenerico[] {
  const alvoFiltro = filtro ? normalizar(filtro.valor.trim()) : null;
  const linhas =
    filtro && alvoFiltro !== null
      ? t.linhas.filter((l) => normalizar(celulaParaChave(l[filtro.indiceColuna] ?? null)) === alvoFiltro)
      : t.linhas;

  const grupos = new Map<string, { contagem: number; valores: number[] }>();
  for (const linha of linhas) {
    const chave = indiceAgrupar === null ? 'total' : celulaParaChave(linha[indiceAgrupar] ?? null).trim() || '(vazio)';
    const atual = grupos.get(chave) ?? { contagem: 0, valores: [] };
    atual.contagem += 1;
    if (indiceMetrica !== null) {
      const v = linha[indiceMetrica];
      if (typeof v === 'number') atual.valores.push(v);
    }
    grupos.set(chave, atual);
  }

  return [...grupos.entries()].map(([chave, g]) => {
    if (metrica === 'contagem') return { chave, contagem: g.contagem };
    const valor =
      g.valores.length === 0
        ? 0
        : metrica === 'soma'
          ? g.valores.reduce((s, v) => s + v, 0)
          : metrica === 'media'
            ? g.valores.reduce((s, v) => s + v, 0) / g.valores.length
            : metrica === 'minimo'
              ? Math.min(...g.valores)
              : Math.max(...g.valores);
    return { chave, contagem: g.contagem, valor };
  });
}
