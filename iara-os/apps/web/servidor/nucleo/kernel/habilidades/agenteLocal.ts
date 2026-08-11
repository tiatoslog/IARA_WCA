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
    esquema: {
      acao: {
        tipo: 'texto',
        padrao: 'desligar',
        dentre: ['desligar', 'reiniciar', 'suspender'],
      },
    },
  },
  async executar(ctx) {
    return {
      texto: agenteLocal.pedirEnergia(ctx.id_usuario, String(ctx.parametros.acao) as AcaoEnergia),
      detalhe: `energia:${ctx.parametros.acao} pendente de confirmação`,
      resolveu: true,
    };
  },

  /**
   * O que esta habilidade PROMETE é registrar uma pendência — não desligar
   * nada. Então é exatamente isso que se verifica. Verificar aqui se a máquina
   * desligou seria verificar a promessa errada.
   */
  async verificar(_resultado, ctx) {
    return agenteLocal.temPendencia(ctx.id_usuario)
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
    const havia = agenteLocal.temPendencia(ctx.id_usuario);
    return {
      texto: confirmou
        ? agenteLocal.confirmar(ctx.id_usuario)
        : agenteLocal.cancelar(ctx.id_usuario),
      detalhe: confirmou
        ? havia
          ? 'confirmação aceita'
          : 'nada pendente para confirmar'
        : 'ação cancelada',
      // `resolveu` é o relato do executor: houve mesmo um ciclo para fechar?
      resolveu: confirmou ? havia : true,
    };
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
      return agenteLocal.temPendencia(ctx.id_usuario)
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
