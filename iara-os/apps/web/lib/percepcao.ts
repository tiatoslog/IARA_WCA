/**
 * Percepção de tela — o contrato do P0.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO está em
 * `docs/prd/percepcao-continua-de-tela.md`: **a visão diz ONDE, o POP diz O
 * QUÊ.** Nada aqui identifica tela, conclui etapa ou produz evidência. O P0
 * responde a uma pergunta só, e ela é modesta de propósito:
 *
 *     "mudou alguma coisa na janela autorizada?"
 *
 * O QUE ESTE ARQUIVO NÃO TEM, e a ausência é o desenho: nenhum campo carrega
 * imagem. `EventoVisual` tem hash e metadado, e o teste
 * `testes/percepcao-p0.test.ts` falha se alguém acrescentar um campo que
 * pareça pixel. O quadro nunca sai da máquina do operador porque ele nunca
 * chega inteiro nem ao processo do Braço: o que atravessa o cano do helper é
 * uma matriz 32×32 em tons de cinza — 1 KB do qual não se reconstrói tela
 * nenhuma.
 *
 * NENHUMA ESCALA DE CONFIANÇA. `OrigemDaObservacao` diz de que mecanismo veio a
 * observação; `Verdade.ts` continua sendo o único eixo de procedência. Um
 * `confianca: 0.94` aqui seria a segunda escala que o `CLAUDE.md` proíbe.
 */

// ---------------------------------------------------------------------------
// Geometria da amostra
// ---------------------------------------------------------------------------

/**
 * O lado da miniatura que o helper devolve. 32×32 = 1024 tons de cinza.
 *
 * ESCOLHIDO PARA SER PEQUENO DEMAIS PARA RECONSTRUIR A TELA e grande o bastante
 * para o gradiente estrutural sobreviver. É a garantia de privacidade mais forte
 * do P0, e ela é geométrica, não processual: não existe caminho de código que
 * mande a tela para a IARA porque a tela nunca existe do lado do Node.
 */
export const LADO_MINIATURA = 32;

/** Colunas do dHash. 9 colunas produzem 8 comparações por linha. */
export const COLUNAS_HASH = 9;
/** Linhas do dHash. 8 × 8 comparações = 64 bits = 16 dígitos hex. */
export const LINHAS_HASH = 8;

// ---------------------------------------------------------------------------
// Hash de quadro — identidade PERCEPTUAL, não criptográfica
// ---------------------------------------------------------------------------

/**
 * dHash de 64 bits a partir da matriz de cinza.
 *
 * A DIFERENÇA QUE PRECISA FICAR ESCRITA, porque o nome "hash" engana: isto NÃO
 * é sha256. Um hash criptográfico prova identidade de bytes e muda inteiro
 * quando um pixel muda — é exatamente o que não serve aqui, porque um cursor
 * piscando mudaria o hash tanto quanto trocar de tela. Este é um hash
 * PERCEPTUAL: ele codifica o gradiente horizontal da imagem reduzida, então
 * quadros visualmente parecidos produzem hashes PRÓXIMOS, e a distância entre
 * eles é que carrega a informação.
 *
 * Consequência prática, e é o ponto do P0 inteiro: comparar por igualdade
 * (`a !== b`) desperdiça o sinal. Compara-se por distância de Hamming.
 */
