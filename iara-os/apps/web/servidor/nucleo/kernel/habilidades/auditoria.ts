/**
 * AUDITORIA — "IARA, o que está errado por aqui?"
 *
 * O QUE ESTA HABILIDADE NÃO FAZ, e vem primeiro porque é a parte honesta:
 *
 *   ELA NÃO AUDITA A SUA ROTINA ADMINISTRATIVA.
 *
 * A especificação de evolução (§20) pede uma auditoria de processos, fluxos de
 * trabalho, tarefas e rotinas — procurando gargalos, redundâncias e
 * oportunidades de automação. Nada disso existe como DADO neste sistema. Não há
 * cadastro de processo, não há fluxo modelado, não há registro de quanto tempo
 * uma tarefa administrativa leva. Uma "auditoria" sobre isso seria a LLM
 * escrevendo um relatório plausível a partir de nada — e um relatório plausível
 * sobre dados inexistentes é a definição exata da IA mágica que o §27 proíbe.
 * A recusa é dita na resposta, não escondida.
 *
 * O QUE ELA AUDITA, e é real porque cada linha sai de uma fonte viva no
 * processo:
 *
 *   CAPACIDADE   habilidades no catálogo que estão desligadas por falta de
 *                credencial. É o "o que eu poderia fazer e não posso".
 *   CONFIANÇA    erros cognitivos que se REPETIRAM. Um erro é acidente; o mesmo
 *                erro três vezes é defeito, e o `RegistroErros` sabe a diferença
 *                porque agrupa por assinatura.
 *   EFICÁCIA     o que já se tentou e não resolveu, da `MemoriaDeSolucoes`.
 *   INTEGRIDADE  o estado da prova criptográfica do jornal.
 *
 * É menos do que foi pedido. É tudo que pode ser afirmado.
 */

import type { Habilidade } from '../Habilidade';
import { memoriaDeSolucoes, taxaDe } from '../MemoriaDeSolucoes';
import { estadoDaChave } from '../Prova';
import { nivelAtual, ESCADA } from '../Autonomia';

/** A partir de quantas repetições um erro deixa de ser acidente. */
const REPETICOES_PARA_ACHADO = 2;

export interface Achado {
  readonly area: 'capacidade' | 'confianca' | 'eficacia' | 'integridade';
  readonly gravidade: 'informacao' | 'atencao' | 'risco';
  readonly descricao: string;
  /** O que fazer. Vazio quando a IARA não sabe — e aí ela diz que não sabe. */
  readonly conduta: string;
}

const SIMBOLO: Record<Achado['gravidade'], string> = {
  informacao: '·',
  atencao: '!',
  risco: '!!',
};

/**
 * Os achados, a partir das fontes vivas. Função pura sobre o que lhe entregam —
 * o mesmo desenho de `MotorAnalise`: quem coleta não julga.
 */
export function auditar(entrada: {
  indisponiveis: readonly { nome: string; motivo: string }[];
  /** `null` = não consegui olhar. Diferente de `[]`, que é "olhei e não achei". */
  errosRepetidos: readonly { assinatura: string; vezes: number; classe: string }[] | null;
  solucoesIneficazes: readonly { rotulo: string; tentativas: number }[];
  chaveDeProvaAtiva: boolean;
  motivoDaChave: string;
}): Achado[] {
  const achados: Achado[] = [];

  for (const h of entrada.indisponiveis) {
    achados.push({
      area: 'capacidade',
      gravidade: 'informacao',
      descricao: `"${h.nome}" está no catálogo mas desligada: ${h.motivo}`,
      conduta: 'configurar a credencial que falta, se essa capacidade for necessária',
    });
  }

  /**
   * A DISTINÇÃO ENTRE `null` E `[]`, a mesma das sondas de desempenho: "não
   * consegui olhar" nunca pode virar "olhei e está tudo bem". Sem esta linha, a
   * auditoria rodando sem registro de erros produziria silêncio sobre a área —
   * indistinguível de um resultado limpo.
   */
  if (entrada.errosRepetidos === null) {
    achados.push({
      area: 'confianca',
      gravidade: 'informacao',
      descricao: 'não consegui ler o registro de erros desta sessão — esta área ficou sem auditoria',
      conduta: '',
    });
  }

  for (const e of entrada.errosRepetidos ?? []) {
    achados.push({
      area: 'confianca',
      gravidade: e.vezes >= 4 ? 'risco' : 'atencao',
      descricao: `o erro "${e.classe}" se repetiu ${e.vezes} vezes (assinatura ${e.assinatura})`,
      /**
       * A conduta aponta para o caderno de regressão porque é o que o
       * `RegistroErros` já produz. Um achado sem conduta seria uma reclamação.
       */
      conduta: 'virar caso de regressão antes de mexer no comportamento',
    });
  }

  for (const s of entrada.solucoesIneficazes) {
    achados.push({
      area: 'eficacia',
      gravidade: 'atencao',
      descricao: `o plano "${s.rotulo}" foi tentado ${s.tentativas} vezes e nunca resolveu`,
      conduta: 'parar de propor esse caminho para esta situação, ou investigar por outro ângulo',
    });
  }

  if (!entrada.chaveDeProvaAtiva) {
    achados.push({
      area: 'integridade',
      gravidade: 'risco',
      descricao: `a prova criptográfica do jornal está desligada: ${entrada.motivoDaChave}`,
      conduta: 'definir IARA_CHAVE_PROVA com pelo menos 32 caracteres',
    });
  }

  // Risco primeiro: uma lista longa é lida de cima para baixo, e o que importa
  // não pode ficar embaixo de cinco linhas informativas.
  const peso = { risco: 0, atencao: 1, informacao: 2 } as const;
  return achados.sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}

