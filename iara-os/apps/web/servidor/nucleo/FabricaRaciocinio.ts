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

import { configUtilizavel, lerConfig, type Ambiente } from './kernel/Configuracao';
import { ClienteClaude } from './ClienteClaude';
import { ClienteOllama } from './ClienteOllama';
import type { OrigemRaciocinio, ProvedorRaciocinio } from './ProvedorRaciocinio';

/** O que `IARA_PROVEDOR` aceita. Valor fora do trio é tratado como `auto` —
 *  ausência de valor válido é ausência, o padrão da casa. */
type Escolha = 'anthropic' | 'ollama' | 'auto';

function escolhaDeclarada(ambiente: Ambiente): Escolha {
  const bruto = (lerConfig('IARA_PROVEDOR', ambiente) ?? 'auto').toLowerCase();
  return bruto === 'anthropic' || bruto === 'ollama' ? bruto : 'auto';
}

/**
 * Decide e instancia. Em `auto`: chave Anthropic utilizável vence; senão um
 * `OLLAMA_URL` declarado; senão um `ClienteClaude` indisponível — que é
 * exatamente o modo honesto de sempre, mensagens incluídas. Chave CONTAMINADA
 * sem Ollama declarado continua levantando `ConfiguracaoInvalida` no
 * construtor do `ClienteClaude`, como hoje — a fábrica não engole o erro que
 * `conferirAmbiente` recusaria na subida.
 */
export function criarProvedorRaciocinio(ambiente: Ambiente = process.env): ProvedorRaciocinio {
  const escolha = escolhaDeclarada(ambiente);
  if (escolha === 'anthropic') return new ClienteClaude();
  if (escolha === 'ollama') return new ClienteOllama();

  if (configUtilizavel('ANTHROPIC_API_KEY', ambiente)) return new ClienteClaude();
  if (configUtilizavel('OLLAMA_URL', ambiente)) return new ClienteOllama();
  return new ClienteClaude();
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
      modelo: lerConfig('IARA_MODELO', ambiente) ?? 'claude-opus-5',
      url: null,
      alcancavel: null,
    };
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
