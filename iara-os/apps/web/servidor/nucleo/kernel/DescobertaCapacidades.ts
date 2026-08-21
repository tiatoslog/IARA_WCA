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
 *
 * ---------------------------------------------------------------------------
 * O QUE MUDOU EM 21/08/2026 — A EVIDÊNCIA DEIXOU DE SER JOGADA FORA
 * ---------------------------------------------------------------------------
 *
 * Até aqui o módulo inteiro tinha UM método público, `pareceOperacional():
 * boolean`. Por trás dele já existia tudo que uma descoberta precisa —
 * frequência de documento, teto de stopword calculado do catálogo real, índice
 * separado de exemplos, acumulação por habilidade — e o `return true`
 * descartava a única coisa que o resto do sistema precisaria saber depois: QUAL
 * habilidade casou, POR QUE, e SE havia uma segunda quase tão boa quanto.
 *
 * O sintoma era visível no próprio código, no ramo da coincidência dupla:
 *
 *     const acertos = (acertosPorHabilidade.get(id) ?? 0) + 1;
 *     if (acertos >= 2) return true;          // <- sai antes de gravar
 *     acertosPorHabilidade.set(id, acertos);  // <- só grava quem perdeu
 *
 * O mapa que existia para acumular evidência nunca chegava a registrar o
 * vencedor. Num booleano isso não aparece; numa arquitetura que precisa
 * comparar candidatos, é o defeito inteiro.
 *
 * `descobrirCandidatos()` devolve o que a busca de fato encontrou. O booleano
 * continua existindo — é `candidatos.length > 0`, pelas MESMAS três regras — e
 * por isso nenhuma rota muda com esta alteração. Primeiro tornar observável o
 * que a descoberta encontra; depois, e só com medida na mão, mexer em quem
 * decide.
 *
 * POR QUE A EVIDÊNCIA SAI DECOMPOSTA (`Correspondencia`): a mesma disciplina de
 * `Suficiencia.ts` — num escore único, o sinal ruim vira uma parcela pequena de
 * uma média boa e some. Duas habilidades podem chegar a 0,8 por caminhos
 * incomparáveis: uma por duas palavras de prosa da descrição, outra porque
 * alguém já pediu exatamente aquilo e a frase está nos exemplos. Quem for
 * decidir depois precisa enxergar a diferença.
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

/**
 * SIGLA: uma corrida de maiúsculas que não encosta em letra dos dois lados,
 * com um `s` minúsculo opcional de plural — `UF`, `SQL`, `PDF`, `MT`, `OCIs`.
 *
 * POR QUE ISTO EXISTE (auditoria de 21/08/2026). O corte era `t.length >= 4`, e
 * ele apagava exatamente os sinais mais operacionais que existem:
 *
 *     "só de MT"        -> nenhum token útil
 *     "olha o CT-e"     -> apenas "olha"
 *     "quantas OCI?"    -> nenhum token útil
 *
 * A tentação óbvia é uma lista — `['MG','CT-e','OCI',...]` — e ela é o mesmo
 * anti-padrão que o cabeçalho deste arquivo proíbe em maiúsculas: sigla nova
 * exigiria editar este arquivo, e o catálogo deixaria de ser a fonte.
 *
 * A REGRA É TIPOGRÁFICA, e por isso nasce do dado. O manifesto escreve `UF`,
 * `CT-e` e `OCIs` em caixa alta porque são siglas; nunca escreve `dia` assim.
 * O que a caixa alta produz é uma CANDIDATURA — quem decide de verdade é a
 * mesma frequência de documento que governa o resto do índice: medido no
 * catálogo de 47 habilidades, `de` (DF 44) e `da` (DF 33) entram por
 * "A EXPRESSÃO DE TEMPO" estar em caixa alta e saem podados pelo teto, enquanto
 * `mt`, `tms`, `sql`, `pdf`, `ocr`, `pc`, `png` (DF 1), `uf` e `ct` (DF 2)
 * sobrevivem.
 *
 * O LIMITE, declarado: `MG` não está em manifesto nenhum, logo não existe no
 * índice. Isso é honesto — o catálogo não declara conhecer Minas Gerais — e é
 * o contrário de fingir cobertura com uma lista escrita à mão.
 */
const SIGLA = /(?<!\p{L})([A-Z]{2,})s?(?!\p{L})/gu;

export type MotivoDeAdmissao =
  /** Token que aparece em ≤2 habilidades: "motorista", "whatsapp", "lembrete". */
  | 'token_quase_exclusivo'
  /** Token dos EXEMPLOS de ≤2 habilidades — alguém já pediu isso com essa palavra. */
  | 'token_de_exemplo'
  /** Dois tokens distintos da mesma habilidade. Coincidência dupla não é acaso. */
  | 'coincidencia_dupla';

