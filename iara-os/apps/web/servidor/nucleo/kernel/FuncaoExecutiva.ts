/**
 * Função Executiva — o córtex pré-frontal do kernel.
 *
 * REGRA ABSOLUTA: ela NUNCA responde. Ela decide.
 *
 * Se você encontrar uma string voltada ao operador nascendo neste arquivo,
 * é bug de arquitetura, não detalhe de implementação.
 *
 * Ela responde a uma pergunta só: **qual rota de planejamento este pedido
 * merece?** E responde considerando três coisas — o que a percepção
 * reconheceu, o que a memória de trabalho já está fazendo, e quanto isso vai
 * custar.
 */

import type { Percepcao } from './Evento';
import type { Planejador } from './Planejador';
import type { MemoriaTrabalho } from './MemoriaTrabalho';
import { PortaoSigilo } from './Sigilo';
import {
  DetectorAmbiguidade,
  perguntaDe,
  CONTEXTO_VAZIO,
  type Ambiguidade,
  type ContextoDecisao,
} from './Ambiguidade';

export type RotaExecutiva =
  | 'sigilo' // barrar antes de tudo
  | 'esclarecer' // falta informação essencial: perguntar, não adivinhar
  | 'plano_local' // receita determinística, custo zero
  | 'plano_cognitivo' // pedir decomposição à LLM
  | 'raciocinio_direto'; // um passo de raciocínio, sem plano

/**
 * O que a IARA vai FAZER, no vocabulário do domínio.
 *
 * Existe ao lado de `rota` de propósito: `rota` é o mecanismo interno (que
 * planejador roda), `acao` é a decisão em si. Sem esta separação, medir
 * "quantas vezes a IARA perguntou em vez de adivinhar" exigiria inferir
 * intenção a partir de nome de rota — e métrica que depende de inferência não
 * se sustenta.
 */
export type AcaoCognitiva =
  | 'responder'
  | 'perguntar'
  | 'executar'
  | 'pesquisar'
  | 'recuperar_memoria'
  | 'criar_plano'
  /**
   * APURAR uma situação: medir, comparar com o esperado e levantar hipóteses.
   *
   * Não é `responder` (não há resposta antes da medição), não é `executar` (não
   * produz efeito nenhum no mundo) e não é `criar_plano` (o plano é a SAÍDA da
   * apuração, não o meio dela). Existe como valor próprio pelo mesmo motivo que
   * `perguntar` existe: medir "quantas vezes a IARA investigou em vez de
   * palpitar" não pode depender de inferir intenção a partir de nome de rota.
   */
  | 'investigar'
  | 'recusar';

export interface Decisao {
  readonly rota: RotaExecutiva;
  readonly acao: AcaoCognitiva;
  readonly justificativa: string;
  readonly custo_estimado: 'zero' | 'tokens';
  /** Preenchido só na rota `esclarecer`. É a pergunta literal ao operador. */
  readonly pergunta?: string;
  /** O que estava indeterminado. Vai para o console técnico e para a métrica. */
  readonly ambiguidade?: Ambiguidade;
}

/** Âncoras que já dizem qual é a ação, sem precisar do plano. */
const ACAO_DA_ANCORA: Record<string, AcaoCognitiva> = {
  busca: 'pesquisar',
  incidente: 'recuperar_memoria',
  lentidao: 'investigar',
  executar_plano: 'executar',
  pasta: 'executar',
  abrir_app: 'executar',
  energia: 'executar',
  confirmacao: 'executar',
};

/**
 * Acima disto, a percepção reconheceu terreno conhecido e não há por que
 * gastar token para planejar.
 */
const CONFIANCA_SUFICIENTE = 0.85;

export class FuncaoExecutiva {
  private readonly sigilo: PortaoSigilo;
  private readonly ambiguidade = new DetectorAmbiguidade();

  constructor(
    private readonly planejador: Planejador,
    private readonly memoria: MemoriaTrabalho,
    outrosOperadores: readonly string[],
    /** A nuvem está configurada? Sem ela, não adianta cogitar plano cognitivo. */
    private readonly nuvemDisponivel: () => boolean,
  ) {
    this.sigilo = new PortaoSigilo(outrosOperadores);
  }

