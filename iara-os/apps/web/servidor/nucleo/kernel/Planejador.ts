/**
 * Planejador hierárquico: objetivo -> plano -> passos -> habilidades.
 *
 * DECISÃO QUE MERECE EXPLICAÇÃO: o planejamento é híbrido, não determinístico
 * puro.
 *
 * Um planejador de regras só consegue executar planos que alguém já escreveu.
 * "Analise este contrato e me faça um resumo" tem sete passos que ninguém
 * cadastrou antes — decompor isso É raciocínio. Um planejador só de regras
 * troca "a LLM faz tudo" por "a IARA não faz nada que não foi previsto".
 *
 * Então: intenção reconhecida vira plano determinístico (custo zero, ~5ms);
 * objetivo novo vira um plano de um passo que delega a decomposição ao
 * raciocínio. A Função Executiva é quem escolhe, e ela escolhe pelo grau de
 * confiança da percepção.
 */

import type { Percepcao, Passo, Plano } from './Evento';
import { extrairAssuntoLembrete } from './Quando';
import { planosPropostos } from './PlanosPropostos';
import { passosExecutaveis } from './Investigacao';
import { corrigirTypos } from '../texto';

function passo(
  indice: number,
  descricao: string,
  habilidade: string | null,
  parametros: Record<string, unknown> = {},
): Passo {
  return { indice, descricao, habilidade, parametros };
}

/**
 * Planos conhecidos, indexados pela âncora que a percepção encontrou.
 *
 * Os ids referenciados aqui têm que existir no catálogo —
 * `testes/integridade-cognitiva.test.ts` verifica isso percorrendo cada
 * receita. Uma receita apontando para habilidade inexistente é o pior defeito
 * possível deste arquivo: o passo é pulado, a resposta cai no raciocínio livre
 * e a LLM narra como feita uma ação que nunca rodou.
 *
 * Este comentário já apontou para um teste que não existia, enquanto quatro
 * receitas (`criar_pasta`, `abrir_aplicativo`, `acionar_energia`,
 * `resolver_confirmacao`) citavam habilidades ausentes do catálogo. Se mover o
 * teste, mova esta referência junto.
 */
/**
 * QUEM está falando, para as receitas que precisam consultar estado do diálogo.
 *
 * A `Percepcao` não carrega identidade — e não deve carregar: ela é o que a
 * FRASE diz, e a frase não sabe de quem é. Mas uma receita como a de autorizar
 * um plano proposto precisa saber qual proposta está aberta, e proposta é por
 * operador e por conversa.
 *
 * OPCIONAL de propósito. Sem contexto, as receitas que dependem dele produzem o
 * plano honesto de "não há nada aberto" em vez de adivinhar — que é o que um
 * chamador de teste, ou um caminho novo que esqueceu de passar o contexto, deve
 * receber.
 */
export interface ContextoPlanejamento {
  readonly id_usuario: string;
  readonly sessao: string;
}

