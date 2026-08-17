/**
 * O MOTOR DE VEREDITO.
 *
 * Uma função pura, sem disco, sem rede e sem modelo de linguagem: recebe o
 * registro de baterias, as linhas de evidência e o commit em julgamento, e
 * devolve o veredito com os motivos que o produziram.
 *
 * O que ele NÃO tem é o ponto: não existe parâmetro de override, não existe
 * "considerar aprovado apesar de", não existe grau de confiança do auditor. Se
 * fosse possível ajustar o veredito à mão, ele voltaria a ser opinião — e a
 * opinião já errou uma vez, em 17/08/2026, escrevendo READY sobre cinco baterias
 * que não rodaram.
 *
 * TRÊS REGRAS DE APURAÇÃO que parecem detalhe e são a defesa toda:
 *
 *  1. EVIDÊNCIA É SOBRE UM COMMIT. Registro de outro commit não conta — e é
 *     REPORTADO como obsoleto, nunca descartado em silêncio. É assim que uma
 *     bateria "sempre verde" nasce: alguém rodou uma vez, o código andou, e o
 *     verde ficou.
 *
 *  2. DUAS RODADAS QUE DISCORDAM VALEM A PIOR. Um defeito observado uma vez é
 *     um defeito; a rodada seguinte que passou não o desfaz — chama-se
 *     intermitente, e intermitente nunca foi aprovação.
 *
 *  3. REGISTRO MALFORMADO NÃO É DESCARTE NEM FALHA. Vira inconclusivo, que é a
 *     verdade: alguém rodou algo e não deixou como conferir. Descartar apagaria
 *     a tentativa; chamar de falha inventaria defeito de produto onde houve
 *     defeito de registro. Só a alegação de SUCESSO é rebaixada: um registro
 *     malformado que já dizia FALHOU continua falhando, porque rebaixá-lo
 *     esconderia um defeito real atrás de um erro de preenchimento.
 */

import {
  conferirRegistro,
  maisSevero,
  podeChamarDePronto,
  ROTULO_INTERNACIONAL,
  type Bateria,
  type ProblemaEvidencia,
  type RegistroEvidencia,
  type StatusExecucao,
  type Veredito,
} from './contrato';

/** Severidade do status, para a regra 2. Pior = número maior. */
const PESO_STATUS: Readonly<Record<StatusExecucao, number>> = {
  EXECUTADA_PASSOU: 0,
  NAO_EXECUTADA: 1,
  EXECUTADA_INCONCLUSIVA: 2,
  EXECUTADA_FALHOU: 3,
};

export interface LinhaApuracao {
  readonly bateria: Bateria;
  /** O status EFETIVO, depois das três regras acima. */
  readonly status: StatusExecucao;
  /** O registro que decidiu, ou `null` quando nada válido foi encontrado. */
  readonly registro: RegistroEvidencia | null;
  /** Uma linha explicando o status efetivo. Vai para o relatório. */
  readonly observacao: string;
  readonly problemas: readonly ProblemaEvidencia[];
  /** Registros existentes que falam de outro commit. Reportados, não usados. */
  readonly obsoletos: readonly string[];
}

export interface Apuracao {
  readonly commit: string;
  readonly veredito: Veredito;
  /** O par em inglês, para relatório que sai desta casa. */
  readonly rotulo: string;
  /**
   * A única permissão que este módulo concede ou nega. Distribuir é decisão do
   * dono; chamar de pronto é decisão do sistema.
   */
  readonly pode_chamar_de_pronto: boolean;
  readonly linhas: readonly LinhaApuracao[];
  /** Por que este veredito, em ordem de severidade. Nunca vazio. */
  readonly motivos: readonly string[];
}

const mesmoCommit = (a: string, b: string): boolean => {
  const x = a.trim().toLowerCase();
  const y = b.trim().toLowerCase();
  if (!x || !y) return false;
  return x.startsWith(y) || y.startsWith(x);
};

