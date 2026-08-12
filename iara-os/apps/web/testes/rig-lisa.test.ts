/**
 * O rig da Lisa sustenta presença.
 *
 * O dicionário abaixo é a lista REAL dos 62 blendshapes do GLB em
 * `ativos/identidade_iara/source.glb` (lida do binário FBX original, canal a
 * canal). Se o mapa facial deixar de casar com ela, a projeção Presença cai no
 * aviso de rig ausente — e este teste conta o porquê antes de a tela contar.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { resolverAlvos, rigSuficiente, PARAMETROS_ESSENCIAIS } from '../components/projecao/mapaFacial';

const CANAIS_LISA = [
  'AA', 'BrowsD_L', 'BrowsD_R', 'BrowsU_C', 'BrowsU_L', 'BrowsU_R', 'CH',
  'CheekSquint_L', 'CheekSquint_R', 'ChinLowerRaise', 'ChinUpperRaise', 'EE',
  'EyeBlink_L', 'EyeBlink_R', 'EyeOpen_L', 'EyeOpen_R', 'EyeSquint_L',
  'EyeSquint_R', 'EyesDown', 'EyesLeft', 'EyesRight', 'EyesUp', 'IH',
  'JawChew', 'JawFwd', 'JawLeft', 'JawOpen', 'JawRight', 'LipsFunnel',
  'LipsLowerClose', 'LipsLowerDown', 'LipsLowerOpen', 'LipsPucker',
  'LipsStretch_L', 'LipsStretch_R', 'LipsUpperClose', 'LipsUpperOpen',
  'LipsUpperUp', 'MouthDimple_L', 'MouthDimple_R', 'MouthFrown_L',
  'MouthFrown_R', 'MouthLeft', 'MouthRight', 'MouthSmile_L', 'MouthSmile_R',
  'OH', 'OU', 'Puff', 'Sneer', 'TH', 'base_head', 'dd', 'ff', 'frown', 'kk',
  'nn', 'pp', 'rr', 'sil', 'smile', 'ss',
];

function dicionarioLisa(): Record<string, number> {
  const d: Record<string, number> = {};
  CANAIS_LISA.forEach((nome, i) => { d[nome] = i; });
  return d;
}

test('o rig da Lisa resolve todos os parâmetros essenciais', () => {
  const resolvido = resolverAlvos(dicionarioLisa());
  for (const p of PARAMETROS_ESSENCIAIS) {
    assert.ok((resolvido[p]?.length ?? 0) > 0, `parâmetro essencial sem alvo: ${p}`);
  }
  assert.equal(rigSuficiente(resolvido), true);
});

test('emoções e visemas têm alvo na Lisa', () => {
  const resolvido = resolverAlvos(dicionarioLisa());
  // O sorriso "solicita" exige o par canto + bochecha (sorriso sem bochecha
  // lê como falso — ver POSE_DA_EMOCAO); os visemas exigem a boca completa.
  for (const p of [
    'canto_sobe', 'bochecha_sobe', 'sobrancelha_interna_sobe',
    'labios_arredondam', 'labios_selam', 'labios_esticam',
    'olho_arregalado', 'palpebra_apertada', 'sobrancelha_desce',
  ] as const) {
    assert.ok((resolvido[p]?.length ?? 0) > 0, `sem alvo: ${p}`);
  }
});

test('o corpo antigo (só esqueleto, zero morphs) continua recusado', () => {
  // Regressão do diagnóstico: dicionário vazio = modelo sem blendshape.
  assert.equal(rigSuficiente(resolverAlvos({})), false);
});
