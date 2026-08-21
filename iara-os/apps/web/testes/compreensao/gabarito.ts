/**
 * O GABARITO — o que estas frases SIGNIFICAM, escrito por quem conhece a
 * operação, sem consultar a implementação.
 *
 * A REGRA QUE FAZ ESTE ARQUIVO VALER ALGUMA COISA: nada aqui foi gerado pelo
 * sistema que ele mede. O circuito proibido é
 *
 *     IARA interpreta → IARA produz o esperado → IARA compara consigo → passa
 *
 * e ele não é uma preocupação teórica: um gabarito derivado da implementação
 * fica verde por construção, exatamente como o "0 contornos" que este
 * repositório já pagou para descobrir que era vácuo.
 *
 * O QUE SE ESCREVE AQUI e o que NÃO se escreve. Cada caso fixa só as dimensões
 * que um humano consegue afirmar lendo a frase — `ato`, `operacao`, `objeto`,
 * `referente`. O `objetivo` (qual habilidade do catálogo responde) fica de fora
 * de propósito na maioria dos casos: ele depende de o catálogo TER a capacidade,
 * que é outra pergunta, e travá-lo aqui faria este arquivo ficar vermelho quando
 * alguém acrescentasse uma habilidade legítima.
 *
 * `undefined` numa dimensão = "não afirmo nada sobre isto". O teste não a olha.
 */

import type {
  AtoComunicativo,
  Operacao,
} from '../../servidor/nucleo/kernel/CompreensaoSemantica';

export interface CasoDeCompreensao {
  readonly frase: string;
  /** Por que um humano lê assim. Sai na mensagem de falha. */
  readonly porque: string;
  readonly ato?: AtoComunicativo;
  readonly operacao?: Operacao | null;
  readonly objeto?: string | null;
  /** Comparado contra o CONCEITO canonico do referente, nao contra o literal. */
  readonly referente?: string | null;
  /** Quando o catálogo TEM a habilidade certa e ela é inequívoca. */
  readonly objetivo?: string;
}

// ---------------------------------------------------------------------------
// EQUIVALÊNCIA — formas diferentes, mesma operação semântica
// ---------------------------------------------------------------------------

/**
 * O ATO DIFERE E A OPERAÇÃO NÃO. É o par que justifica as duas dimensões
 * existirem separadas: « lista os arquivos » manda, « quais arquivos existem? »
 * pergunta, e as duas querem a mesma resposta. Um sistema com uma dimensão só
 * teria de escolher entre perder a diferença ou perder a igualdade.
 */
export const EQUIVALENTES: readonly (readonly CasoDeCompreensao[])[] = [
  [
    { frase: 'lista os arquivos', porque: 'imperativo de leitura sobre arquivo', operacao: 'leitura', objeto: 'arquivo' },
    { frase: 'me mostra os arquivos', porque: 'mesma leitura, verbo diferente', operacao: 'leitura', objeto: 'arquivo' },
    { frase: 'quais arquivos existem?', porque: 'mesma leitura, na forma de pergunta', operacao: 'leitura', objeto: 'arquivo' },
    { frase: 'olha os arquivos pra mim', porque: 'mesma leitura, registro informal', operacao: 'leitura', objeto: 'arquivo' },
  ],
  [
    { frase: 'quantas cargas foram coletadas essa semana?', porque: 'contagem sobre carga', operacao: 'contagem', objeto: 'carga' },
    { frase: 'quantas cargas tivemos essa semana?', porque: 'mesma contagem', operacao: 'contagem', objeto: 'carga' },
    { frase: 'qual o total de cargas dessa semana?', porque: '"total de" é quantificador', operacao: 'contagem', objeto: 'carga' },
  ],
  [
    { frase: 'manda um whatsapp pro João', porque: 'envio a terceiro', operacao: 'envio' },
    { frase: 'avisa o João no zap', porque: 'mesmo envio, gíria', operacao: 'envio' },
    { frase: 'envia uma mensagem pro João no whatsapp', porque: 'mesmo envio', operacao: 'envio' },
  ],
];

// ---------------------------------------------------------------------------
// DISTINÇÃO — os casos mínimos da ordem de 21/08/2026
// ---------------------------------------------------------------------------

