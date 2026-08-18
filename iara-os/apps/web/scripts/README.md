# scripts/

Utilitários de linha de comando. Todos rodam a partir de `iara-os/apps/web`.

A separação é por **o que o script faz com o disco**, não por assunto. Quem chega
novo precisa saber, pelo nome da pasta, se pode rodar sem medo.

| Pasta | Escreve? | Onde |
|---|---|---|
| `diagnostico/` | **não** | — |
| `provas/` | só em diretório temporário | `tmpdir` do sistema |
| `geracao/` | **sim** | `public/`, e os ícones do app desktop |
| `docs/` | **sim** | `docs/gerado/` |

Registrados no `package.json`: `npm run verificar`, `npm run docs`,
`npm run marca`, `npm run icones`, `npm run vozes`, `npm run medir:voz`.

## Ao acrescentar um script

1. Escolha a pasta pelo critério acima, não pelo assunto.
2. Comece com um comentário de topo explicando **por que ele existe** — a
   primeira frase vira a descrição dele na documentação gerada.
3. Se ele for chamado com frequência, registre no `package.json`.

Imports relativos daqui saem de duas pastas acima: `../../servidor/…`,
`../../lib/…`. `npm run verificar` confere que todos resolvem.
