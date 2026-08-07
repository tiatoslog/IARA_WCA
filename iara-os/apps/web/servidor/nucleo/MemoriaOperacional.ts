/**
 * Memória operacional com isolamento de shards.
 *
 * Duas persistências, mesmo contrato: Supabase quando configurado, arquivo em
 * `dados/memoria/<id>.json` caso contrário.
 *
 * O INVARIANTE NÃO MUDA COM O BACKEND: o `id_usuario` vem sempre da sessão do
 * socket, nunca da mensagem. No modo arquivo isso vira o caminho do shard; no
 * Supabase vira um `.eq('id_usuario', ...)` obrigatório em toda query. Não
 * existe método aqui que leia dois operadores de uma vez — nem o consolidador
 * noturno.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InsightRelacional, RegistroMemoria } from '../../lib/estado';
import { supabase } from './ClienteSupabase';

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

  // ---------------------------------------------------------------------------
  // Modo arquivo
  // ---------------------------------------------------------------------------

  private async abrir(idUsuario: string): Promise<Shard> {
    const chave = idSeguro(idUsuario);
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    let shard: Shard;
    try {
      shard = JSON.parse(
        await readFile(path.join(PASTA_SHARDS, `${chave}.json`), 'utf8'),
      ) as Shard;
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

  // ---------------------------------------------------------------------------
  // API pública
  // ---------------------------------------------------------------------------

  async registrar(
    idUsuario: string,
    papel: RegistroMemoria['papel'],
    texto: string,
    destino?: RegistroMemoria['destino'],
  ): Promise<void> {
    const chave = idSeguro(idUsuario);
    const bd = supabase();

    if (bd) {
      const { error } = await bd.from('memoria_registros').insert({
        id_usuario: chave,
        instante: new Date().toISOString(),
        papel,
        texto,
        destino: destino ?? null,
      });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return;
    }

    const shard = await this.abrir(chave);
    shard.registros.push({
      id: randomUUID(),
      id_usuario: chave,
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
    const chave = idSeguro(idUsuario);
    const bd = supabase();

    if (bd) {
      const { data, error } = await bd
        .from('memoria_registros')
        .select('id, id_usuario, instante, papel, texto, destino')
        .eq('id_usuario', chave) // ← o filtro que define o shard
        .order('instante', { ascending: false })
        .limit(limite);
      if (error) throw new Error(`Supabase: ${error.message}`);
      // A query vem em ordem decrescente para pegar os N mais recentes; o
      // motor precisa em ordem cronológica.
      return ((data ?? []) as RegistroMemoria[]).reverse();
    }

    const shard = await this.abrir(chave);
    return shard.registros.slice(-limite);
  }

  async insightsPendentes(idUsuario: string): Promise<InsightRelacional[]> {
    const chave = idSeguro(idUsuario);
    const bd = supabase();

    if (bd) {
      const { data, error } = await bd
        .from('insights_relacionais')
        .select('id, id_usuario, gerado_em, titulo, detalhe, proativo')
        .eq('id_usuario', chave)
        .eq('proativo', true);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (data ?? []) as InsightRelacional[];
    }

    const shard = await this.abrir(chave);
    return shard.insights.filter((i) => i.proativo);
  }

  async gravarInsight(
    idUsuario: string,
    titulo: string,
    detalhe: string,
  ): Promise<InsightRelacional> {
    const chave = idSeguro(idUsuario);
    const insight: InsightRelacional = {
      id: randomUUID(),
      id_usuario: chave,
      gerado_em: new Date().toISOString(),
      titulo,
      detalhe,
      proativo: true,
    };

    const bd = supabase();
    if (bd) {
      const { error } = await bd.from('insights_relacionais').insert(insight);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return insight;
    }

    const shard = await this.abrir(chave);
    shard.insights.push(insight);
    await this.gravar(shard);
    return insight;
  }

  async consumirInsight(idUsuario: string, id: string): Promise<void> {
    const chave = idSeguro(idUsuario);
    const bd = supabase();

    if (bd) {
      // O `eq('id_usuario')` é redundante com o id ser uuid, e é proposital:
      // nenhuma escrita sai daqui sem carimbo de dono.
      const { error } = await bd
        .from('insights_relacionais')
        .update({ proativo: false })
        .eq('id', id)
        .eq('id_usuario', chave);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return;
    }

    const shard = await this.abrir(chave);
    const alvo = shard.insights.find((i) => i.id === id);
    if (!alvo) return;
    alvo.proativo = false;
    await this.gravar(shard);
  }

  /**
   * Consolidação noturna: roda por shard, em isolamento. Não existe caminho
   * aqui que leia dois operadores no mesmo processamento — nem por engano.
   */
  async consolidar(idUsuario: string): Promise<InsightRelacional | null> {
    const chave = idSeguro(idUsuario);
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    let recentes: RegistroMemoria[];
    const bd = supabase();
    if (bd) {
      const { data, error } = await bd
        .from('memoria_registros')
        .select('id, id_usuario, instante, papel, texto, destino')
        .eq('id_usuario', chave)
        .gte('instante', desde);
      if (error) throw new Error(`Supabase: ${error.message}`);
      recentes = (data ?? []) as RegistroMemoria[];
    } else {
      const shard = await this.abrir(chave);
      recentes = shard.registros.filter((r) => r.instante >= desde);
    }

    if (recentes.length < 6) return null;

    const doOperador = recentes.filter((r) => r.papel === 'operador');
    if (doOperador.length === 0) return null;

    const porDestino = new Map<string, number>();
    for (const r of doOperador) {
      const k = r.destino ?? 'indefinido';
      porDestino.set(k, (porDestino.get(k) ?? 0) + 1);
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
      chave,
      `Padrão dominante: ${legenda[dominante[0]] ?? dominante[0]}`,
      `${dominante[1]} de ${doOperador.length} mensagens nas últimas 24h caíram nessa categoria.`,
    );
  }
}