/**
 * A evidência por FONTE, nunca colapsada num número.
 *
 * `lexical` e `exemplo` medem coisas diferentes sobre a mesma frase: a
 * descrição DESCREVE o que a habilidade faz, o exemplo É uma frase de operador
 * que já pediu isso. Uma habilidade com `exemplo: 0` e `lexical: 1,5` chegou
 * por prosa; a régua de quem decide depois pode querer tratá-las diferente, e
 * não vai poder se as duas virarem "0,75".
 */
export interface Correspondencia {
  /** Soma de 1/|habilidades que contêm o token| sobre o índice do manifesto. */
  readonly lexical: number;
  /** O mesmo sobre o índice de exemplos, que é evidência mais forte. */
  readonly exemplo: number;
  /**
   * LACUNA DECLARADA, e é por isso que o campo existe zerado em vez de não
   * existir. Nada do histórico, da memória ou do turno anterior entra na
   * descoberta hoje — medido, não suposto: o construtor recebe manifestos e
   * mais nada. "e por central?" depende inteiramente do turno anterior e por
   * isso não produz candidato nenhum aqui.
   *
   * O campo fica visível zerado para que a ausência apareça em qualquer
   * relatório que decomponha a evidência, em vez de sumir dentro de um escore
   * que ninguém sabe do que é feito.
   */
  readonly contexto: number;
}

export interface Candidato {
  /** `id` do manifesto. É a identidade que o `return true` jogava fora. */
  readonly habilidade: string;
  /**
   * Peso agregado, para ORDENAR — não para decidir sozinho. Soma de evidência
   * (`lexical + 2×exemplo`), não média: média esconde parcela, soma preserva.
   */
  readonly score: number;
  /** Tokens da frase que deram evidência para esta habilidade. */
  readonly evidencias: readonly string[];
  readonly correspondencia: Correspondencia;
  /** Qual(is) das três regras admitiram este candidato. Responde "por quê?". */
  readonly motivos: readonly MotivoDeAdmissao[];
}

/** Exemplo pesa mais que prosa — ver `porTokenExemplo`. */
const PESO_EXEMPLO = 2;

/**
 * A DISTÂNCIA ENTRE O PRIMEIRO E O SEGUNDO, relativa ao primeiro.
 *
 * `1` = candidato único, ou vantagem total. Perto de `0` = duas leituras
 * plausíveis da mesma frase, e escolher a de cima é escolher por desempate
 * numérico, não por evidência.
 *
 * Existe como função e não como campo de propósito: a margem é uma propriedade
 * do CONJUNTO, não de um candidato. Guardá-la dentro de cada item convidaria a
 * carregar o primeiro colocado adiante e descartar o resto — que é exatamente o
 * descarte que este arquivo acabou de parar de fazer.
 */
export function margemRelativa(candidatos: readonly Candidato[]): number {
  if (candidatos.length === 0) return 0;
  if (candidatos.length === 1) return 1;
  const [a, b] = candidatos;
  if (a.score <= 0) return 0;
  return (a.score - b.score) / a.score;
}

export class DescobertaCapacidades {
  /** token → em quantas habilidades ele aparece (frequência de documento). */
  private readonly frequencia = new Map<string, number>();
  /** token → ids das habilidades cujo manifesto o contém. */
  private readonly porToken = new Map<string, Set<string>>();
  /**
   * token → ids das habilidades em cujos EXEMPLOS ele aparece.
   *
   * Índice separado porque exemplo é evidência de outra natureza: a descrição
   * DESCREVE o que a habilidade faz; o exemplo É uma frase de operador que já
   * pediu isso. Um token que aparece nos exemplos de poucas habilidades liga a
   * frase nova àquela família com força que a prosa da descrição não tem.
   */
  private readonly porTokenExemplo = new Map<string, Set<string>>();
  /** Siglas curtas que o catálogo declarou pela caixa alta. Ver `SIGLA`. */
  private readonly siglas = new Set<string>();
  /** Plural de sigla → singular: `ocis` → `oci`, para os dois lados casarem. */
  private readonly singularDeSigla = new Map<string, string>();

