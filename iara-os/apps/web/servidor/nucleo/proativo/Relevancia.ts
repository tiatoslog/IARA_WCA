/**
 * RELEVÂNCIA — "isto importa PARA ESTA PESSOA, AGORA?"
 *
 * A pergunta errada é *"este evento é importante?"*. Ela tem resposta absoluta,
 * e resposta absoluta produz o mesmo alerta para todo mundo — que é como um
 * sistema de avisos vira ruído para 80% de quem o recebe.
 *
 * ---------------------------------------------------------------------------
 * A LLM NÃO DECIDE ISTO
 * ---------------------------------------------------------------------------
 *
 * O modelo pode interpretar um evento, resumir, explicar. Ele não pontua
 * relevância, por três razões e as três são operacionais, não filosóficas:
 *
 *  1. Isto roda SEM NINGUÉM OLHANDO. Um turno que a operadora acompanha pode
 *     custar tokens e variar de resposta; um laço que acorda de dez em dez
 *     minutos, sozinho, não pode nem uma coisa nem outra.
 *  2. Precisa ser AUDITÁVEL. "Por que você me chamou?" tem de ter resposta em
 *     forma de sinais e pesos que alguém possa discordar e editar — não em forma
 *     de "o modelo achou".
 *  3. Precisa ser ESTÁVEL. A mesma ocorrência, o mesmo estado, tem de dar a
 *     mesma pontuação. Variância aqui é exatamente o defeito estrutural que a
 *     extração do Hermes identificou no resto do kernel; não faz sentido
 *     reintroduzi-lo numa camada nova.
 *
 * ---------------------------------------------------------------------------
 * OS SINAIS
 * ---------------------------------------------------------------------------
 *
 * Seis, todos em [0,1], todos derivados de fato observável. A pontuação é a
 * média ponderada. Os pesos são uma opinião — declarada, num lugar só, editável
 * por quem discordar — e não um número espalhado por dez `if`.
 */

import type { Confianca, Severidade } from '../kernel/Investigacao';
import type { PreferenciasOperador } from '../../../lib/perfil';
import { normalizar } from '../texto';
import type { Atencao } from './Atencao';
import { pesoDe } from './Atencao';
import type { Ocorrencia } from './Ocorrencia';

export interface SinaisRelevancia {
  /** Quanto custa se isto for verdade e ninguém souber. Vem da severidade. */
  readonly impacto: number;
  /** Quanto a IARA acredita no que está afirmando. */
  readonly confianca: number;
  /** O que ESTA pessoa demonstrou, ao longo do tempo, sobre este assunto. */
  readonly interesse: number;
  /** O que ESTA pessoa DECLAROU que é trabalho dela. Ver `lib/perfil.ts`. */
  readonly responsabilidade: number;
  /** É notícia, ou é a décima vez que a IARA vê a mesma coisa? */
  readonly novidade: number;
  /** Existe algo a fazer, ou é só informação? */
  readonly acionabilidade: number;
}

/**
 * A OPINIÃO, num lugar só. Soma 1 — há teste travando isso, porque um vetor de
 * pesos que não soma 1 faz a pontuação deixar de caber em [0,1] e todos os
 * limiares de `DecisaoProativa` passarem a significar outra coisa em silêncio.
 *
 * `impacto` e `interesse` empatam no topo de propósito: um evento grave que a
 * pessoa não quer saber e um evento leve que ela adora são, os dois, motivos
 * fracos para interromper. É a tensão que define a camada inteira.
 */
export const PESOS: Readonly<Record<keyof SinaisRelevancia, number>> = {
  impacto: 0.26,
  interesse: 0.26,
  confianca: 0.16,
  responsabilidade: 0.14,
  acionabilidade: 0.1,
  novidade: 0.08,
};

const IMPACTO_DA_SEVERIDADE: Record<Severidade, number> = {
  leve: 0.2,
  moderada: 0.55,
  grave: 1,
};

const VALOR_DA_CONFIANCA: Record<Confianca, number> = {
  baixa: 0.2,
  media: 0.6,
  alta: 1,
};

/**
 * O motivo estruturado. Não é texto para humano: é o insumo de auditoria e o que
 * a frase pode citar. Nome fechado de propósito — um motivo em texto livre é um
 * motivo que ninguém consegue contar depois.
 */
export type MotivoRelevancia =
  | 'impacto_alto'
  | 'confianca_baixa'
  | 'interesse_aprendido'
  | 'desinteresse_aprendido'
  | 'responsabilidade_declarada'
  | 'fato_novo'
  | 'fato_repetido'
  | 'acionavel'
  | 'sem_historico';

