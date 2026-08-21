/**
 * Contrato de Habilidade — o "App Intent" da IARA.
 *
 * A IARA nunca chama código diretamente. Ela declara que quer uma habilidade,
 * e o `GerenciadorHabilidades` decide se pode, valida os parâmetros, aplica
 * timeout e registra auditoria. O executor nunca é invocado sem passar por
 * essas quatro portas.
 *
 * Manifesto em TypeScript, não em `manifest.json`: o esquema precisa ser
 * verificado em tempo de compilação junto com o executor. JSON separado do
 * código é como se cria manifesto que mente sobre o que a habilidade faz.
 */

import type { CapacidadeAtiva } from '../../../lib/estado';
import type { Ilustracao } from '../../../lib/snapshot';
import type { Dominio } from '../../../lib/capacidades';
/* Ciclo APENAS de tipo — `Investigacao` importa `Risco` daqui e este arquivo
   importa `Evidencia` de lá. Os dois lados são `import type`, apagados na
   compilação: não existe aresta em runtime, e o vocabulário fica num lugar só
   em vez de ganhar uma cópia por conveniência de grafo. */
import type { Evidencia } from './Investigacao';
import type { Operacao, SemanticaEfeito } from './Operacao';
import type { RegistroOperacoes } from './RegistroOperacoes';
import type { RegistroErros } from './RegistroErros';

export type Permissao =
  | 'rede' // fala com a internet
  | 'banco' // lê dados da operação
  | 'memoria' // lê o shard privado do operador
  | 'llm' // gasta tokens
  | 'escrita' // altera algo na máquina onde o motor roda
  /**
   * Age no mundo EM NOME do operador, alcançando outra pessoa: manda mensagem,
   * envia e-mail, publica. Separada de `escrita` porque o risco é de outra
   * natureza — criar uma pasta errada se desfaz, uma mensagem enviada ao
   * destinatário errado não. Enquanto `escrita` é do operador, `externo` é do
   * administrador.
   */
  | 'externo';

/** Validação em runtime dos parâmetros. Simples de propósito: o kernel
 *  precisa disso rápido e sem dependência de biblioteca de schema. */
export interface CampoEsquema {
  tipo: 'texto' | 'numero' | 'booleano';
  obrigatorio?: boolean;
  /** Valores aceitos. Ausente = qualquer um do tipo. */
  dentre?: readonly string[];
  /**
   * SINÔNIMOS DECLARADOS — a tradução do vocabulário de gente para o da API.
   *
   * O DEFEITO (produção, 18/08/2026). A operadora perguntou "quantas cargas
   * temos no total?" e recebeu: *"Não executei isso. (…) `agrupar_por` fora dos
   * valores aceitos."* O `dentre` de `agrupar_por` é
   * `nenhum|motorista|rota|origem|destino|status`, e a LLM emitiu outra palavra
   * para dizer a mesma coisa. O turno morreu, e o nome de um parâmetro interno
   * foi parar na tela de quem só queria um número.
   *
   * A causa não é a validação — ela é trava de segurança e fica rígida. A causa
   * é ACOPLAMENTO: o modelo precisava adivinhar o vocabulário exato da API
   * interna, e uma palavra fora do enum matava o turno inteiro.
   *
   * TRADUÇÃO DECLARADA, NUNCA APROXIMAÇÃO. Nada de distância de edição nem de
   * "parece com": cada sinônimo é escrito à mão por quem conhece o domínio, o
   * mapa é dado do esquema como `dentre`, e o que não estiver nele continua
   * sendo recusado. Casamento aproximado transformaria `destino` em `origem`
   * num dia ruim — e responder a pergunta errada é o defeito que esta auditoria
   * inteira persegue.
   *
   * Comparado sem acento e em minúsculas, porque "rota" e "ROTA" e "rótulo de
   * rota" não são decisões de domínio diferentes.
   */
  sinonimos?: Readonly<Record<string, string>>;
  padrao?: unknown;
  /**
   * Teto de tamanho para `texto`. Ausente = `MAX_TEXTO_PADRAO`.
   *
   * O esquema não tinha limite nenhum, e a ausência tinha consequência real:
   * `consultar_memoria_corporativa` monta um índice de trigramas sobre o
   * parâmetro (O(n) em memória e tempo), e o valor vem de um plano emitido pela
   * LLM — que por sua vez pode estar repetindo um documento que alguém colou.
   * Um parâmetro de megabytes não é ataque sofisticado; é o que sai naturalmente
   * de um modelo instruído por uma página maliciosa a "repita este texto no
   * parâmetro".
   *
   * O padrão é generoso o bastante para toda habilidade real do catálogo e
   * pequeno o bastante para que nenhuma delas vire um laço caro por engano.
   */
  max?: number;
}

