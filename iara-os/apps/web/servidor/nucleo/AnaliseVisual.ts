/**
 * Análise visual — a IARA lê um screenshot que o operador anexou e aponta um
 * alvo (ou diz honestamente que não achou).
 *
 * CADEIA PRÓPRIA, FORA da cadeia de `ProvedorRaciocinio`. Aquele contrato é
 * texto-only (`mensagem: string`) e compartilhado por Anthropic/Groq/Gemini/
 * Ollama — estender o contrato genérico para carregar imagem arriscaria
 * instabilidade num código que muda com frequência (a ordem de fallback foi
 * reordenada por custo em 18/08/2026, `FabricaRaciocinio.ts`), e obrigaria o
 * Ollama local — sem visão — a ganhar um caminho de erro novo. Ver ADR-1 em
 * `docs/prd/test-plan.md`.
 *
 * MESMO ASSIM, GRATUITAS PRIMEIRO — a pedido da operadora (18/08/2026), esta
 * cadeia segue o MESMO princípio de custo que `FabricaRaciocinio` já aplica
 * ao texto: Groq → Gemini → Anthropic. Groq e Gemini entram com modelo de
 * visão PRÓPRIO — nem o Groq nem o Gemini enxergam imagem com o modelo de
 * TEXTO configurado para o resto da IARA (`GROQ_MODELO` aponta para o
 * `openai/gpt-oss-120b`, que não tem visão). `GROQ_MODELO_VISAO` existe
 * separado por isso; o Gemini reaproveita `GEMINI_MODELO` porque a família
 * Flash já é multimodal nativa — não há um segundo modelo de texto-só lá.
 *
 * NÃO É UMA HABILIDADE DE CATÁLOGO. Nenhuma habilidade hoje chama a LLM —
 * quem raciocina é sempre `MotorRaciocinio`/`ClienteClaude`, direto do
 * Kernel. Isto seria a primeira exceção a esse padrão se entrasse como
 * habilidade; em vez disso é um módulo irmão de `ClienteClaude`, chamado pelo
 * Kernel do mesmo jeito. Ver ADR-2.
 */

import Anthropic from '@anthropic-ai/sdk';
import { MODELO_NUVEM_PADRAO, lerConfig } from './kernel/Configuracao';
import { GEMINI, GROQ } from './ClienteCompativelOpenAI';
import type { Procedencia } from './kernel/Verdade';
/* O vocabulário da conferência mora no domínio (`lib/`), não aqui: quem guarda
   a situação é `ProcedimentosEmCurso`, que é ESTADO INTERNO e não pode alcançar
   — nem por tipo — um módulo que fala com a rede. Ver `Fronteira.ts`. */
import type { ParadaEsperada, SituacaoNaParada } from '../../lib/procedimento';

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
  /**
   * `null` quando a chamada NÃO foi situada — ninguém perguntou, e um palpite
   * sobre pergunta não feita é pior que a ausência da resposta.
   */
  readonly situacao: SituacaoNaParada | null;
  readonly tokens_entrada: number;
  readonly tokens_saida: number;
  /** Quem respondeu de fato — `groq`, `gemini` ou `anthropic`. A mesma lição
   *  de `ProvedorRaciocinio.ts`: dois provedores indistinguíveis na telemetria
   *  já custaram caro uma vez (16/08/2026) para não repetir aqui. */
  readonly provedor: string;
}

const MEDIA_TYPES_SUPORTADOS = new Set(['image/png', 'image/jpeg', 'image/webp']);
type MediaTypeSuportado = 'image/png' | 'image/jpeg' | 'image/webp';

const MAX_TOKENS_RESPOSTA = 1024;

/**
 * TETO MAIOR para Groq/Gemini — achado em depuração real (18/08/2026): o
 * Qwen3.6 da Groq é um modelo de RACIOCÍNIO (pensa antes de responder), e
 * `1024` cortava a resposta NO MEIO do raciocínio, antes do JSON pedido
 * sequer começar a sair — a análise inteira virava "não consegui
 * interpretar" mesmo com uma resposta válida a caminho. A Anthropic não
 * ativa `thinking` nesta chamada (nunca pede raciocínio visível), então
 * continua com o teto menor.
 */
const MAX_TOKENS_RESPOSTA_ABERTA = 4096;

const INSTRUCAO_SISTEMA =
  'Você é a camada de visão da IARA, o escritório digital da Atos Log. Responda sempre em ' +
  'português. Seja literal sobre o que está visível na imagem.';

