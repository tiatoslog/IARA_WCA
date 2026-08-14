/**
 * Cliente WhatsApp Business Cloud API — a chamada de envio em si.
 *
 * Mesmo contrato dos outros clientes (`ClienteGraph`, `OrquestradorAcoes`):
 * ambiente lido em função, `{ ok, texto }` honesto em vez de exceção.
 *
 * ESTE MÓDULO NUNCA DECIDE SE ENVIA. Ele só sabe FALAR com a Meta depois que
 * alguém mandou. A decisão de quando chamar — e a confirmação explícita do
 * operador antes disso — mora em `AgenteLocal.ts`, no mesmo desenho de duas
 * travas que protege `acionar_energia`: a pendência em memória (amarrada a
 * operador+sessão, com janela de 60s) e a operação persistida no jornal. Um
 * cliente HTTP que decidisse por conta própria seria a rota de fuga que
 * `Fronteira.ts` existe para impedir — por isso ele nem importa `AgenteLocal`,
 * só é chamado por ele.
 */

const TEMPO_LIMITE_MS = 10_000;

function token(): string {
  return (process.env.WHATSAPP_TOKEN ?? '').trim();
}

function idNumero(): string {
  return (process.env.WHATSAPP_PHONE_ID ?? '').trim();
}

export function whatsappDisponivel(): boolean {
  return token().length > 0 && idNumero().length > 0;
}

interface RespostaMeta {
  messages?: Array<{ id: string }>;
  error?: { message?: string; code?: number; error_data?: { details?: string } };
}

/**
 * Envia UMA mensagem de texto. Não faz retry, não faz fila — quem chama
 * decide o que fazer com uma falha, e retry automático de mensagem para
 * humano é a receita clássica de mandar duas vezes.
 */
export async function enviarWhatsapp(
  destinatario: string,
  mensagem: string,
): Promise<{ ok: boolean; texto: string }> {
  const t = token();
  const idDoNumero = idNumero();
  if (!t || !idDoNumero) {
    return { ok: false, texto: 'WHATSAPP_TOKEN ou WHATSAPP_PHONE_ID não configurado — canal desligado.' };
  }

  // E.164 solto: só dígitos, com ou sem `+`. A Meta recusa formatação humana
  // ("(65) 99999-9999"), e recusar aqui é mais rápido que pagar a rodada
  // até a API para descobrir a mesma coisa.
  const numero = destinatario.replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(numero)) {
    return {
      ok: false,
      texto: `"${destinatario}" não parece um número de WhatsApp válido (formato internacional, só dígitos).`,
    };
  }

  try {
    const resposta = await fetch(`https://graph.facebook.com/v20.0/${idDoNumero}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: numero,
        type: 'text',
        text: { body: mensagem },
      }),
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
    });

    const dados = (await resposta.json().catch(() => ({}))) as RespostaMeta;

    if (!resposta.ok) {
      const detalhe = dados.error?.error_data?.details ?? dados.error?.message;
      if (resposta.status === 401 || resposta.status === 403) {
        return {
          ok: false,
          texto: 'WHATSAPP_TOKEN expirou, é inválido ou não tem permissão para enviar mensagem.',
        };
      }
      return {
        ok: false,
        texto: `WhatsApp recusou o envio (HTTP ${resposta.status})${detalhe ? `: ${detalhe}` : ''}.`,
      };
    }

    const id = dados.messages?.[0]?.id;
    if (!id) {
      // 200 sem `messages[0].id` não é o contrato documentado da Meta —
      // melhor dizer "não sei" do que afirmar entrega que não confirmou.
      return {
        ok: false,
        texto: 'A Meta respondeu OK mas sem confirmar o envio. Prefiro não afirmar que entreguei.',
      };
    }

    /**
     * "Aceito", não "entregue". A Meta confirmou que RECEBEU a mensagem para
     * envio (devolveu um id) — não que ela chegou ao destinatário. Ver
     * `EstadoOperacao.aceita_pelo_provedor` em `Operacao.ts`: são estados
     * diferentes de propósito, e a frase que sai daqui precisa respeitar essa
     * distinção, não só o código que a guarda.
     */
    return { ok: true, texto: `Aceito pelo WhatsApp para envio a ${numero} (id ${id}).` };
  } catch (erro) {
    return {
      ok: false,
      texto: `Não consegui falar com o WhatsApp (${(erro as Error).message}). Prefiro dizer isso a fingir que enviei.`,
    };
  }
}
