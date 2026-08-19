/**
 * PeriodoOperacional — a tradução de "hoje", "amanhã", "essa semana" para um
 * intervalo de datas. Mesmo espírito de `Quando.ts`, adaptado de INSTANTE
 * (uma hora precisa) para INTERVALO DE DIAS (o que a operação de cargas
 * precisa: "quantas cargas coletamos hoje" não tem hora, tem dia).
 *
 * Módulo PURO: não abre disco, não fala com a rede. Recebe texto e `agora`,
 * devolve um intervalo ou `null` — nunca um palpite. A mesma regra de
 * `Quando.ts`: ambíguo vira pergunta, não vira meia-noite por convenção.
 *
 * Datas são comparadas como STRING "AAAA-MM-DD" em toda esta cadeia — nunca
 * `Date` nem `toISOString()` para o cálculo de dia civil, porque
 * `toISOString()` fala UTC e o servidor fala hora local; usar um pra outro é
 * a mesma armadilha documentada em `Quando.ts`.
 */

function normalizar(bruto: string): string {
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Formata em hora LOCAL — nunca `toISOString()`, que fala UTC. */
function paraISOLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * A DATA COMO GENTE FALA — pedido da operadora, 19/08/2026:
 *
 *   "me incomoda o jeito que ela fala data, '18 do oito' poderia ser 18 de
 *    agosto"
 *
 * Ela está certa e o defeito é de origem: `18/08` é notação de PLANILHA. A IARA
 * lê planilha, mas conversa com uma pessoa — e a pessoa lê "dezoito barra zero
 * oito" em voz alta como "dezoito do oito", que é o que soava artificial.
 *
 * Vale duas vezes aqui, porque este rótulo também é FALADO: a voz neural lê o
 * mesmo texto que a tela mostra. Uma barra no meio de uma data é onde a
 * naturalidade morre primeiro.
 */
const MESES = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
] as const;

function porExtenso(iso: string): string {
  const [, m, dia] = iso.split('-');
  return `${Number(dia)} de ${MESES[Number(m) - 1]}`;
}

/**
 * UM INTERVALO NÃO REPETE O MÊS quando ele é o mesmo.
 *
 * "17 de agosto a 21 de agosto" é como um formulário preenche; "17 a 21 de
 * agosto" é como alguém diz. Quando o intervalo atravessa o mês, os dois lados
 * voltam por inteiro — aí a repetição não é redundante, é informação.
 */
function intervaloPorExtenso(inicio: string, fim: string): string {
  const [, mi] = inicio.split('-');
  const [, mf] = fim.split('-');
  if (mi === mf) return `${Number(inicio.split('-')[2])} a ${porExtenso(fim)}`;
  return `${porExtenso(inicio)} a ${porExtenso(fim)}`;
}

function comDias(agora: Date, deslocamento: number): Date {
  const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  d.setDate(d.getDate() + deslocamento);
  return d;
}

/** Segunda-feira da semana de `d` (semana começa na segunda, como a operação roda). */
function segundaDaSemana(d: Date): Date {
  const diaSemana = d.getDay(); // 0=domingo .. 6=sábado
  const distanciaDaSegunda = diaSemana === 0 ? 6 : diaSemana - 1;
  const seg = new Date(d);
  seg.setDate(seg.getDate() - distanciaDaSegunda);
  return seg;
}

export interface Periodo {
  readonly inicio: string; // AAAA-MM-DD
  readonly fim: string; // AAAA-MM-DD, inclusive
  /** Como a IARA vai DIZER o que entendeu, para uma leitura errada ser corrigível. */
  readonly rotulo: string;
}

const DATA_EXPLICITA = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/;

