/**
 * PlanilhaGenerica — leitura de QUALQUER planilha `.xlsx`/`.xls` que esteja em
 * `dados/documentos/`, sem suposição nenhuma de esquema (colunas, aba, nome de
 * arquivo). É o par genérico de `ClientePlanilhaOcis.ts`: aquele conhece a
 * planilha da operação LUFT célula por célula; este não conhece planilha
 * nenhuma — só sabe abrir um `.xlsx` e devolver linha e coluna cruas.
 *
 * MESMA TRAVA DE `extrairTextoDocumento` (`habilidades/dados.ts`): o nome do
 * arquivo é validado com `path.basename(pedido) !== pedido` ANTES de qualquer
 * I/O — sem isso, `../../.env.local` vira caminho de leitura.
 *
 * SEM REDE: ao contrário de `ClientePlanilhaOcis.ts` (que busca no SharePoint
 * via Microsoft Graph), aqui o arquivo já está no disco onde o motor roda —
 * por isso entra em `LEITURA_INTERNA` na `Fronteira.ts`, ao lado de `dados.ts`,
 * não em `LEITURA_EXTERNA`.
 *
 * DADO DE CÉLULA É DADO, NUNCA COMANDO — a mesma disciplina que
 * `ClientePlanilhaOcis.ts` já declara: nada aqui concatena texto de célula em
 * algo que vira prompt, comando de sistema ou instrução.
 */

import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import XLSX from 'xlsx';
import { normalizar } from './texto';

const RAIZ_DADOS = path.resolve(process.cwd(), 'dados');
const PASTA_DOCUMENTOS = path.join(RAIZ_DADOS, 'documentos');

/** 10 MB — generoso para planilha real de operação, pequeno o bastante para não estourar `timeout_ms`. */
export const TAMANHO_MAXIMO_BYTES = 10 * 1024 * 1024;
/** Linhas além disto entram como `truncada: true` — nunca somem em silêncio. */
export const LIMITE_LINHAS_PERFIL = 50_000;

const EXTENSAO_VALIDA = /\.(xlsx|xls)$/i;

export type CelulaValor = string | number | boolean | null;

export interface TabelaGenerica {
  readonly arquivo: string;
  readonly aba: string;
  readonly abas_disponiveis: readonly string[];
  /** Célula vazia vira `coluna_N` (1-indexado); nome duplicado vira `nome_2`, `nome_3`... */
  readonly cabecalho: readonly string[];
  readonly linhas: readonly (readonly CelulaValor[])[];
  /** Total REAL de linhas de dado (excluindo cabeçalho), mesmo quando `linhas` foi cortado. */
  readonly total_linhas: number;
  /** `true` quando `total_linhas` excede `LIMITE_LINHAS_PERFIL` e `linhas` foi cortado. */
  readonly truncada: boolean;
}

export type ResultadoLeituraPlanilha = { ok: true; tabela: TabelaGenerica } | { ok: false; motivo: string };

function paraCelula(v: unknown): CelulaValor {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

/** Vazio vira `coluna_N`; duplicata (mesmo após normalizar espaço/caixa) recebe sufixo `_2`, `_3`... */
function normalizarCabecalho(bruto: readonly unknown[]): string[] {
  const vistos = new Map<string, number>();
  return bruto.map((celula, indice) => {
    const base = String(celula ?? '').trim() || `coluna_${indice + 1}`;
    const contagem = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, contagem);
    return contagem === 1 ? base : `${base}_${contagem}`;
  });
}

/** A primeira aba com pelo menos uma linha além do cabeçalho — não necessariamente `SheetNames[0]`. */
function escolherAbaPadrao(pasta: XLSX.WorkBook): string | null {
  for (const nome of pasta.SheetNames) {
    const matriz = XLSX.utils.sheet_to_json<unknown[]>(pasta.Sheets[nome], { header: 1, raw: true, defval: '' });
    if (matriz.length > 1) return nome;
  }
  return pasta.SheetNames[0] ?? null;
}

function resolverAba(pasta: XLSX.WorkBook, abaPedida: string | undefined): { ok: true; nome: string } | { ok: false; motivo: string } {
  if (!abaPedida) {
    const nome = escolherAbaPadrao(pasta);
    return nome ? { ok: true, nome } : { ok: false, motivo: 'o arquivo não tem nenhuma aba.' };
  }
  if (pasta.SheetNames.includes(abaPedida)) return { ok: true, nome: abaPedida };
  const alvo = normalizar(abaPedida);
  const achada = pasta.SheetNames.find((n) => normalizar(n) === alvo);
  if (achada) return { ok: true, nome: achada };
  return {
    ok: false,
    motivo: `não encontrei a aba "${abaPedida}". Abas disponíveis: ${pasta.SheetNames.join(', ')}.`,
  };
}

export async function lerPlanilhaGenerica(nomeArquivo: string, abaPedida?: string): Promise<ResultadoLeituraPlanilha> {
  const seguro = path.basename(nomeArquivo);
  if (!seguro || seguro !== nomeArquivo) {
    return { ok: false, motivo: 'caminho inválido: informe apenas o nome do arquivo.' };
  }
  if (!EXTENSAO_VALIDA.test(seguro)) {
    return { ok: false, motivo: 'só arquivos .xlsx ou .xls são suportados.' };
  }

  const alvo = path.join(PASTA_DOCUMENTOS, seguro);

  let tamanho: number;
  try {
    tamanho = (await stat(alvo)).size;
  } catch {
    return { ok: false, motivo: `não encontrei "${seguro}" em dados/documentos/.` };
  }
  if (tamanho > TAMANHO_MAXIMO_BYTES) {
    return {
      ok: false,
      motivo: `"${seguro}" tem ${(tamanho / (1024 * 1024)).toFixed(1)} MB — acima do limite de ${TAMANHO_MAXIMO_BYTES / (1024 * 1024)} MB que esta habilidade lê.`,
    };
  }

  let buffer: Buffer;
  try {
    buffer = await readFile(alvo);
  } catch (erro) {
    return { ok: false, motivo: `não consegui ler "${seguro}": ${(erro as Error).message}` };
  }

  let pasta: XLSX.WorkBook;
  try {
    pasta = XLSX.read(buffer, { type: 'buffer' });
  } catch (erro) {
    return { ok: false, motivo: `"${seguro}" não é um arquivo Excel válido: ${(erro as Error).message}` };
  }

  if (pasta.SheetNames.length === 0) {
    return { ok: false, motivo: `"${seguro}" não tem nenhuma aba.` };
  }

  const aba = resolverAba(pasta, abaPedida?.trim() || undefined);
  if (!aba.ok) return { ok: false, motivo: aba.motivo };

  const matriz = XLSX.utils.sheet_to_json<unknown[]>(pasta.Sheets[aba.nome], { header: 1, raw: true, defval: '' });
  const cabecalhoBruto = matriz[0] ?? [];
  const resto = matriz.slice(1);

  const totalLinhas = resto.length;
  const truncada = totalLinhas > LIMITE_LINHAS_PERFIL;
  const linhas = (truncada ? resto.slice(0, LIMITE_LINHAS_PERFIL) : resto).map((linha) => linha.map(paraCelula));

  return {
    ok: true,
    tabela: {
      arquivo: seguro,
      aba: aba.nome,
      abas_disponiveis: pasta.SheetNames,
      cabecalho: normalizarCabecalho(cabecalhoBruto),
      linhas,
      total_linhas: totalLinhas,
      truncada,
    },
  };
}
