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

import { lerConfig } from './kernel/Configuracao';
import {
  ProvedorIndisponivel,
  type PedidoRaciocinio,
  type ProvedorRaciocinio,
  type RespostaRaciocinio,
} from './ProvedorRaciocinio';

/**
 * O ELO DEMOROU DEMAIS PARA COMEÇAR — e por isso foi abandonado.
 *
 * Classe própria porque o abandono precisa ser distinguível de duas coisas
 * parecidas e de consequência oposta: do operador cancelando (que NÃO merece
 * outro cérebro) e de um erro do provedor (que já tem classificação). Sem tipo
 * próprio, o `AbortError` do abandono cairia em `cancelado` e mataria o turno
 * exatamente quando ele deveria seguir para o próximo elo.
 */
export class EloDemorouDemais extends Error {
  constructor(
    readonly apelido: string,
    readonly prazoMs: number,
  ) {
    super(`${apelido} não enviou o primeiro pedaço em ${prazoMs} ms`);
    this.name = 'EloDemorouDemais';
  }
}

/**
 * DEZ SEGUNDOS PARA O PRIMEIRO PEDAÇO, e o número saiu de medição.
 *
 * Medido em 18/08/2026, prompt de 10.226 tokens, três voltas por provedor:
 *
 *   anthropic   1º pedaço em 1,4 s / 1,7 s / 1,9 s — respondeu 3/3
 *   openrouter  429 (cota diária gratuita esgotada) em 46–390 ms
 *   groq        413 (o prompt não cabe no tier) em 121–1656 ms
 *   gemini      503 (high demand) em 5,2 s · 21,9 s · **43,6 s**
 *
 * O gemini não é lento a responder: é lento a FALHAR. E a cadeia paga essa
 * espera antes de chegar a quem funciona — vezes duas ou três chamadas de
 * modelo por turno. Foi essa soma que produziu turnos de 70 segundos com a tela
 * parada, e nenhum teto do sistema a via: o orçamento de tempo é de 15 minutos
 * e só é conferido entre passos, nunca dentro de uma chamada de rede.
 *
 * Dez segundos deixa folga de 5× sobre o elo saudável mais lento que se mediu, e
 * corta o 503 de 43 s em 10. Um prazo apertado demais abandonaria provedor bom
 * em dia ruim, que é trocar lentidão por burrice.
 *
 * VALE PARA O PRIMEIRO PEDAÇO, NUNCA PARA A RESPOSTA INTEIRA. Depois que o texto
 * começou a sair, o turno é daquele elo — cortar no meio jogaria fora uma
 * resposta que já estava chegando e duplicaria a fala se o próximo respondesse.
 * É a mesma regra que já governa `comecouAFalar`.
 */
export const PRAZO_PRIMEIRO_PEDACO_PADRAO_MS = 10_000;

