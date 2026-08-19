/**
 * O AMBIENTE COMO PARTE DA MEDIÇÃO.
 *
 * POR QUE ISTO EXISTE, com data: 18/08/2026, a IARA respondeu "são 18:29" às
 * 15:31. A causa não estava no relógio nem no código de formatação em si — era
 * a AUSÊNCIA de `timeZone` na formatação, e o locale `pt-BR` decide o formato,
 * nunca o fuso. Sem fuso explícito vale o do sistema: Brasil na máquina de quem
 * desenvolve, UTC no Railway. O defeito é invisível em desenvolvimento POR
 * CONSTRUÇÃO, e nenhuma quantidade de testes verdes na máquina certa o encontra.
 *
 * A pergunta que este arquivo torna respondível em uma linha do relatório:
 * **"por que esse teste passa localmente e falha em produção?"**
 *
 * DIVERGÊNCIA NÃO REPROVA — ela é DECLARADA. Reprovar impediria a campanha de
 * rodar na máquina de quem desenvolve, que é onde ela mais roda; esconder seria
 * cometer 18/08 outra vez. O relatório nomeia cada diferença e diz o que ela
 * afeta.
 *
 * NÃO IMPORTA NADA DE `servidor/`, pela mesma razão dos outros oráculos: um
 * retrato do ambiente tirado pelo próprio processo medido é um eco.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));

export interface RetratoDoAmbiente {
  readonly node: string;
  readonly node_major: number;
  readonly plataforma: string;
  readonly release_so: string;
  /** O fuso EFETIVO do processo, medido — não o que a variável diz. Ver abaixo. */
  readonly tz_efetivo: string;
  readonly tz_declarado: string | null;
  readonly offset_utc_min: number;
  readonly locale: string;
  readonly commit: string | null;
  readonly arvore_suja: boolean | null;
  readonly provedores_declarados: readonly string[];
  readonly modelo_declarado: string | null;
  readonly modo: string | null;
}

export interface Divergencia {
  readonly campo: string;
  readonly producao: string;
  readonly aqui: string;
  /** O que essa diferença pode quebrar. Vem do contrato, não da imaginação. */
  readonly afeta: string;
}

interface ContratoAmbiente {
  readonly ambiente: string;
  readonly esperado: Record<string, string | number | null>;
  readonly critico_para: Record<string, string>;
  readonly provedores_esperados: readonly string[];
}

function lerContrato(): ContratoAmbiente {
  return JSON.parse(
    readFileSync(path.join(AQUI, 'contrato-ambiente.json'), 'utf8'),
  ) as ContratoAmbiente;
}

function gitCurto(args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch {
    return null;
  }
}

/**
 * O FUSO EFETIVO, e a diferença com `process.env.TZ` é o coração do arquivo.
 *
 * `TZ` pode estar ausente e o processo ainda rodar em UTC (é o caso do
 * contêiner do Railway) — ou estar declarada e ser ignorada. Ler a variável
 * responderia "o que alguém configurou"; o que interessa é "em que fuso este
 * processo está de fato", e isso só o deslocamento medido responde.
 *
 * Aqui `Intl` é legítimo, ao contrário do `OraculoRelogio`: este arquivo não
 * confere resposta da IARA, ele retrata o processo. Um retrato que erra junto
 * com o retratado ainda é o retrato certo.
 */
function fusoEfetivo(): { nome: string; offsetMin: number } {
  const offsetMin = -new Date().getTimezoneOffset();
  let nome = 'desconhecido';
  try {
    nome = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'desconhecido';
  } catch {
    /* Sem ICU completo. O deslocamento medido continua valendo, e é ele que
       decide se a hora sai certa. */
  }
  return { nome, offsetMin };
}

/** Quais cérebros ESTE processo declara — lido do ambiente, sem instanciar nada. */
function provedoresDoAmbiente(ambiente: NodeJS.ProcessEnv): string[] {
  /* A ORDEM É A DA CADEIA em `FabricaRaciocinio`, duplicada de propósito: este
     diretório não importa de `servidor/`, e é a mesma regra que faz o
     `OraculoJornal` reimplementar o HMAC. Se as duas divergirem, o relatório
     mostra uma ordem e a IARA usa outra — e é para isso que serve a comparação
     com `provedores_esperados`. */
  const par: ReadonlyArray<readonly [string, string]> = [
    ['groq', 'GROQ_API_KEY'],
    ['gemini', 'GEMINI_API_KEY'],
    ['openrouter', 'OPENROUTER_API_KEY'],
    ['anthropic', 'ANTHROPIC_API_KEY'],
    ['ollama', 'OLLAMA_URL'],
  ];
  const forcado = (ambiente.IARA_PROVEDOR ?? '').trim().toLowerCase();
  const vivos = par.filter(([, v]) => (ambiente[v] ?? '').trim().length > 0).map(([n]) => n);
  if (forcado && forcado !== 'auto') return vivos.includes(forcado) ? [forcado] : [];
  return vivos;
}