/** Teto de um campo `texto` que não declara o próprio. */
export const MAX_TEXTO_PADRAO = 4000;

export type Esquema = Record<string, CampoEsquema>;

/**
 * UM CONCEITO DA OPERAÇÃO e as palavras com que ele é dito.
 *
 * `{ nome: 'disponibilidade', termos: ['livre', 'vago', 'ocupado', 'horario'] }`
 *
 * `nome` é canônico e serve à NORMALIZAÇÃO (dois operadores dizendo "coletas" e
 * "cargas" falam do mesmo referente); `termos` servem à RECUPERAÇÃO (qualquer um
 * deles alcança a habilidade). Ver `ManifestoHabilidade.conceitos`.
 */
export interface ConceitoDeclarado {
  readonly nome: string;
  readonly termos: readonly string[];
}

/**
 * O QUE ESTA HABILIDADE FAZ COM O OBJETO — o vocabulário em que a compreensão e
 * o catálogo se comparam.
 *
 * Mora AQUI, e não na camada de compreensão, pela mesma razão que `risco` e
 * `conceitos`: o catálogo é a fonte de verdade e a política o lê. Se o tipo
 * vivesse do outro lado, o manifesto passaria a depender do interpretador.
 *
 * A fronteira que importa é leitura↔escrita. `leitura`, `contagem` e `analise`
 * não alteram nada e são intercambiáveis para efeito de rota; as outras cinco
 * só casam consigo mesmas.
 */
export type OperacaoSemantica =
  | 'leitura'
  | 'contagem'
  | 'analise'
  | 'criacao'
  | 'alteracao'
  | 'remocao'
  | 'envio'
  | 'execucao';

