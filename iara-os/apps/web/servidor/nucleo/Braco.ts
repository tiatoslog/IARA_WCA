/**
 * O BRAÇO — o gerente de execução.
 *
 * Entre "a IARA decidiu agir" e "algo aconteceu no computador" havia uma
 * chamada de função. Este arquivo é o reconhecimento de que ali existe uma
 * REDE, e de tudo que decorre disso.
 *
 * O QUE ELE RESOLVE, e por que cada peça precisa existir:
 *
 *  IDENTIDADE (`execucao_id`) — sem um número que atravesse a cadeia inteira, a
 *  pergunta "por que a IARA não abriu o Chrome?" só tem resposta por dedução.
 *  Com ele, a resposta é uma consulta: o pedido parou em `enviada_ao_dispositivo`
 *  e nunca virou `recebida_pelo_dispositivo` — logo, o braço não leu.
 *
 *  ESTADOS — `sucesso: true` é a mentira mais barata que um sistema distribuído
 *  sabe contar, porque ele é o valor padrão de quem não olhou. Aqui não existe
 *  transição para `sucesso` que não venha de um relato do lado que tem as mãos.
 *
 *  PRAZO — uma ordem sem teto fica em `executando` para sempre quando o cabo
 *  cai, e "para sempre" na tela do operador se parece com travamento.
 *
 *  FILA — as ordens de um operador são serializadas, e isso NÃO é preguiça de
 *  concorrência. A prova de `abrir_aplicativo` é a diferença entre a tabela de
 *  processos antes e depois; duas aberturas em paralelo fazem o "antes" de uma
 *  enxergar o "depois" da outra, e a prova passa a atestar o aplicativo errado.
 *  Serializar é o que mantém a verificação verdadeira. A ordem em que o
 *  operador pediu também é preservada de graça — "abra o bloco de notas e
 *  depois a calculadora" acontece nessa ordem.
 *
 *  IDEMPOTÊNCIA DE TRANSPORTE — a Meta reentrega webhook, o navegador reenvia
 *  ao reconectar, o operador toca no botão duas vezes. Nenhuma dessas
 *  repetições é um segundo pedido. Note que esta é uma camada DIFERENTE da
 *  deduplicação semântica do `RegistroOperacoes`: aquela responde "este EFEITO
 *  já foi produzido?"; esta responde "este PACOTE já chegou?".
 *
 * O QUE ELE NÃO FAZ, e é importante que não faça: não decide se pode. Risco,
 * confirmação, sigilo e autorização acontecem antes, na camada de habilidades e
 * no jornal. O Braço recebe uma ordem já autorizada e responde o que aconteceu
 * com ela.
 */

import {
  ehTerminal,
  novaExecucaoId,
  RETENTAVEL,
  type AcaoDesktop,
  type CodigoErro,
  type EstadoExecucao,
  type OrdemExecucao,
  type RelatoExecucao,
} from '../../lib/execucao';
import { ponteDispositivos, type DispositivoConectado } from '../barramento/PonteDispositivos';
import { executarOrdem } from './ExecutorDesktop';
import { EscolhaDeMaquina, escolhaDeMaquina } from './EscolhaDeMaquina';
import { identidadeBackend } from './IdentidadeBackend';
import type { PacoteBraco } from '../../lib/execucao';

/**
 * O QUE O BRAÇO PRECISA DE UMA PONTE — e nada além disso.
 *
 * Tipar o construtor pela classe concreta obrigaria qualquer teste a levantar
 * um `WebSocketServer` para exercitar um timeout. Duas coisas ruins vêm daí: o
 * teste passa a medir a rede em vez da lógica, e o desenho fica sem a resposta
 * para "o que o gerente de execução realmente depende do transporte?". São dois
 * métodos. Declarar isso é o que mantém a ponte substituível.
 */
export interface PonteDeOrdens {
  /**
   * `alvo` é o `id_dispositivo` que o operador escolheu. Quando vem preenchido,
   * a ponte devolve AQUELA máquina ou `null` — nunca outra. Ver
   * `EscolhaDeMaquina`.
   */
  destinoDe(idUsuario: string, alvo?: string | null): DispositivoConectado | null;
  aoPacote(ouvinte: (d: DispositivoConectado, p: PacoteBraco) => void): () => void;
}

// ---------------------------------------------------------------------------
// Onde estão as mãos
// ---------------------------------------------------------------------------

