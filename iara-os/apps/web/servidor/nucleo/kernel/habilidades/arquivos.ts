/**
 * A FAMÍLIA DE ARQUIVOS — criar com conteúdo, renomear, mover, copiar.
 *
 * POR QUE ELA EXISTE, e a data importa: 20/08/2026, campanha adversarial,
 * missão LC-01. A operadora pediu, em português comum:
 *
 *     "Cria um arquivo chamado notas-1029v1.txt na área de trabalho com o
 *      texto 'reuniao as 10h'."
 *
 * E a IARA respondeu, com toda a razão:
 *
 *     "não tenho ferramenta de criação de arquivo de texto no catálogo:
 *      consigo criar pasta, mas escrever um .txt com conteúdo específico não
 *      está entre o que posso fazer."
 *
 * Aquela recusa foi CORRETA e vale mais que uma função falsa que responde
 * "feito". Mas a auditoria de capacidades classificou a lacuna pelo que ela é:
 * `NOT_IMPLEMENTED` numa família inteira que o produto precisa ter. Este
 * arquivo a fecha.
 *
 * ================= AS REGRAS, HERDADAS E NÃO INVENTADAS =================
 *
 * Cada verbo aqui copia a disciplina de `criarPasta`, deliberadamente. Um verbo
 * novo que inventa as próprias regras é exatamente por onde a allowlist de
 * locais vira decoração:
 *
 *   NOME, NUNCA CAMINHO. Três locais nomeados, e o nome validado por
 *   `validarNomeArquivo` — que recusa barra, contrabarra, `..`, unidade (`C:`),
 *   nome reservado do Windows e extensão executável.
 *
 *   A PONTE, NUNCA A CHAMADA DIRETA. Tudo atravessa o Braço, porque o disco do
 *   processo não é o disco do operador desde que o motor foi para a nuvem.
 *
 *   A PROVA VEM DO DISCO. `verificar` nunca lê o texto que `executar`
 *   devolveu — conferir o relato com o relato é o vício que a quinta porta
 *   existe para impedir.
 *
 * ================= O QUE FICA DE FORA, E POR QUÊ =================
 *
 * `excluir_arquivo` NÃO está aqui. É o único verbo desta família cujo erro não
 * tem volta, e ele pertence à classe de `acionar_energia`: risco alto e
 * confirmação prévia do operador. Desenho que se decide com o dono do produto,
 * não junto de quatro verbos reversíveis.
 */

import type { Habilidade } from '../Habilidade';
import { agenteLocal, ROTULO_DO_LOCAL, type LocalAutorizado } from '../../AgenteLocal';
import { braco } from '../../Braco';
import { provaDaPonte } from './agenteLocal';

/* Os mesmos três locais de `agenteLocal.ts`, derivados do rótulo — nunca uma
   segunda lista escrita à mão, que é como as duas divergem. */
const LOCAIS = Object.keys(ROTULO_DO_LOCAL) as LocalAutorizado[];

const local = (v: unknown): LocalAutorizado => String(v) as LocalAutorizado;

