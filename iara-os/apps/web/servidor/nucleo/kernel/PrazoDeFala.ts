/**
 * O PRAZO DE FALA — quanto tempo o operador fica olhando para o nada.
 *
 * O DEFEITO, medido em 18/08/2026 com motor real e provedor real: seis de
 * catorze turnos passaram 90 s sem produzir uma única coisa na tela. Sem erro,
 * sem estouro de orçamento, sem nada no console do operador. A sala em
 * "pensando" e a pessoa concluindo, com razão, que travou.
 *
 * POR QUE `IARA_ORCAMENTO_TEMPO_MS` NÃO RESOLVIA, apesar de contar o mesmo
 * milissegundo: são duas perguntas diferentes com um número só.
 *
 *   orçamento de tempo — "este turno já custou demais?"   15 min, e está certo:
 *                        o provedor local leva ~263 s por chamada, e um teto de
 *                        60 s ali transformaria operação normal em recusa.
 *   prazo de fala      — "esta pessoa já esperou demais?"  ~20 s, porque é isso
 *                        que alguém aguenta olhando para uma tela parada.
 *
 * E o orçamento nem é um cronômetro: ele é conferido quando alguém chama
 * `consumir`. Um turno parado dentro de uma chamada lenta nunca é interrompido
 * por ele — passa despercebido pelos dois portões e chega aos 90 s.
 *
 * ELE NÃO ABORTA NADA, e essa é a decisão mais importante do arquivo.
 *
 * Cortar o turno no prazo pareceria mais decidido e produziria o defeito OPOSTO:
 * `executarPlano` pode estar com um efeito em voo, e abortar ali faria a IARA
 * dizer "não consegui" sobre uma pasta que nasceu, um e-mail que saiu. É
 * `FALSO_NEGATIVO` — pela tabela da campanha, *menos perigoso para a confiança e
 * mais perigoso para o mundo*, porque um efeito que ninguém sabe que aconteceu
 * não é desfeito por ninguém. Trocar silêncio por mentira não é conserto.
 *
 * Então ele faz uma coisa só: avisa. O turno segue exatamente como seguia.
 *
 * O AVISO NÃO PROMETE NADA. "Aviso assim que terminar" seria promessa de ação
 * futura, e `auditarPromessa` da campanha trata promessa não cumprida no turno
 * como incidente — com razão. O texto diz o que está acontecendo AGORA, medido:
 * segundos decorridos e em qual tentativa de provedor a cadeia está.
 */

import type { BarramentoEventos } from './BarramentoEventos';
import { lerConfig } from './Configuracao';

/**
 * VINTE SEGUNDOS, e o número tem origem — não é arredondamento bonito.
 *
 * A medição de 18/08/2026 na cadeia gratuita: turnos bons responderam em 1,8 s,
 * 2,6 s, 3,1 s e 6,3 s; os ruins em 62 s, 74 s e 90 s (estes últimos, o teto do
 * cliente — provavelmente teriam ido além). Não há nada entre 6 e 62. Vinte
 * segundos cai no vazio dessa distribuição: nenhum turno saudável desta medição
 * chega perto de disparar, e todo turno patológico dispara com folga.
 *
 * Um prazo dentro da nuvem de turnos bons faria a IARA avisar que está devagar
 * quando não está — e um aviso que aparece sempre é um aviso que ninguém lê.
 */
export const PRAZO_FALA_PADRAO_MS = 20_000;

export function prazoDeFalaDoAmbiente(): number {
  const bruto = lerConfig('IARA_PRAZO_FALA_MS');
  if (bruto === null) return PRAZO_FALA_PADRAO_MS;
  const n = Number(bruto);
  /* Zero ou negativo desligaria o aviso em silêncio, e "desligado por engano" é
     indistinguível de "nunca demorou". Quem quiser desligar declara um número
     grande, que aparece no diagnóstico como o número que é. */
  return Number.isInteger(n) && n > 0 ? n : PRAZO_FALA_PADRAO_MS;
}

