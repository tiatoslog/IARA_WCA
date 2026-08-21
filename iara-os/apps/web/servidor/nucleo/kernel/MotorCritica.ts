/**
 * MOTOR DE CRÍTICA — o que contesta a conclusão antes de o operador ler.
 *
 * A PERGUNTA QUE ESTE ARQUIVO RESPONDE: o conjunto de evidências que este turno
 * juntou sustenta o TIPO de frase que a resposta quer dizer? Não "a resposta
 * está bonita", não "a resposta parece cuidadosa" — sustenta ou não sustenta.
 *
 * POR QUE É CÓDIGO E NÃO PROMPT. Uma etapa de crítica escrita como instrução
 * ("procure o que pode estar errado") tem exatamente a autoridade do texto que
 * ela critica: o mesmo modelo, na mesma chamada, com o mesmo viés de confirmar
 * o que acabou de escrever. E custaria outra ida ao provedor num turno que já
 * paga até oito voltas de laço mais a síntese, que é a chamada mais cara do
 * kernel. Aqui a contestação é aritmética sobre `Evidencia[]`: roda sem rede,
 * sem chave, em microssegundos, e um teste consegue provar que ela dispara.
 *
 * A PEÇA CENTRAL É A ESCADA, NÃO A RECUSA. Este motor não devolve "pode" ou
 * "não pode": devolve o degrau mais alto que a evidência aguenta —
 *
 *     nenhum → descritiva → populacional → comparativa → causal
 *
 * e a resposta DESCE até ele. Uma IARA que se cala quando não pode afirmar
 * causa é tão inútil quanto uma que afirma causa sem lastro; a resposta certa
 * quase sempre existe um degrau abaixo, e dizer qual degrau é a informação que
 * um profissional sênior entrega junto com o número.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: não mede, não busca, não chama modelo, não fala
 * com o operador e NÃO CONHECE DOMÍNIO. Ele não sabe o que é carga, margem ou
 * motorista — se soubesse, cada domínio novo precisaria de uma cópia dele, que
 * é a doença que `dizerCobertura()` dentro de `cargasLuft.ts` já tem.
 */

import {
  classificarCobertura,
  mesmoRecorte,
  saoComparaveis,
  zeroEhAusencia,
  type Cobertura,
} from './Cobertura';
import type { Evidencia } from './Investigacao';
import { podeAfirmarSemRessalva, type Procedencia } from './Verdade';

// ---------------------------------------------------------------------------
// 1. O que se quer afirmar
// ---------------------------------------------------------------------------

/**
 * O TIPO da frase, ordenado do que exige menos ao que exige mais.
 *
 * A ordem é a política inteira deste arquivo, e ela não é arbitrária: cada
 * degrau só acrescenta uma exigência ao anterior.
 *
 *  - `descritiva`  — "sobre as 40 cargas que apurei, 12 estão paradas".
 *                    Exige só que o número tenha vindo de algum lugar.
 *  - `populacional`— "12 das cargas da semana estão paradas". Exige cobertura
 *                    completa: falar da população com amostra é a mentira mais
 *                    barata de produzir e a mais cara de descobrir.
 *  - `comparativa` — "caiu 3 pontos contra a semana passada". Exige, além do
 *                    acima, que os dois lados sejam comparáveis — denominador
 *                    móvel é o erro clássico da comparação entre períodos.
 *  - `causal`      — "caiu POR CAUSA do pedágio". Exige lastro que dado
 *                    observacional não dá. Ver `R9`.
 */
export type TipoDeConclusao = 'descritiva' | 'populacional' | 'comparativa' | 'causal';

/** O degrau mais alto sustentável. `nenhum` é a abstenção. */
export type DegrauSustentado = 'nenhum' | TipoDeConclusao;

const ESCADA: readonly DegrauSustentado[] = [
  'nenhum',
  'descritiva',
  'populacional',
  'comparativa',
  'causal',
];

const altura = (d: DegrauSustentado): number => ESCADA.indexOf(d);

/** O mais BAIXO entre dois degraus — o teto de uma conclusão é o pior limite. */
export function menorDegrau(a: DegrauSustentado, b: DegrauSustentado): DegrauSustentado {
  return altura(a) <= altura(b) ? a : b;
}

export function alcanca(sustentado: DegrauSustentado, pedido: TipoDeConclusao): boolean {
  return altura(sustentado) >= altura(pedido);
}

// ---------------------------------------------------------------------------
// 2. Ressalva — uma contestação com nome
// ---------------------------------------------------------------------------

