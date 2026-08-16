/**
 * Quando — a tradução de "me lembre amanhã às 9" para um instante.
 *
 * Módulo PURO: não abre disco, não fala com a rede, não conhece o operador.
 * Recebe texto e o `agora`, devolve uma data ou `null`. É por isso que ele não
 * aparece em `Fronteira.ts` — não há o que declarar em quem só calcula.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO:
 *
 *   quando não dá para saber a hora, o resultado é `null` — nunca um palpite.
 *
 * Um lembrete com hora inventada é pior que nenhum lembrete. Quem não recebeu
 * nada sabe que não recebeu; quem recebeu às 14h o que pediu para as 8h perdeu
 * a reunião E confia no sistema. Todo caminho ambíguo aqui termina em `null`, e
 * a habilidade transforma isso numa pergunta ao operador.
 *
 * O `rotulo` existe pela mesma razão. A IARA sempre repete o que entendeu —
 * "amanhã às 09:00" — porque o único jeito de o operador corrigir uma leitura
 * errada é ouvi-la antes da hora.
 *
 * DIAS DA SEMANA são interpretados desde 15/08/2026, com regra explícita —
 * ver `diaDaSemana`. Antes disso eles caíam no chão em silêncio, e o resultado
 * não era a pergunta que se pretendia: era um lembrete marcado para o dia
 * errado, porque o "às 8h" da mesma frase continuava sendo lido.
 */