export interface ManifestoHabilidade {
  /** Verbo + objeto, em português: `consultar_clima`, `buscar_historico`. */
  readonly id: string;
  readonly nome: string;
  /**
   * Escrita PARA A LLM ler ao planejar, não para humano ler em documentação.
   * Descrição vaga produz plano vago — é o insumo mais barato de melhorar e o
   * mais fácil de negligenciar.
   */
  readonly descricao: string;
  /**
   * FRASES REAIS DE OPERADOR que devem alcançar esta habilidade — como foram
   * ditas, não como um manual as escreveria ("Quantas cargas vamos coletar
   * amanhã?", "Motoristas disponíveis agora?").
   *
   * Dois consumidores, e nenhum deles é documentação:
   *   · `DescobertaCapacidades` indexa os tokens — e token de exemplo é SINAL
   *     FORTE: um exemplo é evidência direta de que uma frase daquela família
   *     pertence a esta habilidade, coisa que a descrição só sugere.
   *   · `MotorRaciocinio.planejar()` mostra os exemplos à LLM junto com a
   *     descrição, para a escolha de habilidade ancorar em frase real.
   *
   * OPCIONAL NO TIPO, OBRIGATÓRIO NO CATÁLOGO: o teste de contrato
   * (`testes/habilidades.test.ts`) recusa habilidade de catálogo sem exemplos.
   * O tipo fica opcional para não quebrar habilidade injetada de teste.
   */
  readonly exemplos?: readonly string[];
  /**
   * Verbos de domínio que esta habilidade cobre ("contar cargas", "ranking de
   * motoristas"). Vocabulário de CAPACIDADE, não frase de operador — completa
   * o índice da descoberta onde a descrição é prosa demais.
   */
  readonly capacidades?: readonly string[];
  /**
   * OS SUBSTANTIVOS QUE ESTA HABILIDADE CONTA OU ENUMERA — no singular, sem
   * acento, minúsculos. `['carga', 'motorista', 'rota']`.
   *
   * Não é vocabulário de busca: `capacidades` e `exemplos` já alimentam o
   * índice de assunto da `DescobertaCapacidades`, que responde "esta frase
   * parece falar do que eu faço?". Este campo responde outra pergunta, mais
   * estreita e mais dura: **"um número sobre esta coisa só pode vir de
   * execução?"** — e é a trava de autoridade do Kernel que a faz.
   *
   * O DEFEITO QUE ISTO FECHA (auditoria de 21/08/2026). A trava vivia como uma
   * alternação escrita à mão dentro de `Kernel.ts`, fechada em seis
   * substantivos. Medida contra doze perguntas de cardinalidade legítimas da
   * operação, ela armava em duas: « quantas coletas tivemos esse mês? »,
   * « quantas OCIs foram abertas? » e « quantos lembretes eu tenho? » podiam
   * receber um número inventado pela LLM, sem execução nenhuma, digitado ao
   * vivo na tela do operador. O cabeçalho da trava dizia "A REGRA É GERAL"; a
   * medição dizia que ela era uma lista de seis palavras.
   *
   * POR QUE AQUI E NÃO LÁ. Uma habilidade nova que conta alguma coisa nasce
   * coberta pela trava sem que ninguém precise lembrar de editar uma regex em
   * outro arquivo — é a mesma disciplina de `risco` com o `PorteiroAutorizacao`
   * e de `idempotencia` com o `PortalEfeitos`: o dado é declarado por quem
   * conhece a habilidade, e a política o lê.
   *
   * O QUE NÃO DECLARAR, e a recusa é o que mantém a trava honesta. Só entram
   * substantivos da OPERAÇÃO — coisas que existem porque esta empresa existe.
   * "dia", "letra", "ano" não entram: um número sobre eles é conhecimento de
   * mundo, e armar a trava ali faria a IARA descartar "fevereiro tem 28 dias"
   * como afirmação sem procedência, que é punir a resposta certa.
   *
   * `central` também não entra, e por outro motivo: ela já tem oráculo próprio
   * (`PERGUNTA_DE_CENTRAIS` em `VerificacaoRuntime`) que sabe o VALOR certo, e
   * saber o valor vale mais que saber a procedência.
   */
  readonly entidades?: readonly string[];
  /**
   * OS CONCEITOS QUE ESTA HABILIDADE ATENDE — e as palavras com que as pessoas
   * os nomeiam.
   *
   * O DEFEITO QUE ISTO FECHA (auditoria de 21/08/2026, medido pelo arnês de
   * invariância). « Estou livre amanhã? » morria em conversa. O ato estava
   * certo (`perguntar`), o período estava certo (`amanhã`), e nada ligava
   * "livre" a `ver_agenda_calendario` — porque "livre" não aparece em manifesto
   * nenhum. O mesmo buraco, em outras roupas:
   *
   *     "coletas"   → devia recuperar o conceito de carga
   *     "caixa"     → devia recuperar e-mail
   *     "documentos"→ devia recuperar arquivo
   *
   * Não são quatro casos: é UMA lacuna — palavras diferentes para o mesmo
   * conceito — e é por isso que a correção é um campo declarado, não quatro
   * remendos.
   *
   * POR QUE AQUI E NÃO NO CÓDIGO. Se `livre → agenda` virasse regra dentro de
   * um módulo de interpretação, três dias depois alguém acrescentaria `vago`,
   * `sem reunião`, `tenho horário?`, `posso marcar?` — o ciclo que este projeto
   * inteiro persegue. O catálogo é a fonte de verdade: habilidade nova declara
   * os próprios conceitos e nasce recuperável sem que ninguém edite um `if`.
   * `testes/compreensao/aberto-fechado.test.ts` recusa vocabulário de domínio
   * dentro da camada de decisão, justamente para forçar a correção para cá.
   *
   * DUAS FUNÇÕES NUM CAMPO SÓ, e as duas precisam do mesmo dado:
   *   · RECUPERAÇÃO — `termos` alcança a habilidade ("livre" → agenda);
   *   · NORMALIZAÇÃO — `nome` é o conceito canônico, e é o que permite
   *     « coletas de agosto » e « cargas de agosto » terem o MESMO referente
   *     sem perder o que o operador escreveu.
   *
   * `nome` é o conceito; `termos` são as realizações lexicais dele, sem acento e
   * em minúsculas, no singular quando houver singular. Termo que não pertence
   * ao conceito é pior que termo faltando: recuperar a habilidade errada com
   * confiança é o defeito caro desta auditoria.
   *
   * O QUE ISTO NÃO É: autorização. Conceito recuperado PROPÕE candidato; quem
   * admite é a compatibilidade estrutural de operação — ver `IndiceConceitual`.
   * "criar arquivo" e "listar arquivo" compartilham conceito e são operações
   * opostas, e nenhuma similaridade pode fazer uma virar a outra.
   */
  readonly conceitos?: readonly ConceitoDeclarado[];
  /**
   * A OPERAÇÃO QUE ESTA HABILIDADE EXECUTA — declarada, não adivinhada.
   *
   * O DEFEITO QUE ISTO FECHA (Arnês C, 21/08/2026). A trava de compatibilidade
   * lia a operação do PREFIXO DO ID: `listar_arquivos` → leitura,
   * `criar_arquivo` → criação. Funciona porque o CLAUDE.md obriga `verbo_objeto`
   * — até a habilidade cujo id começa por substantivo. `informacoes_sistema`
   * saía `null`, e a trava RECUSAVA a habilidade por não conseguir classificá-la:
   *
   *     « como está o PC agora? »  →  informacoes_sistema INCOMPATÍVEL
   *
   * Uma trava que não sabe classificar barra o inocente, e o sintoma aparece
   * longe da causa — a habilidade certa some da lista sem explicação.
   *
   * O PROBLEMA NÃO É O `null`, É A FONTE. Inferir semântica de convenção de
   * nomenclatura mistura duas coisas: como a habilidade se CHAMA e o que ela
   * FAZ. São independentes, e no dia em que divergirem quem paga é a decisão.
   *
   * DECLARE quando o id não disser, ou quando disser errado. A inferência
   * continua existindo como conveniência para as 45 habilidades cujo id já é
   * honesto — mas ela é o padrão, não a verdade. `testes/compreensao/
   * conceitos.test.ts` recusa habilidade sem operação legível por nenhum dos
   * dois caminhos.
   */
  readonly operacao_semantica?: OperacaoSemantica;
  /**
   * ESTE EFEITO SÓ FECHA ALGO QUE O OPERADOR JÁ ABRIU — nunca origina nada.
   *
   * `resolver_confirmacao` exige uma pendência armada num turno anterior;
   * `cancelar_lembrete` exige um lembrete que alguém marcou; `assumir_plano`
   * exige uma proposta em cima da mesa. Nenhuma delas consegue produzir efeito
   * a partir do nada: a autorização veio antes, do próprio operador.
   *
   * POR QUE O CAMPO EXISTE (auditoria de 21/08/2026). O guarda que impede uma
   * PERGUNTA de compilar para efeito — ver `Planejador.recusarEscritaDePergunta`
   * — na primeira versão barrava « devo cancelar isso, certo? », e a pendência
   * de desligar a máquina seguia viva. O operador saía achando que tinha
   * desistido. `testes/cerebro-integridade-final.test.ts` já carregava a regra
   * escrita, do defeito anterior da mesma família:
   *
   *   "A assimetria do AgenteLocal: desistir nunca exige a prova que agir exige."
   *
   * O campo é essa assimetria em forma legível por código. Sem ele, a única
   * saída seria uma lista de ids dentro do guarda — e uma lista de nomes é
   * exatamente o que esta auditoria inteira existe para tirar do caminho.
   *
   * IDEMPOTÊNCIA NÃO SERVE PARA ISTO, e a tentação é forte. `resolver_confirmacao`
   * é `escrita_nao_idempotente` e `enviar_whatsapp` é `escrita_idempotente`:
   * a semântica de repetição não diz nada sobre quem autorizou o efeito.
   */
  readonly fecha_interacao_aberta?: boolean;
  /** Família a que pertence. Define o agrupamento no manifesto e na projeção. */
  readonly dominio: Dominio;
  /** Qual objeto da sala acende enquanto esta habilidade roda. */
  readonly capacidade: CapacidadeAtiva;
  readonly permissoes: readonly Permissao[];
  readonly timeout_ms: number;
  readonly custo: 'zero' | 'tokens';
  /**
   * Quanto custa errar com esta habilidade — e, portanto, quanta prova ela
   * exige antes e depois.
   *
   * `baixo`  consultar, ler, organizar. Nenhuma confirmação, nenhuma
   *          verificação (a resposta É o resultado).
   * `medio`  altera algo na máquina ou nos dados. Sem confirmação prévia, mas
   *          verificação obrigatória: criar pasta é reversível, afirmar que
   *          criou sem ter criado não é.
   * `alto`   irreversível ou alcança terceiro. Confirmação explícita ANTES,
   *          verificação DEPOIS.
   *
   * Risco é ortogonal a confiança. Uma intenção pode ter confiança 0,99 e
   * ainda assim exigir confirmação — ver `PoliticaDeRisco`.
   */
  readonly risco: Risco;
  /**
   * O QUE ACONTECE SE ISTO RODAR DUAS VEZES.
   *
   * Obrigatório, e obrigatório em tempo de COMPILAÇÃO: uma habilidade nova não
   * compila sem responder. É deliberado — a alternativa é um campo opcional que
   * ninguém preenche até o dia em que um reenvio chega ao cliente.
   *
   * Ortogonal a `risco`, e confundir os dois é o erro clássico. Risco governa
   * confirmação PRÉVIA (quanto custa errar); semântica governa DEDUPLICAÇÃO e
   * retry (quanto custa repetir). `criar_pasta` é risco médio e idempotente;
   * `abrir_aplicativo` é o mesmo risco e não idempotente. A política que trata
   * as duas igual erra uma das duas.
   *
   * Ver `Operacao.ts`. Quem declara `efeito_desconhecido` NÃO executa.
   */
  readonly idempotencia: SemanticaEfeito;
  readonly esquema: Esquema;
}

