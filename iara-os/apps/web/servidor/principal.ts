/**
 * Processo único: Next + motor cognitivo na MESMA porta.
 *
 * Por que unificar: dois processos em portas diferentes obrigam a expor duas
 * URLs, dois certificados e um WebSocket cross-origin. Num processo só, o
 * barramento é same-origin em `/barramento`, herda o TLS do host e roda em
 * qualquer lugar que execute Node — Railway, Render, Fly, Docker, VPS.
 *
 * Vercel continua fora: serverless não mantém processo longo nem WebSocket.
 */

import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import next from 'next';
import { WebSocketServer } from 'ws';
import { config as carregarEnv } from 'dotenv';
import { conectarOperador, encerrarResidentes, prepararMotor } from './barramento/Porta';
import { persistenciaEmUso } from './nucleo/ClienteSupabase';
import { autenticacaoAtiva } from './nucleo/Autenticacao';
import { ehRotaWhatsapp, tratarWhatsapp } from './canais/PortaWhatsapp';
import { diagnosticoWhatsapp } from './canais/WhatsApp';
import { audioPorHash, diagnosticoVoz } from './nucleo/Voz';

carregarEnv({ path: '.env.local' });
carregarEnv();

/**
 * Modo por flag, não por variável de ambiente prefixada no comando:
 * `NODE_ENV=x cmd` não funciona no shell do Windows, e o time roda Windows.
 * `npm run dev` passa `--dev`; `npm start` é produção por padrão.
 */
const DEV = process.argv.includes('--dev') || process.env.NODE_ENV === 'development';
// O Next e o React leem NODE_ENV; alinhamos antes de instanciar o app.
// Os tipos do Node marcam NODE_ENV como somente-leitura; em runtime é um campo
// comum, e escrevê-lo aqui é justamente o ponto.
(process.env as Record<string, string>).NODE_ENV = DEV ? 'development' : 'production';
// Hosts de PaaS injetam PORT. IARA_PORTA é o override local.
const PORTA = Number(process.env.PORT ?? process.env.IARA_PORTA ?? 3000);
const CAMINHO_WS = '/barramento';

/**
 * Trava de origem. Sem isto, qualquer página na internet abre um WebSocket
 * para o motor e conversa com ele. Navegador não aplica CORS a WebSocket — a
 * checagem é responsabilidade do servidor.
 *
 * `IARA_ORIGENS` é uma lista separada por vírgula. Vazio em produção = só
 * mesma origem (requisições sem header `Origin`, como cliente nativo, são
 * recusadas).
 */
const ORIGENS = (process.env.IARA_ORIGENS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function origemPermitida(req: IncomingMessage): boolean {
  const origem = req.headers.origin;
  if (!origem) return DEV; // sem Origin: só tolerado em desenvolvimento
  if (ORIGENS.includes(origem)) return true;
  if (DEV && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origem)) return true;
  // Mesma origem do próprio host: compara com o Host do request.
  const host = req.headers.host;
  if (host && (origem === `https://${host}` || origem === `http://${host}`)) return true;
  return false;
}