function apurarBateria(
  bateria: Bateria,
  registros: readonly RegistroEvidencia[],
  commit: string,
): LinhaApuracao {
  const daBateria = registros.filter((r) => r.bateria === bateria.id);
  const desteCommit = daBateria.filter((r) => mesmoCommit(r.commit, commit));
  const obsoletos = daBateria
    .filter((r) => !mesmoCommit(r.commit, commit))
    .map((r) => `${r.commit.slice(0, 7)} (${r.instante})`);

  if (desteCommit.length === 0) {
    const semHarness = bateria.cobertura_parcial
      ? `não há harness desta bateria; cobertura parcial hoje: ${bateria.cobertura_parcial}`
      : 'nunca executada: o harness não existe';
    return {
      bateria,
      status: 'NAO_EXECUTADA',
      registro: null,
      problemas: [],
      obsoletos,
      observacao:
        obsoletos.length > 0
          ? `sem evidência neste commit; há ${obsoletos.length} registro(s) de outro commit — evidência obsoleta não conta`
          : bateria.harness === null
            ? semHarness
            : `harness existe (${bateria.harness}) e ninguém o chamou neste commit`,
    };
  }

  // Regra 3 antes da regra 2: o rebaixamento muda a severidade que a regra 2
  // compara. Invertido, um PASSOU malformado venceria um INCONCLUSIVA honesto.
  const avaliados = desteCommit.map((r) => {
    const problemas = conferirRegistro(r);
    const status: StatusExecucao =
      problemas.length > 0 && r.status === 'EXECUTADA_PASSOU' ? 'EXECUTADA_INCONCLUSIVA' : r.status;
    return { r, problemas, status };
  });

  // Regra 2 — a pior vence. Empate fica com a mais recente, para o relatório
  // apontar a rodada que o leitor consegue reabrir.
  const escolhido = avaliados.reduce((pior, atual) => {
    if (PESO_STATUS[atual.status] > PESO_STATUS[pior.status]) return atual;
    if (PESO_STATUS[atual.status] < PESO_STATUS[pior.status]) return pior;
    return Date.parse(atual.r.instante) >= Date.parse(pior.r.instante) ? atual : pior;
  });

  const discordancia = new Set(avaliados.map((a) => a.status)).size > 1;
  const rebaixado = escolhido.problemas.length > 0 && escolhido.r.status === 'EXECUTADA_PASSOU';

  return {
    bateria,
    status: escolhido.status,
    registro: escolhido.r,
    problemas: escolhido.problemas,
    obsoletos,
    observacao: rebaixado
      ? `alegou PASSOU sem evidência válida (${escolhido.problemas
          .map((p) => `${p.campo}: ${p.motivo}`)
          .join('; ')}) — rebaixado a inconclusiva`
      : discordancia
        ? `${avaliados.length} rodadas neste commit discordam; vale a pior (${escolhido.status})`
        : `${escolhido.r.cenarios} cenário(s), execução ${escolhido.r.execucao}`,
  };
}

/**
 * A TABELA DE PRECEDÊNCIA. Cada regra acrescenta motivo e eleva a severidade;
 * o veredito é o mais severo que se aplicou. A ordem de leitura do disco não
 * influencia o resultado — foi por isso que a resolução virou `maisSevero` em
 * vez de uma sequência de atribuições.
 */
