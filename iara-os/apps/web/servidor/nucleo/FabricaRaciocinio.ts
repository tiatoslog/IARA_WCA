/**
 * A FÁBRICA do provedor de raciocínio — o único lugar que decide qual cérebro
 * este processo usa. Contrato ← implementações ← fábrica: ela importa as duas
 * implementações, e nenhuma implementação importa a outra nem a fábrica.
 *
 * A regra do modo `auto`, e por que ela exige `OLLAMA_URL` declarada: nada
 * neste codebase auto-descobre infraestrutura (Supabase, Graph, WhatsApp —
 * tudo é variável explícita), e um motor que muda de cérebro porque um
 * processo alheio abriu a porta 11434 seria a antítese de "presença não é
 * validade". Bônus que decide sozinho: os testes adversariais que instanciam
 * o Kernel sem injeção continuam determinísticos em qualquer máquina —
 * inclusive numa que tenha um Ollama rodando.
 */

import {
  MODELO_NUVEM_PADRAO,
  configUtilizavel,
  lerConfig,
  type Ambiente,
} from './kernel/Configuracao';
import { CadeiaDeRaciocinio } from './CadeiaDeRaciocinio';
import { ClienteClaude } from './ClienteClaude';
import { ClienteCompativelOpenAI, GEMINI, GROQ, OPENROUTER } from './ClienteCompativelOpenAI';
import { ClienteOllama } from './ClienteOllama';
import type { OrigemRaciocinio, ProvedorRaciocinio } from './ProvedorRaciocinio';

/** O que `IARA_PROVEDOR` aceita. Valor fora da lista é tratado como `auto` —
 *  ausência de valor válido é ausência, o padrão da casa. */
type Escolha = 'anthropic' | 'ollama' | 'groq' | 'gemini' | 'openrouter' | 'auto';

function escolhaDeclarada(ambiente: Ambiente): Escolha {
  const bruto = (lerConfig('IARA_PROVEDOR', ambiente) ?? 'auto').toLowerCase();
  return bruto === 'anthropic' ||
    bruto === 'ollama' ||
    bruto === 'groq' ||
    bruto === 'gemini' ||
    bruto === 'openrouter'
    ? bruto
    : 'auto';
}

/**
 * Decide e instancia.
 *
 * `IARA_PROVEDOR` declarado força UM provedor, sem cadeia — quem declarou sabe
 * o que quer, e um teste que fixa o provedor não pode ganhar um segundo cérebro
 * por acidente.
 *
 * Em `auto`, monta a CADEIA com tudo que estiver declarado, nesta ordem:
 * Groq → Gemini → OpenRouter (as três gratuitas) → Anthropic (a melhor
 * qualidade, e a única que cobra) → Ollama (o local). Se o primeiro falhar por
 * cota, chave ou serviço fora, o próximo assume no MESMO turno — ver
 * `CadeiaDeRaciocinio` e o incidente de 15/08/2026 que a originou.
 *
 * OPENROUTER É TERCEIRO ENTRE OS GRATUITOS, e não primeiro: o padrão dele é um
 * Nemotron 3 Ultra, forte em planejamento mas servido em fila gratuita. Ordenar gratuito por
 * capacidade, e não por ordem de chegada, é o que faz a cadeia degradar suave
 * em vez de degradar por acidente de configuração.
 *
 * A ANTHROPIC DESCEU PARA TERCEIRA EM 18/08/2026, por decisão de custo: ela é a
 * única paga, e passa a ser último recurso antes do local. O que se compra com
 * isso é dinheiro; o que se paga é qualidade média das respostas, porque o
 * primeiro elo passa a ser o que responde quase sempre. A troca está declarada
 * aqui para não ser redescoberta como "a IARA piorou" daqui a um mês.
 *
 * OLLAMA CONTINUA POR ÚLTIMO, e não promovido junto com as gratuitas: ele é
 * local e sem custo, mas ~260 s por chamada nesta máquina. Colocá-lo antes da
 * Anthropic faria a IARA levar minutos sempre que as duas gratuitas falhassem —
 * trocar dinheiro por uma espera que o operador lê como travamento. Ele é a rede
 * de segurança de quando não há mais nada, não uma economia.
 *
 * Sem nada declarado, o resultado é um `ClienteClaude` indisponível: o modo
 * honesto de sempre, mensagens incluídas. Chave CONTAMINADA continua
 * levantando `ConfiguracaoInvalida` no construtor — a fábrica não engole o erro
 * que `conferirAmbiente` recusaria na subida.
 */