export type Risco = 'baixo' | 'medio' | 'alto';

export interface ContextoHabilidade {
  readonly sessao: string;
  readonly id_usuario: string;
  readonly parametros: Record<string, unknown>;
  readonly sinal: AbortSignal;
  /** Texto original do operador. Algumas habilidades precisam do bruto. */
  readonly enunciado: string;
  /**
   * O jornal das operações.
   *
   * Só as habilidades que ARMAM ou RESOLVEM uma autorização precisam disto —
   * hoje as duas de energia. As outras ignoram, e é bom que ignorem: uma
   * habilidade que mexe no jornal por conta própria é uma habilidade que pode
   * se autoautorizar. A máquina de transições impede o pior (nenhuma delas
   * consegue carimbar `verificador` num estado que não conferiu), mas o desenho
   * é este: quem executa não legisla.
   */
  readonly registro: RegistroOperacoes;
  /**
   * A operação que ESTE passo é. `null` para leitura — leitura não tem
   * identidade persistida, ver `Kernel.abrirOperacao`.
   */
  readonly operacao: Operacao | null;
  /**
   * Os defeitos cognitivos acumulados NESTA sessão, para quem audita.
   *
   * OPCIONAL, e a opcionalidade não é preguiça: o registro é por Kernel, e há
   * caminhos legítimos que executam habilidade sem um (testes de porta, e o
   * verificador quando roda isolado). Quem depende dele trata a ausência
   * dizendo que não conseguiu ler — nunca relatando "nenhum erro", que é a
   * mesma mentira de um diagnóstico que omite o que não conseguiu medir.
   *
   * Só a auditoria usa. Uma segunda habilidade precisando disto é o momento de
   * revisar se o lugar certo continua sendo o contexto.
   */
  readonly erros?: RegistroErros;
}

