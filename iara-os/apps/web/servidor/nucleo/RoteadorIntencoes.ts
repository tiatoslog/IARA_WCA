/**
 * CAMADA 1 — Roteador semântico local.
 *
 * Decide em microssegundos, sem gastar um token, para onde a mensagem vai.
 * É o que faz a IARA parecer instantânea: ~80% das perguntas operacionais
 * nunca sobem para a nuvem.
 */

import type { DestinoCognitivo } from '../../lib/estado';

export interface IntencaoMapeada {
  destino: DestinoCognitivo;
  modulo?: 'clima' | 'banco' | 'busca_web' | 'agenda' | 'rag';
  parametros: Record<string, unknown>;
  confianca: number;
  /** Vai para o console técnico, explica a decisão. */
  justificativa: string;
}

/**
 * Normaliza acento e caixa. SEM isto, `/ja aconteceu/` nunca casa com
 * "já aconteceu" — o bug silencioso mais comum em roteador PT-BR.
 */
export function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const UFS: Record<string, string> = {
  'mato grosso do sul': 'MS',
  'mato grosso': 'MT',
  goias: 'GO',
  'sao paulo': 'SP',
  parana: 'PR',
  rondonia: 'RO',
};

/**
 * Sondagem entre shards. Teste em DUAS partes, deliberadamente:
 *
 *   (o alvo é outra pessoa do time) E (verbo de sondagem OU coisa privada)
 *
 * Uma regex única não dá conta: "o que o Operador 3 falou" tem dígito no meio
 * do nome; "mostra as mensagens dele" não tem verbo; "quantas centrais o time
 * tem" tem alvo mas não é sondagem. Separar as duas dimensões acerta os três.
 */
const VERBO_SONDAGEM =
  /\b(falou|disse|escreveu|perguntou|reclamou|comentou|anotou|desabafou|conversou|respondeu|reportou|mandou|acha|pensa|avaliou)\b/;

const COISA_PRIVADA =
  /\b(conversa|conversas|mensagem|mensagens|historico|registro|registros|anotacao|anotacoes|nota|notas|desabafo|avaliacao|feedback|chat|prompt)\b/;

const ALVO_GENERICO =
  /\b(operador|operadora|colega|usuario)\s*\d*\b|\boutr[oa] (operador|operadora|pessoa|usuario)\b|\b(os outros|as outras|o pessoal|a equipe|o time)\b|\b(ele|ela|eles|elas|dele|dela|deles|delas)\b/;

export class RoteadorIntencoes {
  /** Nomes dos DEMAIS operadores. Quem está falando nunca entra na lista. */
  constructor(private readonly outros: string[] = []) {}

  private ehSondagem(t: string): boolean {
    const alvoNominal = this.outros.some((nome) => {
      const n = normalizar(nome);
      return n.length > 2 && t.includes(n);
    });
    if (!alvoNominal && !ALVO_GENERICO.test(t)) return false;
    return VERBO_SONDAGEM.test(t) || COISA_PRIVADA.test(t);
  }

  rotear(mensagem: string): IntencaoMapeada {
    const t = normalizar(mensagem);

    // 0. Sigilo antes de tudo — nem chega a decidir rota.
    if (this.ehSondagem(t)) {
      return {
        destino: 'recusa_sigilo',
        parametros: {},
        confianca: 0.85,
        justificativa: 'Padrão de sondagem sobre shard de terceiro detectado.',
      };
    }

    // 1. Clima / mundo real
    if (/\b(chuva|chover|chovendo|tempo|clima|temperatura|previsao|calor|frio)\b/.test(t)) {
      return {
        destino: 'sistema_local',
        modulo: 'clima',
        parametros: {},
        confianca: 0.96,
        justificativa: 'Consulta meteorológica → Open-Meteo, custo zero.',
      };
    }

    // 2. Métricas de infraestrutura
    if (
      /\b(quantas centrais|centrais ativas|total de clientes|servidores ativos|status do sistema|quantos veiculos|frota|status da operacao)\b/.test(
        t,
      )
    ) {
      let uf = 'GERAL';
      for (const [nome, sigla] of Object.entries(UFS)) {
        if (t.includes(nome)) {
          uf = sigla;
          break;
        }
      }
      if (uf === 'GERAL') {
        const m = t.match(/\b(?:em|no|na|de|do|da)\s+(mt|ms|go|sp|pr|ro)\b/);
        if (m) uf = m[1].toUpperCase();
      }
      return {
        destino: 'sistema_local',
        modulo: 'banco',
        parametros: { tabela: 'centrais', uf },
        confianca: 0.93,
        justificativa: `Consulta estruturada → banco, filtro UF=${uf}.`,
      };
    }

    // 3. Retrospectiva de erros → RAG local, schema-only
    if (
      /\b(esse erro|este erro|ja aconteceu|ja tivemos|erro de banco|bug repetido|caiu de novo|mesmo problema|aconteceu antes)\b/.test(
        t,
      )
    ) {
      return {
        destino: 'rag_historico',
        modulo: 'rag',
        parametros: { consulta: mensagem },
        confianca: 0.9,
        justificativa: 'Retrospectiva histórica → índice local, sem log bruto no prompt.',
      };
    }

    // 4. Busca web leve
    if (/\b(pesquis|busca na internet|procura na web|o que e |quem e |noticia)\b/.test(t)) {
      return {
        destino: 'sistema_local',
        modulo: 'busca_web',
        parametros: { consulta: mensagem },
        confianca: 0.7,
        justificativa: 'Busca factual → HTTP puro no DuckDuckGo, sem navegador headless.',
      };
    }

    // 5. Hora e data
    if (/\b(que horas|hora certa|que dia e hoje|data de hoje)\b/.test(t)) {
      return {
        destino: 'sistema_local',
        modulo: 'agenda',
        parametros: {},
        confianca: 0.98,
        justificativa: 'Relógio do servidor.',
      };
    }

    // 6. Fallback: exige raciocínio abstrato ou Teoria da Mente.
    return {
      destino: 'claude_nuvem',
      parametros: { prompt: mensagem },
      confianca: 1,
      justificativa: 'Sem correspondência determinística → matriz de raciocínio.',
    };
  }
}
