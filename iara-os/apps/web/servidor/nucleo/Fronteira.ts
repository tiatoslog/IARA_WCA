/**
 * A FRONTEIRA — o que é estado interno da IARA e o que alcança o mundo.
 *
 * A auditoria anterior fechou a rota de fuga do WhatsApp e declarou duas
 * exclusões: `MemoriaOperacional` e o jornal ficariam FORA do `PortalEfeitos`.
 * A justificativa era boa — roteá-los criaria regressão infinita, porque o
 * portal grava no jornal para registrar que vai gravar na memória, e o jornal é
 * memória. Mas uma justificativa boa não é uma prova, e uma exclusão que vive só
 * num parágrafo de relatório é uma exclusão que ninguém consegue defender daqui
 * a seis meses.
 *
 * Este arquivo transforma a exclusão em CONTRATO. Ele não tem comportamento em
 * tempo de execução: é uma declaração, lida por `testes/fronteira-interna.test.ts`,
 * que faz análise de GRAFO DE CHAMADAS — não `grep` — e prova que:
 *
 *   1. nenhum módulo de ESTADO INTERNO alcança, nem transitivamente, um módulo
 *      capaz de produzir efeito externo;
 *   2. o registro nunca chama o portal (`Portal → Registro`, jamais o inverso);
 *   3. todo módulo que toca um provedor ou executor está declarado aqui.
 *
 * A terceira regra é a que sobrevive ao tempo: um arquivo novo que alcance a
 * rede, o disco ou o shell e não esteja declarado FAZ A SUÍTE FALHAR. A pessoa
 * que o escrever é obrigada a classificá-lo, e classificar é o momento em que
 * ela pensa sobre o que está fazendo.
 */

/**
 * ESTADO INTERNO — o que a IARA sabe sobre si mesma e sobre a conversa.
 *
 * Persistem em disco e em banco, e nada disso é efeito no mundo: ninguém além
 * da própria IARA lê essas tabelas, nenhum terceiro é alcançado, nada é
 * irreversível de forma observável fora do processo. Repetir uma gravação de
 * histórico produz uma linha a mais num log que só o motor consulta.
 *
 * A pergunta que separa esta lista da de baixo NÃO é "escreve em algum lugar?" —
 * as duas escrevem. É: **alguém fora da IARA percebe?**
 */
