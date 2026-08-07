/**
 * Integrações externas — declaradas, ainda não ligadas.
 *
 * POR QUE EXISTEM ANTES DE FUNCIONAR
 *
 * Uma habilidade sem credencial não é a mesma coisa que uma habilidade que não
 * existe. Declarar aqui produz três efeitos que valem o arquivo:
 *
 *  1. O manifesto mostra ao operador o que a IARA PODERIA fazer e o que falta
 *     ligar — em vez de o sistema parecer limitado quando está desconfigurado.
 *  2. O Planejador não as oferece à LLM enquanto indisponíveis, então nunca
 *     nasce um plano que depende de algo que vai falhar no meio.
 *  3. O contrato (esquema, permissões, timeout) já está revisado quando a
 *     credencial chegar. Ligar vira preencher `executar`.
 *
 * Todas pedem `escrita` ou tocam dado de terceiro, e por isso nenhuma é
 * concedida ao papel `operador` por padrão — ver `Seguranca.ts`.
 */

import type { Habilidade } from '../Habilidade';

/** Fábrica das habilidades ainda não implementadas. */
function pendente(
  manifesto: Habilidade['manifesto'],
  variavel: string,
): Habilidade {
  return {
    manifesto,
    indisponivelPorque() {
      return process.env[variavel]?.trim() ? null : `falta ${variavel} no ambiente`;
    },
    async executar() {
      // Nunca deveria ser alcançado: o Gerenciador filtra por disponibilidade
      // antes. Se chegou aqui, é bug de roteamento — e falhar alto é melhor
      // que devolver texto inventado.
      throw new Error(
        `${manifesto.id} está declarada mas não implementada. Configure ${variavel} e implemente o executor.`,
      );
    },
  };
}

export const lerEmails = pendente(
  {
    id: 'ler_emails',
    nome: 'Caixa de entrada',
    descricao:
      'Lê e-mails recentes da caixa corporativa do operador, filtrando por remetente ou assunto.',
    dominio: 'comunicacao',
    capacidade: 'conhecimento',
    permissoes: ['rede', 'memoria'],
    timeout_ms: 10000,
    custo: 'zero',
    esquema: {
      filtro: { tipo: 'texto' },
      limite: { tipo: 'numero', padrao: 10 },
    },
  },
  'MS_GRAPH_TOKEN',
);

export const enviarWhatsapp = pendente(
  {
    id: 'enviar_whatsapp',
    nome: 'Envio de WhatsApp',
    descricao:
      'Envia mensagem de WhatsApp para um contato da operação. Ação irreversível: exige confirmação explícita do operador antes de disparar.',
    dominio: 'comunicacao',
    capacidade: 'automacao',
    // `escrita` porque sai do processo e chega em outra pessoa. Nenhuma
    // habilidade que fala com o mundo externo em nome do operador pode ser
    // acionada sem esse selo.
    permissoes: ['rede', 'escrita'],
    timeout_ms: 10000,
    custo: 'zero',
    esquema: {
      destinatario: { tipo: 'texto', obrigatorio: true },
      mensagem: { tipo: 'texto', obrigatorio: true },
    },
  },
  'WHATSAPP_TOKEN',
);

export const buscarDocumentoSharepoint = pendente(
  {
    id: 'buscar_documento_sharepoint',
    nome: 'Busca no SharePoint',
    descricao:
      'Localiza documentos no SharePoint corporativo por título ou conteúdo e devolve o link e um resumo.',
    dominio: 'operacoes',
    capacidade: 'conhecimento',
    permissoes: ['rede', 'banco'],
    timeout_ms: 12000,
    custo: 'zero',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  'MS_GRAPH_TOKEN',
);

export const HABILIDADES_INTEGRACAO: readonly Habilidade[] = [
  lerEmails,
  enviarWhatsapp,
  buscarDocumentoSharepoint,
];
