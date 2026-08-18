/**
 * A CADEIA — vários cérebros, uma porta, e a IARA nunca mais muda por cota.
 *
 * O INCIDENTE QUE A ORIGINOU (15/08/2026): a conta da Anthropic zerou. A chave
 * continuava no ambiente, então a `FabricaRaciocinio` escolheu o `ClienteClaude`
 * na subida — e ele falhava em TODO turno. A operadora leu "não consegui
 * concluir; tente de novo" em cada pedido e concluiu, com razão, que a IARA
 * inteira estava quebrada. O `auto` de então protegia contra chave AUSENTE;
 * não contra chave que para de funcionar depois. É a diferença entre escolher
 * na subida e ter para onde ir em runtime.
 *
 * A REGRA QUE GOVERNA A TROCA, e ela é curta: troca-se quando o provedor não
 * conseguiu COMEÇAR — cota, chave, limite de taxa, serviço fora. Nunca depois
 * que um pedaço de texto já chegou ao operador: repetir com outro cérebro
 * duplicaria a fala no meio da frase. É a mesma regra do corte de retentativa
 * do `ClienteClaude` e do `ClienteOllama`, pela mesma razão.
 *
 * O QUE A CADEIA NÃO FAZ: mascarar. Se todos falharem, o erro do último sobe
 * inteiro — a mensagem honesta continua sendo a última palavra, e é ela que o
 * `mensagemHumanaDeFalha` traduz para a operadora.
 */