/**
 * A FRASE. Curta, factual, sem promessa e sem afirmar efeito nenhum — ela passa
 * pelo `LeitorDeFala` da campanha como qualquer outra fala, e uma frase de
 * espera que sugerisse conclusão seria mentira operacional de tipo novo.
 */
export function textoDeEspera(decorridoMs: number, tentativasDeProvedor: number): string {
  const s = Math.round(decorridoMs / 1000);
  const cauda =
    tentativasDeProvedor > 1
      ? ` A camada de raciocínio está na ${tentativasDeProvedor}ª tentativa — provedor lento ou sem cota.`
      : '';
  return `Ainda estou nisto: ${s} segundos até agora.${cauda}`;
}

export interface AvisoDeEspera {
  /** Chame sempre no `finally` do turno. Idempotente. */
  cancelar(): void;
  /** O aviso chegou a ser publicado? Para telemetria e teste. */
  disparou(): boolean;
}

export interface DependenciasDoPrazo {
  readonly barramento: BarramentoEventos;
  readonly idDaPergunta: string;
  /** Quantas tentativas de provedor o turno já gastou, perguntado na hora. */
  readonly tentativasDeProvedor: () => number;
  readonly prazoMs?: number;
  /** Injetáveis para o teste não depender de relógio de parede real. */
  readonly agora?: () => number;
  readonly agendar?: (fn: () => void, ms: number) => unknown;
  readonly desagendar?: (id: unknown) => void;
}

/**
 * Arma o aviso. Devolve o cancelamento — que precisa rodar em TODO caminho de
 * saída do turno, inclusive exceção, senão um turno rápido dispara o aviso
 * depois de já ter respondido.
 */
export function armarAvisoDeEspera(dep: DependenciasDoPrazo): AvisoDeEspera {
  const agora = dep.agora ?? Date.now;
  const agendar = dep.agendar ?? ((fn, ms) => setTimeout(fn, ms));
  const desagendar = dep.desagendar ?? ((id) => clearTimeout(id as NodeJS.Timeout));
  const prazo = dep.prazoMs ?? prazoDeFalaDoAmbiente();
  const inicio = agora();

  let perceptivel = false;
  let publicou = false;
  let cancelado = false;

  /**
   * QUALQUER COISA QUE A TELA MOSTRARIA conta como "o operador já viu algo": um
   * trecho da fala streamando ou a fala inteira de uma vez. Observar o
   * barramento em vez de instrumentar os treze pontos que publicam fala é o que
   * mantém isto fora do caminho do turno — e é o mesmo choke point que a
   * `PonteProjecao` usa para decidir o que vai para a tela.
   */
  const desassinar = dep.barramento.assinarTudo((e) => {
    if (e.tipo === 'RESPOSTA_TRECHO' || e.tipo === 'TAREFA_CONCLUIDA') perceptivel = true;
  });

  const bilhete = agendar(() => {
    if (cancelado || perceptivel) return;
    publicou = true;
    /* Publicado como TRECHO, não como conclusão: o turno NÃO acabou, e um
       `TAREFA_CONCLUIDA` aqui faria o cliente (e a campanha) tratarem o aviso
       como a resposta. O trecho seguinte, quando vier, substitui este texto —
       `RESPOSTA_TRECHO` carrega o acumulado inteiro, não o delta. */
    dep.barramento.publicar({
      tipo: 'RESPOSTA_TRECHO',
      id_mensagem: `espera:${dep.idDaPergunta}`,
      texto: textoDeEspera(agora() - inicio, dep.tentativasDeProvedor()),
      responde_a: dep.idDaPergunta,
      /**
       * MARCA OBRIGATÓRIA. Sem ela, o `CompiladorSnapshot` promove este recado a
       * resposta quando o turno morre — medido: o turno 5 expirou, o 6 chegou, e
       * "Ainda estou nisto: 2 segundos até agora." virou a resposta do turno 5.
       */
      provisoria: true,
    });
  }, prazo);

  return {
    cancelar(): void {
      if (cancelado) return;
      cancelado = true;
      desagendar(bilhete);
      desassinar();
    },
    disparou: () => publicou,
  };
}
