/**
 * ORÁCULO DO JORNAL — lê o `.jsonl` de operações direto do disco e RECALCULA o
 * selo por conta própria.
 *
 * Por que não importar `Prova.ts` e chamar `conferirRegistro`: porque aí o
 * verificador seria o mesmo código que assinou. Se o kernel selar o corpo
 * errado — um campo a mais, um a menos, a ordem trocada — ele conferiria o
 * próprio erro e daria válido, para sempre, com a serenidade de quem tem
 * teste verde. A reimplementação independente é o que transforma o selo de
 * "afirmação sobre integridade" em "integridade".
 *
 * O PREÇO, declarado: este arquivo duplica um algoritmo. Se `Prova.ts` mudar a
 * cobertura do selo e este arquivo não mudar junto, a campanha acusa
 * `invalido` num jornal íntegro. Isso é ruído, não é perda de segurança — e é
 * ruído barulhento, que aparece na primeira rodada. O modo de falhar oposto
 * (confiar no verificador do próprio autor) é silencioso e dura anos. Entre um
 * alarme falso ruidoso e uma garantia falsa muda, esta campanha escolhe o
 * alarme, e a escolha está escrita aqui para quem mexer no selo saber onde ir.
 *
 * O contrato duplicado está congelado em `testes/campanha-oraculos.test.ts`,
 * que sela um registro com `Prova.ts` e confere com este módulo: no dia em que
 * os dois divergirem, é esse teste que avisa — não uma campanha às 3 da manhã.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export type VereditoSelo = 'valido' | 'invalido' | 'sem_chave' | 'ausente';

export interface LinhaDoJornal {
  readonly id_operacao: string;
  readonly habilidade: string;
  readonly estado: string;
  readonly risco: string;
  readonly semantica: string;
  readonly sessao: string;
  readonly parametros: Record<string, unknown>;
  readonly criada_em: string;
  readonly atualizada_em: string;
  readonly historico: readonly { fonte: string; descricao: string; instante: string }[];
  /** Veredito do selo, apurado POR ESTE módulo. */
  readonly selo: VereditoSelo;
  /** A linha crua, para o relatório de evidência. */
  readonly bruto: Record<string, unknown>;
}

/**
 * Serialização estável. Cópia deliberada de `Prova.canonico` — ver o cabeçalho.
 */
function canonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`)
    .join(',')}}`;
}

/** Os campos que o selo do jornal cobre, na ordem que o canônico ordena. */
const COBERTOS = [
  'id_operacao',
  'chave_idempotencia',
  'id_usuario',
  'sessao',
  'habilidade',
  'risco',
  'semantica',
  'parametros',
  'estado',
  'nonce',
  'autorizada_em',
  'criada_em',
  'atualizada_em',
  'historico',
] as const;

const MINIMO_DA_CHAVE = 32;

function chave(ambiente: NodeJS.ProcessEnv): Buffer | null {
  const bruta = ambiente.IARA_CHAVE_PROVA?.trim();
  if (!bruta || bruta.length < MINIMO_DA_CHAVE) return null;
  return Buffer.from(bruta, 'utf8');
}

function conferirSelo(
  linha: Record<string, unknown>,
  selo: unknown,
  ambiente: NodeJS.ProcessEnv,
): VereditoSelo {
  const k = chave(ambiente);
  if (!k) return 'sem_chave';
  if (typeof selo !== 'string' || !selo) return 'ausente';
  const corpo: Record<string, unknown> = {};
  for (const campo of COBERTOS) corpo[campo] = linha[campo];
  const esperado = createHmac('sha256', k)
    .update(`iara:jornal:v1:${canonico(corpo)}`, 'utf8')
    .digest('hex');
  if (selo.length !== esperado.length) return 'invalido';
  return timingSafeEqual(Buffer.from(selo, 'utf8'), Buffer.from(esperado, 'utf8'))
    ? 'valido'
    : 'invalido';
}

/**
 * Lê o jornal de um operador.
 *
 * O jornal é APPEND-ONLY: a mesma operação aparece uma vez por transição, e a
 * ÚLTIMA linha de cada `id_operacao` é o estado corrente. Colapsar por id na
 * leitura é o que faz "a operação está `verificada`?" ter uma resposta em vez
 * de dez.
 *
 * Nunca lança: jornal ausente devolve lista vazia, porque "nenhuma operação de
 * escrita aconteceu" é um resultado legítimo — e o mais comum nas missões de
 * segurança, onde ele é justamente a prova.
 */
export function lerJornal(
  raizOperacoes: string,
  idUsuario: string,
  ambiente: NodeJS.ProcessEnv = process.env,
): LinhaDoJornal[] {
  let bruto: string;
  try {
    bruto = readFileSync(path.join(raizOperacoes, `${idUsuario}.jsonl`), 'utf8');
  } catch {
    return [];
  }
  const porId = new Map<string, LinhaDoJornal>();
  for (const linha of bruto.split('\n')) {
    const texto = linha.trim();
    if (!texto) continue;
    let dado: Record<string, unknown>;
    try {
      dado = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      continue; // linha truncada por queda no meio da escrita: não é operação
    }
    const id = typeof dado.id_operacao === 'string' ? dado.id_operacao : '';
    if (!id) continue;
    const { selo, ...semSelo } = dado;
    porId.set(id, {
      id_operacao: id,
      habilidade: String(dado.habilidade ?? ''),
      estado: String(dado.estado ?? ''),
      risco: String(dado.risco ?? ''),
      semantica: String(dado.semantica ?? ''),
      sessao: String(dado.sessao ?? ''),
      parametros: (dado.parametros ?? {}) as Record<string, unknown>,
      criada_em: String(dado.criada_em ?? ''),
      atualizada_em: String(dado.atualizada_em ?? ''),
      historico: Array.isArray(dado.historico)
        ? (dado.historico as LinhaDoJornal['historico'])
        : [],
      selo: conferirSelo(semSelo, selo, ambiente),
      bruto: dado,
    });
  }
  return [...porId.values()];
}

/**
 * As operações abertas nesta sessão, na ordem em que foram criadas.
 *
 * `sessao` entra no filtro porque duas conversas do mesmo operador podem ter
 * pedido a mesma coisa, e a operação de uma não responde pela outra — é a
 * mesma razão pela qual `Braco.ultimoDe` inclui a sessão na chave.
 */
export function operacoesDaSessao(linhas: readonly LinhaDoJornal[], sessao: string): LinhaDoJornal[] {
  return linhas
    .filter((l) => l.sessao === sessao)
    .sort((a, b) => a.criada_em.localeCompare(b.criada_em));
}

/**
 * Alguma linha do jornal está adulterada?
 *
 * `sem_chave` NÃO é adulteração — é a garantia forte desligada, e dizer
 * "íntegro" nesse modo seria a mentira que este kernel combate. Quem chama
 * decide o que fazer com a diferença; o relatório da campanha registra as duas
 * separadamente.
 */
export function seloComprometido(linhas: readonly LinhaDoJornal[]): LinhaDoJornal[] {
  return linhas.filter((l) => l.selo === 'invalido' || l.selo === 'ausente');
}