export function criarProvedorRaciocinio(ambiente: Ambiente = process.env): ProvedorRaciocinio {
  const escolha = escolhaDeclarada(ambiente);
  if (escolha === 'anthropic') return new ClienteClaude();
  if (escolha === 'ollama') return new ClienteOllama();
  if (escolha === 'groq') return new ClienteCompativelOpenAI(GROQ);
  if (escolha === 'gemini') return new ClienteCompativelOpenAI(GEMINI);
  if (escolha === 'openrouter') return new ClienteCompativelOpenAI(OPENROUTER);

  const elos: ProvedorRaciocinio[] = [];
  if (configUtilizavel(GROQ.variavelChave, ambiente)) {
    elos.push(new ClienteCompativelOpenAI(GROQ));
  }
  if (configUtilizavel(GEMINI.variavelChave, ambiente)) {
    elos.push(new ClienteCompativelOpenAI(GEMINI));
  }
  if (configUtilizavel(OPENROUTER.variavelChave, ambiente)) {
    elos.push(new ClienteCompativelOpenAI(OPENROUTER));
  }
  if (configUtilizavel('ANTHROPIC_API_KEY', ambiente)) elos.push(new ClienteClaude());
  if (configUtilizavel('OLLAMA_URL', ambiente)) elos.push(new ClienteOllama());

  if (elos.length === 0) return new ClienteClaude();
  if (elos.length === 1) return elos[0];
  return new CadeiaDeRaciocinio(elos);
}

/**
 * QUAIS CÉREBROS ESTE PROCESSO TEM, em ordem — para o `/saude`.
 *
 * Síncrona, barata e sem segredo: lê o ambiente, devolve apelidos. Nada de
 * instanciar cliente nem sondar rede, porque quem chama é o healthcheck do
 * host e um `/saude` lento vira um deploy marcado como doente.
 *
 * EXISTE POR CAUSA DE UM INCIDENTE (15/08/2026): a cota da Anthropic acabou, a
 * IARA ficou inútil, e o `/saude` continuou respondendo `ok: true` — porque
 * ele não conhecia a camada de raciocínio. É exatamente o argumento que o
 * comentário de `dispositivos` já fazia ali: um deploy sem mãos é
 * indistinguível de um saudável até alguém pedir alguma coisa. Sem cérebro,
 * idem.
 */
/**
 * A variável que torna cada escolha UTILIZÁVEL — a mesma que a cadeia consulta
 * logo abaixo. Existe para que "declarar um provedor" e "ter esse provedor" não
 * sejam a mesma afirmação.
 */
const VARIAVEL_DA_ESCOLHA: Record<Exclude<Escolha, 'auto'>, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  ollama: 'OLLAMA_URL',
  groq: GROQ.variavelChave,
  gemini: GEMINI.variavelChave,
  openrouter: OPENROUTER.variavelChave,
};