/**
 * O BLOCO QUE SITUA A LEITURA — presente só quando há procedimento em curso.
 *
 * A REGRA QUE ELE CARREGA, e é a razão de o texto ser tão insistente: a visão
 * responde ONDE A PESSOA ESTÁ; o POP responde O QUE FAZER. Um modelo de visão
 * a quem se mostra um procedimento tende naturalmente a continuar o
 * procedimento — e aí a orientação passa a vir da leitura de uma imagem em vez
 * do documento aprovado, sem que ninguém na conversa perceba a troca.
 *
 * Por isso o pedido é explicitamente NEGATIVO em duas frentes: não corrigir o
 * procedimento e não inventar o próximo passo. O que a IARA vai dizer ao
 * operador sobre o que fazer sai do POP, verbatim, montado em
 * `ConferenciaDeTela.ts` — nada do que voltar daqui entra naquele lugar.
 */
function blocoDaParada(parada: ParadaEsperada): string {
  const marcas = parada.marcas.length > 0 ? parada.marcas.join(', ') : '(nenhuma)';
  return (
    `\nCONTEXTO — esta pessoa está no meio de um procedimento oficial, na parada ` +
    `${parada.posicao} de "${parada.titulo}" (etapa: ${parada.etapa}).\n` +
    `O procedimento manda, NESTA parada, exatamente isto (texto do documento, não reescreva):\n` +
    `"""\n${parada.instrucao}\n"""\n` +
    `O documento marca nesta tela os pontos: ${marcas}.\n\n` +
    `SUA ÚNICA TAREFA A MAIS é dizer se o screenshot anexado é a tela dessa parada. ` +
    `Acrescente ao JSON o campo "situacao" com um destes valores:\n` +
    `  "na_etapa"   — o screenshot é a tela que essa parada descreve\n` +
    `  "outra_tela" — é claramente outra tela do sistema\n` +
    `  "indefinido" — você não consegue afirmar\n` +
    `Na dúvida, "indefinido". Dizer que a pessoa está no lugar errado quando você ` +
    `apenas não conseguiu ler a tela é pior que não responder.\n` +
    `NÃO corrija o procedimento, NÃO diga qual é o próximo passo e NÃO acrescente ` +
    `instrução que não esteja no texto acima — quem orienta é o documento, não você.\n`
  );
}

function instrucaoDoPedido(duvida: string, parada?: ParadaEsperada): string {
  const pergunta = duvida.trim();
  return (
    `O operador anexou um screenshot da tela onde está trabalhando e perguntou:\n` +
    `"${pergunta || '(nada escrito — descreva o que vê e sugira o próximo passo óbvio)'}"\n` +
    (parada ? blocoDaParada(parada) : '') +
    `\nResponda APENAS com um objeto JSON, sem cerca de código e sem texto antes ou depois, neste formato:\n` +
    `{"encontrou": true ou false, "alvo_x": número entre 0.0 e 1.0, "alvo_y": número entre 0.0 e 1.0, ` +
    `"elemento": "nome curto do que a pessoa deve usar", "explicacao": "frase curta para o operador"` +
    (parada ? `, "situacao": "na_etapa" | "outra_tela" | "indefinido"` : '') +
    `}\n\n` +
    `"alvo_x" e "alvo_y" são a posição NORMALIZADA do CENTRO do elemento — 0.0 é a borda ` +
    `esquerda/superior da imagem, 1.0 é a borda direita/inferior. Nunca pixel absoluto.\n` +
    `Se a dúvida não corresponder a nenhum elemento visível nesta imagem, devolva "encontrou": false ` +
    `e explique em uma frase o que você vê em vez disso. NUNCA invente um botão, campo ou menu que não ` +
    `está visível — é preferível dizer que não encontrou.\n` +
    `Se você raciocinar antes de responder, seja BREVE — a resposta final em JSON precisa caber no ` +
    `orçamento de tokens da chamada.`
  );
}

/** Clampa para [0,1] e arredonda em 3 casas — coordenada normalizada nunca
 *  sai do quadro da imagem, e três casas já é mais precisão do que um clique
 *  humano consegue mirar. */
function normalizar(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
}

/**
 * Acha TODOS os blocos `{...}` de nível superior no texto e devolve o
 * ÚLTIMO que parseia como objeto com a chave `encontrou` — nunca só
 * "primeiro `{` ao último `}`".
 *
 * Achado em depuração real (18/08/2026): modelos de raciocínio (Qwen3.6 na
 * Groq, por exemplo) às vezes pensam em prosa ANTES do JSON pedido, e essa
 * prosa pode conter chaves soltas (`{`, `}` de código citado, por exemplo).
 * "do primeiro `{` ao último `}`" pegava um trecho que misturava a prosa com
 * o JSON de verdade e o `JSON.parse` explodia — a análise inteira virava
 * "não consegui interpretar" mesmo com uma resposta válida lá dentro. Varrer
 * por profundidade de chave e tentar cada bloco top-level (do ÚLTIMO para o
 * primeiro, porque o padrão pedido é "responda só com o JSON", e quando o
 * modelo desobedece o formato ainda tende a pôr a resposta final por
 * último) resolve sem impor formato de saída mais rígido a três provedores
 * diferentes.
 */
