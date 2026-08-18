/**
 * Detector de ambiguidade — o que falta para agir com segurança.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO, e que é fácil errar nos dois sentidos:
 *
 *   perguntar o que o contexto já responde é tão ruim quanto adivinhar.
 *
 * Um assistente que pergunta "qual relatório?" quando o operador falou daquele
 * relatório há dois turnos é um assistente que não presta atenção. Um que
 * escolhe sozinho entre três Joões é um assistente que erra alto. As duas
 * falhas têm a mesma causa — não olhar o contexto antes de decidir — e por isso
 * moram no mesmo módulo.
 *
 * Este detector NÃO decide perguntar. Ele reporta o que está indeterminado; a
 * `PoliticaDecisao` cruza isso com risco e confiança para decidir.
 */

import { normalizar } from '../texto';
import { extrairNomePasta } from './Planejador';

export type TipoAmbiguidade =
  /** "aquele relatório", "esse arquivo" — referência sem antecedente achável. */
  | 'referencia_sem_antecedente'
  /** "manda pro João" com mais de um João possível. */
  | 'destinatario_multiplo'
  /** "manda isso" — ação que alcança alguém, sem alvo nenhum. */
  | 'destinatario_ausente'
  /** "cria uma pasta" — criar algo que precisa de nome, sem nome nenhum. */
  | 'objeto_sem_nome'
  /** "cria a pasta X. na verdade não, deixa pra lá" — pedido cancelado na própria frase. */
  | 'ordem_revogada';

export interface Ambiguidade {
  readonly tipo: TipoAmbiguidade;
  /** O que exatamente falta. Vira a pergunta — por isso é específico. */
  readonly faltando: string;
  /** Candidatos, quando existem. A pergunta os oferece em vez de abrir espaço. */
  readonly candidatos: readonly string[];
}

export interface ContextoDecisao {
  /** Texto dos turnos recentes, do mais antigo ao mais novo. */
  readonly historicoRecente: readonly string[];
  /** Pessoas que a IARA sabe nomear. Hoje: os demais operadores da casa. */
  readonly pessoasConhecidas: readonly string[];
}

export const CONTEXTO_VAZIO: ContextoDecisao = {
  historicoRecente: [],
  pessoasConhecidas: [],
};

// ---------------------------------------------------------------------------


/**
 * CRIAR ALGO QUE PRECISA DE NOME. Hoje só pasta — é a única criação nomeada que o
 * catálogo determinístico executa. Quando entrar arquivo, entra aqui junto.
 */
const CRIAR_PASTA = /\b(cria|criar|crie|faz|fazer|faça|monta|montar|monte)\b[^.!?]*\bpasta\b/;

/**
 * REVOGAÇÃO NA MESMA MENSAGEM — e a lista é curta de propósito.
 *
 * `não` sozinho está FORA: "cria a pasta X, não a Y" é correção de alvo, não
 * cancelamento, e tratá-la como revogação faria a IARA parar de atender pedido
 * legítimo — o defeito simétrico, que custa mais caro que o original porque o
 * operador não tem como entender o que aconteceu.
 *
 * O que entra são frases que só existem para desfazer o que veio antes.
 */
const REVOGACAO =
  /\b(na verdade n[ãa]o|deixa pra l[áa]|deixa quieto|esquece|esquece isso|cancela|cancelar|melhor n[ãa]o|n[ãa]o precisa mais|desconsidera)\b/;

/** Verbos que fazem algo CHEGAR em outra pessoa. */
const VERBO_ENVIO = /\b(manda|mandar|mande|envia|enviar|envie|encaminha|encaminhar|encaminhe|repassa|repassar|passa pro|passa para)\b/;

/** Referência que aponta para algo dito antes, sem nomear. */
const REFERENCIA_ANAFORICA =
  /\b(aquele|aquela|aqueles|aquelas|esse|essa|esses|essas|este|esta|o mesmo|a mesma|de novo|novamente)\b/;

/**
 * Substantivos que uma referência anafórica costuma qualificar. Sem um destes,
 * "de novo" provavelmente se refere à conversa, não a um objeto de trabalho.
 */
const OBJETO_DE_TRABALHO =
  /\b(relatorio|relatorios|planilha|planilhas|arquivo|arquivos|documento|documentos|pasta|pastas|consulta|consultas|analise|analises|grafico|graficos|extrato|extratos|pedido|pedidos)\b/;