export function provedoresDeclarados(ambiente: Ambiente = process.env): string[] {
  const escolha = escolhaDeclarada(ambiente);
  /**
   * FORÇAR UM PROVEDOR NÃO O TORNA UTILIZÁVEL, e esta conferência custou uma
   * campanha inteira em 18/08/2026.
   *
   * Antes, a escolha declarada era ECOADA sem checagem: com `IARA_PROVEDOR=groq`
   * e nenhuma `GROQ_API_KEY` no ambiente, o banner de subida e o `/saude`
   * anunciavam `groq` enquanto o Kernel respondia, no mesmo processo, "a camada
   * de raciocínio está desligada". A campanha CO subiu com esse carimbo, mediu
   * doze segundos de recusa honesta, e o relatório teria chamado isso de
   * resultado da Groq.
   *
   * É O INCIDENTE DE 15/08 OUTRA VEZ — um diagnóstico verde sobre um processo
   * sem cérebro — reaberto no único caminho que ninguém checava: o do provedor
   * forçado. O comentário acima já dizia que divergir da cadeia faria "o
   * diagnóstico apontar um cérebro e a IARA usar outro"; o `if` que devolvia a
   * escolha crua era essa divergência, escrita duas linhas antes do aviso.
   *
   * A FÁBRICA CONTINUA INSTANCIANDO o provedor forçado mesmo sem chave, e isso é
   * de propósito: lá, o cliente indisponível é quem diz em voz alta que está
   * indisponível, com a mensagem certa. O que não pode é o RELATO afirmar que
   * existe cérebro. Devolver lista vazia aqui faz o banner imprimir "NENHUM
   * provedor declarado", que é a verdade.
   */
  if (escolha !== 'auto') {
    return configUtilizavel(VARIAVEL_DA_ESCOLHA[escolha], ambiente) ? [escolha] : [];
  }

  /* A MESMA ORDEM DA CADEIA, e não uma lista qualquer: quem lê `/saude` está
     lendo quem responde primeiro. Divergir daqui faria o diagnóstico apontar um
     cérebro e a IARA usar outro — e essa é a divergência que ninguém percebe até
     estar depurando a resposta errada. */
  const nomes: string[] = [];
  if (configUtilizavel(GROQ.variavelChave, ambiente)) nomes.push(GROQ.apelido);
  if (configUtilizavel(GEMINI.variavelChave, ambiente)) nomes.push(GEMINI.apelido);
  if (configUtilizavel(OPENROUTER.variavelChave, ambiente)) nomes.push(OPENROUTER.apelido);
  if (configUtilizavel('ANTHROPIC_API_KEY', ambiente)) nomes.push('anthropic');
  if (configUtilizavel('OLLAMA_URL', ambiente)) nomes.push('ollama');
  return nomes;
}

/** O retrato que o `diagnosticar` mostra — espelha a decisão da fábrica. */
export interface EstadoRaciocinio {
  origem: OrigemRaciocinio;
  modelo: string | null;
  /** Endereço do Ollama quando `origem === 'local'`; null nos demais. */
  url: string | null;
  /** Resultado de sonda ativa quando `origem === 'local'`; null nos demais. */
  alcancavel: boolean | null;
}

/**
 * Consulta para o autodiagnóstico. Sonda o Ollama DE VERDADE (prazo curto)
 * quando ele é o provedor decidido — um painel que confunde "configurado" com
 * "respondendo" manda quem investiga procurar no lugar errado.
 */
export async function estadoRaciocinio(ambiente: Ambiente = process.env): Promise<EstadoRaciocinio> {
  const escolha = escolhaDeclarada(ambiente);
  const chave = configUtilizavel('ANTHROPIC_API_KEY', ambiente);
  const ollamaDeclarado = configUtilizavel('OLLAMA_URL', ambiente);

  const usaNuvem = escolha === 'anthropic' || (escolha === 'auto' && chave);
  if (usaNuvem) {
    return {
      origem: 'nuvem',
      modelo: lerConfig('IARA_MODELO', ambiente) ?? MODELO_NUVEM_PADRAO,
      url: null,
      alcancavel: null,
    };
  }

  /* As camadas gratuitas são nuvem como qualquer outra — e o diagnóstico
     precisa nomear QUAL, senão quem investiga procura no provedor errado. */
  for (const perfil of [GROQ, GEMINI, OPENROUTER]) {
    if (escolha === perfil.apelido || (escolha === 'auto' && configUtilizavel(perfil.variavelChave, ambiente))) {
      return {
        origem: 'nuvem',
        modelo: `${perfil.apelido}: ${lerConfig(perfil.variavelModelo, ambiente) ?? perfil.modeloPadrao}`,
        url: null,
        alcancavel: null,
      };
    }
  }

  const usaOllama = escolha === 'ollama' || ollamaDeclarado;
  if (usaOllama) {
    const cliente = new ClienteOllama();
    const alcancavel = await cliente.sondar();
    return {
      origem: 'local',
      modelo: cliente.modelo,
      url: lerConfig('OLLAMA_URL', ambiente) ?? 'http://127.0.0.1:11434',
      alcancavel,
    };
  }

  return { origem: 'nenhuma', modelo: null, url: null, alcancavel: null };
}
