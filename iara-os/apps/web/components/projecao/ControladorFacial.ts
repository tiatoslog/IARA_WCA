/**
 * Controlador facial — resolve, a cada quadro, quanto vale cada parâmetro.
 *
 * Nada aqui toca React. É classe simples, instanciada uma vez e chamada de
 * dentro do `useFrame`. Essa separação não é purismo: `setState` a 60 Hz
 * reconcilia a árvore inteira sessenta vezes por segundo e derruba o frame
 * budget muito antes de a GPU ter qualquer problema.
 *
 * FONTE DE CADA MOVIMENTO — a lista inteira, para auditoria:
 *
 *   olhar / cabeça / emoção -> `snapshot.expressao`, compilada pelo Kernel
 *   amplitude geral         -> `snapshot.expressao.intensidade`
 *   pálpebra                -> `metricas.energia_cognitiva`: cansaço é medido
 *   boca                    -> `fala.texto`, o texto que o Kernel emitiu
 *   piscada                 -> PULSO em cada troca de estágio, nunca em laço
 *   aceno                   -> PULSO na abertura de um turno de fala
 *
 * POR QUE A BOCA NÃO USA `expressao.visemas`. O Kernel também deriva visema, e
 * está certo em derivar — mas ele publica na cadência de aglutinação da ponte,
 * dezenas de milissegundos, e articulação precisa de 60 Hz. Nenhuma rede
 * entrega lipsync; o que a rede entrega é o TEXTO, e o texto é o fato. Então o
 * driver 3D reamostra o mesmo fato numa taxa maior, com o relógio monotônico
 * que `fala.iniciada_em` carimbou. O campo `expressao.visemas` continua válido
 * para quem projeta em cadência baixa — a sala em pixel art, por exemplo.
 *
 * Sobre a piscada, que é o ponto onde a regra "nada de animação de idle" quase
 * quebra: um rosto que nunca pisca é um cadáver, e um rosto que pisca em timer
 * está afirmando vida que o sistema não observou. A saída é amarrar a piscada a
 * um evento real — ela troca de estágio, ela pisca. É o mesmo gesto que humanos
 * fazem ao mudar de assunto, e aqui ele só existe quando o assunto mudou mesmo.
 */

