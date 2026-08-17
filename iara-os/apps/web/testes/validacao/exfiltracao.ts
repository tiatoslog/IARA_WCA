/**
 * BATERIA — EXFILTRAÇÃO DE SEGREDO EM EXECUÇÃO.
 *
 * A varredura de artefato (`npm run varrer-segredos`) responde "há credencial
 * versionada ou empacotada?". Esta bateria responde outra coisa, e é a pergunta
 * que a auditoria de 17/08 admitiu não ter atacado:
 *
 *     um segredo que este processo CARREGA consegue sair por alguma porta
 *     enquanto a IARA está rodando?
 *
 * O incidente que criou `redigir` é o roteiro: `ANTHROPIC_API_KEY` chegou
 * contaminada, o SDK a pôs num cabeçalho, o `Headers` recusou, e a exceção subiu
 * com a chave INTEIRA na mensagem — que o Kernel publicou como fala. **A
 * operadora leu a credencial no celular dela**, e a captura de tela circulou.
 *
 * O conserto daquele dia foi certeiro sobre o CANAL onde foi lido: `redigir` na
 * saída do socket, sobre o pacote serializado, "porque redigir na origem é uma
 * disciplina que se esquece; redigir na saída é uma propriedade do canal".
 *
 * ESTA BATERIA EXISTE PARA PERGUNTAR SE TODAS AS PORTAS TÊM A PROPRIEDADE. A
 * IARA fala por três hoje: o socket da tela, a resposta do WhatsApp e o jornal em
 * disco. Uma delas não passa por `redigir` — e é a porta do celular, exatamente
 * onde a credencial foi lida em 13/08.
 *
 * O ORÁCULO SÃO OS BYTES QUE SAEM, não a intenção do código: um socket falso que
 * guarda o que foi enviado, um `fetch` substituído que guarda o corpo do POST, e
 * o arquivo do jornal lido do disco depois.
 */

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SessaoOperador } from '../../servidor/barramento/SessaoOperador';
import { entregarTexto } from '../../servidor/canais/WhatsApp';
import { RegistroOperacoes } from '../../servidor/nucleo/kernel/RegistroOperacoes';
import { evidencia } from '../../servidor/nucleo/kernel/Operacao';

/**
 * O segredo de laboratório, montado por concatenação e NUNCA escrito inteiro no
 * código-fonte: um literal com formato de credencial neste arquivo faria a
 * varredura de segredos acusar o próprio teste que existe para proteger segredo.
 */
const SEGREDO_DO_PROCESSO = ['sk', 'ant', 'L4B'.padEnd(64, 'X')].join('-');
/** Um segredo que este processo NÃO tem: chegou num payload de terceiro. */
const SEGREDO_DE_TERCEIRO = ['sk', 'ant', 'T3RC'.padEnd(52, 'Z')].join('-');

export interface CenarioExfiltracao {
  readonly id: string;
  /** Por onde a IARA fala neste cenário. */
  readonly canal: 'socket' | 'whatsapp' | 'jornal';
  /** Como o segredo entrou no texto — o roteiro do vazamento. */
  readonly veiculo: string;
  /** `true` quando o segredo é do processo; `false` quando é de terceiro. */
  readonly do_processo: boolean;
}

export interface JulgamentoExfiltracao {
  readonly cenario: CenarioExfiltracao;
  /** O que efetivamente saiu pela porta. Cortado, nunca omitido. */
  readonly saida: string;
  /** O segredo apareceu em claro nos bytes que saíram? */
  readonly vazou: boolean;
  /** Sobrou marca de redação — prova de que a porta agiu, e não que nada saiu. */
  readonly redigido: boolean;
  /**
   * NADA SAIU PELA PORTA — e isso NÃO é aprovação.
   *
   * Saída vazia significa que o cenário não conseguiu fazer a IARA falar: o
   * oráculo ficou cego, e cego não confirma segurança. Contado à parte e nunca
   * somado aos limpos, pela mesma razão que `ESTADO_DESCONHECIDO` existe na
   * campanha. Foi o que aconteceu na primeira rodada desta bateria — o cenário do
   * jornal devolveu string vazia porque a chamada estava errada, e sem esta
   * distinção o relatório teria dito "o jornal não vaza".
   */
  readonly cego: boolean;
}

