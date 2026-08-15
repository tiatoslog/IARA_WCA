/**
 * Descoberta de capacidades — "esta frase parece pedir algo que o catálogo faz?"
 *
 * O TERCEIRO SINAL do portão de rota, ao lado de `tipo === 'comando'` e da
 * pergunta-de-fato. Os dois primeiros olham a FORMA da frase; este olha o
 * ASSUNTO — e o assunto vem do próprio catálogo, nunca de uma lista escrita à
 * mão. "Motoristas disponíveis agora?" não tem interrogativo de fato nem verbo
 * no imperativo, mas fala de motoristas — e "motorista" está na descrição das
 * habilidades da operação LUFT. É o suficiente para valer uma chamada de
 * planejamento em vez de cair em conversa.
 *
 * POR QUE LÉXICO, NÃO EMBEDDING: o índice nasce dos manifestos em memória, em
 * microssegundos, sem chamada externa, sem estado, sem custo por mensagem. O
 * falso positivo é barato (uma chamada de planejamento a mais, que volta com
 * um passo de raciocínio puro — resposta certa, só mais lenta). O falso
 * negativo é o bug que esta auditoria pagou para ver: pedido real morrendo em
 * conversa. A régua fica onde o erro barato absorve o erro caro.
 *
 * OPEN/CLOSED DE VERDADE: habilidade nova entra aqui no mesmo commit em que
 * entra no catálogo, pelo próprio texto do manifesto — igual a
 * `descricaoParaPrompt`. Se um dia este arquivo ganhar uma lista de palavras
 * por habilidade, a arquitetura regrediu.
 *
 * O QUE ESTE MÓDULO NÃO É: roteador. Ele não escolhe habilidade nenhuma — só
 * decide se vale OFERECER o catálogo à LLM (`plano_cognitivo`), que é quem
 * escolhe de verdade, com as quatro portas do Gerenciador na frente.
 */

import type { ManifestoHabilidade } from './Habilidade';
import { normalizar } from '../texto';

/**
 * Palavras funcionais que aparecem em qualquer manifesto e em qualquer frase.
 * Curta de propósito: o filtro que trabalha é o de frequência entre
 * documentos, logo abaixo — este só tira o que a estatística não pegaria com
 * um catálogo pequeno.
 */
const FUNCIONAIS = new Set([
  'para', 'como', 'quando', 'onde', 'porque', 'exemplo', 'sobre', 'entre',
  'depois', 'antes', 'nunca', 'sempre', 'apenas', 'ainda', 'muito', 'pouco',
  'mais', 'menos', 'cada', 'todo', 'toda', 'todos', 'todas', 'este', 'esta',
  'esse', 'essa', 'aquele', 'aquela', 'pelo', 'pela', 'pode', 'devolve',
  'responde', 'preencha', 'escolha', 'hoje', 'amanha', 'agora', 'aqui',
]);

/** Radical grosseiro: só o plural simples. "motoristas" e "motorista" são a
 *  mesma chave; flexão verbal fica de fora de propósito — o índice é de
 *  SUBSTANTIVOS de domínio, e verbo conjugado raramente é o que liga uma
 *  frase a uma habilidade. */
const radical = (t: string): string => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t);

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !FUNCIONAIS.has(t))
    .map(radical);
}

export class DescobertaCapacidades {
  /** token → em quantas habilidades ele aparece (frequência de documento). */
  private readonly frequencia = new Map<string, number>();
  /** token → ids das habilidades cujo manifesto o contém. */
  private readonly porToken = new Map<string, Set<string>>();

  constructor(manifestos: readonly ManifestoHabilidade[]) {
    for (const m of manifestos) {
      const doManifesto = new Set(tokens(`${m.id.replace(/_/g, ' ')} ${m.nome} ${m.descricao}`));
      for (const t of doManifesto) {
        this.frequencia.set(t, (this.frequencia.get(t) ?? 0) + 1);
        let ids = this.porToken.get(t);
        if (!ids) this.porToken.set(t, (ids = new Set()));
        ids.add(m.id);
      }
    }
    /**
     * Token presente em um terço ou mais do catálogo não distingue nada —
     * "consulta", "operador", "computador" estão em toda parte. Vira ruído e
     * sai do índice. É o mesmo papel de uma lista de stopwords, só que
     * calculado do dado real: cresce o catálogo, a régua acompanha.
     */
    const teto = Math.max(2, Math.ceil(manifestos.length / 3));
    for (const [t, f] of this.frequencia) {
      if (f >= teto) {
        this.frequencia.delete(t);
        this.porToken.delete(t);
      }
    }
  }

  /**
   * A frase compartilha assunto com alguma habilidade?
   *
   * Dois jeitos de dizer sim, e os dois pedem ESPECIFICIDADE:
   *   · dois tokens distintos da mesma habilidade — coincidência dupla não é
   *     acaso ("cargas" + "coletadas", "faturamento" + "rota");
   *   · um token quase-exclusivo (aparece em ≤2 habilidades) — "motorista",
   *     "email", "whatsapp" bastam sozinhos, porque não são de ninguém mais.
   */
  pareceOperacional(bruto: string): boolean {
    const daFrase = new Set(tokens(bruto));
    const acertosPorHabilidade = new Map<string, number>();
    for (const t of daFrase) {
      const ids = this.porToken.get(t);
      if (!ids) continue;
      if (ids.size <= 2) return true;
      for (const id of ids) {
        const acertos = (acertosPorHabilidade.get(id) ?? 0) + 1;
        if (acertos >= 2) return true;
        acertosPorHabilidade.set(id, acertos);
      }
    }
    return false;
  }
}
