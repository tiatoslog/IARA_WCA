/**
 * DOSSIÊ ANALÍTICO — o que permite reconstruir POR QUE uma resposta saiu.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: seis meses depois, alguém pergunta "de
 * onde veio esse 18%?". Sem dossiê, a única resposta possível é reler a frase
 * que a IARA escreveu — que é a coisa cuja confiabilidade está em xeque.
 *
 * ELE NÃO GUARDA RACIOCÍNIO. Nada de cadeia de pensamento, nada de prompt, nada
 * do que o modelo "considerou". Guarda o que é verificável por terceiro: quais
 * fontes foram tocadas, sobre quantos registros, com que procedência, quais
 * contestações dispararam, qual degrau sobrou e por que a confiança ficou onde
 * ficou. Um auditor consegue refazer a conta sem confiar em nenhuma frase.
 *
 * POR QUE ELE MONTA A ANÁLISE EM VEZ DE SÓ REGISTRÁ-LA. Se a montagem morasse
 * no `Kernel`, a ordem — nível, crítica, confiança, suficiência — seria uma
 * sequência de chamadas no meio de um método de 400 linhas, e a próxima pessoa
 * com pressa inverteria duas delas. Aqui a ordem é a função, ela é pura, e um
 * teste consegue prová-la sem subir kernel nenhum.
 */

import { classificarCobertura } from './Cobertura';
import type { Evidencia } from './Investigacao';
import {
  criticar,
  menorDegrau,
  ordenarRessalvas,
  type DegrauSustentado,
  type Ressalva,
} from './MotorCritica';
import { escolherNivel, type LeituraDoNivel } from './NivelDeAnalise';
import {
  avaliarConfianca,
  decidirSuficiencia,
  explicarConfianca,
  type Suficiencia,
} from './Suficiencia';

export interface DossieAnalitico {
  /** O traço do turno — o mesmo id que a auditoria e o jornal usam. */
  readonly analise_id: string;
  readonly pergunta: string;
  readonly nivel: LeituraDoNivel;
  /** As fontes distintas que produziram evidência. */
  readonly fontes: readonly string[];
  /** As habilidades que rodaram neste turno. */
  readonly ferramentas: readonly string[];
  readonly evidencias: readonly Evidencia[];
  readonly ressalvas: readonly Ressalva[];
  readonly degrau: DegrauSustentado;
  readonly suficiencia: Suficiencia;
  /** A frase que explica a confiança. Vai ao operador quando ele pergunta. */
  readonly porque_a_confianca: string;
  /** O que este turno NÃO conseguiu apurar. */
  readonly limitacoes: readonly string[];
  readonly instante: string;
}

/**
 * A EVIDÊNCIA É INSUFICIENTE PARA O NÍVEL PEDIDO?
 *
 * Mora aqui e não em `MotorCritica` de propósito: o motor de crítica não conhece
 * nível e não deve conhecer — ele contesta o conjunto de evidências pelo que
 * ele é, não pelo que alguém esperava dele. Quem cruza "o que a pergunta pedia"
 * com "o que o turno juntou" é este arquivo, que é o único que vê os dois.
 */
function ressalvaDeVolume(
  evidencias: readonly Evidencia[],
  nivel: LeituraDoNivel,
): readonly Ressalva[] {
  const diretas = evidencias.filter((e) => e.relevancia === 'direta');
  if (diretas.length >= nivel.evidencias_minimas) return [];
  return [
    {
      codigo: 'procedencia_fraca',
      gravidade: 'seria',
      texto:
        `Uma pergunta desse tipo (${nivel.nivel}) pede pelo menos ${nivel.evidencias_minimas} ` +
        `evidência(s) para eu concluir; apurei ${diretas.length}. Estou respondendo com o que tenho e ` +
        'dizendo que é menos do que a pergunta merecia.',
      metricas: diretas.map((e) => e.metrica),
      teto: 'descritiva',
    },
  ];
}

/**
 * O que ficou de fora — escrito para o operador, derivado da evidência.
 *
 * Limitação NÃO é a mesma coisa que ressalva: a ressalva contesta o que foi
 * concluído, a limitação declara o que nem chegou a ser olhado. As duas
 * precisam sair na resposta, e confundi-las faz a segunda desaparecer — que é
 * como um sistema passa a impressão de ter olhado tudo.
 */