export type CodigoRessalva =
  | 'ausencia_como_zero'
  | 'cobertura_parcial'
  | 'cobertura_nao_declarada'
  | 'contradicao_entre_fontes'
  | 'dado_envelhecido'
  | 'fonte_unica'
  | 'procedencia_fraca'
  | 'denominador_movel'
  | 'causa_sem_lastro'
  | 'amostra_pequena';

/**
 * `impeditiva` DERRUBA O DEGRAU; `seria` e `leve` só entram na resposta.
 *
 * A distinção é o que impede a crítica de virar decoração: se toda ressalva
 * fosse texto, a IARA escreveria as objeções e concluiria do mesmo jeito — que
 * é precisamente o comportamento de quem lista riscos no rodapé para poder
 * afirmar no título.
 */
export type Gravidade = 'impeditiva' | 'seria' | 'leve';

export interface Ressalva {
  readonly codigo: CodigoRessalva;
  readonly gravidade: Gravidade;
  /** Escrito para o operador ler. Vai para a resposta, não para o log. */
  readonly texto: string;
  /** Quais métricas ela toca. Permite rastrear a ressalva até a evidência. */
  readonly metricas: readonly string[];
  /** O degrau em que esta ressalva coloca o teto. `null` = não mexe no teto. */
  readonly teto: DegrauSustentado | null;
}

// ---------------------------------------------------------------------------
// 3. Convenções declaradas
// ---------------------------------------------------------------------------

/**
 * Números com nome, pela mesma disciplina de `FAIXAS` e `LIMIAR_COBERTURA`.
 *
 * `amostra_minima: 5` não vem de teoria estatística — vem de honestidade sobre
 * o que este sistema faz: ele ranqueia e compara grupos ("top 3 motoristas"), e
 * um ranking de grupos com 2 registros cada é ordenação de ruído. Não é um
 * teste de significância e não finge ser: é um piso abaixo do qual a resposta
 * diz que o grupo é pequeno demais para o verbo que ela usaria.
 */
export const CONVENCOES_DE_CRITICA = {
  /** Diferença relativa a partir da qual dois números da mesma métrica brigam. */
  tolerancia_relativa: 0.001,
  /** Acima disto o dado entra com ressalva de idade. */
  frescor_horas: 24,
  /** Acima disto a idade vira ressalva séria. */
  obsoleto_horas: 24 * 7,
  /** Abaixo disto o conjunto é pequeno demais para ranquear ou tendenciar. */
  amostra_minima: 5,
} as const;

// ---------------------------------------------------------------------------
// 4. As contestações
// ---------------------------------------------------------------------------

const ehNumero = (v: number | string): v is number => typeof v === 'number';

const horasEntre = (a: string, b: string): number | null => {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (!Number.isFinite(ta) || !Number.isFinite(tb)) return null;
  return Math.abs(tb - ta) / 3_600_000;
};

const divergem = (a: number | string, b: number | string): boolean => {
  if (ehNumero(a) && ehNumero(b)) {
    const escala = Math.max(Math.abs(a), Math.abs(b));
    if (escala === 0) return false;
    return Math.abs(a - b) / escala > CONVENCOES_DE_CRITICA.tolerancia_relativa;
  }
  return String(a).trim() !== String(b).trim();
};

const diretas = (evidencias: readonly Evidencia[]): readonly Evidencia[] =>
  evidencias.filter((e) => e.relevancia === 'direta');

/** O recorte de uma evidência escrito para o operador ler. */
const rotularRecorte = (e: Evidencia): string =>
  e.cobertura && e.cobertura.recorte.length > 0
    ? e.cobertura.recorte.map((r) => `${r.dimensao}=${r.valor}`).join(', ')
    : 'sem recorte declarado';

/**
 * R1 — NENHUM REGISTRO ENTROU NA CONTA. IMPEDITIVA sempre.
 *
 * A REGRA OLHA O DENOMINADOR, NÃO O VALOR — e essa é a correção do P0 que a
 * auditoria independente achou (19/08/2026). A primeira versão exigia
 * `valor === 0` (via `zeroEhAusencia`), e por isso deixava passar o caso pior:
 * uma métrica com valor 18,4 apurada sobre `0 de 0` registros atravessava as
 * DEZ contestações sem nenhuma ressalva e saía como conclusão POPULACIONAL com
 * confiança média — e com três evidências, com confiança ALTA. `classificarCobertura`
 * chama esse estado de `vazia`, e `vazia` não estava na lista de R2 nem na de R1.
 *
 * Olhar `consideradas === 0` cobre os dois casos de uma vez e fecha, de quebra,
 * o buraco do tipo: `valor: '0'` em string nunca casaria `valor === 0`. Um
 * número que não saiu de registro nenhum não é zero, não é 18,4 e não é nada —
 * é ausência de dado, e ausência de dado não sustenta afirmação.
 *
 * `zeroEhAusencia` continua existindo em `Cobertura.ts` porque responde outra
 * pergunta ("este zero é um zero de verdade?"), que é a que a redação precisa.
 */
