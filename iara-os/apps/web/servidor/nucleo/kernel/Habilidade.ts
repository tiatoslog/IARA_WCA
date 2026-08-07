/**
 * Contrato de Habilidade — o "App Intent" da IARA.
 *
 * A IARA nunca chama código diretamente. Ela declara que quer uma habilidade,
 * e o `GerenciadorHabilidades` decide se pode, valida os parâmetros, aplica
 * timeout e registra auditoria. O executor nunca é invocado sem passar por
 * essas quatro portas.
 *
 * Manifesto em TypeScript, não em `manifest.json`: o esquema precisa ser
 * verificado em tempo de compilação junto com o executor. JSON separado do
 * código é como se cria manifesto que mente sobre o que a habilidade faz.
 */

import type { CapacidadeAtiva } from '../../../lib/estado';
import type { Dominio } from '../../../lib/capacidades';

export type Permissao =
  | 'rede' // fala com a internet
  | 'banco' // lê dados da operação
  | 'memoria' // lê o shard privado do operador
  | 'llm' // gasta tokens
  | 'escrita'; // altera algo fora do processo

/** Validação em runtime dos parâmetros. Simples de propósito: o kernel
 *  precisa disso rápido e sem dependência de biblioteca de schema. */
export interface CampoEsquema {
  tipo: 'texto' | 'numero' | 'booleano';
  obrigatorio?: boolean;
  /** Valores aceitos. Ausente = qualquer um do tipo. */
  dentre?: readonly string[];
  padrao?: unknown;
}

export type Esquema = Record<string, CampoEsquema>;

export interface ManifestoHabilidade {
  /** Verbo + objeto, em português: `consultar_clima`, `buscar_historico`. */
  readonly id: string;
  readonly nome: string;
  /**
   * Escrita PARA A LLM ler ao planejar, não para humano ler em documentação.
   * Descrição vaga produz plano vago — é o insumo mais barato de melhorar e o
   * mais fácil de negligenciar.
   */
  readonly descricao: string;
  /** Família a que pertence. Define o agrupamento no manifesto e na projeção. */
  readonly dominio: Dominio;
  /** Qual objeto da sala acende enquanto esta habilidade roda. */
  readonly capacidade: CapacidadeAtiva;
  readonly permissoes: readonly Permissao[];
  readonly timeout_ms: number;
  readonly custo: 'zero' | 'tokens';
  readonly esquema: Esquema;
}

export interface ContextoHabilidade {
  readonly sessao: string;
  readonly id_usuario: string;
  readonly parametros: Record<string, unknown>;
  readonly sinal: AbortSignal;
  /** Texto original do operador. Algumas habilidades precisam do bruto. */
  readonly enunciado: string;
}

export interface ResultadoHabilidade {
  /** O que vira resposta ao operador (ou insumo do próximo passo). */
  readonly texto: string;
  /** Uma linha para o console técnico. Nunca payload cru. */
  readonly detalhe: string;
  /** Habilidade pode declarar que não resolveu sem ser um erro. */
  readonly resolveu: boolean;
}

export interface Habilidade {
  readonly manifesto: ManifestoHabilidade;
  /**
   * Faltou credencial ou dependência? Devolve o motivo; `null` significa
   * pronta para uso.
   *
   * Habilidade indisponível continua NO CATÁLOGO, e isso é deliberado: some do
   * que o Planejador pode pedir, mas aparece no manifesto para o operador ver
   * o que a IARA poderia fazer e o que falta ligar. Esconder o desligado é o
   * que faz um sistema parecer limitado quando na verdade está desconfigurado.
   */
  indisponivelPorque?(): string | null;
  executar(ctx: ContextoHabilidade): Promise<ResultadoHabilidade>;
}

/** Pronta para uso agora? */
export function disponivel(h: Habilidade): boolean {
  return !h.indisponivelPorque || h.indisponivelPorque() === null;
}

// ---------------------------------------------------------------------------

export class ParametroInvalido extends Error {}
export class PermissaoNegada extends Error {}
export class HabilidadeExpirou extends Error {}

/**
 * Valida e normaliza contra o esquema. Rejeita chave desconhecida: parâmetro
 * que ninguém declarou é a porta por onde entra injeção vinda de um plano
 * gerado por LLM.
 */
export function validar(esquema: Esquema, entrada: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const chave of Object.keys(entrada)) {
    if (!(chave in esquema)) {
      throw new ParametroInvalido(`parâmetro não declarado: "${chave}"`);
    }
  }

  for (const [chave, campo] of Object.entries(esquema)) {
    const valor = entrada[chave] ?? campo.padrao;

    if (valor === undefined || valor === null) {
      if (campo.obrigatorio) throw new ParametroInvalido(`falta "${chave}"`);
      continue;
    }

    const tipoReal = typeof valor;
    const esperado =
      campo.tipo === 'texto' ? 'string' : campo.tipo === 'numero' ? 'number' : 'boolean';
    if (tipoReal !== esperado) {
      throw new ParametroInvalido(`"${chave}" deveria ser ${campo.tipo}, veio ${tipoReal}`);
    }
    if (campo.dentre && !campo.dentre.includes(String(valor))) {
      throw new ParametroInvalido(`"${chave}" fora dos valores aceitos`);
    }
    saida[chave] = valor;
  }

  return saida;
}
