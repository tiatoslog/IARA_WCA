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
import type { Operacao, SemanticaEfeito } from './Operacao';
import type { RegistroOperacoes } from './RegistroOperacoes';
import type { RegistroErros } from './RegistroErros';

export type Permissao =
  | 'rede' // fala com a internet
  | 'banco' // lê dados da operação
  | 'memoria' // lê o shard privado do operador
  | 'llm' // gasta tokens
  | 'escrita' // altera algo na máquina onde o motor roda
  /**
   * Age no mundo EM NOME do operador, alcançando outra pessoa: manda mensagem,
   * envia e-mail, publica. Separada de `escrita` porque o risco é de outra
   * natureza — criar uma pasta errada se desfaz, uma mensagem enviada ao
   * destinatário errado não. Enquanto `escrita` é do operador, `externo` é do
   * administrador.
   */
  | 'externo';

/** Validação em runtime dos parâmetros. Simples de propósito: o kernel
 *  precisa disso rápido e sem dependência de biblioteca de schema. */
export interface CampoEsquema {
  tipo: 'texto' | 'numero' | 'booleano';
  obrigatorio?: boolean;
  /** Valores aceitos. Ausente = qualquer um do tipo. */
  dentre?: readonly string[];
  padrao?: unknown;
  /**
   * Teto de tamanho para `texto`. Ausente = `MAX_TEXTO_PADRAO`.
   *
   * O esquema não tinha limite nenhum, e a ausência tinha consequência real:
   * `consultar_memoria_corporativa` monta um índice de trigramas sobre o
   * parâmetro (O(n) em memória e tempo), e o valor vem de um plano emitido pela
   * LLM — que por sua vez pode estar repetindo um documento que alguém colou.
   * Um parâmetro de megabytes não é ataque sofisticado; é o que sai naturalmente
   * de um modelo instruído por uma página maliciosa a "repita este texto no
   * parâmetro".
   *
   * O padrão é generoso o bastante para toda habilidade real do catálogo e
   * pequeno o bastante para que nenhuma delas vire um laço caro por engano.
   */
  max?: number;
}

/** Teto de um campo `texto` que não declara o próprio. */
export const MAX_TEXTO_PADRAO = 4000;

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
  /**
   * Quanto custa errar com esta habilidade — e, portanto, quanta prova ela
   * exige antes e depois.
   *
   * `baixo`  consultar, ler, organizar. Nenhuma confirmação, nenhuma
   *          verificação (a resposta É o resultado).
   * `medio`  altera algo na máquina ou nos dados. Sem confirmação prévia, mas
   *          verificação obrigatória: criar pasta é reversível, afirmar que
   *          criou sem ter criado não é.
   * `alto`   irreversível ou alcança terceiro. Confirmação explícita ANTES,
   *          verificação DEPOIS.
   *
   * Risco é ortogonal a confiança. Uma intenção pode ter confiança 0,99 e
   * ainda assim exigir confirmação — ver `PoliticaDeRisco`.
   */
  readonly risco: Risco;
  /**
   * O QUE ACONTECE SE ISTO RODAR DUAS VEZES.
   *
   * Obrigatório, e obrigatório em tempo de COMPILAÇÃO: uma habilidade nova não
   * compila sem responder. É deliberado — a alternativa é um campo opcional que
   * ninguém preenche até o dia em que um reenvio chega ao cliente.
   *
   * Ortogonal a `risco`, e confundir os dois é o erro clássico. Risco governa
   * confirmação PRÉVIA (quanto custa errar); semântica governa DEDUPLICAÇÃO e
   * retry (quanto custa repetir). `criar_pasta` é risco médio e idempotente;
   * `abrir_aplicativo` é o mesmo risco e não idempotente. A política que trata
   * as duas igual erra uma das duas.
   *
   * Ver `Operacao.ts`. Quem declara `efeito_desconhecido` NÃO executa.
   */
  readonly idempotencia: SemanticaEfeito;
  readonly esquema: Esquema;
}

export type Risco = 'baixo' | 'medio' | 'alto';

export interface ContextoHabilidade {
  readonly sessao: string;
  readonly id_usuario: string;
  readonly parametros: Record<string, unknown>;
  readonly sinal: AbortSignal;
  /** Texto original do operador. Algumas habilidades precisam do bruto. */
  readonly enunciado: string;
  /**
   * O jornal das operações.
   *
   * Só as habilidades que ARMAM ou RESOLVEM uma autorização precisam disto —
   * hoje as duas de energia. As outras ignoram, e é bom que ignorem: uma
   * habilidade que mexe no jornal por conta própria é uma habilidade que pode
   * se autoautorizar. A máquina de transições impede o pior (nenhuma delas
   * consegue carimbar `verificador` num estado que não conferiu), mas o desenho
   * é este: quem executa não legisla.
   */
  readonly registro: RegistroOperacoes;
  /**
   * A operação que ESTE passo é. `null` para leitura — leitura não tem
   * identidade persistida, ver `Kernel.abrirOperacao`.
   */
  readonly operacao: Operacao | null;
  /**
   * Os defeitos cognitivos acumulados NESTA sessão, para quem audita.
   *
   * OPCIONAL, e a opcionalidade não é preguiça: o registro é por Kernel, e há
   * caminhos legítimos que executam habilidade sem um (testes de porta, e o
   * verificador quando roda isolado). Quem depende dele trata a ausência
   * dizendo que não conseguiu ler — nunca relatando "nenhum erro", que é a
   * mesma mentira de um diagnóstico que omite o que não conseguiu medir.
   *
   * Só a auditoria usa. Uma segunda habilidade precisando disto é o momento de
   * revisar se o lugar certo continua sendo o contexto.
   */
  readonly erros?: RegistroErros;
}