function r1AusenciaComoZero(evidencias: readonly Evidencia[]): Ressalva[] {
  const lista = diretas(evidencias);
  const atingidas = lista.filter(
    (e) => e.cobertura !== undefined && e.cobertura.consideradas === 0,
  );
  if (atingidas.length === 0) return [];
  const zeros = atingidas.filter((e) => e.cobertura && zeroEhAusencia(e.valor, e.cobertura));

  /**
   * ⚠️ O TETO É GLOBAL AO TURNO, E POR ISSO ELE PRECISA DE DUAS SAÍDAS.
   *
   * A segunda passada da auditoria independente achou o defeito que a primeira
   * correção criou: R1 passou a disparar para QUALQUER evidência vazia, com
   * `teto: 'nenhum'`, e o teto vale para o turno inteiro. Medido —
   *
   *   margem = 34,2% sobre 2688/2688 (cobertura perfeita)
   *   cargas_atrasadas = 0 sobre 0/0 (ninguém lançou SLA)
   *   → o turno inteiro abstém, e a margem perfeita vai para o lixo
   *
   * E o laço agrega evidência de TODAS as voltas: multi-hop é o objetivo
   * declarado dele, então uma sub-consulta vazia matava o turno. Trocar um
   * falso positivo por outro maior não é conserto.
   *
   *   TODAS vazias  → nada foi apurado → `nenhum`, abstenção. É o caso original.
   *   ALGUMAS vazias → o que foi apurado continua valendo, mas o turno não pode
   *                    mais falar da população: `descritiva`, ressalva séria com
   *                    as métricas nomeadas.
   */
  const todasVazias = atingidas.length === lista.length;
  const nomes = atingidas.map((e) => e.metrica).join(', ');

  return [
    {
      codigo: 'ausencia_como_zero',
      gravidade: todasVazias ? 'impeditiva' : 'seria',
      texto: todasVazias
        ? `Não entrou registro nenhum na conta de ${nomes} no recorte pedido. ` +
          (zeros.length > 0
            ? 'O resultado é ausência de dado, não zero — as duas coisas levam a decisões opostas, e eu não vou ' +
              'apresentar uma como a outra.'
            : 'Qualquer número aqui saiu de um conjunto vazio, e um número sem registro por trás não é um resultado.')
        : `Sobre ${nomes} eu não tenho nada: nenhum registro do recorte entrou nessa conta. ` +
          'O resto do que eu te disse está apurado; isso aí especificamente é ausência de dado, não zero.',
      metricas: atingidas.map((e) => e.metrica),
      teto: todasVazias ? 'nenhum' : 'descritiva',
    },
  ];
}

/** R2 — a conta viu só parte do recorte. */
function r2CoberturaParcial(evidencias: readonly Evidencia[]): Ressalva[] {
  const parciais = diretas(evidencias).filter((e) => {
    if (!e.cobertura) return false;
    const classe = classificarCobertura(e.cobertura);
    return classe === 'parcial' || classe === 'insuficiente' || classe === 'alta';
  });
  if (parciais.length === 0) return [];
  const pior = parciais.reduce((a, b) =>
    (a.cobertura?.percentual ?? 100) <= (b.cobertura?.percentual ?? 100) ? a : b,
  );
  /**
   * ABAIXO DE 95% A FALHA É SÉRIA, e a fronteira mudou depois do holdout H02.
   *
   * A primeira versão só chamava de séria a cobertura `insuficiente` (<70%), e
   * a margem de 2024 — 88,07% das cargas, 39 rotas sem preço — saía com ressalva
   * LEVE e confiança alta. Um número que ignora 12% do que ele diz medir não é
   * um detalhe de rodapé: é a diferença entre "a margem da operação" e "a
   * margem do que eu consegui cruzar".
   *
   * `alta` (95–99,9%) continua leve porque a distinção precisa sobreviver ao
   * uso: se 99% também fosse sério, a ressalva séria apareceria em quase todo
   * turno da operação e deixaria de significar alguma coisa.
   */
  const classe = classificarCobertura(pior.cobertura as Cobertura);
  return [
    {
      codigo: 'cobertura_parcial',
      gravidade: classe === 'alta' ? 'leve' : 'seria',
      texto:
        `Isto não cobre o recorte inteiro: ${pior.metrica} saiu de ` +
        `${pior.cobertura?.consideradas} de ${pior.cobertura?.elegiveis} registros` +
        (pior.cobertura?.motivo_ausencia ? ` (${pior.cobertura.motivo_ausencia})` : '') +
        '. Vale para o que eu apurei, não para o conjunto todo.',
      metricas: parciais.map((e) => e.metrica),
      /* Cobertura parcial NÃO derruba a resposta — derruba o degrau. O número
         continua verdadeiro sobre o subconjunto; o que ele deixa de sustentar é
         a frase sobre a população. */
      teto: 'descritiva',
    },
  ];
}

