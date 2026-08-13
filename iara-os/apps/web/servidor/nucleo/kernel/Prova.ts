/**
 * PROVA DETERMINÍSTICA — o selo que separa "está escrito no jornal" de
 * "eu escrevi isto".
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE, e que nenhum outro respondia:
 *
 *   o registro de autorização que estou lendo foi produzido por este sistema,
 *   ou apenas ENCONTRADO no lugar onde este sistema escreve?
 *
 * O DEFEITO que ele fecha, encontrado na auditoria zero-trust:
 *
 *   `RegistroOperacoes.reidratar` fazia `JSON.parse(linha) as Operacao` e
 *   confiava no resultado — inteiro. Uma linha acrescentada ao `.jsonl` por
 *   qualquer coisa com acesso ao disco entrava no índice do processo como
 *   operação legítima: com `estado: "verificada"` ela vira um efeito que a
 *   IARA jura ter conferido e nunca executou; com `id_usuario` de outra pessoa
 *   ela envenena `pendentesDeVerdade` e `porChave` de um terceiro.
 *
 *   O jornal É a trilha de auditoria do sistema. Trilha de auditoria que o
 *   próprio sistema não sabe distinguir de texto colado dentro dela não é
 *   evidência de nada — é um arquivo.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ, e é tão importante quanto o que faz:
 *
 *   ELE NÃO DECIDE SE UMA AÇÃO É PERMITIDA.
 *
 * Nenhuma política mora aqui. `PorteiroAutorizacao`, `PoliticaRisco` e o
 * `SandboxPorPolitica` continuam sendo os únicos lugares onde se decide. Este
 * módulo CARIMBA a decisão já tomada, de forma que ela possa ser reconhecida
 * mais tarde — e recusada quando não puder.
 *
 * SOBRE A CHAVE, sem eufemismo. Sem `IARA_CHAVE_PROVA` no ambiente não existe
 * garantia criptográfica nenhuma: quem pode escrever o jornal pode escrever o
 * selo. Nesse modo o sistema continua fazendo a validação ESTRUTURAL (formato,
 * dono, estado legal), que já barra o registro forjado grosseiro e a poluição
 * de índice entre operadores, e diz em voz alta que a garantia forte está
 * desligada. Prometer integridade com chave ausente seria a mesma mentira
 * operacional que o resto deste kernel combate.
 */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

// ---------------------------------------------------------------------------
// 1. Chave
// ---------------------------------------------------------------------------

const NOME_DA_CHAVE = 'IARA_CHAVE_PROVA';

/** Piso de entropia. Chave curta dá falsa sensação e é pior que nenhuma. */
const MINIMO_DA_CHAVE = 32;

export interface EstadoDaChave {
  readonly ativa: boolean;
  readonly motivo: string;
}

export function estadoDaChave(): EstadoDaChave {
  const bruta = process.env[NOME_DA_CHAVE]?.trim();
  if (!bruta) {
    return {
      ativa: false,
      motivo:
        `${NOME_DA_CHAVE} ausente: o jornal de operações é validado só por estrutura. ` +
        'Quem escrever no disco consegue forjar um registro de autorização.',
    };
  }
  if (bruta.length < MINIMO_DA_CHAVE) {
    return {
      ativa: false,
      motivo: `${NOME_DA_CHAVE} tem menos de ${MINIMO_DA_CHAVE} caracteres — tratada como ausente.`,
    };
  }
  return { ativa: true, motivo: '' };
}

function chave(): Buffer | null {
  const bruta = process.env[NOME_DA_CHAVE]?.trim();
  if (!bruta || bruta.length < MINIMO_DA_CHAVE) return null;
  return Buffer.from(bruta, 'utf8');
}

// ---------------------------------------------------------------------------
// 2. Canonicalização
// ---------------------------------------------------------------------------

/**
 * Serialização ESTÁVEL. `JSON.stringify` preserva ordem de inserção, e duas
 * cópias do mesmo objeto montadas por caminhos diferentes têm ordens
 * diferentes — a assinatura mudaria sem o conteúdo mudar. Ordenar as chaves,
 * recursivamente, é o que torna o selo reproduzível.
 */
