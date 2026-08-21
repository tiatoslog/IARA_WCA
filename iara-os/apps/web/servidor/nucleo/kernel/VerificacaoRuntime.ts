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

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { lerConfig } from './Configuracao';
import {
  NAO_SEI_CONFERIR,
  type ContextoDaTarefa,
  type PortaVerificacaoRuntime,
  type ResultadoVerificacao,
} from '../../../lib/verificacao/contrato';
import {
  conferirContagem,
  conferirExecucaoNoTurno,
  conferirHoraDeParede,
  conferirSemFonte,
} from '../../../lib/verificacao/oraculos';


/** `<app>/` — quatro níveis acima deste arquivo (`servidor/nucleo/kernel/`). */
export const RAIZ_DO_APP = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);

/**
 * COMO O OPERADOR CHAMA CADA FONTE — e é isto que faltava.
 *
 * A primeira versão casava o NOME da integração contra a pergunta, e o defeito
 * apareceu na revisão de fechamento: ninguém pergunta "quantas cargas na LUFT?".
 * Pergunta-se **"quantas cargas existem na base 2026?"**. Com o nome da
 * integração como única chave, o caso exato que originou toda esta fatia — a
 * IARA respondendo "temos 1234 cargas cadastradas" com Graph e Supabase
 * zerados — não era reconhecido, e a verificação nunca dispararia nele.
 *
 * Os apelidos são o vocabulário de quem pergunta, não o de quem integra.
 */
interface FonteDeVerdade {
  readonly nome: string;
  readonly apelidos: RegExp;
  readonly desligada: (vazia: (n: string) => boolean) => boolean;
}

const FONTES: readonly FonteDeVerdade[] = [
  {
    nome: 'LUFT',
    /* O que a operação LUFT responde: cargas, quem as levou, por onde, e
       quanto renderam. Se a planilha está fora, nenhum desses números existe. */
    apelidos: /\b(luft|cargas?|motoristas?|fretes?|faturamento|rotas?)\b/i,
    desligada: (vazia) =>
      vazia('MS_GRAPH_OCI_URL') || (vazia('MS_GRAPH_TOKEN') && vazia('MS_GRAPH_CLIENT_SECRET')),
  },
  {
    nome: 'Supabase',
    apelidos: /\b(supabase|banco|base de dados|hist[óo]rico de incidentes)\b/i,
    desligada: (vazia) => vazia('SUPABASE_URL') || vazia('SUPABASE_SERVICE_ROLE_KEY'),
  },
];

/**
 * QUAIS FONTES ESTÃO DESLIGADAS AGORA — lido do ambiente, não de um catálogo.
 *
 * A pergunta é estreita: existe credencial para esta integração? É a mesma
 * conferência que a IARA já faz para dizer "falta MS_GRAPH_TOKEN". Aqui ela
 * serve para o verificador saber que QUALQUER número afirmado sobre essa fonte
 * é invenção — sem precisar saber qual seria o número certo.
 */
export function fontesDesligadas(ambiente: NodeJS.ProcessEnv = process.env): string[] {
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
  return FONTES.filter((f) => f.desligada(vazia)).map((f) => f.nome);
}

/** A fonte desligada que esta pergunta invoca, se houver. */
function fonteInvocada(pergunta: string, ausentes: readonly string[]): FonteDeVerdade | null {
  return (
    FONTES.find((f) => ausentes.includes(f.nome) && f.apelidos.test(pergunta)) ?? null
  );
}

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

/**
 * PERGUNTA DE CARDINALIDADE SOBRE A OPERAÇÃO — "quantos motoristas", "quantas
 * cargas", "quantas rotas diferentes".
 *
 * Existe para o oráculo de EVIDÊNCIA DO TURNO, que não confere o valor: confere
 * se o valor teve de onde vir. Por isso a lista de substantivos é a das
 * entidades que TÊM operação determinística — perguntar deles e responder sem
 * executar nada é o defeito de 19/08/2026, quando a IARA repetiu "75
 * motoristas" do próprio histórico.
 *
 * `centrais` fica de fora de propósito: tem oráculo próprio, que sabe a
 * resposta certa, e um oráculo que sabe o valor vale mais que um que só sabe a
 * procedência.
 */
const PERGUNTA_DE_CARDINALIDADE =
  /\b(quantos?|quantas?|n[úu]mero de|total de|quantidade de)\b[^?]{0,40}\b(motoristas?|cargas?|rotas?|destinos?|origens?|clientes?)\b/i;

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
    /* O relógio não depende de arquivo nenhum: a fonte é aritmética. */
    if (PERGUNTA_DE_HORA.test(pergunta)) return true;
    /**
     * A FONTE PRECISA EXISTIR PARA A PERGUNTA CONTAR COMO RECONHECIDA.
     *
     * Sem esta conferência, uma base ilegível fazia `reconhece` devolver `true`,
     * a fala ficava retida, e `verificar` devolvia `inconclusivo` — o operador
     * perdia a digitação ao vivo em troca de nada. Reconhecer é uma promessa de
     * que existe veredito a dar, não um palpite sobre o assunto da frase.
     */
    if (PERGUNTA_DE_CENTRAIS.test(pergunta)) {
      return existsSync(path.join(this.opcoes.raiz, 'dados', 'infraestrutura.json'));
    }
    /**
     * CARDINALIDADE NÃO ENTRA AQUI — e a razão é o E23.
     *
     * A tentação era reconhecer toda pergunta de "quantos X" para poder cobrar
     * procedência. Mas `reconhece` arma a trava da fala e custa a digitação ao
     * vivo do turno INTEIRO, inclusive nos turnos que funcionam — e a imensa
     * maioria funciona. Punir o caminho bom para pegar o ruim é caro demais.
     *
     * A procedência é cobrada noutro lugar, e num lugar melhor: o Kernel já
     * sabe, ANTES de gerar, se algum passo alcançou o mundo. Cobrar ali retém a
     * fala só nos turnos de fato suspeitos — ver a trava de cardinalidade em
     * `Kernel.ts`. O oráculo `conferirExecucaoNoTurno` continua ligado em
     * `verificar` para os turnos que chegarem aqui por outro motivo.
     */
    return fonteInvocada(pergunta, this.opcoes.fontesAusentes?.() ?? []) !== null;
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
    /**
     * EVIDÊNCIA DO TURNO — vem antes da fonte-desligada porque é mais preciso:
     * "não executou nada" é um fato do turno, enquanto "a fonte está fora" é uma
     * inferência sobre o ambiente. Quando os dois valem, o primeiro diz mais.
     */
    if (PERGUNTA_DE_CARDINALIDADE.test(pergunta)) {
      const veredito = conferirExecucaoNoTurno(
        resposta,
        contexto.operacoes_do_turno,
        'a operação',
      );
      /* `inconclusivo` aqui significa "o turno executou algo" ou "não sei quais
         operações rodaram" — nos dois casos a palavra final é de quem sabe o
         valor, e a cadeia segue para os oráculos de baixo. */
      if (veredito.status !== 'inconclusivo') return veredito;
    }

    const fonte = fonteInvocada(pergunta, this.opcoes.fontesAusentes?.() ?? []);
    if (fonte) {
      /* O ano citado no pedido é ecoado na recusa ("a base 2026 está
         desligada") e não é alegação de dado. */
      const anos = [...pergunta.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0]));
      return conferirSemFonte(resposta, fonte.nome, anos);
    }

    return NAO_SEI_CONFERIR('nenhum oráculo determinístico reconhece esta pergunta');
  }
}