function extrairObjeto(bruto: string): Record<string, unknown> | null {
  const blocos: string[] = [];
  let profundidade = 0;
  let inicio = -1;
  for (let i = 0; i < bruto.length; i += 1) {
    if (bruto[i] === '{') {
      if (profundidade === 0) inicio = i;
      profundidade += 1;
    } else if (bruto[i] === '}') {
      if (profundidade > 0) {
        profundidade -= 1;
        if (profundidade === 0 && inicio >= 0) blocos.push(bruto.slice(inicio, i + 1));
      }
    }
  }

  for (let i = blocos.length - 1; i >= 0; i -= 1) {
    try {
      const v: unknown = JSON.parse(blocos[i]);
      if (typeof v === 'object' && v !== null && !Array.isArray(v) && 'encontrou' in v) {
        return v as Record<string, unknown>;
      }
    } catch {
      // Bloco não era JSON válido (chave solta em prosa) — tenta o anterior.
    }
  }
  return null;
}

/**
 * Valida os campos do objeto que `extrairObjeto` achou — mesma disciplina
 * defensiva de `MotorRaciocinio.interpretarPlano`: resposta que não bate com
 * o formato pedido vira "não encontrei", nunca uma exceção que derruba o
 * turno nem uma coordenada inventada para preencher o buraco.
 *
 * COMUM AOS TRÊS PROVEDORES de propósito: o formato pedido no prompt é o
 * mesmo para Groq, Gemini e Anthropic — só a chamada HTTP muda por baixo.
 * Duas regras de interpretação para o mesmo contrato é o erro que
 * `Verdade.ts` já nomeia como doença conhecida deste repositório.
 */
/**
 * A situação, só quando ela foi PEDIDA e veio num dos três valores.
 *
 * Sem `situada`, um modelo que devolvesse `"situacao"` por conta própria numa
 * chamada não situada faria a IARA falar de uma parada que não existe. Valor
 * fora da lista vira `indefinido`, nunca o mais provável: adivinhar aqui é
 * afirmar sobre a tela de alguém.
 */
function lerSituacao(obj: Record<string, unknown>, situada: boolean): SituacaoNaParada | null {
  if (!situada) return null;
  const bruto = typeof obj.situacao === 'string' ? obj.situacao.trim() : '';
  return bruto === 'na_etapa' || bruto === 'outra_tela' ? bruto : 'indefinido';
}

/* Exportada para o teste: é aqui que mora a regra de nunca adivinhar a
   situação, e provar isso pela chamada de rede exigiria um provedor de visão
   ligado — o teste passaria a depender de chave e de acerto do modelo. */
export function interpretar(
  bruto: string,
  situada: boolean,
): { texto: string; alvo: AlvoVisual | null; procedencia: Procedencia; situacao: SituacaoNaParada | null } {
  const obj = extrairObjeto(bruto);
  if (!obj) {
    return {
      texto: 'Não consegui interpretar a imagem agora.',
      alvo: null,
      procedencia: 'desconhecido',
      // Não interpretou a resposta é não ter olhado — nunca "está na etapa".
      situacao: situada ? 'indefinido' : null,
    };
  }

  const explicacao = typeof obj.explicacao === 'string' ? obj.explicacao.trim() : '';
  const encontrou = obj.encontrou === true;
  const x = normalizar(obj.alvo_x);
  const y = normalizar(obj.alvo_y);
  const elemento = typeof obj.elemento === 'string' ? obj.elemento.trim().slice(0, 120) : '';

  /* A situação é lida ANTES do `encontrou`, e independe dele: "não achei o botão
     que você procura" e "esta não é a tela da etapa 3" são dois fatos separados,
     e o segundo continua útil quando o primeiro falha. */
  const situacao = lerSituacao(obj, situada);

  if (!encontrou || x === null || y === null || !elemento) {
    return {
      texto: explicacao || 'Não encontrei, nesta imagem, o que você está procurando.',
      alvo: null,
      procedencia: 'desconhecido',
      situacao,
    };
  }

  return {
    texto: explicacao || `Encontrei: ${elemento}.`,
    alvo: { x, y, elemento },
    procedencia: 'inferencia',
    situacao,
  };
}