export interface ResultadoHabilidade {
  /** O que vira resposta ao operador (ou insumo do próximo passo). */
  readonly texto: string;
  /** Uma linha para o console técnico. Nunca payload cru. */
  readonly detalhe: string;
  /**
   * Habilidade pode declarar que não resolveu sem ser um erro.
   *
   * ATENÇÃO: isto é AUTODECLARADO. É o relato do executor, não a verdade — por
   * isso a procedência de um resultado cru é `resultado_ferramenta`, e só a
   * verificação a promove a `fato_verificado`. Nunca trate `resolveu: true`
   * como prova de que algo aconteceu no mundo.
   */
  readonly resolveu: boolean;
  /**
   * "NÃO RESOLVI PORQUE FALTA UM PARÂMETRO — e a resposta que eu dei pede
   * exatamente ele."
   *
   * É o que torna o multiturno possível sem adivinhação: o Kernel guarda
   * `{habilidade, parametros, parametro}` por UM turno, e se a próxima
   * mensagem for curta e não casar âncora nenhuma, ela vira o valor deste
   * parâmetro e a MESMA habilidade roda de novo — pelo caminho normal, com
   * esquema, porteiro e jornal intactos. Qualquer outra mensagem descarta a
   * pendência em silêncio (o operador mudou de assunto; insistir seria pior).
   *
   * Declarativo de propósito: a habilidade sabe O QUE falta; o Kernel sabe
   * COMO retomar. Nenhum dos dois conhece o outro além deste campo.
   */
  readonly pendencia?: { readonly parametro: string };
  /**
   * AS TELAS QUE ESTA RESPOSTA MOSTRA, quando a habilidade orienta a partir de
   * um documento que tinha captura. Vira `FalaProjetada.ilustracao`.
   *
   * Sobe pelo caminho de `texto`, e junto com ele: o Kernel só aproveita a
   * ilustração do passo cujo texto ele aproveitou. Um passo que o mundo
   * desmentiu perde os dois — a imagem sozinha continuaria orientando alguém a
   * clicar, calada, depois de a frase ter sido retirada por ser falsa.
   *
   * SÓ RECORTE DE DOCUMENTO. Ver `lib/snapshot.ts#Ilustracao`: nenhuma
   * habilidade tem licença para pôr aqui imagem que ela mesma desenhou.
   */
  readonly ilustracao?: Ilustracao | null;
  /**
   * OS NÚMEROS QUE ESTA HABILIDADE CALCULOU, TIPADOS — não a frase sobre eles.
   *
   * O DEFEITO QUE ESTE CAMPO FECHA: até aqui, todo número que uma habilidade
   * apurava virava `string` antes de sair dela. `dizerCobertura()` mora dentro
   * de `cargasLuft.ts` e é uma convenção de redação — nada obriga a próxima
   * habilidade a chamá-la, e o kernel não tem como SABER que a cobertura foi
   * 71%. Sem saber, ele não pode recusar uma afirmação sobre a população, não
   * pode calcular confiança e não pode se abster. As propriedades analíticas
   * boas deste repositório eram texto escrito à mão, habilidade por habilidade.
   *
   * OPCIONAL, E VAI CONTINUAR SENDO. A imensa maioria das habilidades — abrir
   * aplicativo, criar pasta, mandar mensagem — não apura número nenhum, e
   * obrigá-las a declarar evidência vazia seria cerimônia sem informação. O
   * campo é para quem calcula sobre um CONJUNTO de registros, que é onde "18%"
   * pode ser 18% de tudo ou 18% do que tinha preço, com a mesma frase.
   *
   * AUSÊNCIA NÃO É COBERTURA COMPLETA: `MotorCritica` trata evidência ausente
   * ou sem `cobertura` como "não declarada" e rebaixa a conclusão para
   * descritiva. Supor completa no silêncio transformaria esquecimento de quem
   * escreveu a habilidade em garantia sobre o mundo.
   */
  readonly evidencias?: readonly Evidencia[];
}

