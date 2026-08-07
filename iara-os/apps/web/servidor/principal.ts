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
  const app = next({ dev: DEV });
  await app.prepare();
  const tratarRequisicao = app.getRequestHandler();
  // O Next tem o próprio WebSocket de HMR em dev; se não devolvermos o upgrade
  // para ele, o hot reload morre.
  const tratarUpgrade = app.getUpgradeHandler();

  const servidorHttp = createServer((req, res) => {
    void tratarRequisicao(req, res);
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

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
      conectarOperador(ws);
    });
  });

  servidorHttp.listen(PORTA, () => {
    console.log(`[iara] IARA OS em http://localhost:${PORTA}`);
    console.log(`[iara] barramento em ${CAMINHO_WS} (mesma porta, mesma origem)`);
    console.log(`[iara] persistência: ${persistenciaEmUso()}`);
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
    (e: Error) => console.warn(`[iara] índice histórico indisponível: ${e.message}`),
  );

  const encerrar = () => {
    console.log('\n[iara] encerrando...');
    encerrarResidentes();
    wss.close();
    servidorHttp.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

void subir();
