/**
 * Lacunas de capacidade — "o que me pediram e eu não sei fazer".
 *
 * O CASO QUE ESTE MÓDULO EXISTE PARA NÃO PERDER: "Motoristas disponíveis
 * agora?" aconteceu três vezes ao vivo em 14/08/2026 antes de alguém notar que
 * nenhuma habilidade cobria a pergunta. As três vezes deixaram rastro só na
 * memória de quem estava olhando. A fila de evolução do catálogo não pode
 * depender de alguém estar olhando.
 *
 * O QUE É UMA LACUNA: a frase tinha FORMA DE PEDIDO (comando ou interrogação),
 * compartilhava assunto com o catálogo (`pareceOperacional` disse sim), a rota
 * `plano_cognitivo` mostrou o catálogo inteiro à LLM — e o plano voltou sem
 * UMA habilidade sequer. O sistema reconheceu o terreno e não tinha
 * ferramenta. Isso não é erro (nada quebrou), não é ambiguidade (nada faltou
 * perguntar): é o catálogo sendo menor que a operação, medido em vez de
 * suposto.
 *
 * DESDE 19/08/2026 EXISTE UMA SEGUNDA ORIGEM: o SOS. Quando alguém pergunta
 * como executar um procedimento e nenhum POP oficial responde, isso é a mesma
 * espécie de fato — a documentação sendo menor que a operação. É o que fecha o
 * ciclo *dúvida → lacuna → supervisor → POP novo*, e é o único caminho pelo qual
 * a base de erros (que nenhum dos 11 POPs cataloga) pode vir a existir.
 *
 * O CONTRATO DE PRIVACIDADE, dito sem exagero: a assinatura É a frase do
 * operador em forma sintática — normalizada, com números e e-mails mascarados,
 * numa linha com teto. Isso NÃO a torna anônima (nomes citados sobrevivem), e
 * é por isso que a proteção de verdade é a PARTIÇÃO: cada lacuna pertence ao
 * operador que a pediu, `inventarioDe(id_usuario)` só devolve as dele, e a
 * auditoria mostra a cada um apenas as próprias frases. O log de observação
 * carrega só hash e contagem — a assinatura nunca sai para o stdout.
 * (A primeira versão deste módulo afirmava "incapaz de carregar dado pessoal"
 * e expunha a fila inteira a qualquer operador — achado da auditoria
 * adversarial de 14/08, corrigido antes do primeiro commit.)
 *
 * AGORA PERSISTE, e a decisão estava prevista aqui mesmo: a versão anterior
 * dizia que a fila era volátil "de propósito nesta fase", e que persistir seria
 * decisão "da fase em que a fila de evolução ganhar consumidor além de
 * `auditar_sistema`". O SOS é esse consumidor. Um sinal que zera a cada
 * redeploy nunca acumula as cinco ocorrências que justificam escrever um POP —
 * e "apareceu cinco vezes em trinta dias" é exatamente a frase que faz um
 * supervisor agir.
 *
 * A persistência é POR OPERADOR, em `dados/lacunas/<id>.json`, fora do Git pela
 * mesma razão do shard de memória: são as frases de uma pessoa, e elas dizem o
 * que ela ainda não sabe fazer. Instância criada sem pasta (o que os testes
 * fazem) continua só em memória.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizar } from '../texto';

/** De onde veio a lacuna. Agrupa junto; a triagem distingue. */
export type OrigemDaLacuna =
  /** Nenhuma habilidade cobriu o pedido. */
  | 'capacidade'
  /** Nenhum POP oficial respondeu "como faço isso". */
  | 'procedimento'
  /**
   * O operador contestou o POP — "isto está errado", "aqui fazemos diferente".
   *
   * ENTRA NESTA FILA, e não numa fila nova, porque é o mesmo destino: material
   * para quem revisa procedimento. Uma segunda fila teria de repetir a
   * partição por operador, a assinatura mascarada, o teto e a contagem — e a
   * segunda cópia de uma política de privacidade é como as duas passam a
   * discordar.
   *
   * O QUE ELA NÃO É: aprendizado. Nada aqui reescreve POP nem vira orientação.
   * A divergência fica REGISTRADA como relato do operador, com a contagem que
   * distingue tropeço isolado de documento realmente defasado.
   */
  | 'divergencia';