export function redigirAuditoria(achados: readonly Achado[]): string {
  const linhas = ['Auditoria do que eu consigo observar:', ''];

  if (achados.length === 0) {
    linhas.push('  Nada fora do lugar nas quatro áreas que eu sei conferir.');
  } else {
    for (const a of achados) {
      linhas.push(`  ${SIMBOLO[a.gravidade]} [${a.area}] ${a.descricao}`);
      if (a.conduta) linhas.push(`      conduta: ${a.conduta}`);
    }
  }

  /**
   * O LIMITE DECLARADO. Ele sai SEMPRE, inclusive quando não houve achado
   * nenhum — e principalmente aí: "nada fora do lugar" sem esta ressalva
   * convidaria o operador a ler cobertura que não existe.
   */
  linhas.push(
    '',
    'O que eu NÃO auditei, porque não tenho o dado: sua rotina administrativa, seus',
    'processos de trabalho, prazos de tarefa e gargalos de fluxo. Nada disso está',
    'cadastrado em lugar nenhum que eu alcance, e eu não vou escrever um relatório',
    'sobre isso a partir de suposição.',
  );

  return linhas.join('\n');
}

export const auditarSistema: Habilidade = {
  manifesto: {
    id: 'auditar_sistema',
    nome: 'Auditoria do que a IARA observa',
    descricao:
      'Audita as quatro áreas que a IARA consegue observar de si mesma: capacidades desligadas por ' +
      'falta de credencial, erros cognitivos que se repetiram, planos que foram tentados e nunca ' +
      'resolveram, e a integridade da prova do jornal. Declara explicitamente o que NÃO auditou. ' +
      'Use para "faça uma auditoria", "o que está errado por aqui", "o que precisa de atenção".',
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: [],
    timeout_ms: 8000,
    custo: 'zero',
    risco: 'baixo',
    idempotencia: 'leitura',
    esquema: {},
  },

  async executar(ctx) {
    /**
     * Import tardio, pela mesma razão de `diagnostico.ts`: `habilidades/index.ts`
     * importa este arquivo para montar o catálogo, e importá-lo de volta no topo
     * fecharia um ciclo de módulos — que em ESM resolve para `undefined` num dos
     * lados, produzindo um catálogo que às vezes tem zero habilidades.
     */
    let indisponiveis: { nome: string; motivo: string }[] = [];
    try {
      const { CATALOGO } = await import('./index');
      indisponiveis = CATALOGO.flatMap((h) => {
        const motivo = h.indisponivelPorque?.();
        return motivo ? [{ nome: h.manifesto.nome, motivo }] : [];
      });
    } catch {
      indisponiveis = [];
    }

    /**
     * O registro de erros vem do contexto, e pode não vir: ele é por Kernel, e
     * há caminhos legítimos que executam habilidade sem um. A ausência é DITA na
     * resposta — relatar "nenhum erro recorrente" sem ter olhado seria a mesma
     * mentira de um diagnóstico que omite o que não conseguiu medir.
     */
    const errosRepetidos = ctx.erros
      ? ctx.erros.inventario
          .filter((e) => e.ocorrencias >= REPETICOES_PARA_ACHADO)
          .map((e) => ({ assinatura: e.assinatura, vezes: e.ocorrencias, classe: e.classe }))
      : null;

    const ineficazes: { rotulo: string; tentativas: number }[] = [];
    for (const r of memoriaDeSolucoes.todos(ctx.id_usuario)) {
      if (r.tentativas >= REPETICOES_PARA_ACHADO && taxaDe(r) === 0) {
        ineficazes.push({ rotulo: r.rotulo, tentativas: r.tentativas });
      }
    }

    const chave = estadoDaChave();
    const achados = auditar({
      indisponiveis,
      errosRepetidos,
      solucoesIneficazes: ineficazes,
      chaveDeProvaAtiva: chave.ativa,
      motivoDaChave: chave.motivo,
    });

    const nivel = nivelAtual();
    return {
      texto:
        `${redigirAuditoria(achados)}\n\n` +
        `Minha autonomia está em "${nivel}" (escada: ${ESCADA.join(' → ')}).`,
      detalhe: `auditar_sistema: ${achados.length} achado(s), autonomia ${nivel}`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_AUDITORIA: readonly Habilidade[] = [auditarSistema];
