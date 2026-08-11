/**
 * Mapa da aurora — a tradução visual da entidade, no mesmo papel que
 * `mapaFacial.ts` tem para o avatar: nenhum componente conhece parâmetro de
 * shader, pela mesma razão que nenhum conhece nome de morph target.
 *
 * Um estado cognitivo vira um conjunto de parâmetros físicos da entidade:
 * amplitude e velocidade das ondas, raio orbital das cortinas, brilho,
 * incandescência do núcleo e faixa de matiz. O `SnapshotCognitivo` continua
 * sendo a única coisa que atravessa a fronteira — este arquivo só o traduz.
 *
 * A ENERGIA DA VOZ é o mesmo fato de 60 Hz que articulava a boca: a abertura
 * do visema corrente, reamostrada do texto que o Kernel emitiu. O lipsync não
 * morreu com o avatar — ele virou luz.
 */

import type { SnapshotCognitivo } from '../../lib/snapshot';
import type { Fala } from '../../hooks/useIaraSocket';
import type { RelogioVoz } from '../../hooks/useVoz';
import {
  ABERTURA_DO_VISEMA,
  trilhaDeVisemas,
  visemaAgora,
  visemaNoProgresso,
  type Visema,
} from '../../lib/visemas';

/** Parâmetros físicos da entidade — o vocabulário inteiro do shader. */
export interface EstadoEntidade {
  /** Amplitude das ondas viajantes (0..1). */
  amp: number;
  /** Velocidade do movimento. */
  vel: number;
  /** Fator do raio orbital das cortinas. */
  raio: number;
  /** Brilho geral das auroras. */
  brilho: number;
  /** Incandescência do núcleo (o encante). */
  interno: number;
  /** Faixa de matiz, em voltas do círculo HSV (m0..m1). */
  m0: number;
  m1: number;
}

/**
 * Um estado da entidade para CADA estágio cognitivo, mais o alerta.
 *
 * O `EstagioCognitivo` sempre teve seis valores; era este mapa que jogava
 * `executando`, `consultando` e `pensando` no mesmo balde. O efeito era a tela
 * mentir por omissão: a IARA rodando uma ação local e a IARA raciocinando na
 * nuvem apareciam idênticas, e quem olha não tinha como saber se o trabalho
 * está acontecendo aqui ou lá fora.
 *
 * O QUE DISTINGUE CADA UM não é só a cor — cor sozinha não sobrevive a um
 * monitor mal calibrado nem a quem não distingue verde de vermelho. Cada
 * estado tem também uma postura: o raio das cortinas diz se a entidade se
 * recolhe ou se abre, o brilho diz se a atenção está para dentro ou para fora,
 * e a incandescência do encante diz quanto está queimando por dentro.
 *
 *   disponível  — em repouso, aberta, brasa baixa.
 *   observando  — recolhe (0,85) e acelera: escuta é atenção contida.
 *   pensando    — a aurora ESCURECE (0,35) e o encante vai ao máximo: a
 *                 entidade apaga por fora porque está toda por dentro.
 *   trabalhando — o oposto exato: abre (1,18), brilha, e o encante fica em
 *                 meio termo. Ação acontece para fora.
 *   revisando   — recolhe como quem escuta, mas queima como quem pensa: é
 *                 leitura, não conversa e não raciocínio.
 *   respondendo — amplitude máxima, na energia da voz.
 *   alerta      — a única faixa quente, e a única que tinge o vidro.
 *
 * Matiz em voltas (0..1). As faixas não se sobrepõem entre estados vizinhos,
 * e a de 0.02–0.09 é o coral do alerta — nunca vermelho saturado, invariante
 * mantido. Nenhuma outra faixa desce abaixo de 0,2, que é o limiar que liga o
 * tingimento do vidro e das cortinas.
 */
const ESTADOS = {
  disponivel:  { amp: 0.15, vel: 0.25, raio: 1.0,  brilho: 0.62, interno: 0.3,  m0: 0.42, m1: 0.72 },
  observando:  { amp: 0.1,  vel: 0.5,  raio: 0.85, brilho: 0.65, interno: 0.4,  m0: 0.42, m1: 0.58 },
  pensando:    { amp: 0.18, vel: 0.7,  raio: 0.95, brilho: 0.35, interno: 1.0,  m0: 0.60, m1: 0.78 },
  trabalhando: { amp: 0.30, vel: 0.95, raio: 1.18, brilho: 0.68, interno: 0.55, m0: 0.28, m1: 0.46 },
  revisando:   { amp: 0.22, vel: 0.8,  raio: 0.88, brilho: 0.5,  interno: 0.72, m0: 0.78, m1: 0.95 },
  respondendo: { amp: 0.9,  vel: 1.1,  raio: 1.1,  brilho: 1.0,  interno: 0.55, m0: 0.38, m1: 0.95 },
  alerta:      { amp: 0.4,  vel: 0.55, raio: 1.02, brilho: 0.8,  interno: 0.65, m0: 0.02, m1: 0.09 },
} satisfies Record<string, EstadoEntidade>;