export const ESTADO_INTERNO: readonly string[] = [
  // Histórico, shards, preferências e insights do operador.
  'servidor/nucleo/MemoriaOperacional.ts',
  /**
   * Lembretes do operador. Passa nesta lista pela mesma pergunta que decide
   * todas as outras: alguém fora da IARA percebe? Não. Um lembrete gravado não
   * manda mensagem, não marca compromisso em calendário de terceiro, não sai do
   * processo. Quando vence, quem fala é a própria IARA, pelo canal de sempre.
   */
  'servidor/nucleo/Agenda.ts',
  // Cliente do banco onde o estado interno mora.
  'servidor/nucleo/ClienteSupabase.ts',
  /**
   * A SESSÃO DO BRAÇO — a credencial deste computador, em disco.
   *
   * Classificar isto deu trabalho, e o caminho errado vale ficar escrito. A
   * primeira tentativa foi `EFEITO_EXTERNO`, pelo argumento de que o refresh
   * token ROTA no Supabase e escreve arquivo. A suíte recusou, e recusou com
   * razão: `G3` exige que todo `EFEITO_EXTERNO` só seja alcançado pelo portal,
   * e o braço não passa nem pode passar por ele — o braço não é uma habilidade,
   * é um processo cliente que ainda nem conectou.
   *
   * A pergunta que decide esta lista é a do cabeçalho: **alguém fora da IARA
   * percebe?** Renovar a própria sessão é a IARA se identificando, não a IARA
   * agindo sobre o mundo de alguém. É exatamente a mesma natureza do
   * `ClienteSupabase` logo acima, que também abre rede e também é estado
   * interno. O efeito no disco do operador que esta camada existe para vigiar é
   * o `criar_pasta` que ele PEDIU — não o arquivo de sessão que o programa
   * precisa para funcionar.
   *
   * O que sustenta a classificação, e não é boa-fé: este módulo importa
   * `node:fs`, `node:os` e `node:path`, e mais nada. Ele não alcança
   * `AgenteLocal`, nem shell, nem provedor de terceiro — `G1` prova isso pelo
   * grafo. O POST que ele faz está declarado em `POST_SEM_EFEITO`.
   */
  'servidor/braco/credencial.ts',
  /**
   * O PAREAMENTO DO LADO DO COMPUTADOR — o cliente das rotas `/parear/*`.
   *
   * A classificação foi refeita do zero em vez de herdada de `credencial.ts`
   * logo acima, e vale registrar por quê: os dois módulos são vizinhos e fazem
   * coisas diferentes. Aquele grava um arquivo; este faz dois POST. Copiar o
   * rótulo do vizinho é exatamente o hábito que fez `habilidades/agenteLocal.ts`
   * ser classificado como LEITURA INTERNA — verdade sobre o `node:fs`, mentira
   * sobre o arquivo.
   *
   * A pergunta do cabeçalho, respondida para ESTE módulo: alguém fora da IARA
   * percebe? Não. Os dois POST são contra o MOTOR DA PRÓPRIA IARA — o primeiro
   * cria uma linha efêmera na memória daquele processo, o segundo lê uma
   * resposta. Nenhum terceiro é alcançado, nada de ninguém é criado ou
   * entregue, e o que muda é a identidade que ESTE processo passa a carregar.
   *
   * `EFEITO_EXTERNO` foi descartado pelo mesmo argumento estrutural que barrou
   * `credencial.ts`: `G3` exige que todo efeito externo só seja alcançado pelo
   * portal, e o braço não passa nem pode passar por ele — ele nem conectou
   * ainda. O que sustenta a classificação, e não é boa-fé: este módulo importa
   * `./credencial` e mais nada. Não abre `node:fs`, não abre shell, não alcança
   * o `AgenteLocal` — `G1` prova isso pelo grafo. Os POST estão declarados em
   * `POST_SEM_EFEITO`.
   */
  'servidor/braco/pareamento.ts',
  /**
   * O PAREAMENTO DO LADO DO MOTOR — códigos efêmeros e credenciais de
   * dispositivo.
   *
   * Escreve numa tabela do Supabase, e é isso que o traz para esta declaração.
   * Pela pergunta que separa as duas listas, é estado interno pelo mesmo motivo
   * que `MemoriaOperacional`: ninguém além da própria IARA lê essa tabela,
   * nenhum terceiro é alcançado, e o que ela guarda é o registro da IARA sobre
   * si mesma — quais mãos ela reconhece.
   *
   * A tentação de chamar isto de EFEITO EXTERNO existe e tem um argumento
   * respeitável: emitir uma credencial é conceder poder de execução no
   * computador de alguém. Mas o poder não é concedido AQUI — ele é exercido na
   * `PonteDispositivos`, que é PONTE DE EXECUÇÃO, e o efeito no mundo continua
   * nascendo no `AgenteLocal`, que é EFEITO EXTERNO. Este módulo grava um hash
   * e o compara depois. Classificá-lo como efeito externo o obrigaria a passar
   * pelo portal — e o portal existe para operações que a LLM propõe e o
   * operador autoriza, o que não descreve nada do que acontece aqui.
   */
  'servidor/nucleo/Pareamento.ts',
  // O jornal das operações. É a AUDITORIA, não um executor — ver `Fase 3`.
  'servidor/nucleo/kernel/RegistroOperacoes.ts',
  // Estado cognitivo em memória; nada atravessa o processo.
  'servidor/nucleo/EstadoAtomico.ts',
  'servidor/nucleo/kernel/MemoriaTrabalho.ts',
  'servidor/nucleo/kernel/RegistroErros.ts',
  /**
   * O VERIFICADOR DE RUNTIME. Abre `node:fs` para LER a base determinística e
   * comparar com o que a IARA afirmou — leitura, e só.
   *
   * A tentação de classificá-lo como efeito existe porque ele participa da
   * decisão de gastar dinheiro (a escalada ao pool premium). Mas o gasto não
   * nasce aqui: este módulo devolve `valido | invalido | inconclusivo`, e quem
   * decide é `EscaladaDoTurno` contra o `OrcamentoDoTurno`. Um verificador que
   * passasse pelo portal também seria um verificador que a LLM poderia propor
   * — e o portal existe justamente para o que a LLM propõe.
   */
  'servidor/nucleo/kernel/VerificacaoRuntime.ts',
];

