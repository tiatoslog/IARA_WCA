/**
 * ÍNDICE CONCEITUAL — palavras diferentes, mesmo conceito.
 *
 * ===========================================================================
 * A LACUNA QUE ISTO FECHA, medida e não suposta
 * ===========================================================================
 *
 * O arnês de invariância mediu, em 21/08/2026, quatro sintomas que pareciam
 * casos separados:
 *
 *     « estou livre amanhã? »   → morria em conversa; nada liga "livre" a agenda
 *     « coletas de agosto »     → referente "coleta" ≠ referente "carga"
 *     « caixa de entrada »      → não alcançava `ler_emails`
 *     « documentos »            → não alcançava `listar_arquivos`
 *
 * São UM defeito. O ato estava certo, a operação estava certa, o período estava
 * certo — e o vocabulário do operador não era o vocabulário do manifesto. A
 * camada anterior fechou a distância entre FORMA e INTENÇÃO; esta fecha a
 * distância entre PALAVRA e CONCEITO.
 *
 * ===========================================================================
 * SIMILARIDADE NÃO É COMPATIBILIDADE — a regra que governa este arquivo
 * ===========================================================================
 *
 * « criar arquivo » e « listar arquivo » são semanticamente PRÓXIMOS. Qualquer
 * medida de similaridade — este índice, um embedding, o que for — vai dizer
 * isso, e vai estar certa. E são operações OPOSTAS: uma escreve no disco do
 * operador, a outra lê.
 *
 * Por isso este módulo RECUPERA e não DECIDE. Ele devolve conceitos e as
 * capacidades relacionadas a eles, com escore; a admissão de um candidato exige,
 * além disso, compatibilidade estrutural de operação — que mora na
 * `CompreensaoSemantica` e é aplicada depois. A decisão final é
 *
 *     similaridade semântica × compatibilidade estrutural × contexto
 *
 * e nunca `similaridade > X → executar`. `admissivel()` existe neste arquivo
 * exatamente para tornar essa conjunção explícita em vez de convenção.
 *
 * ===========================================================================
 * DE ONDE VÊM OS CONCEITOS
 * ===========================================================================
 *
 * Dos MANIFESTOS, pelo campo `conceitos` — nunca de uma tabela aqui dentro. É a
 * mesma disciplina de `risco`, `idempotencia` e `entidades`: o dado é declarado
 * por quem conhece a habilidade, e a política o lê. Habilidade nova nasce
 * recuperável sem que ninguém edite este arquivo.
 *
 * Se um dia aparecer aqui dentro uma constante com `livre`, `coleta` ou
 * `caixa`, a arquitetura regrediu para o ciclo que ela veio matar — e
 * `testes/compreensao/aberto-fechado.test.ts` fica vermelho apontando a palavra.
 *
 * ===========================================================================
 * ONDE UM EMBEDDING ENTRARIA
 * ===========================================================================
 *
 * `ConceitoRecuperado` é a moeda desta camada, e ela não diz de onde veio: um
 * termo declarado no manifesto e um vizinho vetorial produzem a MESMA estrutura,
 * com `origem` diferente. Um recuperador externo pluga em `mesclar()` sem que
 * nada abaixo mude — e sem ganhar poder nenhum, porque a admissão continua
 * exigindo a compatibilidade estrutural que ele não controla.
 *
 * Este módulo é PURO: sem rede, sem relógio, sem disco.
 */

import { normalizar } from '../texto';
import type { ManifestoHabilidade } from './Habilidade';

/** De onde a ligação palavra→conceito veio. Vai para a auditoria. */
export type OrigemDoConceito =
  /** O operador escreveu o próprio nome do conceito. */
  | 'literal'
  /** O operador escreveu um termo que o manifesto declara para o conceito. */
  | 'termo_declarado'
  /** Um recuperador externo (embedding) propôs. Nunca admite sozinho. */
  | 'recuperacao_semantica';

export interface ConceitoRecuperado {
  /** O conceito canônico: `disponibilidade`, `carga`, `email`. */
  readonly conceito: string;
  /** O que o operador de fato escreveu: `livre`, `coletas`, `caixa`. */
  readonly literal: string;
  readonly origem: OrigemDoConceito;
  /** 0 a 1. Confiança da LIGAÇÃO, não autorização para nada. */
  readonly score: number;
  /** Habilidades que declararam atender este conceito. */
  readonly capacidades: readonly string[];
}

/**
 * Termo declarado vale menos que a palavra exata do conceito, e os dois valem
 * mais que um vizinho vetorial. Réguas declaradas: mexer nelas muda o que o
 * sistema considera ligação forte, e isso não pode ficar escondido numa soma.
 */
const PESO: Record<OrigemDoConceito, number> = {
  literal: 1,
  termo_declarado: 0.9,
  recuperacao_semantica: 0.7,
};

/** Mesmo radical grosseiro da `DescobertaCapacidades` — plural simples. */
const radical = (t: string): string => (t.length > 4 && t.endsWith('s') ? t.slice(0, -1) : t);

const palavras = (texto: string): string[] =>
  normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(radical);

export class IndiceConceitual {
  /** termo (radicalizado) → conceitos canônicos que o declaram. */
  private readonly porTermo = new Map<string, Set<string>>();
  /** conceito → habilidades que o atendem. */
  private readonly capacidadesDoConceito = new Map<string, Set<string>>();
  /** conceito → o nome canônico já radicalizado, para casamento literal. */
  private readonly nomeDoConceito = new Map<string, string>();

