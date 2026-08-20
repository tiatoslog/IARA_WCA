/**
 * QUAL CÓDIGO ESTÁ ATENDENDO — a identidade do backend, carimbada.
 *
 * POR QUE ISTO EXISTE, e o pedido veio da auditoria de 20/08/2026 antes de
 * liberar o push:
 *
 *     "Você consegue provar 'o Railway respondeu', mas não 'o Railway respondeu
 *      usando exatamente o código que acabou de ser auditado'."
 *
 * É a lição de 16/08 com outra roupa — *"o ambiente da nuvem diverge do
 * local"* — e o custo dela é sempre o mesmo: uma tarde comparando o
 * comportamento de um localhost consertado com um servidor que roda outro
 * commit, e tirando conclusões sobre arquitetura a partir de uma diferença de
 * deploy. Com o sha ao lado de cada execução, "funciona local e não funciona no
 * Railway" deixa de ser investigação e vira uma linha.
 *
 * ================= A REGRA: NÃO INVENTAR =================
 *
 * Mesma disciplina de `lerStatusDaMaquina` e de `Cobertura.percentual`. Um
 * `git_sha` chutado é PIOR que `null`: `null` faz alguém ir procurar, e um sha
 * errado faz alguém PARAR de procurar — com a conclusão errada na mão.
 *
 * Cada campo declara de onde veio, e a ausência é um valor legítimo:
 *
 *   `ambiente` — `IARA_GIT_SHA` ou `RAILWAY_GIT_COMMIT_SHA`, carimbados pelo
 *                pipeline que construiu a imagem. É a fonte mais confiável
 *                porque é a única que sabe o que foi PUBLICADO.
 *   `disco`    — `.git/HEAD` resolvido à mão, para o motor de desenvolvimento.
 *                Sem `execFile`: ler dois arquivos é mais barato e não depende
 *                de `git` existir no contêiner.
 *   `nenhuma`  — e aí `git_sha` é `null`, dito em voz alta.
 *
 * ================= O QUE ELE NÃO GUARDA =================
 *
 * Nada que venha de credencial. A identidade viaja junto de cada execução no
 * jornal e vai para o `/saude`, que responde SEM LOGIN — é o healthcheck do
 * host. Um campo a mais aqui é um campo publicado na internet.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

export type OrigemDoSha = 'ambiente' | 'disco' | 'nenhuma';
export type AmbienteDeclarado = 'producao' | 'desenvolvimento' | 'desconhecido';

export interface IdentidadeBackend {
  /** `package.json`. `null` quando não deu para ler — nunca "0.0.0". */
  readonly versao: string | null;
  readonly git_sha: string | null;
  /** Os 7 primeiros: é o que se lê num relatório. */
  readonly git_sha_curto: string | null;
  readonly git_origem: OrigemDoSha;
  readonly ambiente: AmbienteDeclarado;
  /** ISO do momento em que ESTE processo subiu. Ver `INICIO_DO_PROCESSO`. */
  readonly iniciado_em: string;
}

/**
 * Carimbado UMA vez, na carga do módulo.
 *
 * Duas linhas do jornal do mesmo turno não podem discordar sobre quando o
 * processo começou — e `new Date()` dentro da função faria exatamente isso.
 */
const INICIO_DO_PROCESSO = new Date().toISOString();

/** Um sha é 40 hexadecimais. Qualquer outra coisa não é um sha. */
const EH_SHA = /^[0-9a-f]{40}$/i;

function shaDoAmbiente(env: Record<string, string | undefined>): string | null {
  for (const nome of ['IARA_GIT_SHA', 'RAILWAY_GIT_COMMIT_SHA', 'GIT_COMMIT_SHA']) {
    const bruto = (env[nome] ?? '').trim();
    if (EH_SHA.test(bruto)) return bruto.toLowerCase();
  }
  return null;
}

/**
 * `.git/HEAD` lido à mão, sem `git` e sem `execFile`.
 *
 * `HEAD` tem duas formas: `ref: refs/heads/main` (o normal) ou o sha cru (HEAD
 * destacado — o estado de um checkout por commit, que é como CI costuma
 * trabalhar). As duas são tratadas; qualquer terceira devolve `null`.
 */
/**
 * A PASTA DE METADADOS DO GIT, subindo a árvore — e as duas descobertas que
 * esta função custou, as duas medidas na subida real de 20/08/2026
 * (`[iara] código: v1.0.0 · sha desconhecido`):
 *
 *   1. O app mora em `iara-os/apps/web/` e o `.git` fica na RAIZ do
 *      repositório, três níveis acima. Procurar só ao lado devolve `null` no
 *      layout normal deste projeto.
 *
 *   2. Neste repositório `.git` é um ARQUIVO, não uma pasta: `IARA_WCA` é um
 *      submódulo, e submódulo guarda `gitdir: ../.git/modules/<nome>` num
 *      arquivo de uma linha. Um leitor que só abre `.git/HEAD` como pasta
 *      falha exatamente no caso desta casa.
 *
 * O teto de subida é curto de propósito: sem ele, um processo rodando em
 * `/app` dentro de um contêiner varreria a raiz do sistema atrás de um `.git`
 * que não existe, e poderia encontrar o de OUTRO projeto montado por acaso.
 */
