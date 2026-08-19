/**
 * OCORRÊNCIA — o que aconteceu no mundo, antes de alguém decidir se importa.
 *
 * Esta é a única forma pela qual um fato entra na camada proativa. Detector
 * nenhum fala com o operador; ele produz uma ocorrência, e a ocorrência é
 * julgada. A separação existe porque a pergunta "isto aconteceu?" e a pergunta
 * "isto merece interromper alguém?" têm respostas diferentes, donos diferentes e
 * modos de errar diferentes — misturá-las é como nasce o alarme que ninguém lê.
 *
 * ---------------------------------------------------------------------------
 * A REGRA QUE GOVERNA O ARQUIVO INTEIRO
 * ---------------------------------------------------------------------------
 *
 *   **O conteúdo de uma ocorrência é DADO, nunca instrução.**
 *
 * Nada que venha no texto — resumo, evidência, nome de fonte — pode mudar a
 * severidade, a confiança, o destinatário ou a decisão. Os campos que a política
 * lê são todos ENUMERADOS e validados contra a lista fechada; o texto livre só
 * alcança a frase que o operador vai ler, e mesmo aí passa por saneamento e
 * redação de segredo.
 *
 * Isto não é paranoia sobre um futuro hipotético. É a mesma lição que
 * `Percepcao.citado` já carrega para a mensagem do operador: preservar QUEM
 * DISSE, não só O QUE FOI DITO. No dia em que uma ocorrência nascer de uma
 * página web ou de um webhook — e é para isso que `origem` existe —, a única
 * coisa que separa "a fonte relatou X" de "a fonte mandou a IARA fazer X" é esta
 * fronteira estar escrita em código, e não na boa-fé de quem escrever o detector.
 *
 * ---------------------------------------------------------------------------
 * POR QUE A NORMALIZAÇÃO RECUSA EM VEZ DE CONSERTAR
 * ---------------------------------------------------------------------------
 *
 * A tentação é sanear tudo: severidade desconhecida vira `leve`, campo a mais é
 * descartado, assunto malformado é aparado. Saneamento é uma função que PERDE
 * INFORMAÇÃO, e o que se perde aqui é a evidência de que alguém produziu uma
 * ocorrência errada. Um detector que emite `severidade: 'critica'` está quebrado
 * ou está sendo forjado; nas duas leituras a resposta certa é recusar alto e
 * claro, não traduzir para o valor mais próximo e seguir.
 *
 * É a mesma decisão de `Identidade.exigirIdCanonico` — barrar em vez de mutilar —
 * e de `Habilidade.validar`, que recusa parâmetro não declarado em vez de
 * ignorá-lo.
 */

import { createHash } from 'node:crypto';
import type { Confianca, Severidade } from '../kernel/Investigacao';
import { normalizar } from '../texto';

/**
 * As famílias de ocorrência que a IARA reconhece HOJE.
 *
 * Lista deliberadamente curta. Cada tipo aqui tem um detector real produzindo-o
 * com dado real; nenhum existe "para o dia em que precisarmos". Acrescentar um
 * tipo é uma linha — o custo de manter um tipo que ninguém emite é um catálogo
 * que mente sobre o que o sistema percebe.
 */
export const TIPOS_OCORRENCIA = [
  /** Uma métrica saiu da faixa normal. Hoje: o vigia medindo a máquina. */
  'operacao.anomalia',
  /** Algo que a IARA tentou fazer falhou de um jeito que se repete. */
  'operacao.falha',
  /** O sistema está pior do que estava, sem ter falhado ainda. */
  'sistema.degradacao',
  /** Um procedimento repetido o bastante para valer perguntar se automatiza. */
  'automacao.oportunidade',
  /** Um dado que a IARA leu contradiz outro que ela também leu. */
  'dado.inconsistente',
] as const;

export type TipoOcorrencia = (typeof TIPOS_OCORRENCIA)[number];

/**
 * QUEM VIU. Não é decoração de log: é o que permite, mais tarde, dar peso
 * diferente a uma ocorrência conforme quem a produziu — exatamente como
 * `Verdade.Procedencia` faz com afirmações.
 *
 * `externa` existe e não tem produtor hoje. Está aqui porque a validação precisa
 * de uma lista fechada, e porque o dia em que existir uma fonte externa a
 * distinção entre ela e um detector interno tem de ser um campo, não um
 * comentário.
 */
export const ORIGENS_OCORRENCIA = ['vigia', 'jornal', 'kernel', 'externa'] as const;
export type OrigemOcorrencia = (typeof ORIGENS_OCORRENCIA)[number];

