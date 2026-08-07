/**
 * Habilidades de dados: banco, memória corporativa e extração documental.
 *
 * São as três que tocam informação da casa, e por isso as três que mais
 * precisam de trava. Cada uma declara explicitamente por que pode estar
 * indisponível — em vez de falhar no meio de um plano com erro de conexão.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { inflateSync } from 'node:zlib';
import type { Habilidade } from '../Habilidade';
import { supabase } from '../../ClienteSupabase';
import { CONSULTAS, listarConsultas, type SeletorSupabase } from './consultasNomeadas';
import { validar } from '../Habilidade';
import { normalizar } from '../../RoteadorIntencoes';

// ---------------------------------------------------------------------------
// 1. Banco operacional — consultas nomeadas
// ---------------------------------------------------------------------------

export const executarConsultaSql: Habilidade = {
  manifesto: {
    id: 'executar_consulta_sql',
    nome: 'Consulta ao banco operacional',
    descricao:
      `Executa uma consulta PRÉ-APROVADA no banco. Você escolhe pelo nome; não escreve SQL. ` +
      `Consultas disponíveis: ${listarConsultas()}`,
    dominio: 'automacao',
    capacidade: 'automacao',
    permissoes: ['banco'],
    timeout_ms: 6000,
    custo: 'zero',
    esquema: {
      consulta: { tipo: 'texto', obrigatorio: true, dentre: Object.keys(CONSULTAS) },
      // Validado de novo, contra o esquema da consulta escolhida.
      parametros: { tipo: 'texto', padrao: '{}' },
    },
  },

  indisponivelPorque() {
    return supabase() ? null : 'Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).';
  },

  async executar(ctx) {
    const bd = supabase();
    if (!bd) throw new Error('Supabase indisponível');

    const nome = String(ctx.parametros.consulta);
    const definicao = CONSULTAS[nome];
    // Redundante com `dentre` no esquema, e proposital: se alguém afrouxar o
    // esquema um dia, esta linha continua barrando.
    if (!definicao) throw new Error(`consulta não catalogada: ${nome}`);

    // Segunda validação: os parâmetros contra o esquema DA CONSULTA, não da
    // habilidade. É aqui que "uf: DROP" morre.
    let brutos: Record<string, unknown> = {};
    try {
      const cru = ctx.parametros.parametros;
      brutos = typeof cru === 'string' ? (JSON.parse(cru || '{}') as Record<string, unknown>) : {};
    } catch {
      throw new Error('parâmetros da consulta não são JSON válido');
    }
    const parametros = validar(definicao.esquema, brutos);

    const seletor = definicao.montar(
      bd.from(definicao.tabela) as unknown as SeletorSupabase,
      parametros,
    );
    const { data, error } = (await (seletor as unknown as PromiseLike<{
      data: Record<string, unknown>[] | null;
      error: { message: string } | null;
    }>)) as { data: Record<string, unknown>[] | null; error: { message: string } | null };

    if (error) throw new Error(`Supabase: ${error.message}`);
    const linhas = data ?? [];

    return {
      texto: definicao.redigir(linhas, parametros),
      detalhe: `consulta "${nome}" → ${linhas.length} linha(s)`,
      resolveu: linhas.length > 0,
    };
  },
};

// ---------------------------------------------------------------------------
// 2. Memória corporativa
// ---------------------------------------------------------------------------

const RAIZ_DADOS = path.resolve(process.cwd(), 'dados');

/**
 * Índice lexical sobre os documentos internos. Mesma técnica do RAG de
 * incidentes — trigramas com cosseno — e pela mesma razão: determinístico,
 * offline, sem dependência nativa e sem custo por consulta.
 *
 * Honesto sobre o que é: busca lexical, não semântica. Para um corpus de
 * procedimentos internos com vocabulário próprio da casa, isso acerta mais que
 * embedding genérico — "baixa de CT-e" aqui não significa o que significa fora.
 */
function trigramas(texto: string): Map<string, number> {
  const base = ` ${normalizar(texto)} `;
  const m = new Map<string, number>();
  for (let i = 0; i + 3 <= base.length; i += 1) {
    const g = base.slice(i, i + 3);
    m.set(g, (m.get(g) ?? 0) + 1);
  }
  return m;
}

function cosseno(a: Map<string, number>, b: Map<string, number>): number {
  let prod = 0;
  let na = 0;
  let nb = 0;
  for (const p of a.values()) na += p * p;
  for (const [g, p] of b) {
    nb += p * p;
    const o = a.get(g);
    if (o) prod += o * p;
  }
  return na === 0 || nb === 0 ? 0 : prod / (Math.sqrt(na) * Math.sqrt(nb));
}

interface Trecho {
  titulo: string;
  texto: string;
  indice: Map<string, number>;
}

let corpus: Trecho[] | null = null;

