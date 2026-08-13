/**
 * Agenda — os lembretes que o operador deixou marcados com a IARA.
 *
 * Mesmo desenho da `MemoriaOperacional`, e não é preguiça: é o mesmo problema.
 * Duas persistências sob um contrato só (Supabase quando configurado, arquivo
 * em `dados/agenda/<id>.json` caso contrário), e o `id_usuario` vindo SEMPRE da
 * sessão do socket — nunca da mensagem. Um lembrete é tão privado quanto o
 * histórico: ele diz o que a pessoa tem medo de esquecer.
 *
 * POR QUE ISTO É ESTADO INTERNO, e não efeito externo. Um lembrete gravado não
 * é percebido por ninguém fora da IARA. Ele não manda mensagem, não marca nada
 * em calendário de terceiro, não sai do processo. Quando vence, quem fala é a
 * própria IARA pelo mesmo canal de sempre. Por isso `Fronteira.ts` o declara em
 * `ESTADO_INTERNO`, ao lado da memória — e por isso ele não pode, nem
 * transitivamente, alcançar o `AgenteLocal` ou o portal.
 *
 * A ENTREGA É REGISTRADA, e este é o campo que importa. `entregue_em` existe
 * para que um lembrete dispare UMA vez. Sem ele, o ciclo autônomo reencontraria
 * o mesmo vencimento a cada 15 segundos e a IARA repetiria o recado até alguém
 * matar o processo — o modo de falha clássico de agendador que só compara
 * horários.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { supabase } from './ClienteSupabase';

const PASTA_AGENDA = path.resolve(process.cwd(), 'dados', 'agenda');

/** Teto por operador. Agenda sem teto é fila de spam esperando um laço. */
const MAX_PENDENTES = 50;

export interface Lembrete {
  readonly id: string;
  readonly id_usuario: string;
  readonly criado_em: string;
  /** ISO. O instante em que a IARA deve falar. */
  readonly vence_em: string;
  readonly assunto: string;
  /** ISO quando já foi dito ao operador; `null` enquanto espera. */
  readonly entregue_em: string | null;
}

interface Caderno {
  id_usuario: string;
  lembretes: Lembrete[];
}

/** Só `[a-z0-9_-]`. A mesma trava da memória: nada que venha do socket vira caminho. */
function idSeguro(idUsuario: string): string {
  const limpo = idUsuario.toLowerCase().replace(/[^a-z0-9_-]/g, '');
  if (!limpo) throw new Error('id_usuario inválido');
  return limpo.slice(0, 48);
}

export class Agenda {
  private cache = new Map<string, Caderno>();

  /**
   * Id do último lembrete criado por operador — mesmo papel que o mapa de
   * capturas do `AgenteLocal`, e pela mesma razão exata: o verificador da
   * habilidade não tem como recalcular um uuid. Sem isto, `verificar` só
   * poderia reler o texto que `executar` devolveu, que é conferir o relato
   * contra o próprio relato — o buraco que a quinta porta existe para fechar.
   */
  private ultimos = new Map<string, string>();

  // -------------------------------------------------------------------------
  // Modo arquivo
  // -------------------------------------------------------------------------

  private async abrir(chave: string): Promise<Caderno> {
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;

    let caderno: Caderno;
    try {
      caderno = JSON.parse(
        await readFile(path.join(PASTA_AGENDA, `${chave}.json`), 'utf8'),
      ) as Caderno;
      caderno.lembretes ??= [];
    } catch {
      caderno = { id_usuario: chave, lembretes: [] };
    }
    this.cache.set(chave, caderno);
    return caderno;
  }

  private async gravar(caderno: Caderno): Promise<void> {
    await mkdir(PASTA_AGENDA, { recursive: true });
    await writeFile(
      path.join(PASTA_AGENDA, `${caderno.id_usuario}.json`),
      JSON.stringify(caderno, null, 2),
      'utf8',
    );
  }

  // -------------------------------------------------------------------------
  // API pública
  // -------------------------------------------------------------------------

  /**
   * Marca um lembrete. Devolve `null` quando o operador já está no teto — e a
   * habilidade transforma isso numa frase, não numa exceção: estar com a agenda
   * cheia é um fato do operador, não um erro do sistema.
   */
  async agendar(idUsuario: string, assunto: string, venceEm: Date): Promise<Lembrete | null> {
    const chave = idSeguro(idUsuario);
    /**
     * O id antigo sai ANTES da tentativa. Se a gravação falhar, `verificar`
     * precisa encontrar ausência — e não o lembrete da vez passada, que existe
     * de verdade e confirmaria um agendamento que não aconteceu.
     */
    this.ultimos.delete(chave);

    const pendentes = await this.pendentes(chave);
    if (pendentes.length >= MAX_PENDENTES) return null;

    const lembrete: Lembrete = {
      id: randomUUID(),
      id_usuario: chave,
      criado_em: new Date().toISOString(),
      vence_em: venceEm.toISOString(),
      assunto: assunto.slice(0, 200),
      entregue_em: null,
    };

    const bd = supabase();
    if (bd) {
      const { error } = await bd.from('agenda_lembretes').insert(lembrete);
      if (error) throw new Error(`Supabase: ${error.message}`);
      this.ultimos.set(chave, lembrete.id);
      return lembrete;
    }

    const caderno = await this.abrir(chave);
    caderno.lembretes.push(lembrete);
    await this.gravar(caderno);
    this.ultimos.set(chave, lembrete.id);
    return lembrete;
  }

