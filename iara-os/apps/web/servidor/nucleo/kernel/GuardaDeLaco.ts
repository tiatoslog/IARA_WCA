/**
 * A GUARDA DO LAÇO — o que impede a segunda volta de virar a milésima.
 *
 * ESTE ARQUIVO EXISTE ANTES DO LAÇO, e a ordem é deliberada. Um laço de agente
 * sem detector de repetição é uma conta de API aberta: o modelo que errou o
 * parâmetro na volta 1 erra o MESMO parâmetro na volta 2, lê o mesmo erro, e a
 * única coisa que cresce é o gasto. O `OrcamentoDoTurno` para isso — mas para
 * pelo teto, depois de pagar N vezes pelo mesmo engano. A guarda para pelo
 * PADRÃO, na segunda ou terceira repetição, e diz por quê.
 *
 * O QUE ELA NÃO FAZ, e é o que a mantém testável:
 *
 *   ela não executa, não publica evento, não escreve no jornal e não decide
 *   política de risco. Recebe observação, devolve veredicto. Quem chama traduz
 *   o veredicto em evento, em observação para o modelo ou em fim de turno.
 *   Mesma disciplina de `OrcamentoDeContexto`: a peça que decide o que a IARA
 *   pode continuar tentando não pode depender de ambiente para ser provada.
 *
 * O QUE A DIFERENCIA DA GUARDA DO HERMES. O `tool_guardrails.py` mantém uma
 * lista fixa de nomes de ferramenta idempotente (`IDEMPOTENT_TOOL_NAMES`) —
 * um segundo lugar onde a verdade sobre uma ferramenta mora, e que sai de
 * sincronia no dia em que alguém muda a ferramenta e esquece a lista. Aqui o
 * dado já existe e é obrigatório em tempo de compilação:
 * `ManifestoHabilidade.idempotencia`. A guarda lê o manifesto. Não há segunda
 * lista para desatualizar.
 *
 * BARRAR É FALAR. Um passo barrado não some: o veredicto carrega um `motivo`
 * escrito para o MODELO ler na volta seguinte. Descartar em silêncio trocaria
 * o defeito de lugar — o modelo repetiria a chamada achando que ela nunca
 * aconteceu. É a mesma regra da recusa por fila cheia no `Kernel`.
 *
 * SOBRE OS NÚMEROS. Eles não são gosto: saem do teto de voltas que o laço vai
 * declarar (`VOLTAS_PADRAO`). Um limiar acima do teto nunca dispara e é código
 * morto; um limiar de 1 mataria a retentativa legítima — corrigir um parâmetro
 * e tentar de novo é exatamente o comportamento que o laço existe para
 * permitir. Os limiares abaixo deixam UMA correção passar e param a segunda.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { SemanticaEfeito } from './Operacao';

/**
 * O teto de voltas que o laço vai adotar. Vive aqui porque é dele que os
 * limiares derivam — e um limiar que não conhece o teto é um número solto.
 *
 * Oito, e não mais: o `TETOS_PADRAO.passos` de hoje é 6, e o laço não deve
 * nascer podendo gastar mais passos que o pipeline que ele substitui gastava.
 * Duas voltas de folga cobrem o caso que motivou o laço — errar o parâmetro,
 * ler o erro, corrigir — sem abrir espaço para uma expedição.
 */
export const VOLTAS_PADRAO = 8;

export type AcaoDaGuarda =
  /** Segue. Nada observado que justifique intervir. */
  | 'permitir'
  /** Segue, mas o modelo recebe um aviso junto do resultado. */
  | 'avisar'
  /** ESTE passo não roda. O laço continua — o modelo lê o motivo e pode mudar. */
  | 'barrar'
  /** O laço para. A resposta é composta com o que já se tem. */
  | 'encerrar';

export interface VeredictoDaGuarda {
  readonly acao: AcaoDaGuarda;
  /** Código estável para auditoria e teste. Nunca texto livre. */
  readonly codigo:
    | 'permitido'
    | 'falha_identica'
    | 'ja_executado'
    | 'habilidade_falhando'
    | 'voltas_esgotadas';
  /** Escrito para o MODELO ler. Vazio quando `permitir`. */
  readonly motivo: string;
  readonly habilidade: string;
  /** Quantas vezes o padrão detectado já ocorreu, incluindo esta. */
  readonly contagem: number;
}

const PERMITIDO = (habilidade: string): VeredictoDaGuarda => ({
  acao: 'permitir',
  codigo: 'permitido',
  motivo: '',
  habilidade,
  contagem: 0,
});

