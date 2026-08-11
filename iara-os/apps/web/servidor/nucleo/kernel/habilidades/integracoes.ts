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

    /**
     * Verificação declarada, ainda não implementável — pelo mesmo motivo que o
     * executor: não há provedor ligado.
     *
     * Existe agora porque o contrato do catálogo exige que toda habilidade de
     * risco médio ou alto saiba se verificar (`testes/verificacao.test.ts`), e
     * porque a forma correta de "ainda não sei" é dizer isso, não omitir.
     *
     * QUEM IMPLEMENTAR `executar` IMPLEMENTA ISTO JUNTO. Para um envio, a
     * verificação real é: status do provedor, destinatário confirmado e
     * carimbo de tempo do envio — nunca o código de retorno da chamada HTTP.
     */
    async verificar() {
      return {
        confirmado: false,
        evidencia: `${manifesto.id} não tem provedor ligado; nada foi enviado`,
        motivo: 'sem_meio_de_verificar' as const,
      };
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
    risco: 'baixo',
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
    // `externo`, não `escrita`: chega em OUTRA PESSOA. Mensagem enviada ao
    // destinatário errado não se desfaz, e é por isso que essa permissão não
    // é concedida ao papel `operador` — ver `Seguranca.ts`.
    permissoes: ['rede', 'externo'],
    timeout_ms: 10000,
    custo: 'zero',
    risco: 'alto',
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
    risco: 'baixo',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },
  'MS_GRAPH_TOKEN',
);

export const HABILIDADES_INTEGRACAO: readonly Habilidade[] = [
  lerEmails,
  enviarWhatsapp,
  buscarDocumentoSharepoint,
];