function pastaDoGit(raiz: string): string | null {
  let atual = path.resolve(raiz);

  for (let nivel = 0; nivel < 6; nivel += 1) {
    const marca = path.join(atual, '.git');
    try {
      const conteudo = readFileSync(marca, 'utf8');
      /* Leu como arquivo: é submódulo (ou worktree), e o caminho real está
         dentro, relativo a esta pasta. */
      const apontado = /^gitdir:\s*(.+)$/m.exec(conteudo)?.[1]?.trim();
      if (apontado) return path.resolve(atual, apontado);
    } catch (e) {
      /* `EISDIR` é o caso COMUM: `.git` é a pasta de metadados, e achá-la
         assim é sucesso, não erro. */
      if ((e as NodeJS.ErrnoException).code === 'EISDIR') return marca;
    }

    const acima = path.dirname(atual);
    if (acima === atual) break;
    atual = acima;
  }
  return null;
}

function shaDoDisco(raiz: string): string | null {
  try {
    const git = pastaDoGit(raiz);
    if (!git) return null;

    const head = readFileSync(path.join(git, 'HEAD'), 'utf8').trim();

    if (EH_SHA.test(head)) return head.toLowerCase();

    const ref = /^ref:\s*(.+)$/.exec(head)?.[1]?.trim();
    if (!ref) return null;

    const alvo = readFileSync(path.join(git, ref), 'utf8').trim();
    return EH_SHA.test(alvo) ? alvo.toLowerCase() : null;
  } catch {
    /* Sem repositório: é o caso normal de uma imagem publicada, não um erro.
       Quem publica carimba a variável de ambiente. */
    return null;
  }
}

function versaoDoPacote(raiz: string): string | null {
  try {
    const bruto = readFileSync(path.join(raiz, 'package.json'), 'utf8');
    const v = (JSON.parse(bruto) as { version?: unknown }).version;
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
  } catch {
    return null;
  }
}

function ambienteDeclarado(env: Record<string, string | undefined>): AmbienteDeclarado {
  const declarado = (env.IARA_AMBIENTE ?? '').trim().toLowerCase();
  if (declarado === 'producao' || declarado === 'production') return 'producao';
  if (declarado === 'desenvolvimento' || declarado === 'development') return 'desenvolvimento';

  const node = (env.NODE_ENV ?? '').trim().toLowerCase();
  if (node === 'production') return 'producao';
  if (node === 'development') return 'desenvolvimento';

  /* Nem o operador declarou, nem o runtime: dizer "produção" por padrão faria
     um log de desenvolvimento se passar por um de produção no dia do
     incidente. */
  return 'desconhecido';
}

export function lerIdentidadeBackend(entrada?: {
  ambiente?: Record<string, string | undefined>;
  raiz?: string;
}): IdentidadeBackend {
  const env = entrada?.ambiente ?? process.env;
  const raiz = entrada?.raiz ?? RAIZ_DO_APP;

  const doAmbiente = shaDoAmbiente(env);
  const git_sha = doAmbiente ?? shaDoDisco(raiz);
  const git_origem: OrigemDoSha = doAmbiente ? 'ambiente' : git_sha ? 'disco' : 'nenhuma';

  return {
    versao: versaoDoPacote(raiz),
    git_sha,
    git_sha_curto: git_sha ? git_sha.slice(0, 7) : null,
    git_origem,
    ambiente: ambienteDeclarado(env),
    iniciado_em: INICIO_DO_PROCESSO,
  };
}

/** A raiz do app — dois níveis acima de `servidor/nucleo/`. */
const RAIZ_DO_APP = path.resolve(import.meta.dirname, '..', '..');

/**
 * A identidade DESTE processo, resolvida uma vez.
 *
 * Uma vez e não por chamada: ela vai ao lado de cada execução no jornal, e ler
 * o disco a cada linha seria pagar E/S por um valor que não muda enquanto o
 * processo vive.
 */
export const identidadeBackend: IdentidadeBackend = lerIdentidadeBackend();

/** Uma linha para o console da subida. */
export function frasearIdentidade(id: IdentidadeBackend = identidadeBackend): string {
  const sha = id.git_sha_curto ? `${id.git_sha_curto} (${id.git_origem})` : 'sha desconhecido';
  return `v${id.versao ?? '?'} · ${sha} · ambiente ${id.ambiente}`;
}