const RECEITAS: Record<string, (p: Percepcao, ctx: ContextoPlanejamento | null) => Plano> = {
  clima: (p) => {
    const horizonte = extrairHorizonteClima(p.bruto);
    const cidade = extrairCidadeClima(p.bruto);
    return {
      objetivo:
        horizonte === 'agora'
          ? 'Informar a condição externa corrente do perímetro operacional'
          : `Informar a previsão do tempo para ${horizonte === 'amanha' ? 'amanhã' : 'hoje'}`,
      origem: 'deterministico',
      // A descrição do passo é o que o operador lê no console. Ela dizia
      // "Consultar radar meteorológico" para os dois casos — e não há radar
      // nenhum: a fonte é modelo numérico. Ver `OrquestradorAcoes.consultarClima`.
      passos: [
        passo(
          0,
          horizonte === 'agora'
            ? 'Ler a estação meteorológica (condição corrente)'
            : 'Ler a previsão do modelo meteorológico',
          'consultar_clima',
          cidade ? { horizonte, cidade } : { horizonte },
        ),
      ],
    };
  },

  /**
   * "Quais centrais estão inativas?" achado ao vivo em auditoria (14/08/2026):
   * `consultar_infraestrutura` só devolve centrais ATIVAS — não tem noção de
   * status. Antes desta correção, QUALQUER frase com "central" caía nesta
   * receita e nunca sobrava chance de o raciocínio emergente escolher
   * `executar_consulta_sql` com a consulta pré-aprovada `centrais_inativas`
   * (ela existe, está no catálogo, e nunca era alcançada). A IARA respondia
   * "não tenho essa consulta liberada" sobre uma consulta que tinha — mentira
   * por rota errada, não por falta de capacidade.
   *
   * A correção NÃO aponta direto para `executar_consulta_sql`: isso violaria
   * a mesma regra do comentário abaixo ("receita determinística nunca depende
   * de habilidade opcional", travada em teste). Em vez disso, esta âncora
   * DESISTE — devolve o mesmo plano de `planoDeRaciocinio` — e deixa o
   * raciocínio emergente escolher. `descricaoParaPrompt` já lista
   * `centrais_inativas` com o rótulo certo quando o Supabase está ligado, e
   * lista `[DESLIGADA: ...]` quando não está — dos dois jeitos, honesto.
   */
  infraestrutura: (p) => {
    if (INATIVA_INFRAESTRUTURA.test(normalizarLocal(p.bruto))) {
      return {
        objetivo: p.objetivo_provavel === 'indeterminado' ? 'Atender o pedido do operador' : p.objetivo_provavel,
        origem: 'emergente',
        passos: [passo(0, 'Raciocinar sobre o pedido', 'raciocinio', {})],
      };
    }
    return {
      objetivo: 'Responder sobre o estado da infraestrutura',
      origem: 'deterministico',
      // `consultar_infraestrutura` e não `executar_consulta_sql`: aquela funciona
      // com ou sem banco, esta some do catálogo sem Supabase. Receita
      // determinística não pode depender de credencial opcional.
      passos: [passo(0, 'Consultar base de centrais', 'consultar_infraestrutura', { uf: extrairUf(p.bruto) })],
    };
  },

  incidente: (p) => ({
    objetivo: 'Recuperar histórico de incidente equivalente',
    origem: 'deterministico',
    passos: [
      passo(0, 'Buscar assinatura no índice histórico', 'buscar_historico', { consulta: p.bruto }),
    ],
  }),

  relogio: () => ({
    objetivo: 'Informar referência temporal',
    origem: 'deterministico',
    passos: [passo(0, 'Ler relógio do servidor', 'consultar_agenda')],
  }),

  busca: (p) => ({
    objetivo: 'Levantar informação factual externa',
    origem: 'deterministico',
    passos: [passo(0, 'Buscar na web', 'pesquisar_web', { consulta: p.bruto })],
  }),

  // --- agente local ---
  pasta: (p) => ({
    objetivo: 'Criar pasta no computador',
    origem: 'deterministico',
    passos: [
      passo(0, 'Criar a pasta na raiz autorizada', 'criar_pasta', {
        nome: extrairNomePasta(p.bruto),
        local: extrairLocalAutorizado(p.bruto),
      }),
    ],
  }),

  /**
   * O apelido vai CRU para a habilidade, e é de propósito. Ela conhece a
   * allowlist; o planejador não — e não deve, porque a lista muda por máquina.
   * Aqui só se reconhece a intenção; quem decide se aquele nome existe é quem
   * tem o disco.
   */
  atualizar_repositorio: (p) => ({
    objetivo: 'Atualizar um repositório autorizado',
    origem: 'deterministico',
    passos: [
      passo(0, 'Puxar as novidades do repositório', 'atualizar_repositorio', {
        repositorio: extrairApelidoRepositorio(p.bruto),
      }),
    ],
  }),

  abrir_app: (p) => {
    const site = extrairSiteAbertura(p.bruto);
    return {
      objetivo: 'Abrir aplicativo autorizado',
      origem: 'deterministico',
      passos: [
        passo(0, 'Abrir o aplicativo pedido', 'abrir_aplicativo', {
          aplicativo: p.bruto,
          ...(site ? { site } : {}),
        }),
      ],
    };
  },

  fechar_app: (p) => ({
    objetivo: 'Fechar aplicativo autorizado',
    origem: 'deterministico',
    passos: [passo(0, 'Fechar o aplicativo pedido', 'fechar_aplicativo', { aplicativo: p.bruto })],
  }),

  listar_arquivos: (p) => ({
    objetivo: 'Inventariar uma pasta autorizada',
    origem: 'deterministico',
    passos: [
      passo(0, 'Ler a pasta autorizada no computador do operador', 'listar_arquivos', {
        // O MESMO extrator de `criar_pasta`. Duas formas de descobrir o local
        // divergiriam no dia em que alguém acrescentasse um sinônimo a uma só.
        local: extrairLocalAutorizado(p.bruto),
      }),
    ],
  }),

  sistema: () => ({
    objetivo: 'Informar o estado da máquina do operador',
    origem: 'deterministico',
    passos: [passo(0, 'Ler memória, processador e rede do computador', 'informacoes_sistema', {})],
  }),

  /**
   * UM PASSO SÓ, e é uma decisão, não uma simplificação.
   *
   * A tentação é decompor aqui — medir, analisar, propor — porque é assim que a
   * investigação de fato acontece. Mas o plano do kernel executa passo a passo e
   * compõe as SAÍDAS, e as duas primeiras etapas não têm saída para o operador:
   * uma medição sem análise é uma parede de números, e uma análise sem plano é
   * um diagnóstico sem saída. Espalhá-las em três passos faria a resposta juntar
   * três textos que só fazem sentido como um.
   *
   * O laço de verdade — medir, agir, medir de novo, comparar — não cabe num
   * plano: ele atravessa TURNOS, porque no meio dele mora uma autorização do
   * operador. Quem o mantém é a referência guardada em `habilidades/investigacao.ts`.
   */
  lentidao: () => ({
    objetivo: 'Investigar a lentidão relatada no computador do operador',
    origem: 'deterministico',
    passos: [
      passo(
        0,
        'Medir processador, memória, disco e processos; comparar com as faixas e propor planos',
        'investigar_lentidao',
        {},
      ),
    ],
  }),

  auditoria: () => ({
    objetivo: 'Auditar o que a IARA consegue observar de si mesma',
    origem: 'deterministico',
    passos: [
      passo(
        0,
        'Conferir capacidades desligadas, erros repetidos, planos ineficazes e a prova do jornal',
        'auditar_sistema',
        {},
      ),
    ],
  }),

  diagnostico: () => ({
    objetivo: 'Relatar o estado real de cada elo da cadeia',
    origem: 'deterministico',
    passos: [passo(0, 'Consultar motor, banco, dispositivos e trilha', 'diagnosticar_sistema', {})],
  }),

  captura: (p) => ({
    objetivo: 'Registrar a tela em arquivo',
    origem: 'deterministico',
    passos: [
      passo(0, 'Fotografar a tela e salvar na pasta autorizada', 'capturar_tela', {
        local: extrairLocalCaptura(p.bruto),
      }),
    ],
  }),

  /**
   * A ÚNICA receita que escolhe entre três habilidades, e é o mesmo desenho de
   * `confirmacao`: uma âncora, e a polaridade da frase decide o passo. Separar
   * em três âncoras faria a percepção reconhecer "lembrete" três vezes e a
   * ordem entre elas virar a regra de desempate — que é precisamente o tipo de
   * acoplamento invisível que a lista de âncoras já paga caro em `clima`.
   */
  lembrete: (p) => {
    if (ehCancelamentoDeLembrete(p.bruto)) {
      return {
        objetivo: 'Cancelar lembrete marcado',
        origem: 'deterministico',
        passos: [
          passo(0, 'Remover o lembrete da agenda do operador', 'cancelar_lembrete', {
            termo: extrairTermoLembrete(p.bruto),
          }),
        ],
      };
    }
    if (ehConsultaDeLembrete(p.bruto)) {
      return {
        objetivo: 'Listar lembretes pendentes',
        origem: 'deterministico',
        passos: [passo(0, 'Ler a agenda do operador', 'listar_lembretes', {})],
      };
    }
    return {
      objetivo: 'Marcar lembrete',
      origem: 'deterministico',
      passos: [
        passo(0, 'Gravar o lembrete na agenda do operador', 'agendar_lembrete', {
          assunto: extrairAssuntoLembrete(p.bruto),
          // A FRASE, não a data. Quem interpreta é `Quando.ts` — ver o
          // cabeçalho de `habilidades/agenda.ts`.
          quando: p.bruto,
        }),
      ],
    };
  },

  energia: (p) => ({
    objetivo: 'Preparar ação de energia com confirmação',
    origem: 'deterministico',
    passos: [
      passo(0, 'Registrar pendência e pedir confirmação', 'acionar_energia', {
        acao: extrairAcaoEnergia(p.bruto),
      }),
    ],
  }),

  /**
   * O PLANO AUTORIZADO VIRA UM PLANO DO KERNEL — e é aqui que a Fase 2 se paga.
   *
   * A receita não executa nada. Ela TRADUZ os passos que o `MotorAnalise`
   * propôs em passos que o Kernel roda, e o Kernel os roda pelas portas de
   * sempre: porteiro de autorização, jornal, esquema, timeout, verificador. Um
   * plano autorizado não ganha atalho nenhum por ter sido autorizado.
   *
   * `origem: 'deterministico'` é verdade e importa: o `PorteiroAutorizacao` só
   * deixa passar risco alto vindo de plano determinístico, e este veio de uma
   * receita fixa acionada por uma frase do operador — nunca de decomposição da
   * LLM. É por isso que o passo de reiniciar pode chegar ao `acionar_energia`,
   * que então arma a SUA própria confirmação. Autorizar o plano não é confirmar
   * o desligamento; são duas portas, e as duas continuam de pé.
   *
   * O passo 0 é sempre `assumir_plano`: ele registra a autorização e anuncia o
   * que vem. Sem proposta viva, ele é o único passo — e diz isso.
   */
  executar_plano: (p, ctx) => {
    const letra = extrairLetraDoPlano(p.bruto);
    const escolhido = ctx ? planosPropostos.escolher(ctx.id_usuario, ctx.sessao, letra) : null;

    const passos: Passo[] = [
      passo(0, 'Assumir o plano autorizado pelo operador', 'assumir_plano', {
        plano: letra ?? '',
      }),
    ];

    if (escolhido) {
      /**
       * Só os passos de AGORA, na ordem, parando no primeiro que depende do
       * operador. Ver `passosExecutaveis`: um plano é uma sequência, e rodar o
       * fim antes do meio não é executar o plano — é executar outro.
       */
      for (const s of passosExecutaveis(escolhido)) {
        passos.push(passo(passos.length, s.descricao, s.habilidade, s.parametros));
      }
    }

    return {
      objetivo: escolhido
        ? `Executar o plano ${escolhido.id}: ${escolhido.rotulo}`
        : 'Responder sobre um plano que não está aberto',
      origem: 'deterministico',
      passos,
    };
  },

  confirmacao: (p) => ({
    objetivo: 'Resolver confirmação pendente',
    origem: 'deterministico',
    passos: [
      passo(0, 'Fechar o ciclo da ação pendente', 'resolver_confirmacao', {
        resposta: ehAfirmacao(p.bruto) ? 'confirmo' : 'cancelar',
      }),
    ],
  }),
};

