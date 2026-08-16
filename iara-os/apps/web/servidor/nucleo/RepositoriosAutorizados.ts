/**
 * ONDE UM AGENTE DE CÓDIGO PODE TRABALHAR — a allowlist, e a trava inteira
 * desta capacidade.
 *
 * A DECISÃO CENTRAL, e ela é de FORMA, não de validação: o operador (e a LLM
 * que interpreta o operador) nunca informa um CAMINHO. Informa um APELIDO.
 *
 * A diferença não é estilística. Uma habilidade que aceitasse caminho precisaria
 * defender-se de `..\..\Windows\System32`, de `\\servidor\share`, de link
 * simbólico apontando para fora, de `C:/Windows` com barra trocada, de
 * `%SystemRoot%`, de caminho curto 8.3 (`C:\PROGRA~1`), de UNC com prefixo
 * `\\?\`. Cada uma dessas é uma regra que alguém precisa lembrar de escrever, e
 * a que faltar é a que vai ser usada. Sem parâmetro de caminho não há nada a
 * escapar: `abra o Claude Code em C:\Windows\System32` não resolve para
 * repositório nenhum, pelo mesmo motivo que "abra o formatador de disco" não
 * resolve para aplicativo nenhum em `AgenteLocal`.
 *
 * É a mesma trava da allowlist de aplicativos, e é deliberado que se pareçam:
 * quem ler as duas deve reconhecer o padrão em vez de inventar um terceiro.
 *
 * A LISTA É DECLARADA, NUNCA DESCOBERTA. Nada neste repositório auto-descobre
 * infraestrutura, e varrer o disco atrás de pastas com `.git` seria a pior
 * versão possível disso — a IARA ganharia acesso a todo projeto que a operadora
 * já clonou, incluindo os que ela nem lembra que existem.
 *
 * O ADMINISTRADOR TAMBÉM ERRA, e por isso a configuração é validada na leitura
 * em vez de ser obedecida. `IARA_REPOS_AGENTE=sistema=C:\Windows\System32` é
 * uma entrada sintaticamente perfeita, e ela é recusada com motivo — alto e
 * claro no log, e visível no diagnóstico. Uma allowlist que aceita qualquer
 * coisa que caiba na variável de ambiente não é uma allowlist.
 */

import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { lerConfig, type Ambiente } from './kernel/Configuracao';

/** A variável que liga a capacidade. Ausente = capacidade desligada, e o
 *  diagnóstico diz isso em vez de a IARA fingir que não existe repositório. */
export const VARIAVEL_REPOS = 'IARA_REPOS_AGENTE';

export interface RepositorioAutorizado {
  /** Como o operador se refere a ele: `iara`, `site`, `braço`. */
  readonly apelido: string;
  /** Caminho absoluto e normalizado. Nunca vem de parâmetro de habilidade. */
  readonly caminho: string;
}

export interface EntradaRecusada {
  readonly bruto: string;
  readonly motivo: string;
}

export interface Allowlist {
  readonly autorizados: readonly RepositorioAutorizado[];
  /** Entradas presentes na variável e RECUSADAS. Aparecem no diagnóstico:
   *  configuração silenciosamente ignorada é pior que configuração ausente. */
  readonly recusadas: readonly EntradaRecusada[];
}

/**
 * Raízes que nenhum apelido pode alcançar, nem por configuração.
 *
 * Não é uma lista de "lugares perigosos" — é a lista de lugares que não são
 * projeto de ninguém. Um agente de código solto em `System32` ou em `/etc` não
 * é uma configuração ousada; é um acidente esperando data.
 *
 * A comparação é feita sobre o caminho JÁ resolvido (`path.resolve`), então
 * `C:\projetos\..\Windows` cai aqui igual a `C:\Windows`.
 */
const RAIZES_PROIBIDAS = [
  'c:\\windows',
  'c:\\program files',
  'c:\\program files (x86)',
  'c:\\programdata',
  '/etc',
  '/usr',
  '/bin',
  '/sbin',
  '/boot',
  '/dev',
  '/proc',
  '/sys',
  '/var/lib',
  '/system',
  '/library',
];

