/**
 * A CREDENCIAL DO BRAÇO — como este computador prova de quem ele é.
 *
 * O PROBLEMA que este arquivo resolve. A `PonteDispositivos` exige o mesmo
 * token do Supabase que uma aba de navegador usaria, e isso está certo: o braço
 * é a porta que EXECUTA, e seria absurdo que ela fosse a única do sistema em
 * que o cliente escolhe de quem é. Só que um access token do Supabase vive uma
 * hora. Enquanto o braço foi `IARA_TOKEN=... npm run braco` num terminal de
 * desenvolvimento isso passou despercebido — quem estava mexendo colava outro.
 * Num computador de operadora, "funcionou de manhã e às onze parou" é um
 * defeito, não uma configuração.
 *
 * A ESCOLHA ORIGINAL: guardar o REFRESH token, não o access token. O refresh é
 * a única coisa que sobrevive ao dia; o access é derivado dele a cada conexão.
 * É a mesma mecânica que o navegador já usa quando a operadora fica logada — só
 * que aqui o dono da sessão é um processo, e não uma aba.
 *
 * O QUE MUDOU (pareamento). A forma preferida hoje é o `token_dispositivo`,
 * emitido pelo motor quando alguém aprova o código deste computador numa tela
 * já logada. Ele não expira, não rotaciona e vale para UMA coisa — a porta dos
 * braços. As duas formas convivem neste arquivo de propósito: uma máquina que
 * entrou por `braco:entrar` antes do pareamento continua funcionando sem que
 * ninguém precise mexer nela, e o dia em que a última delas sumir, o bloco
 * legado sai daqui sem tocar em mais nada.
 *
 * Por que o token de dispositivo é MELHOR e não só mais novo: o refresh token
 * é a sessão inteira da pessoa, gravada em disco de máquina de escritório, para
 * exercer um poder que o braço nunca usa (ler shard, abrir barramento). O token
 * de dispositivo é escopo estreito por construção — e revogável numa linha de
 * tabela, que é o que dá sentido ao botão "desconectar" da aba Dispositivos.
 *
 * ROTAÇÃO (só no caminho legado). O Supabase devolve um refresh NOVO a cada
 * renovação e invalida o anterior. Perder o novo é perder a sessão — por isso a
 * gravação acontece ANTES de qualquer uso do access token, e por isso ela é
 * atômica (arquivo temporário + rename). Um `write` interrompido no meio
 * deixaria este computador deslogado sem ninguém ter feito nada. Esta é
 * exatamente a fragilidade que o token de dispositivo não tem.
 *
 * ONDE FICA. Fora do repositório, no perfil do usuário do sistema
 * operacional — `%APPDATA%\iara\braco.json` no Windows. Não é `.env.local`
 * porque isto não é configuração do projeto: é a sessão de UMA pessoa em UM
 * computador, e ela não deve nem poder ser commitada por acidente.
 *
 * O QUE ISTO NÃO É: pareamento. O fluxo de código curto (o computador mostra o
 * código, o celular já logado aprova) troca só a forma de PREENCHER este
 * arquivo — o resto do braço continua igual, lendo daqui. É de propósito que a
 * fronteira esteja neste ponto, e a previsão se confirmou: quando o pareamento
 * entrou, este módulo ganhou um campo e nenhuma linha do laço de conexão mudou.
 * Quem fala com o motor para conseguir o token é `braco/pareamento.ts`.
 *
 * O QUE ISTO TAMBÉM NÃO É: efeito no mundo. Está declarado como ESTADO INTERNO
 * em `Fronteira.ts`, e a entrada de lá registra por que a classificação como
 * efeito externo foi tentada primeiro e recusada. Em uma linha: o arquivo que
 * esta camada existe para vigiar é a pasta que o operador PEDIU, não a sessão
 * que o programa precisa para existir.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export interface CredencialBraco {
  /**
   * Onde a IARA mora, em HTTP (`https://…`). O braço deriva daqui o endereço do
   * WebSocket. Fica no MESMO arquivo da sessão porque as duas coisas nascem do
   * mesmo ato — "conectar este computador à IARA da minha empresa" — e separá-las
   * produziria a máquina logada numa instalação e apontada para outra.
   */
  readonly motor: string;
  /**
   * A credencial de PAREAMENTO — `iad_…`. Vale só na porta dos braços, não
   * expira e é revogável pela operadora. É a forma preferida; as três abaixo
   * são o caminho legado, mantido para quem já instalou por `braco:entrar`.
   */
  readonly token_dispositivo?: string;
  /** LEGADO. Projeto Supabase que emitiu a sessão. Guardado junto para o braço
   *  não depender de `.env.local` — ele roda no computador da operadora, onde o
   *  repositório pode simplesmente não existir. */
  readonly url_supabase?: string;
  /** LEGADO. Chave `anon`. É pública por desenho (vai no bundle do navegador);
   *  está aqui por conveniência, não por sigilo. */
  readonly chave_anon?: string;
  /** LEGADO. Ver o cabeçalho: rotaciona, e por isso a gravação é atômica. */
  readonly refresh_token?: string;
  readonly email: string;
  readonly atualizado_em: string;
}

/** A forma legada está completa? Meia sessão não serve para nada e vale como
 *  ausência — é o que faz o braço cair no pareamento em vez de tentar renovar
 *  um refresh que não tem para onde ir. */
function sessaoLegadaCompleta(c: Partial<CredencialBraco>): boolean {
  return (
    typeof c.url_supabase === 'string' &&
    typeof c.chave_anon === 'string' &&
    typeof c.refresh_token === 'string'
  );
}

