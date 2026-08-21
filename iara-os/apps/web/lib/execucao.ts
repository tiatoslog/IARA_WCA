/**
 * O CONTRATO DE EXECUÇÃO REMOTA — a única coisa que atravessa a ponte entre o
 * motor e as mãos.
 *
 * POR QUE ISTO EXISTE. Até aqui, o `AgenteLocal` era chamado dentro do próprio
 * processo do motor, e a arquitetura assumia — sem nunca dizer — que "a máquina
 * do operador" e "a máquina onde o motor roda" eram a mesma coisa. Enquanto o
 * motor subia no computador de cada pessoa isso era verdade. Desde que o motor
 * mudou para a nuvem (ver `apps/desktop/src-tauri/src/main.rs`, que já anunciava
 * esta fase), deixou de ser: um pedido vindo do celular chegava ao contêiner
 * Linux e tentava abrir o Bloco de Notas LÁ.
 *
 * A ponte não é "mais uma camada". Ela é o reconhecimento de um fato que já era
 * verdade e estava calado: entre a intenção e o efeito existe uma REDE, e rede
 * falha de maneiras que chamada de função não tem como falhar — o outro lado
 * pode não estar lá, pode receber e morrer, pode executar e não conseguir
 * contar. Cada um desses casos tem um nome nesta lista de estados, e nenhum
 * deles é `sucesso`.
 *
 * INVARIANTE CENTRAL: `sucesso` NUNCA é inferido do envio. Ele só existe quando
 * o lado que tem as mãos devolveu prova. É a mesma regra que o resto do sistema
 * já aplica à quinta porta (`Habilidade.verificar`), estendida à distância.
 *
 * Este arquivo mora em `lib/` porque é contrato compartilhado: o motor, o braço
 * e a projeção leem a mesma definição. Nenhum dos três importa código do outro.
 */

// ---------------------------------------------------------------------------
// O que pode ser pedido a um par de mãos
// ---------------------------------------------------------------------------

import { TIPOS_EVENTO_VISUAL, type EventoVisual, type JanelaObservada } from './percepcao';

/**
 * O catálogo FECHADO de ações que atravessam a ponte.
 *
 * Não existe `executar_comando`, e a ausência é a decisão mais importante deste
 * arquivo. Um campo de comando livre transformaria a ponte em shell remoto, e
 * a allowlist do `AgenteLocal` — que é revisada em commit — viraria decoração.
 * A LLM emite uma destas etiquetas ou não emite nada.
 */
export type AcaoDesktop =
  | 'abrir_aplicativo'
  | 'fechar_aplicativo'
  | 'criar_pasta'
  /**
   * ESCREVER ARQUIVO COM CONTEUDO — a familia que faltava, medida em
   * 20/08/2026: a operadora pediu "cria notas.txt com o texto X" e a IARA
   * recusou com honestidade porque a habilidade nao existia.
   *
   * Nome, nunca caminho — a mesma regra de `criar_pasta`, e a razao e a mesma:
   * caminho livre transforma a allowlist de locais em decoracao.
   */
  | 'criar_arquivo'
  | 'renomear_arquivo'
  | 'mover_arquivo'
  | 'copiar_arquivo'
  | 'listar_arquivos'
  | 'capturar_tela'
  | 'informacoes_sistema'
  /**
   * Separada de `informacoes_sistema`, e a separação é de contrato, não de
   * conveniência: aquela responde "como está o computador" com uma leitura
   * instantânea de `node:os`; esta AMOSTRA a máquina ao longo de uma janela
   * (CPU e processos são taxas, não valores) e custa segundos por isso. Fundir
   * as duas faria toda pergunta sobre memória pagar a sonda de processos.
   */
  | 'medir_desempenho'
  /**
   * `git pull --ff-only` num repositório da allowlist.
   *
   * A primeira ação do catálogo cujo alvo NÃO é um "local nomeado" (área de
   * trabalho, documentos, downloads) — é um repositório declarado, por apelido.
   * Está aqui, no mesmo contrato fechado das outras, exatamente porque a
   * tentação era outra: aceitar um caminho e deixar o `git` decidir. Um verbo
   * que altera código-fonte é o último lugar do sistema onde o alvo pode vir da
   * frase que a pessoa digitou.
   *
   * O que ela deliberadamente NÃO faz: merge, rebase, commit e push. Ver
   * `AgenteLocal.atualizarRepositorio` para o porquê de cada recusa.
   */
  | 'atualizar_repositorio';

export const ACOES_DESKTOP: readonly AcaoDesktop[] = [
  'abrir_aplicativo',
  'fechar_aplicativo',
  'criar_pasta',
  'criar_arquivo',
  'renomear_arquivo',
  'mover_arquivo',
  'copiar_arquivo',
  'listar_arquivos',
  'capturar_tela',
  'informacoes_sistema',
  'medir_desempenho',
  'atualizar_repositorio',
];

export function ehAcaoDesktop(v: unknown): v is AcaoDesktop {
  return typeof v === 'string' && (ACOES_DESKTOP as readonly string[]).includes(v);
}

// ---------------------------------------------------------------------------
// Estados
// ---------------------------------------------------------------------------

/**
 * A vida de uma execução, do pedido ao desfecho.
 *
 * Os estados intermediários não são enfeite de log: cada um responde a uma
 * pergunta diferente quando algo dá errado. `enviada_ao_dispositivo` sem
 * `recebida_pelo_dispositivo` é rede; `recebida_pelo_dispositivo` sem
 * `executando` é o braço travado; `executando` sem desfecho é a ação em si.
 * Sem essa granularidade, "não funcionou" é indistinguível de "não funcionou",
 * e é assim que se perde uma tarde procurando no lugar errado.
 */
export type EstadoExecucao =
  /** O motor recebeu o pedido e ele ainda não foi olhado. */
  | 'recebida'
  /** Conferindo ação, parâmetros e permissão — antes de qualquer envio. */
  | 'validando'
  /** Válida, esperando vez (há outra execução do mesmo operador em curso). */
  | 'enfileirada'
  /** Escrita no socket do dispositivo. NÃO significa que ele leu. */
  | 'enviada_ao_dispositivo'
  /** O braço confirmou que a ordem chegou. Ainda não começou. */
  | 'recebida_pelo_dispositivo'
  /** O braço começou. A partir daqui, repetir o pedido pode duplicar efeito. */
  | 'executando'
  /** Terminou E há prova. O único estado que autoriza a IARA a dizer "pronto". */
  | 'sucesso'
  /** Terminou e não deu certo. `codigo_erro` diz por quê. */
  | 'falhou'
  /** O prazo venceu sem desfecho. O efeito pode ter acontecido — ver abaixo. */
  | 'expirou'
  /** Alguém desistiu antes de o efeito começar. */
  | 'cancelada'
  /** Não havia mãos: nenhum braço conectado para este operador. */
  | 'dispositivo_ausente'
  /** Chegou de novo o que já foi executado. O relato devolvido é o do original. */
  | 'duplicada';