import {
  ProvedorIndisponivel,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from './ProvedorRaciocinio';

/**
 * POR QUE O CÉREBRO FALHOU — uma escala só, e ela é esta.
 *
 * O `CLAUDE.md` é explícito sobre isto: "uma segunda escala ao lado da
 * existente é a doença que já custou caro aqui duas vezes". O diagnóstico por
 * provedor precisava saber DE QUE tipo era a falha, e a tentação era escrever
 * um segundo conjunto de regexes ao lado do que já decidia a troca. Em vez
 * disso, a classificação virou a fonte única: `mereceOutroProvedor` passou a
 * ser derivada dela, e não o contrário.
 *
 * `cancelado` não é falha do provedor: é o operador desistindo. Trocar de
 * cérebro nesse caso gastaria a cota do próximo para produzir uma resposta que
 * ninguém está mais esperando.
 */
export type ClasseFalhaProvedor =
  | 'quota'
  | 'autenticacao'
  | 'rate_limit'
  | 'servico_fora'
  /**
   * O MODELO CONFIGURADO NÃO EXISTE MAIS NO PROVEDOR — auditoria de 18/08/2026.
   *
   * A Groq descomissionou `llama-3.3-70b-versatile` e passou a responder 404
   * `model_not_found`. Nenhuma regex daqui reconhecia esse texto, então ele caía
   * em `outra` — e `outra` NÃO merece troca, de propósito. Resultado: a cadeia
   * desistia no PRIMEIRO elo e o operador recebia o JSON cru da Groq, com Gemini
   * e Anthropic intactos logo atrás, nunca tentados. Uma cadeia de três cérebros
   * comportando-se como se tivesse zero.
   *
   * É falha do PROVEDOR (aquele elo não serve para nenhum turno), não do pedido:
   * merece troca imediata. E é a que menos se conserta sozinha — o nome do
   * modelo está em configuração, não no ar —, daí a carência longa.
   */
  | 'modelo_invalido'
  | 'cancelado'
  /** Erro que não se encaixa em nenhuma das anteriores. Não vale troca: uma
   *  falha que não sabemos nomear pode muito bem repetir no próximo elo. */
  | 'outra';

export function classificarFalhaProvedor(erro: unknown, sinal?: AbortSignal): ClasseFalhaProvedor {
  if (sinal?.aborted) return 'cancelado';
  if (erro instanceof Error && erro.name === 'AbortError') return 'cancelado';

  const texto = erro instanceof Error ? erro.message : String(erro);

  /* A ORDEM IMPORTA e não é alfabética. Um 429 de cota traz as duas palavras;
     "sem crédito" é o diagnóstico útil, "tente mais devagar" é o inútil. */
  if (/credit balance|quota|insufficient|billing|payment/i.test(texto)) return 'quota';
  /* Antes de `autenticacao`: "you do not have access to it" é a metade final da
     frase que a Groq e a OpenAI usam para modelo inexistente, e ela cheira a
     permissão sem ser. O código `model_not_found` é o sinal inequívoco; as
     outras formas cobrem quem não o envia. */
  if (
    /model_not_found|does not exist or you do not have access|unknown model|model.{0,30}(not found|does not exist)|decommissioned|deprecated model/i.test(
      texto,
    )
  ) {
    return 'modelo_invalido';
  }
  if (/rate.?limit|429|too many requests/i.test(texto)) return 'rate_limit';
  if (/401|403|invalid.?api.?key|unauthorized|permission/i.test(texto)) return 'autenticacao';
  if (/5\d{2}|overloaded|unavailable|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed/i.test(texto)) {
    return 'servico_fora';
  }

  /* `ProvedorIndisponivel` sem texto reconhecível continua valendo troca — é o
     provedor declarando de si mesmo que não serve para este turno. Fica por
     último para não sequestrar a classificação de um erro já nomeado acima. */
  return erro instanceof ProvedorIndisponivel ? 'servico_fora' : 'outra';
}

/** Frase curta para o painel. `cancelado` e `outra` não aparecem no diagnóstico
 *  por provedor — são estados do turno, não do cérebro. */
export const MOTIVO_DA_CLASSE: Record<ClasseFalhaProvedor, string> = {
  quota: 'cota/crédito esgotado',
  autenticacao: 'chave recusada',
  rate_limit: 'limite de taxa atingido',
  servico_fora: 'serviço fora do ar ou inalcançável',
  modelo_invalido: 'o modelo configurado não existe neste provedor',
  cancelado: 'o turno foi cancelado',
  outra: 'falha não classificada',
};

/**
 * O erro merece outro cérebro?
 *
 * Sim para o que é do PROVEDOR (cota, crédito, chave, limite de taxa, serviço
 * indisponível). Não para o que é do OPERADOR (ele cancelou) — trocar aí
 * gastaria a cota do próximo para produzir uma resposta que ninguém pediu.
 */
export function mereceOutroProvedor(erro: unknown, sinal?: AbortSignal): boolean {
  const classe = classificarFalhaProvedor(erro, sinal);
  return classe !== 'cancelado' && classe !== 'outra';
}

/** O que se OBSERVOU acontecer com um cérebro — a diferença entre "a chave está
 *  no ambiente" e "a chave funcionou da última vez que foi usada". */
export interface FalhaObservada {
  readonly classe: ClasseFalhaProvedor;
  readonly detalhe: string;
  readonly instante: string;
}

/**
 * O QUE CADA CÉREBRO SOFREU DE VERDADE — registro do PROCESSO, por apelido.
 *
 * Por que do processo e não da cadeia. Cota é propriedade da CONTA, não da
 * sessão: se o crédito da Anthropic acabou para uma operadora, acabou para
 * todas, e um registro por instância faria cada sessão redescobrir o mesmo fato
 * pagando o mesmo pedido. Some-se a isso que a fábrica devolve o provedor NU
 * quando só existe um elo — que é exatamente a configuração do motor onde o
 * incidente aconteceu. Um registro que morasse dentro da cadeia não veria
 * justamente o caso que precisava ver.
 *
 * É a única fonte capaz de dizer "a cota acabou". Nenhuma sonda barata descobre
 * isso: o endpoint que lista modelos responde 200 com a conta zerada, porque
 * listar não gasta crédito. Saldo só se descobre gastando.
 */
const observacoes = new Map<string, FalhaObservada>();

export function registrarFalhaProvedor(apelido: string, erro: unknown, sinal?: AbortSignal): void {
  const classe = classificarFalhaProvedor(erro, sinal);
  /* `cancelado` não se registra: o operador desistir não diz nada sobre a saúde
     do cérebro, e gravá-lo pintaria de vermelho um provedor são. */
  if (classe === 'cancelado') return;
  observacoes.set(apelido, {
    classe,
    detalhe: (erro instanceof Error ? erro.message : String(erro)).slice(0, 200),
    instante: new Date().toISOString(),
  });
}

/** Sucesso APAGA a falha anterior: uma cota recarregada não pode continuar
 *  aparecendo como esgotada no painel para sempre. */
export function registrarSucessoProvedor(apelido: string): void {
  observacoes.delete(apelido);
}

/** Cópia — o diagnóstico lê, nunca escreve. */
export function falhasObservadas(): ReadonlyMap<string, FalhaObservada> {
  return new Map(observacoes);
}

/** Só para teste: registro de processo precisa de reset entre casos. */
export function limparFalhasObservadas(): void {
  observacoes.clear();
}

// ---------------------------------------------------------------------------
// Carência — o cérebro que acabou de falhar vai para o fim da fila
// ---------------------------------------------------------------------------

/**
 * QUANTO TEMPO UM CÉREBRO FICA NO FIM DA FILA DEPOIS DE FALHAR.
 *
 * O DEFEITO QUE ISTO FECHA, e ele é o MESMO incidente do cabeçalho deste
 * arquivo, um passo adiante:
 *
 *   A cadeia aprendeu a ter para onde ir quando a cota da Anthropic acabou —
 *   mas continuou tentando a Anthropic PRIMEIRO em todo turno seguinte. O
 *   `observacoes` registrava "cota esgotada" e ninguém no caminho de execução
 *   lia esse registro: `raciocinar` filtrava por `elo.disponivel`, que responde
 *   "a chave está no ambiente" — nunca "a chave funcionou da última vez".
 *
 *   O custo é por turno e composto: uma ida à rede que já se sabe perdida,
 *   até o timeout, antes de começar o pedido que vai de fato responder. Numa
 *   máquina onde o elo local leva ~260 s, somar a espera do elo morto à frente
 *   dele é a diferença entre lento e inutilizável. E quem paga é a operadora,
 *   em toda mensagem, por dias, até alguém recarregar a conta.
 *
 * A CARÊNCIA É POR CLASSE porque as falhas não duram o mesmo tanto. Limite de
 * taxa passa em segundos; crédito zerado e chave recusada não passam sozinhos —
 * dependem de alguém agir fora do sistema, e insistir a cada minuto só produz
 * mais linhas de log iguais.
 */
export const CARENCIA_MS: Record<ClasseFalhaProvedor, number> = {
  /* Ninguém recarrega a conta sem perceber; e quando recarregar, o primeiro
     turno em que os outros elos também estiverem em carência já o traz de
     volta — ver `ordenarPorSaude`. */
  quota: 15 * 60 * 1000,
  /* Chave revogada ou errada não se conserta sozinha. Mesmo raciocínio. */
  autenticacao: 15 * 60 * 1000,
  /* Nome de modelo errado está em CONFIGURAÇÃO: não passa sem deploy nem
     recarga de ambiente. É a falha mais duradoura das cinco — insistir nela a
     cada turno é a ida à rede mais previsivelmente perdida que existe aqui. */
  modelo_invalido: 60 * 60 * 1000,
  /* Serviço fora costuma voltar. Espera o suficiente para não martelar. */
  servico_fora: 2 * 60 * 1000,
  /* A janela de um 429 é curta por definição. */
  rate_limit: 60 * 1000,
  /* Nunca chegam a ser registradas — ver `registrarFalhaProvedor` e
     `mereceOutroProvedor`. Estão aqui para o mapa ser total, e valem zero
     para que uma mudança futura naquelas regras não crie carência por acidente. */
  cancelado: 0,
  outra: 0,
};

/** Este cérebro falhou faz pouco tempo? */
export function emCarencia(apelido: string, agora: number = Date.now()): boolean {
  const falha = observacoes.get(apelido);
  if (!falha) return false;
  const carencia = CARENCIA_MS[falha.classe];
  if (carencia <= 0) return false;
  return agora - Date.parse(falha.instante) < carencia;
}

/**
 * A fila do turno: quem não falhou recentemente vai na frente.
 *
 * REORDENA, NUNCA REMOVE — e essa é a decisão inteira.
 *
 * Excluir o elo em carência transformaria "todos os cérebros falharam faz
 * pouco" em "a IARA não tem cérebro nenhum", que é trocar lentidão por morte.
 * Com todos em carência a ordem original volta inteira e a cadeia tenta como
 * sempre tentou: pior caso idêntico ao de hoje, caso comum muito melhor.
 *
 * É também o que devolve um provedor recarregado ao serviço sem ninguém avisar
 * o sistema: assim que ele é tentado e responde, `registrarSucessoProvedor`
 * apaga a observação e ele volta para a frente da fila no turno seguinte.
 *
 * A ordem RELATIVA dentro de cada grupo é preservada de propósito: a preferência
 * declarada em `IARA_CADEIA_RACIOCINIO` continua mandando entre os saudáveis, e
 * entre os doentes. A carência decide o grupo, não a hierarquia.
 */
export function ordenarPorSaude<T extends { apelido: string }>(
  elos: readonly T[],
  agora: number = Date.now(),
): T[] {
  const saudaveis = elos.filter((e) => !emCarencia(e.apelido, agora));
  const emEspera = elos.filter((e) => emCarencia(e.apelido, agora));
  return [...saudaveis, ...emEspera];
}

export class CadeiaDeRaciocinio implements ProvedorRaciocinio {
  /** O elo que respondeu por último — é o que a telemetria e o snapshot mostram. */
  private atual: ProvedorRaciocinio;

  constructor(private readonly elos: ProvedorRaciocinio[]) {
    if (elos.length === 0) throw new Error('cadeia de raciocínio vazia');
    this.atual = elos[0];
  }

  /** O apelido do elo que está respondendo AGORA. A tela precisa poder dizer
   *  "raciocinando com gemini", não "raciocinando com a nuvem". */
  get apelido(): string {
    return this.atual.apelido;
  }

  /** A origem e o modelo são os do elo que está respondendo AGORA — a tela não
   *  pode dizer "nuvem" enquanto quem responde é o Ollama da sala. */
  get origem(): 'nuvem' | 'local' {
    return this.atual.origem;
  }

  get modelo(): string {
    return this.atual.modelo;
  }

  /** Disponível se ALGUM elo está. Exigir todos desligaria a rota de raciocínio
   *  por causa de um provedor secundário sem chave. */
  get disponivel(): boolean {
    return this.elos.some((e) => e.disponivel);
  }

  /** Sonda os que sabem se sondar; basta um responder. */
  async sondar(): Promise<boolean> {
    let algum = false;
    for (const elo of this.elos) {
      if (!elo.sondar) {
        if (elo.disponivel) algum = true;
        continue;
      }
      if (await elo.sondar()) algum = true;
    }
    return algum;
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    const candidatos = this.elos.filter((e) => e.disponivel);
    /**
     * `disponivel` responde "a chave está no ambiente"; `ordenarPorSaude`
     * responde "ela funcionou da última vez". São perguntas diferentes, e era a
     * segunda que faltava — ver `CARENCIA_MS`.
     */
    const fila = ordenarPorSaude(candidatos.length > 0 ? candidatos : this.elos);
    let ultimoErro: unknown = new ProvedorIndisponivel('nenhum provedor de raciocínio disponível');
    for (const elo of fila) {
      /**
       * O ORÇAMENTO DO TURNO DECIDE SE HÁ MAIS UMA TENTATIVA.
       *
       * Sem isto, uma chamada de modelo custava até quatro idas à rede e o teto
       * de chamadas contava 1 — o multiplicador que nenhum teto de chamada vê. A
       * cadeia não conhece o orçamento: ela recebe uma pergunta para fazer.
       *
       * Recusa aqui NÃO é falha do elo: nada é registrado contra ele, porque ele
       * não foi tentado. Marcar carência por falta de orçamento faria o próximo
       * turno rebaixar um provedor saudável.
       */
      if (pedido.aoTentarProvedor && !pedido.aoTentarProvedor()) {
        throw new ProvedorIndisponivel(
          'o orçamento de tentativas deste turno acabou antes de eu conseguir uma resposta',
        );
      }

      /**
       * A porta de saída da troca: o instante em que o primeiro pedaço chega
       * ao operador. Daí em diante o turno é daquele elo, dê no que der.
       */
      let comecouAFalar = false;

      try {
        this.atual = elo;
        const resposta = await elo.raciocinar({
          ...pedido,
          aoReceberTexto: (pedaco) => {
            comecouAFalar = true;
            pedido.aoReceberTexto(pedaco);
          },
        });
        registrarSucessoProvedor(elo.apelido);
        return resposta;
      } catch (erro) {
        ultimoErro = erro;
        /**
         * REGISTRAR AQUI É O PONTO INTEIRO. O elo que falhou e foi substituído
         * some do turno: a resposta chega pelo próximo, o operador não vê nada,
         * e o motivo da troca não existe em lugar nenhum depois. É exatamente o
         * caso que o painel precisa mostrar — "anthropic: cota esgotada, quem
         * respondeu foi gemini" — e o único instante em que ele é observável.
         */
        registrarFalhaProvedor(elo.apelido, erro, pedido.sinal);
        if (comecouAFalar) throw erro;
        if (!mereceOutroProvedor(erro, pedido.sinal)) throw erro;
        /* Segue para o próximo elo. O motivo deste não se perde: se todos
           falharem, o último sobe — e os anteriores já foram vistos por quem
           acompanha o console técnico. */
      }
    }

    throw ultimoErro;
  }
}