export function hashDoQuadro(cinza: readonly number[], lado = LADO_MINIATURA): string {
  const reduzido = reduzir(cinza, lado, COLUNAS_HASH, LINHAS_HASH);
  let bits = '';
  for (let y = 0; y < LINHAS_HASH; y += 1) {
    for (let x = 0; x < COLUNAS_HASH - 1; x += 1) {
      bits += reduzido[y * COLUNAS_HASH + x] > reduzido[y * COLUNAS_HASH + x + 1] ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Reamostragem por MÉDIA DE ÁREA, não por vizinho mais próximo.
 *
 * Vizinho mais próximo faz o hash depender de qual pixel caiu no ponto de
 * amostragem, e um deslocamento de um pixel na janela (que acontece o tempo
 * todo, porque a janela é redimensionada e reposicionada) viraria mudança. A
 * média de área é o que torna o hash estável sob ruído — e estabilidade sob
 * ruído é o requisito §6 escrito como aritmética.
 */
function reduzir(
  cinza: readonly number[],
  lado: number,
  colunas: number,
  linhas: number,
): number[] {
  const saida: number[] = [];
  for (let y = 0; y < linhas; y += 1) {
    const y0 = Math.floor((y * lado) / linhas);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * lado) / linhas));
    for (let x = 0; x < colunas; x += 1) {
      const x0 = Math.floor((x * lado) / colunas);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * lado) / colunas));
      let soma = 0;
      let n = 0;
      for (let j = y0; j < y1 && j < lado; j += 1) {
        for (let i = x0; i < x1 && i < lado; i += 1) {
          soma += cinza[j * lado + i] ?? 0;
          n += 1;
        }
      }
      saida.push(n > 0 ? soma / n : 0);
    }
  }
  return saida;
}

/** Bits diferentes entre dois hashes perceptuais. 0 = quadro visualmente igual. */
export function distanciaDeHamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * DISTÂNCIA MÍNIMA PARA UMA MUDANÇA DE CONTEÚDO SER RELEVANTE.
 *
 * MEDIDO, e a medição mudou o desenho. `scripts/diagnostico/calibrar-percepcao.ts`
 * rodou nesta máquina em 21/08/2026 (Windows 10, janela de 1382×744) e devolveu:
 *
 *   piso de ruído, mesma janela, 49 amostras   p50=0  p95=11  max=13
 *   sinal, janela trocada                      18
 *
 * O primeiro palpite escrito aqui era `6`, e a medição o desmentiu: **6 fica
 * DENTRO do ruído** de um navegador com conteúdo vivo, e a IARA falaria sozinha
 * a cada quadro. O valor é `16` porque precisa ficar acima do pior ruído
 * observado (13) e abaixo do sinal observado (18).
 *
 * A MARGEM É ESTREITA — 13 contra 18 — e é por isso que este limiar NÃO é o
 * único sinal: `mudouDeJanela` decide sem limiar nenhum quando o processo ou o
 * título mudam. Uma navegação real quase sempre mexe nos dois; depender só da
 * distância seria apostar tudo numa folga de cinco bits.
 *
 * O ruído foi medido no pior caso de propósito (navegador rolando). Numa tela de
 * ERP parada ele é praticamente zero — e um limiar calibrado no caso fácil é o
 * que produz alarme falso no dia real.
 */
export const DISTANCIA_MINIMA_RELEVANTE = 16;

/**
 * A JANELA MUDOU DE IDENTIDADE? Sinal ortogonal, sem limiar.
 *
 * Existe por causa da medição acima: distância de Hamming sozinha separa mal
 * conteúdo animado de navegação. Processo e título são METADADO — mudaram ou não
 * mudaram, sem zona cinzenta —, e uma navegação de verdade quase sempre mexe em
 * pelo menos um dos dois.
 *
 * Compara a ASSINATURA, nunca o título cru: quem chama já mascarou, e a
 * comparação de dois textos mascarados continua detectando a troca.
 */
export function mudouDeJanela(
  anterior: JanelaObservada | null,
  atual: JanelaObservada,
): boolean {
  if (!anterior) return false;
  return anterior.processo !== atual.processo || anterior.assinatura !== atual.assinatura;
}

/**
 * Intervalo entre capturas. 1 Hz.
 *
 * Não é frame a frame de propósito (§14 e §21 do pedido): a pergunta do P0 é
 * "mudou de tela?", e tela de sistema de gestão não muda dez vezes por segundo.
 * A 41 ms por captura medidos nesta máquina, 1 Hz custa ~4% de um núcleo.
 */