interface RespostaBruta {
  readonly texto: string;
  readonly tokens_entrada: number;
  readonly tokens_saida: number;
}

/**
 * Groq e Gemini falam o MESMO dialeto de visão — `image_url` com data URI em
 * base64, no formato `/chat/completions` da OpenAI — pela mesma razão que
 * `ClienteCompativelOpenAI` já é um cliente só para os dois no caminho de
 * texto: escrever duas chamadas quase iguais seria duas verdades para manter
 * em concordância. SEM STREAMING aqui (ADR-4 do test-plan: uma chamada única,
 * sem picotar) — só o resultado final importa.
 */
async function chamarVisaoOpenAICompat(
  base: string,
  chave: string,
  modelo: string,
  bytes: Buffer,
  mediaType: string,
  instrucao: string,
  sinal: AbortSignal,
): Promise<RespostaBruta> {
  const resposta = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
    body: JSON.stringify({
      model: modelo,
      stream: false,
      max_tokens: MAX_TOKENS_RESPOSTA_ABERTA,
      messages: [
        { role: 'system', content: INSTRUCAO_SISTEMA },
        {
          role: 'user',
          content: [
            { type: 'text', text: instrucao },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${bytes.toString('base64')}` } },
          ],
        },
      ],
    }),
    signal: sinal,
  });

  if (!resposta.ok) {
    const corpo = await resposta.text().catch(() => '');
    throw new Error(`respondeu ${resposta.status}: ${corpo.slice(0, 300)}`);
  }

  const corpo = (await resposta.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
  };
  const texto = corpo.choices?.[0]?.message?.content;
  return {
    texto: typeof texto === 'string' ? texto : '',
    tokens_entrada: typeof corpo.usage?.prompt_tokens === 'number' ? corpo.usage.prompt_tokens : 0,
    tokens_saida: typeof corpo.usage?.completion_tokens === 'number' ? corpo.usage.completion_tokens : 0,
  };
}

async function chamarVisaoAnthropic(
  chave: string,
  modelo: string,
  bytes: Buffer,
  mediaType: string,
  instrucao: string,
  sinal: AbortSignal,
): Promise<RespostaBruta> {
  const cliente = new Anthropic({ apiKey: chave });
  const resposta = (await cliente.messages.create(
    {
      model: modelo,
      max_tokens: MAX_TOKENS_RESPOSTA,
      system: INSTRUCAO_SISTEMA,
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
  )) as Anthropic.Message;

  const bloco = resposta.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return {
    texto: bloco?.text ?? '',
    tokens_entrada: resposta.usage.input_tokens ?? 0,
    tokens_saida: resposta.usage.output_tokens ?? 0,
  };
}

interface EloDeVisao {
  readonly apelido: string;
  chamar(bytes: Buffer, mediaType: string, instrucao: string, sinal: AbortSignal): Promise<RespostaBruta>;
}

/**
 * A CADEIA, na mesma ordem de custo que `FabricaRaciocinio` usa para texto:
 * Groq → Gemini → Anthropic. Só entra quem tem chave declarada — mesma regra
 * de "infraestrutura declarada, nunca descoberta" do resto do sistema.
 *
 * `GROQ_MODELO_VISAO` tem um padrão, e ele já mudou uma vez no mesmo dia:
 * a primeira aposta (Llama 4 Scout, documentada em blogs e no cookbook da
 * Groq) devolveu 404 `model_not_found` contra a chave real — o catálogo
 * vivo em 18/08/2026 (`GET /v1/models`) nem lista mais modelo Llama de
 * visão. `qwen/qwen3.6-27b` é o que a própria documentação de visão da Groq
 * (`console.groq.com/docs/vision`) cita hoje, e é o que está de fato
 * disponível na conta — confirmado por chamada real, não por busca. Mesmo
 * assim continua sendo uma aposta sobre um catálogo que muda (a mesma lição
 * que `GEMINI_MODELO` já registra); se o padrão parar de existir, o elo
 * simplesmente falha e a cadeia cai para o próximo — nunca trava a análise
 * inteira.
 */
function montarCadeia(): EloDeVisao[] {
  const elos: EloDeVisao[] = [];

  const chaveGroq = lerConfig(GROQ.variavelChave);
  if (chaveGroq) {
    const modelo = lerConfig('GROQ_MODELO_VISAO') ?? 'qwen/qwen3.6-27b';
    elos.push({
      apelido: GROQ.apelido,
      chamar: (bytes, mediaType, instrucao, sinal) =>
        chamarVisaoOpenAICompat(GROQ.base, chaveGroq, modelo, bytes, mediaType, instrucao, sinal),
    });
  }

  const chaveGemini = lerConfig(GEMINI.variavelChave);
  if (chaveGemini) {
    const modelo = lerConfig(GEMINI.variavelModelo) ?? GEMINI.modeloPadrao;
    elos.push({
      apelido: GEMINI.apelido,
      chamar: (bytes, mediaType, instrucao, sinal) =>
        chamarVisaoOpenAICompat(GEMINI.base, chaveGemini, modelo, bytes, mediaType, instrucao, sinal),
    });
  }

  const chaveAnthropic = lerConfig('ANTHROPIC_API_KEY');
  if (chaveAnthropic) {
    const modelo = lerConfig('IARA_MODELO') ?? MODELO_NUVEM_PADRAO;
    elos.push({
      apelido: 'anthropic',
      chamar: (bytes, mediaType, instrucao, sinal) =>
        chamarVisaoAnthropic(chaveAnthropic, modelo, bytes, mediaType, instrucao, sinal),
    });
  }

  return elos;
}

/**
 * Analisa `bytes` (a imagem) à luz de `duvida` (o que o operador perguntou).
 *
 * NUNCA lança por causa do CONTEÚDO da resposta — um JSON malformado ou uma
 * resposta que não aponta elemento nenhum vira `alvo: null, procedencia:
 * 'desconhecido'`, não uma falha de turno. Só lança por indisponibilidade
 * (`VisaoIndisponivel`, quando NENHUM elo da cadeia tem chave ou todos
 * falharam) — o Kernel já tem, no `catch` do turno, o caminho que transforma
 * isso em fala honesta ao operador (`mensagemHumanaDeFalha`).
 *
 * SEM RETENTATIVA dentro de um mesmo elo (ADR-4: uma chamada única por
 * provedor) — mas a CADEIA em si já é a retentativa: um elo que falha
 * (modelo fora do ar, chave inválida, catálogo mudou) cai para o próximo
 * antes de desistir, do mesmo jeito que `CadeiaDeRaciocinio` já faz para
 * texto.
 */
export async function analisarImagem(
  bytes: Buffer,
  mediaType: string,
  duvida: string,
  sinal: AbortSignal,
  /**
   * A parada em que o operador está, quando há procedimento em curso. INJETADA
   * — este módulo não conhece `BaseProcedimentos` nem `ProcedimentosEmCurso`, e
   * não deve conhecer: quem lê o corpus e a posição é o Kernel, pelo caminho de
   * sempre. É a mesma disciplina de `MotorAnalise` com o catálogo de efeitos.
   */
  parada?: ParadaEsperada,
): Promise<ResultadoAnaliseVisual> {
  if (!MEDIA_TYPES_SUPORTADOS.has(mediaType)) {
    throw new VisaoIndisponivel(`formato de imagem não suportado: ${mediaType}`);
  }

  const elos = montarCadeia();
  if (elos.length === 0) {
    throw new VisaoIndisponivel(
      'nenhum provedor de visão configurado (GROQ_API_KEY, GEMINI_API_KEY ou ANTHROPIC_API_KEY) — a visão da IARA está desligada.',
    );
  }

  const instrucao = instrucaoDoPedido(duvida, parada);
  const falhas: string[] = [];

  for (const elo of elos) {
    if (sinal.aborted) throw new VisaoIndisponivel('turno cancelado');
    try {
      const bruta = await elo.chamar(bytes, mediaType, instrucao, sinal);
      const { texto, alvo, procedencia, situacao } = interpretar(bruta.texto, Boolean(parada));
      return {
        texto,
        alvo,
        procedencia,
        situacao,
        tokens_entrada: bruta.tokens_entrada,
        tokens_saida: bruta.tokens_saida,
        provedor: elo.apelido,
      };
    } catch (erro) {
      if (sinal.aborted) throw new VisaoIndisponivel('turno cancelado');
      const mensagem = erro instanceof Error ? erro.message : String(erro);
      falhas.push(`${elo.apelido}: ${mensagem}`);
      // Achado em QA (18/08/2026): o vencedor da cadeia já tinha telemetria
      // (`canal: 'visao'` no Kernel), mas um elo que falha ANTES de vencer
      // ficava mudo — impossível saber, sem isto, se Groq/Gemini estavam
      // sendo tentados e recusando, ou nem chegavam a ser tentados.
      console.warn(`[iara] visão: ${elo.apelido} falhou — ${mensagem}`);
    }
  }

  throw new VisaoIndisponivel(`nenhum provedor de visão respondeu — ${falhas.join(' | ')}`);
}
