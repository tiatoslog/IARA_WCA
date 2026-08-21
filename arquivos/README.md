# arquivos/

Material de apoio que **não é código**.

| Pasta | O que vai ali | No Git? |
|---|---|---|
| `documentos/` | contratos, especificações e planilhas em formato binário | sim |
| `procedimentos/` | os POPs oficiais (`IT - ADMLUFT - NNN`) — fonte da verdade do SOS | sim |
| `packs-arte/` | os `.zip` originais dos packs de arte | **não** |
| `identidade-metahuman/` | projeto MetaHuman e assets derivados | **não** |

## Por que dois desses ficam fora do Git

Não é higiene, é licença.

- **`packs-arte/`** — *Modern Interiors Free v2.2* proíbe uso comercial e
  *Modern Office 2D Props* proíbe deixar os arquivos originais baixáveis.
  Um repositório é redistribuição, e servir por HTTP é deixar baixável.
  O pack em uso (arlantr, *free to use any way you want*) vai versionado como
  PNG em `public/escritorio/`, o que a licença dele permite.
- **`identidade-metahuman/`** — assets de MetaHuman são licenciados para uso
  **dentro da Unreal Engine**. Versionar ou redistribuir o pacote, inclusive
  exportado para `.glb`, está fora dessa licença.

⚠️ As regras do `.gitignore` que protegem essas duas pastas **acompanham o
caminho**. Ao mover qualquer uma delas, mova a regra junto — senão a proteção de
licença se desfaz em silêncio, e os arquivos entram no próximo commit. Já
aconteceu uma vez, em 14/08/2026, durante a própria reorganização que criou
estas pastas.

## O que não vai aqui

Código, configuração e documentação escrita — esses vão para `iara-os/` e
`docs/`.
