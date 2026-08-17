/**
 * Gestor de erros cognitivos — o que transforma falha em teste.
 *
 * A DIFERENÇA QUE ESTE ARQUIVO EXISTE PARA FAZER:
 *
 *   log de erro  →  alguém talvez leia, alguém talvez conserte
 *   este registro →  a falha vira assinatura, a assinatura vira caso de teste
 *
 * A auditoria de 11/08 encontrou quatro defeitos que sobreviveram a 126 testes
 * verdes. Nenhum deles era invisível — todos deixavam rastro. O que faltava era
 * um lugar onde o rastro virasse obrigação.
 *
 * Este módulo NÃO conserta nada e não decide nada. Ele classifica, deduplica e
 * emite o esqueleto do teste de regressão. O conserto é humano; o que ele
 * garante é que o conserto tenha uma trava depois.
 */

import { createHash } from 'node:crypto';
import { normalizar } from '../texto';
import { contar } from '../texto';

/**
 * As classes de erro cognitivo que este sistema sabe distinguir.
 *
 * Cada uma nasceu de um defeito real. A classificação importa porque cada
 * classe tem uma correção estrutural diferente — e tratar todas como "bug"
 * apaga exatamente essa informação.
 */
export type ClasseErro =
  /** Plano citou habilidade fora do catálogo. Correção: teste de integridade. */
  | 'habilidade_ausente'
  /** Executor relatou sucesso, o mundo discordou. Correção: verificador. */
  | 'execucao_nao_confirmada'
  /** Âncora capturou frase de outro assunto. Correção: exceção na âncora. */
  | 'roteamento_incorreto'
  /** Habilidade falhou em execução (timeout, permissão, parâmetro). */
  | 'falha_de_execucao'
  /** A IARA afirmou algo sem fonte. Correção: procedência obrigatória. */
  | 'afirmacao_sem_fonte'
  /** Adivinhou onde deveria perguntar. Correção: regra de ambiguidade. */
  | 'ambiguidade_ignorada'
  /**
   * Um passo de risco alto tentou executar sem autorização humana — tipicamente
   * proposto pela camada de raciocínio. Correção: porteiro de autorização.
   *
   * Esta classe existe porque a tentativa é informação, mesmo barrada. Uma LLM
   * que propõe desligar a máquina três vezes por semana é um sinal sobre o
   * prompt, e um inventário que só registra o que passou não o mostra.
   */
  | 'autorizacao_negada'
  /**
   * A SÍNTESE AFIRMOU EFEITO QUE NENHUM PASSO SUSTENTA — e a trava da fala a
   * descartou antes de o operador ler.
   *
   * Classe própria, e não `afirmacao_sem_fonte`, porque a correção é outra:
   * aquela pede procedência para um FATO citado; esta é sobre a LLM narrar uma
   * AÇÃO que não houve. Medida em 17/08/2026 em 56% dos claims do caminho
   * cognitivo, com provedor adversarial. Cada linha aqui é uma vez em que o
   * modelo tentou e a trava segurou — a série diz se o prompt está melhorando ou
   * se a trava é a única coisa de pé.
   */
  | 'afirmacao_sem_efeito';

export interface ErroCognitivo {
  readonly classe: ClasseErro;
  /** O que o operador pediu. É o insumo do caso de teste. */
  readonly entrada: string;
  /** O que aconteceu de errado, em uma linha. */
  readonly observado: string;
  /** O que deveria ter acontecido. Vira a asserção. */
  readonly esperado: string;
  readonly instante: string;
}

export interface ErroRegistrado extends ErroCognitivo {
  /** Hash da classe + forma da entrada. Duas ocorrências do mesmo defeito colidem. */
  readonly assinatura: string;
  readonly ocorrencias: number;
}

