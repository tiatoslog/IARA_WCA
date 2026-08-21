/**
 * Base de procedimentos — o corpus do SOS, e a busca sobre ele.
 *
 * Lê o que `npm run pops` gerou em `dados/procedimentos/`. Só LÊ: nada aqui
 * escreve, e nenhum caminho de código altera POP (proibição nº 3 de
 * `docs/prd/hierarquia-da-verdade-sos.md`).
 *
 * A BUSCA É LEXICAL, e usa o `Lexico.ts` compartilhado com o RAG de incidentes e
 * o de memória corporativa. O limiar mora aqui porque é calibração DESTE corpus,
 * medida contra ele — não propriedade da técnica.
 *
 * O QUE ESTE MÓDULO RECUSA A FAZER, e é o ponto dele: escolher entre sistemas.
 * Busca lexical não sabe de sistema — "encerrar" casa com o encerramento do GW e
 * casaria com o de qualquer outro sistema pelo mesmo trigrama. Quando os
 * candidatos de topo pertencem a sistemas diferentes, este módulo devolve a
 * ambiguidade em vez de eleger o mais parecido. Enquanto todos os POPs forem GW
 * isso nunca dispara — e é justamente por isso que precisa entrar agora, com
 * teste, e não no dia do segundo sistema, em produção.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Etapa, Procedimento, SlideDoPop } from '../../lib/procedimento';
import { podeOrientar } from '../../lib/procedimento';
import { cosseno, trigramas } from './Lexico';

const RAIZ = path.resolve(process.cwd(), 'dados', 'procedimentos');

/**
 * O PISO DE SIMILARIDADE — MEDIDO, não escolhido.
 *
 * Vem de `scripts/diagnostico/calibrar-pops.ts`, rodado em 19/08/2026 contra os
 * 11 POPs, com 13 perguntas de gabarito e 6 de ruído:
 *
 *   pior similaridade de acerto : 0.266  ("como faço o follow-up dos documentos")
 *   maior similaridade de ruído : 0.183  ("me lembra de ligar para o contador")
 *   faixa segura                : ]0.183, 0.266[
 *
 * `0.225` fica no meio da faixa. Não é número universal, é o que ESTE corpus
 * sustenta — e precisa ser REMEDIDO quando o corpus crescer: um limiar apurado
 * em 11 documentos não vale para 60.
 *
 * A medição também é o que reprovou o desenho anterior. Com índice único por
 * slide, o ruído chegava a `0.324` e a faixa segura era de três centésimos —
 * folga nenhuma —, e "como emitir o CTE ou a minuta" achava o POP errado.
 */
export const LIMIAR_DE_SIMILARIDADE = 0.225;

export interface Achado {
  readonly procedimento: Procedimento;
  readonly etapa: Etapa;
  readonly slide: SlideDoPop;
  readonly similaridade: number;
}

export interface Resultado {
  readonly achados: readonly Achado[];
  /**
   * Sistemas presentes entre os candidatos de topo. Mais de um significa que a
   * pergunta não distingue sistema — e a resposta certa é perguntar, não eleger.
   */
  readonly sistemas: readonly string[];
}

/**
 * O corpus é indexado em DOIS níveis, e a separação não é otimização — é a
 * correção de um erro medido.
 *
 * A primeira versão indexava só por slide, e a calibração reprovou: *"como
 * emitir o CTE ou a minuta"* achava o POP 006 (TRANSMITIR CTE) em vez do 004,
 * cujo título é literalmente "EMITIR CTE OU MINUTA". O título — o campo de maior
 * sinal — ficava diluído no meio do texto das telas, e um slide qualquer do 006
 * com muitas ocorrências de "CTE" ganhava do documento certo.
 *
 * São duas perguntas diferentes e merecem dois índices: **qual procedimento** se
 * decide por título e código; **qual etapa** se decide dentro do procedimento já
 * escolhido.
 */
interface Documento {
  procedimento: Procedimento;
  /** Título, código e títulos de etapa. Curto e denso — a pergunta do operador. */
  indice: Map<string, number>;
  trechos: Trecho[];
}

interface Trecho {
  etapa: Etapa;
  slide: SlideDoPop;
  indice: Map<string, number>;
}

interface EntradaIndice {
  vigente: string;
  versoes: { hash: string; ingerido_em: string; estado: string; arquivo_origem: string }[];
}

export class BaseProcedimentos {
  private documentos: Documento[] = [];
  private porCodigoMapa = new Map<string, Procedimento>();
  private carregada = false;

  carregar(): void {
    if (this.carregada) return;
    this.recarregar();
  }

