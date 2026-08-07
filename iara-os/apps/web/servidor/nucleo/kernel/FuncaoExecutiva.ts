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
import { RoteadorIntencoes } from '../RoteadorIntencoes';

export type RotaExecutiva =
  | 'sigilo' // barrar antes de tudo
  | 'plano_local' // receita determinística, custo zero
  | 'plano_cognitivo' // pedir decomposição à LLM
  | 'raciocinio_direto'; // um passo de raciocínio, sem plano

export interface Decisao {
  readonly rota: RotaExecutiva;
  readonly justificativa: string;
  readonly custo_estimado: 'zero' | 'tokens';
}

/**
 * Acima disto, a percepção reconheceu terreno conhecido e não há por que
 * gastar token para planejar.
 */
const CONFIANCA_SUFICIENTE = 0.85;

export class FuncaoExecutiva {
  private readonly roteador: RoteadorIntencoes;

  constructor(
    private readonly planejador: Planejador,
    private readonly memoria: MemoriaTrabalho,
    outrosOperadores: readonly string[],
    /** A nuvem está configurada? Sem ela, não adianta cogitar plano cognitivo. */
    private readonly nuvemDisponivel: () => boolean,
  ) {
    this.roteador = new RoteadorIntencoes([...outrosOperadores]);
  }

  decidir(percepcao: Percepcao): Decisao {
    // 1. Sigilo antes de tudo. Nem percepção nem plano importam se o pedido é
    //    sobre o shard de outra pessoa.
    const rota = this.roteador.rotear(percepcao.bruto);
    if (rota.destino === 'recusa_sigilo') {
      return {
        rota: 'sigilo',
        justificativa: 'Sondagem sobre registro de terceiro detectada antes do planejamento.',
        custo_estimado: 'zero',
      };
    }

    // 2. Receita conhecida vence sempre. É o caminho de ~5ms e custo zero, e
    //    é onde cai a maioria do dia a dia operacional.
    if (this.planejador.temReceita(percepcao)) {
      return {
        rota: 'plano_local',
        justificativa: `Âncoras reconhecidas (${percepcao.ancoras.join(', ')}) → plano determinístico.`,
        custo_estimado: 'zero',
      };
    }

    // 3. Sem nuvem, não há como planejar nem raciocinar. Segue para o passo
    //    único, que vai responder honestamente que a camada está desligada.
    if (!this.nuvemDisponivel()) {
      return {
        rota: 'raciocinio_direto',
        justificativa: 'Sem receita local e camada de nuvem desligada.',
        custo_estimado: 'zero',
      };
    }

    // 4. Pedido curto e de baixa complexidade não merece uma chamada só para
    //    planejar. Duas chamadas onde uma resolve é desperdício puro.
    if (!this.mereceDecomposicao(percepcao)) {
      return {
        rota: 'raciocinio_direto',
        justificativa: 'Pedido de escopo único → raciocínio direto, sem custo de planejamento.',
        custo_estimado: 'tokens',
      };
    }

    // 5. Objetivo novo e composto: vale gastar uma chamada para decompor.
    return {
      rota: 'plano_cognitivo',
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
