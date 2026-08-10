/**
 * Pontos de extensão de segurança.
 *
 * As interfaces são definitivas; as implementações são as mais simples que
 * funcionam. É de propósito: quando entrar RBAC de verdade, LGPD ou um cofre
 * de segredos, troca-se a implementação e nenhum chamador muda.
 *
 * O que NÃO é simples e já está valendo: a política de capacidades e a
 * auditoria. Sem essas duas, uma habilidade nova entra com acesso total e sem
 * rastro — e é assim que sistema de agente vira incidente.
 */

import type { Permissao } from './Habilidade';

// ---------------------------------------------------------------------------
// Autorização
// ---------------------------------------------------------------------------

export type Papel = 'operador' | 'administrador' | 'somente_leitura';

export interface PoliticaCapacidades {
  /** Permissões que este papel pode conceder a uma habilidade. */
  permissoesDe(papel: Papel): readonly Permissao[];
  /** Este papel pode acionar esta habilidade? */
  podeUsar(papel: Papel, habilidade: string): boolean;
}

const POR_PAPEL: Record<Papel, readonly Permissao[]> = {
  /**
   * `escrita` para o operador é decisão CONSCIENTE, tomada quando o Agente
   * Local entrou no catálogo (criar_pasta, abrir_aplicativo, energia). As
   * fronteiras que tornam isso aceitável moram no `AgenteLocal`: raízes
   * autorizadas, allowlist de aplicativos e confirmação obrigatória para
   * energia. Habilidade nova com `escrita` passa por essas mesmas réguas ou
   * não entra.
   */
  operador: ['rede', 'banco', 'memoria', 'llm', 'escrita'],
  administrador: ['rede', 'banco', 'memoria', 'llm', 'escrita'],
  somente_leitura: ['banco', 'memoria'],
};

export class PoliticaPadrao implements PoliticaCapacidades {
  permissoesDe(papel: Papel): readonly Permissao[] {
    return POR_PAPEL[papel] ?? POR_PAPEL.somente_leitura;
  }

  podeUsar(papel: Papel, habilidade: string): boolean {
    if (papel === 'somente_leitura') {
      // IDs REAIS do catálogo (habilidades/operacionais.ts) — a lista antiga
      // usava apelidos que não existem e bloquearia tudo, inclusive a recusa
      // de sigilo, no dia em que o papel entrasse em uso.
      return [
        'consultar_agenda',
        'consultar_clima',
        'consultar_infraestrutura',
        'buscar_historico',
        'recusar_por_sigilo',
      ].includes(habilidade);
    }
    return true;
  }
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------

export interface RegistroAuditoria {
  readonly instante: string;
  readonly sessao: string;
  readonly id_usuario: string;
  readonly traco: string;
  readonly acao: string;
  readonly detalhe: string;
  readonly permitido: boolean;
}

export interface Auditoria {
  registrar(r: RegistroAuditoria): void;
}

/**
 * Auditoria em log estruturado. Uma linha JSON por evento — formato que
 * qualquer coletor consome sem parser próprio, e que é o mesmo que o OTel vai
 * receber quando entrar.
 *
 * NUNCA registra conteúdo de mensagem. Registra qual ação, de quem, quando e
 * se foi permitida. Auditoria que copia a conversa é vazamento com outro nome.
 */
export class AuditoriaEstruturada implements Auditoria {
  registrar(r: RegistroAuditoria): void {
    console.log(JSON.stringify({ canal: 'auditoria', ...r }));
  }
}

// ---------------------------------------------------------------------------
// Segredos
// ---------------------------------------------------------------------------

export interface GerenciadorSegredos {
  obter(chave: string): string | undefined;
  /** Existe sem revelar o valor — para diagnóstico e telas de status. */
  tem(chave: string): boolean;
}

export class SegredosDoAmbiente implements GerenciadorSegredos {
  obter(chave: string): string | undefined {
    const v = process.env[chave];
    return v && v.trim() ? v.trim() : undefined;
  }

  tem(chave: string): boolean {
    return this.obter(chave) !== undefined;
  }
}

// ---------------------------------------------------------------------------
// Sandbox de habilidades
// ---------------------------------------------------------------------------

export interface Sandbox {
  /** Chamado antes de executar. Lança para barrar. */
  verificar(habilidade: string, permissoes: readonly Permissao[], papel: Papel): void;
}

export class SandboxPorPolitica implements Sandbox {
  constructor(private readonly politica: PoliticaCapacidades = new PoliticaPadrao()) {}

  verificar(habilidade: string, permissoes: readonly Permissao[], papel: Papel): void {
    if (!this.politica.podeUsar(papel, habilidade)) {
      throw new Error(`papel "${papel}" não pode acionar "${habilidade}"`);
    }
    const concedidas = this.politica.permissoesDe(papel);
    const faltando = permissoes.filter((p) => !concedidas.includes(p));
    if (faltando.length > 0) {
      throw new Error(`papel "${papel}" não concede: ${faltando.join(', ')}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Limite de vazão
// ---------------------------------------------------------------------------

/**
 * Janela deslizante por sessão. Protege o orçamento de tokens e o próprio
 * motor: uma aba presa num laço não consegue disparar cem raciocínios.
 */
export class LimiteVazao {
  private marcas: number[] = [];

  constructor(
    private readonly maximo = 30,
    private readonly janelaMs = 60_000,
  ) {}

  permitir(agora = Date.now()): boolean {
    this.marcas = this.marcas.filter((t) => agora - t < this.janelaMs);
    if (this.marcas.length >= this.maximo) return false;
    this.marcas.push(agora);
    return true;
  }

  get restante(): number {
    return Math.max(0, this.maximo - this.marcas.length);
  }
}
