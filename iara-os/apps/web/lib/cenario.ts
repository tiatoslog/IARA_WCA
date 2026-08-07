/**
 * O escritório. Coordenadas em PIXELS DE ARTE (não em pixels de tela) — o
 * componente aplica a escala inteira. Isso mantém o pixel art alinhado ao
 * grid em qualquer zoom.
 *
 * Trocar de pack de arte = trocar `arquivo` e as dimensões aqui. Nenhum
 * componente conhece nome de arquivo.
 */

import type { EstagioCognitivo, IdObjeto } from './estado';

export const PIXEL = 3; // escala de renderização
export const TILE = 16; // grid do pack — toda posição é múltipla disto
export const SALA_LARGURA = 320;
export const SALA_ALTURA = 208;
export const ALTURA_PAREDE = 64;

/**
 * Linha de contato da fileira do fundo — um tile INTEIRO abaixo da emenda
 * parede/piso.
 *
 * Móvel encostado na parede não toca o chão na emenda: ele fica À FRENTE da
 * parede, com o pé no piso. Alinhar a base exatamente em `ALTURA_PAREDE` é o
 * que faz um armário parecer pendurado — foi o defeito da primeira versão, em
 * que a arte da estante terminava 12px ACIMA da emenda e a sala inteira lia
 * como uma parede com quadros, não como um cômodo com móveis.
 *
 * O corpo do móvel atravessar a emenda é o efeito desejado, não um acidente:
 * é ele que produz a leitura de profundidade. O rack já fazia isso (base 108).
 */
export const LINHA_FUNDO = ALTURA_PAREDE + TILE; // 80

// ---------------------------------------------------------------------------
// Profundidade
// ---------------------------------------------------------------------------

/**
 * Ordem de desenho derivada da posição, nunca escrita à mão. Quem tem a linha
 * de contato com o piso mais baixa na tela está mais perto da câmera e cobre
 * quem está atrás.
 *
 * As três primeiras faixas são fixas porque não competem por profundidade:
 * piso e parede são superfícies, e mural é o que está *chapado* na parede
 * (janela, quadro) — nada nunca passa atrás disso.
 */
export const CAMADA_PISO = 0;
export const CAMADA_PAREDE = 1;
export const CAMADA_MURAL = 2;
/** Piso da faixa dinâmica. Base 64..208 vira z 74..218 — acima de todo mural. */
export const CAMADA_OBJETOS = 10;

export function profundidade(base: number): number {
  return CAMADA_OBJETOS + Math.round(base);
}

export interface Sprite {
  arquivo: string;
  largura: number;
  altura: number;
  x: number;
  y: number;
  /** Objetos com `luz` reagem ao estado. Os demais são cenário morto. */
  luz?: IdObjeto;
  /**
   * Distância do topo do sprite até a linha em que o objeto toca o piso.
   * As folhas 64x64 do pack têm padding transparente embaixo, então a base
   * real fica acima da borda. Sem isto, objetos de parede se comportam como
   * se estivessem no meio da sala.
   */
  ancora?: number;
}

export function baseDoSprite(s: Sprite): number {
  return s.y + (s.ancora ?? s.altura);
}