export const INTERVALO_CAPTURA_MS = 1_000;

/**
 * QUANTO TEMPO A TELA PRECISA FICAR PARADA para a mudança ser anunciada.
 *
 * É o debounce do §5, e ele existe por causa da transição: enquanto uma tela
 * carrega, os quadros intermediários são todos diferentes entre si. Anunciar
 * cada um produziria cinco eventos para uma navegação só — que é como um
 * operador aprende a ignorar aviso da IARA. O evento sai quando a tela NOVA se
 * estabiliza, e carrega o hash estável, não o do meio do caminho.
 */
export const ESTABILIDADE_MS = 1_500;

// ---------------------------------------------------------------------------
// Janela — escopo, e a máscara que o título exige
// ---------------------------------------------------------------------------

export interface JanelaObservada {
  /** Nome do processo: `chrome`, `notepad`. Baixo risco, alto valor de escopo. */
  readonly processo: string;
  /** O título JÁ MASCARADO. Nunca o título cru — ver `assinaturaDeTitulo`. */
  readonly assinatura: string;
  readonly largura: number;
  readonly altura: number;
}

/** Teto da assinatura de título. Título de janela não é documento. */
const MAX_ASSINATURA = 60;

/**
 * O TÍTULO DA JANELA É CONTEÚDO, e essa é a descoberta que a sonda de
 * 21/08/2026 entregou de graça.
 *
 * A primeira captura desta máquina devolveu o título
 * `"Hospedagem de sites a partir de R$ 5,99/mês - Google Chrome"` — ou seja, o
 * que a pessoa estava lendo. Num GW o título carrega número de CT-e, placa,
 * nome de motorista. Mandar título cru pela rede seria vazar exatamente o que o
 * desenho dos 32×32 cinza existe para não vazar, por um campo de texto que
 * ninguém olhou.
 *
 * A máscara roda NO BRAÇO, antes de o evento existir (§13 do pedido). É a mesma
 * política de `assinaturaDeLacuna` — dígitos e e-mails viram `n` — reescrita
 * aqui porque `lib/` não pode importar de `servidor/`. A duplicação é a de cinco
 * linhas; a alternativa era furar a fronteira.
 */
export function assinaturaDeTitulo(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\S+@\S+/g, 'n')
    .replace(/\d+([.,/:-]\d+)*/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ASSINATURA);
}

/**
 * O ESCOPO AUTORIZADO — o requisito bloqueante do §7.
 *
 * `processos` é a chave: o operador autoriza observar *o GW*, não *a tela*.
 * Casar por processo e não por título é deliberado — título muda a cada
 * navegação, processo não, e um escopo que se perde a cada clique viraria
 * "autorize de novo" até alguém desligar a checagem.
 */
export interface EscopoDePercepcao {
  /** Nomes de processo autorizados, minúsculos. Vazio = nada é autorizado. */
  readonly processos: readonly string[];
}

/**
 * A janela em foco está no escopo?
 *
 * FECHADO POR PADRÃO: escopo vazio recusa tudo. Um bug que zerasse a lista
 * produziria captura de tudo se o padrão fosse permitir — e o modo de falha
 * seguro aqui é a IARA cega, nunca a IARA olhando o que não devia.
 */
export function dentroDoEscopo(processo: string, escopo: EscopoDePercepcao): boolean {
  if (escopo.processos.length === 0) return false;
  return escopo.processos.includes(processo.toLowerCase());
}

// ---------------------------------------------------------------------------
// Evento — o que atravessa a rede, e só isso
// ---------------------------------------------------------------------------

/**
 * De que MECANISMO veio a observação. Não é confiança: é procedência de
 * instrumento, e ela é verificável olhando o código que a produziu.
 */
export type OrigemDaObservacao = 'hash_de_quadro' | 'metadado_de_janela' | 'ocr';

