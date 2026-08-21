/**
 * AUDITORIA DO CATÁLOGO — nenhuma habilidade inacessível por convenção nominal.
 *
 * O DEFEITO QUE ISTO VIGIA (Arnês C, 21/08/2026). A trava de compatibilidade
 * lia a operação de uma habilidade do PREFIXO DO ID. Funciona para 45 das 47,
 * porque o CLAUDE.md obriga `verbo_objeto` — e falha em silêncio para as outras
 * duas: `informacoes_sistema` começa por substantivo, saía `null`, e a trava
 * RECUSAVA a habilidade por não conseguir classificá-la.
 *
 *     « como está o PC agora? »  →  informacoes_sistema INCOMPATÍVEL
 *
 * Uma trava que não sabe classificar barra o inocente, e o sintoma aparece longe
 * da causa: a habilidade certa some da lista de candidatos sem explicação.
 *
 * O QUE ESTA AUDITORIA PUBLICA, e por que cada linha importa:
 *
 *   explícitas   declararam `operacao_semantica`. É a verdade.
 *   inferidas    o `id` é honesto e a convenção acerta. É o padrão, não a
 *                verdade — vale até alguém renomear a habilidade.
 *   ausentes     nem declarada nem legível. São as inacessíveis.
 *   conflitantes declararam UMA coisa e o `id` diz OUTRA. Não é erro
 *                automático — a declaração vence — mas é sempre suspeito, e
 *                quase sempre um dos dois está errado.
 */

import {
  operacaoDaHabilidade,
  operacaoDoManifesto,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { IndiceConceitual } from '../../servidor/nucleo/kernel/IndiceConceitual';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

export interface LinhaDaAuditoria {
  readonly id: string;
  readonly declarada: string | null;
  readonly inferida: string | null;
  readonly efetiva: string | null;
  readonly conflito: boolean;
  readonly temConceitos: boolean;
  readonly temEntidades: boolean;
  readonly temExemplos: boolean;
}

export interface Auditoria {
  readonly linhas: readonly LinhaDaAuditoria[];
  readonly total: number;
  readonly explicitas: number;
  readonly inferidas: number;
  readonly ausentes: readonly string[];
  readonly conflitantes: readonly string[];
  readonly semConceitos: readonly string[];
  readonly semExemplos: readonly string[];
}

export function auditarCatalogo(): Auditoria {
  const manifestos = CATALOGO.map((h) => h.manifesto);
  const conceitual = new IndiceConceitual(manifestos);
  void conceitual;

  const linhas = manifestos.map((m): LinhaDaAuditoria => {
    const declarada = (m.operacao_semantica as string | undefined) ?? null;
    const inferida = operacaoDaHabilidade(m.id);
    return {
      id: m.id,
      declarada,
      inferida,
      efetiva: operacaoDoManifesto(m),
      conflito: declarada !== null && inferida !== null && declarada !== inferida,
      temConceitos: (m.conceitos ?? []).length > 0,
      temEntidades: (m.entidades ?? []).length > 0,
      temExemplos: (m.exemplos ?? []).length > 0,
    };
  });

  return {
    linhas,
    total: linhas.length,
    explicitas: linhas.filter((l) => l.declarada !== null).length,
    inferidas: linhas.filter((l) => l.declarada === null && l.inferida !== null).length,
    ausentes: linhas.filter((l) => l.efetiva === null).map((l) => l.id),
    conflitantes: linhas.filter((l) => l.conflito).map((l) => `${l.id}: ${l.declarada} ≠ ${l.inferida}`),
    /**
     * Conceito é o que dá tolerância a erro de digitação e recuperação por
     * sinônimo. Habilidade sem conceito não está QUEBRADA — está sem rede: só é
     * alcançável pelas palavras exatas do manifesto.
     */
    semConceitos: linhas.filter((l) => !l.temConceitos && !l.temEntidades).map((l) => l.id),
    semExemplos: linhas.filter((l) => !l.temExemplos).map((l) => l.id),
  };
}
