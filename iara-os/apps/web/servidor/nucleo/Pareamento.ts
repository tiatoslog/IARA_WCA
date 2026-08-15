/**
 * O PAREAMENTO — como um computador entra para a lista de mãos de um operador
 * sem que ninguém digite senha nele.
 *
 * O PROBLEMA. Até aqui a única forma de dar identidade a um braço era
 * `npm run braco:entrar`: e-mail e senha digitados no terminal da máquina onde
 * o braço ia rodar. Isso funciona para quem tem o repositório e sabe o que é um
 * terminal. Para a operadora que vai receber um link e um programa, é a parede
 * inteira do produto — e, pior, ensina a digitar a senha da conta em qualquer
 * console que peça.
 *
 * O DESENHO é o do WhatsApp Web, invertido em relação à intuição: quem PEDE é a
 * máquina nova, quem APROVA é a tela que já está autenticada. A máquina nova não
 * tem como provar nada — então ela não prova: ela pede um código curto, mostra
 * na tela, e fica esperando. A autoridade vem inteira do outro lado, de uma
 * sessão que o Supabase já verificou.
 *
 * DOIS SEGREDOS, e a separação é o que torna o código curto seguro:
 *
 *   · `codigo` — 8 caracteres, legível em voz alta, digitável no celular. É o
 *     que aparece na tela da máquina nova. Vive minutos.
 *   · `chave` — 32 bytes aleatórios que SÓ a máquina que abriu o pedido conhece.
 *     É com ela que o computador vem buscar a credencial depois da aprovação.
 *
 * Sem essa separação, quem adivinhasse o código levaria a credencial. Com ela,
 * adivinhar o código só permite APROVAR o pareamento de outra pessoa (e para
 * isso é preciso estar logado como ela) — a credencial sai pelo canal de quem
 * provou conhecer a chave.
 *
 * A CREDENCIAL DURÁVEL é nativa da IARA, não um refresh token do Supabase, e a
 * escolha foi tomada contra a alternativa óbvia. Relé do refresh token do
 * navegador foi tentado no papel e recusado por duas razões:
 *
 *   1. o Supabase ROTACIONA o refresh a cada renovação e invalida o anterior —
 *      dois donos do mesmo refresh (a aba e o braço) se derrubam mutuamente, e
 *      o sintoma é a operadora sendo deslogada do aplicativo sozinha;
 *   2. um refresh token é a sessão INTEIRA da pessoa. O braço não precisa dela:
 *      ele precisa provar que este computador é um par autorizado. Dar-lhe a
 *      sessão completa é conceder, num arquivo em disco de máquina de escritório,
 *      poder que ele nunca vai exercer.
 *
 * O token de dispositivo é escopo estreito por construção: a `PonteDispositivos`
 * o aceita, e mais ninguém. Ele não abre o barramento do operador, não lê shard,
 * não vale no Supabase. E ele é REVOGÁVEL numa linha de tabela — que é o que dá
 * sentido ao botão "desconectar" da aba Dispositivos. Revogar um refresh token
 * do Supabase a partir do motor não tem esse caminho limpo.
 *
 * O QUE NÃO MUDA: a identidade continua vindo do servidor. O braço manda um
 * token; quem decide de quem ele é continua sendo este processo, contra um hash
 * guardado no banco. O cliente nunca escolhe quem é — que é o invariante que a
 * `PonteDispositivos` existe para defender.
 */

import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import { supabase } from './ClienteSupabase';
import { LimiteVazao } from './kernel/Seguranca';
/**
 * A grafia do código (alfabeto, normalizar, formatar) mudou para `lib/` em
 * 15/08/2026 — o convite de pareamento é desenhado pelo cliente, e o que os
 * dois lados precisam saber mora no contrato compartilhado. Reexportada abaixo
 * para que nenhum consumidor do kernel precise saber da mudança.
 */
import { ALFABETO_CODIGO as ALFABETO, TAMANHO_CODIGO, normalizarCodigo } from '../../lib/codigoPareamento';

export { normalizarCodigo, formatarCodigo } from '../../lib/codigoPareamento';

