/**
 * Motor de Percepção.
 *
 * A LLM nunca vê a mensagem crua primeiro — nem o planejador, nem a função
 * executiva. Todos veem uma `Percepcao`: tipo, urgência, objetivo provável,
 * estado do operador e as âncoras que o reconhecedor determinístico encontrou.
 *
 * Isso é o que separa "chatbot que recebe string" de "sistema que interpreta
 * entrada". E é barato: tudo aqui é regex e contagem, zero token.
 */

import type { LeituraOperador } from '../../../lib/estado';
import type { Percepcao, TipoEntrada, Urgencia } from './Evento';
import { corrigirTypos, normalizar } from '../texto';
import { TeoriaDaMente, type SinalTemporal } from '../TeoriaDaMente';
import {
  INFINITIVO_OPERACIONAL,
  INTENCAO_PROCEDIMENTAL,
  PERGUNTA_DE_DADO,
  TENTATIVA_DE_ATALHO,
  VOCABULARIO_GW,
} from './IntencaoProcedimento';
import {
  ehPerguntaSobreResolver,
  periodoEhIrrealis,
  separarVozes,
  sobNegacao,
} from './Enunciacao';

const URGENTE =
  /\b(urgente|urgencia|agora|imediato|parou|caiu|travou|fora do ar|critico|emergencia|prejuizo)\b/;
const SAUDACAO = /^(oi|ola|bom dia|boa tarde|boa noite|e ai|opa|tudo bem)\b/;
/**
 * `leia`/`envie` entraram em 14/08/2026: sem eles, "leia meus emails" e "envie
 * uma mensagem" classificavam como `tipo: 'texto'` — a mesma forma de conversa
 * casual — e a `FuncaoExecutiva` nunca oferecia o catálogo à LLM para essas
 * frases (ver `mereceDecomposicao`). O verbo já existia como infinitivo
 * (`enviar`); faltava a forma imperativa que uma pessoa realmente digita.
 */
const COMANDO =
  /^(abre|abrir|roda|rodar|executa|executar|lista|listar|mostra|mostrar|gera|gerar|cria|criar|manda|enviar|envie|leia|ler)\b/;
const DOCUMENTO = /\b(pdf|planilha|xlsx|csv|documento|contrato|anexo|arquivo|nota fiscal|cte|ct-e)\b/;

/**
 * Sinais que o reconhecedor determinístico encontra.
 *
 * `acionavel` distingue duas coisas que é fácil confundir — e confundir custa
 * caro: reconhecer a PALAVRA não é o mesmo que saber AGIR. "analise" é tema,
 * não plano; existe habilidade para clima, não para análise. Uma âncora
 * temática não pode inflar a confiança, senão a Função Executiva acha que
 * domina o assunto e deixa de pedir decomposição.
 */
/**
 * Contextos em que "tempo" NÃO é meteorologia. Sem esta trava, "quanto tempo
 * leva para gerar o relatório?" casava a âncora `clima`, virava plano
 * determinístico com confiança 0,92 e a IARA respondia a previsão do tempo —
 * com toda a segurança do mundo. O `RoteadorIntencoes` já tinha essa guarda; a
 * `Percepcao`, que é quem de fato decide a rota, não tinha. Duas camadas de
 * roteamento, uma corrigida e outra não: ver `testes/regressoes.test.ts`.
 */
const TEMPO_NAO_METEOROLOGICO =
  // O lookahead inicial faz a exceção CEDER quando há termo meteorológico
  // inequívoco na frase: "vai chover? quanto tempo até parar" é clima, apesar
  // do "quanto tempo". Só a palavra "tempo" sozinha é ambígua.
  /^(?!.*\b(chuva|chover|chovendo|clima|temperatura|previsao|calor|frio)\b).*(?:\b(quanto|ha quanto|em quanto|qualquer|algum|muito|pouco|todo|um)\s+tempo\b|\btempo\s+(de|para|pra|que|restante|estimado|medio|limite|habil|integral|real)\b|\bao mesmo tempo\b|\bperda de tempo\b)/;