/**
 * EFEITO EXTERNO — daqui alguém de fora percebe.
 *
 * Rede que alcança terceiro, processo do sistema operacional, arquivo no disco
 * do operador. Todo módulo desta lista só pode ser alcançado ATRAVÉS do
 * `PortalEfeitos`, e é isso que o teste de grafo prova.
 */
export const EFEITO_EXTERNO: readonly string[] = [
  // Cliente do provedor: POST ao Graph da Meta.
  'servidor/canais/WhatsApp.ts',
  // `spawn` (shell) e `mkdir` (disco do operador).
  'servidor/nucleo/AgenteLocal.ts',
  /**
   * O SEGUNDO CLIENTE DO WHATSAPP — envio proativo, não resposta a webhook.
   *
   * `servidor/canais/WhatsApp.ts` já cobria a metade REATIVA (responder quem
   * escreveu, via `PortaWhatsapp` → `PortalEfeitos`). A habilidade
   * `enviar_whatsapp` precisa da metade PROATIVA — a IARA inicia a mensagem —
   * e essa metade usa o desenho R2 de `acionar_energia`: arma uma pendência,
   * exige "confirmo" do MESMO operador, e só então efetiva. É um fluxo
   * síncrono demais para o portal reativo (a Meta responde dentro da mesma
   * chamada que confirma, e `resolver_confirmacao` precisa gravar esse
   * resultado no MESMO jornal antes de devolver a fala) — por isso ganhou
   * cliente próprio em vez de reaproveitar `integracoes/whatsapp.ts`.
   *
   * Continua sendo EFEITO EXTERNO — mandar mensagem para um contato real é
   * exatamente o que essa categoria existe para marcar — e continua só
   * alcançável pelo caminho que `G3` prova: `AgenteLocal.ts` o importa, e
   * `AgenteLocal.ts` só é alcançado pelo catálogo (`resolver_confirmacao`),
   * que é o portal.
   */
  'servidor/nucleo/ClienteWhatsapp.ts',
  /**
   * A CRIAÇÃO DE EVENTO NO GOOGLE CALENDAR — mesmo desenho R2 de
   * `ClienteWhatsapp.ts`, mesma pergunta respondida "sim": um evento real,
   * visível no calendário/telefone do operador, é exatamente a fronteira que
   * o comentário de `Agenda.ts` (acima, em ESTADO_INTERNO) cita como o que
   * tornaria um lembrete efeito externo — "não marca compromisso em
   * calendário de terceiro". Este módulo marca.
   *
   * Separado de `ClienteGoogleCalendario.ts` (LEITURA_EXTERNA, abaixo) de
   * propósito: aquele só lê, este só cria. Um arquivo só com as duas funções
   * tornaria as duas categorias indistinguíveis para `G5` (categorias
   * disjuntas por MÓDULO, não por função dentro do módulo).
   *
   * Só alcançável via `AgenteLocal.ts`: `pedirCriarEventoCalendario` arma a
   * pendência sem chamar o Google; quem de fato chama é
   * `confirmarCriarEventoCalendario`, disparado por `resolver_confirmacao`
   * em `habilidades/agenteLocal.ts` — já porteiro.
   */
  'servidor/nucleo/ClienteGoogleCalendarioEscrita.ts',
];