/**
 * O motor tem as mãos do operador?
 *
 * `IARA_MAOS_LOCAIS=1` afirma que sim; `=0` afirma que não. Sem declaração, o
 * padrão é a plataforma — e a razão é o desenho real da implantação, não uma
 * heurística: o motor publicado roda em Linux, e o motor de desenvolvimento
 * roda no Windows de quem está mexendo nele. Um contêiner Linux nunca é o
 * computador do operador; um Windows rodando o motor quase sempre é.
 *
 * O erro que este padrão evita é o de UM LADO SÓ. Assumir mãos onde não há
 * produz a mentira que este trabalho inteiro existe para eliminar ("abri o
 * Chrome" num servidor sem tela). Assumir que não há onde existem produz apenas
 * um "seu computador não está conectado" que o operador resolve declarando a
 * variável. Falhar para o lado da recusa é o certo.
 */
export function motorTemMaos(): boolean {
  const declarado = process.env.IARA_MAOS_LOCAIS;
  if (declarado === '1') return true;
  if (declarado === '0') return false;
  return process.platform === 'win32';
}

// ---------------------------------------------------------------------------
// Prazos
// ---------------------------------------------------------------------------

/**
 * Teto por ação, medido do envio.
 *
 * Não é um número só porque as ações não custam a mesma coisa: a captura de
 * tela carrega `System.Drawing` na primeira chamada e leva segundos numa
 * máquina fria, enquanto listar uma pasta é instantâneo. Um teto único ou
 * derruba a captura legítima ou deixa a listagem pendurada tempo demais.
 */
const PRAZO_MS: Record<AcaoDesktop, number> = {
  abrir_aplicativo: 20_000,
  fechar_aplicativo: 20_000,
  criar_pasta: 10_000,
  /* Escrita local de até 2 MB: o custo é do disco, não da rede. O teto de 15 s
     cobre um HD lento sem deixar a operadora esperando por um `write` travado. */
  criar_arquivo: 15_000,
  renomear_arquivo: 10_000,
  /* Mover pode cair no caminho copiar-e-apagar quando os locais estão em
     volumes diferentes (`EXDEV`) — aí o custo é o do tamanho do arquivo. */
  mover_arquivo: 20_000,
  copiar_arquivo: 20_000,
  listar_arquivos: 10_000,
  capturar_tela: 45_000,
  informacoes_sistema: 10_000,
  /**
   * O maior prazo do quadro depois da captura, e cada segundo tem dono: a sonda
   * de processos gasta 1 s SÓ na janela de amostragem (CPU de processo é taxa,
   * não valor), mais a partida do PowerShell, que numa máquina fria não é
   * barata. Um teto apertado aqui produziria "não consegui medir" justamente na
   * máquina lenta que a medição existe para investigar.
   */
  medir_desempenho: 30_000,
  /**
   * O maior prazo do quadro, e o único que atravessa a INTERNET: um `pull`
   * depende do servidor do outro lado. O executor de git já corta em 60 s; a
   * folga aqui existe para que o prazo do braço não expire ANTES dele — se
   * expirasse, o operador ouviria "não sei o que aconteceu" onde o git tinha uma
   * resposta clara para dar.
   */
  atualizar_repositorio: 75_000,
};

/** Janela em que um pedido idêntico é considerado repetição de pacote, e não
 *  um segundo pedido. Curta: "abre o bloco de notas" de novo um minuto depois
 *  é uma pessoa querendo outra janela. */
const JANELA_IDEMPOTENCIA_MS = 8_000;

/** Quantas linhas de trilha ficam em memória para diagnóstico. */
const TETO_TRILHA = 300;

/** Quantos "último desfecho por (operador, sessão, ação)" ficam guardados. */
const TETO_ULTIMOS = 500;

// ---------------------------------------------------------------------------

export interface PedidoExecucao {
  readonly acao: AcaoDesktop;
  readonly parametros: Record<string, unknown>;
  readonly id_usuario: string;
  readonly sessao: string;
  /** Identidade do pedido de origem, quando existe (id da mensagem, da
   *  operação). Quando ausente, a chave é derivada do conteúdo. */
  readonly chave_idempotencia?: string;
}

export interface LinhaTrilha {
  readonly instante: string;
  readonly execucao_id: string;
  readonly id_usuario: string;
  readonly acao: AcaoDesktop;
  readonly estado: EstadoExecucao;
  readonly alvo: 'dispositivo' | 'motor' | 'nenhum';
  readonly dispositivo: string | null;
  readonly detalhe: string;
  readonly ms: number;
}

