/**
 * Habilidades do Agente Local — as mãos da IARA na máquina onde o motor roda.
 *
 * Este arquivo é a PONTE entre o catálogo e o `AgenteLocal`. Ele existia, foi
 * perdido na remoção acidental de 10/08 e reconstruído aqui: as âncoras da
 * `Percepcao` e as receitas do `Planejador` sobreviveram ao acidente, mas os
 * manifestos não — e receita apontando para habilidade inexistente é a pior
 * falha possível, porque o passo é PULADO em silêncio e a resposta final passa
 * a ser inventada pela LLM. Ver `testes/regressoes.test.ts`.
 *
 * Nenhuma regra de segurança mora aqui. Raízes autorizadas, allowlist de
 * aplicativos e a pendência de 60s da energia são do `AgenteLocal`; este
 * arquivo só declara esquema, permissão e timeout. A separação é proposital:
 * afrouxar um manifesto não afrouxa uma fronteira.
 */

import type { Habilidade, Verificacao } from '../Habilidade';
import {
  agenteLocal,
  ROTULO_DO_LOCAL,
  type AcaoEnergia,
  type LocalAutorizado,
} from '../../AgenteLocal';
import { braco, motorTemMaos } from '../../Braco';
import type { AcaoDesktop } from '../../../../lib/execucao';
import type { ContextoHabilidade } from '../Habilidade';

const LOCAIS = Object.keys(ROTULO_DO_LOCAL) as LocalAutorizado[];

/**
 * A PROVA de um passo que atravessou a ponte.
 *
 * As três habilidades que mexem no computador têm o mesmo verificador, e ele é
 * uma linha: devolver o que o lado das mãos apurou. Cada uma tinha a própria
 * cópia da checagem de disco, e essa duplicação era inofensiva enquanto motor e
 * mãos eram a mesma máquina — depois disso, virou três lugares conferindo o
 * disco errado.
 *
 * O RAMO DE FALLBACK não é defensivo, é o caminho legítimo de quando não houve
 * execução nenhuma nesta conversa (a suíte chama `verificar` isolado, e é bom
 * que possa) e o motor de fato tem as mãos desta máquina. Fora disso ele recusa
 * a inventar prova: sem relato e sem mãos, a resposta honesta é que não há como
 * conferir daqui.
 */
export function provaDaPonte(
  ctx: ContextoHabilidade,
  acao: AcaoDesktop,
  local: () => Verificacao,
): Verificacao {
  const relato = braco.ultimoDe(ctx.id_usuario, ctx.sessao, acao);
  if (relato) return relato.prova;
  if (motorTemMaos()) return local();
  return {
    confirmado: false,
    evidencia: 'nenhuma execução registrada nesta conversa e o motor não tem as mãos desta máquina',
    motivo: 'sem_meio_de_verificar',
  };
}

