# docs/

Documentação do IARA OS.

| Pasta | O que vai ali |
|---|---|
| `manual/` | Seções escritas à mão. É onde se escreve. |
| `gerado/` | Saída de `npm run docs`. **Não editar.** |
| `relatorios/` | Registros históricos de auditoria e encerramento. Congelados. |
| `especificacao/` | A especificação do projeto, como documento de origem. |

**O que não vai aqui:** documento em formato binário que não seja saída do
gerador (contrato, planilha, apresentação) — esses vão para `arquivos/`.

## Gerar a documentação

```bash
cd iara-os/apps/web
npm run docs
```

Produz Markdown, HTML, Word e PDF em `docs/gerado/`, combinando o que é derivado
do código com o que está escrito em `docs/manual/`.