/**
 * A FRONTEIRA em si. Só ela, e os adaptadores que ela registra, podem alcançar
 * a lista de cima.
 */
export const PORTAL = 'servidor/nucleo/kernel/PortalEfeitos.ts';

/**
 * LEITURA EXTERNA — sai para a rede e não muda nada.
 *
 * Categoria própria, e não um apêndice de `EFEITO_EXTERNO`, porque a diferença
 * governa o que o sistema precisa garantir. Uma consulta repetida devolve a
 * mesma coisa: não há duplicidade a evitar, não há o que verificar, não há o que
 * autorizar. Tratá-las como efeito encheria o jornal de linhas inúteis e, pior,
 * ensinaria a equipe a ignorar o jornal.
 *
 * Continuam declaradas porque saem do processo — e o que sai do processo é
 * sempre matéria de auditoria, mesmo quando é inofensivo.
 */
export const LEITURA_EXTERNA: readonly string[] = [
  'servidor/nucleo/BuscaWeb.ts', // busca na web
  'servidor/nucleo/OrquestradorAcoes.ts', // previsão do tempo
  'servidor/nucleo/Voz.ts', // síntese de voz: texto entra, áudio sai
  // Transcrição de fala: áudio entra, texto sai. O espelho do `Voz.ts` — e o
  // único módulo daqui por onde sai a VOZ do operador, não conteúdo que a IARA
  // produziu. Não muda nada no provedor; muda o que este sistema expõe.
  'servidor/nucleo/Transcricao.ts',
  // Microsoft Graph: lê e-mail e busca no SharePoint. Ver `POST_SEM_EFEITO`
  // para o POST de busca — é consulta, não escrita.
  'servidor/nucleo/ClienteGraph.ts',
  /**
   * Google Calendar — SÓ LEITURA de eventos, mais a obtenção do próprio
   * token de acesso (conta de serviço). Ver `POST_SEM_EFEITO`: o POST que
   * troca o JWT por access token não cria nem altera nada no calendário de
   * ninguém — é autenticação, mesma classe do `renovarTokenGraph` da
   * Microsoft Graph. A CRIAÇÃO de evento é outro módulo — ver
   * `ClienteGoogleCalendarioEscrita.ts` em EFEITO_EXTERNO, acima.
   */
  'servidor/nucleo/ClienteGoogleCalendario.ts',
  // Lê a planilha de cargas da operação LUFT via Graph. Só GET — nada é
  // criado, alterado nem entregue a ninguém no SharePoint.
  'servidor/nucleo/ClientePlanilhaOcis.ts',
  // Inferência local via Ollama: o prompt entra, o texto volta. Mesmo caso do
  // TTS — ver a justificativa do POST em `POST_SEM_EFEITO`.
  'servidor/nucleo/ClienteOllama.ts',
  // Inferência nas camadas gratuitas (Groq, Gemini). Mesma classe do Ollama e
  // do ClienteClaude: prompt entra, texto volta em stream, nada é criado nem
  // alterado em serviço nenhum. A diferença em relação ao Ollama é o lugar —
  // nuvem de terceiro, não a máquina do operador —, e por isso o conteúdo que
  // sai daqui é o mesmo que já sai para a Anthropic hoje.
  'servidor/nucleo/ClienteCompativelOpenAI.ts',
  // Sonda de diagnóstico dos provedores de raciocínio: um GET que LISTA modelos
  // em cada um (`/v1/models`, `/api/tags`). Não gera texto, não gasta cota e não
  // manda conteúdo do operador para lugar nenhum — o corpo da requisição é
  // vazio, e o que sai é a chave de API no cabeçalho, para o mesmo provedor que
  // já a recebe em toda inferência. Existe para o painel poder dizer "a chave do
  // Gemini foi aceita" sem queimar um pedido de raciocínio para descobrir.
  'servidor/nucleo/DiagnosticoProvedores.ts',
  // Análise visual (18/08/2026) — a mesma classe do `ClienteCompativelOpenAI`
  // e do `ClienteClaude`: imagem + pergunta entram, texto (e uma coordenada
  // normalizada) volta, nada é criado nem alterado em serviço nenhum. Cadeia
  // própria (Groq → Gemini → Anthropic) por razão de custo — ver ADR-1 em
  // `docs/prd/test-plan.md` — mas a classificação de fronteira é idêntica à
  // dos provedores de texto: LEITURA.
  'servidor/nucleo/AnaliseVisual.ts',
];

