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
import {
  normalizarPreferencias,
  PREFERENCIAS_PADRAO,
  type PreferenciasOperador,
} from '../../lib/perfil';
import { bancoPara } from './ClienteSupabase';
import { exigirIdCanonico } from './kernel/Identidade';

const RAIZ = path.resolve(process.cwd(), 'dados');
const PASTA_SHARDS = path.join(RAIZ, 'memoria');
const LIMITE_HISTORICO = 40;

interface Shard {
  id_usuario: string;
  registros: RegistroMemoria[];
  insights: InsightRelacional[];
  /** A ficha que o operador escreveu sobre si. Ausente em shard antigo. */
  preferencias?: PreferenciasOperador;
}

/**
 * A chave do shard. RECUSA um id fora da forma canônica em vez de consertá-lo.
 *
 * A versão anterior fazia `toLowerCase().replace(...).slice(0, 48)` — e
 * saneamento é uma função que perde informação. `"Ana"` e `"ana"` caíam no
 * MESMO shard; `"x".repeat(50) + "a"` e `"x".repeat(50) + "b"` também. Cada
 * colisão dessas é o histórico de uma pessoa aparecendo para outra, que é
 * exatamente o invariante que este arquivo existe para sustentar.
 *
 * Ver `kernel/Identidade.ts`. A trava de travessia de caminho continua sendo a
 * mesma — a forma canônica não admite `/`, `\` nem `.` —, só que agora ela
 * barra em vez de mutilar.
 */
function idSeguro(idUsuario: string): string {
  return exigirIdCanonico(idUsuario, 'MemoriaOperacional');
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
    const bd = bancoPara('memoria_registros');

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
    const bd = bancoPara('memoria_registros');

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

  /**
   * QUANTAS VEZES essa pessoa já falou com a IARA — o lastro da familiaridade.
   *
   * O PROBLEMA QUE ISTO RESOLVE: a `afinidade` de `MetricasVitais` nasce em 0,5
   * e sobe 0,015 por tarefa concluída, mas vive no estado da sessão. Toda manhã
   * ela zerava. Quem conversa com a IARA há seis meses era tratado, às nove da
   * manhã, exatamente como quem chegou ontem — e é a afinidade que abre a
   * provocação amigável em `TeoriaDaMente.overrideDeFamiliaridade`. Sem lastro,
   * "eu sabia que você ia tentar isso" nunca podia ser dito por quem de fato
   * sabia, e a personalidade ficava presa na primeira semana para sempre.
   *
   * A contagem é do que o OPERADOR escreveu, não do total: as falas da IARA
   * dobrariam o número sem dobrar a convivência.
   *
   * NUNCA LANÇA. Familiaridade é enfeite de tom; tabela ausente ou shard
   * ilegível devolve 0, que é a leitura conservadora — a IARA recomeça formal.
   * Mesma regra de `lerPreferencias` e do insight noturno na `Porta`: ler
   * memória não pode impedir ninguém de entrar no escritório.
   */
  async trocasAcumuladas(idUsuario: string): Promise<number> {
    try {
      const chave = idSeguro(idUsuario);
      const bd = bancoPara('memoria_registros');

      if (bd) {
        // `head: true` traz só o total: contar convivência não é motivo para
        // arrastar o histórico inteiro pela rede na abertura da sessão.
        const { count, error } = await bd
          .from('memoria_registros')
          .select('id', { count: 'exact', head: true })
          .eq('id_usuario', chave) // ← o filtro que define o shard
          .eq('papel', 'operador');
        if (error) throw new Error(`Supabase: ${error.message}`);
        return count ?? 0;
      }

      const shard = await this.abrir(chave);
      return shard.registros.filter((r) => r.papel === 'operador').length;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Ficha do operador
  // ---------------------------------------------------------------------------

  /**
   * Lê a ficha do shard. NUNCA lança: uma tabela ausente no Supabase não pode
   * impedir alguém de entrar no escritório — é a mesma regra que já vale para o
   * insight noturno na `Porta`. Ficha ilegível degrada para "nada declarado",
   * que é exatamente o estado em que a IARA não presume tratamento nenhum.
   */
  async lerPreferencias(idUsuario: string): Promise<PreferenciasOperador> {
    const chave = idSeguro(idUsuario);
    const bd = bancoPara('operador_preferencias');

    try {
      if (bd) {
        const { data, error } = await bd
          .from('operador_preferencias')
          .select('preferencias')
          .eq('id_usuario', chave) // ← o filtro que define o shard
          .maybeSingle();
        if (error) throw new Error(`Supabase: ${error.message}`);
        return normalizarPreferencias(data?.preferencias);
      }
      const shard = await this.abrir(chave);
      return normalizarPreferencias(shard.preferencias);
    } catch {
      return { ...PREFERENCIAS_PADRAO };
    }
  }

  /**
   * Grava a ficha. Ao contrário da leitura, PROPAGA o erro: quem clicou em
   * "salvar" precisa saber que não salvou. Sumir com a escrita e devolver a
   * tela em silêncio é o que faz o operador declarar a mesma coisa três vezes.
   */
  async gravarPreferencias(
    idUsuario: string,
    preferencias: PreferenciasOperador,
  ): Promise<PreferenciasOperador> {
    const chave = idSeguro(idUsuario);
    const limpo = normalizarPreferencias(preferencias);
    const bd = bancoPara('operador_preferencias');

    if (bd) {
      const { error } = await bd
        .from('operador_preferencias')
        .upsert(
          { id_usuario: chave, preferencias: limpo, atualizado_em: new Date().toISOString() },
          { onConflict: 'id_usuario' },
        );
      if (error) throw new Error(`Supabase: ${error.message}`);
      return limpo;
    }

    const shard = await this.abrir(chave);
    shard.preferencias = limpo;
    await this.gravar(shard);
    return limpo;
  }

  async insightsPendentes(idUsuario: string): Promise<InsightRelacional[]> {
    const chave = idSeguro(idUsuario);
    const bd = bancoPara('insights_relacionais');

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

    const bd = bancoPara('insights_relacionais');
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
    const bd = bancoPara('insights_relacionais');

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
    const bd = bancoPara('memoria_registros');
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
