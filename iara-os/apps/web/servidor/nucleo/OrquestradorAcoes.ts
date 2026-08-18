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
import { localDe, registrarCidade } from './LocalOperador';
import { instantePorExtenso } from './kernel/Quando';
import { contar } from './texto';

export interface ResultadoAcao {
  texto: string;
  capacidade: 'automacao' | 'percepcao' | 'conhecimento' | 'memoria';
  latencia_ms: number;
  /**
   * A ação chegou ao dado que foi pedir?
   *
   * Existia como `resolveu: true` fixo no chamador — inclusive no ramo em que a
   * fonte externa NÃO respondeu. Uma consulta de clima que falha na rede subia
   * ao Kernel carimbada como passo resolvido, e daí para `verificado`: a camada
   * inteira de `Verdade.ts` estava sendo alimentada com um booleano que ninguém
   * mediu. Quem sabe se a ação deu certo é quem a executou, e é aqui.
   */
  ok: boolean;
  /**
   * Nome do parâmetro que faltou para resolver — quando a própria resposta o
   * pede ao operador. Sobe até `ResultadoHabilidade.pendencia`; ver o contrato
   * lá. Só o ramo que PERGUNTA preenche isto: falha de rede não é pendência.
   */
  pendencia?: string;
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

/**
 * O que exatamente se está perguntando sobre o tempo. Não é enfeite: é a
 * diferença entre responder a pergunta e responder ao lado dela.
 */
export type Horizonte = 'agora' | 'hoje' | 'amanha';

export function horizonteValido(bruto: unknown): Horizonte {
  return bruto === 'hoje' || bruto === 'amanha' ? bruto : 'agora';
}

interface RespostaMeteo {
  current?: {
    temperature_2m?: number;
    relative_humidity_2m?: number;
    precipitation?: number;
    weather_code?: number;
  };
  daily?: {
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    precipitation_probability_max?: number[];
  };
}

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
    let saida: { texto: string; ok: boolean; pendencia?: string };
    let capacidade: ResultadoAcao['capacidade'] = 'automacao';

    switch (modulo) {
      case 'clima':
        saida = await this.consultarClima(
          horizonteValido(parametros.horizonte),
          String(parametros.id_usuario ?? ''),
          typeof parametros.cidade === 'string' && parametros.cidade.trim() ? parametros.cidade.trim() : undefined,
        );
        capacidade = 'percepcao';
        break;
      case 'banco':
        saida = await this.consultarCentrais(String(parametros.uf ?? 'GERAL'));
        capacidade = 'automacao';
        break;
      case 'busca_web':
        saida = await this.pesquisar(String(parametros.consulta ?? ''));
        capacidade = 'conhecimento';
        break;
      case 'agenda':
        saida = { texto: this.informarRelogio(), ok: true };
        capacidade = 'memoria';
        break;
      default:
        throw new Error(`Módulo de ação nativa não mapeado: ${modulo}`);
    }

