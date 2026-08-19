/**
 * O CONTRATO da camada de raciocínio — a única forma que o kernel conhece.
 *
 * `MotorRaciocinio` fala com QUALQUER cérebro através desta interface; quem
 * decide qual cérebro é a `FabricaRaciocinio`, na subida. Duas implementações
 * existem: `ClienteClaude` (nuvem Anthropic) e `ClienteOllama` (inferência
 * local). Nenhuma importa a outra, e este arquivo não importa nenhuma das
 * duas — contrato ← implementações ← fábrica, nunca o contrário, porque ciclo
 * ESM aqui é o defeito documentado em `diagnostico.ts`.
 *
 * O que o contrato NÃO muda: a autoridade. O provedor local entra pelo MESMO
 * `MotorRaciocinio`, pelo mesmo `interpretarPlano`, pelo mesmo porteiro. Uma
 * LLM rodando no próprio computador tem exatamente a autoridade da LLM de
 * nuvem: nenhuma.
 */

import type { RegistroMemoria } from '../../lib/estado';

/** Lançado por qualquer provedor quando a camada de raciocínio não está utilizável. */
export class ProvedorIndisponivel extends Error {}

/** O tipo mora em `lib/estado.ts` — ele atravessa a fronteira até as projeções
 *  dentro do snapshot, e `lib/` não pode importar de `servidor/`. */
export type { OrigemRaciocinio } from '../../lib/estado';

export interface PedidoRaciocinio {
  mensagem: string;
  historico: RegistroMemoria[];
  /** Anexado ao system DEPOIS do breakpoint de cache. */
  overridePersona: string;
  /** Fatos públicos da empresa. Parte do prefixo estável. */
  camadaGlobal: string;
  /**
   * O catálogo de habilidades, já redigido pelo `GerenciadorHabilidades`.
   *
   * CHEGA PRONTO, e isso é fronteira, não estilo: a camada de conversa não pode
   * importar `habilidades/`, porque o catálogo alcança o `AgenteLocal` e ela
   * passaria a alcançar o mundo por transitividade —
   * `testes/fronteira-interna.test.ts` derruba a suíte se isso acontecer. É a
   * mesma injeção que o `MotorAnalise` recebe para saber o que sabe fechar.
   *
   * Vazio no modo planejador, que monta a própria lista com outro recorte.
   */
  capacidades?: string;
  sinal: AbortSignal;
  /**
   * O ORÇAMENTO DO TURNO, PERGUNTADO — não importado.
   *
   * A cadeia chama isto antes de tentar CADA elo. Devolver `false` significa "o
   * turno não tem mais tentativa de rede para pagar", e a cadeia para sem tentar
   * o próximo em vez de percorrer a fila inteira.
   *
   * É função e não objeto de propósito: esta camada não pode conhecer
   * `OrcamentoDoTurno` — ela vive do lado de fora do kernel, e um import daqui
   * para lá inverteria a fronteira que `testes/fronteira-interna.test.ts` vigia.
   * Ausente significa "sem teto", que é o caso de quem chama o provedor fora de
   * um turno (sonda, diagnóstico).
   */
  aoTentarProvedor?: () => boolean;
  aoReceberTexto: (pedaco: string) => void;
}

export interface RespostaRaciocinio {
  texto: string;
  tokens_entrada: number;
  tokens_saida: number;
  /** Tokens lidos do cache de prompt. Provedor sem cache devolve 0 — o campo é honesto, não simulado. */
  cache_lido: number;
  /** Recusa explícita do provedor. Provedor sem esse conceito devolve false. */
  recusado: boolean;
}