export const criarPasta: Habilidade = {
  manifesto: {
    id: 'criar_pasta',
    nome: 'Criar pasta',
    descricao:
      'Cria uma pasta em um local autorizado da máquina (Área de Trabalho, Documentos ou Downloads). ' +
      'Não aceita caminho livre — só um desses três locais nomeados. Use para "crie uma pasta chamada X".',
    exemplos: [
      'Crie uma pasta chamada Relatórios',
      'Cria uma pasta Notas Fiscais nos Downloads',
    ],
    capacidades: ['criar pasta em local autorizado'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 5000,
    custo: 'zero',
    risco: 'medio',
    // A segunda chamada encontra a pasta e não cria outra: `existsSync` antes do
    // `mkdir` é o que torna isto convergente, não uma coincidência feliz.
    idempotencia: 'escrita_idempotente',
    esquema: {
      nome: { tipo: 'texto', obrigatorio: true },
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    /**
     * O PEDIDO ATRAVESSA A PONTE em vez de virar chamada de função.
     *
     * A troca parece cerimônia e não é: a chamada direta assumia, sem nunca
     * declarar, que o disco do processo era o disco do operador. Com o motor na
     * nuvem essa suposição criava a pasta no contêiner Linux e relatava sucesso.
     * O Braço responde a pergunta que a chamada de função não sabia fazer —
     * ONDE estão as mãos — e, quando não há nenhuma, recusa em voz alta.
     */
    const relato = await braco.executar({
      acao: 'criar_pasta',
      parametros: { nome: String(ctx.parametros.nome), local: String(ctx.parametros.local) },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `criar_pasta em ${ctx.parametros.local} [${relato.execucao_id}] ${relato.estado}`,
      // `resolveu` é o ESTADO apurado, nunca a ausência de exceção. Nome
      // recusado pela regra de segurança devolve texto útil e `false` — não é
      // erro, é recusa; e `expirou` também é `false`, porque não se sabe.
      resolveu: relato.estado === 'sucesso',
    };
  },

  /**
   * Confere o DISCO — o da máquina que executou. É a verificação canônica do
   * sistema: nome pedido → nome validado → raiz resolvida → o diretório está lá?
   *
   * Note que ela não olha o texto devolvido por `executar`. Olhar o próprio
   * relato para confirmar o relato é o que se está tentando evitar.
   */
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'criar_pasta', () =>
      agenteLocal.provaDaPasta(
        String(ctx.parametros.nome),
        String(ctx.parametros.local) as LocalAutorizado,
      ),
    );
  },
};

export const abrirAplicativo: Habilidade = {
  manifesto: {
    id: 'abrir_aplicativo',
    nome: 'Abrir aplicativo',
    descricao:
      'Abre um aplicativo de uma lista fechada e revisada (Bloco de Notas, Calculadora, Paint, ' +
      'Explorador de Arquivos, Chrome, Edge). Não executa comando arbitrário. Para Chrome/Edge, ' +
      'aceita opcionalmente um "site" (endereço http:// ou https:// completo) para abrir já ' +
      'naquela página — outros aplicativos da lista não têm o que fazer com um endereço.',
    exemplos: ['Abre o bloco de notas', 'Abre o Chrome no site da LUFT'],
    capacidades: ['abrir aplicativo da lista autorizada'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    /**
     * O teto subiu de 4 s porque a habilidade deixou de mentir. Antes ela
     * respondia na hora — soltava o processo e afirmava "aberto". Agora ela
     * espera o lançamento e o processo aparecer na tabela, o que numa máquina
     * fria leva segundos. Tempo gasto para poder afirmar é tempo bem gasto; o
     * teto precisa acomodar o prazo do Braço (20 s) com folga.
     */
    timeout_ms: 25000,
    custo: 'zero',
    risco: 'medio',
    // Mesmo risco de `criar_pasta` e semântica oposta — é o par que prova que as
    // duas perguntas são independentes. Lançar o Bloco de Notas duas vezes abre
    // duas janelas, e o processo é solto com `unref`: não há como recolher.
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      aplicativo: { tipo: 'texto', obrigatorio: true },
      /**
       * A VALIDAÇÃO DE VERDADE (esquema http/https, sem espaço, sem aspas)
       * mora em `AgenteLocal.validarUrlAbertura` — o `CampoEsquema` genérico
       * só sabe conferir tipo, presença e teto de tamanho, não formato de
       * URL. `max` aqui é só o cinto de segurança contra um valor absurdo
       * chegando cedo demais; a recusa que importa é a de lá.
       */
      site: { tipo: 'texto', obrigatorio: false, max: 2000 },
    },
  },
  async executar(ctx) {
    const site = ctx.parametros.site;
    const relato = await braco.executar({
      acao: 'abrir_aplicativo',
      parametros: {
        aplicativo: String(ctx.parametros.aplicativo),
        ...(typeof site === 'string' && site.trim() ? { url: site } : {}),
      },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `abrir_aplicativo [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },

  /**
   * ESTA ERA A LIMITAÇÃO DECLARADA, e ela deixou de ser necessária.
   *
   * O texto anterior dizia, com razão para o código de então: "processo lançado
   * desanexado; não acompanho o ciclo de vida dele". A IARA soltava o filho e
   * não olhava para trás, então `sem_meio_de_verificar` era a resposta honesta.
   *
   * O que mudou não foi a disposição de afirmar — foi a existência de evidência.
   * O executor agora fotografa a tabela de processos ANTES e DEPOIS, e a
   * diferença entre as duas fotos é um fato conferível. Quando ela sobe, há
   * prova; quando o aplicativo já estava aberto, `sem_meio_de_verificar`
   * continua sendo a resposta certa — e agora é uma ressalva sobre UM caso, não
   * sobre todos.
   */
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'abrir_aplicativo', () => ({
      confirmado: false,
      evidencia: 'nenhuma execução registrada nesta conversa',
      motivo: 'nao_encontrado',
    }));
  },
};

/**
 * Fechar um aplicativo — o par que faltava de `abrir_aplicativo`.
 *
 * RISCO `medio`, e não `alto`, porque o executor recusa forçar: sem `/F`, um
 * programa com trabalho não salvo simplesmente não fecha, e a IARA relata isso.
 * O que tornaria esta habilidade irreversível — matar o processo por cima do
 * documento aberto de alguém — é justamente o que ela não faz.
 */
export const fecharAplicativo: Habilidade = {
  manifesto: {
    id: 'fechar_aplicativo',
    nome: 'Fechar aplicativo',
    descricao:
      'Fecha um aplicativo da lista autorizada no computador do operador, pedindo educadamente ao ' +
      'Windows (nunca forçando). Se houver trabalho não salvo, o programa recusa e a IARA diz isso. ' +
      'Use para "feche o bloco de notas", "pode fechar o Chrome".',
    exemplos: ['Fecha o bloco de notas', 'Pode fechar o Chrome'],
    capacidades: ['fechar aplicativo sem forçar'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 25000,
    custo: 'zero',
    risco: 'medio',
    /**
     * Fechar duas vezes converge: na segunda o processo já não está lá, e o
     * executor devolve "já não estava aberto" sem tocar em nada. É o oposto de
     * `abrir_aplicativo`, e o par continua servindo de exemplo de que risco e
     * semântica são perguntas independentes.
     */
    idempotencia: 'escrita_idempotente',
    esquema: { aplicativo: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'fechar_aplicativo',
      parametros: { aplicativo: String(ctx.parametros.aplicativo) },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `fechar_aplicativo [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'fechar_aplicativo', () => ({
      confirmado: false,
      evidencia: 'nenhuma execução registrada nesta conversa',
      motivo: 'nao_encontrado',
    }));
  },
};

/**
 * Listar o que está numa pasta autorizada.
 *
 * RISCO `baixo` e sem verificador — e as duas coisas andam juntas, por contrato:
 * quem só lê não implementa `verificar`, porque verificar uma leitura seria
 * repetir a leitura, pagando duas vezes por nenhuma garantia nova. A resposta É
 * o resultado.
 */
export const listarArquivos: Habilidade = {
  manifesto: {
    id: 'listar_arquivos',
    nome: 'Listar arquivos',
    descricao:
      'Lista pastas e arquivos de um local autorizado do computador do operador (Área de Trabalho, ' +
      'Documentos ou Downloads). Não aceita caminho livre. Use para "o que tem na minha área de ' +
      'trabalho", "liste os arquivos de Downloads".',
    exemplos: ['O que tem na minha área de trabalho?', 'Lista os arquivos de Downloads'],
    capacidades: ['listar arquivos de local autorizado'],
    /**
     * "documento" é o conceito, e ele NÃO é a pasta Documentos — a descrição
     * usa a palavra nos dois sentidos, e era por isso que « quais arquivos estão
     * nos documentos? » ia parar na planilha de cargas.
     */
    conceitos: [
      { nome: 'arquivo', termos: ['documento', 'pasta', 'conteudo', 'diretorio'] },
    ],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 15000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'listar_arquivos',
      parametros: { local: String(ctx.parametros.local) },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
    });
    return {
      texto: relato.texto,
      detalhe: `listar_arquivos em ${ctx.parametros.local} [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
};

/**
 * O estado da máquina do operador — memória, processador, tempo ligado, rede.
 *
 * SÍNCRONA: `executar` espera `braco.executar` terminar (2-3s típico) e o
 * resultado vira parte desta MESMA resposta — não existe segunda mensagem
 * chegando depois. Achado ao vivo em auditoria (14/08/2026): a IARA disse "o
 * retorno vem por ele, não por mim; assim que chegar eu te digo" e nunca
 * completou a promessa — confundiu esta chamada direta com o ciclo autônomo
 * (`CicloAutonomo`/`Vigia`), que usa a MESMA ação (`medir_desempenho`) mas de
 * fato reporta depois, por iniciativa própria. A descrição deixa isso
 * explícito para não repetir a confusão.
 */
export const informacoesSistema: Habilidade = {
  manifesto: {
    id: 'informacoes_sistema',
    nome: 'Informações do computador',
    descricao:
      'Consulta o estado do computador do operador: memória em uso, processador, tempo ligado e ' +
      'interfaces de rede. Use para "quanto de memória meu computador está usando", "meu computador ' +
      'está conectado", "como está o PC". SÍNCRONA: o resultado sai nesta mesma resposta, em poucos ' +
      'segundos — nunca diga que vai avisar depois, porque não há um "depois" aqui.',
    exemplos: ['Quanto de memória meu computador está usando?', 'Como está o PC agora?'],
    capacidades: ['memória, processador e rede da máquina'],
    /**
     * DECLARADA porque o `id` começa por substantivo: `informacoes_sistema` não
     * tem verbo para a inferência ler, e a trava de compatibilidade RECUSAVA
     * esta habilidade por não conseguir classificá-la — « como está o PC
     * agora? » perdia a única habilidade que responde isso.
     */
    operacao_semantica: 'leitura',
    conceitos: [{ nome: 'computador', termos: ['maquina', 'memoria', 'processador', 'cpu', 'pc'] }],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 15000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'informacoes_sistema',
      parametros: {},
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
    });
    return {
      texto: relato.texto,
      detalhe: `informacoes_sistema [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
};

/**
 * Captura de tela — a habilidade mais indiscriminada do catálogo, e por isso a
 * que mais depende de uma fronteira escrita.
 *
 * RISCO `medio`, NÃO `alto`, e a distinção é do contrato, não de conveniência:
 * `alto` é o que é irreversível ou alcança terceiro. Uma captura é um arquivo
 * no disco do próprio operador — reversível apagando, e ninguém de fora a vê.
 * Cobrar confirmação prévia aqui gastaria a confirmação, que só funciona
 * enquanto for rara: um sistema que pergunta "tem certeza?" o tempo todo ensina
 * a responder "sim" sem ler.
 *
 * O QUE DE FATO PROTEGE ESTA HABILIDADE não é o nível de risco, é o que ela
 * devolve. `executar` entrega caminho e tamanho; nunca bytes. O contrato de
 * `ResultadoHabilidade.texto` diz, com todas as letras, que ele é "insumo do
 * próximo passo" — ou seja, pode terminar no prompt. Uma captura de tela leva
 * junto tudo que estava aberto: senha à mostra, conversa de outra pessoa, tela
 * de um sistema que não é nosso. Ela fica onde já estava, no computador de quem
 * pediu, e o kernel aprende apenas que ela existe.
 *
 * É a mesma regra do RAG, que injeta assinatura e nunca log bruto.
 */
export const capturarTela: Habilidade = {
  manifesto: {
    id: 'capturar_tela',
    nome: 'Captura de tela',
    descricao:
      'Fotografa a tela do computador onde o motor roda e salva um PNG numa pasta autorizada ' +
      '(Área de Trabalho, Documentos ou Downloads). Devolve o caminho e o tamanho do arquivo — ' +
      'NUNCA o conteúdo da imagem, que não é lido nem transmitido. Use para "tira um print", ' +
      '"captura a tela", "salva uma foto do que está aberto".',
    exemplos: ['Tira um print da tela', 'Captura a tela e salva nos Documentos'],
    capacidades: ['capturar tela em PNG local'],
    /** « faz um print aí » não alcançava: "print" só existia no exemplo. */
    conceitos: [{ nome: 'tela', termos: ['print', 'captura', 'screenshot', 'foto'] }],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    // Add-Type carrega System.Drawing na primeira chamada e isso é lento numa
    // máquina fria. Timeout curto aqui produziria falha aparente numa captura
    // que estava a caminho.
    timeout_ms: 20000,
    custo: 'zero',
    risco: 'medio',
    // Cada chamada nasce com carimbo de segundo no nome e produz um arquivo
    // novo — duas capturas são dois FATOS distintos, e sobrescrever a primeira
    // para "convergir" apagaria o instante que alguém quis guardar.
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      local: { tipo: 'texto', padrao: 'documentos', dentre: LOCAIS },
    },
  },

  /**
   * NÃO existe `indisponivelPorque` aqui, e a ausência é a decisão.
   *
   * Plataforma sem tela é um motivo legítimo de indisponibilidade — mas
   * habilidade indisponível some do que o Planejador pode pedir, e a receita
   * determinística de `captura` passaria a apontar para o vazio no motor
   * publicado (Linux). O operador receberia silêncio ou uma exceção. Com a
   * recusa dentro do executor ele recebe uma frase que explica o motivo, que é
   * o comportamento que o resto do Agente Local já tem para aplicativo fora da
   * allowlist.
   */
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'capturar_tela',
      parametros: { local: String(ctx.parametros.local) },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `capturar_tela em ${ctx.parametros.local} [${relato.execucao_id}] ${relato.estado}`,
      // O FATO é o arquivo apurado no disco de quem executou, não a ausência de
      // exceção: as duas recusas (sem tela, raiz ausente) devolvem texto útil e
      // nada no mapa de capturas.
      resolveu: relato.estado === 'sucesso',
    };
  },

  /**
   * Confere o DISCO — e confere o tamanho junto, na máquina que fotografou.
   *
   * Só `existsSync` não bastaria: o `Bitmap.Save` do .NET cria o arquivo antes
   * de escrever, e um PNG de zero byte existe sem ser uma foto. Arquivo vazio é
   * `divergente` — houve execução e o resultado não presta —, não
   * `nao_encontrado`.
   */
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'capturar_tela', () => agenteLocal.provaDaCaptura(ctx.id_usuario));
  },
};

