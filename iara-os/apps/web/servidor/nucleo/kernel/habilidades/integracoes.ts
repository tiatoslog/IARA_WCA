/**
 * Integrações externas — Microsoft Graph (e-mail, SharePoint) e WhatsApp.
 *
 * IMPLEMENTADAS em 14/08/2026. Até então este arquivo só DECLARAVA as três
 * habilidades — manifesto revisado, `indisponivelPorque` checando a
 * credencial, `executar` lançando "declarada mas não implementada". Essa
 * fase valeu o próprio arquivo por três efeitos que continuam valendo:
 *
 *  1. O manifesto mostra ao operador o que a IARA PODERIA fazer e o que falta
 *     ligar — em vez de o sistema parecer limitado quando está desconfigurado.
 *  2. O Planejador não as oferece à LLM enquanto indisponíveis, então nunca
 *     nasce um plano que depende de algo que vai falhar no meio.
 *  3. O contrato (esquema, permissões, timeout) já estava revisado quando a
 *     credencial chegou — ligar foi só preencher `executar`.
 *
 * Todas pedem `escrita` ou tocam dado de terceiro, e por isso nenhuma é
 * concedida ao papel `operador` por padrão — ver `Seguranca.ts`. NENHUMA foi
 * testada contra um provedor real: `MS_GRAPH_TOKEN` e `WHATSAPP_TOKEN`
 * continuam ausentes neste ambiente. Os testes cobrem o contrato HTTP com
 * `fetch` simulado — ver `testes/graph.test.ts` e `testes/whatsapp.test.ts`.
 */

import type { Habilidade } from '../Habilidade';
import { buscarEmails, buscarSharepoint, graphDisponivel } from '../../ClienteGraph';
import { agenteLocal } from '../../AgenteLocal';
import { whatsappDisponivel } from '../../ClienteWhatsapp';

/**
 * IMPLEMENTADA em 14/08/2026, contra a Microsoft Graph real
 * (`servidor/nucleo/ClienteGraph.ts`). Sem `MS_GRAPH_TOKEN` continua
 * declarada e desligada — `indisponivelPorque` é o mesmo contrato de antes,
 * só que agora `executar` de fato chama a API em vez de lançar.
 *
 * NÃO TESTADA CONTRA UM TENANT REAL: os testes cobrem o contrato HTTP
 * (`fetch` simulado) contra a documentação pública da Graph, não uma conta
 * de verdade — ninguém neste ambiente tem `MS_GRAPH_TOKEN` configurado. Isso
 * fica registrado como lacuna, não escondido.
 */