/**
 * O vocabulário FECHADO de estados, para a fronteira poder recusar o que não
 * existe. `ehTerminal` responde outra pergunta — "acabou?" — e usá-lo como
 * validador deixava passar `enfileirada` tanto quanto `sucesso!!`.
 */
export const ESTADOS_CONHECIDOS: readonly string[] = [
  'recebida',
  'validando',
  'enfileirada',
  'enviada_ao_dispositivo',
  'recebida_pelo_dispositivo',
  'executando',
  'sucesso',
  'falhou',
  'expirou',
  'cancelada',
  'dispositivo_ausente',
  'duplicada',
];

export const ESTADOS_TERMINAIS: readonly EstadoExecucao[] = [
  'sucesso',
  'falhou',
  'expirou',
  'cancelada',
  'dispositivo_ausente',
  'duplicada',
];

export function ehTerminal(e: EstadoExecucao): boolean {
  return ESTADOS_TERMINAIS.includes(e);
}

/**
 * `expirou` é o estado mais honesto e o mais desconfortável da lista.
 *
 * Ele NÃO quer dizer "não aconteceu". Quer dizer "não sei". O braço pode ter
 * aberto o Chrome e perdido a conexão antes de contar. Por isso a frase que a
 * IARA diz para `expirou` nunca é "não consegui" — é "não recebi confirmação",
 * que é a diferença entre relatar um fato e relatar a própria ignorância.
 */
export const ESTADOS_INCERTOS: readonly EstadoExecucao[] = ['expirou'];

// ---------------------------------------------------------------------------
// Erros
// ---------------------------------------------------------------------------

/**
 * O vocabulário fechado de falhas. Fechado porque a resposta ao operador é
 * escolhida a partir dele: um código novo sem frase correspondente produziria
 * ou silêncio, ou o texto técnico cru na cara de quem não pediu isso.
 */
export type CodigoErro =
  | 'DESKTOP_OFFLINE'
  | 'APP_NAO_ENCONTRADO'
  /**
   * O programa INICIOU e nenhuma janela apareceu na tela.
   *
   * Nasceu em 21/08/2026, do caso em que a IARA disse "Pronto. Abri o Bloco de
   * Notas" com a tela vazia. É deliberadamente distinto de
   * `APP_NAO_ENCONTRADO`: ali o programa não existe na máquina, aqui ele existe
   * e não se mostrou. As duas frases são diferentes porque as duas causas são
   * diferentes, e juntar as duas devolveria "não está instalado" sobre um
   * programa instalado.
   */
  | 'APP_SEM_JANELA'
  | 'ARQUIVO_NAO_ENCONTRADO'
  | 'PERMISSAO_NEGADA'
  | 'PARAMETRO_INVALIDO'
  | 'FERRAMENTA_INDISPONIVEL'
  | 'EXPIROU'
  | 'ERRO_DE_REDE'
  | 'FALHA_NA_EXECUCAO';

/**
 * Vale a pena tentar de novo?
 *
 * Só o que é transitório. `APP_NAO_ENCONTRADO` não fica menos ausente na
 * segunda tentativa, e repetir um pedido que falhou por permissão é como o
 * sistema aprende a ignorar a própria política.
 *
 * `EXPIROU` fica de FORA de propósito, e é a decisão mais delicada aqui: a ação
 * pode ter acontecido do outro lado. Repetir automaticamente uma execução de
 * desfecho desconhecido é exatamente como se abre o Chrome duas vezes — ou pior,
 * como se envia a mesma mensagem duas vezes. Quem decide repetir é o operador,
 * com a informação na frente.
 */
export const CODIGOS_ERRO: readonly CodigoErro[] = [
  'DESKTOP_OFFLINE',
  'APP_NAO_ENCONTRADO',
  'APP_SEM_JANELA',
  'ARQUIVO_NAO_ENCONTRADO',
  'PERMISSAO_NEGADA',
  'PARAMETRO_INVALIDO',
  'FERRAMENTA_INDISPONIVEL',
  'EXPIROU',
  'ERRO_DE_REDE',
  'FALHA_NA_EXECUCAO',
];

export const RETENTAVEL: Record<CodigoErro, boolean> = {
  DESKTOP_OFFLINE: true,
  ERRO_DE_REDE: true,
  APP_NAO_ENCONTRADO: false,
  /* Não retentável: a segunda tentativa encontra o mesmo programa residente e
     produz a mesma ausência de janela. Repetir aqui é o laço que a operadora
     viveu à mão — pediu duas vezes, ouviu "Pronto" duas vezes, viu nada. */
  APP_SEM_JANELA: false,
  ARQUIVO_NAO_ENCONTRADO: false,
  PERMISSAO_NEGADA: false,
  PARAMETRO_INVALIDO: false,
  FERRAMENTA_INDISPONIVEL: false,
  EXPIROU: false,
  FALHA_NA_EXECUCAO: false,
};

// ---------------------------------------------------------------------------
// Prova
// ---------------------------------------------------------------------------

/**
 * O que o lado das mãos APUROU depois de agir — conferindo o mundo, não o
 * próprio relato.
 *
 * Mesma forma de `Habilidade.Verificacao`, e é intencional: a prova nasce no
 * dispositivo e é entregue à quinta porta sem tradução. Traduzir seria a
 * oportunidade de perder a ressalva no caminho.
 *
 * `confirmado: false` não é sinônimo de falha. `motivo` separa "conferi e não
 * está lá" de "não tenho como conferir" — e a IARA fala diferente nos dois
 * casos, porque são coisas diferentes.
 */