export function retratar(ambiente: NodeJS.ProcessEnv = process.env): RetratoDoAmbiente {
  const fuso = fusoEfetivo();
  const sujo = gitCurto(['status', '--porcelain']);
  return {
    node: process.version,
    node_major: Number(process.version.replace('v', '').split('.')[0]),
    plataforma: process.platform,
    release_so: os.release(),
    tz_efetivo: fuso.nome,
    tz_declarado: ambiente.TZ ?? null,
    offset_utc_min: fuso.offsetMin,
    locale: Intl.DateTimeFormat().resolvedOptions().locale ?? 'desconhecido',
    commit: gitCurto(['rev-parse', '--short', 'HEAD']),
    arvore_suja: sujo === null ? null : sujo.length > 0,
    provedores_declarados: provedoresDoAmbiente(ambiente),
    modelo_declarado: ambiente.IARA_MODELO ?? null,
    modo: ambiente.IARA_MODO ?? null,
  };
}

/**
 * O QUE DIFERE DE PRODUÇÃO. Lista vazia significa paridade — e é a única forma
 * de um relatório poder dizer "medido sob o contrato de produção" sem mentir.
 */
export function divergencias(r: RetratoDoAmbiente = retratar()): Divergencia[] {
  const c = lerContrato();
  const fora: Divergencia[] = [];
  const anotar = (campo: string, producao: string, aqui: string) => {
    if (producao !== aqui) {
      fora.push({ campo, producao, aqui, afeta: c.critico_para[campo] ?? '(não declarado)' });
    }
  };

  /* TZ é comparada pelo DESLOCAMENTO, não pelo nome: `UTC`, `Etc/UTC` e
     `Universal` são a mesma coisa para a hora que a operadora lê, e um relatório
     que acusa divergência entre sinônimos ensina a equipe a ignorar a seção. */
  const offsetEsperado = c.esperado.TZ === 'UTC' ? 0 : null;
  if (offsetEsperado !== null) {
    anotar('TZ', `UTC (offset 0)`, `${r.tz_efetivo} (offset ${r.offset_utc_min} min)`);
  }
  anotar('plataforma', String(c.esperado.plataforma), r.plataforma);
  anotar('NODE_MAJOR', String(c.esperado.NODE_MAJOR), String(r.node_major));

  const esperados = [...c.provedores_esperados].join(' → ');
  const aqui = [...r.provedores_declarados].join(' → ');
  if (esperados !== aqui) {
    fora.push({
      campo: 'provedores',
      producao: esperados,
      aqui: aqui || '(nenhum)',
      afeta:
        'a cadeia responde na ordem declarada; medir com outra ordem mede outra IARA, ' +
        'e a latência de um turno é a soma dos elos tentados',
    });
  }
  return fora;
}

/** As linhas que vão para o relatório da campanha. */
export function emMarkdown(r: RetratoDoAmbiente = retratar()): string[] {
  const fora = divergencias(r);
  const linhas = [
    '## Ambiente da medição',
    '',
    `- node ${r.node} · ${r.plataforma} ${r.release_so}`,
    `- fuso EFETIVO ${r.tz_efetivo} (offset ${r.offset_utc_min} min) · TZ declarada: ${r.tz_declarado ?? '(ausente)'}`,
    `- locale ${r.locale}`,
    `- commit ${r.commit ?? '(sem git)'}${r.arvore_suja ? ' — **árvore suja**' : ''}`,
    `- cérebros declarados: ${r.provedores_declarados.join(' → ') || '(nenhum)'}`,
    `- modelo: ${r.modelo_declarado ?? '(padrão)'} · modo: ${r.modo ?? '(padrão)'}`,
    '',
  ];
  if (fora.length === 0) {
    linhas.push('**Paridade com produção: sim.** Nenhuma divergência declarada.', '');
    return linhas;
  }
  linhas.push(
    `**Divergências em relação a produção: ${fora.length}.** O que passa aqui pode falhar lá,`,
    'e o inverso — cada linha diz exatamente o quê.',
    '',
    '| campo | produção | esta medição | o que isso afeta |',
    '|---|---|---|---|',
    ...fora.map((d) => `| ${d.campo} | ${d.producao} | ${d.aqui} | ${d.afeta} |`),
    '',
  );
  return linhas;
}
