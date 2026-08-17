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

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TravaAssincrona } from './TravaAssincrona';
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

/**
 * `rename` POR CIMA DE ARQUIVO ABERTO, no Windows.
 *
 * No POSIX o `rename` atômico é incondicional. No Windows ele falha com
 * `EPERM`/`EBUSY`/`EACCES` enquanto QUALQUER processo mantém um descritor aberto
 * no alvo — e nesta casa isso acontece o tempo todo: um leitor de histórico, o
 * antivírus varrendo a pasta, o indexador do sistema. A janela é de
 * milissegundos e passa sozinha.
 *
 * Sem esta insistência a falha subia por `gravarPreferencias`, que PROPAGA erro
 * de propósito — o operador clicaria em salvar e leria que não salvou, por
 * causa de um antivírus. Encontrado como teste intermitente (≈1 em 3 execuções
 * da suíte completa) antes de aparecer como chamado de suporte.
 *
 * O teto é baixo de propósito: se depois de ~150 ms o alvo continua preso, não
 * é mais disputa de milissegundos, e aí o erro DEVE subir — insistir mais
 * esconderia um problema real (arquivo travado, permissão errada) atrás de uma
 * lentidão inexplicável.
 */
const TENTATIVAS_RENOMEAR = 6;

async function renomearComInsistencia(de: string, para: string): Promise<void> {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await rename(de, para);
      return;
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code;
      const disputa = codigo === 'EPERM' || codigo === 'EBUSY' || codigo === 'EACCES';
      if (!disputa || tentativa >= TENTATIVAS_RENOMEAR) throw erro;
      await new Promise((pronto) => setTimeout(pronto, tentativa * 5));
    }
  }
}

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
  private travas = new Map<string, TravaAssincrona>();
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

  /**
   * A trava do shard. UMA POR OPERADOR, e não uma global: o histórico da Ana
   * não tem por que esperar o da Bia terminar de gravar, e uma trava única
   * transformaria toda escrita de memória numa fila do escritório inteiro.
   */
  private travaDe(chave: string): TravaAssincrona {
    let trava = this.travas.get(chave);
    if (!trava) {
      trava = new TravaAssincrona();
      this.travas.set(chave, trava);
    }
    return trava;
  }

  /** Lê o shard IGNORANDO o cache. É a leitura de quem vai escrever. */
  private async lerDoDisco(chave: string): Promise<Shard> {
    let shard: Shard;
    try {
      shard = JSON.parse(await readFile(path.join(PASTA_SHARDS, `${chave}.json`), 'utf8')) as Shard;
      shard.registros ??= [];
      shard.insights ??= [];
    } catch {
      shard = { id_usuario: chave, registros: [], insights: [] };
    }
    return shard;
  }

  /**
   * LER, ALTERAR, GRAVAR — sob trava, e relendo o disco toda vez.
   *
   * O DEFEITO QUE ISTO FECHA, reproduzido em 17/08/2026 com duas instâncias:
   *
   *   `Porta.ts:43` e `canais/PortaWhatsapp.ts:46` constroem, cada uma, a sua
   *   `MemoriaOperacional`. Cada instância lia o shard UMA vez, guardava o
   *   objeto no cache e, a cada mensagem, gravava o objeto CACHEADO inteiro por
   *   cima do arquivo. A partir da segunda leitura nenhuma das duas voltava ao
   *   disco — então cada escrita apagava tudo que o outro canal tinha escrito
   *   desde então. Medido: `MSG-WHATS-1` sumiu do histórico, e a ficha que o
   *   operador salvou na web (`como_me_chamar`) voltou a `null` na mensagem
   *   seguinte do WhatsApp. Sem erro, sem log, sem sintoma.
   *
   *   É o pior modo de falha desta casa: silencioso e indistinguível de "o
   *   operador nunca disse isso". Pior ainda porque `gravarPreferencias`
   *   promete, no comentário logo abaixo, propagar erro para quem clicou em
   *   salvar — e ela propagava; era outro canal que desfazia depois.
   *
   * DUAS TRAVAS, NÃO UMA. A `TravaAssincrona` fecha a janela `ler → await →
   * escrever` DENTRO do processo. O `rename` fecha a janela ENTRE processos:
   * ele é atômico no sistema de arquivos, então ninguém nunca lê um shard pela
   * metade — que é como um JSON truncado cairia no `catch` do `lerDoDisco` e
   * viraria um shard VAZIO, apagando a memória do operador de vez.
   *
   * O que isto NÃO resolve, e é honesto dizer: dois PROCESSOS distintos ainda
   * podem perder uma atualização um do outro, porque `rename` serializa a
   * escrita mas não a leitura que veio antes dela. O modo multiprocesso
   * suportado é o Supabase, onde cada registro é um `INSERT` e nada é
   * reescrito. Ver o cabeçalho do arquivo.
   */
  private async sobTrava<T>(chave: string, corpo: (shard: Shard) => T | Promise<T>): Promise<T> {
    return this.travaDe(chave).executar(async () => {
      const shard = await this.lerDoDisco(chave);
      const saida = await corpo(shard);
      await this.gravar(shard);
      // O cache passa a valer o que ACABOU de ir para o disco. Ele serve à
      // leitura; a escrita nunca mais confia nele.
      this.cache.set(chave, shard);
      return saida;
    });
  }

  private async abrir(idUsuario: string): Promise<Shard> {
    const chave = idSeguro(idUsuario);
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    const shard = await this.lerDoDisco(chave);
    this.cache.set(chave, shard);
    return shard;
  }

  /**
   * Escrita ATÔMICA: arquivo temporário e `rename` por cima.
   *
   * `writeFile` direto trunca o alvo antes de escrever o conteúdo novo. Um
   * crash — ou só duas escritas se cruzando — deixa um JSON pela metade, e um
   * JSON pela metade cai no `catch` do `lerDoDisco` como shard VAZIO. A memória
   * inteira do operador desaparece porque uma gravação foi interrompida.
   *
   * O nome do temporário carrega pid e sorteio para que dois escritores
   * simultâneos nunca disputem o mesmo arquivo intermediário.
   */
  private async gravar(shard: Shard): Promise<void> {
    await mkdir(PASTA_SHARDS, { recursive: true });
    const alvo = path.join(PASTA_SHARDS, `${shard.id_usuario}.json`);
    const temporario = `${alvo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temporario, JSON.stringify(shard, null, 2), 'utf8');
    await renomearComInsistencia(temporario, alvo);
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

    await this.sobTrava(chave, (shard) => {
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
    });
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

    await this.sobTrava(chave, (shard) => {
      shard.preferencias = limpo;
    });
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

    await this.sobTrava(chave, (shard) => {
      shard.insights.push(insight);
    });
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

    await this.sobTrava(chave, (shard) => {
      const alvo = shard.insights.find((i) => i.id === id);
      if (alvo) alvo.proativo = false;
    });
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

/**
 * A MEMÓRIA DO PROCESSO É UMA SÓ.
 *
 * A trava e o cache moram na INSTÂNCIA. Duas instâncias no mesmo processo são
 * duas travas que não se conhecem — e era exatamente isso que havia: a `Porta`
 * (tela) e o canal WhatsApp construíam cada uma a sua, e o mesmo operador
 * falando pelos dois lados perdia mensagem e ficha.
 *
 * Um `export const` é a forma mais barata de tornar a duplicata impossível: não
 * há como um canal novo "esquecer" de compartilhar a trava se não existe outra
 * instância para construir. A classe continua exportada porque teste e
 * ferramenta precisam de instância isolada — o que não pode existir é uma
 * segunda instância SERVINDO OPERADOR.
 */
export const memoriaOperacional = new MemoriaOperacional();