/**
 * O que a verificação apurou CONFERINDO O MUNDO, depois de executar.
 *
 * `confirmado: false` não quer dizer "falhou" — quer dizer "não consegui
 * provar". A distinção é o núcleo desta camada: `motivo` explica qual das duas
 * coisas aconteceu, e a resposta ao operador muda conforme.
 */
export interface Verificacao {
  readonly confirmado: boolean;
  /** Uma linha: o que foi conferido e o que se encontrou. */
  readonly evidencia: string;
  /** Preenchido quando `confirmado` é falso. */
  /**
   * Espelha `ProvaExecucao.motivo` de `lib/execucao.ts` — os relatos do braço
   * atravessam a fronteira e chegam aqui como `Verificacao`. Duas listas que
   * precisam concordar são duas chances de divergir; `ja_estava_aberto` entrou
   * nas duas no mesmo commit, e o `tsc` foi quem cobrou a segunda.
   */
  readonly motivo?:
    | 'nao_encontrado'
    | 'divergente'
    | 'sem_meio_de_verificar'
    | 'ja_estava_aberto';
}

export interface Habilidade {
  readonly manifesto: ManifestoHabilidade;
  /**
   * Faltou credencial ou dependência? Devolve o motivo; `null` significa
   * pronta para uso.
   *
   * Habilidade indisponível continua NO CATÁLOGO, e isso é deliberado: some do
   * que o Planejador pode pedir, mas aparece no manifesto para o operador ver
   * o que a IARA poderia fazer e o que falta ligar. Esconder o desligado é o
   * que faz um sistema parecer limitado quando na verdade está desconfigurado.
   */
  indisponivelPorque?(): string | null;
  executar(ctx: ContextoHabilidade): Promise<ResultadoHabilidade>;

