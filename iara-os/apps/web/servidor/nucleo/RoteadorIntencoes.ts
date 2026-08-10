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

/**
 * Alvo humano EXPLÍCITO (operador, colega, equipe) e pronome anafórico são
 * dimensões separadas de propósito: "registro dele" numa frase sobre um erro
 * de banco se refere ao ERRO, não a uma pessoa. Pronome sozinho só vira alvo
 * quando não há assunto técnico por perto (ver `ehSondagem`).
 */
const ALVO_HUMANO =
  /\b(operador|operadora|colega|usuario)\s*\d*\b|\boutr[oa] (operador|operadora|pessoa|usuario)\b|\b(os outros|as outras|o pessoal|a equipe|o time)\b/;

const PRONOME = /\b(ele|ela|eles|elas|dele|dela|deles|delas)\b/;

/** Assunto técnico: âncora de que o pronome se refere a coisa, não a gente. */
const ASSUNTO_TECNICO =
  /\b(erro|erros|bug|bugs|falha|falhas|problema|problemas|servidor|servidores|sistema|sistemas|banco|api|container|deploy|timeout|conexao|processo|script|relatorio)\b/;

export class RoteadorIntencoes {
  /** Nomes dos DEMAIS operadores. Quem está falando nunca entra na lista. */
  constructor(private readonly outros: string[] = []) {}

  private ehSondagem(t: string): boolean {
    const alvoNominal = this.outros.some((nome) => {
      const n = normalizar(nome);
      return n.length > 2 && t.includes(n);
    });

    // Alvo explícito (nome ou "operador 3", "a equipe"): qualquer verbo de
    // sondagem ou coisa privada confirma.
    if (alvoNominal || ALVO_HUMANO.test(t)) {
      return VERBO_SONDAGEM.test(t) || COISA_PRIVADA.test(t);
    }

    // Só pronome: "registro dele" numa frase sobre erro/servidor aponta para
    // a coisa, não para colega — deixa passar para o RAG responder. Sem
    // assunto técnico por perto, o pronome só pode ser gente: barra.
    if (PRONOME.test(t)) {
      if (VERBO_SONDAGEM.test(t)) return true;
      return COISA_PRIVADA.test(t) && !ASSUNTO_TECNICO.test(t);
    }

    return false;
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

    // 1. Clima / mundo real. "tempo" solto é armadilha: "quanto tempo leva"
    // é duração, não meteorologia — só casa "tempo" com contexto de clima.
    if (
      !/\b(quanto|ha quanto|em quanto)\s+tempo\b/.test(t) &&
      /\b(chuva|chover|chovendo|clima|temperatura|previsao|calor|frio|tempo (hoje|agora|amanha|la fora)|(como esta|como ta|como anda) o tempo)\b/.test(
        t,
      )
    ) {
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

    // 4. Busca web leve. `pesquis\w*`, não `pesquis\b`: o \b depois de prefixo
    // exige não-letra em seguida e faria "pesquisa"/"pesquise" nunca casarem.
    if (/\b(pesquis\w*|busca na internet|procura na web|o que e |quem e |noticia\w*)\b/.test(t)) {
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