/** R3 — número de conjunto que não disse sobre quanto foi calculado. */
function r3CoberturaNaoDeclarada(evidencias: readonly Evidencia[]): Ressalva[] {
  const mudas = diretas(evidencias).filter((e) => ehNumero(e.valor) && e.cobertura === undefined);
  if (mudas.length === 0) return [];
  return [
    {
      codigo: 'cobertura_nao_declarada',
      gravidade: 'leve',
      texto:
        `Não sei sobre quantos registros ${mudas.map((e) => e.metrica).join(', ')} foi apurado, ` +
        'então trato como recorte e não como total.',
      metricas: mudas.map((e) => e.metrica),
      /* SILÊNCIO NÃO É GARANTIA. Supor cobertura completa quando ninguém a
         declarou transformaria esquecimento de quem escreveu a habilidade em
         afirmação sobre o mundo — exatamente o modo de falhar que este arquivo
         existe para fechar. */
      teto: 'descritiva',
    },
  ];
}

/** R4 — duas fontes discordam sobre a mesma métrica. IMPEDITIVA. */
function r4Contradicao(
  evidencias: readonly Evidencia[],
  tipo: TipoDeConclusao,
  contar: (n: number) => void,
): Ressalva[] {
  let silenciadas = 0;
  const porMetrica = new Map<string, Evidencia[]>();
  for (const e of evidencias) {
    const lista = porMetrica.get(e.metrica) ?? [];
    lista.push(e);
    porMetrica.set(e.metrica, lista);
  }
  const brigas: Ressalva[] = [];
  for (const [metrica, lista] of porMetrica) {
    if (lista.length < 2) continue;
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const a = lista[i];
        const b = lista[j];
        /* Mesma fonte relendo a mesma métrica em instantes diferentes é série
           temporal, não contradição — foi este o falso positivo que a bateria
           adversarial pegou primeiro. Só briga o que vem de fontes DIFERENTES. */
        if (a.fonte === b.fonte) continue;
        /**
         * RECORTES DIFERENTES SÃO A COMPARAÇÃO, NÃO UMA BRIGA — o segundo P0 da
         * auditoria independente.
         *
         * "Compare a margem de 2024 com a de 2026" produz duas evidências da
         * MESMA métrica com valores diferentes, de propósito. Sem esta guarda, a
         * pergunta mais comum de análise saía com *"duas fontes discordam sobre
         * margem_bruta_pct"* e **abstenção** — o falso positivo mais caro que
         * existe, porque não é ruído no rodapé: é recusa de responder o que foi
         * perguntado.
         *
         * Duas evidências só brigam quando falam do MESMO recorte. `mesmoRecorte`
         * já existia em `Cobertura.ts` e só o teste dela a chamava.
         *
         * Sem cobertura declarada dos dois lados não dá para saber se o recorte é
         * o mesmo, e aí a briga vale — é o caso dos 73 contra 75 motoristas, em
         * que nenhuma das duas fontes declarou recorte nenhum.
         */
        if (a.cobertura && b.cobertura && !mesmoRecorte(a.cobertura.recorte, b.cobertura.recorte)) {
          /**
           * ⚠️ O SILÊNCIO AQUI SERIA PIOR QUE O FALSO POSITIVO QUE ELE CONSERTOU.
           *
           * `Recorte.valor` é texto livre por contrato. Duas habilidades que
           * escrevam o mesmo período de formas diferentes — `2026-08` e
           * `agosto/2026` — deixam `mesmoRecorte` falso, e a guarda acima
           * desativa a detecção de contradição EM SILÊNCIO. Medido pela
           * segunda passada da auditoria: 73 motoristas na planilha contra 95
           * no cadastro saíam como conclusão populacional, confiança alta,
           * rodapé VAZIO.
           *
           * Não dá para resolver isso comparando strings melhor: qualquer
           * normalização continua sendo um palpite sobre rótulo que ninguém
           * padronizou. O que dá para fazer é o que esta casa já faz com corte
           * de histórico e com cobertura — **declarar a suposição** em vez de
           * agir calado.
           *
           * O QUE DECIDE SE VALE DECLARAR É O QUE A PERGUNTA PEDIU, e este é o
           * único discriminador honesto disponível. Numa pergunta comparativa,
           * dois recortes diferentes com valores diferentes SÃO a resposta —
           * avisar ali seria o ruído que faz o operador parar de ler o rodapé
           * (a primeira versão desta guarda emitia em toda comparação legítima,
           * e a bateria acusou). Numa pergunta que NÃO pediu comparação, dois
           * números diferentes para a mesma métrica são suspeitos, e aí a
           * suposição precisa aparecer.
           */
          if (divergem(a.valor, b.valor)) silenciadas += 1;
          if (divergem(a.valor, b.valor) && tipo !== 'comparativa' && tipo !== 'causal') {
            brigas.push({
              codigo: 'contradicao_entre_fontes',
              gravidade: 'seria',
              texto:
                `${metrica} vale ${a.valor}${a.unidade} em "${rotularRecorte(a)}" (${a.fonte}) e ` +
                `${b.valor}${b.unidade} em "${rotularRecorte(b)}" (${b.fonte}). Tratei como recortes ` +
                'diferentes, não como divergência. Se os dois deviam falar do mesmo período, há um ' +
                'problema de dado que eu não consigo ver daqui.',
              metricas: [metrica],
              teto: null,
            });
          }
          continue;
        }
        if (!divergem(a.valor, b.valor)) continue;
        brigas.push({
          codigo: 'contradicao_entre_fontes',
          gravidade: 'impeditiva',
          texto:
            `Duas fontes discordam sobre ${metrica}: ${a.fonte} diz ${a.valor}${a.unidade} e ` +
            `${b.fonte} diz ${b.valor}${b.unidade}. Enquanto isso não for resolvido eu não tenho ` +
            'um número para te dar — escolher um dos dois seria inventar qual está certo.',
          metricas: [metrica],
          teto: 'nenhum',
        });
      }
    }
  }
  contar(silenciadas);
  return brigas;
}