/** Marca de destinatário: "pro X", "para o X", "ao X". */
const MARCA_DESTINATARIO = /\b(pro|pra|para o|para a|para|ao|a)\s+([a-z]{3,})\b/;

/** Palavras que nunca são nome de pessoa, mesmo depois de "para". */
const NAO_E_NOME =
  /^(mim|voce|nos|eles|elas|isso|isto|aquilo|ontem|hoje|amanha|agora|ele|ela|la|ali|casa|empresa|todos|todas|qual|quem|que|onde|quando)$/;

/**
 * O destinatário é o PRÓPRIO OPERADOR.
 *
 * "me manda aquele documento" tem verbo de envio, mas não alcança terceiro
 * nenhum — a IARA é que vai entregar, a quem já está falando com ela. Sem esta
 * exceção o detector pedia "para quem devo enviar?" para um pedido cujo
 * destinatário é a pessoa que digitou. Perguntar isso é o tipo de ruído que
 * ensina o operador a ignorar as perguntas da IARA, inclusive as necessárias.
 */
const DESTINATARIO_EH_O_OPERADOR = /\b(me|mim|pra mim|para mim)\b/;

/**
 * Devolve o acento aos substantivos que o reconhecedor viu normalizados.
 *
 * Só os que este módulo pode citar numa pergunta — não é um dicionário, é a
 * lista fechada de `OBJETO_DE_TRABALHO`. Palavra fora da lista sai como está.
 */
const ACENTUADO: Record<string, string> = {
  relatorio: 'relatório',
  relatorios: 'relatórios',
  analise: 'análise',
  analises: 'análises',
  grafico: 'gráfico',
  graficos: 'gráficos',
};

function comAcento(palavra: string): string {
  return ACENTUADO[palavra] ?? palavra;
}

// ---------------------------------------------------------------------------