/**
 * Confirmação vs. cancelamento.
 *
 * O teste anterior era `/^confirmo|^pode /`, e a âncora `confirmacao` da
 * percepção casa um vocabulário bem maior que isso: "confirmado", "confirmar" e
 * "prossiga" caíam todos no ramo `cancelar`. Errava para o lado seguro — mas
 * errava, e o operador que digita "prossiga" duas vezes sem nada acontecer
 * conclui, com razão, que a IARA não entende confirmação.
 *
 * O NEGATIVO é verificado primeiro: "cancela, não prossiga" tem as duas
 * famílias na frase, e nesse empate desistir é a leitura correta.
 */
const NEGACAO = /\b(cancela|cancelar|cancelado|aborta|abortar|desiste|desistir|nao|deixa)\b/;
const AFIRMACAO = /\b(confirmo|confirmado|confirma|confirmar|prossiga|prossegue|prosseguir|pode ir|pode sim|manda|sim)\b/;

export function ehAfirmacao(bruto: string): boolean {
  const t = normalizarLocal(bruto);
  if (NEGACAO.test(t)) return false;
  return AFIRMACAO.test(t);
}

function normalizarLocal(bruto: string): string {
  // `corrigirTypos` tolera erro de digitação de uma letra nas palavras que as
  // âncoras reconhecem — mesmo motivo do `Percepcao.ts`, aqui é a segunda
  // rodada de reconhecimento (marcar/listar/cancelar lembrete etc).
  return corrigirTypos(
    bruto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim(),
  );
}