/**
 * `IARA_CREDENCIAL_BRACO` existe para o teste e para quem roda dois braços na
 * mesma máquina com contas diferentes. Sem ela, o caminho é o do sistema.
 */
export function caminhoCredencial(): string {
  const declarado = process.env.IARA_CREDENCIAL_BRACO;
  if (declarado) return declarado;
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'iara', 'braco.json');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'iara', 'braco.json');
}

/** `null` quando não há sessão gravada — é o caso normal do primeiro uso, não erro. */
export function lerCredencial(): CredencialBraco | null {
  try {
    const bruto = JSON.parse(readFileSync(caminhoCredencial(), 'utf8')) as Partial<CredencialBraco>;
    const temDispositivo = typeof bruto.token_dispositivo === 'string' && bruto.token_dispositivo !== '';
    if (!temDispositivo && !sessaoLegadaCompleta(bruto)) return null;
    return {
      motor: typeof bruto.motor === 'string' ? bruto.motor : '',
      ...(temDispositivo ? { token_dispositivo: bruto.token_dispositivo } : {}),
      ...(sessaoLegadaCompleta(bruto)
        ? {
            url_supabase: bruto.url_supabase,
            chave_anon: bruto.chave_anon,
            refresh_token: bruto.refresh_token,
          }
        : {}),
      email: typeof bruto.email === 'string' ? bruto.email : '',
      atualizado_em: typeof bruto.atualizado_em === 'string' ? bruto.atualizado_em : '',
    };
  } catch {
    return null;
  }
}

export function salvarCredencial(c: CredencialBraco): void {
  const caminho = caminhoCredencial();
  mkdirSync(dirname(caminho), { recursive: true });
  const temporario = `${caminho}.novo`;
  /**
   * `0o600` é honesto no Linux/macOS e decorativo no Windows, onde a proteção
   * real vem da ACL do perfil do usuário. Declarar assim mesmo custa nada e
   * evita que a versão portátil deste arquivo nasça com permissão de mundo.
   */
  writeFileSync(temporario, `${JSON.stringify(c, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temporario, caminho);
}

/**
 * DESCARTA a credencial deste computador.
 *
 * Existe por causa de um defeito real (15/08/2026): quando o motor recusava a
 * credencial — revogada no "desconectar", apagada do banco, ou emitida contra
 * outra instalação —, o braço só imprimia "não autorizado" e reconectava para
 * sempre, num laço que nunca refazia o pareamento. A frase que ele mostrava
 * ("autorize o código que aparece aqui") mentia: não havia código nenhum na
 * tela, porque o pareamento só roda quando NÃO existe credencial. A operadora
 * ficava sem saída a não ser baixar o programa de novo.
 *
 * Apagar é o que devolve o programa ao estado de primeira execução, que é
 * exatamente o que ele é quando a credencial não vale mais. Silencioso se o
 * arquivo já não existe — o destino desejado é o mesmo.
 */
export function apagarCredencial(): void {
  try {
    rmSync(caminhoCredencial(), { force: true });
  } catch {
    /* Arquivo travado por outro processo ou permissão negada: o pareamento
       seguinte sobrescreve, e derrubar o programa aqui seria pior. */
  }
}

/**
 * `https://iara.exemplo.com` → `wss://iara.exemplo.com/dispositivo`.
 *
 * O caminho é fixo porque é contrato do motor (`CAMINHO_DISPOSITIVO` em
 * `servidor/principal.ts`), não escolha de quem instala. Pedir a URL do
 * WebSocket inteira à operadora seria transferir para ela um detalhe que só o
 * programa conhece — e um `/dispositivo` esquecido vira um 404 mudo.
 */
export function wsDoMotor(motor: string): string {
  const u = new URL(motor);
  return `${u.protocol === 'https:' ? 'wss:' : 'ws:'}//${u.host}/dispositivo`;
}

export class SessaoExpirada extends Error {}

/**
 * Troca o refresh guardado por um access token novo, e PERSISTE o refresh
 * rotacionado antes de devolver.
 *
 * A ordem importa: gravar depois de conectar deixaria uma janela em que o
 * refresh usado já não vale e o novo ainda não foi salvo — a sessão morreria
 * na próxima queda de rede, sem ninguém ter tocado em nada.
 */
export async function renovarAcesso(c: CredencialBraco): Promise<string> {
  if (!c.url_supabase || !c.chave_anon || !c.refresh_token) {
    /* Só o caminho legado passa por aqui. Uma credencial de pareamento chegando
       nesta função é erro de quem chamou, não estado inválido do arquivo — e
       dizer isso é melhor que devolver um `undefined` que morre na rede. */
    throw new SessaoExpirada('esta credencial não tem sessão renovável do Supabase');
  }
  const resposta = await fetch(`${c.url_supabase.replace(/\/+$/, '')}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { apikey: c.chave_anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: c.refresh_token }),
  });

  if (!resposta.ok) {
    /**
     * 400/401 aqui é sessão revogada ou refresh já consumido — não adianta
     * tentar de novo, e insistir em laço só queima o endpoint de auth. Quem
     * chama transforma isto na frase que manda rodar o login de novo.
     */
    throw new SessaoExpirada(
      `o Supabase recusou a renovação (${resposta.status}); esta sessão precisa ser refeita`,
    );
  }

  const dados = (await resposta.json()) as { access_token?: string; refresh_token?: string };
  if (!dados.access_token) throw new SessaoExpirada('o Supabase respondeu sem access token');

  if (dados.refresh_token && dados.refresh_token !== c.refresh_token) {
    salvarCredencial({ ...c, refresh_token: dados.refresh_token, atualizado_em: new Date().toISOString() });
  }
  return dados.access_token;
}