export interface ProvaExecucao {
  readonly confirmado: boolean;
  readonly evidencia: string;
  readonly motivo?:
    | 'nao_encontrado'
    | 'divergente'
    | 'sem_meio_de_verificar'
    /**
     * O EFEITO JÁ ESTAVA NO MUNDO ANTES DO PEDIDO.
     *
     * Nasceu em 21/08/2026, de um achatamento que eu mesmo tinha feito: pedir
     * o Bloco de Notas com ele já aberto devolvia `sem_meio_de_verificar`, e
     * os dois estados não são o mesmo. `sem_meio_de_verificar` é IGNORÂNCIA —
     * não tenho como olhar. Este é CONHECIMENTO: eu olhei, e o que você pediu
     * já estava feito antes de eu chegar.
     *
     * A diferença muda a frase e muda o que a IARA pode concluir depois. Dizer
     * "não consigo provar" sobre algo que se observa perfeitamente é uma
     * mentira por modéstia — e ensina o operador a ignorar as ressalvas
     * verdadeiras.
     */
    | 'ja_estava_aberto';
}

// ---------------------------------------------------------------------------
// Ordem e relato
// ---------------------------------------------------------------------------

export interface OrdemExecucao {
  /** Ver `novaExecucaoId`. Acompanha o pedido do começo ao fim da cadeia. */
  readonly execucao_id: string;
  readonly acao: AcaoDesktop;
  readonly parametros: Record<string, unknown>;
  readonly id_usuario: string;
  /** O diálogo de origem. O braço o devolve; nada dele é interpretado lá. */
  readonly sessao: string;
  /**
   * A MÁQUINA QUE O OPERADOR ESCOLHEU, quando ele escolheu uma.
   *
   * `null` quer dizer "não escolhi" — e aí vale o padrão de sempre: o último
   * braço que conectou atende. Não quer dizer "qualquer uma": com o campo
   * preenchido, a ordem vai para ELA ou não vai (ver `EscolhaDeMaquina` e
   * `Braco.executar`).
   *
   * Viaja na ordem, e não só no roteamento, por duas razões: o jornal precisa
   * registrar QUAL máquina era a pretendida — sem isso, "a ação rodou no
   * escritório" não distingue escolha de acaso —, e o braço que recebe pode
   * conferir que a ordem era mesmo para ele.
   */
  readonly id_dispositivo_alvo: string | null;
  /** Teto de vida desta ordem, contado do envio. */
  readonly prazo_ms: number;
  readonly emitida_em: number;
}

export interface RelatoExecucao {
  readonly execucao_id: string;
  readonly estado: EstadoExecucao;
  /** O que a IARA tem para dizer ao operador. Nunca stack trace. */
  readonly texto: string;
  readonly prova: ProvaExecucao;
  readonly codigo_erro: CodigoErro | null;
  readonly duracao_ms: number;
  /** Qual dispositivo executou. `null` quando ninguém executou. */
  readonly dispositivo: string | null;
  /** Onde a ação de fato correu. `nenhum` quando ela não chegou a correr. */
  readonly onde: 'motor' | 'dispositivo' | 'nenhum';
  /**
   * O que a execução MEDIU, em estrutura — para quando o motor precisa raciocinar
   * sobre o resultado e não apenas repeti-lo ao operador.
   *
   * OPCIONAL, e a opcionalidade é o desenho. Um braço de versão anterior não
   * conhece este campo e continua respondendo só `texto`; quem depende dos dados
   * precisa tratar a ausência como LACUNA declarada, nunca como zero. É a mesma
   * regra de `null` em `SondasDesempenho`, atravessando a rede.
   *
   * NÃO é um canal de propósito geral para payload cru. Quem o preenche declara
   * o formato do lado do motor e o valida na chegada — o braço é outro processo,
   * possivelmente de outra versão, e nada que vem dele entra tipado por confiança.
   */
  readonly dados?: Readonly<Record<string, unknown>>;
}

export interface DescricaoDispositivo {
  readonly id_dispositivo: string;
  readonly nome: string;
  readonly plataforma: string;
  readonly versao: string;
  readonly conectado_em: number;
  readonly visto_em: number;
  /**
   * A credencial durável com que este braço se apresentou, quando há uma.
   *
   * `null` para quem entrou por `IARA_TOKEN` colado ou em modo local — que é o
   * caso do desenvolvimento e não deveria existir numa máquina de operadora.
   * O campo é o que costura o socket vivo à linha da tabela: sem ele, a mesma
   * máquina apareceria duas vezes na aba Dispositivos, uma como "conectada" e
   * outra como "pareada", e desconectar uma não faria nada com a outra.
   */
  readonly id_credencial?: string | null;
  /**
   * `null` sem atualização em curso; `0`–`100` durante o download — Etapa 2
   * (14/08/2026). `readonly` na declaração, mutado por cast pontual como
   * `visto_em` já era — é estado de socket, não identidade da máquina.
   */
  readonly atualizando: number | null;
  /** Motivo da última falha de atualização, ou `null`. Some sozinho na
   *  próxima tentativa — é o recado do agora, não um histórico. */
  readonly ultimoErroAtualizacao: string | null;
}

/**
 * UMA MÁQUINA, do ponto de vista de quem olha a aba Dispositivos.
 *
 * Funde duas fontes que o resto do sistema mantém separadas de propósito: o
 * socket vivo (`PonteDispositivos`, memória do processo) e a credencial gravada
 * (`Pareamento`, banco). A fusão acontece no servidor, e não na tela, porque
 * decidir se dois registros são "a mesma máquina" é conhecimento de domínio —
 * deixá-lo no cliente produziria uma resposta diferente por projeção.
 *
 * `conectada: false` com `pareada_em` preenchido é o estado normal de um
 * computador desligado, e não uma falha. É exatamente o que a operadora precisa
 * ver para entender por que um comando não chegou.
 */
/**
 * O ESTADO DE UMA MÁQUINA, com as dimensões SEPARADAS.
 *
 * A auditoria de 20/08/2026 nomeou o erro conceitual melhor do que este arquivo
 * o tinha nomeado:
 *
 *     versao == null  →  DESCONHECIDA
 *     e NÃO
 *     versao == null  →  desatualizada=false  →  a tela lê "atual"
 *
 * `pareada`, `conectada`, `selecionada` e `versão conhecida` são QUATRO
 * perguntas, e a tela vinha respondendo as quatro com dois booleanos. Um
 * vocabulário pobre demais para o que se quer dizer é como uma interface passa
 * a mentir sem ninguém escrever uma mentira.
 *
 * ================= O ESCOPO DA CONEXÃO =================
 *
 * `nao_conectada_aqui`, e não `desligada`. A diferença não é preciosismo: o
 * pareamento mora no banco COMPARTILHADO, e a conexão é por SERVIDOR. Um braço
 * ligado ao `iara.up.railway.app` aparece desconectado numa tela apontada para
 * o localhost — e "desligado" faria a tela afirmar sobre o computador o que ela
 * só sabe sobre este processo. A pessoa não distingue "está desligado" de "o
 * braço caiu", "o backend caiu" ou "está atendendo outra IARA".
 *
 * O QUE ESTE MÓDULO SE RECUSA A INVENTAR: `conectado_a_outro_backend`. O
 * `ultimo_uso_em` é carimbado na APRESENTAÇÃO, não em heartbeat (ver
 * `inventarioDeMaquinas`), então esta instalação NÃO TEM COMO SABER se a
 * máquina está atendendo outro servidor agora. Dizer que está exigiria um dado
 * que ninguém mede — o defeito que este módulo existe para fechar. O que dá
 * para fazer honestamente é escopar a frase, e é o que ele faz.
 *
 * Puro. Testado em `testes/status-da-maquina.test.ts`.
 */
