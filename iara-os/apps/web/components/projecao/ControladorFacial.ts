/**
 * Controlador facial — resolve, a cada quadro, quanto vale cada parâmetro.
 *
 * Nada aqui toca React. É classe simples, instanciada uma vez e chamada de
 * dentro do `useFrame`. Essa separação não é purismo: `setState` a 60 Hz
 * reconcilia a árvore inteira sessenta vezes por segundo e derruba o frame
 * budget muito antes de a GPU ter qualquer problema.
 *
 * O QUE ANIMA E POR QUÊ — a lista inteira, para auditoria:
 *
 *   boca      -> texto realmente entregue pelo `fala_delta` (ver `visemas.ts`)
 *   olhar     -> `estagio`, via `olharDe` em `lib/projecao.ts`
 *   pálpebra  -> `energia_cognitiva`: cansaço é fato medido, não estilo
 *   sobrancelha/canto de boca -> `emocao`, que por sua vez é derivada de
 *                estágio + leitura do operador + disponibilidade da nuvem
 *   piscada   -> PULSO em cada troca de estágio, nunca em laço
 *   aceno     -> PULSO no início de um turno de fala
 *
 * Sobre a piscada, que é o ponto onde a regra "nada de animação de idle" quase
 * quebra: um rosto que nunca pisca é um cadáver, e um rosto que pisca em timer
 * está afirmando vida que o sistema não observou. A saída é amarrar a piscada a
 * um evento real — ela troca de estágio, ela pisca. É o mesmo gesto que humanos
 * fazem ao mudar de assunto, e aqui ele só existe quando o assunto mudou mesmo.
 */

import type { SnapshotCognitivo } from '../../lib/projecao';
import type { EstagioCognitivo } from '../../lib/estado';
import {
  ABERTURA_DO_VISEMA,
  ARREDONDAMENTO_DO_VISEMA,
  visemaAgora,
} from '../../lib/visemas';
import type { ParametroFacial } from './mapaFacial';

/** Poses de emoção. Valores baixos por decisão: microexpressão, não careta. */
const POSE_DA_EMOCAO: Record<string, Partial<Record<ParametroFacial, number>>> = {
  neutra: {},
  atenta: {
    sobrancelha_interna_sobe: 0.18,
    olho_arregalado: 0.1,
  },
  concentrada: {
    sobrancelha_desce: 0.26,
    palpebra_apertada: 0.18,
  },
  cordial: {
    // Canto da boca SEM bochecha subindo é o sorriso que todo mundo lê como
    // falso. O par é obrigatório.
    canto_sobe: 0.3,
    bochecha_sobe: 0.22,
  },
  contida: {
    sobrancelha_interna_sobe: 0.12,
    canto_desce: 0.1,
    palpebra_apertada: 0.12,
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
const VELOCIDADE: Partial<Record<ParametroFacial, number>> = {
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

const VELOCIDADE_PADRAO = 10;

/** Duração de uma piscada humana. Mais que isso lê como sonolência. */
const PISCADA_MS = 130;
/** Duração do aceno de reconhecimento no início da fala. */
const ACENO_MS = 620;

const PARAMETROS = Object.keys(VELOCIDADE) as ParametroFacial[];

export interface PoseCabeca {
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

export class ControladorFacial {
  private atual = zerado();
  private alvo = zerado();

  private estagioAnterior: EstagioCognitivo | null = null;
  private falaAnterior: string | null = null;
  private piscadaEm: number | null = null;
  private acenoEm: number | null = null;

  /**
   * Um quadro. `agora` vem do relógio da cena (`performance.now()`), `dt` é o
   * delta em segundos que o R3F já entrega.
   */
  atualizar(snapshot: SnapshotCognitivo, agora: number, dt: number): QuadroFacial {
    this.detectarEventos(snapshot, agora);
    this.montarAlvo(snapshot, agora);
    this.convergir(dt);
    this.aplicarPulsos(agora);

    return {
      face: this.atual,
      cabeca: {
        giro: snapshot.cabeca.giro,
        inclinacao: snapshot.cabeca.inclinacao,
        aceno: this.intensidadeAceno(agora),
      },
    };
  }

  /** Pulsos nascem de transições observadas, nunca de temporizador. */
  private detectarEventos(snapshot: SnapshotCognitivo, agora: number) {
    if (this.estagioAnterior !== null && this.estagioAnterior !== snapshot.estagio) {
      this.piscadaEm = agora;
    }
    this.estagioAnterior = snapshot.estagio;

    if (snapshot.fala.id !== null && snapshot.fala.id !== this.falaAnterior) {
      this.acenoEm = agora;
    }
    this.falaAnterior = snapshot.fala.id;
  }

  private montarAlvo(snapshot: SnapshotCognitivo, agora: number) {
    for (const p of PARAMETROS) this.alvo[p] = 0;

    // --- emoção -----------------------------------------------------------
    const pose = POSE_DA_EMOCAO[snapshot.emocao] ?? {};
    for (const [p, valor] of Object.entries(pose) as Array<[ParametroFacial, number]>) {
      this.alvo[p] = valor;
    }

    // --- olhar ------------------------------------------------------------
    const { x, y } = snapshot.olhar;
    if (x >= 0) this.alvo.olhar_direita = x;
    else this.alvo.olhar_esquerda = -x;
    if (y >= 0) this.alvo.olhar_cima = y;
    else this.alvo.olhar_baixo = -y;

    // --- cansaço ----------------------------------------------------------
    // Energia baixa pesa a pálpebra. É o único lugar onde uma métrica vital
    // vira expressão, e é literal: menos energia, olho mais fechado.
    const cansaco = Math.max(0, 0.55 - snapshot.energia) / 0.55;
    this.alvo.palpebra_apertada = Math.max(this.alvo.palpebra_apertada, cansaco * 0.3);

    // --- boca -------------------------------------------------------------
    if (snapshot.fala.ativa && snapshot.fala.iniciada_em !== null) {
      const { visema } = visemaAgora(
        snapshot.fala.trilha,
        snapshot.fala.revelados,
        agora - snapshot.fala.iniciada_em,
      );
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
      const v = VELOCIDADE[p] ?? VELOCIDADE_PADRAO;
      const k = 1 - Math.exp(-v * passo);
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