export interface Relevancia {
  readonly pontuacao: number;
  readonly sinais: SinaisRelevancia;
  readonly motivos: readonly MotivoRelevancia[];
}

/**
 * Palavra curta demais não distingue nada: "de", "da", "com" casariam com
 * qualquer ficha e fariam `responsabilidade` valer 1 para todo mundo — que é
 * exatamente o mesmo que não existir.
 */
const MINIMO_TOKEN = 4;

function tokens(texto: string): string[] {
  return normalizar(texto)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= MINIMO_TOKEN);
}

/**
 * O QUE A PESSOA DECLAROU SER TRABALHO DELA — casado com o que a ocorrência é.
 *
 * A fonte é a ficha (`lib/perfil.ts`), e a ficha é o único lugar da IARA onde
 * nada é inferido: todo campo ali foi digitado pelo operador sobre si mesmo. É a
 * fonte certa para esta pergunta, e é por isso que este sinal existe separado de
 * `interesse` — um é o que a pessoa DIZ, o outro é o que ela FAZ, e os dois
 * discordam com frequência.
 *
 * FICHA VAZIA DEVOLVE 0,5, NÃO 0. Ausência de declaração não é evidência de
 * desinteresse; é ausência de evidência. Zerar aqui faria todo operador que
 * nunca preencheu a ficha — a maioria, no primeiro mês — receber menos avisos
 * que alguém que preencheu com qualquer coisa.
 */
export function responsabilidadeDe(p: PreferenciasOperador, o: Ocorrencia): number {
  const declarado = tokens(`${p.funcao} ${p.observacoes}`);
  if (declarado.length === 0) return 0.5;

  const alvo = new Set(tokens(`${o.assunto} ${o.rotulo} ${o.resumo}`));
  const casou = declarado.filter((t) => alvo.has(t)).length;

  /* Um casamento já basta para dizer "isto é assunto dela"; a partir daí o sinal
     satura. Contar proporção do texto inteiro premiaria quem escreveu uma ficha
     curta e punir quem escreveu uma longa, o que não tem nada a ver com
     responsabilidade. */
  if (casou === 0) return 0.25;
  return casou >= 2 ? 1 : 0.8;
}

/**
 * NOVIDADE: quantas vezes este mesmo fato (mesma chave) já foi visto.
 *
 * Decai como `1/(1+vezes)` — o segundo avistamento vale metade, o terceiro um
 * terço. Decaimento suave, não degrau, porque um fato que volta pela terceira
 * vez ainda pode ser notícia se piorou; o que ele não pode é valer o mesmo que
 * a primeira vez.
 */
export function novidadeDe(vezesVisto: number): number {
  return 1 / (1 + Math.max(0, vezesVisto));
}

export function avaliar(entrada: {
  readonly ocorrencia: Ocorrencia;
  readonly atencao: Atencao;
  readonly preferencias: PreferenciasOperador;
  readonly vezesVisto: number;
}): Relevancia {
  const { ocorrencia: o, atencao, preferencias, vezesVisto } = entrada;

  const sinais: SinaisRelevancia = {
    impacto: IMPACTO_DA_SEVERIDADE[o.severidade],
    confianca: VALOR_DA_CONFIANCA[o.confianca],
    interesse: pesoDe(atencao),
    responsabilidade: responsabilidadeDe(preferencias, o),
    novidade: novidadeDe(vezesVisto),
    acionabilidade: o.acionavel ? 1 : 0.3,
  };

  let pontuacao = 0;
  for (const [nome, peso] of Object.entries(PESOS) as [keyof SinaisRelevancia, number][]) {
    pontuacao += peso * sinais[nome];
  }

  const motivos: MotivoRelevancia[] = [];
  if (sinais.impacto >= 1) motivos.push('impacto_alto');
  if (o.confianca === 'baixa') motivos.push('confianca_baixa');
  if (atencao.propostas === 0) motivos.push('sem_historico');
  else if (sinais.interesse >= 0.65) motivos.push('interesse_aprendido');
  else if (sinais.interesse <= 0.35) motivos.push('desinteresse_aprendido');
  if (sinais.responsabilidade >= 0.8) motivos.push('responsabilidade_declarada');
  if (vezesVisto === 0) motivos.push('fato_novo');
  else motivos.push('fato_repetido');
  if (o.acionavel) motivos.push('acionavel');

  /* Arredondado para três casas: a pontuação vai para disco e para log, e
     `0.6100000000000001` num arquivo de auditoria é ruído que alguém vai tentar
     interpretar um dia. */
  return { pontuacao: Math.round(pontuacao * 1000) / 1000, sinais, motivos };
}