/**
 * O QUE A IARA ESTÁ AFIRMANDO — e é a diferença entre um assistente e um
 * chute com voz calma.
 *
 * `observado`  eu medi / eu li isto. Há evidência direta.
 * `inferido`   deduzi a partir do que medi. Pode estar errado sem que a medição
 *              esteja.
 * `previsto`   ainda não aconteceu.
 * `desconhecido` não consegui apurar. NUNCA vira afirmação na fala.
 *
 * O exemplo ruim do documento de requisitos — "Seu processo está com problema" —
 * é `inferido` disfarçado de `observado`. O exemplo bom — "Detectei um aumento de
 * 34% nos erros desde 13h. Ainda não determinei a causa" — é `observado` com a
 * lacuna declarada. Este campo é o que torna a diferença verificável.
 */
export const NATUREZAS = ['observado', 'inferido', 'previsto', 'desconhecido'] as const;
export type NaturezaAfirmacao = (typeof NATUREZAS)[number];

/**
 * De onde o fato veio, de um jeito que dê para reconferir.
 *
 * `referencia` é o que permite a alguém — pessoa ou teste — voltar à origem: um
 * caminho de arquivo, um id de operação, uma URL. Uma fonte sem referência é uma
 * citação sem citação, e a IARA não afirma sobre o mundo com isso.
 */
export interface FonteOcorrencia {
  readonly nome: string;
  readonly referencia: string;
  readonly instante: number;
}

export interface Ocorrencia {
  readonly id: string;
  readonly tipo: TipoOcorrencia;
  readonly origem: OrigemOcorrencia;
  readonly instante: number;
  /**
   * A CHAVE DE APRENDIZADO. Estável, curta, em forma de identificador
   * (`memoria_uso`, `cargas_luft`), porque é por ela que a preferência do
   * operador é acumulada ao longo de meses. Um assunto que muda de grafia
   * fragmenta o aprendizado em silêncio — o operador rejeita dez vezes e a
   * relevância nunca cai, porque cada rejeição foi contada num balde diferente.
   */
  readonly assunto: string;
  /** O nome do assunto em português, para a frase e para o casamento com a ficha. */
  readonly rotulo: string;
  /** Uma linha, já legível. Nunca começa com "Olá" e nunca promete nada. */
  readonly resumo: string;
  /** Os fatos que sustentam. Sem interpretação: número, hora, contagem. */
  readonly evidencia: readonly string[];
  readonly confianca: Confianca;
  readonly severidade: Severidade;
  readonly natureza: NaturezaAfirmacao;
  /** Existe algo que a IARA poderia FAZER a respeito, se lhe pedissem? */
  readonly acionavel: boolean;
  /** Duas ocorrências com a mesma chave são o MESMO fato. Ver `Livro`. */
  readonly chave_dedup: string;
  /** Amarra ocorrências que são partes do mesmo acontecimento. `null` = solta. */
  readonly correlacao: string | null;
  /** SEMPRE o dono da sessão. O que vier no payload é ignorado. */
  readonly id_usuario: string;
  /** Depois disto o fato não é mais notícia. `null` = não expira sozinho. */
  readonly expira_em: number | null;
  readonly fontes: readonly FonteOcorrencia[];
}

/** O resultado da normalização. Recusa é um valor, não uma exceção. */
export type LeituraOcorrencia =
  | { readonly ok: true; readonly ocorrencia: Ocorrencia }
  | { readonly ok: false; readonly motivo: string };

const MAX_ASSUNTO = 48;
const MAX_ROTULO = 80;
const MAX_RESUMO = 240;
const MAX_EVIDENCIA_ITENS = 5;
const MAX_EVIDENCIA_TEXTO = 200;
const MAX_FONTES = 5;
const MAX_REFERENCIA = 300;

/**
 * Os campos que uma ocorrência pode declarar. Qualquer outro é recusa.
 *
 * Mesma trava de `Habilidade.validar`, e pela mesma razão: campo não declarado é
 * a porta por onde entra o que ninguém revisou. `id` e `id_usuario` NÃO estão
 * aqui de propósito — quem produz não escolhe nem um nem outro.
 */
const CAMPOS_ACEITOS = new Set([
  'tipo',
  'origem',
  'instante',
  'assunto',
  'rotulo',
  'resumo',
  'evidencia',
  'confianca',
  'severidade',
  'natureza',
  'acionavel',
  'chave_dedup',
  'correlacao',
  'expira_em',
  'fontes',
]);

