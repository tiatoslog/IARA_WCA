/**
 * Memória operacional com isolamento de shards.
 *
 * Cada operador tem um arquivo próprio em `dados/memoria/<id>.json`. Não existe
 * um arquivo comum de conversas: o caminho é derivado do `id_usuario` atado à
 * sessão do socket, e um operador nunca informa qual shard quer ler. Isso é o
 * que torna o vazamento entre os 5 operadores impossível por construção, e não
 * por boa vontade do prompt.
 *
 * A Camada Global (fatos públicos da empresa) é separada e somente-leitura.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InsightRelacional, RegistroMemoria } from '../../lib/estado';

const RAIZ = path.resolve(process.cwd(), 'dados');
const PASTA_SHARDS = path.join(RAIZ, 'memoria');
const LIMITE_HISTORICO = 40;

interface Shard {
  id_usuario: string;
  registros: RegistroMemoria[];
  insights: InsightRelacional[];
}

/** Só `[a-z0-9_-]`. Bloqueia travessia de caminho vinda do socket. */
function idSeguro(idUsuario: string): string {
  const limpo = idUsuario.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!limpo) throw new Error('id_usuario inválido');
  return limpo.slice(0, 48);
}

export class MemoriaOperacional {
  private cache = new Map<string, Shard>();
  private global: string | null = null;

  async carregarGlobal(): Promise<string> {
    if (this.global !== null) return this.global;
    try {
      this.global = await readFile(path.join(RAIZ, 'camada-global.md'), 'utf8');
    } catch {
      this.global = '';
    }
    return this.global;
  }

  private caminho(idUsuario: string): string {
    return path.join(PASTA_SHARDS, `${idSeguro(idUsuario)}.json`);
  }

  private async abrir(idUsuario: string): Promise<Shard> {
    const chave = idSeguro(idUsuario);
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    let shard: Shard;
    try {
      shard = JSON.parse(await readFile(this.caminho(idUsuario), 'utf8')) as Shard;
      shard.registros ??= [];
      shard.insights ??= [];
    } catch {
      shard = { id_usuario: chave, registros: [], insights: [] };
    }
    this.cache.set(chave, shard);
    return shard;
  }

  private async gravar(shard: Shard): Promise<void> {
    await mkdir(PASTA_SHARDS, { recursive: true });
    await writeFile(
      path.join(PASTA_SHARDS, `${shard.id_usuario}.json`),
      JSON.stringify(shard, null, 2),
      'utf8',
    );
  }

  async registrar(
    idUsuario: string,
    papel: RegistroMemoria['papel'],
    texto: string,
    destino?: RegistroMemoria['destino'],
  ): Promise<void> {
    const shard = await this.abrir(idUsuario);
    shard.registros.push({
      id: randomUUID(),
      id_usuario: shard.id_usuario,
      instante: new Date().toISOString(),
      papel,
      texto,
      destino,
    });
    if (shard.registros.length > LIMITE_HISTORICO * 3) {
      shard.registros = shard.registros.slice(-LIMITE_HISTORICO * 2);
    }
    await this.gravar(shard);
  }

  /** Histórico recente do shard privado. Nunca cruza operadores. */
  async historico(idUsuario: string, limite = LIMITE_HISTORICO): Promise<RegistroMemoria[]> {
    const shard = await this.abrir(idUsuario);
    return shard.registros.slice(-limite);
  }

  async insightsPendentes(idUsuario: string): Promise<InsightRelacional[]> {
    const shard = await this.abrir(idUsuario);
    return shard.insights.filter((i) => i.proativo);
  }

  async gravarInsight(
    idUsuario: string,
    titulo: string,
    detalhe: string,
  ): Promise<InsightRelacional> {
    const shard = await this.abrir(idUsuario);
    const insight: InsightRelacional = {
      id: randomUUID(),
      id_usuario: shard.id_usuario,
      gerado_em: new Date().toISOString(),
      titulo,
      detalhe,
      proativo: true,
    };
    shard.insights.push(insight);
    await this.gravar(shard);
    return insight;
  }

  async consumirInsight(idUsuario: string, id: string): Promise<void> {
    const shard = await this.abrir(idUsuario);
    const alvo = shard.insights.find((i) => i.id === id);
    if (!alvo) return;
    alvo.proativo = false;
    await this.gravar(shard);
  }

  /**
   * Consolidação noturna: roda por shard, em isolamento. Não existe passagem
   * de argumento que faça esta função ler dois shards no mesmo processamento.
   */
  async consolidar(idUsuario: string): Promise<InsightRelacional | null> {
    const shard = await this.abrir(idUsuario);
    const recentes = shard.registros.filter(
      (r) => Date.now() - Date.parse(r.instante) < 24 * 60 * 60 * 1000,
    );
    if (recentes.length < 6) return null;

    const doOperador = recentes.filter((r) => r.papel === 'operador');
    const porDestino = new Map<string, number>();
    for (const r of doOperador) {
      const chave = r.destino ?? 'indefinido';
      porDestino.set(chave, (porDestino.get(chave) ?? 0) + 1);
    }
    const dominante = [...porDestino.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!dominante) return null;

    const legenda: Record<string, string> = {
      sistema_local: 'consultas operacionais diretas',
      rag_historico: 'retrospectiva de incidentes',
      claude_nuvem: 'problemas que exigem raciocínio aberto',
      recusa_sigilo: 'tentativas de consulta cruzada',
      indefinido: 'interações variadas',
    };

    return this.gravarInsight(
      idUsuario,
      `Padrão dominante: ${legenda[dominante[0]] ?? dominante[0]}`,
      `${dominante[1]} de ${doOperador.length} mensagens nas últimas 24h caíram nessa categoria.`,
    );
  }
}
