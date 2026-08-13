/**
 * O motor cognitivo, em dois modos.
 *
 * `unificado` (padrão) — Next + motor na MESMA porta, um processo só. Dois
 * processos em portas diferentes obrigariam a expor duas URLs, dois
 * certificados e um WebSocket cross-origin; aqui o barramento é same-origin em
 * `/barramento`, herda o TLS do host e roda em qualquer lugar que execute Node.
 *
 * `headless` — o motor SEM a interface. O Next é servido noutro host (Vercel), e
 * este processo entrega só o que exige estado vivo: o WebSocket, o áudio da voz
 * (que mora em memória, não em disco) e o webhook do WhatsApp. Serverless nunca
 * serviu para isto — não mantém processo longo, não preserva memória entre
 * invocações e tem filesystem somente-leitura.
 *
 * O PADRÃO é `unificado` de propósito, e isso é uma decisão de operação, não de
 * estética: `npm run dev` continua idêntico, e no dia em que o front na nuvem
 * quebrar — domínio expirado, NEXT_PUBLIC_IARA_WS apontando para o lugar
 * errado, deploy travado — trocar UMA variável no host devolve o sistema
 * inteiro num endereço só. É por isso que o Dockerfile continua rodando
 * `npm run build` mesmo quando este processo sobe headless.
 */

import { createServer, type IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer } from 'ws';
import { config as carregarEnv } from 'dotenv';
import { origemNaLista, temCuringa } from '../lib/origens';
import { conectarOperador, encerrarResidentes, prepararMotor } from './barramento/Porta';
import { persistenciaEmUso } from './nucleo/ClienteSupabase';
import { autenticacaoAtiva } from './nucleo/Autenticacao';
import { ehRotaWhatsapp, tratarWhatsapp } from './canais/PortaWhatsapp';
import { diagnosticoWhatsapp } from './canais/WhatsApp';
import { audioPorHash, diagnosticoVoz } from './nucleo/Voz';
import { estadoDaChave } from './nucleo/kernel/Prova';

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

/** Ver o cabeçalho do arquivo. Qualquer valor que não seja `headless` é unificado. */
type ModoMotor = 'unificado' | 'headless';
const MODO: ModoMotor = process.env.IARA_MODO === 'headless' ? 'headless' : 'unificado';

/**
 * Trava de origem. Sem isto, qualquer página na internet abre um WebSocket
 * para o motor e conversa com ele. Navegador não aplica CORS a WebSocket — a
 * checagem é responsabilidade do servidor.
 *
 * `IARA_ORIGENS` é uma lista separada por vírgula. Vazio em produção = só
 * mesma origem (requisições sem header `Origin`, como cliente nativo, são
 * recusadas).
 *
 * Em modo headless a "mesma origem" deixa de existir: o front mora noutro
 * domínio, e a lista passa a ser a ÚNICA coisa que separa a IARA da internet.
 */
const ORIGENS = (process.env.IARA_ORIGENS ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

function origemPermitida(req: IncomingMessage): boolean {
  const origem = req.headers.origin;
  if (!origem) return DEV; // sem Origin: só tolerado em desenvolvimento
  if (origemNaLista(origem, ORIGENS)) return true;
  if (DEV && /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origem)) return true;
  // Mesma origem do próprio host: compara com o Host do request.
  const host = req.headers.host;
  if (host && (origem === `https://${host}` || origem === `http://${host}`)) return true;
  return false;
}

/**
 * A interface, quando ela mora neste processo.
 *
 * Devolve os dois tratadores que o Next expõe. O de upgrade não é detalhe: o
 * Next tem o próprio WebSocket de HMR em dev, e sem devolver o upgrade para ele
 * o hot reload morre.
 */