export interface LacunaCapacidade {
  /** sha1 truncado de operador+assinatura. Identidade estável entre ocorrências. */
  readonly hash: string;
  /** A ÚNICA forma textual guardada: normalizada, e-mails e dígitos → n. */
  readonly assinatura: string;
  readonly contagem: number;
  readonly primeira_ocorrencia: string;
  readonly ultima_ocorrencia: string;
  /**
   * As origens já vistas para esta forma de frase.
   *
   * É lista, e não campo único, porque a MESMA pergunta pode chegar pelos dois
   * caminhos — e as duas ocorrências são o mesmo fato ("não sei responder
   * isso"), com contagem somada. Separar por origem partiria o sinal em dois
   * montes menores, que é o oposto do que a fila existe para fazer.
   */
  readonly origens: readonly OrigemDaLacuna[];
}

/**
 * Teto de lacunas distintas por processo. Acima disso, a de MENOR contagem (e,
 * no empate, a mais antiga) sai para a nova entrar — uma lacuna que apareceu
 * uma vez há uma semana informa menos que qualquer coisa pedida hoje.
 */
const MAX_LACUNAS = 200;

/** Teto da assinatura. Frase de operador cabe; parágrafo colado não entra. */
const MAX_ASSINATURA = 80;

/** Onde a fila do singleton mora. Gitignorado, como `dados/memoria/`. */
const PASTA_PADRAO = path.resolve(process.cwd(), 'dados', 'lacunas');

/**
 * A assinatura sintática: normalização (sem acento, sem caixa), e-mails e
 * dígitos mascarados como `n`, espaço colapsado, uma linha, comprimento
 * limitado.
 *
 * Mais legível que a forma `P P N` do `RegistroErros`, de propósito: lá a
 * assinatura agrupa DEFEITOS e ninguém a lê como frase; aqui ela é o que o
 * PRÓPRIO operador vai reler na auditoria para decidir qual habilidade
 * construir — uma forma toda mascarada tornaria a fila ilegível para quem ela
 * existe para servir. O que paga essa legibilidade é a partição por operador,
 * não a máscara.
 */
export function assinaturaDeLacuna(bruto: string): string {
  return normalizar(bruto)
    .replace(/\S+@\S+/g, 'n')
    .replace(/\d+([.,/:-]\d+)*/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_ASSINATURA);
}

/** Só `[a-z0-9_-]`: nada que venha do socket vira nome de arquivo. */
function nomeDeArquivo(idUsuario: string): string | null {
  return /^[a-z0-9_-]{1,64}$/.test(idUsuario) ? idUsuario : null;
}

export class LacunasCapacidade {
  /** `id_usuario|hash-da-assinatura` → lacuna. A partição mora na chave. */
  private readonly porChave = new Map<string, LacunaCapacidade>();
  /** Operadores já lidos do disco nesta instância. */
  private readonly hidratados = new Set<string>();

  /** `null` = só memória. É o que as instâncias de teste usam. */
  constructor(private readonly pasta: string | null = null) {}

  private caminho(idUsuario: string): string | null {
    if (!this.pasta) return null;
    const nome = nomeDeArquivo(idUsuario);
    return nome ? path.join(this.pasta, `${nome}.json`) : null;
  }

  /**
   * Traz do disco a fila deste operador, uma vez por instância.
   *
   * Falha de leitura é silenciosa e vira fila vazia DE PROPÓSITO: um JSON
   * corrompido não pode derrubar o turno de quem só fez uma pergunta. O que se
   * perde é sinal estatístico; o que se preservaria com um `throw` aqui é nada.
   */
  private hidratar(idUsuario: string): void {
    if (this.hidratados.has(idUsuario)) return;
    this.hidratados.add(idUsuario);
    const caminho = this.caminho(idUsuario);
    if (!caminho || !existsSync(caminho)) return;
    try {
      const lidas = JSON.parse(readFileSync(caminho, 'utf8')) as LacunaCapacidade[];
      for (const l of lidas) {
        if (l?.hash && l?.assinatura) {
          this.porChave.set(`${idUsuario}|${l.hash}`, { ...l, origens: l.origens ?? ['capacidade'] });
        }
      }
    } catch {
      /* fila ilegível: começa vazia */
    }
  }

