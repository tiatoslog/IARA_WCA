/**
 * Onde cada operador parou num procedimento — o "Estou aqui" do SOS.
 *
 * DUAS DIFERENÇAS DELIBERADAS EM RELAÇÃO AO MOLDE (`kernel/PlanosPropostos.ts`),
 * e as duas vêm do mesmo fato: um POP não envelhece como uma medição.
 *
 * 1. **Não vence.** `PlanosPropostos` expira em 20 minutos porque um plano fala
 *    de um estado do mundo que já mudou. Aqui, quem está na etapa 4 de 8 está
 *    operando o GW de verdade entre uma etapa e outra — pode almoçar, pode ser
 *    interrompido, pode voltar amanhã. Expirar seria perder o lugar exatamente
 *    de quem mais precisa dele.
 *
 * 2. **Não amarra à sessão.** Aquele módulo exige `p.sessao === sessao` para que
 *    um "pode executar" solto noutro diálogo não autorize um plano alheio. Aqui é
 *    o contrário: o valor está em retomar em outra sessão, em outro aparelho, no
 *    dia seguinte. E o risco que a amarração cobria não existe — retomar um
 *    procedimento não autoriza efeito nenhum; quem autoriza continua sendo o
 *    `PorteiroAutorizacao`, no caminho de sempre.
 *
 * POR ISSO PERSISTE EM DISCO, e não em memória do processo: um redeploy da
 * Railway derrubaria a posição de todo mundo, e derrubaria justamente no cenário
 * que o SOS existe para cobrir — a pessoa que está sozinha, substituindo alguém.
 *
 * É ESTADO INTERNO (`Fronteira.ts`). Ninguém fora da IARA percebe que alguém
 * está na etapa 4: não manda mensagem, não marca nada em sistema de terceiro,
 * não sai do processo.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ConferenciaDaParada,
  Desvio,
  EstadoDaExecucao,
  TipoDeEvidencia,
} from '../../lib/procedimento';
import { exigirIdCanonico } from './kernel/Identidade';
import { TravaAssincrona } from './TravaAssincrona';

const PASTA = path.resolve(process.cwd(), 'dados', 'procedimentos-em-curso');

export type ModoDoProcedimento = 'guiar' | 'treinar';

export interface ProcedimentoEmCurso {
  readonly id_usuario: string;
  readonly codigo: string;
  readonly modo: ModoDoProcedimento;
  /** Número da etapa corrente, como o POP a numera. */
  readonly etapa: number;
  /** Índice do slide corrente dentro da etapa. */
  readonly slide: number;
  /**
   * A versão do POP em que esta pessoa começou.
   *
   * Existe para detectar o caso feio: o POP foi revisado enquanto alguém estava
   * na etapa 4. A etapa 4 da versão nova pode ser outra coisa — ou não existir.
   * Sem este campo, a IARA continuaria contando "etapa 4 de 8" sobre um
   * documento que já não é o mesmo, com a confiança de quem não sabe que mudou.
   */
  readonly hash_origem: string;
  readonly iniciado_em: string;
  readonly atualizado_em: string;

  /** Onde a máquina de estados está. Nunca inferido do resto. */
  readonly estado: EstadoDaExecucao;
  /**
   * O que sustentou a ÚLTIMA passagem de etapa.
   *
   * Guardado porque a pergunta da auditoria não é "avançou?" — é "com base em
   * quê?". Sem este campo, a resposta seria sempre "porque o ponteiro moveu",
   * que é o relato conferindo a si mesmo.
   */
  readonly evidencia: TipoDeEvidencia;
  /**
   * O que saiu do trilho, na ordem em que saiu.
   *
   * NUNCA vira conhecimento novo — é registro. Um desvio repetido é assunto para
   * quem escreve o POP, não para a IARA aprender um caminho alternativo sozinha.
   */
  readonly desvios: readonly Desvio[];
  /**
   * A ÚLTIMA CONFERÊNCIA DE TELA desta parada, quando houve uma.
   *
   * É o que permite o print virar evidência de um avanço que a pessoa pede no
   * turno SEGUINTE — conferir e avançar são duas frases separadas, e sem este
   * campo a conferência morria no turno em que foi feita.
   *
   * NÃO É UM ATALHO: ela carrega a parada e a versão em que foi tirada, e
   * `conferenciaVale` descarta a que não corresponde exatamente à parada atual.
   * Uma conferência da etapa 3 não sustenta o avanço da etapa 4.
   */
  readonly conferencia?: ConferenciaDaParada | null;
}