/**
 * LEITURA INTERNA — abre o disco e só lê.
 *
 * Categoria criada na auditoria de terceira ordem, e a razão é um defeito do
 * próprio teste que a antecedeu. A checagem original procurava NOMES DE MÉTODO
 * (`writeFile(`, `spawn(`…), e um módulo que importasse `node:fs` e usasse
 * `createWriteStream` ou `writeFileSync` passaria batido — a regex não conhece
 * todas as formas de escrever num arquivo, e nunca vai conhecer.
 *
 * A checagem passou a ser por IMPORTAÇÃO: quem abre `node:fs` ou
 * `node:child_process` precisa estar declarado em alguma categoria. Isso obrigou
 * a nomear os que só leem — e nomear é o ponto, porque o dia em que um deles
 * passar a escrever, a declaração vira mentira e alguém precisa mexer aqui.
 */
export const LEITURA_INTERNA: readonly string[] = [
  'servidor/nucleo/RagHistorico.ts', // lê o histórico de incidentes
  'servidor/nucleo/kernel/habilidades/dados.ts', // lê documentos
  // Lê planilha genérica (.xlsx/.xls) de dados/documentos/. Mesmo disco de
  // `dados.ts`, sem rede — por isso LEITURA_INTERNA, não LEITURA_EXTERNA
  // (essa é onde `ClientePlanilhaOcis.ts` vive, por buscar via Graph).
  'servidor/nucleo/PlanilhaGenerica.ts',
  /**
   * A allowlist de repositórios onde um agente de código pode trabalhar. Toca o
   * disco só para VALIDAR o que a configuração declara: a pasta existe, é pasta,
   * e tem `.git`. Nunca escreve, nunca lista diretório, e nunca descobre
   * repositório sozinha — a lista vem de `IARA_REPOS_AGENTE` e nada mais.
   *
   * A validação é no disco de propósito: um apelido apontando para pasta
   * inexistente ou para algo que não é repositório precisa ser recusado na
   * LEITURA da configuração, alto e claro, e não descoberto quando o agente já
   * estiver rodando no lugar errado.
   */
  'servidor/nucleo/RepositoriosAutorizados.ts',
];

/**
 * CATÁLOGO — habilidades que ALCANÇAM um efeito, e podem.
 *
 * Categoria criada corrigindo um defeito da própria auditoria de terceira ordem.
 * `habilidades/agenteLocal.ts` tinha sido classificado como LEITURA INTERNA
 * porque importa `existsSync` para o verificador — verdade sobre o `node:fs`, e
 * mentira sobre o arquivo: ele também importa o `AgenteLocal` e chega ao `spawn`.
 *
 * O estrago não era o rótulo errado. Era que, com um módulo que legitimamente
 * alcança efeito dentro de LEITURA INTERNA, a categoria ficava impossível de
 * verificar — e uma categoria que não pode ser verificada é onde alguém esconde
 * o próximo executor. Separar devolve a LEITURA INTERNA a propriedade que a
 * torna útil: `G6b` prova que dali NÃO se alcança o mundo.
 *
 * Estes alcançam efeito, e é o desenho: são o catálogo, e o catálogo passa pelo
 * `Kernel.abrirOperacao` — que é o portal.
 */