  /**
   * Confere o MUNDO depois de executar. Opcional, e a ausência é significativa.
   *
   * Quem altera algo fora do processo DEVE implementar: é o que separa "pedi
   * para criar a pasta" de "a pasta existe". Quem só lê (clima, relógio,
   * consulta) não implementa — verificar uma leitura seria repetir a leitura,
   * pagando duas vezes por nenhuma garantia nova.
   *
   * A regra "toda habilidade de risco médio ou alto verifica" é imposta por
   * teste em `testes/verificacao.test.ts`, não pela boa vontade de quem
   * escreve a habilidade.
   */
  verificar?(resultado: ResultadoHabilidade, ctx: ContextoHabilidade): Promise<Verificacao>;
}

/** Pronta para uso agora? */
export function disponivel(h: Habilidade): boolean {
  return !h.indisponivelPorque || h.indisponivelPorque() === null;
}

// ---------------------------------------------------------------------------

export class ParametroInvalido extends Error {}
export class PermissaoNegada extends Error {}
export class HabilidadeExpirou extends Error {}

/**
 * Valida e normaliza contra o esquema. Rejeita chave desconhecida: parâmetro
 * que ninguém declarou é a porta por onde entra injeção vinda de um plano
 * gerado por LLM.
 */
/**
 * A palavra que a LLM emitiu vira a palavra que a API entende — ou fica como
 * está e a trava a recusa. Ver `CampoEsquema.sinonimos`.
 *
 * Comparação sem acento e em minúsculas: "MOTORISTA", "motorista" e "Motorista"
 * não são três decisões de domínio. O mapa continua sendo casamento EXATO da
 * forma normalizada — nunca aproximado.
 */
function traduzirSinonimo(valor: unknown, campo: CampoEsquema): unknown {
  if (typeof valor !== 'string' || !campo.sinonimos) return valor;
  const chave = valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
  return campo.sinonimos[chave] ?? valor;
}

