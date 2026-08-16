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
import { ponteDispositivos } from './barramento/PonteDispositivos';
import { motorTemMaos } from './nucleo/Braco';
import { persistenciaEmUso } from './nucleo/ClienteSupabase';
import { autenticacaoAtiva, verificarToken } from './nucleo/Autenticacao';
import {
  MAX_BYTES_AUDIO,
  diagnosticoTranscricao,
  extensaoDe,
  transcrever,
  transcricaoDisponivel,
} from './nucleo/Transcricao';
import { formatarCodigo, pareamento } from './nucleo/Pareamento';
import { provedoresDeclarados } from './nucleo/FabricaRaciocinio';
import { ehRotaWhatsapp, tratarWhatsapp } from './canais/PortaWhatsapp';
import { diagnosticoWhatsapp } from './canais/WhatsApp';
import { audioPorHash, diagnosticoVoz } from './nucleo/Voz';
import { iniciarRenovacaoAutomaticaGraph, pararRenovacaoAutomaticaGraph } from './nucleo/ClienteGraph';
import { estadoDaChave } from './nucleo/kernel/Prova';
import { conferirAmbiente } from './nucleo/kernel/Configuracao';

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
 * A porta dos BRAÇOS. Separada de `/barramento` de propósito: são dois
 * protocolos diferentes, com dois formatos de pacote e duas consequências
 * distintas — de um lado entra fala e sai snapshot; do outro entra ordem e sai
 * efeito no computador de alguém. Um caminho só, com um campo dizendo "sou
 * braço", faria a checagem de qual é qual virar responsabilidade de quem lê o
 * pacote, e é assim que um cliente comum acaba conseguindo mandar executar.
 */
const CAMINHO_DISPOSITIVO = '/dispositivo';

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

function responderJson(res: import('node:http').ServerResponse, codigo: number, corpo: unknown): void {
  const bytes = Buffer.from(JSON.stringify(corpo), 'utf8');
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': bytes.length,
    /* Resposta de pareamento nunca entra em cache: ela é um segredo de uso
       único, e um proxy que a guardasse entregaria a credencial ao próximo. */
    'Cache-Control': 'no-store',
  });
  res.end(bytes);
}

/**
 * Corpo JSON pequeno, com teto de bytes CONTADO enquanto chega — não depois.
 *
 * Ler tudo e conferir o tamanho no fim é o que transforma um `Content-Length`
 * mentiroso em memória do motor: quem envia não é obrigado a declarar a verdade,
 * e o único número confiável é o que já entrou.
 */