/**
 * Os cinco tipos do P0. Nem um a mais (§10 do pedido).
 *
 * `mudanca_visual` é o único que carrega hash. Os outros quatro são transições
 * do ciclo de vida da sessão, e existem porque o operador tem direito de saber
 * quando a observação começou, parou, e por quê.
 */
export type TipoEventoVisual =
  | 'sessao_iniciada'
  | 'mudanca_visual'
  /**
   * A tela mostra algo com FORMA de mensagem de sistema.
   *
   * `mensagem_detectada`, e nunca `erro_detectado`: a percepção observou uma
   * frase; afirmar que houve erro seria interpretar pixel. Quem decide se aquilo
   * é problema — e o que fazer — é o diagnóstico do treinamento, contra o POP.
   *
   * Nasceu COM consumidor, que é a regra do §18: `treinar_procedimento` em modo
   * diagnóstico usa o texto para procurar orientação no conhecimento autorizado.
   */
  | 'mensagem_detectada'
  | 'percepcao_suspensa'
  | 'percepcao_retomada'
  | 'sessao_encerrada';

export const TIPOS_EVENTO_VISUAL: readonly TipoEventoVisual[] = [
  'sessao_iniciada',
  'mudanca_visual',
  'mensagem_detectada',
  'percepcao_suspensa',
  'percepcao_retomada',
  'sessao_encerrada',
];

export interface EventoVisual {
  readonly tipo: TipoEventoVisual;
  readonly sessao_percepcao: string;
  readonly instante: string;
  /** `null` quando não havia janela em foco legível. */
  readonly janela: JanelaObservada | null;
  /** Hash perceptual. Só em `mudanca_visual`; `null` nos demais. */
  readonly hash: string | null;
  /** Distância do hash anterior. `null` no primeiro quadro da sessão. */
  readonly distancia: number | null;
  readonly origem: OrigemDaObservacao;
  /**
   * O TEXTO DA TELA, **já mascarado na origem**. Vazio quando não houve OCR.
   *
   * A máscara roda no Braço, antes de o evento existir — ver `lib/mascara.ts`.
   * O que atravessa a rede é `«cpf»`, nunca o CPF. E continua não havendo pixel
   * nenhum: o bitmap morre dentro do helper que o leu.
   *
   * Só `mudanca_visual` e `mensagem_detectada` carregam texto. Um evento de
   * ciclo de vida com o conteúdo da tela dentro é um pacote que não nasceu deste
   * laço, e a fronteira o recusa.
   */
  readonly texto: string;
  /** Por que suspendeu/encerrou. Vazio nos eventos que não explicam nada. */
  readonly motivo: string;
}

/**
 * De quanto em quanto tempo o texto da tela é lido.
 *
 * NÃO É A CADA QUADRO. O OCR custa 90–460 ms medidos nesta máquina, contra 41 ms
 * de uma captura — lê-lo a 1 Hz multiplicaria por dez o custo da percepção para
 * responder a uma pergunta que muda devagar. Cinco segundos é o intervalo em que
 * uma pessoa digita um campo inteiro.
 */
export const INTERVALO_OCR_MS = 5_000;

/**
 * Quantas linhas precisam mudar para o texto contar como mudança.
 *
 * MEDIDO em 21/08/2026 (`calibrar-percepcao.ts 25 --texto`), sobre uma janela
 * parada de verdade:
 *
 *   ruído do OCR, 25 amostras a 1 Hz   min=0  p50=0  p95=0  max=0
 *   custo por leitura                  118 ms média, 139 ms pico
 *
 * O OCR do Windows NÃO oscila sozinho numa tela estática — eu esperava ver a
 * troca de "l" por "I" aparecer no ruído e ela simplesmente não aconteceu.
 * Duas linhas fica com folga acima de zero.
 *
 * CONSEQUÊNCIA QUE PRECISA FICAR ESCRITA: como a contagem é simétrica, UMA linha
 * cujo conteúdo muda soma 2 (uma sai, uma entra) e portanto DISPARA. Isso é o
 * comportamento desejado, não um efeito colateral — um campo preenchido no GW
 * muda exatamente uma linha, e é o caso que a percepção precisava enxergar.
 * Uma linha que só APARECE (rodapé que o OCR pegou desta vez) soma 1 e não
 * dispara.
 *
 * É uma CONTAGEM, não uma escala de similaridade: "duas linhas mudaram" é
 * verificável olhando as duas listas, o que um cosseno não é.
 */