export const lerEmails: Habilidade = {
  manifesto: {
    id: 'ler_emails',
    nome: 'Caixa de entrada',
    descricao:
      'Lê e-mails recentes da caixa corporativa do operador, filtrando por remetente ou assunto.',
    exemplos: [
      'Leia meus emails recentes',
      'Chegou algum email da LUFT hoje?',
      'Tem email novo sobre a fatura?',
    ],
    capacidades: ['ler e-mails recentes', 'filtrar e-mail por remetente ou assunto'],
    /**
     * O nome da habilidade já é "Caixa de entrada" e mesmo assim « me mostra a
     * caixa » não a alcançava: o índice de assunto indexa o texto do manifesto,
     * mas "caixa" sozinha é comum demais para admitir sozinha. Declarada como
     * TERMO do conceito `email`, ela passa a recuperar — e a normalizar o
     * referente, que é o outro trabalho do campo.
     */
    /**
     * `mail` está aqui porque "e-mails" perde o hífen na normalização e vira
     * `mail` — a realização mais comum da palavra não casava com o próprio
     * conceito. Declarar é o lugar certo de consertar isso; um caso especial de
     * hífen dentro do tokenizador seria a regra de código que este campo existe
     * para evitar.
     */
    conceitos: [{ nome: 'email', termos: ['caixa', 'correio', 'mensagem', 'inbox', 'mail'] }],
    dominio: 'comunicacao',
    capacidade: 'conhecimento',
    permissoes: ['rede', 'memoria'],
    timeout_ms: 10000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {
      filtro: { tipo: 'texto' },
      limite: { tipo: 'numero', padrao: 10 },
    },
  },
  indisponivelPorque() {
    return graphDisponivel() ? null : 'falta MS_GRAPH_TOKEN no ambiente';
  },
  async executar(ctx) {
    const filtro = String(ctx.parametros.filtro ?? '');
    const limite = Number(ctx.parametros.limite ?? 10);
    const r = await buscarEmails(filtro, limite);
    return { texto: r.texto, detalhe: `Microsoft Graph: ${filtro ? `busca "${filtro}"` : 'recentes'}`, resolveu: r.ok };
  },
  /**
   * Leitura verifica lendo de novo, não comparando com o passado — a mesma
   * disciplina de `capturar_tela`: o que se confere é "a fonte respondeu",
   * não "o número bate com uma expectativa que ninguém tinha".
   */
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'Microsoft Graph respondeu à consulta de mensagens' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

/**
 * IMPLEMENTADA em 14/08/2026 — mesmo desenho de R2 do `acionar_energia`
 * (`servidor/nucleo/AgenteLocal.ts`): esta habilidade NUNCA envia. Ela ARMA
 * uma pendência (interlock em memória + operação persistida no jornal, as
 * duas amarradas a operador+sessão) e devolve o pedido de confirmação. Quem
 * de fato manda a mensagem é `resolver_confirmacao`, só depois do MESMO
 * operador dizer "confirmo" na MESMA conversa, dentro de 60s.
 *
 * NÃO TESTADA CONTRA UM NÚMERO REAL — mesma lacuna nomeada em `lerEmails`.
 */
export const enviarWhatsapp: Habilidade = {
  manifesto: {
    id: 'enviar_whatsapp',
    nome: 'Envio de WhatsApp',
    descricao:
      'Envia mensagem de WhatsApp para um contato da operação. NUNCA executa direto: registra uma ' +
      'pendência e pede confirmação explícita do operador.',
    exemplos: [
      'Manda um whatsapp para o João avisando do atraso',
      'Avisa a Marina no zap que a coleta foi remarcada',
    ],
    capacidades: ['enviar mensagem de WhatsApp com confirmação'],
    dominio: 'comunicacao',
    capacidade: 'automacao',
    // `externo`, não `escrita`: chega em OUTRA PESSOA. Mensagem enviada ao
    // destinatário errado não se desfaz, e é por isso que essa permissão não
    // é concedida ao papel `operador` — ver `Seguranca.ts`.
    permissoes: ['rede', 'externo'],
    timeout_ms: 10000,
    custo: 'zero',
    risco: 'alto',
    // Esta habilidade não envia nada: ela ARMA uma pendência. Pedir duas vezes
    // seguidas para o MESMO destinatário/mensagem converge para uma pendência
    // só — quem carrega o efeito irreversível é `resolver_confirmacao`. Mesma
    // semântica de `acionar_energia`.
    idempotencia: 'escrita_idempotente',
    esquema: {
      destinatario: { tipo: 'texto', obrigatorio: true },
      mensagem: { tipo: 'texto', obrigatorio: true, max: 1000 },
    },
  },
  indisponivelPorque() {
    return whatsappDisponivel() ? null : 'falta WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID no ambiente';
  },
  async executar(ctx) {
    const destinatario = String(ctx.parametros.destinatario ?? '').trim();
    const mensagem = String(ctx.parametros.mensagem ?? '').trim();
    if (!destinatario || !mensagem) {
      return {
        texto: 'Preciso do destinatário e do texto da mensagem para armar o envio.',
        detalhe: 'parâmetro ausente',
        resolveu: false,
      };
    }

    /**
     * MESMO PADRÃO DE `acionar_energia`: a operação persistida vem ANTES do
     * interlock em memória, e `armada ?? pendenteDe(...)` deduplica pedido
     * repetido em vez de empilhar. Ver o comentário completo em
     * `agenteLocal.ts` (`acionarEnergia.executar`) — não repetido aqui
     * palavra por palavra para não divergir de lá com o tempo.
     */
    const armada = await ctx.registro.armar({
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      habilidade: 'envio_whatsapp',
      risco: 'alto',
      semantica: 'escrita_nao_idempotente',
      parametros: { destinatario, mensagem },
      origem_pedido: ctx.operacao?.id_operacao ?? ctx.sessao,
    });
    const pendente = armada ?? ctx.registro.pendenteDe(ctx.id_usuario, ctx.sessao);

    if (!pendente) {
      return {
        texto:
          `Você já tem um envio para ${destinatario} aguardando confirmação em outra conversa. ` +
          'Confirme por lá — não armo o mesmo envio duas vezes.',
        detalhe: 'recusada: pendência idêntica em outro contexto',
        resolveu: false,
      };
    }

    return {
      texto: agenteLocal.pedirWhatsapp(ctx.id_usuario, destinatario, mensagem, ctx.sessao),
      detalhe: `whatsapp para ${destinatario} pendente de confirmação (${pendente.id_operacao})`,
      resolveu: true,
    };
  },
  /** O que esta habilidade PROMETE é registrar uma pendência — não enviar nada. */
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

/** Ver o comentário de `lerEmails`: mesma data, mesmo cliente, mesma lacuna de teste contra tenant real. */
export const buscarDocumentoSharepoint: Habilidade = {
  manifesto: {
    id: 'buscar_documento_sharepoint',
    nome: 'Busca no SharePoint',
    descricao:
      'Localiza documentos no SharePoint corporativo por título ou conteúdo e devolve o link e um resumo.',
    exemplos: [
      'Acha no SharePoint a planilha de fechamento',
      'Procura o documento do contrato da LUFT',
    ],
    capacidades: ['localizar documento corporativo'],
    dominio: 'operacoes',
    capacidade: 'conhecimento',
    permissoes: ['rede', 'banco'],
    timeout_ms: 12000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  indisponivelPorque() {
    return graphDisponivel() ? null : 'falta MS_GRAPH_TOKEN no ambiente';
  },
  async executar(ctx) {
    const consulta = String(ctx.parametros.consulta ?? '');
    const r = await buscarSharepoint(consulta);
    return { texto: r.texto, detalhe: `Microsoft Graph Search: "${consulta}"`, resolveu: r.ok };
  },
  async verificar(resultado) {
    return resultado.resolveu
      ? { confirmado: true, evidencia: 'Microsoft Graph Search respondeu à consulta' }
      : { confirmado: false, evidencia: resultado.texto, motivo: 'sem_meio_de_verificar' };
  },
};

export const HABILIDADES_INTEGRACAO: readonly Habilidade[] = [
  lerEmails,
  enviarWhatsapp,
  buscarDocumentoSharepoint,
];