// ---------------------------------------------------------------------------
// Zoneamento
// ---------------------------------------------------------------------------
//
// Grid de 16px. Colunas 0..19, linhas 0..12. Parede = linhas 0..3, piso = 4..12.
//
// CARGA DE PERÍMETRO — a regra que manda aqui. Móvel de corpo fechado
// (armário, estante, impressora, rack) tem costas: precisa encostar numa
// parede, senão lê como caixote largado no meio da sala. A sala tem três
// paredes utilizáveis: a faixa de fundo (y<64) e as duas bordas laterais
// (x=0 e x=320). O centro do piso não é parede — é circulação.
//
//        0    32   64   96  128  160  192  224  256  288  320
//   0    +------+------+-----+----------+------+--------+---+
//        |metas |estant| pia | cafeteira| bebe | janela |rck|  parede de fundo
//  64    +------+------+-----+----------+------+--------+---+
//        |escriv|                                    |print|
//        |      |   est.1        est.2               |     |  piso
// 144    |      | [cadeiras encostadas nas mesas]    |banca|
// 160    |------+---- C O R R E D O R   L I V R E ---+-----|
// 208    |planta|                                    |plant|
//        +--------------------------------------------------+
//
// AS COORDENADAS SÃO DE CONTEÚDO, NÃO DE FOLHA. Toda folha do pack tem padding
// transparente, e ele não é simétrico nem previsível: `cabinet.png` é 64x64 com
// 25px de arte começando em x=18; `coffee-maker.png` é 64x64 com 62px de arte
// começando em x=1. Espaçar pela largura declarada da folha é o que produz
// sobreposição — dois sprites "encostados" pela folha têm arte separada por
// 30px, e dois "separados" pela folha se atropelam.
//
// Larguras de ARTE medidas do arquivo (alpha bounding box):
//   cabinet 25 · sink 34 · coffee-maker 62 · water-cooler 14
//   writing-table 38 · desk 38 · desk-with-pc 38 · PC1 25 · Chair 12
//   printer 61 · stamping-table 46 · Trash 9 · plant 11
//
// Parede de fundo, da esquerda para a direita, em coordenada de ARTE:
//   metas 6..46 · estante 54..79 · pia 87..120 · cafeteira 128..189
//   bebedouro 197..210 · janela 218..282 · rack 288..316
// Folga de 8 entre vizinhos, 6 antes do rack, 4 de margem nas pontas.
//
// Invariantes de layout:
//   - Nada de corpo fechado no piso aberto. Só cadeiras, plantas e o par
//     mesa/monitor vivem soltos, e cadeira sempre encostada na sua mesa.
//   - Fileira do fundo tem base em LINHA_FUNDO (80), não em ALTURA_PAREDE (64):
//     ela fica À FRENTE da parede, com o pé no piso. O corpo do móvel cruza a
//     emenda de propósito — é isso que dá profundidade em vez de leitura de
//     quadro pendurado.
//   - `ancora` é o padding transparente de BAIXO da folha, medido do arquivo.
//     Se ela mentir, a base mente, e a ordem de desenho mente junto.
//   - Estações compartilham base ~145: mesas paralelas e alinhadas.
//   - Cadeira = base da mesa + 6. Folga maior que isso lê como cadeira
//     abandonada longe da mesa, não como posto de trabalho.
//   - Monitor sobre mesa tem base na LINHA DA TAMPA, não no piso: assim a
//     frente da mesa desenha por cima do pé do monitor.
//   - Faixa y 160..208 vazia entre as bordas: é o corredor.
//
// `testes/cenario.test.ts` remede os PNGs e falha se qualquer par voltar a se
// sobrepor. Não confie no olho aqui — foi o olho que deixou passar da última vez.

/** Mobília e adereços. Nada aqui reage a dado — a luz é aplicada por cima. */
export const MOBILIA: Sprite[] = [
  // --- fileira do fundo, esquerda para a direita ---
  // O `x` compensa o padding lateral da folha: arte em 54 com padding 18 =>
  // sprite 36. A `ancora` é o padding VERTICAL de baixo, medido do arquivo, e
  // por isso a base de cada uma cai exatamente em LINHA_FUNDO.
  { arquivo: 'cabinet.png', largura: 64, altura: 64, x: 36, y: 32, luz: 'estante', ancora: 48 },
  { arquivo: 'sink.png', largura: 64, altura: 64, x: 72, y: 33, ancora: 47 },
  { arquivo: 'coffee-maker.png', largura: 64, altura: 64, x: 127, y: 30, luz: 'cafeteira', ancora: 50 },
  { arquivo: 'water-cooler.png', largura: 16, altura: 32, x: 197, y: 50, ancora: 30 },

  // --- borda esquerda: escrivaninha de costas para a parede lateral ---
  { arquivo: 'writing-table.png', largura: 64, altura: 64, x: 0, y: 96, luz: 'gaveteiro', ancora: 48 },

  // --- borda direita: coluna tech inteira sob o rack ---
  // y=110 e não 104: o rack termina em 108, e 104 punha a arte da impressora
  // por cima do pé dele.
  { arquivo: 'printer.png', largura: 64, altura: 32, x: 252, y: 110, ancora: 31 },
  { arquivo: 'stamping-table.png', largura: 64, altura: 32, x: 252, y: 148, ancora: 28 },
  // Encostada na parede direita, entre a impressora e a bancada. Em x=236 ela
  // ficava solta no meio do piso e ainda entrava no corredor.
  { arquivo: 'Trash.png', largura: 16, altura: 16, x: 302, y: 142, ancora: 12 },

  // --- operacional: ilha central, duas estações paralelas ---
  { arquivo: 'desk.png', largura: 64, altura: 32, x: 60, y: 112, ancora: 28 },
  // ÚNICA âncora que não é o fundo da arte: o monitor não toca o piso, toca a
  // TAMPA DA MESA. `22` põe a base dele em 118, acima da base da mesa (140), e
  // é isso que faz a frente da mesa desenhar por cima do pé do monitor.
  { arquivo: 'PC1.png', largura: 32, altura: 32, x: 76, y: 96, ancora: 22 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 84, y: 134, ancora: 15 },

  { arquivo: 'desk-with-pc.png', largura: 64, altura: 64, x: 140, y: 84, luz: 'terminal', ancora: 47 },
  { arquivo: 'Chair.png', largura: 16, altura: 16, x: 164, y: 132, ancora: 15 },

  // --- adereços: plantas nos dois cantos inferiores, fechando o corredor ---
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 0, y: 172, luz: 'planta', ancora: 31 },
  { arquivo: 'plant.png', largura: 32, altura: 32, x: 288, y: 176, ancora: 31 },
];