export const criarArquivo: Habilidade = {
  manifesto: {
    id: 'criar_arquivo',
    nome: 'Criar arquivo',
    descricao:
      'Cria um arquivo de texto com o conteúdo que o operador ditou, em um local autorizado ' +
      '(Área de Trabalho, Documentos ou Downloads). Não aceita caminho livre e não escreve ' +
      'programa executável. Não sobrescreve: arquivo que já existe é recusado com o nome dito.',
    exemplos: [
      'Cria um arquivo notas.txt na área de trabalho com o texto reunião às 10h',
      'Salva um arquivo lista.md nos documentos com os três pontos que combinamos',
    ],
    capacidades: ['criar arquivo de texto com conteúdo em local autorizado'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 15_000,
    custo: 'zero',
    risco: 'medio',
    /**
     * IDEMPOTENTE porque a segunda chamada NÃO cria outro nem sobrescreve: ela
     * encontra o arquivo e recusa. É a mesma convergência de `criar_pasta`, e
     * ela nasce do `flag: 'wx'`, não de sorte.
     */
    idempotencia: 'escrita_idempotente',
    esquema: {
      nome: { tipo: 'texto', obrigatorio: true },
      conteudo: { tipo: 'texto', obrigatorio: true },
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'criar_arquivo',
      parametros: {
        nome: String(ctx.parametros.nome),
        conteudo: String(ctx.parametros.conteudo),
        local: String(ctx.parametros.local),
      },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `criar_arquivo em ${ctx.parametros.local} [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'criar_arquivo', () =>
      agenteLocal.provaDoArquivo(
        String(ctx.parametros.nome),
        local(ctx.parametros.local),
        Buffer.byteLength(String(ctx.parametros.conteudo), 'utf8'),
      ),
    );
  },
};

export const renomearArquivo: Habilidade = {
  manifesto: {
    id: 'renomear_arquivo',
    nome: 'Renomear arquivo',
    descricao:
      'Troca o nome de um arquivo dentro do mesmo local autorizado. Recusa se já existir outro ' +
      'com o nome novo — não sobrescreve nada.',
    exemplos: [
      'Renomeia notas.txt para reuniao.txt na área de trabalho',
      'Troca o nome de lista.md para pendencias.md nos documentos',
    ],
    capacidades: ['renomear arquivo em local autorizado'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 10_000,
    custo: 'zero',
    risco: 'medio',
    /**
     * NÃO IDEMPOTENTE, e a diferença de `criar_arquivo` é real: repetir depois
     * do sucesso não encontra mais a origem e devolve recusa. O estado final é
     * o mesmo, mas o caminho até ele não é convergente — e classificar isto
     * como idempotente ensinaria o retry a achar que pode repetir à vontade.
     */
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      nome: { tipo: 'texto', obrigatorio: true },
      nome_novo: { tipo: 'texto', obrigatorio: true },
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'renomear_arquivo',
      parametros: {
        nome: String(ctx.parametros.nome),
        nome_novo: String(ctx.parametros.nome_novo),
        local: String(ctx.parametros.local),
      },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `renomear_arquivo em ${ctx.parametros.local} [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
  async verificar(_resultado, ctx) {
    /* DUAS pontas: o novo existe E o antigo sumiu. Conferir só o novo daria
       sucesso a uma cópia que deixou o original para trás. */
    return provaDaPonte(ctx, 'renomear_arquivo', () => {
      const chegou = agenteLocal.provaDoArquivo(
        String(ctx.parametros.nome_novo),
        local(ctx.parametros.local),
      );
      if (!chegou.confirmado) return chegou;
      return agenteLocal.provaDeAusencia(String(ctx.parametros.nome), local(ctx.parametros.local));
    });
  },
};

export const moverArquivo: Habilidade = {
  manifesto: {
    id: 'mover_arquivo',
    nome: 'Mover arquivo',
    descricao:
      'Move um arquivo entre os locais autorizados (Área de Trabalho, Documentos, Downloads). ' +
      'Recusa se já existir um com o mesmo nome no destino.',
    exemplos: [
      'Move notas.txt da área de trabalho para os documentos',
      'Leva o relatorio.md para a pasta de downloads',
    ],
    capacidades: ['mover arquivo entre locais autorizados'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 20_000,
    custo: 'zero',
    risco: 'medio',
    idempotencia: 'escrita_nao_idempotente',
    esquema: {
      nome: { tipo: 'texto', obrigatorio: true },
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
      local_destino: { tipo: 'texto', padrao: 'documentos', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'mover_arquivo',
      parametros: {
        nome: String(ctx.parametros.nome),
        local: String(ctx.parametros.local),
        local_destino: String(ctx.parametros.local_destino),
      },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `mover_arquivo ${ctx.parametros.local}→${ctx.parametros.local_destino} [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
  async verificar(_resultado, ctx) {
    return provaDaPonte(ctx, 'mover_arquivo', () => {
      const chegou = agenteLocal.provaDoArquivo(
        String(ctx.parametros.nome),
        local(ctx.parametros.local_destino),
      );
      if (!chegou.confirmado) return chegou;
      return agenteLocal.provaDeAusencia(String(ctx.parametros.nome), local(ctx.parametros.local));
    });
  },
};

export const copiarArquivo: Habilidade = {
  manifesto: {
    id: 'copiar_arquivo',
    nome: 'Copiar arquivo',
    descricao:
      'Copia um arquivo entre os locais autorizados, deixando o original onde estava. ' +
      'Recusa se já existir um com o mesmo nome no destino.',
    exemplos: [
      'Copia notas.txt da área de trabalho para os documentos',
      'Faz uma cópia do relatorio.md nos downloads',
    ],
    capacidades: ['copiar arquivo entre locais autorizados'],
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['escrita'],
    timeout_ms: 20_000,
    custo: 'zero',
    risco: 'medio',
    /* IDEMPOTENTE: a segunda chamada encontra a cópia e recusa, sem destruir
       nada — o `COPYFILE_EXCL` é o que garante isso, e não a intenção. */
    idempotencia: 'escrita_idempotente',
    esquema: {
      nome: { tipo: 'texto', obrigatorio: true },
      local: { tipo: 'texto', padrao: 'area_de_trabalho', dentre: LOCAIS },
      local_destino: { tipo: 'texto', padrao: 'documentos', dentre: LOCAIS },
    },
  },
  async executar(ctx) {
    const relato = await braco.executar({
      acao: 'copiar_arquivo',
      parametros: {
        nome: String(ctx.parametros.nome),
        local: String(ctx.parametros.local),
        local_destino: String(ctx.parametros.local_destino),
      },
      id_usuario: ctx.id_usuario,
      sessao: ctx.sessao,
      chave_idempotencia: ctx.operacao?.id_operacao,
    });
    return {
      texto: relato.texto,
      detalhe: `copiar_arquivo ${ctx.parametros.local}→${ctx.parametros.local_destino} [${relato.execucao_id}] ${relato.estado}`,
      resolveu: relato.estado === 'sucesso',
    };
  },
  async verificar(_resultado, ctx) {
    /* Os DOIS presentes. Se o original sumiu, isto foi um `mover` disfarçado e
       a verificação tem de acusar em vez de aplaudir. */
    return provaDaPonte(ctx, 'copiar_arquivo', () => {
      const chegou = agenteLocal.provaDoArquivo(
        String(ctx.parametros.nome),
        local(ctx.parametros.local_destino),
      );
      if (!chegou.confirmado) return chegou;
      return agenteLocal.provaDoArquivo(String(ctx.parametros.nome), local(ctx.parametros.local));
    });
  },
};

/** A família inteira, na ordem em que a operadora as usaria. */
export const HABILIDADES_ARQUIVOS: readonly Habilidade[] = [
  criarArquivo,
  renomearArquivo,
  moverArquivo,
  copiarArquivo,
];