export function prazoDoPrimeiroPedaco(): number {
  const bruto = lerConfig('IARA_PRAZO_PROVEDOR_MS');
  if (bruto === null) return PRAZO_PRIMEIRO_PEDACO_PADRAO_MS;
  const n = Number(bruto);
  /* Zero ou negativo desligaria o abandono em silêncio. Quem quiser desligar
     declara um número grande, que aparece no diagnóstico como o número que é. */
  return Number.isInteger(n) && n > 0 ? n : PRAZO_PRIMEIRO_PEDACO_PADRAO_MS;
}

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
  /**
   * O ABANDONO POR DEMORA VEM ANTES DE TUDO, inclusive de `cancelado`.
   *
   * Um elo que não começou a falar no prazo está, para efeito deste turno,
   * fora do ar — e a carência de `servico_fora` (2 min) é exatamente a que se
   * quer: ele não é tentado de novo enquanto está ruim, e volta sozinho depois.
   *
   * A conferência é por TIPO e não por texto. Com `IARA_PRAZO_PROVEDOR_MS=15000`
   * a mensagem conteria "15000", e o `/5\d{2}/` de `servico_fora` lá embaixo
   * casaria com "500" no meio do número — a classe certa pelo motivo errado, que
   * é o tipo de acerto que some no dia em que alguém mexer no prazo.
   */
  if (erro instanceof EloDemorouDemais) return 'servico_fora';
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
  /** Quantas vezes SEGUIDAS este elo falhou pela mesma causa. Ver a carência. */
  readonly seguidas?: number;
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
  const anterior = observacoes.get(apelido);
  /**
   * A REINCIDÊNCIA CONTA — e a carência dobra com ela.
   *
   * Medido em 18 e 19/08/2026: o Gemini devolveu `503` três vezes seguidas, em
   * corridas diferentes, levando 5,2 s, 21,9 s e 43,6 s para dizer que estava
   * fora. Entre elas a carência de dois minutos expirava e ele voltava para a
   * frente da fila — para cair de novo, pelo mesmo motivo, cobrando a mesma
   * espera. Carência de tamanho fixo trata a terceira queda como se fosse a
   * primeira.
   *
   * Só a MESMA CLASSE acumula: um `503` depois de um `rate_limit` é outro
   * problema, e herdar o recuo do anterior puniria o elo por um defeito que
   * não é o dele. Sucesso zera — `registrarSucessoProvedor` apaga a observação
   * inteira.
   */
  const seguidas = anterior?.classe === classe ? (anterior.seguidas ?? 1) + 1 : 1;
  observacoes.set(apelido, {
    seguidas,
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

/**
 * LATÊNCIA OBSERVADA — quanto cada elo demorou para começar a falar.
 *
 * MEDIDA, NUNCA DECLARADA. Um número de latência escrito à mão envelhece no dia
 * seguinte: provedor gratuito muda de fila, modelo é trocado, a rede daqui não é
 * a rede de lá. O que vale é o que ESTE processo observou.
 *
 * É O TEMPO ATÉ O PRIMEIRO PEDAÇO, e não o total, pela mesma razão que o prazo
 * de abandono usa esse marco: é ele que tira a tela do vazio. Uma resposta longa
 * que começa em 1 s é melhor, para quem espera, que uma curta que começa em 10.
 *
 * SÓ SUCESSO CONTA. Medido em 18/08/2026, o OpenRouter devolvia `429` em 46 ms e
 * o Gemini `503` em 43 s — contar falha como latência faria o elo com a cota
 * esgotada parecer o mais rápido da casa e ganhar a frente da fila.
 *
 * Guarda as últimas amostras e usa a MEDIANA: uma ida ruim isolada não deve
 * rebaixar um elo bom, e uma boa isolada não deve promover um ruim. O anel é
 * curto de propósito — a fila gratuita muda de humor ao longo do dia, e média
 * longa demais mede o passado.
 */
const AMOSTRAS_POR_ELO = 5;
const latencias = new Map<string, number[]>();

export function registrarLatenciaProvedor(apelido: string, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) return;
  const anel = latencias.get(apelido) ?? [];
  anel.push(ms);
  if (anel.length > AMOSTRAS_POR_ELO) anel.shift();
  latencias.set(apelido, anel);
}

/** A mediana observada, ou `null` quando este elo nunca respondeu. */
export function latenciaObservada(apelido: string): number | null {
  const anel = latencias.get(apelido);
  if (!anel || anel.length === 0) return null;
  const ordenado = [...anel].sort((a, b) => a - b);
  return ordenado[Math.floor(ordenado.length / 2)];
}

/** Cópia para o diagnóstico. */
export function latenciasObservadas(): ReadonlyMap<string, number> {
  const mapa = new Map<string, number>();
  for (const apelido of latencias.keys()) {
    const m = latenciaObservada(apelido);
    if (m !== null) mapa.set(apelido, m);
  }
  return mapa;
}

/** Só para teste: registro de processo precisa de reset entre casos. */
export function limparLatenciasObservadas(): void {
  latencias.clear();
}


/**
 * SABE FAZER ESTE TIPO DE TRABALHO? — a capacidade OBSERVADA por tarefa.
 *
 * A tentação, ao falar em "escolher modelo por tarefa", é escrever no código que
 * tal modelo planeja melhor. Isso seria opinião com cara de configuração, e
 * envelheceria no dia em que o provedor trocasse o modelo por baixo — foi
 * exatamente o que aconteceu com o `llama-3.3-70b-versatile` da Groq, fixado no
 * código e descomissionado sem aviso.
 *
 * Então nada é declarado: registra-se o que se VIU. Um elo que devolveu texto e
 * esse texto não virou plano é um elo que, para `plano`, falhou — e a próxima
 * vez ele desce na fila daquela tarefa.
 *
 * SÓ CONTA QUANDO O MODELO RESPONDEU. Provedor que estourou cota não disse nada
 * sobre saber planejar; contá-lo como incapaz condenaria um elo bom por um
 * problema de conta. É a mesma linha que separa latência de falha rápida.
 *
 * REBAIXA, NUNCA REMOVE. Uma falha de formato pode ser sorteio de temperatura, e
 * excluir por uma amostra é sobreajuste. O elo incapaz vai para o fim do grupo e
 * continua sendo tentado quando os de cima falharem — mesma disciplina de
 * `ordenarPorSaude`, pelo mesmo motivo.
 */
export type TarefaDoModelo = 'plano' | 'resposta';

const capacidades = new Map<string, { ok: number; falhou: number }>();
const chaveCapacidade = (apelido: string, tarefa: TarefaDoModelo): string => `${apelido}:${tarefa}`;

export function registrarCapacidadeProvedor(
  apelido: string,
  tarefa: TarefaDoModelo,
  conseguiu: boolean,
): void {
  const chave = chaveCapacidade(apelido, tarefa);
  const atual = capacidades.get(chave) ?? { ok: 0, falhou: 0 };
  if (conseguiu) atual.ok += 1;
  else atual.falhou += 1;
  capacidades.set(chave, atual);
}

/**
 * `null` = nunca observado, e aí não há opinião. `false` = já falhou mais vezes
 * do que acertou nesta tarefa.
 */
export function capacidadeObservada(apelido: string, tarefa: TarefaDoModelo): boolean | null {
  const c = capacidades.get(chaveCapacidade(apelido, tarefa));
  if (!c || c.ok + c.falhou === 0) return null;
  return c.ok >= c.falhou;
}

export function limparCapacidadesObservadas(): void {
  capacidades.clear();
}

/**
 * ORDENA POR LATÊNCIA DENTRO DA CAMADA — e o "dentro da camada" é a parte que
 * impede um estrago.
 *
 * A ordem da cadeia carrega uma DECISÃO DE CUSTO, tomada e documentada em
 * 18/08/2026: as gratuitas primeiro, a Anthropic (única paga) por último. E a
 * Anthropic é, de longe, a mais rápida — 1,4–1,9 s ao primeiro pedaço contra
 * 5–44 s do Gemini naquele mesmo dia. Ordenar por latência sem olhar a camada
 * poria a paga na frente e reverteria, em silêncio, uma decisão que alguém tomou
 * de propósito. Latência não pode revogar orçamento.
 *
 * ENTÃO O PADRÃO COMPETE COM O PADRÃO, e o premium fica onde a decisão de custo
 * o pôs. Dentro de cada grupo, quem responde mais rápido vai na frente.
 *
 * SEM MEDIÇÃO, SEM OPINIÃO — e a implementação disso não é um comparador que
 * devolve zero. Um comparador que devolve zero para alguns pares e não para
 * outros deixa de ser ordem total: com A sem medição, B=10 e C=5, `A vs B` e
 * `A vs C` empatam mas `B vs C` não, e o resultado passa a depender da ORDEM EM
 * QUE o `sort` compara. Ordenação de fila de provedor não pode variar por
 * detalhe de implementação do motor de JavaScript.
 *
 * Então os elos MEDIDOS são ordenados entre si e reescritos nas posições que já
 * ocupavam; os não medidos ficam parados onde a configuração os pôs. Um elo novo
 * não é promovido por otimismo nem rebaixado por desconhecimento — ele mantém o
 * lugar declarado até dizer, respondendo, quanto custa esperar por ele.
 */
export function ordenarPorLatencia<T extends { apelido: string; camada?: 'padrao' | 'premium' }>(
  elos: readonly T[],
  tarefa?: TarefaDoModelo,
): T[] {
  const fora = [...elos];
  /**
   * O GRUPO É (SAÚDE, CAMADA) — e a saúde entrar aqui foi um defeito que um
   * teste pegou.
   *
   * A primeira versão agrupava só por camada, e com isso DESFAZIA a ordenação
   * por saúde: um elo em carência, por ser rápido, voltava para a frente de um
   * saudável mais lento. Rápido e quebrado continua quebrado, e o comentário
   * acima já prometia "dentro do que a saúde já separou" — a implementação é que
   * não cumpria.
   *
   * Reordenar dentro de cada grupo nunca move um elo através da fronteira que
   * `ordenarPorSaude` desenhou.
   */
  const chave = (e: T): string => `${emCarencia(e.apelido) ? 'doente' : 'sao'}:${e.camada ?? 'padrao'}`;
  const grupos = [...new Set(fora.map(chave))];

  for (const g of grupos) {
    /* As POSIÇÕES ocupadas por elos medidos deste grupo. Só elas são
       reescritas — tudo o mais fica exatamente onde estava. */
    /**
     * "TER OPINIÃO" É LATÊNCIA **OU** CAPACIDADE, não só latência.
     *
     * A primeira versão coletava apenas quem tinha latência medida, e com isso a
     * capacidade observada NUNCA era aplicada num elo que ainda não tinha
     * respondido — que é exatamente o caso de quem só falhou em planejar. O
     * teste C29 pegou: o elo que provadamente não devolve JSON continuava na
     * frente porque ninguém sabia quanto ele demora.
     */
    const temOpiniao = (e: T): boolean =>
      latenciaObservada(e.apelido) !== null ||
      (tarefa !== undefined && capacidadeObservada(e.apelido, tarefa) !== null);
    const posicoes: number[] = [];
    for (const [i, e] of fora.entries()) {
      if (chave(e) === g && temOpiniao(e)) posicoes.push(i);
    }
    if (posicoes.length < 2) continue;

    /**
     * CAPACIDADE ANTES DE LATÊNCIA, e a ordem entre as duas é a de sempre nesta
     * casa: primeiro "serve?", depois "quanto custa esperar?". Um elo que não
     * devolve JSON parseável não fica melhor por devolvê-lo depressa — a chamada
     * inteira vira token gasto do mesmo jeito.
     *
     * Sem tarefa declarada ou sem observação, `incapaz` é 0 para todos e a
     * ordenação recai inteiramente sobre a latência.
     */
    const incapaz = (e: T): number =>
      tarefa && capacidadeObservada(e.apelido, tarefa) === false ? 1 : 0;
    const ordenados = posicoes
      .map((i) => fora[i])
      .sort(
        (a, b) =>
          incapaz(a) - incapaz(b) ||
          (latenciaObservada(a.apelido) ?? 0) - (latenciaObservada(b.apelido) ?? 0),
      );
    posicoes.forEach((pos, k) => {
      fora[pos] = ordenados[k];
    });
  }
  return fora;
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
/**
 * O RECUO EFETIVO — a carência da classe, dobrada a cada reincidência.
 *
 * Teto de oito vezes a base: sem ele, um provedor fora do ar por um dia sairia
 * da fila por semanas, e voltar a tentá-lo é justamente como o sistema descobre
 * que ele voltou. `ordenarPorSaude` reordena em vez de remover pela mesma razão.
 */
export function carenciaEfetiva(falha: FalhaObservada): number {
  const base = CARENCIA_MS[falha.classe];
  if (base <= 0) return 0;
  const fator = Math.min(2 ** Math.max(0, (falha.seguidas ?? 1) - 1), 8);
  return base * fator;
}

export function emCarencia(apelido: string, agora: number = Date.now()): boolean {
  const falha = observacoes.get(apelido);
  if (!falha) return false;
  const carencia = carenciaEfetiva(falha);
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

/**
 * QUANTOS TOKENS ESTE PEDIDO CUSTA — estimativa, e declarada como tal.
 *
 * QUATRO CARACTERES POR TOKEN, e a escolha do número é sobre para que LADO
 * errar. Português corrido fica perto de 3 chars/token, então dividir por 4
 * SUBESTIMA — a cadeia vai achar o pedido menor do que ele é e tentar elos que
 * talvez não caibam.
 *
 * É o erro certo. Subestimar custa o que já custa hoje: uma ida à rede que
 * volta 413 em ~150 ms. Superestimar custaria pular um provedor gratuito que
 * teria funcionado — perder um cérebro por causa de uma conta de padaria. Entre
 * gastar 150 ms e perder um elo, gasta-se os 150 ms.
 *
 * A conta inclui o que o cliente REALMENTE manda: persona, camada global,
 * catálogo de capacidades, histórico e a mensagem. Deixar o histórico de fora
 * seria estimar o turno 1 e errar todos os seguintes.
 */
export function estimarTokensDoPedido(pedido: PedidoRaciocinio): number {
  /**
   * TUDO OPCIONAL NA LEITURA, mesmo o que o contrato declara obrigatório.
   *
   * `historico`, `overridePersona` e `camadaGlobal` são obrigatórios no tipo e
   * há chamador que não os passa — a bateria de roteamento é um deles, e a
   * primeira versão deste estimador derrubou seis cenários dela com
   * `Cannot read properties of undefined`. É o mesmo defeito que o
   * `AbortSignal.any([undefined])` cometeu no abandono por demora, e a lição é a
   * mesma: uma ESTIMATIVA que explode é pior que uma que erra baixo. Errando
   * baixo, o pior caso é o comportamento de hoje — tentar um elo que não cabe.
   */
  const tamanho = (v: unknown): number => (typeof v === 'string' ? v.length : 0);
  const historico = Array.isArray(pedido.historico)
    ? pedido.historico.reduce((n, r) => n + tamanho(r?.texto), 0)
    : 0;
  const caracteres =
    tamanho(pedido.mensagem) +
    tamanho(pedido.overridePersona) +
    tamanho(pedido.camadaGlobal) +
    tamanho(pedido.capacidades) +
    historico;
  return Math.ceil(caracteres / 4);
}

/**
 * ESTE ELO CABE? `true` quando ele não declara limite — não medir não é motivo
 * para recusar.
 */
export function eloComporta(elo: ProvedorRaciocinio, tokens: number): boolean {
  return elo.limite_entrada_tokens === undefined || tokens <= elo.limite_entrada_tokens;
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

  /**
   * O POOL PREMIUM: os elos declaradamente de maior capacidade, fora de
   * carência. Vazio é resposta legítima — significa "não há para onde escalar",
   * e a escalada degrada honestamente em vez de fingir que tentou.
   */
  private premiumVivos(): ProvedorRaciocinio[] {
    return this.elos.filter(
      (e) => e.camada === 'premium' && e.disponivel && !emCarencia(e.apelido),
    );
  }

  premiumSaudavel(): boolean {
    return this.premiumVivos().length > 0;
  }

  /**
   * REFAZ O PEDIDO NO PREMIUM — e não é retentativa.
   *
   * A diferença está no gatilho: retentativa acontece porque o resultado não
   * chegou a existir; isto acontece porque ele existe e um verificador
   * independente o contestou. Ver `EscaladaDoTurno.ts`.
   *
   * Não passa por `ordenarPorSaude` nem percorre a fila inteira: escalar é ir a
   * UM lugar específico. Se o premium falhar aqui, o erro sobe — não se cai de
   * volta para o barato que já errou.
   */
  async raciocinarNoPremium(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    const premium = this.premiumVivos()[0];
    if (!premium) throw new ProvedorIndisponivel('não há camada premium para escalar');
    this.atual = premium;
    try {
      const r = await premium.raciocinar(pedido);
      registrarSucessoProvedor(premium.apelido);
      return r;
    } catch (erro) {
      registrarFalhaProvedor(premium.apelido, erro, pedido.sinal);
      throw erro;
    }
  }

  async raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio> {
    const candidatos = this.elos.filter((e) => e.disponivel);
    /**
     * `disponivel` responde "a chave está no ambiente"; `ordenarPorSaude`
     * responde "ela funcionou da última vez". São perguntas diferentes, e era a
     * segunda que faltava — ver `CARENCIA_MS`.
     */
    /**
     * SAÚDE PRIMEIRO, LATÊNCIA DEPOIS — e a ordem entre as duas não é arbitrária.
     *
     * "Funcionou da última vez" é uma pergunta sobre EXISTIR resposta; "responde
     * rápido" é sobre QUANTO custa esperar por ela. Um elo em carência que
     * respondia em 1 s não deve ganhar a frente de um saudável que leva 3 —
     * rápido e quebrado continua quebrado. Por isso a latência reordena DENTRO
     * do que a saúde já separou, nunca por cima dela.
     */
    const porSaude = ordenarPorLatencia(
      ordenarPorSaude(candidatos.length > 0 ? candidatos : this.elos),
      pedido.tarefa,
    );

    /**
     * O ELO QUE NÃO CABE NÃO É TENTADO — o primeiro degrau do roteamento por
     * modelo, e o único respondível ANTES de gastar a ida à rede.
     *
     * A Groq gratuita tem teto de 8.000 tokens por minuto e o prompt de sistema
     * da IARA custa ~5.000; medido em 18/08/2026, cinco chamadas seguidas deram
     * 1 ok e 4 `429 … Limit 8000, Used 5036`, e um pedido maior deu
     * `413 Request too large … Requested 10226`. Tentar assim mesmo é uma ida à
     * rede cuja resposta já se sabe.
     *
     * PULAR NÃO É FALHAR: nada é registrado contra o elo, e ele não entra em
     * carência. Ele não foi tentado — a mesma regra do orçamento recusando
     * tentativa, pelo mesmo motivo (marcar carência aqui rebaixaria um provedor
     * saudável no turno seguinte).
     *
     * E SE NENHUM COUBER, a fila volta inteira. "Todos os elos são pequenos
     * demais" não pode virar "a IARA não tem cérebro nenhum" — é o mesmo
     * argumento de `ordenarPorSaude` reordenar em vez de remover: trocar uma
     * recusa provável por uma recusa certa não é ganho.
     */
    const tokens = estimarTokensDoPedido(pedido);
    const cabem = porSaude.filter((e) => eloComporta(e, tokens));
    const fila = cabem.length > 0 ? cabem : porSaude;
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

      /**
       * O ABANDONO POR DEMORA. Sinal próprio, combinado com o do turno: o do
       * turno é do operador e mata tudo; este é da cadeia e só descarta ESTE elo.
       *
       * Combinar em vez de substituir é obrigatório — passar só o nosso deixaria
       * um cancelamento do operador sem efeito dentro da chamada de rede, e a
       * IARA continuaria pensando depois de mandarem parar.
       */
      const comecouEm = Date.now();
      const abandono = new AbortController();
      const prazoElo = prazoDoPrimeiroPedaco();
      const relogioDoElo = setTimeout(() => {
        if (!comecouAFalar) abandono.abort(new EloDemorouDemais(elo.apelido, prazoElo));
      }, prazoElo);

      try {
        this.atual = elo;
        const resposta = await elo.raciocinar({
          ...pedido,
          /* `pedido.sinal` é obrigatório no contrato e há chamador que não o
             passa — a bateria de roteamento é um deles. `AbortSignal.any`
             levanta com `undefined` na lista, e uma cadeia que explode por falta
             de sinal seria pior que a demora que ela veio consertar. */
          sinal: AbortSignal.any(
            [pedido.sinal, abandono.signal].filter((x): x is AbortSignal => x !== undefined),
          ),
          aoReceberTexto: (pedaco) => {
            /* Começou a falar: o prazo morre aqui. Daqui em diante o turno é
               deste elo, dê no que der — cortar no meio duplicaria a fala. */
            if (!comecouAFalar) {
              clearTimeout(relogioDoElo);
              /* O MARCO DA MEDIÇÃO é este, e não o fim da resposta: é o primeiro
                 pedaço que tira a tela do vazio. Registrado só no caminho de
                 sucesso — falha rápida não é elo rápido. */
              registrarLatenciaProvedor(elo.apelido, Date.now() - comecouEm);
            }
            comecouAFalar = true;
            pedido.aoReceberTexto(pedaco);
          },
        });
        registrarSucessoProvedor(elo.apelido);
        return resposta;
      } catch (erroBruto) {
        /**
         * O ABANDONO CHEGA AQUI COMO `AbortError`, e é preciso desmascará-lo
         * ANTES de classificar: `classificarFalhaProvedor` manda todo abort para
         * `cancelado`, e `cancelado` não merece outro cérebro. Sem esta troca, o
         * abandono mataria o turno exatamente quando deveria adiantá-lo.
         *
         * A conferência é pelo sinal do ABANDONO e não pelo do turno: se o
         * operador cancelou, quem venceu foi ele, e aí `cancelado` está certo.
         */
        const erro =
          abandono.signal.aborted && !pedido.sinal?.aborted
            ? new EloDemorouDemais(elo.apelido, prazoElo)
            : erroBruto;
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
      } finally {
        clearTimeout(relogioDoElo);
      }
    }

    throw ultimoErro;
  }
}