export function catalogoExfiltracao(): readonly CenarioExfiltracao[] {
  return [
    {
      id: 'socket-fala-com-excecao',
      canal: 'socket',
      veiculo: 'a mensagem de uma exceção virou texto de pacote — o incidente de 13/08',
      do_processo: true,
    },
    {
      id: 'socket-log-tecnico',
      canal: 'socket',
      veiculo: 'linha de console técnico enviada à tela',
      do_processo: true,
    },
    {
      id: 'socket-segredo-de-terceiro',
      canal: 'socket',
      veiculo: 'credencial de terceiro que apareceu num payload e este processo nunca teve',
      do_processo: false,
    },
    {
      id: 'whatsapp-fala',
      canal: 'whatsapp',
      veiculo: 'a resposta do turno saiu pelo celular, que é onde a credencial foi lida em 13/08',
      do_processo: true,
    },
    {
      id: 'whatsapp-segredo-de-terceiro',
      canal: 'whatsapp',
      veiculo: 'credencial de terceiro na resposta que sai pelo celular',
      do_processo: false,
    },
    {
      id: 'jornal-parametro',
      canal: 'jornal',
      veiculo: 'o operador colou uma credencial no pedido e ela virou parâmetro de operação',
      do_processo: true,
    },
  ];
}

// ---------------------------------------------------------------------------

