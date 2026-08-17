/**
 * O DIÁRIO DE EVIDÊNCIA — uma linha por execução de bateria, em disco.
 *
 * Append-only e em `.jsonl` pelo mesmo motivo que o jornal de operações: a
 * pergunta que ele responde é histórica ("por que aquele commit foi considerado
 * validado?"), e um arquivo reescrito perde a única coisa que dava valor à
 * resposta. Rodada nova nunca apaga rodada velha; quem decide o que conta é o
 * `MotorVeredito`, comparando commit.
 *
 * LINHA ILEGÍVEL É REPORTADA, NUNCA PULADA. Um leitor que engole JSON quebrado
 * em silêncio transforma corrupção de disco em "essa bateria nunca rodou" — e o
 * veredito sai plausível e errado, que é a família de defeito que este diretório
 * inteiro existe para não cometer.
 */

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RegistroEvidencia } from './contrato';

/** `<app>/` — dois níveis acima deste arquivo. */
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const CAMINHO_PADRAO = path.join(RAIZ, 'test-evidence', 'validacao', 'diario.jsonl');

export interface LeituraDiario {
  readonly registros: readonly RegistroEvidencia[];
  /** Linhas que não viraram registro. Cada uma com o motivo e o número. */
  readonly ilegiveis: readonly string[];
}

export function registrar(r: RegistroEvidencia, caminho: string = CAMINHO_PADRAO): void {
  mkdirSync(path.dirname(caminho), { recursive: true });
  appendFileSync(caminho, `${JSON.stringify(r)}\n`, 'utf8');
}

/**
 * Campo ausente vira linha ilegível, não valor padrão. Um registro incompleto
 * completado por padrão é um registro inventado — e `conferirRegistro` julgaria
 * a invenção, não a execução.
 */
function interpretar(linha: string): RegistroEvidencia | string {
  let dado: unknown;
  try {
    dado = JSON.parse(linha);
  } catch {
    return 'JSON inválido';
  }
  if (typeof dado !== 'object' || dado === null) return 'não é objeto';

  const o = dado as Record<string, unknown>;
  const texto = (c: string): string | null => (typeof o[c] === 'string' ? (o[c] as string) : null);
  const inteiro = (c: string): number | null =>
    typeof o[c] === 'number' && Number.isInteger(o[c]) ? (o[c] as number) : null;

  const faltando: string[] = [];
  for (const c of ['bateria', 'execucao', 'commit', 'ambiente', 'instante', 'status', 'versao_oraculo']) {
    if (texto(c) === null) faltando.push(c);
  }
  /* `artefato` aceita `null` — bateria não executada não tem o que anexar. Mas a
     CHAVE tem de estar lá: ausente e nulo significam a mesma coisa para o motor,
     e é justamente por isso que aceitar a ausência seria aceitar um registro
     escrito pela metade como se fosse uma declaração. */
  if (!Object.hasOwn(o, 'artefato') || !(typeof o.artefato === 'string' || o.artefato === null)) {
    faltando.push('artefato');
  }
  for (const c of ['cenarios', 'passou', 'falhou', 'inconclusivo', 'bloqueado']) {
    if (inteiro(c) === null) faltando.push(c);
  }
  if (!Array.isArray(o.violacoes_criticas)) faltando.push('violacoes_criticas');
  if (typeof o.metricas !== 'object' || o.metricas === null) faltando.push('metricas');
  if (faltando.length > 0) return `campo ausente ou de tipo errado: ${faltando.join(', ')}`;

  const metricas: Record<string, number> = {};
  for (const [k, v] of Object.entries(o.metricas as Record<string, unknown>)) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return `métrica "${k}" não é número finito`;
    metricas[k] = v;
  }

  return {
    bateria: texto('bateria') as string,
    execucao: texto('execucao') as string,
    commit: texto('commit') as string,
    ambiente: texto('ambiente') as string,
    instante: texto('instante') as string,
    status: texto('status') as RegistroEvidencia['status'],
    cenarios: inteiro('cenarios') as number,
    passou: inteiro('passou') as number,
    falhou: inteiro('falhou') as number,
    inconclusivo: inteiro('inconclusivo') as number,
    bloqueado: inteiro('bloqueado') as number,
    artefato: texto('artefato'),
    metricas,
    versao_oraculo: texto('versao_oraculo') as string,
    violacoes_criticas: (o.violacoes_criticas as unknown[]).map((v) => String(v)),
  };
}

export function ler(caminho: string = CAMINHO_PADRAO): LeituraDiario {
  let bruto: string;
  try {
    bruto = readFileSync(caminho, 'utf8');
  } catch {
    // Diário inexistente é estado legítimo e significa exatamente uma coisa:
    // nenhuma bateria rodou. O motor traduz isso em VALIDACAO_INCOMPLETA.
    return { registros: [], ilegiveis: [] };
  }

  const registros: RegistroEvidencia[] = [];
  const ilegiveis: string[] = [];

  bruto.split('\n').forEach((linha, i) => {
    if (!linha.trim()) return;
    const r = interpretar(linha);
    if (typeof r === 'string') ilegiveis.push(`linha ${i + 1}: ${r}`);
    else registros.push(r);
  });

  return { registros, ilegiveis };
}