interface Ancora {
  readonly re: RegExp;
  readonly nome: string;
  readonly acionavel: boolean;
  /** Casou `re`, mas casa isto também? Então não é esta âncora. */
  readonly exceto?: RegExp;
  /**
   * "não faça isto" significa NÃO FAÇA — e a âncora some.
   *
   * Vale para as âncoras que disparam receita de EFEITO (energia, pasta,
   * aplicativo): ali a negação inverte o pedido, e agir seria fazer o oposto do
   * que foi dito. NÃO vale para `confirmacao`, cuja receita já lê a polaridade
   * por conta própria (`ehAfirmacao`): remover a âncora ali quebraria "não
   * confirmo", que hoje cancela corretamente.
   */
  readonly negavel?: boolean;
  /**
   * "Como faço para confirmar?" pergunta SOBRE a ação; não a resolve.
   *
   * Separado de `negavel` porque as duas famílias não coincidem: a âncora de
   * confirmação precisa sobreviver à negação (para poder cancelar) e morrer na
   * interrogação (para não confirmar sem querer).
   */
  readonly interrogavel?: boolean;
}

const ANCORAS: ReadonlyArray<Ancora> = [
  {
    re: /\b(chuva|chover|chovendo|tempo|clima|temperatura|previsao)\b/,
    nome: 'clima',
    acionavel: true,
    exceto: TEMPO_NAO_METEOROLOGICO,
  },
  {
    /**
     * `frota` NUNCA sozinha.
     *
     * Todas as outras alternativas desta âncora são frases de contagem; `frota`
     * era a única palavra solta, e por isso capturava tudo que mencionasse a
     * frota por qualquer motivo. "Elabore uma estratégia de redução de custo
     * para a frota" virava plano determinístico e a IARA respondia quantas
     * centrais existem — resposta impecável para uma pergunta que ninguém fez.
     *
     * Mesma família do bug de "tempo": palavra genérica tratada como âncora
     * acionável. Ver `testes/mentira-operacional.test.ts`.
     */
    re: /\b(quantas centrais|centrais ativas|servidores ativos|quantos veiculos)\b|\b(quantos?|quantas?|tamanho da|status da|total da|composicao da)\s+(veiculos na\s+)?frota\b|\bfrota\s+(ativa|total|atual|disponivel)\b/,
    nome: 'infraestrutura',
    acionavel: true,
  },
  {
    re: /\b(esse erro|este erro|ja aconteceu|aconteceu antes|caiu de novo|mesmo problema)\b/,
    nome: 'incidente',
    acionavel: true,
  },
  { re: /\b(que horas|que dia e hoje|data de hoje)\b/, nome: 'relogio', acionavel: true },
  {
    // `pesquis\w*`, não `pesquis\b`: o \b depois de um prefixo exige não-letra
    // em seguida, então "pesquise" e "pesquisa" nunca casavam — a âncora só
    // funcionava para a palavra "pesquis", que ninguém digita. Mesmo motivo
    // para `noticia\w*` ("notícias" no plural). O `RoteadorIntencoes` já tinha
    // essa correção; esta cópia da regra não.
    // A MESMA CORREÇÃO, UMA CONJUGAÇÃO ADIANTE (18/08/2026). O parágrafo acima
    // conserta `pesquis\w*` e para ali: `busca na internet` continuava exigindo
    // o substantivo exato. A operadora escreveu "BUSQUE na internet o preço do
    // diesel S10" e a IARA não reconheceu — o pedido foi parar na nuvem, que
    // estava fora.
    //
    // `bus(c|qu)`, e não `busc`: em português o radical de *buscar* troca o `c`
    // por `qu` antes de `e` — "busque", "busquem", "busquei". Um `busc\w*`
    // parece cobrir o verbo inteiro e não cobre justamente a forma que o
    // operador usa para PEDIR. É a mesma armadilha de `pesquis\b`: supor o
    // radical em vez de conferir a conjugação.
    //
    // O verbo fica preso ao complemento ("na internet", "na web", "no google")
    // de propósito: solto, capturaria "busca de emprego" — a doença de palavra
    // genérica que a âncora `infraestrutura` já pagou caro com `frota`.
    re: /\b(pesquis\w*|noticia\w*)\b|\b(bus(?:c|qu)\w*|procur\w*)\s+(n[ao]\s+(internet|web)|no\s+google)\b/,
    nome: 'busca',
    acionavel: true,
  },
  {
    re: /\b(resum\w*|analis\w*|explic\w*|compar\w*)\b/,
    nome: 'analise',
    acionavel: false,
  },
  // Agente Local. O vocabulário abaixo é o mesmo que `Planejador.extrairNomePasta`,
  // `extrairLocalAutorizado` e `extrairAcaoEnergia` sabem interpretar — reconhecer
  // aqui o que o planejador não sabe extrair produziria âncora sem plano.
  {
    re: /\b(cri[ae]|criar|nova)\s+(uma\s+)?pasta\b|\bpasta\s+(chamada|nomeada|com o nome)\b/,
    nome: 'pasta',
    acionavel: true,
    negavel: true,
  },
  {
    /**
     * O verbo exige o SUBSTANTIVO junto ("repositório", "repo", "código", ou um
     * `git` explícito). "Atualize o sistema" e "atualiza aí" não são pedidos de
     * `git pull` — são frases vagas que, reconhecidas aqui, virariam uma ação
     * sobre código-fonte a partir de uma suposição. A âncora que erra para o
     * lado de não reconhecer devolve a frase ao raciocínio, que pergunta; a que
     * erra para o outro lado altera o repositório de alguém.
     */
    re: /\b(atualiz\w*|puxa|puxar|sincroniz\w*|baixa|baixar)\s+(o\s+|a\s+|as\s+|os\s+|do\s+|as novidades do\s+|as novidades da\s+)?(repositorio|repositorios|repo|codigo|projeto)\b|\bgit pull\b/,
    nome: 'atualizar_repositorio',
    acionavel: true,
    negavel: true,
  },
  {
    /**
     * A LISTA DE SUBSTANTIVOS ESTAVA INCOMPLETA, e a falta era justamente a do
     * aplicativo mais pedido: `chrome` não estava aqui. "Abra o Chrome no
     * computador" — a frase que abre o caderno de testes — não casava âncora
     * nenhuma, caía com confiança 0,35 no plano de raciocínio e ia depender da
     * LLM adivinhar a habilidade. Sem chave da nuvem, não abria nada.
     *
     * O defeito é da família de `pesquis\w*`: a allowlist do `AgenteLocal`
     * ganhou entradas (chrome, edge, paint) e este reconhecedor não ganhou
     * junto. São duas listas que precisam concordar e nada as obrigava a isso —
     * agora `testes/ponte-execucao.test.ts` percorre a allowlist e exige que
     * cada rótulo seja reconhecível aqui.
     */
    re: /\b(abra|abre|abrir|inicie|iniciar|sobe|subir)\s+(o|a|os|as)?\s*(bloco de notas|notepad|calculadora|navegador|explorador|chrome|google chrome|edge|paint|terminal|prompt|aplicativo|programa)\b/,
    nome: 'abrir_app',
    acionavel: true,
    negavel: true,
  },
  {
    /**
     * Fechar vem DEPOIS de abrir na lista e não colide com ela: os verbos são
     * disjuntos. Está separado porque o efeito é oposto, e uma âncora só com a
     * polaridade decidida depois (como em `confirmacao`) faria "abra e feche o
     * bloco de notas" virar uma coisa só.
     */
    re: /\b(fech[ae]|fechar|encerr[ae]|encerrar|mat[ae]|finaliz[ae]|finalizar)\s+(o|a|os|as)?\s*(bloco de notas|notepad|calculadora|navegador|chrome|google chrome|edge|paint)\b/,
    nome: 'fechar_app',
    acionavel: true,
    negavel: true,
  },
  {
    /**
     * "o que tem na área de trabalho" é a forma que as pessoas usam de verdade,
     * e ela não tem verbo de listagem nenhum — por isso a segunda alternativa.
     * A primeira exige o substantivo (arquivos/pastas/documentos) junto do
     * verbo: "mostre o relatório" fala de um documento específico, não de uma
     * listagem, e responder com o conteúdo da pasta seria responder outra coisa.
     *
     * `exceto` SHAREPOINT — achado ao vivo em auditoria (14/08/2026, parte 2):
     * "mostre os documentos do SharePoint sobre frete" casa "mostre ... os
     * documentos" e virava, sem exceção, um plano determinístico de
     * `listar_arquivos` na pasta LOCAL — a IARA respondia o conteúdo de
     * "Documentos" no computador do operador, ignorando "do SharePoint sobre
     * frete" por inteiro. É a mesma família do bug de `centrais_inativas`: uma
     * âncora determinística engole uma frase que pedia outra habilidade
     * (`buscar_documento_sharepoint`, que só o raciocínio emergente alcança) e
     * a origem determinística nunca dá à LLM a chance de escolher a certa. A
     * exceção não tenta reconhecer a intenção certa aqui — só desiste da
     * intenção errada, e devolve a frase para quem sabe interpretar "SharePoint".
     */
    re: /\b(list[ae]|listar|mostr[ae]|mostrar|ver|vej[ae]|quais|quantos)\s+(os\s+|as\s+|meus\s+|minhas\s+|todos\s+os\s+)?(arquivos|pastas|documentos)\b|\bo que (tem|ha|existe)\s+(na|no|em)\s+(minha\s+|meu\s+)?(area de trabalho|desktop|documentos|downloads|pasta)\b|\bconteudo (da|do)\s+(minha\s+|meu\s+)?(area de trabalho|desktop|pasta|documentos|downloads)\b/,
    nome: 'listar_arquivos',
    acionavel: true,
    exceto: /\bsharepoint\b/,
  },
  /**
   * LENTIDÃO VEM ANTES DE `diagnostico` E DE `sistema`, e a ordem é a regra.
   *
   * As três âncoras se sobrepõem em frases reais e respondem coisas diferentes:
   * `diagnostico` é o autoteste da IARA ("você está funcionando?"), `sistema` é
   * uma leitura instantânea ("quanto de memória?"), e esta é uma INVESTIGAÇÃO
   * ("por que está lento?"). "Diagnostique a lentidão do meu computador" casa as
   * três, e a resposta certa é a investigação — quem pergunta por que quer causa,
   * não uma lista de bolinhas verdes nem um número solto.
   *
   * `lento` NUNCA SOZINHO, pela lição de `frota` e de `tempo`: "o cliente está
   * lento para responder" e "esse processo de aprovação é lento" são frases
   * sobre outra coisa, e medir o computador ali seria responder uma pergunta que
   * ninguém fez. O que qualifica é a MÁQUINA aparecer perto — em qualquer das
   * duas ordens, porque "meu computador está lento" e "está lento o computador"
   * são a mesma frase.
   *
   * A segunda alternativa é o pedido de nova medição, que fecha o laço do §14
   * ("meça de novo"). Ela dispensa a palavra da máquina porque nenhuma outra
   * habilidade do catálogo MEDE — não há o que confundir.
   */
  {
    re: /\b(computador|pc|maquina|notebook|windows|micro)\b[^.?!]{0,40}\b(lent[oa]|lentidao|devagar|travando|travad[oa]|arrastando|engasgando|pesad[oa]|nao responde)\b|\b(lent[oa]|lentidao|devagar|travando|travad[oa]|arrastando|engasgando)\b[^.?!]{0,40}\b(computador|pc|maquina|notebook|windows|micro)\b|\b(med[ei]|meca|medir|mede)\s+(o\s+|a\s+)?(desempenho|computador|maquina|pc\s+)?(de\s+novo|novamente)\b/,
    nome: 'lentidao',
    acionavel: true,
  },
  {
    /**
     * `memoria` e `processador` NUNCA sozinhos, pela lição de `frota` e de
     * `tempo`: "não tenho memória de ter pedido isso" e "o processador de
     * pedidos travou" são frases sobre outra coisa. O que qualifica a âncora é a
     * referência à MÁQUINA — computador, PC, sistema — ou a forma de pergunta
     * de medição ("quanto de memória").
     */
    re: /\b(quanto de (memoria|ram)|uso de (memoria|ram|cpu|processador)|(memoria|cpu|processador|desempenho) (do|no) (computador|pc|sistema|meu computador)|informacoes (do|sobre o) (computador|sistema)|status (do|de) (computador|pc|meu computador)|como esta (o|meu) (computador|pc)|especificacoes (do|desse) (computador|pc))\b/,
    nome: 'sistema',
    acionavel: true,
  },
  /**
   * AUDITORIA vem antes de `diagnostico` porque as duas casam "checagem" e
   * respondem coisas diferentes: `diagnostico` é o autoteste dos elos da cadeia
   * (motor, banco, braço), e esta procura o que está ERRADO — capacidade
   * desligada, erro que se repete, plano que nunca resolve, prova sem chave.
   *
   * `auditoria` NUNCA sozinha, pela lição de `frota`: "auditoria" é palavra do
   * dia a dia da Atos Log — há até um assunto `auditoria` em `MemoriaFatos`. "a
   * auditoria da transportadora chega quinta" não é um pedido de autodiagnóstico.
   * O que qualifica é o verbo de execução junto, ou a referência explícita ao
   * que a IARA deve olhar.
   */
  {
    re: /\b(faz|faca|fazer|roda|rodar|executa|executar|quero|preciso de)\s+(uma\s+|a\s+)?auditoria\b|\bauditoria\s+(do sistema|da iara|geral|interna)\b|\bo que (esta|ta) (errado|ruim) (por aqui|no sistema|com voce)\b|\bo que precisa de atencao\b/,
    nome: 'auditoria',
    acionavel: true,
  },
  {
    /**
     * A SEGUNDA METADE (a partir de `descubr[ae]`) fecha um caso real, achado
     * em auditoria (14/08/2026): "descubra se o computador está conectado
     * então" não continha nenhuma palavra da primeira metade — nem
     * "diagnóstico", nem "autoteste" — e caía fora de QUALQUER âncora. Sem
     * receita determinística nem decomposição (frase curta, sem verbo da
     * lista de `mereceDecomposicao`), o pedido ia para `raciocinio_direto`,
     * que não executa nenhuma habilidade: a IARA respondia "vou verificar" e
     * o turno acabava ali — a promessa nunca virava chamada de
     * `diagnosticar_sistema`, e o operador precisava mandar outra mensagem
     * para arrancar uma resposta de verdade (que, sem ter rodado a
     * habilidade nenhuma vez, era a LLM inventando um desfecho).
     *
     * "Conectado" é literalmente a pergunta que `diagnosticar_sistema`
     * responde no primeiro elo verificável (linha "Computador" do painel) —
     * é a âncora certa, só faltava reconhecer a frase.
     */
    re: /\b(diagnostico|diagnosticar|autoteste|auto-teste|checagem geral|status geral|voce esta (ok|bem|funcionando|online)|esta tudo (ok|certo|funcionando))\b|\b(descubr[ae]|verific[ae]|confir[ae]|confer[ei]|ve[ja])\s+se\s+(o\s+|meu\s+)?computador\s+(esta|ta)\s+(mesmo\s+)?conectad[oa]\b|\bcomputador\s+(esta|ta)\s+conectad[oa]\b|\b(esta|ta)\s+conectad[oa]\s+(a\s+)?(voce|mim|iara)\b/,
    nome: 'diagnostico',
    acionavel: true,
  },
  {
    /**
     * `print` e `screenshot` NUNCA sozinhos: "manda o print que o cliente
     * enviou" fala de uma imagem que já existe, e capturar a tela ali seria
     * responder a uma frase que ninguém disse. O verbo (ou o "da tela") é o que
     * separa pedir de mencionar — mesma família do bug de `frota`.
     */
    re: /\b(tir[ae]|tirar|faz|faca|fazer|bat[ae]|bater|captur\w+|salv[ae]|salvar)\s+(um\s+|uma\s+|o\s+|a\s+)?(print|screenshot|captura|foto)\b|\b(print|screenshot|captura|foto)\s+(da|de|do)\s+tela\b|\bcaptur\w+\s+(a\s+|minha\s+|essa\s+)?tela\b/,
    nome: 'captura',
    acionavel: true,
    negavel: true,
  },
  /**
   * Lembretes vêm ANTES de `confirmacao` na lista, e a ordem é o que resolve um
   * conflito real: "cancela o lembrete das 15h" casa as duas âncoras, e a
   * primeira reconhecida é a que vira plano. Sem esta ordem, cancelar um
   * lembrete resolveria — ou pior, confirmaria — uma pendência de energia
   * aberta em outra frase.
   */
  {
    /**
     * `me lembra` exige complemento (`de|do|da|que`): "isso me lembra o
     * incidente de março" é comentário, não pedido. E `me lembro` fica de fora
     * de propósito — é o verbo na primeira pessoa, nunca uma ordem.
     */
    re: /\blembrete[s]?\b|\bme\s+lembr(e|ar)\b|\bme\s+lembra\s+(de|do|da|que)\b|\blembr[ae]\s*-?\s*me\b|\bnao\s+me\s+deixe\s+esquecer\b/,
    nome: 'lembrete',
    acionavel: true,
    negavel: true,
  },
  {
    re: /\b(desligue|desliga|desligar|reinicie|reinicia|reiniciar|suspenda|suspender|hiberne|hibernar)\b/,
    nome: 'energia',
    acionavel: true,
    negavel: true,
  },
  /**
   * AUTORIZAR UM PLANO PROPOSTO — vem ANTES de `confirmacao`, e a ordem resolve
   * um conflito real: "pode executar" casa as duas, e a pendência de energia do
   * `AgenteLocal` não é a mesma coisa que um plano de investigação.
   *
   * A âncora EXIGE a palavra `plano`, e é a trava que torna a ordem segura. Sem
   * ela, "confirmo" e "prossiga" — que hoje resolvem uma confirmação de
   * desligamento — passariam a disputar com um plano aberto, e o desempate
   * silencioso decidiria qual ação de risco alto o operador acabou de autorizar.
   * Uma palavra a mais de exigência aqui vale mais que a conveniência de
   * responder "sim": a investigação termina dizendo, com todas as letras, como
   * responder.
   *
   * `negavel` porque "não execute o plano B" é o oposto exato do pedido, e agir
   * ali seria fazer justamente o que foi proibido.
   *
   * A EXCEÇÃO É PRÓPRIA, e não `interrogavel`, por um motivo que quase passou:
   * `ehPerguntaSobreResolver` só conhece a família de CONFIRMAR
   * (`confirm|prossegu|prossig`), então ela não veria "como eu executo o
   * plano?". Estendê-la para cobrir `execut` teria sido pior que não cobrir —
   * o regex de lá exige um interrogativo antes do verbo, e `pode` está na
   * lista: "pode executar o plano A", que é EXATAMENTE como o operador
   * autoriza, passaria a ser suprimida como pergunta. A exceção aqui é estreita
   * de propósito e não contém `pode`.
   */
  {
    re: /\bplano\s+[a-e]\b|\b(execut\w+|aplic\w+|roda\w*|segu[ei]\w*|assum\w+|vamos com|manda ver)\s+(o\s+|com\s+o\s+|esse\s+|este\s+|aquele\s+)?plano\b|\bpode\s+(executar|aplicar|seguir|rodar)\b/,
    nome: 'executar_plano',
    acionavel: true,
    negavel: true,
    exceto:
      /\b(como|de que jeito|de que forma|o que acontece|o que muda|quanto tempo|por que|porque|em que consiste)\b[^?]{0,60}\b(plano|execut)/,
  },
  {
    re: /\b(confirmo|confirmado|confirmar|prossiga|cancela|cancelar|cancelado|abortar)\b/,
    nome: 'confirmacao',
    acionavel: true,
    /**
     * NÃO é `negavel` — "não confirmo" precisa continuar chegando à receita,
     * que lê a polaridade e cancela. Mas é `interrogavel`: perguntar COMO
     * confirmar não pode resolver a pendência. Ver `ehPerguntaSobreResolver`.
     */
    interrogavel: true,
  },
  /**
   * PROCEDIMENTO DO GW — a âncora que impede a LLM de ser a autoridade sobre se
   * o POP é consultado.
   *
   * O DEFEITO QUE ELA FECHA: sem rota determinística, "como faço o agendamento"
   * dependia de a `DescobertaCapacidades` convencer a LLM a escolher
   * `consultar_procedimento`. Quando ela não escolhia, o Kernel caía em
   * `raciocinio_direto` e a IARA respondia de conhecimento geral — sem POP, sem
   * citação, sem lacuna registrada. "Ignore o POP" e "use sua experiência" não
   * tinham defesa nenhuma, porque a defesa morava DENTRO da habilidade e quem
   * decidia invocá-la estava fora dela.
   *
   * FICA POR ÚLTIMO NA LISTA de propósito: toda âncora existente tem
   * prioridade, e esta só recolhe o que ninguém mais reivindicou.
   *
   * O REGEX É COMPOSTO, nunca copiado. `Percepcao` já pagou por uma cópia de
   * regra que não recebeu a correção da original (`pesquis\b`, ver a âncora
   * `busca`). O vocabulário e as formas de pedido moram em
   * `IntencaoProcedimento.ts`, e a mesma fonte alimenta a habilidade.
   *
   * As duas primeiras alternativas dispensam intenção: um código `IT-ADMLUFT-NNN`
   * e a palavra `sos` só existem nesta conversa para pedir procedimento. A
   * terceira EXIGE intenção procedimental E vocabulário do GW — substantivo
   * solto capturaria toda frase que mencionasse "coleta", que é a doença que a
   * âncora `infraestrutura` já pagou caro com `frota`.
   */
  {
    re: new RegExp(
      // Dispensam intenção: só existem nesta conversa para pedir procedimento.
      '\\bit[\\s-]*admluft[\\s-]*\\d{3}\\b|\\bsos\\b|\\b(?:ignor\\w+|sem)\\s+(?:o\\s+)?pop\\b|' +
        // Exigem intenção E vocabulário do GW. A intenção pode ser uma forma de
        // pedido ("como faço"), um verbo operacional no infinitivo ("emitir
        // CTE") ou uma TENTATIVA DE ATALHO ("o jeito mais rápido de encerrar o
        // manifesto") — esta última porque pedir para contornar o procedimento
        // É um pedido sobre o procedimento, e mandá-la ao raciocínio livre
        // entregava exatamente o que ela pedia: resposta sem POP.
        `(?=[\\s\\S]*(?:${INTENCAO_PROCEDIMENTAL.source}|${INFINITIVO_OPERACIONAL.source}` +
        `|${TENTATIVA_DE_ATALHO.source}))(?=[\\s\\S]*${VOCABULARIO_GW.source})`,
    ),
    nome: 'procedimento_gw',
    acionavel: true,
    /**
     * "Quantas OCIs temos hoje" é a PLANILHA, não o POP. Sem esta exclusão a
     * âncora roubaria as frases de `consultar_estatisticas_cargas_luft` — o
     * vocabulário é o mesmo, a pergunta é outra.
     */
    exceto: PERGUNTA_DE_DADO,
  },
];