/**
 * A CAUDA DA FRASE — tudo que vem depois de o nome ter acabado.
 *
 * Corta a partir do LOCAL, e não só quando ele encerra a frase. A forma
 * anterior embutia o local numa parte opcional ancorada em `$`, e o efeito
 * disso só aparece com a frase que a pessoa realmente fala: "crie uma pasta de
 * teste na área de trabalho DO MEU COMPUTADOR" não termina no local, a âncora
 * não casa, e o nome da pasta vira `de teste na área de trabalho do meu
 * computador` — a frase inteira virando nome de diretório.
 *
 * Também corta o "no meu computador" sozinho, sem local nomeado, porque é o
 * jeito mais natural de pedir isso de um celular: a pessoa diz ONDE justamente
 * porque não está na frente da máquina.
 */
const CAUDA_DO_PEDIDO =
  /\s*\b(?:n[ao]s?|em|d[ao]s?)\s+(?:minha\s+|meu\s+|minhas\s+|meus\s+)?(?:área de trabalho|area de trabalho|desktop|documentos|downloads|computador|pc|máquina|maquina|notebook)\b.*$/i;

/** Cortesias e vocativos que ninguém quer ver como nome de pasta. */
const CORTESIA = /\s*\b(?:por favor|pra mim|para mim|pra você|iara)\b\s*[?.!]*$/i;

/**
 * Preposição ou artigo grudado no começo do nome.
 *
 * "crie uma pasta DE teste" pede uma pasta chamada `teste`, não `de teste`. Era
 * a forma mais comum de pedir isso e a que produzia o nome mais estranho —
 * estranho o bastante para a operadora achar que a IARA tinha inventado o nome
 * sozinha, que é uma suspeita bem pior do que a verdade.
 */
const LIGACAO_INICIAL = /^(?:de|do|da|dos|das|com|para|pra|em|no|na|o|a|os|as|um|uma)\s+/i;

/**
 * Sobras que não nomeiam nada. Ficam de fora `teste`, `nova` composta e
 * qualquer palavra de conteúdo: o critério é "isto é um nome?", não "isto é
 * curto?" — cortar por tamanho recusaria uma pasta legitimamente chamada `RH`.
 */
