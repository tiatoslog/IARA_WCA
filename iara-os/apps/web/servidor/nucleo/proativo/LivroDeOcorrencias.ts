/**
 * O LIVRO — tudo o que a camada proativa sabe sobre UM operador, em disco.
 *
 * Mesmo desenho da `MemoriaOperacional` e da `Agenda`, e pela mesma razão: é o
 * mesmo problema. Um arquivo por operador, caminho derivado do `id_usuario` da
 * SESSÃO (nunca de payload), trava por operador, releitura do disco antes de
 * cada escrita e `rename` atômico por cima. O que este livro guarda é tão
 * privado quanto o histórico — ele diz o que a pessoa ignora, o que ela rejeita,
 * a que horas ela trabalha e que procedimento ela repete.
 *
 * É ESTADO INTERNO, e a pergunta que decide isso é a de `Fronteira.ts`: alguém
 * fora da IARA percebe? Não. Nada aqui manda mensagem, marca compromisso ou sai
 * do processo. Quando uma decisão vira fala, quem fala é a própria IARA pelo
 * canal de sempre — exatamente como o lembrete vencido.
 *
 * ---------------------------------------------------------------------------
 * O QUE TEM TETO, E POR QUÊ TODOS TÊM
 * ---------------------------------------------------------------------------
 *
 * Cada coleção deste arquivo tem um teto declarado. Não é zelo estético: este é
 * o único módulo do sistema que grava a partir de um laço que roda sozinho, sem
 * ninguém olhando, para sempre. Uma coleção sem teto aqui é um arquivo JSON que
 * cresce até o dia em que `JSON.parse` custa segundos — e o sintoma aparece
 * primeiro como "a IARA ficou lenta", nunca como "o livro encheu".
 *
 * A poda é sempre pelo mais antigo e sempre CONTADA (`podados`), pela lição que
 * `MemoriaOperacional.podados` já registra: perda de dado sem registro da perda é
 * indistinguível de cobertura completa.
 *
 * ---------------------------------------------------------------------------
 * O QUE ACONTECE QUANDO O DISCO FALHA
 * ---------------------------------------------------------------------------
 *
 * O erro SOBE. Este módulo não engole nada. Quem chama (`MotorProativo`) traduz
 * a falha em "não falei e registrei por quê" — que é a degradação segura pedida:
 * uma IARA que não consegue lembrar o que já disse não pode falar, porque não
 * tem como saber se está repetindo.
 *
 * A exceção é a LEITURA de um arquivo corrompido ou ausente, que devolve livro
 * novo com um aviso no console. É a mesma escolha da memória, e pelo mesmo
 * motivo: não abrir a sessão de alguém porque o livro proativo está ilegível
 * seria trocar um recurso acessório por um bloqueio total.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { TravaAssincrona } from '../TravaAssincrona';
import { exigirIdCanonico } from '../kernel/Identidade';
import { redigir } from '../kernel/Configuracao';
import type { Atencao } from './Atencao';
import { atencaoNova } from './Atencao';
import { atividadeVazia } from './Interrupcao';
import type { FonteOcorrencia, Ocorrencia } from './Ocorrencia';
import type { Justificativa } from './DecisaoProativa';
import type { RegistroPasso } from './DetectorDeRepeticao';

const RAIZ_PADRAO = path.resolve(process.cwd(), 'dados', 'proativo');

export const TETO_VISTAS = 500;
export const TETO_DECISOES = 200;
export const TETO_PASSOS = 500;
export const TETO_CARENCIA = 200;
export const TETO_INTERRUPCOES = 100;

/**
 * UM FATO, VÁRIAS FONTES — a resposta ao requisito de deduplicação.
 *
 * Quando cinco lugares relatam a mesma coisa, o que se guarda é uma vista com
 * cinco fontes, não cinco ocorrências. `vezes` é o que alimenta o sinal de
 * novidade; `fontes` é o que permite dizer "isto foi relatado por A, B e C" sem
 * ter dito nada três vezes.
 */