/** R5 — o dado envelheceu. */
function r5Envelhecido(evidencias: readonly Evidencia[], agora: string): Ressalva[] {
  const velhas = diretas(evidencias)
    .map((e) => ({ e, horas: horasEntre(e.instante, agora) }))
    .filter((x): x is { e: Evidencia; horas: number } =>
      x.horas !== null && x.horas > CONVENCOES_DE_CRITICA.frescor_horas,
    );
  if (velhas.length === 0) return [];
  const maisVelha = velhas.reduce((a, b) => (a.horas >= b.horas ? a : b));
  const obsoleta = maisVelha.horas > CONVENCOES_DE_CRITICA.obsoleto_horas;
  return [
    {
      codigo: 'dado_envelhecido',
      gravidade: obsoleta ? 'seria' : 'leve',
      texto:
        `O dado de ${maisVelha.e.metrica} tem ${Math.round(maisVelha.horas)}h ` +
        `(fonte ${maisVelha.e.fonte}). Pode ter mudado desde então.`,
      metricas: velhas.map((x) => x.e.metrica),
      teto: obsoleta ? 'descritiva' : null,
    },
  ];
}

/** R6 — tudo veio do mesmo lugar; não há confirmação independente. */
function r6FonteUnica(evidencias: readonly Evidencia[], tipo: TipoDeConclusao): Ressalva[] {
  const lista = diretas(evidencias);
  if (lista.length < 2) return [];
  const fontes = new Set(lista.map((e) => e.fonte));
  if (fontes.size > 1) return [];
  if (tipo === 'descritiva' || tipo === 'populacional') return [];
  return [
    {
      codigo: 'fonte_unica',
      gravidade: 'leve',
      texto:
        `Tudo isto veio de uma fonte só (${[...fontes][0]}). Se ela estiver errada, a conclusão ` +
        'inteira erra junto, e eu não tenho como perceber por aqui.',
      metricas: lista.map((e) => e.metrica),
      teto: null,
    },
  ];
}