/**
 * Assinatura sintática, não conteúdo.
 *
 * Mesma regra do `RagHistorico`: o que identifica o defeito é a FORMA do
 * pedido, não o texto exato. "manda pro João" e "manda pro Pedro" são a mesma
 * falha de ambiguidade — e guardar as duas separadas transforma o registro num
 * log com outro nome.
 *
 * Números viram `N` e palavras de conteúdo viram `P` justamente para que a
 * variação de conteúdo não produza assinaturas diferentes.
 *
 * O CUSTO DESSA ESCOLHA, declarado: a assinatura é grosseira, e dois defeitos
 * distintos com a mesma classe e a mesma forma de frase vão colidir. É o
 * trade-off aceito de propósito — num registro de defeitos, subcontar é melhor
 * que inflar. Um inventário que cresce a cada variação de nome próprio vira o
 * log que este módulo existe para não ser.
 */
export function assinaturaDe(classe: ClasseErro, entrada: string): string {
  const forma = normalizar(entrada)
    .split(' ')
    // Artigo definido sai: é a partícula mais variável e a menos informativa
    // sobre a forma do pedido. "leva o relatório" e "leva a carga" são o mesmo
    // defeito, e só o artigo os separava.
    .filter((t) => !/^(o|a|os|as)$/.test(t))
    // Só o começo da frase: é onde mora a estrutura do pedido. O resto é
    // complemento, e complemento é justamente o que varia entre duas
    // ocorrências do mesmo defeito.
    .slice(0, 4)
    .map((t) => {
      if (/\d/.test(t)) return 'N';
      // Palavra de conteúdo vira marcador; preposição e artigo ficam, porque
      // é neles que a FORMA do pedido aparece ("P pro P" ≠ "P uma P").
      return t.length >= 4 ? 'P' : t;
    })
    .join(' ');
  return createHash('sha1').update(`${classe}|${forma}`).digest('hex').slice(0, 12);
}

export class RegistroErros {
  private readonly porAssinatura = new Map<string, ErroRegistrado>();

  /** Registra e devolve o acumulado desta assinatura. */
  registrar(erro: ErroCognitivo): ErroRegistrado {
    const assinatura = assinaturaDe(erro.classe, erro.entrada);
    const anterior = this.porAssinatura.get(assinatura);

    const registrado: ErroRegistrado = anterior
      ? { ...anterior, ocorrencias: anterior.ocorrencias + 1, instante: erro.instante }
      : { ...erro, assinatura, ocorrencias: 1 };

    this.porAssinatura.set(assinatura, registrado);

    // Uma linha JSON por ocorrência, mesmo canal da auditoria. Nunca o
    // conteúdo da conversa além do enunciado que reproduz o defeito.
    console.log(
      JSON.stringify({
        canal: 'erro_cognitivo',
        assinatura,
        classe: erro.classe,
        ocorrencias: registrado.ocorrencias,
        observado: erro.observado,
      }),
    );

    return registrado;
  }

  /** Defeitos distintos vistos, do mais frequente ao menos. */
  get inventario(): readonly ErroRegistrado[] {
    return [...this.porAssinatura.values()].sort((a, b) => b.ocorrencias - a.ocorrencias);
  }

  /**
   * Esqueleto do teste de regressão, pronto para colar em
   * `testes/integridade-cognitiva.test.ts`.
   *
   * Gerar o caso é deliberadamente MECÂNICO e a asserção fica como `TODO`: uma
   * asserção inventada por máquina passaria a proteger o que a máquina achou
   * que era o problema. Quem entendeu o defeito escreve a asserção; o registro
   * garante que o caso exista e que ninguém precise lembrar dele.
   */
  casoDeRegressao(e: ErroRegistrado): string {
    const titulo = `${e.classe}: ${e.entrada.slice(0, 60)}`.replace(/'/g, '');
    return [
      `/**`,
      ` * Regressão ${e.assinatura} — ${contar(e.ocorrencias, 'ocorrência', 'ocorrências')}.`,
      ` * Observado: ${e.observado}`,
      ` * Esperado:  ${e.esperado}`,
      ` */`,
      `test('${titulo}', () => {`,
      `  const p = percepcao.perceber(${JSON.stringify(e.entrada)});`,
      `  // TODO: asserção que falha com o defeito e passa com a correção.`,
      `  assert.ok(p);`,
      `});`,
    ].join('\n');
  }
}