  recarregar(): void {
    this.documentos = [];
    this.porCodigoMapa = new Map();
    this.carregada = true;

    const caminhoIndice = path.join(RAIZ, 'indice.json');
    if (!existsSync(caminhoIndice)) return;

    const indice = JSON.parse(readFileSync(caminhoIndice, 'utf8')) as Record<
      string,
      EntradaIndice
    >;

    for (const [codigo, entrada] of Object.entries(indice)) {
      const arquivo = path.join(RAIZ, codigo, `${entrada.vigente}.json`);
      if (!existsSync(arquivo)) continue;
      const p = JSON.parse(readFileSync(arquivo, 'utf8')) as Procedimento;

      /**
       * Só a versão VIGENTE e só se ela pode orientar. Versão `em_revisao`
       * existe no disco e não entra na busca: quem responde "como faço isso?" é
       * procedimento oficial, e uma revisão que ninguém validou responderia com
       * autoridade que não tem.
       */
      if (!podeOrientar(p.estado)) continue;

      this.porCodigoMapa.set(p.codigo, p);

      const trechos: Trecho[] = [];
      for (const etapa of p.etapas) {
        for (const slide of etapa.slides) {
          trechos.push({
            etapa,
            slide,
            indice: trigramas(
              [etapa.titulo, slide.texto, slide.passos.map((q) => q.rotulo).join(' ')].join(' '),
            ),
          });
        }
      }

      this.documentos.push({
        procedimento: p,
        // Só o que IDENTIFICA o procedimento. Juntar o texto das telas aqui é o
        // que fazia o documento certo perder para um slide denso do errado.
        indice: trigramas(
          [p.titulo, p.codigo, ...p.etapas.map((e) => e.titulo)].join(' '),
        ),
        trechos,
      });
    }
  }

  /** Os procedimentos que podem orientar, para listar ao operador. */
  catalogo(): readonly Procedimento[] {
    this.carregar();
    return [...this.porCodigoMapa.values()].sort((a, b) => a.codigo.localeCompare(b.codigo));
  }

  porCodigo(codigo: string): Procedimento | null {
    this.carregar();
    return this.porCodigoMapa.get(codigo.toUpperCase()) ?? null;
  }

  /**
   * Busca por pergunta em linguagem natural.
   *
   * `sistema` é FILTRO DURO aplicado ANTES da similaridade — nunca desempate
   * depois. Quando não é informado, a busca corre em tudo e a ambiguidade entre
   * sistemas volta em `Resultado.sistemas`, para quem chamou decidir perguntar.
   */
  consultar(
    pergunta: string,
    opcoes: {
      sistema?: string;
      codigo?: string;
      limite?: number;
      /** Só a calibração usa. Medir o piso com o piso aplicado devolve zero. */
      ignorarLimiar?: boolean;
    } = {},
  ): Resultado {
    this.carregar();
    const limite = opcoes.limite ?? 3;

    let universo = this.documentos;
    if (opcoes.sistema) {
      const alvo = opcoes.sistema.toUpperCase();
      universo = universo.filter((d) => d.procedimento.sistema.toUpperCase() === alvo);
    }
    if (opcoes.codigo) {
      const alvo = opcoes.codigo.toUpperCase();
      universo = universo.filter((d) => d.procedimento.codigo.toUpperCase() === alvo);
    }
    if (universo.length === 0) return { achados: [], sistemas: [] };

    const alvo = trigramas(pergunta);

    /**
     * ESTÁGIO 1 — qual procedimento. Decidido por título e código.
     *
     * O LIMIAR NÃO SE APLICA quando o operador NOMEOU o POP. O limiar existe
     * para separar "achei" de "achei parecido"; com o código na mão não há o que
     * separar — a escolha já foi determinística. Sem esta exceção, pedir
     * `IT-ADMLUFT-003` junto de uma frase curta ("como faço") devolvia nada, e a
     * IARA respondia que não conhecia um procedimento que ela tem em mãos.
     */
    const candidatos = universo
      .map((d) => ({ d, s: cosseno(alvo, d.indice) }))
      .filter(
        (x) =>
          Boolean(opcoes.codigo) || opcoes.ignorarLimiar || x.s > LIMIAR_DE_SIMILARIDADE,
      )
      .sort((a, b) => b.s - a.s);

    if (candidatos.length === 0) return { achados: [], sistemas: [] };

    // ESTÁGIO 2 — qual etapa, DENTRO do procedimento escolhido. Quando nenhum
    // slide se destaca, o primeiro é a resposta certa: quem pergunta "como faço
    // X" sem dizer onde parou quer começar do começo.
    const vencedor = candidatos[0].d;
    const porSlide = vencedor.trechos
      .map((t) => ({ t, s: cosseno(alvo, t.indice) }))
      .sort((a, b) => b.s - a.s);
    const melhores = porSlide.slice(0, limite).filter((x, i) => i === 0 || x.s > 0);

    return {
      achados: melhores.map((x) => ({
        procedimento: vencedor.procedimento,
        etapa: x.t.etapa,
        slide: x.t.slide,
        similaridade: Number(candidatos[0].s.toFixed(3)),
      })),
      // A ambiguidade de SISTEMA é medida entre os candidatos de topo do
      // estágio 1 — é lá que a confusão entre sistemas apareceria.
      sistemas: [...new Set(candidatos.slice(0, limite).map((x) => x.d.procedimento.sistema))],
    };
  }
}

/**
 * A instância do processo. Singleton pela mesma razão do `ragHistorico`: o
 * corpus é o mesmo para todos os operadores, e reler 11 arquivos por turno seria
 * desperdício sem nenhum ganho de isolamento — não há nada privado aqui.
 */
export const baseProcedimentos = new BaseProcedimentos();
