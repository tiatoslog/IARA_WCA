# arquivos/identidade-metahuman/

**O conteúdo desta pasta fica fora do Git. Este README é a única exceção.**

Projeto MetaHuman e assets derivados. Assets de MetaHuman são licenciados para
uso **dentro da Unreal Engine**. Versionar ou redistribuir o pacote — inclusive
exportado para `.glb` — está fora dessa licença, e um repositório é
redistribuição.

Além disso é projeto de engine, não código do produto: o Kernel não conhece
renderizador.

## Se a identidade 3D for adotada

O que entra no repositório é só o arquivo final que a licença permitir servir,
em `iara-os/apps/web/public/identidade_iara/`.

A projeção viva hoje é a `EntidadePresenca` — geometria procedural, sem GLB e sem
rig. O componente `AvatarPresenca` existe, está pronto e não é montado por
ninguém; ver o comentário no topo dele e `components/projecao/EXPORTACAO.md`.

O modelo que os testes usam é outro: `ativos/identidade_iara/source.glb`, que é o
"Lisa - Woman Head with BlendShapes" sob CC-BY-4.0 — licença que **permite uso
comercial** e exige crédito. O crédito está em
`ativos/identidade_iara/LICENCA-lisa.txt`.

## ⚠️ A regra do .gitignore acompanha esta pasta

Se mover esta pasta, mova a regra junto. Em 14/08/2026, movê-la para cá fez os
`.mhpkg` voltarem a aparecer como não rastreados — uma reorganização de pastas
desfazendo, em silêncio, uma proteção de licença.