/** Normaliza para comparação: resolvido, sem barra final, minúsculo. */
function paraComparacao(caminho: string): string {
  const resolvido = path.resolve(caminho).replace(/[\\/]+$/, '');
  return resolvido.toLowerCase().replace(/\//g, path.sep === '\\' ? '\\' : '/');
}

/** `alvo` está DENTRO de `raiz` (ou é a própria raiz)? Compara por segmento —
 *  `C:\windows-projetos` não é filho de `C:\windows`. */
function dentroDe(alvo: string, raiz: string): boolean {
  const a = paraComparacao(alvo);
  const r = paraComparacao(raiz);
  if (a === r) return true;
  const separador = r.includes('\\') ? '\\' : '/';
  return a.startsWith(r.endsWith(separador) ? r : r + separador);
}

/** O apelido é chave de allowlist: forma estreita, sem caminho disfarçado. */
const APELIDO_VALIDO = /^[a-z0-9][a-z0-9_-]{0,31}$/;

/**
 * Valida UMA entrada. Devolve o motivo da recusa, ou `null` quando serve.
 *
 * A ordem das checagens é a ordem do custo: forma antes de disco, porque uma
 * variável malformada não deve provocar acesso a sistema de arquivos.
 */
export function motivoDeRecusa(apelido: string, caminho: string): string | null {
  if (!APELIDO_VALIDO.test(apelido)) {
    return `apelido "${apelido}" fora do formato (minúsculas, dígitos, hífen ou sublinhado, até 32)`;
  }
  if (!caminho) return 'caminho vazio';
  if (!path.isAbsolute(caminho)) return `"${caminho}" não é caminho absoluto`;
  /* UNC e caminho estendido nunca entram: o alvo é a máquina da operadora, e um
     share de rede muda quem é o dono do que o agente vai editar. */
  if (/^\\\\/.test(caminho)) return `"${caminho}" é caminho de rede (UNC) — só disco local`;

  const resolvido = path.resolve(caminho);
  for (const raiz of RAIZES_PROIBIDAS) {
    if (dentroDe(resolvido, raiz)) return `"${resolvido}" fica dentro de ${raiz} — área de sistema`;
  }

  if (!existsSync(resolvido)) return `"${resolvido}" não existe nesta máquina`;
  if (!statSync(resolvido).isDirectory()) return `"${resolvido}" não é uma pasta`;
  /**
   * EXIGIR `.git` não é preciosismo de ferramenta: é o que impede um apelido de
   * apontar para a pasta de Documentos inteira, ou para a raiz de um disco. Um
   * repositório tem fronteira conhecida e histórico — o que o agente fizer lá
   * dentro é revisável e reversível. Fora de um repositório, não é.
   *
   * `.git` é ARQUIVO num submódulo e PASTA num clone normal; `existsSync` cobre
   * os dois, e o `IARA_WCA` deste projeto é justamente o primeiro caso.
   */
  if (!existsSync(path.join(resolvido, '.git'))) {
    return `"${resolvido}" não é um repositório git (sem .git)`;
  }
  return null;
}

/**
 * Lê a allowlist do ambiente.
 *
 * Formato: `apelido=caminho` separados por `;` — o separador é o ponto e vírgula
 * porque `:` e `,` aparecem dentro de caminho no Windows (`C:\...`).
 *
 * Nunca lança. Entrada ruim vira `recusadas`, e a lista boa continua valendo:
 * um apelido malformado não pode desligar os outros três que estavam certos.
 */
export function lerAllowlist(ambiente: Ambiente = process.env): Allowlist {
  const bruto = (lerConfig(VARIAVEL_REPOS, ambiente) ?? '').trim();
  if (!bruto) return { autorizados: [], recusadas: [] };

  const autorizados: RepositorioAutorizado[] = [];
  const recusadas: EntradaRecusada[] = [];
  const vistos = new Set<string>();

  for (const pedaco of bruto.split(';')) {
    const entrada = pedaco.trim();
    if (!entrada) continue;

    const igual = entrada.indexOf('=');
    if (igual <= 0) {
      recusadas.push({ bruto: entrada, motivo: 'falta `apelido=caminho`' });
      continue;
    }
    const apelido = entrada.slice(0, igual).trim().toLowerCase();
    const caminho = entrada.slice(igual + 1).trim();

    const motivo = motivoDeRecusa(apelido, caminho);
    if (motivo) {
      recusadas.push({ bruto: entrada, motivo });
      continue;
    }
    /* Apelido repetido: fica o PRIMEIRO. Deixar o último vencer permitiria que
       uma entrada acrescentada no fim da variável sequestrasse um apelido já
       conhecido pela operadora. */
    if (vistos.has(apelido)) {
      recusadas.push({ bruto: entrada, motivo: `apelido "${apelido}" repetido — vale a primeira` });
      continue;
    }
    vistos.add(apelido);
    autorizados.push({ apelido, caminho: path.resolve(caminho) });
  }

  return { autorizados, recusadas };
}

/**
 * Resolve o que o operador disse para UM repositório autorizado.
 *
 * Casa por apelido exato primeiro; só depois por apelido contido na frase, do
 * mais longo para o mais curto — a mesma disciplina de `resolverAplicativo`,
 * para que `iara-wca` ganhe de `iara` quando os dois existem.
 *
 * Devolve `null` para qualquer coisa que não seja um apelido conhecido. É aqui
 * que `C:\Windows\System32` morre: ele não é apelido de nada.
 */
export function resolverRepositorio(
  pedido: string,
  ambiente: Ambiente = process.env,
): RepositorioAutorizado | null {
  const alvo = (pedido ?? '').trim().toLowerCase();
  if (!alvo) return null;

  const { autorizados } = lerAllowlist(ambiente);
  const exato = autorizados.find((r) => r.apelido === alvo);
  if (exato) return exato;

  const porTamanho = [...autorizados].sort((a, b) => b.apelido.length - a.apelido.length);
  for (const repo of porTamanho) {
    /* Fronteira de palavra: `iara` não casa dentro de `iarada`. */
    if (new RegExp(`(^|[^a-z0-9])${repo.apelido}([^a-z0-9]|$)`).test(alvo)) return repo;
  }
  return null;
}

/** A frase que a IARA usa para dizer o que conhece. Vazia nunca: quando não há
 *  nada configurado, ela precisa dizer QUE não há e COMO configurar. */
export function repositoriosDisponiveis(ambiente: Ambiente = process.env): string {
  const { autorizados } = lerAllowlist(ambiente);
  if (autorizados.length === 0) {
    return `nenhum — ${VARIAVEL_REPOS} não está configurada neste computador`;
  }
  return autorizados.map((r) => r.apelido).join(', ');
}
