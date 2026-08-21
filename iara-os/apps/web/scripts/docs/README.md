# scripts/docs/

O gerador da documentação técnica. `npm run docs`.

| Arquivo | Papel |
|---|---|
| `gerar-documentacao.mjs` | orquestra: monta o roteiro, gera os quatro formatos, varre segredos |
| `derivar.mjs` | as seções lidas do repositório |
| `markdown.mjs` | analisador do subconjunto de Markdown usado |
| `html.mjs` | árvore de blocos → HTML autocontido |
| `docx.mjs` | árvore de blocos → OOXML |
| `pdf.mjs` | árvore de blocos → PDF |
| `zip.mjs` | escritor de ZIP mínimo (um `.docx` é um ZIP de XML) |

## Sem dependência nova, e por quê

Word, LibreOffice e pandoc não existem no runner do CI, e "funciona na minha
máquina" é exatamente o que uma documentação auto-gerada não pode ser. O `.docx`
é montado com o `zlib` que já vem no Node; o PDF é escrito direto, com as fontes
base-14 que todo leitor é obrigado a ter.

## Onde mexer

- Seção **derivada** errada ou faltando → `derivar.mjs`, e registre no `ROTEIRO`
  de `gerar-documentacao.mjs`.
- Seção **escrita à mão** → `docs/manual/`, na raiz do repositório.
- Marcação de Markdown não reconhecida → `markdown.mjs`. É melhor a árvore dizer
  "não sei o que é isto" do que sair marcação crua no documento entregue.

## A varredura final

`gerar-documentacao.mjs` termina procurando, no documento pronto, o formato de
segredo e de dado pessoal (chave, JWT, string de conexão, CPF, CNPJ, telefone,
chave privada). Se acha, **falha a geração**.

Quando isso acontecer, a correção é na **origem** — o código ou a seção manual.
Nunca no arquivo gerado: ele é reescrito na próxima execução, e o problema volta.