export interface LimiaresDaGuarda {
  /**
   * Mesma habilidade, MESMOS parâmetros, falhando de novo.
   *
   * SÓ UM DEGRAU, e não avisa-depois-barra como os outros dois. Uma chamada
   * byte a byte idêntica que já falhou vai falhar de novo: recusa de esquema,
   * negativa do porteiro e teto de autonomia são determinísticos. Avisar e
   * deixar passar seria pagar a segunda vez pela mesma resposta.
   */
  readonly falha_identica_barra: number;
  /** Mesma habilidade falhando com parâmetros DIFERENTES a cada tentativa. */
  readonly habilidade_falhando_avisa: number;
  readonly habilidade_falhando_encerra: number;
  /** Teto de voltas do laço. */
  readonly voltas: number;
}

/**
 * Derivados de `VOLTAS_PADRAO`, e a derivação é o argumento:
 *
 *  · `falha_identica` — barra já na 2ª. O argumento da "corrida legítima" vale
 *    para leitura, não para falha: esquema recusado, porteiro negando e teto de
 *    autonomia não mudam de opinião entre duas voltas do mesmo turno. Medido em
 *    19/08/2026, era exatamente esta a repetição que fazia dois passos barrados
 *    virarem oito.
 *  · `habilidade_falhando` — parâmetros diferentes a cada vez é o modelo
 *    TENTANDO consertar, que é comportamento desejado. Três tentativas é
 *    esforço honesto; a quarta é chute, e chute com efeito é o que a IARA não
 *    faz. Avisa na 3ª, encerra na 4ª.
 */
export const LIMIARES_PADRAO: LimiaresDaGuarda = {
  falha_identica_barra: 2,
  habilidade_falhando_avisa: 3,
  habilidade_falhando_encerra: 4,
  voltas: VOLTAS_PADRAO,
};

/**
 * O que a guarda precisa saber sobre a chamada ANTES de ela rodar.
 *
 * `idempotencia` vem do manifesto, não de uma lista aqui dentro — ver o
 * cabeçalho. `undefined` é aceito e trata como não-leitura: uma habilidade sem
 * manifesto conhecido não ganha o benefício da dúvida.
 */
export interface ChamadaObservada {
  readonly habilidade: string;
  readonly parametros: Record<string, unknown>;
  readonly idempotencia?: SemanticaEfeito;
}

/** O que a guarda precisa saber DEPOIS que a chamada rodou. */
export interface ResultadoObservado {
  readonly falhou: boolean;
}

/**
 * Canonicaliza parâmetros para hash: chaves ordenadas em toda profundidade.
 *
 * Sem a ordenação recursiva, `{a:{x:1,y:2}}` e `{a:{y:2,x:1}}` — a MESMA
 * chamada — produziriam assinaturas diferentes e o detector nunca casaria.
 * É o modo de falha silencioso desta classe inteira: uma guarda que nunca
 * dispara parece uma guarda que nunca precisou disparar.
 */
/**
 * Profundidade máxima. Estrutura mais funda que isto não vem de plano de LLM —
 * vem de defeito ou de ataque, e em qualquer um dos dois casos a assinatura não
 * melhora descendo mais.
 */
const PROFUNDIDADE_MAX = 8;

