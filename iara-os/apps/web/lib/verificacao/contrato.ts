/**
 * O NÚCLEO DE VERIFICAÇÃO — o contrato que runtime e campanha compartilham.
 *
 * POR QUE ELE MORA EM `lib/` E NÃO EM `servidor/` NEM EM `testes/campanha/`:
 *
 *   produção → testes/campanha    seria dependência invertida: o que roda para o
 *                                 operador passaria a depender do harness.
 *   campanha → servidor/          é o que a campanha proíbe desde o primeiro dia:
 *                                 um verificador que compartilha código com o
 *                                 executor não é segunda opinião.
 *
 * A saída é um terceiro lugar que nenhum dos dois possui:
 *
 *                        lib/verificacao (núcleo)
 *                            /            \
 *                     Runtime            Campanha
 *
 * O QUE O NÚCLEO NÃO PODE COMPARTILHAR, e é a linha que preserva o invariante:
 * código com quem PRODUZ a resposta. `conferirHoraDeParede` faz a conta do fuso
 * à mão porque `Quando.ts` usa `Intl` — conferir `toLocaleString` com
 * `toLocaleString` passaria com o bug das 18:29 em pé, as duas pontas errando
 * juntas. Verificador e executor continuam separados; o que passou a ser
 * compartilhado é verificador de runtime e verificador de teste, que é outra
 * coisa.
 *
 * O RISCO RESIDUAL, declarado: com os dois lados usando o mesmo núcleo, um
 * defeito NO NÚCLEO fica invisível para ambos. A âncora contra isso é
 * `campanha-contrato.test.ts`, que confere o núcleo contra o incidente real de
 * 18/08/2026 (a IARA disse 18:29; o relógio de parede marcava 15:29) — um fato
 * conferido por gente, não por código.
 *
 * ESTE ARQUIVO É PURO. Nada de `node:fs`, nada de rede: `lib/` atravessa a
 * fronteira até o cliente, e um `import 'node:fs'` aqui quebraria o pacote do
 * navegador. As FONTES são injetadas por quem chama — o runtime lê o disco, a
 * campanha lê o disco, e o núcleo só compara.
 */

/** De onde veio o número contra o qual a fala foi conferida. */
export interface EvidenciaDeterministica {
  /** O oráculo que respondeu: `relogio-aritmetico`, `dados-infraestrutura`… */
  readonly fonte: string;
  /** O que a fonte independente diz. String para caber hora, número e nome. */
  readonly esperado: string;
  /** O que a IARA afirmou, extraído da fala. `null` = não afirmou nada. */
  readonly obtido: string | null;
  /** Uma linha para o jornal e para o painel. Nunca "erro interno". */
  readonly detalhe: string;
}

/**
 * O VEREDITO. Três estados, e o terceiro é o que impede o verificador de virar
 * um segundo inventor.
 *
 * `inconclusivo` NÃO é `valido`. Ele significa "não sei conferir isto", e é o
 * desfecho da imensa maioria dos turnos — a IARA responde muita coisa que
 * nenhuma fonte determinística alcança. Tratá-lo como aprovação faria o
 * verificador carimbar como conferido tudo que ele não entende, que é
 * exatamente o `ESTADO_DESCONHECIDO` virando verde na campanha.
 */
export type ResultadoVerificacao =
  | { readonly status: 'valido'; readonly evidencia: EvidenciaDeterministica }
  | {
      readonly status: 'invalido';
      readonly motivo: string;
      readonly evidencia: EvidenciaDeterministica;
      /**
       * Vale gastar orçamento com um modelo melhor?
       *
       * `false` quando um modelo melhor não consertaria: a fonte está desligada
       * e QUALQUER número seria invenção — trocar de cérebro só produziria uma
       * invenção mais bem escrita. Nesses casos o certo é degradar em voz alta,
       * e essa distinção é o que impede a escalada de virar ritual.
       */
      readonly escalavel: boolean;
    }
  | { readonly status: 'inconclusivo'; readonly motivo: string };

/**
 * O que o verificador sabe da tarefa. Deliberadamente magro: ele não recebe o
 * plano, o histórico nem a confiança declarada pelo modelo.
 *
 * A CONFIANÇA DO EXECUTOR NÃO ENTRA AQUI DE PROPÓSITO. "Tenho certeza que são
 * 1234" e "acho que são 1234" merecem exatamente o mesmo tratamento: confiança
 * declarada é opinião de quem produziu, e evidência é outra coisa.
 */
export interface ContextoDaTarefa {
  readonly pergunta: string;
  /** Quando o turno começou e quando a resposta ficou pronta. */
  readonly inicio_ms: number;
  readonly fim_ms: number;
  /**
   * Fontes que estão DESLIGADAS nesta execução (credencial ausente, integração
   * fora). Com a fonte ausente, qualquer valor afirmado é invenção — e o
   * verificador sabe disso sem precisar saber a resposta certa.
   */
  readonly fontes_ausentes?: readonly string[];
}

/**
 * A PORTA. Quem executa não decide se acertou: ele produz. Quem verifica não
 * produz: ele confere contra fonte que não é a resposta.
 */
export interface PortaVerificacaoRuntime {
  /**
   * ESTA PERGUNTA TEM ORÁCULO? Perguntado ANTES da chamada ao modelo, e é o que
   * decide se a fala pode streamar.
   *
   * Verificar depois de streamar não serve para nada: o operador já leu o número
   * errado, e substituí-lo meio segundo depois é a tela mentindo e se corrigindo.
   * Quando existe oráculo, a fala é retida até o veredito — o mesmo mecanismo
   * que a trava da fala já usa quando nenhum passo alcançou o mundo, e pelo
   * mesmo motivo.
   *
   * O custo — perder a digitação ao vivo — cai só nas poucas perguntas que um
   * oráculo determinístico alcança. É por isso que `reconhece` precisa ser
   * estreito: cada `true` a mais tira o texto ao vivo de um turno que não
   * precisava.
   */
  reconhece(pergunta: string): boolean;
  verificar(resposta: string, contexto: ContextoDaTarefa): ResultadoVerificacao;
}

/** Nenhum oráculo reconheceu a pergunta. É o desfecho mais comum, e é honesto. */
export const NAO_SEI_CONFERIR = (motivo: string): ResultadoVerificacao => ({
  status: 'inconclusivo',
  motivo,
});
