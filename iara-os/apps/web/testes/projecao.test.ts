/**
 * Testes da camada de projeção — visemas, ligação com o rig e o asset real.
 *
 * O último bloco é o mais importante do arquivo: ele abre o GLB que está em
 * `public/identidade_iara/` e afirma o que esse arquivo REALMENTE tem. Hoje ele
 * falha em ter rig facial, e o teste documenta isso em vez de deixar a
 * descoberta para quem abrir a tela. No dia em que o modelo for re-exportado do
 * Unreal com blendshapes, o teste vira o sinal de que o pipeline ficou pronto.
 *
 *   npm test
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  ABERTURA_DO_VISEMA,
  CARACTERES_POR_SEGUNDO,
  trilhaDeVisemas,
  visemaAgora,
  visemaNoProgresso,
} from '../lib/visemas';
import { resolverAlvos, rigSuficiente, PARAMETROS_ESSENCIAIS } from '../components/projecao/mapaFacial';

// ---------------------------------------------------------------------------
// Visemas
// ---------------------------------------------------------------------------

test('trilha de visemas mantém alinhamento 1:1 com o texto', () => {
  // O cursor de tempo indexa a trilha pelo índice do CARACTERE. Se um dígrafo
  // ocupasse uma posição só, a boca dessincronizaria do texto revelado a partir
  // do primeiro "ch" da resposta.
  const texto = 'chuva nao molha o rack';
  assert.equal(trilhaDeVisemas(texto).length, texto.length);
});

test('dígrafo vale mais que a soma das letras', () => {
  // 'ch' não é K seguido de H — é um visema de lábio projetado.
  assert.deepEqual(trilhaDeVisemas('ch'), ['CH', 'CH']);
  assert.deepEqual(trilhaDeVisemas('nh'), ['CH', 'CH']);
  assert.deepEqual(trilhaDeVisemas('rr'), ['RR', 'RR']);
  // Já 'c' sozinho continua sendo K.
  assert.deepEqual(trilhaDeVisemas('ca'), ['KK', 'AA']);
});

test('espaço e pontuação viram repouso', () => {
  assert.deepEqual(trilhaDeVisemas('a, b'), ['AA', 'repouso', 'repouso', 'PP']);
});

test('a boca nunca articula texto que ainda não chegou', () => {
  const trilha = trilhaDeVisemas('aaaaaaaaaa'); // 10 caracteres, todos AA
  // Tempo suficiente para 10 caracteres, mas só 3 revelados pelo servidor.
  const decorrido = (10 / CARACTERES_POR_SEGUNDO) * 1000;
  const { visema } = visemaAgora(trilha, 3, decorrido);
  // Travada no que existe: ainda é AA (índice 3 não passou do fim revelado),
  // e não `repouso`, que só acontece ao alcançar o fim da trilha inteira.
  assert.equal(visema, 'AA');
});

test('a boca nunca corre à frente da cadência de locução', () => {
  const trilha = trilhaDeVisemas('aaaaaaaaaa');
  // Texto todo revelado, mas só 100 ms decorridos: ~1.4 caracteres de fala.
  const { progresso } = visemaAgora(trilha, 10, 100);
  assert.ok(progresso < 0.2, `progresso ${progresso} deveria estar no começo`);
});

test('fala terminada fecha a boca', () => {
  const trilha = trilhaDeVisemas('oi');
  const { visema, progresso } = visemaAgora(trilha, 2, 60_000);
  assert.equal(visema, 'repouso');
  assert.equal(progresso, 1);
  assert.equal(ABERTURA_DO_VISEMA[visema], 0);
});

test('texto vazio não move nada', () => {
  assert.deepEqual(visemaAgora([], 0, 999), { visema: 'repouso', progresso: 0 });
});

// ---------------------------------------------------------------------------
// Boca dirigida pelo áudio real
// ---------------------------------------------------------------------------

test('com áudio, a boca segue o relógio da locução', () => {
  // "amor": A-M-O-R. Na metade do áudio a boca está no 'O', independente de
  // quantos caracteres por segundo alguém teria lido.
  const trilha = trilhaDeVisemas('amor');
  assert.equal(visemaNoProgresso(trilha, 0).visema, 'AA');
  assert.equal(visemaNoProgresso(trilha, 0.3).visema, 'PP'); // m
  assert.equal(visemaNoProgresso(trilha, 0.55).visema, 'OO');
  assert.equal(visemaNoProgresso(trilha, 0.8).visema, 'RR');
});

test('fim do áudio fecha a boca', () => {
  const trilha = trilhaDeVisemas('amor');
  assert.deepEqual(visemaNoProgresso(trilha, 1), { visema: 'repouso', progresso: 1 });
});

test('progresso fora de 0..1 não estoura a trilha', () => {
  // `currentTime/duration` pode passar de 1 por um quadro no fim do áudio, e
  // um índice fora do array viraria `undefined` no meio do loop de animação.
  const trilha = trilhaDeVisemas('oi');
  assert.equal(visemaNoProgresso(trilha, 1.4).visema, 'repouso');
  assert.equal(visemaNoProgresso(trilha, -0.2).visema, 'OO');
  assert.equal(visemaNoProgresso([], 0.5).visema, 'repouso');
});

// ---------------------------------------------------------------------------
// Ligação com o rig
// ---------------------------------------------------------------------------

/** Dicionário mínimo com a nomenclatura MetaHuman, prefixada como o pack usa. */
const RIG_METAHUMAN: Record<string, number> = {
  head_lod0_mesh__jaw_open: 0,
  head_lod0_mesh__eye_blink_L: 1,
  head_lod0_mesh__eye_blink_R: 2,
  head_lod0_mesh__eye_lookLeft_L: 3,
  head_lod0_mesh__eye_lookLeft_R: 4,
  head_lod0_mesh__eye_lookUp_L: 5,
  head_lod0_mesh__eye_lookUp_R: 6,
  head_lod0_mesh__mouth_cornerPull_left: 7,
};