/**
 * Energia NUNCA executa aqui. Esta habilidade só REGISTRA a pendência e devolve
 * o pedido de confirmação — quem executa é `resolver_confirmacao`, e só depois
 * de o mesmo operador dizer "confirmo" dentro da janela de 60s.
 */
export const acionarEnergia: Habilidade = {
  manifesto: {
    id: 'acionar_energia',
    nome: 'Energia da máquina',
    descricao:
      'Prepara desligar, reiniciar ou suspender a máquina. NUNCA executa direto: registra uma ' +
      'pendência e pede confirmação explícita do operador.',
    exemplos: ['Desliga o computador', 'Reinicia a máquina para mim'],
    capacidades: ['desligar, reiniciar ou suspender com confirmação'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 3000,
    custo: 'zero',
    risco: 'alto',
    // Esta habilidade não desliga nada: ela ARMA uma pendência. Pedir duas vezes
    // converge para uma pendência só. Quem carrega o efeito irreversível — e a
    // semântica não idempotente — é `resolver_confirmacao`.
    idempotencia: 'escrita_idempotente',
    esquema: {
      acao: {
        tipo: 'texto',
        padrao: 'desligar',
        dentre: ['desligar', 'reiniciar', 'suspender'],
      },
    },
  },
  async executar(ctx) {
    const acao = String(ctx.parametros.acao) as AcaoEnergia;

    /**
     * ENERGIA AINDA NÃO ATRAVESSA A PONTE — e por isso ela recusa quando as
     * mãos não são daqui. Esta é a ÚNICA família do Agente Local que continua
     * executando no processo do motor, e a razão é honesta: a pendência R2 é um
     * interlock em memória amarrado a (operador, sessão), com uma máquina de
     * autorização de sete conferências no jornal por cima. Mover isso para o
     * outro lado de uma rede é um trabalho por si — e fazê-lo às pressas, na
     * habilidade que desliga computador, seria a pior ordem possível de
     * prioridades.
     *
     * O que NÃO se pode aceitar enquanto isso é o comportamento anterior: com o
     * motor na nuvem, "desligue o computador" armava uma pendência e o
     * "confirmo" mandava `shutdown` no CONTÊINER. Um servidor derrubado por um
     * comando dirigido a um desktop. Recusar em voz alta é a resposta certa
     * para uma capacidade que existe e não alcança o destino pedido.
     */
    if (!motorTemMaos()) {
      return {
        texto:
          'Ainda não consigo desligar, reiniciar ou suspender o seu computador a distância. ' +
          'Eu chego nele para abrir programas, criar pastas e tirar print, mas o controle de energia ' +
          'só funciona quando eu estou rodando na própria máquina — e não é o caso agora. ' +
          'Prefiro dizer isso a mexer na energia do servidor errado.',
        detalhe: `energia:${acao} recusada: o motor não tem as mãos desta máquina`,
        resolveu: false,
      };
    }

    /**
     * DUAS TRAVAS INDEPENDENTES, e é de propósito que sejam duas.
     *
     * A primeira é o interlock do dispositivo (`agenteLocal.pedirEnergia`): um
     * slot em memória, amarrado a (operador, sessão), com janela de 60s. É rápida,
     * síncrona e morre com o processo.
     *
     * A segunda é a OPERAÇÃO PERSISTIDA, armada aqui. Ela é quem carrega o nonce,
     * a expiração explícita, o cancelamento definitivo e — o que a primeira não
     * tem como ter — um registro que sobrevive ao processo. Sem ela, um crash no
     * meio do ciclo apagava toda memória de que a ação existiu, e "não sei que
     * existiu" é indistinguível de "nunca aconteceu": o operador pede de novo e
     * o efeito sai duas vezes.
     *
     * `confirmar` exige as duas. Uma trava que some no restart e uma que não
     * some não são redundância — cobrem falhas diferentes.
     *
     * O ID LÓGICO É OUTRO (`energia_da_maquina`), não `acionar_energia`. São
     * coisas distintas: esta habilidade ARMA (reversível, idempotente); a
     * operação armada é o DESLIGAMENTO (irreversível, não idempotente). Fundir
     * as duas identidades faria a impressão do efeito colidir consigo mesma e a
     * própria armação ser recusada como duplicata.
     */
    const armada = await ctx.registro.armar({
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      habilidade: 'energia_da_maquina',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { acao },
      origem_pedido: ctx.operacao?.id_operacao ?? ctx.sessao,
    });

    /**
     * `armar` devolve `null` quando a reserva encontrou um efeito idêntico já em
     * curso — pedir "desligar" duas vezes seguidas, ou pedir em duas conversas.
     * A pendência que JÁ EXISTE nesta conversa é a resposta certa: reusá-la é o
     * comportamento convergente que a semântica desta habilidade promete.
     */
    const pendente = armada ?? ctx.registro.pendenteDe(ctx.id_usuario, ctx.sessao);

    /**
     * Sem operação persistida NESTA conversa, o dispositivo não é armado.
     *
     * Armar aqui produziria o estado que a prova de escrita pegou: dispositivo
     * pronto, jornal vazio, e um "confirmo" que precisa decidir em quem
     * acreditar. A ação existe — em outra conversa — e é lá que ela se confirma.
     */
    if (!pendente) {
      return {
        texto:
          `Você já tem um pedido de ${acao} aguardando confirmação em outra conversa. ` +
          'Confirme por lá — não armo a mesma ação irreversível duas vezes.',
        detalhe: `energia:${acao} recusada: pendência idêntica em outro contexto`,
        resolveu: false,
      };
    }

    return {
      texto: agenteLocal.pedirEnergia(ctx.id_usuario, acao, ctx.sessao),
      detalhe: `energia:${acao} pendente de confirmação (${pendente.id_operacao})`,
      resolveu: true,
    };
  },

  /**
   * O que esta habilidade PROMETE é registrar uma pendência — não desligar
   * nada. Então é exatamente isso que se verifica. Verificar aqui se a máquina
   * desligou seria verificar a promessa errada.
   */
  async verificar(_resultado, ctx) {
    return agenteLocal.temPendencia(ctx.id_usuario, ctx.sessao)
      ? { confirmado: true, evidencia: 'pendência registrada e dentro da janela de 60s' }
      : {
          confirmado: false,
          evidencia: 'nenhuma pendência ativa para este operador após a execução',
          motivo: 'divergente',
        };
  },
};

export const resolverConfirmacao: Habilidade = {
  manifesto: {
    id: 'resolver_confirmacao',
    /** Só fecha o que o operador abriu antes. Ver ManifestoHabilidade. */
    fecha_interacao_aberta: true,
    nome: 'Resolver confirmação pendente',
    descricao:
      'Fecha o ciclo de uma ação que ficou aguardando confirmação: executa se o operador confirmou, ' +
      'aborta se cancelou. Sem pendência válida, diz isso em vez de executar qualquer coisa.',
    exemplos: ['confirmo', 'não, cancela'],
    capacidades: ['executar ou abortar ação pendente de confirmação'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 3000,
    custo: 'zero',
    risco: 'alto',
    // Aqui mora o `shutdown.exe`. Consumir a pendência uma única vez é o que
    // impede o segundo agendamento, e agora isso é contrato declarado em vez de
    // efeito colateral de um `delete` no mapa.
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      resposta: { tipo: 'texto', obrigatorio: true, dentre: ['confirmo', 'cancelar'] },
    },
  },
  async executar(ctx) {
    const confirmou = ctx.parametros.resposta === 'confirmo';
    /**
     * Lido ANTES de confirmar, porque `confirmar` apaga a pendência: depois da
     * chamada é impossível distinguir "confirmei uma ação real" de "não havia
     * nada para confirmar". Sem este booleano, `verificar` afirmava que um
     * desligamento tinha sido agendado toda vez que alguém digitava "confirmo"
     * — inclusive com a fala do executor dizendo, na linha de cima, que não
     * havia ação pendente. Duas frases contraditórias na mesma resposta.
     */
    /**
     * O TIPO decide qual confirmação executar depois — síncrona e fogo-e-
     * esquece para energia, assíncrona e que espera a Meta responder para
     * WhatsApp. Ver `AgenteLocal.confirmarComunicacao` para o porquê de não
     * serem a mesma função. `havia` continua existindo como nome porque é
     * exatamente o que as próximas linhas perguntam: havia ALGUMA pendência?
     */
    const tipo = agenteLocal.tipoPendencia(ctx.id_usuario, ctx.sessao);
    const havia = tipo !== null;

    /** A operação persistida que corresponde a esta pendência, se houver. */
    await ctx.registro.expirarVencidas();
    const operacaoPendente = ctx.registro.pendenteDe(ctx.id_usuario, ctx.sessao);

    /**
     * CANCELAR NUNCA PEDE PROVA. Assimetria deliberada, herdada do
     * `AgenteLocal` e agora estendida ao jornal: desistir custa nada se for
     * demais e custa um desligamento se for de menos. O cancelamento alcança o
     * dispositivo E a operação persistida, e `cancelada` é terminal — nenhum
     * "confirmo" atrasado ressuscita o que o operador desistiu de fazer.
     */
    if (!confirmou) {
      if (operacaoPendente) {
        await ctx.registro.cancelar(operacaoPendente.id_operacao, 'o operador desistiu');
      }
      return {
        texto: agenteLocal.cancelar(ctx.id_usuario, ctx.sessao),
        detalhe: 'ação cancelada',
        resolveu: true,
      };
    }

    /**
     * CONFIRMAR EXIGE AS DUAS TRAVAS, e a do jornal vem primeiro.
     *
     * `autorizar` confere sete coisas que o interlock do dispositivo não confere
     * — entre elas o NONCE (esta confirmação pertence a ESTA ação?) e o estado
     * (já foi confirmada? foi cancelada? expirou?). É o que transforma "confirmo"
     * de cheque em branco sobre o slot atual em uma autorização vinculada.
     *
     * Note que a fala do operador chega aqui como EVIDÊNCIA CARIMBADA `operador`,
     * e é o único carimbo que `transicionar` aceita para risco alto. O caminho
     * pelo qual a camada de raciocínio poderia produzir esse carimbo não existe:
     * um plano emergente nem chega a esta habilidade — o porteiro o barra — e,
     * se chegasse, ele carimbaria `porteiro`, que é recusado.
     */
    /**
     * AS DUAS TRAVAS PRECISAM CONCORDAR — e a discordância recusa.
     *
     * Este ramo era um `||` que caía em `agenteLocal.confirmar(...)`, e a prova
     * de escrita o pegou: com o dispositivo armado e o jornal SEM pendência
     * (porque a operação persistida ficou em outra conversa, ou porque a
     * armação foi deduplicada), a chamada executava o `shutdown` contornando
     * inteiramente a autorização que este trabalho existe para impor.
     *
     * Defeito criado pela própria correção, encontrado atacando-a. A lição é a
     * de sempre: duas fontes de verdade que "se completam" com um `||` viram
     * uma fonte só — a mais permissiva.
     */
    if (!havia) {
      // Nada armado no dispositivo. `confirmar` aqui é inofensivo: devolve a
      // frase de "não há nada aguardando" sem executar coisa nenhuma.
      return {
        texto: agenteLocal.confirmar(ctx.id_usuario, ctx.sessao),
        detalhe: 'nada pendente para confirmar',
        resolveu: false,
      };
    }

    if (!operacaoPendente) {
      return {
        texto:
          'Existe um pedido armado, mas não encontro o registro dele nesta conversa — ' +
          'pode ter sido feito em outra, ou já ter sido resolvido. Não executo ação ' +
          'irreversível sem o registro correspondente: peça de novo aqui.',
        detalhe: 'dispositivo armado sem operação persistida correspondente; recusado',
        resolveu: false,
      };
    }

    const veredito = await ctx.registro.autorizar({
      id_operacao: operacaoPendente.id_operacao,
      nonce: operacaoPendente.nonce,
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      fala: ctx.enunciado,
    });

    if (!veredito.ok) {
      return {
        texto: `Não executei: ${veredito.motivo}.`,
        detalhe: `autorização recusada pelo jornal: ${veredito.motivo}`,
        resolveu: false,
      };
    }

    // Jornal ANTES do efeito: se o processo morrer no `shutdown`, a reidratação
    // encontra `executando` e devolve `desconhecida`, nunca "nada aconteceu".
    await ctx.registro.marcar(
      operacaoPendente.id_operacao,
      'executando',
      { fonte: 'executor', descricao: 'autorizado; acionando o dispositivo', instante: new Date().toISOString() },
    );

    /**
     * WHATSAPP DIVERGE AQUI, e só aqui: as duas travas (interlock + jornal) já
     * concordaram do mesmo jeito para os dois tipos — a diferença é que enviar
     * mensagem tem resultado OBSERVÁVEL dentro deste processo (a Meta responde
     * síncrono), e fingir que não sei se deu certo, quando sei, seria a mesma
     * mentira operacional que este arquivo inteiro existe para impedir. Energia
     * não tem essa opção — ver o comentário de `confirmarComunicacao`.
     */
    if (tipo === 'whatsapp') {
      const resultado = await agenteLocal.confirmarComunicacao(ctx.id_usuario, ctx.sessao);
      if (!resultado) {
        // A pendência sumiu entre a validação de tipo (linha acima) e agora —
        // só possível se outra chamada concorrente a consumiu no meio dos
        // `await` de autorização. Falhar honesto é melhor que adivinhar.
        await ctx.registro.marcar(operacaoPendente.id_operacao, 'desconhecida', {
          fonte: 'executor',
          descricao: 'pendência consumida entre a autorização e a confirmação',
          instante: new Date().toISOString(),
        });
        return {
          texto: 'A pendência sumiu bem na hora de confirmar — pode ter sido resolvida em outra conversa. Peça de novo se precisar.',
          detalhe: 'whatsapp: pendência consumida entre autorizar e confirmar',
          resolveu: false,
        };
      }
      /**
       * `aceita_pelo_provedor`, não um `sucesso` que não existe no vocabulário
       * de `Operacao.ts` — e a ausência é de propósito, não lacuna: a Meta
       * confirma que RECEBEU a mensagem, não que ela chegou a alguém. Ver o
       * comentário do próprio estado em `Operacao.ts`.
       */
      await ctx.registro.marcar(
        operacaoPendente.id_operacao,
        resultado.sucesso ? 'aceita_pelo_provedor' : 'falhou',
        {
          fonte: 'executor',
          descricao: resultado.sucesso ? 'mensagem aceita pelo provedor' : `provedor recusou: ${resultado.texto}`,
          instante: new Date().toISOString(),
        },
      );
      return {
        texto: resultado.texto,
        detalhe: `whatsapp: ${resultado.sucesso ? 'enviado' : 'falhou'}`,
        resolveu: resultado.sucesso,
      };
    }

    /**
     * CALENDÁRIO DIVERGE DA MESMA FORMA QUE WHATSAPP, pela mesma razão: o
     * Google responde síncrono, dentro desta chamada, e fingir que não sei
     * se o evento foi criado quando já sei seria a mesma mentira operacional
     * que este arquivo existe para impedir.
     */
    if (tipo === 'calendario') {
      const resultado = await agenteLocal.confirmarCriarEventoCalendario(ctx.id_usuario, ctx.sessao);
      if (!resultado) {
        await ctx.registro.marcar(operacaoPendente.id_operacao, 'desconhecida', {
          fonte: 'executor',
          descricao: 'pendência consumida entre a autorização e a confirmação',
          instante: new Date().toISOString(),
        });
        return {
          texto: 'A pendência sumiu bem na hora de confirmar — pode ter sido resolvida em outra conversa. Peça de novo se precisar.',
          detalhe: 'calendario: pendência consumida entre autorizar e confirmar',
          resolveu: false,
        };
      }
      await ctx.registro.marcar(
        operacaoPendente.id_operacao,
        resultado.sucesso ? 'aceita_pelo_provedor' : 'falhou',
        {
          fonte: 'executor',
          descricao: resultado.sucesso ? 'evento aceito pelo provedor' : `provedor recusou: ${resultado.texto}`,
          instante: new Date().toISOString(),
        },
      );
      return {
        texto: resultado.texto,
        detalhe: `calendario: ${resultado.sucesso ? 'criado' : 'falhou'}`,
        resolveu: resultado.sucesso,
      };
    }

    const texto = agenteLocal.confirmar(ctx.id_usuario, ctx.sessao);
    await ctx.registro.marcar(operacaoPendente.id_operacao, 'desconhecida', {
      fonte: 'executor',
      descricao: 'agendado no sistema operacional; não observável deste processo',
      instante: new Date().toISOString(),
    });

    return { texto, detalhe: 'confirmação aceita', resolveu: true };
  },

  /**
   * QUATRO RAMOS agora — WhatsApp e calendário entraram com uma propriedade
   * que nem cancelar nem confirmar-energia têm: são verificáveis DE VERDADE.
   * O provedor responde dentro desta chamada, então "confirmado" aqui não é
   * opinião, é o que ele disse — nos dois sentidos, sucesso ou recusa.
   *
   * CANCELAR é: a pendência sumiu. Confere-se e pronto.
   *
   * CONFIRMAR ENERGIA agenda um `shutdown /t 20`. Um processo que vai ser
   * encerrado pelo sistema em 20 segundos não tem como provar, de dentro de
   * si mesmo, que o encerramento vai acontecer — e se conseguisse, não
   * estaria mais vivo para relatar.
   */
  async verificar(resultado, ctx) {
    if (ctx.parametros.resposta !== 'confirmo') {
      return agenteLocal.temPendencia(ctx.id_usuario, ctx.sessao)
        ? { confirmado: false, evidencia: 'pendência ainda ativa após o cancelamento', motivo: 'divergente' }
        : { confirmado: true, evidencia: 'nenhuma pendência ativa; cancelamento efetivado' };
    }

    if (resultado.detalhe.startsWith('whatsapp:') || resultado.detalhe.startsWith('calendario:')) {
      if (resultado.detalhe.includes('consumida entre')) {
        return { confirmado: false, evidencia: resultado.texto, motivo: 'divergente' };
      }
      // Sucesso OU falha — os dois são fato conhecido, porque o provedor
      // respondeu dentro desta mesma chamada. `confirmado: true` nos dois
      // casos: o que se verifica é "sei o que aconteceu", não "deu certo".
      return { confirmado: true, evidencia: resultado.texto };
    }

    /**
     * Confirmação sem pendência não agendou nada, e dizer que agendou é a
     * mentira operacional que esta camada inteira existe para impedir. Não é
     * "não consegui verificar": é um fato conhecido e negativo.
     */
    if (!resultado.resolveu) {
      return {
        confirmado: false,
        evidencia: 'não havia ação pendente; nada foi agendado nem executado',
        motivo: 'nao_encontrado',
      };
    }
    return {
      confirmado: false,
      evidencia: 'desligamento agendado no sistema operacional; não observável deste processo',
      motivo: 'sem_meio_de_verificar',
    };
  },
};

/**
 * ATUALIZAR REPOSITÓRIO — `git pull --ff-only`.
 *
 * RISCO MÉDIO, e a escolha merece defesa porque a tentação era `alto`. O que
 * separa os dois neste kernel não é "mexe em coisa importante" — é
 * REVERSIBILIDADE e ALCANCE. Um `pull` não sai da máquina, não alcança
 * terceiro, e o estado que ele substitui está inteiro no servidor: o pior caso
 * é a pessoa voltar o HEAD. Comparar com `acionar_energia`, que é alto: aquela
 * derruba a máquina de quem está usando.
 *
 * A trava que de fato protege este verbo não é o nível de risco — é a allowlist
 * e a recusa de árvore suja, e as duas moram no `AgenteLocal`, longe da LLM.
 *
 * `escrita_idempotente` porque o segundo `pull` de uma árvore já em dia não
 * produz efeito nenhum e diz isso. Convergente por construção, não por sorte.
 */
export const atualizarRepositorio: Habilidade = {
  manifesto: {
    id: 'atualizar_repositorio',
    nome: 'Atualizar repositório',
    descricao:
      'Puxa as novidades de um repositório autorizado com git pull --ff-only. ' +
      'O alvo é o APELIDO de um repositório declarado, nunca um caminho. ' +
      'Recusa se houver trabalho não salvo e nunca resolve conflito. ' +
      'Use para "atualize o repositório X" ou "puxa as novidades do X".',
    exemplos: ['Atualiza o repositório da IARA', 'Puxa as novidades do repositório'],
    capacidades: ['git pull em repositório autorizado'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 80_000,
    custo: 'zero',
    risco: 'medio',
    idempotencia: 'escrita_idempotente',
    esquema: {
      repositorio: { tipo: 'texto', obrigatorio: true },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'atualizar_repositorio',
      parametros: { repositorio: String(ctx.parametros.repositorio) },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `atualizar_repositorio [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },

  /**
   * A prova é o par de hashes que o executor mediu do outro lado da ponte — não
   * há verificação local possível: o repositório está na máquina do operador, e
   * quem consultou o `git` foi quem tem as mãos. É exatamente o caso para o
   * qual `provaDaPonte` existe.
   *
   * O ramo local recusa em vez de inventar. Reconferir daqui exigiria rodar
   * `git` no disco do motor — o disco errado, quando o motor está na nuvem —, e
   * essa é a família de engano que a ponte inteira foi construída para acabar.
   */
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'atualizar_repositorio', () => ({
      confirmado: false,
      evidencia: 'a atualização acontece no repositório do operador; nada a conferir a partir do motor',
      motivo: 'sem_meio_de_verificar',
    }));
  },
};

export const HABILIDADES_AGENTE_LOCAL: readonly Habilidade[] = [
  criarPasta,
  abrirAplicativo,
  fecharAplicativo,
  listarArquivos,
  informacoesSistema,
  capturarTela,
  acionarEnergia,
  atualizarRepositorio,
  resolverConfirmacao,
];