/**
 * Cinco minutos. Curto o bastante para que um código abandonado numa tela não
 * fique valendo o dia inteiro; longo o bastante para quem precisa pegar o
 * celular, destravar, abrir o aplicativo e achar a aba.
 */
const VALIDADE_MS = 5 * 60_000;

/** De quanto em quanto tempo o computador volta perguntando. Vai na resposta
 *  para que o intervalo seja decidido aqui e não em cada cliente. */
export const INTERVALO_CONSULTA_S = 3;

/**
 * Teto de pedidos abertos NO PROCESSO. Abrir pedido é de graça e não exige
 * credencial nenhuma — sem teto, um laço enche a memória do motor e, pior,
 * satura o espaço de códigos: com pedidos demais vivos ao mesmo tempo, adivinhar
 * um código deixa de ser improvável. O teto é o que mantém a conta de
 * probabilidade honesta.
 */
const MAX_PEDIDOS_ABERTOS = 200;

/** Mesma disciplina do `ola` do barramento: abrir socket (ou fazer POST) é de
 *  graça, e a defesa mora na janela deslizante. */
const PEDIDOS_POR_MINUTO = 30;
const CONSULTAS_POR_MINUTO = 600;

/**
 * Tentativas de aprovação erradas por operador, por minuto.
 *
 * É a trava que decide o tamanho do código. São 30^8 ≈ 6,5 × 10^11
 * combinações; com 10 tentativas por minuto e 5 minutos de vida, uma força
 * bruta precisaria de mais de um milhão de anos para uma chance razoável — e
 * ainda teria que estar logada como a vítima para tentar.
 */
const APROVACOES_ERRADAS_POR_MINUTO = 10;

export type EstadoPedido = 'aguardando' | 'aprovado' | 'expirado' | 'desconhecido';

export interface PedidoAberto {
  readonly codigo: string;
  readonly chave: string;
  readonly expira_em: number;
  readonly intervalo_s: number;
}

export interface CredencialEmitida {
  readonly token: string;
  readonly id_usuario: string;
  readonly email: string;
  readonly nome: string;
}

export interface DispositivoPareado {
  readonly id_credencial: string;
  readonly id_usuario: string;
  readonly nome: string;
  readonly plataforma: string;
  readonly pareado_em: number;
  readonly ultimo_uso_em: number | null;
}

/** Quem ficou sabendo que um pareamento foi aprovado — a tela que aprovou. */
export interface IdentidadeAprovadora {
  readonly id_usuario: string;
  readonly nome: string;
  readonly email: string;
}

/**
 * O armazém das credenciais duráveis. Interface, e não chamada direta ao
 * Supabase, por uma razão que já custou caro neste repositório: sem ela o único
 * jeito de testar o ciclo de vida do pareamento seria contra um projeto real, e
 * o que não se testa em suíte é o que volta quebrado depois.
 */
export interface RepositorioDispositivos {
  disponivel(): boolean;
  gravar(d: {
    id_credencial: string;
    id_usuario: string;
    nome: string;
    plataforma: string;
    hash_token: string;
  }): Promise<void>;
  /** `null` quando o hash não existe ou a credencial foi revogada. */
  porHash(hash: string): Promise<DispositivoPareado | null>;
  marcarUso(idCredencial: string): Promise<void>;
  listar(idUsuario: string): Promise<DispositivoPareado[]>;
  /** `false` quando a credencial não é deste operador — ver `revogar`. */
  revogar(idUsuario: string, idCredencial: string): Promise<boolean>;
  /** `false` quando a credencial não é deste operador ou já foi revogada. */
  renomear(idUsuario: string, idCredencial: string, novoNome: string): Promise<boolean>;
}

interface Pendente {
  codigo: string;
  chave: string;
  nome: string;
  plataforma: string;
  versao: string;
  expira_em: number;
  aprovado: CredencialEmitida | null;
}

