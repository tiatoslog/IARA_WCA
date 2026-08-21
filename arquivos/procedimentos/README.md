# arquivos/procedimentos/

Os POPs oficiais da operação — **a fonte da verdade do IARA SOS**.

Instruções de trabalho em PowerPoint, no padrão `IT - ADMLUFT - NNN - NOME.pptx`.
Hoje são 11, todos do sistema **GW**, elaborados entre 29/05/2025 e 06/06/2025.

## Vão no Git, e por quê

Ao contrário de `packs-arte/` e `identidade-metahuman/`, aqui **não há restrição
de licença**: é material da própria casa. E versionar não é só higiene — é o que
faz uma revisão de POP aparecer como `git diff` em vez de virar um arquivo
sobrescrito que ninguém sabe explicar. A proibição ❌4 do
`iara-os/apps/web/docs/prd/hierarquia-da-verdade-sos.md` ("nunca apagar
conhecimento anterior sem versionamento") começa a ser cumprida aqui, no Git,
antes de qualquer código.

## Como o conteúdo chega até a IARA

```bash
cd iara-os/apps/web
npm run pops
```

Lê estes `.pptx` e gera a base estruturada em `dados/procedimentos/` mais as
capturas de tela em `public/procedimentos/`. **Estes arquivos nunca são escritos
por código** — nenhum caminho da IARA escreve aqui. POP novo ou revisado entra
por pessoa, e a revisão é o `git diff`.

## O que não vai aqui

- POP de sistema que não seja GW sem declarar o sistema no nome e no cabeçalho.
  Busca lexical não distingue sistema sozinha, e misturar procedimentos de
  sistemas diferentes é a proibição ❌5 — a mais fácil de violar sem perceber
  enquanto **todos** os POPs forem GW.
- Documento que não seja procedimento (contrato, especificação, planilha):
  esses vão em `arquivos/documentos/`.
- Qualquer arquivo gerado. `dados/procedimentos/` e `public/procedimentos/` são
  saída de `npm run pops`, não entrada.

## O que a operação ainda precisa resolver

Medido nos 11 arquivos, não estimado:

- **`Data`, `Elaborado por`, `Analisado por` e `Aprovado por` estão vazios em
  todos os 11.** Enquanto estiverem, a IARA vai citar "aprovador não informado
  no documento" — porque preencher isso por conta própria seria inventar um
  aprovador, e um aprovador falso é o que faz alguém confiar sem conferir.
- **A revisão está inconsistente:** 001–005, 007 e 008 em `REV.:02`; 006, 009,
  010 e 011 em `REV.:01`. O **006 traz as duas no mesmo arquivo**.
- **Nenhum dos 11 documenta mensagem de erro.** É por isso que o modo "deu erro"
  do SOS não nasce da ingestão: ele nasce das lacunas que o uso registrar.