export interface VistaOcorrencia {
  readonly chave: string;
  readonly tipo: Ocorrencia['tipo'];
  readonly assunto: string;
  readonly rotulo: string;
  readonly resumo: string;
  readonly severidade: Ocorrencia['severidade'];
  readonly confianca: Ocorrencia['confianca'];
  readonly natureza: Ocorrencia['natureza'];
  readonly vezes: number;
  readonly primeira_em: number;
  readonly ultima_em: number;
  readonly fontes: readonly FonteOcorrencia[];
}

export interface RegistroDecisao {
  readonly id: string;
  readonly chave: string;
  readonly em: number;
  readonly justificativa: Justificativa;
  /** A frase que saiu, quando saiu. `null` quando a decisão foi silenciosa. */
  readonly texto: string | null;
}

/**
 * A PROPOSTA À ESPERA DE REAÇÃO.
 *
 * Uma só por vez, e é deliberado: com duas pendentes, a próxima mensagem do
 * operador seria evidência ambígua — "obrigada" responde a qual delas? Atribuir
 * a reação errada ao assunto errado envenena o aprendizado em silêncio, que é
 * pior que não aprender. A pendência anterior que ainda não venceu é fechada
 * como `ignorou` quando uma nova entra; ver `MotorProativo`.
 */
export interface Pendencia {
  readonly id_decisao: string;
  readonly assunto: string;
  readonly rotulo: string;
  readonly em: number;
}

/**
 * OS CONTADORES QUE VIRAM MÉTRICA (`utilidade`, taxas). Guardados em disco
 * porque a pergunta que eles respondem — "a IARA está ficando mais útil ou mais
 * barulhenta?" — é sobre meses, não sobre a sessão de hoje.
 */
export interface Contadores {
  avaliadas: number;
  recusadas: number;
  duplicadas: number;
  persistidas: number;
  faladas: number;
  suprimidas: number;
  engajou: number;
  agiu: number;
  ignorou: number;
  rejeitou: number;
}

export function contadoresZerados(): Contadores {
  return {
    avaliadas: 0,
    recusadas: 0,
    duplicadas: 0,
    persistidas: 0,
    faladas: 0,
    suprimidas: 0,
    engajou: 0,
    agiu: 0,
    ignorou: 0,
    rejeitou: 0,
  };
}

export interface Livro {
  id_usuario: string;
  versao: 1;
  vistas: Record<string, VistaOcorrencia>;
  atencao: Record<string, Atencao>;
  interrupcoes: number[];
  carencia: Record<string, number>;
  atividade: number[];
  decisoes: RegistroDecisao[];
  passos: RegistroPasso[];
  pendente: Pendencia | null;
  contadores: Contadores;
  podados: number;
}

export function livroNovo(idUsuario: string): Livro {
  return {
    id_usuario: idUsuario,
    versao: 1,
    vistas: {},
    atencao: {},
    interrupcoes: [],
    carencia: {},
    atividade: atividadeVazia(),
    decisoes: [],
    passos: [],
    pendente: null,
    contadores: contadoresZerados(),
    podados: 0,
  };
}

/**
 * `rename` por cima de arquivo aberto, no Windows — a mesma insistência de
 * `MemoriaOperacional`, e pelo mesmo motivo medido lá: antivírus e indexador
 * seguram o descritor por milissegundos e o `rename` volta `EPERM`/`EBUSY`. O
 * teto é baixo de propósito: passados ~150 ms, deixou de ser disputa e o erro
 * deve subir.
 */
const TENTATIVAS_RENOMEAR = 6;

async function renomearComInsistencia(de: string, para: string): Promise<void> {
  for (let tentativa = 1; ; tentativa += 1) {
    try {
      await rename(de, para);
      return;
    } catch (erro) {
      const codigo = (erro as NodeJS.ErrnoException).code;
      const disputa = codigo === 'EPERM' || codigo === 'EBUSY' || codigo === 'EACCES';
      if (!disputa || tentativa >= TENTATIVAS_RENOMEAR) throw erro;
      await new Promise((pronto) => setTimeout(pronto, tentativa * 5));
    }
  }
}

/** Poda mantendo os N mais recentes. Devolve quantos saíram. */
function podarLista<T>(lista: T[], teto: number): number {
  if (lista.length <= teto) return 0;
  const fora = lista.length - teto;
  lista.splice(0, fora);
  return fora;
}