export type ConexaoDaMaquina =
  /** Atendendo ESTE servidor agora. O único estado que autoriza o verde. */
  | 'atendendo'
  /** Pareada, já vista alguma vez, e não conectada a este servidor agora. */
  | 'nao_conectada_aqui'
  /** Pareada e nunca deu sinal. Diferente de "sumiu": nunca chegou. */
  | 'nunca_vista';

export type VersaoDaMaquina =
  | { readonly tipo: 'conhecida'; readonly valor: string }
  /** Ninguém leu. NÃO é "atual" e NÃO é "antiga". */
  | { readonly tipo: 'desconhecida' };

export interface StatusDaMaquina {
  readonly conexao: ConexaoDaMaquina;
  readonly versao: VersaoDaMaquina;
  /** Só quando a versão é CONHECIDA e inferior ao mínimo. */
  readonly desatualizada: boolean;
  /** É a máquina que vai receber as ações? Ortogonal a estar conectada. */
  readonly selecionada: boolean;
  /** Progresso de atualização, quando há uma em curso. */
  readonly atualizando: number | null;
  /** A frase que a tela mostra. Escopada: nunca afirma sobre o mundo. */
  readonly frase: string;
}

export function lerStatusDaMaquina(
  maquina: MaquinaDoOperador,
  selecionada: string | null,
): StatusDaMaquina {
  const versao: VersaoDaMaquina =
    typeof maquina.versao === 'string' && maquina.versao !== ''
      ? { tipo: 'conhecida', valor: maquina.versao }
      : { tipo: 'desconhecida' };

  const conexao: ConexaoDaMaquina = maquina.conectada
    ? 'atendendo'
    : maquina.vista_em === null
      ? 'nunca_vista'
      : 'nao_conectada_aqui';

  /* `desatualizada` EXIGE versão conhecida. Um `true` chegando com versão nula
     é contradição do contrato, e propagá-la seria acusar de antiga uma versão
     que ninguém leu. */
  const desatualizada = versao.tipo === 'conhecida' && maquina.desatualizada;

  const frase =
    conexao === 'atendendo'
      ? 'atendendo agora'
      : conexao === 'nunca_vista'
        ? 'ainda não se apresentou a esta IARA'
        : 'não está conectado a esta IARA';

  return {
    conexao,
    versao,
    desatualizada,
    selecionada: selecionada !== null && selecionada === maquina.id,
    atualizando: maquina.atualizando,
    frase,
  };
}

/**
 * A FRASE SOBRE A VERSÃO INSTALADA — três estados, e não dois.
 *
 * O DEFEITO, visto pela operadora em 20/08/2026: a folha da Automação dizia
 * *"Instalada em Homeoffice — na versão atual"* sobre uma máquina desligada
 * desde o dia 16, cuja versão ninguém tinha lido.
 *
 * A causa é uma inversão sutil. `desatualizada` é `false` quando `versao` é
 * `null` — o contrato se RECUSA, com razão, a acusar de antiga uma máquina que
 * não reportou versão nenhuma. A tela lia `every(m => !m.desatualizada)` e
 * concluía a afirmação OPOSTA sobre o mesmo dado inexistente. O silêncio
 * honesto virava garantia.
 *
 * Custo real: a folha diz que está tudo em dia, o computador não atende, e a
 * pessoa reinstala às cegas — que foi exatamente o que aconteceu.
 *
 * Puro, e por isso testável sem navegador: `testes/status-de-instalacao.test.ts`.
 */
export function frasearVersaoInstalada(maquinas: readonly MaquinaDoOperador[]): string {
  if (maquinas.length === 0) return '';

  /* Antiga vence tudo: é a única das três que pede uma ação da pessoa. */
  if (maquinas.some((m) => m.desatualizada)) {
    return ' — uma versão antiga espera o computador ligar';
  }

  /* SÓ QUEM REPORTOU VERSÃO foi conferido. `versao` só existe enquanto o
     socket existe — ver `inventarioDeMaquinas`. */
  const semConferir = maquinas.filter((m) => m.versao === null);
  if (semConferir.length === 0) return ' — na versão atual';

  if (semConferir.length === maquinas.length) {
    return maquinas.length === 1
      ? ' — não dá para conferir a versão enquanto ele estiver desligado'
      : ' — não dá para conferir a versão enquanto estiverem desligados';
  }

  /* Mistura: nomear quem ficou de fora, em vez de generalizar sobre o grupo.
     Uma máquina em dia não autoriza dizer que "estão" em dia — e a outra é
     justamente a que a pessoa não está conseguindo usar. */
  return ` — na versão atual onde deu para conferir; ${semConferir
    .map((m) => m.nome)
    .join(', ')} está desligado e não dá para saber`;
}

export interface MaquinaDoOperador {
  /** `id_credencial` quando pareada; o id de sessão quando não há credencial. */
  readonly id: string;
  readonly nome: string;
  readonly plataforma: string;
  /** `null` para uma máquina pareada que não está conectada agora. */
  readonly versao: string | null;
  readonly conectada: boolean;
  /** Pode ser desconectada/esquecida? Só o que tem credencial durável. */
  readonly pareada: boolean;
  readonly pareada_em: number | null;
  /** Última vez que esta máquina deu sinal — a "última sessão" da tela. */
  readonly vista_em: number | null;
  /**
   * Abaixo de `VERSAO_MINIMA_BRACO`? Ver `versaoBracoDesatualizada`.
   *
   * `false` quando `versao` é `null` — a máquina não está conectada agora, ou
   * nunca reportou versão nenhuma. Não afirmar desatualização sobre um dado
   * que não existe é a mesma disciplina que o resto do sistema já aplica a
   * `sem_meio_de_verificar`: silêncio é honesto, acusação sem prova não é.
   */
  readonly desatualizada: boolean;
  /**
   * `null` quando não há atualização em curso. `0`–`100` durante o download
   * — Etapa 2 do sistema de atualização (14/08/2026). Vem do próprio braço,
   * em tempo real, pelo mesmo socket que já carregava a versão; a gaveta
   * Dispositivos publica a mudança na hora (`aoMudarInventario`), não numa
   * varredura de 15 s — uma barra de progresso que atualiza a cada quinze
   * segundos não é barra de progresso.
   */
  readonly atualizando: number | null;
  /** Motivo da última falha de atualização, ou `null`. Some sozinho na
   *  próxima tentativa — é o recado do agora, não um histórico. */
  readonly erroAtualizacao: string | null;
}

