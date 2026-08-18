# docs/gerado/

**Saída automática. Não editar nada aqui.**

Todo arquivo desta pasta é reescrito por `npm run docs` e recommitado pelo
workflow `.github/workflows/documentacao.yml` a cada publicação em `main`.

| Arquivo | Para quê |
|---|---|
| `IARA-OS-Documentacao.md` | leitura no próprio repositório |
| `IARA-OS-Documentacao.html` | autocontido: abre por duplo clique, imprime bem |
| `IARA-OS-Documentacao.docx` | entrega e anexo |
| `IARA-OS-Documentacao.pdf` | impressão e reunião |

## Para corrigir algo que está errado no documento

Depende de qual metade:

- Seção **derivada do código** (dependências, rotas, habilidades, regras, banco,
  variáveis, rotinas): corrija o código. O documento acompanha sozinho.
- Seção **escrita à mão**: corrija o arquivo correspondente em `docs/manual/`.

Editar aqui não resolve — a próxima geração desfaz.
