/**
 * Procedimento operacional — o contrato do IARA SOS.
 *
 * Atravessa a fronteira servidor↔cliente pela mesma razão que `snapshot.ts`: o
 * servidor produz, a projeção consome, e nenhum dos dois conhece o outro.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO está em `docs/prd/hierarquia-da-verdade-sos.md`:
 * a IARA pode ser inteligente na interpretação e é conservadora na verdade
 * operacional. Nada aqui carrega uma escala de confiança própria — a procedência
 * de um procedimento é `documento` no vocabulário de `Verdade.ts`, e o que este
 * arquivo acrescenta é AUTORIDADE (`EstadoConhecimento`), que é outro eixo.
 */

/* A forma da ilustração é do CONTRATO DE PROJEÇÃO, não deste domínio: quem
   desenha é a fala, e um dia a fonte pode não ser um POP. Este arquivo sabe
   PRODUZIR uma; não é dono do formato. */
import type { Ilustracao, TelaIlustrada } from './snapshot';

/**
 * Se esta fonte pode orientar alguém a operar.
 *
 * NUNCA É ESCRITO PELA IARA. Só por pessoa com papel `supervisor` ou
 * `administrador`. É esta trava — e não uma instrução no prompt — que impede
 * "sugestão da IA" de virar "procedimento oficial vigente" (❌ nº 9 e nº 10 da
 * carta).
 */
export type EstadoConhecimento =
  /** Pode orientar. É a única resposta legítima a "como faço isso?". */
  | 'oficial'
  /** Mudou e ninguém validou. Visível a quem revisa, sempre com aviso. */
  | 'em_revisao'
  /** Veio de alguém ou da IARA, sem validação. Nunca é procedimento. */
  | 'sugestao'
  /** Aposentado. Não orienta como vigente — mas continua existindo, porque
   *  apagar a versão antiga é apagar a chance de explicar por que mudou. */
  | 'desativado';

/** Só `oficial` orienta operação. As outras três explicam-se, não mandam. */
export function podeOrientar(estado: EstadoConhecimento): boolean {
  return estado === 'oficial';
}

/**
 * QUALIDADE DO DOCUMENTO — terceiro eixo, e ele não se confunde com os outros
 * dois.
 *
 *   `Procedencia`         de onde vem a afirmação   (`Verdade.ts`)
 *   `EstadoConhecimento`  quem autorizou            (este arquivo)
 *   `QualidadeDocumental` o documento se sustenta?  (este bloco)
 *
 * Um POP pode ser perfeitamente oficial e, ao mesmo tempo, discordar de si
 * mesmo. É o caso real do `IT-ADMLUFT-006`, que traz `REV.:01` e `REV.:02` no
 * MESMO arquivo. Resolver isso por probabilidade — "REV 02 parece mais recente"
 * — seria decidir, em silêncio, qual versão do procedimento a pessoa vai
 * executar. A contradição se PRESERVA e limita o que a IARA pode fazer com o
 * documento.
 */
export type QualidadeDocumental =
  /** Tem identidade, autoria e vigência coerentes. */
  | 'completo'
  /** Falta metadado (aprovador, vigência), mas o conteúdo é coerente. */
  | 'incompleto'
  /** O documento discorda de si mesmo. Não dá para saber qual versão vale. */
  | 'contraditorio'
  /** Reservado: documento sem autoridade declarada que o sustente. */
  | 'nao_autorizado';

/**
 * Consultar é diferente de guiar, e a qualidade separa os dois.
 *
 * CONSULTAR um POP contraditório ajuda — a pessoa lê o conteúdo e vê o aviso.
 * GUIAR por ele é outra coisa: conduzir etapa a etapa é afirmar "esta é a
 * sequência vigente", e num documento com duas revisões ninguém sabe qual
 * sequência é essa. Bloquear a consulta inteira tiraria de serviço um
 * procedimento cujo conteúdo está lá; bloquear só a condução é a medida do
 * problema real.
 */
export function podeGuiar(p: {
  estado: EstadoConhecimento;
  qualidade: QualidadeDocumental;
}): boolean {
  return podeOrientar(p.estado) && p.qualidade !== 'contraditorio' && p.qualidade !== 'nao_autorizado';
}

export const MOTIVO_DA_QUALIDADE: Record<QualidadeDocumental, string> = {
  completo: '',
  incompleto: 'o documento não declara aprovador ou vigência',
  contraditorio: 'o documento discorda de si mesmo sobre qual revisão vale',
  nao_autorizado: 'o documento não tem autoridade declarada',
};

