/**
 * A CAMADA SEMÂNTICA NÃO É UMA LISTA DE FRASES QUE CRESCE.
 *
 * A ORDEM DE 21/08/2026 PROÍBE EM UMA LINHA: *"Não transforme isso em 155
 * regexes → 300 regexes."* Uma proibição sem detector é um comentário — e este
 * repositório já viu um cabeçalho afirmar em maiúsculas *"A REGRA É GERAL"* sobre
 * uma alternação de seis substantivos escritos à mão, medida depois armando em
 * duas de doze perguntas legítimas.
 *
 * A PERGUNTA QUE SEPARA UM LÉXICO DE UMA LISTA DE FRASES, e que estes testes
 * respondem com código rodando:
 *
 *     habilidade nova, ou formulação nova, obriga a editar `CompreensaoSemantica.ts`?
 *
 * Se a resposta for sim, a camada regrediu para o anti-padrão, por mais bem
 * escrita que esteja. Se for não, a tabela de verbos que ela tem dentro é o que
 * ela diz ser: um léxico do português, ortogonal ao produto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { compreender, operacaoDaHabilidade } from '../../servidor/nucleo/kernel/CompreensaoSemantica';
import { DescobertaCapacidades } from '../../servidor/nucleo/kernel/DescobertaCapacidades';
import type { ManifestoHabilidade } from '../../servidor/nucleo/kernel/Habilidade';
import { CATALOGO } from '../../servidor/nucleo/kernel/habilidades';

const MANIFESTOS = CATALOGO.map((h) => h.manifesto);
const AGORA = new Date('2026-08-19T10:00:00');

/** Só o CÓDIGO — comentário citando domínio é documentação, não acoplamento. */
const CODIGO = readFileSync(
  path.join(process.cwd(), 'servidor/nucleo/kernel/CompreensaoSemantica.ts'),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

// ---------------------------------------------------------------------------
// 1. Habilidade nova nasce classificada, sem tocar no módulo
// ---------------------------------------------------------------------------

const falsa = (id: string, descricao: string, exemplo: string): ManifestoHabilidade =>
  ({
    id,
    nome: id.replace(/_/g, ' '),
    descricao,
    exemplos: [exemplo],
    capacidades: [],
    esquema: {},
    risco: 'baixo',
  }) as unknown as ManifestoHabilidade;

/**
 * UM DOMÍNIO QUE NÃO EXISTE NESTE PRODUTO. "contêiner" e "lacre" não aparecem em
 * manifesto nenhum da Atos Log, e por isso servem: se a camada os entender, ela
 * entendeu pela ESTRUTURA — verbo + objeto — e não porque alguém a ensinou.
 */
const CATALOGO_NOVO: readonly ManifestoHabilidade[] = [
  ...MANIFESTOS,
  falsa('listar_conteineres', 'Lista os contêineres no pátio.', 'Quais contêineres estão no pátio?'),
  falsa('criar_conteiner', 'Registra um contêiner novo no pátio.', 'Registra um contêiner novo'),
  falsa('cancelar_lacre', 'Cancela um lacre emitido.', 'Cancela o lacre do contêiner'),
];

test('habilidade nova é classificada pelo `id`, sem editar a camada', () => {
  /**
   * O invariante de nomenclatura do CLAUDE.md — *"Verbo + objeto, em português"* —
   * é o que torna isto possível, e é por isso que a operação sai do `id` em vez
   * de uma tabela por habilidade.
   */
  assert.equal(operacaoDaHabilidade('listar_conteineres'), 'leitura');
  assert.equal(operacaoDaHabilidade('criar_conteiner'), 'criacao');
  assert.equal(operacaoDaHabilidade('cancelar_lacre'), 'remocao');
});

test('frase sobre domínio que a camada nunca viu é interpretada corretamente', () => {
  const descoberta = new DescobertaCapacidades(CATALOGO_NOVO);
  const habilidades = CATALOGO_NOVO.map((m) => m.id);
  const ler = (bruto: string) => compreender({ bruto, descoberta, agora: AGORA, habilidades });

  const leitura = ler('lista os contêineres do pátio');
  assert.equal(leitura.operacao, 'leitura');
  assert.equal(leitura.objetivo, 'listar_conteineres', 'a habilidade nova tem que ser alcançada');

  const criacao = ler('registra um contêiner novo');
  assert.equal(criacao.operacao, 'criacao');

  /**
   * A METADE QUE PROTEGE: mesmo objeto, verbos opostos, contratos diferentes —
   * num domínio para o qual ninguém escreveu uma linha de código.
   */
  assert.notEqual(
    leitura.operacao,
    criacao.operacao,
    'ler contêiner e criar contêiner não podem ser a mesma coisa num domínio novo',
  );
});

test('formulação nova da mesma intenção não exige edição', () => {
  const descoberta = new DescobertaCapacidades(CATALOGO_NOVO);
  const habilidades = CATALOGO_NOVO.map((m) => m.id);
  const ler = (bruto: string) => compreender({ bruto, descoberta, agora: AGORA, habilidades });

  /** Quatro jeitos de pedir a mesma coisa; nenhum está escrito em lugar nenhum. */
  for (const f of [
    'me mostra os contêineres',
    'quais contêineres existem?',
    'olha os contêineres pra mim',
    'exibe os contêineres do pátio',
  ]) {
    assert.equal(ler(f).operacao, 'leitura', `« ${f} » tinha que ser leitura`);
  }
});

// ---------------------------------------------------------------------------
// 2. O módulo não conhece o produto
// ---------------------------------------------------------------------------

test('nenhum substantivo do domínio aparece no CÓDIGO da camada', () => {
  /**
   * O DETECTOR DO ANTI-PADRÃO. No dia em que alguém "consertar uma frase" aqui,
   * vai fazer isso escrevendo `carga`, `lembrete` ou `whatsapp` no meio de uma
   * alternação — e este teste fica vermelho apontando a palavra.
   *
   * A correção certa, quando isso acontecer, nunca é acrescentar a palavra a uma
   * exceção: é o manifesto declarar o que faltava, ou a estrutura ganhar a
   * dimensão que não tinha. Foi assim que o verbo entrou nesta camada.
   */
  /**
   * NEM TUDO QUE ESTÁ NUM `id` É DOMÍNIO, e a primeira versão deste teste
   * confundiu as duas coisas. As três exclusões abaixo são justificadas uma a
   * uma — uma lista de exceções sem motivo por item seria o mesmo afrouxamento
   * que o teste existe para pegar.
   */
  const NAO_SAO_DOMINIO = new Set([
    // `enviar_para_agente_codigo`: preposição, não substantivo.
    'para',
    // `extrair_texto_documento`: "texto" é o tipo do dado em toda a base de
    // código (`bruto: string`, `texto: string`), não um objeto da operação.
    'texto',
    // `resolver_confirmacao`: confirmação é ATO DE DIÁLOGO, e ato de diálogo é
    // exatamente o assunto desta camada. Proibi-la aqui seria proibir a camada
    // de fazer o que ela existe para fazer.
    'confirmacao',
  ]);

  const doDominio = [
    ...new Set(
      MANIFESTOS.flatMap((m) => [...(m.entidades ?? []), ...m.id.split('_').slice(1)]).filter(
        (p) =>
          p.length >= 4 &&
          !NAO_SAO_DOMINIO.has(p) &&
          /**
           * PALAVRA QUE NOMEIA UMA OPERAÇÃO NÃO É VOCABULÁRIO DE DOMÍNIO.
           *
           * `executar_consulta_sql` põe "consulta" na lista de partes de `id`, e
           * a camada legitimamente contém `consultar` — o verbo canônico da
           * operação `leitura`, uma das oito entradas de `VERBO_CANONICO`.
           * Acusar isso obrigaria a camada a batizar suas operações com palavras
           * que o catálogo nunca use, que é ceder a arquitetura ao teste.
           *
           * A regra é a mesma que classifica habilidade: se o classificador de
           * verbos lê a palavra, ela é operação, não assunto.
           */
          operacaoDaHabilidade(p) === null,
      ),
    ),
  ];
  assert.ok(doDominio.length > 10, 'o teste tem que estar lendo vocabulário de verdade');

  /**
   * A BUSCA É NOS LITERAIS, e a distinção custou uma rodada vermelha.
   *
   * O detector acusou `origem` — porque `origem` é entidade da planilha LUFT (o
   * posto de onde a carga sai) E é o nome do campo que diz de onde veio a
   * ligação palavra→conceito. São homônimos, e só um deles é acoplamento.
   *
   * Um IDENTIFICADOR com nome de substantivo comum é estrutura. Uma regra
   * léxica sobre um domínio só pode existir dentro de uma STRING ou de uma
   * REGEX — é lá que uma palavra vira condição. Procurar no código inteiro
   * pega o nome de um campo e ensina quem escreve a batizar mal as coisas para
   * não acordar o teste, que é pior que não ter teste.
   */
  const literais = [
    ...CODIGO.matchAll(/'([^'\\]*)'/g),
    ...CODIGO.matchAll(/"([^"\\]*)"/g),
    ...CODIGO.matchAll(/\/([^/\n]{2,})\/[gimsuy]*/g),
  ]
    .map((m) => m[1])
    .join(' | ');

  const encontrados = doDominio.filter((p) => new RegExp(`\\b${p}`, 'i').test(literais));
  assert.deepEqual(
    encontrados,
    [],
    `vocabulário de domínio no código da camada semântica: ${encontrados.join(', ')}.\n` +
      `    A camada tem de funcionar para habilidade que ainda não existe. Palavra de ` +
      `domínio aqui dentro é a lista crescente de formulações que a ordem proíbe.`,
  );
});

test('o léxico verbal é pequeno e fechado', () => {
  /**
   * Não é um número mágico: é um TETO com significado. O português tem algumas
   * centenas de verbos de uso corrente e oito operações; uma tabela que passe
   * disso deixou de ser léxico e virou catálogo disfarçado. Se um dia estourar
   * legitimamente, o que se discute é a régua — não se sobe o número em silêncio.
   */
  const radicais = [...CODIGO.matchAll(/'([a-z]{2,12})'/g)].length;
  assert.ok(
    radicais < 400,
    `a camada tem ${radicais} literais de string; acima disso ela virou lista, não léxico`,
  );
});