async function carregarCorpus(): Promise<Trecho[]> {
  if (corpus) return corpus;
  const bruto = await readFile(path.join(RAIZ_DADOS, 'camada-global.md'), 'utf8').catch(() => '');
  // Quebra por seção: parágrafo isolado perde contexto, documento inteiro
  // afoga o prompt. Seção é a unidade que preserva sentido.
  const secoes = bruto
    .split(/\n(?=#{1,3}\s|---)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 60);

  corpus = secoes.map((s) => {
    const titulo = s.split('\n')[0].replace(/^#+\s*/, '').slice(0, 80);
    return { titulo, texto: s, indice: trigramas(s) };
  });
  return corpus;
}

export const consultarMemoriaCorporativa: Habilidade = {
  manifesto: {
    id: 'consultar_memoria_corporativa',
    nome: 'Memória corporativa',
    descricao:
      'Consulta procedimentos, políticas e vocabulário interno da Atos Log. Use quando a pergunta depende de como A CASA faz algo, não de conhecimento geral.',
    dominio: 'memoria',
    capacidade: 'conhecimento',
    permissoes: ['banco'],
    timeout_ms: 4000,
    custo: 'zero',
    esquema: { consulta: { tipo: 'texto', obrigatorio: true } },
  },

  async executar(ctx) {
    const docs = await carregarCorpus();
    if (docs.length === 0) {
      return {
        texto: 'A base de conhecimento interna está vazia.',
        detalhe: 'camada-global.md sem seções indexáveis',
        resolveu: false,
      };
    }

    const alvo = trigramas(String(ctx.parametros.consulta));
    const achados = docs
      .map((d) => ({ d, s: cosseno(alvo, d.indice) }))
      .filter((a) => a.s > 0.06)
      .sort((x, y) => y.s - x.s)
      .slice(0, 2);

    if (achados.length === 0) {
      return {
        texto: 'Não encontrei nada sobre isso nos documentos internos.',
        detalhe: 'nenhuma seção acima do limiar de similaridade',
        resolveu: false,
      };
    }

    return {
      texto: achados.map((a) => a.d.texto.slice(0, 900)).join('\n\n---\n\n'),
      detalhe: `${achados.length} seção(ões), similaridade máxima ${achados[0].s.toFixed(2)}`,
      resolveu: true,
    };
  },
};

// ---------------------------------------------------------------------------
// 3. Extração de texto de documento
// ---------------------------------------------------------------------------

/**
 * Extrai a CAMADA DE TEXTO de um PDF. Não é OCR.
 *
 * A distinção importa para o caso de uso: CT-e, DACTE e nota fiscal são
 * gerados digitalmente e trazem texto embutido — para esses, isto resolve com
 * custo zero e sem dependência. Documento escaneado é imagem, não tem camada
 * de texto, e aqui devolve isso explicitamente em vez de retornar vazio e
 * deixar o plano seguir achando que leu o arquivo.
 */
function extrairTextoPdf(buffer: Buffer): string {
  const partes: string[] = [];

  // Streams comprimidos (FlateDecode) — o caso comum.
  let posicao = 0;
  while (true) {
    const inicio = buffer.indexOf('stream', posicao);
    if (inicio < 0) break;
    const fim = buffer.indexOf('endstream', inicio);
    if (fim < 0) break;

    let corpo = buffer.subarray(inicio + 6, fim);
    // Pula o CRLF/LF que segue a palavra `stream`.
    let corte = 0;
    while (corte < corpo.length && (corpo[corte] === 0x0d || corpo[corte] === 0x0a)) corte += 1;
    corpo = corpo.subarray(corte);

    try {
      partes.push(inflateSync(corpo).toString('latin1'));
    } catch {
      // Stream não comprimido ou codec não suportado: usa como está.
      partes.push(corpo.toString('latin1'));
    }
    posicao = fim + 9;
  }

  const conteudo = partes.join('\n');
  const texto: string[] = [];

  // Operadores de texto do PDF: (literal) Tj  e  [(a)-(b)] TJ
  for (const m of conteudo.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) texto.push(m[1]);
  for (const m of conteudo.matchAll(/\[((?:[^\][]|\\.)*)\]\s*TJ/g)) {
    for (const p of m[1].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)) texto.push(p[1]);
  }

  return texto
    .join(' ')
    .replace(/\\(\d{3})/g, (_, o: string) => String.fromCharCode(parseInt(o, 8)))
    .replace(/\\([()\\])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export const extrairTextoDocumento: Habilidade = {
  manifesto: {
    id: 'extrair_texto_documento',
    nome: 'Extração de texto de documento',
    descricao:
      'Lê a camada de texto de um PDF gerado digitalmente (CT-e, DACTE, nota fiscal, contrato). NÃO faz OCR de documento escaneado. O caminho é relativo a dados/documentos/.',
    dominio: 'automacao',
    capacidade: 'percepcao',
    permissoes: ['banco'],
    timeout_ms: 12000,
    custo: 'zero',
    esquema: { arquivo: { tipo: 'texto', obrigatorio: true } },
  },

  async executar(ctx) {
    const pedido = String(ctx.parametros.arquivo);
    // Trava de travessia: o nome vem de um plano, e plano pode vir da LLM.
    // `../../.env.local` não pode virar leitura de arquivo.
    const seguro = path.basename(pedido);
    if (!seguro || seguro !== pedido) {
      throw new Error('caminho inválido: informe apenas o nome do arquivo');
    }
    if (!/\.pdf$/i.test(seguro)) {
      throw new Error('só PDF é suportado nesta habilidade');
    }

    const alvo = path.join(RAIZ_DADOS, 'documentos', seguro);
    let buffer: Buffer;
    try {
      buffer = await readFile(alvo);
    } catch {
      return {
        texto: `Não encontrei "${seguro}" em dados/documentos/.`,
        detalhe: 'arquivo ausente',
        resolveu: false,
      };
    }

    const texto = extrairTextoPdf(buffer);
    if (texto.length < 40) {
      return {
        texto:
          `"${seguro}" não tem camada de texto legível — provavelmente é um documento ` +
          `escaneado. Isso exigiria OCR, que não está habilitado neste ambiente.`,
        detalhe: `extração devolveu ${texto.length} caracteres`,
        resolveu: false,
      };
    }

    return {
      texto: texto.slice(0, 12000),
      detalhe: `${texto.length} caracteres extraídos de ${seguro}`,
      resolveu: true,
    };
  },
};

export const HABILIDADES_DADOS: readonly Habilidade[] = [
  executarConsultaSql,
  consultarMemoriaCorporativa,
  extrairTextoDocumento,
];
