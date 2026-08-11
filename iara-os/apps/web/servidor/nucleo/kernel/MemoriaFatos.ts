/**
 * Fatos com procedência extraídos do histórico — e o conflito entre eles.
 *
 * O BLOQUEADOR QUE ESTE ARQUIVO FECHA (auditoria de fechamento, 11/08/2026):
 *
 *   `Verdade.ts` definia procedência, força e desempate. Tinha teste. Nenhuma
 *   linha de produção chamava `maisForte`. O histórico ia CRU para o prompt, e
 *   quando ele continha "a reunião é às 16h" e depois "a reunião é às 17h",
 *   quem escolhia era a LLM — em silêncio, sem política, sem registro de que
 *   houve escolha. A IARA respondia um horário com a mesma segurança com que
 *   responderia um fato verificado.
 *
 * A REGRA, em uma frase: **o desempate é do kernel; a redação é da LLM.**
 *
 * O QUE ESTE ARQUIVO NÃO É: um extrator de fatos de propósito geral. Ele
 * reconhece uma família estreita e fechada — horário associado a um assunto
 * operacional conhecido — porque é onde o conflito de fato acontece na operação
 * e porque falso positivo aqui é caro: inventar conflito onde não há faz a IARA
 * hesitar sobre coisa resolvida, que é tão ruim quanto escolher sozinha.
 * Ampliar a família é acrescentar linha em `ASSUNTOS`, não reescrever o módulo.
 *
 * O QUE ELE TAMBÉM NÃO FAZ: resolver por conta própria e calar. Quando o
 * desempate tem base (procedência diferente, ou recência dentro da mesma
 * procedência), ele resolve E DECLARA que houve conflito. A informação antiga
 * não desaparece — some da resposta como resposta, não como história.
 */

import type { RegistroMemoria } from '../../../lib/estado';
import { maisForte, type Afirmacao, type Procedencia } from './Verdade';
import { normalizar } from '../texto';

/**
 * Assuntos operacionais que carregam horário. Lista fechada, revisada em
 * commit — a mesma disciplina da allowlist de aplicativos do `AgenteLocal`.
 */
const ASSUNTOS = [
  'reuniao',
  'relatorio',
  'entrega',
  'chamada',
  'visita',
  'manutencao',
  'deploy',
  'backup',
  'treinamento',
  'apresentacao',
  'auditoria',
  'coleta',
] as const;

type Assunto = (typeof ASSUNTOS)[number];

/** `16h`, `16:30`, `às 9h`. Minutos opcionais; segundos não existem em agenda. */
const HORARIO = /\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/g;

/** Quantas palavras separam o assunto do horário para ainda serem a mesma coisa. */
const ALCANCE_ASSUNTO = 12;

export interface FatoHorario extends Afirmacao {
  readonly assunto: Assunto;
  /** Minutos desde a meia-noite. É o valor que se compara, não a grafia. */
  readonly minutos: number;
}

export interface ConflitoFato {
  readonly assunto: Assunto;
  /** A afirmação que prevalece, segundo a política — nunca segundo a LLM. */
  readonly vigente: FatoHorario;
  /** As que foram superadas. Preservadas: história não é lixo. */
  readonly superadas: readonly FatoHorario[];
  /** Por que esta venceu. Vai para o contexto e pode ir para a resposta. */
  readonly criterio: 'procedencia' | 'recencia';
}

