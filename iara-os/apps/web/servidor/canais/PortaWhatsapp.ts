/**
 * Porta HTTP do canal WhatsApp.
 *
 * Aqui mora a única coisa que o WhatsApp exige e o WebSocket não: um turno
 * SEM sessão viva. No navegador, o operador fica conectado e recebe snapshots
 * conforme o kernel trabalha. No WhatsApp não há conexão — chega uma mensagem,
 * sai uma resposta.
 *
 * A solução não é um kernel diferente. É assinar o barramento por um turno,
 * esperar `TAREFA_CONCLUIDA`, mandar o texto e desassinar. O mesmo Kernel, a
 * mesma Percepção, o mesmo Planejador, os mesmos shards.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { BarramentoEventos } from '../nucleo/kernel/BarramentoEventos';
import { EstadoAtomico } from '../nucleo/EstadoAtomico';
import { MemoriaOperacional } from '../nucleo/MemoriaOperacional';
import { Kernel } from '../nucleo/kernel/Kernel';
import { outrosOperadores } from '../../lib/operadores';
import { PortalEfeitos } from '../nucleo/kernel/PortalEfeitos';
import { registroOperacoes } from '../nucleo/kernel/RegistroOperacoes';
import { ID_WHATSAPP_RESPONDER, INTEGRACOES } from '../nucleo/kernel/integracoes';
import {
  assinaturaValida,
  identificar,
  lerMensagem,
  verificarWebhook,
  whatsappDisponivel,
} from './WhatsApp';

/**
 * A fronteira de efeitos deste canal.
 *
 * Compartilha o `registroOperacoes` do processo — que é onde TODO o estado mora
 * — então instanciar o portal aqui não cria uma segunda verdade: cria um segundo
 * ponteiro para a mesma. O portal em si só carrega o mapa de integrações.
 *
 * Existe para o caso do número NÃO CADASTRADO, que precisa de uma resposta antes
 * de haver kernel algum. Para operador conhecido, usa-se `kernel.efeitos`, que é
 * o mesmo desenho com o mesmo jornal.
 */
const portalCanal = new PortalEfeitos(registroOperacoes);
portalCanal.registrarTodas(INTEGRACOES);

const memoria = new MemoriaOperacional();

/** Um kernel por operador, como no WebSocket. Estado não é por mensagem. */
interface Residente {
  estado: EstadoAtomico;
  barramento: BarramentoEventos;
  kernel: Kernel;
}
const residentes = new Map<string, Residente>();

function residenteDe(idUsuario: string): Residente {
  let r = residentes.get(idUsuario);
  if (!r) {
    const estado = new EstadoAtomico();
    const barramento = new BarramentoEventos(idUsuario);
    r = {
      estado,
      barramento,
      kernel: new Kernel({
        sessao: `whatsapp:${idUsuario}`,
        idUsuario,
        outrosOperadores: outrosOperadores(idUsuario),
        estado,
        memoria,
        barramento,
      }),
    };
    residentes.set(idUsuario, r);
  }
  return r;
}

/**
 * Descarta mensagem repetida.
 *
 * A Meta reentrega o webhook quando não recebe 200 rápido o bastante. Sem
 * deduplicação, uma resposta lenta vira duas respostas iguais para o operador
 * — e dois raciocínios pagos pelo mesmo pedido.
 */
const jaVistas = new Map<string, number>();
function repetida(id: string): boolean {
  const agora = Date.now();
  for (const [k, t] of jaVistas) if (agora - t > 10 * 60_000) jaVistas.delete(k);
  if (jaVistas.has(id)) return true;
  jaVistas.set(id, agora);
  return false;
}

// ---------------------------------------------------------------------------

const CAMINHO = '/canais/whatsapp';

export function ehRotaWhatsapp(url: string): boolean {
  return url.split('?')[0] === CAMINHO;
}

export async function tratarWhatsapp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!whatsappDisponivel()) {
    res.writeHead(503).end('canal WhatsApp não configurado');
    return;
  }

  if (req.method === 'GET') {
    const parametros = new URL(req.url ?? '', 'http://local').searchParams;
    const r = verificarWebhook(parametros);
    res.writeHead(r.status, { 'Content-Type': 'text/plain' }).end(r.corpo);
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405).end();
    return;
  }

  const bruto = await lerCorpo(req);

  // A assinatura é conferida sobre o corpo BRUTO, antes de qualquer parse.
  if (!assinaturaValida(bruto, req.headers['x-hub-signature-256'] as string | undefined)) {
    console.warn('[iara] whatsapp: assinatura inválida — requisição descartada');
    res.writeHead(401).end();
    return;
  }

  let corpo: unknown;
  try {
    corpo = JSON.parse(bruto.toString('utf8'));
  } catch {
    res.writeHead(400).end();
    return;
  }

  /**
   * 200 IMEDIATO, processamento depois.
   *
   * A Meta reentrega se não receber 200 em poucos segundos, e um raciocínio na
   * nuvem passa disso com folga. Responder antes de processar troca "resposta
   * duplicada" por "resposta que demora" — que é o defeito certo a ter.
   */
  res.writeHead(200).end();

  const mensagem = lerMensagem(corpo);
  if (!mensagem || repetida(mensagem.id)) return;

  const identidade = identificar(mensagem.telefone);
  if (!identidade) {
    console.warn(`[iara] whatsapp: número não cadastrado (${mascarar(mensagem.telefone)})`);
    // Resposta genérica e idêntica para qualquer desconhecido: confirmar que
    // "este número não tem acesso" já entrega que o número existe e atende.
    await entregar({
      // Ator único, e não o telefone: o nome do arquivo de jornal deriva do
      // ator, e um jornal por número desconhecido seria um arquivo novo a cada
      // sonda da internet — com o telefone no NOME do arquivo. O número vai nos
      // parâmetros, dentro do shard do canal.
      ator: 'canal_whatsapp',
      sessao: 'whatsapp:nao_cadastrado',
      telefone: mensagem.telefone,
      texto: 'Não consigo atender por este canal. Fale com o time de TI da Atos Log.',
      origem_pedido: mensagem.id,
      portal: portalCanal,
    });
    return;
  }

  await atender(identidade.id_usuario, mensagem.telefone, mensagem.texto, mensagem.id);
}

