/**
 * Integração WhatsApp — ADAPTADOR, não autoridade.
 *
 * Ela sabe UMA coisa: como falar com a Cloud API da Meta. Não sabe se a ação é
 * permitida, não sabe se já foi feita, não decide se o efeito aconteceu. Recebe
 * um contrato do `PortalEfeitos` e devolve evidência.
 *
 * Compare com o que existia. `PortaWhatsapp.atender()` fazia:
 *
 *     await r.kernel.processar(texto);
 *     await responder(telefone, resposta);   // ← POST direto ao Graph
 *
 * Uma mensagem alcançava uma pessoa sem operação, sem chave de idempotência,
 * sem jornal e sem verificador. Após um restart, uma reentrega da Meta gerava
 * resposta duplicada, porque a única proteção era um `Map` em memória.
 *
 * Agora o canal descreve o efeito e o portal o conduz. A diferença que importa
 * não é o WhatsApp ter ficado mais seguro — é que a PRÓXIMA integração não
 * consegue nascer com esta porta.
 */

import { entregarTexto } from '../../../canais/WhatsApp';
import type { Integracao, PedidoIntegracao, RespostaProvedor } from '../PortalEfeitos';

export const ID_WHATSAPP_RESPONDER = 'whatsapp.responder';

export const integracaoWhatsapp: Integracao = {
  id: ID_WHATSAPP_RESPONDER,
  nome: 'Resposta por WhatsApp',
  /**
   * `medio`, não `alto`, e a distinção é de destinatário — não de gravidade.
   *
   * `enviar_whatsapp` (o catálogo) é `alto` porque escolhe PARA QUEM mandar: um
   * número errado alcança um terceiro e não se desfaz. Aqui o destinatário é
   * fixo e derivado — é quem acabou de escrever. O pior caso é o operador
   * receber duas vezes a resposta dele mesmo.
   *
   * Risco alto aqui exigiria uma confirmação explícita para cada resposta de
   * chat, o que tornaria o canal inutilizável — e política que ninguém consegue
   * cumprir é política que alguém contorna.
   */
  risco: 'medio',
  /**
   * Duas mensagens iguais são duas mensagens. É a família inteira que o
   * controle de duplicidade existe para proteger.
   */
  semantica: 'escrita_nao_idempotente',
  timeout_ms: 12_000,

  indisponivelPorque() {
    const falta = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID'].filter(
      (v) => !process.env[v]?.trim(),
    );
    return falta.length > 0 ? `falta ${falta.join(' e ')} no ambiente` : null;
  },

  async executar(pedido: PedidoIntegracao): Promise<RespostaProvedor> {
    const telefone = String(pedido.parametros.telefone ?? '');
    const texto = String(pedido.parametros.texto ?? '');
    if (!telefone || !texto) {
      return { aceito: false, detalhe: 'telefone ou texto ausente no contrato' };
    }

    const entrega = await entregarTexto(telefone, texto, pedido.chave_idempotencia);
    return {
      aceito: entrega.aceito,
      referencia: entrega.referencia,
      detalhe: entrega.detalhe,
    };
  },

  /**
   * NÃO EXISTE `verificar` AQUI, e a ausência é a parte honesta.
   *
   * A Cloud API não oferece leitura de uma mensagem enviada: o status (`sent`,
   * `delivered`, `read`) chega DEPOIS, por webhook, de forma assíncrona. Não há
   * nada que este processo possa perguntar agora e obter como resposta "chegou".
   *
   * Poderíamos conferir que o `wamid` existe. Seria teatro: o `wamid` foi a
   * própria Meta que acabou de nos dar, e confirmar o recibo com o recibo é o
   * que esta camada inteira existe para não fazer.
   *
   * Sem verificador, a operação DESCANSA em `aceita_pelo_provedor` — que já diz
   * exatamente o que se sabe: a Meta enfileirou, e ninguém provou entrega.
   * Quando o webhook de status for consumido, ele será a evidência de fonte
   * `verificador` que promove a operação — e é por isso que a `referencia` é
   * gravada no jornal desde já.
   */
};
