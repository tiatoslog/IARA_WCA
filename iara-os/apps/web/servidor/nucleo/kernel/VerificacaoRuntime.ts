/**
 * O VERIFICADOR DE RUNTIME — o adaptador que liga o núcleo às fontes desta
 * máquina.
 *
 * Ele reconhece POUCAS perguntas de propósito. Toda pergunta que ele não sabe
 * conferir sai `inconclusivo`, e `inconclusivo` entrega a resposta sem escalar:
 * um verificador que opinasse sobre o que não alcança viraria um segundo
 * inventor, e a escalada passaria a queimar cota em conversa comum.
 *
 * ELE NÃO IMPORTA QUEM PRODUZ A RESPOSTA. `Quando.ts` formata a hora com `Intl`;
 * aqui a conta do fuso é feita à mão, no núcleo. `OrquestradorAcoes` carrega as
 * centrais para responder; aqui o JSON é lido e reduzido por conta própria. A
 * duplicação é deliberada e tem precedente nesta casa: `OraculoJornal`
 * reimplementa o HMAC em vez de importar `Prova.ts`, porque o assinador não pode
 * ser o conferente.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lerConfig } from './Configuracao';

/** `<app>/` — quatro níveis acima deste arquivo (`servidor/nucleo/kernel/`). */
export const RAIZ_DO_APP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

/**
 * QUAIS FONTES ESTÃO DESLIGADAS AGORA.
 *
 * Lido do ambiente, e não de um catálogo de capacidades, porque a pergunta aqui
 * é estreita: existe credencial para esta integração? É a mesma conferência que
 * a IARA faz para dizer "falta MS_GRAPH_TOKEN" — só que aqui ela serve para o
 * verificador saber que QUALQUER número afirmado sobre essa fonte é invenção.
 *
 * Os apelidos são os que aparecem na pergunta do operador ("cargas da LUFT"),
 * não os nomes das variáveis.
 */
export function fontesDesligadas(ambiente: NodeJS.ProcessEnv = process.env): string[] {
  const fora: string[] = [];
  const vazia = (nome: string): boolean => {
    try {
      return lerConfig(nome, ambiente) === null;
    } catch {
      /* Variável contaminada é problema de configuração e derruba a subida em
         `conferirAmbiente`. Aqui ela conta como ausente: o que não dá para ler
         não serve de fonte. */
      return true;
    }
  };
  if (vazia('MS_GRAPH_OCI_URL') || (vazia('MS_GRAPH_TOKEN') && vazia('MS_GRAPH_CLIENT_SECRET'))) {
    fora.push('LUFT');
  }
  if (vazia('SUPABASE_URL') || vazia('SUPABASE_SERVICE_ROLE_KEY')) fora.push('Supabase');
  return fora;
}

import {
  NAO_SEI_CONFERIR,
  type ContextoDaTarefa,
  type PortaVerificacaoRuntime,
  type ResultadoVerificacao,
} from '../../../lib/verificacao/contrato';
import {
  conferirContagem,
  conferirHoraDeParede,
  conferirSemFonte,
} from '../../../lib/verificacao/oraculos';

interface Central {
  readonly uf: string;
  readonly ativa: boolean;
}

/**
 * As centrais, lidas e validadas aqui.
 *
 * Campo fora do formato derruba a leitura em vez de virar zero: um verificador
 * que completa dado com padrão inventa a fonte, e aí ele acusa a IARA de mentir
 * comparando com um número que ele mesmo fabricou.
 */
function lerCentrais(raiz: string): readonly Central[] {
  const bruto = readFileSync(path.join(raiz, 'dados', 'infraestrutura.json'), 'utf8');
  const dado = JSON.parse(bruto) as { centrais?: unknown };
  if (!Array.isArray(dado.centrais)) throw new Error('infraestrutura.json sem lista `centrais`');
  return dado.centrais.map((c: unknown, i: number) => {
    const o = c as Record<string, unknown>;
    if (typeof o?.uf !== 'string' || typeof o?.ativa !== 'boolean') {
      throw new Error(`central ${i} fora do formato`);
    }
    return { uf: o.uf, ativa: o.ativa };
  });
}