const SEVERIDADES: readonly Severidade[] = ['leve', 'moderada', 'grave'];
const CONFIANCAS: readonly Confianca[] = ['baixa', 'media', 'alta'];

/**
 * Texto que atravessa a fronteira: sem controle C0, sem espaço duplicado, com
 * teto.
 *
 * O byte nulo e o `\r\n` estão aqui pela mesma razão que estão em
 * `Habilidade.validar`: este texto vai para um `.json` em disco, para um log
 * estruturado e para a tela do operador. Um `\n` no meio de uma linha de log
 * JSON parte o registro em dois — e o segundo pedaço vira uma linha forjada num
 * arquivo que existe para ser auditado.
 */
function texto(bruto: unknown, teto: number): string {
  if (typeof bruto !== 'string') return '';
  return bruto
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, teto);
}

/**
 * O assunto vira identificador. Sem acento, sem espaço, sem maiúscula.
 *
 * Faz a mesma coisa que `Agenda.idSeguro` faz com o id do operador, e pelo mesmo
 * motivo dobrado: além de virar chave de aprendizado, o assunto entra em nome de
 * campo dentro do livro em disco. Um assunto com `.` ou `/` seria uma chave de
 * objeto estranha; um com `__proto__` seria pior.
 */
function assuntoSeguro(bruto: unknown): string {
  if (typeof bruto !== 'string') return '';
  const limpo = normalizar(bruto)
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, MAX_ASSUNTO);
  /**
   * `constructor` e `prototype` viram chave de objeto adiante, e as duas
   * atravessam a classe de caracteres acima INTACTAS — são palavras de letras
   * minúsculas. Num objeto literal, `{}['constructor']` devolve a função
   * `Object` em vez de `undefined`, e a partir daí a aritmética de peso vira
   * `NaN` em silêncio.
   *
   * `__proto__` está na lista por simetria de intenção, e não por necessidade:
   * o saneamento acima já o transforma em `proto`, que é um assunto comum e
   * inofensivo. Manter o nome aqui documenta o que se quis barrar; quem confiar
   * SÓ nesta linha, porém, está confiando numa comparação que nunca dispara —
   * por isso `LivroDeOcorrencias.atencaoDe` usa `Object.hasOwn` e não depende
   * dela.
   */
  if (limpo === '__proto__' || limpo === 'constructor' || limpo === 'prototype') return '';
  return limpo;
}

/**
 * A impressão digital do fato. Duas ocorrências com a mesma chave são a MESMA
 * coisa acontecida — publicada por duas fontes, detectada duas vezes, ou
 * reenviada.
 *
 * Deriva de tipo + assunto + resumo NORMALIZADO. O resumo entra porque "memória
 * em 88%" e "disco em 91%" são fatos diferentes sobre o mesmo assunto; entra
 * normalizado porque duas fontes que relatam a mesma coisa com pontuação
 * diferente não são duas coisas.
 *
 * Quem produz PODE declarar a própria chave, e deve fazê-lo quando conhece a
 * identidade do fato melhor que esta heurística — o detector de repetição, por
 * exemplo, sabe que o fato é "esta assinatura neste patamar", independentemente
 * de como a frase ficou.
 */
export function chaveDe(tipo: string, assunto: string, resumo: string): string {
  return createHash('sha256')
    .update(`${tipo}|${assunto}|${normalizar(resumo)}`)
    .digest('hex')
    .slice(0, 24);
}

/**
 * Lê uma ocorrência bruta e devolve a forma canônica — ou a recusa, com motivo.
 *
 * `dono` vem da SESSÃO. É o mesmo invariante do shard de memória e do lembrete:
 * o operador nunca informa de quem é o dado. Um `id_usuario` no payload é
 * ignorado sem cerimônia, e há teste provando isso, porque "ignorar em silêncio"
 * é a única resposta que não vira oráculo para quem sonda.
 */