function limitacoesDe(evidencias: readonly Evidencia[]): readonly string[] {
  const fora: string[] = [];
  for (const e of evidencias) {
    if (!e.cobertura) continue;
    if (e.cobertura.ausentes > 0 && e.cobertura.motivo_ausencia) {
      fora.push(
        `${e.metrica}: ${e.cobertura.ausentes} registro(s) fora da conta — ${e.cobertura.motivo_ausencia}`,
      );
    }
    if (classificarCobertura(e.cobertura) === 'vazia') {
      fora.push(`${e.metrica}: o recorte não trouxe registro nenhum`);
    }
  }
  return [...new Set(fora)];
}

/**
 * Monta o dossiê — nível, crítica, confiança, suficiência, nesta ordem.
 *
 * `agora` é injetado. Módulo puro, testável sem relógio: uma análise que muda de
 * veredicto entre duas execuções com a mesma entrada não é auditável, e
 * auditabilidade é a razão de este arquivo existir.
 */
export function montarDossie(entrada: {
  readonly analise_id: string;
  readonly pergunta: string;
  readonly evidencias: readonly Evidencia[];
  readonly ferramentas: readonly string[];
  readonly agora: string;
}): DossieAnalitico {
  const nivel = escolherNivel(entrada.pergunta);

  const critica = criticar({
    evidencias: entrada.evidencias,
    tipo_pretendido: nivel.tipo_pretendido,
    agora: entrada.agora,
  });

  const doVolume = ressalvaDeVolume(entrada.evidencias, nivel);
  const ressalvas = ordenarRessalvas([...critica.ressalvas, ...doVolume]);

  /**
   * O teto desce com a ressalva de volume também — senão uma pergunta
   * estratégica respondida com uma evidência só sairia como conclusão causal
   * rebaixada apenas por `R9`, e não pelo fato de não ter dado.
   *
   * `menorDegrau` e NÃO uma comparação escrita aqui: a primeira versão desta
   * linha aplicava `r.teto` direto e SUBIA o teto quando a ressalva de volume
   * era menos severa que a crítica. Teto que sobe não é teto. A escada tem uma
   * ordem só, e ela mora em `MotorCritica`.
   */
  const degrau = doVolume.reduce<DegrauSustentado>(
    (teto, r) => (r.teto === null ? teto : menorDegrau(teto, r.teto)),
    critica.degrau,
  );

  const confiabilidade = avaliarConfianca({
    evidencias: entrada.evidencias,
    ressalvas,
    agora: entrada.agora,
    divergencias_silenciadas: critica.divergencias_silenciadas,
  });

  const suficiencia = decidirSuficiencia({
    tipo_pretendido: nivel.tipo_pretendido,
    degrau,
    ressalvas,
    confiabilidade,
  });

  return {
    analise_id: entrada.analise_id,
    pergunta: entrada.pergunta,
    nivel,
    fontes: [...new Set(entrada.evidencias.map((e) => e.fonte))],
    ferramentas: [...new Set(entrada.ferramentas)],
    evidencias: entrada.evidencias,
    ressalvas,
    degrau,
    suficiencia,
    porque_a_confianca: explicarConfianca(confiabilidade),
    limitacoes: limitacoesDe(entrada.evidencias),
    instante: entrada.agora,
  };
}

/**
 * O QUE A RESPOSTA CARREGA, e por que ele é CONCATENADO em vez de pedido.
 *
 * Se as ressalvas entrassem só no prompt da síntese, a LLM poderia omiti-las —
 * e omitiria exatamente nos turnos em que o texto ficasse melhor sem elas, que
 * são os turnos em que elas importam. É a diferença entre instrução e trava, e
 * este repositório já mediu a diferença: 56% de afirmação falsa quando a única
 * defesa era uma linha de contexto pedindo para não afirmar.
 *
 * Devolve vazio quando não há nada a ressalvar — encher toda resposta de rodapé
 * é o ruído que `RESSALVA` em `Verdade.ts` evita pela mesma razão.
 */
export function rodapeDoDossie(d: DossieAnalitico): string {
  const partes: string[] = [];

  if (d.suficiencia.veredicto !== 'concluir' && d.suficiencia.texto) {
    partes.push(d.suficiencia.texto);
  }
  if (d.limitacoes.length > 0) {
    partes.push(`Ficou de fora: ${d.limitacoes.join('; ')}.`);
  }
  /* A confiança só aparece quando NÃO é alta. Repetir "confiança alta" em toda
     resposta ensina a pessoa a pular o rodapé — inclusive no dia em que ele
     disser "baixa". */
  if (d.suficiencia.confiabilidade.confianca !== 'alta') {
    partes.push(d.porque_a_confianca);
  }

  return partes.join('\n');
}