export function interpretarPeriodo(bruto: string, agora = new Date()): Periodo | null {
  const t = normalizar(bruto);

  if (/\bhoje\b|\bagora\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, 0));
    return { inicio: iso, fim: iso, rotulo: `hoje (${porExtenso(iso)})` };
  }

  if (/\bdepois de amanha\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, 2));
    return { inicio: iso, fim: iso, rotulo: `depois de amanhã (${porExtenso(iso)})` };
  }

  if (/\bamanha\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, 1));
    return { inicio: iso, fim: iso, rotulo: `amanhã (${porExtenso(iso)})` };
  }

  /**
   * "NOS ÚLTIMOS 30 DIAS" — janela móvel, pedida pela operadora em 19/08/2026.
   *
   * É o período que a pergunta "quais centrais não tiveram carga nos últimos 30
   * dias?" exige, e nenhuma das expressões acima o cobre: "essa semana" é curta
   * demais para ver uma central parar, e o ano inteiro é longo demais.
   *
   * A janela INCLUI hoje — 30 dias contados para trás a partir de hoje dão 30
   * dias de calendário, não 31. Quem pergunta por "últimos 30 dias" quer o mês
   * que passou, e um dia a mais faria a resposta discordar de qualquer relatório
   * que a operadora tire por fora.
   */
  const janela = t.match(/\bultimos?\s+(\d{1,3})\s+dias?\b|\bultimo\s+(dia)\b/);
  if (janela) {
    const dias = janela[2] ? 1 : Number(janela[1]);
    if (dias >= 1 && dias <= 366) {
      const inicio = paraISOLocal(comDias(agora, -(dias - 1)));
      const fim = paraISOLocal(comDias(agora, 0));
      return {
        inicio,
        fim,
        rotulo: `os últimos ${dias} dia${dias === 1 ? '' : 's'} (${intervaloPorExtenso(inicio, fim)})`,
      };
    }
  }

  if (/\bontem\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, -1));
    return { inicio: iso, fim: iso, rotulo: `ontem (${porExtenso(iso)})` };
  }

  if (/\b(semana que vem|proxima semana|semana seguinte)\b/.test(t)) {
    const seg = segundaDaSemana(comDias(agora, 7));
    const sex = comDias(seg, 4);
    const inicio = paraISOLocal(seg);
    const fim = paraISOLocal(sex);
    return { inicio, fim, rotulo: `semana que vem (${intervaloPorExtenso(inicio, fim)})` };
  }

  if (/\b(semana passada|semana anterior)\b/.test(t)) {
    const seg = segundaDaSemana(comDias(agora, -7));
    const sex = comDias(seg, 4);
    const inicio = paraISOLocal(seg);
    const fim = paraISOLocal(sex);
    return { inicio, fim, rotulo: `semana passada (${intervaloPorExtenso(inicio, fim)})` };
  }

  /**
   * A CONTRAÇÃO COME A FRONTEIRA DE PALAVRA — e o período sumia por causa disso.
   *
   * O DEFEITO (auditoria em navegador real, 19/08/2026): "qual o valor total das
   * cargas DESSA SEMANA?" devolveu *"todas as cargas de 2026: R$ 4.738.184,52
   * (2688 cargas)"*. O ano inteiro, com rótulo honesto, para quem perguntou pela
   * semana. Ninguém mentiu e ninguém respondeu a pergunta.
   *
   * A causa é uma letra. `\bessa semana\b` não casa "dessa semana": em "dessa",
   * o "essa" vem colado num "d", e `\b` exige fronteira ali. Como o período não
   * era reconhecido, ele virava vazio — que significa "universo inteiro".
   *
   * `de|em` + `essa|esta` é como a operadora fala: "dessa semana", "nessa
   * semana", "desta semana", "nesta semana". O `d?` e o `n?` cobrem as quatro
   * sem afrouxar nada: continuam sendo as mesmas duas expressões.
   */
  if (/\b[dn]?(essa|esta) semana\b|\bsemana atual\b/.test(t)) {
    const seg = segundaDaSemana(agora);
    const sex = comDias(seg, 4);
    const inicio = paraISOLocal(seg);
    const fim = paraISOLocal(sex);
    return { inicio, fim, rotulo: `essa semana (${intervaloPorExtenso(inicio, fim)})` };
  }

  // Data explícita: "17/08", "17/08/2026". Ano ausente assume o ano corrente.
  const m = t.match(DATA_EXPLICITA);
  if (m) {
    const dia = Number(m[1]);
    const mes = Number(m[2]);
    const anoBruto = m[3] ? Number(m[3]) : agora.getFullYear();
    const ano = anoBruto < 100 ? 2000 + anoBruto : anoBruto;
    if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;
    const d = new Date(ano, mes - 1, dia);
    // `Date` corrige datas inválidas em vez de recusar (32/13 vira outro mês) —
    // conferir se o dia sobreviveu à volta é o que pega isso.
    if (d.getDate() !== dia || d.getMonth() !== mes - 1) return null;
    const iso = paraISOLocal(d);
    return { inicio: iso, fim: iso, rotulo: porExtenso(iso) };
  }

  return null;
}