/**
 * O MANIFESTO da versão atual do braço — Etapa 2/3 (14/08/2026).
 *
 * Fonte única do que o motor oferece para quem está atrasado: onde baixar,
 * a integridade esperada (SHA256, conferido pelo PRÓPRIO braço antes de
 * substituir qualquer coisa) e um resumo em português do que mudou. As três
 * variáveis de ambiente espelham o padrão já estabelecido por
 * `NEXT_PUBLIC_IARA_INSTALADOR` — a mesma variável de build, o mesmo
 * cuidado de deploy por Docker (`ARG` na imagem).
 *
 * `sha256` vazio é um estado válido, não um erro: numa instalação que ainda
 * não publicou o hash (ex.: alguém rodou `empacotar:braco` e esqueceu de
 * colar o valor impresso), a atualização automática simplesmente não é
 * oferecida — nunca se baixa e substitui um executável sem prova de
 * integridade. Ver `manifestoAtualizacaoDisponivel`.
 */
export interface ManifestoBraco {
  readonly versao: string;
  readonly url: string;
  readonly sha256: string;
  readonly notas: string;
}

export function lerManifestoBraco(): ManifestoBraco {
  return {
    versao: VERSAO_MINIMA_BRACO,
    url: process.env.NEXT_PUBLIC_IARA_INSTALADOR ?? '',
    sha256: (process.env.NEXT_PUBLIC_IARA_INSTALADOR_SHA256 ?? '').trim().toLowerCase(),
    notas: process.env.NEXT_PUBLIC_IARA_INSTALADOR_NOTAS ?? '',
  };
}

/** Há o que oferecer? URL e SHA256 são os dois que importam — sem os dois,
 *  não existe atualização automática segura para propor. */
export function manifestoAtualizacaoDisponivel(m: ManifestoBraco): boolean {
  return m.url.length > 0 && /^[0-9a-f]{64}$/.test(m.sha256);
}

/**
 * A VERSÃO MÍNIMA que o motor aceita sem avisar a operadora.
 *
 * Fonte única da verdade — Stage 1 do sistema de atualização (14/08/2026). O
 * braço já mandava a própria versão (`VERSAO` em `servidor/braco/principal.ts`)
 * no handshake desde sempre; o que faltava era ALGUÉM comparar. Esta constante
 * é esse alguém: sobe quando uma versão nova do braço exige um mínimo novo do
 * lado de quem já está instalado, e o valor abaixo dela é quando a operadora
 * passa a ver o aviso na gaveta Dispositivos.
 *
 * Isto NÃO baixa nem substitui o executável sozinho — essa é a Stage 2
 * (Updater separado, com validação de integridade), deliberadamente fora
 * deste escopo. Aqui só se detecta e avisa.
 */
/**
 * 1.3.0 (15/08/2026): abaixo disso, a Automação NÃO se recupera de uma
 * credencial recusada — ela reconecta em laço eterno, sem nunca mostrar código
 * novo, e a única saída da operadora é baixar o programa de novo. Uma máquina
 * nessas condições precisa aparecer como desatualizada no quadro para que a
 * atualização seja oferecida.
 */
export const VERSAO_MINIMA_BRACO = '1.3.0';

/**
 * Compara duas versões `major.minor.patch` (sem qualificador de pré-release).
 * Segmento ausente ou não numérico vira `0` — nunca lança, porque uma versão
 * malformada não pode derrubar a checagem inteira; ela só perde precedência.
 */
function compararVersoes(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const tamanho = Math.max(pa.length, pb.length);
  for (let i = 0; i < tamanho; i++) {
    const diferenca = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diferenca !== 0) return diferenca;
  }
  return 0;
}

/**
 * `versao` está abaixo de `VERSAO_MINIMA_BRACO`?
 *
 * `null` devolve `false` de propósito — ver o comentário do campo
 * `desatualizada` em `MaquinaDoOperador`. Igual à mínima NÃO é desatualizada:
 * o aviso é para quem está para trás, não para quem está em dia.
 */
export function versaoBracoDesatualizada(versao: string | null): boolean {
  if (!versao) return false;
  return compararVersoes(versao, VERSAO_MINIMA_BRACO) < 0;
}

// ---------------------------------------------------------------------------
// Identidade da execução
// ---------------------------------------------------------------------------

let contador = 0;

/**
 * A MARCA DESTE PROCESSO, e ela existe por causa de um defeito real.
 *
 * A primeira versão deste id era `IARA-<dia>-<contador>` e vinha acompanhada de
 * um comentário confiante: "não é chave global — dois motores geram a mesma
 * sequência —, e não precisa ser". Precisava.
 *
 * O QUE ACONTECEU, na primeira bateria de testes com braço real: o motor
 * reiniciou (recarga do `tsx watch`), o contador voltou para 1, e o braço — que
 * guarda os relatos por cinco minutos para poder responder a uma reentrega sem
 * executar duas vezes — encontrou `IARA-20260813-000002` no próprio cache. Só
 * que o `000002` DELE era um "abra o bloco de notas" de minutos antes, e a
 * ordem nova era "quanto de memória está sendo usada". Ele reenviou o relato
 * antigo. A IARA respondeu, com todas as letras, "Pronto. Abri o Bloco de Notas
 * no computador." para uma pergunta sobre memória — nada foi executado, e o
 * relato de sucesso era de outra ação.
 *
 * É a falha mais grave possível neste sistema, e ela não veio de um efeito
 * errado: veio de uma IDENTIDADE que se repetia. A proteção contra duplicidade,
 * construída para impedir mentira, passou a produzi-la.
 *
 * A marca é gerada uma vez por processo. Dois motores, ou o mesmo motor depois
 * de reiniciar, nunca mais compartilham prefixo — e um cache do outro lado da
 * rede não tem como confundir execuções de vidas diferentes.
 */
const MARCA_DO_PROCESSO = Math.floor(Math.random() * 0xffff)
  .toString(16)
  .padStart(4, '0');

