/**
 * O LADO DO COMPUTADOR no pareamento — como esta máquina consegue, sozinha, a
 * credencial que a `PonteDispositivos` vai exigir dela.
 *
 * É o cliente das duas rotas de `servidor/principal.ts`. O ciclo inteiro cabe
 * em três frases: pede um código, mostra na tela, e fica perguntando se já
 * aprovaram. Nenhuma senha é digitada nesta máquina — a autoridade mora do outro
 * lado, na tela que já está logada.
 *
 * POR QUE UM ARQUIVO SEPARADO de `credencial.ts`. Aquele módulo responde "onde
 * fica e como se lê a sessão deste computador"; este responde "como ela nasce".
 * A separação foi anunciada no cabeçalho de lá antes de existir, e mantê-la é o
 * que permite ao braço não saber de qual das duas formas o arquivo foi
 * preenchido.
 *
 * CLASSIFICAÇÃO NA FRONTEIRA: ESTADO INTERNO, pelo mesmo raciocínio que
 * `credencial.ts` — e o raciocínio precisa ser refeito aqui, não herdado. A
 * pergunta de `Fronteira.ts` é "alguém fora da IARA percebe?". Este módulo faz
 * dois POST, e os dois são contra o MOTOR DA PRÓPRIA IARA: o primeiro cria uma
 * linha efêmera na memória daquele processo, o segundo lê uma resposta. Nenhum
 * terceiro é alcançado, nenhum dado de ninguém é criado ou entregue, e o que
 * muda é a identidade que ESTE processo carrega. É a IARA se apresentando para
 * si mesma. Não abre disco (quem grava é `credencial.ts`), não abre shell, não
 * alcança o `AgenteLocal`.
 */

import { wsDoMotor } from './credencial';

/** O braço não é a primeira coisa a descobrir isto: sem `Origin`, o motor
 *  devolve 403 mudo. Ver o mesmo cuidado no laço de conexão do braço. */
function origemDe(motor: string): string {
  const u = new URL(motor);
  return `${u.protocol}//${u.host}`;
}

export interface PedidoDePareamento {
  /** Já formatado para leitura humana: `H7K2-9QP4`. */
  readonly codigo: string;
  readonly chave: string;
  readonly expira_em: number;
  readonly intervalo_s: number;
}

/**
 * OS DOIS LINKS DO MESMO CÓDIGO, e por que são dois.
 *
 * `linkDoPareamento` é o que o CELULAR abre: `/?parear=` cai na gaveta
 * Dispositivos com o código preenchido, faltando só o toque em "Autorizar".
 * É o conteúdo do QR.
 *
 * `linkDoConvite` é o que o COMPUTADOR NOVO abre: `/?convite=` faz a interface
 * da IARA mostrar o próprio QR num popover com a cara do aplicativo — em vez
 * de um desenho ASCII num terminal ou um PNG num visualizador avulso. O
 * popover só EXIBE; autorizar continua exigindo a sessão logada do celular.
 *
 * O hífen do código sai da URL nos dois: ele existe para olhos, e um `-` a
 * menos é um caractere a menos para o QR carregar.
 */
export function linkDoPareamento(motor: string, codigo: string): string {
  return `${motor.replace(/\/+$/, '')}/?parear=${codigo.replace(/-/g, '')}`;
}

export function linkDoConvite(motor: string, codigo: string): string {
  return `${motor.replace(/\/+$/, '')}/?convite=${codigo.replace(/-/g, '')}`;
}

export class PareamentoRecusado extends Error {}

async function postar(
  motor: string,
  caminho: string,
  corpo: unknown,
): Promise<{ status: number; dados: Record<string, unknown> }> {
  const base = motor.replace(/\/+$/, '');
  const resposta = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origemDe(motor) },
    body: JSON.stringify(corpo),
  });
  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    /* Resposta sem JSON (proxy no meio, 502 em HTML): o status já conta a
       história, e um parser que explode aqui esconderia o que aconteceu. */
  }
  return { status: resposta.status, dados };
}

/**
 * Abre o pedido. Valida o endereço ANTES de sair à rede — `wsDoMotor` lança
 * para um endereço malformado, e ouvir isso agora é melhor que ouvir
 * `ECONNREFUSED` daqui a dois minutos de tentativas.
 */
export async function pedirCodigo(
  motor: string,
  maquina: { nome: string; plataforma: string; versao: string },
): Promise<PedidoDePareamento> {
  wsDoMotor(motor);

  const { status, dados } = await postar(motor, '/parear/pedir', maquina);

  if (status === 503 || status === 429) {
    // O motor explicou por escrito; repetir a frase dele é melhor que traduzir.
    throw new PareamentoRecusado(String(dados.erro ?? 'o motor recusou o pedido agora'));
  }
  if (status === 403) {
    throw new PareamentoRecusado(
      `o motor em ${motor} recusou a origem deste pedido — confira se o endereço é o mesmo ` +
        'domínio em que a IARA está publicada',
    );
  }
  if (status !== 200 || typeof dados.codigo !== 'string' || typeof dados.chave !== 'string') {
    throw new PareamentoRecusado(
      `o motor em ${motor} respondeu ${status} a um pedido de pareamento — ` +
        'esta versão da IARA pode ser anterior ao pareamento',
    );
  }

  return {
    codigo: dados.codigo,
    chave: dados.chave,
    expira_em: typeof dados.expira_em === 'number' ? dados.expira_em : Date.now() + 5 * 60_000,
    intervalo_s: typeof dados.intervalo_s === 'number' ? dados.intervalo_s : 3,
  };
}

export interface CredencialPareada {
  readonly token_dispositivo: string;
  readonly email: string;
}

/**
 * Fica perguntando até alguém aprovar, o prazo vencer ou o processo morrer.
 *
 * Devolve `null` quando o prazo venceu — que NÃO é erro: é o caso normal de
 * quem pediu o código e foi almoçar. Quem chama pede outro e mostra de novo.
 *
 * Falha de rede no meio da espera não interrompe o laço. O computador da
 * operadora perde Wi-Fi, e desistir do pareamento por causa disso obrigaria a
 * recomeçar com um código novo — quando o que ela precisa é que o programa
 * continue esperando, como qualquer outra tela de "aguardando confirmação".
 */
export async function aguardarAprovacao(
  motor: string,
  pedido: PedidoDePareamento,
  aoTentar?: (segundosRestantes: number) => void,
): Promise<CredencialPareada | null> {
  const intervaloMs = Math.max(1, pedido.intervalo_s) * 1000;

  while (Date.now() < pedido.expira_em) {
    await new Promise((r) => setTimeout(r, intervaloMs));
    aoTentar?.(Math.max(0, Math.round((pedido.expira_em - Date.now()) / 1000)));

    try {
      const { status, dados } = await postar(motor, '/parear/resgatar', { chave: pedido.chave });
      if (status !== 200) continue;
      if (dados.estado === 'aprovado' && typeof dados.token_dispositivo === 'string') {
        return {
          token_dispositivo: dados.token_dispositivo,
          email: typeof dados.email === 'string' ? dados.email : '',
        };
      }
      /**
       * `desconhecido` significa que o motor não tem mais este pedido: ele
       * expirou lá, ou o processo reiniciou. Insistir com uma chave que já não
       * existe é bater numa porta que ninguém vai abrir — sai do laço e deixa
       * quem chamou pedir um código novo.
       */
      if (dados.estado === 'desconhecido') return null;
    } catch {
      /* Rede caiu. Continua tentando até o prazo — ver o cabeçalho. */
    }
  }
  return null;
}
