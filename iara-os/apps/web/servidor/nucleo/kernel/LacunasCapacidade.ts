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
 * EM MEMÓRIA, POR PROCESSO, de propósito nesta fase: a lacuna é sinal
 * estatístico ("isso apareceu N vezes"), não jornal de auditoria. Um restart
 * zera a contagem e a lacuna real reaparece sozinha — porque o operador vai
 * pedir de novo. Persistir é decisão da fase em que a fila de evolução ganhar
 * consumidor além de `auditar_sistema`.
 */

import { createHash } from 'node:crypto';
import { normalizar } from '../texto';

export interface LacunaCapacidade {
  /** sha1 truncado de operador+assinatura. Identidade estável entre ocorrências. */
  readonly hash: string;
  /** A ÚNICA forma textual guardada: normalizada, e-mails e dígitos → n. */
  readonly assinatura: string;
  readonly contagem: number;
  readonly primeira_ocorrencia: string;
  readonly ultima_ocorrencia: string;
}

/**
 * Teto de lacunas distintas por processo. Acima disso, a de MENOR contagem (e,
 * no empate, a mais antiga) sai para a nova entrar — uma lacuna que apareceu
 * uma vez há uma semana informa menos que qualquer coisa pedida hoje.
 */
const MAX_LACUNAS = 200;

/** Teto da assinatura. Frase de operador cabe; parágrafo colado não entra. */
const MAX_ASSINATURA = 80;

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

export class LacunasCapacidade {
  /** `id_usuario|hash-da-assinatura` → lacuna. A partição mora na chave. */
  private readonly porChave = new Map<string, LacunaCapacidade>();

  /** Registra uma ocorrência DO OPERADOR dado. Devolve o acumulado. */
  registrar(
    bruto: string,
    idUsuario: string,
    instante = new Date().toISOString(),
  ): LacunaCapacidade {
    const assinatura = assinaturaDeLacuna(bruto);
    const hash = createHash('sha1').update(`${idUsuario}|${assinatura}`).digest('hex').slice(0, 12);
    const chave = `${idUsuario}|${hash}`;

    const anterior = this.porChave.get(chave);
    const registrada: LacunaCapacidade = anterior
      ? { ...anterior, contagem: anterior.contagem + 1, ultima_ocorrencia: instante }
      : {
          hash,
          assinatura,
          contagem: 1,
          primeira_ocorrencia: instante,
          ultima_ocorrencia: instante,
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

    // Uma linha JSON, mesmo canal do RegistroErros — SEM a assinatura: o
    // stdout é lido por quem opera o processo, não só por quem fez o pedido,
    // e a frase de um operador não pertence a esse canal. O hash basta para
    // correlacionar com o que a auditoria dele mostrar.
    console.log(
      JSON.stringify({ canal: 'lacuna_capacidade', hash, contagem: registrada.contagem }),
    );

    return registrada;
  }

  /** As lacunas DESTE operador, da mais pedida à menos. É a fila de evolução. */
  inventarioDe(idUsuario: string): readonly LacunaCapacidade[] {
    const prefixo = `${idUsuario}|`;
    return [...this.porChave.entries()]
      .filter(([chave]) => chave.startsWith(prefixo))
      .map(([, l]) => l)
      .sort(
        (a, b) => b.contagem - a.contagem || (a.ultima_ocorrencia < b.ultima_ocorrencia ? 1 : -1),
      );
  }

  /** Só para teste: isolar um caso do resto da suíte. */
  zerar(): void {
    this.porChave.clear();
  }
}

/**
 * O registro do processo. Compartilhado entre kernels pela mesma razão do
 * `registroOperacoes`: dois canais do mesmo operador (navegador e WhatsApp)
 * são a mesma operação, e uma lacuna pedida em cada um é UMA lacuna pedida
 * duas vezes. A partição por operador mora na chave, não em instâncias
 * separadas.
 */
export const lacunasCapacidade = new LacunasCapacidade();