/**
 * `IARA-20260813-a3f9-000123`.
 *
 * Data local porque quem lê um log procura por dia; marca do processo porque a
 * unicidade precisa sobreviver a um restart; contador porque dentro de um
 * processo o que se quer é ordem.
 *
 * Continua sendo um id de TRANSPORTE — ele responde "onde esta execução parou".
 * A identidade global de um EFEITO é do jornal (`RegistroOperacoes`), que a
 * resolve com impressão digital e nonce, e essa divisão não mudou.
 */
export function novaExecucaoId(agora = new Date()): string {
  const d = (n: number) => String(n).padStart(2, '0');
  const dia = `${agora.getFullYear()}${d(agora.getMonth() + 1)}${d(agora.getDate())}`;
  contador = (contador + 1) % 1_000_000;
  return `IARA-${dia}-${MARCA_DO_PROCESSO}-${String(contador).padStart(6, '0')}`;
}

// ---------------------------------------------------------------------------
// Pacotes da ponte
// ---------------------------------------------------------------------------

/** Braço → motor. */
export type PacoteBraco =
  | {
      tipo: 'apresentacao';
      id_usuario: string;
      token?: string;
      nome: string;
      plataforma: string;
      versao: string;
    }
  | { tipo: 'recebida'; execucao_id: string }
  | { tipo: 'executando'; execucao_id: string }
  | { tipo: 'concluida'; relato: RelatoExecucao }
  /**
   * ETAPA 2 (14/08/2026) — durante o download da versão nova, sem
   * `execucao_id` de propósito: isto NÃO é uma execução do catálogo, é o
   * braço se automantendo. `PonteDispositivos` trata os dois tipos abaixo
   * ANTES de repassar a `Braco.ts`, que só entende relato de execução.
   */
  | { tipo: 'progresso_atualizacao'; percentual: number }
  | { tipo: 'atualizacao_falhou'; motivo: string }
  /**
   * PERCEPÇÃO DE TELA (P0, 21/08/2026) — o único pacote que o laço de percepção
   * produz, e ele NUNCA carrega imagem.
   *
   * O quadro não chega nem ao processo do Braço: o helper devolve 32×32 tons de
   * cinza, o hash é calculado ali e o resto é descartado. Este pacote leva hash,
   * metadado mascarado e motivo. `lerEventoVisual` recusa qualquer chave fora da
   * lista — é assim que "não mande frame" deixa de ser combinado e vira porta.
   */
  | { tipo: 'percepcao'; evento: EventoVisual };

/** Motor → braço. */
export type PacoteMotor =
  | { tipo: 'bem_vindo'; id_dispositivo: string }
  | { tipo: 'recusado'; motivo: string }
  /**
   * A ORDEM DE ATUALIZAÇÃO carrega o SHA256 esperado, e não é decoração: o
   * braço confere o hash do que baixou ANTES de tocar no próprio executável.
   * Um valor que não bate nunca vira substituição — vira `atualizacao_falhou`
   * e a versão antiga continua rodando. Ver `manifestoAtualizacaoDisponivel`.
   */
  | { tipo: 'atualizar'; url: string; sha256: string; versao: string }
  | { tipo: 'executar'; ordem: OrdemExecucao }
  /**
   * O PEDIDO de percepção. **Não é uma ordem** — é um pedido, e a diferença é o
   * §8 inteiro: quem decide é a pessoa na frente da máquina, no console do
   * Braço. O motor pode pedir; ligar a observação da tela de alguém não é uma
   * coisa que se comanda de longe.
   *
   * `processos` é o escopo autorizado. Vem do motor porque é lá que se sabe qual
   * sistema o procedimento usa; vale no Braço porque é lá que ele é aplicado
   * antes de qualquer pixel ser lido.
   */
  | {
      tipo: 'percepcao_iniciar';
      sessao_percepcao: string;
      processos: readonly string[];
      /**
       * QUANDO O OPERADOR AUTORIZOU, na conversa. Ausente = ninguém autorizou
       * ainda, e o Braço PERGUNTA no próprio console antes de capturar.
       *
       * O campo existe para não perguntar duas vezes. Quando o consentimento já
       * foi dado no produto — e ele fica no jornal, com hora —, repetir a
       * pergunta no console do Braço treina a pessoa a aceitar sem ler, que é o
       * oposto do que um consentimento serve para fazer. Sem o campo, o caminho
       * antigo continua de pé: pergunta e espera.
       */
      autorizado_em?: string;
    }
  | { tipo: 'percepcao_encerrar'; sessao_percepcao: string; motivo: string };

const objeto = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const texto = (v: unknown, max = 200): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;

/**
 * Teto do texto que o braço devolve.
 *
 * NÃO é higiene de log: `RelatoExecucao.texto` sobe para a resposta do operador
 * e, por contrato, é insumo do próximo passo — ou seja, pode acabar no prompt.
 * Sem teto, um braço comprometido (ou apenas de uma versão com defeito) entrega
 * megabytes que atravessam o motor inteiro, engordam o snapshot e são cobrados
 * em tokens. `lerPacoteCliente` sempre limitou o que vem do navegador em 8000
 * caracteres; esta fronteira estava sem o equivalente, e ela é a que executa
 * coisas.
 */
/** Teto do escopo de percepcao. Uma lista longa de processos e o escopo se
 *  dissolvendo: autorizar quinze aplicacoes e autorizar a tela. */
const MAX_PROCESSOS_NO_ESCOPO = 5;

const MAX_TEXTO_RELATO = 8_000;
const MAX_EVIDENCIA = 2_000;

const MOTIVOS_PROVA: readonly string[] = ['nao_encontrado', 'divergente', 'sem_meio_de_verificar'];
const ONDES: readonly string[] = ['motor', 'dispositivo', 'nenhum'];

/**
 * O relato do braço, campo a campo — nunca `as RelatoExecucao` sobre o que veio
 * do socket.
 *
 * A versão anterior conferia quatro campos (`execucao_id`, `texto`,
 * `estado` como string qualquer, `prova.confirmado`) e repassava o OBJETO
 * INTEIRO com uma asserção de tipo. Tudo o mais — `estado` fora do vocabulário,
 * `evidencia` que não é texto, `codigo_erro` inventado, `onde` arbitrário,
 * `texto` de qualquer tamanho — entrava tipado por confiança num processo que
 * mora no computador de outra pessoa e pode ser de outra versão.
 *
 * Devolve `null` para qualquer desvio: um relato que não se deixa ler é um
 * relato que não aconteceu, e o prazo do Braço já sabe tratar silêncio.
 */