export class LivroDeOcorrencias {
  private readonly cache = new Map<string, Livro>();
  private readonly travas = new Map<string, TravaAssincrona>();

  constructor(private readonly raiz: string = RAIZ_PADRAO) {}

  /**
   * A chave do arquivo. RECUSA id fora da forma canônica em vez de saneá-lo —
   * ver `kernel/Identidade.ts`. Saneamento colidiria shards, e um shard colidido
   * aqui significa a atenção de uma pessoa governando os avisos de outra.
   */
  private chaveDe(idUsuario: string): string {
    return exigirIdCanonico(idUsuario, 'LivroDeOcorrencias');
  }

  private travaDe(chave: string): TravaAssincrona {
    let trava = this.travas.get(chave);
    if (!trava) {
      trava = new TravaAssincrona();
      this.travas.set(chave, trava);
    }
    return trava;
  }

  private arquivo(chave: string): string {
    return path.join(this.raiz, `${chave}.json`);
  }

  /** Lê do disco ignorando o cache. É a leitura de quem vai escrever. */
  private async lerDoDisco(chave: string): Promise<Livro> {
    let bruto: string;
    try {
      bruto = await readFile(this.arquivo(chave), 'utf8');
    } catch {
      return livroNovo(chave);
    }

    try {
      const livro = JSON.parse(bruto) as Partial<Livro>;
      const base = livroNovo(chave);
      /* Campo a campo, com padrão: um livro gravado por uma versão anterior não
         pode derrubar a leitura por causa de uma chave que ainda não existia. */
      return {
        ...base,
        ...livro,
        id_usuario: chave,
        versao: 1,
        vistas: livro.vistas ?? base.vistas,
        atencao: livro.atencao ?? base.atencao,
        interrupcoes: livro.interrupcoes ?? base.interrupcoes,
        carencia: livro.carencia ?? base.carencia,
        atividade:
          Array.isArray(livro.atividade) && livro.atividade.length === base.atividade.length
            ? livro.atividade
            : base.atividade,
        decisoes: livro.decisoes ?? base.decisoes,
        passos: livro.passos ?? base.passos,
        pendente: livro.pendente ?? null,
        contadores: { ...base.contadores, ...(livro.contadores ?? {}) },
        podados: livro.podados ?? 0,
      };
    } catch (erro) {
      /* Livro ilegível NÃO impede a sessão. Mas a perda é declarada: um livro
         que volta vazio sem aviso é indistinguível de um operador novo, e essa
         confusão apagaria meses de preferência aprendida em silêncio. */
      console.warn(
        JSON.stringify({
          canal: 'proativo',
          acao: 'livro_ilegivel',
          id_usuario: chave,
          detalhe: (erro as Error).message.slice(0, 160),
        }),
      );
      return livroNovo(chave);
    }
  }

  /** Leitura barata, servida pelo cache. Nunca usada por quem vai escrever. */
  async ler(idUsuario: string): Promise<Livro> {
    const chave = this.chaveDe(idUsuario);
    const emCache = this.cache.get(chave);
    if (emCache) return emCache;
    const livro = await this.lerDoDisco(chave);
    this.cache.set(chave, livro);
    return livro;
  }

  /**
   * LER, ALTERAR, GRAVAR — sob trava, relendo o disco toda vez.
   *
   * As duas travas de `MemoriaOperacional`, pelo mesmo motivo: a
   * `TravaAssincrona` fecha a janela `ler → await → escrever` dentro do
   * processo, e o `rename` garante que ninguém nunca leia um JSON pela metade —
   * que cairia no `catch` do parse e viraria um livro VAZIO, apagando a
   * preferência aprendida de vez.
   *
   * O corpo pode devolver `false` para dizer "não mudei nada" e pular a escrita.
   * É o que permite avaliar dez mil ocorrências irrelevantes sem dez mil
   * gravações — sem isso, o silêncio custaria mais caro que a fala.
   */
  async transacao<T>(
    idUsuario: string,
    corpo: (livro: Livro) => T | Promise<T>,
    gravar: (saida: T) => boolean = () => true,
  ): Promise<T> {
    const chave = this.chaveDe(idUsuario);
    return this.travaDe(chave).executar(async () => {
      const livro = await this.lerDoDisco(chave);
      const saida = await corpo(livro);
      if (gravar(saida)) {
        this.podar(livro);
        await this.gravar(livro);
      }
      this.cache.set(chave, livro);
      return saida;
    });
  }

