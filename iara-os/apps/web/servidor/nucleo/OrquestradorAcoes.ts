/**
 * CAMADA 2 — Ações nativas.
 *
 * Cada método aqui é determinístico, gratuito e responde em centenas de
 * milissegundos. Nenhum deles chama a LLM.
 *
 * Toda ação de rede tem timeout e caminho de falha explícito: a IARA diz que
 * a fonte falhou, ela nunca inventa o dado.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buscarNaWeb } from './BuscaWeb';
import { supabase } from './ClienteSupabase';

export interface ResultadoAcao {
  texto: string;
  capacidade: 'automacao' | 'percepcao' | 'conhecimento' | 'memoria';
  latencia_ms: number;
}

interface Central {
  nome: string;
  uf: string;
  ativa: boolean;
  veiculos: number;
}

const RAIZ_DADOS = path.resolve(process.cwd(), 'dados');

const CODIGOS_TEMPO: Record<number, string> = {
  0: 'céu limpo',
  1: 'predominantemente limpo',
  2: 'parcialmente nublado',
  3: 'encoberto',
  45: 'névoa',
  48: 'névoa com deposição de geada',
  51: 'garoa fraca',
  53: 'garoa moderada',
  55: 'garoa densa',
  61: 'chuva fraca',
  63: 'chuva moderada',
  65: 'chuva forte',
  71: 'neve fraca',
  80: 'pancadas isoladas',
  81: 'pancadas moderadas',
  82: 'pancadas fortes',
  95: 'trovoada',
  96: 'trovoada com granizo',
  99: 'trovoada com granizo intenso',
};

/** Validade do cache de centrais. Sem TTL, mudança no banco só aparecia
 *  depois de reiniciar o processo. */
const CACHE_CENTRAIS_MS = 60_000;

export class OrquestradorAcoes {
  private cacheCentrais: Central[] | null = null;
  private cacheCentraisEm = 0;
  /** true quando a resposta veio do dataset semente, não do banco real. */
  private centraisDeDemonstracao = false;

  async executar(
    modulo: string,
    parametros: Record<string, unknown>,
  ): Promise<ResultadoAcao> {
    const inicio = Date.now();
    let texto: string;
    let capacidade: ResultadoAcao['capacidade'] = 'automacao';

    switch (modulo) {
      case 'clima':
        texto = await this.consultarClima();
        capacidade = 'percepcao';
        break;
      case 'banco':
        texto = await this.consultarCentrais(String(parametros.uf ?? 'GERAL'));
        capacidade = 'automacao';
        break;
      case 'busca_web':
        texto = await this.pesquisar(String(parametros.consulta ?? ''));
        capacidade = 'conhecimento';
        break;
      case 'agenda':
        texto = this.informarRelogio();
        capacidade = 'memoria';
        break;
      default:
        throw new Error(`Módulo de ação nativa não mapeado: ${modulo}`);
    }

    return { texto, capacidade, latencia_ms: Date.now() - inicio };
  }

  // -------------------------------------------------------------------------