/**
 * O PREFIXO existe para que a `PonteDispositivos` saiba, sem perguntar à rede,
 * qual das duas autoridades consultar. Sem ele, todo braço com token de
 * dispositivo pagaria uma ida ao Supabase Auth para ouvir "não é meu" antes de
 * chegar na tabela certa.
 */
export const PREFIXO_TOKEN = 'iad_';

const hashDe = (token: string): string => createHash('sha256').update(token).digest('hex');

/** Comparação em tempo constante para o código curto. Um `===` vaza o prefixo
 *  correto pelo tempo de resposta, e o espaço aqui é pequeno o bastante para
 *  que isso importe. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

function sortearCodigo(): string {
  let s = '';
  for (let i = 0; i < TAMANHO_CODIGO; i += 1) s += ALFABETO[randomInt(ALFABETO.length)];
  return s;
}

export class RegistroPareamento {
  private readonly pendentes = new Map<string, Pendente>();
  private readonly vazaoPedidos = new LimiteVazao(PEDIDOS_POR_MINUTO, 60_000);
  private readonly vazaoConsultas = new LimiteVazao(CONSULTAS_POR_MINUTO, 60_000);
  /** Uma janela por operador: o erro de um não consome a cota do outro. */
  private readonly vazaoAprovacao = new Map<string, LimiteVazao>();

  constructor(private readonly repositorio: RepositorioDispositivos) {}

  disponivel(): boolean {
    return this.repositorio.disponivel();
  }

  /**
   * Um computador pede para entrar. Não há autenticação nenhuma aqui, e não
   * pode haver: é justamente a máquina que ainda não tem identidade.
   *
   * `null` quando o processo está sob pressão. O chamador transforma isso em
   * 429 — e não em erro genérico, porque "tente daqui a pouco" e "não funciona"
   * são conselhos diferentes.
   */
  abrir(
    dados: { nome: string; plataforma: string; versao: string },
    agora = Date.now(),
  ): PedidoAberto | null {
    this.limpar(agora);
    if (!this.vazaoPedidos.permitir(agora)) return null;
    if (this.pendentes.size >= MAX_PEDIDOS_ABERTOS) return null;

    /**
     * Colisão de código é improvável e não é impossível — e um código repetido
     * faria a aprovação de um pareamento entregar a credencial ao computador
     * errado. Sortear de novo custa nada; descobrir isso em produção custaria a
     * confiança inteira no mecanismo.
     */
    let codigo = sortearCodigo();
    for (let tentativa = 0; this.pendentes.has(codigo) && tentativa < 8; tentativa += 1) {
      codigo = sortearCodigo();
    }
    if (this.pendentes.has(codigo)) return null;

    const chave = randomBytes(32).toString('base64url');
    this.pendentes.set(codigo, {
      codigo,
      chave,
      nome: dados.nome.slice(0, 80),
      plataforma: dados.plataforma.slice(0, 60),
      versao: dados.versao.slice(0, 30),
      expira_em: agora + VALIDADE_MS,
      aprovado: null,
    });

    return { codigo, chave, expira_em: agora + VALIDADE_MS, intervalo_s: INTERVALO_CONSULTA_S };
  }

  /** O que a tela mostra antes de aprovar: qual máquina é esta. */
  descrever(codigoBruto: string, agora = Date.now()): { nome: string; plataforma: string } | null {
    this.limpar(agora);
    const p = this.acharPorCodigo(normalizarCodigo(codigoBruto));
    return p ? { nome: p.nome, plataforma: p.plataforma } : null;
  }

  /**
   * A APROVAÇÃO. Vem de uma sessão já autenticada — `quem` é a identidade que o
   * barramento resolveu, nunca um campo do pacote.
   *
   * Emite a credencial durável e a guarda pendurada no pedido. Ela só sai deste
   * processo pela `resgatar`, para quem apresentar a chave.
   *
   * `nomeEscolhido` (15/08/2026): quem autoriza pode batizar a máquina na
   * mesma tela ("Notebook Daiane", "PC de Casa") em vez de aceitar o hostname
   * e renomear depois. Vazio ou ausente, vale o que o braço reportou — o
   * comportamento de sempre. É só o NOME: a identidade do dono continua vindo
   * da sessão, nunca do pacote.
   */
  async aprovar(
    codigoBruto: string,
    quem: IdentidadeAprovadora,
    agora = Date.now(),
    nomeEscolhido?: string,
  ): Promise<{ ok: true; nome: string } | { ok: false; motivo: string }> {
    this.limpar(agora);

    if (!this.repositorio.disponivel()) {
      return {
        ok: false,
        motivo: 'Esta instalação está sem banco configurado — o pareamento não fica guardado.',
      };
    }

    let janela = this.vazaoAprovacao.get(quem.id_usuario);
    if (!janela) {
      janela = new LimiteVazao(APROVACOES_ERRADAS_POR_MINUTO, 60_000);
      this.vazaoAprovacao.set(quem.id_usuario, janela);
    }

    const codigo = normalizarCodigo(codigoBruto);
    const pedido = codigo.length === TAMANHO_CODIGO ? this.acharPorCodigo(codigo) : null;

    if (!pedido) {
      /**
       * A cota é consumida só no ERRO, e é isso que a torna utilizável: quem
       * digita certo nunca esbarra nela, quem está adivinhando esbarra em dez
       * tentativas. Cobrar do acerto faria uma operadora com três computadores
       * ser barrada por usar o produto.
       */
      if (!janela.permitir(agora)) {
        return { ok: false, motivo: 'Tentativas demais. Espere um minuto e peça um código novo.' };
      }
      return { ok: false, motivo: 'Esse código não confere ou já expirou. Peça um novo no computador.' };
    }

    if (pedido.aprovado) {
      /**
       * Uso único: o segundo "autorizar" no mesmo código não emite uma segunda
       * credencial. Duplo clique é o caso comum, e ele não pode deixar uma
       * credencial órfã viva no banco para sempre.
       *
       * QUEM aprovou entra na condição, e essa linha fechou um defeito real
       * encontrado na auditoria de 13/08/2026. Sem ela, um segundo operador que
       * mandasse o mesmo código recebia `ok: true` com o NOME da máquina alheia:
       *
       *   · falso sucesso — a tela dele dizia "PC-DA-ANA conectado" enquanto a
       *     lista de dispositivos dele continuava vazia. Nenhuma credencial
       *     vazava (o token exige a chave), mas a afirmação era mentira, e
       *     mentira com selo de sucesso é o que este kernel inteiro combate;
       *   · oráculo entre operadores — ele confirmava que aquele código existia
       *     e aprendia o nome do computador de outra pessoa, sem pagar cota,
       *     porque o caminho de acerto não consome a janela de erro.
       *
       * Para quem não é o dono, isto agora é indistinguível de um código
       * errado: mesma frase, mesma cota. É a mesma disciplina de
       * `verificarToken`, que não separa expirado de inexistente para não virar
       * oráculo de contas válidas.
       */
      if (pedido.aprovado.id_usuario !== quem.id_usuario) {
        if (!janela.permitir(agora)) {
          return { ok: false, motivo: 'Tentativas demais. Espere um minuto e peça um código novo.' };
        }
        return { ok: false, motivo: 'Esse código não confere ou já expirou. Peça um novo no computador.' };
      }
      return { ok: true, nome: pedido.nome };
    }

    const token = `${PREFIXO_TOKEN}${randomBytes(32).toString('base64url')}`;
    const idCredencial = randomBytes(16).toString('hex');

    /* Mesmo teto e mesma limpeza de `renomear`: o nome é da operadora, mas o
       tamanho é do banco. */
    const batismo = (nomeEscolhido ?? '').trim().slice(0, 80);
    const nomeDaMaquina = batismo || pedido.nome;

    await this.repositorio.gravar({
      id_credencial: idCredencial,
      id_usuario: quem.id_usuario,
      nome: nomeDaMaquina,
      plataforma: pedido.plataforma,
      hash_token: hashDe(token),
    });

    pedido.aprovado = {
      token,
      id_usuario: quem.id_usuario,
      email: quem.email,
      nome: quem.nome,
    };
    return { ok: true, nome: nomeDaMaquina };
  }

  /**
   * O computador vem buscar. Apresenta a CHAVE, não o código — e é por isso que
   * saber o código não basta para levar a credencial.
   *
   * Entrega UMA vez: o pedido some do mapa junto com a resposta. Uma segunda
   * consulta com a mesma chave devolve `desconhecido`, que é a verdade — aquele
   * pedido não existe mais.
   */
  resgatar(
    chave: string,
    agora = Date.now(),
  ): { estado: EstadoPedido; credencial?: CredencialEmitida } {
    this.limpar(agora);
    if (!this.vazaoConsultas.permitir(agora)) return { estado: 'aguardando' };

    for (const pedido of this.pendentes.values()) {
      if (!iguais(pedido.chave, chave)) continue;
      if (!pedido.aprovado) return { estado: 'aguardando' };
      this.pendentes.delete(pedido.codigo);
      return { estado: 'aprovado', credencial: pedido.aprovado };
    }
    return { estado: 'desconhecido' };
  }

  /**
   * Quem é este braço? Devolve `null` para qualquer token que não seja uma
   * credencial viva — sem distinguir "nunca existiu" de "foi revogada", pela
   * mesma razão que `verificarToken` não distingue expirado de inexistente.
   */
  async verificar(token: string | undefined): Promise<DispositivoPareado | null> {
    if (!token || !token.startsWith(PREFIXO_TOKEN)) return null;
    const registro = await this.repositorio.porHash(hashDe(token));
    if (!registro) return null;
    /* O carimbo de uso é o que alimenta a coluna "última sessão" da aba
       Dispositivos. Falhar aqui não pode impedir um computador de conectar: a
       tabela é o registro, o socket é o produto. */
    void this.repositorio.marcarUso(registro.id_credencial).catch(() => undefined);
    return registro;
  }

  listar(idUsuario: string): Promise<DispositivoPareado[]> {
    return this.repositorio.listar(idUsuario);
  }

  /**
   * Revogação. O `id_usuario` vem da sessão e entra na condição da escrita —
   * não é conferido antes e aplicado depois. Uma checagem em dois tempos é onde
   * mora a corrida que deixa alguém revogar a credencial de outro operador.
   */
  revogar(idUsuario: string, idCredencial: string): Promise<boolean> {
    return this.repositorio.revogar(idUsuario, idCredencial);
  }

  /**
   * O NOME É DA OPERADORA, NÃO DO HOSTNAME. Etapa 4 (14/08/2026) — a gaveta
   * só mostrava o que o braço reportou sozinho (`hostname()`, geralmente algo
   * como "DESKTOP-7F2A"), e não havia onde trocar isso por "meu notebook" ou
   * "PC da recepção". Mesma disciplina de `revogar`: `idUsuario` entra na
   * condição da escrita, nunca é conferido antes e aplicado depois.
   */
  renomear(idUsuario: string, idCredencial: string, novoNome: string): Promise<boolean> {
    const limpo = novoNome.trim().slice(0, 80);
    if (!limpo) return Promise.resolve(false);
    return this.repositorio.renomear(idUsuario, idCredencial, limpo);
  }

  private acharPorCodigo(codigo: string): Pendente | null {
    for (const p of this.pendentes.values()) if (iguais(p.codigo, codigo)) return p;
    return null;
  }

  /**
   * Varredura preguiçosa, chamada por toda entrada pública em vez de por um
   * `setInterval`. Um timer para isto acordaria o event loop para sempre num
   * processo que passa a maior parte do tempo sem nenhum pareamento aberto — é a
   * mesma decisão da drenagem sob demanda da `SessaoOperador`.
   */
  private limpar(agora: number): void {
    for (const [codigo, p] of this.pendentes) if (p.expira_em <= agora) this.pendentes.delete(codigo);
  }

  /** Só para a suíte: quantos pedidos estão vivos agora. */
  get abertos(): number {
    return this.pendentes.size;
  }
}