interface EmCurso {
  readonly ordem: OrdemExecucao;
  estado: EstadoExecucao;
  readonly inicio: number;
  dispositivo: DispositivoConectado | null;
  resolver: (r: RelatoExecucao) => void;
  relogio: NodeJS.Timeout | null;
}

export class Braco {
  private readonly emCurso = new Map<string, EmCurso>();
  /** Relatos terminais, para responder repetição e diagnóstico. */
  private readonly diario = new Map<string, { relato: RelatoExecucao; em: number }>();
  private readonly porChave = new Map<string, { execucao_id: string; em: number }>();
  /**
   * Pedidos IDÊNTICOS ainda em voo, por chave.
   *
   * O DEFEITO que este mapa fecha, reproduzido com executor espião: `porChave`
   * só é escrito em `fechar`, ou seja, DEPOIS do desfecho. Dois pedidos iguais
   * disparados no mesmo tique — o duplo clique que o cabeçalho deste arquivo diz
   * cobrir, a aba que reenvia ao reconectar, o webhook reentregue antes de o
   * primeiro terminar — passavam os dois por `repeticaoDe` com o mapa vazio e
   * executavam os dois. A fila por operador não salvava: ela SERIALIZA, não
   * deduplica, então o segundo simplesmente esperava a vez e abria a segunda
   * janela.
   *
   * A janela de vulnerabilidade era exatamente a duração da execução — que é o
   * intervalo em que o operador, sem resposta na tela, clica de novo.
   */
  private readonly emVoo = new Map<string, Promise<RelatoExecucao>>();
  /** (operador|sessão|ação) → último relato. Ver `ultimoDe`. */
  private readonly ultimos = new Map<string, RelatoExecucao>();
  /** Cauda de execução por operador. Ver a nota sobre fila no cabeçalho. */
  private readonly filas = new Map<string, Promise<unknown>>();
  private trilha: LinhaTrilha[] = [];

  constructor(
    private readonly ponte: PonteDeOrdens = ponteDispositivos,
    private readonly executarNoMotor = executarOrdem,
    private readonly temMaos = motorTemMaos,
    /* A escolha do operador. Injetada como o resto para o teste poder montar
       um cenário de duas máquinas sem subir socket nenhum. */
    private readonly escolha: EscolhaDeMaquina = escolhaDeMaquina,
  ) {
    this.ponte.aoPacote((dispositivo, pacote) => this.receber(dispositivo, pacote));
  }

  // -------------------------------------------------------------------------
  // Observabilidade
  // -------------------------------------------------------------------------

  private registrar(c: EmCurso, estado: EstadoExecucao, detalhe: string): void {
    c.estado = estado;
    const linha: LinhaTrilha = {
      instante: new Date().toISOString(),
      execucao_id: c.ordem.execucao_id,
      id_usuario: c.ordem.id_usuario,
      acao: c.ordem.acao,
      estado,
      alvo: c.dispositivo ? 'dispositivo' : this.temMaos() ? 'motor' : 'nenhum',
      dispositivo: c.dispositivo?.id_dispositivo ?? null,
      detalhe,
      ms: Date.now() - c.inicio,
    };
    this.trilha.push(linha);
    if (this.trilha.length > TETO_TRILHA) this.trilha = this.trilha.slice(-TETO_TRILHA);
    /**
     * Uma linha JSON por transição, no mesmo canal do resto da auditoria.
     * PARÂMETROS NÃO ENTRAM: o nome de uma pasta é conteúdo do operador, e log
     * é lido por mais gente que o shard. A ação e o estado bastam para
     * responder onde parou.
     */
    /**
     * A IDENTIDADE DO BACKEND VAI JUNTO DE CADA EXECUÇÃO — MD-08, pedido da
     * auditoria de 20/08/2026.
     *
     * O `execution_id` responde "qual ação"; sem o sha ao lado, ele não
     * responde "qual CÓDIGO a executou". Um incidente daqui a três semanas
     * precisa das duas coisas na mesma linha, ou a investigação começa
     * comparando comportamento com um deploy que ninguém sabe qual era.
     *
     * `git_sha_curto` e não o completo: é o que se lê de relance, e o jornal
     * é lido por gente. O completo está no `/saude` para conferir.
     */
    console.log(
      JSON.stringify({
        canal: 'execucao',
        ...linha,
        backend: {
          sha: identidadeBackend.git_sha_curto,
          versao: identidadeBackend.versao,
          ambiente: identidadeBackend.ambiente,
        },
      }),
    );
  }

