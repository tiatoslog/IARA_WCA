/**
 * RAG histórico — SCHEMA-ONLY.
 *
 * O ponto inteiro desta classe é o que ela NÃO faz: ela nunca devolve o log
 * bruto. Devolve o hash, a assinatura sintática de uma linha e a resolução
 * anotada pelo time. Um log de 10.000 linhas injetado no prompt custa uma
 * fortuna, afoga o contexto e faz o modelo esquecer o tom.
 *
 * Similaridade: índice lexical por trigramas com cosseno. Determinístico, sem
 * dependência nativa, sem download de modelo, sem chamada paga. Para um corpus
 * de assinaturas curtas é a escolha certa — e é honesto chamá-lo de lexical,
 * não de "vetorial semântico".
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { AssinaturaErro } from '../../lib/estado';
import { normalizar } from './RoteadorIntencoes';

export interface AchadoRag {
  registro: AssinaturaErro;
  similaridade: number;
}

function trigramas(texto: string): Map<string, number> {
  const base = ` ${normalizar(texto)} `;
  const mapa = new Map<string, number>();
  for (let i = 0; i + 3 <= base.length; i += 1) {
    const g = base.slice(i, i + 3);
    mapa.set(g, (mapa.get(g) ?? 0) + 1);
  }
  return mapa;
}

function cosseno(a: Map<string, number>, b: Map<string, number>): number {
  let produto = 0;
  let normaA = 0;
  let normaB = 0;
  for (const peso of a.values()) normaA += peso * peso;
  for (const [g, peso] of b) {
    normaB += peso * peso;
    const outro = a.get(g);
    if (outro) produto += outro * peso;
  }
  if (normaA === 0 || normaB === 0) return 0;
  return produto / (Math.sqrt(normaA) * Math.sqrt(normaB));
}

export class RagHistorico {
  private registros: AssinaturaErro[] = [];
  private indice: Array<Map<string, number>> = [];
  private carregado = false;

  async carregar(): Promise<void> {
    if (this.carregado) return;
    const arquivo = path.resolve(process.cwd(), 'dados', 'historico-erros.json');
    const bruto = await readFile(arquivo, 'utf8');
    const dados = JSON.parse(bruto) as { erros: AssinaturaErro[] };
    this.registros = dados.erros;
    // O índice é construído sobre assinatura + sistema. O log bruto nunca é
    // indexado porque nunca é armazenado.
    this.indice = this.registros.map((r) => trigramas(`${r.assinatura} ${r.sistema}`));
    this.carregado = true;
  }

  async consultar(pergunta: string, limite = 2): Promise<AchadoRag[]> {
    await this.carregar();
    const alvo = trigramas(pergunta);
    return this.registros
      .map((registro, i) => ({ registro, similaridade: cosseno(alvo, this.indice[i]) }))
      .filter((a) => a.similaridade > 0.08)
      .sort((x, y) => y.similaridade - x.similaridade)
      .slice(0, limite);
  }

  /** Redação para o operador. Curta por construção — é o contrato. */
  formatar(achados: AchadoRag[]): string {
    if (achados.length === 0) {
      return 'Vasculhei a base histórica e não encontrei ocorrência com assinatura equivalente. Se descrever a mensagem exata do erro, indexo para a próxima vez.';
    }
    const linhas = achados.map((a) => {
      const r = a.registro;
      return (
        `• ${r.assinatura} (${r.sistema}) — ${r.ocorrencias} ocorrência(s), ` +
        `a última em ${r.ultima_ocorrencia}. Resolução adotada: ${r.resolucao}`
      );
    });
    return `Sim, já passamos por isso.\n${linhas.join('\n')}`;
  }
}