  /** Grava a fila deste operador. Escrita atômica: temporário + rename. */
  private persistir(idUsuario: string): void {
    const caminho = this.caminho(idUsuario);
    if (!caminho) return;
    try {
      mkdirSync(path.dirname(caminho), { recursive: true });
      const temporario = `${caminho}.${process.pid}.tmp`;
      writeFileSync(temporario, JSON.stringify(this.inventarioDe(idUsuario), null, 2), 'utf8');
      renameSync(temporario, caminho);
    } catch {
      /* disco cheio ou permissão: a fila continua valendo em memória */
    }
  }

  /** Registra uma ocorrência DO OPERADOR dado. Devolve o acumulado. */
  registrar(
    bruto: string,
    idUsuario: string,
    instante = new Date().toISOString(),
    origem: OrigemDaLacuna = 'capacidade',
  ): LacunaCapacidade {
    this.hidratar(idUsuario);

    const assinatura = assinaturaDeLacuna(bruto);
    const hash = createHash('sha1').update(`${idUsuario}|${assinatura}`).digest('hex').slice(0, 12);
    const chave = `${idUsuario}|${hash}`;

    const anterior = this.porChave.get(chave);
    const registrada: LacunaCapacidade = anterior
      ? {
          ...anterior,
          contagem: anterior.contagem + 1,
          ultima_ocorrencia: instante,
          origens: anterior.origens.includes(origem)
            ? anterior.origens
            : [...anterior.origens, origem],
        }
      : {
          hash,
          assinatura,
          contagem: 1,
          primeira_ocorrencia: instante,
          ultima_ocorrencia: instante,
          origens: [origem],
        };

    if (!anterior && this.porChave.size >= MAX_LACUNAS) {
      let chaveVitima: string | null = null;
      let vitima: LacunaCapacidade | null = null;
      for (const [c, l] of this.porChave) {
        if (
          !vitima ||
          l.contagem < vitima.contagem ||
          (l.contagem === vitima.contagem && l.ultima_ocorrencia < vitima.ultima_ocorrencia)
        ) {
          vitima = l;
          chaveVitima = c;
        }
      }
      if (chaveVitima) this.porChave.delete(chaveVitima);
    }

    this.porChave.set(chave, registrada);
    this.persistir(idUsuario);

    // Uma linha JSON, mesmo canal do RegistroErros — SEM a assinatura: o
    // stdout é lido por quem opera o processo, não só por quem fez o pedido,
    // e a frase de um operador não pertence a esse canal. O hash basta para
    // correlacionar com o que a auditoria dele mostrar.
    console.log(
      JSON.stringify({ canal: 'lacuna_capacidade', hash, contagem: registrada.contagem, origem }),
    );

    return registrada;
  }

  /** As lacunas DESTE operador, da mais pedida à menos. É a fila de evolução. */
  inventarioDe(idUsuario: string): readonly LacunaCapacidade[] {
    this.hidratar(idUsuario);
    const prefixo = `${idUsuario}|`;
    return [...this.porChave.entries()]
      .filter(([chave]) => chave.startsWith(prefixo))
      .map(([, l]) => l)
      .sort(
        (a, b) => b.contagem - a.contagem || (a.ultima_ocorrencia < b.ultima_ocorrencia ? 1 : -1),
      );
  }

  /** Só para teste: isolar um caso do resto da suíte. Limpa disco também. */
  zerar(): void {
    const operadores = new Set([...this.porChave.keys()].map((c) => c.split('|')[0]));
    this.porChave.clear();
    this.hidratados.clear();
    for (const id of operadores) {
      const caminho = this.caminho(id);
      if (caminho) rmSync(caminho, { force: true });
    }
  }
}

/**
 * O registro do processo. Compartilhado entre kernels pela mesma razão do
 * `registroOperacoes`: dois canais do mesmo operador (navegador e WhatsApp)
 * são a mesma operação, e uma lacuna pedida em cada um é UMA lacuna pedida
 * duas vezes. A partição por operador mora na chave, não em instâncias
 * separadas.
 */
export const lacunasCapacidade = new LacunasCapacidade(PASTA_PADRAO);