function canonicalizar(valor: unknown, vistos: WeakSet<object>, nivel = 0): unknown {
  /**
   * CICLO E FUNDO DE POÇO — e a primeira versão desta função não tratava nem um
   * nem outro. Medido: `{self: circular}` estourava a pilha DENTRO da guarda,
   * e uma guarda que derruba o turno é estritamente pior que guarda nenhuma —
   * ela transforma um laço caro num turno morto.
   *
   * Não é alcançável pelo plano da LLM hoje (`JSON.parse` não produz ciclo),
   * mas a guarda é chamada com `passo.parametros`, e receita determinística
   * monta objeto em código. O custo de fechar isto é uma linha; o custo de
   * descobrir em produção é um turno que some sem explicação.
   */
  if (nivel > PROFUNDIDADE_MAX) return '[fundo]';
  if (Array.isArray(valor)) {
    if (vistos.has(valor)) return '[ciclo]';
    vistos.add(valor);
    return valor.map((v) => canonicalizar(v, vistos, nivel + 1));
  }
  if (valor !== null && typeof valor === 'object') {
    if (vistos.has(valor)) return '[ciclo]';
    vistos.add(valor);
    const entradas = Object.entries(valor as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return Object.fromEntries(
      entradas.map(([k, v]) => [k, canonicalizar(v, vistos, nivel + 1)]),
    );
  }
  /* `JSON.stringify` lança em BigInt e ignora Symbol. Nenhum dos dois sai de
     `JSON.parse`, mas o mesmo argumento do ciclo vale: a guarda não pode ser
     a peça que lança. */
  if (typeof valor === 'bigint' || typeof valor === 'symbol') return String(valor);
  return valor;
}

function hashCurto(texto: string): string {
  return createHash('sha256').update(texto).digest('hex').slice(0, 16);
}

/**
 * Identidade estável e NÃO reversível de uma chamada.
 *
 * NUNCA LANÇA — e é contrato, não zelo. Quem chama está no meio de um turno,
 * antes de executar o passo; uma exceção daqui vira turno morto sem resposta.
 * Se a serialização falhar mesmo depois da canonicalização, a assinatura sai
 * ÚNICA: o detector deixa de casar (degrada para "permitir") em vez de
 * derrubar. Os tetos de verdade — voltas e orçamento — continuam de pé, e são
 * eles que garantem terminação.
 */
export function assinaturaDaChamada(
  habilidade: string,
  parametros: Record<string, unknown>,
): string {
  try {
    const canonico = JSON.stringify(canonicalizar(parametros ?? {}, new WeakSet()));
    return `${habilidade}:${hashCurto(canonico ?? 'undefined')}`;
  } catch {
    return `${habilidade}:naoserializavel:${randomUUID()}`;
  }
}

interface Registro {
  falhas: number;
  /** Quantas vezes esta chamada exata JÁ DEU CERTO neste turno. */
  sucessos: number;
}

export class GuardaDeLaco {
  private volta = 0;
  /** Por assinatura: quantas falhas e quais saídas já se viu. */
  private readonly porAssinatura = new Map<string, Registro>();
  /** Por habilidade: falhas totais, independentemente dos parâmetros. */
  private readonly falhasPorHabilidade = new Map<string, number>();

  constructor(private readonly limiares: LimiaresDaGuarda = LIMIARES_PADRAO) {}

  /**
   * Um turno novo começa limpo. Chamado pelo Kernel na abertura do turno, pelo
   * mesmo motivo que o `OrcamentoDoTurno` nasce na pilha: dois turnos do mesmo
   * kernel não dividem contagem, e uma guarda de instância compartilhada faria
   * o segundo pedido do operador nascer com o histórico de falhas do primeiro.
   */
  reiniciarTurno(): void {
    this.volta = 0;
    this.porAssinatura.clear();
    this.falhasPorHabilidade.clear();
  }

  /** Voltas já abertas neste turno. */
  get voltasGastas(): number {
    return this.volta;
  }

  /**
   * ABRIR UMA VOLTA. Chamado ANTES da chamada de modelo da volta.
   *
   * Separado de `antesDaChamada` de propósito: o teto de voltas é sobre idas ao
   * MODELO, e uma volta pode acionar mais de uma habilidade ou nenhuma. Contar
   * volta ao executar habilidade mediria outra coisa.
   */
  abrirVolta(): VeredictoDaGuarda {
    if (this.volta >= this.limiares.voltas) {
      return {
        acao: 'encerrar',
        codigo: 'voltas_esgotadas',
        motivo:
          `Teto de ${this.limiares.voltas} voltas atingido neste turno. ` +
          'Responda com o que já foi apurado e diga explicitamente o que ficou sem resposta.',
        habilidade: '',
        contagem: this.volta,
      };
    }
    this.volta += 1;
    return PERMITIDO('');
  }

  /**
   * ANTES DE EXECUTAR. Devolve o veredicto sobre esta chamada específica.
   *
   * NÃO substitui o `PorteiroAutorizacao`, o esquema nem o orçamento — roda
   * junto deles e responde outra pergunta: "isto já não foi tentado?". Um
   * `permitir` daqui não autoriza nada; só declara que não é repetição.
   */
  antesDaChamada(c: ChamadaObservada): VeredictoDaGuarda {
    const assinatura = assinaturaDaChamada(c.habilidade, c.parametros);
    const reg = this.porAssinatura.get(assinatura);

    /**
     * 0. JÁ DEU CERTO — repetir chamada idêntica bem-sucedida não traz nada.
     *
     * O detector que faltava, e a lacuna era das caras. Os outros três olham
     * para FALHA e para leitura sem progresso; uma escrita que deu certo e é
     * pedida de novo, byte a byte igual, escapava por entre eles. Medido em
     * 19/08/2026: com um planejador que devolvia o mesmo plano, cada habilidade
     * executava DUAS vezes por turno, em silêncio.
     *
     * `RegistroOperacoes` deduplicaria o efeito no jornal — mas dedup no fim da
     * linha é rede de segurança, não desenho. O laço não deve nem propor a
     * repetição.
     *
     * LEITURA TAMBÉM ENTRA, e a primeira versão a deixava de fora com o
     * argumento da fonte viva: clima e planilha atualizada podem devolver valor
     * diferente, e barrar impediria a IARA de ver o mundo mudar.
     *
     * O argumento é bom e o escopo estava errado. Ele vale ENTRE TURNOS — e
     * entre turnos a guarda já nasce zerada, porque `reiniciarTurno` limpa
     * tudo. DENTRO de um turno, que dura segundos, reler a mesma coisa com os
     * mesmos parâmetros é desperdício quase certo: a observação anterior está
     * ali, na mesma janela de contexto. Medido em 19/08/2026 no cross-talk
     * entre espelhos: cada habilidade executava duas vezes por turno porque a
     * releitura passava com um aviso.
     */
    if (reg && reg.sucessos > 0) {
      return {
        acao: 'barrar',
        codigo: 'ja_executado',
        motivo:
          `"${c.habilidade}" já foi executada neste turno com exatamente estes parâmetros, ` +
          'e deu certo. O resultado está nas observações acima — use-o em vez de repetir.',
        habilidade: c.habilidade,
        contagem: reg.sucessos + 1,
      };
    }

    // 1. Falha idêntica — mesma habilidade, mesmos parâmetros, já falhou.
    if (reg && reg.falhas > 0) {
      const proxima = reg.falhas + 1;
      if (proxima >= this.limiares.falha_identica_barra) {
        return {
          acao: 'barrar',
          codigo: 'falha_identica',
          motivo:
            `"${c.habilidade}" já falhou ${reg.falhas}× com exatamente estes parâmetros. ` +
            'Não a repita sem MUDAR algum parâmetro, ou escolha outro caminho.',
          habilidade: c.habilidade,
          contagem: proxima,
        };
      }
    }

    // 2. Habilidade falhando — parâmetros diferentes, mesma habilidade.
    const falhas = this.falhasPorHabilidade.get(c.habilidade) ?? 0;
    if (falhas > 0) {
      const proxima = falhas + 1;
      if (proxima >= this.limiares.habilidade_falhando_encerra) {
        return {
          acao: 'encerrar',
          codigo: 'habilidade_falhando',
          motivo:
            `"${c.habilidade}" falhou ${falhas}× neste turno, com parâmetros diferentes a cada vez. ` +
            'Pare de tentar: responda com o que apurou e declare esta lacuna.',
          habilidade: c.habilidade,
          contagem: proxima,
        };
      }
      if (proxima >= this.limiares.habilidade_falhando_avisa) {
        return {
          acao: 'avisar',
          codigo: 'habilidade_falhando',
          motivo:
            `Atenção: "${c.habilidade}" já falhou ${falhas}× neste turno. ` +
            'Se a próxima tentativa não for claramente diferente, prefira outro caminho.',
          habilidade: c.habilidade,
          contagem: proxima,
        };
      }
    }

    return PERMITIDO(c.habilidade);
  }

  /**
   * DEPOIS DE EXECUTAR. Alimenta os três detectores.
   *
   * Chamado inclusive quando o passo foi barrado por outra porta (porteiro,
   * esquema, orçamento): uma habilidade que o porteiro recusa vai recusar de
   * novo, e o modelo precisa parar de pedi-la. Quem chama informa `falhou`.
   */
  depoisDaChamada(c: ChamadaObservada, r: ResultadoObservado): void {
    const assinatura = assinaturaDaChamada(c.habilidade, c.parametros);
    const reg = this.porAssinatura.get(assinatura) ?? { falhas: 0, sucessos: 0 };

    if (r.falhou) {
      reg.falhas += 1;
      this.falhasPorHabilidade.set(
        c.habilidade,
        (this.falhasPorHabilidade.get(c.habilidade) ?? 0) + 1,
      );
    } else {
      reg.sucessos += 1;
    }

    this.porAssinatura.set(assinatura, reg);
  }
}