  private podar(livro: Livro): void {
    let fora = 0;
    fora += podarLista(livro.decisoes, TETO_DECISOES);
    fora += podarLista(livro.passos, TETO_PASSOS);
    fora += podarLista(livro.interrupcoes, TETO_INTERRUPCOES);

    const vistas = Object.values(livro.vistas);
    if (vistas.length > TETO_VISTAS) {
      /* Sai o menos recentemente visto — é o que tem menor chance de voltar a
         importar para a novidade de amanhã. */
      const ordenadas = vistas.sort((a, b) => a.ultima_em - b.ultima_em);
      for (const v of ordenadas.slice(0, vistas.length - TETO_VISTAS)) {
        delete livro.vistas[v.chave];
        fora += 1;
      }
    }

    const carencias = Object.entries(livro.carencia);
    if (carencias.length > TETO_CARENCIA) {
      const ordenadas = carencias.sort((a, b) => a[1] - b[1]);
      for (const [assunto] of ordenadas.slice(0, carencias.length - TETO_CARENCIA)) {
        delete livro.carencia[assunto];
        fora += 1;
      }
    }

    livro.podados += fora;
  }

  /**
   * Escrita atômica: temporário e `rename` por cima. O nome do temporário carrega
   * pid e sorteio para que dois escritores simultâneos nunca disputem o mesmo
   * arquivo intermediário.
   *
   * `redigir` ANTES de serializar para o disco, pela mesma razão do jornal de
   * operações: o resumo de uma ocorrência é texto, e texto é onde uma credencial
   * colada acaba parando. Um `.json` legível por qualquer processo da máquina não
   * é lugar para segredo.
   */
  private async gravar(livro: Livro): Promise<void> {
    await mkdir(this.raiz, { recursive: true });
    const alvo = this.arquivo(livro.id_usuario);
    const temporario = `${alvo}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(temporario, redigir(JSON.stringify(livro, null, 2)), 'utf8');
    await renomearComInsistencia(temporario, alvo);
  }

  /**
   * Descarta o cache deste operador. É como um teste prova persistência de
   * verdade: sem isto, a "releitura" viria do mesmo objeto em memória e o teste
   * passaria mesmo que nada tivesse ido ao disco.
   */
  esquecer(idUsuario: string): void {
    this.cache.delete(this.chaveDe(idUsuario));
  }
}

/**
 * A atenção deste assunto, criando-a neutra na primeira vez.
 *
 * `Object.hasOwn`, e NÃO `livro.atencao[assunto] ?? …`.
 *
 * O DEFEITO que isto fecha, encontrado pela suíte adversarial: `assunto` é uma
 * chave de objeto, e `Ocorrencia.assuntoSeguro` a reduz a `[a-z0-9_]`. Essa
 * classe de caracteres mata `__proto__` (vira `proto`), mas **não mata
 * `constructor` nem `prototype`** — as duas são palavras de letras minúsculas e
 * atravessam o saneamento intactas. Num objeto literal, `{}['constructor']` não
 * é `undefined`: é a função `Object`. O `??` a aceitaria como se fosse uma
 * atenção gravada, `pesoDe` faria aritmética sobre `undefined`, a pontuação
 * viraria `NaN`, e toda comparação de limiar passaria a ser falsa — a IARA
 * emudeceria para aquele assunto sem erro nenhum aparecer.
 *
 * `Ocorrencia` recusa esses dois nomes explicitamente, e continua recusando. Mas
 * uma trava que só não falha porque outra a compensa é uma trava que já falhou:
 * a busca precisa estar certa por si, para o dia em que um assunto chegar aqui
 * por um caminho que ainda não existe.
 */
export function atencaoDe(livro: Livro, assunto: string, agora: number): Atencao {
  if (!Object.hasOwn(livro.atencao, assunto)) return atencaoNova(assunto, agora);
  return livro.atencao[assunto] ?? atencaoNova(assunto, agora);
}

/** Instância do processo. O cache dos livros vive nela. */
export const livroDeOcorrencias = new LivroDeOcorrencias();
