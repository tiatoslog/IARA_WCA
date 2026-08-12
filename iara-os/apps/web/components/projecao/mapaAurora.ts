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
import { ABERTURA_DO_VISEMA, trilhaDeVisemas, type Visema } from '../../lib/visemas';
import { visemaCorrente } from './articulacao';

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
  /**
   * Faixa que o estado ocupa no espectro da marca (m0..m1), na escala 0..1 de
   * `paletaMarca`: 0 aço · 0,30 azul · 0,58 violeta · 0,80 champanhe · 1 aço.
   *
   * ATÉ 11/08 ISTO ERA MATIZ HSV, e a diferença não é de unidade, é de
   * arquitetura. Como matiz, o estado tingia por fora um gradiente que já
   * varria o espectro inteiro sozinho — o sinal chegava à tela com ~6% de
   * força contra um fundo que mostrava todas as cores ao mesmo tempo, e
   * nenhum estado conseguia parecer diferente de outro. Como faixa da paleta,
   * o estado escolhe QUAL PEDAÇO do espectro a entidade mostra, e a cortina
   * inteira se move com ele.
   */
  m0: number;
  m1: number;
  /**
   * 1 no alerta, 0 no resto. Sinalizador explícito, não deduzido da faixa.
   *
   * O alerta era detectado por `m0 < 0,2` — o coral saía de "matiz baixo".
   * Isso amarrava um comportamento a um acidente de numeração: renumerar as
   * faixas (que é o que aconteceu) fazia estados normais dispararem coral.
   * Vive aqui, e não fora da interpolação, para atravessar o mesmo suavizador
   * de todos os outros campos — assim o coral entra e sai sem salto.
   */
  alerta: number;
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
 * O verde saiu do repertório inteiro em 11/08, junto com a PALETA GRAFITE: as
 * faixas antigas eram as cores da identidade "água" de 10/08, e com a peça
 * virando cromo sobre laca elas deixaram de ter origem no produto — cor sem
 * origem é exatamente o que se lê como arbitrária.
 *
 * AS FAIXAS SÃO POSIÇÕES NA PALETA DA MARCA, não matizes HSV — ver `m0`/`m1`
 * acima para a razão. A escala é a de `paletaMarca` no shader:
 *
 *     0 ── aço ──0,30── azul ──0,58── violeta ──0,80── champanhe ──1 ── aço
 *
 * A ordem dos estados sobe monotonicamente por esse eixo, e isso é decisão de
 * projeto, não arrumação. Duas razões:
 *
 *  1. SEMÂNTICA. O repouso fica no ponto mais neutro do espectro (aço) e cada
 *     estado se afasta dele na medida em que a entidade se afasta do repouso.
 *     Escuta esfria um passo, ação é azul pleno, raciocínio vira violeta,
 *     leitura chega ao champanhe. Quem olha não precisa decorar código de
 *     cores: percebe DISTÂNCIA do repouso, que é a informação que importa.
 *
 *  2. TRANSIÇÃO. O controlador interpola m0 e m1 como qualquer outro número.
 *     Com a ordem monotônica, trocar entre estados vizinhos percorre um trecho
 *     curto da paleta; sem ela, a mesma troca varreria o espectro inteiro e a
 *     tela daria um arco-íris a cada mudança. Nenhum valor passa de 1 nem cai
 *     abaixo de 0 pelo mesmo motivo: a paleta fecha o círculo, mas a
 *     interpolação não sabe disso e daria a volta longa.
 *
 * O ALERTA NÃO TEM FAIXA PRÓPRIA porque coral não é uma cor da paleta: é a
 * saída dela, e é justamente por não pertencer ao espectro do cromo que ele
 * funciona como alerta. Entra pelo campo `alerta`, por cima. A faixa dele fica
 * na do repouso só para a transição de volta não ter nada a atravessar.
 * Nunca vermelho saturado — invariante mantido.
 */
const ESTADOS = {
  /* repouso: aço com um sopro de azul. NÃO é aço puro, e a razão é de uso:
     este é o estado em que a IARA passa a maior parte do tempo, e no extremo
     zero da paleta a cena inteira chega acromática — a entidade some como
     presença e vira fumaça cinza. 0,04–0,18 mantém o repouso como o ponto
     MAIS neutro do repertório sem torná-lo ausência de cor. */
  disponivel:  { amp: 0.15, vel: 0.25, raio: 1.0,  brilho: 0.62, interno: 0.3,  m0: 0.04, m1: 0.18, alerta: 0 },
  /* escuta: esfria um passo, e recolhe */
  observando:  { amp: 0.1,  vel: 0.5,  raio: 0.85, brilho: 0.65, interno: 0.4,  m0: 0.20, m1: 0.32, alerta: 0 },
  /* ação para fora: azul pleno, aberta e brilhante */
  trabalhando: { amp: 0.30, vel: 0.95, raio: 1.18, brilho: 0.68, interno: 0.55, m0: 0.32, m1: 0.44, alerta: 0 },
  /* raciocínio: violeta, aurora apagada e encante no máximo */
  pensando:    { amp: 0.18, vel: 0.7,  raio: 0.95, brilho: 0.35, interno: 1.0,  m0: 0.48, m1: 0.60, alerta: 0 },
  /* leitura: champanhe — recolhida como quem escuta, quente como quem pensa */
  revisando:   { amp: 0.22, vel: 0.8,  raio: 0.88, brilho: 0.5,  interno: 0.72, m0: 0.64, m1: 0.78, alerta: 0 },
  /* fala: varre quase todo o espectro — é o estado que mais se move */
  respondendo: { amp: 0.9,  vel: 1.1,  raio: 1.1,  brilho: 1.0,  interno: 0.55, m0: 0.06, m1: 0.74, alerta: 0 },
  /* alerta: faixa do repouso; quem pinta é o coral, por cima */
  alerta:      { amp: 0.4,  vel: 0.55, raio: 1.02, brilho: 0.8,  interno: 0.65, m0: 0.04, m1: 0.18, alerta: 1 },
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
   * O mesmo fato que articula a boca do avatar: o visema corrente da fala,
   * decidido em `articulacao.ts` — um lugar só para as duas projeções. Aqui a
   * abertura do visema vira o envelope de energia das ondas.
   */
  private energiaDaVoz(fala: Fala | null, voz: RelogioVoz | null, agora: number): number | null {
    if (!fala || fala.papel !== 'iara') return null;
    this.garantirTrilha(fala);
    const visema = visemaCorrente(this.trilha, fala, voz, agora);
    return visema === null ? null : ABERTURA_DO_VISEMA[visema];
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
