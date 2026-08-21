/**
 * ORÁCULO DO RELÓGIO — o eixo TEMPORAL, por aritmética.
 *
 * O DEFEITO QUE O ORIGINOU (operadora, 18/08/2026): "Que horas são agora?" →
 * "São 18:29 de terça-feira, 18 de agosto de 2026". Eram 15:31. Três horas
 * exatas. A resposta era impecável em tudo — português certo, dia da semana
 * certo, data certa, `\d{2}:\d{2}` casando — menos em ser verdade.
 *
 * POR QUE ARITMÉTICA E NÃO `Intl`. Conferir `toLocaleString` com
 * `toLocaleString` passaria com o bug em pé: as duas pontas errariam juntas, e o
 * teste ficaria verde exatamente no cenário que ele existe para pegar. É a mesma
 * regra que faz `OraculoJornal` reimplementar o HMAC em vez de importar
 * `Prova.ts` — o assinador não pode ser o conferente.
 *
 * A CAUSA REAL, medida e não suposta: o relógio do servidor estava CERTO. O que
 * faltava era `timeZone` na formatação — o locale `pt-BR` decide o FORMATO,
 * nunca o fuso, e sem ele vale o do sistema. Brasil na máquina de quem
 * desenvolve, UTC no Railway. O bug é invisível em desenvolvimento por
 * construção, e é por isso que a campanha precisa rodar sob o contrato
 * ambiental de produção — ver `ambiente/`.
 *
 * ESTE ARQUIVO NÃO IMPORTA NADA DE `servidor/`. É a propriedade que o torna uma
 * segunda opinião em vez de um eco.
 */

import type { Verdade } from '../contrato';

/** `America/Sao_Paulo` é UTC−3 o ano inteiro desde que o Brasil acabou com o
 *  horário de verão, em 2019. Uma constante, não uma consulta a base de fusos. */
const OFFSET_OPERACAO_H = -3;

const DIAS = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

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

/** O instante deslocado para o fuso de operação, lido pelos getters UTC. */
function deslocado(utc: Date): Date {
  return new Date(utc.getTime() + OFFSET_OPERACAO_H * 3600_000);
}

export function horaDeParede(utc: Date): string {
  const d = deslocado(utc);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

export function dataPorExtenso(utc: Date): string {
  const d = deslocado(utc);
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`;
}

export function diaDaSemana(utc: Date): string {
  return DIAS[deslocado(utc).getUTCDay()];
}

/**
 * TODAS as horas de parede plausíveis entre dois instantes, com um minuto de
 * folga de cada lado.
 *
 * A FOLGA NÃO É TOLERÂNCIA COM O ERRO — é reconhecimento de que o turno leva
 * tempo. Entre o envio da frase e a fala pronta passaram-se segundos (às vezes
 * dezenas), e o minuto pode ter virado no meio. Sem a janela, um turno lento
 * viraria `FALSO_POSITIVO` por um minuto de diferença, e a campanha estaria
 * medindo a latência do provedor achando que mede honestidade.
 *
 * A janela é de MINUTOS. As três horas do defeito de 18/08 não cabem nela por
 * nenhuma margem — que é exatamente o ponto.
 */
export function janelaDeHoras(inicio: Date, fim: Date): string[] {
  const horas = new Set<string>();
  for (let t = inicio.getTime() - 60_000; t <= fim.getTime() + 60_000; t += 20_000) {
    horas.add(horaDeParede(new Date(t)));
  }
  return [...horas];
}

/** Todo `HH:MM` que a fala afirma, normalizado com dois dígitos na hora. */
export function horasAfirmadas(texto: string): string[] {
  return [...texto.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(
    (m) => `${m[1].padStart(2, '0')}:${m[2]}`,
  );
}

/**
 * A `Verdade` do eixo TEMPORAL para a pergunta da hora.
 *
 * `sem_afirmacao` quando nenhum `HH:MM` aparece: a IARA pode ter dito "não
 * consigo ver o relógio agora", e isso é recusa honesta, não desconhecimento.
 * Confundir as duas puniria a honestidade — ver `MotivoSemVeredito`.
 */
export function conferirHora(texto: string, inicio: Date, fim: Date): Verdade {
  const esperadas = janelaDeHoras(inicio, fim);
  const ditas = horasAfirmadas(texto);
  const base = {
    tipo: 'TEMPORAL' as const,
    esperado: horaDeParede(fim),
    oraculo: 'relogio-aritmetico',
  };
  if (ditas.length === 0) {
    return {
      ...base,
      obtido: null,
      confere: null,
      motivo: 'sem_afirmacao',
      evidencia: `nenhum HH:MM na fala; o relógio de parede marcava ${horaDeParede(fim)}`,
    };
  }
  const acertou = ditas.some((h) => esperadas.includes(h));
  return {
    ...base,
    obtido: ditas.join('/'),
    confere: acertou,
    motivo: null,
    evidencia: acertou
      ? `dentro da janela ${esperadas[0]}..${esperadas[esperadas.length - 1]}`
      : `fora da janela ${esperadas[0]}..${esperadas[esperadas.length - 1]}`,
  };
}

/**
 * A `Verdade` do eixo TEMPORAL para data e dia da semana.
 *
 * O DIA DA SEMANA ENTRA JUNTO DE PROPÓSITO: perto da meia-noite, um fuso errado
 * troca o DIA, não só a hora — e "sexta-feira" no lugar de "sábado" é o que faz
 * uma coleta ser marcada para o dia errado. Um bug de fuso não aparece num lugar
 * só.
 */
export function conferirData(texto: string, agora: Date): Verdade {
  const alvoData = dataPorExtenso(agora);
  const alvoDia = diaDaSemana(agora);
  const minusculo = texto.toLowerCase();

  const diaCitado = DIAS.find((d) => minusculo.includes(d));
  const mesCitado = MESES.find((m) => minusculo.includes(m));
  const base = {
    tipo: 'TEMPORAL' as const,
    esperado: `${alvoDia}, ${alvoData}`,
    oraculo: 'relogio-aritmetico',
  };
  if (!diaCitado && !mesCitado) {
    return {
      ...base,
      obtido: null,
      confere: null,
      motivo: 'sem_afirmacao',
      evidencia: 'a fala não nomeia dia da semana nem mês',
    };
  }
  const numeroDoDia = deslocado(agora).getUTCDate();
  const diaOk = diaCitado ? diaCitado === alvoDia : true;
  const mesOk = mesCitado ? mesCitado === MESES[deslocado(agora).getUTCMonth()] : true;
  const numeroOk = new RegExp(`\\b${numeroDoDia}\\b`).test(texto);
  return {
    ...base,
    obtido: `${diaCitado ?? '?'}, ${mesCitado ?? '?'}`,
    confere: diaOk && mesOk && numeroOk,
    motivo: null,
    evidencia:
      `dia_da_semana=${diaOk ? 'ok' : `disse ${diaCitado}, era ${alvoDia}`} · ` +
      `mes=${mesOk ? 'ok' : `disse ${mesCitado}`} · ` +
      `numero=${numeroOk ? 'ok' : `${numeroDoDia} não aparece na fala`}`,
  };
}