  /** As últimas execuções, para o diagnóstico e para "por que não funcionou?". */
  trilhaDe(idUsuario: string, quantas = 10): LinhaTrilha[] {
    return this.trilha.filter((l) => l.id_usuario === idUsuario).slice(-quantas);
  }

  relatoDe(execucaoId: string): RelatoExecucao | null {
    return this.diario.get(execucaoId)?.relato ?? null;
  }

  /**
   * O último desfecho de uma ação, para ESTE diálogo.
   *
   * Existe para a quinta porta. `Habilidade.verificar` recebe o
   * `ResultadoHabilidade` — que é o RELATO — e precisa da PROVA, que nasceu no
   * outro lado da ponte. Sem este acesso, a verificação teria duas saídas, as
   * duas ruins: reconferir o disco a partir do motor (o disco errado, quando o
   * motor está na nuvem) ou reler o próprio texto devolvido pela execução —
   * conferir o relato contra o relato, que é justamente o que essa porta existe
   * para impedir.
   *
   * A chave inclui a sessão porque duas conversas do mesmo operador podem ter
   * pedido a mesma ação; a prova de uma não responde pela outra.
   */
  ultimoDe(idUsuario: string, sessao: string, acao: AcaoDesktop): RelatoExecucao | null {
    return this.ultimos.get(`${idUsuario}\0${sessao}\0${acao}`) ?? null;
  }

  // -------------------------------------------------------------------------
  // Entrada
  // -------------------------------------------------------------------------

  /**
   * O caminho inteiro de uma ordem, do pedido ao desfecho.
   *
   * Nunca lança. Toda falha vira um `RelatoExecucao` com estado e código —
   * porque quem chama é uma habilidade, e uma exceção subindo daqui viraria
   * "erro interno" na cara do operador em vez da frase que explica o que houve.
   */
  async executar(pedido: PedidoExecucao): Promise<RelatoExecucao> {
    const chave = pedido.chave_idempotencia ?? this.chaveDe(pedido);
    const repetido = this.repeticaoDe(chave);
    if (repetido) {
      console.log(
        JSON.stringify({
          canal: 'execucao',
          estado: 'duplicada',
          execucao_id: repetido.execucao_id,
          acao: pedido.acao,
          detalhe: 'pedido idêntico dentro da janela; devolvendo o relato original',
        }),
      );
      return { ...repetido, estado: 'duplicada' };
    }

    /**
     * O MESMO pedido ainda em voo. Não executa: pendura-se no desfecho do
     * original e devolve `duplicada`, que é a mesma resposta que a repetição
     * tardia recebe — a diferença entre chegar durante e chegar depois é do
     * relógio, não da intenção.
     */
    const jaVoando = this.emVoo.get(chave);
    if (jaVoando) {
      console.log(
        JSON.stringify({
          canal: 'execucao',
          estado: 'duplicada',
          acao: pedido.acao,
          detalhe: 'pedido idêntico ainda em execução; aguardando o desfecho do original',
        }),
      );
      const original = await jaVoando.catch(() => null);
      if (original) return { ...original, estado: 'duplicada' };
      /**
       * O original morreu de um jeito que ele mesmo não soube relatar. Para
       * ESTE chamador o desfecho é desconhecido — e desconhecido tem nome nesta
       * camada. Repetir aqui seria o retry cego que o `expirou` existe para
       * impedir.
       */
      return {
        execucao_id: 'nao-emitida',
        estado: 'expirou',
        texto:
          'Você pediu isso duas vezes quase ao mesmo tempo. Não repeti a execução, e não consegui ' +
          'ler o desfecho da primeira — confere aí, e se não tiver acontecido é só pedir de novo.',
        prova: {
          confirmado: false,
          evidencia: 'pedido idêntico em voo; a execução original terminou sem relato legível',
          motivo: 'sem_meio_de_verificar',
        },
        codigo_erro: 'EXPIROU',
        duracao_ms: 0,
        dispositivo: null,
        onde: 'nenhum',
      };
    }

    /**
     * A FILA. Cada operador tem uma cauda; a próxima ordem só começa quando a
     * anterior terminou. `catch` na cauda para que uma execução que falhou não
     * envenene a corrente inteira — o desfecho dela já foi relatado a quem
     * pediu, e a próxima não tem nada com isso.
     */
    const anterior = this.filas.get(pedido.id_usuario) ?? Promise.resolve();
    const minha = anterior.catch(() => undefined).then(() => this.despachar(pedido, chave));
    this.filas.set(
      pedido.id_usuario,
      minha.catch(() => undefined),
    );
    // A marca de "em voo" é posta ANTES do primeiro await — é o que fecha a
    // janela em que o segundo pedido idêntico não via nada e seguia adiante.
    this.emVoo.set(chave, minha);

    try {
      return await minha;
    } finally {
      if (this.emVoo.get(chave) === minha) this.emVoo.delete(chave);
      // Solta a cauda quando ela sou eu: sem isto o mapa cresce por operador
      // e a última promessa fica retida para sempre.
      if (this.filas.get(pedido.id_usuario) === minha) this.filas.delete(pedido.id_usuario);
    }
  }