/**
 * PROCEDÊNCIA QUE NUNCA FOI OBSERVADA — derivada, não medida.
 *
 * A LINHA É "ALGUÉM VIU ISTO EM ALGUM LUGAR?". `resultado_ferramenta`,
 * `documento` e `memoria` foram observados — só não foram conferidos depois, e
 * por isso ganham ressalva e não rebaixamento. `inferencia`, `hipotese` e
 * `desconhecido` nunca existiram fora do raciocínio, e um número deduzido não
 * sustenta afirmação sobre uma população que ele não contou.
 *
 * A distinção nasceu do holdout H05 — custo de manutenção estimado por
 * quilometragem, apresentado como o custo do mês. A primeira versão só rebaixava
 * `hipotese` e `desconhecido`, então `inferencia` passava como conclusão
 * populacional: exatamente "estimativa apresentada como valor confirmado", que a
 * missão proíbe por escrito. Puxar a linha para `!podeAfirmarSemRessalva` teria
 * sido pior no outro sentido — rebaixaria todo turno cuja habilidade devolve
 * `resultado_ferramenta`, e ressalva que aparece sempre deixa de ser lida.
 */
export const DERIVADAS: readonly Procedencia[] = ['inferencia', 'hipotese', 'desconhecido'];

/** R7 — inferência ou hipótese entrando como se fosse medida. */
function r7ProcedenciaFraca(evidencias: readonly Evidencia[]): Ressalva[] {
  const fracas = diretas(evidencias).filter((e) => !podeAfirmarSemRessalva(e.procedencia));
  if (fracas.length === 0) return [];
  const derivadas = fracas.filter((e) => DERIVADAS.includes(e.procedencia));
  return [
    {
      codigo: 'procedencia_fraca',
      gravidade: derivadas.length > 0 ? 'seria' : 'leve',
      texto:
        `Nem tudo aqui é medição: ${fracas.map((e) => `${e.metrica} (${e.procedencia})`).join(', ')}. ` +
        'Estou marcando o que é dedução minha para você não tratar como número apurado.',
      metricas: fracas.map((e) => e.metrica),
      teto: derivadas.length > 0 ? 'descritiva' : null,
    },
  ];
}

/** R8 — os dois lados da comparação não são comparáveis. IMPEDITIVA para comparação. */
function r8DenominadorMovel(evidencias: readonly Evidencia[]): Ressalva[] {
  const porMetrica = new Map<string, Evidencia[]>();
  for (const e of diretas(evidencias)) {
    if (!e.cobertura) continue;
    const lista = porMetrica.get(e.metrica) ?? [];
    lista.push(e);
    porMetrica.set(e.metrica, lista);
  }
  const achadas: Ressalva[] = [];
  for (const [metrica, lista] of porMetrica) {
    if (lista.length < 2) continue;
    for (let i = 0; i < lista.length; i += 1) {
      for (let j = i + 1; j < lista.length; j += 1) {
        const ca = lista[i].cobertura as Cobertura;
        const cb = lista[j].cobertura as Cobertura;
        if (saoComparaveis(ca, cb)) continue;
        achadas.push({
          codigo: 'denominador_movel',
          gravidade: 'seria',
          texto:
            `Os dois lados de ${metrica} não se comparam direito: um saiu de ${ca.consideradas}/${ca.elegiveis} ` +
            `e o outro de ${cb.consideradas}/${cb.elegiveis}. Parte da diferença é variação de quanto eu ` +
            'enxergo, não do que aconteceu.',
          metricas: [metrica],
          teto: 'populacional',
        });
      }
    }
  }
  return achadas;
}

/**
 * R9 — causa exige lastro que dado observacional não dá. IMPEDITIVA para causa.
 *
 * ESTA É A ÚNICA CONTESTAÇÃO QUE DISPARA SEM OLHAR PARA A EVIDÊNCIA, e é
 * deliberado. Este sistema lê planilha e sonda máquina; ele não faz experimento
 * e não tem grupo de controle. Nenhum arranjo de números observados distingue
 * "o pedágio derrubou a margem" de "as duas coisas mudaram no mesmo mês" — e
 * uma regra que tentasse distinguir seria uma heurística com cara de prova, que
 * é pior que a ausência dela.
 *
 * A EXCEÇÃO É REAL, não decorativa: uma evidência `fato_verificado` cuja métrica
 * começa com `intervencao:` significa que alguém MEXEU numa variável e o efeito
 * foi medido depois. Aí existe lastro, e o degrau abre. Hoje nada no catálogo
 * produz isso; o dia em que produzir, a regra já sabe reconhecer.
 *
 * O resultado não é silêncio: é a resposta caindo para `comparativa` — "as duas
 * coisas andaram juntas" — mais a frase do que confirmaria a causa.
 */