export function apurar(entrada: {
  readonly commit: string;
  readonly baterias: readonly Bateria[];
  readonly registros: readonly RegistroEvidencia[];
}): Apuracao {
  const { commit, baterias, registros } = entrada;
  const linhas = baterias.map((b) => apurarBateria(b, registros, commit));
  const motivos: string[] = [];
  let veredito: Veredito = 'PRONTO';

  // (a) Violação crítica de segurança bloqueia sozinha, venha de onde vier —
  // inclusive de bateria opcional. Segurança não é opcional porque a bateria é.
  for (const l of linhas) {
    for (const v of l.registro?.violacoes_criticas ?? []) {
      motivos.push(`BLOQUEADO — violação crítica em "${l.bateria.nome}": ${v}`);
      veredito = maisSevero(veredito, 'BLOQUEADO');
    }
  }

  // (b) Bateria crítica que falhou.
  for (const l of linhas) {
    if (l.bateria.critica && l.status === 'EXECUTADA_FALHOU') {
      motivos.push(`BLOQUEADO — bateria crítica falhou: "${l.bateria.nome}" (${l.observacao})`);
      veredito = maisSevero(veredito, 'BLOQUEADO');
    }
  }

  // (c) Obrigatória não crítica que falhou: defeito conhecido e aberto.
  for (const l of linhas) {
    if (l.bateria.obrigatoria && !l.bateria.critica && l.status === 'EXECUTADA_FALHOU') {
      motivos.push(`FALHOU — bateria obrigatória falhou: "${l.bateria.nome}" (${l.observacao})`);
      veredito = maisSevero(veredito, 'FALHOU');
    }
  }

  // (d) A regra que existe por causa do READY de 17/08: falta medição.
  for (const l of linhas) {
    if (!l.bateria.obrigatoria) continue;
    if (l.status === 'NAO_EXECUTADA' || l.status === 'EXECUTADA_INCONCLUSIVA') {
      motivos.push(
        `VALIDACAO_INCOMPLETA — obrigatória sem prova: "${l.bateria.nome}" (${l.observacao})`,
      );
      veredito = maisSevero(veredito, 'VALIDACAO_INCOMPLETA');
    }
  }

  // (e) Opcional sem prova não impede a palavra "pronto" — mas ela sai com a
  // ressalva colada, e a ressalva é nominal: sabe-se de QUE risco se fala.
  for (const l of linhas) {
    if (l.bateria.obrigatoria) continue;
    if (l.status !== 'EXECUTADA_PASSOU') {
      motivos.push(`risco conhecido — opcional sem prova: "${l.bateria.nome}" (${l.observacao})`);
      veredito = maisSevero(veredito, 'PRONTO_COM_RISCOS');
    }
  }

  if (motivos.length === 0) {
    motivos.push(
      `PRONTO — as ${baterias.length} baterias do registro rodaram e passaram contra ${commit.slice(0, 7)}`,
    );
  }

  return {
    commit,
    veredito,
    rotulo: ROTULO_INTERNACIONAL[veredito],
    pode_chamar_de_pronto: podeChamarDePronto(veredito),
    linhas,
    motivos,
  };
}

/** Texto para terminal e para colar em relatório. Sem cor, sem enfeite. */
export function resumo(a: Apuracao): string {
  const largura = a.linhas.reduce((m, l) => Math.max(m, l.bateria.nome.length), 0);
  const linhas = a.linhas.map((l) => {
    const marca =
      l.status === 'EXECUTADA_PASSOU'
        ? 'ok      '
        : l.status === 'EXECUTADA_FALHOU'
          ? 'FALHOU  '
          : l.status === 'EXECUTADA_INCONCLUSIVA'
            ? 'incerta '
            : 'ausente ';
    const marcador = l.bateria.critica ? '!' : l.bateria.obrigatoria ? '*' : ' ';
    return `  ${marcador} ${marca} ${l.bateria.nome.padEnd(largura)}  ${l.observacao}`;
  });

  return [
    `VEREDITO: ${a.veredito} (${a.rotulo})`,
    `commit ${a.commit.slice(0, 7)} · ${a.linhas.length} baterias · ` +
      `pode chamar de pronto: ${a.pode_chamar_de_pronto ? 'sim' : 'NÃO'}`,
    '',
    '  ! crítica · * obrigatória',
    ...linhas,
    '',
    'Por quê:',
    ...a.motivos.map((m) => `  · ${m}`),
  ].join('\n');
}
