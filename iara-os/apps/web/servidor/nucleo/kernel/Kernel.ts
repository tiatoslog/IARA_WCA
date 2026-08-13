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
import { Planejador } from './Planejador';
import { FuncaoExecutiva } from './FuncaoExecutiva';
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
import { PorteiroAutorizacao } from './PorteiroAutorizacao';
import type { Plano } from './Evento';
import { PermissaoNegada, ParametroInvalido, type Habilidade, type Risco } from './Habilidade';
import { confirmaAcontecimento, VERBO_DO_ESTADO, type EstadoExecucao } from './Verdade';
import { RegistroOperacoes, registroOperacoes } from './RegistroOperacoes';
import { PortalEfeitos } from './PortalEfeitos';
import { INTEGRACOES } from './integracoes';
// `provaDe`, não `evidencia`: o bloco de exceção deste arquivo já tem uma
// variável local com esse nome, e sombra silenciosa entre uma string e a função
// que carimba a fonte da prova é o tipo de colisão que compila e mente.
import type { Operacao, SemanticaEfeito } from './Operacao';
import { contextoDeConflitos, detectarConflitos, extrairFatosHorario } from './MemoriaFatos';
import type { DestinoCognitivo, EstagioCognitivo } from '../../../lib/estado';
import { normalizarPreferencias } from '../../../lib/perfil';

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
 * Passos que NÃO aconteceram. `aguardando_confirmacao` entra aqui porque, do
 * ponto de vista do operador, o efeito não existe — mudou só o motivo.
 */
const falhasDe = (e: ExecucaoPlano): string[] =>
  e.passos
    .filter((p) => p.estado === 'falhou' || p.estado === 'aguardando_confirmacao')
    .map((p) => `${p.descricao}: ${p.evidencia}`);

/**
 * A zona cinzenta entre "fiz" e "provei que fiz". Não são falhas, e tratá-las
 * como sucesso é a mentira operacional que este arquivo inteiro combate.
 */