  constructor(manifestos: readonly ManifestoHabilidade[]) {
    for (const m of manifestos) {
      for (const c of m.conceitos ?? []) {
        const nome = normalizar(c.nome);

        let capacidades = this.capacidadesDoConceito.get(nome);
        if (!capacidades) this.capacidadesDoConceito.set(nome, (capacidades = new Set()));
        capacidades.add(m.id);

        /**
         * O NOME DO CONCEITO TAMBÉM É UM TERMO DELE. Quem escreve "agenda"
         * está dizendo o conceito, e seria absurdo exigir que "agenda" fosse
         * repetido dentro dos próprios termos para ser reconhecido.
         */
        for (const p of palavras(c.nome)) {
          this.nomeDoConceito.set(p, nome);
          this.registrar(p, nome);
        }
        for (const termo of c.termos) {
          for (const p of palavras(termo)) this.registrar(p, nome);
        }
      }
    }
  }

  private registrar(termo: string, conceito: string): void {
    let cs = this.porTermo.get(termo);
    if (!cs) this.porTermo.set(termo, (cs = new Set()));
    cs.add(conceito);
  }

  /** Existe algum conceito declarado? Falso num catálogo que ainda não migrou. */
  get vazio(): boolean {
    return this.porTermo.size === 0;
  }

  /** Os conceitos que o catálogo declara. Diagnóstico e teste de contrato. */
  get conceitos(): readonly string[] {
    return [...this.capacidadesDoConceito.keys()].sort();
  }

  /**
   * QUE CONCEITOS ESTA FRASE INVOCA — em ordem de peso.
   *
   * NÃO decide habilidade. Devolve conceito, a palavra que o invocou, de onde a
   * ligação veio e quais capacidades o declaram. Quem escolhe é quem tiver, além
   * disto, a operação e o contexto.
   *
   * A palavra mais específica ganha: um termo que pertence a UM conceito diz
   * mais que um que pertence a quatro. Mesma régua de especificidade do índice
   * de assunto, pelo mesmo motivo.
   */
  recuperar(bruto: string): readonly ConceitoRecuperado[] {
    const achados = new Map<string, ConceitoRecuperado>();

    for (const p of new Set(palavras(bruto))) {
      const conceitos = this.porTermo.get(p);
      if (!conceitos) continue;

      for (const conceito of conceitos) {
        const origem: OrigemDoConceito = this.nomeDoConceito.get(p) === conceito ? 'literal' : 'termo_declarado';
        const score = PESO[origem] / conceitos.size;
        const anterior = achados.get(conceito);
        if (anterior && anterior.score >= score) continue;
        achados.set(conceito, {
          conceito,
          literal: p,
          origem,
          score,
          capacidades: [...(this.capacidadesDoConceito.get(conceito) ?? [])].sort(),
        });
      }
    }

    return [...achados.values()].sort(
      (a, b) => b.score - a.score || a.conceito.localeCompare(b.conceito),
    );
  }

  /**
   * Junta o que o índice declarado achou com o que um recuperador externo
   * propôs — o ponto de entrada de um embedding, quando houver um.
   *
   * O EXTERNO NUNCA SOBREPÕE O DECLARADO. Um vizinho vetorial com escore alto
   * não pode empurrar para baixo um termo que o manifesto declara: o manifesto é
   * a fonte de verdade, o modelo é uma sugestão. E conceito que o catálogo não
   * conhece entra sem capacidade nenhuma — recuperar um conceito que ninguém
   * atende não é erro, é informação, e o contrato pode dizer "entendi o assunto
   * e não tenho ferramenta".
   */
  mesclar(
    declarados: readonly ConceitoRecuperado[],
    externos: readonly { readonly conceito: string; readonly literal: string; readonly score: number }[],
  ): readonly ConceitoRecuperado[] {
    const porConceito = new Map(declarados.map((d) => [d.conceito, d]));
    for (const e of externos) {
      const conceito = normalizar(e.conceito);
      if (porConceito.has(conceito)) continue;
      porConceito.set(conceito, {
        conceito,
        literal: e.literal,
        origem: 'recuperacao_semantica',
        score: PESO.recuperacao_semantica * Math.max(0, Math.min(1, e.score)),
        capacidades: [...(this.capacidadesDoConceito.get(conceito) ?? [])].sort(),
      });
    }
    return [...porConceito.values()].sort(
      (a, b) => b.score - a.score || a.conceito.localeCompare(b.conceito),
    );
  }
}

/**
 * O RECUPERADOR EXTERNO — a costura para um embedding, e a coleira dele.
 *
 * Ele devolve CONCEITOS, nunca habilidades. É a diferença entre "esta frase
 * fala de disponibilidade" e "execute `ver_agenda_calendario`": a primeira é uma
 * observação sobre linguagem, a segunda é uma decisão sobre o mundo, e um modelo
 * de similaridade só tem competência para a primeira.
 *
 * Assíncrono porque um embedding real será; o núcleo da compreensão continua
 * síncrono e puro, e recebe o resultado já pronto por `conceitosRecuperados`.
 * Sem isso, a interpretação inteira passaria a depender de rede — trocando a
 * variância que estas fases mataram por outra.
 */
export interface RecuperadorDeConceitos {
  recuperar(
    frase: string,
    k: number,
  ): Promise<readonly { readonly conceito: string; readonly literal: string; readonly score: number }[]>;
}