/** Teto de desvios guardados. O arquivo é por pessoa e não pode virar log. */
const MAX_DESVIOS = 20;

interface Caderno {
  id_usuario: string;
  em_curso: ProcedimentoEmCurso | null;
}

export class ProcedimentosEmCurso {
  private readonly travas = new Map<string, TravaAssincrona>();

  constructor(private readonly agora: () => number = () => Date.now()) {}

  private trava(chave: string): TravaAssincrona {
    let t = this.travas.get(chave);
    if (!t) {
      t = new TravaAssincrona();
      this.travas.set(chave, t);
    }
    return t;
  }

  private caminho(chave: string): string {
    return path.join(PASTA, `${chave}.json`);
  }

  private async abrir(chave: string): Promise<Caderno> {
    try {
      const bruto = await readFile(this.caminho(chave), 'utf8');
      const caderno = JSON.parse(bruto) as Caderno;
      return { id_usuario: chave, em_curso: caderno.em_curso ?? null };
    } catch {
      return { id_usuario: chave, em_curso: null };
    }
  }

  /**
   * Escrita atômica: grava num temporário e renomeia. Sem isto, um processo
   * derrubado no meio do `writeFile` deixa um JSON truncado — e o operador
   * perde o lugar de um jeito que se parece com "nunca comecei".
   */
  private async gravar(caderno: Caderno): Promise<void> {
    await mkdir(PASTA, { recursive: true });
    const destino = this.caminho(caderno.id_usuario);
    const temporario = `${destino}.${process.pid}.tmp`;
    await writeFile(temporario, JSON.stringify(caderno, null, 2), 'utf8');
    await rename(temporario, destino);
  }