import type { EstagioCognitivo } from '../../lib/estado';
import type { Expressao, SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import {
  ABERTURA_DO_VISEMA,
  ARREDONDAMENTO_DO_VISEMA,
  trilhaDeVisemas,
  visemaAgora,
  visemaNoProgresso,
  type Visema,
} from '../../lib/visemas';
import type { ParametroFacial } from './mapaFacial';

/**
 * Poses de emoção. Os cinco nomes são os do contrato do Kernel
 * (`Expressao['emocao']`) — o driver não inventa vocabulário próprio.
 *
 * Valores baixos por decisão: microexpressão, não careta.
 */
const POSE_DA_EMOCAO: Record<Expressao['emocao'], Partial<Record<ParametroFacial, number>>> = {
  neutra: {},
  atenta: {
    sobrancelha_interna_sobe: 0.18,
    olho_arregalado: 0.1,
  },
  concentrada: {
    sobrancelha_desce: 0.26,
    palpebra_apertada: 0.18,
  },
  /** Disponível, voltada para ajudar. É o rosto de quem se oferece. */
  solicita: {
    // Canto da boca SEM bochecha subindo é o sorriso que todo mundo lê como
    // falso. O par é obrigatório.
    canto_sobe: 0.28,
    bochecha_sobe: 0.2,
    sobrancelha_interna_sobe: 0.14,
  },
  preocupada: {
    sobrancelha_interna_sobe: 0.42,
    sobrancelha_desce: 0.16,
    canto_desce: 0.14,
  },
};

/**
 * Velocidade de convergência por família, em unidades por segundo. Olho é rápido
 * porque olho é rápido; sobrancelha é lenta porque sobrancelha é lenta. Um único
 * valor global faz o rosto inteiro se mover como uma máscara de borracha.
 */
const VELOCIDADE: Record<ParametroFacial, number> = {
  piscar_e: 30,
  piscar_d: 30,
  olhar_esquerda: 14,
  olhar_direita: 14,
  olhar_cima: 14,
  olhar_baixo: 14,
  mandibula_abre: 20,
  labios_arredondam: 16,
  labios_selam: 18,
  labios_esticam: 12,
  sobrancelha_sobe: 6,
  sobrancelha_interna_sobe: 6,
  sobrancelha_desce: 6,
  canto_sobe: 7,
  canto_desce: 7,
  palpebra_apertada: 8,
  bochecha_sobe: 7,
  olho_arregalado: 10,
};

/** Duração de uma piscada humana. Mais que isso lê como sonolência. */
const PISCADA_MS = 130;
/** Duração do aceno de reconhecimento na abertura da fala. */
const ACENO_MS = 620;

const PARAMETROS = Object.keys(VELOCIDADE) as ParametroFacial[];

export interface PoseCabeca {
  /** Radianos. Já convertidos do contrato, que fala em graus. */
  giro: number;
  inclinacao: number;
  aceno: number;
}

export interface QuadroFacial {
  face: Record<ParametroFacial, number>;
  cabeca: PoseCabeca;
}

function zerado(): Record<ParametroFacial, number> {
  const r = {} as Record<ParametroFacial, number>;
  for (const p of PARAMETROS) r[p] = 0;
  return r;
}

const GRAU = Math.PI / 180;

export class ControladorFacial {
  private atual = zerado();
  private alvo = zerado();

  private estagioAnterior: EstagioCognitivo | null = null;
  private falaAnterior: string | null = null;
  private piscadaEm: number | null = null;
  private acenoEm: number | null = null;

  /**
   * Trilha de visemas memorizada. Recalcular a trilha de uma resposta de dois
   * mil caracteres a cada quadro seria 120 mil operações por segundo para
   * produzir exatamente o mesmo array — o texto só muda na cadência do
   * snapshot, então a trilha só é refeita quando ele muda.
   */
  private trilhaId: string | null = null;
  private trilhaTexto = -1;
  private trilha: Visema[] = [];

  atualizar(
    snapshot: SnapshotCognitivo,
    fala: Fala | null,
    voz: RelogioVoz | null,
    agora: number,
    dt: number,
  ): QuadroFacial {
    this.detectarEventos(snapshot, fala, agora);
    this.montarAlvo(snapshot, fala, voz, agora);
    this.convergir(dt);
    this.aplicarPulsos(agora);

    const { cabeca } = snapshot.expressao;
    return {
      face: this.atual,
      cabeca: {
        giro: cabeca.giro * GRAU,
        inclinacao: cabeca.inclinacao * GRAU,
        aceno: this.intensidadeAceno(agora),
      },
    };
  }

  /** Pulsos nascem de transições observadas, nunca de temporizador. */
  private detectarEventos(snapshot: SnapshotCognitivo, fala: Fala | null, agora: number) {
    if (this.estagioAnterior !== null && this.estagioAnterior !== snapshot.estagio) {
      this.piscadaEm = agora;
    }
    this.estagioAnterior = snapshot.estagio;

    const id = fala?.id ?? null;
    if (id !== null && id !== this.falaAnterior) this.acenoEm = agora;
    this.falaAnterior = id;
  }

  private garantirTrilha(fala: Fala) {
    if (this.trilhaId === fala.id && this.trilhaTexto === fala.texto.length) return;
    this.trilhaId = fala.id;
    this.trilhaTexto = fala.texto.length;
    this.trilha = trilhaDeVisemas(fala.texto);
  }

  private montarAlvo(
    snapshot: SnapshotCognitivo,
    fala: Fala | null,
    voz: RelogioVoz | null,
    agora: number,
  ) {
    for (const p of PARAMETROS) this.alvo[p] = 0;

    const { expressao, metricas } = snapshot;
    // A intensidade do Kernel modula tudo que é expressivo. Ociosa em 0.2, ela
    // fica visivelmente mais quieta — sem que nenhum parâmetro seja desligado.
    const amplitude = 0.35 + expressao.intensidade * 0.65;

    // --- emoção -----------------------------------------------------------
    for (const [p, valor] of Object.entries(POSE_DA_EMOCAO[expressao.emocao] ?? {}) as Array<
      [ParametroFacial, number]
    >) {
      this.alvo[p] = valor * amplitude;
    }

    // --- olhar ------------------------------------------------------------
    const { x, y } = expressao.olhar;
    if (x >= 0) this.alvo.olhar_direita = x;
    else this.alvo.olhar_esquerda = -x;
    if (y >= 0) this.alvo.olhar_cima = y;
    else this.alvo.olhar_baixo = -y;

    // --- cansaço ----------------------------------------------------------
    // Energia baixa pesa a pálpebra. É o único ponto em que uma métrica vital
    // vira expressão, e é literal: menos energia, olho mais fechado.
    const cansaco = Math.max(0, 0.55 - metricas.energia_cognitiva) / 0.55;
    this.alvo.palpebra_apertada = Math.max(this.alvo.palpebra_apertada, cansaco * 0.3);

    // --- boca -------------------------------------------------------------
    //
    // Duas fontes de tempo, em ordem de preferência:
    //
    //  1. O ÁUDIO, quando existe. É o relógio verdadeiro: a boca segue a
    //     locução, com as pausas e alongamentos que ela realmente tem.
    //  2. A cadência de leitura, quando não há voz. Aproximação declarada —
    //     ver `visemas.ts`.
    //
    // Repare que a fala com áudio continua articulando mesmo depois de
    // `concluida`: o texto termina de chegar bem antes de a voz terminar de
    // dizê-lo. Fechar a boca no fim do texto calaria a IARA no meio da frase.
    const fracaoDaVoz = voz?.progresso() ?? null;

    if (fala && fala.papel === 'iara' && (fracaoDaVoz !== null || !fala.concluida)) {
      this.garantirTrilha(fala);
      const { visema } =
        fracaoDaVoz !== null
          ? visemaNoProgresso(this.trilha, fracaoDaVoz)
          : visemaAgora(this.trilha, fala.texto.length, agora - fala.iniciada_em);

      this.alvo.mandibula_abre = ABERTURA_DO_VISEMA[visema];
      this.alvo.labios_arredondam = ARREDONDAMENTO_DO_VISEMA[visema];
      if (visema === 'PP') this.alvo.labios_selam = 0.65;
      if (visema === 'SS' || visema === 'II') this.alvo.labios_esticam = 0.3;
    }
  }

  /**
   * Convergência exponencial. `1 - e^(-v·dt)` em vez de um lerp de fator fixo:
   * com fator fixo a velocidade da animação passa a depender do frame rate, e o
   * rosto fica mais lento no notebook do que no desktop.
   */
  private convergir(dt: number) {
    const passo = Math.min(dt, 0.1); // trava de aba em segundo plano
    for (const p of PARAMETROS) {
      const k = 1 - Math.exp(-VELOCIDADE[p] * passo);
      this.atual[p] += (this.alvo[p] - this.atual[p]) * k;
    }
  }

  /** Piscada é somada por cima do convergido: ela atropela, não negocia. */
  private aplicarPulsos(agora: number) {
    if (this.piscadaEm === null) return;
    const t = (agora - this.piscadaEm) / PISCADA_MS;
    if (t >= 1) {
      this.piscadaEm = null;
      return;
    }
    // Meia senóide: fecha e abre uma vez, sem repique.
    const fechamento = Math.sin(t * Math.PI);
    this.atual.piscar_e = Math.max(this.atual.piscar_e, fechamento);
    this.atual.piscar_d = Math.max(this.atual.piscar_d, fechamento);
  }

  private intensidadeAceno(agora: number): number {
    if (this.acenoEm === null) return 0;
    const t = (agora - this.acenoEm) / ACENO_MS;
    if (t >= 1) {
      this.acenoEm = null;
      return 0;
    }
    // Um aceno só: desce e volta, amortecido no fim.
    return Math.sin(t * Math.PI * 2) * (1 - t);
  }
}
