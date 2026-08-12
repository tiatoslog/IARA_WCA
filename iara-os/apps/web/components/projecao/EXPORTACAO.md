# Exportando a IARA do Unreal para a web

O Projection Engine está pronto e ligado. O que falta é o modelo.

## O problema com o arquivo atual

`ativos/identidade_iara/source.glb` foi verificado byte a byte:

| campo | valor |
| --- | --- |
| meshes | 1 — `SK_Natasha_V3_Body` |
| morph targets | **0** |
| animations | **0** |
| textures / images | **0** |
| materials | 1, `MI_Skin_Body`, sem mapa nenhum |
| nodes | 348 (esqueleto completo; `head_013` é **osso**, não malha) |

É o corpo. Sem cabeça, sem textura, sem blendshape. Nenhuma quantidade de código
faz esse arquivo falar ou olhar — não há o que animar.

A cara dela está em `SK_Natasha_V3_Face.FBX` (dentro de `source.zip`), com **737
blendshapes FACS** do rig MetaHuman. Esse FBX também não tem textura: elas vivem
dentro do `.uasset` de 145 MB no `mhc_hannah.mhpkg`, legível só pelo Unreal.

Por isso o caminho é re-exportar da engine, e não converter o que já está aqui.

## O que o engine precisa receber

Um único `.glb` em `ativos/identidade_iara/source.glb`, com:

**1. Face e corpo na mesma malha ou no mesmo arquivo.** Incluir olhos, dentes e
língua — sem a malha dos olhos o olhar não existe, e o rosto fica com dois
buracos escuros.

**2. Texturas embutidas (`Embed Textures`).** Baked em albedo/normal/roughness.
Sem elas a IARA sai cinza fosca, que lê como manequim de vitrine.

**3. Blendshapes REDUZIDOS.** Não exporte os 737. Cada target guarda deltas por
vértice; o arquivo inteiro fica inservível por HTTP. O engine usa 34, listados
abaixo. Nomes MetaHuman originais — o prefixo de malha
(`head_lod0_mesh__`) pode ficar ou sair, `mapaFacial.ts` casa por sufixo.

Essenciais — sem estes o rosto é recusado e a tela mostra o aviso honesto:

```
jaw_open
eye_blink_L          eye_blink_R
eye_lookLeft_L       eye_lookLeft_R
eye_lookRight_L      eye_lookRight_R
eye_lookUp_L         eye_lookUp_R
eye_lookDown_L       eye_lookDown_R
```

Expressão — sem estes o rosto fala, mas não sente:

```
brow_raise_L         brow_raise_R
brow_raiseIn_L       brow_raiseIn_R
brow_down_L          brow_down_R
eye_widen_L          eye_widen_R
eye_squintInner_L    eye_squintInner_R
eye_cheekRaise_L     eye_cheekRaise_R
mouth_cornerPull_left    mouth_cornerPull_right
mouth_cornerDepress_L    mouth_cornerDepress_R
mouth_stretch_left       mouth_stretch_right
mouth_lipsPress_L        mouth_lipsPress_R
mouth_funnel_UL  mouth_funnel_UR  mouth_funnel_DL  mouth_funnel_DR
```

Se o seu exportador só entregar nomes ARKit (`jawOpen`, `eyeBlinkLeft`,
`mouthSmile_L`…), também serve: a tabela já resolve as duas nomenclaturas.

**4. LOD0 decimado.** A cabeça MetaHuman em LOD0 é cara demais para navegador.
Alvo: **≤ 40 MB** o arquivo inteiro, ~60k triângulos. LOD1 ou LOD2 do próprio
MetaHuman normalmente já resolve.

**5. Osso da cabeça com nome reconhecível** — `head`, `head_*` ou
`mixamorigHead`. É por ele que giro, inclinação e aceno acontecem.

**6. Sem animação embutida.** O engine dirige tudo por parâmetro. Clipe de idle
no arquivo seria movimento que não corresponde a fato nenhum — exatamente o que
a direção de arte proíbe.

## Como saber que deu certo

```bash
npm test
```

O teste `ESTADO CONHECIDO: o modelo atual não tem rig facial` **vai falhar** — e
essa falha é a notícia boa. Ele afirma o estado atual do asset; quando o modelo
novo entrar, ele acusa a mudança. Inverta a asserção nesse momento.

Na tela, troque para a projeção **Presença**: o aviso "Sem rig facial" some
sozinho e o rosto assume.

## O que o engine faz com o modelo

Não altera nada dele. Não cria morph target, não renomeia osso, não injeta
animação, não toca no GLB. Ele lê o rig que existe, casa com a tabela semântica
de `mapaFacial.ts` e escreve influências quadro a quadro em `ControladorFacial`.

Trocar de avatar depois é editar `mapaFacial.ts`, e mais nada — mesmo contrato
que `lib/cenario.ts` tem com o pack de pixel art.