  /**
   * A ordem das etapas é a política, e ela não é arbitrária:
   *
   *   segurança (sigilo) → o que falta saber (ambiguidade) → o que sei fazer
   *   (receita) → o que consigo pagar (nuvem) → quanto vale decompor
   *
   * Ambiguidade vem ANTES de receita de propósito. Uma receita determinística
   * executa; executar com o alvo errado é pior que não executar. Depois de
   * escolhida a receita já é tarde para perguntar.
   */
  decidir(percepcao: Percepcao, contexto: ContextoDecisao = CONTEXTO_VAZIO): Decisao {
    // 1. Sigilo antes de tudo. Nem percepção nem plano importam se o pedido é
    //    sobre o shard de outra pessoa.
    if (this.sigilo.ehSondagem(percepcao.bruto)) {
      return {
        rota: 'sigilo',
        acao: 'recusar',
        justificativa: 'Sondagem sobre registro de terceiro detectada antes do planejamento.',
        custo_estimado: 'zero',
      };
    }

    // 2. Falta alguma coisa que o contexto NÃO responde? Então pergunte.
    //    O detector já consultou o histórico: o que chega aqui é lacuna real,
    //    não preguiça de olhar para trás.
    const lacunas = this.ambiguidade.detectar(percepcao.bruto, contexto);
    if (lacunas.length > 0) {
      const lacuna = lacunas[0];
      return {
        rota: 'esclarecer',
        acao: 'perguntar',
        justificativa: `Ambiguidade "${lacuna.tipo}" não resolvida pelo contexto (${contexto.historicoRecente.length} turnos consultados).`,
        custo_estimado: 'zero',
        pergunta: perguntaDe(lacuna),
        ambiguidade: lacuna,
      };
    }

    // 3. Receita conhecida vence sempre. É o caminho de ~5ms e custo zero, e
    //    é onde cai a maioria do dia a dia operacional.
    if (this.planejador.temReceita(percepcao)) {
      const ancora = percepcao.ancoras.find((a) => a in ACAO_DA_ANCORA);
      return {
        rota: 'plano_local',
        acao: ancora ? ACAO_DA_ANCORA[ancora] : 'responder',
        justificativa: `Âncoras reconhecidas (${percepcao.ancoras.join(', ')}) → plano determinístico.`,
        custo_estimado: 'zero',
      };
    }

    // 4. Sem nuvem, não há como planejar nem raciocinar. Segue para o passo
    //    único, que vai responder honestamente que a camada está desligada.
    if (!this.nuvemDisponivel()) {
      return {
        rota: 'raciocinio_direto',
        acao: 'responder',
        justificativa: 'Sem receita local e camada de nuvem desligada.',
        custo_estimado: 'zero',
      };
    }

    // 5. Pedido curto e de baixa complexidade não merece uma chamada só para
    //    planejar. Duas chamadas onde uma resolve é desperdício puro.
    if (!this.mereceDecomposicao(percepcao)) {
      return {
        rota: 'raciocinio_direto',
        acao: 'responder',
        justificativa: 'Pedido de escopo único → raciocínio direto, sem custo de planejamento.',
        custo_estimado: 'tokens',
      };
    }

    // 6. Objetivo novo e composto: vale gastar uma chamada para decompor.
    return {
      rota: 'plano_cognitivo',
      acao: 'criar_plano',
      justificativa: `Objetivo novo (confiança ${percepcao.confianca.toFixed(2)}) e composto → decomposição pela LLM.`,
      custo_estimado: 'tokens',
    };
  }

  /**
   * Heurística de composição. Um pedido merece plano quando tem mais de um
   * verbo de ação, ou menciona documento, ou é longo o bastante para conter
   * várias exigências.
   */
  private mereceDecomposicao(p: Percepcao): boolean {
    if (p.confianca >= CONFIANCA_SUFICIENTE) return false;
    if (p.tipo === 'saudacao') return false;
    if (p.tipo === 'documento') return true;

    const conectivos = (p.bruto.match(/\b(e|depois|então|em seguida|e me|e então)\b/gi) ?? []).length;
    const verbos = (
      p.bruto.match(
        /\b(analis\w+|resum\w+|compar\w+|extrai\w*|extrair|gera\w*|gerar|list\w+|calcul\w+|verific\w+|revis\w+)\b/gi,
      ) ?? []
    ).length;

    return verbos >= 2 || (verbos >= 1 && conectivos >= 1) || p.bruto.length > 220;
  }
}
