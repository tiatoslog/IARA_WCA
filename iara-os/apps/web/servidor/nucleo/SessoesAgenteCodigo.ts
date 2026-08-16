/**
 * O JULGAMENTO de uma sessão de agente de código — a parte que decide o que a
 * IARA tem o direito de AFIRMAR depois de mandar o Claude Code trabalhar.
 *
 * Sem `spawn` e sem rede de propósito: aqui só se interpreta e se julga, e por
 * isso dá para provar cada regra com teste, sem processo nenhum no meio. Quem
 * tem as mãos é o `AgenteLocal`, como todo o resto que alcança a máquina.
 *
 * AS DUAS ARMADILHAS, as duas medidas com o binário real (2.1.233) em
 * 16/08/2026, e nenhuma das duas seria visível com um dublê:
 *
 * 1. `subtype` MENTE. Uma execução que falhou por falta de login devolveu, no
 *    mesmo objeto: `"is_error": true`, `"terminal_reason": "api_error"` e
 *    `"subtype": "success"`. O campo com o nome mais convidativo do JSON inteiro
 *    é o único que não se pode ler. Quem escrevesse `subtype === 'success'` —
 *    que é o que qualquer pessoa escreveria — teria a IARA anunciando trabalho
 *    concluído sobre uma sessão que não trocou uma palavra com modelo nenhum.
 *
 * 2. TRANSCRIPT NO DISCO NÃO É PROVA DE SUCESSO. O Claude Code cria
 *    `~/.claude/projects/<slug>/<uuid>.jsonl` mesmo quando a execução falha —
 *    conferido: a sessão de teste não logada deixou o arquivo lá. O transcript
 *    prova IDENTIDADE (esta sessão existe, é esta, e nasceu neste diretório),
 *    nunca RESULTADO. Um verificador que parasse em `existsSync` seria um
 *    gerador de falso positivo com cara de evidência independente.
 *
 * Por isso o veredito exige TRÊS coisas concordando — saída do processo,
 * `is_error` e identidade da sessão — e trata qualquer desacordo como
 * `desconhecido`, nunca como sucesso. É `Verdade.ts` aplicado a este domínio:
 * `executado` não é `verificado`.
 */

import path from 'node:path';

/**
 * Onde o Claude Code grava o diário da sessão.
 *
 * O nome da pasta é o caminho absoluto do diretório de trabalho com `:`, `\` e
 * `/` trocados por `-` — medido, não deduzido: um `cwd` de
 * `C:\Users\daian\AppData\Local\Temp\...\scratchpad` produziu
 * `C--Users-daian-AppData-Local-Temp-...-scratchpad`. O `C--` do começo é o
 * resultado natural de `C:` virar `C-` e a barra seguinte virar outro `-`.
 *
 * Formato observado numa versão específica da ferramenta. Se ele mudar, o
 * verificador perde ESTE oracle e passa a dizer `sem_meio_de_verificar` — que é
 * degradação honesta, não falso positivo. É por isso que ele nunca é a única
 * evidência.
 */
export function caminhoDoTranscript(pastaDoUsuario: string, diretorio: string, idSessao: string): string {
  const slug = path.resolve(diretorio).replace(/[:\\/]/g, '-');
  return path.join(pastaDoUsuario, '.claude', 'projects', slug, `${idSessao}.jsonl`);
}

/** O envelope que `--output-format json` devolve. Só o que se usa. */
export interface SaidaClaude {
  readonly session_id?: unknown;
  readonly is_error?: unknown;
  readonly result?: unknown;
  readonly num_turns?: unknown;
  readonly total_cost_usd?: unknown;
  /** Lido só para NUNCA ser usado como veredito — ver o cabeçalho. */
  readonly subtype?: unknown;
}

/**
 * Extrai o envelope JSON da saída bruta.
 *
 * Tolerante de propósito: a CLI pode emitir aviso antes do JSON, e uma linha de
 * ruído não pode custar o resultado inteiro. Procura o último objeto que
 * comece na coluna zero — o envelope final é o que interessa.
 *
 * `null` quando não há JSON nenhum. Isso é um estado legítimo (a ferramenta
 * morreu antes de escrever), e quem chama o traduz em `desconhecido`.
 */
export function interpretarSaidaClaude(bruto: string): SaidaClaude | null {
  const texto = (bruto ?? '').trim();
  if (!texto) return null;
  const inicio = texto.lastIndexOf('\n{');
  const candidato = inicio >= 0 ? texto.slice(inicio + 1) : texto;
  for (const tentativa of [candidato, texto]) {
    try {
      const v: unknown = JSON.parse(tentativa);
      if (typeof v === 'object' && v !== null && !Array.isArray(v)) return v as SaidaClaude;
    } catch {
      /* segue para a próxima forma */
    }
  }
  return null;
}

export type EstadoSessao =
  /** Ainda rodando. Não é sucesso nem falha — é ausência de desfecho. */
  | 'trabalhando'
  /** Terminou e o resultado é confiável. */
  | 'concluida'
  /** Terminou e falhou, com motivo conhecido. */
  | 'falhou'
  /** Terminou e NÃO se consegue dizer o que aconteceu. Ver `Verdade.ts`. */
  | 'desconhecida';