const MARCA_DE_REDACAO = /\[REDIGIDO/;

/** Socket falso: só guarda o que foi enviado. É o oráculo do canal da tela. */
class SocketFalso {
  readonly enviados: string[] = [];
  readyState = 1;
  send(dado: string): void {
    this.enviados.push(dado);
  }
  close(): void {}
}

/** O tipo que a `SessaoOperador` espera, sem arrastar o `ws` inteiro para cá. */
type SocketDaSessao = ConstructorParameters<typeof SessaoOperador>[0];

async function cenarioSocket(c: CenarioExfiltracao, segredo: string): Promise<string> {
  const socket = new SocketFalso();
  const sessao = new SessaoOperador(socket as unknown as SocketDaSessao);

  if (c.id === 'socket-log-tecnico') {
    sessao.emitirLog('alerta', `falha ao subir provedor: x-api-key inválido (${segredo})`);
  } else {
    sessao.emitirErro(
      `Não consegui falar com a nuvem: Headers.append recusou o valor "${segredo}".`,
    );
  }

  /* A drenagem é agendada, não imediata: sem ceder o laço, o pacote ainda está
     na fila e o teste mediria silêncio como segurança. */
  await new Promise((r) => setTimeout(r, 60));
  return socket.enviados.join('\n');
}

async function cenarioWhatsapp(segredo: string): Promise<string> {
  const original = globalThis.fetch;
  let corpo = '';
  globalThis.fetch = (async (_url: string, init?: { body?: string }) => {
    corpo = init?.body ?? '';
    return {
      ok: true,
      status: 200,
      async json() {
        return { messages: [{ id: 'wamid.LAB' }] };
      },
      async text() {
        return '';
      },
    };
  }) as unknown as typeof fetch;

  try {
    await entregarTexto(
      '5565999999999',
      `Pronto. O provedor recusou a credencial "${segredo}" — confira no painel.`,
      'chave-de-laboratorio',
    );
  } finally {
    globalThis.fetch = original;
  }
  return corpo;
}

async function cenarioJornal(segredo: string): Promise<string> {
  const raiz = mkdtempSync(path.join(tmpdir(), 'iara-exfil-'));
  const registro = new RegistroOperacoes(raiz);

  /* `reservar` é SÍNCRONO de propósito (ver o comentário dele: um `await` no meio
     do teste-e-ação é onde a duplicata nasce) e NÃO grava — quem grava é
     `marcar`, que põe o disco antes da memória. Sem a transição, o jornal fica
     vazio e a bateria mediria silêncio: foi o primeiro resultado desta bateria, e
     é o que o campo `cego` existe para nunca deixar passar por "não vaza". */
  const reserva = registro.reservar({
    habilidade: 'enviar_whatsapp',
    parametros: { telefone: '5565999999999', texto: `minha chave é ${segredo}` },
    id_usuario: 'operador-de-exfiltracao',
    sessao: 'exfiltracao',
    risco: 'alto',
    semantica: 'escrita_nao_idempotente',
    origem_pedido: 'lab',
  });
  await registro.marcar(
    reserva.operacao.id_operacao,
    'aguardando_autorizacao',
    evidencia('operador', 'cenário de laboratório da bateria de exfiltração'),
  );

  /* Lê o DIRETÓRIO, não um nome de arquivo esperado: se o jornal mudar de nome,
     um `readFile` que falha devolveria string vazia e a bateria concluiria "não
     vazou" por não ter conseguido olhar. Oráculo cego não confirma nada. */
  const { readdirSync } = await import('node:fs');
  const arquivos = readdirSync(raiz);
  return arquivos
    .map((n) => {
      try {
        return `--- ${n} ---\n${readFileSync(path.join(raiz, n), 'utf8')}`;
      } catch {
        return '';
      }
    })
    .join('\n');
}

export async function medirExfiltracao(
  cenarios: readonly CenarioExfiltracao[] = catalogoExfiltracao(),
): Promise<readonly JulgamentoExfiltracao[]> {
  const anterior = { ...process.env };
  /* O segredo do processo entra no ambiente porque é isso que `redigir` usa como
     camada exata. Restaurado no `finally` — um teste que suja o ambiente do
     processo derruba os outros. */
  process.env.ANTHROPIC_API_KEY = SEGREDO_DO_PROCESSO;
  process.env.WHATSAPP_TOKEN = 'token-de-laboratorio-nao-e-segredo-real';
  process.env.WHATSAPP_PHONE_ID = '1234567890';

  const julgamentos: JulgamentoExfiltracao[] = [];
  try {
    for (const c of cenarios) {
      const segredo = c.do_processo ? SEGREDO_DO_PROCESSO : SEGREDO_DE_TERCEIRO;
      const saida =
        c.canal === 'socket'
          ? await cenarioSocket(c, segredo)
          : c.canal === 'whatsapp'
            ? await cenarioWhatsapp(segredo)
            : await cenarioJornal(segredo);

      julgamentos.push({
        cenario: c,
        saida: saida.slice(0, 400),
        vazou: saida.includes(segredo),
        redigido: MARCA_DE_REDACAO.test(saida),
        cego: saida.trim().length === 0,
      });
    }
  } finally {
    process.env = anterior;
  }
  return julgamentos;
}

export interface TaxasExfiltracao {
  readonly portas: number;
  readonly vazamentos: number;
  readonly cegos: number;
  readonly portas_que_vazam: readonly string[];
  readonly taxa: number;
}

export function taxasExfiltracao(js: readonly JulgamentoExfiltracao[]): TaxasExfiltracao {
  const vazaram = js.filter((j) => j.vazou);
  const cegos = js.filter((j) => j.cego);
  return {
    portas: js.length,
    vazamentos: vazaram.length,
    cegos: cegos.length,
    portas_que_vazam: [...new Set(vazaram.map((j) => j.cenario.canal))],
    /* Denominador = cenários que de fato produziram saída. Contar os cegos como
       limpos melhoraria a taxa a cada cenário que parasse de funcionar. */
    taxa: js.length - cegos.length === 0 ? 1 : vazaram.length / (js.length - cegos.length),
  };
}

/**
 * Zero, sem tolerância e sem discussão. Não existe "taxa aceitável de vazamento
 * de credencial": um segredo que saiu uma vez saiu para sempre, e a única
 * pergunta que sobra é quantas pessoas leram.
 */
export function violacoesDeExfiltracao(
  js: readonly JulgamentoExfiltracao[],
): readonly string[] {
  return js
    .filter((j) => j.vazou)
    .map(
      (j) =>
        `segredo saiu em claro pelo canal "${j.cenario.canal}" (${j.cenario.id}): ${j.cenario.veiculo}`,
    );
}
