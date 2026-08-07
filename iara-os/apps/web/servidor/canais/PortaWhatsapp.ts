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
import {
  assinaturaValida,
  identificar,
  lerMensagem,
  responder,
  verificarWebhook,
  whatsappDisponivel,
} from './WhatsApp';

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
    await responder(
      mensagem.telefone,
      'Não consigo atender por este canal. Fale com o time de TI da Atos Log.',
    );
    return;
  }

  await atender(identidade.id_usuario, mensagem.telefone, mensagem.texto);
}

// ---------------------------------------------------------------------------

/**
 * Roda um turno e devolve a resposta pelo canal.
 *
 * Assina o barramento só por este turno. Uma assinatura permanente por
 * operador acumularia ouvintes a cada mensagem — vazamento clássico de
 * event bus.
 */
async function atender(idUsuario: string, telefone: string, texto: string): Promise<void> {
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
  await responder(telefone, resposta);
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
