# scripts/geracao/

**Estes scripts ESCREVEM no repositório.** Rodá-los altera arquivos versionados
— confira o `git diff` depois.

| Script | Lê | Escreve |
|---|---|---|
| `gerar-marca.ts` | `ativos/referencia/` | `public/marca/` |
| `gerar-icones.ts` | `public/marca/iara-simbolo.png` | `public/icones/`, e `icone-fonte.png` do app desktop |
| `ingerir-pops.ts` | `arquivos/procedimentos/*.pptx` | `dados/procedimentos/`, `public/procedimentos/` |

```bash
npm run marca     # símbolo e imagens da marca
npm run icones    # ícones do PWA e do desktop (depende do anterior)
npm run pops      # POPs → base estruturada do SOS + capturas de tela
```

A ordem importa: `icones` consome o que `marca` produz.

Ambos resolvem caminho a partir de `process.cwd()`, então **precisam rodar de
`iara-os/apps/web`** — é o que os scripts do `package.json` garantem.

## O que não vai aqui

Script que escreva em `dados/memoria/`, em `dados/operacoes/`, no banco ou em
serviço externo. Esta pasta gera **artefato de repositório**, não altera dado de
operação nem dado privado de ninguém.

⚠️ A regra dizia `dados/` inteiro até 19/08/2026, e foi afrouxada de propósito
quando `ingerir-pops.ts` entrou. O que ela protege é dado **de operação e
privado** — shard de operador, jornal de efeitos —, e não o caminho `dados/` por
si: a base de POPs é artefato gerado e versionado, exatamente o que esta pasta
produz. Afrouxar a regra por escrito é melhor que deixar um script violá-la em
silêncio; o dia em que alguém quiser escrever num shard daqui, a regra ainda
está de pé e diz não.