export const CATALOGO: readonly string[] = [
  'servidor/nucleo/kernel/habilidades/agenteLocal.ts',
  /**
   * A investigação de lentidão. Ela NÃO produz efeito nenhum — mede, compara com
   * faixas e devolve planos que ela mesma não executa —, e mesmo assim está aqui,
   * porque alcança o `AgenteLocal` por um caminho que o grafo enxerga: importa
   * `aplicativoFechavelDoProcesso` para saber quais programas a IARA sabe
   * encerrar, e sem essa resposta ela proporia um plano impossível.
   *
   * Poderia ter sido resolvido importando a allowlist de dentro do `MotorAnalise`,
   * e não foi de propósito: a camada que RACIOCINA não importa a que AGE, nem
   * para ler. A função entra por injeção, no catálogo, que é onde o portal já
   * passa. Ver `PodeFechar` em `MotorAnalise.ts`.
   */
  'servidor/nucleo/kernel/habilidades/investigacao.ts',
  /**
   * A delegação a um agente de código (Claude Code). Alcança o `AgenteLocal`
   * pelo mesmo motivo que `agenteLocal.ts`: é ele quem tem as mãos, e o `spawn`
   * do processo do agente mora lá, não aqui.
   *
   * O que ESTE arquivo acrescenta ao risco já coberto: o processo lançado é
   * autônomo e edita arquivos. Por isso os dois verbos que fazem trabalho são
   * `risco: 'alto'` — e risco alto exige `operador` como fonte de autorização no
   * `PorteiroAutorizacao`, o que significa que um plano emitido pela LLM não
   * abre sessão sozinho. O diretório de trabalho nunca vem de parâmetro: é
   * resolvido por apelido contra `RepositoriosAutorizados`.
   */
  'servidor/nucleo/kernel/habilidades/agenteCodigo.ts',
];

/**
 * PONTE DE EXECUÇÃO — o caminho entre a intenção e as mãos, quando as mãos
 * estão em outra máquina.
 *
 * Categoria nova, e ela existe porque a fronteira tinha uma suposição embutida
 * que deixou de ser verdade. `EFEITO_EXTERNO` sempre significou "daqui alguém
 * de fora percebe", e `AgenteLocal` entrou nessa lista por rodar `spawn` e
 * `mkdir` — o que é correto. O que estava calado é ONDE: até 12/08/2026, o
 * motor rodava no computador do operador, então "o disco daqui" e "o disco
 * dele" eram a mesma frase. Com o motor na nuvem, deixaram de ser.
 *
 * Estes três módulos são o trajeto que reconhece a distância:
 *
 *   habilidade → Braço (decide ONDE) → ponte → braço remoto → ExecutorDesktop
 *
 * Eles não são efeito externo: nenhum deles abre disco, shell ou provedor. Não
 * são estado interno: eles existem exatamente para alcançar o mundo. E não são
 * catálogo: não têm manifesto e a LLM não os enxerga. São transporte com
 * política, e merecem um nome próprio — sem ele, ou virariam mais uma linha
 * numa lista que já não os descreve, ou ficariam sem classificação nenhuma,
 * que é a coisa que esta declaração existe para tornar impossível.
 */
export const PONTE_DE_EXECUCAO: readonly string[] = [
  // Decide onde a ordem corre, dá identidade, mede prazo e enfileira.
  'servidor/nucleo/Braco.ts',
  // Traduz ordem em efeito. É o único que alcança o `AgenteLocal`.
  'servidor/nucleo/ExecutorDesktop.ts',
  // O socket dos braços. Transporte puro: não interpreta ordem nem executa nada.
  'servidor/barramento/PonteDispositivos.ts',
  // O processo que roda na máquina do operador e tem as mãos de verdade.
  'servidor/braco/principal.ts',
];

/**
 * ENTRADA — o mundo falando com a IARA, não o contrário.
 *
 * `node:http` aqui é servidor, não cliente. A direção inverte tudo: um webhook
 * que chega é matéria a ser percebida; uma requisição que sai é efeito. Confundir
 * as duas classificaria a porta de entrada como rota de fuga.
 */