export function normalizarOcorrencia(
  bruto: unknown,
  dono: string,
  agora: number,
  novoId: () => string,
): LeituraOcorrencia {
  if (typeof bruto !== 'object' || bruto === null || Array.isArray(bruto)) {
    return { ok: false, motivo: 'ocorrência não é um objeto' };
  }
  const o = bruto as Record<string, unknown>;

  for (const chave of Object.keys(o)) {
    if (!CAMPOS_ACEITOS.has(chave)) {
      return { ok: false, motivo: `campo não declarado: "${chave.slice(0, 40)}"` };
    }
  }

  const tipo = o.tipo;
  if (typeof tipo !== 'string' || !(TIPOS_OCORRENCIA as readonly string[]).includes(tipo)) {
    return { ok: false, motivo: `tipo desconhecido: ${String(tipo).slice(0, 40)}` };
  }

  const origem = o.origem;
  if (typeof origem !== 'string' || !(ORIGENS_OCORRENCIA as readonly string[]).includes(origem)) {
    return { ok: false, motivo: `origem desconhecida: ${String(origem).slice(0, 40)}` };
  }

  const severidade = o.severidade;
  if (typeof severidade !== 'string' || !SEVERIDADES.includes(severidade as Severidade)) {
    return { ok: false, motivo: `severidade fora da escala: ${String(severidade).slice(0, 40)}` };
  }

  const confianca = o.confianca;
  if (typeof confianca !== 'string' || !CONFIANCAS.includes(confianca as Confianca)) {
    return { ok: false, motivo: `confiança fora da escala: ${String(confianca).slice(0, 40)}` };
  }

  const natureza = o.natureza;
  if (typeof natureza !== 'string' || !(NATUREZAS as readonly string[]).includes(natureza)) {
    return { ok: false, motivo: `natureza desconhecida: ${String(natureza).slice(0, 40)}` };
  }

  if (o.acionavel !== undefined && typeof o.acionavel !== 'boolean') {
    return { ok: false, motivo: '"acionavel" deveria ser booleano' };
  }

  const assunto = assuntoSeguro(o.assunto);
  if (!assunto) return { ok: false, motivo: 'assunto vazio ou inválido' };

  const resumo = texto(o.resumo, MAX_RESUMO);
  if (!resumo) return { ok: false, motivo: 'resumo vazio' };

  const rotulo = texto(o.rotulo, MAX_ROTULO) || assunto.replace(/_/g, ' ');

  const evidencia = Array.isArray(o.evidencia)
    ? o.evidencia
        .slice(0, MAX_EVIDENCIA_ITENS)
        .map((e) => texto(e, MAX_EVIDENCIA_TEXTO))
        .filter(Boolean)
    : [];

  /**
   * `natureza: 'observado'` SEM evidência é recusado.
   *
   * É a trava que faz o campo significar alguma coisa. Sem ela, todo detector
   * carimbaria `observado` — é o valor que soa melhor — e a distinção entre o que
   * a IARA mediu e o que ela deduziu viraria enfeite. Quem observou tem o número;
   * quem não tem o número inferiu.
   */
  if (natureza === 'observado' && evidencia.length === 0) {
    return { ok: false, motivo: '"observado" exige ao menos uma evidência' };
  }

  const fontes: FonteOcorrencia[] = Array.isArray(o.fontes)
    ? o.fontes
        .slice(0, MAX_FONTES)
        .map((f) => {
          const bruta = (typeof f === 'object' && f !== null ? f : {}) as Record<string, unknown>;
          return {
            nome: texto(bruta.nome, 80),
            referencia: texto(bruta.referencia, MAX_REFERENCIA),
            instante: typeof bruta.instante === 'number' && Number.isFinite(bruta.instante)
              ? bruta.instante
              : agora,
          };
        })
        .filter((f) => f.nome && f.referencia)
    : [];

  const instante =
    typeof o.instante === 'number' && Number.isFinite(o.instante) ? o.instante : agora;
  const expira =
    typeof o.expira_em === 'number' && Number.isFinite(o.expira_em) ? o.expira_em : null;

  const chaveDeclarada = texto(o.chave_dedup, 64).replace(/[^A-Za-z0-9_.:-]/g, '');

  return {
    ok: true,
    ocorrencia: {
      id: novoId(),
      tipo: tipo as TipoOcorrencia,
      origem: origem as OrigemOcorrencia,
      instante,
      assunto,
      rotulo,
      resumo,
      evidencia,
      confianca: confianca as Confianca,
      severidade: severidade as Severidade,
      natureza: natureza as NaturezaAfirmacao,
      acionavel: o.acionavel === true,
      chave_dedup: chaveDeclarada || chaveDe(tipo, assunto, resumo),
      correlacao: texto(o.correlacao, 64) || null,
      /* O DONO É O DA SESSÃO. Ver o cabeçalho de `normalizarOcorrencia`. */
      id_usuario: dono,
      expira_em: expira,
      fontes,
    },
  };
}

/** Já passou da validade? Fato vencido não interrompe ninguém. */
export function vencida(o: Ocorrencia, agora: number): boolean {
  return o.expira_em !== null && o.expira_em <= agora;
}