// ---------------------------------------------------------------------------
// O repositório de produção
// ---------------------------------------------------------------------------

interface LinhaDispositivo {
  id_credencial: string;
  id_usuario: string;
  nome: string;
  plataforma: string;
  pareado_em: string;
  ultimo_uso_em: string | null;
}

const daLinha = (l: LinhaDispositivo): DispositivoPareado => ({
  id_credencial: l.id_credencial,
  id_usuario: l.id_usuario,
  nome: l.nome,
  plataforma: l.plataforma,
  pareado_em: Date.parse(l.pareado_em) || 0,
  ultimo_uso_em: l.ultimo_uso_em ? Date.parse(l.ultimo_uso_em) || null : null,
});

/**
 * Supabase, com a `service_role`. O hash do token nunca sai daqui e o token
 * puro nunca entra: o que a tabela guarda não serve para se passar por um
 * dispositivo, nem para quem tiver o banco inteiro.
 */
class RepositorioSupabase implements RepositorioDispositivos {
  disponivel(): boolean {
    return supabase() !== null;
  }

  async gravar(d: {
    id_credencial: string;
    id_usuario: string;
    nome: string;
    plataforma: string;
    hash_token: string;
  }): Promise<void> {
    const bd = supabase();
    if (!bd) throw new Error('sem banco configurado');
    const { error } = await bd.from('dispositivos_pareados').insert({
      id_credencial: d.id_credencial,
      id_usuario: d.id_usuario,
      nome: d.nome,
      plataforma: d.plataforma,
      hash_token: d.hash_token,
    });
    if (error) throw new Error(error.message);
  }