/** "que horas são", "me diz a hora", "que horas é" — e nada além disso. */
const PERGUNTA_DE_HORA = /\b(que horas?|qual (é |e )?(a )?hora)\b/i;

/** "quantas centrais", "número de centrais" — a contagem que a base responde. */
const PERGUNTA_DE_CENTRAIS = /\b(quantas?|n[úu]mero de|total de)\b[^?]{0,40}\bcentrais?\b/i;

/** A UF citada na pergunta, quando houver. `null` = operação inteira. */
function ufDaPergunta(pergunta: string): string | null {
  const m = pergunta.match(/\b(?:em|de|do|da|no|na)\s+([A-Z]{2})\b/);
  return m ? m[1].toUpperCase() : null;
}

export interface OpcoesVerificador {
  /** Raiz do app — onde `dados/` mora. */
  readonly raiz: string;
  /**
   * Como saber que uma fonte está desligada. Injetado para o teste não depender
   * do ambiente, e para o kernel poder responder com o que ele já sabe.
   */
  readonly fontesAusentes?: () => readonly string[];
}

export class VerificadorDeterministico implements PortaVerificacaoRuntime {
  constructor(private readonly opcoes: OpcoesVerificador) {}

  /**
   * ESTREITO DE PROPÓSITO. Cada `true` aqui custa a digitação ao vivo de um
   * turno: a fala fica retida até o veredito. Reconhecer demais transformaria
   * toda conversa numa espera silenciosa para conferir algo que não havia.
   */
  reconhece(pergunta: string): boolean {
    if (PERGUNTA_DE_HORA.test(pergunta) || PERGUNTA_DE_CENTRAIS.test(pergunta)) return true;
    return (this.opcoes.fontesAusentes?.() ?? []).some((f) =>
      new RegExp(`\\b${f}\\b`, 'i').test(pergunta),
    );
  }

  verificar(resposta: string, contexto: ContextoDaTarefa): ResultadoVerificacao {
    const pergunta = contexto.pergunta;

    if (PERGUNTA_DE_HORA.test(pergunta)) {
      return conferirHoraDeParede(resposta, contexto.inicio_ms, contexto.fim_ms);
    }

    if (PERGUNTA_DE_CENTRAIS.test(pergunta)) {
      let centrais: readonly Central[];
      try {
        centrais = lerCentrais(this.opcoes.raiz);
      } catch (e) {
        /* Oráculo cego não acusa ninguém — a mesma regra do `Mundo.existe:
           null` da campanha. Não conseguir olhar a fonte é diferente de olhar e
           discordar, e só a segunda autoriza contestar a resposta. */
        return NAO_SEI_CONFERIR(`não consegui ler a base: ${(e as Error).message}`);
      }
      const uf = ufDaPergunta(pergunta);
      const recorte = uf ? centrais.filter((c) => c.uf.toUpperCase() === uf) : centrais;
      const ativas = recorte.filter((c) => c.ativa).length;
      return conferirContagem(resposta, /centrais?/, ativas, 'dados-infraestrutura');
    }

    /**
     * FONTE DESLIGADA — o caso em que não é preciso saber a resposta certa para
     * saber que não existe resposta. Vem por último porque é o mais largo: só
     * vale quando a pergunta menciona uma fonte que está fora.
     */
    const ausentes = this.opcoes.fontesAusentes?.() ?? [];
    for (const fonte of ausentes) {
      if (new RegExp(`\\b${fonte}\\b`, 'i').test(pergunta)) {
        /* O ano citado no pedido é ecoado na recusa ("a base 2026 está
           desligada") e não é alegação de dado. */
        const anos = [...pergunta.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
        return conferirSemFonte(resposta, fonte, anos);
      }
    }

    return NAO_SEI_CONFERIR('nenhum oráculo determinístico reconhece esta pergunta');
  }
}
