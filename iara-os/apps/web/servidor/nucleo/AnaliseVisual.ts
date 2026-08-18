/**
 * Análise visual — a IARA lê um screenshot que o operador anexou e aponta um
 * alvo (ou diz honestamente que não achou).
 *
 * CHAMADA DIRETA ao SDK da Anthropic, FORA da cadeia de `ProvedorRaciocinio`.
 * Aquele contrato é texto-only (`mensagem: string`) e compartilhado por
 * Anthropic/Groq/Gemini/Ollama, com uma ordem de fallback que acabou de ser
 * reordenada por custo (`FabricaRaciocinio.ts`, 18/08/2026). Estender o
 * contrato genérico para carregar imagem arriscaria instabilidade num código
 * em mudança, e obrigaria o Ollama local — sem visão — a ganhar um caminho de
 * erro novo. Esta é a primeira chamada de visão do sistema: existe ao lado do
 * contrato de raciocínio, não dentro dele. Ver ADR-1 em
 * `docs/prd/test-plan.md`.
 *
 * NÃO É UMA HABILIDADE DE CATÁLOGO. Nenhuma habilidade hoje chama a LLM —
 * quem raciocina é sempre `MotorRaciocinio`/`ClienteClaude`, direto do
 * Kernel. Isto seria a primeira exceção a esse padrão se entrasse como
 * habilidade; em vez disso é um módulo irmão de `ClienteClaude`, chamado pelo
 * Kernel do mesmo jeito. Ver ADR-2.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELO_NUVEM_PADRAO, lerConfig } from './kernel/Configuracao';
import type { Procedencia } from './kernel/Verdade';

export class VisaoIndisponivel extends Error {}

export interface AlvoVisual {
  readonly x: number;
  readonly y: number;
  readonly elemento: string;
}

export interface ResultadoAnaliseVisual {
  readonly texto: string;
  readonly alvo: AlvoVisual | null;
  readonly procedencia: Procedencia;
  readonly tokens_entrada: number;
  readonly tokens_saida: number;
}

const MEDIA_TYPES_SUPORTADOS = new Set(['image/png', 'image/jpeg', 'image/webp']);
type MediaTypeSuportado = 'image/png' | 'image/jpeg' | 'image/webp';

const MAX_TOKENS_RESPOSTA = 1024;

/** Clampa para [0,1] e arredonda em 3 casas — coordenada normalizada nunca
 *  sai do quadro da imagem, e três casas já é mais precisão do que um clique
 *  humano consegue mirar. */
function normalizar(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
}

/**
 * Extrai o primeiro bloco `{...}` do texto e valida os campos — mesma
 * disciplina defensiva de `MotorRaciocinio.interpretarPlano`: resposta que
 * não bate com o formato pedido vira "não encontrei", nunca uma exceção que
 * derruba o turno nem uma coordenada inventada para preencher o buraco.
 */
function interpretar(bruto: string): { texto: string; alvo: AlvoVisual | null; procedencia: Procedencia } {
  const inicio = bruto.indexOf('{');
  const fim = bruto.lastIndexOf('}');
  if (inicio < 0 || fim <= inicio) {
    return { texto: 'Não consegui interpretar a imagem agora.', alvo: null, procedencia: 'desconhecido' };
  }

  let obj: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(bruto.slice(inicio, fim + 1));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('forma errada');
    obj = v as Record<string, unknown>;
  } catch {
    return { texto: 'Não consegui interpretar a imagem agora.', alvo: null, procedencia: 'desconhecido' };
  }

  const explicacao = typeof obj.explicacao === 'string' ? obj.explicacao.trim() : '';
  const encontrou = obj.encontrou === true;
  const x = normalizar(obj.alvo_x);
  const y = normalizar(obj.alvo_y);
  const elemento = typeof obj.elemento === 'string' ? obj.elemento.trim().slice(0, 120) : '';

  if (!encontrou || x === null || y === null || !elemento) {
    return {
      texto: explicacao || 'Não encontrei, nesta imagem, o que você está procurando.',
      alvo: null,
      procedencia: 'desconhecido',
    };
  }

  return {
    texto: explicacao || `Encontrei: ${elemento}.`,
    alvo: { x, y, elemento },
    procedencia: 'inferencia',
  };
}