export class DetectorAmbiguidade {
  /**
   * O que está indeterminado neste pedido, à luz do contexto disponível.
   *
   * Devolve lista vazia quando o contexto resolve — que é o caso mais comum e
   * o mais importante de acertar.
   */
  detectar(bruto: string, contexto: ContextoDecisao): Ambiguidade[] {
    const t = normalizar(bruto);
    const achadas: Ambiguidade[] = [];

    const envio = VERBO_ENVIO.test(t) && !DESTINATARIO_EH_O_OPERADOR.test(t);
    if (envio) {
      const alvo = this.extrairAlvo(t);
      if (!alvo) {
        achadas.push({
          tipo: 'destinatario_ausente',
          faltando: 'para quem devo enviar',
          candidatos: [...contexto.pessoasConhecidas],
        });
      } else {
        const candidatos = contexto.pessoasConhecidas.filter((p) =>
          normalizar(p).split(' ').some((parte) => parte === alvo),
        );
        if (candidatos.length > 1) {
          // O nome sai como a PESSOA escreve, não como o normalizador vê:
          // perguntar por `qual "joao"` denuncia o encanamento e lê como erro.
          const exibicao = candidatos[0].split(' ')[0];
          achadas.push({
            tipo: 'destinatario_multiplo',
            faltando: `qual ${exibicao}`,
            candidatos,
          });
        }
        // Zero candidatos NÃO é ambiguidade: o operador nomeou alguém que a
        // IARA não conhece. Isso é uma lacuna de dado, não de intenção — e
        // vira falha honesta na execução, não pergunta de esclarecimento.
      }
    }

    /**
     * Referência anafórica a objeto de trabalho: só é ambígua se o histórico
     * NÃO tiver um antecedente plausível.
     *
     * É a regra do §4: "faz aquele relatório de ontem de novo" com o relatório
     * mencionado no histórico se resolve sozinho. A IARA não pergunta o que
     * ela pode ler.
     */
    if (REFERENCIA_ANAFORICA.test(t) && OBJETO_DE_TRABALHO.test(t)) {
      const objeto = t.match(OBJETO_DE_TRABALHO)?.[0] ?? '';
      const temAntecedente = contexto.historicoRecente.some((turno) =>
        normalizar(turno).includes(objeto),
      );
      if (!temAntecedente) {
        achadas.push({
          tipo: 'referencia_sem_antecedente',
          // A busca roda no texto normalizado (sem acento), mas a pergunta vai
          // para uma pessoa: devolve o acento antes de falar.
          faltando: `a qual ${comAcento(objeto)} você se refere`,
          candidatos: [],
        });
      }
    }

    /**
     * PEDIU E DESPEDIU NA MESMA MENSAGEM.
     *
     * Medido pela campanha em 18/08/2026 (CO-05): *"Cria uma pasta chamada
     * Revogada X na área de trabalho. Na verdade não, deixa pra lá, esquece."*
     * criava a pasta. A âncora "pasta chamada X" dispara no início da frase e
     * nada olhava o resto — o pedido morre na segunda oração e o plano nasce da
     * primeira.
     *
     * A revogação tem de vir DEPOIS do pedido: uma mensagem que começa com
     * "esquece o que eu disse ontem, cria a pasta X" é pedido legítimo, e a
     * posição é o que separa os dois casos.
     */
    const ondeRevoga = t.search(REVOGACAO);
    const ondeAge = t.search(/\b(cria|criar|crie|manda|mandar|mande|envia|enviar|envie|abre|abrir|abra|apaga|apagar|apague|desliga|desligar|desligue|move|mover|mova)\b/);
    if (ondeRevoga >= 0 && ondeAge >= 0 && ondeRevoga > ondeAge) {
      achadas.push({
        tipo: 'ordem_revogada',
        faltando: 'se você ainda quer que eu faça',
        candidatos: [],
      });
      /* Revogação vence o resto: perguntar "que nome dar à pasta" de um pedido
         que a própria pessoa cancelou seria não ter lido a mensagem até o fim. */
      return achadas;
    }

    /**
     * CRIAR SEM NOME — a outra metade do achado de 18/08/2026 (CO-03).
     *
     * "Cria uma pasta na área de trabalho" criava `Nova pasta` no disco. O nome
     * ausente vem de `extrairNomePasta`, que é a MESMA função que o planejador
     * usa: uma segunda regra de extração aqui produziria dois entendimentos do
     * mesmo pedido, que é a doença que o CLAUDE.md nomeia.
     */
    if (CRIAR_PASTA.test(t) && extrairNomePasta(bruto) === null) {
      achadas.push({
        tipo: 'objeto_sem_nome',
        faltando: 'que nome dar à pasta',
        candidatos: [],
      });
    }

    return achadas;
  }

  /** O nome logo depois da marca de destinatário, se for plausível. */
  private extrairAlvo(t: string): string | null {
    const m = t.match(MARCA_DESTINATARIO);
    const alvo = m?.[2];
    if (!alvo || NAO_E_NOME.test(alvo)) return null;
    return alvo;
  }
}

/**
 * Monta a pergunta. Objetiva e fechada quando há candidatos — nunca
 * "pode esclarecer?", que devolve ao operador o trabalho de adivinhar o que a
 * IARA não entendeu.
 */
export function perguntaDe(a: Ambiguidade): string {
  /* A revogação não é uma lacuna de dado — é um pedido desfeito. Perguntar
     "preciso saber se você ainda quer, não tenho essa informação no que
     conversamos" leria como desatenção: a informação ESTÁ na mensagem. */
  /* Pergunta própria: a genérica diria "não tenho essa informação no que
     conversamos", que é verdade e soa como desculpa. O que a pessoa precisa
     ouvir é o que falta e por que a IARA não seguiu sozinha. */
  if (a.tipo === 'objeto_sem_nome') {
    return 'Que nome dar à pasta? Prefiro perguntar a inventar um nome por você.';
  }
  if (a.tipo === 'ordem_revogada') {
    return 'Você pediu e cancelou na mesma mensagem, então não fiz nada. Quer que eu faça?';
  }
  if (a.candidatos.length > 1) {
    const lista = a.candidatos.slice(0, 6);
    const ultimo = lista[lista.length - 1];
    const anteriores = lista.slice(0, -1).join(', ');
    return `Preciso saber ${a.faltando}: ${anteriores} ou ${ultimo}?`;
  }
  if (a.candidatos.length === 1) {
    return `Confirma que é ${a.candidatos[0]}?`;
  }
  return `Preciso saber ${a.faltando} — não tenho essa informação no que conversamos.`;
}