function r9CausaSemLastro(evidencias: readonly Evidencia[], tipo: TipoDeConclusao): Ressalva[] {
  if (tipo !== 'causal') return [];
  const intervencao = evidencias.find(
    (e) => e.metrica.startsWith('intervencao:') && e.procedencia === 'fato_verificado',
  );
  if (intervencao) return [];
  return [
    {
      codigo: 'causa_sem_lastro',
      gravidade: 'impeditiva',
      texto:
        'Eu consigo mostrar que essas coisas andaram juntas, não que uma causou a outra — o que eu tenho ' +
        'é observação, não experimento. Para afirmar causa seria preciso mexer na variável suspeita e ' +
        'medir o efeito depois, mantendo o resto igual.',
      metricas: diretas(evidencias).map((e) => e.metrica),
      teto: 'comparativa',
    },
  ];
}

/** R10 — conjunto pequeno demais para o verbo que a conclusão usaria. */
function r10AmostraPequena(evidencias: readonly Evidencia[], tipo: TipoDeConclusao): Ressalva[] {
  if (tipo === 'descritiva') return [];
  const pequenas = diretas(evidencias).filter(
    (e) =>
      e.cobertura !== undefined &&
      e.cobertura.consideradas > 0 &&
      e.cobertura.consideradas < CONVENCOES_DE_CRITICA.amostra_minima,
  );
  if (pequenas.length === 0) return [];
  return [
    {
      codigo: 'amostra_pequena',
      gravidade: 'seria',
      texto:
        `${pequenas.map((e) => `${e.metrica} (${e.cobertura?.consideradas} registro(s))`).join(', ')} — ` +
        'é pouco para eu falar em tendência ou ranking. Com esse tamanho, um registro a mais vira o resultado.',
      metricas: pequenas.map((e) => e.metrica),
      teto: 'descritiva',
    },
  ];
}

// ---------------------------------------------------------------------------
// 5. A crítica
// ---------------------------------------------------------------------------

export interface EntradaDaCritica {
  readonly evidencias: readonly Evidencia[];
  /** O que a análise QUER afirmar. A crítica devolve o que ela PODE. */
  readonly tipo_pretendido: TipoDeConclusao;
  /** ISO 8601 — injetado, nunca lido do relógio. Módulo puro. */
  readonly agora: string;
}

export interface ResultadoDaCritica {
  readonly ressalvas: readonly Ressalva[];
  /** O degrau mais alto que a evidência aguenta. */
  readonly degrau: DegrauSustentado;
  /** O tipo pedido foi rebaixado? */
  readonly rebaixou: boolean;
  /**
   * QUANTAS DIVERGÊNCIAS R4 ENGOLIU por assumir que os recortes eram
   * diferentes — e por que este número não é uma ressalva.
   *
   * O DEFEITO (terceira passada da auditoria independente): a guarda de recorte
   * usa `tipo !== 'comparativa'` como discriminador, e `tipo` vem do NÍVEL. Uma
   * pergunta apenas DECISÓRIA ("devo contratar mais motoristas?") sobe para
   * `gerencial`, que pretende `comparativa` — e cala a detecção. Medido: em
   * quatro de oito redações da mesma pergunta, uma divergência de 73 contra 95
   * saía com confiança ALTA e rodapé VAZIO.
   *
   * O discriminador mede a coisa errada: usa "a pergunta pediu comparação?" como
   * procuração de "estas duas evidências são os dois lados de uma comparação?".
   * O sinal certo mora no rótulo do recorte, que é texto livre por contrato —
   * e enquanto ele for texto livre, nenhuma regra distingue `2026-08` de
   * `agosto/2026` sem adivinhar.
   *
   * O QUE DÁ PARA FAZER SEM ADIVINHAR: parar de sair CARO. Emitir ressalva em
   * toda comparação legítima é o ruído que a segunda tentativa produziu e a
   * bateria acusou. Mas engolir a divergência **e ainda assim dizer "confiança
   * alta"** é a metade perigosa, e essa dá para fechar: uma suposição que eu
   * fiz sobre o dado limita o quanto eu posso me dizer seguro. `Suficiencia`
   * usa este número para travar a confiança em `media`, e a linha de confiança
   * aparece no rodapé — que deixa de ser vazio.
   *
   * RISCO RESIDUAL DECLARADO: a ressalva explícita continua ausente na pergunta
   * comparativa. O conserto de raiz é dar chave canônica a `Recorte`, e ele não
   * cabe nesta rodada.
   */
  readonly divergencias_silenciadas: number;
}

/**
 * Roda as dez contestações e devolve o teto.
 *
 * SEM EVIDÊNCIA NENHUMA O DEGRAU É `nenhum`, e este é o caso mais importante da
 * função: é a pergunta que chegou, nada foi apurado, e a resposta honesta é a
 * abstenção. Devolver `descritiva` num conjunto vazio deixaria a LLM redigir
 * livremente com a bênção da camada analítica — que é o oposto do que ela
 * existe para fazer.
 */