/**
 * A cena pronta para desenhar: ordenada por base crescente. O componente
 * itera nesta ordem e nunca decide profundidade.
 */
export const CENA: Sprite[] = [...MOBILIA].sort((a, b) => baseDoSprite(a) - baseDoSprite(b));

/** A planta que balança. Ambiente puro — precisa ser UMA, nunca duplicada. */
export const PLANTA_AMBIENTE = MOBILIA[MOBILIA.length - 1];

/** De onde sai o vapor. Derivado da cafeteira, não digitado à mão. */
const cafeteira = MOBILIA.find((s) => s.luz === 'cafeteira')!;
export const BICO_CAFETEIRA = {
  x: cafeteira.x + 26,
  y: cafeteira.y + 6,
  z: profundidade(baseDoSprite(cafeteira)) + 1,
};

// ---------------------------------------------------------------------------
// Avatar
// ---------------------------------------------------------------------------

export interface Animacao {
  arquivo: string;
  quadros: number;
  largura: number;
  altura: number;
  duracao_ms: number;
}

/**
 * Folhas de quadros do pack (medidas do arquivo, não chutadas):
 *   Julia-Idle.png ............ 128x32  -> 4 quadros de 32x32
 *   Julia.png ................. 128x32  -> 4 quadros de 32x32
 *   Julia_PC.png .............. 384x64  -> 6 quadros de 64x64
 *   Julia_Drinking_Coffee.png .  96x32  -> 3 quadros de 32x32
 */
export const ANIMACOES: Record<EstagioCognitivo, Animacao> = {
  ocioso: { arquivo: 'Julia-Idle.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 2400 },
  escutando: { arquivo: 'Julia.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 1400 },
  executando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 1000 },
  consultando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 1200 },
  // Piso de ~700ms mesmo no estágio mais pesado: frenético quebra a identidade.
  pensando: { arquivo: 'Julia_PC.png', quadros: 6, largura: 64, altura: 64, duracao_ms: 760 },
  falando: { arquivo: 'Julia.png', quadros: 4, largura: 32, altura: 32, duracao_ms: 1100 },
};

/**
 * Duas âncoras apenas. O avatar caminha entre elas, nunca teleporta.
 * `y` é a linha de contato com o piso — entra na mesma ordenação da mobília,
 * então a IARA passa atrás do que está à frente dela.
 */
export const POSTO_MESA = { x: 176, y: 144 };
export const POSTO_SALA = { x: 160, y: 192 };

export function postoDoEstagio(estagio: EstagioCognitivo): { x: number; y: number } {
  return estagio === 'ocioso' || estagio === 'escutando' ? POSTO_SALA : POSTO_MESA;
}

// ---------------------------------------------------------------------------
// Objetos desenhados à mão (o pack não traz parede, janela, rack nem quadro)
// ---------------------------------------------------------------------------

export interface Retangulo {
  id: IdObjeto;
  x: number;
  y: number;
  largura: number;
  altura: number;
}

/**
 * Chapados na parede: nada passa atrás, então vivem em `CAMADA_MURAL`.
 *
 * O quadro de metas é o primeiro pano da parede, à esquerda da estante. Ele
 * ficava em x=8 — debaixo do armário, invisível — porque o zoneamento foi
 * reescrito e a constante ficou para trás. `CAMADA_MURAL` é o que torna esse
 * tipo de erro silencioso: o mural nunca reclama de ser coberto.
 */
export const QUADRO_METAS: Retangulo = { id: 'quadro_metas', x: 6, y: 16, largura: 40, altura: 28 };
export const JANELA: Retangulo = { id: 'janela', x: 218, y: 12, largura: 64, altura: 40 };

/** O rack fica no piso: tem base e entra na ordenação por profundidade. */
export const RACK: Retangulo = { id: 'rack', x: 288, y: 12, largura: 28, altura: 96 };
export const BASE_RACK = RACK.y + RACK.altura;