async function montarAnexoNext(dev: boolean): Promise<{
  requisicao: (req: IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>;
  upgrade: (req: IncomingMessage, socket: Duplex, head: Buffer) => Promise<void>;
}> {
  const { default: next } = await import('next');
  const app = next({ dev });
  await app.prepare();
  return { requisicao: app.getRequestHandler(), upgrade: app.getUpgradeHandler() };
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

  /**
   * FALHA-FECHADA nº 2: curinga de origem em produção.
   *
   * `https://*.vercel.app` parece "um pouco mais frouxo" e não é: qualquer
   * pessoa consegue um subdomínio `vercel.app` de graça em minutos. O curinga
   * não alarga a lista de origens autorizadas — ele a substitui pela internet
   * inteira, e faz isso silenciosamente, porque tudo continua funcionando.
   *
   * A trava de token do Supabase ainda barraria a impersonação. Mas esta
   * checagem existe justamente por ser a camada que NÃO depende de o token
   * estar certo, e uma defesa em profundidade que se anula sozinha em produção
   * não é defesa nenhuma.
   *
   * Preview de deploy é um caso legítimo — e o lugar dele é um motor separado,
   * com `IARA_AMBIENTE=homologacao` e banco próprio, nunca o de produção.
   */
  if (!DEV && temCuringa(ORIGENS) && process.env.IARA_AMBIENTE !== 'homologacao') {
    console.error(
      '[iara] RECUSANDO SUBIR: curinga em IARA_ORIGENS sem IARA_AMBIENTE=homologacao.\n' +
        `       Origens declaradas: ${ORIGENS.join(', ')}\n` +
        '       Um curinga de subdomínio em produção equivale a autorizar a internet: qualquer\n' +
        '       pessoa registra um subdomínio no mesmo host em minutos. Use o domínio exato, ou\n' +
        '       suba um motor de homologação separado (banco próprio) e declare IARA_AMBIENTE.',
    );
    process.exit(1);
  }

  /**
   * O anexo da interface. Só existe em modo unificado — e o import é DINÂMICO
   * por isso: com `import next from 'next'` no topo, o módulo seria resolvido
   * na subida mesmo sem nunca ser instanciado, e o container headless passaria
   * a exigir um `.next` construído para começar a existir. Headless que carrega
   * o Next não é headless, é Next com a interface desligada.
   */
  const anexo = MODO === 'unificado' ? await montarAnexoNext(DEV) : null;

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
          // A interface está NESTE processo ou noutro host? O shell desktop e
          // quem for diagnosticar um deploy precisam da resposta sem adivinhar.
          projecao: MODO === 'unificado' ? 'anexa' : 'externa',
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
      /**
       * CORS aqui não é o que faz o áudio tocar. Um `new Audio(url)` cross-origin
       * toca sem cabeçalho nenhum — é mídia, não `fetch`.
       *
       * O que estes dois cabeçalhos impedem é a falha SILENCIOSA de amanhã: no
       * dia em que alguém ligar um `AudioContext` no elemento para medir
       * amplitude e alimentar a articulação da boca, sem CORS o elemento vira
       * *tainted* e a saída é silêncio — sem erro, sem exceção, sem pista. E o
       * `Cross-Origin-Resource-Policy` é o que mantém o áudio alcançável se a
       * página do outro host algum dia mandar COEP.
       */
      const origem = req.headers.origin;
      const cabecalhos: Record<string, string | number> = {
        'Content-Type': audio.tipo,
        'Content-Length': audio.bytes.length,
        // Imutável: o nome do arquivo É o hash do conteúdo. Se o texto mudar,
        // muda o hash, muda a URL — nunca há cache servindo áudio velho.
        'Cache-Control': 'public, max-age=86400, immutable',
        'Cross-Origin-Resource-Policy': 'cross-origin',
      };
      // A MESMA trava do barramento decide: nada de `*`. A fala da IARA é
      // conteúdo do operador, e a lista de origens já é a resposta para "quem
      // pode ler isto".
      if (origem && origemPermitida(req)) {
        cabecalhos['Access-Control-Allow-Origin'] = origem;
        cabecalhos.Vary = 'Origin';
      }
      res.writeHead(200, cabecalhos);
      res.end(audio.bytes);
      return;
    }

    if (anexo) {
      void anexo.requisicao(req, res);
      return;
    }

    /**
     * Headless: este processo não tem interface para servir, e dizer isso é
     * melhor que uma página em branco. Quem chegou aqui ou digitou o endereço
     * do motor no navegador, ou tem um NEXT_PUBLIC_IARA_WS apontando para o
     * lugar errado — e as duas confusões se resolvem lendo esta linha.
     */
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(
      JSON.stringify({
        erro: 'motor headless: este processo serve o barramento, a voz e os canais — a interface mora noutro host',
      }),
    );
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
      // Só o HMR do Next tem outro motivo legítimo para pedir upgrade aqui.
      // Sem anexo não há HMR, e um upgrade para caminho desconhecido é ruído
      // ou sondagem: fecha.
      if (anexo) void anexo.upgrade(req, socket, head);
      else socket.destroy();
      return;
    }

    if (!origemPermitida(req)) {
      // A lista esperada vai junto de propósito. O erro nº 1 deste deploy é
      // "https://app.com" contra "https://app.com/", ou http contra https — e
      // ver as duas strings uma embaixo da outra resolve em segundos o que sem
      // isso vira uma tarde procurando no lugar errado.
      console.warn(
        `[iara] upgrade recusado, origem "${req.headers.origin ?? '(vazia)'}" — ` +
          `autorizadas: ${ORIGENS.length ? ORIGENS.join(', ') : '(nenhuma; só mesma origem)'}`,
      );
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
    console.log(
      anexo
        ? `[iara] IARA OS em http://localhost:${PORTA}`
        : `[iara] motor HEADLESS na porta ${PORTA} — sem interface; ela é servida noutro host`,
    );
    console.log(
      anexo
        ? `[iara] barramento em ${CAMINHO_WS} (mesma porta, mesma origem)`
        : `[iara] barramento em ${CAMINHO_WS} (o cliente chega por NEXT_PUBLIC_IARA_WS)`,
    );
    console.log(`[iara] persistência: ${persistenciaEmUso()}`);
    console.log(`[iara] ${diagnosticoWhatsapp()}`);
    console.log(`[iara] voz: ${diagnosticoVoz()}`);
    /**
     * O ESTADO DA CHAVE DE PROVA, dito em voz alta na subida.
     *
     * Não é `process.exit`, e a escolha é deliberada: as duas falhas-fechadas
     * acima recusam subir porque sem elas o sistema fica ABERTO — qualquer um
     * assume qualquer shard. Esta é de outra natureza: sem a chave, o jornal
     * continua sendo validado por estrutura e dono, e todas as travas de
     * runtime seguem de pé. O que se perde é a capacidade de distinguir uma
     * linha adulterada de uma linha legítima DEPOIS de um restart — integridade
     * da trilha de auditoria, não controle de acesso.
     *
     * Derrubar um deploy em produção por causa disso trocaria um risco de
     * forense por um risco de disponibilidade, sem consultar quem opera. Dizer
     * a verdade na subida é o que permite a decisão ser tomada por quem tem
     * competência para tomá-la.
     */
    const chaveProva = estadoDaChave();
    console.log(
      chaveProva.ativa
        ? '[iara] jornal de operações: selado (IARA_CHAVE_PROVA ativa)'
        : `[iara] jornal de operações: SEM SELO — ${chaveProva.motivo}`,
    );
    console.log(
      autenticacaoAtiva()
        ? '[iara] autenticação: Supabase Auth (identidade vem do token verificado)'
        : '[iara] autenticação: DESLIGADA — modo local. NÃO EXPONHA ESTE PROCESSO À INTERNET.',
    );
    if (!DEV && ORIGENS.length === 0) {
      console.warn(
        anexo
          ? '[iara] IARA_ORIGENS vazio em produção: só a própria origem é aceita no barramento.'
          : '[iara] ATENÇÃO: headless com IARA_ORIGENS vazio. A interface mora noutro domínio e\n' +
              '       "mesma origem" não existe aqui — nenhum navegador vai conseguir conectar.\n' +
              '       O sintoma é a IARA presa em "reconectando…" sem erro nenhum no painel.\n' +
              '       Declare IARA_ORIGENS com o domínio exato do front.',
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