async function subir(): Promise<void> {
  /**
   * FALHA-FECHADA. Produção sem autenticação era um aviso no log — e aviso
   * não impede deploy incompleto: sem Supabase, a identidade vem de um campo
   * que o CLIENTE digita, e qualquer pessoa que alcance o WebSocket assume o
   * shard de qualquer operador. Se isso é intencional (rede fechada, PoC),
   * declare IARA_PERMITIR_MODO_LOCAL=1 e assuma a decisão por escrito.
   */
  if (!DEV && !autenticacaoAtiva() && process.env.IARA_PERMITIR_MODO_LOCAL !== '1') {
    console.error(
      '[iara] RECUSANDO SUBIR: produção sem autenticação (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes).\n' +
        '       Em modo local a identidade vem de um seletor do cliente — exposto à internet, isso é\n' +
        '       impersonação de qualquer operador. Configure o Supabase Auth ou, se este processo roda\n' +
        '       em rede fechada e a decisão é consciente, declare IARA_PERMITIR_MODO_LOCAL=1.',
    );
    process.exit(1);
  }

  const app = next({ dev: DEV });
  await app.prepare();
  const tratarRequisicao = app.getRequestHandler();
  // O Next tem o próprio WebSocket de HMR em dev; se não devolvermos o upgrade
  // para ele, o hot reload morre.
  const tratarUpgrade = app.getUpgradeHandler();

  /**
   * Áudio da voz, servido pelo próprio processo.
   *
   * Vive fora do Next de propósito: os bytes estão em memória do motor, não no
   * disco, e uma rota de API do Next não os alcançaria sem duplicar o estado.
   * O hash na URL é a chave de um Map — não há caminho de arquivo envolvido,
   * então não há travessia de diretório possível. A validação abaixo existe
   * mesmo assim, porque "não há como" envelhece mal.
   */
  const ROTA_VOZ = /^\/voz\/([0-9a-f]{8,64})\.(mp3|wav)$/;

  const inicioProcesso = Date.now();

  const servidorHttp = createServer((req, res) => {
    const caminho = (req.url ?? '').split('?')[0];

    /**
     * Health check para orquestradores (Railway, Docker, monitor de uptime).
     * Sem segredo nenhum na resposta: é estado operacional, não diagnóstico.
     *
     * O campo `app` existe para o shell desktop. Ele precisa decidir se sobe o
     * motor ou reusa o que já está na porta 3000, e "a porta responde" NÃO
     * responde essa pergunta: 3000 é a porta mais disputada que existe. Sem uma
     * assinatura, o Tauri carregaria o app de qualquer outro processo dentro da
     * janela da IARA, em silêncio. Mudar esta string quebra essa checagem —
     * ver `apps/desktop/src-tauri/src/main.rs`.
     */
    if (caminho === '/saude') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          app: 'iara',
          ok: true,
          uptime_s: Math.round((Date.now() - inicioProcesso) / 1000),
          modo: DEV ? 'desenvolvimento' : 'producao',
          autenticacao: autenticacaoAtiva() ? 'supabase' : 'local',
        }),
      );
      return;
    }

    /**
     * Canal WhatsApp. Vem ANTES do Next porque a Meta exige o corpo bruto para
     * conferir a assinatura, e o body parser do Next já teria consumido o
     * stream — reserializar o JSON muda bytes e a assinatura deixa de bater.
     */
    if (ehRotaWhatsapp(req.url ?? '')) {
      void tratarWhatsapp(req, res).catch((e: Error) => {
        console.warn(`[iara] whatsapp: ${e.message}`);
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }

    const voz = ROTA_VOZ.exec(caminho);

    if (voz) {
      const audio = audioPorHash(voz[1]);
      if (!audio) {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': audio.tipo,
        'Content-Length': audio.bytes.length,
        // Imutável: o nome do arquivo É o hash do conteúdo. Se o texto mudar,
        // muda o hash, muda a URL — nunca há cache servindo áudio velho.
        'Cache-Control': 'public, max-age=86400, immutable',
      });
      res.end(audio.bytes);
      return;
    }

    void tratarRequisicao(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

  /**
   * HEARTBEAT. Um socket cujo cabo caiu (Wi-Fi, suspensão, NAT expirando) não
   * emite `close` — ele apenas para de responder, e a sessão dele viraria
   * zumbi ocupando vaga de espelho. Ping a cada 30 s; quem não devolveu o pong
   * da rodada anterior é terminado, e aí sim o `close` dispara a desmontagem.
   */
  const vivos = new WeakSet<import('ws').WebSocket>();
  const RITMO_HEARTBEAT_MS = 30_000;
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!vivos.has(ws)) {
        ws.terminate();
        continue;
      }
      vivos.delete(ws);
      ws.ping();
    }
  }, RITMO_HEARTBEAT_MS);
  heartbeat.unref();

  servidorHttp.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const caminho = (req.url ?? '').split('?')[0];

    if (caminho !== CAMINHO_WS) {
      void tratarUpgrade(req, socket, head);
      return;
    }

    if (!origemPermitida(req)) {
      console.warn(`[iara] upgrade recusado, origem "${req.headers.origin ?? '(vazia)'}"`);
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      vivos.add(ws);
      ws.on('pong', () => vivos.add(ws));
      conectarOperador(ws);
    });
  });

  servidorHttp.listen(PORTA, () => {
    console.log(`[iara] IARA OS em http://localhost:${PORTA}`);
    console.log(`[iara] barramento em ${CAMINHO_WS} (mesma porta, mesma origem)`);
    console.log(`[iara] persistência: ${persistenciaEmUso()}`);
    console.log(`[iara] ${diagnosticoWhatsapp()}`);
    console.log(`[iara] voz: ${diagnosticoVoz()}`);
    console.log(
      autenticacaoAtiva()
        ? '[iara] autenticação: Supabase Auth (identidade vem do token verificado)'
        : '[iara] autenticação: DESLIGADA — modo local. NÃO EXPONHA ESTE PROCESSO À INTERNET.',
    );
    if (!DEV && ORIGENS.length === 0) {
      console.warn(
        '[iara] IARA_ORIGENS vazio em produção: só a própria origem é aceita no barramento.',
      );
    }
  });

  void prepararMotor().then(
    () => console.log('[iara] índice histórico carregado'),
    (e: Error) => {
      console.warn(`[iara] índice histórico indisponível: ${e.message}`);
      // Erro mais comum na primeira subida com Supabase ligado. Sem esta
      // dica, o sintoma na tela ("a IARA não responde") não tem relação
      // aparente com a causa (schema não aplicado).
      if (/table|schema cache|relation/i.test(e.message)) {
        console.warn(
          '[iara] AÇÃO NECESSÁRIA: as tabelas não existem no Supabase.\n' +
            '       Abra o SQL Editor do projeto e rode iara-os/apps/web/supabase/schema.sql\n' +
            '       inteiro. Enquanto isso, a IARA atende mas não grava histórico.',
        );
      }
    },
  );

  const encerrar = () => {
    console.log('\n[iara] encerrando...');
    clearInterval(heartbeat);
    encerrarResidentes();
    wss.close();
    servidorHttp.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

void subir();