const SEM_NOME = /^(?:nova|novo|uma|um|a|o|mim|favor|aqui|ali|ai|aí|isso|isto)$/i;

/**
 * O NOME vem do texto ORIGINAL (acentos preservados — a pasta se chama
 * "Contratos Aéreos", não "contratos aereos"); o LOCAL vem do normalizado.
 *
 * A limpeza acontece em etapas, e não numa expressão só, porque foi a expressão
 * só que produziu o defeito: cada pedaço opcional que se acrescenta a ela muda
 * silenciosamente o que os outros casam. Em etapas, cada corte tem um nome e
 * uma linha de teste.
 */
export function extrairNomePasta(bruto: string): string | null {
  /**
   * A ÂNCORA DE NOMEAÇÃO decide se a ligação inicial é ligação ou é o nome.
   *
   * "crie uma pasta DE teste" → o "de" liga, e o nome é `teste`.
   * "crie uma pasta chamada UM Relatório" → o "Um" É o nome, e cortá-lo faz a
   * IARA batizar a pasta de outro jeito sem avisar ninguém.
   *
   * O defeito era real e voltado ao operador (achado em auditoria, 16/08/2026):
   * pedir `pasta chamada Um k5c4r1` criava `k5c4r1`, e a fala confirmava o nome
   * trocado com toda a naturalidade. Pior que feio — um sistema que renomeia
   * calado corrompe qualquer verificação que use o nome como âncora, e foi
   * exatamente assim que um teste de concorrência passou sem ter testado nada.
   *
   * O "de" da fórmula "chamada DE X" é absorvido pela própria âncora, porque
   * ali ele pertence à maneira de nomear, não ao nome. `chamad[ao]` cobre
   * "chamado", que antes não era âncora nenhuma e virava parte do nome.
   */
  const m = bruto.match(
    /pasta\s+(chamad[ao]\s+(?:de\s+)?|com\s+o\s+nome\s+(?:de\s+)?|de\s+nome\s+|nomead[ao]\s+(?:como\s+)?)?["“']?(.+?)["”']?\s*[?.!]*$/i,
  );
  const nomeada = Boolean(m?.[1]);
  let nome = (m?.[2] ?? '').trim();
  nome = nome.replace(CAUDA_DO_PEDIDO, '').trim();
  nome = nome.replace(CORTESIA, '').trim();
  if (!nomeada) nome = nome.replace(LIGACAO_INICIAL, '').trim();
  // Aspas sobrando quando o nome vinha citado e a cauda foi cortada por fora.
  nome = nome.replace(/^["“']|["”']$/g, '').trim();
  /**
   * SEM NOME É `null`, e não um nome inventado.
   *
   * Devolvia `'Nova pasta'`, com o comentário "nome honesto de fallback". Como
   * string ele é honesto; como AÇÃO, não: a campanha adversarial de 18/08/2026
   * pediu "Cria uma pasta na área de trabalho" — sem nome — e mediu
   * `Desktop/Nova pasta` no disco, com o verificador confirmando. Desfecho
   * `FALSO_NEGATIVO`: efeito proibido a partir de pedido que não o sustenta.
   *
   * `RegistroErros` já nomeia essa classe: `ambiguidade_ignorada` — "adivinhou
   * onde deveria perguntar". Ausência de nome é DADO, e quem decide o que fazer
   * com ela é o detector de ambiguidade, que roda antes da receita determinística
   * e devolve pergunta em vez de passo.
   */
  if (!nome || SEM_NOME.test(nome)) return null;
  return nome;
}

/**
 * O APELIDO do repositório na frase.
 *
 * Escrito depois do conserto de `extrairNomePasta`, e com a lição dele: a
 * limpeza é em etapas nomeadas, não numa expressão só. O nome vem do texto
 * ORIGINAL — um repositório pode se chamar `IARA_WCA`, e devolver `iara_wca`
 * obrigaria a allowlist a adivinhar a caixa (ela normaliza, mas quem lê o log
 * não).
 *
 * Vazio é resposta legítima: "atualize o repositório", sem nome, com UM
 * repositório declarado, é um pedido claro. Quem resolve essa ambiguidade é a
 * habilidade, que conhece a lista — inventar um nome aqui seria escolher por
 * ela.
 */
export function extrairApelidoRepositorio(bruto: string): string {
  const m = bruto.match(
    /(?:reposit[óo]rio|repo|c[óo]digo|projeto)\s+(?:chamado\s+|do\s+|da\s+|de\s+)?["“']?([\w.-]+)["”']?/i,
  );
  const nome = (m?.[1] ?? '').trim();
  // "o", "meu", "esse" casam o grupo e não nomeiam nada.
  if (/^(o|a|os|as|meu|minha|esse|essa|este|esta|aqui|ai)$/i.test(nome)) return '';
  return nome;
}

/**
 * O SITE dentro do pedido de abrir aplicativo — "abra o chrome no
 * youtube.com", "abre o navegador em https://iara.up.railway.app".
 *
 * `undefined`, não string vazia, quando não há nada a extrair: é o sinal que
 * `AgenteLocal.abrirAplicativo` usa para nem tentar validar URL nenhuma. Duas
 * formas reconhecidas, e só duas — a lição de `resolverAplicativo` (substring
 * contra lista fechada) vale aqui pelo motivo oposto: um domínio "adivinhado"
 * a partir de uma palavra solta ("abra o chrome" ⇏ "chrome.com") seria a
 * IARA inventando destino, não reconhecendo um.
 *
 *   1. um endereço `http://`/`https://` já escrito por extenso;
 *   2. um token com PONTO E TLD reconhecível ("youtube.com", "iara.up.railway.app")
 *      — nunca uma palavra solta, porque é o ponto que separa "abra o site
 *      google" (sem TLD, não é endereço) de "abra o google.com" (é).
 *
 * A validação de FORMATO de verdade (esquema, espaço, aspas) não mora aqui —
 * mora em `AgenteLocal.validarUrlAbertura`, que roda de qualquer forma antes
 * do `spawn`. Esta função só decide SE HÁ algo para oferecer a ela.
 */
export function extrairSiteAbertura(bruto: string): string | undefined {
  const comEsquema = bruto.match(/https?:\/\/[^\s'"]+/i);
  if (comEsquema) return comEsquema[0].replace(/[.,;!?)]+$/, '');

  const dominio = bruto.match(
    /\b([a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.(?:com\.br|gov\.br|org\.br|net\.br|com|org|net|io|co|app|dev))\b/i,
  );
  return dominio ? `https://${dominio[1]}` : undefined;
}

export function extrairLocalAutorizado(bruto: string): string {
  const t = normalizarLocal(bruto);
  if (/\b(documentos)\b/.test(t)) return 'documentos';
  if (/\b(downloads)\b/.test(t)) return 'downloads';
  return 'area_de_trabalho';
}

/**
 * Onde a captura é salva. Padrão `documentos`, e não a Área de Trabalho como em
 * `criar_pasta`: print é arquivo que se acumula, e acumular na área de trabalho
 * é onde ele vira sujeira que ninguém limpa. O operador continua mandando.
 */
export function extrairLocalCaptura(bruto: string): string {
  const t = normalizarLocal(bruto);
  if (/\b(area de trabalho|desktop)\b/.test(t)) return 'area_de_trabalho';
  if (/\b(downloads)\b/.test(t)) return 'downloads';
  return 'documentos';
}

// ---------------------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------------------

/**
 * "cancela o lembrete da reunião" cancela; "me lembre de cancelar a reunião"
 * MARCA. A diferença é o objeto do verbo, e é por isso que o teste exige a
 * palavra `lembrete` logo depois — sem essa amarra, todo lembrete que contivesse
 * a palavra "cancelar" no assunto seria lido como um pedido de cancelamento, e a
 * IARA apagaria justamente o recado que estava sendo criado.
 */
/** Ver o comentário da receita `infraestrutura`. */
const INATIVA_INFRAESTRUTURA = /\b(inativ\w*|parad\w*|fora de operac\w*|desativad\w*)\b/;

const CANCELAR_LEMBRETE =
  /\b(cancel\w*|apag\w*|remov\w*|desmarc\w*|exclu\w*|esquec\w*|tir[ae]|deleta\w*)\s+(?:(?:o|a|os|as|aquele|aquela|aqueles|esse|essa|este|esta|meu|minha|meus|minhas)\s+)*lembrete/;

/**
 * "o que eu marquei" era a ÚNICA frase de recapitulação reconhecida — achado
 * ao vivo em auditoria (14/08/2026): "confirma o que você já marcou" (pessoa e
 * tempo verbal diferentes, mesmo pedido) não casava com nada aqui, caía no
 * `return` padrão de `lembrete()` e virava uma TENTATIVA DE CRIAR lembrete
 * — que falhava dizendo "não consegui entender ... como horário", uma recusa
 * sem relação nenhuma com o que foi perguntado. `marc(?:ou|amos|aram|ei)` cobre
 * as conjugações de quem pergunta (eu marquei / você marcou / a gente marcou).
 */
const LISTAR_LEMBRETE =
  /\b(quais|quantos|que)\s+(?:sao\s+)?(?:os\s+|meus\s+)?lembrete|\b(lista|listar|liste|mostra|mostrar|mostre|ver|vejo|tenho)\s+(?:algum\s+|os\s+|meus\s+|meu\s+)?lembrete|\bmeus\s+lembretes\b|\bminha\s+agenda\b|\bo que (?:eu|voce|a gente)\s+(?:ja\s+)?marc(?:ou|amos|aram|ei)\b/;

export function ehCancelamentoDeLembrete(bruto: string): boolean {
  return CANCELAR_LEMBRETE.test(normalizarLocal(bruto));
}

export function ehConsultaDeLembrete(bruto: string): boolean {
  return LISTAR_LEMBRETE.test(normalizarLocal(bruto));
}

/**
 * QUAL lembrete cancelar. Vem do texto ORIGINAL, com acento, porque o termo é
 * casado contra o assunto que o operador escreveu — e "reunião" não encontra
 * "reuniao" por acidente feliz nenhum: quem normaliza os dois lados é a
 * `Agenda`, e ela precisa receber o termo como foi dito.
 */
export function extrairTermoLembrete(bruto: string): string {
  const m = bruto.match(
    /lembrete\s+(?:d[aeo]s?\s+|sobre\s+|para\s+|pra\s+|que\s+|com\s+)?(.+?)\s*[?.!]*$/i,
  );
  return (m?.[1] ?? '').trim().slice(0, 120);
}

/**
 * "executar o plano B" → `B`. Sem letra → `undefined`, e quem resolve usa o
 * RECOMENDADO — que é o que a pergunta "posso executar o plano A?" torna natural
 * responder com um "pode executar".
 *
 * A letra é limitada a A–E porque é o alcance real de `planosParaLentidao`
 * (quatro alternativas no pior caso). Aceitar qualquer letra faria "execute o
 * plano X" virar um pedido válido para um plano que nunca existiu, e a resposta
 * honesta a isso já existe — só que ela é melhor quando diz "não tenho um plano
 * X", e não quando o extrator inventou um alvo.
 */
export function extrairLetraDoPlano(bruto: string): string | undefined {
  const m = normalizarLocal(bruto).match(/\bplano\s+([a-e])\b/);
  return m ? m[1].toUpperCase() : undefined;
}

export function extrairAcaoEnergia(bruto: string): string {
  const t = normalizarLocal(bruto);
  if (/\b(reinicie|reinicia|reiniciar)\b/.test(t)) return 'reiniciar';
  if (/\b(suspenda|suspender|hiberne|hibernar)\b/.test(t)) return 'suspender';
  return 'desligar';
}

/**
 * "Vai chover hoje?" ou "está chovendo?" — a MESMA âncora, perguntas
 * diferentes, e essa diferença é o defeito que este extrator corrige.
 *
 * Até 12/08 a receita de clima ignorava o tempo verbal e sempre chamava a
 * medição corrente. A IARA respondia "céu limpo, sem precipitação na última
 * hora" para quem perguntou sobre a tarde — dado verdadeiro respondendo a
 * pergunta errada, que é indistinguível de mentira para quem lê.
 *
 * A ordem das checagens importa: "amanhã" vence, porque quem diz "hoje e
 * amanhã" está pedindo o horizonte mais longo; futuro vence o presente pelo
 * mesmo motivo. Sem sinal nenhum de tempo, o padrão é `agora` — é a leitura
 * mais conservadora, e a única que a IARA pode MEDIR em vez de estimar.
 */
const AMANHA = /\b(amanha|amanhã)\b/;
const HOJE = /\b(hoje|a tarde|à tarde|de tarde|hoje a noite|mais tarde|ainda hoje|o dia)\b/;
const FUTURO = /\b(vai|vao|ira|irao|deve|previsao|prevista|previsto|previsão)\b/;

export function extrairHorizonteClima(bruto: string): 'agora' | 'hoje' | 'amanha' {
  const t = normalizarLocal(bruto);
  if (AMANHA.test(t)) return 'amanha';
  if (HOJE.test(t) || FUTURO.test(t)) return 'hoje';
  return 'agora';
}

/** Palavras que "em X" costuma trazer sem X ser um lugar. */
const CLIMA_NAO_CIDADE = /^(hoje|amanha|amanhã|agora|breve|instantes|dias|pouco|casa|geral)$/i;

/**
 * "vai chover EM VALINHOS hoje?", "clima em São Paulo" → o nome depois de
 * "em", parando antes de um marcador de tempo, pontuação ou fim de frase.
 *
 * Sobre `p.bruto` (texto original, não `normalizarLocal`): o nome segue para
 * `geocodificarCidade`, que faz sua própria busca — preservar acento e caixa
 * ajuda o serviço a casar, e não atrapalha se ele não precisar.
 *
 * DUAS CORREÇÕES ACHADAS EM VERIFICAÇÃO INDEPENDENTE (14/08/2026), antes de
 * qualquer uso em produção:
 *
 * 1. EXIGE MAIÚSCULA NO PRIMEIRO CARACTERE. Sem isto, "estou em reunião até
 *    de tarde", "estou em rota pra SP", "estou em dúvida se levo casaco" —
 *    frases comuns numa mensagem que também menciona clima — extraíam
 *    "reunião", "rota pra SP", "dúvida se levo casaco" como CIDADE, e como o
 *    nome dito no texto GANHA da localização do aparelho, isso regredia uma
 *    consulta que antes funcionava (caía certo no aparelho) para uma recusa
 *    de geocodificação sobre lixo. Nome próprio em português quase sempre
 *    vem maiúsculo mesmo em mensagem informal; exigir isso é o lado seguro —
 *    perde uma cidade digitada tudo minúsculo, nunca quebra uma pergunta que
 *    já funcionava. `CLIMA_NAO_CIDADE` continua casando sem diferenciar caixa
 *    (`Hoje`, por exemplo, ainda é descartado).
 *
 * 2. FRONTEIRA DE "amanhã" NÃO USA `\b` DEPOIS DO ACENTO. `\b` do regex é
 *    ASCII — `\w` não inclui `ã` — então `\bamanh[ãa]\b` nunca casava a
 *    forma acentuada em nenhuma posição, e "vai chover em Foz do Iguaçu
 *    amanhã?" extraía "Foz do Iguaçu amanhã" (a palavra de tempo virava parte
 *    do nome da cidade, e a geocodificação falhava por um motivo que não
 *    tinha nada a ver com a cidade). Troca por `(?![a-zà-ÿ])`: nega "mais uma
 *    letra minúscula depois", que não depende de `\b` reconhecer `ã` como
 *    parte de palavra.
 *
 * Heurística, não gramática: não tenta reconhecer todo jeito de nomear uma
 * cidade (não cobre "aqui em Valinhos" sem preposição redundante, por
 * exemplo, nem cidade digitada tudo minúsculo). Cobre o padrão observado ao
 * vivo — achado real, ver auditoria de 14/08/2026 — e devolve `undefined` sem
 * tentar adivinhar quando não casa; quem chama já sabe cair para o
 * aparelho/escritório nesse caso.
 */
export function extrairCidadeClima(bruto: string): string | undefined {
  const m = bruto.match(
    /\bem\s+([A-ZÀ-Ý][\wà-ÿÀ-Ÿ'’\- ]{1,50}?)(?=\s+(?:hoje|amanh[ãa]|agora)(?![a-zà-ÿ])|[?.,!;]|$)/,
  );
  if (!m) return undefined;
  const cidade = m[1].trim().replace(/\s{2,}/g, ' ');
  if (cidade.length < 2 || CLIMA_NAO_CIDADE.test(cidade)) return undefined;
  return cidade;
}

const UFS: Record<string, string> = {
  'mato grosso do sul': 'MS',
  'mato grosso': 'MT',
  goias: 'GO',
  'sao paulo': 'SP',
  parana: 'PR',
  rondonia: 'RO',
};

function extrairUf(bruto: string): string {
  const t = bruto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const [nome, sigla] of Object.entries(UFS)) {
    if (t.includes(nome)) return sigla;
  }
  const m = t.match(/\b(?:em|no|na|de|do|da)\s+(mt|ms|go|sp|pr|ro)\b/);
  return m ? m[1].toUpperCase() : 'GERAL';
}

export class Planejador {
  /** Existe receita determinística para esta percepção? */
  temReceita(p: Percepcao): boolean {
    return p.ancoras.some((a) => a in RECEITAS);
  }

  /**
   * A primeira âncora reconhecida vence. Ordem importa: "esse erro de banco já
   * aconteceu?" casa `incidente` e `infraestrutura`; a intenção real é o
   * histórico, e `incidente` vem antes na lista de âncoras da percepção.
   */
  planejar(p: Percepcao, ctx: ContextoPlanejamento | null = null): Plano {
    for (const ancora of p.ancoras) {
      const receita = RECEITAS[ancora];
      if (receita) return receita(p, ctx);
    }
    return this.planoDeRaciocinio(p);
  }

  /**
   * Plano de um passo só: delega a decomposição ao raciocínio. É a saída
   * honesta para objetivo novo — melhor um passo que admite que precisa pensar
   * do que sete passos inventados que não levam a lugar nenhum.
   */
  planoDeRaciocinio(p: Percepcao): Plano {
    return {
      objetivo: p.objetivo_provavel === 'indeterminado' ? 'Atender o pedido do operador' : p.objetivo_provavel,
      origem: 'emergente',
      passos: [passo(0, 'Raciocinar sobre o pedido', 'raciocinio', {})],
    };
  }

  planoDeRecusa(motivo: string): Plano {
    return {
      objetivo: 'Recusar acesso a registro de terceiro',
      origem: 'deterministico',
      passos: [passo(0, motivo, 'recusar_por_sigilo', {})],
    };
  }
}