export function criticar(entrada: EntradaDaCritica): ResultadoDaCritica {
  const { evidencias, tipo_pretendido: tipo, agora } = entrada;

  /**
   * NENHUMA EVIDÊNCIA **DIRETA** — e a palavra "direta" é o conserto de um
   * escape que a própria varredura adversarial achou.
   *
   * Oito das dez contestações olham só para `relevancia: 'direta'`, porque
   * `contextual` existe justamente para o que entra no relatório sem entrar no
   * raciocínio (ver `Investigacao.Relevancia`). O buraco: uma habilidade que
   * declarasse TUDO como `contextual` — por descuido ou para escapar da
   * crítica — passava com `R2`, `R3`, `R5`, `R6`, `R7`, `R8` e `R10` todas
   * cegas, e a conclusão saía no degrau pedido.
   *
   * A regra que fecha é a mesma de sempre, dita para outro caso: conclusão
   * precisa de alguma coisa que a sustente. Um conjunto só de contexto não
   * sustenta nada, e o degrau é `nenhum` — exatamente como o conjunto vazio.
   */
  if (diretas(evidencias).length === 0) {
    return {
      ressalvas: [
        {
          codigo: 'procedencia_fraca',
          gravidade: 'impeditiva',
          texto:
            evidencias.length === 0
              ? 'Não apurei nenhuma evidência para sustentar isto.'
              : 'O que eu juntei é contexto, não sustentação: nenhuma evidência fala diretamente sobre a pergunta.',
          metricas: evidencias.map((e) => e.metrica),
          teto: 'nenhum',
        },
      ],
      degrau: 'nenhum',
      rebaixou: true,
      divergencias_silenciadas: 0,
    };
  }

  /**
   * NÚMERO QUE NÃO É NÚMERO — `NaN` e `Infinity` entrando como medida.
   *
   * `0/0` em JavaScript devolve `NaN`, e `NaN` atravessa este motor sem ser
   * notado: toda comparação com ele é falsa, então `divergem` nunca acusa
   * contradição e `zeroEhAusencia` nunca acusa ausência. Uma divisão por zero
   * numa habilidade sairia como "a margem foi NaN%" com procedência `fato` e
   * confiança alta. É a única forma de "inventar número" que o resto das
   * travas não alcança, porque o valor veio de uma fonte legítima.
   */
  const naoFinitas = evidencias.filter((e) => ehNumero(e.valor) && !Number.isFinite(e.valor));
  if (naoFinitas.length > 0) {
    return {
      ressalvas: [
        {
          codigo: 'procedencia_fraca',
          gravidade: 'impeditiva',
          texto:
            `A conta de ${naoFinitas.map((e) => e.metrica).join(', ')} não produziu um número válido ` +
            '(provavelmente uma divisão sem denominador). Não vou apresentar isso como resultado.',
          metricas: naoFinitas.map((e) => e.metrica),
          teto: 'nenhum',
        },
      ],
      degrau: 'nenhum',
      rebaixou: true,
      divergencias_silenciadas: 0,
    };
  }

  let silenciadas = 0;
  const ressalvas = [
    ...r1AusenciaComoZero(evidencias),
    ...r2CoberturaParcial(evidencias),
    ...r3CoberturaNaoDeclarada(evidencias),
    ...r4Contradicao(evidencias, tipo, (n) => { silenciadas = n; }),
    ...r5Envelhecido(evidencias, agora),
    ...r6FonteUnica(evidencias, tipo),
    ...r7ProcedenciaFraca(evidencias),
    ...r8DenominadorMovel(evidencias),
    ...r9CausaSemLastro(evidencias, tipo),
    ...r10AmostraPequena(evidencias, tipo),
  ];

  const degrau = ressalvas.reduce<DegrauSustentado>(
    (teto, r) => (r.teto === null ? teto : menorDegrau(teto, r.teto)),
    tipo,
  );

  return {
    ressalvas,
    degrau,
    rebaixou: altura(degrau) < altura(tipo),
    divergencias_silenciadas: silenciadas,
  };
}

/** Ordena para a resposta: impeditiva primeiro, depois séria, depois leve. */
export function ordenarRessalvas(r: readonly Ressalva[]): Ressalva[] {
  const peso: Record<Gravidade, number> = { impeditiva: 0, seria: 1, leve: 2 };
  return [...r].sort((a, b) => peso[a.gravidade] - peso[b.gravidade]);
}