function grafia(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Procedência de um registro de conversa. É AQUI que a memória deixa de ser
 * uma pilha de strings todas do mesmo peso.
 *
 * O DEFEITO, encontrado no fechamento forense (11/08/2026): esta função
 * devolvia `memoria` para tudo. Duas consequências, e a segunda é séria:
 *
 *  1. O ramo `criterio: 'procedencia'` de `detectarConflitos` era INALCANÇÁVEL.
 *     A política de força existia e nunca era exercida — a mesma doença que
 *     tirou `Verdade.ts` do caminho vivo, reencenada dentro do próprio módulo
 *     que a curou.
 *  2. Como o desempate caía sempre em recência, **a prosa da própria LLM
 *     sobrepunha o que o operador declarou**, bastando ser mais recente. A IARA
 *     dizia "a reunião é às 18h" por engano num turno, aquilo virava memória de
 *     mesmo peso, e no turno seguinte derrubava o "16h" que o operador tinha
 *     afirmado. Alucinação virando fato por decurso de prazo.
 *
 * A escala resolve as duas: o que veio de ferramenta determinística é `fato`
 * (6), documento recuperado é `documento` (4), o que o OPERADOR declarou é
 * `memoria` (3), e prosa da nuvem é `inferencia` (2) — abaixo do operador, de
 * propósito. A IARA não é fonte sobre o mundo; ela é fonte sobre o que apurou.
 */
function procedenciaDe(registro: RegistroMemoria): Procedencia {
  if (registro.papel === 'operador') return 'memoria';

  switch (registro.destino) {
    // Índice de incidentes: verdadeiro na data em que foi escrito.
    case 'rag_historico':
      return 'documento';
    /**
     * TUDO O MAIS QUE A IARA DISSE É `inferencia` — inclusive a rota
     * `sistema_local`, e isso merece explicação porque a tentação é o contrário.
     *
     * `sistema_local` parece determinístico, e a fonte é. Mas o que fica no
     * histórico não é o dado: é a PROSA que o kernel compôs em volta dele, e
     * ela carrega de volta o que o operador escreveu. O ataque de segunda ordem
     * mostrou a forma: "crie uma pasta chamada Reunião 16h" produz a resposta
     * `Pasta "Reunião 16h" criada`, que na rota `plano_local` viraria `fato`
     * (força 6) e derrubaria um "a reunião é às 17h" declarado pelo operador
     * depois. O eco de uma ação viraria autoridade sobre o mundo.
     *
     * `fato` fica RESERVADO para um armazém de fatos estruturados, que ainda
     * não existe. Enquanto a memória for conversa, nada que a IARA falou pesa
     * mais do que o que a pessoa afirmou.
     */
    default:
      return 'inferencia';
  }
}

/**
 * Fatos de horário no histórico, do mais antigo ao mais novo.
 *
 * Um registro pode conter mais de um: "a reunião é às 16h e a entrega às 18h"
 * produz dois fatos de assuntos diferentes, que não conflitam entre si.
 */
export function extrairFatosHorario(registros: readonly RegistroMemoria[]): FatoHorario[] {
  const fatos: FatoHorario[] = [];

  for (const registro of registros) {
    const t = normalizar(registro.texto);

    for (const achado of t.matchAll(HORARIO)) {
      if (achado.index === undefined) continue;
      const hora = Number(achado[1]);
      const minuto = Number(achado[2] ?? 0);
      // `24h` é jornada, não horário; `13:70` é lixo de digitação.
      if (hora > 23 || minuto > 59) continue;

      /**
       * O assunto é procurado ANTES do horário, dentro de uma janela curta.
       * "a reunião de amanhã é às 16h" liga; "a reunião foi boa, te ligo às 16h"
       * também ligaria — e é por isso que a lista de assuntos é fechada e o
       * alcance é curto. Errar para menos aqui significa não detectar um
       * conflito real; errar para mais significa inventar um.
       */
      const ateAqui = t.slice(0, achado.index).split(/\s+/);
      const janela = ateAqui.slice(-ALCANCE_ASSUNTO);
      const assunto = ASSUNTOS.find((a) => janela.includes(a));
      if (!assunto) continue;

      fatos.push({
        assunto,
        minutos: hora * 60 + minuto,
        conteudo: `${assunto} às ${grafia(hora * 60 + minuto)}`,
        procedencia: procedenciaDe(registro),
        origem: 'shard',
        instante: registro.instante,
      });
    }
  }

  return fatos;
}

/**
 * Conflitos entre fatos do MESMO assunto com valores diferentes.
 *
 * Repetir a mesma informação não é conflito — é confirmação, e tratá-la como
 * conflito encheria toda conversa longa de ressalva. Só valores divergentes
 * entram.
 */
export function detectarConflitos(fatos: readonly FatoHorario[]): ConflitoFato[] {
  const porAssunto = new Map<Assunto, FatoHorario[]>();
  for (const f of fatos) {
    const lista = porAssunto.get(f.assunto) ?? [];
    lista.push(f);
    porAssunto.set(f.assunto, lista);
  }

  const conflitos: ConflitoFato[] = [];
  for (const [assunto, lista] of porAssunto) {
    const valores = new Set(lista.map((f) => f.minutos));
    if (valores.size < 2) continue;

    /**
     * O DESEMPATE É AQUI, e é `maisForte` quem o faz — a mesma função que os
     * testes já travavam e que a produção nunca chamava. Procedência vence
     * primeiro; recência só desempata dentro da mesma procedência.
     */
    const vigente = lista.reduce((a, b) => maisForte(a, b) as FatoHorario);
    const criterio = lista.some((f) => f.procedencia !== vigente.procedencia)
      ? 'procedencia'
      : 'recencia';

    conflitos.push({
      assunto,
      vigente,
      superadas: lista.filter((f) => f.minutos !== vigente.minutos),
      criterio,
    });
  }

  return conflitos;
}

/**
 * O conflito escrito para entrar no contexto do raciocínio.
 *
 * Duas ordens explícitas, e as duas importam: qual valor vale (senão a LLM
 * escolhe) e que houve conflito (senão a IARA responde um horário com a
 * segurança de quem nunca viu o outro). Vazio quando não há conflito — e é o
 * caso da esmagadora maioria dos turnos.
 */
export function contextoDeConflitos(conflitos: readonly ConflitoFato[]): string {
  if (conflitos.length === 0) return '';

  const linhas = conflitos.map((c) => {
    const antigos = c.superadas.map((f) => grafia(f.minutos)).join(', ');
    const porque =
      c.criterio === 'procedencia'
        ? 'venceu por ter procedência mais forte'
        : 'venceu por ser o registro mais recente';
    return (
      `- ${c.assunto}: VALOR VIGENTE ${grafia(c.vigente.minutos)} (${porque}). ` +
      `Registro anterior conflitante: ${antigos}.`
    );
  });

  return (
    '--- CONFLITO DE MEMÓRIA JÁ RESOLVIDO PELO KERNEL ---\n' +
    'Use o valor vigente. NÃO escolha por conta própria e NÃO omita que houve\n' +
    'divergência: diga o valor vigente e mencione que havia um registro anterior\n' +
    'diferente, para o operador poder corrigir se a mudança não foi intencional.\n' +
    linhas.join('\n')
  );
}
