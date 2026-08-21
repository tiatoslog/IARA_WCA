# mascarar-relatorio.md — o que foi removido das capturas

> Gerado por `project/mascarar.py`. Não editar à mão.

**8 capturas processadas · 16 faixas mascaradas.**

O renderizador lê **apenas** de `assets/screenshots/`. A cópia crua em
`public/procedimentos/` não é aberta pelo pipeline de vídeo.

## `42a3607a3cf2.png` — Planilha CONTATOS LUFT — postos e centrais

- Dimensões: 1259×438
- SHA-256 origem: `42a3607a3cf2e446` → saída: `5ba120668c8f6b88`
- **Mascarado:**
  - nome de contato do posto
  - telefone do posto
  - nome do motorista
  - telefone do motorista
  - nome do contato da central
  - telefone da central
- **Preservado deliberadamente:**
  - cabeçalho das colunas (é o conteúdo didático do passo 2.10)
  - coluna CENTRAL — nomes de cidade não são dado pessoal

## `b6e615e3f096.png` — E-mail de recebimento da OCI

- Dimensões: 1284×398
- SHA-256 origem: `b6e615e3f09632c4` → saída: `f5f527ad65ee134c`
- **Mascarado:**
  - remetente: nome + e-mail
  - destinatários: nomes + e-mails
  - continuação dos destinatários
  - saudação nominal
  - assinatura: nome da remetente
  - marca d'água Ativar o Windows
- **Preservado deliberadamente:**
  - linha Assunto — descreve origem e destino da carga (passo 1.1)
  - as duas linhas OCI 184957 / 184958 — é o que o aluno precisa reconhecer
  - corpo da mensagem e data de envio
  - razão social no rodapé — pessoa jurídica

## `242b460e7efd.png` — Planilha de controle de OCIs — linha de lançamento

- Dimensões: 1042×225
- SHA-256 origem: `242b460e7efd87b7` → saída: `cd2c6ce0524d0330`
- **Mascarado:**
  - primeiro nome de motorista
- **Preservado deliberadamente:**
  - OCI, ORIGEM, DESTINO, U.F., DATA REC. — os campos que o aluno preenche
  - coluna ROTA — objeto do passo 2.7

## `e93c9a811c0e.png` — Bloco AGENDAMENTO — postos, central e TAC

- Dimensões: 528×224
- SHA-256 origem: `e93c9a811c0ecb20` → saída: `3ecb3c973ab0a34b`
- **Mascarado:**
  - nome do contato do posto
  - nome do contato da central
- **Preservado deliberadamente:**
  - colunas DATA e HORA — o que o passo manda registrar
  - cabeçalhos POSTOS / CENTRAL / TAC

## `c55adba2c23c.png` — Colunas DATA COLETA e DATA DESCARGA

- Dimensões: 463×252
- SHA-256 origem: `c55adba2c23c0c72` → saída: `c87feb3fc3308dbb`
- **Mascarado:**
  - nome de motorista
- **Preservado deliberadamente:**
  - DATA REC. OCI, DATA COLETA, DATA DESCARGA — objeto dos passos 2.14/2.15

## `1c66b4f5a0c3.png` — Caminho de rede da planilha

- Dimensões: 898×227
- SHA-256 origem: `1c66b4f5a0c3db5d` → saída: `f0b9a6561f587659`
- **Mascarado:** nada — a captura não contém dado pessoal

## `294247ef05fb.png` — Lista de arquivos — planilha de contatos

- Dimensões: 419×138
- SHA-256 origem: `294247ef05fb35fc` → saída: `6d6100cee9758504`
- **Mascarado:** nada — a captura não contém dado pessoal

## `d5c9b293e917.png` — Trilha de pastas CtrFrete

- Dimensões: 569×73
- SHA-256 origem: `d5c9b293e91748c5` → saída: `658e015ebfccc755`
- **Mascarado:** nada — a captura não contém dado pessoal