export class MotorPercepcao {
  private readonly mente = new TeoriaDaMente();

  perceber(bruto: string): Percepcao {
    const temporal: SinalTemporal = this.mente.registrarChegada();
    const leitura: LeituraOperador = this.mente.analisar(bruto, temporal);

    /**
     * A VOZ VEM ANTES DA ÂNCORA.
     *
     * Âncora procurada na frase inteira não distingue "desligue o computador"
     * de "o e-mail diz: desligue o computador" — e a segunda armava uma
     * pendência de risco alto por causa de uma frase que o operador só estava
     * mostrando. O reconhecimento roda sobre a voz PRÓPRIA; o que ele atribuiu
     * a terceiro fica de fora do gatilho e sobrevive em `bruto` para o
     * raciocínio comentar.
     *
     * A classificação de tipo e a medição de urgência continuam olhando a frase
     * inteira: um e-mail citado dizendo "o sistema caiu" é urgente de verdade,
     * mesmo não sendo um comando.
     */
    const vozes = separarVozes(bruto);
    // `corrigirTypos` só ajuda a ÂNCORA reconhecer a palavra — o texto usado
    // para extrair o que o operador realmente pediu continua sendo `bruto`,
    // sem correção nenhuma. Ver o comentário da função em `texto.ts`.
    const t = corrigirTypos(normalizar(bruto));
    const tPropria = vozes.temRelato ? corrigirTypos(normalizar(vozes.propria)) : t;

    /**
     * Uma âncora de EFEITO só sobrevive quando a frase de fato PEDE a ação.
     * Três formas de não pedir, e as três chegavam armando pendência:
     * citar (tratado em `separarVozes`), proibir (`sobNegacao`) e apenas
     * mencionar — "se eu pedisse para desligar", "você consegue desligar?".
     */
    const encontradas = ANCORAS.filter((a) => {
      if (a.exceto?.test(tPropria)) return false;
      // "como faço para confirmar?" pergunta sobre a resolução; não resolve.
      // Este teste é da mensagem inteira: não existe "confirmar em parte".
      if (a.interrogavel && ehPerguntaSobreResolver(tPropria)) return false;

      /**
       * TODAS as ocorrências, não só a primeira.
       *
       * `String.match` sem `g` devolve o primeiro casamento, e era isso que
       * fazia "imagine que eu pedisse para desligar. agora desligue de verdade"
       * perder a âncora inteira: a supressão era decidida pela ocorrência
       * hipotética e a ordem real da segunda frase nunca era olhada. A âncora
       * sobrevive se UMA ocorrência for pedido de verdade.
       */
      const todas = [...tPropria.matchAll(new RegExp(a.re.source, 'g'))];
      return todas.some((m) => {
        if (m.index === undefined) return false;
        if (!a.negavel) return true;
        // "não desligue o computador" não é um pedido de desligamento. É o
        // oposto exato dele, e agir seria fazer o contrário do que foi dito.
        if (sobNegacao(tPropria, m.index)) return false;
        // "o que aconteceria se eu pedisse para desligar?" fala da ação; não a
        // pede. Escopo por PERÍODO, para não engolir ordem em frase seguinte.
        if (periodoEhIrrealis(tPropria, m.index)) return false;
        return true;
      });
    });
    const ancoras = encontradas.map((a) => a.nome);
    const acionaveis = encontradas.filter((a) => a.acionavel).length;
    const tipo = this.classificar(t, bruto);
    const urgencia = this.medirUrgencia(t, leitura);

    return {
      bruto,
      tipo,
      urgencia,
      idioma: 'pt-BR',
      objetivo_provavel: this.supor(tipo, ancoras),
      leitura,
      // Confiança = "sei agir sobre isto", não "reconheci uma palavra".
      // Só âncora acionável sobe o número; âncora temática fica no meio do
      // caminho, que é exatamente o que ela é.
      confianca:
        acionaveis > 0 ? 0.92 : tipo === 'saudacao' ? 0.85 : ancoras.length > 0 ? 0.5 : 0.35,
      ancoras,
      citado: vozes.relatada,
    };
  }