export interface ProvedorRaciocinio {
  /**
   * QUEM É ESTE CÉREBRO — `anthropic`, `groq`, `gemini`, `ollama`.
   *
   * `origem` responde "nuvem ou máquina local", que é o que a projeção precisa
   * saber. Não responde QUAL nuvem, e essa diferença apareceu em 16/08/2026: com
   * a cota da Anthropic esgotada, a operadora perguntou "mas você não tem Gemini
   * e Grok?" e não havia, em lugar nenhum do sistema, um campo capaz de nomear
   * o provedor que estava respondendo. Dois provedores de nuvem eram
   * indistinguíveis entre si em toda a telemetria.
   */
  readonly apelido: string;
  /** 'nuvem' (Anthropic, Groq, Gemini) ou 'local' (Ollama) — telemetria e snapshot. */
  readonly origem: 'nuvem' | 'local';
  /**
   * A CAMADA DE CAPACIDADE — para onde a escalada por verificação aponta.
   *
   * `origem` responde "roda aqui ou na nuvem", que é pergunta de infraestrutura.
   * Esta responde "vale gastar mais por uma resposta melhor", que é pergunta de
   * qualidade — e são coisas diferentes: o Ollama é local e fraco, a Groq é
   * nuvem e barata, a Anthropic é nuvem e cara.
   *
   * Ausente significa `padrao`. Só quem é declaradamente premium recebe a
   * escalada; sem isso a IARA "escalaria" para um cérebro igual e gastaria
   * orçamento para receber o mesmo erro.
   */
  readonly camada?: 'padrao' | 'premium';
  /**
   * QUANTO CABE NUM PEDIDO, em tokens. `undefined` = não medido — e aí a cadeia
   * tenta, porque ausência de medição nunca pode virar recusa.
   *
   * É o primeiro degrau do roteamento por MODELO: hoje a cadeia escolhe por
   * saúde ("funcionou da última vez") e por camada ("vale gastar mais"). Falta
   * a pergunta mais barata das três, que é *cabe?* — e ela é a única
   * respondível antes de gastar a ida à rede.
   */
  readonly limite_entrada_tokens?: number;
  /**
   * Existe camada premium utilizável AGORA? Opcional porque um provedor único
   * não tem para onde escalar — e `undefined` é a resposta honesta ali, não
   * `false` disfarçado de política.
   */
  premiumSaudavel?(): boolean;
  /** Refaz o pedido no elo premium. Só a cadeia implementa. */
  raciocinarNoPremium?(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio>;
  readonly modelo: string;
  readonly disponivel: boolean;
  /**
   * Sonda ativa opcional. O Anthropic não implementa (chave presente =
   * disponível); o Ollama confirma que o servidor local responde antes de o
   * snapshot anunciar raciocínio local.
   */
  sondar?(): Promise<boolean>;
  raciocinar(pedido: PedidoRaciocinio): Promise<RespostaRaciocinio>;
}

/**
 * NORMALIZAÇÃO DO HISTÓRICO — compartilhada pelos provedores. A API da
 * Anthropic exige que a primeira mensagem seja `user` e os papéis alternem; o
 * Ollama tolera mais, mas um único comportamento testável vale mais que dois
 * quase iguais. O shard não garante a forma: turno cancelado grava só o lado
 * do operador, falha de persistência pula registros. Sem normalizar, um
 * histórico começando em `assistant` (ou com dois `user` seguidos) derruba
 * TODA chamada de nuvem com erro 400 até a janela deslizar. Regras: corta
 * prefixo até o primeiro `user`; papéis consecutivos iguais são fundidos num
 * único bloco; a mensagem corrente fecha a lista — se o histórico terminou em
 * `user` (registro da própria mensagem já gravado), funde em vez de duplicar.
 */
export function normalizarHistorico(
  historico: RegistroMemoria[],
  mensagem: string,
): Array<{ role: 'user' | 'assistant'; content: string }> {
  const brutas = historico.map((r) => ({
    role: r.papel === 'operador' ? ('user' as const) : ('assistant' as const),
    content: r.texto,
  }));
  const inicio = brutas.findIndex((m) => m.role === 'user');
  const mensagens: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  if (inicio >= 0) {
    for (const m of brutas.slice(inicio)) {
      const anterior = mensagens[mensagens.length - 1];
      if (anterior && anterior.role === m.role) {
        anterior.content = `${anterior.content}\n\n${m.content}`;
      } else {
        mensagens.push({ ...m });
      }
    }
  }
  const ultima = mensagens[mensagens.length - 1];
  if (ultima && ultima.role === 'user') {
    if (ultima.content !== mensagem) {
      ultima.content = `${ultima.content}\n\n${mensagem}`;
    }
  } else {
    mensagens.push({ role: 'user' as const, content: mensagem });
  }
  return mensagens;
}