/**
 * A FRONTEIRA QUE ESTA CAMADA EXISTE PARA PROTEGER: ler não é escrever.
 *
 * Antes desta fase, « lista os arquivos da área de trabalho » caía em
 * `criar_arquivo` — o substantivo decidia sozinho e o verbo era descartado.
 * O erro não é de ranking: é de representação. Uma leitura que vira escrita no
 * disco do operador é o defeito mais caro que este pipeline pode ter.
 */
export const DISTINTOS: readonly CasoDeCompreensao[] = [
  {
    frase: 'lista os arquivos da área de trabalho',
    porque: 'LEITURA — o verbo manda, o local é restrição',
    ato: 'solicitar_acao',
    operacao: 'leitura',
    objeto: 'arquivo',
    objetivo: 'listar_arquivos',
  },
  {
    frase: 'cria um arquivo na área de trabalho',
    porque: 'CRIAÇÃO — mesmo objeto, verbo oposto',
    ato: 'solicitar_acao',
    operacao: 'criacao',
    objeto: 'arquivo',
    objetivo: 'criar_arquivo',
  },
  {
    frase: 'esse arquivo foi criado quando?',
    porque:
      'CONSULTA DE METADADO — "criado" é particípio numa pergunta, descreve estado; ' +
      'tratá-lo como operação pedida é o defeito que enfiava lembrete na agenda de quem só perguntou',
    ato: 'perguntar',
    operacao: 'leitura',
    objeto: 'arquivo',
  },
  {
    frase: 'analisa os arquivos da área de trabalho',
    porque: 'ANÁLISE — nem leitura simples, nem escrita',
    ato: 'solicitar_acao',
    operacao: 'analise',
    objeto: 'arquivo',
  },
  {
    frase: 'não, cancela isso',
    porque: 'CANCELAMENTO — ato de fechamento, e o alvo não está na frase',
    ato: 'cancelar',
    referente: 'desconhecido',
  },
  {
    frase: 'como você está?',
    porque:
      'CONVERSA — interrogativa na forma, sem objeto de domínio, sem operação e sem tempo; ' +
      'sintaxe não é proxy de intenção',
    ato: 'conversar',
    operacao: null,
    objeto: null,
  },
  {
    frase: 'estou livre amanhã?',
    porque:
      'CONSULTA — interrogativa como a anterior, e com PERÍODO; é o traço que as separa',
    ato: 'perguntar',
  },
  {
    frase: 'e aquele segundo?',
    porque: 'REFERÊNCIA CONTEXTUAL — elipse anafórica, sem conteúdo próprio',
    ato: 'continuar',
    referente: 'desconhecido',
  },
];

// ---------------------------------------------------------------------------
// PARES QUE NÃO PODEM COLAPSAR
// ---------------------------------------------------------------------------

export interface ParDistinto {
  readonly a: string;
  readonly b: string;
  readonly dimensao: 'ato' | 'operacao' | 'objetivo';
  readonly porque: string;
}

/**
 * O LADO QUE IMPEDE "ROBUSTO DEMAIS". Uma camada que casasse tudo com tudo
 * faria a taxa de equivalência ir a 100% e destruiria o produto.
 */
export const NAO_COLAPSAM: readonly ParDistinto[] = [
  {
    a: 'lista os arquivos da área de trabalho',
    b: 'cria um arquivo na área de trabalho',
    dimensao: 'operacao',
    porque: 'ler não é escrever — a fronteira mais cara do pipeline',
  },
  {
    a: 'quais lembretes eu tenho?',
    b: 'me lembre de ligar para o cliente em 20 minutos',
    dimensao: 'operacao',
    porque: 'consultar o que foi marcado não é marcar coisa nova',
  },
  {
    a: 'esse arquivo foi criado quando?',
    b: 'cria um arquivo na área de trabalho',
    dimensao: 'operacao',
    porque: 'perguntar sobre criação não é pedir criação',
  },
  {
    a: 'como você está?',
    b: 'estou livre amanhã?',
    dimensao: 'ato',
    porque: 'as duas são interrogativas e só uma é consulta operacional',
  },
  {
    a: 'leia meus emails recentes',
    b: 'manda um whatsapp pro João',
    dimensao: 'operacao',
    porque: 'ler a própria caixa não é alcançar terceiro',
  },
  {
    a: 'renomeia notas.txt para reuniao.txt',
    b: 'cria um arquivo notas.txt',
    dimensao: 'operacao',
    porque: 'alterar o que existe não é criar do nada',
  },
];