  /**
   * A identidade de transporte de um pedido.
   *
   * O SEPARADOR É `\0`, e a troca não é estética. A forma anterior era
   * `usuario|acao|k1=v1&k2=v2`, e `=`/`&`/`|` são caracteres que um valor de
   * parâmetro pode conter — um `nome` com `&outro=x` dentro produzia a MESMA
   * chave que um pedido de dois parâmetros. Duas ordens diferentes com a mesma
   * chave é a cache devolvendo o relato de outra ação, que é exatamente a
   * mentira com selo de sucesso descrita em `braco/principal.ts`.
   *
   * `\0` não sobrevive a JSON nem a nome de arquivo do Windows, e a
   * serialização canônica (chaves ordenadas, valor via JSON) faz `{a:1,b:2}` e
   * `{b:2,a:1}` coincidirem sem fazer `"1&b=2"` coincidir com nada. É a mesma
   * escolha de `Operacao.derivarChaveIdempotencia`, que já usava `\0` — as duas
   * camadas de idempotência agora concordam sobre o que é "o mesmo pedido".
   */
  private chaveDe(p: PedidoExecucao): string {
    const parametros = JSON.stringify(
      Object.keys(p.parametros)
        .sort()
        .map((k) => [k, p.parametros[k]]),
    );
    return [p.id_usuario, p.acao, parametros].join('\0');
  }

  private repeticaoDe(chave: string): RelatoExecucao | null {
    const agora = Date.now();
    for (const [k, v] of this.porChave) {
      if (agora - v.em > JANELA_IDEMPOTENCIA_MS) this.porChave.delete(k);
    }
    const marca = this.porChave.get(chave);
    if (!marca) return null;
    return this.diario.get(marca.execucao_id)?.relato ?? null;
  }

  // -------------------------------------------------------------------------
  // Despacho
  // -------------------------------------------------------------------------