export const AVISO_DO_ESTADO: Record<EstadoConhecimento, string> = {
  oficial: '',
  em_revisao: 'esta versão ainda não foi validada — não use para operar',
  sugestao: 'isto é sugestão, não procedimento oficial',
  desativado: 'esta versão foi aposentada e não vale mais',
};

/**
 * Uma captura de tela do sistema, recortada do slide.
 *
 * `caixa` é a posição no slide em pontos — guardada porque é o que permite
 * descobrir, por geometria, a qual captura uma seta aponta. Sem ela, ligar
 * passo e imagem viraria adivinhação.
 */
export interface Captura {
  /** Servida estaticamente pelo Next. Chave `(slide, rId)`, nunca o nome do
   *  arquivo interno: a mesma imagem se repete entre slides no mesmo POP. */
  readonly url: string;
  readonly largura: number;
  readonly altura: number;
  readonly caixa: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

/**
 * Um passo numerado, tal como a seta do POP o marca.
 *
 * As setas do PowerPoint são shapes VETORIAIS com texto e coordenada próprios —
 * não estão queimadas dentro do PNG. É isso que torna a âncora calculável em vez
 * de inferida, e é a razão de este projeto não precisar de visão computacional
 * para a estrutura.
 */
export interface PassoDoPop {
  /** O número dentro da seta, quando é número. `null` quando é frase. */
  readonly ordem: number | null;
  /** O texto da seta: `'3'` ou `'Clicar sim 2x'`. */
  readonly rotulo: string;
  /**
   * Onde a ponta da seta aponta, normalizado 0.0–1.0 DENTRO da captura.
   *
   * `null` quando a ponta não cai dentro de captura nenhuma — e aí fica `null`
   * mesmo. Escolher "a captura mais próxima" seria produzir uma marcação que
   * parece precisa e aponta para o lugar errado, que é pior que não marcar.
   */
  readonly ancora: {
    readonly captura: string;
    readonly x: number;
    readonly y: number;
  } | null;
}

export interface SlideDoPop {
  /** 1-based, como o rodapé do POP mostra (`Página: 8/9`). */
  readonly indice: number;
  /** O texto do slide, VERBATIM. Nunca reescrito, nunca resumido. */
  readonly texto: string;
  readonly passos: readonly PassoDoPop[];
  readonly capturas: readonly Captura[];
}

/** O número no canto do slide agrupa slides consecutivos no mesmo macro-passo. */
export interface Etapa {
  readonly numero: number;
  readonly titulo: string;
  readonly slides: readonly SlideDoPop[];
}

export interface Procedimento {
  readonly codigo: string;
  readonly titulo: string;
  /**
   * O sistema a que este procedimento pertence.
   *
   * FILTRO DURO, aplicado ANTES da similaridade — nunca um desempate depois.
   * Busca lexical não distingue sistema: "encerrar" casa com o encerramento do
   * GW e casaria com o de qualquer outro sistema pelo mesmo trigrama. Enquanto
   * todos os POPs forem GW o defeito é invisível; ele apareceria em produção, no
   * dia do segundo sistema, mandando alguém fazer no GW o que o POP do outro
   * sistema dizia (❌ nº 5).
   */
  readonly sistema: string;
  /** Como está escrito no arquivo, inconsistência inclusa. Nunca normalizado. */
  readonly revisao: string;
  readonly estado: EstadoConhecimento;
  /** O documento se sustenta? Calculado na ingestão, nunca digitado. */
  readonly qualidade: QualidadeDocumental;

  readonly arquivo_origem: string;
  /** sha256 do `.pptx`. Identidade da VERSÃO — é o que detecta POP revisado. */
  readonly hash_origem: string;
  readonly ingerido_em: string;

  readonly objetivo: string | null;
  readonly etapas: readonly Etapa[];
  /**
   * Exceções e casos particulares que o POP declara ("Sorriso não tem
   * agendamento", "Cargas da Adicer: agenda antes de solicitar a OCI").
   * Separadas dos passos de propósito: são o que faz o procedimento NÃO se
   * aplicar, e enterrá-las no meio dos passos é como elas passam despercebidas.
   */
  readonly particularidades: readonly string[];

  /**
   * Quem aprovou, e desde quando vale. `null` = **não informado no documento**.
   *
   * Nos 11 POPs de 18/08/2026 os dois são `null` em 100% dos arquivos: os campos
   * `Data`, `Elaborado por`, `Analisado por` e `Aprovado por` estão em branco no
   * template. `null` aqui é informação, não falta dela — a IARA cita "aprovador
   * não informado no documento", porque inventar "Operações" seria fabricar um
   * aval, e um aval falso é o que faz alguém confiar sem conferir.
   */
  readonly aprovado_por: string | null;
  readonly vigente_desde: string | null;