export type NomeEstadoEntidade = keyof typeof ESTADOS;

/**
 * Snapshot → estado. A emoção `preocupada` tem precedência (é o alerta do
 * Kernel); depois a fala em curso; depois o estágio cognitivo, um para um.
 *
 * O `switch` é exaustivo de propósito: estágio novo no contrato passa a ser
 * erro de compilação aqui, e não silêncio visual.
 */
export function estadoDaEntidade(
  snapshot: SnapshotCognitivo,
  articulando: boolean,
): NomeEstadoEntidade {
  if (snapshot.expressao.emocao === 'preocupada') return 'alerta';
  if (articulando) return 'respondendo';
  switch (snapshot.estagio) {
    case 'escutando':
      return 'observando';
    case 'executando':
      return 'trabalhando';
    case 'consultando':
      return 'revisando';
    case 'pensando':
      return 'pensando';
    case 'falando':
      return 'respondendo';
    case 'ocioso':
      return 'disponivel';
  }
}

export interface QuadroEntidade extends EstadoEntidade {
  /** Envelope da voz (0..1) — amplitude instantânea das ondas ao falar. */
  env: number;
  estado: NomeEstadoEntidade;
}

/**
 * Controlador da entidade — o análogo do `ControladorFacial`. Classe simples,
 * instanciada uma vez, chamada de dentro do `useFrame`. Nada aqui toca React.
 *
 * A transição entre estados é sempre interpolada (água não tem frames): a
 * convergência exponencial `1 - e^(-v·dt)` independe do frame rate.
 */
export class ControladorEntidade {
  private atual: EstadoEntidade = { ...ESTADOS.disponivel };
  private envSuave = 0;

  private trilhaId: string | null = null;
  private trilhaTexto = -1;
  private trilha: Visema[] = [];

  private garantirTrilha(fala: Fala) {
    if (this.trilhaId === fala.id && this.trilhaTexto === fala.texto.length) return;
    this.trilhaId = fala.id;
    this.trilhaTexto = fala.texto.length;
    this.trilha = trilhaDeVisemas(fala.texto);
  }

  /**
   * O mesmo fato que articulava a boca: o visema corrente da fala, com o
   * relógio do áudio quando há voz e a cadência de leitura quando não há.
   * A abertura do visema vira o envelope de energia das ondas.
   */
  private energiaDaVoz(fala: Fala | null, voz: RelogioVoz | null, agora: number): number | null {
    const fracaoDaVoz = voz?.progresso() ?? null;
    if (!fala || fala.papel !== 'iara' || (fracaoDaVoz === null && fala.concluida)) return null;

    this.garantirTrilha(fala);
    const { visema } =
      fracaoDaVoz !== null
        ? visemaNoProgresso(this.trilha, fracaoDaVoz)
        : visemaAgora(this.trilha, fala.texto.length, agora - fala.iniciada_em);
    return ABERTURA_DO_VISEMA[visema];
  }

  atualizar(
    snapshot: SnapshotCognitivo,
    fala: Fala | null,
    voz: RelogioVoz | null,
    agora: number,
    dt: number,
  ): QuadroEntidade {
    const energia = this.energiaDaVoz(fala, voz, agora);
    const estado = estadoDaEntidade(snapshot, energia !== null);
    const alvo = ESTADOS[estado];

    // Suaviza o envelope: a boca salta de visema em visema, a luz não pode.
    // Sem fala, o envelope repousa no meio — é o que mantém a onda viva sem
    // afirmar energia de voz que não existe.
    const alvoEnv = energia ?? 0.35;
    this.envSuave += (alvoEnv - this.envSuave) * Math.min(1, 8 * dt);

    const k = 1 - Math.exp(-3.5 * Math.min(dt, 0.1));
    for (const chave of Object.keys(alvo) as Array<keyof EstadoEntidade>) {
      this.atual[chave] += (alvo[chave] - this.atual[chave]) * k;
    }

    return { ...this.atual, env: this.envSuave, estado };
  }
}