/**
 * Analisa `bytes` (a imagem) à luz de `duvida` (o que o operador perguntou).
 *
 * NUNCA lança por causa do CONTEÚDO da resposta — um JSON malformado ou uma
 * resposta que não aponta elemento nenhum vira `alvo: null, procedencia:
 * 'desconhecido'`, não uma falha de turno. Só lança por indisponibilidade
 * (`VisaoIndisponivel`) ou erro de rede/provedor — o Kernel já tem, no
 * `catch` do turno, o caminho que transforma isso em fala honesta ao
 * operador (`mensagemHumanaDeFalha`). Sem retentativa nesta versão: ADR-4 —
 * a chamada de texto normal já retenta `overloaded_error`; esta é uma
 * chamada única, e falhar com uma mensagem clara é preferível a inventar uma
 * segunda política de retentativa para uma capacidade nova.
 */
export async function analisarImagem(
  bytes: Buffer,
  mediaType: string,
  duvida: string,
  sinal: AbortSignal,
): Promise<ResultadoAnaliseVisual> {
  const chave = lerConfig('ANTHROPIC_API_KEY');
  if (!chave) {
    throw new VisaoIndisponivel('ANTHROPIC_API_KEY não configurada — a visão da IARA está desligada.');
  }
  if (!MEDIA_TYPES_SUPORTADOS.has(mediaType)) {
    throw new VisaoIndisponivel(`formato de imagem não suportado: ${mediaType}`);
  }

  const cliente = new Anthropic({ apiKey: chave });
  const modelo = lerConfig('IARA_MODELO') ?? MODELO_NUVEM_PADRAO;

  const pergunta = duvida.trim();
  const instrucao =
    `O operador anexou um screenshot da tela onde está trabalhando e perguntou:\n` +
    `"${pergunta || '(nada escrito — descreva o que vê e sugira o próximo passo óbvio)'}"\n\n` +
    `Responda APENAS com um objeto JSON, sem cerca de código e sem texto antes ou depois, neste formato:\n` +
    `{"encontrou": true ou false, "alvo_x": número entre 0.0 e 1.0, "alvo_y": número entre 0.0 e 1.0, ` +
    `"elemento": "nome curto do que a pessoa deve usar", "explicacao": "frase curta para o operador"}\n\n` +
    `"alvo_x" e "alvo_y" são a posição NORMALIZADA do CENTRO do elemento — 0.0 é a borda ` +
    `esquerda/superior da imagem, 1.0 é a borda direita/inferior. Nunca pixel absoluto.\n` +
    `Se a dúvida não corresponder a nenhum elemento visível nesta imagem, devolva "encontrou": false ` +
    `e explique em uma frase o que você vê em vez disso. NUNCA invente um botão, campo ou menu que não ` +
    `está visível — é preferível dizer que não encontrou.`;

  let resposta: Anthropic.Message;
  try {
    resposta = await cliente.messages.create(
      {
        model: modelo,
        max_tokens: MAX_TOKENS_RESPOSTA,
        system:
          'Você é a camada de visão da IARA, o escritório digital da Atos Log. Responda sempre em ' +
          'português. Seja literal sobre o que está visível na imagem.',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: mediaType as MediaTypeSuportado, data: bytes.toString('base64') },
              },
              { type: 'text', text: instrucao },
            ],
          },
        ],
      } as unknown as Parameters<Anthropic['messages']['create']>[0],
      { signal: sinal },
    ) as Anthropic.Message;
  } catch (erro) {
    if (sinal.aborted) throw erro;
    const mensagem = erro instanceof Error ? erro.message : String(erro);
    throw new VisaoIndisponivel(`provedor de visão recusou: ${mensagem}`);
  }

  const bloco = resposta.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  const { texto, alvo, procedencia } = interpretar(bloco?.text ?? '');

  return {
    texto,
    alvo,
    procedencia,
    tokens_entrada: resposta.usage.input_tokens ?? 0,
    tokens_saida: resposta.usage.output_tokens ?? 0,
  };
}
