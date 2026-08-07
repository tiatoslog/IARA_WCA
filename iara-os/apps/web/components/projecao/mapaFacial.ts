/**
 * Tradução entre parâmetro semântico e blendshape do modelo.
 *
 * POR QUE ESTA CAMADA EXISTE: nenhum componente pode conhecer nome de morph
 * target, pela mesma razão que nenhum componente conhece nome de arquivo de
 * sprite (ver `lib/cenario.ts`). O controlador facial pede "mandíbula abre 0.4";
 * quem sabe que isso se chama `jaw_open` neste modelo — e `jawOpen` no próximo —
 * é esta tabela. Trocar de avatar é editar este arquivo, e mais nada.
 *
 * Os nomes da coluna MetaHuman foram lidos do rig real (`SK_Natasha_V3_Face`,
 * 737 blendshapes FACS). Vale reparar na inconsistência de sufixo do próprio
 * pack: `eye_blink_L` convive com `mouth_cornerPull_left`. Não é erro de
 * digitação aqui — é assim no arquivo, e por isso a resolução é por lista de
 * candidatos em vez de por regra de sufixo.
 *
 * REGRA DE RESOLUÇÃO: todo candidato que existir no modelo é acionado. Isso
 * cobre os dois casos de uma vez — nomenclaturas alternativas (MetaHuman vs.
 * ARKit, das quais só uma existe por modelo) e parâmetros que legitimamente
 * movem vários alvos (funil de lábio são quatro quadrantes).
 */

export type ParametroFacial =
  // olhos
  | 'piscar_e'
  | 'piscar_d'
  | 'olhar_esquerda'
  | 'olhar_direita'
  | 'olhar_cima'
  | 'olhar_baixo'
  | 'palpebra_apertada'
  | 'olho_arregalado'
  // sobrancelhas
  | 'sobrancelha_sobe'
  | 'sobrancelha_interna_sobe'
  | 'sobrancelha_desce'
  // boca
  | 'mandibula_abre'
  | 'labios_arredondam'
  | 'labios_selam'
  | 'labios_esticam'
  | 'canto_sobe'
  | 'canto_desce'
  | 'bochecha_sobe';

/**
 * Prefixo das malhas MetaHuman. O `head_lod0_mesh__` some quando o exportador
 * de glTF normaliza os nomes, então o casamento é por sufixo — ver `resolver`.
 */