export function canonico(valor: unknown): string {
  if (valor === undefined) return 'null';
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor) ?? 'null';
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  const pares = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`);
  return `{${pares.join(',')}}`;
}

/** SHA-256 hex do texto que o operador escreveu. Identidade da intenção. */
export function hashIntencao(enunciado: string): string {
  return createHash('sha256').update(enunciado, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// 3. Assinatura
// ---------------------------------------------------------------------------

/** Prefixo de domínio: um selo de jornal nunca vale como selo de prova. */
type Dominio = 'jornal' | 'prova';

function assinar(dominio: Dominio, corpo: string): string {
  const k = chave();
  if (!k) return '';
  return createHmac('sha256', k).update(`iara:${dominio}:v1:${corpo}`, 'utf8').digest('hex');
}

/**
 * Comparação em tempo constante. Não porque um atacante vá medir o relógio de
 * um `reidratar` — porque a alternativa é escrever `===` aqui e ensinar a
 * próxima pessoa que comparar MAC com `===` é aceitável.
 */
function selosIguais(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

// ---------------------------------------------------------------------------
// 4. Selo do jornal
// ---------------------------------------------------------------------------

/**
 * Os campos que o selo COBRE. Deliberadamente explícitos, e não "tudo menos o
 * selo": um campo novo em `Operacao` passaria a ser assinado sem ninguém
 * decidir isso, e um campo removido da cobertura passaria despercebido. Aqui,
 * acrescentar campo ao registro obriga a decidir se ele é matéria de
 * integridade — que é o momento em que se pensa sobre o assunto.
 */
export interface RegistroSelavel {
  readonly id_operacao: string;
  readonly chave_idempotencia: string;
  readonly id_usuario: string;
  readonly sessao: string;
  readonly habilidade: string;
  readonly risco: string;
  readonly semantica: string;
  readonly parametros: Readonly<Record<string, unknown>>;
  readonly estado: string;
  readonly nonce: string;
  readonly autorizada_em: string | null;
  readonly criada_em: string;
  readonly atualizada_em: string;
  readonly historico: readonly { fonte: string; descricao: string; instante: string }[];
}

function corpoDoRegistro(r: RegistroSelavel): string {
  return canonico({
    id_operacao: r.id_operacao,
    chave_idempotencia: r.chave_idempotencia,
    id_usuario: r.id_usuario,
    sessao: r.sessao,
    habilidade: r.habilidade,
    risco: r.risco,
    semantica: r.semantica,
    parametros: r.parametros,
    estado: r.estado,
    nonce: r.nonce,
    autorizada_em: r.autorizada_em,
    criada_em: r.criada_em,
    atualizada_em: r.atualizada_em,
    historico: r.historico,
  });
}

/** Sela uma linha do jornal. String vazia quando não há chave configurada. */
export function selarRegistro(r: RegistroSelavel): string {
  return assinar('jornal', corpoDoRegistro(r));
}

export type VereditoSelo =
  /** Selo confere. */
  | 'valido'
  /** Selo ausente ou não confere. Com chave ativa, isto é adulteração. */
  | 'invalido'
  /** Não há chave: nada a conferir, e dizer "válido" seria mentira. */
  | 'sem_chave';

export function conferirRegistro(r: RegistroSelavel, selo: unknown): VereditoSelo {
  if (!chave()) return 'sem_chave';
  if (typeof selo !== 'string') return 'invalido';
  return selosIguais(selo, assinar('jornal', corpoDoRegistro(r))) ? 'valido' : 'invalido';
}

// ---------------------------------------------------------------------------
// 5. Prova de decisão
// ---------------------------------------------------------------------------

/**
 * As invariantes que precisam ter sido conferidas ANTES de um efeito alcançar
 * o mundo. A lista é o contrato: `emitirProva` recusa emitir se alguma faltar,
 * e o portal recusa executar sem prova.
 *
 * Não são conferidas AQUI — cada uma é conferida por quem tem competência para
 * isso, e o que chega aqui é o resultado. Reconferir neste módulo criaria uma
 * segunda política, e política em dois lugares é política em nenhum.
 */
export const INVARIANTES_OBRIGATORIAS = [
  /** O `id_usuario` do efeito é o da sessão verificada, não um campo do pedido. */
  'ISOLAMENTO_SHARD',
  /** Parâmetros passaram por `validar` contra o esquema declarado. */
  'PARAMETROS_VALIDADOS',
  /** A habilidade declarou o que acontece se rodar duas vezes. */
  'SEMANTICA_DECLARADA',
  /** A fonte de autorização é tipada, e risco alto exige `operador`. */
  'AUTORIZACAO_TIPADA',
  /** O turno que originou o pedido é identificável no jornal. */
  'ORIGEM_RASTREAVEL',
] as const;

export type Invariante = (typeof INVARIANTES_OBRIGATORIAS)[number];

export interface ReivindicacoesAutorizacao {
  readonly id_usuario: string;
  readonly sessao: string;
  readonly papel: string;
  readonly escopo: readonly string[];
}

export interface AvaliacaoPolitica {
  readonly permitido: boolean;
  /** Nome da regra que decidiu. Vai para o log de auditoria. */
  readonly politica: string;
  readonly risco: string;
  readonly fonte_autorizacao: string;
}

/**
 * O objeto de prova executável. Formato de AUDITORIA, não de transporte: ele
 * existe para que alguém, seis meses depois, consiga responder "quem autorizou
 * isto, com que parâmetros, sob qual regra" sem ler código.
 */
export interface ProvaDeterministica {
  readonly id_acao: string;
  readonly hash_intencao: string;
  readonly parametros: Readonly<Record<string, unknown>>;
  readonly reivindicacoes: ReivindicacoesAutorizacao;
  readonly avaliacao: AvaliacaoPolitica;
  readonly invariantes: readonly Invariante[];
  readonly emitida_em: string;
  /** HMAC-SHA256. Vazia quando não há chave — ver o cabeçalho do arquivo. */
  readonly assinatura: string;
}

export class ProvaRecusada extends Error {}

/**
 * Emite a prova. LANÇA quando falta invariante — e lançar é o desenho:
 * `Status != VERIFIED_PROOF => ABORT` não pode ser um `if` que alguém esquece
 * de escrever no caminho novo. Quem não consegue emitir prova não executa,
 * porque a emissão está NO caminho da execução, não ao lado dele.
 */
export function emitirProva(entrada: {
  id_acao: string;
  enunciado: string;
  parametros: Readonly<Record<string, unknown>>;
  reivindicacoes: ReivindicacoesAutorizacao;
  avaliacao: AvaliacaoPolitica;
  invariantes: readonly Invariante[];
}): ProvaDeterministica {
  const faltando = INVARIANTES_OBRIGATORIAS.filter((i) => !entrada.invariantes.includes(i));
  if (faltando.length > 0) {
    throw new ProvaRecusada(`invariante não conferida: ${faltando.join(', ')}`);
  }
  if (!entrada.avaliacao.permitido) {
    throw new ProvaRecusada(`política "${entrada.avaliacao.politica}" recusou a ação`);
  }
  if (!entrada.reivindicacoes.id_usuario) {
    throw new ProvaRecusada('prova sem id_usuario: efeito sem dono não executa');
  }

  const nucleo = {
    id_acao: entrada.id_acao,
    hash_intencao: hashIntencao(entrada.enunciado),
    parametros: entrada.parametros,
    reivindicacoes: entrada.reivindicacoes,
    avaliacao: entrada.avaliacao,
    invariantes: [...entrada.invariantes].sort() as readonly Invariante[],
    emitida_em: new Date().toISOString(),
  };

  return { ...nucleo, assinatura: assinar('prova', canonico(nucleo)) };
}

export function conferirProva(p: ProvaDeterministica): VereditoSelo {
  if (!chave()) return 'sem_chave';
  const { assinatura, ...nucleo } = p;
  return selosIguais(assinatura, assinar('prova', canonico(nucleo))) ? 'valido' : 'invalido';
}