export const MIN_LINHAS_MUDADAS = 2;

/**
 * Hash estável de um texto. Serve só para comparar duas leituras.
 *
 * FNV-1a de 32 bits: barato, determinístico e sem dependência. Não é
 * criptográfico e não precisa ser — ninguém prova identidade com ele, só
 * responde "é o mesmo texto de antes?".
 */
export function hashDeTexto(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Quantas linhas existem numa leitura e não na outra, nos dois sentidos.
 *
 * Simétrico de propósito: uma mensagem que APARECE e uma que SOME são as duas
 * relevantes, e uma contagem só de um lado deixaria metade dos casos calada.
 */
export function linhasMudadas(anterior: string, atual: string): number {
  const a = new Set(anterior.split('\n').filter(Boolean));
  const b = new Set(atual.split('\n').filter(Boolean));
  let n = 0;
  for (const l of b) if (!a.has(l)) n += 1;
  for (const l of a) if (!b.has(l)) n += 1;
  return n;
}

// ---------------------------------------------------------------------------
// Estado visual — o que a IARA sabe, do lado do motor
// ---------------------------------------------------------------------------

/**
 * O MENOR CONTRATO POSSÍVEL para o P0 (§15 do pedido).
 *
 * NÃO TEM `tela_identificada`, e a ausência é o requisito: nada neste estágio
 * reconhece "tela de manifestação". Ele diz que houve mudança, quando, em que
 * processo — e para de falar. Um campo `tela` aqui, preenchido por dedução,
 * seria a primeira mentira desta camada.
 */
/**
 * O CICLO DE VIDA DE UMA SESSÃO DE PERCEPÇÃO — cinco estados, e a poda tem
 * o mesmo critério do resto do repositório: cada um tem um evento que o produz
 * e um que o encerra.
 *
 * `aguardando_consentimento` foi FUNDIDO em `solicitada`, e a fusão é a poda:
 * entre "a IARA pediu" e "o operador ainda não respondeu" não existe transição
 * nenhuma — é o mesmo instante visto de dois lados. Dois estados ali seriam um
 * com entrada e sem saída própria.
 *
 * O ESTADO IMPOSSÍVEL QUE ESTE TIPO IMPEDE: `encerrada` com captura em curso.
 * `podeCapturar` é a única porta, e ela só devolve `true` em `ativa`.
 */
export type EstadoDaSessaoDePercepcao =
  /** Nunca pedida, ou já esquecida. */
  | 'inativa'
  /** A IARA pediu; o operador ainda não autorizou. NADA é capturado aqui. */
  | 'solicitada'
  /** Autorizada e observando. */
  | 'ativa'
  /** Autorizada, mas a janela em foco saiu do escopo. */
  | 'suspensa'
  /** Terminou. Não volta — uma sessão nova nasce com outro identificador. */
  | 'encerrada';

/**
 * A ÚNICA PORTA que autoriza captura.
 *
 * Função e não campo booleano: um campo `capturando` ao lado do estado é como
 * os dois passam a discordar. Aqui a resposta é derivada, e `encerrada` +
 * capturando é uma combinação que não tem como existir.
 */
export function podeCapturar(estado: EstadoDaSessaoDePercepcao): boolean {
  return estado === 'ativa' || estado === 'suspensa';
}

/**
 * TETO DE VIDA DE UMA SESSÃO — obrigatório, e não configurável para cima.
 *
 * Cobre a falha que o §27 nomeia: o motor cai, ninguém manda encerrar, e o
 * Braço continua observando a tela de alguém indefinidamente. Trinta minutos é
 * o tempo de um treinamento longo; acima disso a pessoa pede de novo, o que é
 * barato, e o silêncio deixa de ser permissão.
 */
export const TETO_DA_SESSAO_MS = 30 * 60 * 1_000;

/** Quanto tempo um pedido não autorizado continua de pé. */
export const VALIDADE_DA_SOLICITACAO_MS = 5 * 60 * 1_000;

/**
 * O PEDIDO da IARA — o contrato do §3, reduzido ao que tem consumidor.
 *
 * `duracao` e `nivel de percepção` do rascunho ficaram de fora: o teto é
 * `TETO_DA_SESSAO_MS` para todo mundo (um teto negociável não é teto), e nível
 * de percepção só faria sentido com mais de um nível implementado. Campo sem
 * consumidor é campo que mente sobre o que o sistema faz.
 */
export interface SolicitacaoDePercepcao {
  readonly sessao_percepcao: string;
  readonly id_usuario: string;
  readonly escopo: EscopoDePercepcao;
  /** Por que a IARA quer observar. Vai para a auditoria e para a resposta. */
  readonly motivo: string;
  /** O POP em curso quando o pedido nasceu, se havia. */
  readonly procedimento: string | null;
  readonly solicitada_em: string;
}

export interface EstadoVisual {
  readonly sessao_percepcao: string;
  readonly id_dispositivo: string;
  readonly id_usuario: string;
  /**
   * O ESTADO, e não dois booleanos.
   *
   * A versão anterior tinha `ativa` e `suspensa` lado a lado, e as quatro
   * combinações incluíam duas que não existem no mundo — encerrada e suspensa,
   * inativa e suspensa. Um estado que o tipo permite representar é um estado que
   * alguém vai produzir por engano; `podeCapturar` é a única porta.
   */
  readonly estado: EstadoDaSessaoDePercepcao;
  readonly janela: JanelaObservada | null;
  readonly hash: string | null;
  readonly ultima_mudanca: string | null;
  readonly mudancas: number;
  readonly atualizado_em: string;
  readonly motivo: string;
  /** Escopo autorizado. Vazio antes da autorização. */
  readonly processos: readonly string[];
  /** Quando a IARA pediu. `null` numa sessão que nasceu sem pedido. */
  readonly solicitada_em: string | null;
  /** Quando o operador autorizou. `null` enquanto não autorizou. */
  readonly autorizada_em: string | null;
  /**
   * O TETO. Depois disto a sessão morre mesmo que ninguém mande encerrar — é a
   * trava do §27: motor caído não deixa o Braço observando para sempre.
   */
  readonly expira_em: string | null;
  /** O POP em curso quando a sessão nasceu, se havia. */
  readonly procedimento: string | null;
  /** O último texto observado, mascarado. Vazio quando não houve OCR. */
  readonly texto: string;
  /** As últimas linhas com forma de mensagem de sistema. Já mascaradas. */
  readonly mensagens: readonly string[];
}

/** O estado de uma sessão recém-PEDIDA. Nada é capturado neste ponto. */
export function estadoSolicitado(
  pedido: SolicitacaoDePercepcao,
  id_dispositivo: string,
): EstadoVisual {
  return {
    sessao_percepcao: pedido.sessao_percepcao,
    id_dispositivo,
    id_usuario: pedido.id_usuario,
    estado: 'solicitada',
    janela: null,
    hash: null,
    ultima_mudanca: null,
    mudancas: 0,
    atualizado_em: pedido.solicitada_em,
    motivo: pedido.motivo,
    processos: pedido.escopo.processos,
    solicitada_em: pedido.solicitada_em,
    autorizada_em: null,
    expira_em: null,
    procedimento: pedido.procedimento,
    texto: '',
    mensagens: [],
  };
}

/**
 * Aplica um evento ao estado. PURA — o estado é derivado, nunca escrito à mão.
 *
 * Função em vez de método porque é ela que o teste lê: um redutor puro se prova
 * contra uma sequência de eventos escrita à mão. Um método de classe com I/O ao
 * lado se prova contra a própria classe.
 *
 * SESSÃO ENCERRADA NÃO REVIVE. Um evento que chegue depois do encerramento — um
 * quadro em voo quando o operador apertou parar, um Braço que não leu a ordem —
 * NÃO reabre a observação. É a metade da trava do kill switch que mora do lado
 * do motor; a outra metade é o Braço parando o laço.
 */
export function aplicarEvento(
  anterior: EstadoVisual | null,
  evento: EventoVisual,
  identidade: { id_dispositivo: string; id_usuario: string },
): EstadoVisual {
  const base: EstadoVisual = anterior ?? {
    sessao_percepcao: evento.sessao_percepcao,
    id_dispositivo: identidade.id_dispositivo,
    id_usuario: identidade.id_usuario,
    estado: 'inativa',
    janela: null,
    hash: null,
    ultima_mudanca: null,
    mudancas: 0,
    atualizado_em: evento.instante,
    motivo: '',
    processos: [],
    solicitada_em: null,
    autorizada_em: null,
    expira_em: null,
    procedimento: null,
    texto: '',
    mensagens: [],
  };

  if (base.estado === 'encerrada') {
    return { ...base, atualizado_em: evento.instante };
  }

  const comum = {
    ...base,
    sessao_percepcao: evento.sessao_percepcao,
    id_dispositivo: identidade.id_dispositivo,
    id_usuario: identidade.id_usuario,
    atualizado_em: evento.instante,
    janela: evento.janela ?? base.janela,
    motivo: evento.motivo,
  };

  switch (evento.tipo) {
    case 'sessao_iniciada':
      return {
        ...comum,
        estado: 'ativa',
        mudancas: 0,
        hash: null,
        ultima_mudanca: null,
        autorizada_em: base.autorizada_em ?? evento.instante,
        expira_em: new Date(Date.parse(evento.instante) + TETO_DA_SESSAO_MS).toISOString(),
      };
    case 'mudanca_visual':
      return {
        ...comum,
        estado: 'ativa',
        hash: evento.hash,
        ultima_mudanca: evento.instante,
        mudancas: base.mudancas + 1,
        texto: evento.texto || base.texto,
      };
    case 'mensagem_detectada':
      /* NÃO conta como mudança. Uma mensagem que aparece já veio junto de uma
         mudança visual; contá-la de novo faria o número que o operador lê dizer
         o dobro do que aconteceu. */
      return {
        ...comum,
        estado: 'ativa',
        texto: evento.texto || base.texto,
        mensagens: evento.texto ? evento.texto.split('\n').filter(Boolean).slice(0, 3) : base.mensagens,
      };
    case 'percepcao_suspensa':
      /* A JANELA NÃO É ATUALIZADA numa suspensão por escopo: o motor não precisa
         saber para qual aplicação a pessoa foi. Saber que ela SAIU do escopo é o
         suficiente, e é o mínimo — registrar o destino transformaria o escopo
         numa lista do que mais a pessoa usa. */
      return { ...comum, janela: base.janela, estado: 'suspensa' };
    case 'percepcao_retomada':
      return { ...comum, estado: 'ativa' };
    case 'sessao_encerrada':
      return { ...comum, estado: 'encerrada' };
  }
}

/** A sessão passou do teto? Puro: o instante entra por parâmetro. */
export function sessaoExpirou(estado: EstadoVisual, agora: number): boolean {
  if (estado.estado === 'solicitada') {
    return (
      estado.solicitada_em !== null &&
      agora - Date.parse(estado.solicitada_em) > VALIDADE_DA_SOLICITACAO_MS
    );
  }
  if (!podeCapturar(estado.estado)) return false;
  return estado.expira_em !== null && agora > Date.parse(estado.expira_em);
}
