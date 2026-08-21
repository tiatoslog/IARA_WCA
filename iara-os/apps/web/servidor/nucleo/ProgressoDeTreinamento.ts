/**
 * O progresso PEDAGÓGICO de cada operador — a memória do treinamento.
 *
 * IRMÃO DE `ProcedimentosEmCurso.ts`, e a fronteira entre os dois é o ponto
 * inteiro desta camada:
 *
 *   `ProcedimentosEmCurso`   ONDE a pessoa está     (etapa, slide, evidência)
 *   este arquivo             O QUE ela já aprendeu  (estado, dificuldades, exercícios)
 *
 * **Este módulo não move ninguém.** Ele não importa `procedimentosEmCurso` e
 * nunca vai importar: quem escreve posição é `avancar_procedimento`, pelo
 * guardião, pela porta de sempre. Um progresso pedagógico que também andasse
 * com o ponteiro seria um segundo caminho de execução na frente do guardião —
 * exatamente o que o `CLAUDE.md` proíbe para plano autorizado, pela mesma razão.
 * A proibição é verificada em `testes/treinamento-fronteira.test.ts`, não por
 * este comentário.
 *
 * O QUE ELE NÃO GUARDA, e a omissão é a decisão de projeto mais importante do
 * arquivo: etapa, slide, evidência e conferência. Todos existem no ponteiro. Uma
 * segunda cópia aqui é como dois espelhos passam a discordar sobre em que etapa
 * alguém está — o mesmo defeito que fez `ProcedimentosEmCurso` recusar cache em
 * memória.
 *
 * PERSISTE EM DISCO pelas duas razões daquele módulo: não vence (aprender não
 * envelhece por relógio) e não amarra à sessão (o valor está em retomar amanhã,
 * noutro aparelho). E é ESTADO INTERNO — ninguém fora da IARA percebe que
 * alguém está treinando.
 *
 * UM PROGRESSO POR (OPERADOR, POP, REVISÃO). Trocar a revisão do POP não
 * atualiza o progresso: **cria outro**. O que a pessoa demonstrou saber era
 * outro documento, e continuar contando seria a mentira que `hash_origem` existe
 * para impedir do lado operacional.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  chaveDaParada,
  progressoInicial,
  transicionar,
  type AvaliacaoRegistrada,
  type DificuldadeRegistrada,
  type EventoPedagogico,
  type PerguntaDeAvaliacao,
  type ProgressoDeTreinamento as Progresso,
} from '../../lib/treinamento';
import { exigirIdCanonico } from './kernel/Identidade';
import { TravaAssincrona } from './TravaAssincrona';

const PASTA = path.resolve(process.cwd(), 'dados', 'progresso-treinamento');

/**
 * Teto de dificuldades guardadas por progresso.
 *
 * Maior que o de desvios (20) porque a série aqui é o material de quem revisa
 * POP: "sete pessoas travaram na etapa 4" só aparece se as ocorrências
 * sobreviverem. Ainda assim é teto — o arquivo é por pessoa e não pode virar
 * log.
 */
const MAX_DIFICULDADES = 60;
const MAX_AVALIACOES = 60;
const MAX_CONCEITOS = 40;

interface Caderno {
  id_usuario: string;
  /** Um por (código, hash_origem). Chave: `${codigo}|${hash}`. */
  progressos: Record<string, Progresso>;
}

function chaveDoProgresso(codigo: string, hashOrigem: string): string {
  return `${codigo}|${hashOrigem}`;
}