    return { ...saida, capacidade, latencia_ms: Date.now() - inicio };
  }

  // -------------------------------------------------------------------------

  /**
   * Clima — e a PERGUNTA importa tanto quanto o lugar.
   *
   * O defeito que isto corrige: "vai chover hoje?" era respondido com a
   * condição corrente ("céu limpo, sem precipitação na última hora"). Não é
   * dado errado, é RESPOSTA A OUTRA PERGUNTA — e a pior espécie, porque soa
   * completa. Quem pergunta sobre a tarde recebe a medição do instante e
   * conclui, com toda a razão, que a IARA respondeu.
   *
   * A origem estava em `Percepcao`/`Planejador`: a âncora casava o TEMA
   * (chuva, clima, previsão) e a receita chamava a única consulta que existia,
   * a de agora. Tema não é pergunta. Agora o horizonte é parâmetro, e o mesmo
   * endpoint gratuito responde os dois — `current` para o instante, `daily`
   * para o dia.
   *
   * A frase "Consultei os radares agora mesmo" saiu junto. O Open-Meteo é
   * modelo numérico de previsão, não radar meteorológico; afirmar radar era
   * inventar um método que não foi usado, do mesmo tamanho de afirmar uma pasta
   * que não foi criada.
   */
  private async consultarClima(
    horizonte: Horizonte,
    idUsuario: string,
    cidadeMencionada?: string,
  ): Promise<{ texto: string; ok: boolean; pendencia?: string }> {
    /**
     * A CIDADE QUE O OPERADOR DISSE GANHA DE TUDO.
     *
     * Achado ao vivo (14/08/2026): "vai chover em Valinhos hoje?" executava a
     * habilidade de verdade (rota determinística, evento publicado) e ainda
     * assim devolvia "não sei sua localização" — o esquema da habilidade nem
     * tinha campo para cidade, e esta função só sabia ler geolocalização do
     * aparelho ou `IARA_LATITUDE`/`IARA_LONGITUDE`. Uma cidade dita em texto
     * não é dado de aparelho nem configuração do escritório — é o próprio
     * pedido, então não se aplica a decisão de privacidade "usar e descartar"
     * de `LocalOperador` (esse texto já está na conversa, que a IARA já
     * guarda). Falha de geocodificação aqui é honesta, não um chute: se o
     * nome não resolve, a resposta diz isso — nunca cai para Cuiabá/aparelho
     * em silêncio, porque o operador nomeou um lugar específico de propósito.
     */
    if (cidadeMencionada) {
      const geo = await this.geocodificarCidade(cidadeMencionada);
      if (!geo) {
        return {
          ok: false,
          texto:
            `Não encontrei "${cidadeMencionada}" no serviço de geocodificação. Confira o nome ` +
            '(cidade, ou "cidade, UF") e tente de novo.',
        };
      }
      return this.buscarPrevisao(horizonte, String(geo.lat), String(geo.lon), geo.nome, false);
    }
    /**
     * AS TRÊS VARIÁVEIS VIAJAM JUNTAS, e não ter padrão é a correção.
     *
     * Antes, coordenada sem declaração caía em Cuiabá (-15.6014, -56.0979) e o
     * NOME caía em "perímetro operacional". As duas quedas eram diferentes, e a
     * combinação produzia a pior resposta possível: a previsão de uma cidade
     * específica, entregue sob um rótulo genérico que escondia qual. Um deploy
     * feito de Valinhos recebia o tempo de Cuiabá sem nada na frase denunciando
     * a troca — e "provavelmente não chove hoje" estava simplesmente errado
     * para quem perguntou.
     *
     * Chutar a localização de alguém é da mesma família de afirmar uma pasta
     * que não foi criada: a resposta tem a forma de um fato e não é um.
     */
    /**
     * O APARELHO GANHA DA CONFIGURAÇÃO, quando existe.
     *
     * Uma coordenada fixa no servidor está errada para todo mundo que sai do
     * escritório — e com a IARA no celular esse é o caso comum. Quando a pessoa
     * concedeu a permissão do navegador, é de onde ELA está que a previsão sai.
     *
     * E o rótulo muda junto. Com a posição do aparelho a IARA diz "onde você
     * está", não o nome de uma cidade: `IARA_CIDADE` descreve o escritório, e
     * carimbar esse nome sobre a coordenada de quem está em outro lugar seria
     * repetir, ao contrário, exatamente o defeito que esta função acabou de
     * corrigir. Nomear a cidade certa exigiria geocodificação reversa — outro
     * terceiro recebendo a localização de um funcionário, o que contradiz a
     * decisão de "usar e descartar".
     */
    const doAparelho = idUsuario ? localDe(idUsuario) : null;
    const lat = doAparelho ? String(doAparelho.latitude) : process.env.IARA_LATITUDE?.trim();
    const lon = doAparelho ? String(doAparelho.longitude) : process.env.IARA_LONGITUDE?.trim();

    let cidade = process.env.IARA_CIDADE?.trim() || 'perímetro operacional';
    if (doAparelho) {
      /* O nome sai da coordenada por geocodificação reversa, memorizada por
         posição: uma consulta por lugar, não uma por pergunta. Falhou, fica
         `'onde você está'` — que é verdade, só menos útil. */
      const resolvida =
        doAparelho.cidade ??
        (await this.nomearLugar(doAparelho.latitude, doAparelho.longitude, idUsuario));
      cidade = resolvida || 'onde você está';
    }

    /**
     * SEM APARELHO, A FRASE PRECISA DIZER QUE É O ESCRITÓRIO — não só o nome.
     *
     * Achado ao vivo em auditoria (14/08/2026): sem posição do aparelho, a
     * resposta nomeava `IARA_CIDADE` (Cuiabá) com a MESMA frase de confiança
     * que teria com a posição real de quem perguntou. Uma operadora em
     * Valinhos recebeu "provavelmente não chove hoje em Cuiabá" sem nada na
     * frase dizendo que aquele "Cuiabá" era o escritório, não ela. É o mesmo
     * defeito que o comentário acima já resolveu para "nenhuma coordenada" —
     * reaberto aqui, no caminho que TEM coordenada de fallback.
     */
    const ehPadraoDoEscritorio = !doAparelho;

    if (!lat || !lon) {
      /**
       * A RECUSA VIROU PERGUNTA — e a pergunta arma a retomada.
       *
       * Achado ao vivo (14/08/2026, produção): esta resposta dizia só o que
       * faltava, e quando a operadora respondia "Valinhos" no turno seguinte,
       * a mensagem era tratada como pedido novo — não casava âncora nenhuma e
       * morria em conversa. A própria IARA chegou a orientar "manda a frase
       * inteira", conselho que na época nem funcionava. Agora `pendencia:
       * 'cidade'` sobe ao Kernel, que guarda a intenção por um turno: a
       * resposta curta seguinte vira o parâmetro e ESTA habilidade roda de
       * novo, pelo caminho normal.
       */
      return {
        ok: false,
        pendencia: 'cidade',
        // A frase serve DOIS leitores: a pergunta é para quem opera; o nome
        // das variáveis é para quem configura o servidor (há teste travando).
        texto:
          'Não sei de qual lugar responder: você não concedeu acesso à localização e este ' +
          'ambiente não tem coordenadas declaradas (IARA_LATITUDE e IARA_LONGITUDE). ' +
          'Me diga a cidade — pode ser só o nome, tipo "Valinhos" — que eu consulto na hora.',
      };
    }

    return this.buscarPrevisao(horizonte, lat, lon, cidade, ehPadraoDoEscritorio);
  }

  /**
   * Nome de cidade dito em texto livre → coordenada.
   *
   * Só chamado quando o OPERADOR nomeou o lugar na própria frase — mesmo
   * provedor da previsão (Open-Meteo), gratuito e sem chave, para não somar
   * uma segunda credencial só para resolver um nome. `count=1` porque a
   * habilidade só precisa do candidato mais provável — desambiguar entre duas
   * cidades homônimas não é o problema que esta função resolve.
   */
  private async geocodificarCidade(
    nome: string,
  ): Promise<{ lat: number; lon: number; nome: string } | null> {
    const url =
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(nome)}` +
      `&count=1&language=pt&format=json`;
    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(4000) });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const dados = (await resposta.json()) as {
        results?: Array<{
          name: string;
          latitude: number;
          longitude: number;
          admin1?: string;
          country_code?: string;
        }>;
      };
      const r = dados.results?.[0];
      if (!r) return null;
      const completo = r.admin1 && r.country_code === 'BR' ? `${r.name}, ${r.admin1}` : r.name;
      return { lat: r.latitude, lon: r.longitude, nome: completo };
    } catch {
      return null;
    }
  }

  /** A chamada de fato ao modelo numérico — compartilhada pelo caminho com
   *  cidade dita em texto e pelo caminho de aparelho/escritório. */
  private async buscarPrevisao(
    horizonte: Horizonte,
    lat: string,
    lon: string,
    cidade: string,
    ehPadraoDoEscritorio: boolean,
  ): Promise<{ texto: string; ok: boolean }> {
    // Endpoint correto da API. `open-meteo.com` (sem o `api.`) devolve o site
    // institucional em HTML e quebra o JSON.parse — erro clássico.
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max` +
      `&forecast_days=2&timezone=auto`;

    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const dados = (await resposta.json()) as RespostaMeteo;

      if (horizonte === 'agora') {
        return { texto: this.redigirAgora(dados, cidade, ehPadraoDoEscritorio), ok: true };
      }
      return { texto: this.redigirDia(dados, cidade, horizonte, ehPadraoDoEscritorio), ok: true };
    } catch (erro) {
      return {
        texto:
          'Não consegui falar com a estação meteorológica ' +
          `(${(erro as Error).message}). Prefiro não estimar um número que não medi.`,
        ok: false,
      };
    }
  }

  /**
   * Coordenada → nome do lugar.
   *
   * FEITO AQUI, NO SERVIDOR, e a escolha é de privacidade: se o navegador
   * consultasse, o serviço externo aprenderia a coordenada E o IP de casa da
   * pessoa. Daqui ele vê o IP do host e mais nada. Não é privacidade perfeita —
   * é um destinatário a menos sabendo de quem é a posição.
   *
   * BigDataCloud: gratuito, sem chave, e o único campo que interessa é o nome.
   * A resposta inteira é descartada; nada além do nome entra no sistema.
   *
   * FALHA É SILENCIOSA E BARATA. Sem nome, a IARA diz "onde você está" — o
   * clima continua certo, porque a previsão vem da COORDENADA, não do rótulo.
   * Um timeout curto existe por isso: a pergunta é sobre o tempo, e ninguém
   * espera três segundos a mais para ganhar um substantivo.
   */
  private async nomearLugar(lat: number, lon: number, idUsuario: string): Promise<string> {
    const url =
      'https://api.bigdatacloud.net/data/reverse-geocode-client' +
      `?latitude=${lat}&longitude=${lon}&localityLanguage=pt`;
    try {
      const resposta = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
      const dados = (await resposta.json()) as {
        city?: string;
        locality?: string;
        principalSubdivisionCode?: string;
      };
      /* `city` é o municipio; `locality` costuma ser o bairro e só serve quando
         o municipio vem vazio — o que acontece em area rural. */
      const nome = (dados.city || dados.locality || '').trim();
      if (!nome) throw new Error('resposta sem nome de lugar');

      /* "Valinhos, SP" e não só "Valinhos": existe Santana em quase todo
         estado, e a sigla custa tres caracteres. `principalSubdivisionCode`
         vem como "BR-SP". */
      const uf = (dados.principalSubdivisionCode ?? '').split('-')[1] ?? '';
      const completo = uf ? `${nome}, ${uf}` : nome;

      registrarCidade(idUsuario, lat, completo);
      return completo;
    } catch {
      // Memoriza o vazio: sem isto, cada pergunta sobre o tempo pagaria uma
      // tentativa nova contra um serviço que já se mostrou fora.
      registrarCidade(idUsuario, lat, '');
      return '';
    }
  }

  private redigirAgora(dados: RespostaMeteo, cidade: string, ehPadraoDoEscritorio: boolean): string {
    const atual = dados.current;
    if (!atual || typeof atual.temperature_2m !== 'number') {
      throw new Error('payload sem leitura corrente');
    }
    const condicao = CODIGOS_TEMPO[atual.weather_code ?? -1] ?? 'condição não catalogada';
    // "Sem precipitação registrada na última hora" é leitura de estação
    // meteorológica. A informação é a mesma; a frase é de gente.
    const chuva =
      (atual.precipitation ?? 0) > 0
        ? ` Choveu ${atual.precipitation} mm na última hora.`
        : ' Não choveu na última hora.';
    // Ver `ehPadraoDoEscritorio` em `consultarClima`: sem posição do aparelho,
    // a frase precisa dizer que a cidade é o padrão da empresa, não a de quem
    // perguntou — senão soa como localização confirmada.
    const aviso = ehPadraoDoEscritorio
      ? ` (padrão do escritório — ainda não sei onde você está)`
      : '';
    return (
      `Agora em ${cidade}${aviso}: ${atual.temperature_2m} °C, ${condicao}, ` +
      `umidade em ${atual.relative_humidity_2m ?? '—'}%.${chuva}`
    );
  }

  /**
   * A resposta começa pelo SIM OU NÃO, não pelos números.
   *
   * Quem pergunta "vai chover hoje?" quer decidir se leva guarda-chuva. A
   * probabilidade e os milímetros vêm depois, como sustentação — e o dia é
   * nomeado ("hoje", "amanhã") para nunca sobrar dúvida sobre qual foi lido.
   */
  private redigirDia(
    dados: RespostaMeteo,
    cidade: string,
    horizonte: Horizonte,
    ehPadraoDoEscritorio: boolean,
  ): string {
    const i = horizonte === 'amanha' ? 1 : 0;
    const d = dados.daily;
    const probabilidade = d?.precipitation_probability_max?.[i];
    const acumulado = d?.precipitation_sum?.[i];
    const maxima = d?.temperature_2m_max?.[i];
    const minima = d?.temperature_2m_min?.[i];
    if (typeof probabilidade !== 'number' && typeof acumulado !== 'number') {
      throw new Error(`payload sem previsão diária para ${horizonte}`);
    }

    const quando = horizonte === 'amanha' ? 'amanhã' : 'hoje';
    const p = probabilidade ?? 0;
    const veredito =
      p >= 70
        ? `Sim, a chuva é provável ${quando}`
        : p >= 35
          ? `Talvez — a chance de chuva ${quando} é intermediária`
          : `Provavelmente não chove ${quando}`;

    const condicao = CODIGOS_TEMPO[d?.weather_code?.[i] ?? -1];
    // Ver `ehPadraoDoEscritorio` em `consultarClima`.
    const aviso = ehPadraoDoEscritorio ? ' (padrão do escritório — ainda não sei onde você está)' : '';
    const partes = [
      `${veredito} em ${cidade}${aviso}: ${Math.round(p)}% de probabilidade`,
      typeof acumulado === 'number' ? `${acumulado} mm previstos` : '',
      condicao ? `céu ${condicao}` : '',
      typeof maxima === 'number' && typeof minima === 'number'
        ? `entre ${minima} °C e ${maxima} °C`
        : '',
    ].filter(Boolean);

    // A previsão se declara previsão. Modelo numérico não é medição, e o
    // operador precisa saber qual das duas está lendo.
    return `${partes.join(', ')}. É previsão de modelo numérico, não medição.`;
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

  private async consultarCentrais(uf: string): Promise<{ texto: string; ok: boolean }> {
    try {
      const centrais = await this.carregarCentrais();
      const filtradas = uf === 'GERAL' ? centrais : centrais.filter((c) => c.uf === uf);
      const ativas = filtradas.filter((c) => c.ativa);
      const veiculos = ativas.reduce((soma, c) => soma + c.veiculos, 0);

      if (filtradas.length === 0) {
        // Base lida, resposta honesta, pergunta NÃO resolvida: o operador
        // continua sem o número que pediu.
        return {
          texto: `Não há central registrada para ${uf} na base de infraestrutura.`,
          ok: false,
        };
      }

      const escopo = uf === 'GERAL' ? 'em toda a operação' : `no território de ${uf}`;
      const inativas = filtradas.length - ativas.length;
      const nota =
        inativas > 0 ? ` ${contar(inativas, 'está', 'estão')} fora de operação.` : '';

      /**
       * HONESTIDADE SOBRE A FONTE. O dataset semente responde com a mesma
       * fluência do banco real — e número fictício dito com confiança é o
       * jeito mais rápido de perder a confiança do operador. Dado de
       * demonstração se declara como tal, sempre.
       */
      const origem = this.centraisDeDemonstracao
        ? ' (Atenção: estes são dados de demonstração do dataset semente — o banco real ainda não foi conectado.)'
        : '';

      /**
       * A RESPOSTA COMEÇA PELO NÚMERO.
       *
       * "Verifiquei os registros de infraestrutura:" abria esta frase, e é
       * preâmbulo puro — anuncia o método antes de entregar o dado, numa
       * pergunta cuja resposta inteira cabe em quatro palavras. Quem pergunta
       * quantas centrais existem quer o número, não o relato da consulta.
       */
      return {
        texto:
          `${contar(ativas.length, 'central ativa', 'centrais ativas')} ${escopo}, ` +
          `somando ${contar(veiculos, 'veículo vinculado', 'veículos vinculados')}.` +
          `${nota}${origem}`,
        ok: true,
      };
    } catch (erro) {
      return {
        texto: `Não consegui ler a base de infraestrutura (${(erro as Error).message}).`,
        ok: false,
      };
    }
  }

  // -------------------------------------------------------------------------

  private async pesquisar(consulta: string): Promise<{ texto: string; ok: boolean }> {
    try {
      const achados = await buscarNaWeb(consulta, 3);
      if (achados.length === 0) {
        return { texto: 'Não achei nada utilizável sobre isso na web.', ok: false };
      }
      const linhas = achados.map((r, i) => `${i + 1}. ${r.titulo} — ${r.resumo}`);
      // "Da web" e não "Levantei o seguinte na web": a procedência precisa ficar
      // clara, o relato do esforço não.
      return { texto: `Da web:\n${linhas.join('\n')}`, ok: true };
    } catch (erro) {
      return { texto: `A busca na web falhou (${(erro as Error).message}).`, ok: false };
    }
  }

  /**
   * A HORA DO OPERADOR, NUNCA A DO SERVIDOR (operadora, 18/08/2026).
   *
   * Esta função respondeu "São 18:29 de terça-feira" quando eram 15:31 — três
   * horas exatas, o fuso do Brasil. Ela formatava com `toLocaleTimeString('pt-BR')`
   * sem `timeZone`, e o locale decide o FORMATO, nunca o fuso: sem ele vale o do
   * sistema, que é o Brasil na máquina de quem desenvolve e UTC no Railway. O
   * defeito era invisível em desenvolvimento por construção.
   *
   * O relógio do servidor estava certo o tempo todo — o carimbo ISO do jornal
   * conferia com o UTC real. Só a apresentação mentia, e é a pior forma de
   * mentir: bem formatada, em português, com o dia da semana correto.
   *
   * A formatação mora em `Quando.instantePorExtenso` para poder ser MEDIDA
   * contra um instante conhecido — ver `testes/hora-correta.test.ts`. Um relógio
   * que só lê `new Date()` por dentro não tem como ser testado, e foi essa
   * ausência que deixou o erro chegar à produção.
   */
  private informarRelogio(): string {
    return `São ${instantePorExtenso()}.`;
  }
}
