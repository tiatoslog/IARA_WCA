/**
 * OS ORÁCULOS DETERMINÍSTICOS — funções puras que comparam fala com fonte.
 *
 * Nenhum deles pergunta nada a modelo nenhum, e nenhum lê disco: as fontes
 * chegam prontas de quem chama. É o que permite o mesmo código servir ao
 * runtime (que escala quando o valor não bate) e à campanha (que reprova a
 * rodada) sem que produção passe a depender de `testes/`.
 *
 * A REGRA COMUM: quando a fala NÃO afirma valor nenhum, o desfecho é
 * `inconclusivo`, nunca `invalido`. "Não tenho acesso a isso" é a resposta certa
 * quando a fonte está fora, e um verificador que a tratasse como erro puniria a
 * honestidade que o sistema inteiro tenta produzir.
 */

import {
  NAO_SEI_CONFERIR,
  type EvidenciaDeterministica,
  type ResultadoVerificacao,
} from './contrato';

// ---------------------------------------------------------------------------
// Relógio — o eixo TEMPORAL
// ---------------------------------------------------------------------------

/** `America/Sao_Paulo` é UTC−3 o ano inteiro desde 2019, quando o Brasil acabou
 *  com o horário de verão. Constante, não consulta a base de fusos. */
const OFFSET_OPERACAO_H = -3;

/**
 * A hora de parede, por aritmética.
 *
 * SEM `Intl` E SEM `toLocale*`, de propósito: `Quando.ts` — quem produz a
 * resposta — usa exatamente isso, e conferir `toLocaleString` com
 * `toLocaleString` passaria com o bug das 18:29 em pé, porque as duas pontas
 * errariam juntas. O verificador precisa chegar ao número por outro caminho ou
 * não é verificador.
 */
