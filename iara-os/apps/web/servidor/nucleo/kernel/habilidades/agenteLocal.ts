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

import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Habilidade } from '../Habilidade';
import {
  agenteLocal,
  resolverRaiz,
  validarNomePasta,
  ROTULO_DO_LOCAL,
  type AcaoEnergia,
  type LocalAutorizado,
} from '../../AgenteLocal';

const LOCAIS = Object.keys(ROTULO_DO_LOCAL) as LocalAutorizado[];

export const criarPasta: Habilidade = {
  manifesto: {
    id: 'criar_pasta',
    nome: 'Criar pasta',
    descricao:
      'Cria uma pasta em um local autorizado da máquina (Área de Trabalho, Documentos ou Downloads). ' +
      'Não aceita caminho livre — só um desses três locais nomeados. Use para "crie uma pasta chamada X".',
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
    const texto = await agenteLocal.criarPasta(
      ctx.id_usuario,
      String(ctx.parametros.nome),
      String(ctx.parametros.local) as LocalAutorizado,
    );
    // `resolveu` reflete o FATO verificado pelo agente (a pasta existe no
    // disco), não a ausência de exceção. Nome recusado pela regra de segurança
    // devolve texto útil e `resolveu: false` — não é erro, é recusa.
    return {
      texto,
      detalhe: `criar_pasta em ${ctx.parametros.local}`,
      resolveu: texto.startsWith('Pasta ') || texto.includes('já existe'),
    };
  },

  /**
   * Confere o DISCO. É a verificação canônica do sistema: nome pedido → nome
   * validado → raiz resolvida → o diretório está lá?
   *
   * Note que ela não olha o texto devolvido por `executar`. Olhar o próprio
   * relato para confirmar o relato é o que se está tentando evitar.
   */
  async verificar(_resultado, ctx) {
    const nome = validarNomePasta(String(ctx.parametros.nome));
    if (!nome) {
      return {
        confirmado: false,
        evidencia: 'nome recusado pela regra de segurança; nada foi criado',
        motivo: 'nao_encontrado',
      };
    }

    const raiz = resolverRaiz(String(ctx.parametros.local) as LocalAutorizado);
    if (!raiz) {
      return {
        confirmado: false,
        evidencia: `raiz "${ctx.parametros.local}" não existe nesta máquina`,
        motivo: 'nao_encontrado',
      };
    }

    const destino = path.join(raiz, nome);
    return existsSync(destino)
      ? { confirmado: true, evidencia: `diretório existe em ${destino}` }
      : {
          confirmado: false,
          evidencia: `${destino} não existe depois da execução`,
          motivo: 'divergente',
        };
  },
};

export const abrirAplicativo: Habilidade = {
  manifesto: {
    id: 'abrir_aplicativo',
    nome: 'Abrir aplicativo',
    descricao:
      'Abre um aplicativo de uma lista fechada e revisada (Bloco de Notas, Calculadora, Paint, ' +
      'Explorador de Arquivos, Chrome, Edge). Não executa comando arbitrário.',
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 4000,
    custo: 'zero',
    risco: 'medio',
    // Mesmo risco de `criar_pasta` e semântica oposta — é o par que prova que as
    // duas perguntas são independentes. Lançar o Bloco de Notas duas vezes abre
    // duas janelas, e o processo é solto com `unref`: não há como recolher.
    idempotencia: 'escrita_nao_idempotente',
    esquema: { aplicativo: { tipo: 'texto', obrigatorio: true } },
  },
  async executar(ctx) {
    const texto = agenteLocal.abrirAplicativo(ctx.id_usuario, String(ctx.parametros.aplicativo));
    return {
      texto,
      detalhe: 'abrir_aplicativo (allowlist)',
      resolveu: !texto.startsWith('Esse aplicativo não está'),
    };
  },

  /**
   * ESTE É O CASO HONESTO. O processo é lançado com `detached` e `unref` — a
   * IARA solta o filho e não o acompanha. Um app pode subir e fechar sozinho,
   * pode abrir uma janela existente em vez de um processo novo, pode demorar.
   *
   * Poderíamos varrer a tabela de processos e chamar isso de verificação. Seria
   * teatro: o resultado não provaria que a janela apareceu para o operador.
   * Declarar a limitação vale mais que uma confirmação que não confirma — e é
   * por isso que `sem_meio_de_verificar` existe como motivo de primeira classe.
   */
  async verificar(resultado) {
    if (resultado.texto.startsWith('Esse aplicativo não está')) {
      return { confirmado: false, evidencia: 'aplicativo fora da allowlist; nada foi lançado', motivo: 'nao_encontrado' };
    }
    return {
      confirmado: false,
      evidencia: 'processo lançado desanexado; não acompanho o ciclo de vida dele',
      motivo: 'sem_meio_de_verificar',
    };
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
    nome: 'Resolver confirmação pendente',
    descricao:
      'Fecha o ciclo de uma ação que ficou aguardando confirmação: executa se o operador confirmou, ' +
      'aborta se cancelou. Sem pendência válida, diz isso em vez de executar qualquer coisa.',
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
    const havia = agenteLocal.temPendencia(ctx.id_usuario, ctx.sessao);

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
    const texto = agenteLocal.confirmar(ctx.id_usuario, ctx.sessao);
    await ctx.registro.marcar(operacaoPendente.id_operacao, 'desconhecida', {
      fonte: 'executor',
      descricao: 'agendado no sistema operacional; não observável deste processo',
      instante: new Date().toISOString(),
    });

    return { texto, detalhe: 'confirmação aceita', resolveu: true };
  },

  /**
   * Os dois ramos verificam coisas diferentes, e só um é verificável.
   *
   * CANCELAR é: a pendência sumiu. Confere-se e pronto.
   *
   * CONFIRMAR agenda um `shutdown /t 20`. Um processo que vai ser encerrado
   * pelo sistema em 20 segundos não tem como provar, de dentro de si mesmo,
   * que o encerramento vai acontecer — e se conseguisse, não estaria mais vivo
   * para relatar. A resposta ao operador precisa carregar essa limitação em
   * vez de um "pronto" que ninguém apurou.
   */
  async verificar(resultado, ctx) {
    if (ctx.parametros.resposta !== 'confirmo') {
      return agenteLocal.temPendencia(ctx.id_usuario, ctx.sessao)
        ? { confirmado: false, evidencia: 'pendência ainda ativa após o cancelamento', motivo: 'divergente' }
        : { confirmado: true, evidencia: 'nenhuma pendência ativa; cancelamento efetivado' };
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

export const HABILIDADES_AGENTE_LOCAL: readonly Habilidade[] = [
  criarPasta,
  abrirAplicativo,
  acionarEnergia,
  resolverConfirmacao,
];