function lerRelato(bruto: unknown): RelatoExecucao | null {
  if (!objeto(bruto)) return null;
  if (!texto(bruto.execucao_id, 80)) return null;
  if (typeof bruto.texto !== 'string' || bruto.texto.length > MAX_TEXTO_RELATO) return null;
  if (typeof bruto.estado !== 'string' || !ESTADOS_CONHECIDOS.includes(bruto.estado)) return null;

  const p = bruto.prova;
  if (!objeto(p) || typeof p.confirmado !== 'boolean') return null;
  if (typeof p.evidencia !== 'string' || p.evidencia.length > MAX_EVIDENCIA) return null;
  if (p.motivo !== undefined && !MOTIVOS_PROVA.includes(p.motivo as string)) return null;

  if (bruto.codigo_erro !== null && bruto.codigo_erro !== undefined) {
    if (typeof bruto.codigo_erro !== 'string') return null;
    if (!(CODIGOS_ERRO as readonly string[]).includes(bruto.codigo_erro)) return null;
  }
  if (bruto.dispositivo !== null && bruto.dispositivo !== undefined && !texto(bruto.dispositivo, 80)) {
    return null;
  }
  if (bruto.onde !== undefined && !ONDES.includes(bruto.onde as string)) return null;
  if (bruto.dados !== undefined && !objeto(bruto.dados)) return null;

  return {
    execucao_id: bruto.execucao_id,
    estado: bruto.estado as EstadoExecucao,
    texto: bruto.texto,
    prova: {
      confirmado: p.confirmado,
      evidencia: p.evidencia,
      ...(p.motivo !== undefined ? { motivo: p.motivo as ProvaExecucao['motivo'] } : {}),
    },
    codigo_erro: (bruto.codigo_erro as CodigoErro | null) ?? null,
    duracao_ms:
      typeof bruto.duracao_ms === 'number' && Number.isFinite(bruto.duracao_ms) ? bruto.duracao_ms : 0,
    dispositivo: (bruto.dispositivo as string | null) ?? null,
    onde: (bruto.onde as RelatoExecucao['onde']) ?? 'dispositivo',
    ...(bruto.dados ? { dados: bruto.dados as Readonly<Record<string, unknown>> } : {}),
  };
}

/**
 * As chaves que um `EventoVisual` pode ter. LISTA FECHADA, e é ela que impede
 * um quadro de atravessar a rede.
 *
 * O requisito era "quero um teste que impeça o evento de carregar PNG, base64,
 * buffer ou screenshot". Procurar por esses nomes seria a defesa fraca — a lista
 * de formas de escrever "imagem" não tem fim, e é a mesma lição que fez `G4b` da
 * fronteira interna checar a IMPORTAÇÃO em vez do nome do método. Aqui a porta é
 * estreita e conhecida: se aparecer chave que não está nesta lista, o pacote
 * inteiro é recusado — não importa como ela se chame.
 */
const CHAVES_EVENTO_VISUAL: readonly string[] = [
  'tipo',
  'sessao_percepcao',
  'instante',
  'janela',
  'hash',
  'distancia',
  'origem',
  'motivo',
  'texto',
];

/**
 * Teto do texto observado num evento.
 *
 * `prepararTextoDaTela` já corta em 12 linhas de 120 caracteres; este é o teto
 * da FRONTEIRA, que não confia no que o outro lado prometeu cortar. Um braço de
 * outra versão — ou adulterado — não sobe a tela inteira como texto.
 */
const MAX_TEXTO_OBSERVADO = 2_000;

const CHAVES_JANELA: readonly string[] = ['processo', 'assinatura', 'largura', 'altura'];

const ORIGENS_OBSERVACAO: readonly string[] = ['hash_de_quadro', 'metadado_de_janela', 'ocr'];

/** Bits de um dHash de 64. Um `distancia` fora disto não veio deste sistema. */
const MAX_DISTANCIA = 64;

function lerJanelaObservada(bruto: unknown): JanelaObservada | null {
  if (!objeto(bruto)) return null;
  if (Object.keys(bruto).some((k) => !CHAVES_JANELA.includes(k))) return null;
  if (!texto(bruto.processo, 60)) return null;
  if (typeof bruto.assinatura !== 'string' || bruto.assinatura.length > 80) return null;
  const l = bruto.largura;
  const a = bruto.altura;
  if (typeof l !== 'number' || !Number.isFinite(l) || l < 0) return null;
  if (typeof a !== 'number' || !Number.isFinite(a) || a < 0) return null;
  return { processo: bruto.processo, assinatura: bruto.assinatura, largura: l, altura: a };
}

/**
 * O evento visual, campo a campo. `null` para qualquer desvio.
 *
 * NENHUM `as EventoVisual` sobre o que veio do socket: este pacote nasce num
 * processo que roda no computador de outra pessoa e pode ser de outra versão —
 * o mesmo argumento que já governa `lerRelato` logo acima.
 */
export function lerEventoVisual(bruto: unknown): EventoVisual | null {
  if (!objeto(bruto)) return null;
  if (Object.keys(bruto).some((k) => !CHAVES_EVENTO_VISUAL.includes(k))) return null;

  if (typeof bruto.tipo !== 'string') return null;
  if (!(TIPOS_EVENTO_VISUAL as readonly string[]).includes(bruto.tipo)) return null;
  if (!texto(bruto.sessao_percepcao, 80)) return null;
  if (!texto(bruto.instante, 40)) return null;
  if (typeof bruto.origem !== 'string' || !ORIGENS_OBSERVACAO.includes(bruto.origem)) return null;
  if (typeof bruto.motivo !== 'string' || bruto.motivo.length > 200) return null;
  if (bruto.texto !== undefined && bruto.texto !== null) {
    if (typeof bruto.texto !== 'string' || bruto.texto.length > MAX_TEXTO_OBSERVADO) return null;
  }
  const textoObservado = typeof bruto.texto === 'string' ? bruto.texto : '';

  let janela: JanelaObservada | null = null;
  if (bruto.janela !== null && bruto.janela !== undefined) {
    janela = lerJanelaObservada(bruto.janela);
    if (!janela) return null;
  }

  let hash: string | null = null;
  if (bruto.hash !== null && bruto.hash !== undefined) {
    if (typeof bruto.hash !== 'string' || !/^[0-9a-f]{16}$/.test(bruto.hash)) return null;
    hash = bruto.hash;
  }

  let distancia: number | null = null;
  if (bruto.distancia !== null && bruto.distancia !== undefined) {
    const d = bruto.distancia;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > MAX_DISTANCIA) return null;
    distancia = d;
  }

  /* SÓ `mudanca_visual` CARREGA HASH. Um `sessao_encerrada` com hash é um
     pacote que não nasceu deste laço — e um evento de ciclo de vida não tem
     nada que dizer sobre o conteúdo da tela de ninguém. */
  if (bruto.tipo !== 'mudanca_visual' && (hash !== null || distancia !== null)) return null;

  /* SÓ OS DOIS EVENTOS DE CONTEÚDO CARREGAM TEXTO. Um `sessao_encerrada` com o
     texto da tela dentro é um pacote que não nasceu deste laço — e um evento de
     ciclo de vida não tem nada que dizer sobre o que estava escrito na tela. */
  if (textoObservado && bruto.tipo !== 'mudanca_visual' && bruto.tipo !== 'mensagem_detectada') {
    return null;
  }

  return {
    tipo: bruto.tipo as EventoVisual['tipo'],
    sessao_percepcao: bruto.sessao_percepcao,
    instante: bruto.instante,
    janela,
    hash,
    distancia,
    origem: bruto.origem as EventoVisual['origem'],
    motivo: bruto.motivo,
    texto: textoObservado,
  };
}