/** Sem acento, minúsculo, espaços colapsados. */
function normalizar(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export interface Instante {
  readonly quando: Date;
  /**
   * Como a IARA vai DIZER o que entendeu — "hoje às 15:30", "em 20 minutos".
   * Sai na resposta ao operador para que uma leitura errada seja corrigível
   * antes de virar um lembrete que dispara na hora errada.
   */
  readonly rotulo: string;
}

const UNIDADES: Record<string, number> = {
  min: 60_000,
  mins: 60_000,
  minuto: 60_000,
  minutos: 60_000,
  h: 3_600_000,
  hora: 3_600_000,
  horas: 3_600_000,
  dia: 86_400_000,
  dias: 86_400_000,
};

/** "meia hora", "uma hora", "um dia" — quantidade escrita por extenso. */
const POR_EXTENSO: Record<string, number> = {
  meia: 0.5,
  meio: 0.5,
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  quatro: 4,
  cinco: 5,
  seis: 6,
  dez: 10,
  quinze: 15,
  vinte: 20,
  trinta: 30,
};

/** Hora padrão de cada período do dia, quando o operador não disse o relógio. */
const PERIODOS: Record<string, { hora: number; nome: string }> = {
  manha: { hora: 9, nome: 'de manhã' },
  tarde: { hora: 14, nome: 'à tarde' },
  noite: { hora: 20, nome: 'à noite' },
};

function doisDigitos(n: number): string {
  return String(n).padStart(2, '0');
}

function relogio(d: Date): string {
  return `${doisDigitos(d.getHours())}:${doisDigitos(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// 1. Duração relativa — "em 20 minutos", "daqui a meia hora"
// ---------------------------------------------------------------------------

const RELATIVO = /\b(?:em|daqui a|daqui|dentro de)\s+([a-z]+|\d{1,4})\s*(min|mins|minutos?|h|horas?|dias?)\b/;

function comoDuracao(t: string, agora: Date): Instante | null {
  const m = t.match(RELATIVO);
  if (!m) return null;

  const bruto = m[1];
  const quantidade = /^\d+$/.test(bruto) ? Number(bruto) : POR_EXTENSO[bruto];
  if (quantidade === undefined || quantidade <= 0) return null;

  const passo = UNIDADES[m[2]];
  if (!passo) return null;

  /**
   * Teto de 365 dias. Não é medo de número grande: é que "em 5000 dias" quase
   * sempre é erro de transcrição da fala, e um lembrete para 2040 sentado no
   * shard do operador é lixo que ninguém vai lembrar de limpar.
   */
  const deslocamento = quantidade * passo;
  if (deslocamento > 365 * 86_400_000) return null;

  const unidade = m[2].startsWith('min')
    ? 'minuto'
    : m[2].startsWith('h')
      ? 'hora'
      : 'dia';
  const plural = quantidade === 1 ? unidade : `${unidade}s`;
  const escrita = quantidade === 0.5 ? `meia ${unidade}` : `${quantidade} ${plural}`;

  return {
    quando: new Date(agora.getTime() + deslocamento),
    rotulo: `em ${escrita}`,
  };
}

// ---------------------------------------------------------------------------
// 2. Relógio — "às 15h", "as 9:30", "ao meio-dia"
// ---------------------------------------------------------------------------

const HORA_EXPLICITA = /\b(?:as|a|ate as)\s*(\d{1,2})(?:\s*[:h]\s*(\d{2}))?\b(?!\s*(?:min|minutos?|dias?))|\b(\d{1,2})\s*h(?:\s*(\d{2}))?\b/;

interface Relogio {
  readonly hora: number;
  readonly minuto: number;
}

function comoRelogio(t: string): Relogio | null {
  if (/\bmeio[- ]dia\b/.test(t)) return { hora: 12, minuto: 0 };
  if (/\bmeia[- ]noite\b/.test(t)) return { hora: 0, minuto: 0 };

  const m = t.match(HORA_EXPLICITA);
  if (!m) return null;

  const hora = Number(m[1] ?? m[3]);
  const minuto = Number(m[2] ?? m[4] ?? 0);
  if (!Number.isFinite(hora) || hora > 23 || minuto > 59) return null;

  /**
   * "às 8" com "da noite" na frase é 20h, não 8h. Sem esta correção o lembrete
   * das oito da noite dispara às oito da manhã do dia seguinte — pontualmente
   * errado, que é o modo de falha que este módulo inteiro tenta evitar.
   */
  if (hora < 12 && /\b(da|de|a) (noite|tarde)\b/.test(t)) {
    return { hora: hora === 12 ? 12 : hora + 12, minuto };
  }
  return { hora, minuto };
}

// ---------------------------------------------------------------------------
// 3. Dia — "hoje", "amanhã", "depois de amanhã"
// ---------------------------------------------------------------------------

/**
 * Os dias da semana, na ordem de `Date.getDay()` (0 = domingo).
 *
 * O nome com hífen é o que a IARA DIZ de volta; as grafias aceitas incluem a
 * forma curta ("segunda") e a com sufixo ("segunda-feira", "segunda feira").
 * "terça" aparece sem acento porque o texto chega normalizado.
 */
const DIAS_DA_SEMANA: ReadonlyArray<{ nome: string; padrao: RegExp }> = [
  { nome: 'domingo', padrao: /\bdomingo\b/ },
  { nome: 'segunda-feira', padrao: /\bsegunda(-| )?(feira)?\b/ },
  { nome: 'terça-feira', padrao: /\bterca(-| )?(feira)?\b/ },
  { nome: 'quarta-feira', padrao: /\bquarta(-| )?(feira)?\b/ },
  { nome: 'quinta-feira', padrao: /\bquinta(-| )?(feira)?\b/ },
  { nome: 'sexta-feira', padrao: /\bsexta(-| )?(feira)?\b/ },
  { nome: 'sabado', padrao: /\bsabado\b/ },
];

/**
 * DIA DA SEMANA — "na segunda às 8h", "sexta que vem às 14h".
 *
 * ESTE BLOCO FECHA UM DEFEITO REAL (15/08/2026), e a história importa porque o
 * comportamento anterior era o oposto do que o cabeçalho deste arquivo promete.
 * Dias da semana não eram interpretados — a intenção era cair em `null` e
 * deixar a IARA perguntar. Só que a frase "segunda-feira às 8h" tem um relógio
 * DENTRO dela: o "às 8h" era lido, o "segunda-feira" caía no chão em silêncio,
 * e o lembrete era marcado para amanhã. Num sábado, "sexta que vem às 14h"
 * virava "amanhã às 14:00". Não era ausência de resposta: era hora inventada
 * com cara de precisão — exatamente o que o parágrafo de abertura proíbe.
 *
 * A ambiguidade que motivou a omissão é real e tem UMA regra explícita aqui:
 * o alvo é a PRÓXIMA ocorrência daquele dia, estritamente no futuro. Se hoje é
 * segunda e alguém diz "segunda", são sete dias — quem quis dizer hoje diria
 * "hoje".
 *
 * "QUE VEM" NÃO SOMA UMA SEMANA, e isso foi medido antes de virar código:
 * numa sexta-feira, "sexta que vem" com +7 daria QUATORZE dias, que ninguém
 * quer dizer; num sábado, "sexta que vem" daria 28/08 quando o natural é a
 * sexta seguinte, 21/08. Em português falado a expressão quase sempre é só
 * ênfase na próxima ocorrência — e é ela que a regra devolve.
 *
 * O rótulo devolve o dia E a data ("segunda-feira, 17/08"), porque é a única
 * chance de o operador discordar antes da hora — e a data é o que desfaz
 * qualquer dúvida sobre qual segunda.
 */
function diaDaSemana(t: string, agora: Date): { dias: number; nome: string } | null {
  const alvo = DIAS_DA_SEMANA.findIndex((d) => d.padrao.test(t));
  if (alvo < 0) return null;

  let dias = (alvo - agora.getDay() + 7) % 7;
  /* Mesmo dia da semana = a próxima, não hoje. */
  if (dias === 0) dias = 7;

  const data = new Date(agora);
  data.setDate(data.getDate() + dias);
  const dd = String(data.getDate()).padStart(2, '0');
  const mm = String(data.getMonth() + 1).padStart(2, '0');

  return { dias, nome: `${DIAS_DA_SEMANA[alvo].nome}, ${dd}/${mm},` };
}

function deslocamentoDeDia(t: string, agora: Date): { dias: number; nome: string } | null {
  if (/\bdepois de amanha\b/.test(t)) return { dias: 2, nome: 'depois de amanhã' };
  if (/\bamanha\b/.test(t)) return { dias: 1, nome: 'amanhã' };
  if (/\bhoje\b|\bainda hoje\b/.test(t)) return { dias: 0, nome: 'hoje' };
  /* Depois dos relativos: "hoje" e "amanhã" são mais específicos que o nome do
     dia, e uma frase que traga os dois ("amanhã, segunda") quis dizer amanhã. */
  return diaDaSemana(t, agora);
}

// ---------------------------------------------------------------------------

/**
 * A leitura completa. Ordem: duração vence relógio, porque "em 2 horas" e "às
 * 14h" nunca aparecem juntos com o mesmo sentido — e quem diz os dois ("me
 * lembre em 2 horas, às 14h") está se corrigindo, com a duração vindo primeiro
 * na frase e sendo a intenção.
 */
export function interpretarQuando(bruto: string, agora = new Date()): Instante | null {
  const t = normalizar(bruto);

  const duracao = comoDuracao(t, agora);
  if (duracao) return duracao;

  const dia = deslocamentoDeDia(t, agora);
  const hora = comoRelogio(t);

  /**
   * Período sem relógio — "amanhã de manhã". Só vale com um dia declarado: um
   * "de manhã" solto pode ser hoje de manhã (já passou) ou amanhã, e adivinhar
   * qual é precisamente a decisão que este módulo não toma.
   */
  if (!hora && dia) {
    const periodo = Object.entries(PERIODOS).find(([chave]) =>
      new RegExp(`\\b(de|a|pela) ${chave}\\b`).test(t),
    );
    if (periodo) {
      const alvo = new Date(agora);
      alvo.setDate(alvo.getDate() + dia.dias);
      alvo.setHours(periodo[1].hora, 0, 0, 0);
      if (alvo.getTime() <= agora.getTime()) return null;
      return { quando: alvo, rotulo: `${dia.nome} ${periodo[1].nome} (${relogio(alvo)})` };
    }
  }

  if (!hora) return null;

  const alvo = new Date(agora);
  alvo.setDate(alvo.getDate() + (dia?.dias ?? 0));
  alvo.setHours(hora.hora, hora.minuto, 0, 0);

  /**
   * HORA JÁ PASSADA, e os dois casos são diferentes.
   *
   * Sem dia declarado, "às 8" quando já são 10h quer dizer amanhã — é a leitura
   * que qualquer pessoa faria, e o rótulo diz "amanhã" para o operador poder
   * discordar. Mas com o dia DECLARADO ("hoje às 8"), rolar para amanhã seria
   * contrariar o que foi dito: aí o certo é devolver `null` e deixar a
   * habilidade explicar que aquele horário já passou.
   */
  if (alvo.getTime() <= agora.getTime()) {
    if (dia) return null;
    alvo.setDate(alvo.getDate() + 1);
    return { quando: alvo, rotulo: `amanhã às ${relogio(alvo)}` };
  }

  return {
    quando: alvo,
    rotulo: `${dia?.nome ?? 'hoje'} às ${relogio(alvo)}`,
  };
}

// ---------------------------------------------------------------------------
// Assunto do lembrete
// ---------------------------------------------------------------------------

/**
 * O texto ORIGINAL e sua sombra sem acento, com os índices alinhados.
 *
 * O assunto é lido de volta em voz alta para o operador: "ligar para o Índio"
 * não pode voltar como "ligar para o indio". Mas o ruído temporal é escrito sem
 * acento (`amanha`, `as`, `manha`) porque é assim que o resto do módulo lê
 * hora. Casar um contra o outro é impossível — `ã` e `a` são caracteres
 * distintos — e foi exatamente essa impossibilidade que deixou "amanhã" e "às"
 * dentro do assunto, produzindo lembretes chamados "às" e horários lidos de
 * volta como se fossem o compromisso.
 *
 * A saída é achar o RECORTE na sombra e aplicá-lo no original. Cada caractere
 * da sombra guarda o índice de onde veio, então um casamento em `plano` vira um
 * intervalo em `texto` sem que nenhum acento precise ser tocado.
 */
interface Sombra {
  /** O original em NFC — acentos preservados, forma composta garantida. */
  readonly texto: string;
  /** O mesmo texto sem acento e em minúsculas. */
  readonly plano: string;
  /** Para cada caractere de `plano`, de qual índice de `texto` ele veio. */
  readonly origem: readonly number[];
}

function projetar(bruto: string): Sombra {
  // NFC primeiro: um "a" seguido de til combinante ocupa dois índices e
  // deixaria o acento órfão quando o recorte levasse só a letra.
  const texto = bruto.normalize('NFC');
  let plano = '';
  const origem: number[] = [];
  for (let i = 0; i < texto.length; i += 1) {
    const sem = texto[i]
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
    for (const c of sem) {
      plano += c;
      origem.push(i);
    }
  }
  return { texto, plano, origem };
}

/** Onde a frase para de ser pedido e começa a ser assunto. */
const GATILHO = /^.*?\b(?:me\s+lembr(?:e|ar|a)|lembr[ae]\s*-?\s*me|lembrete)\b/;

/**
 * Termos que só marcam a hora — não fazem parte do que deve ser lembrado.
 * Escritos na forma sem acento porque rodam sobre a sombra, nunca sobre o
 * original.
 */
const RUIDO_TEMPORAL = new RegExp(
  [
    // duração: "em 20 minutos", "daqui a 2 horas", "dentro de meia hora"
    /\b(?:em|daqui a|daqui|dentro de)\s+(?:[a-z]+|\d{1,4})\s*(?:min|mins|minutos?|h|horas?|dias?)\b/,
    // relógio anunciado: "às 15", "as 15h", "às 15h30", "as 9:30"
    /\b(?:as|ate as)\s*\d{1,2}(?:\s*[:h]\s*\d{2}|\s*h)?\b/,
    // relógio solto: "15h", "15h30"
    /\b\d{1,2}\s*h(?:\s*\d{2})?\b/,
    /\bmeio[- ]dia\b/,
    /\bmeia[- ]noite\b/,
    // dia
    /\b(?:depois de )?amanha\b/,
    /\bhoje\b/,
    // período: "de manhã", "da noite", "pela tarde"
    /\b(?:de|da|do|a|as|pela|pelo)\s+(?:manha|tarde|noite)\b/,
  ]
    .map((r) => r.source)
    .join('|'),
  'g',
);

/**
 * Conectivos que ligavam o pedido ao ruído temporal e sobram quando ele sai:
 * "me lembre EM 20 MINUTOS **de** ligar". Só são cortados na ponta — no meio da
 * frase são a frase.
 */
const CONECTIVO_INICIAL = /^(?:de|do|da|que|para|pra|sobre)\b\s*/i;
const CONECTIVO_FINAL = /\s+(?:de|do|da|para|pra|sobre|em|a|ao)$/i;

/**
 * O QUE deve ser lembrado, separado do QUANDO.
 *
 * Devolver string vazia é resposta legítima e frequente: "me lembre às 15h" não
 * diz do que, e a habilidade transforma o vazio numa pergunta. O que este
 * módulo não pode fazer é devolver um assunto que na verdade é um horário —
 * um lembrete chamado "às" é indistinguível de um lembrete real na lista de
 * pendentes, e a IARA o anuncia com a mesma confiança.
 */
export function extrairAssuntoLembrete(bruto: string): string {
  const { texto, plano, origem } = projetar(bruto);

  const recortado = new Array<boolean>(texto.length).fill(false);
  const recortar = (indice: number, tamanho: number): void => {
    if (tamanho <= 0) return;
    const inicio = origem[indice];
    const fim = origem[indice + tamanho - 1] + 1;
    for (let i = inicio; i < fim; i += 1) recortado[i] = true;
  };

  const gatilho = plano.match(GATILHO);
  if (gatilho?.index !== undefined) recortar(gatilho.index, gatilho[0].length);

  RUIDO_TEMPORAL.lastIndex = 0;
  for (const m of plano.matchAll(RUIDO_TEMPORAL)) {
    if (m.index !== undefined) recortar(m.index, m[0].length);
  }

  let sobra = '';
  for (let i = 0; i < texto.length; i += 1) sobra += recortado[i] ? ' ' : texto[i];

  let assunto = sobra
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, '')
    .trim();

  // Duas passadas bastam: "de manhã de ligar" já perdeu "de manhã" no recorte,
  // então sobra no máximo um conectivo colado noutro ("de que").
  for (let passada = 0; passada < 2; passada += 1) {
    assunto = assunto.replace(CONECTIVO_INICIAL, '').replace(CONECTIVO_FINAL, '').trim();
  }
  assunto = assunto.replace(/^[\s,;:.-]+|[\s,;:.!?-]+$/g, '').trim();

  // "me lembre às 15h" — hora sem assunto. Devolver string vazia deixa a
  // habilidade perguntar do que se trata, em vez de agendar um lembrete mudo.
  if (assunto.length < 2) return '';
  return assunto.slice(0, 200);
}