export const ENTRADA: readonly string[] = [
  'servidor/principal.ts', // servidor HTTP + WebSocket
  'servidor/canais/PortaWhatsapp.ts', // webhook da Meta (usa o portal para sair)
];

/**
 * MÉTODO MUTÁVEL SEM EFEITO — a lista que impede a declaração de mentir.
 *
 * O DEFEITO que ela corrige foi encontrado atacando a própria fronteira: mover
 * `WhatsApp.ts` de EFEITO EXTERNO para LEITURA EXTERNA passava nos quinze testes.
 * Nenhuma asserção olhava se a classificação era VERDADE — todas confiavam nela.
 * Uma declaração auto-atestada é exatamente tão forte quanto a boa-fé de quem a
 * edita, e a boa-fé não sobrevive a um prazo apertado.
 *
 * Agora a classificação é conferida contra EVIDÊNCIA: quem usa `POST`, `PUT`,
 * `PATCH` ou `DELETE` é EFEITO EXTERNO — a menos que esteja declarado aqui, com
 * a razão escrita. Reclassificar deixou de ser mover uma linha; virou afirmar
 * por escrito, num arquivo cuja única função é essa afirmação, que um POST não
 * muda nada. É o máximo que uma checagem estática alcança, e é muito mais que
 * confiar.
 */
export const POST_SEM_EFEITO: Record<string, string> = {
  'servidor/nucleo/Voz.ts':
    'POST de síntese de voz: o texto entra, o áudio volta. Nada é criado, ' +
    'alterado ou entregue a ninguém no provedor — é uma função pura cara.',
  'servidor/nucleo/Transcricao.ts':
    'POST de transcrição: o áudio entra, o texto volta. Nada é criado, ' +
    'alterado ou entregue a ninguém no provedor — mesma função pura cara do ' +
    'TTS, na direção oposta. O que ESTA entrada precisa dizer, e que a do ' +
    '`Voz.ts` não precisava: o corpo enviado é a voz do operador. Não é ' +
    'fronteira nova — o `SpeechRecognition` do Chrome já mandava esse mesmo ' +
    'áudio ao serviço de fala do Google, sem nada declarado em lugar nenhum. ' +
    'A diferença é que agora está escrito aqui, tem provedor escolhido e ' +
    'desliga tirando uma variável de ambiente.',
  'servidor/braco/pareamento.ts':
    'Dois POST contra o motor da PRÓPRIA IARA, na primeira execução deste ' +
    'computador: um abre um pedido de pareamento (uma linha efêmera na memória ' +
    'daquele processo, que expira em cinco minutos) e o outro pergunta se já ' +
    'aprovaram. Nenhum terceiro é alcançado, nenhum dado de ninguém é criado, ' +
    'alterado ou entregue. O que muda é a identidade que este processo passa a ' +
    'carregar — e ela só passa a valer quando alguém, de uma tela já ' +
    'autenticada, autoriza o código do outro lado.',
  'servidor/braco/credencial.ts':
    'POST de renovação de sessão no endpoint de auth do Supabase. O que muda é ' +
    'o token que ESTE processo carrega — nenhum dado de ninguém é criado, ' +
    'alterado ou entregue, e nenhum terceiro é alcançado. É a mesma operação ' +
    'que o navegador faz sozinho para manter a operadora logada; aqui o dono da ' +
    'sessão é um processo em vez de uma aba.',
  'servidor/nucleo/ClienteGraph.ts':
    'POST contra `/search/query` da Microsoft Search API — é a sintaxe que a ' +
    'Graph exige para consulta com corpo (o termo de busca vai no corpo, não ' +
    'numa query string), não uma escrita. Nada é criado, alterado ou entregue a ' +
    'ninguém: a chamada devolve documentos que o operador já tinha acesso, do ' +
    'mesmo jeito que `GET /me/messages` lê e-mail. É a mesma classe de ' +
    '"POST que na verdade lê" do `search/query` da própria documentação da Graph.',
  'servidor/nucleo/ClienteOllama.ts':
    'POST de inferência local: o prompt entra, o texto volta em stream. Nada é ' +
    'criado, alterado ou entregue a ninguém no servidor Ollama — que roda na ' +
    'máquina do operador ou na rede privada dele — e nenhum terceiro é ' +
    'alcançado. É uma função pura cara, o mesmo caso do TTS logo acima.',
  'servidor/nucleo/ClienteCompativelOpenAI.ts':
    'POST de inferência nas camadas gratuitas (Groq, Gemini), que falam o ' +
    'dialeto `/chat/completions`: o prompt entra, o texto volta em stream. ' +
    'Nada é criado, alterado ou entregue a ninguém — é a mesma classe de ' +
    '"POST que na verdade pensa" do `ClienteOllama` e do `ClienteClaude`. ' +
    'Existe porque a cota da Anthropic acabou em 15/08/2026 e a IARA ficou ' +
    'muda; a chave é DECLARADA (GROQ_API_KEY / GEMINI_API_KEY), nunca ' +
    'descoberta.',
  'servidor/nucleo/ClienteGoogleCalendario.ts':
    'POST contra `oauth2.googleapis.com/token`, trocando um JWT auto-assinado ' +
    'pela conta de serviço por um access token. Nada é criado, alterado ou ' +
    'entregue a ninguém no Google Calendar — é autenticação, a mesma classe ' +
    'do POST de `renovarTokenGraph` em `ClienteGraph.ts` contra o Azure AD. A ' +
    'leitura de eventos que este arquivo também faz é GET.',
  'servidor/nucleo/AnaliseVisual.ts':
    'POST de inferência visual em três provedores (Groq, Gemini via dialeto ' +
    '`/chat/completions`; Anthropic via Messages API): a imagem e a pergunta ' +
    'entram, o texto (e uma coordenada normalizada) volta. Nada é criado, ' +
    'alterado ou entregue a ninguém — a mesma classe de "POST que na verdade ' +
    'pensa" do `ClienteCompativelOpenAI` e do `ClienteClaude`. Cadeia própria ' +
    'por custo (Groq → Gemini → Anthropic), não a `ProvedorRaciocinio` ' +
    'compartilhada — ver ADR-1 em `docs/prd/test-plan.md`.',
};

