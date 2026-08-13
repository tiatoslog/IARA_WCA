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
import { ponteDispositivos, type DispositivoConectado, type PonteDispositivos } from '../barramento/PonteDispositivos';
import { executarOrdem } from './ExecutorDesktop';

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
  listar_arquivos: 10_000,
  capturar_tela: 45_000,
  informacoes_sistema: 10_000,
};

/** Janela em que um pedido idêntico é considerado repetição de pacote, e não
 *  um segundo pedido. Curta: "abre o bloco de notas" de novo um minuto depois
 *  é uma pessoa querendo outra janela. */
const JANELA_IDEMPOTENCIA_MS = 8_000;

/** Quantas linhas de trilha ficam em memória para diagnóstico. */
const TETO_TRILHA = 300;

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
  /** (operador|sessão|ação) → último relato. Ver `ultimoDe`. */
  private readonly ultimos = new Map<string, RelatoExecucao>();
  /** Cauda de execução por operador. Ver a nota sobre fila no cabeçalho. */
  private readonly filas = new Map<string, Promise<unknown>>();
  private trilha: LinhaTrilha[] = [];

  constructor(
    private readonly ponte: PonteDispositivos = ponteDispositivos,
    private readonly executarNoMotor = executarOrdem,
    private readonly temMaos = motorTemMaos,
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
    console.log(JSON.stringify({ canal: 'execucao', ...linha }));
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
    return this.ultimos.get(`${idUsuario}|${sessao}|${acao}`) ?? null;
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
    const relato = await minha;

    // Solta a cauda quando ela sou eu: sem isto o mapa cresce por operador
    // e a última promessa fica retida para sempre.
    if (this.filas.get(pedido.id_usuario) === minha) this.filas.delete(pedido.id_usuario);
    return relato;
  }

  private chaveDe(p: PedidoExecucao): string {
    /** Chaves ordenadas: `{a:1,b:2}` e `{b:2,a:1}` são o mesmo pedido. */
    const parametros = Object.keys(p.parametros)
      .sort()
      .map((k) => `${k}=${String(p.parametros[k])}`)
      .join('&');
    return `${p.id_usuario}|${p.acao}|${parametros}`;
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

    const dispositivo = this.ponte.destinoDe(pedido.id_usuario);

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

  private receber(
    dispositivo: DispositivoConectado,
    pacote: Parameters<Parameters<PonteDispositivos['aoPacote']>[0]>[1],
  ): void {
    if (pacote.tipo === 'apresentacao') return;

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
    const coerente: EstadoExecucao =
      bruto.estado === 'sucesso' && !bruto.prova.confirmado && bruto.prova.motivo === 'divergente'
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
    this.ultimos.set(`${c.ordem.id_usuario}|${c.ordem.sessao}|${c.ordem.acao}`, relato);

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