export const MAPA_FACIAL: Record<ParametroFacial, string[]> = {
  piscar_e: ['eye_blink_L', 'eyeBlink_L', 'eyeBlinkLeft'],
  piscar_d: ['eye_blink_R', 'eyeBlink_R', 'eyeBlinkRight'],

  olhar_esquerda: ['eye_lookLeft_L', 'eye_lookLeft_R', 'eyeLookOut_L', 'eyeLookIn_R', 'eyeLookOutLeft', 'eyeLookInRight'],
  olhar_direita: ['eye_lookRight_L', 'eye_lookRight_R', 'eyeLookIn_L', 'eyeLookOut_R', 'eyeLookInLeft', 'eyeLookOutRight'],
  olhar_cima: ['eye_lookUp_L', 'eye_lookUp_R', 'eyeLookUp_L', 'eyeLookUp_R', 'eyeLookUpLeft', 'eyeLookUpRight'],
  olhar_baixo: ['eye_lookDown_L', 'eye_lookDown_R', 'eyeLookDown_L', 'eyeLookDown_R', 'eyeLookDownLeft', 'eyeLookDownRight'],

  palpebra_apertada: ['eye_squintInner_L', 'eye_squintInner_R', 'eyeSquint_L', 'eyeSquint_R'],
  olho_arregalado: ['eye_widen_L', 'eye_widen_R', 'eyeWide_L', 'eyeWide_R'],

  sobrancelha_sobe: ['brow_raise_L', 'brow_raise_R', 'brow_raiseOuter_left', 'brow_raiseOuter_right', 'browOuterUp_L', 'browOuterUp_R'],
  sobrancelha_interna_sobe: ['brow_raiseIn_L', 'brow_raiseIn_R', 'browInnerUp'],
  sobrancelha_desce: ['brow_down_L', 'brow_down_R', 'browDown_L', 'browDown_R'],

  mandibula_abre: ['jaw_open', 'jawOpen'],

  labios_arredondam: [
    'mouth_funnel_UL', 'mouth_funnel_UR', 'mouth_funnel_DL', 'mouth_funnel_DR',
    'mouth_lipsPurse_UL', 'mouth_lipsPurse_UR', 'mouth_lipsPurse_DL', 'mouth_lipsPurse_DR',
    'mouthFunnel', 'mouthPucker',
  ],
  labios_selam: ['mouth_lipsPress_L', 'mouth_lipsPress_R', 'mouthClose', 'mouthPress_L', 'mouthPress_R'],
  labios_esticam: ['mouth_stretch_left', 'mouth_stretch_right', 'mouthStretch_L', 'mouthStretch_R'],

  canto_sobe: ['mouth_cornerPull_left', 'mouth_cornerPull_right', 'mouthSmile_L', 'mouthSmile_R'],
  canto_desce: ['mouth_cornerDepress_L', 'mouth_cornerDepress_R', 'mouthFrown_L', 'mouthFrown_R'],

  bochecha_sobe: ['eye_cheekRaise_L', 'eye_cheekRaise_R', 'cheekSquint_L', 'cheekSquint_R'],
};

/** Um alvo já resolvido: em qual malha e em qual índice do array de influências. */
export interface AlvoMorph {
  indice: number;
  /** Guardado só para diagnóstico — o loop de animação usa o índice. */
  nome: string;
}

/**
 * Casa a tabela com o dicionário de morphs de uma malha.
 *
 * O casamento é por sufixo porque exportadores de glTF prefixam o nome da malha
 * (`head_lod0_mesh__eye_blink_L`) ou não (`eye_blink_L`), e não dá para saber
 * qual dos dois virá antes de abrir o arquivo. Sufixo cobre os dois.
 */
export function resolverAlvos(
  dicionario: Record<string, number>,
): Partial<Record<ParametroFacial, AlvoMorph[]>> {
  const nomes = Object.keys(dicionario);
  const resolvido: Partial<Record<ParametroFacial, AlvoMorph[]>> = {};

  for (const [parametro, candidatos] of Object.entries(MAPA_FACIAL) as Array<
    [ParametroFacial, string[]]
  >) {
    const alvos: AlvoMorph[] = [];
    for (const candidato of candidatos) {
      for (const nome of nomes) {
        if (nome === candidato || nome.endsWith(`__${candidato}`) || nome.endsWith(`_${candidato}`)) {
          alvos.push({ indice: dicionario[nome], nome });
        }
      }
    }
    if (alvos.length > 0) resolvido[parametro] = alvos;
  }

  return resolvido;
}

/**
 * O mínimo que um modelo precisa ter para sustentar presença.
 *
 * Sem estes cinco, o rosto não consegue nem falar nem olhar — e um rosto parado
 * em cima de um sistema que está trabalhando é pior do que nenhum rosto: afirma
 * que nada está acontecendo. É o teste que decide entre montar o avatar ou cair
 * no aviso honesto de rig ausente.
 */
export const PARAMETROS_ESSENCIAIS: ParametroFacial[] = [
  'mandibula_abre',
  'piscar_e',
  'piscar_d',
  'olhar_esquerda',
  'olhar_cima',
];

export function rigSuficiente(
  resolvido: Partial<Record<ParametroFacial, AlvoMorph[]>>,
): boolean {
  return PARAMETROS_ESSENCIAIS.every((p) => (resolvido[p]?.length ?? 0) > 0);
}