  constructor(manifestos: readonly ManifestoHabilidade[]) {
    /**
     * PASSO ZERO — quais tokens curtos o catálogo autoriza.
     *
     * Roda antes de qualquer indexação porque `tokens()` depende do resultado:
     * sem isto, `uf` seria descartado ao INDEXAR e o índice nunca teria a
     * palavra para o lado da frase encontrar.
     */
    for (const m of manifestos) {
      const cru = [m.nome, m.descricao, ...(m.capacidades ?? []), ...(m.exemplos ?? [])].join(' ');
      for (const achado of cru.matchAll(SIGLA)) {
        const inteiro = normalizar(achado[0]);
        const nucleo = normalizar(achado[1]);
        // `OCIs` declara as duas chaves e a ponte entre elas: quem escrever
        // "OCI" e quem escrever "OCIs" tem de cair no mesmo lugar.
        if (nucleo.length >= 2 && nucleo.length <= 3) this.siglas.add(nucleo);
        if (inteiro !== nucleo) this.singularDeSigla.set(inteiro, nucleo);
      }
    }

    for (const m of manifestos) {
      /**
       * As três fontes do manifesto rico entram no MESMO índice: id/nome/
       * descrição (como sempre), `capacidades` (verbos de domínio) e
       * `exemplos` (frases reais). Exemplos também alimentam o índice próprio,
       * acima — a frequência de documento conta todas as fontes juntas, para
       * que a régua de stopword enxergue o vocabulário inteiro.
       */
      const doManifesto = new Set(
        this.tokens(
          `${m.id.replace(/_/g, ' ')} ${m.nome} ${m.descricao} ${(m.capacidades ?? []).join(' ')}`,
        ),
      );
      const dosExemplos = new Set((m.exemplos ?? []).flatMap((e) => this.tokens(e)));
      for (const t of dosExemplos) doManifesto.add(t);

      for (const t of doManifesto) {
        this.frequencia.set(t, (this.frequencia.get(t) ?? 0) + 1);
        let ids = this.porToken.get(t);
        if (!ids) this.porToken.set(t, (ids = new Set()));
        ids.add(m.id);
      }
      for (const t of dosExemplos) {
        let ids = this.porTokenExemplo.get(t);
        if (!ids) this.porTokenExemplo.set(t, (ids = new Set()));
        ids.add(m.id);
      }
    }
    /**
     * Token presente em um terço ou mais do catálogo não distingue nada —
     * "consulta", "operador", "computador" estão em toda parte. Vira ruído e
     * sai do índice. É o mesmo papel de uma lista de stopwords, só que
     * calculado do dado real: cresce o catálogo, a régua acompanha.
     *
     * A régua vale também para o índice de exemplos: "sinal forte" é o token
     * de exemplo ESPECÍFICO, não qualquer palavra que os exemplos repitam em
     * todo o catálogo.
     *
     * E vale, sobretudo, para as siglas: é AQUI que `de` e `da` — que entraram
     * por "A EXPRESSÃO DE TEMPO" estar em caixa alta — morrem, sem que ninguém
     * precise escrevê-las numa lista.
     */
    const teto = Math.max(2, Math.ceil(manifestos.length / 3));
    for (const [t, f] of this.frequencia) {
      if (f >= teto) {
        this.frequencia.delete(t);
        this.porToken.delete(t);
        this.porTokenExemplo.delete(t);
      }
    }
  }

  private tokens(texto: string): string[] {
    return this.tokensComPosicao(texto).map((x) => x.token);
  }

  /**
   * O mesmo que `tokens`, guardando ONDE cada um estava na frase.
   *
   * A posição não interessa ao índice — casamento de assunto não tem ordem — mas
   * interessa a quem precisa saber qual substantivo o verbo rege: em português
   * o objeto direto vem depois do verbo, e « lista os ARQUIVOS da área de
   * trabalho » só se distingue de « lista os arquivos da ÁREA de trabalho »
   * pela ordem. Ver `CompreensaoSemantica`.
   */
  private tokensComPosicao(texto: string): readonly { token: string; posicao: number }[] {
    const saida: { token: string; posicao: number }[] = [];
    const palavras = normalizar(texto).split(/[^a-z0-9]+/);
    for (let i = 0; i < palavras.length; i += 1) {
      const t = this.singularDeSigla.get(palavras[i]) ?? palavras[i];
      if ((t.length >= 4 || this.siglas.has(t)) && !FUNCIONAIS.has(t)) {
        saida.push({ token: radical(t), posicao: i });
      }
    }
    return saida;
  }