test('resolve nomes MetaHuman mesmo com o prefixo da malha', () => {
  const alvos = resolverAlvos(RIG_METAHUMAN);
  assert.deepEqual(alvos.mandibula_abre?.map((a) => a.indice), [0]);
  assert.deepEqual(alvos.piscar_e?.map((a) => a.indice), [1]);
  // Olhar para a esquerda move os DOIS olhos: dois alvos, um parâmetro.
  assert.deepEqual(alvos.olhar_esquerda?.map((a) => a.indice), [3, 4]);
});

test('absorve a inconsistência de sufixo do próprio pack', () => {
  // `eye_blink_L` e `mouth_cornerPull_left` convivem no MetaHuman. Uma regra de
  // sufixo única quebraria em um dos dois.
  const alvos = resolverAlvos(RIG_METAHUMAN);
  assert.equal(alvos.piscar_e?.length, 1);
  assert.equal(alvos.canto_sobe?.length, 1);
});

test('resolve nomenclatura ARKit sem tabela separada', () => {
  const alvos = resolverAlvos({
    jawOpen: 0,
    eyeBlinkLeft: 1,
    eyeBlinkRight: 2,
    eyeLookOutLeft: 3,
    eyeLookUpLeft: 4,
  });
  assert.deepEqual(alvos.mandibula_abre?.map((a) => a.indice), [0]);
  assert.deepEqual(alvos.piscar_d?.map((a) => a.indice), [2]);
});

test('rig sem os essenciais é recusado', () => {
  assert.equal(rigSuficiente(resolverAlvos(RIG_METAHUMAN)), true);
  // Tira a mandíbula: sem ela não há fala, e o rig deixa de servir.
  const { head_lod0_mesh__jaw_open: _fora, ...semMandibula } = RIG_METAHUMAN;
  assert.equal(rigSuficiente(resolverAlvos(semMandibula)), false);
  assert.equal(rigSuficiente({}), false);
});

// ---------------------------------------------------------------------------
// O asset que está no repositório agora
// ---------------------------------------------------------------------------

/** Lê o cabeçalho JSON de um .glb sem depender do three. */
function lerGlb(caminho: string): {
  meshes: Array<{ nome: string; morphs: number; alvos: string[] }>;
  animacoes: number;
  imagens: number;
} {
  const buf = readFileSync(caminho);
  assert.equal(buf.readUInt32LE(0), 0x46546c67, 'assinatura glTF ausente');

  let off = 12;
  let json: Record<string, unknown> | null = null;
  while (off < buf.length) {
    const tamanho = buf.readUInt32LE(off);
    const tipo = buf.readUInt32LE(off + 4);
    if (tipo === 0x4e4f534a) {
      json = JSON.parse(new TextDecoder().decode(buf.subarray(off + 8, off + 8 + tamanho)));
      break;
    }
    off += 8 + tamanho + ((4 - ((off + 8 + tamanho) % 4)) % 4);
  }
  assert.ok(json, 'bloco JSON não encontrado no glb');

  const g = json as {
    meshes?: Array<{ name: string; primitives: Array<{ targets?: unknown[] }>; extras?: { targetNames?: string[] } }>;
    animations?: unknown[];
    images?: unknown[];
  };

  return {
    meshes: (g.meshes ?? []).map((m) => ({
      nome: m.name,
      morphs: m.primitives?.[0]?.targets?.length ?? 0,
      alvos: m.extras?.targetNames ?? [],
    })),
    animacoes: g.animations?.length ?? 0,
    imagens: g.images?.length ?? 0,
  };
}

const CAMINHO_GLB = fileURLToPath(new URL('../public/identidade_iara/source.glb', import.meta.url));

test('o modelo publicado é um glTF válido e servível', () => {
  const glb = lerGlb(CAMINHO_GLB);
  assert.ok(glb.meshes.length > 0, 'nenhuma malha no modelo');
});

test('ESTADO CONHECIDO: o modelo atual não tem rig facial', () => {
  const glb = lerGlb(CAMINHO_GLB);
  const dicionario: Record<string, number> = {};
  let i = 0;
  for (const malha of glb.meshes) for (const alvo of malha.alvos) dicionario[alvo] = i++;

  const total = glb.meshes.reduce((s, m) => s + m.morphs, 0);

  // Se esta asserção começar a falhar, é boa notícia: significa que o modelo
  // foi re-exportado com blendshapes. Troque este teste pelo inverso e ligue a
  // projeção 3D — ver EXPORTACAO.md.
  assert.equal(total, 0, 'o modelo ganhou morph targets — atualize este teste');
  assert.equal(
    rigSuficiente(resolverAlvos(dicionario)),
    false,
    'rig suficiente: a projeção 3D pode assumir o rosto',
  );

  // O que falta, nomeado, para o aviso na tela não ser genérico.
  const resolvidos = resolverAlvos(dicionario);
  const faltando = PARAMETROS_ESSENCIAIS.filter((p) => !resolvidos[p]?.length);
  assert.deepEqual(faltando, PARAMETROS_ESSENCIAIS);
});
