/**
 * Kernel Cognitivo. Um por sessão.
 *
 * O laço, na ordem exata:
 *
 *   mensagem → percepção → decisão executiva → plano → passos → resposta
 *
 * Cada seta publica evento. Nenhum módulo chama outro diretamente; o Kernel é
 * o único que conhece todos, e mesmo ele coordena por eventos.
 *
 * O que NÃO acontece aqui: nenhuma decisão sobre como isso aparece na tela.
 * O Kernel publica; o `CompiladorSnapshot` traduz; a sessão transmite.
 */

import { randomUUID } from 'node:crypto';
import type { EstadoAtomico } from '../EstadoAtomico';
import type { MemoriaOperacional } from '../MemoriaOperacional';
import { TeoriaDaMente } from '../TeoriaDaMente';
import { BarramentoEventos } from './BarramentoEventos';
import { MotorPercepcao } from './Percepcao';
import { MemoriaTrabalho } from './MemoriaTrabalho';
import { Planejador, capacidadesSemNuvemEmTexto } from './Planejador';
import { FuncaoExecutiva, type Decisao } from './FuncaoExecutiva';
import { DescobertaCapacidades } from './DescobertaCapacidades';
import { lacunasCapacidade } from './LacunasCapacidade';
import { GerenciadorHabilidades } from './GerenciadorHabilidades';
import { MotorRaciocinio } from './MotorRaciocinio';
import { CATALOGO } from './habilidades';
import {
  AuditoriaEstruturada,
  LimiteVazao,
  PoliticaPadrao,
  SandboxPorPolitica,
  type Papel,
} from './Seguranca';
import { RegistroErros } from './RegistroErros';
import {
  OrcamentoDoTurno,
  tetosDoAmbiente,
  type TetosDoTurno,
  type VeredictoOrcamento,
} from './OrcamentoDoTurno';
import { PorteiroAutorizacao } from './PorteiroAutorizacao';
import { motivoDaRecusa, nivelAtual, podeSem } from './Autonomia';
import type { Plano } from './Evento';
import { PermissaoNegada, ParametroInvalido, type Habilidade, type Risco } from './Habilidade';
import { confirmaAcontecimento, VERBO_DO_ESTADO, type EstadoExecucao } from './Verdade';
import { lerAfirmacaoDeFeito } from './AfirmacaoDeFeito';
import { RegistroOperacoes, registroOperacoes } from './RegistroOperacoes';
import { PortalEfeitos } from './PortalEfeitos';
import { INTEGRACOES } from './integracoes';
// `provaDe`, não `evidencia`: o bloco de exceção deste arquivo já tem uma
// variável local com esse nome, e sombra silenciosa entre uma string e a função
// que carimba a fonte da prova é o tipo de colisão que compila e mente.
import type { Operacao, SemanticaEfeito } from './Operacao';
import { contextoDeConflitos, detectarConflitos, extrairFatosHorario } from './MemoriaFatos';
import { armarAvisoDeEspera } from './PrazoDeFala';
import { decidirEscalada, textoDegradado } from './EscaladaDoTurno';
import { RAIZ_DO_APP, VerificadorDeterministico, fontesDesligadas } from './VerificacaoRuntime';
import type { PortaVerificacaoRuntime } from '../../../lib/verificacao/contrato';
import type { DestinoCognitivo, EstagioCognitivo, OrigemRaciocinio } from '../../../lib/estado';
import { normalizarPreferencias } from '../../../lib/perfil';
import { analisarImagem } from '../AnaliseVisual';
import { porUrl as anexoPorUrl } from '../AnexoImagem';

/**
 * O que se sabe sobre UM passo depois de tentar executá-lo.
 *
 * O `estado` é do vocabulário de `Verdade.ts`, e é ele — não um booleano, não a
 * ausência de exceção — que decide o verbo que a resposta pode usar. Antes desta
 * auditoria o Kernel colapsava tudo em três listas de string e perdia a
 * distinção que mais importa: `falhou` ("não aconteceu") e `desconhecido` ("não
 * consigo provar o que aconteceu") caíam no mesmo balde.
 */
interface PassoExecutado {
  readonly descricao: string;
  readonly habilidade: string;
  readonly estado: EstadoExecucao;
  /** O que sobe para a resposta. Vazio quando o passo não produziu saída. */
  readonly texto: string;
  /** Uma linha: o que se apurou. Vira ressalva ou motivo de recusa. */
  readonly evidencia: string;
}

/**
 * Resultado da execução de um plano. As falhas são tão fato quanto as saídas —
 * e precisam viajar juntas, senão a composição só enxerga o que deu certo.
 */
interface ExecucaoPlano {
  readonly passos: readonly PassoExecutado[];
}

/** Passos que produziram texto aproveitável para a resposta. */
const saidasDe = (e: ExecucaoPlano): string[] =>
  e.passos.filter((p) => p.texto).map((p) => p.texto);

/**
 * UM PASSO FALA UMA VEZ.
 *
 * As três listas abaixo alimentam parágrafos diferentes da mesma resposta, e o
 * `!p.texto` é o que impede o passo de entrar em dois deles. Sem esse filtro, um
 * plano de passo único que falhou dizia a MESMA coisa três vezes: o texto da
 * habilidade ("o seu computador não está conectado a mim"), a ressalva colada
 * nele mais abaixo, e um "O resto do pedido eu NÃO executei: <a mesma
 * evidência>" — sendo que não havia resto nenhum.
 *
 * Cada uma das três camadas nasceu consertando uma omissão real, e nenhuma está
 * errada sozinha. O defeito era de composição, e é aqui que ele se fecha: quem
 * já emprestou texto à resposta não é recontado. Nada se perde — `evidencia`
 * continua inteira no passo, na auditoria e no jornal, que é onde se responde
 * "por que não funcionou?".
 */
const jaFalouNaResposta = (p: ExecucaoPlano['passos'][number]): boolean => Boolean(p.texto);

/**
 * Passos que NÃO aconteceram. `aguardando_confirmacao` entra aqui porque, do
 * ponto de vista do operador, o efeito não existe — mudou só o motivo. Passo
 * barrado pela autorização sempre chega com `texto` vazio (ver o ramo do
 * `porteiro`), então continua sendo contado aqui, que era o ponto do conserto
 * original da falha parcial.
 */
const falhasDe = (e: ExecucaoPlano): string[] =>
  e.passos
    .filter((p) => !jaFalouNaResposta(p))
    .filter((p) => p.estado === 'falhou' || p.estado === 'aguardando_confirmacao')
    .map((p) => `${p.descricao}: ${p.evidencia}`);

/**
 * A zona cinzenta entre "fiz" e "provei que fiz". Não são falhas, e tratá-las
 * como sucesso é a mentira operacional que este arquivo inteiro combate.
 */
const desconhecidosDe = (e: ExecucaoPlano): string[] =>
  e.passos
    .filter((p) => !jaFalouNaResposta(p))
    .filter((p) => p.estado === 'desconhecido')
    .map((p) => `${p.descricao}: ${p.evidencia}`);

/** Um pedido que chegou de outra tela enquanto esta sessão já trabalhava. */
interface PedidoNaFila {
  readonly texto: string;
  readonly idLocal?: string;
  readonly origem: string;
  /**
   * O `op:` que a tela vai reconhecer como a PRÓPRIA bolha — o mesmo que o
   * turno usará em `MENSAGEM_RECEBIDA` quando chegar a vez. Decidido aqui, na
   * entrada da fila, e não no começo do turno: a projeção da fila precisa dele
   * antes de o turno existir, e dois lugares gerando o id dariam dois ids
   * diferentes para o mesmo pedido.
   */
  readonly id: string;
  readonly anexo?: AnexoMensagem;
}

/** Screenshot anexado a uma mensagem — ver `lib/protocolo.ts`. */
export interface AnexoMensagem {
  readonly url: string;
  readonly largura: number;
  readonly altura: number;
}

/**
 * Quantos pedidos podem esperar a vez.
 *
 * Casado por construção com o teto de telas de `Porta.ts`, sem importá-lo: o
 * Kernel não conhece o transporte, e não vai passar a conhecer por causa de um
 * número. Como cada espelho ocupa no máximo uma vaga (o segundo pedido dele
 * substitui o primeiro), quatro é o teto que a topologia já impõe — o valor
 * aqui é a rede de segurança para o dia em que ela mudar sem ninguém avisar.
 */
/**
 * "QUANTOS X" SOBRE A OPERAÇÃO — as perguntas cujo número só pode vir de contar.
 *
 * Usada pela trava de autoridade: pergunta desta forma respondida num turno em
 * que nada alcançou o mundo é um número sem procedência, e foi assim que a IARA
 * repetiu "75 motoristas" do próprio histórico em 19/08/2026.
 *
 * A lista é das entidades que TÊM operação determinística. `centrais` fica de
 * fora porque já tem oráculo que sabe o valor certo — e saber o valor vale mais
 * que saber a procedência.
 */
const PERGUNTA_DE_CARDINALIDADE_OPERACIONAL =
  /\b(quantos?|quantas?|n[úu]mero de|total de|quantidade de)\b[^?]{0,40}\b(motoristas?|cargas?|rotas?|destinos?|origens?|clientes?)\b/i;

const TETO_DA_FILA = 4;

/**
 * A origem de quem não tem tela: WhatsApp, ciclo autônomo, teste.
 *
 * Todos compartilham este rótulo de propósito. O que o campo precisa distinguir
 * é "veio da MESMA tela que já está sendo atendida" — e nenhum destes veio de
 * tela nenhuma, então nenhum deles preempta o turno de um operador que está
 * olhando para a resposta.
 */
export const ORIGEM_SEM_TELA = 'sem-tela';

export interface DependenciasKernel {
  sessao: string;
  idUsuario: string;
  papel?: Papel;
  outrosOperadores: readonly string[];
  estado: EstadoAtomico;
  memoria: MemoriaOperacional;
  barramento: BarramentoEventos;
  /**
   * A camada de raciocínio. Injetável por UM motivo, e não é conveniência:
   * ela é a única entrada NÃO CONFIÁVEL do kernel, e as travas que existem para
   * contê-la só podem ser provadas se um teste puder emitir o plano hostil que
   * a LLM emitiria.
   *
   * Trocar isto não desliga nenhuma guarda — o `PorteiroAutorizacao`, o
   * sandbox, o esquema e o verificador continuam todos no caminho. É por isso
   * que a costura é aceitável aqui e não seria em cima de uma trava.
   */
  raciocinio?: MotorRaciocinio;
  /**
   * QUEM CONFERE O VALOR DA RESPOSTA — e não é quem a produziu.
   *
   * Injetável para o teste poder pôr um verificador que contesta sempre, e
   * `null` explícito desliga a verificação. Ausente vale o determinístico
   * padrão, que reconhece poucas perguntas e diz `inconclusivo` no resto.
   */
  verificacao?: PortaVerificacaoRuntime | null;
  /**
   * Habilidades ACRESCENTADAS ao catálogo real. Nunca substituem nada.
   *
   * Mesma justificativa de `raciocinio`, e a mesma disciplina: existe para
   * poder EXERCITAR uma trava, nunca para desligá-la. O catálogo real é
   * bem-comportado — todo executor dele ou devolve texto ou lança de imediato —
   * e por isso ele não consegue produzir os três casos em que a distinção entre
   * "falhou" e "não sei" nasce: o executor que trava, o verificador que
   * pendura, e o executor que ALCANÇA O MUNDO e só então explode.
   *
   * Provar esses casos só na camada do `GerenciadorHabilidades` deixava de fora
   * exatamente o que importa — como a RESPOSTA fala deles. Foi assim que passou
   * um passo `verificado` que não chegava a frase nenhuma.
   *
   * Nenhuma guarda é contornada: porteiro, sandbox, esquema, timeout e
   * verificador continuam todos no caminho de uma habilidade injetada. E
   * `Porta.ts`/`PortaWhatsapp.ts` não passam este campo — o catálogo de
   * produção é o de sempre, e há teste travando isso.
   */
  habilidadesExtras?: readonly Habilidade[];
  /**
   * O jornal das operações de escrita. Injetável para que os testes possam
   * apontá-lo a um diretório temporário — e, sobretudo, para que um teste possa
   * DESTRUIR o registro e construir outro sobre o mesmo jornal, que é a única
   * forma honesta de provar reidratação sem matar o processo de teste.
   *
   * Não desliga nada: sem injeção, o Kernel cria o seu, e o caminho de escrita
   * passa por ele de qualquer jeito.
   */
  registroOperacoes?: RegistroOperacoes;
  /**
   * Tetos do orçamento por turno. Ausente = os do ambiente, que por sua vez
   * caem nos padrões do módulo. Injetável para que um teste possa provar o
   * BLOQUEIO com teto de 1 sem esperar seis passos — e, como todas as injeções
   * deste tipo aqui, ela aperta a trava, nunca a solta: nenhum valor injetado
   * permite mais do que o ambiente permitiria por conta própria.
   */
  tetosOrcamento?: TetosDoTurno;
}

const ESTAGIO_DA_ROTA: Record<string, EstagioCognitivo> = {
  sigilo: 'executando',
  esclarecer: 'falando',
  plano_local: 'executando',
  plano_cognitivo: 'pensando',
  raciocinio_direto: 'pensando',
};

/**
 * Turnos que o detector de ambiguidade consulta para procurar antecedente.
 *
 * Deliberadamente menor que a janela do raciocínio (20): resolver "aquele
 * relatório" com algo dito há trinta mensagens não é recuperar contexto, é
 * inventar um vínculo. Se o assunto sumiu por seis turnos, perguntar é o
 * comportamento certo.
 */
const JANELA_ANTECEDENTE = 6;