  async porHash(hash: string): Promise<DispositivoPareado | null> {
    const bd = supabase();
    if (!bd) return null;
    const { data, error } = await bd
      .from('dispositivos_pareados')
      .select('id_credencial,id_usuario,nome,plataforma,pareado_em,ultimo_uso_em')
      .eq('hash_token', hash)
      .is('revogado_em', null)
      .maybeSingle();
    if (error || !data) return null;
    return daLinha(data as LinhaDispositivo);
  }

  async marcarUso(idCredencial: string): Promise<void> {
    const bd = supabase();
    if (!bd) return;
    await bd
      .from('dispositivos_pareados')
      .update({ ultimo_uso_em: new Date().toISOString() })
      .eq('id_credencial', idCredencial);
  }

  async listar(idUsuario: string): Promise<DispositivoPareado[]> {
    const bd = supabase();
    if (!bd) return [];
    const { data, error } = await bd
      .from('dispositivos_pareados')
      .select('id_credencial,id_usuario,nome,plataforma,pareado_em,ultimo_uso_em')
      .eq('id_usuario', idUsuario)
      .is('revogado_em', null)
      .order('pareado_em', { ascending: false });
    if (error || !data) return [];
    return (data as LinhaDispositivo[]).map(daLinha);
  }

  async revogar(idUsuario: string, idCredencial: string): Promise<boolean> {
    const bd = supabase();
    if (!bd) return false;
    const { data, error } = await bd
      .from('dispositivos_pareados')
      .update({ revogado_em: new Date().toISOString() })
      /* As duas condições na MESMA escrita. Ler o dono e depois escrever seria
         a janela em que a linha muda de mãos entre os dois passos. */
      .eq('id_credencial', idCredencial)
      .eq('id_usuario', idUsuario)
      .is('revogado_em', null)
      .select('id_credencial');
    if (error || !data) return false;
    return data.length > 0;
  }

  async renomear(idUsuario: string, idCredencial: string, novoNome: string): Promise<boolean> {
    const bd = supabase();
    if (!bd) return false;
    const { data, error } = await bd
      .from('dispositivos_pareados')
      .update({ nome: novoNome })
      .eq('id_credencial', idCredencial)
      .eq('id_usuario', idUsuario)
      .is('revogado_em', null)
      .select('id_credencial');
    if (error || !data) return false;
    return data.length > 0;
  }
}

/** Instância única do processo — os pedidos abertos são do motor, não da sessão. */
export const pareamento = new RegistroPareamento(new RepositorioSupabase());