  private classificar(t: string, bruto: string): TipoEntrada {
    if (SAUDACAO.test(t) && bruto.length < 40) return 'saudacao';
    if (DOCUMENTO.test(t)) return 'documento';
    if (COMANDO.test(t)) return 'comando';
    return 'texto';
  }

  private medirUrgencia(t: string, leitura: LeituraOperador): Urgencia {
    if (URGENTE.test(t)) return 'alta';
    if (leitura.estado === 'frustrado' || leitura.estado === 'estressado') return 'alta';
    if (leitura.estado === 'produtivo' || leitura.estado === 'focado') return 'normal';
    return 'normal';
  }

  private supor(tipo: TipoEntrada, ancoras: readonly string[]): string {
    if (ancoras.includes('incidente')) return 'retrospectiva de incidente';
    if (ancoras.includes('infraestrutura')) return 'consulta operacional';
    if (ancoras.includes('clima')) return 'condição externa';
    if (ancoras.includes('relogio')) return 'referência temporal';
    if (ancoras.includes('busca')) return 'levantamento factual';
    if (ancoras.includes('analise')) return 'análise';
    if (ancoras.includes('confirmacao')) return 'resolução de ação pendente';
    if (ancoras.includes('pasta')) return 'organização de arquivos';
    if (ancoras.includes('abrir_app')) return 'abertura de aplicativo';
    if (ancoras.includes('fechar_app')) return 'encerramento de aplicativo';
    if (ancoras.includes('listar_arquivos')) return 'inventário de pasta';
    if (ancoras.includes('executar_plano')) return 'autorização de um plano proposto';
    if (ancoras.includes('auditoria')) return 'auditoria do que a IARA observa de si';
    if (ancoras.includes('lentidao')) return 'investigação de lentidão no computador do operador';
    if (ancoras.includes('sistema')) return 'estado da máquina do operador';
    if (ancoras.includes('diagnostico')) return 'autodiagnóstico do sistema';
    if (ancoras.includes('captura')) return 'registro visual da tela';
    if (ancoras.includes('lembrete')) return 'marcação de lembrete';
    if (ancoras.includes('energia')) return 'controle de energia da máquina';
    if (tipo === 'documento') return 'análise documental';
    if (tipo === 'saudacao') return 'abertura de conversa';
    if (tipo === 'comando') return 'execução de ação';
    return 'indeterminado';
  }
}