export interface ResultadoHabilidade {
  /** O que vira resposta ao operador (ou insumo do próximo passo). */
  readonly texto: string;
  /** Uma linha para o console técnico. Nunca payload cru. */
  readonly detalhe: string;
  /**
   * Habilidade pode declarar que não resolveu sem ser um erro.
   *
   * ATENÇÃO: isto é AUTODECLARADO. É o relato do executor, não a verdade — por
   * isso a procedência de um resultado cru é `resultado_ferramenta`, e só a
   * verificação a promove a `fato_verificado`. Nunca trate `resolveu: true`
   * como prova de que algo aconteceu no mundo.
   */
  readonly resolveu: boolean;
  /**
   * "NÃO RESOLVI PORQUE FALTA UM PARÂMETRO — e a resposta que eu dei pede
   * exatamente ele."
   *
   * É o que torna o multiturno possível sem adivinhação: o Kernel guarda
   * `{habilidade, parametros, parametro}` por UM turno, e se a próxima
   * mensagem for curta e não casar âncora nenhuma, ela vira o valor deste
   * parâmetro e a MESMA habilidade roda de novo — pelo caminho normal, com
   * esquema, porteiro e jornal intactos. Qualquer outra mensagem descarta a
   * pendência em silêncio (o operador mudou de assunto; insistir seria pior).
   *
   * Declarativo de propósito: a habilidade sabe O QUE falta; o Kernel sabe
   * COMO retomar. Nenhum dos dois conhece o outro além deste campo.
   */
  readonly pendencia?: { readonly parametro: string };
}

/**
 * O que a verificação apurou CONFERINDO O MUNDO, depois de executar.
 *
 * `confirmado: false` não quer dizer "falhou" — quer dizer "não consegui
 * provar". A distinção é o núcleo desta camada: `motivo` explica qual das duas
 * coisas aconteceu, e a resposta ao operador muda conforme.
 */
export interface Verificacao {
  readonly confirmado: boolean;
  /** Uma linha: o que foi conferido e o que se encontrou. */
  readonly evidencia: string;
  /** Preenchido quando `confirmado` é falso. */
  readonly motivo?: 'nao_encontrado' | 'divergente' | 'sem_meio_de_verificar';
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

  /**
   * Confere o MUNDO depois de executar. Opcional, e a ausência é significativa.
   *
   * Quem altera algo fora do processo DEVE implementar: é o que separa "pedi
   * para criar a pasta" de "a pasta existe". Quem só lê (clima, relógio,
   * consulta) não implementa — verificar uma leitura seria repetir a leitura,
   * pagando duas vezes por nenhuma garantia nova.
   *
   * A regra "toda habilidade de risco médio ou alto verifica" é imposta por
   * teste em `testes/verificacao.test.ts`, não pela boa vontade de quem
   * escreve a habilidade.
   */
  verificar?(resultado: ResultadoHabilidade, ctx: ContextoHabilidade): Promise<Verificacao>;
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
    /**
     * `Object.hasOwn`, NÃO `chave in esquema`.
     *
     * `in` caminha a cadeia de protótipos, e `esquema` é um objeto literal —
     * então `'__proto__' in esquema`, `'constructor' in esquema`,
     * `'toString' in esquema` e `'hasOwnProperty' in esquema` eram todos
     * VERDADEIROS. A porta que existe para recusar parâmetro não declarado
     * deixava passar, calada, a família inteira de nomes herdados de
     * `Object.prototype` — inclusive os que um payload de poluição de protótipo
     * usa por definição.
     *
     * Nada foi explorável por acidente: o laço de baixo percorre
     * `Object.entries(esquema)`, que é só de propriedades próprias, e nenhuma
     * dessas chaves chegava a `saida`. Mas uma trava que só não falha porque
     * outra coisa a compensa é uma trava que já falhou — e a compensação vai
     * embora no dia em que alguém trocar o laço de baixo por um `for...in`.
     *
     * Encontrado pela suíte adversarial, não por leitura. Ver
     * `zero-trust-adversarial.test.ts`, D1.
     */
    if (!Object.hasOwn(esquema, chave)) {
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
    if (campo.tipo === 'texto') {
      const teto = campo.max ?? MAX_TEXTO_PADRAO;
      if ((valor as string).length > teto) {
        throw new ParametroInvalido(`"${chave}" passa de ${teto} caracteres`);
      }
      /**
       * BYTE NULO E CONTROLE C0.
       *
       * Não é paranoia de fuzzing: o parâmetro chega a `path.join`, a nome de
       * arquivo e a corpo de requisicao HTTP. Um NUL trunca caminho em
       * várias APIs nativas, e `\r\n` num campo que vira cabeçalho é injeção de
       * cabeçalho. O tipo `texto` promete texto — recusar aqui é o que faz a
       * promessa valer para todas as habilidades de uma vez, em vez de cada
       * executor se lembrar sozinho.
       *
       * `\n` e `\t` passam: são texto legítimo em parâmetro de mensagem.
       */
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(valor as string)) {
        throw new ParametroInvalido(`"${chave}" contém caractere de controle`);
      }
    }
    if (campo.tipo === 'numero' && !Number.isFinite(valor as number)) {
      // `NaN` e `Infinity` são `typeof 'number'` e passariam pela checagem de
      // tipo acima. Nenhum executor do catálogo sabe o que fazer com eles.
      throw new ParametroInvalido(`"${chave}" não é um número finito`);
    }
    saida[chave] = valor;
  }

  return saida;
}