/**
 * Validação estrutural na fronteira, nos DOIS sentidos.
 *
 * O braço valida o que vem do motor pela mesma razão que o motor valida o que
 * vem do braço: nenhum dos dois pode assumir que o outro é a versão que ele
 * espera. Um braço antigo conversando com um motor novo é o caso normal de um
 * produto instalado em máquina de gente, não a exceção.
 */
export function lerPacoteBraco(bruto: string): PacoteBraco | null {
  let v: unknown;
  try {
    v = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!objeto(v)) return null;

  switch (v.tipo) {
    case 'apresentacao':
      if (!texto(v.id_usuario, 120) || !texto(v.nome, 120)) return null;
      if (!texto(v.plataforma, 60) || !texto(v.versao, 60)) return null;
      if (v.token !== undefined && typeof v.token !== 'string') return null;
      return {
        tipo: 'apresentacao',
        id_usuario: v.id_usuario,
        nome: v.nome,
        plataforma: v.plataforma,
        versao: v.versao,
        ...(typeof v.token === 'string' ? { token: v.token } : {}),
      };
    case 'recebida':
    case 'executando':
      return texto(v.execucao_id, 80) ? { tipo: v.tipo, execucao_id: v.execucao_id } : null;
    case 'concluida': {
      const relato = lerRelato(v.relato);
      return relato ? { tipo: 'concluida', relato } : null;
    }
    case 'progresso_atualizacao':
      return typeof v.percentual === 'number' && Number.isFinite(v.percentual)
        ? { tipo: 'progresso_atualizacao', percentual: Math.max(0, Math.min(100, v.percentual)) }
        : null;
    case 'atualizacao_falhou':
      return texto(v.motivo, 500) ? { tipo: 'atualizacao_falhou', motivo: v.motivo } : null;
    case 'percepcao': {
      const evento = lerEventoVisual(v.evento);
      return evento ? { tipo: 'percepcao', evento } : null;
    }
    default:
      return null;
  }
}

export function lerPacoteMotor(bruto: string): PacoteMotor | null {
  let v: unknown;
  try {
    v = JSON.parse(bruto);
  } catch {
    return null;
  }
  if (!objeto(v)) return null;

  switch (v.tipo) {
    case 'bem_vindo':
      return texto(v.id_dispositivo, 80) ? { tipo: 'bem_vindo', id_dispositivo: v.id_dispositivo } : null;
    case 'recusado':
      return typeof v.motivo === 'string' ? { tipo: 'recusado', motivo: v.motivo } : null;
    case 'atualizar':
      if (!texto(v.url, 500) || !texto(v.versao, 60)) return null;
      if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256)) return null;
      return { tipo: 'atualizar', url: v.url, sha256: v.sha256, versao: v.versao };
    case 'percepcao_iniciar': {
      if (!texto(v.sessao_percepcao, 80)) return null;
      if (!Array.isArray(v.processos) || v.processos.length === 0) return null;
      if (v.processos.length > MAX_PROCESSOS_NO_ESCOPO) return null;
      const processos: string[] = [];
      for (const item of v.processos) {
        /* Nome de processo, nao caminho e nao curinga: o escopo e uma lista de
           aplicacoes autorizadas, e aceitar padrao livre aqui transformaria
           "observe o GW" em "observe tudo" com uma linha de configuracao. */
        if (typeof item !== 'string' || !/^[a-z0-9._-]{1,60}$/i.test(item)) return null;
        processos.push(item.toLowerCase());
      }
      if (v.autorizado_em !== undefined && !texto(v.autorizado_em, 40)) return null;
      return {
        tipo: 'percepcao_iniciar',
        sessao_percepcao: v.sessao_percepcao,
        processos,
        ...(typeof v.autorizado_em === 'string' ? { autorizado_em: v.autorizado_em } : {}),
      };
    }
    case 'percepcao_encerrar':
      return texto(v.sessao_percepcao, 80) && typeof v.motivo === 'string' && v.motivo.length <= 200
        ? { tipo: 'percepcao_encerrar', sessao_percepcao: v.sessao_percepcao, motivo: v.motivo }
        : null;
    case 'executar': {
      const o = v.ordem;
      if (!objeto(o) || !texto(o.execucao_id, 80) || !ehAcaoDesktop(o.acao)) return null;
      if (!objeto(o.parametros)) return null;
      if (!texto(o.id_usuario, 120) || !texto(o.sessao, 200)) return null;
      if (typeof o.prazo_ms !== 'number' || !Number.isFinite(o.prazo_ms)) return null;
      return {
        tipo: 'executar',
        ordem: {
          execucao_id: o.execucao_id,
          acao: o.acao,
          parametros: o.parametros,
          id_usuario: o.id_usuario,
          sessao: o.sessao,
          /* O ALVO ATRAVESSA A VALIDAÇÃO. Ausente vira `null` — pacote de um
             braço antigo, de antes da escolha existir, continua entrando. */
          id_dispositivo_alvo: texto(o.id_dispositivo_alvo, 120) ? (o.id_dispositivo_alvo as string) : null,
          prazo_ms: o.prazo_ms,
          emitida_em: typeof o.emitida_em === 'number' ? o.emitida_em : Date.now(),
        },
      };
    }
    default:
      return null;
  }
}
