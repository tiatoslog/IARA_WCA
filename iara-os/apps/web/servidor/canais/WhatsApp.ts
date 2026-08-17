/**
 * Canal WhatsApp — Cloud API oficial da Meta.
 *
 * POR QUE A OFICIAL, E NÃO BAILEYS/VENOM/WPPCONNECT
 *
 * As bibliotecas não-oficiais fazem engenharia reversa do WhatsApp Web e
 * violam os Termos de Serviço. O resultado típico não é falha técnica: é o
 * número ser banido. Sendo o número da empresa, o custo do banimento é a
 * operação parar. A Cloud API é chata de habilitar e não some de um dia para
 * o outro.
 *
 * O QUE ESTE ARQUIVO É
 *
 * Um TRANSPORTE, não um cérebro. Ele traduz webhook em `kernel.processar()` e
 * snapshot em mensagem de saída. É a mesma posição que a `SessaoOperador`
 * ocupa para o WebSocket — e é por isso que WhatsApp entra sem tocar em
 * Percepção, Função Executiva, Planejador ou Habilidades.
 *
 * A FRONTEIRA DE SEGURANÇA MUDA DE NATUREZA
 *
 * No WebSocket a identidade vem de um token que o servidor verifica. Aqui vem
 * de um número de telefone, que o remetente controla. Duas travas, e nenhuma é
 * opcional:
 *
 *   1. ASSINATURA. Todo POST da Meta vem com `X-Hub-Signature-256`. Sem
 *      conferir, qualquer um na internet manda mensagem fingindo ser você — e
 *      a IARA responde com o conteúdo do SEU shard.
 *   2. LISTA FECHADA. Número não cadastrado não abre sessão. Nunca. Não existe
 *      caminho aqui que crie operador a partir de quem escreveu.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { operadorPorTelefone } from '../../lib/operadores';
import { redigir } from '../nucleo/kernel/Configuracao';

const GRAPH = 'https://graph.facebook.com/v21.0';

function seg(nome: string): string | undefined {
  const v = process.env[nome]?.trim();
  return v || undefined;
}

export function whatsappDisponivel(): boolean {
  return Boolean(seg('WHATSAPP_TOKEN') && seg('WHATSAPP_PHONE_ID') && seg('WHATSAPP_APP_SECRET'));
}

export function diagnosticoWhatsapp(): string {
  const faltando = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'].filter(
    (n) => !seg(n),
  );
  return faltando.length === 0 ? 'canal WhatsApp: ATIVO' : `canal WhatsApp: desligado (falta ${faltando.join(', ')})`;
}

// ---------------------------------------------------------------------------
// 1. Verificação do webhook (handshake inicial da Meta)
// ---------------------------------------------------------------------------

export interface RespostaCanal {
  status: number;
  corpo: string;
}

/**
 * A Meta faz um GET com um desafio ao cadastrar a URL. Responder o
 * `hub.challenge` só quando o `verify_token` bate é o que impede outra pessoa
 * de apontar o webhook dela para o nosso endpoint.
 */
export function verificarWebhook(parametros: URLSearchParams): RespostaCanal {
  const esperado = seg('WHATSAPP_VERIFY_TOKEN');
  if (!esperado) return { status: 503, corpo: 'canal não configurado' };

  const modo = parametros.get('hub.mode');
  const token = parametros.get('hub.verify_token');
  const desafio = parametros.get('hub.challenge') ?? '';

  if (modo === 'subscribe' && token && iguais(token, esperado)) {
    return { status: 200, corpo: desafio };
  }
  return { status: 403, corpo: 'verificação recusada' };
}