  private async despachar(pedido: PedidoExecucao, chave: string): Promise<RelatoExecucao> {
    const ordem: OrdemExecucao = {
      execucao_id: novaExecucaoId(),
      acao: pedido.acao,
      parametros: pedido.parametros,
      id_usuario: pedido.id_usuario,
      sessao: pedido.sessao,
      id_dispositivo_alvo: this.escolha.escolhida(pedido.id_usuario),
      prazo_ms: PRAZO_MS[pedido.acao] ?? 15_000,
      emitida_em: Date.now(),
    };

    const c: EmCurso = {
      ordem,
      estado: 'recebida',
      inicio: Date.now(),
      dispositivo: null,
      resolver: () => undefined,
      relogio: null,
    };

    this.registrar(c, 'recebida', 'pedido aceito pelo gerente de execução');
    this.registrar(c, 'validando', 'conferindo destino');

    /**
     * O ALVO MANDA, e o que ele muda é o que NÃO acontece.
     *
     * Sem escolha, tudo segue como antes: a ponte devolve o último que conectou
     * e o motor com mãos é o segundo na fila. Com escolha, existem duas saídas e
     * só duas — a máquina escolhida, ou uma recusa que a nomeia.
     */
    const alvo = this.escolha.escolhida(pedido.id_usuario);
    const dispositivo = this.ponte.destinoDe(pedido.id_usuario, alvo);

    if (alvo && !dispositivo) {
      /**
       * ESCOLHIDA E FORA DO AR — o item 8 da lista da operadora, e o defeito
       * mais perigoso do estado anterior.
       *
       * Antes desta guarda, a ordem caía para outro braço conectado (ou para o
       * motor, quando o processo tinha mãos) e voltava "sucesso". Uma ação
       * FÍSICA acontecia num computador que ninguém escolheu, e nada no relato
       * dizia que a máquina tinha mudado.
       *
       * A recusa NOMEIA a máquina. "Não consegui" sem dizer qual é o que faz o
       * operador tentar de novo às cegas — e tentar de novo, aqui, é a porta da
       * duplicação.
       */
      const nome = this.escolha.nomeEscolhido(pedido.id_usuario) ?? alvo;
      this.registrar(c, 'validando', `alvo ${alvo} escolhido e não conectado`);
      return this.fechar(c, chave, {
        execucao_id: ordem.execucao_id,
        estado: 'dispositivo_ausente',
        texto:
          `Você escolheu trabalhar em "${nome}", e esse computador não está conectado a mim agora. ` +
          'Abra a IARA nele, ou escolha outro no quadro de dispositivos — eu não vou executar em ' +
          'máquina que você não pediu.',
        prova: {
          confirmado: false,
          evidencia: `a máquina escolhida (${alvo}) não está no inventário conectado deste operador`,
          motivo: 'nao_encontrado',
        },
        codigo_erro: 'DESKTOP_OFFLINE',
        duracao_ms: Date.now() - c.inicio,
        dispositivo: null,
        onde: 'nenhum',
      });
    }

    /**
     * A ORDEM DE PREFERÊNCIA, e ela tem uma razão. Um braço conectado ganha do
     * motor com mãos, sempre. Quando os dois existem — que é o caso do loop de
     * desenvolvimento, com `npm run dev` e `npm run braco` na mesma máquina —, a
     * ação acaba acontecendo no mesmo computador de qualquer jeito. Mas o dia em
     * que forem máquinas diferentes, o computador que o operador declarou como
     * dele é o dela, não o que hospeda o processo.
     */
    if (dispositivo) return this.viaDispositivo(c, dispositivo, chave);
    if (this.temMaos()) return this.viaMotor(c, chave);

    /**
     * DESCONECTADO É UM ESTADO REAL, não um erro a ser escondido. Este é o
     * ramo que substitui o comportamento antigo — em que o pedido era executado
     * no contêiner da nuvem e a IARA relatava sucesso de algo que aconteceu na
     * máquina errada, ou o processo simplesmente caía.
     */
    return this.fechar(c, chave, {
      execucao_id: ordem.execucao_id,
      estado: 'dispositivo_ausente',
      texto:
        'Não consigo fazer isso agora: o seu computador não está conectado a mim. ' +
        'Abra o aplicativo da IARA nele e eu executo na hora.',
      prova: {
        confirmado: false,
        evidencia: 'nenhum braço registrado para este operador e o motor não tem as mãos da máquina dele',
        motivo: 'nao_encontrado',
      },
      codigo_erro: 'DESKTOP_OFFLINE',
      duracao_ms: Date.now() - c.inicio,
      dispositivo: null,
      onde: 'nenhum',
    });
  }

  private async viaMotor(c: EmCurso, chave: string): Promise<RelatoExecucao> {
    this.registrar(c, 'executando', 'o motor tem as mãos desta máquina');
    const relato = await this.executarNoMotor(c.ordem, 'motor', null);
    this.registrar(c, relato.estado, relato.prova.evidencia);
    return this.fechar(c, chave, relato);
  }