export class Kernel {
  private readonly percepcao = new MotorPercepcao();
  private readonly trabalho = new MemoriaTrabalho();
  private readonly planejador = new Planejador();
  private readonly habilidades: GerenciadorHabilidades;
  private readonly raciocinio: MotorRaciocinio;
  private readonly executiva: FuncaoExecutiva;
  private readonly politica = new PoliticaPadrao();
  private readonly sandbox = new SandboxPorPolitica(this.politica);
  /**
   * Autorização por RISCO, ortogonal à permissão por papel do `sandbox`.
   *
   * As duas portas respondem perguntas diferentes e nenhuma substitui a outra:
   * o sandbox pergunta "este papel pode?", o porteiro pergunta "quem autorizou
   * este passo?". Foi a ausência da segunda que deixou um plano da LLM desligar
   * a máquina — ver `PorteiroAutorizacao.ts`.
   */
  private readonly porteiro = new PorteiroAutorizacao();
  /**
   * A IDENTIDADE E O DESTINO de tudo que altera o mundo.
   *
   * O porteiro responde "quem autorizou". Este responde as duas perguntas que
   * ninguém respondia: "de que ação exatamente estamos falando" e "o que se
   * sabe sobre ela depois que o processo morreu". Sem a primeira não existe
   * deduplicação possível; sem a segunda, um restart apaga a diferença entre
   * "não aconteceu" e "aconteceu e ninguém viu".
   */
  private readonly registro: RegistroOperacoes;
  /**
   * A ÚNICA fronteira por onde qualquer efeito alcança o mundo.
   *
   * O Kernel não executa mais escrita por conta própria: ele descreve a operação
   * e o portal a conduz. Não é indireção decorativa — é o que torna possível
   * dizer, e provar com teste de arquitetura, que nenhum caminho de efeito
   * escapa. Enquanto a sequência morava dentro do laço de passos daqui, ela
   * valia só para quem passava pelo laço; foi assim que o canal WhatsApp
   * alcançou a Meta por fora de tudo.
   */
  private readonly portal: PortalEfeitos;
  private readonly auditoria = new AuditoriaEstruturada();
  private readonly vazao = new LimiteVazao();
  /** Falhas cognitivas do turno viram assinatura, não só linha de console. */
  private readonly erros = new RegistroErros();
  private readonly papel: Papel;

  private emAndamento: AbortController | null = null;
  /**
   * DE QUAL ESPELHO é o turno em voo. `null` quando não há turno.
   *
   * É este campo que separa as duas preempções que o Kernel confundia. Ver
   * `processar`.
   */
  private origemEmAndamento: string | null = null;
  /**
   * Pedidos de OUTROS espelhos esperando a vez. No máximo um por espelho: o
   * segundo pedido da mesma tela substitui o primeiro, porque quem reescreve na
   * própria tela está corrigindo o que pediu, não pedindo duas coisas.
   */
  private readonly fila: PedidoNaFila[] = [];
  /**
   * A INTENÇÃO QUE FICOU ESPERANDO UM PARÂMETRO — ver
   * `ResultadoHabilidade.pendencia`. Vive UM turno: a próxima mensagem ou a
   * consome (curta, sem âncora → vira o valor do parâmetro e a habilidade
   * roda de novo) ou a descarta (o operador mudou de assunto). Nunca
   * persiste, nunca atravessa sessão — é diálogo, não memória.
   */
  private pendenciaParametro: {
    habilidade: string;
    parametros: Record<string, unknown>;
    parametro: string;
  } | null = null;

  /**
   * O índice de assunto do catálogo. Campo — e não variável local do
   * construtor — porque DOIS consumidores o leem: a Função Executiva (portão
   * de rota) e o registro de lacunas (o mesmo "parece operacional" que abre a
   * rota é o que qualifica a lacuna quando a rota volta de mãos vazias).
   * Duas instâncias seriam duas réguas que um dia divergem.
   */
  private readonly descoberta: DescobertaCapacidades;
  /** Quem confere o valor da resposta. `null` desliga a verificação em runtime. */
  private readonly verificacao: PortaVerificacaoRuntime | null;

  constructor(private readonly dep: DependenciasKernel) {
    this.papel = dep.papel ?? 'operador';
    this.raciocinio = dep.raciocinio ?? new MotorRaciocinio();
    /* `undefined` vale o padrão; `null` desliga. A diferença importa: um teste
       que passa `null` está declarando que não quer verificação, e isso é outra
       coisa de "esqueci de configurar". */
    this.verificacao =
      dep.verificacao === undefined
        ? new VerificadorDeterministico({
            raiz: RAIZ_DO_APP,
            fontesAusentes: () => fontesDesligadas(),
          })
        : dep.verificacao;
    /**
     * O jornal COMPARTILHADO do processo, não um por kernel. Um kernel por
     * sessão significa dois kernels para o mesmo operador (navegador e
     * WhatsApp); índices separados fariam a deduplicação valer dentro de um
     * canal e não entre eles. Ver `registroOperacoes`.
     */
    this.registro = dep.registroOperacoes ?? registroOperacoes;
    this.portal = new PortalEfeitos(this.registro, dep.barramento);
    this.portal.registrarTodas(INTEGRACOES);
    this.habilidades = new GerenciadorHabilidades(dep.barramento);
    this.habilidades.registrarTodas(CATALOGO);
    if (dep.habilidadesExtras) this.habilidades.registrarTodas(dep.habilidadesExtras);
    /**
     * O índice de assunto nasce dos MESMOS manifestos registrados acima —
     * habilidade nova entra no portão de rota no mesmo commit em que entra
     * no catálogo, sem tocar em nenhuma âncora. Manifestos são dados puros:
     * a Função Executiva continua sem alcançar executor nenhum.
     */
    this.descoberta = new DescobertaCapacidades(
      [...CATALOGO, ...(dep.habilidadesExtras ?? [])].map((h) => h.manifesto),
    );
    this.executiva = new FuncaoExecutiva(
      this.planejador,
      this.trabalho,
      dep.outrosOperadores,
      () => this.raciocinio.disponivel,
      this.descoberta,
    );
  }

  get memoriaTrabalho(): MemoriaTrabalho {
    return this.trabalho;
  }

  /** O jornal das escritas desta sessão. Leitura — ninguém transiciona por fora. */
  get operacoes(): RegistroOperacoes {
    return this.registro;
  }

  /** A fronteira de efeitos. Exposta para o canal poder responder POR ELA. */
  get efeitos(): PortalEfeitos {
    return this.portal;
  }

  /** Defeitos cognitivos observados nesta sessão, para diagnóstico e métrica. */
  get inventarioDeErros() {
    return this.erros.inventario;
  }

  /** De onde vem o raciocínio desta sessão — `nenhuma` quando o provedor
   *  decidido não está utilizável. A `Porta` grava isto no estado. */
  get origemRaciocinio(): OrigemRaciocinio {
    return this.raciocinio.disponivel ? this.raciocinio.origem : 'nenhuma';
  }

  /** Sonda ativa do provedor (Ollama), para o snapshot nascer com a origem
   *  certa na abertura da sessão. Anthropic não sonda — chave é presença. */
  async prepararRaciocinio(): Promise<void> {
    await this.raciocinio.preparar();
  }