export interface VereditoSessao {
  readonly estado: EstadoSessao;
  /** O que sustenta o veredito, em uma linha. Vai para a prova da habilidade. */
  readonly evidencia: string;
  /** O texto que o agente produziu, quando há um confiável. */
  readonly resultado: string | null;
}

export interface EntradaDeJulgamento {
  /** `null` enquanto o processo não saiu. */
  readonly codigoSaida: number | null;
  readonly saidaBruta: string;
  readonly erroBruto: string;
  /** O UUID que a IARA gerou e passou em `--session-id`. */
  readonly idEsperado: string;
  /** O diário existe no disco? Prova de identidade, jamais de sucesso. */
  readonly transcriptExiste: boolean;
}

const umaLinha = (t: string, teto = 300): string =>
  t.replace(/\s+/g, ' ').trim().slice(0, teto);

/**
 * O JULGAMENTO. Três fontes precisam concordar para haver sucesso, e a ordem
 * das recusas é deliberada: tudo que NÃO é sucesso comprovado sai daqui como
 * falha ou como desconhecido.
 */
export function julgarSessao(e: EntradaDeJulgamento): VereditoSessao {
  if (e.codigoSaida === null) {
    /* Ainda em curso. Aqui o transcript ganha o único papel que ele sabe fazer
       bem: confirmar que a sessão que estamos acompanhando é REAL e é esta. */
    return {
      estado: 'trabalhando',
      evidencia: e.transcriptExiste
        ? `processo em execução e o diário da sessão ${e.idEsperado} já existe no disco`
        : `processo em execução; o diário da sessão ainda não apareceu no disco`,
      resultado: null,
    };
  }

  const envelope = interpretarSaidaClaude(e.saidaBruta);

  if (!envelope) {
    /* Saiu sem JSON. Pode ter morrido, pode ter sido morto, pode ter mudado de
       formato. Nenhuma dessas é "deu certo", e nenhuma é "o agente recusou". */
    const pista = umaLinha(e.erroBruto || e.saidaBruta) || 'sem saída';
    return {
      estado: e.codigoSaida === 0 ? 'desconhecida' : 'falhou',
      evidencia:
        `o agente saiu com código ${e.codigoSaida} e não devolveu o envelope JSON esperado — ${pista}`,
      resultado: null,
    };
  }

  /**
   * IDENTIDADE ANTES DE RESULTADO. Um envelope que fala de OUTRA sessão não é
   * evidência sobre a nossa, mesmo dizendo `is_error: false`. É a mesma lição
   * do `execucao_id` reaproveitado que fez a IARA anunciar "Pronto. Abri o
   * Bloco de Notas" para uma pergunta sobre memória.
   */
  if (typeof envelope.session_id === 'string' && envelope.session_id !== e.idEsperado) {
    return {
      estado: 'desconhecida',
      evidencia:
        `o agente respondeu sobre a sessão ${umaLinha(envelope.session_id, 40)}, ` +
        `e eu perguntei pela ${e.idEsperado}`,
      resultado: null,
    };
  }

  const resultado = typeof envelope.result === 'string' ? envelope.result : null;

  /**
   * `is_error` MANDA, e `subtype` não é consultado em lugar nenhum deste
   * arquivo. Ver a armadilha 1 no cabeçalho: os dois vieram contraditórios do
   * binário real, e o bonito era o mentiroso.
   */
  if (envelope.is_error === true || e.codigoSaida !== 0) {
    return {
      estado: 'falhou',
      evidencia:
        `o agente terminou com código ${e.codigoSaida} e is_error=${String(envelope.is_error)}` +
        (resultado ? ` — ${umaLinha(resultado, 200)}` : ''),
      resultado,
    };
  }

  if (envelope.is_error !== false) {
    /* Nem `true` nem `false`: campo ausente ou de outro tipo. Sem ele não há
       como afirmar sucesso, e inferir sucesso do silêncio é a doença inteira. */
    return {
      estado: 'desconhecida',
      evidencia: `o agente saiu com código 0 mas não declarou is_error — não consigo afirmar que concluiu`,
      resultado,
    };
  }

  if (!resultado) {
    return {
      estado: 'desconhecida',
      evidencia: 'o agente declarou sucesso e não devolveu texto de resultado',
      resultado: null,
    };
  }

  /**
   * O ÚNICO caminho para `concluida`. O transcript entra aqui como reforço
   * independente — e a frase diz quando ele NÃO foi encontrado, em vez de
   * omitir. Ausência dele não derruba o veredito (ver armadilha 2: ele não
   * responde por resultado), mas some da evidência quem não a sustenta.
   */
  const turnos = typeof envelope.num_turns === 'number' ? envelope.num_turns : null;
  return {
    estado: 'concluida',
    evidencia:
      `o agente saiu com código 0 e is_error=false na sessão ${e.idEsperado}` +
      (turnos !== null ? `, em ${turnos} turno(s)` : '') +
      (e.transcriptExiste
        ? '; o diário da sessão confere no disco'
        : '; o diário da sessão não foi encontrado no disco (sem esse reforço)'),
    resultado,
  };
}