/** Comparação em tempo constante. Igualdade de string vaza o prefixo correto. */
function iguais(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// 2. Assinatura do corpo
// ---------------------------------------------------------------------------

/**
 * Confere `X-Hub-Signature-256` contra o corpo BRUTO.
 *
 * Tem que ser o corpo bruto, byte a byte: reserializar o JSON muda espaços e
 * ordem de chave, e a assinatura deixa de bater. É o erro mais comum ao
 * integrar webhook assinado, e o sintoma é "funciona no Postman e falha em
 * produção".
 */
export function assinaturaValida(bruto: Buffer, cabecalho: string | undefined): boolean {
  const segredo = seg('WHATSAPP_APP_SECRET');
  if (!segredo) return false;
  if (!cabecalho?.startsWith('sha256=')) return false;

  const esperado = createHmac('sha256', segredo).update(bruto).digest('hex');
  return iguais(cabecalho.slice('sha256='.length), esperado);
}

// ---------------------------------------------------------------------------
// 3. Leitura da mensagem
// ---------------------------------------------------------------------------

export interface MensagemWhatsapp {
  /** Número do remetente, só dígitos. */
  telefone: string;
  texto: string;
  id: string;
}

/**
 * Extrai a mensagem de texto do payload. Devolve `null` para tudo que não for
 * texto — status de entrega, reação, áudio, figurinha. Um webhook recebe muito
 * mais evento do que mensagem, e tratar todos como pergunta acorda o kernel à
 * toa.
 */
export function lerMensagem(corpo: unknown): MensagemWhatsapp | null {
  const raiz = corpo as {
    entry?: Array<{
      changes?: Array<{
        value?: {
          messages?: Array<{ from?: string; id?: string; type?: string; text?: { body?: string } }>;
        };
      }>;
    }>;
  };

  const m = raiz?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
  if (!m || m.type !== 'text') return null;

  const telefone = (m.from ?? '').replace(/\D/g, '');
  const texto = m.text?.body?.trim() ?? '';
  if (!telefone || !texto) return null;

  return { telefone, texto: texto.slice(0, 4000), id: m.id ?? '' };
}

// ---------------------------------------------------------------------------
// 4. Identidade
// ---------------------------------------------------------------------------

export interface IdentidadeWhatsapp {
  id_usuario: string;
  nome: string;
}

/**
 * Número → operador cadastrado. `null` recusa o atendimento.
 *
 * Não existe cadastro automático aqui, e é deliberado: um número desconhecido
 * que consegue abrir sessão consegue, no mesmo movimento, ganhar um shard e
 * conversar com a IARA corporativa. Quem entra no escritório é decidido no
 * código, não por quem manda mensagem.
 */
export function identificar(telefone: string): IdentidadeWhatsapp | null {
  const op = operadorPorTelefone(telefone);
  return op ? { id_usuario: op.id, nome: op.nome } : null;
}

// ---------------------------------------------------------------------------
// 5. Envio
// ---------------------------------------------------------------------------

/** O que a Meta respondeu. Nunca um booleano — ver `EntregaWhatsapp`. */
export interface EntregaWhatsapp {
  /** A Meta ACEITOU e enfileirou. Não quer dizer entregue nem lido. */
  readonly aceito: boolean;
  /** `wamid` atribuído pela Meta. É por ele que se pergunta o status depois. */
  readonly referencia?: string;
  readonly detalhe: string;
}

/**
 * ENTREGA O TEXTO AO PROVEDOR. Primitiva de transporte, e só isso.
 *
 * ESTA FUNÇÃO NÃO DEVE SER CHAMADA POR NINGUÉM ALÉM DA INTEGRAÇÃO
 * `servidor/nucleo/kernel/integracoes/whatsapp.ts`. Há um teste de arquitetura
 * (`fronteira-efeitos.test.ts`) que falha se outro arquivo a importar.
 *
 * O DEFEITO QUE ISSO CORRIGE: ela se chamava `responder`, devolvia `boolean`, e
 * era chamada direto por `PortaWhatsapp.atender()`. Uma mensagem saía para uma
 * pessoa sem operação, sem identidade, sem idempotência, sem verificador e sem
 * uma linha de jornal — a última porta dos fundos da arquitetura.
 *
 * Duas mudanças, e as duas são de contrato, não de implementação:
 *
 *  1. o nome diz o que ela faz (ENTREGAR a um provedor), não o que ela
 *     significava no fluxo (RESPONDER ao operador). Quem quer responder agora
 *     precisa passar pelo portal;
 *  2. o retorno carrega EVIDÊNCIA — aceite mais referência do provedor — em vez
 *     de um booleano que colapsava "a Meta enfileirou" e "a pessoa recebeu" no
 *     mesmo `true`.
 *
 * Não lança: falha de transporte é informação, não exceção. Quem decide o que
 * isso significa é o portal.
 */
export async function entregarTexto(
  telefone: string,
  texto: string,
  /**
   * Chave de idempotência da operação. A Cloud API **não** oferece cabeçalho de
   * idempotência hoje, então ela viaja apenas como correlação de log — e é por
   * isso que o relatório declara `at-most-once local`, não `exactly-once`.
   * Quando a Meta publicar o cabeçalho, é aqui que ele entra.
   */
  chaveIdempotencia?: string,
): Promise<EntregaWhatsapp> {
  const token = seg('WHATSAPP_TOKEN');
  const phoneId = seg('WHATSAPP_PHONE_ID');
  if (!token || !phoneId) {
    return { aceito: false, detalhe: 'WHATSAPP_TOKEN/WHATSAPP_PHONE_ID ausentes' };
  }
  void chaveIdempotencia;

  try {
    const r = await fetch(`${GRAPH}/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefone,
        type: 'text',
        /**
         * REDIGIDO AQUI, e a razão é a mesma que pôs `redigir` na saída do
         * socket: redação é propriedade do CANAL, não disciplina de quem escreve
         * o texto.
         *
         * Esta porta não tinha a propriedade — e é a porta do celular, exatamente
         * onde a credencial foi lida no incidente de 13/08. O socket redige o
         * pacote serializado desde então; esta função mandava `texto` cru para o
         * Graph. Medido pela bateria `exfiltracao` em 17/08/2026: o segredo do
         * processo E o segredo de terceiro saíam em claro pelo WhatsApp enquanto
         * os três cenários de socket saíam redigidos.
         *
         * ANTES do `slice`, não depois: cortar primeiro poderia partir a
         * credencial em duas e o marcador não casaria mais — sobraria metade de
         * uma chave viajando, que é vazamento com aparência de segurança.
         *
         * WhatsApp corta em 4096; a margem é para não truncar no meio de uma
         * palavra e parecer erro.
         */
        text: { body: redigir(texto).slice(0, 3900), preview_url: false },
      }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      const detalhe = await r.text().catch(() => '');
      console.warn(`[iara] whatsapp: envio falhou ${r.status} ${detalhe.slice(0, 200)}`);
      return { aceito: false, detalhe: `HTTP ${r.status}: ${detalhe.slice(0, 120)}` };
    }

    /**
     * O `wamid` é o que torna a verificação POSSÍVEL um dia. Sem ele, "aceito"
     * seria uma afirmação sobre a qual nunca mais daria para perguntar nada.
     */
    const corpo = (await r.json().catch(() => ({}))) as {
      messages?: { id?: string }[];
    };
    return {
      aceito: true,
      referencia: corpo.messages?.[0]?.id,
      detalhe: 'a Meta aceitou e enfileirou a mensagem',
    };
  } catch (erro) {
    /**
     * A REQUISIÇÃO PODE TER CHEGADO. Timeout, socket cortado, DNS no meio — a
     * exceção é sobre o que ESTE processo sabe, não sobre o que a Meta fez.
     * Relançar é deliberado: o portal precisa distinguir "o provedor recusou"
     * (`aceito: false`, fato apurado) de "não faço ideia" (exceção → estado
     * `desconhecida`). Devolver `aceito: false` aqui apagaria a diferença.
     */
    console.warn(`[iara] whatsapp: ${(erro as Error).message}`);
    throw erro;
  }
}