  /**
   * O procedimento em curso deste operador, ou `null`.
   *
   * NÃO relê cache: sempre do disco. O SOS é usado de vários aparelhos pela
   * mesma pessoa, e um cache em memória por processo é como dois espelhos
   * passam a discordar sobre em que etapa alguém está.
   */
  async emCurso(idUsuario: string): Promise<ProcedimentoEmCurso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProcedimentosEmCurso.emCurso');
    return (await this.abrir(chave)).em_curso;
  }

  /** Começa (ou recomeça) um procedimento. Substitui o anterior, se houver. */
  async iniciar(entrada: {
    id_usuario: string;
    codigo: string;
    modo: ModoDoProcedimento;
    etapa: number;
    slide: number;
    hash_origem: string;
  }): Promise<ProcedimentoEmCurso> {
    const chave = exigirIdCanonico(entrada.id_usuario, 'ProcedimentosEmCurso.iniciar');
    return this.trava(chave).executar(async () => {
      const instante = new Date(this.agora()).toISOString();
      const emCurso: ProcedimentoEmCurso = {
        id_usuario: chave,
        codigo: entrada.codigo,
        modo: entrada.modo,
        etapa: entrada.etapa,
        slide: entrada.slide,
        hash_origem: entrada.hash_origem,
        iniciado_em: instante,
        atualizado_em: instante,
        // Começa esperando: a primeira parada foi apresentada e ninguém
        // confirmou nada ainda. `nenhuma` é a verdade sobre este instante.
        estado: 'aguardando_evidencia',
        evidencia: 'nenhuma',
        desvios: [],
      };
      await this.gravar({ id_usuario: chave, em_curso: emCurso });
      return emCurso;
    });
  }

  /**
   * Move a posição. Devolve `null` quando não havia procedimento em curso — e
   * quem chamou precisa dizer isso, nunca inventar um começo.
   */
  /**
   * Move a posição, registrando COM BASE EM QUÊ.
   *
   * `evidencia` é obrigatória: sem ela este método voltaria a ser "andei porque
   * alguém mandou andar", que é o buraco que a Fase 2 fecha. Quem decide se
   * pode andar é o `GuardiaoDoProcedimento`; aqui só se grava.
   */
  async mover(
    idUsuario: string,
    posicao: {
      etapa: number;
      slide: number;
      evidencia: TipoDeEvidencia;
      estado?: EstadoDaExecucao;
    },
  ): Promise<ProcedimentoEmCurso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProcedimentosEmCurso.mover');
    return this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      if (!caderno.em_curso) return null;
      const movido: ProcedimentoEmCurso = {
        ...caderno.em_curso,
        etapa: posicao.etapa,
        slide: posicao.slide,
        evidencia: posicao.evidencia,
        estado: posicao.estado ?? 'aguardando_evidencia',
        /* MUDOU DE PARADA, A CONFERÊNCIA MORRE. `conferenciaVale` já a
           descartaria por divergência de posição, mas deixá-la no arquivo é
           deixar uma afirmação sobre uma tela que já não é a de ninguém — e a
           próxima pessoa a ler este JSON teria de deduzir que ela não vale. */
        conferencia: null,
        atualizado_em: new Date(this.agora()).toISOString(),
      };
      await this.gravar({ id_usuario: chave, em_curso: movido });
      return movido;
    });
  }

  /**
   * Anota um desvio sem mover ninguém.
   *
   * Existe separado de `mover` porque desvio acontece JUSTAMENTE quando não se
   * move — tentar avançar sem confirmação, por exemplo. Juntar os dois faria o
   * registro do desvio depender de um avanço que não houve.
   */
  async registrarDesvio(idUsuario: string, d: Desvio): Promise<ProcedimentoEmCurso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProcedimentosEmCurso.registrarDesvio');
    return this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      if (!caderno.em_curso) return null;
      const anotado: ProcedimentoEmCurso = {
        ...caderno.em_curso,
        desvios: [...caderno.em_curso.desvios, d].slice(-MAX_DESVIOS),
        atualizado_em: new Date(this.agora()).toISOString(),
      };
      await this.gravar({ id_usuario: chave, em_curso: anotado });
      return anotado;
    });
  }

  /**
   * Guarda a conferência de tela desta parada. NÃO MOVE NINGUÉM.
   *
   * Separado de `mover` pela mesma razão que `registrarDesvio`: conferir
   * acontece justamente quando não se move. Se um dia esta função avançar
   * qualquer coisa, a leitura de uma imagem passa a escrever posição por um
   * caminho que o guardião não vigia — que é o defeito que ela existe para não
   * ser.
   */
  async registrarConferencia(
    idUsuario: string,
    c: ConferenciaDaParada,
  ): Promise<ProcedimentoEmCurso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProcedimentosEmCurso.registrarConferencia');
    return this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      if (!caderno.em_curso) return null;
      /* Conferência de outra parada não entra. O turno de visão lê a posição e
         confere contra ela, mas entre uma coisa e outra o operador pode ter
         avançado noutra tela — e gravar aqui seria carimbar a parada nova com a
         leitura da antiga. */
      if (
        c.codigo !== caderno.em_curso.codigo ||
        c.etapa !== caderno.em_curso.etapa ||
        c.slide !== caderno.em_curso.slide ||
        c.hash_origem !== caderno.em_curso.hash_origem
      ) {
        return caderno.em_curso;
      }
      const anotado: ProcedimentoEmCurso = {
        ...caderno.em_curso,
        conferencia: c,
        atualizado_em: new Date(this.agora()).toISOString(),
      };
      await this.gravar({ id_usuario: chave, em_curso: anotado });
      return anotado;
    });
  }

  /** Encerra. Devolve o que foi encerrado, ou `null` se não havia nada. */
  async encerrar(idUsuario: string): Promise<ProcedimentoEmCurso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProcedimentosEmCurso.encerrar');
    return this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      if (!caderno.em_curso) return null;
      await this.gravar({ id_usuario: chave, em_curso: null });
      return caderno.em_curso;
    });
  }
}

/**
 * A instância do processo. Singleton pela mesma razão da `memoriaOperacional`:
 * dois canais do mesmo operador (navegador e WhatsApp) são a MESMA pessoa no
 * mesmo procedimento, e duas instâncias fariam cada canal contar uma etapa
 * diferente.
 */
export const procedimentosEmCurso = new ProcedimentosEmCurso();