  /**
   * O QUE A FRASE ENCONTROU NO CATÁLOGO — em ordem de peso, com a evidência
   * junto.
   *
   * As três regras de admissão são as mesmas de sempre, e continuam pedindo
   * ESPECIFICIDADE. O que mudou é que cada uma agora NOMEIA a habilidade que
   * ela admitiu em vez de responder `true`:
   *   · dois tokens distintos da mesma habilidade — coincidência dupla não é
   *     acaso ("cargas" + "coletadas", "faturamento" + "rota");
   *   · um token quase-exclusivo (aparece em ≤2 habilidades) — "motorista",
   *     "email", "whatsapp" bastam sozinhos, porque não são de ninguém mais;
   *   · um token que aparece nos EXEMPLOS de ≤2 habilidades — sinal forte por
   *     definição: alguém já pediu exatamente isso com essa palavra, e o
   *     manifesto gravou a frase.
   *
   * DEVOLVE TODOS, não o melhor. Duas habilidades com 0,82 e 0,79 são duas
   * hipóteses, e a frase que as produziu é ambígua — quem for decidir precisa
   * poder ver isso (`margemRelativa`). Cortar aqui pelo maior escore devolveria
   * o mesmo descarte que este método veio consertar, só que uma camada acima.
   */
  descobrirCandidatos(bruto: string): readonly Candidato[] {
    const daFrase = new Set(this.tokens(bruto));

    const lexical = new Map<string, number>();
    const exemplo = new Map<string, number>();
    const evidencias = new Map<string, Set<string>>();
    const motivos = new Map<string, Set<MotivoDeAdmissao>>();
    const tokensPorHabilidade = new Map<string, Set<string>>();

    const marcar = (id: string, motivo: MotivoDeAdmissao) => {
      let m = motivos.get(id);
      if (!m) motivos.set(id, (m = new Set()));
      m.add(motivo);
    };

    for (const t of daFrase) {
      const ids = this.porToken.get(t);
      if (!ids) continue;
      const deExemplo = this.porTokenExemplo.get(t);

      for (const id of ids) {
        // Especificidade do token: quanto menos habilidades o compartilham,
        // mais ele diz. É o mesmo princípio do IDF, calculado do índice que
        // já existia — não uma constante escolhida à mão.
        lexical.set(id, (lexical.get(id) ?? 0) + 1 / ids.size);

        let ev = evidencias.get(id);
        if (!ev) evidencias.set(id, (ev = new Set()));
        ev.add(t);

        let tks = tokensPorHabilidade.get(id);
        if (!tks) tokensPorHabilidade.set(id, (tks = new Set()));
        tks.add(t);

        if (ids.size <= 2) marcar(id, 'token_quase_exclusivo');
        // A CORREÇÃO DO DEFEITO: gravar ANTES de concluir. A versão anterior
        // saía com `return true` no segundo acerto e o mapa ficava com 1.
        if (tks.size >= 2) marcar(id, 'coincidencia_dupla');
      }

      if (deExemplo) {
        for (const id of deExemplo) {
          exemplo.set(id, (exemplo.get(id) ?? 0) + 1 / deExemplo.size);
          if (deExemplo.size <= 2) marcar(id, 'token_de_exemplo');
        }
      }
    }

    const candidatos: Candidato[] = [];
    for (const [id, porQue] of motivos) {
      const l = lexical.get(id) ?? 0;
      const e = exemplo.get(id) ?? 0;
      candidatos.push({
        habilidade: id,
        score: l + PESO_EXEMPLO * e,
        evidencias: [...(evidencias.get(id) ?? [])].sort(),
        correspondencia: { lexical: l, exemplo: e, contexto: 0 },
        motivos: [...porQue].sort(),
      });
    }

    // Ordem total e determinística: o desempate por id impede que duas frases
    // idênticas devolvam ordens diferentes por acidente de iteração de Map.
    return candidatos.sort((a, b) => b.score - a.score || a.habilidade.localeCompare(b.habilidade));
  }

  /**
   * OS SUBSTANTIVOS DE DOMÍNIO QUE A FRASE TROUXE, do mais específico ao mais
   * comum — com em quantas habilidades cada um vive.
   *
   * Existe para a `CompreensaoSemantica` responder "sobre O QUÊ é esta frase?"
   * sem construir um segundo índice do catálogo. Duas cópias do mesmo
   * vocabulário divergem no primeiro manifesto novo, e a segunda cópia é sempre
   * a que ninguém lembra de atualizar.
   *
   * NÃO decide nada: devolve vocabulário observado, sem escolher objeto nem
   * habilidade. Quem escolhe é a camada semântica, com o verbo na mão.
   */
  tokensDeDominio(
    bruto: string,
  ): readonly { readonly token: string; readonly habilidades: number; readonly posicao: number }[] {
    const vistos = new Map<string, { habilidades: number; posicao: number }>();
    for (const { token, posicao } of this.tokensComPosicao(bruto)) {
      const ids = this.porToken.get(token);
      // A PRIMEIRA ocorrência manda: a posição serve para achar o objeto que o
      // verbo rege, e a repetição de uma palavra não a move na frase.
      if (ids && !vistos.has(token)) vistos.set(token, { habilidades: ids.size, posicao });
    }
    return [...vistos]
      .map(([token, x]) => ({ token, ...x }))
      .sort((a, b) => a.posicao - b.posicao);
  }

  /**
   * A frase compartilha assunto com alguma habilidade?
   *
   * O contrato antigo, preservado: as três regras de admissão são as mesmas,
   * logo "existe candidato" e "parecia operacional" são a MESMA proposição.
   * Nenhuma rota muda por causa desta refatoração — é o que permite medir a
   * descoberta antes de mexer em quem decide.
   */
  pareceOperacional(bruto: string): boolean {
    return this.descobrirCandidatos(bruto).length > 0;
  }
}