  /** Id do último lembrete que este operador criou. Usado pelo verificador. */
  ultimoAgendadoDe(idUsuario: string): string | null {
    return this.ultimos.get(idSeguro(idUsuario)) ?? null;
  }

  /** Os que ainda não foram ditos, do mais próximo ao mais distante. */
  async pendentes(idUsuario: string): Promise<Lembrete[]> {
    const chave = idSeguro(idUsuario);
    const bd = supabase();

    if (bd) {
      const { data, error } = await bd
        .from('agenda_lembretes')
        .select('id, id_usuario, criado_em, vence_em, assunto, entregue_em')
        .eq('id_usuario', chave) // ← o filtro que define o shard
        .is('entregue_em', null)
        .order('vence_em', { ascending: true });
      if (error) throw new Error(`Supabase: ${error.message}`);
      return (data ?? []) as Lembrete[];
    }

    const caderno = await this.abrir(chave);
    return caderno.lembretes
      .filter((l) => l.entregue_em === null)
      .sort((a, b) => a.vence_em.localeCompare(b.vence_em));
  }

  /**
   * O que já venceu e ainda não foi dito.
   *
   * Filtra em memória mesmo no caminho do Supabase: `pendentes` já traz só os
   * não entregues deste operador, e a lista tem teto de 50. Uma query a mais
   * por tique não paga o que custa manter duas expressões de vencimento —
   * uma em SQL, outra em TypeScript — concordando ao longo do tempo.
   */
  async vencidos(idUsuario: string, agora = new Date()): Promise<Lembrete[]> {
    const limite = agora.toISOString();
    return (await this.pendentes(idUsuario)).filter((l) => l.vence_em <= limite);
  }

  /**
   * Carimba a entrega. Chamado DEPOIS de a IARA falar, nunca antes: um carimbo
   * antecipado transforma uma falha de entrega em lembrete silenciosamente
   * perdido, que é o único desfecho pior que repetir o recado.
   */
  async marcarEntregue(idUsuario: string, id: string): Promise<void> {
    const chave = idSeguro(idUsuario);
    const instante = new Date().toISOString();
    const bd = supabase();

    if (bd) {
      // O `eq('id_usuario')` é redundante com o id ser uuid, e é proposital:
      // nenhuma escrita sai daqui sem carimbo de dono.
      const { error } = await bd
        .from('agenda_lembretes')
        .update({ entregue_em: instante })
        .eq('id', id)
        .eq('id_usuario', chave);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return;
    }

    const caderno = await this.abrir(chave);
    const alvo = caderno.lembretes.findIndex((l) => l.id === id);
    if (alvo < 0) return;
    caderno.lembretes[alvo] = { ...caderno.lembretes[alvo], entregue_em: instante };
    await this.gravar(caderno);
  }

  /**
   * Cancela pelo ASSUNTO, não por id.
   *
   * O operador fala; ele não tem um uuid na mão. `termo` vazio só cancela
   * quando existe exatamente um pendente — com dois ou mais, devolver "o
   * primeiro" seria escolher por ele. Nesse caso volta `null` e a habilidade
   * pede qual.
   */
  async cancelar(idUsuario: string, termo: string): Promise<Lembrete | null> {
    const chave = idSeguro(idUsuario);
    const pendentes = await this.pendentes(chave);
    if (pendentes.length === 0) return null;

    const alvo = this.escolher(pendentes, termo);
    if (!alvo) return null;

    const bd = supabase();
    if (bd) {
      const { error } = await bd
        .from('agenda_lembretes')
        .delete()
        .eq('id', alvo.id)
        .eq('id_usuario', chave);
      if (error) throw new Error(`Supabase: ${error.message}`);
      return alvo;
    }

    const caderno = await this.abrir(chave);
    caderno.lembretes = caderno.lembretes.filter((l) => l.id !== alvo.id);
    await this.gravar(caderno);
    return alvo;
  }

  /**
   * Qual lembrete o operador quis dizer. Determinístico de propósito: a LLM
   * não escolhe o que apagar.
   */
  private escolher(pendentes: readonly Lembrete[], termo: string): Lembrete | null {
    const t = termo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .trim();

    if (!t) return pendentes.length === 1 ? pendentes[0] : null;

    const casam = pendentes.filter((l) =>
      l.assunto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .includes(t),
    );
    // Ambíguo NÃO cancela. Apagar o lembrete errado é silencioso: o operador só
    // descobre na hora em que o certo não toca.
    return casam.length === 1 ? casam[0] : null;
  }

  /** Existe pendente com este id? Usado pelo verificador da habilidade. */
  async temPendente(idUsuario: string, id: string): Promise<boolean> {
    return (await this.pendentes(idUsuario)).some((l) => l.id === id);
  }

  /**
   * Que lembrete este termo identifica AGORA — sem cancelar nada.
   *
   * É como o verificador de `cancelar_lembrete` confere o mundo sem precisar
   * guardar estado: se o termo ainda encontra alguém, o cancelamento não
   * aconteceu.
   */
  async encontrar(idUsuario: string, termo: string): Promise<Lembrete | null> {
    return this.escolher(await this.pendentes(idUsuario), termo);
  }
}

/** Instância única do processo — o cache dos cadernos vive nela. */
export const agenda = new Agenda();