async function lerCorpoJson(req: IncomingMessage, maxBytes = 4096): Promise<Record<string, unknown> | null> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req) {
    const b = pedaco as Buffer;
    total += b.length;
    if (total > maxBytes) return null;
    pedacos.push(b);
  }
  try {
    const v: unknown = JSON.parse(Buffer.concat(pedacos).toString('utf8'));
    return typeof v === 'object' && v !== null && !Array.isArray(v)
      ? (v as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const textoDe = (v: unknown, padrao: string): string =>
  typeof v === 'string' && v.trim() ? v.trim() : padrao;

/**
 * Corpo BINÁRIO com o mesmo teto contado enquanto chega que o `lerCorpoJson` —
 * e aqui o cuidado importa mais, porque áudio é grande por natureza e um
 * `Content-Length` mentiroso viraria megabytes de memória do motor à disposição
 * de quem mandasse. `null` significa "estourou o teto", nunca "quase lá".
 */
async function lerCorpoBinario(req: IncomingMessage, maxBytes: number): Promise<Buffer | null> {
  const pedacos: Buffer[] = [];
  let total = 0;
  for await (const pedaco of req) {
    const b = pedaco as Buffer;
    total += b.length;
    if (total > maxBytes) return null;
    pedacos.push(b);
  }
  return Buffer.concat(pedacos);
}

/**
 * TRANSCRIÇÃO — o navegador captura, o motor entende.
 *
 * A rota devolve TEXTO e para por aí. Ela não fala com o Kernel, não cria
 * turno, não dispara intenção: o cliente recebe a transcrição e a manda pelo
 * barramento como se tivesse sido digitada. É o que mantém a promessa de que
 * nenhum sistema novo de percepção nasce daqui — a fala entra pela mesma porta
 * do texto, e `Percepcao`, porteiro, jornal e verificador continuam sendo o
 * único caminho até uma ação.
 *
 * Fica fora do Next pela mesma razão do áudio da voz e do pareamento: a chave e
 * o estado vivem na memória deste processo, e em modo headless o Next nem
 * existe aqui.
 */
async function tratarTranscricao(
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    responderJson(res, 405, { erro: 'use POST' });
    return;
  }
  // A MESMA trava de origem do barramento, do pareamento e da porta dos braços.
  if (!origemPermitida(req)) {
    responderJson(res, 403, { erro: 'origem não autorizada' });
    return;
  }
  if (!transcricaoDisponivel()) {
    responderJson(res, 503, {
      erro: 'transcrição desligada neste motor',
      // Dito com todas as letras: sem isto o cliente não tem como distinguir
      // "o motor não transcreve" de "o motor falhou ao transcrever", e cairia
      // no mesmo silêncio ambíguo que custou uma semana no microfone.
      detalhe: 'defina IARA_STT_CHAVE no motor ou continue com o reconhecimento do navegador',
    });
    return;
  }

  /**
   * A identidade vem do TOKEN, nunca de um campo do corpo — é o invariante de
   * `Autenticacao.ts`, e vale aqui pela mesma razão que vale no socket: quem
   * controla o navegador controla o que digita. Em modo local (sem Supabase) o
   * motor já grita na subida que não deve ser exposto; a trava de origem é o
   * que resta, e é o mesmo contrato das outras rotas.
   */
  if (autenticacaoAtiva()) {
    const cabecalho = req.headers.authorization ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : undefined;
    if (!(await verificarToken(token))) {
      responderJson(res, 401, { erro: 'sessão inválida' });
      return;
    }
  }

  const tipo = (req.headers['content-type'] ?? '').split(';')[0].trim();
  if (!extensaoDe(tipo)) {
    responderJson(res, 415, { erro: `formato de áudio não suportado: ${tipo || '(ausente)'}` });
    return;
  }

  const bytes = await lerCorpoBinario(req, MAX_BYTES_AUDIO);
  if (!bytes) {
    responderJson(res, 413, { erro: 'áudio grande demais' });
    return;
  }

  const r = await transcrever(bytes, tipo);
  if (!r.ok) {
    responderJson(res, 502, { erro: r.motivo, ms: r.ms });
    return;
  }
  responderJson(res, 200, { texto: r.texto, ms: r.ms });
}

async function tratarPareamento(
  caminho: string,
  req: IncomingMessage,
  res: import('node:http').ServerResponse,
): Promise<void> {
  if (req.method !== 'POST') {
    responderJson(res, 405, { erro: 'use POST' });
    return;
  }
  /**
   * A MESMA trava de origem do barramento e da porta dos braços, e a tentação
   * de afrouxar aqui é maior que nas outras duas porque quem chama é um
   * programa, não uma página. Cedê-la abriria à internet inteira a rota que
   * emite credenciais de execução. O braço manda `Origin` de propósito — ver
   * `braco/principal.ts`, onde a mesma disciplina já custou um 403 mudo.
   */
  if (!origemPermitida(req)) {
    responderJson(res, 403, { erro: 'origem não autorizada' });
    return;
  }

  const corpo = await lerCorpoJson(req);
  if (!corpo) {
    responderJson(res, 400, { erro: 'corpo inválido' });
    return;
  }

  if (caminho === '/parear/pedir') {
    if (!pareamento.disponivel()) {
      /**
       * 503 e não 400: não é o pedido que está errado, é a instalação que não
       * tem onde guardar a credencial. A frase vai inteira porque quem a lê é
       * quem instalou — e "sem banco" não tem relação aparente com "meu
       * computador não conecta".
       */
      responderJson(res, 503, {
        erro:
          'Esta IARA está sem banco configurado; o pareamento não tem onde ser guardado. ' +
          'Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no motor.',
      });
      return;
    }
    const pedido = pareamento.abrir({
      nome: textoDe(corpo.nome, 'computador'),
      plataforma: textoDe(corpo.plataforma, 'desconhecida'),
      versao: textoDe(corpo.versao, '?'),
    });
    if (!pedido) {
      responderJson(res, 429, { erro: 'muitos pedidos agora; tente de novo em um minuto' });
      return;
    }
    responderJson(res, 200, {
      codigo: formatarCodigo(pedido.codigo),
      chave: pedido.chave,
      expira_em: pedido.expira_em,
      intervalo_s: pedido.intervalo_s,
    });
    return;
  }

  const chave = typeof corpo.chave === 'string' ? corpo.chave : '';
  if (!chave) {
    responderJson(res, 400, { erro: 'sem chave' });
    return;
  }
  const r = pareamento.resgatar(chave);
  if (r.estado !== 'aprovado' || !r.credencial) {
    responderJson(res, 200, { estado: r.estado });
    return;
  }
  responderJson(res, 200, {
    estado: 'aprovado',
    token_dispositivo: r.credencial.token,
    email: r.credencial.email,
    nome_operador: r.credencial.nome,
  });
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
   * FALHA-FECHADA Nº 0 — configuração contaminada. Vem ANTES das outras duas
   * porque as outras duas LEEM configuração para decidir, e decidir a partir de
   * um valor que carrega duas coisas dentro é decidir sobre nada.
   *
   * O incidente que a trouxe: `ANTHROPIC_API_KEY` valia `sk-ant-…\nCRON_SECRET=…`
   * no host, porque alguém colou duas linhas num campo só. O processo subiu
   * feliz, anunciou raciocínio profundo ligado, e falhou em TODA mensagem —
   * cuspindo a credencial na tela da operadora a cada tentativa. Durou dias.
   *
   * Recusar subir é o comportamento certo e não é exagero: a alternativa é um
   * deploy que parece vivo e não atende, que é o modo de falha mais caro que
   * existe. E é falha-fechada de verdade — NENHUM efeito externo acontece antes
   * desta checagem, porque ela roda antes do primeiro `listen`.
   *
   * Ausência continua sendo legítima: sem chave a IARA roda local e diz isso.
   * O que morre aqui é a configuração PRESENTE e INUTILIZÁVEL.
   */
  const problemas = conferirAmbiente();
  if (problemas.length > 0) {
    console.error(
      '[iara] RECUSANDO SUBIR: configuração contaminada ou malformada.\n' +
        problemas.map((p) => `       · ${p.variavel} (${p.gravidade}) ${p.motivo}`).join('\n') +
        '\n\n' +
        '       Uma variável de ambiente carrega EXATAMENTE uma configuração. O erro mais\n' +
        '       comum é colar um bloco de várias linhas no campo de valor de uma variável só\n' +
        '       no painel do host — o painel aceita, e o valor passa a conter as duas.\n' +
        '       Abra o painel, separe uma por campo, e suba de novo.\n\n' +
        '       Nenhum valor foi impresso acima, de propósito: quem lê isto está olhando um\n' +
        '       log, e log é onde credencial fica guardada mais tempo que em qualquer lugar.',
    );
    process.exit(1);
  }

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

  /**
   * Dispara ANTES do `listen`: a primeira troca de credencial por token não
   * precisa esperar a porta abrir, e assim a caixa de entrada já pode estar
   * pronta na primeira requisição em vez de na primeira renovação.
   */
  const statusRenovacaoGraph = iniciarRenovacaoAutomaticaGraph();

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
          /**
           * Onde estão as MÃOS. Sem estes dois campos, um deploy em que ninguém
           * conectou o braço é indistinguível de um deploy saudável — até
           * alguém pedir para abrir o Chrome e ouvir que o computador não está
           * conectado. É a pergunta que o monitor de uptime precisa fazer.
           */
          dispositivos: ponteDispositivos.total(),
          maos_no_motor: motorTemMaos(),
          /**
           * E onde está o CÉREBRO. Mesmo argumento das mãos, aprendido do jeito
           * caro em 15/08/2026: a cota da Anthropic acabou, a IARA passou a
           * responder "não consegui" a tudo, e este endpoint continuou dizendo
           * `ok: true` — porque não conhecia a camada de raciocínio. Lista
           * vazia aqui significa uma IARA que conversa mas não pensa, e isso
           * precisa ser visível de fora, sem login.
           *
           * São APELIDOS de provedor, nunca chave: a leitura é do ambiente e
           * não instancia nem sonda nada — este endpoint é o healthcheck do
           * host, e healthcheck lento é deploy marcado como doente.
           */
          raciocinio: provedoresDeclarados(),
          /**
           * E como a IARA se autentica no Graph — pelo mesmo motivo das mãos e
           * do cérebro. Em 15/08/2026 a planilha da operação parou com
           * "Lifetime validation failed, the token is expired", e de fora o
           * deploy parecia perfeito: o `MS_GRAPH_TOKEN` colado à mão vence em
           * cerca de uma hora e ninguém o renova, enquanto a credencial de app
           * (CLIENT_ID/TENANT_ID/SECRET) renova sozinha para sempre. Esta
           * linha é a diferença entre as duas, visível sem login e sem
           * segredo: é a frase que a própria função de renovação já devolvia
           * para o log de subida.
           */
          graph: statusRenovacaoGraph,
        }),
      );
      return;
    }

    /**
     * PAREAMENTO — as duas únicas rotas do motor sem autenticação, e é assim
     * por construção: quem bate aqui é um computador que AINDA NÃO TEM
     * identidade. Exigir credencial seria exigir o que a rota existe para
     * conceder.
     *
     * O que segura o lugar de uma credencial, então:
     *
     *   · a trava de ORIGEM, a mesma do barramento e da porta dos braços;
     *   · a janela de vazão do `RegistroPareamento` (abrir pedido é de graça);
     *   · o fato de que abrir um pedido não concede NADA. Ele só vira credencial
     *     quando alguém logado aprova o código do outro lado — e a credencial
     *     sai pela chave, que só o computador que abriu o pedido conhece.
     *
     * Ficam fora do Next pela mesma razão do áudio da voz: o estado vive na
     * memória deste processo, e uma rota de API do Next não o alcançaria sem
     * duplicar o estado. Em modo headless o Next nem existe aqui.
     */
    if (caminho === '/parear/pedir' || caminho === '/parear/resgatar') {
      void tratarPareamento(caminho, req, res).catch((e: Error) => {
        console.warn(`[iara] pareamento: ${e.message}`);
        if (!res.headersSent) responderJson(res, 500, { erro: 'falha interna' });
      });
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

    if (caminho === '/transcrever') {
      void tratarTranscricao(req, res).catch((e: Error) => {
        console.warn(`[iara] transcrição: ${e.message}`);
        if (!res.headersSent) responderJson(res, 500, { erro: 'falha interna' });
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

    /**
     * A porta dos braços passa pela MESMA trava de origem do barramento, e não
     * por uma mais frouxa. A tentação de afrouxar aqui é real — um cliente
     * nativo não manda `Origin` sozinho —, e cedê-la seria abrir para a
     * internet inteira justamente a porta que executa coisas no computador de
     * alguém. Quem escreve o braço manda o cabeçalho; ver `braco/principal.ts`.
     */
    if (caminho === CAMINHO_DISPOSITIVO) {
      if (!origemPermitida(req)) {
        console.warn(
          `[iara] braço recusado, origem "${req.headers.origin ?? '(vazia)'}" — ` +
            `autorizadas: ${ORIGENS.length ? ORIGENS.join(', ') : '(nenhuma; só mesma origem)'}`,
        );
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        vivos.add(ws);
        ws.on('pong', () => vivos.add(ws));
        ponteDispositivos.conectar(ws);
      });
      return;
    }

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
    console.log(
      motorTemMaos()
        ? `[iara] mãos: NESTE processo (${process.platform}) — e em qualquer braço que conectar em ${CAMINHO_DISPOSITIVO}`
        : `[iara] mãos: SÓ por braço conectado em ${CAMINHO_DISPOSITIVO}. ` +
            'Sem braço, ação no computador é recusada em voz alta — nunca simulada.',
    );
    console.log(`[iara] ${diagnosticoWhatsapp()}`);
    console.log(`[iara] voz: ${diagnosticoVoz()}`);
    console.log(`[iara] transcrição: ${diagnosticoTranscricao()}`);
    console.log(`[iara] Microsoft Graph: ${statusRenovacaoGraph}`);
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
    pararRenovacaoAutomaticaGraph();
    encerrarResidentes();
    ponteDispositivos.encerrar();
    wss.close();
    servidorHttp.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
}

void subir();