  /** Cancelamento preemptivo. Nenhuma trava global é segurada em rede. */
  cancelar(motivo = 'preempção'): void {
    if (!this.emAndamento) return;
    this.emAndamento.abort(new Error(motivo));
    this.emAndamento = null;
    this.origemEmAndamento = null;
    this.dep.barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo });
  }

  /**
   * FIM DE LINHA: não sobrou tela nenhuma, ou o processo está caindo.
   *
   * Só isto esvazia a fila, e a distinção importa. `cancelar()` sozinho não
   * pode esvaziá-la porque ele TAMBÉM é a preempção da mesma tela (ver
   * `processar`) — se esvaziasse, quem reescrevesse a própria frase apagaria os
   * pedidos das outras telas junto, que é exatamente o dano do CC-01 de volta
   * por outra porta.
   *
   * Achado na auditoria de garantia, e ele nasceu COM a fila: antes de existir
   * fila, "a última tela fechou" cancelava o turno em voo e não havia mais nada
   * pendente. Agora havia — e os pedidos enfileirados continuariam sendo
   * executados contra uma sessão que não tem mais ninguém olhando.
   */
  pararTudo(motivo: string): void {
    const tinhaFila = this.fila.length > 0;
    this.fila.length = 0;
    if (tinhaFila) this.publicarFila();
    this.cancelar(motivo);
  }

  /**
   * "PARE" — vindo de UMA TELA, e valendo só para o que é dela.
   *
   * `cancelar()` acima é global e continua sendo: é a porta do desligamento e
   * do fim da sessão, onde derrubar tudo é o certo. `Porta.ts` chamava ELA para
   * atender o botão de interromper, e o resultado era a segunda metade do
   * CC-01: quem apertasse "parar" no computador matava o turno que a outra
   * pessoa — a mesma pessoa, noutra tela — tinha acabado de pedir. Serializar
   * os turnos consertou o cross-talk da resposta e deixou esta porta aberta:
   * agora que os pedidos esperam a vez, um "parar" global derruba o turno em
   * voo E deixa a fila andar, o que é ainda mais confuso do que era antes.
   *
   * Três casos, e só o primeiro cancela alguma coisa:
   *  · o turno em voo é DESTA tela → cancela;
   *  · o pedido desta tela está NA FILA → sai da fila (a pessoa desistiu antes
   *    de chegar a vez);
   *  · esta tela não tem nada em curso → não faz nada. Silêncio aqui é
   *    honesto: não há o que parar.
   */
  interromper(origem: string): void {
    /**
     * Turno SEM TELA (WhatsApp, ciclo autônomo) pode ser parado por qualquer
     * tela do operador. Antes de a origem existir, isto funcionava por
     * acidente — `cancelar()` derrubava tudo. Casar só por igualdade teria
     * tirado da operadora a única forma de interromper um turno que ela vê
     * acontecendo e que nenhuma tela dela iniciou. Ver `ORIGEM_SEM_TELA`.
     */
    const emVooEhDela =
      this.origemEmAndamento === origem || this.origemEmAndamento === ORIGEM_SEM_TELA;
    if (this.emAndamento && emVooEhDela) {
      this.cancelar('interrupção do operador');
      return;
    }
    this.retirarDaFila(origem, 'o operador desistiu antes de chegar a vez');
  }

  /**
   * A TELA SAIU. Retira da fila o pedido dela — e só isso.
   *
   * Não encosta no turno em voo de propósito: se ele já começou, o efeito pode
   * estar a caminho do mundo, e as outras telas do mesmo operador continuam
   * abertas para receber a resposta. O que não pode ficar é a VAGA: a fila tem
   * uma por espelho, e espelho que não existe mais segurando vaga acabaria
   * recusando o pedido de uma tela viva. Achado pela auditoria de garantia,
   * contra a linha do test-plan que exige exatamente isto.
   */
  esquecerEspelho(origem: string): void {
    this.retirarDaFila(origem, 'a tela que fez o pedido foi fechada antes de chegar a vez');
  }

  /**
   * Tira um pedido da fila E CONTA. O `splice` mudo era o defeito que a
   * auditoria apontou: um pedido que some sem uma linha sequer é a mesma
   * família do CC-01 — o operador fica com a bolha na tela e nenhuma notícia.
   */
  private retirarDaFila(origem: string, motivo: string): void {
    const espera = this.fila.findIndex((x) => x.origem === origem);
    if (espera < 0) return;
    this.fila.splice(espera, 1);
    this.dep.barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo });
    this.publicarFila();
  }

  /**
   * A fila INTEIRA, sempre que ela muda. Estado completo, nunca delta — ver
   * `FILA_ATUALIZADA` em `Evento.ts`.
   */
  private publicarFila(): void {
    this.dep.barramento.publicar({
      tipo: 'FILA_ATUALIZADA',
      pedidos: this.fila.map((p) => ({ id_mensagem: p.id, texto: p.texto })),
    });
  }

  /** Quantos pedidos de outras telas estão esperando. Leitura, para teste e
   *  diagnóstico — ninguém enfileira por fora de `processar`. */
  get pedidosNaFila(): number {
    return this.fila.length;
  }

  /**
   * Chama o próximo da fila, se houver. Roda no `finally` do turno que acabou,
   * e é `await`ado ali de propósito: assim a promessa devolvida por `processar`
   * só resolve quando a fila inteira drenou, e quem espera o fim do turno
   * (`Porta.ts` religa o ciclo autônomo) espera o fim de verdade.
   */
  private async drenarFila(): Promise<void> {
    // Preempção legítima já abriu outro turno: a fila espera mais um pouco.
    if (this.emAndamento) return;
    const proximo = this.fila.shift();
    if (!proximo) return;
    /* A tela precisa saber que saiu da fila ANTES de o turno começar: entre o
       `shift` e a primeira transição de estágio existe uma janela em que a
       pessoa ainda veria "esperando a vez" sobre um pedido que já entrou. */
    this.publicarFila();
    try {
      await this.processar(proximo.texto, proximo.idLocal, proximo.origem, proximo.id, proximo.anexo);
    } catch (erro) {
      /* `processar` já trata as próprias falhas; o que chega aqui é o que
         escapou do `finally` dele. Deixar subir mataria a drenagem e os
         pedidos seguintes morreriam calados — que é o defeito original. */
      this.dep.barramento.publicar({
        tipo: 'FALHA',
        modulo: 'fila_de_espelhos',
        mensagem: `Pedido da fila não pôde ser atendido: ${(erro as Error).message}`,
      });
    }
  }

  // -------------------------------------------------------------------------

  /**
   * `idLocal` é o identificador que a tela deu à própria bolha, quando veio de
   * uma. Ele só serve para a frase voltar projetada e o aparelho de origem se
   * reconhecer — nada aqui decide coisa alguma com base nele. Ausente (WhatsApp,
   * ciclo autônomo, teste), o turno ganha um id próprio: a pergunta precisa de
   * identidade nos espelhos mesmo quando não nasceu numa tela.
   */
  async processar(
    texto: string,
    idLocal?: string,
    origem: string = ORIGEM_SEM_TELA,
    /** Só a drenagem da fila passa isto: o pedido já ganhou id ao entrar nela. */
    idJaAtribuido?: string,
    /** Screenshot anexado pelo operador — ver `AnexoMensagem`. */
    anexo?: AnexoMensagem,
  ): Promise<void> {
    /**
     * O prefixo `op:` é o que garante que um id vindo da rede nunca colida com
     * o `randomUUID` das falas da IARA. Sem ele, um cliente que mandasse como
     * `id_local` o id de uma resposta em curso faria a própria bolha e a fala
     * da IARA disputarem a mesma linha da lista.
     *
     * Calculado ANTES da fila porque a fila também precisa dele: é por este id
     * que a tela reconhece, na projeção da fila, qual dos pedidos esperando é o
     * dela.
     */
    const idDaPergunta = idJaAtribuido ?? (idLocal ? `op:${idLocal}` : `op:${randomUUID()}`);

    /**
     * DUAS PREEMPÇÕES QUE ERAM UMA SÓ — o CC-01 (16/08/2026).
     *
     * "Chegou mensagem nova, cancele o turno" está certo quando quem manda é a
     * MESMA tela: a pessoa reescreveu, mudou de ideia, corrigiu o pedido. A
     * resposta do turno velho não interessa mais a ninguém.
     *
     * Está errado quando quem manda é OUTRA tela. Uma sessão tem um kernel e
     * até quatro espelhos; o operador no computador e no celular são a mesma
     * pessoa, mas não são o mesmo pedido. O turno morria calado e a fala do
     * turno vencedor ia para a sessão inteira — a tela que perdeu a corrida
     * exibia "Pronto, criei a pasta Beta em Documentos" como resposta a um
     * pedido de criar Alfa na Área de Trabalho. Medido no navegador, com duas
     * abas e 42 ms de desalinhamento: o efeito de Alfa ACONTECEU no disco, e
     * foi só a resposta dele que se perdeu. Mentira operacional das piores,
     * porque o mundo dava razão à IARA e a tela não.
     *
     * Agora o pedido de outra tela ESPERA A VEZ. Serializar é o que torna
     * verdadeira a frase que já estava escrita mais abaixo — "o turno cancelado
     * não fala; quem fala é o turno novo" — porque agora ela só vale para
     * turnos que a mesma tela substituiu.
     */
    if (this.emAndamento && this.origemEmAndamento !== origem) {
      const jaEspera = this.fila.findIndex((x) => x.origem === origem);
      if (jaEspera >= 0) {
        this.fila[jaEspera] = { texto, idLocal, origem, id: idDaPergunta, anexo };
        this.publicarFila();
        return;
      }
      if (this.fila.length >= TETO_DA_FILA) {
        /* Recusa EXPLÍCITA. Descartar em silêncio sob pressão seria trocar o
           defeito de lugar: em vez de responder a pergunta errada, não
           responder e não contar. Mesmo canal do limite de vazão logo abaixo. */
        this.dep.barramento.publicar({
          tipo: 'FALHA',
          modulo: 'fila_de_espelhos',
          mensagem:
            'Já há pedidos demais esperando nesta sessão. Este NÃO entrou na fila — ' +
            'nada foi feito com ele. Mande de novo daqui a pouco.',
        });
        return;
      }
      this.fila.push({ texto, idLocal, origem, id: idDaPergunta, anexo });
      this.publicarFila();
      return;
    }

    this.cancelar('nova mensagem do operador');

    if (!this.vazao.permitir()) {
      this.dep.barramento.publicar({
        tipo: 'FALHA',
        modulo: 'limite_vazao',
        mensagem: 'Ritmo acima do limite da sessão. Aguarde alguns segundos.',
      });
      return;
    }

    const controle = new AbortController();
    this.emAndamento = controle;
    this.origemEmAndamento = origem;
    const b = this.dep.barramento;
    b.novoTraco();
    const inicio = Date.now();

    /**
     * UM ORÇAMENTO POR TURNO, criado aqui e em nenhum outro lugar.
     *
     * Vive na pilha, não no campo da classe: dois turnos do mesmo kernel não
     * dividem teto (o segundo pedido do operador não pode nascer sem orçamento
     * porque o primeiro gastou), e um campo compartilhado seria exatamente esse
     * defeito — com a agravante de a fila serializar turnos, o que faria o
     * vazamento aparecer só depois de duas telas conversando.
     */
    const orcamento = new OrcamentoDoTurno(this.dep.tetosOrcamento ?? tetosDoAmbiente());

    /**
     * A PACIÊNCIA DE UMA PESSOA, que é coisa diferente do orçamento acima.
     *
     * O orçamento pergunta "este turno já custou demais?" e responde em 15 min.
     * Este pergunta "esta pessoa já esperou demais?" e responde em ~20 s. Ter um
     * número só para as duas foi o defeito medido em 18/08/2026: turnos de 46 s,
     * 62 s e 90 s sem NADA na tela, dentro do orçamento, sem erro nenhum — e do
     * lado de cá indistinguível de um sistema morto.
     *
     * Ele não aborta, não gasta e não decide. Só avisa. Ver `PrazoDeFala.ts`
     * para por que abortar seria trocar silêncio por `FALSO_NEGATIVO`.
     */
    const avisoDeEspera = armarAvisoDeEspera({
      barramento: b,
      idDaPergunta,
      tentativasDeProvedor: () => orcamento.gasto('tentativa_provedor'),
    });

    /* `idDaPergunta` nasceu lá em cima, antes da fila. Ele tem três
       consumidores: a bolha do operador (`MENSAGEM_RECEBIDA`), o endereço de
       toda fala deste turno (`responde_a`), e a projeção da fila enquanto o
       pedido espera a vez. */

    try {
      b.publicar({
        tipo: 'MENSAGEM_RECEBIDA',
        texto,
        id_mensagem: idDaPergunta,
        anexo,
      });

      /**
       * ANÁLISE VISUAL — short-circuit no mesmo estilo do bloco `esclarecer`
       * logo abaixo: decisão determinística, sem plano, sem habilidade. Uma
       * imagem anexada não é um pedido a decompor pelo planejador — é uma
       * pergunta sobre o que está na tela, e quem responde é a visão do
       * Claude, chamada direto (nenhuma habilidade do catálogo fala com a
       * LLM; ver `AnaliseVisual.ts` e ADR-2 em `docs/prd/test-plan.md`).
       */
      if (anexo) {
        await this.registrarSemQuebrar('operador', texto || '(imagem anexada, sem pergunta escrita)');
        if (controle.signal.aborted) return;
        await this.dep.estado.transicionar('pensando', null);

        const idMensagem = randomUUID();
        const concluirVisual = async (motivo: string, destino: DestinoCognitivo): Promise<void> => {
          b.publicar({
            tipo: 'TAREFA_CONCLUIDA',
            id_mensagem: idMensagem,
            texto: motivo,
            rota: 'analise_visual',
            ms: Date.now() - inicio,
            responde_a: idDaPergunta,
            marcacao: null,
          });
          await this.registrarSemQuebrar('iara', motivo, destino);
        };

        const permissao = orcamento.consumir('chamada_modelo');
        if (!permissao.permitido) {
          this.avisarOrcamento(permissao, 'análise visual');
          await concluirVisual(permissao.motivo, 'sistema_local');
          return;
        }

        const arquivo = anexoPorUrl(anexo.url);
        if (!arquivo) {
          await concluirVisual('Não encontrei mais essa imagem — pode anexar de novo?', 'sistema_local');
          return;
        }

        /* `modelo` fica genérico de propósito: `analisarImagem` tenta uma
           CADEIA (Groq → Gemini → Anthropic, ver AnaliseVisual.ts) e só se
           sabe quem respondeu depois que a chamada volta — nomear um
           provedor aqui seria uma afirmação que ainda não é verdade. */
        b.publicar({ tipo: 'RACIOCINIO_INICIADO', modelo: 'visão', origem: 'nuvem' });
        const resultado = await analisarImagem(arquivo.bytes, arquivo.tipo, texto, controle.signal);
        if (controle.signal.aborted) return;
        orcamento.consumir('tokens', resultado.tokens_entrada + resultado.tokens_saida);
        b.publicar({
          tipo: 'RACIOCINIO_CONCLUIDO',
          tokens_entrada: resultado.tokens_entrada,
          tokens_saida: resultado.tokens_saida,
          cache_lido: 0,
          ms: Date.now() - inicio,
        });
        // QUEM respondeu de fato — mesma disciplina de `vocalizar()`: fato
        // relevante para depuração de custo/latência, sem campo próprio no
        // snapshot (a mesma lacuna que `RACIOCINIO_CONCLUIDO` já tem para
        // texto: nenhum apelido de provedor atravessa até a projeção).
        console.log(
          JSON.stringify({ canal: 'visao', provedor: resultado.provedor, procedencia: resultado.procedencia }),
        );

        b.publicar({
          tipo: 'TAREFA_CONCLUIDA',
          id_mensagem: idMensagem,
          texto: resultado.texto,
          rota: 'analise_visual',
          ms: Date.now() - inicio,
          responde_a: idDaPergunta,
          marcacao: resultado.alvo
            ? { alvo_x: resultado.alvo.x, alvo_y: resultado.alvo.y, elemento: resultado.alvo.elemento }
            : null,
        });
        await this.registrarSemQuebrar('iara', resultado.texto, 'claude_nuvem');
        await this.dep.estado.aplicarIntencao({
          campo: 'afinidade',
          delta: TeoriaDaMente.GANHO_POR_TROCA,
        });
        return;
      }

      // --- 1. Percepção -----------------------------------------------------
      const p = this.percepcao.perceber(texto);
      b.publicar({ tipo: 'PERCEPCAO_CONCLUIDA', percepcao: p });
      await this.dep.estado.definirLeitura(p.leitura);
      // Gravar histórico é DESEJÁVEL, não essencial para responder. Se a
      // persistência estiver fora (tabela ausente, rede caída), a IARA
      // continua atendendo e avisa no console — em vez de o turno inteiro
      // morrer por causa de um INSERT.
      await this.registrarSemQuebrar('operador', texto);
      if (controle.signal.aborted) return;

      // --- 2. Função executiva ---------------------------------------------
      /**
       * O histórico entra na DECISÃO, não só no raciocínio.
       *
       * É o que faz a IARA não perguntar "qual relatório?" sobre um relatório
       * que ela mesma acabou de discutir. Sem isto o detector de ambiguidade
       * decide no escuro — e decidir no escuro produz as duas falhas opostas:
       * perguntar o óbvio e adivinhar o crítico.
       *
       * Custo zero quando a persistência está fora: contexto vazio faz a IARA
       * perguntar mais, que é o lado seguro de degradar.
       */
      const recentes = await this.dep.memoria
        .historico(this.dep.idUsuario, JANELA_ANTECEDENTE)
        .catch(() => [] as Awaited<ReturnType<typeof this.dep.memoria.historico>>);

      /**
       * RETOMADA DE INTENÇÃO PENDENTE — o protocolo de diálogo que faltava.
       *
       * Turno anterior: "vai chover hoje?" → a habilidade respondeu "me diga a
       * cidade" e declarou `pendencia: {parametro: 'cidade'}`. Turno atual:
       * "Valinhos". Sem isto, "Valinhos" era percebido como mensagem nova, não
       * casava âncora nenhuma e morria em conversa — achado ao vivo em
       * produção (14/08/2026), com a própria IARA dando um conselho que não
       * funcionava ("manda a frase inteira").
       *
       * A pendência é UM-TURNO e a leitura a consome sempre: ou a mensagem a
       * preenche, ou ela morre em silêncio. Preenche quando é curta e não
       * reconheceu âncora nenhuma — ou seja, quando NÃO É um pedido novo. O
       * plano forjado é DETERMINÍSTICO e roda pelo caminho de sempre:
       * `executarPlano` valida o esquema, o porteiro vigia, o jornal registra.
       * Nenhuma porta é pulada; só a rota de decisão é curto-circuitada,
       * porque a decisão já foi tomada no turno anterior — pela habilidade.
       */
      const pendente = this.pendenciaParametro;
      this.pendenciaParametro = null;
      const preenchePendencia =
        pendente !== null &&
        p.ancoras.length === 0 &&
        p.tipo !== 'saudacao' &&
        texto.trim().length > 0 &&
        texto.trim().length <= 60;

      const decisao: Decisao = preenchePendencia
        ? {
            rota: 'plano_local',
            acao: 'executar',
            justificativa:
              `Resposta curta preenche o parâmetro "${pendente.parametro}" pendente de ` +
              `${pendente.habilidade} (turno anterior).`,
            custo_estimado: 'zero',
          }
        : this.executiva.decidir(p, {
            historicoRecente: recentes.map((r) => r.texto),
            pessoasConhecidas: this.dep.outrosOperadores,
          });

      b.publicar({
        tipo: 'DECISAO_TOMADA',
        rota: decisao.rota,
        justificativa: decisao.justificativa,
        custo_estimado: decisao.custo_estimado,
      });
      this.auditoria.registrar({
        instante: new Date().toISOString(),
        sessao: this.dep.sessao,
        id_usuario: this.dep.idUsuario,
        traco: b.tracoAtual,
        acao: `rota:${decisao.rota}`,
        detalhe: decisao.justificativa,
        permitido: true,
      });

      await this.dep.estado.transicionar(ESTAGIO_DA_ROTA[decisao.rota] ?? 'executando', null);

      /**
       * PERGUNTAR É UMA RESPOSTA COMPLETA, e sai por aqui.
       *
       * Não há plano, não há habilidade, não há token: a IARA identificou o
       * que falta e devolve exatamente essa pergunta. Deixar isto seguir para
       * o raciocínio seria pagar por uma chamada cujo único desfecho aceitável
       * já está decidido — e correr o risco de a LLM, vendo o pedido inteiro,
       * resolver adivinhar em vez de perguntar.
       */
      if (decisao.rota === 'esclarecer' && decisao.pergunta) {
        /* `idDaFala`, não `idPergunta`: o que nasce aqui é o id da FALA da IARA
           — que por acaso é uma pergunta. A pergunta do operador é
           `idDaPergunta`, e confundir as duas é o que este turno inteiro está
           consertando. */
        const idDaFala = randomUUID();
        b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: idDaFala,
          texto: decisao.pergunta,
          responde_a: idDaPergunta,
        });
        b.publicar({
          tipo: 'TAREFA_CONCLUIDA',
          id_mensagem: idDaFala,
          texto: decisao.pergunta,
          rota: 'esclarecer',
          ms: Date.now() - inicio,
          responde_a: idDaPergunta,
        });
        await this.registrarSemQuebrar('iara', decisao.pergunta, 'sistema_local');
        return;
      }

      // --- 3. Plano ---------------------------------------------------------
      const plano =
        preenchePendencia && pendente
          ? ({
              objetivo: `Retomar ${pendente.habilidade} com "${pendente.parametro}" informado`,
              origem: 'deterministico',
              passos: [
                {
                  indice: 0,
                  descricao: `Executar ${pendente.habilidade} com o ${pendente.parametro} que o operador acabou de dizer`,
                  habilidade: pendente.habilidade,
                  parametros: { ...pendente.parametros, [pendente.parametro]: texto.trim() },
                },
              ],
            } satisfies Plano)
          : await this.montarPlano(decisao.rota, p, controle.signal, orcamento);
      if (controle.signal.aborted) return;

      this.trabalho.iniciarTarefa(p, plano);
      b.publicar({ tipo: 'PLANO_CRIADO', plano });

      /**
       * LACUNA DE CAPACIDADE — FASE A (14/08/2026).
       *
       * A frase parecia operacional (o mesmo índice que abriu a rota diz
       * isso), o catálogo inteiro foi oferecido à LLM, e o plano voltou sem
       * UMA habilidade sequer: só raciocínio. O sistema reconheceu o terreno
       * e não tinha ferramenta — é exatamente o que a fila de evolução do
       * catálogo precisa medir. "Motoristas disponíveis agora?" aconteceu 3×
       * ao vivo antes de existir onde cair; agora cai aqui.
       *
       * DOIS filtros além do plano vazio, e cada um barra uma mentira:
       *
       *   · assunto (`pareceOperacional`) — pergunta filosófica com "qual"
       *     não é lacuna; é conversa que pagou planejamento pelo lado seguro;
       *   · FORMA DE PEDIDO (comando, ou frase interrogada) — achado da
       *     auditoria adversarial de 14/08: os exemplos do manifesto rico
       *     alargaram o índice de assunto o bastante para um desabafo com
       *     vocabulário de trabalho ("esse relatório me destruiu hoje")
       *     parecer operacional. Desabafo não é pedido, e uma fila de
       *     evolução com desabafo dentro vira exatamente o log de conversa
       *     que o contrato proíbe. O custo declarado: pedido digitado sem
       *     "?" e sem imperativo fica de fora — subcontar é o lado certo de
       *     errar num registro que alguém vai reler.
       *
       * A lacuna pertence AO OPERADOR que a pediu (partição em
       * `LacunasCapacidade`), e nada além da assinatura sintática é guardado.
       */
      const formaDePedido = p.tipo === 'comando' || /\?\s*$/.test(p.bruto.trim());
      if (
        decisao.rota === 'plano_cognitivo' &&
        formaDePedido &&
        plano.passos.every((x) => !x.habilidade || x.habilidade === 'raciocinio') &&
        this.descoberta.pareceOperacional(p.bruto)
      ) {
        lacunasCapacidade.registrar(p.bruto, this.dep.idUsuario);
      }

      // --- 4. Execução ------------------------------------------------------
      const execucao = await this.executarPlano(plano, p.bruto, controle, orcamento);
      if (controle.signal.aborted) {
        /**
         * CANCELAR A RESPOSTA NÃO CANCELA O MUNDO.
         *
         * Um passo pode ter completado o efeito microssegundos antes de a
         * preempção chegar — o operador manda uma segunda mensagem enquanto a
         * primeira já criou a pasta. A resposta deste turno é descartada (é o
         * que preempção significa), mas o EFEITO não pode ser descartado junto:
         * some da tela e some do histórico, e ninguém nunca soube que
         * aconteceu.
         *
         * O turno cancelado não fala — quem fala é o turno novo. Mas o fato vai
         * para o barramento, e daí para a trilha de auditoria.
         */
        const realizados = execucao.passos.filter(
          (x) => x.estado === 'verificado' || x.estado === 'executado' || x.estado === 'desconhecido',
        );
        if (realizados.length > 0) {
          b.publicar({
            tipo: 'FALHA',
            modulo: 'preempcao',
            mensagem:
              'Turno interrompido DEPOIS de executar: ' +
              `${realizados.map((x) => x.descricao).join('; ')}. ` +
              'A resposta foi descartada; o efeito não.',
          });
        }
        return;
      }

      // --- 5. Resposta ------------------------------------------------------
      const idMensagem = randomUUID();
      const texto_final = await this.comporResposta(
        plano,
        execucao,
        p,
        idMensagem,
        idDaPergunta,
        controle,
        orcamento,
      );
      if (controle.signal.aborted) return;

      b.publicar({
        tipo: 'TAREFA_CONCLUIDA',
        id_mensagem: idMensagem,
        texto: texto_final,
        rota: decisao.rota,
        ms: Date.now() - inicio,
        responde_a: idDaPergunta,
      });

      await this.registrarSemQuebrar('iara', texto_final, this.destinoDe(decisao.rota));
      // O mesmo ganho que a `Porta` usa para semear o lastro histórico. Duas
      // constantes iguais em arquivos diferentes é como elas deixam de ser iguais.
      await this.dep.estado.aplicarIntencao({
        campo: 'afinidade',
        delta: TeoriaDaMente.GANHO_POR_TROCA,
      });
    } catch (erro) {
      if (controle.signal.aborted) return;
      const mensagem = (erro as Error).message;
      b.publicar({ tipo: 'FALHA', modulo: 'kernel', mensagem });

      /**
       * A falha PRECISA chegar ao operador como fala.
       *
       * Antes ela só virava linha de console — e o console vem fechado. O
       * sintoma era o pior possível: o operador manda mensagem e a tela não
       * muda em nada. Silêncio é a única resposta que um assistente nunca
       * pode dar.
       */
      b.publicar({
        tipo: 'TAREFA_CONCLUIDA',
        id_mensagem: randomUUID(),
        texto: this.mensagemHumanaDeFalha(mensagem),
        rota: 'falha',
        ms: Date.now() - inicio,
        responde_a: idDaPergunta,
      });
    } finally {
      /* PRIMEIRO no `finally`, e por um motivo estreito: tudo abaixo daqui faz
         E/S (jornal, transição de estado, drenar fila). Um turno que respondeu
         em dois segundos e depois demorasse a fechar dispararia o aviso DEPOIS
         de já ter falado — a IARA avisando que está pensando sobre uma resposta
         que a pessoa já leu. */
      avisoDeEspera.cancelar();
      if (this.emAndamento === controle) {
        this.emAndamento = null;
        this.origemEmAndamento = null;
      }
      /**
       * O GASTO DO TURNO VAI PARA O JORNAL SEMPRE — estourado ou não.
       *
       * Registrar só o estouro daria a série errada: sem os turnos normais no
       * registro não há como saber se o teto está apertado demais ou frouxo
       * demais, e a primeira pessoa a ver um alerta de orçamento não teria nada
       * com que comparar. É a mesma razão de a bateria de falsa conclusão contar
       * também os cenários honestos.
       */
      this.auditoria.registrar({
        instante: new Date().toISOString(),
        sessao: this.dep.sessao,
        id_usuario: this.dep.idUsuario,
        traco: b.tracoAtual,
        acao: orcamento.estouro ? `orcamento_turno:estourado` : 'orcamento_turno',
        detalhe: orcamento.resumo(),
        permitido: orcamento.estouro === null,
      });
      this.trabalho.encerrarTarefa();
      await this.dep.estado.transicionar('ocioso', null);
      /* A vez do próximo espelho. Depois de `ocioso`, para que o turno da fila
         não comece em cima do estágio do turno que acabou. */
      await this.drenarFila();
    }
  }

  // -------------------------------------------------------------------------

  private async montarPlano(
    rota: string,
    p: Parameters<MotorPercepcao['perceber']> extends never ? never : ReturnType<MotorPercepcao['perceber']>,
    sinal: AbortSignal,
    orcamento: OrcamentoDoTurno,
  ): Promise<Plano> {
    if (rota === 'sigilo') {
      return this.planejador.planoDeRecusa('Recusar acesso a registro de terceiro');
    }
    if (rota === 'plano_local') {
      /**
       * O CONTEXTO entra aqui, e só aqui. A `Percepcao` continua sendo o que a
       * frase diz; a identidade de quem a disse vem do Kernel, que é quem a tem.
       * Sem isto, a receita de autorizar um plano proposto não teria como saber
       * QUAL proposta está aberta — e adivinhar seria autorizar no escuro.
       */
      return this.planejador.planejar(p, {
        id_usuario: this.dep.idUsuario,
        sessao: this.dep.sessao,
      });
    }
    if (rota === 'plano_cognitivo') {
      /**
       * O ORÇAMENTO É CONSULTADO ANTES DE PLANEJAR, e a recusa aqui degrada em
       * vez de derrubar: sem chamada de modelo disponível, o plano de passo único
       * determinístico ainda responde. É o mesmo desenho da nuvem desligada — a
       * IARA continua atendendo com o que alcança, e diz o que não alcançou.
       */
      const permissao = orcamento.consumir('chamada_modelo');
      if (!permissao.permitido) {
        this.avisarOrcamento(permissao, 'planejamento');
        return this.planejador.planoDeRaciocinio(p);
      }
      // A LLM DECOMPÕE. Ela não executa nada do que propôs — o kernel é quem
      // roda cada passo, com validação de esquema e permissão em cada um.
      const emergente = await this.raciocinio.planejar(p, this.habilidades.catalogo(), sinal, {
        aoTentarProvedor: () => orcamento.consumir('tentativa_provedor').permitido,
      });
      if (emergente) return emergente;
      // Planejamento falhou ou veio inválido: cai para o passo único, que
      // sempre funciona. Nunca executa plano pela metade.
      return this.planejador.planoDeRaciocinio(p);
    }
    return this.planejador.planoDeRaciocinio(p);
  }

  /**
   * A recusa do orçamento chega ao operador como FATO, pelos mesmos canais das
   * outras recusas: evento de falha e linha de auditoria. Barrar sem contar
   * trocaria uma mentira ("fiz") por outra ("nada aconteceu").
   */
  private avisarOrcamento(v: VeredictoOrcamento, onde: string): void {
    if (v.permitido) return;
    this.dep.barramento.publicar({
      tipo: 'FALHA',
      modulo: 'orcamento',
      mensagem: `${v.motivo} (${onde}).`,
    });
    this.auditoria.registrar({
      instante: new Date().toISOString(),
      sessao: this.dep.sessao,
      id_usuario: this.dep.idUsuario,
      traco: this.dep.barramento.tracoAtual,
      acao: `orcamento_estourado:${v.recurso}`,
      detalhe: `${onde} — gasto ${v.gasto}, teto ${v.teto}`,
      permitido: false,
    });
  }

  private async executarPlano(
    plano: Plano,
    enunciado: string,
    controle: AbortController,
    orcamento: OrcamentoDoTurno,
  ): Promise<ExecucaoPlano> {
    const b = this.dep.barramento;
    const passos: PassoExecutado[] = [];

    for (const passo of plano.passos) {
      if (controle.signal.aborted) break;
      // O passo de raciocínio é resolvido na composição da resposta, com
      // streaming. Aqui só passam as habilidades nativas.
      if (!passo.habilidade || passo.habilidade === 'raciocinio') continue;

      /**
       * O TETO DE PASSOS É CONFERIDO ANTES DE QUALQUER OUTRA PORTA — antes do
       * catálogo, do porteiro, do esquema e do jornal — porque ele é o único que
       * não fala sobre ESTE passo: fala sobre quanto o turno já gastou. Conferir
       * depois faria o orçamento cobrar por trabalho que outra porta ia barrar de
       * graça, e a mensagem ao operador citaria o recurso errado.
       *
       * O passo barrado continua na lista, e o laço NÃO para: cada passo que não
       * vai acontecer aparece na resposta com o motivo. Sair no primeiro estouro
       * deixaria o operador sabendo de um passo e ignorando os outros dois.
       *
       * `efeito_externo` entra na MESMA decisão para escrita, tudo ou nada — ver
       * `consumirVarios`. A semântica vem do manifesto declarado, não de uma
       * lista de nomes: habilidade de escrita nova nasce coberta.
       */
      /* Habilidade fora do catálogo cai como leitura para efeito de orçamento:
         ela vai ser barrada logo abaixo e não alcança o mundo, então cobrar
         `efeito_externo` dela seria cobrar por um efeito impossível. O `passo`
         continua sendo cobrado — o turno gastou uma vez do teto tentando. */
      const manifestoParaOrcamento = this.habilidades.manifesto(passo.habilidade);
      const escreve = manifestoParaOrcamento?.idempotencia !== undefined &&
        manifestoParaOrcamento.idempotencia !== 'leitura';
      const permissaoDoPasso = orcamento.consumirVarios(
        escreve
          ? [{ recurso: 'passo' as const }, { recurso: 'efeito_externo' as const }]
          : [{ recurso: 'passo' as const }],
      );
      if (!permissaoDoPasso.permitido) {
        this.trabalho.registrarErro();
        this.avisarOrcamento(permissaoDoPasso, `passo "${passo.descricao}"`);
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          /* `aguardando_confirmacao`, e não `falhou`: nada quebrou e nada
             aconteceu no mundo. Falta uma decisão de quem paga a conta — mandar
             de novo, ou subir o teto. É o mesmo verbo da recusa por autoridade,
             pela mesma razão: o operador precisa saber que a ação está de pé,
             não sepultada. */
          estado: 'aguardando_confirmacao',
          texto: '',
          evidencia: permissaoDoPasso.motivo,
        });
        b.publicar({
          tipo: 'PASSO_CONCLUIDO',
          passo,
          resumo: 'barrado pelo orçamento do turno',
          ms: 0,
        });
        continue;
      }

      this.trabalho.entrarNoPasso(passo.indice, passo.habilidade);
      b.publicar({ tipo: 'PASSO_INICIADO', passo, total: plano.passos.length });

      /**
       * Habilidade referenciada por um plano mas ausente do catálogo.
       *
       * Antes isto era `continue` mudo: o passo sumia, `saidas` ficava vazio e
       * a composição caía no raciocínio livre — onde a LLM, sem nenhum
       * resultado e sem saber que algo falhou, narrava a ação como se tivesse
       * acontecido. Era assim que "crie uma pasta" virava "pasta criada" sem
       * pasta nenhuma. Falha de catálogo agora é FATO REGISTRADO, e o fato
       * viaja até a resposta.
       */
      const manifesto = this.habilidades.manifesto(passo.habilidade);
      if (!manifesto) {
        this.trabalho.registrarErro();
        const motivo = `habilidade "${passo.habilidade}" não existe no catálogo`;
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: 'falhou',
          texto: '',
          evidencia: motivo,
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `habilidade_ausente:${passo.habilidade}`,
          detalhe: motivo,
          permitido: false,
        });
        b.publicar({ tipo: 'FALHA', modulo: 'catalogo', mensagem: motivo });
        b.publicar({ tipo: 'PASSO_CONCLUIDO', passo, resumo: `falhou: ${motivo}`, ms: 0 });
        this.erros.registrar({
          classe: 'habilidade_ausente',
          entrada: enunciado,
          observado: motivo,
          esperado: `plano determinístico só cita habilidade registrada no catálogo`,
          instante: new Date().toISOString(),
        });
        continue;
      }

      /**
       * PORTEIRO DE AUTORIZAÇÃO — entender não é autorizar.
       *
       * Antes do sandbox de propósito: o sandbox responde "este papel pode?", e
       * o papel `operador` concede `escrita`. Isso era tudo que separava um
       * plano emitido pela LLM de um `shutdown.exe`. Aqui se pergunta outra
       * coisa — QUEM autorizou este passo — e a resposta "a própria LLM" nunca
       * basta para risco alto.
       *
       * A recusa é FATO REGISTRADO, não silêncio: vai para `falhas`, e `falhas`
       * viaja até a resposta. Barrar sem contar seria trocar uma mentira
       * ("desliguei") por outra ("nada aconteceu").
       */
      const veredito = this.porteiro.avaliar({
        habilidade: passo.habilidade,
        risco: manifesto.risco,
        origem: plano.origem,
      });
      if (!veredito.permitido) {
        this.trabalho.registrarErro();
        /**
         * `aguardando_confirmacao`, não `falhou`: nada quebrou — falta
         * autoridade. O verbo que a resposta usa muda com isso, e é o verbo
         * que diz ao operador o que fazer a seguir.
         */
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: 'aguardando_confirmacao',
          texto: '',
          evidencia: veredito.motivo,
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `autorizacao_negada:${passo.habilidade}`,
          detalhe: `risco ${manifesto.risco}, origem ${plano.origem}`,
          permitido: false,
        });
        b.publicar({ tipo: 'FALHA', modulo: 'autorizacao', mensagem: veredito.motivo });
        b.publicar({ tipo: 'PASSO_CONCLUIDO', passo, resumo: 'barrado pela autorização', ms: 0 });
        this.erros.registrar({
          classe: 'autorizacao_negada',
          entrada: enunciado,
          observado: `plano ${plano.origem} tentou acionar "${passo.habilidade}" (risco ${manifesto.risco})`,
          esperado: 'ação de risco alto só nasce de pedido direto do operador',
          instante: new Date().toISOString(),
        });
        continue;
      }

      /**
       * TETO DE AUTONOMIA — achado em auditoria (14/08/2026): `Autonomia.ts`
       * define quatro capacidades na escada, mas só `falar_sem_ser_chamada`
       * (o `Vigia`) era de fato consultada. `executar_pedido` — a mais baixa
       * da escada, "rodar o que o operador pediu neste turno" — nunca era
       * checada em lugar nenhum: um operador que configurasse
       * `IARA_AUTONOMIA=conversa` esperando "nenhuma habilidade roda" via
       * habilidade alguma executando de qualquer jeito.
       *
       * NÃO É A CORREÇÃO COMPLETA. `executar_plano_aprovado` (rodar os
       * passos de um plano já autorizado, que a escada propositalmente exige
       * um degrau ACIMA de `executar_pedido`) continua sem checagem própria:
       * a receita `executar_plano` do Planejador marca `origem:
       * 'deterministico'` para os passos do plano aprovado exatamente como
       * marca para qualquer pedido direto — as duas formas são
       * indistinguíveis aqui sem uma mudança no tipo `Plano`, e inventar essa
       * distinção sob pressão de tempo é o tipo de decisão de design que essa
       * auditoria decidiu NÃO tomar às pressas. Resultado prático: no nível
       * `comando`, um passo de plano aprovado roda quando a escada diz que
       * deveria exigir `plano`. Nível padrão (`plano`) não é afetado — nesse
       * nível as duas capacidades já liberam a mesma coisa. Débito nomeado,
       * não escondido.
       */
      const nivelAutonomia = nivelAtual();
      if (!podeSem(nivelAutonomia, 'executar_pedido')) {
        const motivo = motivoDaRecusa(nivelAutonomia, 'executar_pedido');
        this.trabalho.registrarErro();
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: 'aguardando_confirmacao',
          texto: '',
          evidencia: motivo,
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `autonomia_insuficiente:${passo.habilidade}`,
          detalhe: `nível "${nivelAutonomia}" não alcança "executar_pedido"`,
          permitido: false,
        });
        b.publicar({ tipo: 'FALHA', modulo: 'autonomia', mensagem: motivo });
        b.publicar({ tipo: 'PASSO_CONCLUIDO', passo, resumo: 'barrado pelo teto de autonomia', ms: 0 });
        continue;
      }

      /**
       * REGISTRO DA OPERAÇÃO — a porta que faltava entre AUTORIZAR e EXECUTAR.
       *
       * Toda escrita ganha identidade, é gravada no jornal ANTES de o efeito
       * acontecer, e é deduplicada contra o que já existe. Leitura não passa por
       * aqui de propósito: uma consulta repetida devolve a mesma coisa, não há
       * duplicidade a evitar, e dar identidade persistida a cada leitura de
       * relógio encheria o jornal de linhas que nunca serão consultadas.
       *
       * A fronteira é a semântica DECLARADA no manifesto, não uma lista de
       * nomes de habilidade. Habilidade nova de escrita nasce coberta.
       */
      /**
       * VALIDAR ANTES DE ABRIR. A ordem é a correção, não o gosto.
       *
       * O esquema era conferido lá dentro do `GerenciadorHabilidades`, DEPOIS
       * de a operação já ter identidade, chave de idempotência e linha no
       * jornal — todas derivadas de parâmetros que ninguém tinha olhado. Um
       * plano da LLM com um campo a mais gravava a intenção errada no registro
       * de auditoria e só morria no passo seguinte; pior, dois pedidos que só
       * diferiam num campo inexistente produziam chaves de idempotência
       * DIFERENTES para o mesmo efeito real.
       *
       * Validar aqui faz o jornal registrar a ação de verdade — e é o que
       * permite ao portal carimbar `PARAMETROS_VALIDADOS` na prova sem mentir.
       */
      let parametrosValidados: Record<string, unknown>;
      try {
        parametrosValidados = this.habilidades.validarParametros(passo.habilidade, {
          ...passo.parametros,
        });
      } catch (erro) {
        this.trabalho.registrarErro();
        const motivo = (erro as Error).message;
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: 'falhou',
          texto: '',
          evidencia: motivo,
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `parametro_invalido:${passo.habilidade}`,
          detalhe: motivo,
          permitido: false,
        });
        b.publicar({ tipo: 'FALHA', modulo: 'esquema', mensagem: motivo });
        b.publicar({ tipo: 'PASSO_CONCLUIDO', passo, resumo: `falhou: ${motivo}`, ms: 0 });
        continue;
      }

      const abertura = await this.abrirOperacao(
        { habilidade: passo.habilidade, parametros: parametrosValidados },
        manifesto,
        plano.origem,
        enunciado,
      );
      if (!abertura.ok) {
        this.trabalho.registrarErro();
        /**
         * DEDUPLICAÇÃO CONTRA EFEITO JÁ VERIFICADO É UM RESULTADO, NÃO SILÊNCIO.
         *
         * Medido na auditoria de 16/08/2026, pedindo "abra o Bloco de Notas"
         * duas vezes seguidas. O segundo pedido voltou em 17 ms com:
         *
         *   "Não consegui executar esse pedido e não tenho resultado para
         *    mostrar. Nada foi alterado."
         *
         * As duas frases são falsas. A IARA CONSEGUIU — o aplicativo está
         * aberto — e o registro tinha a frase certa guardada: `não repeti
         * "abrir_aplicativo": <motivo>`. Ela nunca chegava ao operador porque
         * o passo era empilhado com `texto` vazio, e um passo sem texto e com
         * estado `verificado` não entra em NENHUMA das três listas que montam
         * a resposta — nem saídas, nem falhas, nem desconhecidos. Sobrava o
         * ramo de "plano que não produziu nada", que é outra coisa.
         *
         * "Nada foi alterado" era a parte cara: é afirmação sobre o mundo, e o
         * mundo dizia o contrário. O comentário logo acima, em `abrirOperacao`,
         * já tinha raciocinado exatamente sobre esse risco para `desconhecida`
         * — o caso `verificada` escapou por não ter para onde ir.
         *
         * `verificado` é o único estado que precisa disto. `falhou` e
         * `aguardando_confirmacao` já são contados por `falhasDe`, e
         * `desconhecido` por `desconhecidosDe`.
         */
        /**
         * A FRASE VAI EM PORTUGUÊS DE GENTE, o motivo cru fica na evidência.
         *
         * A primeira versão desta correção mandava `abertura.motivo` direto
         * para a fala e o operador lia: `não repeti "abrir_aplicativo": efeito
         * idêntico pedido há instantes (verificada)` — verdadeiro, e com o id
         * da habilidade e o nome interno do estado no meio. Trocar uma frase
         * falsa por um despejo de vocabulário do kernel é meio conserto: a
         * `evidencia` existe exatamente para guardar isso, e é ela que o
         * console técnico e o jornal mostram.
         */
        const jaAconteceu = abertura.estado === 'verificado';
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: abertura.estado,
          texto: jaAconteceu
            ? `Isso já estava feito — ${passo.descricao.toLowerCase()}. Não repeti para não duplicar o efeito.`
            : '',
          evidencia: abertura.motivo,
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `operacao_barrada:${passo.habilidade}`,
          detalhe: abertura.motivo,
          permitido: false,
        });
        b.publicar({ tipo: 'FALHA', modulo: 'operacao', mensagem: abertura.motivo });
        b.publicar({ tipo: 'PASSO_CONCLUIDO', passo, resumo: abertura.motivo, ms: 0 });
        continue;
      }
      const operacao = abertura.operacao;

      const inicio = Date.now();
      try {
        this.sandbox.verificar(passo.habilidade, manifesto.permissoes, this.papel);

        const v = await this.habilidades.executarVerificando({
          id: passo.habilidade,
          parametros: { ...passo.parametros },
          enunciado,
          id_usuario: this.dep.idUsuario,
          sessao: this.dep.sessao,
          sinal: controle.signal,
          concedidas: this.politica.permissoesDe(this.papel),
          registro: this.registro,
          // Os defeitos cognitivos desta sessão. Só a auditoria lê — ver
          // `ContextoHabilidade.erros`.
          erros: this.erros,
          operacao,
        });

        /**
         * AQUI a execução deixa de ser sinônimo de verdade.
         *
         * O texto que sobe para a resposta é o da habilidade, mas quando a
         * verificação não confirmou ele viaja ACOMPANHADO da ressalva. É a
         * diferença entre "Pasta criada" e "Pasta criada — mas não consegui
         * confirmar: o diretório não existe depois da execução".
         *
         * O `estado` que o Gerenciador apurou é ADOTADO, não recalculado. Antes
         * ele era descartado: `divergente` (o executor disse uma coisa e o
         * mundo disse outra — isto é FALHA) e `sem_meio_de_verificar` (limite
         * conhecido da plataforma — isto é DESCONHECIDO) caíam os dois no mesmo
         * balde de "verificação pendente", e a resposta os tratava igual.
         */
        const naoConfirmado =
          v.verificacao !== null && !v.verificacao.confirmado ? v.verificacao : null;

        /**
         * A habilidade pediu um parâmetro ao operador? Arma a retomada para o
         * PRÓXIMO turno — ver `pendenciaParametro` e o consumo em `processar`.
         * Os parâmetros guardados são os VALIDADOS: a retomada re-valida de
         * qualquer forma, mas guardar o que já passou no esquema evita
         * ressuscitar um parâmetro que o validador normalizou.
         */
        if (v.resultado.pendencia) {
          this.pendenciaParametro = {
            habilidade: passo.habilidade,
            parametros: parametrosValidados,
            parametro: v.resultado.pendencia.parametro,
          };
        }

        /**
         * `confirmaAcontecimento` é o predicado, não `naoConfirmado`.
         *
         * A diferença aparece na habilidade de risco que não declara
         * verificador: `verificacao` vem `null`, o antigo teste concluía
         * "confirmado" e a ressalva sumia — justo no caso em que menos se sabe.
         * O contrato do catálogo impede essa habilidade de existir, mas a
         * ressalva não pode depender de o contrato ser respeitado.
         *
         * O verbo vem de `Verdade.ts`. "[não confirmado: …]" era um rótulo
         * técnico; "[não consigo provar o que aconteceu: …]" é o que a IARA de
         * fato tem a dizer.
         */
        /**
         * A RESSALVA EXISTE PARA CONTRADIZER, e um texto que já se desmente não
         * precisa ser desmentido.
         *
         * O caso que ela foi feita para pegar é "Pasta criada em Downloads" com
         * a verificação dizendo que a pasta não está lá: ali a frase da
         * habilidade AFIRMA um efeito, e deixá-la sozinha é a mentira
         * operacional. O caso que ela estragava é o oposto — "Não consigo fazer
         * isso agora: o seu computador não está conectado a mim" seguido de
         * "[não consegui executar: nenhum braço registrado para este operador]".
         * Duas frases, um fato, e a segunda em linguagem de máquina.
         *
         * `resolveu: false` é confissão contra o próprio interesse, e por isso
         * dá para confiar nela AQUI (o cabeçalho de `ResultadoHabilidade` avisa
         * que o contrário — `resolveu: true` — nunca é prova de nada, e é
         * justamente esse ramo que continua ganhando a ressalva). A evidência
         * técnica não se perde: ela segue em `passos[].evidencia`, na auditoria
         * e no jornal.
         */
        const jaSeDesmente = !v.resultado.resolveu && v.resultado.texto.trim().length > 0;
        const texto =
          confirmaAcontecimento(v.estado) || jaSeDesmente
            ? v.resultado.texto
            : `${v.resultado.texto}\n\n[${VERBO_DO_ESTADO[v.estado]}: ` +
              `${naoConfirmado?.evidencia ?? 'esta habilidade não sabe conferir o próprio efeito'}]`;

        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: v.estado,
          /**
           * Passo que o mundo DESMENTIU não empresta seu texto à resposta. Era
           * assim que "Pasta criada em Downloads" continuava sendo a primeira
           * frase que o operador lia, com a desmentida escondida embaixo.
           *
           * Só `divergente`, não todo `falhou`. Quando o motivo é
           * `nao_encontrado`, o executor JÁ FOI HONESTO — "esse nome não passa
           * na minha regra de segurança, me diga outro" é a melhor frase que
           * existe para aquele momento, e trocá-la pela evidência crua puniria
           * a habilidade por ter contado a verdade.
           */
          texto: naoConfirmado?.motivo === 'divergente' ? '' : texto,
          evidencia: naoConfirmado?.evidencia ?? v.resultado.detalhe,
        });
        if (naoConfirmado?.motivo !== 'divergente') this.trabalho.concluirPasso(texto);

        // `sem_meio_de_verificar` é limitação conhecida da plataforma, não
        // defeito da IARA — registrar isso a cada `abrir_aplicativo` encheria
        // o inventário de ruído. `divergente` é outra coisa: o executor disse
        // uma coisa e o mundo disse outra, e isso É defeito.
        if (naoConfirmado?.motivo === 'divergente') {
          this.trabalho.registrarErro();
          this.erros.registrar({
            classe: 'execucao_nao_confirmada',
            entrada: enunciado,
            observado: `${passo.habilidade} relatou sucesso; verificação: ${naoConfirmado.evidencia}`,
            esperado: 'execução confirmada pelo mundo, ou falha declarada',
            instante: new Date().toISOString(),
          });
        }

        await this.fecharOperacao(operacao, v.estado, v.verificacao?.evidencia ?? v.resultado.detalhe);

        b.publicar({
          tipo: 'PASSO_CONCLUIDO',
          passo,
          resumo: naoConfirmado
            ? `${v.resultado.detalhe} — não confirmado (${v.estado})`
            : v.resultado.detalhe,
          ms: Date.now() - inicio,
        });
      } catch (erro) {
        if (controle.signal.aborted) break;
        this.trabalho.registrarErro();

        const estado = await this.apurarAposExcecao(
          passo,
          operacao,
          manifesto.risco,
          manifesto.idempotencia,
          erro,
          enunciado,
          controle,
        );
        const evidencia = estado.evidencia ?? (erro as Error).message;

        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: estado.estado,
          /**
           * O PASSO QUE O MUNDO CONFIRMOU PRECISA FALAR.
           *
           * Este `texto` era `''` sempre, e aí `verificado` vindo daqui não
           * entrava em `saidasDe` (filtra texto vazio) nem em `falhasDe` nem em
           * `desconhecidosDe` — ele simplesmente sumia. Um plano de passo único
           * cujo executor explodiu DEPOIS de aplicar o efeito respondia
           * "Não consegui executar esse pedido […]. Nada foi alterado." com o
           * efeito aplicado e o verificador confirmando que ele existe. Mentira
           * operacional pelo avesso, criada pela própria correção anterior.
           *
           * Só o ramo confirmado empresta texto: `falhou` e `desconhecido`
           * continuam sendo contados pela evidência, nas listas certas.
           */
          texto: estado.estado === 'verificado' ? evidencia : '',
          evidencia,
        });
        if (estado.estado === 'verificado') this.trabalho.concluirPasso(evidencia);
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `habilidade:${passo.habilidade}`,
          detalhe: `${estado.estado}: ${evidencia}`,
          permitido: false,
        });
        await this.fecharOperacao(operacao, estado.estado, evidencia);

        b.publicar({
          tipo: 'PASSO_CONCLUIDO',
          passo,
          resumo: `${estado.estado}: ${evidencia}`,
          ms: Date.now() - inicio,
        });
      }
    }

    return { passos };
  }

  /**
   * Dá identidade à escrita, autoriza-a e grava "vou executar" ANTES de
   * executar. Devolve `ok: false` quando o efeito não deve acontecer.
   *
   * A ORDEM DAS PORTAS É A SEGURANÇA, e cada uma cobre um caso distinto:
   *
   *  1. semântica desconhecida — quem não sabe o que a própria repetição causa
   *     não alcança o mundo;
   *  2. reserva — deduplicação e concorrência, num só passo síncrono;
   *  3. autorização — risco alto exige fala humana, e a fonte é tipada;
   *  4. jornal — o registro de intenção precisa estar no disco antes do efeito,
   *     senão um crash no meio não deixa rastro nenhum.
   *
   * O passo 4 é o que separa este desenho de um contador de duplicatas em
   * memória. Gravar depois seria mais rápido e inútil: o único momento em que o
   * jornal importa é justamente aquele em que o processo não chega ao "depois".
   */
  private async abrirOperacao(
    passo: { habilidade: string | null; parametros: Readonly<Record<string, unknown>> },
    manifesto: { id: string; risco: Risco; idempotencia: SemanticaEfeito },
    origem: Plano['origem'],
    enunciado: string,
  ): Promise<
    | { ok: true; operacao: Operacao | null }
    | { ok: false; estado: EstadoExecucao; motivo: string }
  > {
    /**
     * A FONTE DA AUTORIZAÇÃO VEM DA ORIGEM DO PLANO — e é a segunda barreira
     * contra a LLM, independente do porteiro.
     *
     * Plano determinístico nasce de uma âncora encontrada no texto que o
     * OPERADOR escreveu: a autorização é, literalmente, a fala dele. Plano
     * emergente nasce da camada de raciocínio e carimba `porteiro`, que
     * `transicionar` recusa para risco alto. Mesmo que alguém apague a checagem
     * do porteiro, um passo de risco alto proposto pela LLM continua sem
     * conseguir chegar a `autorizada`.
     */
    const r = await this.portal.abrir({
      id_usuario: this.dep.idUsuario,
      sessao: this.dep.sessao,
      acao: manifesto.id,
      risco: manifesto.risco,
      semantica: manifesto.idempotencia,
      parametros: { ...passo.parametros },
      /**
       * O TRAÇO DO BARRAMENTO É A IDENTIDADE DO TURNO — o discriminador inteiro
       * da chave de idempotência. `novoTraco()` roda uma vez por mensagem do
       * operador: o mesmo turno reexecutado colide, um turno novo não.
       */
      origem_pedido: this.dep.barramento.tracoAtual,
      fonte_autorizacao: origem === 'deterministico' ? 'operador' : 'porteiro',
      motivo_autorizacao:
        origem === 'deterministico'
          ? 'pedido direto do operador (plano determinístico)'
          : `plano ${origem}, risco ${manifesto.risco}`,
      /**
       * As reivindicações da prova. `enunciado` vira `hash_intencao` — a ponte
       * entre a linha de auditoria e o pedido humano, sem copiar o texto da
       * conversa para dentro do jornal.
       */
      enunciado,
      papel: this.papel,
      escopo: this.politica.permissoesDe(this.papel),
      /**
       * O portal não conhece esquema de habilidade; esta é a única invariante
       * que só o Kernel pode atestar, e ele a atesta porque acabou de rodar
       * `validarParametros` sobre exatamente estes parâmetros.
       */
      invariantes_conferidas: ['PARAMETROS_VALIDADOS'],
    });

    if (r.ok) return r;

    /**
     * Tradução do vocabulário do portal (ciclo de vida da operação) para o do
     * turno (`Verdade.ts`). `desconhecida` vira `desconhecido`, e nunca
     * `falhou`: dizer "não executei" seria verdade sobre ESTE turno e mentira
     * sobre o mundo — o efeito anterior pode existir.
     */
    return {
      ok: false,
      estado:
        r.estado === 'verificada'
          ? 'verificado'
          : r.estado === 'falhou'
            ? 'falhou'
            : 'desconhecido',
      motivo: r.motivo,
    };
  }

  /**
   * Fecha a operação com o que se APUROU — traduzindo o vocabulário de
   * `Verdade.ts` (o que se sabe deste passo) para o de `Operacao.ts` (o ciclo
   * de vida da coisa persistida).
   *
   * A tradução é o ponto todo. `verificado` só vira `verificada` carregando uma
   * prova de fonte `verificador`; qualquer outra fonte faz `transicionar`
   * lançar. É "execução não é verificação" imposto por tipo, num único lugar,
   * em vez de por disciplina em vários.
   */
  private async fecharOperacao(
    operacao: Operacao | null,
    estado: EstadoExecucao,
    evidenciaTexto: string,
  ): Promise<void> {
    const destino =
      estado === 'verificado'
        ? 'verificada'
        : estado === 'falhou'
          ? 'falhou'
          : estado === 'executado'
            ? 'executada_nao_verificada'
            : 'desconhecida';

    /**
     * `verificador` só quando o estado É verificado. É "execução não é
     * verificação" imposto por tipo: qualquer outra fonte faz `transicionar`
     * lançar, e o portal degrada para `desconhecida` — nunca para sucesso.
     */
    await this.portal.fechar(
      operacao,
      destino,
      destino === 'verificada' ? 'verificador' : 'executor',
      evidenciaTexto,
    );
  }

  /**
   * O executor explodiu. E daí — o mundo mudou ou não?
   *
   * O DEFEITO que este método corrige (P1 da auditoria de fechamento): toda
   * exceção virava `falhas`, e `falhas` sem nenhuma saída produzia a frase
   * "Não executei isso. […]. Nada foi alterado na máquina." Para uma exceção de
   * PORTA (permissão, esquema, credencial ausente) essa frase é verdadeira: o
   * executor nunca rodou. Para um TIMEOUT ela é um chute — `criar_pasta` pode
   * ter alcançado o disco antes de o relógio estourar, e um envio pode ter
   * chegado ao destinatário antes de a resposta se perder. Afirmar "nada foi
   * alterado" nesse caso é a mentira operacional pelo avesso: negar um efeito
   * que existe.
   *
   * A ordem é: primeiro descartar o que nem chegou a executar; depois PERGUNTAR
   * AO MUNDO; e só quando não há a quem perguntar admitir `desconhecido`.
   */
  private async apurarAposExcecao(
    passo: { habilidade: string | null; parametros: Readonly<Record<string, unknown>> },
    operacao: Operacao | null,
    risco: string,
    /**
     * A SEMÂNTICA DECLARADA, e ela entrou aqui por causa de uma medição.
     *
     * O atalho abaixo era `risco === 'baixo'`, na premissa de que consulta não
     * muda o mundo. A premissa vale enquanto a declaração for coerente — e nada
     * no repositório impõe `risco baixo ⇒ semântica leitura`. `assumir_plano`
     * está no catálogo hoje com `risco: 'baixo'` e `escrita_idempotente`.
     *
     * Com um `baixo` que ESCREVE, um timeout depois do efeito virava `falhou`, e
     * `falhou` faz a resposta dizer "Nada foi alterado na máquina" — afirmação
     * sobre o mundo, sem ninguém ter olhado o mundo. Achado pela bateria de falsa
     * conclusão (17/08/2026), que contou isso como falsa negativa.
     *
     * Agora o atalho exige as DUAS coisas. Leitura de verdade continua no caminho
     * rápido; escrita declarada com risco baixo passa pela apuração como
     * qualquer escrita — e sem verificador cai em `desconhecido`, que é o estado
     * honesto para "aconteceu e ninguém confirmou".
     */
    semantica: SemanticaEfeito,
    erro: unknown,
    enunciado: string,
    controle: AbortController,
  ): Promise<{ estado: EstadoExecucao; evidencia?: string }> {
    const mensagem = (erro as Error).message;

    /**
     * Exceção de PORTA: barrada antes do executor. Aqui "nada aconteceu" é
     * fato, não suposição — e `HabilidadeExpirou` deliberadamente NÃO entra
     * nesta lista.
     */
    const antesDeExecutar =
      erro instanceof PermissaoNegada ||
      erro instanceof ParametroInvalido ||
      /indisponível:/.test(mensagem);
    if (antesDeExecutar || (risco === 'baixo' && semantica === 'leitura')) {
      return { estado: 'falhou', evidencia: mensagem };
    }

    const apuracao = await this.habilidades
      .apurar(
        passo.habilidade!,
        {
          parametros: { ...passo.parametros },
          enunciado,
          id_usuario: this.dep.idUsuario,
          sessao: this.dep.sessao,
          sinal: controle.signal,
          concedidas: this.politica.permissoesDe(this.papel),
          registro: this.registro,
          // Os defeitos cognitivos desta sessão. Só a auditoria lê — ver
          // `ContextoHabilidade.erros`.
          erros: this.erros,
          operacao,
        },
        { texto: '', detalhe: mensagem, resolveu: false },
      )
      .catch(() => null);

    if (apuracao?.confirmado) {
      // O executor quebrou DEPOIS de alcançar o mundo. O efeito existe.
      return {
        estado: 'verificado',
        evidencia: `o executor falhou (${mensagem}), mas o mundo confirma: ${apuracao.evidencia}`,
      };
    }
    if (apuracao && apuracao.motivo !== 'sem_meio_de_verificar') {
      return { estado: 'falhou', evidencia: `${mensagem}; ${apuracao.evidencia}` };
    }
    return {
      estado: 'desconhecido',
      evidencia: `${mensagem} — e não consigo apurar se chegou a acontecer`,
    };
  }

  /**
   * Compõe a resposta final.
   *
   * Um plano determinístico de passo único já tem a resposta pronta — mandar
   * isso para a LLM seria gastar token para reescrever o que já está correto.
   * Plano com raciocínio, ou com vários passos, precisa de síntese.
   */
  private async comporResposta(
    plano: Plano,
    execucao: ExecucaoPlano,
    percepcao: ReturnType<MotorPercepcao['perceber']>,
    idMensagem: string,
    /** O `op:` da pergunta deste turno — carimbo de `responde_a` em cada
     *  trecho. Parâmetro, e não campo lido na hora de publicar: campo lido na
     *  hora é exatamente o acoplamento implícito que produziu o CC-01. */
    respondeA: string,
    controle: AbortController,
    orcamento: OrcamentoDoTurno,
  ): Promise<string> {
    const b = this.dep.barramento;
    const saidas = saidasDe(execucao);
    const falhas = falhasDe(execucao);
    const verificacoesPendentes = desconhecidosDe(execucao);
    const precisaRaciocinio = plano.passos.some(
      (p) => !p.habilidade || p.habilidade === 'raciocinio',
    );

    if (!precisaRaciocinio && saidas.length > 0) {
      /**
       * FALHA PARCIAL — o que deu certo não pode apagar o que não deu.
       *
       * Este ramo devolvia só `saidas`, e `falhas` morria aqui. Um plano de dois
       * passos em que o primeiro lia o relógio e o segundo era BARRADO pela
       * autorização respondia "São 10:55" e mais nada: a recusa aparecia no
       * console e no evento `FALHA`, nunca na fala. O operador concluía que o
       * pedido inteiro tinha sido atendido.
       *
       * É a mesma família da mentira operacional que o resto deste arquivo
       * combate — só que pelo avesso: em vez de afirmar o que não aconteceu,
       * omitir o que não aconteceu. As duas produzem uma resposta que não
       * representa o estado real do mundo.
       */
      const texto = [
        saidas.join('\n\n'),
        falhas.length > 0 ? `O resto do pedido eu NÃO executei: ${falhas.join('; ')}.` : '',
        verificacoesPendentes.length > 0
          ? `Sobre o resto, ${VERBO_DO_ESTADO.desconhecido}: ${verificacoesPendentes.join('; ')}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto, responde_a: respondeA });
      return texto;
    }

    /**
     * Plano determinístico que não produziu UMA saída sequer.
     *
     * Aqui não se cai para a LLM. O operador pediu uma AÇÃO, a ação não
     * aconteceu, e mandar isso para o raciocínio livre — sem resultado e sem
     * ferramenta — é exatamente a receita da ação inventada. A resposta
     * honesta é dizer o que falhou.
     *
     * "NADA FOI ALTERADO" É UMA AFIRMAÇÃO SOBRE O MUNDO, e por isso só sai
     * quando o mundo a sustenta. Com um passo em `desconhecido` — um timeout
     * que pode ter alcançado o disco, uma resposta que se perdeu depois do
     * efeito — essa frase é um chute com cara de garantia, e o operador tomaria
     * decisão em cima dela. O verbo honesto vem de `Verdade.ts`.
     */
    if (!precisaRaciocinio && saidas.length === 0) {
      const naoSei = verificacoesPendentes.length > 0;
      const texto = naoSei
        ? `${VERBO_DO_ESTADO.desconhecido.replace(/^n/, 'N')}: ${verificacoesPendentes.join('; ')}. ` +
          (falhas.length > 0 ? `Além disso, não executei: ${falhas.join('; ')}. ` : '') +
          'Confira antes de repetir o pedido — pode ter acontecido pela metade.'
        : falhas.length > 0
          ? `Não executei isso. ${falhas.join('; ')}. Nada foi alterado na máquina.`
          : 'Não consegui executar esse pedido e não tenho resultado para mostrar. Nada foi alterado.';
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto, responde_a: respondeA });
      return texto;
    }

    /**
     * O TETO DE CHAMADA DE MODELO, conferido antes da síntese.
     *
     * Aqui a degradação é a mesma da camada desligada, e por isso ela reaproveita
     * o ramo de baixo em vez de inventar um terceiro: o que muda é o motivo, não
     * o comportamento. O que o turno já produziu é entregue; o que dependia de
     * mais uma ida ao modelo é declarado como não feito.
     *
     * Este é o ponto do turno onde o estouro mais dói e onde ele é mais
     * necessário: síntese é a chamada mais cara (histórico, persona, catálogo e
     * contexto no prompt), e é a que um laço de reparo futuro vai querer repetir.
     */
    const permissaoDaSintese = orcamento.consumir('chamada_modelo');
    if (!permissaoDaSintese.permitido) {
      this.avisarOrcamento(permissaoDaSintese, 'síntese da resposta');
      const texto = [
        saidas.length > 0 ? saidas.join('\n\n') : '',
        `${permissaoDaSintese.motivo}. ` +
          (saidas.length > 0
            ? 'Entreguei o que já estava pronto e não redigi o fechamento.'
            : 'Não cheguei a produzir resultado neste turno. Nada foi alterado por mim depois disso.'),
        falhas.length > 0 ? `Não executei: ${falhas.join('; ')}.` : '',
        verificacoesPendentes.length > 0
          ? `Sobre o resto, ${VERBO_DO_ESTADO.desconhecido}: ${verificacoesPendentes.join('; ')}.`
          : '',
      ]
        .filter(Boolean)
        .join('\n\n');
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto, responde_a: respondeA });
      return texto;
    }

    if (!this.raciocinio.disponivel) {
      const texto =
        saidas.length > 0
          ? `${saidas.join('\n\n')}\n\nPara ir além disso eu precisaria da camada de raciocínio, e ela está desligada aqui.`
          : 'Isso exige raciocínio aberto, e a camada de raciocínio está desligada — falta a chave da Anthropic no ambiente, ' +
            'e não há Ollama local configurado e alcançável. ' +
            'Prefiro dizer isso a improvisar. Local eu resolvo: clima, hora, infraestrutura, histórico de incidentes e busca.';
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto, responde_a: respondeA });
      return texto;
    }

    await this.dep.estado.transicionar('pensando', 'raciocinio');
    b.publicar({
      tipo: 'RACIOCINIO_INICIADO',
      modelo: this.raciocinio.modelo,
      origem: this.raciocinio.origem,
    });

    // Histórico enriquece o prompt; a ausência dele degrada a resposta, não
    // impede. Persistência fora não pode calar o raciocínio.
    const historico = await this.dep.memoria
      .historico(this.dep.idUsuario, 20)
      .catch(() => [] as Awaited<ReturnType<typeof this.dep.memoria.historico>>);
    const camadaGlobal = await this.dep.memoria.carregarGlobal().catch(() => '');

    /**
     * A ficha vem do ESTADO, não de uma leitura por turno: a `Porta` já a
     * carregou na abertura da sessão e a regrava ali quando o operador salva.
     * Reler o shard a cada raciocínio seria um ida-e-volta de persistência no
     * caminho crítico da resposta, para buscar algo que não mudou.
     *
     * Ordem importa: a ficha (declarada, estável) vem antes da leitura de
     * humor (inferida, volátil). Quem lê o prompt encontra primeiro quem é a
     * pessoa, depois como ela está agora, e por último o quanto vocês já
     * conversaram — que é o que abre ou fecha a provocação amigável.
     */
    const instantaneo = this.dep.estado.instantaneo();
    const perfil = instantaneo.operador;
    const overridePersona = [
      TeoriaDaMente.overrideDePreferencias(
        normalizarPreferencias(perfil?.preferencias),
        perfil?.nome ?? '',
      ),
      TeoriaDaMente.overrideDePersona(percepcao.leitura),
      TeoriaDaMente.overrideDeFamiliaridade(instantaneo.metricas.afinidade),
      /**
       * A TRAVA CONTRA A PROMESSA VAZIA — achada em auditoria (14/08/2026).
       *
       * `execucao.passos` só ganha entrada quando um passo REAL de habilidade
       * rodou (`executarPlano` pula o passo `raciocinio` com `continue`, sem
       * empurrar nada para a lista). Chegar aqui com a lista vazia significa
       * que este turno é 100% conversa: nenhuma ferramenta foi acionada, e
       * nenhuma vai ser depois — o turno termina no texto que sai daqui.
       *
       * Sem esta trava, a persona ("nomeie a capacidade") e o hábito de
       * assistente de escrever "vou verificar"/"vou rodar" se combinam numa
       * promessa que ninguém cumpre: o texto sai como resposta FINAL, o
       * turno fecha, e o operador só descobre que nada aconteceu mandando
       * outra mensagem — que a LLM, sem nenhum resultado real para relatar,
       * respondia inventando um desfecho. As duas metades desse defeito
       * fecham aqui: a primeira impede a promessa vazia; a correção da
       * âncora de `diagnostico` (`Percepcao.ts`) fecha o caso concreto que a
       * expôs, fazendo mais pedidos chegarem a este método já com um passo
       * executado de verdade.
       */
      execucao.passos.length === 0
        ? 'ESTE TURNO NÃO ACIONOU NENHUMA FERRAMENTA E NENHUMA VAI RODAR DEPOIS: ' +
          'você está respondendo só com o que já sabe agora. Nunca diga "vou verificar", ' +
          '"vou rodar", "vou checar" ou qualquer variação de ação futura — você não tem como ' +
          'cumprir essa promessa neste turno, e o operador só vai saber que nada aconteceu se ' +
          'mandar outra mensagem perguntando. Responda com o que você sabe agora; se a resposta ' +
          'exige uma ação real (rodar diagnóstico, abrir algo, medir alguma coisa), diga isso e ' +
          'peça o pedido de forma mais direta, para que ele seja executado de verdade desta vez.'
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    /**
     * A TRAVA DA FALA — o conserto do 56%.
     *
     * Medido em 17/08/2026 (`npm run bateria -- falsa_conclusao`): com um provedor
     * que mente por construção, o caminho determinístico não afirmou efeito falso
     * nenhuma vez em 11 claims, e o caminho cognitivo afirmou em 9 de 16. A única
     * defesa aqui era a linha de contexto pedindo "não afirme que foram" —
     * instrução, não trava.
     *
     * `alcancouOMundo` é ESTREITO de propósito: só `falhou` e
     * `aguardando_confirmacao` deixam a trava armada. Um passo `desconhecido`
     * pode ter acontecido, e nesse caso o texto tem outra correção a fazer (o
     * verbo de `Verdade.ts`), não esta. Entre deixar passar uma afirmação — que a
     * bateria acusa — e engolir uma resposta honesta — que o operador nunca
     * entende —, esta trava erra para o primeiro lado.
     *
     * COM A TRAVA ARMADA, A FALA NÃO É TRANSMITIDA ENQUANTO CHEGA. Conferir
     * depois de streamar deixaria a mentira aparecer na tela e ser substituída
     * meio segundo depois, e o operador já teria lido. O custo — perder a
     * digitação ao vivo — cai só nos turnos em que nenhum passo chegou ao mundo,
     * que são exatamente os turnos em que não há nada de bom para mostrar rápido.
     */
    const alcancouOMundo = execucao.passos.some(
      (x) => x.estado === 'verificado' || x.estado === 'executado' || x.estado === 'desconhecido',
    );
    /**
     * O TURNO SEM PASSO NENHUM TAMBÉM ARMA, quando o pedido era um COMANDO.
     *
     * O buraco foi achado pela campanha adversarial em 18/08/2026, missão CO-04, e
     * a cadeia inteira está no protocolo: o operador pediu, em português falado
     * ("cria ai uma pastinha chamada Teste X na area d trabalho vlw"), nenhuma
     * âncora casou, a função executiva mandou para `plano_cognitivo`, e o plano
     * emergente da LLM teve UM passo — `raciocinio`. `executarPlano` pula o passo
     * de raciocínio com `continue` e não empurra nada para a lista, então
     * `execucao.passos.length === 0`, a trava não armava, e a fala saiu afirmando
     * que a pasta existia. O mundo desmentiu: FALSO_POSITIVO.
     *
     * A bateria de falsa conclusão não podia ter achado isso — ela CONSTRÓI os
     * turnos, e sempre com passo. Foi preciso um modelo de verdade planejando mal
     * para produzir a forma que ninguém imaginou.
     *
     * `tipo === 'comando'` é o que mantém a trava estreita. Turno de conversa e
     * saudação continuam fora: numa conversa, "consegui entender" é frase honesta,
     * e engolir resposta legítima é o defeito simétrico que custa mais caro. Aqui a
     * pessoa mandou FAZER algo, nada foi feito, e não há o que afirmar.
     */
    const comandoSemPasso = execucao.passos.length === 0 && percepcao.tipo === 'comando';
    /**
     * A PERGUNTA TEM ORÁCULO? Decidido ANTES da chamada porque é isto que retém
     * a fala: verificar depois de streamar deixaria o número errado aparecer na
     * tela e ser trocado meio segundo depois, que é a tela mentindo e se
     * corrigindo. `reconhece` é estreito de propósito — cada `true` a mais tira
     * a digitação ao vivo de um turno que não precisava.
     */
    const verificavel = this.verificacao?.reconhece(percepcao.bruto) ?? false;
    /**
     * PERGUNTA DE CARDINALIDADE QUE NÃO EXECUTOU NADA — a trava de autoridade.
     *
     * O INCIDENTE (produção, 19/08/2026): "quantos motoristas temos?" → *"75
     * motoristas diferentes — **mesma contagem que te dei agora há pouco**"*.
     * São 73. Não houve soma de listagem truncada (esse foi o defeito da
     * véspera, já fechado) e não houve chamada de ferramenta: a IARA repetiu a
     * própria resposta errada do histórico. O "já respondi isso" virou
     * credencial, e o erro passou a se auto-confirmar.
     *
     * POR QUE AQUI E NÃO NO `reconhece` DO VERIFICADOR. Reconhecer toda
     * pergunta de "quantos X" armaria a trava em TODO turno de contagem,
     * inclusive nos que funcionam — e a imensa maioria funciona. O E23 de
     * `escalada-verificada.test.ts` recusa isso com razão: punir o caminho bom
     * para pegar o ruim custa a digitação ao vivo de todo mundo.
     *
     * Aqui a conta é outra: neste ponto o turno JÁ executou (ou não), e a trava
     * arma só quando nada alcançou o mundo. O turno legítimo — o que consultou a
     * planilha — não paga nada.
     *
     * A REGRA É GERAL, e é o que a impede de virar `if pergunta.includes
     * ("motoristas")`: ela não conhece motorista, não conhece carga e não sabe
     * que a resposta é 73. Ela cobra PROCEDÊNCIA — um número que só poderia vir
     * de execução, num turno em que execução não houve.
     *
     * Memória segue resolvendo CONTEXTO e referência ("e em 2026?"). Nunca
     * VALOR: a hierarquia é execução no turno > fonte > memória > resposta
     * anterior da IARA > inferência da LLM, e as duas últimas não fornecem
     * número operacional quando existe operação que o produz.
     */
    const cardinalidadeSemExecucao =
      PERGUNTA_DE_CARDINALIDADE_OPERACIONAL.test(percepcao.bruto) && !alcancouOMundo;

    const travaArmada =
      (execucao.passos.length > 0 && !alcancouOMundo) ||
      comandoSemPasso ||
      verificavel ||
      cardinalidadeSemExecucao;

    const inicio = Date.now();
    let acumulado = '';
    let abriu = false;

    /* Guardado numa variável porque a ESCALADA refaz este mesmo pedido no pool
       premium quando o verificador contesta o valor. Ver `EscaladaDoTurno.ts`. */
    const pedidoDeSintese = {
      enunciado: percepcao.bruto,
      historico: historico.slice(0, -1),
      overridePersona,
      camadaGlobal,
      /**
       * O QUE ELA SABE FAZER, redigido do catálogo desta subida.
       *
       * Sai daqui porque é o Kernel quem tem o gerenciador — e porque a camada
       * que fala com a nuvem não pode importar habilidade nenhuma sem alcançar
       * o `AgenteLocal` por transitividade. Ver `PedidoRaciocinio.capacidades`.
       */
      capacidades: this.habilidades.descricaoParaPrompt(),
      /**
       * As falhas entram no contexto como FATO, não como silêncio. Sem esta
       * linha a LLM recebe um plano pela metade sem saber que metade faltou —
       * e preenche a lacuna com prosa plausível.
       */
      contexto: [
        /**
         * O que o operador CITOU entra aqui, junto com o resto do material de
         * terceiro — e não na posição de pedido. A percepção já o separou; se
         * ele voltasse a valer como enunciado, a separação teria sido só
         * cosmética. Ver `Enunciacao.ts` e a moldura em `MotorRaciocinio`.
         */
        percepcao.citado
          ? `--- trecho que o operador atribuiu a outra fonte ---\n${percepcao.citado}`
          : '',
        /**
         * O DESEMPATE DE MEMÓRIA CHEGA RESOLVIDO, não como matéria-prima.
         *
         * O histórico ia cru, e quando ele continha dois horários para a mesma
         * reunião era a LLM quem escolhia — sem política, sem registro, e sem
         * dizer ao operador que havia escolhido. Agora o kernel aplica
         * `maisForte` (procedência primeiro, recência só dentro da mesma
         * procedência) e manda o veredito junto com a evidência descartada.
         */
        contextoDeConflitos(detectarConflitos(extrairFatosHorario(historico))),
        this.trabalho.contextoAcumulado(),
        falhas.length > 0
          ? `--- passos que NÃO foram executados (não afirme que foram) ---\n${falhas.join('\n')}`
          : '',
        verificacoesPendentes.length > 0
          ? '--- executados mas NÃO CONFIRMADOS (diga que solicitou, não que está feito) ---\n' +
            verificacoesPendentes.join('\n')
          : '',
      ]
        .filter(Boolean)
        .join('\n\n'),
      sinal: controle.signal,
      /* A cadeia pergunta antes de tentar OUTRO elo. Sem isto, uma chamada de
         modelo contaria 1 no orçamento e custaria quatro idas à rede — que é
         exatamente o multiplicador que um teto de chamadas não vê. */
      aoTentarProvedor: () => orcamento.consumir('tentativa_provedor').permitido,
      aoReceberTexto: (pedaco: string) => {
        if (controle.signal.aborted) return;
        acumulado += pedaco;
        /* Trava armada: acumula e não publica. A sala continua em "pensando"
           porque é o que está acontecendo — ela ainda não falou. */
        if (travaArmada) return;
        if (!abriu) {
          abriu = true;
          void this.dep.estado.transicionar('falando', 'raciocinio');
        }
        b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto: acumulado, responde_a: respondeA });
      },
    };

    const r = await this.raciocinio.responder(pedidoDeSintese);

    b.publicar({
      tipo: 'RACIOCINIO_CONCLUIDO',
      tokens_entrada: r.tokens_entrada,
      tokens_saida: r.tokens_saida,
      cache_lido: r.cache_lido,
      ms: Date.now() - inicio,
    });

    /* Token é contabilizado DEPOIS porque ninguém sabe o custo antes de pagar.
       O teto atua na chamada seguinte — e é por isso que ele é teto de
       acumulado, com pior caso do tamanho de uma chamada. Está declarado no
       cabeçalho de `OrcamentoDoTurno`. */
    orcamento.registrar('tokens', r.tokens_entrada + r.tokens_saida);

    const textoDaLLM = r.texto || acumulado;

    /**
     * A VERIFICAÇÃO EM RUNTIME, e o lugar dela é este: a resposta existe e
     * NINGUÉM a leu ainda. Conferir depois de streamar não serviria de nada — o
     * operador já teria lido o número errado.
     *
     * PRECEDÊNCIA: vem antes da trava de afirmação-sem-efeito logo abaixo porque
     * as duas tratam turnos de forma diferente — aquela é sobre COMANDO que não
     * aconteceu, esta sobre PERGUNTA respondida com valor errado. Na prática não
     * se cruzam; quando cruzarem, contestar o valor é o achado mais específico.
     *
     * `reconhece` foi perguntado lá em cima e é o que armou a trava: sem isso,
     * chegar aqui com o texto já na tela tornaria a escalada decorativa.
     */
    if (verificavel) {
      const verificado = await this.verificarEEscalar({
        texto: textoDaLLM,
        pergunta: percepcao.bruto,
        inicio,
        pedido: pedidoDeSintese,
        orcamento,
        b,
        idMensagem,
        respondeA,
      });
      if (verificado !== null) return verificado;
    }

    if (travaArmada) {
      const leitura = lerAfirmacaoDeFeito(textoDaLLM);
      if (leitura.afirma) {
        /**
         * A síntese afirmou efeito e nenhum passo chegou ao mundo. Ela é
         * DESCARTADA e a resposta volta a ser composta pelo Kernel — que é o
         * caminho medido em 0% de falsa conclusão.
         *
         * O descarte é DITO ao operador. Uma trava que corrige em silêncio
         * ensina que a IARA às vezes muda de assunto sozinha; e um dia em que a
         * trava errar, ninguém terá como saber que foi ela.
         */
        this.trabalho.registrarErro();
        b.publicar({
          tipo: 'FALHA',
          modulo: 'verdade',
          mensagem:
            `A síntese afirmava efeito ("${leitura.ancora}") e nenhum passo deste turno ` +
            'chegou ao mundo. Descartada.',
        });
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: 'sintese_descartada:afirmacao_sem_efeito',
          detalhe: `âncora "${leitura.ancora}"`,
          permitido: false,
        });
        this.erros.registrar({
          classe: 'afirmacao_sem_efeito',
          entrada: percepcao.bruto,
          observado: `a síntese afirmou "${leitura.ancora}" com nenhum passo alcançando o mundo`,
          esperado: 'a fala não afirma o que os passos não sustentam',
          instante: new Date().toISOString(),
        });

        const texto = [
          saidas.length > 0 ? saidas.join('\n\n') : '',
          falhas.length > 0
            ? `Não executei isso. ${falhas.join('; ')}. Nada foi alterado na máquina.`
            : 'Não executei o que você pediu, e não tenho resultado para mostrar. ' +
              'Nada foi alterado na máquina.',
          'Eu tinha redigido um fechamento dizendo que estava feito. Não está, ' +
            'então descartei o fechamento em vez de te entregar ele.',
        ]
          .filter(Boolean)
          .join('\n\n');

        b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: idMensagem,
          texto,
          responde_a: respondeA,
        });
        return texto;
      }

      /* Não afirmou nada: a fala é honesta e vai inteira, de uma vez — foi só a
         transmissão ao vivo que ficou retida. */
      await this.dep.estado.transicionar('falando', 'raciocinio');
      b.publicar({
        tipo: 'RESPOSTA_TRECHO',
        id_mensagem: idMensagem,
        texto: textoDaLLM,
        responde_a: respondeA,
      });
      return textoDaLLM;
    }

    await this.dep.estado.aplicarIntencao({ campo: 'energia_cognitiva', delta: -0.06 });
    await this.dep.estado.aplicarIntencao({
      campo: 'carga_contextual',
      delta: Math.min(0.25, r.tokens_entrada / 40000),
    });

    return r.texto || acumulado;
  }

  /**
   * VERIFICA A RESPOSTA E, SE FOR O CASO, ESCALA UMA VEZ.
   *
   * Devolve o texto a entregar, ou `null` quando não há veredito que mude o
   * caminho — aí o fluxo normal da síntese segue como sempre seguiu.
   *
   * O LAÇO TEM NO MÁXIMO DUAS VOLTAS, e isso é estrutural, não convenção:
   * `ja_escalou` vira `true` na primeira e `decidirEscalada` degrada em toda
   * situação contestada com ele ligado. Uma escalada por TURNO — não por
   * provedor, não por verificação.
   */
  private async verificarEEscalar(a: {
    texto: string;
    pergunta: string;
    inicio: number;
    pedido: Parameters<MotorRaciocinio['responder']>[0];
    orcamento: OrcamentoDoTurno;
    b: BarramentoEventos;
    idMensagem: string;
    respondeA: string | null;
  }): Promise<string | null> {
    const porta = this.verificacao;
    if (!porta) return null;

    let texto = a.texto;
    let jaEscalou = false;

    for (let volta = 0; volta < 2; volta += 1) {
      const resultado = porta.verificar(texto, {
        pergunta: a.pergunta,
        inicio_ms: a.inicio,
        fim_ms: Date.now(),
      });

      /* O ORÇAMENTO É O DONO DO LAÇO — perguntado sem debitar, para que avaliar
         a escalada não gaste a chamada que talvez não aconteça. */
      const cabe = a.orcamento.podeGastar([
        { recurso: 'chamada_modelo' },
        { recurso: 'tentativa_provedor' },
      ]);

      const decisao = decidirEscalada({
        resultado,
        ja_escalou: jaEscalou,
        orcamento_permite: cabe,
        premium_saudavel: this.raciocinio.premiumSaudavel,
      });

      this.auditoria.registrar({
        instante: new Date().toISOString(),
        sessao: this.dep.sessao,
        id_usuario: this.dep.idUsuario,
        traco: a.b.tracoAtual,
        acao: `verificacao:${resultado.status}:${decisao.acao}`,
        detalhe: decisao.porque,
        permitido: decisao.acao !== 'degradar',
      });

      if (decisao.acao === 'entregar') {
        /* Nada a corrigir. `null` na primeira volta devolve o turno ao fluxo
           normal; depois de uma escalada, o texto premium é o que sai. */
        if (!jaEscalou) return null;
        await this.dep.estado.transicionar('falando', 'raciocinio');
        a.b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: a.idMensagem,
          texto,
          responde_a: a.respondeA,
        });
        return texto;
      }

      if (decisao.acao === 'degradar') {
        /**
         * O DESCARTE É DITO. Uma verificação que corrige em silêncio ensina que
         * a IARA às vezes muda de assunto sozinha — e no dia em que ELA errar,
         * ninguém terá como saber que foi ela. Mesma regra da trava da fala.
         */
        this.trabalho.registrarErro();
        a.b.publicar({
          tipo: 'FALHA',
          modulo: 'verdade',
          mensagem: `Valor contestado por fonte independente: ${decisao.porque}`,
        });
        const honesto = textoDegradado(resultado);
        await this.dep.estado.transicionar('falando', 'raciocinio');
        a.b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: a.idMensagem,
          texto: honesto,
          responde_a: a.respondeA,
        });
        return honesto;
      }

      /* ---- ESCALAR. Debita ANTES de gastar a rede. -------------------- */
      const debito = a.orcamento.consumirVarios([
        { recurso: 'chamada_modelo' },
        { recurso: 'tentativa_provedor' },
      ]);
      if (!debito.permitido) {
        /* A janela entre perguntar e debitar. Não deveria acontecer num turno
           de uma linha de execução só, e mesmo assim degrada em vez de seguir:
           gastar rede sem orçamento é o defeito que o teto existe para impedir. */
        const honesto = textoDegradado(resultado);
        a.b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: a.idMensagem,
          texto: honesto,
          responde_a: a.respondeA,
        });
        return honesto;
      }

      jaEscalou = true;
      try {
        const premium = await this.raciocinio.responderNoPremium(a.pedido, decisao.porque);
        texto = premium.texto;
      } catch (erro) {
        /* O premium não respondeu. Isso é falha de PROVEDOR, não valor
           contestado — e a resposta honesta continua sendo a degradação, nunca o
           número que a fonte desmentiu. */
        a.b.publicar({
          tipo: 'FALHA',
          modulo: 'escalada',
          mensagem: `a escalada ao premium falhou: ${(erro as Error).message}`,
        });
        const honesto = textoDegradado(resultado);
        a.b.publicar({
          tipo: 'RESPOSTA_TRECHO',
          id_mensagem: a.idMensagem,
          texto: honesto,
          responde_a: a.respondeA,
        });
        return honesto;
      }
    }

    /* Inalcançável: a segunda volta sempre termina em `entregar` ou `degradar`,
       porque `ja_escalou` está ligado. Fica como rede, não como caminho. */
    return texto;
  }

  /**
   * Grava no shard sem deixar a persistência derrubar o atendimento.
   *
   * A falha vira alerta no console, uma vez por turno. Sem isso, uma tabela
   * ausente no Supabase transforma a IARA inteira em silêncio — que foi
   * exatamente o que aconteceu quando o schema não tinha sido aplicado.
   */
  private async registrarSemQuebrar(
    papel: 'operador' | 'iara',
    texto: string,
    destino?: DestinoCognitivo,
  ): Promise<void> {
    try {
      await this.dep.memoria.registrar(this.dep.idUsuario, papel, texto, destino);
    } catch (erro) {
      this.dep.barramento.publicar({
        tipo: 'FALHA',
        modulo: 'memoria',
        mensagem: `histórico não gravado (${(erro as Error).message}). O atendimento segue.`,
      });
    }
  }

  private destinoDe(rota: string): DestinoCognitivo {
    if (rota === 'sigilo') return 'recusa_sigilo';
    if (rota === 'plano_local') return 'sistema_local';
    return 'claude_nuvem';
  }

  /**
   * A fala do operador não pode virar despejo de JSON.
   *
   * Achado em auditoria (14/08/2026): `(erro as Error).message` de um erro do
   * SDK da Anthropic (sobrecarga, limite de taxa) TRAZ o corpo JSON da
   * resposta embutido na string — e aquele texto ia inteiro para a bolha de
   * chat, sem quebra de linha possível, estourando a largura do card. O
   * `mensagem` bruto continua indo pro evento `FALHA` (console técnico); só a
   * fala que o operador lê é que precisa ser curta e em português.
   */
  private mensagemHumanaDeFalha(bruta: string): string {
    /**
     * SEM CRÉDITO NÃO É "TENTE DE NOVO" — incidente real de 15/08/2026: a
     * conta da Anthropic zerou e TODO turno de nuvem passou a falhar com a
     * mensagem genérica, que mandava a operadora tentar de novo uma coisa que
     * nunca ia funcionar. Ela concluiu, com razão, que a IARA inteira estava
     * quebrada. Falta de crédito tem UM conserto (recarregar) e UMA pessoa
     * que consegue fazê-lo — a mensagem precisa dizer exatamente isso.
     */
    if (/credit balance is too low|billing/i.test(bruta)) {
      /**
       * A LISTA VEM DAS RECEITAS, NUNCA DA MEMÓRIA DE QUEM ESCREVE A FRASE.
       *
       * Auditoria de 18/08/2026: esta frase prometia "clima, hora,
       * infraestrutura, histórico e busca" e três das cinco devolviam esta
       * mesma frase quando pedidas. A lista estava escrita à mão aqui e de novo
       * em `resumirProvedores` — duas cópias que ninguém comparava com as
       * receitas que existem. Ver `CAPACIDADES_SEM_NUVEM`.
       */
      return (
        'A cota da nuvem desta instalação acabou — não é defeito, é crédito. ' +
        'Avise quem administra a IARA para recarregar. ' +
        `Enquanto isso continuo com o que é local: ${capacidadesSemNuvemEmTexto()}.`
      );
    }
    if (/overloaded_error|rate_limit_error/i.test(bruta)) {
      return 'A camada de raciocínio da IARA está sobrecarregada agora. Tente de novo em alguns segundos.';
    }
    if (/timeout|ETIMEDOUT/i.test(bruta)) {
      return 'A resposta demorou demais e foi interrompida. Tente de novo.';
    }
    const pareceTecnica = bruta.trim().startsWith('{') || bruta.length > 200;
    return pareceTecnica
      ? 'Não consegui concluir esse pedido agora. O detalhe técnico ficou registrado; tente de novo.'
      : `Não consegui concluir esse pedido: ${bruta}`;
  }
}