const desconhecidosDe = (e: ExecucaoPlano): string[] =>
  e.passos
    .filter((p) => p.estado === 'desconhecido')
    .map((p) => `${p.descricao}: ${p.evidencia}`);

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

  constructor(private readonly dep: DependenciasKernel) {
    this.papel = dep.papel ?? 'operador';
    this.raciocinio = dep.raciocinio ?? new MotorRaciocinio();
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
    this.executiva = new FuncaoExecutiva(
      this.planejador,
      this.trabalho,
      dep.outrosOperadores,
      () => this.raciocinio.disponivel,
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

  /** Cancelamento preemptivo. Nenhuma trava global é segurada em rede. */
  cancelar(motivo = 'preempção'): void {
    if (!this.emAndamento) return;
    this.emAndamento.abort(new Error(motivo));
    this.emAndamento = null;
    this.dep.barramento.publicar({ tipo: 'TAREFA_CANCELADA', motivo });
  }

  // -------------------------------------------------------------------------

  async processar(texto: string): Promise<void> {
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
    const b = this.dep.barramento;
    b.novoTraco();
    const inicio = Date.now();

    try {
      b.publicar({ tipo: 'MENSAGEM_RECEBIDA', texto });

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

      const decisao = this.executiva.decidir(p, {
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
        const idPergunta = randomUUID();
        b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idPergunta, texto: decisao.pergunta });
        b.publicar({
          tipo: 'TAREFA_CONCLUIDA',
          id_mensagem: idPergunta,
          texto: decisao.pergunta,
          rota: 'esclarecer',
          ms: Date.now() - inicio,
        });
        await this.registrarSemQuebrar('iara', decisao.pergunta, 'sistema_local');
        return;
      }

      // --- 3. Plano ---------------------------------------------------------
      const plano = await this.montarPlano(decisao.rota, p, controle.signal);
      if (controle.signal.aborted) return;

      this.trabalho.iniciarTarefa(p, plano);
      b.publicar({ tipo: 'PLANO_CRIADO', plano });

      // --- 4. Execução ------------------------------------------------------
      const execucao = await this.executarPlano(plano, p.bruto, controle);
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
      const texto_final = await this.comporResposta(plano, execucao, p, idMensagem, controle);
      if (controle.signal.aborted) return;

      b.publicar({
        tipo: 'TAREFA_CONCLUIDA',
        id_mensagem: idMensagem,
        texto: texto_final,
        rota: decisao.rota,
        ms: Date.now() - inicio,
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
        texto:
          'Não consegui concluir esse pedido. Falhou em: ' +
          `${mensagem}. O detalhe completo está no console técnico.`,
        rota: 'falha',
        ms: Date.now() - inicio,
      });
    } finally {
      if (this.emAndamento === controle) this.emAndamento = null;
      this.trabalho.encerrarTarefa();
      await this.dep.estado.transicionar('ocioso', null);
    }
  }

  // -------------------------------------------------------------------------

  private async montarPlano(
    rota: string,
    p: Parameters<MotorPercepcao['perceber']> extends never ? never : ReturnType<MotorPercepcao['perceber']>,
    sinal: AbortSignal,
  ): Promise<Plano> {
    if (rota === 'sigilo') {
      return this.planejador.planoDeRecusa('Recusar acesso a registro de terceiro');
    }
    if (rota === 'plano_local') {
      return this.planejador.planejar(p);
    }
    if (rota === 'plano_cognitivo') {
      // A LLM DECOMPÕE. Ela não executa nada do que propôs — o kernel é quem
      // roda cada passo, com validação de esquema e permissão em cada um.
      const emergente = await this.raciocinio.planejar(p, this.habilidades.catalogo(), sinal);
      if (emergente) return emergente;
      // Planejamento falhou ou veio inválido: cai para o passo único, que
      // sempre funciona. Nunca executa plano pela metade.
      return this.planejador.planoDeRaciocinio(p);
    }
    return this.planejador.planoDeRaciocinio(p);
  }

  private async executarPlano(
    plano: Plano,
    enunciado: string,
    controle: AbortController,
  ): Promise<ExecucaoPlano> {
    const b = this.dep.barramento;
    const passos: PassoExecutado[] = [];

    for (const passo of plano.passos) {
      if (controle.signal.aborted) break;
      // O passo de raciocínio é resolvido na composição da resposta, com
      // streaming. Aqui só passam as habilidades nativas.
      if (!passo.habilidade || passo.habilidade === 'raciocinio') continue;

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
        passos.push({
          descricao: passo.descricao,
          habilidade: passo.habilidade,
          estado: abertura.estado,
          texto: '',
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
        const texto = confirmaAcontecimento(v.estado)
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

        const estado = await this.apurarAposExcecao(passo, operacao, manifesto.risco, erro, enunciado, controle);
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
    if (antesDeExecutar || risco === 'baixo') {
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
    controle: AbortController,
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
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto });
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
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto });
      return texto;
    }

    if (!this.raciocinio.disponivel) {
      const texto =
        saidas.length > 0
          ? `${saidas.join('\n\n')}\n\nPara ir além disso eu precisaria da camada de raciocínio, e ela está desligada aqui.`
          : 'Isso exige raciocínio aberto, e a camada de nuvem está desligada — falta a chave da Anthropic no ambiente. ' +
            'Prefiro dizer isso a improvisar. Local eu resolvo: clima, hora, infraestrutura, histórico de incidentes e busca.';
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto });
      return texto;
    }

    await this.dep.estado.transicionar('pensando', 'raciocinio');
    b.publicar({ tipo: 'RACIOCINIO_INICIADO', modelo: this.raciocinio.modelo });

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
    ]
      .filter(Boolean)
      .join('\n\n');

    const inicio = Date.now();
    let acumulado = '';
    let abriu = false;

    const r = await this.raciocinio.responder({
      enunciado: percepcao.bruto,
      historico: historico.slice(0, -1),
      overridePersona,
      camadaGlobal,
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
      aoReceberTexto: (pedaco) => {
        if (controle.signal.aborted) return;
        acumulado += pedaco;
        if (!abriu) {
          abriu = true;
          void this.dep.estado.transicionar('falando', 'raciocinio');
        }
        b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto: acumulado });
      },
    });

    b.publicar({
      tipo: 'RACIOCINIO_CONCLUIDO',
      tokens_entrada: r.tokens_entrada,
      tokens_saida: r.tokens_saida,
      cache_lido: r.cache_lido,
      ms: Date.now() - inicio,
    });

    await this.dep.estado.aplicarIntencao({ campo: 'energia_cognitiva', delta: -0.06 });
    await this.dep.estado.aplicarIntencao({
      campo: 'carga_contextual',
      delta: Math.min(0.25, r.tokens_entrada / 40000),
    });

    return r.texto || acumulado;
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
}