export class ProgressosDeTreinamento {
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
      return { id_usuario: chave, progressos: caderno.progressos ?? {} };
    } catch {
      return { id_usuario: chave, progressos: {} };
    }
  }

  /** Escrita atômica: temporário + rename, como o ponteiro. */
  private async gravar(caderno: Caderno): Promise<void> {
    await mkdir(PASTA, { recursive: true });
    const destino = this.caminho(caderno.id_usuario);
    const temporario = `${destino}.${process.pid}.tmp`;
    await writeFile(temporario, JSON.stringify(caderno, null, 2), 'utf8');
    await rename(temporario, destino);
  }

  /**
   * O progresso desta pessoa NESTA REVISÃO do POP, ou `null`.
   *
   * `null` quando não existe — e quem chamar precisa dizer isso em vez de
   * inventar um começo. É a mesma disciplina de `acharPosicao` devolvendo `null`
   * quando a etapa sumiu do documento revisado.
   */
  async ler(idUsuario: string, codigo: string, hashOrigem: string): Promise<Progresso | null> {
    const chave = exigirIdCanonico(idUsuario, 'ProgressosDeTreinamento.ler');
    const caderno = await this.abrir(chave);
    return caderno.progressos[chaveDoProgresso(codigo, hashOrigem)] ?? null;
  }

  /**
   * O progresso de OUTRAS revisões do mesmo POP.
   *
   * Existe para a retomada poder dizer *"você treinou a REV.:01 e o documento
   * hoje é a REV.:02"* — que é informação, e some se a busca for só pela chave
   * exata. Silenciar isso faria a IARA tratar quem já treinou como quem nunca
   * viu o procedimento, sem explicar por quê.
   */
  async deOutrasRevisoes(
    idUsuario: string,
    codigo: string,
    hashOrigem: string,
  ): Promise<readonly Progresso[]> {
    const chave = exigirIdCanonico(idUsuario, 'ProgressosDeTreinamento.deOutrasRevisoes');
    const caderno = await this.abrir(chave);
    return Object.values(caderno.progressos).filter(
      (p) => p.codigo === codigo && p.hash_origem !== hashOrigem,
    );
  }

  /** Todos os progressos desta pessoa, do mais recente para o mais antigo. */
  async todos(idUsuario: string): Promise<readonly Progresso[]> {
    const chave = exigirIdCanonico(idUsuario, 'ProgressosDeTreinamento.todos');
    const caderno = await this.abrir(chave);
    return Object.values(caderno.progressos).sort((a, b) =>
      b.atualizado_em.localeCompare(a.atualizado_em),
    );
  }

  /**
   * Lê o progresso, criando-o se não existir. Ponto único de criação.
   *
   * Privado de propósito: toda escrita passa por `mudar`, e `mudar` é quem
   * chama isto. Duas portas de criação produziriam dois `iniciado_em` para o
   * mesmo treinamento.
   */
  private garantir(
    caderno: Caderno,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    instante: string,
  ): Progresso {
    const chave = chaveDoProgresso(alvo.codigo, alvo.hash_origem);
    return (
      caderno.progressos[chave] ??
      progressoInicial({ id_usuario: caderno.id_usuario, ...alvo }, instante)
    );
  }

  /**
   * A ÚNICA ESCRITA DESTE MÓDULO — uma transformação pura sob trava.
   *
   * Recebe uma função em vez de N métodos (`registrarDificuldade`,
   * `marcarEnsinada`, `guardarPergunta`…) porque todas fariam a mesma coisa:
   * ler, transformar, gravar. N métodos com o mesmo corpo é onde a terceira
   * cópia esquece a trava.
   */
  private async mudar(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    transformar: (anterior: Progresso, instante: string) => Progresso,
  ): Promise<Progresso> {
    const chave = exigirIdCanonico(idUsuario, 'ProgressosDeTreinamento.mudar');
    return this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      const instante = new Date(this.agora()).toISOString();
      const anterior = this.garantir(caderno, alvo, instante);
      const novo: Progresso = { ...transformar(anterior, instante), atualizado_em: instante };
      caderno.progressos[chaveDoProgresso(alvo.codigo, alvo.hash_origem)] = novo;
      caderno.id_usuario = chave;
      await this.gravar(caderno);
      return novo;
    });
  }

  /** Aplica um evento pedagógico. Quem decide o estado é a tabela pura. */
  async aplicarEvento(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    evento: EventoPedagogico,
  ): Promise<Progresso> {
    return this.mudar(idUsuario, alvo, (p) => ({ ...p, estado: transicionar(p.estado, evento) }));
  }

  /** Marca uma parada como ENSINADA com instrução completa. */
  async marcarEnsinada(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    etapa: number,
    slide: number,
  ): Promise<Progresso> {
    const parada = chaveDaParada(etapa, slide);
    return this.mudar(idUsuario, alvo, (p) => ({
      ...p,
      estado: transicionar(p.estado, 'ensinou'),
      paradas_ensinadas: p.paradas_ensinadas.includes(parada)
        ? p.paradas_ensinadas
        : [...p.paradas_ensinadas, parada],
      /* Ensinar ZERA o socrático desta parada: a pergunta já não faz sentido
         depois de a resposta ter sido dada. Sem isto, o teto de duas perguntas
         valeria para sempre e a IARA nunca voltaria a perguntar nada aqui. */
      socraticas_na_parada: p.parada_socratica === parada ? 0 : p.socraticas_na_parada,
    }));
  }

  /** Marca que a pessoa respondeu por conta própria antes da instrução. */
  async marcarPraticada(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    etapa: number,
    slide: number,
  ): Promise<Progresso> {
    const parada = chaveDaParada(etapa, slide);
    return this.mudar(idUsuario, alvo, (p) => ({
      ...p,
      paradas_praticadas: p.paradas_praticadas.includes(parada)
        ? p.paradas_praticadas
        : [...p.paradas_praticadas, parada],
    }));
  }

  /** Conta mais uma pergunta socrática nesta parada. Troca de parada, zera. */
  async contarSocratica(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    etapa: number,
    slide: number,
  ): Promise<Progresso> {
    const parada = chaveDaParada(etapa, slide);
    return this.mudar(idUsuario, alvo, (p) => ({
      ...p,
      parada_socratica: parada,
      socraticas_na_parada: p.parada_socratica === parada ? p.socraticas_na_parada + 1 : 1,
    }));
  }

  /** Anota uma dificuldade. NUNCA move nem conclui nada. */
  async registrarDificuldade(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    dificuldade: Omit<DificuldadeRegistrada, 'instante'>,
  ): Promise<Progresso> {
    return this.mudar(idUsuario, alvo, (p, instante) => ({
      ...p,
      dificuldades: [...p.dificuldades, { ...dificuldade, instante }].slice(-MAX_DIFICULDADES),
    }));
  }

  /** Guarda a questão que aguarda resposta, ou a limpa com `null`. */
  async guardarPergunta(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    pergunta: PerguntaDeAvaliacao | null,
  ): Promise<Progresso> {
    return this.mudar(idUsuario, alvo, (p) => ({ ...p, pergunta_pendente: pergunta }));
  }

  /**
   * Registra o resultado de um exercício e limpa a questão pendente.
   *
   * O ESTADO SEGUE A TABELA, não o resultado direto: `correta` não promove
   * ninguém a `dominado` sozinha — quem faz isso é `concluiu_avaliacao`, emitido
   * quando a avaliação termina. Uma questão certa não é uma avaliação.
   */
  async registrarAvaliacao(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    avaliacao: Omit<AvaliacaoRegistrada, 'instante'>,
  ): Promise<Progresso> {
    return this.mudar(idUsuario, alvo, (p, instante) => ({
      ...p,
      avaliacoes: [...p.avaliacoes, { ...avaliacao, instante }].slice(-MAX_AVALIACOES),
      pergunta_pendente: null,
      estado:
        avaliacao.resultado === 'incorreta' || avaliacao.resultado === 'parcial'
          ? transicionar(p.estado, 'errou')
          : p.estado,
    }));
  }

  /** Anota um conceito já explicado, para não reexplicá-lo a cada turno. */
  async registrarConceito(
    idUsuario: string,
    alvo: { codigo: string; hash_origem: string; revisao: string },
    conceito: string,
  ): Promise<Progresso> {
    const termo = conceito.trim().toLowerCase();
    return this.mudar(idUsuario, alvo, (p) => ({
      ...p,
      conceitos_explicados: p.conceitos_explicados.includes(termo)
        ? p.conceitos_explicados
        : [...p.conceitos_explicados, termo].slice(-MAX_CONCEITOS),
    }));
  }

  /** Apaga o progresso desta pessoa neste POP. Só para teste e para reinício. */
  async esquecer(idUsuario: string, codigo?: string): Promise<void> {
    const chave = exigirIdCanonico(idUsuario, 'ProgressosDeTreinamento.esquecer');
    await this.trava(chave).executar(async () => {
      const caderno = await this.abrir(chave);
      for (const k of Object.keys(caderno.progressos)) {
        if (!codigo || caderno.progressos[k].codigo === codigo) delete caderno.progressos[k];
      }
      await this.gravar({ id_usuario: chave, progressos: caderno.progressos });
    });
  }
}

/**
 * A instância do processo. Singleton pela razão do ponteiro: dois canais do
 * mesmo operador são a MESMA pessoa no mesmo treinamento.
 */
export const progressosDeTreinamento = new ProgressosDeTreinamento();
