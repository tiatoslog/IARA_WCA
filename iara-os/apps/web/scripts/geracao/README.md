# scripts/geracao/

**Estes scripts ESCREVEM no repositório.** Rodá-los altera arquivos versionados
— confira o `git diff` depois.

| Script | Lê | Escreve |
|---|---|---|
| `gerar-marca.ts` | `ativos/referencia/` | `public/marca/` |
| `gerar-icones.ts` | `public/marca/iara-simbolo.png` | `public/icones/`, e `icone-fonte.png` do app desktop |

```bash
npm run marca     # símbolo e imagens da marca
npm run icones    # ícones do PWA e do desktop (depende do anterior)
```

A ordem importa: `icones` consome o que `marca` produz.

Ambos resolvem caminho a partir de `process.cwd()`, então **precisam rodar de
`iara-os/apps/web`** — é o que os scripts do `package.json` garantem.

## O que não vai aqui

Script que escreva em `dados/`, no banco ou em serviço externo. Esta pasta gera
**artefato de repositório**, não altera dado de operação.