/**
 * O QUE DIZER AO REDATOR sobre o teto desta conclusão.
 *
 * NÃO É A GARANTIA — a garantia é `rodapeDoDossie`, concatenado depois da fala.
 * Isto existe para a resposta não NASCER se contradizendo: sem esta instrução a
 * LLM escrevia "pode levar esse número para a diretoria" e o código colava
 * "isto não cobre o recorte inteiro" logo abaixo, produzindo um texto que se
 * desmente dentro de si.
 *
 * Fala em português comum e nomeia o degrau em termos de FRASE PERMITIDA, não
 * de vocabulário interno: "descritiva" não quer dizer nada para quem redige, e
 * "fale só sobre os registros que você apurou" quer.
 */
export function instrucaoDoDegrau(d: DossieAnalitico): string {
  /**
   * ⚠️ SÓ PROMETE A RESSALVA QUANDO ELA EXISTE — o defeito que a segunda passada
   * da auditoria achou nesta função.
   *
   * A primeira versão anunciava, incondicionalmente, que "uma ressalva vai ser
   * acrescentada ao final da sua resposta". Mas `rodapeDoDossie` devolve vazio
   * no caso limpo (veredicto `concluir`, confiança alta, sem limitação) — e um
   * modelo cooperativo escreve *"conforme a ressalva abaixo"* atrás de nada.
   * É a MESMA auto-contradição que esta função existe para eliminar, com o
   * sinal trocado.
   *
   * Note que a checagem é a chamada real de `rodapeDoDossie`, não uma condição
   * escrita à mão que concorde com ela hoje e divirja amanhã.
   */
  const haveraRodape = rodapeDoDossie(d) !== '';
  const comum = haveraRodape
    ? 'Uma ressalva sobre os limites desta evidência vai ser acrescentada ao final da sua resposta ' +
      'por código, independentemente do que você escrever. Redija de forma que ela não contradiga ' +
      'o que você disse.'
    : '';

  const porDegrau: Record<string, string> = {
    /* `nenhum` não chega aqui: a abstenção fecha o turno antes da composição.
       Fica declarado para o dia em que alguém chamar esta função de outro
       lugar — e para não parecer que o caso foi esquecido. */
    nenhum:
      'A evidência NÃO sustenta conclusão nenhuma. Não dê número como resposta e não conclua.',
    descritiva:
      'Você só pode falar sobre OS REGISTROS QUE FORAM APURADOS, nunca sobre o conjunto todo. ' +
      'Nada de "a operação", "as cargas", "os motoristas" como se fosse a população inteira.',
    populacional:
      'Você pode afirmar sobre o conjunto do recorte, mas NÃO comparar períodos nem explicar causa.',
    comparativa:
      'Você pode comparar os períodos apurados. NÃO afirme que uma coisa CAUSOU a outra — ' +
      'o que existe aqui é associação, e dizer "por causa de" seria afirmar o que não foi medido.',
    causal: '',
  };

  const especifico = porDegrau[d.degrau] ?? '';
  const confianca =
    d.suficiencia.confiabilidade.confianca === 'alta'
      ? ''
      : `A confiança apurada é ${d.suficiencia.confiabilidade.confianca}. Não escreva a resposta ` +
        'com mais segurança do que isso.';

  return [comum, especifico, confianca].filter(Boolean).join(' ');
}

/**
 * A linha estruturada para a trilha de auditoria. Sem texto livre, sem
 * raciocínio — só o que outro processo consegue conferir.
 */
export function linhaDeAuditoria(d: DossieAnalitico): string {
  return JSON.stringify({
    analise_id: d.analise_id,
    nivel: d.nivel.nivel,
    marcadores: d.nivel.marcadores,
    dimensoes: d.nivel.dimensoes,
    tipo_pretendido: d.nivel.tipo_pretendido,
    degrau_sustentado: d.degrau,
    veredicto: d.suficiencia.veredicto,
    confianca: d.suficiencia.confiabilidade.confianca,
    pontuacao: Number(d.suficiencia.confiabilidade.pontuacao.toFixed(3)),
    fontes: d.fontes,
    ferramentas: d.ferramentas,
    evidencias: d.evidencias.map((e) => ({
      metrica: e.metrica,
      fonte: e.fonte,
      procedencia: e.procedencia,
      cobertura_pct: e.cobertura?.percentual ?? null,
      consideradas: e.cobertura?.consideradas ?? null,
      elegiveis: e.cobertura?.elegiveis ?? null,
    })),
    ressalvas: d.ressalvas.map((r) => ({ codigo: r.codigo, gravidade: r.gravidade })),
    o_que_falta: d.suficiencia.o_que_falta,
  });
}
