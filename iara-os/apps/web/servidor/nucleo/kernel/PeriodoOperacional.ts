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

function paraDDMM(iso: string): string {
  const [, m, dia] = iso.split('-');
  return `${dia}/${m}`;
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
    return { inicio: iso, fim: iso, rotulo: `hoje (${paraDDMM(iso)})` };
  }

  if (/\bdepois de amanha\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, 2));
    return { inicio: iso, fim: iso, rotulo: `depois de amanhã (${paraDDMM(iso)})` };
  }

  if (/\bamanha\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, 1));
    return { inicio: iso, fim: iso, rotulo: `amanhã (${paraDDMM(iso)})` };
  }

  if (/\bontem\b/.test(t)) {
    const iso = paraISOLocal(comDias(agora, -1));
    return { inicio: iso, fim: iso, rotulo: `ontem (${paraDDMM(iso)})` };
  }

  if (/\b(semana que vem|proxima semana|semana seguinte)\b/.test(t)) {
    const seg = segundaDaSemana(comDias(agora, 7));
    const sex = comDias(seg, 4);
    const inicio = paraISOLocal(seg);
    const fim = paraISOLocal(sex);
    return { inicio, fim, rotulo: `semana que vem (${paraDDMM(inicio)} a ${paraDDMM(fim)})` };
  }

  if (/\b(essa semana|esta semana|semana atual)\b/.test(t)) {
    const seg = segundaDaSemana(agora);
    const sex = comDias(seg, 4);
    const inicio = paraISOLocal(seg);
    const fim = paraISOLocal(sex);
    return { inicio, fim, rotulo: `essa semana (${paraDDMM(inicio)} a ${paraDDMM(fim)})` };
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
    return { inicio: iso, fim: iso, rotulo: paraDDMM(iso) };
  }

  return null;
}
