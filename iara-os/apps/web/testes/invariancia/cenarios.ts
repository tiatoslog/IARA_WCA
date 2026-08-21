/**
 * OS CASOS — escritos à mão, fora da implementação que eles medem.
 *
 * A REGRA QUE GOVERNA ESTE ARQUIVO: nada aqui é calculado pelo sistema sob
 * teste. As famílias, as paráfrases, o ruído, os pares negativos e o que conta
 * como "mesma intenção" são julgamento humano sobre a operação da Atos Log. Se
 * um dia alguém gerar este arquivo rodando a IARA sobre um corpus, o arnês
 * passa a comparar o sistema consigo mesmo e para de medir qualquer coisa.
 *
 * O QUE ESTÁ SENDO PERGUNTADO. Para cada intenção, uma formulação LIMPA — a
 * frase de manual — e um punhado de formas humanas da mesma coisa. A pergunta
 * do arnês é se a IARA reconstrói o MESMO significado quando a forma muda:
 *
 *     mesma intenção + formulação diferente  →  mesma interpretação
 *     intenção diferente                     →  interpretação diferente
 *
 * As duas metades importam. Um sistema que responde "cargas" para tudo passa na
 * primeira e falha na segunda, e é por isso que `PARES_NEGATIVOS` existe.
 *
 * O RUÍDO É REAL, não decorativo: erro de digitação, palavra faltando, plural
 * errado, abreviação, "ai" no fim da frase. É como a operadora escreve no
 * celular, entre uma coleta e outra.
 */

/**
 * FAMÍLIA = as habilidades que respondem à MESMA pergunta do operador.
 *
 * Por que agrupar em vez de exigir o id exato: `consultar_cargas_luft` e
 * `consultar_estatisticas_cargas_luft` leem a mesma planilha e respondem
 * "quantas cargas" — qual das duas o planejador escolhe é decisão de execução,
 * não de compreensão. Exigir o id exato mediria a fronteira entre duas
 * habilidades irmãs em vez de medir entendimento.
 *
 * Por que NÃO agrupar mais que isto: `agendar_lembrete` e `listar_lembretes`
 * falam de lembrete e são intenções opostas — uma escreve, a outra lê. Juntá-las
 * faria o arnês aplaudir exatamente o defeito que a auditoria persegue
 * (« esse lembrete das 11h foi criado quando? » compilando para criação).
 */
export const FAMILIAS: Readonly<Record<string, readonly string[]>> = {
  cargas: [
    'consultar_cargas_luft',
    'consultar_estatisticas_cargas_luft',
    'comparar_anos_luft',
    'comparar_semanas_luft',
  ],
  lembrete_ler: ['listar_lembretes'],
  lembrete_criar: ['agendar_lembrete'],
  lembrete_cancelar: ['cancelar_lembrete'],
  email: ['ler_emails'],
  arquivos_ler: ['listar_arquivos'],
  arquivos_criar: ['criar_pasta', 'criar_arquivo'],
  clima: ['consultar_clima'],
  maquina: ['informacoes_sistema', 'investigar_lentidao', 'diagnosticar_sistema'],
  agenda_ler: ['ver_agenda_calendario'],
  whatsapp: ['enviar_whatsapp'],
  captura: ['capturar_tela'],
  infraestrutura: ['consultar_infraestrutura'],
};

/** Índice inverso, montado do mapa acima — habilidade → família. */
export const FAMILIA_DA_HABILIDADE: ReadonlyMap<string, string> = new Map(
  Object.entries(FAMILIAS).flatMap(([familia, ids]) => ids.map((id) => [id, familia] as const)),
);

export type Registro = 'limpa' | 'parafrase' | 'ruido';

export interface Formulacao {
  readonly frase: string;
  readonly registro: Registro;
}

export interface Cenario {
  /** Nome da intenção — aparece no relatório. */
  readonly nome: string;
  /** A família que um humano diz que esta intenção pertence. */
  readonly familia: string;
  /** A frase de manual. É a REFERÊNCIA contra a qual as outras são comparadas. */
  readonly limpa: string;
  readonly variacoes: readonly Formulacao[];
}