  private viaDispositivo(
    c: EmCurso,
    dispositivo: DispositivoConectado,
    chave: string,
  ): Promise<RelatoExecucao> {
    c.dispositivo = dispositivo;

    return new Promise<RelatoExecucao>((resolver) => {
      c.resolver = (r) => resolver(this.fechar(c, chave, r));
      this.emCurso.set(c.ordem.execucao_id, c);

      const entregue = dispositivo.enviar({ tipo: 'executar', ordem: c.ordem });
      if (!entregue) {
        /**
         * O socket morreu entre escolher o destino e escrever nele. NADA foi
         * executado — a ordem nem saiu —, então repetir é seguro e é o certo:
         * é o caso do braço que caiu e voltou. Uma tentativa só, no dispositivo
         * que estiver lá agora; insistir em laço seria transformar uma queda
         * numa enxurrada.
         */
        const outro = this.ponte.destinoDe(c.ordem.id_usuario);
        if (outro && outro !== dispositivo && outro.enviar({ tipo: 'executar', ordem: c.ordem })) {
          c.dispositivo = outro;
          this.registrar(c, 'enviada_ao_dispositivo', 'o primeiro destino caiu; reenviada ao braço que reconectou');
        } else {
          this.emCurso.delete(c.ordem.execucao_id);
          this.registrar(c, 'dispositivo_ausente', 'o socket do braço não aceitou a escrita');
          resolver(
            this.fechar(c, chave, {
              execucao_id: c.ordem.execucao_id,
              estado: 'dispositivo_ausente',
              texto:
                'Perdi a conexão com o seu computador bem na hora de mandar o comando. ' +
                'Nada foi executado. Se ele voltar, é só pedir de novo.',
              prova: {
                confirmado: false,
                evidencia: 'a escrita no socket do dispositivo falhou antes do envio',
                motivo: 'nao_encontrado',
              },
              codigo_erro: 'ERRO_DE_REDE',
              duracao_ms: Date.now() - c.inicio,
              dispositivo: dispositivo.id_dispositivo,
              onde: 'nenhum',
            }),
          );
          return;
        }
      } else {
        this.registrar(c, 'enviada_ao_dispositivo', `escrita no socket de ${dispositivo.id_dispositivo}`);
      }

      /**
       * O PRAZO. Ele mede do envio, e o desfecho dele é `expirou` — NÃO
       * `falhou`. A diferença é o núcleo da honestidade desta camada: o braço
       * pode ter aberto o Chrome e morrido antes de contar. Dizer "não
       * consegui" ali seria afirmar um fato negativo que ninguém apurou.
       */
      c.relogio = setTimeout(() => {
        this.emCurso.delete(c.ordem.execucao_id);
        this.registrar(c, 'expirou', `sem desfecho em ${c.ordem.prazo_ms} ms`);
        c.resolver({
          execucao_id: c.ordem.execucao_id,
          estado: 'expirou',
          texto:
            'Mandei o comando para o seu computador e não recebi confirmação a tempo. ' +
            'Não sei dizer se chegou a acontecer — confere aí, e se não tiver acontecido é só pedir de novo.',
          prova: {
            confirmado: false,
            evidencia: `nenhum desfecho em ${c.ordem.prazo_ms} ms; último estado conhecido: ${c.estado}`,
            motivo: 'sem_meio_de_verificar',
          },
          codigo_erro: 'EXPIROU',
          duracao_ms: Date.now() - c.inicio,
          dispositivo: c.dispositivo?.id_dispositivo ?? null,
          onde: 'dispositivo',
        });
      }, c.ordem.prazo_ms);
    });
  }

  // -------------------------------------------------------------------------
  // Retorno do braço
  // -------------------------------------------------------------------------