  /** O que este documento NÃO diz. Mesmo papel de `Diagnostico.lacunas`. */
  readonly lacunas: readonly string[];
}

// ---------------------------------------------------------------------------
// Execução: estado, evidência e desvio
// ---------------------------------------------------------------------------

/**
 * O ESTADO DE UMA EXECUÇÃO EM CURSO.
 *
 * Três estados, e não os dez que um diagrama de máquina de estados costuma ter.
 * Cada um destes tem um EVENTO que o produz e um que o encerra; um estado que
 * nada distingue do vizinho é complexidade ornamental, e um diagrama bonito com
 * transições que ninguém dispara é pior que nenhum diagrama — ele dá a impressão
 * de rigor sem o rigor.
 *
 *   aguardando_evidencia  a parada foi apresentada; a IARA espera o operador
 *   bloqueada             o guardião impediu; não sai daqui sem gente
 *   concluida             chegou ao fim da sequência
 *
 * `verificando` NÃO existe de propósito: a IARA não enxerga a tela do GW, então
 * não há intervalo entre "recebi a declaração" e "conferi" — não há conferência.
 * Criar o estado sugeriria que existe.
 */
export type EstadoDaExecucao = 'aguardando_evidencia' | 'bloqueada' | 'concluida';

/**
 * O QUE SUSTENTA "esta etapa foi feita".
 *
 * A pergunta honesta não é "como impedir que alguém minta", porque não há como:
 * a IARA não instrumenta o GW. É "o sistema sabe DIZER o que sustenta cada
 * passo que ele deu por concluído?". Antes desta camada não sabia — o
 * verificador conferia se o ponteiro tinha movido, que é conferir o relato
 * contra o próprio relato.
 */
export type TipoDeEvidencia =
  /** Nada. O passo avançou sem ninguém afirmar nada. */
  | 'nenhuma'
  /** O operador disse que fez. É relato, não verdade. */
  | 'declarada'
  /** O operador informou um dado que a etapa pedia. Relato com conteúdo. */
  | 'informada'
  /** O operador anexou uma captura da própria tela. */
  | 'anexada';

/**
 * A procedência de cada tipo de evidência, no vocabulário de `Verdade.ts`.
 *
 * NENHUMA delas é `fato_verificado`, e isso é a afirmação central desta camada:
 * **nenhum passo deste sistema é verificado contra o mundo.** `declarada` e
 * `informada` são `resultado_ferramenta` — "o executor disse que deu certo,
 * ainda NÃO é verdade" —, e aqui o executor é a pessoa. Marcar qualquer uma
 * como fato seria a mentira que `Verdade.ts` existe para impedir.
 */
export const PROCEDENCIA_DA_EVIDENCIA: Record<TipoDeEvidencia, string> = {
  nenhuma: 'desconhecido',
  declarada: 'resultado_ferramenta',
  informada: 'resultado_ferramenta',
  anexada: 'documento',
};

/** Como a resposta marca o que sustenta o passo. Vazio nunca — sempre há ressalva. */
export const RESSALVA_DA_EVIDENCIA: Record<TipoDeEvidencia, string> = {
  nenhuma: 'avancei sem nenhuma confirmação sua',
  declarada: 'você declarou que fez — eu não tenho como conferir na tela do GW',
  informada: 'você informou o dado — eu não confiro se ele foi aceito pelo GW',
  /* A frase mudou em 20/08/2026, quando `anexada` deixou de ser inalcançável.
     "sem conferência automática" descrevia um mundo em que o print chegava e
     ninguém olhava; hoje ele SÓ conta como evidência depois de a conferência
     dizer que bate com esta parada. Continua não sendo prova de que o GW
     aceitou coisa alguma — por isso a segunda metade da frase fica. */
  anexada: 'com a captura que você anexou, conferida contra esta etapa — não contra o GW',
};

/**
 * ONDE A PESSOA ESTÁ em relação à parada esperada, lido de um print que ELA
 * anexou.
 *
 * NÃO É UMA ESCALA DE CONFIANÇA — o `CLAUDE.md` proíbe uma segunda escala ao
 * lado de `Verdade.ts`, e um `certeza: 0..1` aqui seria exatamente ela. É uma
 * observação categórica, com procedência `inferencia` como tudo que sai de
 * leitura de imagem.
 *
 * Mora neste arquivo, e não em `AnaliseVisual.ts`, por uma razão de fronteira:
 * `ProcedimentosEmCurso` guarda a conferência, e `ProcedimentosEmCurso` é
 * ESTADO INTERNO — não pode alcançar, nem por tipo, um módulo que fala com a
 * rede. O vocabulário é do domínio; o provedor é que é de lá.
 *
 * `indefinido` é o valor que mais importa: cobre "olhei e não sei dizer", que é
 * diferente de "não é a tela". Colapsar os dois faria a IARA afirmar que alguém
 * está no lugar errado toda vez que ela não conseguiu ler a imagem.
 */
export type SituacaoNaParada = 'na_etapa' | 'outra_tela' | 'indefinido';

/**
 * A CONFERÊNCIA DE UMA PARADA — guardada para o turno seguinte poder usá-la.
 *
 * Existe porque conferir e avançar são turnos diferentes: a pessoa manda o
 * print ("estou aqui?"), a IARA responde, e só depois ela diz "próximo". Sem
 * este registro, a evidência que sustentaria o avanço morria no turno em que
 * foi produzida — que é como `TipoDeEvidencia.anexada` ficou declarado e
 * inalcançável entre 19 e 20/08/2026.
 *
 * AMARRADA À PARADA E À VERSÃO, e é isso que a impede de virar um salvo-conduto:
 * uma conferência da parada 3 não sustenta o avanço da parada 4, e uma
 * conferência de antes de o POP ser revisado não sustenta nada. Quem lê compara
 * os quatro campos; divergiu, descarta.
 */
export interface ConferenciaDaParada {
  readonly situacao: SituacaoNaParada;
  readonly codigo: string;
  readonly etapa: number;
  readonly slide: number;
  readonly hash_origem: string;
  /** A URL do print conferido. Para a auditoria poder reabrir a imagem. */
  readonly anexo: string;
  readonly instante: string;
}

/**
 * Esta conferência ainda vale para esta parada?
 *
 * Sem relógio: uma conferência não envelhece pelo tempo, envelhece por MUDANÇA.
 * Um piso de minutos aqui seria um segundo relógio sem princípio nenhum atrás —
 * a parada é a mesma às 10h e às 14h, e o print continua mostrando a mesma tela.
 */
export function conferenciaVale(
  c: ConferenciaDaParada | null | undefined,
  parada: { codigo: string; etapa: number; slide: number; hash_origem: string },
): boolean {
  return (
    !!c &&
    c.codigo === parada.codigo &&
    c.etapa === parada.etapa &&
    c.slide === parada.slide &&
    c.hash_origem === parada.hash_origem
  );
}

/** O que saiu do trilho. Classificado, nunca virando conhecimento novo. */
export type TipoDeDesvio =
  | 'sem_evidencia'
  /**
   * A pessoa pediu para avançar e o print que ela mandou mostra OUTRA tela.
   *
   * Não é o mesmo que `sem_evidencia`: ali ninguém afirmou nada, aqui a
   * evidência existe e aponta contra. É o único desvio em que a IARA sabe algo
   * que contradiz o operador — e ele nasce classificado, em vez de virar uma
   * dúvida solta no meio da resposta.
   */
  | 'evidencia_contraditoria'
  | 'versao_divergente'
  | 'posicao_perdida'
  | 'documento_contraditorio';

export interface Desvio {
  readonly tipo: TipoDeDesvio;
  readonly detalhe: string;
  readonly instante: string;
}

/**
 * Uma parada do procedimento, já com "quantos faltam".
 *
 * O `indice`/`total` é o "etapa 3 de 8" que a pessoa lê. Ele conta SLIDES, não
 * etapas, porque é a unidade que tem tela e passo — dizer "etapa 2 de 3" para um
 * procedimento cuja etapa 2 tem cinco telas esconde justamente o tamanho do que
 * falta.
 */
export interface Posicao {
  readonly etapa: Etapa;
  readonly slide: SlideDoPop;
  readonly indice: number;
  readonly total: number;
}

/** Todas as paradas, na ordem em que se percorre o procedimento. */
export function posicoes(p: Procedimento): readonly Posicao[] {
  const plano: { etapa: Etapa; slide: SlideDoPop }[] = [];
  for (const etapa of p.etapas) for (const slide of etapa.slides) plano.push({ etapa, slide });
  return plano.map((x, i) => ({ ...x, indice: i + 1, total: plano.length }));
}

/**
 * A parada correspondente a uma posição salva, ou `null`.
 *
 * `null` é o caso que importa: o POP foi revisado e a etapa em que a pessoa
 * estava não existe mais. Quem chamar precisa DIZER isso — continuar contando
 * "etapa 4 de 8" sobre um documento que mudou é a mentira mais fácil de cometer
 * aqui, porque nada quebra.
 */
export function acharPosicao(
  p: Procedimento,
  etapa: number,
  slide: number,
): Posicao | null {
  return posicoes(p).find((x) => x.etapa.numero === etapa && x.slide.indice === slide) ?? null;
}

/**
 * A citação de procedência de uma orientação — o item 2 da carta ("preservar a
 * fonte") reduzido a uma linha.
 *
 * Função PURA e compartilhada de propósito: servidor e testes precisam produzir
 * exatamente a mesma string, senão o teste prova outra coisa que não o que a
 * operadora lê na tela.
 */
export function citar(p: Procedimento, etapa: Etapa, slide: SlideDoPop): string {
  const partes = [
    p.codigo,
    `etapa ${etapa.numero}`,
    `slide ${slide.indice}`,
    p.revisao,
    p.aprovado_por ?? 'aprovador não informado no documento',
  ];
  return partes.join(' · ');
}

/**
 * A parada virada ILUSTRAÇÃO — as capturas do slide com as setas do POP por
 * cima, prontas para a projeção desenhar.
 *
 * Função PURA, e no `lib/` pela mesma razão de `citar`: o que a operadora vê
 * marcado na tela e o que o teste afirma sobre a marcação precisam sair da mesma
 * conta. A alternativa — o servidor montar o objeto à mão em cada habilidade —
 * é como três lugares passam a marcar o mesmo slide de três jeitos.
 *
 * NADA AQUI INVENTA POSIÇÃO. Ponto sem âncora não vira ponto "perto dali": vai
 * para `nao_marcados` e é DITO. Marcar por aproximação produziria um círculo com
 * aparência de precisão sobre o campo errado, que é pior que não marcar — o
 * mesmo raciocínio que já governa `PassoDoPop.ancora`.
 */
export function ilustrarParada(p: Procedimento, pos: Posicao): Ilustracao | null {
  const { slide } = pos;
  if (slide.capturas.length === 0) return null;

  const daCaptura = new Set(slide.capturas.map((c) => c.url));

  const telas: TelaIlustrada[] = slide.capturas.map((c) => ({
    url: c.url,
    largura: c.largura,
    altura: c.altura,
    pontos: slide.passos
      .filter((q) => q.ancora !== null && q.ancora.captura === c.url)
      .map((q) => ({ rotulo: q.rotulo, x: q.ancora!.x, y: q.ancora!.y })),
  }));

  /* `!daCaptura.has(...)` além do `ancora === null`: uma âncora que aponta para
     captura de OUTRO slide não seria desenhada por tela nenhuma e sumiria da
     conta em silêncio. Não acontece nos POPs de hoje — e é exatamente o tipo de
     coisa que passa a acontecer sem ninguém notar. */
  const nao_marcados = slide.passos
    .filter((q) => q.ancora === null || !daCaptura.has(q.ancora.captura))
    .map((q) => q.rotulo);

  return { telas, fonte: citar(p, pos.etapa, slide), nao_marcados };
}

/**
 * O QUE SE ESPERA VER NESTA PARADA — a mesma parada, dita para a camada de
 * visão em vez de para o olho.
 *
 * Existe separada de `ilustrarParada` porque as duas respondem perguntas
 * diferentes: aquela produz o que a pessoa VÊ, esta produz contra o que a tela
 * dela vai ser CONFERIDA. Nunca carrega a captura do POP: a comparação é entre
 * o texto do procedimento e o screenshot do operador — uma segunda imagem na
 * mesma chamada mudaria os três provedores da cadeia de visão de uma vez.
 *
 * `instrucao` é o texto VERBATIM do slide. É o que impede a conferência de
 * virar um resumo do procedimento produzido no caminho.
 */
export interface ParadaEsperada {
  readonly titulo: string;
  readonly etapa: string;
  /** "3 de 8" — a mesma contagem que a operadora lê. */
  readonly posicao: string;
  readonly instrucao: string;
  /** Os rótulos das setas desta parada: `['1', '2', 'Clicar sim 2x']`. */
  readonly marcas: readonly string[];
}

export function descreverParada(p: Procedimento, pos: Posicao): ParadaEsperada {
  return {
    titulo: p.titulo,
    etapa: pos.etapa.titulo,
    posicao: `${pos.indice} de ${pos.total}`,
    instrucao: pos.slide.texto,
    marcas: pos.slide.passos.map((q) => q.rotulo),
  };
}