  private async consultarClima(): Promise<string> {
    const lat = process.env.IARA_LATITUDE ?? '-15.6014';
    const lon = process.env.IARA_LONGITUDE ?? '-56.0979';
    const cidade = process.env.IARA_CIDADE ?? 'perímetro operacional';

    // Endpoint correto da API. `open-meteo.com` (sem o `api.`) devolve o site
    // institucional em HTML e quebra o JSON.parse — erro clássico.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code` +
      `&timezone=auto`;

    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const dados = (await resposta.json()) as {
        current?: {
          temperature_2m?: number;
          relative_humidity_2m?: number;
          precipitation?: number;
          weather_code?: number;
        };
      };
      const atual = dados.current;
      if (!atual || typeof atual.temperature_2m !== 'number') {
        throw new Error('payload sem leitura corrente');
      }

      const condicao = CODIGOS_TEMPO[atual.weather_code ?? -1] ?? 'condição não catalogada';
      const chuva = (atual.precipitation ?? 0) > 0
        ? ` Há ${atual.precipitation} mm de precipitação registrada na última hora.`
        : ' Sem precipitação registrada na última hora.';

      return (
        `Consultei os radares agora mesmo. Em ${cidade}: ${atual.temperature_2m} °C, ` +
        `${condicao}, umidade relativa em ${atual.relative_humidity_2m ?? '—'}%.${chuva}`
      );
    } catch (erro) {
      return (
        'Peço desculpas: meus barômetros externos não responderam ' +
        `(${(erro as Error).message}). Prefiro não estimar um número que não medi.`
      );
    }
  }

  // -------------------------------------------------------------------------

  /**
   * Camada de dados da infraestrutura.
   *
   * Supabase quando configurado, `dados/infraestrutura.json` caso contrário.
   * A decisão é do ambiente, não do código — e o roteador, o motor e a UI não
   * sabem qual das duas está em uso.
   */
  private async carregarCentrais(): Promise<Central[]> {
    if (this.cacheCentrais && Date.now() - this.cacheCentraisEm < CACHE_CENTRAIS_MS) {
      return this.cacheCentrais;
    }

    const bd = supabase();
    if (bd) {
      const { data, error } = await bd
        .from('centrais')
        .select('nome, uf, ativa, veiculos');
      if (error) throw new Error(`Supabase: ${error.message}`);
      // Tabela vazia é configuração incompleta, não resposta válida: cai para
      // o JSON em vez de afirmar que a operação tem zero centrais.
      if (data && data.length > 0) {
        this.cacheCentrais = data as Central[];
        this.cacheCentraisEm = Date.now();
        this.centraisDeDemonstracao = false;
        return this.cacheCentrais;
      }
    }

    const bruto = await readFile(path.join(RAIZ_DADOS, 'infraestrutura.json'), 'utf8');
    const dados = JSON.parse(bruto) as { centrais: Central[] };
    this.cacheCentrais = dados.centrais;
    this.cacheCentraisEm = Date.now();
    this.centraisDeDemonstracao = true;
    return this.cacheCentrais;
  }

  private async consultarCentrais(uf: string): Promise<string> {
    try {
      const centrais = await this.carregarCentrais();
      const filtradas = uf === 'GERAL' ? centrais : centrais.filter((c) => c.uf === uf);
      const ativas = filtradas.filter((c) => c.ativa);
      const veiculos = ativas.reduce((soma, c) => soma + c.veiculos, 0);

      if (filtradas.length === 0) {
        return `Não há central registrada para ${uf} na base de infraestrutura.`;
      }

      const escopo = uf === 'GERAL' ? 'em toda a operação' : `no território de ${uf}`;
      const inativas = filtradas.length - ativas.length;
      const nota = inativas > 0 ? ` ${inativas} está(ão) fora de operação.` : '';

      /**
       * HONESTIDADE SOBRE A FONTE. O dataset semente responde com a mesma
       * fluência do banco real — e número fictício dito com confiança é o
       * jeito mais rápido de perder a confiança do operador. Dado de
       * demonstração se declara como tal, sempre.
       */
      const origem = this.centraisDeDemonstracao
        ? ' (Atenção: estes são dados de demonstração do dataset semente — o banco real ainda não foi conectado.)'
        : '';

      return (
        `Verifiquei os registros de infraestrutura: ${ativas.length} central(is) ativa(s) ` +
        `${escopo}, somando ${veiculos} veículos vinculados.${nota}${origem}`
      );
    } catch (erro) {
      return `Não consegui ler a base de infraestrutura (${(erro as Error).message}).`;
    }
  }

  // -------------------------------------------------------------------------

  private async pesquisar(consulta: string): Promise<string> {
    try {
      const achados = await buscarNaWeb(consulta, 3);
      if (achados.length === 0) return 'A busca não retornou resultado utilizável.';
      const linhas = achados.map((r, i) => `${i + 1}. ${r.titulo} — ${r.resumo}`);
      return `Levantei o seguinte na web:\n${linhas.join('\n')}`;
    } catch (erro) {
      return `A busca externa falhou (${(erro as Error).message}).`;
    }
  }

  private informarRelogio(): string {
    const agora = new Date();
    const data = agora.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
    const hora = agora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return `São ${hora} de ${data}.`;
  }
}
