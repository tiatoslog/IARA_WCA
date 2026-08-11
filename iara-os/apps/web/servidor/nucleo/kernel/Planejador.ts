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
const RECEITAS: Record<string, (p: Percepcao) => Plano> = {
  clima: () => ({
    objetivo: 'Informar a condição externa do perímetro operacional',
    origem: 'deterministico',
    passos: [passo(0, 'Consultar radar meteorológico', 'consultar_clima')],
  }),

  infraestrutura: (p) => ({
    objetivo: 'Responder sobre o estado da infraestrutura',
    origem: 'deterministico',
    // `consultar_infraestrutura` e não `executar_consulta_sql`: aquela funciona
    // com ou sem banco, esta some do catálogo sem Supabase. Receita
    // determinística não pode depender de credencial opcional.
    passos: [passo(0, 'Consultar base de centrais', 'consultar_infraestrutura', { uf: extrairUf(p.bruto) })],
  }),

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

  abrir_app: (p) => ({
    objetivo: 'Abrir aplicativo autorizado',
    origem: 'deterministico',
    passos: [passo(0, 'Abrir o aplicativo pedido', 'abrir_aplicativo', { aplicativo: p.bruto })],
  }),

  energia: (p) => ({
    objetivo: 'Preparar ação de energia com confirmação',
    origem: 'deterministico',
    passos: [
      passo(0, 'Registrar pendência e pedir confirmação', 'acionar_energia', {
        acao: extrairAcaoEnergia(p.bruto),
      }),
    ],
  }),

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
  return bruto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * O NOME vem do texto ORIGINAL (acentos preservados — a pasta se chama
 * "Contratos Aéreos", não "contratos aereos"); o LOCAL vem do normalizado.
 */
export function extrairNomePasta(bruto: string): string {
  const m = bruto.match(
    /pasta\s+(?:chamada\s+|com\s+o\s+nome\s+|nomeada\s+)?["“']?(.+?)["”']?\s*(?:(?:na|no|em)\s+(?:minha\s+|meu\s+)?(?:área de trabalho|area de trabalho|desktop|documentos|downloads))?\s*[?.!]*$/i,
  );
  const nome = m?.[1]?.trim() ?? '';
  // "crie uma pasta" sem nome, ou sobrou só ruído: nome honesto de fallback.
  if (!nome || /^(nova|uma|a)$/i.test(nome)) return 'Nova pasta';
  return nome;
}

export function extrairLocalAutorizado(bruto: string): string {
  const t = normalizarLocal(bruto);
  if (/\b(documentos)\b/.test(t)) return 'documentos';
  if (/\b(downloads)\b/.test(t)) return 'downloads';
  return 'area_de_trabalho';
}

export function extrairAcaoEnergia(bruto: string): string {
  const t = normalizarLocal(bruto);
  if (/\b(reinicie|reinicia|reiniciar)\b/.test(t)) return 'reiniciar';
  if (/\b(suspenda|suspender|hiberne|hibernar)\b/.test(t)) return 'suspender';
  return 'desligar';
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
  planejar(p: Percepcao): Plano {
    for (const ancora of p.ancoras) {
      const receita = RECEITAS[ancora];
      if (receita) return receita(p);
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