  private receber(dispositivo: DispositivoConectado, pacote: PacoteBraco): void {
    if (pacote.tipo === 'apresentacao') return;
    /**
     * Pacotes da Etapa 2 (14/08/2026) — o braço se automantendo, não uma
     * execução do catálogo. `PonteDispositivos` já os trata e nunca deveria
     * repassá-los até aqui; o guarda continua porque este método declara
     * aceitar qualquer `PacoteBraco`, e a ternária abaixo lançaria sobre um
     * pacote sem `execucao_id`.
     */
    if (pacote.tipo === 'progresso_atualizacao' || pacote.tipo === 'atualizacao_falhou') return;

    const id = pacote.tipo === 'concluida' ? pacote.relato.execucao_id : pacote.execucao_id;
    const c = this.emCurso.get(id);
    /**
     * Relato para execução que já não está em curso é o caso do braço que
     * respondeu DEPOIS do prazo. Ignorar em silêncio seria perder a informação
     * mais valiosa que existe sobre um timeout — a de que ele era só lentidão.
     */
    if (!c) {
      console.log(
        JSON.stringify({
          canal: 'execucao',
          execucao_id: id,
          estado: 'fora_de_prazo',
          detalhe: `o braço ${dispositivo.id_dispositivo} respondeu depois do prazo; o operador já foi informado`,
        }),
      );
      return;
    }

    /** Relato de outro operador para uma execução minha: descarta. */
    if (c.ordem.id_usuario !== dispositivo.id_usuario) return;

    if (pacote.tipo === 'recebida') {
      this.registrar(c, 'recebida_pelo_dispositivo', 'o braço confirmou a leitura da ordem');
      return;
    }
    if (pacote.tipo === 'executando') {
      this.registrar(c, 'executando', 'o braço começou a executar');
      return;
    }

    if (c.relogio) clearTimeout(c.relogio);
    this.emCurso.delete(id);

    /**
     * O ESTADO VEM DO BRAÇO, e é conferido aqui em vez de aceito. Um relato
     * dizendo `sucesso` com prova não confirmada seria exatamente o falso
     * positivo que esta camada existe para impedir — e ele chegaria pela porta
     * de quem tem toda a legitimidade para falar. Confiar não é o mesmo que
     * não verificar.
     */
    const bruto = pacote.relato;
    /**
     * A REGRA, e ela precisou ficar mais larga do que era.
     *
     * A forma anterior só rebaixava `sucesso` quando a prova vinha
     * `divergente` — de modo que `sucesso` com `nao_encontrado`, e `sucesso`
     * com prova negada e SEM motivo, atravessavam intactos. Reproduzido com um
     * braço mentiroso: os dois viravam `estado: 'sucesso'`, e `resolveu` da
     * habilidade lê exatamente esse campo.
     *
     * Nenhum dos dois é produzível por um executor honesto: `ExecutorDesktop`
     * deriva `ok` da própria prova, e todo `confirmado: false` do `AgenteLocal`
     * carrega motivo. São estados IMPOSSÍVEIS, e estado impossível chegando
     * pela rede é a definição de relato a recusar.
     *
     * A única prova negada que continua compatível com `sucesso` é
     * `sem_meio_de_verificar` — o caso legítimo do aplicativo que já estava
     * aberto, ou da plataforma sem `tasklist`. Ali a IARA de fato agiu e de
     * fato não tem como provar, e é a quinta porta que carrega a ressalva
     * adiante.
     */
    const provaNega =
      !bruto.prova.confirmado && bruto.prova.motivo !== 'sem_meio_de_verificar';
    const coerente: EstadoExecucao =
      bruto.estado === 'sucesso' && provaNega
        ? 'falhou'
        : ehTerminal(bruto.estado)
          ? bruto.estado
          : 'falhou';

    const relato: RelatoExecucao = {
      ...bruto,
      estado: coerente,
      duracao_ms: Date.now() - c.inicio,
      dispositivo: dispositivo.id_dispositivo,
      onde: 'dispositivo',
    };
    this.registrar(c, coerente, bruto.prova.evidencia);
    c.resolver(relato);
  }

  // -------------------------------------------------------------------------

  private fechar(c: EmCurso, chave: string, relato: RelatoExecucao): RelatoExecucao {
    if (c.relogio) clearTimeout(c.relogio);
    const agora = Date.now();
    this.diario.set(relato.execucao_id, { relato, em: agora });
    this.porChave.set(chave, { execucao_id: relato.execucao_id, em: agora });
    this.ultimos.set(`${c.ordem.id_usuario}\0${c.ordem.sessao}\0${c.ordem.acao}`, relato);
    /**
     * Teto do mapa de últimos desfechos. Ele é indexado por (operador, sessão,
     * ação) e nada o esvaziava: em modo local o `id_usuario` vem de um campo que
     * o cliente digita, e um laço de conexões com ids diferentes fazia o mapa
     * crescer sem credencial nenhuma. `Map` preserva ordem de inserção, então a
     * entrada mais antiga é a primeira — descartá-la custa a prova de uma
     * conversa que já não está em curso.
     */
    while (this.ultimos.size > TETO_ULTIMOS) {
      const maisVelha = this.ultimos.keys().next();
      if (maisVelha.done) break;
      this.ultimos.delete(maisVelha.value);
    }

    // Diário é memória de curto prazo: o jornal em disco é quem guarda efeito.
    if (this.diario.size > TETO_TRILHA) {
      for (const [k, v] of this.diario) {
        if (agora - v.em > 10 * 60_000) this.diario.delete(k);
      }
    }
    return relato;
  }

  /** Vale a pena o operador tentar de novo? Usado pela frase de resposta. */
  static retentavel(codigo: CodigoErro | null): boolean {
    return codigo ? RETENTAVEL[codigo] : false;
  }
}

/** Instância única do processo — a fila e o diário são do motor. */
export const braco = new Braco();