// ---------------------------------------------------------------------------

/**
 * Roda um turno e devolve a resposta pelo canal.
 *
 * Assina o barramento só por este turno. Uma assinatura permanente por
 * operador acumularia ouvintes a cada mensagem — vazamento clássico de
 * event bus.
 */
async function atender(
  idUsuario: string,
  telefone: string,
  texto: string,
  idMensagem: string,
): Promise<void> {
  const r = residenteDe(idUsuario);
  let resposta = '';

  const desassinar = r.barramento.assinar('TAREFA_CONCLUIDA', (e) => {
    resposta = e.texto;
  });

  try {
    await r.kernel.processar(texto);
  } catch (erro) {
    console.warn(`[iara] whatsapp: turno falhou — ${(erro as Error).message}`);
  } finally {
    desassinar();
  }

  if (!resposta) {
    resposta = 'Não consegui concluir esse pedido agora. Tente de novo em instantes.';
  }

  await entregar({
    ator: idUsuario,
    sessao: `whatsapp:${idUsuario}`,
    telefone,
    texto: resposta,
    /**
     * O ID DA MENSAGEM DA META É A IDENTIDADE DO TURNO — e é o que faz a
     * deduplicação sobreviver ao restart.
     *
     * `jaVistas` é um `Map` de 10 minutos em memória: útil, e insuficiente. Uma
     * reentrega da Meta depois de um reinício encontrava o mapa vazio e a IARA
     * respondia duas vezes. Com o id da mensagem como origem do pedido, a chave
     * de idempotência é a mesma nas duas entregas, e o jornal em disco reconhece
     * a segunda como duplicata.
     */
    origem_pedido: idMensagem,
    portal: r.kernel.efeitos,
  });
}

/**
 * A ÚNICA saída de mensagem deste canal.
 *
 * Antes era `await responder(telefone, resposta)` — um POST ao Graph sem
 * operação, sem chave, sem jornal, sem verificador. Agora é uma operação como
 * qualquer outra: identificada, deduplicada, registrada antes do efeito, e
 * fechada em `aceita_pelo_provedor` — nunca em "enviado", porque a Meta aceitar
 * não é a pessoa receber.
 *
 * Não lança: falha de entrega não pode derrubar o webhook, que já respondeu 200.
 * O que não pode acontecer — e não acontece mais — é a falha sumir.
 */
async function entregar(p: {
  ator: string;
  sessao: string;
  telefone: string;
  texto: string;
  origem_pedido: string;
  portal: PortalEfeitos;
}): Promise<void> {
  const r = await p.portal.executar({
    integracao: ID_WHATSAPP_RESPONDER,
    id_usuario: p.ator,
    sessao: p.sessao,
    parametros: { telefone: p.telefone, texto: p.texto },
    origem_pedido: p.origem_pedido,
    /**
     * A autorização é a MENSAGEM QUE O OPERADOR MANDOU. Responder a quem
     * escreveu é o ato que ele iniciou — não uma iniciativa da IARA, e não uma
     * decisão da camada de raciocínio.
     */
    fonte_autorizacao: 'operador',
    motivo_autorizacao: `resposta à mensagem ${p.origem_pedido} recebida do próprio operador`,
    /**
     * O `wamid` da Meta é único por mensagem recebida, e cada mensagem recebida
     * merece exatamente uma resposta. Com isso a chave sozinha basta, e as
     * heurísticas de impressão digital saem do caminho — senão duas perguntas
     * diferentes que produzem a MESMA frase de resposta ("Bom dia! Como posso
     * ajudar?") fariam a segunda ser engolida em silêncio, para sempre.
     */
    origem_confiavel: true,
  });

  if (r.tipo === 'recusada') {
    console.warn(`[iara] whatsapp: resposta não entregue — ${r.motivo}`);
  }
}

function lerCorpo(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const partes: Buffer[] = [];
    let total = 0;
    req.on('data', (p: Buffer) => {
      total += p.length;
      // Teto: webhook legítimo é pequeno. Sem limite, um POST gigante é
      // negação de serviço de graça.
      if (total > 1_000_000) {
        reject(new Error('corpo grande demais'));
        req.destroy();
        return;
      }
      partes.push(p);
    });
    req.on('end', () => resolve(Buffer.concat(partes)));
    req.on('error', reject);
  });
}

/** Telefone em log vai mascarado: log é lido por mais gente que o shard. */
function mascarar(t: string): string {
  return t.length > 4 ? `***${t.slice(-4)}` : '***';
}