/**
 * ESTE arquivo. Ele é a DECLARAÇÃO da fronteira, não um módulo que a atravessa:
 * não importa nada, não executa nada, e cita os nomes dos padrões proibidos
 * dentro de comentários — o que faz a checagem textual acusá-lo de si mesmo.
 *
 * A isenção é EARNED, não concedida: `G7b` prova que este arquivo não tem
 * nenhum `import`. No dia em que alguém acrescentar um, a isenção cai junto.
 */
export const ARQUIVO_DA_DECLARACAO = 'servidor/nucleo/Fronteira.ts';

/** Todo módulo declarado, em qualquer categoria. */
export const DECLARADOS: readonly string[] = [
  ...ESTADO_INTERNO,
  ...EFEITO_EXTERNO,
  ...LEITURA_EXTERNA,
  ...LEITURA_INTERNA,
  ...CATALOGO,
  ...PONTE_DE_EXECUCAO,
  ...ENTRADA,
  PORTAL,
];

/**
 * Módulos do Node cuja simples IMPORTAÇÃO significa alcançar algo fora do
 * processo. Quem os abre precisa estar declarado acima.
 *
 * `node:crypto`, `node:path`, `node:os` ficam de fora: calculam, não alcançam.
 */
export const BUILTINS_QUE_ALCANCAM = [
  'node:fs',
  'node:fs/promises',
  'node:child_process',
  'node:net',
  'node:http',
  'node:https',
  'node:dgram',
  'node:worker_threads',
] as const;