export function validar(esquema: Esquema, entrada: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};

  for (const chave of Object.keys(entrada)) {
    /**
     * `Object.hasOwn`, NÃO `chave in esquema`.
     *
     * `in` caminha a cadeia de protótipos, e `esquema` é um objeto literal —
     * então `'__proto__' in esquema`, `'constructor' in esquema`,
     * `'toString' in esquema` e `'hasOwnProperty' in esquema` eram todos
     * VERDADEIROS. A porta que existe para recusar parâmetro não declarado
     * deixava passar, calada, a família inteira de nomes herdados de
     * `Object.prototype` — inclusive os que um payload de poluição de protótipo
     * usa por definição.
     *
     * Nada foi explorável por acidente: o laço de baixo percorre
     * `Object.entries(esquema)`, que é só de propriedades próprias, e nenhuma
     * dessas chaves chegava a `saida`. Mas uma trava que só não falha porque
     * outra coisa a compensa é uma trava que já falhou — e a compensação vai
     * embora no dia em que alguém trocar o laço de baixo por um `for...in`.
     *
     * Encontrado pela suíte adversarial, não por leitura. Ver
     * `zero-trust-adversarial.test.ts`, D1.
     */
    if (!Object.hasOwn(esquema, chave)) {
      throw new ParametroInvalido(`parâmetro não declarado: "${chave}"`);
    }
  }

  for (const [chave, campo] of Object.entries(esquema)) {
    const bruto = entrada[chave] ?? campo.padrao;

    if (bruto === undefined || bruto === null) {
      if (campo.obrigatorio) throw new ParametroInvalido(`falta "${chave}"`);
      continue;
    }

    const tipoReal = typeof bruto;
    const esperado =
      campo.tipo === 'texto' ? 'string' : campo.tipo === 'numero' ? 'number' : 'boolean';
    if (tipoReal !== esperado) {
      throw new ParametroInvalido(`"${chave}" deveria ser ${campo.tipo}, veio ${tipoReal}`);
    }

    /**
     * A TRADUÇÃO VEM ANTES DA TRAVA, E NÃO NO LUGAR DELA.
     *
     * O valor traduzido segue por TODAS as checagens seguintes — tamanho,
     * caractere de controle, o que vier depois. Um `continue` aqui pouparia
     * duas comparações e criaria um campo que atravessa a validação pela
     * metade; este arquivo já documenta, algumas linhas acima, por que uma
     * trava que só não falha porque outra a compensa é uma trava que já falhou.
     */
    const valor = campo.dentre ? traduzirSinonimo(bruto, campo) : bruto;

    if (campo.dentre && !campo.dentre.includes(String(valor))) {
      /* O enum ENTRA na mensagem. Sem ele, nem a operadora nem o modelo têm
         como saber o que era aceitável — e foi assim que "quantas cargas
         temos?" morreu sem resposta em produção, em 18/08/2026. */
      throw new ParametroInvalido(
        `"${chave}" fora dos valores aceitos (use um de: ${campo.dentre.join(', ')})`,
      );
    }
    if (campo.tipo === 'texto') {
      const teto = campo.max ?? MAX_TEXTO_PADRAO;
      if ((valor as string).length > teto) {
        throw new ParametroInvalido(`"${chave}" passa de ${teto} caracteres`);
      }
      /**
       * BYTE NULO E CONTROLE C0.
       *
       * Não é paranoia de fuzzing: o parâmetro chega a `path.join`, a nome de
       * arquivo e a corpo de requisicao HTTP. Um NUL trunca caminho em
       * várias APIs nativas, e `\r\n` num campo que vira cabeçalho é injeção de
       * cabeçalho. O tipo `texto` promete texto — recusar aqui é o que faz a
       * promessa valer para todas as habilidades de uma vez, em vez de cada
       * executor se lembrar sozinho.
       *
       * `\n` e `\t` passam: são texto legítimo em parâmetro de mensagem.
       */
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(valor as string)) {
        throw new ParametroInvalido(`"${chave}" contém caractere de controle`);
      }
    }
    if (campo.tipo === 'numero' && !Number.isFinite(valor as number)) {
      // `NaN` e `Infinity` são `typeof 'number'` e passariam pela checagem de
      // tipo acima. Nenhum executor do catálogo sabe o que fazer com eles.
      throw new ParametroInvalido(`"${chave}" não é um número finito`);
    }
    saida[chave] = valor;
  }

  return saida;
}
