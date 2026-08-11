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

export type TipoAmbiguidade =
  /** "aquele relatório", "esse arquivo" — referência sem antecedente achável. */
  | 'referencia_sem_antecedente'
  /** "manda pro João" com mais de um João possível. */
  | 'destinatario_multiplo'
  /** "manda isso" — ação que alcança alguém, sem alvo nenhum. */
  | 'destinatario_ausente';

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
