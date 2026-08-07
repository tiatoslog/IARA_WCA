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
import { HABILIDADES_OPERACIONAIS } from './habilidades/operacionais';
import {
  AuditoriaEstruturada,
  LimiteVazao,
  PoliticaPadrao,
  SandboxPorPolitica,
  type Papel,
} from './Seguranca';
import type { Plano } from './Evento';
import type { DestinoCognitivo, EstagioCognitivo } from '../../../lib/estado';

export interface DependenciasKernel {
  sessao: string;
  idUsuario: string;
  papel?: Papel;
  outrosOperadores: readonly string[];
  estado: EstadoAtomico;
  memoria: MemoriaOperacional;
  barramento: BarramentoEventos;
}

const ESTAGIO_DA_ROTA: Record<string, EstagioCognitivo> = {
  sigilo: 'executando',
  plano_local: 'executando',
  plano_cognitivo: 'pensando',
  raciocinio_direto: 'pensando',
};

export class Kernel {
  private readonly percepcao = new MotorPercepcao();
  private readonly trabalho = new MemoriaTrabalho();
  private readonly planejador = new Planejador();
  private readonly habilidades: GerenciadorHabilidades;
  private readonly raciocinio = new MotorRaciocinio();
  private readonly executiva: FuncaoExecutiva;
  private readonly politica = new PoliticaPadrao();
  private readonly sandbox = new SandboxPorPolitica(this.politica);
  private readonly auditoria = new AuditoriaEstruturada();
  private readonly vazao = new LimiteVazao();
  private readonly papel: Papel;

  private emAndamento: AbortController | null = null;

  constructor(private readonly dep: DependenciasKernel) {
    this.papel = dep.papel ?? 'operador';
    this.habilidades = new GerenciadorHabilidades(dep.barramento);
    this.habilidades.registrarTodas(HABILIDADES_OPERACIONAIS);
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
      await this.dep.memoria.registrar(this.dep.idUsuario, 'operador', texto);
      if (controle.signal.aborted) return;

      // --- 2. Função executiva ---------------------------------------------
      const decisao = this.executiva.decidir(p);
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

      // --- 3. Plano ---------------------------------------------------------
      const plano = await this.montarPlano(decisao.rota, p, controle.signal);
      if (controle.signal.aborted) return;

      this.trabalho.iniciarTarefa(p, plano);
      b.publicar({ tipo: 'PLANO_CRIADO', plano });

      // --- 4. Execução ------------------------------------------------------
      const saidas = await this.executarPlano(plano, p.bruto, controle);
      if (controle.signal.aborted) return;

      // --- 5. Resposta ------------------------------------------------------
      const idMensagem = randomUUID();
      const texto_final = await this.comporResposta(plano, saidas, p, idMensagem, controle);
      if (controle.signal.aborted) return;

      b.publicar({
        tipo: 'TAREFA_CONCLUIDA',
        id_mensagem: idMensagem,
        texto: texto_final,
        rota: decisao.rota,
        ms: Date.now() - inicio,
      });

      await this.dep.memoria.registrar(
        this.dep.idUsuario,
        'iara',
        texto_final,
        this.destinoDe(decisao.rota),
      );
      await this.dep.estado.aplicarIntencao({ campo: 'afinidade', delta: 0.015 });
    } catch (erro) {
      if (controle.signal.aborted) return;
      b.publicar({ tipo: 'FALHA', modulo: 'kernel', mensagem: (erro as Error).message });
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
  ): Promise<string[]> {
    const b = this.dep.barramento;
    const saidas: string[] = [];

    for (const passo of plano.passos) {
      if (controle.signal.aborted) break;
      // O passo de raciocínio é resolvido na composição da resposta, com
      // streaming. Aqui só passam as habilidades nativas.
      if (!passo.habilidade || passo.habilidade === 'raciocinio') continue;

      this.trabalho.entrarNoPasso(passo.indice, passo.habilidade);
      b.publicar({ tipo: 'PASSO_INICIADO', passo, total: plano.passos.length });

      const manifesto = this.habilidades.manifesto(passo.habilidade);
      if (!manifesto) {
        this.trabalho.registrarErro();
        continue;
      }

      const inicio = Date.now();
      try {
        this.sandbox.verificar(passo.habilidade, manifesto.permissoes, this.papel);

        const r = await this.habilidades.executar({
          id: passo.habilidade,
          parametros: { ...passo.parametros },
          enunciado,
          id_usuario: this.dep.idUsuario,
          sessao: this.dep.sessao,
          sinal: controle.signal,
          concedidas: this.politica.permissoesDe(this.papel),
        });

        saidas.push(r.texto);
        this.trabalho.concluirPasso(r.texto);
        b.publicar({
          tipo: 'PASSO_CONCLUIDO',
          passo,
          resumo: r.detalhe,
          ms: Date.now() - inicio,
        });
      } catch (erro) {
        if (controle.signal.aborted) break;
        this.trabalho.registrarErro();
        this.auditoria.registrar({
          instante: new Date().toISOString(),
          sessao: this.dep.sessao,
          id_usuario: this.dep.idUsuario,
          traco: b.tracoAtual,
          acao: `habilidade:${passo.habilidade}`,
          detalhe: (erro as Error).message,
          permitido: false,
        });
        b.publicar({
          tipo: 'PASSO_CONCLUIDO',
          passo,
          resumo: `falhou: ${(erro as Error).message}`,
          ms: Date.now() - inicio,
        });
      }
    }

    return saidas;
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
    saidas: string[],
    percepcao: ReturnType<MotorPercepcao['perceber']>,
    idMensagem: string,
    controle: AbortController,
  ): Promise<string> {
    const b = this.dep.barramento;
    const precisaRaciocinio = plano.passos.some(
      (p) => !p.habilidade || p.habilidade === 'raciocinio',
    );

    if (!precisaRaciocinio && saidas.length > 0) {
      const texto = saidas.join('\n\n');
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto });
      return texto;
    }

    if (!this.raciocinio.disponivel) {
      const texto =
        saidas.length > 0
          ? `${saidas.join('\n\n')}\n\nPara ir além disso eu precisaria da camada de raciocínio, que está desligada neste ambiente.`
          : 'Esse pedido exige raciocínio aberto, e a camada de nuvem está desligada: falta a chave da Anthropic no ambiente. ' +
            'Prefiro dizer isso a improvisar. Localmente eu resolvo clima, hora, infraestrutura, histórico de incidentes e busca.';
      b.publicar({ tipo: 'RESPOSTA_TRECHO', id_mensagem: idMensagem, texto });
      return texto;
    }

    await this.dep.estado.transicionar('pensando', 'raciocinio');
    b.publicar({ tipo: 'RACIOCINIO_INICIADO', modelo: this.raciocinio.modelo });

    const historico = await this.dep.memoria.historico(this.dep.idUsuario, 20);
    const camadaGlobal = await this.dep.memoria.carregarGlobal();
    const inicio = Date.now();
    let acumulado = '';
    let abriu = false;

    const r = await this.raciocinio.responder({
      enunciado: percepcao.bruto,
      historico: historico.slice(0, -1),
      overridePersona: TeoriaDaMente.overrideDePersona(percepcao.leitura),
      camadaGlobal,
      contexto: this.trabalho.contextoAcumulado(),
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

  private destinoDe(rota: string): DestinoCognitivo {
    if (rota === 'sigilo') return 'recusa_sigilo';
    if (rota === 'plano_local') return 'sistema_local';
    return 'claude_nuvem';
  }
}