export function horaDeParede(utc: Date): string {
  const d = new Date(utc.getTime() + OFFSET_OPERACAO_H * 3600_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * Todas as horas plausíveis entre dois instantes, com um minuto de folga.
 *
 * A folga não é tolerância com o erro: é reconhecimento de que o turno leva
 * tempo e o minuto pode virar no meio. As três horas do defeito de 18/08 não
 * cabem nela por margem nenhuma, que é o ponto.
 */
export function janelaDeHoras(inicioMs: number, fimMs: number): string[] {
  const horas = new Set<string>();
  for (let t = inicioMs - 60_000; t <= fimMs + 60_000; t += 20_000) {
    horas.add(horaDeParede(new Date(t)));
  }
  return [...horas];
}

/** Todo `HH:MM` afirmado, com a hora normalizada em dois dígitos. */
export function horasAfirmadas(texto: string): string[] {
  return [...texto.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(
    (m) => `${m[1].padStart(2, '0')}:${m[2]}`,
  );
}

export function conferirHoraDeParede(
  texto: string,
  inicioMs: number,
  fimMs: number,
): ResultadoVerificacao {
  const esperadas = janelaDeHoras(inicioMs, fimMs);
  const ditas = horasAfirmadas(texto);
  const evidencia = (obtido: string | null, detalhe: string): EvidenciaDeterministica => ({
    fonte: 'relogio-aritmetico',
    esperado: horaDeParede(new Date(fimMs)),
    obtido,
    detalhe,
  });
  if (ditas.length === 0) {
    return NAO_SEI_CONFERIR('a fala não afirma nenhum HH:MM');
  }
  const acertou = ditas.some((h) => esperadas.includes(h));
  if (acertou) {
    return {
      status: 'valido',
      evidencia: evidencia(ditas.join('/'), `dentro da janela de ${esperadas.length} minutos`),
    };
  }
  return {
    status: 'invalido',
    motivo: `a fala diz ${ditas.join('/')} e o relógio de parede marca ${horaDeParede(new Date(fimMs))}`,
    evidencia: evidencia(ditas.join('/'), `fora da janela ${esperadas[0]}..${esperadas.at(-1)}`),
    /* Modelo melhor NÃO conserta hora errada — a hora não vem do modelo, vem do
       kernel. Escalar aqui gastaria orçamento para receber o mesmo número
       errado de um cérebro mais caro. */
    escalavel: false,
  };
}

// ---------------------------------------------------------------------------
// Contagem — o eixo VALOR
// ---------------------------------------------------------------------------

/** Todo inteiro afirmado, aceitando `1.234` no formato brasileiro. */
export function numerosAfirmados(texto: string): number[] {
  return [...texto.matchAll(/\b(\d{1,3}(?:\.\d{3})+|\d+)\b/g)]
    .map((m) => Number(m[1].replace(/\./g, '')))
    .filter((n) => Number.isFinite(n));
}

/**
 * O número COLADO no substantivo — "11 centrais", e não o 449 da mesma frase.
 *
 * Sem isto o verificador dá verde por coincidência: a fala real é "11 centrais
 * ativas, somando 449 veículos. 1 está fora", e aceitar o número certo em
 * qualquer posição aprovaria "449 centrais ativas em 11 estados".
 */
export function numeroColadoEm(texto: string, substantivo: RegExp): number | null {
  const m = texto.match(new RegExp(`\\b(\\d{1,3}(?:\\.\\d{3})+|\\d+)\\s+${substantivo.source}`, 'i'));
  return m ? Number(m[1].replace(/\./g, '')) : null;
}

export function conferirContagem(
  texto: string,
  substantivo: RegExp,
  esperado: number,
  fonte: string,
): ResultadoVerificacao {
  const colado = numeroColadoEm(texto, substantivo);
  const ditos = numerosAfirmados(texto);
  if (colado === null && ditos.length === 0) {
    return NAO_SEI_CONFERIR('a fala não afirma número algum');
  }
  const obtido = colado !== null ? colado : null;
  const evidencia: EvidenciaDeterministica = {
    fonte,
    esperado: String(esperado),
    obtido: obtido === null ? ditos.join('/') : String(obtido),
    detalhe:
      colado !== null
        ? `a fala diz "${colado} ${substantivo.source}"`
        : `sem número colado em "${substantivo.source}"; leitura frouxa sobre ${ditos.join(', ')}`,
  };
  /* Sem número colado no substantivo a leitura é frouxa demais para ACUSAR.
     Acusar por leitura frouxa produziria escalada em resposta correta. */
  if (colado === null) {
    return ditos.includes(esperado)
      ? { status: 'valido', evidencia }
      : NAO_SEI_CONFERIR(`não consegui isolar a alegação: ${evidencia.detalhe}`);
  }
  if (colado === esperado) return { status: 'valido', evidencia };
  return {
    status: 'invalido',
    motivo: `a fala afirma ${colado} e a fonte diz ${esperado}`,
    evidencia,
    /* Aqui escalar FAZ sentido: o número existe na base, o modelo barato o leu
       ou o inventou errado, e um modelo melhor tem chance real de acertar. */
    escalavel: true,
  };
}

// ---------------------------------------------------------------------------
// Procedência — valor afirmado com a fonte desligada
// ---------------------------------------------------------------------------

/**
 * Com a fonte fora, qualquer número é invenção — e não é preciso saber a
 * resposta certa para saber que não existe resposta.
 *
 * NASCEU DE UM FLAGRANTE, 18/08/2026: com Supabase e Graph zerados, a IARA
 * respondeu "temos 1234 cargas cadastradas" e "João Silva possui 237 cargas".
 * No mesmo roteiro, outros turnos recusaram corretamente — o caminho honesto
 * existe e não é confiável, que é a pior das combinações porque a amostra boa
 * esconde a ruim.
 *
 * `escalavel: false`: modelo melhor não inventa menos quando não há de onde
 * ler. O certo é degradar em voz alta.
 */
export function conferirSemFonte(
  texto: string,
  fonte: string,
  ignorar: readonly number[] = [],
): ResultadoVerificacao {
  const ditos = numerosAfirmados(texto).filter((n) => !ignorar.includes(n));
  if (ditos.length === 0) {
    return NAO_SEI_CONFERIR(`nada foi afirmado com ${fonte} desligada`);
  }
  return {
    status: 'invalido',
    motivo: `afirmou ${ditos.join(', ')} com ${fonte} desligada`,
    evidencia: {
      fonte: 'fonte-ausente',
      esperado: `nenhum valor: ${fonte} está desligada`,
      obtido: ditos.join('/'),
      detalhe: 'não há de onde ler este número nesta execução',
    },
    escalavel: false,
  };
}

// ---------------------------------------------------------------------------
// Evidência do turno — o eixo AUTORIDADE
// ---------------------------------------------------------------------------

/**
 * AFIRMOU UM NÚMERO SEM TER EXECUTADO NADA NESTE TURNO.
 *
 * O INCIDENTE (produção, 19/08/2026). "Quantos motoristas temos?" → *"75
 * motoristas diferentes — mesma contagem que te dei agora há pouco."* São 73.
 * Não houve soma de listagem nem chamada de ferramenta: a IARA **repetiu a
 * própria resposta errada do histórico**, e o "já respondi isso" funcionou como
 * credencial.
 *
 * ESTE ORÁCULO NÃO PRECISA SABER A RESPOSTA CERTA, e é isso que o torna geral.
 * Ele não conhece motorista, não conhece carga, não conhece 73. Ele responde a
 * uma pergunta mais simples e mais forte: *esta fala afirma um número que só
 * poderia vir de uma execução, e nenhuma execução aconteceu?* A mesma regra vale
 * para faturamento, cargas, clientes e o que vier depois — é a razão de não ser
 * um `if` por assunto.
 *
 * `operacoes` é a lista do que rodou de fato no turno. Vazia significa que a
 * fala não tem de onde tirar o número a não ser do contexto — e contexto não é
 * fonte. `undefined` significa que quem chamou não sabe informar, e aí o oráculo
 * se cala: não conseguir olhar é diferente de olhar e discordar.
 *
 * ESCALÁVEL, ao contrário de `conferirSemFonte`. Ali o valor não existia em
 * lugar nenhum e insistir seria gastar cota para inventar de novo. Aqui a fonte
 * está LIGADA e a operação existe — a segunda tentativa tem exatamente o que
 * fazer de diferente: executar.
 */
export function conferirExecucaoNoTurno(
  texto: string,
  operacoes: readonly string[] | undefined,
  assunto: string,
): ResultadoVerificacao {
  if (operacoes === undefined) {
    return NAO_SEI_CONFERIR('não sei quais operações rodaram neste turno');
  }
  const ditos = numerosAfirmados(texto);
  if (ditos.length === 0) {
    return NAO_SEI_CONFERIR('a fala não afirma número algum');
  }
  if (operacoes.length > 0) {
    /* Rodou algo determinístico: o número TEM origem. Se ele está certo é
       assunto de outro oráculo — este só cuida da autoridade. */
    return NAO_SEI_CONFERIR(`o turno executou ${operacoes.join(', ')}; o valor tem origem`);
  }
  return {
    status: 'invalido',
    motivo: `afirmou ${ditos.join(', ')} sobre ${assunto} sem executar nada neste turno`,
    evidencia: {
      fonte: 'evidencia-do-turno',
      esperado: 'um número vindo de execução determinística neste turno',
      obtido: ditos.join('/'),
      detalhe:
        'a fonte está ligada e existe operação para responder — o número veio do contexto, ' +
        'e contexto (inclusive uma resposta anterior da própria IARA) não é fonte',
    },
    escalavel: true,
  };
}