/**
 * A REFERÊNCIA É A FORMULAÇÃO LIMPA, não um contrato escrito à mão campo a
 * campo. Duas razões, e a segunda é a que decide:
 *
 *   · o que o arnês pergunta é INVARIÂNCIA — "a forma mudou, o significado
 *     sobreviveu?" — e isso é uma relação entre duas leituras, não uma nota
 *     absoluta;
 *   · congelar `periodo: '2026-08-17..2026-08-21'` à mão travaria o arnês no
 *     calendário e no formato interno do interpretador, e ele ficaria vermelho
 *     por refatoração em vez de por regressão de compreensão.
 *
 * O que fica escrito à mão é o julgamento que a máquina não pode dar: QUAIS
 * frases são a mesma intenção (`familia` e o agrupamento em `variacoes`), e
 * quais NÃO são (`PARES_NEGATIVOS`).
 */
export const CENARIOS: readonly Cenario[] = [
  {
    nome: 'contar cargas no período corrente',
    familia: 'cargas',
    limpa: 'Quantas cargas foram coletadas essa semana?',
    variacoes: [
      { frase: 'quantas cargas tivemos essa semana?', registro: 'parafrase' },
      { frase: 'me diz quantas cargas essa semana', registro: 'parafrase' },
      { frase: 'quantas coletas essa semana?', registro: 'parafrase' },
      { frase: 'total de cargas dessa semana', registro: 'parafrase' },
      { frase: 'essa semana teve quantas cargas?', registro: 'parafrase' },
      { frase: 'quantas carga essa semana', registro: 'ruido' },
      { frase: 'quantas cargass dessa semana ai', registro: 'ruido' },
      { frase: 'qnts cargas essa semana', registro: 'ruido' },
      { frase: 'quantas cargas foram coletada essa semana', registro: 'ruido' },
    ],
  },
  {
    nome: 'ranking de motorista por carga',
    familia: 'cargas',
    limpa: 'Qual motorista tem mais cargas?',
    variacoes: [
      { frase: 'quem é o motorista com mais cargas?', registro: 'parafrase' },
      { frase: 'qual motorista mais rodou?', registro: 'parafrase' },
      { frase: 'me mostra o ranking dos motoristas', registro: 'parafrase' },
      { frase: 'quem puxou mais carga?', registro: 'parafrase' },
      { frase: 'qual motorista tem mais carga', registro: 'ruido' },
      { frase: 'qual motorosta tem mais cargas?', registro: 'ruido' },
      { frase: 'ranking motorista carga', registro: 'ruido' },
    ],
  },
  {
    nome: 'ler os lembretes marcados',
    familia: 'lembrete_ler',
    limpa: 'Quais lembretes eu tenho?',
    variacoes: [
      { frase: 'o que eu marquei com você?', registro: 'parafrase' },
      { frase: 'me lista os lembretes pendentes', registro: 'parafrase' },
      { frase: 'tenho algum lembrete?', registro: 'parafrase' },
      { frase: 'o que ficou marcado?', registro: 'parafrase' },
      { frase: 'quais lembrete eu tenho', registro: 'ruido' },
      { frase: 'me lista os lembrets', registro: 'ruido' },
      { frase: 'quais lembretes eu tenho ai', registro: 'ruido' },
    ],
  },
  {
    nome: 'marcar um lembrete',
    familia: 'lembrete_criar',
    limpa: 'Me lembre de ligar para o cliente em 20 minutos',
    variacoes: [
      { frase: 'me lembra de ligar pro cliente em 20 minutos', registro: 'parafrase' },
      { frase: 'não me deixe esquecer de ligar pro cliente daqui a 20 minutos', registro: 'parafrase' },
      { frase: 'marca um lembrete pra ligar pro cliente em 20 minutos', registro: 'parafrase' },
      { frase: 'me lembre de ligar pro clientee em 20 min', registro: 'ruido' },
      { frase: 'me lembra ligar cliente 20 minutos', registro: 'ruido' },
    ],
  },
  {
    nome: 'ler a caixa de entrada',
    familia: 'email',
    limpa: 'Leia meus emails recentes',
    variacoes: [
      { frase: 'chegou algum email novo?', registro: 'parafrase' },
      { frase: 'tem email da LUFT hoje?', registro: 'parafrase' },
      { frase: 'me mostra a caixa de entrada', registro: 'parafrase' },
      { frase: 'olha meus e-mails', registro: 'parafrase' },
      { frase: 'le meus emails', registro: 'ruido' },
      { frase: 'chegou algum e mail novo ai', registro: 'ruido' },
    ],
  },
  {
    nome: 'listar arquivos de um local',
    familia: 'arquivos_ler',
    limpa: 'O que tem na minha área de trabalho?',
    variacoes: [
      { frase: 'lista os arquivos da área de trabalho', registro: 'parafrase' },
      { frase: 'me mostra o que tem na area de trabalho', registro: 'parafrase' },
      { frase: 'quais arquivos estão nos documentos?', registro: 'parafrase' },
      { frase: 'lista os arquivo de downloads', registro: 'ruido' },
      { frase: 'oq tem na area de trabalho', registro: 'ruido' },
    ],
  },
  {
    nome: 'previsão do tempo',
    familia: 'clima',
    limpa: 'Vai chover hoje?',
    variacoes: [
      { frase: 'como está o tempo hoje?', registro: 'parafrase' },
      { frase: 'qual a previsão para hoje?', registro: 'parafrase' },
      { frase: 'tá chovendo aí?', registro: 'parafrase' },
      { frase: 'vai chove hoje', registro: 'ruido' },
      { frase: 'como ta o tempo ai hoje', registro: 'ruido' },
    ],
  },
  {
    nome: 'estado da máquina',
    familia: 'maquina',
    limpa: 'Quanto de memória meu computador está usando?',
    variacoes: [
      { frase: 'como está o PC agora?', registro: 'parafrase' },
      { frase: 'quanto de memória o computador tá gastando?', registro: 'parafrase' },
      { frase: 'me diz o uso de memória da máquina', registro: 'parafrase' },
      { frase: 'quanto de memoria o computador ta usando', registro: 'ruido' },
      { frase: 'como ta o pc', registro: 'ruido' },
    ],
  },
  /**
   * DUAS INTENÇÕES, NÃO UMA — e a primeira versão deste arquivo errou nisso.
   *
   * « O que eu tenho essa semana? » e « tenho alguma reunião amanhã? » estavam
   * escritas como paráfrases uma da outra, e o arnês acusou divergência de
   * período em quatro casos. A divergência era real e o defeito era do cenário:
   * as duas frases pedem JANELAS DIFERENTES, e um sistema que as tratasse como
   * a mesma coisa responderia a pergunta certa sobre o dia errado.
   *
   * Separá-las não afrouxa a régua — ao contrário, cada família passa a exigir
   * que o período SOBREVIVA à paráfrase dentro dela.
   */
  {
    nome: 'ver a agenda da semana',
    familia: 'agenda_ler',
    limpa: 'O que eu tenho essa semana?',
    variacoes: [
      { frase: 'me mostra minha agenda dessa semana', registro: 'parafrase' },
      { frase: 'quais compromissos eu tenho essa semana?', registro: 'parafrase' },
      { frase: 'tenho alguma reunião essa semana?', registro: 'parafrase' },
      { frase: 'oq eu tenho essa semana', registro: 'ruido' },
      { frase: 'tenho alguma reuniao essa semana', registro: 'ruido' },
    ],
  },
  {
    nome: 'ver a agenda de amanhã',
    familia: 'agenda_ler',
    limpa: 'Tenho alguma reunião amanhã?',
    variacoes: [
      { frase: 'o que eu tenho amanhã?', registro: 'parafrase' },
      { frase: 'quais são meus compromissos de amanhã?', registro: 'parafrase' },
      { frase: 'me mostra a agenda de amanhã', registro: 'parafrase' },
      { frase: 'tenho alguma reuniao amanha', registro: 'ruido' },
      { frase: 'oq tenho amanha', registro: 'ruido' },
    ],
  },
  {
    nome: 'mandar mensagem no WhatsApp',
    familia: 'whatsapp',
    limpa: 'Manda um whatsapp para o João avisando do atraso',
    variacoes: [
      { frase: 'avisa o João no zap que vai atrasar', registro: 'parafrase' },
      { frase: 'manda mensagem pro João no whatsapp sobre o atraso', registro: 'parafrase' },
      { frase: 'manda um zap pro João', registro: 'parafrase' },
      { frase: 'manda um whats pro Joao avisando do atrazo', registro: 'ruido' },
    ],
  },
  {
    nome: 'tirar print da tela',
    familia: 'captura',
    limpa: 'Tira um print da tela',
    variacoes: [
      { frase: 'captura a tela e salva nos documentos', registro: 'parafrase' },
      { frase: 'faz um print aí', registro: 'parafrase' },
      { frase: 'tira uma foto da tela', registro: 'parafrase' },
      { frase: 'tira um prin da tela', registro: 'ruido' },
    ],
  },
  {
    nome: 'centrais e frota por estado',
    familia: 'infraestrutura',
    limpa: 'Quantas centrais temos ativas?',
    variacoes: [
      { frase: 'quantos veículos tem a frota no MT?', registro: 'parafrase' },
      { frase: 'como está a operação por estado?', registro: 'parafrase' },
      { frase: 'me diz o número de centrais ativas', registro: 'parafrase' },
      { frase: 'quantas central ativas temos', registro: 'ruido' },
      { frase: 'quantos veiculo tem a frota no MT', registro: 'ruido' },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pares negativos — intenções diferentes que NÃO podem colapsar
// ---------------------------------------------------------------------------

export interface ParNegativo {
  readonly a: string;
  readonly b: string;
  /** Por que um humano diz que são coisas diferentes. Sai no relatório. */
  readonly porque: string;
  /** A dimensão em que a diferença TEM de aparecer. */
  readonly dimensao: 'objetivo' | 'rota' | 'proposito';
}

/**
 * O LADO QUE IMPEDE "ROBUSTO DEMAIS".
 *
 * Um índice que casa qualquer coisa com qualquer coisa faz a taxa de
 * convergência subir para 100% e destrói o produto: lembrete lido vira lembrete
 * criado, pergunta vira ordem. Estes pares são a única defesa do arnês contra a
 * própria métrica dele.
 */
export const PARES_NEGATIVOS: readonly ParNegativo[] = [
  {
    a: 'Quais lembretes eu tenho?',
    b: 'Me lembre de ligar para o cliente em 20 minutos',
    porque: 'ler o que já foi marcado não é marcar coisa nova — um lê, o outro escreve',
    dimensao: 'objetivo',
  },
  {
    a: 'O que tem na minha área de trabalho?',
    b: 'Cria uma pasta chamada Relatórios na área de trabalho',
    porque: 'listar não é criar; o segundo produz efeito no disco do operador',
    dimensao: 'objetivo',
  },
  {
    a: 'Vai chover hoje?',
    b: 'Que dia é hoje?',
    porque: 'as duas falam de hoje e nenhuma pergunta a mesma coisa',
    dimensao: 'objetivo',
  },
  {
    a: 'Leia meus emails recentes',
    b: 'Manda um whatsapp para o João avisando do atraso',
    porque: 'ler a própria caixa não é alcançar terceiro com mensagem',
    dimensao: 'objetivo',
  },
  {
    a: 'Quantas cargas foram coletadas essa semana?',
    b: 'Cancela o lembrete da reunião',
    porque: 'contagem sobre a planilha não é revogação de pendência',
    dimensao: 'objetivo',
  },
  {
    a: 'Quantas centrais temos ativas?',
    b: 'Qual central recebeu mais cargas?',
    porque:
      'a primeira conta centrais no cadastro; a segunda agrupa CARGAS por central — fontes diferentes, respostas diferentes',
    dimensao: 'objetivo',
  },
];

// ---------------------------------------------------------------------------
// Ambiguidade — casos em que a resposta certa é "não dá para saber sozinho"
// ---------------------------------------------------------------------------

export interface CasoAmbiguo {
  readonly frase: string;
  readonly porque: string;
}

/**
 * AMBIGUIDADE É RESULTADO VÁLIDO. Uma descoberta que sempre devolve um vencedor
 * mente sobre o que sabe: `A = 0,81` e `B = 0,79` são duas hipóteses, e a
 * diferença entre elas é ruído numérico, não evidência.
 *
 * Estes casos são elípticos ou genéricos de propósito — nenhum deles pode ser
 * decidido sem o turno anterior, que a descoberta ainda não enxerga (a lacuna
 * `contexto`, declarada em `Correspondencia`).
 */
export const CASOS_AMBIGUOS: readonly CasoAmbiguo[] = [
  {
    frase: 'e por central?',
    porque: 'elíptica: só o turno anterior diz agrupar O QUÊ por central',
  },
  {
    frase: 'e no mês passado?',
    porque: 'elíptica: refina um período sobre uma pergunta que não está na frase',
  },
  {
    frase: 'faz a mesma coisa pro outro',
    porque: 'dois referentes anafóricos sem antecedente na própria mensagem',
  },
  {
    frase: 'cancela',
    porque: 'cancelar lembrete, cancelar pendência de confirmação, ou abortar plano',
  },
];
